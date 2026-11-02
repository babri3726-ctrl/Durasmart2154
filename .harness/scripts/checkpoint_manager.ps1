<#
.SYNOPSIS
  Git Checkpoint Manager for AI Coding Workflow.
  Creates isolated checkpoints before write phases and restores cleanly on failure.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [ValidateSet('create', 'restore', 'list', 'drop')]
    [string]$Action = 'list',

    [Parameter(Position=1)]
    [string]$Name = 'auto'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (git rev-parse --show-toplevel).Trim()
$checkpointDir = Join-Path $repoRoot ".harness"
if (-not (Test-Path $checkpointDir)) { New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null }
$checkpointFile = Join-Path $checkpointDir "checkpoints.json"

function Get-Checkpoints {
    if (Test-Path $checkpointFile) {
        try {
            $raw = Get-Content $checkpointFile -Raw
            if ($raw) {
                $obj = $raw | ConvertFrom-Json
                $ht = @{}
                foreach ($prop in $obj.PSObject.Properties) {
                    $ht[$prop.Name] = $prop.Value
                }
                return $ht
            }
        } catch {}
    }
    return @{}
}

function Save-Checkpoints($data) {
    ($data | ConvertTo-Json -Depth 5) | Set-Content $checkpointFile -Encoding UTF8
}

switch ($Action) {
    'create' {
        $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
        $branchName = "checkpoint/$timestamp-$Name"
        $currentBranch = (git branch --show-current).Trim()
        
        $records = Get-Checkpoints
        $record = [PSCustomObject]@{
            name = $Name
            timestamp = $timestamp
            base_branch = $currentBranch
            commit_sha = (git rev-parse HEAD).Trim()
        }
        $records[$Name] = $record
        Save-Checkpoints $records
        Write-Output "CHECKPOINT_CREATED: $Name ($timestamp)"
    }
    'restore' {
        $records = Get-Checkpoints
        if (-not $records.ContainsKey($Name)) {
            Write-Error "Checkpoint '$Name' not found."
            exit 1
        }
        $rec = $records[$Name]
        
        # Clean working directory back to baseline commit, preserving .harness infrastructure
        git reset --hard $rec.commit_sha 2>$null | Out-Null
        git clean -fd -e ".harness/" -e "docs/" 2>$null | Out-Null
        Write-Output "CHECKPOINT_RESTORED: $Name reverted to $($rec.commit_sha)"
    }
    'list' {
        $records = Get-Checkpoints
        Write-Output ($records | ConvertTo-Json -Depth 5)
    }
    'drop' {
        $records = Get-Checkpoints
        if ($records.ContainsKey($Name)) {
            $records.Remove($Name)
            Save-Checkpoints $records
            Write-Output "CHECKPOINT_DROPPED: $Name"
        }
    }
}
