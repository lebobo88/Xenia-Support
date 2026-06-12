# =============================================================================
# pre-tool-privilege.ps1 - PreToolUse hook for Xenia (least-privilege + Article V)
#
# CONTRACT
#   Triggered before any ticket-system bridge tool call (matcher mcp__.*ticket.*).
#
#   Rules enforced:
#     1. Caller allow-list: only iris, intake-router, soteria,
#        retention-success, hermes, escalation-handoff.
#     2. Monetary/irreversible actions require a valid unexpired approval
#        artifact under hearth/approvals/ (Article V deny-by-default).
#        Only hermes/escalation-handoff may carry monetary actions.
#
#   WS-AUTH Phase 2: Trusted caller-capability mint + inject
#   ---------------------------------------------------------
#   For the exact Xenia ticket tools (send_response, execute_approved):
#     a) Identity from CLAUDE_HOOK_AGENT_NAME ONLY. No CLAUDE_AGENT_NAME fallback.
#     b) ticket_id from TOP-LEVEL JSON "ticket_id" field ONLY. No regex fallback.
#     c) mint_for_tool.py called EXACTLY ONCE (single Start-Process).
#        Non-zero exit or empty stdout -> BLOCK.
#     d) Token parsed into PSCustomObject, asserted to be a JSON object.
#        capability_token OVERWRITTEN with the trusted object (not a string).
#     e) STDOUT = EXACTLY ONE JSON object (permissionDecision + updatedInput).
#        ALL log/audit -> STDERR.
#     f) Payload JSON parse failure -> BLOCK.
#     g) Tool not in exact Xenia allow-list -> non-capability path (no mint).
#
#   Fix A: tool matching uses an EXACT allow-list of canonical xenia-tickets
#     tool names (dot and mcp__ gateway forms).  A foreign tool whose name
#     merely ends in send_response/execute_approved is NOT matched.
#
#   Fix 8: ALL log/audit lines use ONLY fixed codes.  No agent slug, no action
#     word, no ticket_id, no filename, no reason, no mint exit code, no payload
#     content.  Write-Audit emits a timestamp + fixed decision code ONLY.
#
#   Fix C: agent normalization is ToLower().Trim() (matches bash tr lower/trim).
#     allow-list, exit codes, tool-match, and branch order are identical to .sh.
#
#   Environment variables consumed:
#     CLAUDE_HOOK_AGENT_NAME  - calling agent slug (TRUSTED, set by framework)
#     CLAUDE_HOOK_TOOL_INPUT  - JSON tool payload
#     CLAUDE_HOOK_TOOL_NAME   - MCP tool name (set by Claude Code)
#     XENIA_ROOT              - pack root (default: script-relative)
#     HYDRA_ROOT              - Hydra repo root
#     HYDRA_OPERATOR_KEY      - signing key (NEVER echoed)
#
#   Exit codes: 0 = allow   2 = block
#   Idempotent: yes
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Logging: ALL output -> STDERR.  STDOUT reserved for the one JSON response.
# Fix 8: Write-Audit emits timestamp + decision code ONLY — no raw values.
# ---------------------------------------------------------------------------

function Write-Audit {
    param([string]$Decision)
    [Console]::Error.WriteLine(
        "$(([datetime]::UtcNow).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) | decision=$Decision"
    )
}

function Write-Log {
    param([string]$Msg)
    [Console]::Error.WriteLine("WS-AUTH-HOOK: $Msg")
}

# ---------------------------------------------------------------------------
# Resolve roots
# ---------------------------------------------------------------------------

