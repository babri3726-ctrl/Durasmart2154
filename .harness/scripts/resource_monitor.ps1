<#
.SYNOPSIS
  Resource Monitor for AI Coding Workflow.
  Caps concurrent agents at 1 and ensures host free memory remains >= 1 GB.
#>
[CmdletBinding()]
param(
    [ValidateSet('acquire', 'release', 'check', 'status')]
    [string]$Action = 'check',

    [int]$MinFreeRamMB = 1024
)

$repoRoot = (git rev-parse --show-toplevel).Trim()
$lockFile = Join-Path $repoRoot ".harness\agent.lock"

function Test-MemoryAdequate {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $freeMB = [math]::Round($os.FreePhysicalMemory / 1024, 2)
        Write-Host "[resource-mon] Available RAM: $freeMB MB (Threshold: $MinFreeRamMB MB)"
        if ($freeMB -lt $MinFreeRamMB) {
            Write-Error "[RESOURCE_REFUSED] Insufficient memory ($freeMB MB free < $MinFreeRamMB MB required)."
            return $false
        }
        return $true
    } catch {
        Write-Warning "[resource-mon] Could not query CIM memory; assuming adequate."
        return $true
    }
}

switch ($Action) {
    'check' {
        if (-not (Test-MemoryAdequate)) { exit 1 }
        Write-Output "[RESOURCE_OK] Memory check passed."
        exit 0
    }
    'acquire' {
        # Check memory first
        if (-not (Test-MemoryAdequate)) { exit 1 }
        
        # Check lock
        if (Test-Path $lockFile) {
            $lockContent = Get-Content $lockFile -Raw
            try {
                $lockData = $lockContent | ConvertFrom-Json
                $existingPid = $lockData.pid
                $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Error "[CONCURRENCY_REFUSED] Agent already active with PID $existingPid. Single-agent concurrency limit reached."
                    exit 1
                } else {
                    Write-Warning "[resource-mon] Stale lock found for dead PID $existingPid. Reclaiming lock."
                }
            } catch {
                Write-Warning "[resource-mon] Invalid lock file. Overwriting."
            }
        }
        
        $myPid = $PID
        $lockPayload = @{
            pid = $myPid
            acquired_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        } | ConvertTo-Json
        Set-Content -Path $lockFile -Value $lockPayload -Encoding UTF8
        Write-Output "[LOCK_ACQUIRED] Process PID $myPid holds agent lock."
        exit 0
    }
    'release' {
        if (Test-Path $lockFile) {
            Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
            Write-Output "[LOCK_RELEASED] Agent lock released."
        }
        exit 0
    }
    'status' {
        if (Test-Path $lockFile) {
            $data = Get-Content $lockFile -Raw
            Write-Output "LOCK_ACTIVE: $data"
        } else {
            Write-Output "LOCK_INACTIVE: No agent currently holds lock."
        }
        Test-MemoryAdequate | Out-Null
    }
}
