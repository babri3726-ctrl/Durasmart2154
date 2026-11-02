<#
.SYNOPSIS
  End-to-End 3-Stage Verification Test Runner (/plan -> /work -> /release).
#>
$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()
$workflowScript = Join-Path $repoRoot ".harness\scripts\workflow.ps1"
$checkpointsJson = Join-Path $repoRoot ".harness\checkpoints.json"
$stateJson = Join-Path $repoRoot ".harness\state.json"
$auditLog = Join-Path $repoRoot ".harness\audit.log"

$stageResults = [ordered]@{}

function Get-CheckpointCount {
    if (Test-Path $checkpointsJson) {
        try {
            $raw = Get-Content $checkpointsJson -Raw
            $obj = $raw | ConvertFrom-Json
            return ($obj.PSObject.Properties | Measure-Object).Count
        } catch { return 0 }
    }
    return 0
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "END-TO-END 3-STAGE WORKFLOW VERIFICATION" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ==============================================================
# STAGE 1: /plan (Read-Only)
# ==============================================================
Write-Host "`n>>> EXECUTING STAGE 1: /plan (list entry points of this project)..." -ForegroundColor Yellow

$s1_cpBefore = Get-CheckpointCount
$s1_gitBefore = (git status --porcelain 2>$null)

$s1_out = & powershell -NoProfile -File $workflowScript -Command "/plan" -Prompt "list entry points of this project" 2>&1
$s1_code = $LASTEXITCODE

$s1_cpAfter = Get-CheckpointCount
$s1_gitAfter = (git status --porcelain 2>$null)
$s1_state = if (Test-Path $stateJson) { Get-Content $stateJson | ConvertFrom-Json } else { $null }

$s1_zeroWrites = ((-join $s1_gitBefore) -eq (-join $s1_gitAfter))
$s1_zeroCheckpoints = ($s1_cpAfter -eq $s1_cpBefore)
$s1_validState = ($s1_state -and $s1_state.lastPhase -eq "/plan" -and $s1_state.status -eq "SUCCESS")

$s1_pass = ($s1_code -eq 0 -and $s1_zeroWrites -and $s1_zeroCheckpoints -and $s1_validState)
$stageResults["Stage 1 (/plan)"] = @{
    Passed = $s1_pass
    Evidence = "ExitCode=$s1_code; ZeroWrites=$s1_zeroWrites; ZeroCheckpoints=$s1_zeroCheckpoints (before=$s1_cpBefore, after=$s1_cpAfter); StatePhase=$($s1_state.lastPhase)"
}

if ($s1_pass) {
    Write-Host "[STAGE 1 PASS] /plan executed cleanly with 0 writes and 0 checkpoints." -ForegroundColor Green
} else {
    Write-Host "[STAGE 1 FAIL] /plan conditions not met: $($stageResults['Stage 1 (/plan)'].Evidence)" -ForegroundColor Red
}

# ==============================================================
# STAGE 2: /work (Write + Verification)
# ==============================================================
Write-Host "`n>>> EXECUTING STAGE 2: /work (verify health endpoint in server)..." -ForegroundColor Yellow

$s2_cpBefore = Get-CheckpointCount

$s2_out = & powershell -NoProfile -File $workflowScript -Command "/work" -Prompt "verify health endpoint in server" -Stack "server" 2>&1
$s2_code = $LASTEXITCODE

$s2_cpAfter = Get-CheckpointCount
$s2_state = if (Test-Path $stateJson) { Get-Content $stateJson | ConvertFrom-Json } else { $null }

$s2_checkpointCreated = ($s2_cpAfter -gt $s2_cpBefore)
$s2_skillMatched = ($s2_state -and $s2_state.selectedSkill -eq "fullstack-dev")
$s2_verifyPassed = ($s2_out -match "All gates passed for stack 'server'")

$s2_pass = ($s2_code -eq 0 -and $s2_checkpointCreated -and $s2_skillMatched -and $s2_verifyPassed)
$stageResults["Stage 2 (/work)"] = @{
    Passed = $s2_pass
    Evidence = "ExitCode=$s2_code; CheckpointCreated=$s2_checkpointCreated (before=$s2_cpBefore, after=$s2_cpAfter); Skill=$($s2_state.selectedSkill); VerifyPassed=$s2_verifyPassed"
}

if ($s2_pass) {
    Write-Host "[STAGE 2 PASS] /work created checkpoint and verified server stack." -ForegroundColor Green
} else {
    Write-Host "[STAGE 2 FAIL] /work conditions not met: $($stageResults['Stage 2 (/work)'].Evidence)" -ForegroundColor Red
}

# ==============================================================
# STAGE 3: /release (Approval + Full Pipeline + Security + Integration)
# ==============================================================
Write-Host "`n>>> EXECUTING STAGE 3: /release (Full Pipeline + Security + Integration)..." -ForegroundColor Yellow

$s3_out = & powershell -NoProfile -File $workflowScript -Command "/release" -ApprovalToken "APPROVE" 2>&1
$s3_code = $LASTEXITCODE

$s3_approvalAccepted = ($s3_out -match "APPROVAL_GATE_ACCEPTED")
$s3_securityRan = ($s3_out -match "security:web_audit" -and $s3_out -match "security:pip_audit")
$s3_integrationRan = ($s3_out -match "INTEGRATION_SUCCESS")
$s3_teardownVerified = ($s3_out -match "Teardown complete\. Zero processes listening on port 8000")
$s3_state = if (Test-Path $stateJson) { Get-Content $stateJson | ConvertFrom-Json } else { $null }

$s3_pass = ($s3_code -eq 0 -and $s3_approvalAccepted -and $s3_securityRan -and $s3_integrationRan -and $s3_teardownVerified)
$stageResults["Stage 3 (/release)"] = @{
    Passed = $s3_pass
    Evidence = "ExitCode=$s3_code; ApprovalAccepted=$s3_approvalAccepted; SecurityAuditRan=$s3_securityRan; IntegrationRan=$s3_integrationRan; TeardownVerified=$s3_teardownVerified; StatePhase=$($s3_state.lastPhase)"
}

if ($s3_pass) {
    Write-Host "[STAGE 3 PASS] /release passed all security, integration, and teardown checks." -ForegroundColor Green
} else {
    Write-Host "[STAGE 3 FAIL] /release conditions not met: $($stageResults['Stage 3 (/release)'].Evidence)" -ForegroundColor Red
}

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "END-TO-END 3-STAGE EXECUTION SUMMARY" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$allPassed = $s1_pass -and $s2_pass -and $s3_pass
foreach ($k in $stageResults.Keys) {
    $info = $stageResults[$k]
    $color = if ($info.Passed) { "Green" } else { "Red" }
    $statusText = if ($info.Passed) { "PASS" } else { "FAIL" }
    Write-Host ("{0,-20} : {1,-6} | {2}" -f $k, $statusText, $info.Evidence) -ForegroundColor $color
}

Write-Host "==================================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "Workflow COMPLETE -- all three E2E tests passed" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Workflow INCOMPLETE -- blockers present" -ForegroundColor Red
    exit 1
}
