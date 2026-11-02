<#
.SYNOPSIS
  Unit & Integration Test Suite for Workflow Dispatcher (Conditions a through f).
#>
$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()
$workflowScript = Join-Path $repoRoot ".harness\scripts\workflow.ps1"
$checkpointManager = Join-Path $repoRoot ".harness\scripts\checkpoint_manager.ps1"
$resourceMonitor = Join-Path $repoRoot ".harness\scripts\resource_monitor.ps1"

$passCount = 0
$failCount = 0

function Report-Result {
    param([string]$TestName, [bool]$Passed, [string]$Evidence)
    if ($Passed) {
        $script:passCount++
        Write-Host "PASS: $TestName" -ForegroundColor Green
        Write-Host "      Evidence: $Evidence" -ForegroundColor DarkGray
    } else {
        $script:failCount++
        Write-Host "FAIL: $TestName" -ForegroundColor Red
        Write-Host "      Evidence: $Evidence" -ForegroundColor Red
    }
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "WORKFLOW DISPATCH TEST SUITE (Conditions a -> f)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Test A: /plan on empty prompt aborts at preflight (exit 1)
$outA = & powershell -NoProfile -File $workflowScript -Command "/plan" 2>&1
$codeA = $LASTEXITCODE
Report-Result -TestName "Test A: /plan empty prompt aborts at preflight" `
              -Passed ($codeA -eq 1 -and ($outA -match "PREFLIGHT FAILED: Task prompt is empty")) `
              -Evidence "ExitCode=$codeA; MatchPreflight=$($outA -match 'PREFLIGHT FAILED')"

# Test B: /work on prompt outside repo aborts at boundary check (exit 1)
$outB = & powershell -NoProfile -File $workflowScript -Command "/work" -Prompt "Edit file in C:\Windows\System32\cmd.exe" 2>&1
$codeB = $LASTEXITCODE
Report-Result -TestName "Test B: /work outside repo boundary aborts" `
              -Passed ($codeB -eq 1 -and ($outB -match "boundary")) `
              -Evidence "ExitCode=$codeB; MatchBoundary=$($outB -match 'boundary')"

# Test C: /work on valid prompt creates a checkpoint before any AGY call
$outC = & powershell -NoProfile -File $workflowScript -Command "/work" -Prompt "test update in web" -Stack "web" -DryRun 2>&1
$codeC = $LASTEXITCODE
Report-Result -TestName "Test C: /work creates checkpoint before execution" `
              -Passed ($codeC -eq 0 -and ($outC -match "CHECKPOINT_CREATED")) `
              -Evidence "ExitCode=$codeC; CheckpointMatch=$($outC -match 'CHECKPOINT_CREATED')"

# Test D: /release aborts if approval input is "yes" or empty (non-APPROVE)
$outD = & powershell -NoProfile -File $workflowScript -Command "/release" -ApprovalToken "yes" 2>&1
$codeD = $LASTEXITCODE
Report-Result -TestName "Test D: /release aborts when approval token is 'yes' (not APPROVE)" `
              -Passed ($codeD -eq 1 -and ($outD -match "Operation refused|APPROVAL_GATE_REFUSED")) `
              -Evidence "ExitCode=$codeD; RefusalMatch=$($outD -match 'APPROVAL_GATE_REFUSED')"

# Test E: /release proceeds only when approval token is literal "APPROVE"
$outE = & powershell -NoProfile -File $workflowScript -Command "/release" -ApprovalToken "APPROVE" -DryRun 2>&1
$codeE = $LASTEXITCODE
Report-Result -TestName "Test E: /release proceeds when approval token is 'APPROVE'" `
              -Passed ($codeE -eq 0 -and ($outE -match "WORKFLOW_SUCCESS")) `
              -Evidence "ExitCode=$codeE; SuccessMatch=$($outE -match 'WORKFLOW_SUCCESS')"

# Test F: Concurrent calls: second call aborts with agent lock held
& powershell -NoProfile -File $resourceMonitor -Action acquire -ProcessId $PID | Out-Null
$outF = & powershell -NoProfile -File $workflowScript -Command "/plan" -Prompt "list entry points" 2>&1
$codeF = $LASTEXITCODE
& powershell -NoProfile -File $resourceMonitor -Action release | Out-Null

Report-Result -TestName "Test F: Concurrent call aborts due to active agent lock" `
              -Passed ($codeF -eq 1 -and ($outF -match "Concurrency limit reached|lock")) `
              -Evidence "ExitCode=$codeF; LockMatch=$($outF -match 'Concurrency limit reached')"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "DISPATCH TEST SUMMARY: Passed=$passCount, Failed=$failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host "==================================================" -ForegroundColor Cyan

exit $failCount
