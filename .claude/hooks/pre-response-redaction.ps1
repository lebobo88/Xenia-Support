# =============================================================================
# pre-response-redaction.ps1 - PreToolUse hook for Xenia (Layer 3 redaction)
#
# CONTRACT
#   Triggered before any Write / xenia.output.write tool call.
#
#   Environment variables consumed (injected by Claude Code / Hydra):
#     CLAUDE_HOOK_AGENT_NAME   - slug of the calling agent (preferred)
#     CLAUDE_AGENT_NAME        - fallback when the preferred var is absent
#     CLAUDE_HOOK_TOOL_INPUT   - JSON object containing the write payload
#
#   Checks:
#     1. PII scan of the outbound body (email, phone, SSN, payment card,
#        API key/credential patterns). Unredacted PII blocks the write
#        unless the body carries the Eunomia clearance marker.
#     2. Customer-facing bodies (under hearth/output/tickets or
#        escalations) must carry the AI-disclosure marker.
#
#   Exit codes:
#     0 - allow the write to proceed
#     2 - block the write (Claude Code hard-refusal; Hydra logs as GATE_BLOCK)
#
#   Stdout  : one audit line per invocation
#   Stderr  : human-readable refusal reason when blocking (exit 2 only)
#   Modules : none (no third-party dependencies)
#   Idempotent: yes
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ISOTimestamp {
    [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function Write-AuditLine {
    param([string]$Agent, [string]$TargetPath, [string]$Decision)
    Write-Output "$(Get-ISOTimestamp) | agent=$Agent | path=$TargetPath | decision=$Decision"
}

# ---------- resolve calling agent --------------------------------------------

$agentName = $env:CLAUDE_HOOK_AGENT_NAME
if (-not $agentName) { $agentName = $env:CLAUDE_AGENT_NAME }
if (-not $agentName) { $agentName = 'unknown' }
$agentSlug = $agentName.ToLower().Trim()

# ---------- resolve payload from tool input JSON ------------------------------

$targetPath = ''
$body = ''
if ($env:CLAUDE_HOOK_TOOL_INPUT) {
    try {
        $inp = $env:CLAUDE_HOOK_TOOL_INPUT | ConvertFrom-Json -ErrorAction Stop
        foreach ($p in @('file_path', 'path')) {
            if ($inp.PSObject.Properties.Name -contains $p) { $targetPath = [string]$inp.$p; break }
        }
        foreach ($b in @('content', 'body', 'new_string')) {
            if ($inp.PSObject.Properties.Name -contains $b) { $body = [string]$inp.$b; break }
        }
    } catch {
        [Console]::Error.WriteLine("pre-response-redaction WARNING: could not parse CLAUDE_HOOK_TOOL_INPUT - $_")
    }
}

if (-not $body) {
    Write-AuditLine -Agent $agentSlug -TargetPath $targetPath -Decision 'ALLOW_NO_BODY'
    exit 0
}

$normPath = $targetPath.Replace('\', '/')

# Internal working files (approvals, progress, tasks) hold operational data,
# not customer-facing bodies; PII scan still applies, disclosure does not.
$isCustomerFacing = $normPath -match '(?i)hearth/output/(tickets|escalations)/'

# ---------- Eunomia clearance marker ------------------------------------------

$hasClearance = $body -match '(?i)eunomia-cleared|clearance:\s*cleared|seal:\s*cleared'

# ---------- PII scan -----------------------------------------------------------

$piiPatterns = @{
    'EMAIL'      = '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    'SSN'        = '\b\d{3}-\d{2}-\d{4}\b'
    'CARD'       = '\b(?:\d[ -]*?){13,16}\b'
    'PHONE'      = '\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b'
    'APIKEY'     = '(?i)\b(sk-[a-zA-Z0-9]{20,}|api[_-]?key\s*[:=]\s*\S{16,}|bearer\s+[a-zA-Z0-9._-]{20,})'
}

# Typed placeholders and opaque refs are the *output* of redaction; ignore them.
$findings = @()
foreach ($kind in $piiPatterns.Keys) {
    $rx = [regex]::new($piiPatterns[$kind])
    foreach ($m in $rx.Matches($body)) {
        $val = $m.Value
        if ($val -match '^\[(EMAIL|PHONE|CARD|SSN|APIKEY)\]$') { continue }
        if ($val -match '(?i)customer:[0-9a-f]{6,}') { continue }
        # Card pattern false-positive guard: require Luhn-ish density of digits
        if ($kind -eq 'CARD') {
            $digits = ($val -replace '[^\d]', '')
            if ($digits.Length -lt 13 -or $digits.Length -gt 16) { continue }
        }
        $findings += $kind
        break  # one finding per kind is enough to decide
    }
}

if ($findings.Count -gt 0 -and -not $hasClearance) {
    $refusal = @(
        "BLOCKED: outbound body contains unredacted PII ($($findings -join ', '))",
        "and carries no Eunomia clearance marker. Route the artifact through",
        "compliance-redaction (Eunomia) before writing. Constitution Article IV:",
        "redaction at every boundary; no single layer is ever trusted alone."
    ) -join ' '
    [Console]::Error.WriteLine($refusal)
    Write-AuditLine -Agent $agentSlug -TargetPath $targetPath -Decision "BLOCK_PII_$($findings -join '_')"
    exit 2
}

# ---------- AI-disclosure marker on customer-facing bodies ---------------------

if ($isCustomerFacing) {
    $hasDisclosure = $body -match '(?i)\[AI-assisted response\]|AI-assisted|automated assistant'
    if (-not $hasDisclosure) {
        $refusal = @(
            "BLOCKED: customer-facing body under hearth/output/ lacks the",
            "AI-disclosure marker '[AI-assisted response]'. Constitution",
            "Article III: AI involvement is always disclosed."
        ) -join ' '
        [Console]::Error.WriteLine($refusal)
        Write-AuditLine -Agent $agentSlug -TargetPath $targetPath -Decision 'BLOCK_NO_DISCLOSURE'
        exit 2
    }
}

Write-AuditLine -Agent $agentSlug -TargetPath $targetPath -Decision 'ALLOW'
exit 0
