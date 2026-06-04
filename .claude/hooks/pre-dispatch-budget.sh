#!/bin/sh
# =============================================================================
# pre-dispatch-budget.sh - PreToolUse hook for Xenia (dispatch-budget counter)
#
# MIRRORS: .claude/hooks/pre-dispatch-budget.ps1  (POSIX equivalent)
# PLATFORM NOTE: A deployment runs EITHER the .ps1 (Windows) OR the .sh set
#   (POSIX/Linux/macOS), never both.  Select by configuring hooks.json for the
#   target harness platform.
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
#     XENIA_ROOT              - pack root (default: two levels above this script)
#
#   Counter file schema (shared with .ps1 — identical JSON fields):
#     hearth/progress/.budget-<run_id>.json
#     { "run_id": str, "command": str, "ceiling": int,
#       "count": int, "terminal": bool, "last_ts": ISO-8601 | null }
#
#   Ceiling table (mirrors SKILL.md hard ceilings):
#     support-ticket    8   subagent dispatches
#     triage-queue     25   dispatches per pass
#     support-shadow   10   dispatches per pass
#     (default)         8
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
#   Dependencies: sh, date, printf, grep, sed, mkdir (POSIX baseline; uses awk
#                 for integer arithmetic; no jq required)
#   Idempotent: yes (temp-file + mv atomic-ish swap matches .ps1 approach)
# =============================================================================

