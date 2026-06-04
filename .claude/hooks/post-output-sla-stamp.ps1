# =============================================================================
# post-output-sla-stamp.ps1 - PostToolUse hook for Xenia (telemetry single-writer)
#
# CONTRACT
#   Triggered after any successful Write / xenia.output.write tool call that
#   targets hearth/output/**. Appends ONE event line to
#   hearth/progress/events.jsonl. This hook is the ONLY writer of
#   events.jsonl (single-writer rule; TheEights watcher tails this file).
#
#   Environment variables consumed:
#     CLAUDE_HOOK_AGENT_NAME / CLAUDE_AGENT_NAME - calling agent slug
#     CLAUDE_HOOK_TOOL_INPUT                     - JSON write payload
#     XENIA_ROOT                                 - pack root (default: script-relative)
#
#   Event schema (consumed by TheEights xenia-bridge; keep stable):
#     event_id   - monotonic, unique: x-<utc-ticks>-<4 random hex>
#     ts         - ISO-8601 UTC
#     kind       - xenia.ticket_created | xenia.ticket_resolved |
#                  xenia.escalated | xenia.voc_report | xenia.output_written
#     agent      - calling agent slug
#     phase      - tickets | escalations | voc | quality | kb-gaps | other
#     ticket_id  - parsed from path when present, else null
#     path       - pack-relative output path
#     sla_state  - ok | warn | breach | n/a (best-effort from body markers)
#     tokens     - {in:<int>,out:<int>} | null  (CLAUDE_HOOK_TOKENS_IN/OUT)
#     cost_usd   - <number> | null  (CLAUDE_HOOK_COST_USD explicit override,
#                  or derived from tokens+tier via built-in rate table,
#                  else null)
#     model_tier - opus | sonnet | haiku | null  (CLAUDE_HOOK_MODEL_TIER)
#   The three cost fields are nullable-additive: absent env vars → null.
#   The bridge ingests with or without them (no bridge change required).
#
#   Exit codes: always 0 (non-blocking telemetry; failures degrade silently
#   to stderr so a telemetry outage can never block customer work).
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

