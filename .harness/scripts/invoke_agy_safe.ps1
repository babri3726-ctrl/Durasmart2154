<#
.SYNOPSIS
  Safe AGY / CLI Command Invoker with Timeout & Retry Policy.
  Enforces hard execution timeout (default 120s) and max 2 retries on transient errors.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$CommandLine,

    [int]$TimeoutSeconds = 120,
    [int]$MaxRetries = 2,
    [string]$Phase = "execute"
)

$repoRoot = (git rev-parse --show-toplevel).Trim()
$auditLogger = Join-Path $repoRoot ".harness\scripts\audit_logger.ps1"

$attempt = 0
$success = $false
$finalExitCode = 1
$startTimeTotal = [System.Diagnostics.Stopwatch]::StartNew()

while ($attempt -le $MaxRetries -and -not $success) {
    $attempt++
    Write-Host "[safe-exec] Attempt $attempt / $($MaxRetries + 1): $CommandLine"
    
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = "powershell.exe"
    $pinfo.Arguments = "-NoProfile -Command `"$CommandLine`""
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.UseShellExecute = $false
    $pinfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $pinfo
    
    try {
        $process.Start() | Out-Null
        $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
        
        $sw.Stop()
        $duration = $sw.Elapsed.TotalSeconds

        if ($timedOut) {
            try { $process.Kill() } catch {}
            Write-Warning "[safe-exec] Command timed out after ${TimeoutSeconds}s (Attempt $attempt)"
            $finalExitCode = 124 # Standard timeout code
            
            if (Test-Path $auditLogger) {
                & $auditLogger -Command $CommandLine -ExitCode $finalExitCode -Phase $Phase -DurationSeconds $duration -Details "Timeout after ${TimeoutSeconds}s on attempt $attempt"
            }
        } else {
            $stdout = $process.StandardOutput.ReadToEnd()
            $stderr = $process.StandardError.ReadToEnd()
            $finalExitCode = $process.ExitCode
            
            if ($stdout) { Write-Output $stdout }
            if ($stderr -and $finalExitCode -ne 0) { Write-Error $stderr }
            
            if ($finalExitCode -eq 0) {
                $success = $true
                if (Test-Path $auditLogger) {
                    & $auditLogger -Command $CommandLine -ExitCode 0 -Phase $Phase -DurationSeconds $duration -Details "Success on attempt $attempt"
                }
                break
            } else {
                Write-Warning "[safe-exec] Command failed with exit code $finalExitCode (Attempt $attempt)"
                if (Test-Path $auditLogger) {
                    & $auditLogger -Command $CommandLine -ExitCode $finalExitCode -Phase $Phase -DurationSeconds $duration -Details "Failed attempt $attempt"
                }
            }
        }
    } catch {
        $sw.Stop()
        Write-Error "[safe-exec] Exception running command: $_"
        $finalExitCode = 1
    } finally {
        $process.Dispose()
    }
    
    if (-not $success -and $attempt -le $MaxRetries) {
        Write-Host "[safe-exec] Backing off 1s before retry..."
        Start-Sleep -Seconds 1
    }
}

$startTimeTotal.Stop()
exit $finalExitCode
