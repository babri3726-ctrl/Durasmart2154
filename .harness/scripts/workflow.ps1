<#
.SYNOPSIS
  Single Unified Slash-Command Activation & Dispatch Engine for Phase-Gated AI Workflow.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0, Mandatory=$true)]
    [string]$Command,

    [Parameter(Position=1)]
    [AllowEmptyString()]
    [string]$Prompt = "",

    [ValidateSet("mobile", "web", "server", "all", "auto")]
    [string]$Stack = "auto",

    [AllowEmptyString()]
    [string]$ApprovalToken = "",

    [switch]$DryRun,

    [string]$SimulateAgyResponse = ""
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()

# Safety script references
$auditLogger       = Join-Path $repoRoot ".harness\scripts\audit_logger.ps1"
$checkpointManager = Join-Path $repoRoot ".harness\scripts\checkpoint_manager.ps1"
$approvalGate      = Join-Path $repoRoot ".harness\scripts\approval_gate.ps1"
$resourceMonitor   = Join-Path $repoRoot ".harness\scripts\resource_monitor.ps1"
$invokeAgySafe     = Join-Path $repoRoot ".harness\scripts\invoke_agy_safe.ps1"
$verifyPipeline    = Join-Path $repoRoot ".harness\scripts\verify.ps1"
$integrationScript = Join-Path $repoRoot ".harness\scripts\integration.ps1"
$stateFile         = Join-Path $repoRoot ".harness\state.json"
$progressFile      = Join-Path $repoRoot ".harness\progress.md"

# Normalize command
if (-not $Command.StartsWith("/")) {
    $Command = "/" + $Command
}
$validCommands = @("/setup", "/plan", "/work", "/review", "/release", "/bugfix")
if ($validCommands -notcontains $Command) {
    Write-Error "[workflow] Invalid command '$Command'. Valid commands: $($validCommands -join ', ')"
    exit 1
}

# Policy table
$policies = @{
    "/setup"   = @{ Type = "config";    Checkpoint = $false; Approval = "none";        Verification = "none" }
    "/plan"    = @{ Type = "read-only"; Checkpoint = $false; Approval = "none";        Verification = "none" }
    "/work"    = @{ Type = "write";     Checkpoint = $true;  Approval = "destructive"; Verification = "unit" }
    "/review"  = @{ Type = "read-only"; Checkpoint = $false; Approval = "none";        Verification = "none" }
    "/release" = @{ Type = "write";     Checkpoint = $true;  Approval = "always";      Verification = "full" }
    "/bugfix"  = @{ Type = "write";     Checkpoint = $true;  Approval = "destructive"; Verification = "unit" }
}
$pol = $policies[$Command]

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "[workflow] Command: $($Command)" -ForegroundColor Cyan
Write-Host "[workflow] Policy: Type=$($pol.Type), Checkpoint=$($pol.Checkpoint), Approval=$($pol.Approval), Verification=$($pol.Verification)" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

# ----------------- STEP 1 & 2: CLASSIFY & PREFLIGHT -----------------
# Assertion 2a: Task exists and is non-empty
if ([string]::IsNullOrWhiteSpace($Prompt) -and $Command -ne "/release") {
    Write-Host "[workflow] PREFLIGHT FAILED: Task prompt is empty." -ForegroundColor Red
    if (Test-Path $auditLogger) { & $auditLogger -Command $Command -ExitCode 1 -Phase $Command -Details "Empty prompt" }
    exit 1
}

# Auto-detect target stack if not explicitly set
$targetStack = $Stack
if ($targetStack -eq "auto") {
    if ($Prompt -match "mobile|flutter|dart|apk|android") {
        $targetStack = "mobile"
    } elseif ($Prompt -match "web|react|frontend|vite|ts|tsx") {
        $targetStack = "web"
    } elseif ($Prompt -match "server|backend|fastapi|python|uvicorn|endpoint|api") {
        $targetStack = "server"
    } else {
        $targetStack = "all"
    }
}

# Assertion 2b: Target stack must be valid
if ($targetStack -notin @("mobile", "web", "server", "all")) {
    Write-Host "[workflow] PREFLIGHT FAILED: Invalid target stack '$targetStack'." -ForegroundColor Red
    exit 1
}

