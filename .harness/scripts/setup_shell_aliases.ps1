<#
.SYNOPSIS
  Registers PowerShell workflow aliases and functions for one-command slash activation.
  Usage: . .\.harness\scripts\setup_shell_aliases.ps1
#>
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    $repoRoot = (Get-Location).Path
}

$workflowScript = Join-Path $repoRoot ".harness\scripts\workflow.ps1"

function global:workflow {
    param(
        [Parameter(Position=0, Mandatory=$true)]
        [string]$Command,
        [Parameter(Position=1)]
        [string]$Prompt = "",
        [string]$Stack = "auto",
        [string]$ApprovalToken = "",
        [switch]$DryRun
    )
    & $workflowScript @PSBoundParameters
}

function global:wf {
    param(
        [Parameter(Position=0, Mandatory=$true)]
        [string]$Command,
        [Parameter(Position=1)]
        [string]$Prompt = "",
        [string]$Stack = "auto",
        [string]$ApprovalToken = "",
        [switch]$DryRun
    )
    & $workflowScript @PSBoundParameters
}

# Individual slash-command helpers
function global:/setup   { param([string]$Prompt = "", [string]$Stack = "auto", [switch]$DryRun) & $workflowScript -Command "/setup" -Prompt $Prompt -Stack $Stack -DryRun:$DryRun }
function global:/plan    { param([string]$Prompt = "", [string]$Stack = "auto", [switch]$DryRun) & $workflowScript -Command "/plan" -Prompt $Prompt -Stack $Stack -DryRun:$DryRun }
function global:/work    { param([string]$Prompt = "", [string]$Stack = "auto", [string]$ApprovalToken = "", [switch]$DryRun) & $workflowScript -Command "/work" -Prompt $Prompt -Stack $Stack -ApprovalToken $ApprovalToken -DryRun:$DryRun }
function global:/review  { param([string]$Prompt = "", [string]$Stack = "auto", [switch]$DryRun) & $workflowScript -Command "/review" -Prompt $Prompt -Stack $Stack -DryRun:$DryRun }
function global:/release { param([string]$Prompt = "", [string]$ApprovalToken = "", [switch]$DryRun) & $workflowScript -Command "/release" -Prompt $Prompt -ApprovalToken $ApprovalToken -DryRun:$DryRun }
function global:/bugfix  { param([string]$Prompt = "", [string]$Stack = "auto", [string]$ApprovalToken = "", [switch]$DryRun) & $workflowScript -Command "/bugfix" -Prompt $Prompt -Stack $Stack -ApprovalToken $ApprovalToken -DryRun:$DryRun }

Write-Host "[workflow-aliases] Registered 'workflow', 'wf', /setup, /plan, /work, /review, /release, /bugfix." -ForegroundColor Green
