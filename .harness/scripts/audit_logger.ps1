<#
.SYNOPSIS
  Audit Logger for AI Coding Workflow.
  Appends structured, secret-redacted execution records to .harness/audit.log.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Command,

    [Parameter(Mandatory=$true)]
    [int]$ExitCode,

    [string]$Phase = "execute",
    [double]$DurationSeconds = 0.0,
    [string]$Details = ""
)

$repoRoot = (git rev-parse --show-toplevel).Trim()
$auditFile = Join-Path $repoRoot ".harness\audit.log"
$redactorScript = Join-Path $repoRoot ".harness\scripts\secret_redactor.ps1"
if (Test-Path $redactorScript) {
    . $redactorScript
} else {
    function Redact-Secrets($s) { return $s }
}

$cleanCommand = Redact-Secrets $Command
$cleanDetails = Redact-Secrets $Details
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$status = if ($ExitCode -eq 0) { "SUCCESS" } else { "FAILURE" }

$logEntry = [ordered]@{
    timestamp = $timestamp
    phase = $Phase
    status = $status
    exit_code = $ExitCode
    duration_s = [math]::Round($DurationSeconds, 3)
    command = $cleanCommand
    details = $cleanDetails
} | ConvertTo-Json -Compress

Add-Content -Path $auditFile -Value $logEntry -Encoding UTF8
Write-Output "AUDIT_LOGGED: [$status] $cleanCommand (exit: $ExitCode)"
