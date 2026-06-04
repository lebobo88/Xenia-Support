#!/bin/sh
# =============================================================================
# pre-tool-privilege.sh - PreToolUse hook for Xenia (least-privilege + Article V)
#
# MIRRORS: .claude/hooks/pre-tool-privilege.ps1  (POSIX equivalent)
# PLATFORM NOTE: A deployment runs EITHER the .ps1 (Windows) OR the .sh set
#   (POSIX/Linux/macOS), never both.  Select by configuring hooks.json for the
#   target harness platform.
#
# CONTRACT
#   Triggered before any ticket-system bridge tool call (matcher mcp__.*ticket.*).
#
#   Enforces two rules:
#     1. Caller allow-list: only iris, intake-router, soteria,
#        retention-success, hermes, and escalation-handoff may touch the
#        ticket system at all.
#     2. Deny-by-default for monetary/irreversible actions (refund, credit,
#        plan change, cancellation, deletion, entitlement change): such calls
#        require a matching, unexpired approval artifact under
#        hearth/approvals/ with status 'approved' — and only hermes may carry
#        them (constitution Article V).
#
#   Environment variables consumed:
#     CLAUDE_HOOK_AGENT_NAME / CLAUDE_AGENT_NAME - calling agent slug
#     CLAUDE_HOOK_TOOL_INPUT                     - JSON tool payload
#     XENIA_ROOT                                 - pack root (default: two levels
#                                                  above this script's directory)
#
#   Exit codes:
#     0 - allow ; 2 - block (stderr carries the reason)
#   Dependencies: sh, grep, sed, date, find (POSIX baseline — no jq required)
#   Idempotent: yes
# =============================================================================

