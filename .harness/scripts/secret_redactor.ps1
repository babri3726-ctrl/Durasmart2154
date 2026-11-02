<#
.SYNOPSIS
  Secret Redactor for AI Coding Workflow.
  Scans text and logs for credential patterns and replaces them with [REDACTED_SECRET].
#>
function Redact-Secrets {
    param(
        [AllowEmptyString()]
        [Parameter(Mandatory=$false, ValueFromPipeline=$true)]
        [string]$InputText = ""
    )

    if ([string]::IsNullOrEmpty($InputText)) {
        return ""
    }

    $patterns = @(
        'ghp_[a-zA-Z0-9]{30,}',
        'gho_[a-zA-Z0-9]{30,}',
        'github_pat_[a-zA-Z0-9_]{30,}',
        'AKIA[0-9A-Z]{16}',
        'AIzaSy[0-9A-Za-z-_]{33}',
        'sk-[a-zA-Z0-9]{20,}',
        'Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*',
        '(?i)(password|secret|token|api_key)\s*[:=]\s*["''][^"'']+["'']'
    )

    $sanitized = $InputText
    foreach ($pat in $patterns) {
        $sanitized = [regex]::Replace($sanitized, $pat, {
            param($match)
            return "[REDACTED_SECRET]"
        })
    }

    return $sanitized
}

if ($MyInvocation.InvocationName -ne '.' -and $MyInvocation.Line -match 'secret_redactor\.ps1') {
    $text = if ($args.Count -gt 0) { $args -join ' ' } else { $input | Out-String }
    if ($text) {
        Redact-Secrets $text
    }
}