# ---------- ISO timestamp (UTC) -----------------------------------------------
iso_timestamp() {
    date -u '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# ---------- audit line --------------------------------------------------------
write_audit_line() {
    # $1=run_id  $2=command  $3=decision
    printf '%s | run_id=%s | command=%s | decision=%s\n' \
        "$(iso_timestamp)" "$1" "$2" "$3"
}

# ---------- outer fail-open wrapper -------------------------------------------
# We use a subshell so any unexpected 'exit' from inner logic still lands at
# the outer exit 0 if we didn't already exit 2.
_inner() {

# ---------- resolve root -------------------------------------------------------
if [ -n "${XENIA_ROOT:-}" ]; then
    root="$XENIA_ROOT"
else
    script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
    root=$(cd "$script_dir/../.." 2>/dev/null && pwd)
fi

# ---------- resolve run_id ----------------------------------------------------
run_id="${CLAUDE_HOOK_RUN_ID:-}"
if [ -z "$run_id" ]; then
    run_id="fallback-$(date -u '+%Y-%m-%d')"
fi
# trim leading/trailing whitespace
run_id=$(printf '%s' "$run_id" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Sanitise run_id for use as a filename: keep alnum, hyphen, underscore, dot
safe_run_id=$(printf '%s' "$run_id" | sed 's/[^a-zA-Z0-9._-]/_/g')

# ---------- resolve command / ceiling -----------------------------------------
command="${CLAUDE_HOOK_COMMAND:-}"
if [ -z "$command" ]; then command="unknown"; fi
command=$(printf '%s' "$command" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')

ceiling=8
case "$command" in
    *support-ticket*)  ceiling=8  ;;
    *triage-queue*)    ceiling=25 ;;
    *support-shadow*)  ceiling=10 ;;
esac

# ---------- locate / create counter file --------------------------------------
progress_dir="${root}/hearth/progress"
mkdir -p "$progress_dir" 2>/dev/null || {
    printf 'pre-dispatch-budget WARNING: could not create %s\n' "$progress_dir" >&2
    # Fail-open
    write_audit_line "$run_id" "$command" "ALLOW_FAILOPEN(mkdir)"
    return 0
}

budget_file="${progress_dir}/.budget-${safe_run_id}.json"

# ---------- read current state ------------------------------------------------
current_count=0
is_terminal=0

if [ -f "$budget_file" ]; then
    raw=$(cat "$budget_file" 2>/dev/null) || raw=""
    if [ -z "$raw" ]; then
        printf 'pre-dispatch-budget WARNING: empty counter file %s (treating as fresh)\n' "$budget_file" >&2
    else
        # Parse count: look for "count": <integer>
        parsed_count=$(printf '%s' "$raw" | grep -oE '"count"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$')
        if [ -n "$parsed_count" ]; then
            current_count="$parsed_count"
        else
            printf 'pre-dispatch-budget WARNING: could not parse count in %s (treating as 0)\n' "$budget_file" >&2
        fi

        # Parse terminal: "terminal": true|false
        term_val=$(printf '%s' "$raw" | grep -oiE '"terminal"[[:space:]]*:[[:space:]]*(true|false)' | head -1 | grep -oiE '(true|false)$' | tr '[:upper:]' '[:lower:]')
        if [ "$term_val" = "true" ]; then
            is_terminal=1
        fi
    fi
fi

# ---------- absorbing-terminal-state check ------------------------------------
if [ "$is_terminal" -eq 1 ]; then
    reason="BLOCKED: run '${run_id}' is in an absorbing terminal state. No further subagent dispatches are permitted for this run. New information = new ticket (FOLLOW_UP_TICKET). See constitution Article VIII."
    printf '%s\n' "$reason" >&2
    write_audit_line "$run_id" "$command" "BLOCK_TERMINAL(count=${current_count},ceiling=${ceiling})"
    return 2
fi

# ---------- ceiling check (pre-increment) -------------------------------------
# Ceiling of N means dispatches 1..N are allowed; dispatch N+1 is blocked.
if [ "$current_count" -ge "$ceiling" ]; then
    reason="BLOCKED: dispatch budget ceiling ${ceiling} reached for run '${run_id}' (command: ${command}). Escalate to a human; do not spin. Constitution Article VIII: subagent dispatch budget exhausted -> terminal state ESCALATED_TO_HUMAN."
    printf '%s\n' "$reason" >&2
    write_audit_line "$run_id" "$command" "BLOCK_CEILING(count=${current_count},ceiling=${ceiling})"
    return 2
fi

# ---------- increment and persist ---------------------------------------------
new_count=$((current_count + 1))
ts_now=$(iso_timestamp)

# Build JSON (manual — no jq dependency)
new_json=$(printf '{"run_id":"%s","command":"%s","ceiling":%d,"count":%d,"terminal":false,"last_ts":"%s"}' \
    "$run_id" "$command" "$ceiling" "$new_count" "$ts_now")

# Atomic-ish write: write to .tmp then mv into place
tmp_file="${budget_file}.tmp"
write_ok=0

if printf '%s\n' "$new_json" > "$tmp_file" 2>/dev/null; then
    if mv -f "$tmp_file" "$budget_file" 2>/dev/null; then
        write_ok=1
    else
        # mv failed (cross-filesystem?): try direct write
        if printf '%s\n' "$new_json" > "$budget_file" 2>/dev/null; then
            write_ok=1
        fi
        rm -f "$tmp_file" 2>/dev/null
    fi
else
    rm -f "$tmp_file" 2>/dev/null
    # Try direct write as fallback
    if printf '%s\n' "$new_json" > "$budget_file" 2>/dev/null; then
        write_ok=1
    fi
fi

if [ "$write_ok" -eq 0 ]; then
    printf 'pre-dispatch-budget WARNING: could not persist counter to %s (fail-open)\n' "$budget_file" >&2
fi

# ---------- allow --------------------------------------------------------------
write_audit_line "$run_id" "$command" "ALLOW(count=${new_count}/${ceiling})"
return 0

} # end _inner

# Run inner logic; capture exit code
_inner
inner_exit=$?

# Fail-open: if inner exited non-zero for any reason OTHER than our deliberate
# exit 2 block, we exit 0.  If it was a deliberate block (exit 2) we honour it.
if [ "$inner_exit" -eq 2 ]; then
    exit 2
fi
exit 0
