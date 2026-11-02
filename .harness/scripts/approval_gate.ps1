<#
.SYNOPSIS
  Human Approval Gate for AI Coding Workflow.
  Hard-stops before destructive operations (force-push, deletions, protected merges, publishing).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Command,

    [string]$ApprovalToken = "",

    [switch]$ForceRequireApproval
)

$destructivePatterns = @(
    'git\s+push\s+.*(--force|-f)',
    'git\s+branch\s+(-D|--delete\s+--force)',
    'git\s+reset\s+--hard',
    'git\s+clean\s+(-f|-x|-d)',
    '(rm\s+-rf|rmdir\s+\/s|Remove-Item\s+.*-Recurse)',
    'git\s+merge\s+.*(main|master)',
    'npm\s+publish',
    '/release'
)

$isDestructive = $ForceRequireApproval.IsPresent
foreach ($p in $destructivePatterns) {
    if ($Command -match $p) {
        $isDestructive = $true
        $matchedPattern = $p
        break
    }
}

if ($isDestructive) {
    if ($ApprovalToken -ne "APPROVE") {
        Write-Error @"
[APPROVAL_GATE_REFUSED]
Destructive operation detected: '$Command' (pattern: '$matchedPattern')
This action requires explicit human confirmation.
To execute, pass -ApprovalToken 'APPROVE'.
"@
        exit 2
    } else {
        Write-Host "[APPROVAL_GATE_ACCEPTED] Explicit human approval verified for '$Command'."
        exit 0
    }
} else {
    Write-Output "[APPROVAL_GATE_CLEARED] Non-destructive command."
    exit 0
}