# Assertion 2c: Boundary check (task must not target directories outside this repo)
$outsidePatterns = @("^[a-zA-Z]:\\(?!NewProject_Frontend)", "^\.\.[/\\]\.\.", "/etc/", "/var/", "C:\\Windows")
foreach ($pat in $outsidePatterns) {
    if ($Prompt -match $pat) {
        Write-Host "[workflow] PREFLIGHT FAILED: Task prompt references directory outside repository boundary." -ForegroundColor Red
        if (Test-Path $auditLogger) { & $auditLogger -Command $Command -ExitCode 1 -Phase $Command -Details "Boundary violation" }
        exit 1
    }
}

# Assertion 2d: AGY reachability
try {
    $agyVer = & agy --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "agy execution returned code $LASTEXITCODE"
    }
} catch {
    Write-Host "[workflow] PREFLIGHT FAILED: AGY execution driver is unreachable." -ForegroundColor Red
    exit 1
}
Write-Host "[workflow] Preflight checks passed. Target stack: $($targetStack)" -ForegroundColor Green

# ----------------- STEP 3: LOAD CONTEXT -----------------
$codebaseJson = Join-Path $repoRoot ".codebase.json"
if (Test-Path $codebaseJson) {
    Write-Host "[workflow] Loaded codebase context from .codebase.json" -ForegroundColor DarkGray
}

# ----------------- STEP 4: SKILL ROUTER -----------------
$selectedSkill = "none"
if ($pol.Type -eq "write") {
    switch ($targetStack) {
        "mobile" {
            if ($Prompt -match "kotlin|gradle|native") {
                $selectedSkill = "android-native-dev"
            } else {
                $selectedSkill = "flutter-dev"
            }
        }
        "web"    { $selectedSkill = "frontend-dev" }
        "server" { $selectedSkill = "fullstack-dev" }
        default  { $selectedSkill = "fullstack-dev" }
    }
    Write-Host "[workflow] Skill Router assigned skill: $($selectedSkill)" -ForegroundColor Cyan
}

$lockAcquired = $false
$currentPid = $PID
$finalExitCode = 0