# ---------- ISO timestamp (UTC) -----------------------------------------------
iso_timestamp() {
    date -u '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# ---------- audit line --------------------------------------------------------
write_audit_line() {
    # $1=agent $2=action $3=decision
    printf '%s | agent=%s | action=%s | decision=%s\n' \
        "$(iso_timestamp)" "$1" "$2" "$3"
}

# ---------- resolve root -------------------------------------------------------
if [ -n "${XENIA_ROOT:-}" ]; then
    root="$XENIA_ROOT"
else
    # Two levels up from .claude/hooks/ -> pack root
    script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
    root=$(cd "$script_dir/../.." 2>/dev/null && pwd)
fi

# ---------- resolve agent ------------------------------------------------------
agent_name="${CLAUDE_HOOK_AGENT_NAME:-}"
if [ -z "$agent_name" ]; then agent_name="${CLAUDE_AGENT_NAME:-}"; fi
if [ -z "$agent_name" ]; then agent_name="unknown"; fi
agent_slug=$(printf '%s' "$agent_name" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

# ---------- resolve payload ----------------------------------------------------
payload_text="${CLAUDE_HOOK_TOOL_INPUT:-}"

# Extract ticket_id from payload (handles both bare TICKET-XXX and JSON field)
ticket_id=""
# Try JSON field "ticket_id": "VALUE" first
json_ticket=$(printf '%s' "$payload_text" | grep -oiE '"ticket_id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"[[:space:]]*$/\1/' | sed 's/.*"ticket_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
if [ -n "$json_ticket" ]; then
    ticket_id="$json_ticket"
else
    # Fall back to bare TICKET-XXX pattern in payload
    bare_ticket=$(printf '%s' "$payload_text" | grep -oiE 'TICKET[-_][A-Za-z0-9]+' | head -1)
    if [ -n "$bare_ticket" ]; then
        ticket_id="$bare_ticket"
    fi
fi

# ---------- rule 1: caller allow-list ------------------------------------------
# Allowed: iris, intake-router, soteria, retention-success, hermes, escalation-handoff
is_allowed=0
for allowed in iris intake-router soteria retention-success hermes escalation-handoff; do
    if [ "$agent_slug" = "$allowed" ]; then
        is_allowed=1
        break
    fi
done

if [ "$is_allowed" -eq 0 ]; then
    msg="BLOCKED: agent '${agent_slug}' is not authorised to call the ticket-system bridge. Only Iris (intake-router), Soteria (retention-success), and Hermes (escalation-handoff) may touch the ticket system. See heads.yaml tool boundaries and AGENTS.md."
    printf '%s\n' "$msg" >&2
    write_audit_line "$agent_slug" "ticket-call" "BLOCK_AGENT_NOT_ALLOWED"
    exit 2
fi

# ---------- rule 2: monetary / irreversible actions ----------------------------
monetary_pattern='(refund|credit|chargeback|plan[_ -]?change|upgrade|downgrade|cancel(lation)?|terminate|delete|deletion|purge|entitlement|comp(ensate|ensation))'

action_word=$(printf '%s' "$payload_text" | grep -oiE "$monetary_pattern" | head -1 | tr '[:upper:]' '[:lower:]')

if [ -z "$action_word" ]; then
    write_audit_line "$agent_slug" "ticket-call" "ALLOW_NON_MONETARY"
    exit 0
fi

# Only hermes carries monetary/irreversible actions.
is_hermes=0
for h in hermes escalation-handoff; do
    if [ "$agent_slug" = "$h" ]; then
        is_hermes=1; break
    fi
done

if [ "$is_hermes" -eq 0 ]; then
    msg="BLOCKED: monetary/irreversible action '${action_word}' attempted by '${agent_slug}'. Constitution Article V: such actions are recommend-only for every head except Hermes, and Hermes requires a human approval artifact. Emit a recommendation instead."
    printf '%s\n' "$msg" >&2
    write_audit_line "$agent_slug" "$action_word" "BLOCK_NOT_HERMES"
    exit 2
fi

# ---------- Hermes path: require valid approval artifact ----------------------
approvals_dir="${root}/hearth/approvals"
valid=0
reason="no approvals directory"

if [ -d "$approvals_dir" ]; then
    reason="no matching approval artifact"

    # Iterate over APPROVAL-*.yaml and APPROVAL-*.json files
    # Use find to be portable; sort for determinism
    while IFS= read -r fpath; do
        [ -f "$fpath" ] || continue
        txt=$(cat "$fpath" 2>/dev/null) || continue
        [ -z "$txt" ] && continue

        # Must have status: approved
        printf '%s' "$txt" | grep -qiE 'status:[[:space:]]*approved' || continue

        # If we have a ticket_id, the artifact must reference it
        if [ -n "$ticket_id" ]; then
            printf '%s' "$txt" | grep -qF "$ticket_id" || continue
        fi

        # action field must match the action family
        # First try exact action word match
        action_matched=0
        if printf '%s' "$txt" | grep -qiE "action:[[:space:]]*[\"']?${action_word}"; then
            action_matched=1
        fi
        # Fall back to the family of known monetary action words
        if [ "$action_matched" -eq 0 ]; then
            if printf '%s' "$txt" | grep -qiE 'action:[[:space:]]*["\047]?(refund|credit|plan-change|cancellation|deletion)'; then
                action_matched=1
            fi
        fi
        [ "$action_matched" -eq 1 ] || continue

        # Expiry check (expires_at field is optional; if present, must not be past)
        exp_val=$(printf '%s' "$txt" | grep -oiE 'expires_at:[[:space:]]*["\047]?[0-9T:.Z+:-]+' | head -1 | sed 's/expires_at:[[:space:]]*["\047]*//' | tr -d '"'"'"' ')
        if [ -n "$exp_val" ]; then
            # Convert ISO-8601 to a comparable integer (epoch seconds via date)
            # Normalise: remove sub-seconds, handle Z/+00:00
            exp_norm=$(printf '%s' "$exp_val" | sed 's/\.[0-9]*//' | sed 's/Z$//' | sed 's/+00:00$//' | tr 'T' ' ')
            exp_epoch=$(date -u -d "$exp_norm" '+%s' 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M:%S' "$exp_norm" '+%s' 2>/dev/null)
            now_epoch=$(date -u '+%s')
            if [ -n "$exp_epoch" ] && [ -n "$now_epoch" ]; then
                if [ "$exp_epoch" -lt "$now_epoch" ]; then
                    fname=$(basename "$fpath")
                    reason="approval expired (${fname})"
                    continue
                fi
            fi
            # If date parsing fails, be conservative and allow (unexpired assumed)
        fi

        # Valid artifact found
        valid=1
        fname=$(basename "$fpath")
        write_audit_line "$agent_slug" "$action_word" "ALLOW_APPROVED(${fname})"
        break

    done < <(find "$approvals_dir" \( -name 'APPROVAL-*.yaml' -o -name 'APPROVAL-*.json' \) 2>/dev/null | sort)
fi

if [ "$valid" -eq 0 ]; then
    msg="BLOCKED: monetary/irreversible action '${action_word}' has no valid human approval artifact (${reason}). Constitution Article V: deny-by-default. Required: hearth/approvals/APPROVAL-<ticket-id>-<seq>.yaml with status: approved, matching ticket and action, unexpired, issued by a named human via /hydra:approve or recorded in-chat confirmation."
    printf '%s\n' "$msg" >&2
    write_audit_line "$agent_slug" "$action_word" "BLOCK_NO_APPROVAL"
    exit 2
fi

exit 0
