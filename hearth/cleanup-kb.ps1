<#
  Removes the superseded knowledge-base files from hearth/kb.

  Two generations are being cleared:
    * ten Lumenboard demo-corpus docs, already copied to hearth/kb-demo/
    * seven first-draft rlm-*.md files, replaced by the five current ones
  The five current RLM docs are listed explicitly and are never touched.

  Run from anywhere:  powershell -ExecutionPolicy Bypass -File cleanup-kb.ps1
  Add -WhatIf to see what it would do without deleting.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$KbPath = "C:\AiAppDeployments\Xenia\hearth\kb",
    [string]$DemoPath = "C:\AiAppDeployments\Xenia\hearth\kb-demo"
)

$ErrorActionPreference = "Stop"

$keep = @(
    "rlm-services.md",
    "rlm-service-area.md",
    "rlm-booking-path.md",
    "rlm-not-offered.md",
    "rlm-not-published.md"
)

$demoDocs = @(
    "account-and-team-management.md",
    "api-keys-and-integrations.md",
    "csv-export-troubleshooting.md",
    "dashboard-sharing-howto.md",
    "data-retention-policy.md",
    "glossary.md",
    "pricing-and-plans.md",
    "product-architecture-concepts.md",
    "refund-policy.md",
    "security-disclosure-policy.md"
)

$oldRlmDocs = @(
    "rlm-services-overview.md",
    "rlm-what-rlm-does-not-do.md",
    "rlm-coverage-and-availability.md",
    "rlm-booking-process.md",
    "rlm-pricing-policy.md",
    "rlm-deliverables-and-turnaround.md",
    "rlm-contact-and-escalation.md"
)

if (-not (Test-Path $KbPath)) { throw "KB path not found: $KbPath" }

# Refuse to delete a demo doc unless its copy really exists in kb-demo.
$missing = @()
foreach ($d in $demoDocs) {
    if ((Test-Path (Join-Path $KbPath $d)) -and -not (Test-Path (Join-Path $DemoPath $d))) {
        $missing += $d
    }
}
if ($missing.Count -gt 0) {
    throw "Not deleting: these demo docs have no copy in $DemoPath -> $($missing -join ', ')"
}

$deleted = 0
foreach ($name in ($demoDocs + $oldRlmDocs)) {
    if ($keep -contains $name) { continue }   # belt and braces
    $file = Join-Path $KbPath $name
    if (Test-Path $file) {
        if ($PSCmdlet.ShouldProcess($file, "Delete")) {
            Remove-Item -LiteralPath $file -Force
            Write-Host "deleted  $name"
            $deleted++
        }
    }
}

# The FTS index is rebuilt lazily when the file count changes, but dropping it
# is free and removes any doubt about stale chunks surviving.
$index = Join-Path $KbPath ".kb-index.db"
if (Test-Path $index) {
    if ($PSCmdlet.ShouldProcess($index, "Delete stale index")) {
        Remove-Item -LiteralPath $index -Force
        Write-Host "deleted  .kb-index.db (rebuilds on next query)"
    }
}

Write-Host ""
Write-Host "$deleted file(s) removed. Remaining in hearth/kb:"
Get-ChildItem -LiteralPath $KbPath -Filter *.md | ForEach-Object { Write-Host "  $($_.Name)" }

$unexpected = Get-ChildItem -LiteralPath $KbPath -Filter *.md |
    Where-Object { $keep -notcontains $_.Name }
if ($unexpected) {
    Write-Warning "Unexpected docs still present: $($unexpected.Name -join ', ')"
} else {
    Write-Host ""
    Write-Host "hearth/kb now holds exactly the five current RLM documents."
}
