<#
.SYNOPSIS
  Dispatch entry point forwarding to workflow.ps1.
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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workflowScript = Join-Path $scriptDir "workflow.ps1"

& $workflowScript @PSBoundParameters
exit $LASTEXITCODE
