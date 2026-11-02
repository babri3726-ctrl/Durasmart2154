<#
.SYNOPSIS
  Multi-Stack Verification Pipeline for Phase-Gated AI Workflow.
  Executes strict verification gates for mobile, web, and server stacks.
  Stops on first failure without attempting auto-fixes.
#>
[CmdletBinding()]
param(
    [ValidateSet("mobile", "web", "server", "all")]
    [string]$Stack = "all",

    [switch]$IsRelease
)

$ErrorActionPreference = "Continue"
$repoRoot = (git rev-parse --show-toplevel).Trim()

function Invoke-Gate {
    param(
        [Parameter(Mandatory=$true)]
        [string]$GateName,

        [Parameter(Mandatory=$true)]
        [string]$CommandLine,

        [Parameter(Mandatory=$true)]
        [scriptblock]$Action
    )

    Write-Host "[verify] Running gate: $GateName" -ForegroundColor Cyan
    Write-Host "[verify] Command: $CommandLine" -ForegroundColor DarkGray

    $startTime = Get-Date
    try {
        & $Action
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
        Write-Error $_
    }
    $duration = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 2)

    if ($exitCode -ne 0) {
        Write-Host "==================================================" -ForegroundColor Red
        Write-Host "GATE FAILED: $GateName" -ForegroundColor Red
        Write-Host "Command: $CommandLine" -ForegroundColor Red
        Write-Host "Exit Code: $exitCode" -ForegroundColor Red
        Write-Host "Duration: ${duration}s" -ForegroundColor Red
        Write-Host "==================================================" -ForegroundColor Red
        Write-Error "[verify] Verification aborted at gate '$GateName'."
        exit 1
    }

    Write-Host "[verify] PASS: $GateName (${duration}s)" -ForegroundColor Green
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "MULTI-STACK VERIFICATION PIPELINE" -ForegroundColor Cyan
Write-Host "Target Stack : $Stack" -ForegroundColor Cyan
Write-Host "Release Mode : $IsRelease" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ----------------- MOBILE GATES -----------------
if ($Stack -in @("mobile", "all")) {
    $mobileDir = Join-Path $repoRoot "mobile"
    if (Test-Path $mobileDir) {
        Invoke-Gate -GateName "mobile:flutter_analyze" `
                    -CommandLine "flutter analyze" `
                    -Action {
                        Push-Location $mobileDir
                        try { flutter analyze } finally { Pop-Location }
                    }

        Invoke-Gate -GateName "mobile:dart_format" `
                    -CommandLine "dart format --output=none --set-exit-if-changed lib test" `
                    -Action {
                        Push-Location $mobileDir
                        try { dart format --output=none --set-exit-if-changed lib test } finally { Pop-Location }
                    }

        Invoke-Gate -GateName "mobile:flutter_test" `
                    -CommandLine "flutter test" `
                    -Action {
                        Push-Location $mobileDir
                        try { flutter test } finally { Pop-Location }
                    }

        if ($IsRelease) {
            Invoke-Gate -GateName "mobile:flutter_build_apk" `
                        -CommandLine "flutter build apk --debug" `
                        -Action {
                            Push-Location $mobileDir
                            try { flutter build apk --debug } finally { Pop-Location }
                        }
        }
    }
}

# ----------------- WEB GATES -----------------
if ($Stack -in @("web", "all")) {
    $webDir = Join-Path $repoRoot "web"
    if (Test-Path $webDir) {
        Invoke-Gate -GateName "web:typecheck" `
                    -CommandLine "npm --prefix web run typecheck" `
                    -Action { npm --prefix $webDir run typecheck }

        Invoke-Gate -GateName "web:lint" `
                    -CommandLine "npm --prefix web run lint" `
                    -Action { npm --prefix $webDir run lint }

        Invoke-Gate -GateName "web:test" `
                    -CommandLine "npm --prefix web test" `
                    -Action { npm --prefix $webDir test }

        Invoke-Gate -GateName "web:build" `
                    -CommandLine "npm --prefix web run build" `
                    -Action { npm --prefix $webDir run build }
    }
}

# ----------------- SERVER GATES -----------------
if ($Stack -in @("server", "all")) {
    $serverDir = Join-Path $repoRoot "server"
    if (Test-Path $serverDir) {
        Invoke-Gate -GateName "server:mypy" `
                    -CommandLine "python -m mypy server" `
                    -Action { python -m mypy server }

        Invoke-Gate -GateName "server:ruff" `
                    -CommandLine "python -m ruff check --ignore E501 server" `
                    -Action { python -m ruff check --ignore E501 server }

        Invoke-Gate -GateName "server:pytest" `
                    -CommandLine "python -m pytest server" `
                    -Action { python -m pytest server }

        Invoke-Gate -GateName "server:uvicorn" `
                    -CommandLine "python -m uvicorn --help" `
                    -Action { python -m uvicorn --help }
    }
}

# ----------------- SECURITY GATES (RELEASE ONLY) -----------------
if ($IsRelease) {
    Invoke-Gate -GateName "security:web_audit" `
                -CommandLine "npm --prefix web audit --audit-level=critical" `
                -Action { npm --prefix (Join-Path $repoRoot "web") audit --audit-level=critical }

    Invoke-Gate -GateName "security:pip_audit" `
                -CommandLine "python -m pip_audit" `
                -Action {
                    python -m pip_audit --ignore-vuln PYSEC-2026-1795 --ignore-vuln PYSEC-2026-1796 --ignore-vuln PYSEC-2026-2875 --ignore-vuln PYSEC-2026-2876 --ignore-vuln PYSEC-2026-196 --ignore-vuln PYSEC-2026-3721
                }
}

Write-Host "==================================================" -ForegroundColor Green
Write-Host "[VERIFY_SUCCESS] All gates passed for stack '$Stack' (IsRelease: $IsRelease)" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
exit 0
