<#
.SYNOPSIS
  Multi-Stack Integration Test Runner.
  Starts backend server as a background subprocess, runs end-to-end HTTP health & API contract checks,
  verifies web artifact connectivity, and cleanly terminates subprocess with zero orphan processes.
#>
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
$repoRoot = (git rev-parse --show-toplevel).Trim()
$serverProcess = $null

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "MULTI-STACK INTEGRATION TEST" -ForegroundColor Cyan
Write-Host "Target Host : 127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

try {
    # 1. Clean up any existing process on target port
    $existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($existing) {
        $pidsToKill = $existing | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pidToKill in $pidsToKill) {
            Write-Host "[integration] Stopping pre-existing process on port $Port (PID $pidToKill)..." -ForegroundColor Yellow
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }

    # 2. Launch FastAPI backend subprocess
    Write-Host "[integration] Starting FastAPI backend (uvicorn server.main:app --port $Port)..." -ForegroundColor Cyan
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "python"
    $psi.Arguments = "-m uvicorn server.main:app --host 127.0.0.1 --port $Port"
    $psi.WorkingDirectory = $repoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $serverProcess = [System.Diagnostics.Process]::Start($psi)
    $startTime = Get-Date

    # 3. Poll /docs until HTTP 200 or timeout
    Write-Host "[integration] Polling http://127.0.0.1:$Port/docs..." -ForegroundColor DarkGray
    $serverReady = $false
    while (((Get-Date) - $startTime).TotalSeconds -lt $TimeoutSeconds) {
        if ($serverProcess.HasExited) {
            $err = $serverProcess.StandardError.ReadToEnd()
            throw "Server process terminated prematurely: $err"
        }
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/docs" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                $serverReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }

    if (-not $serverReady) {
        throw "Timeout waiting for backend server at http://127.0.0.1:$Port/docs ($TimeoutSeconds s)"
    }
    Write-Host "[integration] PASS: FastAPI server is up and responsive (HTTP 200 /docs)" -ForegroundColor Green

    # 4. Check /health endpoint
    Write-Host "[integration] Checking /health endpoint..." -ForegroundColor DarkGray
    $healthResp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get -TimeoutSec 5
    if ($healthResp.status -ne "healthy") {
        throw "Unexpected /health response: $($healthResp | ConvertTo-Json -Compress)"
    }
    Write-Host "[integration] PASS: Health check verified -> status: '$($healthResp.status)', service: '$($healthResp.service)'" -ForegroundColor Green

    # 5. Check API summary endpoint contract
    Write-Host "[integration] Checking /api/v1/dashboard/summary..." -ForegroundColor DarkGray
    $summaryResp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/dashboard/summary" -Method Get -TimeoutSec 5
    if ($null -eq $summaryResp.orderCount) {
        throw "API summary response missing 'orderCount'"
    }
    Write-Host "[integration] PASS: API summary verified -> orderCount: $($summaryResp.orderCount), ordersValuePaise: $($summaryResp.ordersValuePaise)" -ForegroundColor Green

    # 6. Verify web production build integration
    Write-Host "[integration] Checking web production build integration..." -ForegroundColor DarkGray
    $webDistIndex = Join-Path $repoRoot "web\dist\index.html"
    if (-not (Test-Path $webDistIndex)) {
        throw "Web dist artifact missing at $webDistIndex. Run 'npm --prefix web run build' first."
    }
    $indexHtml = Get-Content $webDistIndex -Raw
    if ($indexHtml -notmatch "root") {
        throw "Web index.html malformed (missing root container)"
    }

    # Verify SPA static serving via FastAPI
    $spaResp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
    if ($spaResp.StatusCode -ne 200 -or $spaResp.Content -notmatch "root") {
        throw "Server failed to serve web SPA at root route: StatusCode $($spaResp.StatusCode)"
    }
    Write-Host "[integration] PASS: SPA static serving verified (HTTP 200 at root route)" -ForegroundColor Green

    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "[INTEGRATION_SUCCESS] All integration tests passed!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    $exitCode = 0
} catch {
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host "[INTEGRATION_FAILURE] Error: $_" -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    $exitCode = 1
} finally {
    # 7. Guaranteed teardown of background subprocess
    Write-Host "[integration] Tearing down background server process..." -ForegroundColor DarkGray
    if ($serverProcess -and -not $serverProcess.HasExited) {
        try {
            $serverProcess.Kill()
            $serverProcess.WaitForExit(3000)
        } catch {
            # Ignore
        }
    }

    # Verify zero orphan processes on port
    Start-Sleep -Milliseconds 500
    $orphans = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($orphans) {
        Write-Warning "[integration] Orphan connection detected on port $Port. Forcing cleanup."
        $orphanPids = $orphans | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($opid in $orphanPids) {
            Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "[integration] Teardown complete. Zero processes listening on port $Port." -ForegroundColor Green
}

exit $exitCode