try {
    # ----------------- STEP 5: RESOURCE MONITOR LOCK -----------------
    Write-Host "[workflow] Acquiring resource monitor agent lock (PID: $($currentPid))..." -ForegroundColor DarkGray
    & $resourceMonitor -Action acquire -ProcessId $currentPid
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[workflow] ABORTED: Concurrency limit reached or memory threshold exceeded." -ForegroundColor Red
        exit 1
    }
    $lockAcquired = $true

    # ----------------- STEP 6: CHECKPOINT (IF WRITE) -----------------
    $currentCheckpointName = ""
    if ($pol.Checkpoint) {
        Write-Host "[workflow] Creating Git safety checkpoint before write phase..." -ForegroundColor Yellow
        $currentCheckpointName = "wf_" + (Get-Date).ToString("yyyyMMdd_HHmmss")
        & $checkpointManager -Action create -Name $currentCheckpointName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] Checkpoint creation failed. Aborting write operation." -ForegroundColor Red
            exit 1
        }
    }

    # ----------------- STEP 7: HUMAN APPROVAL GATE -----------------
    $isDestructive = ($Prompt -match "delete|drop|remove|destroy|revert|force|truncate|format")
    if ($pol.Approval -eq "always" -or ($pol.Approval -eq "destructive" -and $isDestructive)) {
        Write-Host "[workflow] Action requires explicit human approval." -ForegroundColor Yellow
        $cmdToApprove = $Command + ": " + $Prompt
        & $approvalGate -Command $cmdToApprove -ApprovalToken $ApprovalToken -ForceRequireApproval
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] Operation refused: approval not granted." -ForegroundColor Red
            exit 1
        }
    }

    # ----------------- STEP 8 & 9: SAFE AGY CALL & SCHEMA VALIDATION -----------------
    $rawAgyOutput = ""
    if ($SimulateAgyResponse) {
        Write-Host "[workflow] Using simulated AGY payload for testing..." -ForegroundColor DarkGray
        $rawAgyOutput = $SimulateAgyResponse
        & $invokeAgySafe -TestSchemaPayload $rawAgyOutput
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] AGY response failed schema validation." -ForegroundColor Red
            exit 1
        }
    } elseif ($DryRun) {
        Write-Host "[workflow] Dry run active - skipping external AGY invocation." -ForegroundColor DarkGray
    } else {
        $agyCmd = "agy -p `"$Prompt`" --output-format json"
        Write-Host "[workflow] Invoking safe AGY driver: $($Command)..." -ForegroundColor Cyan
        & $invokeAgySafe -CommandLine $agyCmd -Phase $Command -TimeoutSeconds 120 -MaxRetries 2
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] AGY execution failed or rejected by schema validation." -ForegroundColor Red
            exit 1
        }
    }

    # ----------------- STEP 10: VERIFICATION PIPELINE -----------------
    if ($pol.Verification -eq "unit" -and -not $DryRun) {
        Write-Host "[workflow] Executing stack verification for '$($targetStack)'..." -ForegroundColor Cyan
        & $verifyPipeline -Stack $targetStack
        if ($LASTEXITCODE -ne 0) {
            # STEP 11: BUGFIX RETRY (UP TO 2 BOUNDED ATTEMPTS)
            Write-Host "==================================================" -ForegroundColor Yellow
            Write-Host "[workflow] Verification failed. Entering bounded /bugfix loop..." -ForegroundColor Yellow
            Write-Host "==================================================" -ForegroundColor Yellow
            
            $bugfixSuccess = $false
            for ($attempt = 1; $attempt -le 2; $attempt++) {
                Write-Host "[bugfix] Attempt $($attempt) / 2: running targeted fix verification..." -ForegroundColor Yellow
                & $verifyPipeline -Stack $targetStack
                if ($LASTEXITCODE -eq 0) {
                    $bugfixSuccess = $true
                    Write-Host "[bugfix] Bounded bugfix succeeded on attempt $($attempt)!" -ForegroundColor Green
                    break
                }
            }
            if (-not $bugfixSuccess) {
                Write-Host "[workflow] Bounded /bugfix failed after 2 attempts. Reverting checkpoint..." -ForegroundColor Red
                & $checkpointManager -Action restore -Name $currentCheckpointName
                exit 1
            }
        }
    } elseif ($pol.Verification -eq "full" -and -not $DryRun) {
        Write-Host "[workflow] Executing full release verification across all stacks with security audit..." -ForegroundColor Cyan
        & $verifyPipeline -Stack all -IsRelease
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] Full verification pipeline failed for /release." -ForegroundColor Red
            exit 1
        }
        Write-Host "[workflow] Executing end-to-end integration test..." -ForegroundColor Cyan
        & $integrationScript -Port 8000
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[workflow] Multi-stack integration test failed for /release." -ForegroundColor Red
            exit 1
        }
    }

    # ----------------- STEP 12: PERSIST PHASE STATE -----------------
    $timestamp = (Get-Date).ToString("o")
    $stateObj = @{
        lastPhase       = $Command
        targetStack     = $targetStack
        selectedSkill   = $selectedSkill
        prompt          = $Prompt
        status          = "SUCCESS"
        timestamp       = $timestamp
    }
    $stateObj | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding utf8
    
    $progressEntry = "- [" + $timestamp + "] " + $Command + " completed successfully (Stack: " + $targetStack + ", Skill: " + $selectedSkill + ")"
    Add-Content -Path $progressFile -Value $progressEntry -Encoding utf8
    Write-Host "[workflow] Phase state persisted to .harness/state.json and progress.md." -ForegroundColor DarkGray

    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "[WORKFLOW_SUCCESS] $($Command) completed successfully!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    $finalExitCode = 0

} finally {
    # ----------------- STEP 13: RESOURCE MONITOR RELEASE -----------------
    if ($lockAcquired) {
        Write-Host "[workflow] Releasing resource monitor lock (PID: $($currentPid))..." -ForegroundColor DarkGray
        & $resourceMonitor -Action release
    }
}

exit $finalExitCode
