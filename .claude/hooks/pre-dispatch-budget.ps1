# =============================================================================
# pre-dispatch-budget.ps1 - PreToolUse hook for Xenia (dispatch-budget counter)
#
# CONTRACT
#   Triggered before any Task / Agent tool call (subagent dispatch).
#   Implements a runtime per-run dispatch counter as defense-in-depth against
#   spin loops (Layer 3 — backs the constitution + Stop-hook layers).
#
#   Environment variables consumed:
#     CLAUDE_HOOK_RUN_ID      - run identifier (preferred); if absent a
#                               per-day fallback is derived from the UTC date
#     CLAUDE_HOOK_COMMAND     - command context (e.g. "support-ticket"); used
#                               to look up the ceiling; defaults to 8
#     XENIA_ROOT              - pack root (default: script-relative)
#
#   Counter file:
#     hearth/progress/.budget-<run_id>.json
#     Schema: { "run_id": str, "command": str, "ceiling": int,
#               "count": int, "terminal": bool, "last_ts": ISO-8601 }
#
#   Ceiling table (mirrors SKILL.md hard ceilings):
#     support-ticket     8   subagent dispatches
#     triage-queue      25   dispatches per pass
#     support-shadow    10   dispatches per pass
#     (default)          8
#
#   Absorbing-terminal-state rule:
#     If the counter file carries "terminal": true, further dispatches for
#     that run_id are blocked regardless of count vs ceiling.
#
#   Fail-open contract (defense-in-depth, not a hard gate):
#     Any internal error (I/O failure, JSON parse error, unwritable dir, etc.)
#     is logged to stderr and the hook exits 0 (allow). A counter outage must
#     never block legitimate support work — it only removes the mechanical
#     backstop, leaving the constitution + Stop-hook layers in place.
#
#   Exit codes:
#     0 - allow dispatch (or fail-open on internal error)
#     2 - block dispatch: budget ceiling exceeded or run is in terminal state
#
#   Stdout  : one audit line per invocation
#   Stderr  : human-readable block reason when exit 2; warning on internal error
#   Idempotent: yes (file-level CAS via temp-write + Move-Item -Force)
# =============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ISOTimestamp {
    [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function Write-AuditLine {
    param([string]$RunId, [string]$Command, [string]$Decision)
    Write-Output "$(Get-ISOTimestamp) | run_id=$RunId | command=$Command | decision=$Decision"
}

# ---------- ceiling table ------------------------------------------------------

$ceilingTable = @{
    'support-ticket'  = 8
    'triage-queue'    = 25
    'support-shadow'  = 10
}
$defaultCeiling = 8

# ---------- fail-open wrapper --------------------------------------------------

try {

    # ---------- resolve root -------------------------------------------------------

    $root = $env:XENIA_ROOT
    if (-not $root) {
        $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    }

    # ---------- resolve run_id ----------------------------------------------------

    $runId = $env:CLAUDE_HOOK_RUN_ID
    if (-not $runId -or $runId.Trim() -eq '') {
        # Per-day fallback: one shared budget token per UTC date when no run ID is
        # injected. This prevents an entirely un-identified session from bypassing
        # the counter entirely, while still isolating distinct calendar days.
        $runId = 'fallback-' + [datetime]::UtcNow.ToString('yyyy-MM-dd')
    }
    $runId = $runId.Trim()

    # Sanitise run_id so it is safe as a filename component (keep alphanumeric,
    # hyphen, underscore, dot; replace everything else with underscore).
    $safeRunId = $runId -replace '[^a-zA-Z0-9._-]', '_'

    # ---------- resolve command / ceiling -----------------------------------------

    $command = $env:CLAUDE_HOOK_COMMAND
    if (-not $command -or $command.Trim() -eq '') { $command = 'unknown' }
    $command = $command.Trim().ToLower()

    $ceiling = $defaultCeiling
    foreach ($key in $ceilingTable.Keys) {
        if ($command -match [regex]::Escape($key)) {
            $ceiling = $ceilingTable[$key]
            break
        }
    }

    # ---------- locate / create counter file --------------------------------------

    $progressDir = Join-Path $root 'hearth/progress'
    if (-not (Test-Path $progressDir)) {
        New-Item -ItemType Directory -Force -Path $progressDir | Out-Null
    }

    $budgetFile = Join-Path $progressDir ".budget-$safeRunId.json"

    # ---------- read current state ------------------------------------------------

    $state = $null
    if (Test-Path $budgetFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($budgetFile, (New-Object System.Text.UTF8Encoding($false)))
            $state = $raw | ConvertFrom-Json -ErrorAction Stop
        } catch {
            # Corrupt counter file — treat as fresh start (fail-open on read error).
            [Console]::Error.WriteLine("pre-dispatch-budget WARNING: could not parse $budgetFile (treating as fresh) -- $_")
            $state = $null
        }
    }

    if ($null -eq $state) {
        $state = [PSCustomObject]@{
            run_id   = $runId
            command  = $command
            ceiling  = $ceiling
            count    = 0
            terminal = $false
            last_ts  = $null
        }
    }

    # ---------- absorbing-terminal-state check ------------------------------------

    $isTerminal = $false
    if ($state.PSObject.Properties.Name -contains 'terminal') {
        # ConvertFrom-Json gives us a bool or a string depending on PS version.
        $tv = $state.terminal
        if ($tv -is [bool]) { $isTerminal = $tv }
        elseif ($tv -is [string]) { $isTerminal = ($tv -eq 'true') }
    }

    if ($isTerminal) {
        $reason = @(
            "BLOCKED: run '$runId' is in an absorbing terminal state.",
            "No further subagent dispatches are permitted for this run.",
            "New information = new ticket (FOLLOW_UP_TICKET). See constitution Article VIII."
        ) -join ' '
        [Console]::Error.WriteLine($reason)
        Write-AuditLine -RunId $runId -Command $command -Decision "BLOCK_TERMINAL(count=$($state.count),ceiling=$ceiling)"
        exit 2
    }

    # ---------- ceiling check (pre-increment) -------------------------------------
    #
    # We check BEFORE incrementing so the Nth allowed dispatch increments to N and
    # the (N+1)th is blocked. Ceiling of 8 means dispatches 1..8 are allowed and
    # dispatch 9 is blocked.

    $currentCount = 0
    if ($state.PSObject.Properties.Name -contains 'count') {
        $cv = $state.count
        if ($cv -is [int] -or $cv -is [long] -or $cv -is [double]) {
            $currentCount = [int]$cv
        }
    }

    if ($currentCount -ge $ceiling) {
        $reason = @(
            "BLOCKED: dispatch budget ceiling $ceiling reached for run '$runId'",
            "(command: $command). Escalate to a human; do not spin.",
            "Constitution Article VIII: subagent dispatch budget exhausted ->",
            "terminal state ESCALATED_TO_HUMAN."
        ) -join ' '
        [Console]::Error.WriteLine($reason)
        Write-AuditLine -RunId $runId -Command $command -Decision "BLOCK_CEILING(count=$currentCount,ceiling=$ceiling)"
        exit 2
    }

    # ---------- increment and persist ---------------------------------------------

    $newCount = $currentCount + 1
    $newState = [ordered]@{
        run_id   = $runId
        command  = $command
        ceiling  = $ceiling
        count    = $newCount
        terminal = $false
        last_ts  = (Get-ISOTimestamp)
    }

    $json = $newState | ConvertTo-Json -Compress -Depth 3
    $encoding = New-Object System.Text.UTF8Encoding($false)

    # Atomic-ish write: write to a temp file then move into place.
    # This prevents a half-written counter from being read as corrupt.
    $tmpFile = $budgetFile + '.tmp'
    try {
        [System.IO.File]::WriteAllText($tmpFile, $json + "`n", $encoding)
        Move-Item -LiteralPath $tmpFile -Destination $budgetFile -Force
    } catch {
        # If atomic swap fails try direct write (e.g. cross-volume temp on some configs).
        try {
            [System.IO.File]::WriteAllText($budgetFile, $json + "`n", $encoding)
        } catch {
            # Persist failure: fail-open (budget outage must never block support work).
            [Console]::Error.WriteLine("pre-dispatch-budget WARNING: could not persist counter to $budgetFile -- $_")
        }
        # Clean up temp if it lingers.
        if (Test-Path $tmpFile) { Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue }
    }

    # ---------- allow --------------------------------------------------------------

    Write-AuditLine -RunId $runId -Command $command -Decision "ALLOW(count=$newCount/$ceiling)"
    exit 0

} catch {
    # Outermost fail-open catch: any unhandled internal error -> allow + warn.
    [Console]::Error.WriteLine("pre-dispatch-budget WARNING (fail-open): internal error -- $_")
    exit 0
}
