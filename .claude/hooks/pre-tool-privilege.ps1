# =============================================================================
# pre-tool-privilege.ps1 - PreToolUse hook for Xenia (least-privilege + Article V)
#
# CONTRACT
#   Triggered before any ticket-system bridge tool call (matcher mcp__.*ticket.*).
#
#   Enforces two rules:
#     1. Caller allow-list: only iris, retention-success (soteria), and
#        escalation-handoff (hermes) may touch the ticket system at all.
#     2. Deny-by-default for monetary/irreversible actions (refund, credit,
#        plan change, cancellation, deletion, entitlement change): such calls
#        require a matching, unexpired approval artifact under
#        hearth/approvals/ with status 'approved' — and only hermes may carry
#        them (constitution Article V).
#
#   Environment variables consumed:
#     CLAUDE_HOOK_AGENT_NAME / CLAUDE_AGENT_NAME - calling agent slug
#     CLAUDE_HOOK_TOOL_INPUT                     - JSON tool payload
#     XENIA_ROOT                                 - pack root (default: script-relative)
#
#   Exit codes:
#     0 - allow ; 2 - block (stderr carries the reason)
#   Idempotent: yes
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ISOTimestamp {
    [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function Write-AuditLine {
    param([string]$Agent, [string]$Action, [string]$Decision)
    Write-Output "$(Get-ISOTimestamp) | agent=$Agent | action=$Action | decision=$Decision"
}

# ---------- resolve root -------------------------------------------------------

$root = $env:XENIA_ROOT
if (-not $root) {
    $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

# ---------- resolve agent ------------------------------------------------------

$agentName = $env:CLAUDE_HOOK_AGENT_NAME
if (-not $agentName) { $agentName = $env:CLAUDE_AGENT_NAME }
if (-not $agentName) { $agentName = 'unknown' }
$agentSlug = $agentName.ToLower().Trim()

# ---------- resolve payload ----------------------------------------------------

$payloadText = ''
if ($env:CLAUDE_HOOK_TOOL_INPUT) { $payloadText = [string]$env:CLAUDE_HOOK_TOOL_INPUT }

$ticketId = $null
if ($payloadText -match '(?i)(TICKET[-_][A-Za-z0-9]+|"ticket_id"\s*:\s*"([^"]+)")') {
    if ($Matches.Count -ge 3 -and $Matches[2]) { $ticketId = $Matches[2] } else { $ticketId = $Matches[1] }
}

# ---------- rule 1: caller allow-list ------------------------------------------

$allowedAgents = @('iris', 'intake-router', 'soteria', 'retention-success', 'hermes', 'escalation-handoff')

if ($agentSlug -notin $allowedAgents) {
    $refusal = @(
        "BLOCKED: agent '$agentSlug' is not authorised to call the ticket-system",
        "bridge. Only Iris (intake-router), Soteria (retention-success), and",
        "Hermes (escalation-handoff) may touch the ticket system.",
        "See heads.yaml tool boundaries and AGENTS.md."
    ) -join ' '
    [Console]::Error.WriteLine($refusal)
    Write-AuditLine -Agent $agentSlug -Action 'ticket-call' -Decision 'BLOCK_AGENT_NOT_ALLOWED'
    exit 2
}

# ---------- rule 2: monetary / irreversible actions ----------------------------

$monetaryPattern = '(?i)\b(refund|credit|chargeback|plan[_ -]?change|upgrade|downgrade|cancel(lation)?|terminate|delete|deletion|purge|entitlement|comp(ensate|ensation))\b'

if ($payloadText -notmatch $monetaryPattern) {
    Write-AuditLine -Agent $agentSlug -Action 'ticket-call' -Decision 'ALLOW_NON_MONETARY'
    exit 0
}

$actionWord = $Matches[1].ToLower()

# Only hermes carries monetary/irreversible actions at all.
if ($agentSlug -notin @('hermes', 'escalation-handoff')) {
    $refusal = @(
        "BLOCKED: monetary/irreversible action '$actionWord' attempted by",
        "'$agentSlug'. Constitution Article V: such actions are recommend-only",
        "for every head except Hermes, and Hermes requires a human approval",
        "artifact. Emit a recommendation instead."
    ) -join ' '
    [Console]::Error.WriteLine($refusal)
    Write-AuditLine -Agent $agentSlug -Action $actionWord -Decision 'BLOCK_NOT_HERMES'
    exit 2
}

# Hermes path: require a valid approval artifact.
$approvalsDir = Join-Path $root 'hearth/approvals'
$valid = $false
$reason = 'no approvals directory'

if (Test-Path $approvalsDir) {
    $reason = 'no matching approval artifact'
    $files = Get-ChildItem -LiteralPath $approvalsDir -Filter 'APPROVAL-*.yaml' -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        $txt = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $txt) { continue }
        if ($txt -notmatch '(?i)status:\s*approved') { continue }
        if ($ticketId -and $txt -notmatch [regex]::Escape($ticketId)) { continue }
        if ($txt -notmatch "(?i)action:\s*[`"']?$([regex]::Escape($actionWord))") {
            # action word in payload must match the artifact's action field family
            if ($txt -notmatch '(?i)action:\s*[\"'']?(refund|credit|plan-change|cancellation|deletion)') { continue }
        }
        if ($txt -match '(?i)expires_at:\s*[\"'']?([0-9T:\.\-Z\+]+)') {
            try {
                $exp = [datetime]::Parse($Matches[1], $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                if ($exp -lt [datetime]::UtcNow) { $reason = "approval expired ($($f.Name))"; continue }
            } catch { $reason = "unparseable expires_at ($($f.Name))"; continue }
        }
        $valid = $true
        Write-AuditLine -Agent $agentSlug -Action $actionWord -Decision "ALLOW_APPROVED($($f.Name))"
        break
    }
}

if (-not $valid) {
    $refusal = @(
        "BLOCKED: monetary/irreversible action '$actionWord' has no valid human",
        "approval artifact ($reason). Constitution Article V: deny-by-default.",
        "Required: hearth/approvals/APPROVAL-<ticket-id>-<seq>.yaml with",
        "status: approved, matching ticket and action, unexpired, issued by a",
        "named human via /hydra:approve or recorded in-chat confirmation."
    ) -join ' '
    [Console]::Error.WriteLine($refusal)
    Write-AuditLine -Agent $agentSlug -Action $actionWord -Decision 'BLOCK_NO_APPROVAL'
    exit 2
}

exit 0
