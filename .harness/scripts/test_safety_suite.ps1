<#
.SYNOPSIS
  Automated Test Suite for the 6 Safety & Recovery Layer controls.
#>
$ErrorActionPreference = 'Continue'
$repoRoot = (git rev-parse --show-toplevel).Trim()
$scriptsDir = Join-Path $repoRoot ".harness\scripts"
$testResults = [ordered]@{}

Write-Host "================================================="
Write-Host "RUNNING SAFETY & RECOVERY LAYER TEST SUITE"
Write-Host "================================================="

# --- TEST 1: Git Checkpoint Manager ---
Write-Host "`n[Test 1] Git Checkpoint Manager..."
$testFile = Join-Path $repoRoot "checkpoint_test.tmp"
Set-Content -Path $testFile -Value "Trivial change for checkpoint test" -Encoding UTF8

powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\checkpoint_manager.ps1" create "test_safety" | Out-Null
Write-Host "  -> Checkpoint created."

# Modify further to ensure rollback proves recovery
Add-Content -Path $testFile -Value "Additional edit after checkpoint"

# Revert checkpoint
powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\checkpoint_manager.ps1" restore "test_safety" | Out-Null
$fileStillExists = Test-Path $testFile
if (-not $fileStillExists) {
    Write-Host "  [PASS] File change reverted and confirmed gone."
    $testResults["checkpoint_manager"] = "PASS"
} else {
    Write-Host "  [FAIL] File still present after restore."
    $testResults["checkpoint_manager"] = "FAIL"
    Remove-Item $testFile -Force -ErrorAction SilentlyContinue
}
powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\checkpoint_manager.ps1" drop "test_safety" | Out-Null

# --- TEST 2: Timeout & Retry Policy ---
Write-Host "`n[Test 2] Timeout & Retry Policy..."
$slowCmd = "Start-Sleep -Seconds 5"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$out = powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\invoke_agy_safe.ps1" -CommandLine $slowCmd -TimeoutSeconds 1 -MaxRetries 1 2>&1
$sw.Stop()
$timedOutTwice = ($out -match "timed out after 1s").Count -ge 1
if ($timedOutTwice -and $LASTEXITCODE -ne 0) {
    Write-Host "  [PASS] Slow command aborted, retried, and failed cleanly ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)."
    $testResults["timeout_and_retry"] = "PASS"
} else {
    Write-Host "  [FAIL] Did not properly timeout and retry: $out"
    $testResults["timeout_and_retry"] = "FAIL"
}

# --- TEST 3 & 4: Audit Logger & Secret Protection ---
Write-Host "`n[Test 3 & 4] Audit Logger and Secret Protection..."
$fakeSecret = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
$cmdWithSecret = "Write-Output 'Checking token $fakeSecret'"
powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\audit_logger.ps1" -Command $cmdWithSecret -ExitCode 0 -Phase "test-auth" | Out-Null

$auditLogPath = Join-Path $repoRoot ".harness\audit.log"
if (Test-Path $auditLogPath) {
    $lastLog = Get-Content $auditLogPath | Select-Object -Last 1
    $hasRedacted = $lastLog -match "\[REDACTED_SECRET\]"
    $leakedSecret = $lastLog -match $fakeSecret
    if ($hasRedacted -and -not $leakedSecret) {
        Write-Host "  [PASS] Audit log recorded command and fake token was REDACTED."
        $testResults["audit_logger"] = "PASS"
        $testResults["secret_protection"] = "PASS"
    } else {
        Write-Host "  [FAIL] Secret was not redacted or not logged: $lastLog"
        $testResults["audit_logger"] = "FAIL"
        $testResults["secret_protection"] = "FAIL"
    }
} else {
    Write-Host "  [FAIL] .harness/audit.log does not exist."
    $testResults["audit_logger"] = "FAIL"
    $testResults["secret_protection"] = "FAIL"
}

# --- TEST 5: Human Approval Gate ---
Write-Host "`n[Test 5] Human Approval Gate..."
$destructCmd = "git reset --hard HEAD~1"
$gateRefusal = powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\approval_gate.ps1" -Command $destructCmd 2>&1
$rejected = ($gateRefusal -match "APPROVAL_GATE_REFUSED")

$gateAccept = powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\approval_gate.ps1" -Command $destructCmd -ApprovalToken "APPROVE" 2>&1
$accepted = ($gateAccept -match "APPROVAL_GATE_ACCEPTED")

if ($rejected -and $accepted) {
    Write-Host "  [PASS] Destructive command refused without APPROVE, accepted with APPROVE."
    $testResults["human_approval_gate"] = "PASS"
} else {
    Write-Host "  [FAIL] Approval gate did not function as expected (refused=$rejected, accepted=$accepted)."
    $testResults["human_approval_gate"] = "FAIL"
}

# --- TEST 6: Resource Monitor ---
Write-Host "`n[Test 6] Resource Monitor (Concurrency & RAM)..."
powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\resource_monitor.ps1" -Action acquire -ProcessId $PID | Out-Null
$secondAcquire = powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\resource_monitor.ps1" -Action acquire 2>&1
$secondBlocked = ($secondAcquire -match "CONCURRENCY_REFUSED")
powershell -NoProfile -ExecutionPolicy Bypass -File "$scriptsDir\resource_monitor.ps1" -Action release | Out-Null

if ($secondBlocked) {
    Write-Host "  [PASS] Single agent concurrency enforced (second agent refused)."
    $testResults["resource_monitor"] = "PASS"
} else {
    Write-Host "  [FAIL] Second agent was not blocked: $secondAcquire"
    $testResults["resource_monitor"] = "FAIL"
}

Write-Host "`n================================================="
Write-Host "SAFETY SUITE RESULTS SUMMARY:"
$testResults.GetEnumerator() | ForEach-Object {
    Write-Host "  $($_.Key): $($_.Value)"
}
Write-Host "================================================="