try {
    # ---------- resolve root ---------------------------------------------------
    $root = $env:XENIA_ROOT
    if (-not $root) {
        $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # .claude/hooks -> pack root
    }

    # ---------- resolve agent + payload ----------------------------------------
    $agentName = $env:CLAUDE_HOOK_AGENT_NAME
    if (-not $agentName) { $agentName = $env:CLAUDE_AGENT_NAME }
    if (-not $agentName) { $agentName = 'unknown' }
    $agentSlug = $agentName.ToLower().Trim()

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
        } catch { }
    }

    $normPath = $targetPath.Replace('\', '/')

    # Only stamp writes under hearth/output/ (the deliverable tree).
    if ($normPath -notmatch '(?i)hearth/output/') { exit 0 }

    # ---------- derive fields ---------------------------------------------------
    $phase = 'other'
    if ($normPath -match '(?i)hearth/output/(tickets|escalations|voc|quality|kb-gaps)/') {
        $phase = $Matches[1].ToLower()
    }

    $ticketId = $null
    # Prefer the body's explicit ticket_id field; fall back to the path.
    if ($body -match '(?i)ticket_id:\s*([A-Za-z0-9_-]+)') { $ticketId = $Matches[1] }
    elseif ($normPath -match '(?i)(TICKET[-_][A-Za-z0-9]+(?:-\d{1,4})?|[A-Z]{2,5}-\d{2,8})') { $ticketId = $Matches[1] }

    $kind = 'xenia.output_written'
    switch ($phase) {
        'escalations' { $kind = 'xenia.escalated' }
        'voc'         { $kind = 'xenia.voc_report' }
        'tickets'     {
            if ($body -match '(?i)terminal_state:\s*RESOLVED') { $kind = 'xenia.ticket_resolved' }
            elseif ($body -match '(?i)terminal_state:\s*ESCALATED_TO_HUMAN') { $kind = 'xenia.escalated' }
            else { $kind = 'xenia.ticket_created' }
        }
    }

    $slaState = 'n/a'
    if ($body -match '(?i)sla[_-]?state:\s*(ok|warn|breach)') { $slaState = $Matches[1].ToLower() }
    elseif ($body -match '(?i)breached:\s*true') { $slaState = 'breach' }

    $severity = 'unknown'
    if ($body -match '(?i)priority:\s*(P[1-4])') { $severity = $Matches[1].ToUpper() }

    $category = 'general'
    if ($body -match '(?i)intent:\s*([a-z-]+)') { $category = $Matches[1].ToLower() }

    # Opaque customer ref (constitution Article IV: hash only, never raw identity)
    $customerRef = $null
    if ($body -match '(?i)customer:([0-9a-f]{6,})') { $customerRef = "customer:$($Matches[1].ToLower())" }

    # Outcome tagging (Soteria's delight convention rides the event too)
    $outcome = $null
    if ($body -match '(?i)outcome:\s*delight') { $outcome = 'delight' }
    elseif ($body -match '(?i)terminal_state:\s*RESOLVED') { $outcome = 'resolved' }

    # ---------- cost / token fields (prop_36000c5c: per-resolution cost) --------
    # Built-in rate table (approx public list pricing per 1M tokens, USD).
    # These are APPROXIMATE and are OVERRIDABLE via CLAUDE_HOOK_COST_USD.
    # Update if Anthropic list prices change materially.
    $rateTable = @{
        'opus'    = @{ in = 15.0;  out = 75.0  }   # $15/$75 per 1M in/out
        'sonnet'  = @{ in = 3.0;   out = 15.0  }   # $3/$15  per 1M in/out
        'haiku'   = @{ in = 0.80;  out = 4.0   }   # $0.80/$4 per 1M in/out
    }

    # model_tier: opus | sonnet | haiku | null
    $modelTier = $null
    if ($env:CLAUDE_HOOK_MODEL_TIER) {
        $t = $env:CLAUDE_HOOK_MODEL_TIER.ToLower().Trim()
        if ($rateTable.ContainsKey($t)) { $modelTier = $t }
    }

    # tokens: {in, out} | null
    $tokensField = $null
    $tokensIn  = $null
    $tokensOut = $null
    if ($env:CLAUDE_HOOK_TOKENS_IN -and $env:CLAUDE_HOOK_TOKENS_OUT) {
        $parsedIn  = 0; $parsedOut = 0
        if ([int]::TryParse($env:CLAUDE_HOOK_TOKENS_IN,  [ref]$parsedIn) -and
            [int]::TryParse($env:CLAUDE_HOOK_TOKENS_OUT, [ref]$parsedOut)) {
            $tokensIn  = $parsedIn
            $tokensOut = $parsedOut
            $tokensField = [ordered]@{ 'in' = $tokensIn; 'out' = $tokensOut }
        }
    }

    # cost_usd: explicit override wins; else derive from tokens+tier; else null
    $costUsd = $null
    if ($env:CLAUDE_HOOK_COST_USD) {
        $parsedCost = 0.0
        if ([double]::TryParse($env:CLAUDE_HOOK_COST_USD,
                [System.Globalization.NumberStyles]::Any,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [ref]$parsedCost)) {
            $costUsd = [math]::Round($parsedCost, 9)
        }
    } elseif ($tokensIn -ne $null -and $tokensOut -ne $null -and $modelTier -ne $null) {
        $rates = $rateTable[$modelTier]
        $costUsd = [math]::Round(
            ($tokensIn  / 1e6 * $rates.in) +
            ($tokensOut / 1e6 * $rates.out), 9)
    }

    # ---------- build + append event (single line, atomic append) ----------------
    $rand = -join ((48..57) + (97..102) | Get-Random -Count 4 | ForEach-Object { [char]$_ })
    $evt = [ordered]@{
        event_id     = "x-$([datetime]::UtcNow.Ticks)-$rand"
        ts           = [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        kind         = $kind
        agent        = $agentSlug
        phase        = $phase
        ticket_id    = $ticketId
        severity     = $severity
        category     = $category
        customer_ref = $customerRef
        outcome      = $outcome
        path         = $normPath
        sla_state    = $slaState
        tokens       = $tokensField
        cost_usd     = $costUsd
        model_tier   = $modelTier
    }

    $progressDir = Join-Path $root 'hearth/progress'
    if (-not (Test-Path $progressDir)) { New-Item -ItemType Directory -Force $progressDir | Out-Null }
    $eventsFile = Join-Path $progressDir 'events.jsonl'

    $line = ($evt | ConvertTo-Json -Compress -Depth 4)
    # BOM-less UTF-8 append (Windows PowerShell 5.1's Add-Content -Encoding utf8
    # writes a BOM on file creation, which breaks JSON.parse on the first line
    # for the TheEights watcher). AppendAllText with explicit no-BOM encoding.
    [System.IO.File]::AppendAllText($eventsFile, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))

    Write-Output "$($evt.ts) | agent=$agentSlug | event=$($evt.event_id) | kind=$kind | stamped"
} catch {
    [Console]::Error.WriteLine("post-output-sla-stamp WARNING (non-blocking): $_")
}

exit 0
