#!/bin/sh
# =============================================================================
# pre-response-redaction.sh - PreToolUse hook for Xenia (Layer 3 redaction)
#
# MIRRORS: .claude/hooks/pre-response-redaction.ps1  (POSIX equivalent)
# PLATFORM NOTE: A deployment runs EITHER the .ps1 (Windows) OR the .sh set
#   (POSIX/Linux/macOS), never both.  Select by configuring hooks.json for the
#   target harness platform.
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
#   Dependencies: sh, grep, sed, date (POSIX baseline — no jq required)
#   Idempotent: yes
# =============================================================================

# ---------- ISO timestamp (UTC) -----------------------------------------------
iso_timestamp() {
    date -u '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# ---------- audit line --------------------------------------------------------
write_audit_line() {
    # $1=agent $2=path $3=decision
    printf '%s | agent=%s | path=%s | decision=%s\n' \
        "$(iso_timestamp)" "$1" "$2" "$3"
}

# ---------- resolve calling agent ---------------------------------------------
agent_name="${CLAUDE_HOOK_AGENT_NAME:-}"
if [ -z "$agent_name" ]; then agent_name="${CLAUDE_AGENT_NAME:-}"; fi
if [ -z "$agent_name" ]; then agent_name="unknown"; fi
# lowercase + trim (POSIX tr)
agent_slug=$(printf '%s' "$agent_name" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

# ---------- parse payload from CLAUDE_HOOK_TOOL_INPUT (pure-shell, no jq) ----
target_path=""
body=""

if [ -n "${CLAUDE_HOOK_TOOL_INPUT:-}" ]; then
    raw="$CLAUDE_HOOK_TOOL_INPUT"

    # Extract file_path or path (first match wins)
    # Handles:  "file_path": "some/path"  or  "path": "some/path"
    for field in file_path path; do
        val=$(printf '%s' "$raw" | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"[^"]*"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
        if [ -n "$val" ]; then
            target_path="$val"
            break
        fi
    done

    # Extract content, body, or new_string (first match wins)
    for field in content body new_string; do
        # Use a broader extraction: capture value after the key, handle escaped quotes
        val=$(printf '%s' "$raw" | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"" | head -1)
        if [ -n "$val" ]; then
            # Extract the full string value for this field (up to the closing unescaped quote)
            # Use sed: find the key, then capture everything between the quotes
            body=$(printf '%s' "$raw" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\(.*\)\".*/\1/p" | head -1)
            # Unescape common JSON escapes
            body=$(printf '%s' "$body" | sed 's/\\n/\n/g; s/\\t/\t/g; s/\\"/"/g; s/\\\\/\\/g')
            break
        fi
    done
fi

# ---------- short-circuit: no body means nothing to scan ----------------------
if [ -z "$body" ]; then
    write_audit_line "$agent_slug" "$target_path" "ALLOW_NO_BODY"
    exit 0
fi

# Normalise path separators
norm_path=$(printf '%s' "$target_path" | tr '\\' '/')

# ---------- customer-facing check (tickets or escalations under hearth/output)
is_customer_facing=0
if printf '%s' "$norm_path" | grep -qiE 'hearth/output/(tickets|escalations)/'; then
    is_customer_facing=1
fi

# ---------- Eunomia clearance marker ------------------------------------------
has_clearance=0
if printf '%s' "$body" | grep -qiE 'eunomia-cleared|clearance:[[:space:]]*cleared|seal:[[:space:]]*cleared'; then
    has_clearance=1
fi

# ---------- PII scan (pure grep — no jq, no Python) ---------------------------
# Each pattern mirrors the PowerShell regex.  We scan the body via grep -E.
# Typed placeholders and opaque refs are excluded AFTER a match by a second check.

findings=""

# Helper: add a finding kind if the body matches the pattern
# and the match is NOT a typed placeholder or customer-opaque ref
add_finding_if_real() {
    kind="$1"
    pattern="$2"
    placeholder_ok="$3"   # optional grep -E pattern that, if matched, suppresses

    match=$(printf '%s' "$body" | grep -oiE "$pattern" | head -1)
    [ -z "$match" ] && return

    # Suppress typed placeholders  [EMAIL] [PHONE] etc.
    if printf '%s' "$match" | grep -qiE '^\[(EMAIL|PHONE|CARD|SSN|APIKEY)\]$'; then return; fi
    # Suppress opaque customer refs
    if printf '%s' "$match" | grep -qiE 'customer:[0-9a-f]{6,}'; then return; fi
    # Kind-specific: CARD — require 13-16 digits
    if [ "$kind" = "CARD" ]; then
        digits=$(printf '%s' "$match" | tr -cd '0-9')
        len=${#digits}
        if [ "$len" -lt 13 ] || [ "$len" -gt 16 ]; then return; fi
    fi

    # Real finding
    if [ -z "$findings" ]; then
        findings="$kind"
    else
        # Only add each kind once
        case "$findings" in
            *"$kind"*) ;;
            *) findings="${findings}_${kind}" ;;
        esac
    fi
}

add_finding_if_real "EMAIL"  '[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'
add_finding_if_real "SSN"    '\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b'
add_finding_if_real "CARD"   '\b([0-9][ -]*?){13,16}\b'
add_finding_if_real "PHONE"  '\b(\+?1[-. ]?)?\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}\b'
add_finding_if_real "APIKEY" '(sk-[a-zA-Z0-9]{20,}|api[_\-]?key[[:space:]]*[:=][[:space:]]*[^[:space:]]{16,}|bearer[[:space:]]+[a-zA-Z0-9._\-]{20,})'

# ---------- block on PII (if any findings and no clearance) -------------------
if [ -n "$findings" ] && [ "$has_clearance" -eq 0 ]; then
    msg="BLOCKED: outbound body contains unredacted PII ($(printf '%s' "$findings" | tr '_' ', ')) and carries no Eunomia clearance marker. Route the artifact through compliance-redaction (Eunomia) before writing. Constitution Article IV: redaction at every boundary; no single layer is ever trusted alone."
    printf '%s\n' "$msg" >&2
    write_audit_line "$agent_slug" "$target_path" "BLOCK_PII_${findings}"
    exit 2
fi

# ---------- AI-disclosure check on customer-facing bodies ---------------------
if [ "$is_customer_facing" -eq 1 ]; then
    if ! printf '%s' "$body" | grep -qiE '\[AI-assisted response\]|AI-assisted|automated assistant'; then
        msg="BLOCKED: customer-facing body under hearth/output/ lacks the AI-disclosure marker '[AI-assisted response]'. Constitution Article III: AI involvement is always disclosed."
        printf '%s\n' "$msg" >&2
        write_audit_line "$agent_slug" "$target_path" "BLOCK_NO_DISCLOSURE"
        exit 2
    fi
fi

write_audit_line "$agent_slug" "$target_path" "ALLOW"
exit 0