$root = $env:XENIA_ROOT
if (-not $root) {
    $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$hydraRoot = $env:HYDRA_ROOT
if (-not $hydraRoot) {
    $hydraRoot = Join-Path (Split-Path -Parent $root) 'Hydra'
}

# ---------------------------------------------------------------------------
# Resolve agent — CLAUDE_HOOK_AGENT_NAME ONLY, no fallback.
# Fix C: ToLower().Trim() matches bash `tr '[:upper:]' '[:lower:]' | tr -d ' '`.
# ---------------------------------------------------------------------------

$agentSlug = ''
if ($env:CLAUDE_HOOK_AGENT_NAME) {
    $agentSlug = ([string]$env:CLAUDE_HOOK_AGENT_NAME).ToLower().Trim()
}

# ---------------------------------------------------------------------------
# Tool name
# ---------------------------------------------------------------------------

$toolName = ''
if ($env:CLAUDE_HOOK_TOOL_NAME) { $toolName = [string]$env:CLAUDE_HOOK_TOOL_NAME }

# ---------------------------------------------------------------------------
# Fix A: exact allow-list for capability tools.
#
# Only the canonical xenia-tickets server forms are accepted.  A foreign tool
# ending in send_response or execute_approved does NOT match.
#
# Canonical forms (all lowercased for comparison):
#   xenia-tickets.send_response          (Claude Code native)
#   xenia-tickets.execute_approved
#   mcp__xenia-tickets__send_response    (Hydra gateway)
#   mcp__xenia-tickets__execute_approved
#   xenia_tickets.send_response          (underscore variant)
#   xenia_tickets.execute_approved
#   mcp__xenia_tickets__send_response
#   mcp__xenia_tickets__execute_approved
# ---------------------------------------------------------------------------

$xeniaSendResponseTools = @(
    'xenia-tickets.send_response',
    'mcp__xenia-tickets__send_response',
    'xenia_tickets.send_response',
    'mcp__xenia_tickets__send_response'
)
$xeniaExecApprovedTools = @(
    'xenia-tickets.execute_approved',
    'mcp__xenia-tickets__execute_approved',
    'xenia_tickets.execute_approved',
    'mcp__xenia_tickets__execute_approved'
)

$toolNameLc = $toolName.ToLower()
$isCapabilityTool = $false
$mintToolName = $null

if ($xeniaSendResponseTools -contains $toolNameLc) {
    $isCapabilityTool = $true
    $mintToolName = 'xenia-tickets.send_response'
} elseif ($xeniaExecApprovedTools -contains $toolNameLc) {
    $isCapabilityTool = $true
    $mintToolName = 'xenia-tickets.execute_approved'
}

# ---------------------------------------------------------------------------
# Parse tool input JSON — fail closed on parse error for capability tools.
# ---------------------------------------------------------------------------

$payloadObj = $null
$payloadText = ''
if ($env:CLAUDE_HOOK_TOOL_INPUT) { $payloadText = [string]$env:CLAUDE_HOOK_TOOL_INPUT }

if ($payloadText -and $payloadText.Trim() -ne '') {
    try {
        $payloadObj = $payloadText | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $errType = $_.Exception.GetType().Name
        if ($isCapabilityTool) {
            Write-Log "PAYLOAD_PARSE_ERROR type=$errType"
            Write-Audit -Decision 'BLOCK_PAYLOAD_PARSE_ERROR'
            exit 2
        }
        Write-Log "PAYLOAD_PARSE_WARN type=$errType"
        $payloadObj = $null
    }
}

# ---------------------------------------------------------------------------
# Extract ticket_id from TOP-LEVEL JSON field ONLY. No regex fallback.
# ---------------------------------------------------------------------------

$ticketId = $null
if ($null -ne $payloadObj) {
    $props = $payloadObj.PSObject.Properties
    if ($props.Name -contains 'ticket_id') {
        $raw = $payloadObj.ticket_id
        if ($null -ne $raw -and ([string]$raw).Trim() -ne '') {
            $ticketId = ([string]$raw).Trim()
        }
    }
}

# ---------------------------------------------------------------------------
# Monetary pattern detection (Rule 2). Fix 8: $actionWord used internally
# for approval matching only — never written to any log line.
# ---------------------------------------------------------------------------

$monetaryPattern = '(?i)\b(refund|credit|chargeback|plan[_ -]?change|upgrade|downgrade|cancel(lation)?|terminate|delete|deletion|purge|entitlement|comp(ensate|ensation))\b'
$isMonetary = $payloadText -match $monetaryPattern
$actionWord = if ($isMonetary) { $Matches[1].ToLower() } else { '' }

# ---------------------------------------------------------------------------
# Rule 1: caller allow-list.
# Fix 8: no agent slug in log/audit. Fix C: same list as bash.
# ---------------------------------------------------------------------------

$allowedAgents = @('iris', 'intake-router', 'soteria', 'retention-success', 'hermes', 'escalation-handoff')

if (-not $agentSlug -or $agentSlug -notin $allowedAgents) {
    Write-Log 'AGENT_NOT_ALLOWED'
    Write-Audit -Decision 'BLOCK_AGENT_NOT_ALLOWED'
    exit 2
}

# ---------------------------------------------------------------------------
# Rule 2: monetary / irreversible actions require Article V approval.
# Fix 8: no agent slug, no action word, no filename, no reason in any log.
# ---------------------------------------------------------------------------

if ($isMonetary) {
    if ($agentSlug -notin @('hermes', 'escalation-handoff')) {
        Write-Log 'MONETARY_NOT_HERMES'
        Write-Audit -Decision 'BLOCK_NOT_HERMES'
        exit 2
    }

    $approvalsDir = Join-Path $root 'hearth/approvals'
    $valid = $false

    if (Test-Path $approvalsDir) {
        $files = Get-ChildItem -LiteralPath $approvalsDir -Filter 'APPROVAL-*.yaml' -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $txt = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
            if (-not $txt) { continue }
            if ($txt -notmatch '(?i)status:\s*approved') { continue }
            if ($ticketId -and $txt -notmatch [regex]::Escape($ticketId)) { continue }
            if ($txt -notmatch "(?i)action:\s*[`"']?$([regex]::Escape($actionWord))") {
                if ($txt -notmatch '(?i)action:\s*[\"'']?(refund|credit|plan-change|cancellation|deletion)') { continue }
            }
            if ($txt -match '(?i)expires_at:\s*[\"'']?([0-9T:\.\-Z\+]+)') {
                try {
                    $exp = [datetime]::Parse($Matches[1], $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                    if ($exp -lt [datetime]::UtcNow) { continue }
                } catch { continue }
            }
            $valid = $true
            Write-Audit -Decision 'ALLOW_APPROVED'
            break
        }
    }

    if (-not $valid) {
        Write-Log 'NO_VALID_APPROVAL'
        Write-Audit -Decision 'BLOCK_NO_APPROVAL'
        exit 2
    }
}

# ---------------------------------------------------------------------------
# WS-AUTH Phase 2: mint + inject capability_token
# ---------------------------------------------------------------------------

if ($isCapabilityTool) {

    # Top-level ticket_id required.
    if (-not $ticketId) {
        Write-Log 'TICKET_ID_ABSENT'
        Write-Audit -Decision 'BLOCK_NO_TICKET_ID'
        exit 2
    }

    # Locate mint_for_tool.py.
    $mintScript = Join-Path $hydraRoot 'mcp_servers\xenia_tickets\mint_for_tool.py'
    if (-not (Test-Path $mintScript)) {
        Write-Log 'MINT_SCRIPT_MISSING'
        Write-Audit -Decision 'BLOCK_MINT_MISSING'
        exit 2
    }

    # Mint EXACTLY ONCE via Start-Process with separated stdout/stderr temp files.
    # Fix 8: mint stderr discarded — never relayed (could contain unexpected data).
    $tmpOut = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    $mintExitCode = -1
    $mintTokenJson = ''

    try {
        $proc = Start-Process -FilePath 'python' `
            -ArgumentList @($mintScript, '--tool-name', $mintToolName, '--ticket-id', $ticketId) `
            -RedirectStandardOutput $tmpOut `
            -RedirectStandardError  $tmpErr `
            -NoNewWindow -Wait -PassThru

        $mintExitCode = $proc.ExitCode

        if (Test-Path $tmpOut) {
            $mintTokenJson = [System.IO.File]::ReadAllText($tmpOut, [System.Text.Encoding]::UTF8).Trim()
        }
        # Fix 8: mint stderr NOT relayed.
    } finally {
        if (Test-Path $tmpOut) { Remove-Item -LiteralPath $tmpOut -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tmpErr) { Remove-Item -LiteralPath $tmpErr -Force -ErrorAction SilentlyContinue }
    }

    # Fix 8: no mintExitCode in log line.
    if ($mintExitCode -ne 0 -or -not $mintTokenJson) {
        Write-Log 'MINT_FAILED'
        Write-Audit -Decision 'BLOCK_MINT_FAILED'
        exit 2
    }

    # Fix 3: parse token JSON into PSCustomObject and assert it is a JSON object.
    $tokenObj = $null
    try {
        $tokenObj = $mintTokenJson | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $errType = $_.Exception.GetType().Name
        Write-Log "TOKEN_PARSE_ERROR type=$errType"
        Write-Audit -Decision 'BLOCK_TOKEN_PARSE_ERROR'
        exit 2
    }

    if ($null -eq $tokenObj -or
        ($tokenObj -isnot [System.Management.Automation.PSCustomObject] -and
         $tokenObj -isnot [System.Collections.Hashtable])) {
        Write-Log 'TOKEN_NOT_OBJECT'
        Write-Audit -Decision 'BLOCK_TOKEN_NOT_OBJECT'
        exit 2
    }

    # Build updatedInput — OVERWRITE any agent-supplied capability_token.
    if ($null -eq $payloadObj) { $payloadObj = [PSCustomObject]@{} }
    $payloadObj | Add-Member -NotePropertyName 'capability_token' -NotePropertyValue $tokenObj -Force

    $response = [ordered]@{
        permissionDecision = 'allow'
        updatedInput       = $payloadObj
    }

    Write-Audit -Decision 'ALLOW_CAP_INJECTED'

    # STDOUT = EXACTLY ONE JSON object.
    $response | ConvertTo-Json -Depth 20 -Compress
    exit 0
}

# ---------------------------------------------------------------------------
# Non-capability tools: plain allow (no stdout JSON).
# ---------------------------------------------------------------------------

Write-Audit -Decision $(if ($isMonetary) { 'ALLOW_MONETARY_APPROVED' } else { 'ALLOW_NON_MONETARY' })
exit 0
