<#
.SYNOPSIS
  Safe AGY / CLI Command Invoker with Timeout, Retry Policy & JSON Schema Validation.
  Enforces hard execution timeout (default 120s), max 2 retries on transient errors,
  and validates AGY response schema.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$CommandLine,

    [int]$TimeoutSeconds = 120,
    [int]$MaxRetries = 2,
    [string]$Phase = "execute",

    # Testing switch for direct schema validation
    [string]$TestSchemaPayload = ""
)

function Test-AgyJsonSchema {
    param([string]$JsonText)
    try {
        if ([string]::IsNullOrWhiteSpace($JsonText)) {
            return @{ valid = $false; error = "Empty JSON payload" }
        }
        $cleanJson = $JsonText
        $firstBrace = $JsonText.IndexOf('{')
        $lastBrace = $JsonText.LastIndexOf('}')
        if ($firstBrace -ge 0 -and $lastBrace -gt $firstBrace) {
            $cleanJson = $JsonText.Substring($firstBrace, ($lastBrace - $firstBrace + 1))
        }
        $obj = $cleanJson | ConvertFrom-Json
        if (-not $obj) { return @{ valid = $false; error = "Null parsed JSON payload" } }
        
        # Check required keys
        $propNames = $obj.PSObject.Properties.Name
        if ($propNames -notcontains 'status') {
            return @{ valid = $false; error = "Missing required key: 'status'" }
        }
        if ($propNames -notcontains 'response' -and $propNames -notcontains 'structured_output') {
            return @{ valid = $false; error = "Missing required key: 'response' or 'structured_output'" }
        }
        if ($propNames -notcontains 'usage') {
            return @{ valid = $false; error = "Missing required key: 'usage'" }
        }
        
        $validStatuses = @('SUCCESS', 'ERROR', 'CANCELED', 'INTERRUPTED')
        if ($validStatuses -notcontains $obj.status) {
            return @{ valid = $false; error = "Invalid status '$($obj.status)'. Expected one of: $($validStatuses -join ', ')" }
        }
        
        return @{ valid = $true; object = $obj }
    } catch {
        return @{ valid = $false; error = "JSON parse error: $_" }
    }
}

# Standalone schema testing mode
if ($TestSchemaPayload) {
    $res = Test-AgyJsonSchema -JsonText $TestSchemaPayload
    if ($res.valid) {
        Write-Output "SCHEMA_VALID"
        exit 0
    } else {
        Write-Error "SCHEMA_INVALID: $($res.error)"
        exit 1
    }
}

if (-not $CommandLine) {
    Write-Error "CommandLine parameter is required."
    exit 1
}

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
    $escapedCmd = $CommandLine.Replace('"', '\"')
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = "powershell.exe"
    $pinfo.Arguments = "-NoProfile -Command `"$escapedCmd`""
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
            
            # Check JSON schema if JSON output expected
            if ($CommandLine -match "--output-format\s+json" -and $finalExitCode -eq 0) {
                $schemaCheck = Test-AgyJsonSchema -JsonText $stdout
                if (-not $schemaCheck.valid) {
                    Write-Error "[safe-exec] JSON schema validation failed: $($schemaCheck.error)"
                    $finalExitCode = 1
                    if (Test-Path $auditLogger) {
                        & $auditLogger -Command $CommandLine -ExitCode 1 -Phase $Phase -DurationSeconds $duration -Details "Schema error: $($schemaCheck.error)"
                    }
                } else {
                    $success = $true
                }
            } elseif ($finalExitCode -eq 0) {
                $success = $true
            }
            
            if ($stdout) { Write-Output $stdout }
            if ($stderr -and $finalExitCode -ne 0) { Write-Error $stderr }
            
            if ($success) {
                if (Test-Path $auditLogger) {
                    & $auditLogger -Command $CommandLine -ExitCode 0 -Phase $Phase -DurationSeconds $duration -Details "Success on attempt $attempt"
                }
                break
            } else {
                Write-Warning "[safe-exec] Command failed with exit code $finalExitCode (Attempt $attempt)"
                if ((Test-Path $auditLogger) -and ($CommandLine -notmatch "--output-format\s+json")) {
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
