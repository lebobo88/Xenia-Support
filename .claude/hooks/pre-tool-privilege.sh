#!/usr/bin/env bash
# =============================================================================
# pre-tool-privilege.sh - PreToolUse hook for Xenia (least-privilege + Article V)
#
# MIRRORS: .claude/hooks/pre-tool-privilege.ps1  (bash equivalent)
# PLATFORM: POSIX/Linux/macOS.  Wired in hooks.json as 'bash .claude/hooks/...'.
#
# CONTRACT — identical logic to the .ps1:
#   1. Caller allow-list: iris, intake-router, soteria, retention-success,
#      hermes, escalation-handoff only.
#   2. Monetary/irreversible actions require a valid unexpired approval
#      artifact under hearth/approvals/ (Article V deny-by-default).
#      Only hermes/escalation-handoff may carry monetary actions.
#
#   WS-AUTH Phase 2: Trusted caller-capability mint + inject
#   ---------------------------------------------------------
#   For the exact Xenia ticket tools (send_response, execute_approved):
#     a) Identity from CLAUDE_HOOK_AGENT_NAME ONLY. No CLAUDE_AGENT_NAME fallback.
#     b) ticket_id from TOP-LEVEL JSON "ticket_id" field ONLY. No regex fallback.
#     c) mint_for_tool.py called EXACTLY ONCE via temp files.
#        Non-zero exit or empty stdout -> BLOCK (exit 2).
#     d) Token parsed as JSON object (python3 dict assertion).
#        capability_token OVERWRITTEN with the trusted object.
#     e) STDOUT = EXACTLY ONE JSON object (permissionDecision + updatedInput).
#        ALL log/audit -> STDERR.
#     f) Payload JSON parse failure -> BLOCK (exit 2).
#     g) Tool not in exact Xenia allow-list -> non-capability path (no mint).
#
#   Fix A: tool matching uses an EXACT allow-list of canonical xenia-tickets
#     tool names (dot + mcp__ gateway + underscore forms).
#     A foreign tool ending in send_response is NOT matched.
#
#   Fix 8: ALL log/audit lines use ONLY fixed codes.  No agent slug, no action
#     word, no ticket_id, no filename, no reason, no payload content anywhere.
#     audit() emits timestamp + decision code ONLY.
#
#   Fix B: `set -e` removed.  Every failure path checks return codes explicitly
#     and routes to `exit 2` via cleanup().  A `trap cleanup EXIT` ensures temp
#     files are always removed.  No path may exit 1 and bypass block semantics.
#
#   Fix C: identical to .ps1:
#     - agent normalization: lowercase + strip whitespace
#     - same allow-list, same monetary agent check
#     - same exact tool allow-list (Fix A)
#     - same exit codes per branch
#     - audit() emits fixed codes only (no raw values)
#
#   Environment variables:
#     CLAUDE_HOOK_AGENT_NAME  - calling agent (TRUSTED, set by framework)
#     CLAUDE_HOOK_TOOL_INPUT  - JSON tool payload
#     CLAUDE_HOOK_TOOL_NAME   - MCP tool name
#     XENIA_ROOT, HYDRA_ROOT, HYDRA_OPERATOR_KEY
#
#   Exit codes: 0=allow  2=block
#   No path exits 1.
#   Idempotent: yes
# =============================================================================

# Fix B: NO set -e.  Return codes checked explicitly throughout.
# set -u and set -o pipefail are kept for unbound-variable and pipeline safety;
# they do NOT cause unexpected exit-1 because every command that could fail is
# guarded with `|| true` or an explicit check.
set -uo pipefail

# ---------------------------------------------------------------------------
# Temp-file registry + cleanup trap
#
# Fix 1: mktemp_tracked was called via $() command substitution, which runs
# in a subshell — the _tmp_files+=() inside the function never reached the
# parent array, so token temp files persisted after exit.
#
# Pattern used here: call mktemp DIRECTLY in the parent shell and append to
# the array in the SAME shell, never inside $().  The helper below does NOT
# print a filename; it writes the path into a caller-supplied variable via
# nameref (bash 4.3+) so the array append happens in the parent.
# Usage:  mktemp_tracked varname
#   Sets $varname to the temp-file path AND appends to _tmp_files.
# ---------------------------------------------------------------------------
_tmp_files=()

cleanup() {
    local f
    for f in "${_tmp_files[@]:-}"; do
        [ -n "$f" ] && rm -f "$f" 2>/dev/null
    done
}
trap cleanup EXIT

# mktemp_tracked VARNAME
# Creates a temp file, stores the path in VARNAME, and records it for cleanup.
# Must be called in the parent shell (not inside $()).
mktemp_tracked() {
    local -n _mtt_ref="$1"   # nameref to caller's variable
    _mtt_ref=$(mktemp 2>/dev/null) || {
        printf 'WS-AUTH-HOOK: MKTEMP_FAILED\n' >&2
        exit 2
    }
    _tmp_files+=("$_mtt_ref")
}

# ---------------------------------------------------------------------------
# Logging helpers — Fix 8: fixed codes ONLY, no raw values anywhere.
# All output -> STDERR.  STDOUT reserved for single JSON response.
# audit() signature: audit DECISION_CODE
# ---------------------------------------------------------------------------
iso_ts() { date -u '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'UNKNOWN'; }

audit() { printf '%s | decision=%s\n' "$(iso_ts)" "$1" >&2; }
log()   { printf 'WS-AUTH-HOOK: %s\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# Resolve roots
# ---------------------------------------------------------------------------
if [ -n "${XENIA_ROOT:-}" ]; then
    root="$XENIA_ROOT"
else
    script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || script_dir=""
    root=$(cd "${script_dir}/../.." 2>/dev/null && pwd) || root=""
fi

if [ -n "${HYDRA_ROOT:-}" ]; then
    hydra_root="$HYDRA_ROOT"
else
    hydra_root=$(cd "${root}/../Hydra" 2>/dev/null && pwd) || hydra_root=""
fi

# ---------------------------------------------------------------------------
# Resolve agent — CLAUDE_HOOK_AGENT_NAME ONLY, no fallback.
# Fix C: lowercase + strip spaces (matches ps1 ToLower().Trim()).
# ---------------------------------------------------------------------------
agent_slug=""
if [ -n "${CLAUDE_HOOK_AGENT_NAME:-}" ]; then
    agent_slug=$(printf '%s' "$CLAUDE_HOOK_AGENT_NAME" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
fi

# ---------------------------------------------------------------------------
# Tool name (lowercased for comparison)
#
# Fix 1: use bash parameter expansion ${var,,} — NO pipe, NO subshell,
# cannot SIGPIPE or produce an empty result on a pipeline error.
# If the raw name is non-empty but lowercasing were somehow indeterminate
# (it can't be with ,, but we guard anyway): fail closed by treating any
# non-empty raw name that doesn't match the allow-list as an unknown tool,
# not as a non-capability tool.  The case statement below does this: an
# unmatched tool sets is_capability_tool=0 but we add an additional guard
# after the case to detect raw names that LOOK like capability tools even
# when lowercasing yields something unexpected.
# ---------------------------------------------------------------------------
tool_name_raw="${CLAUDE_HOOK_TOOL_NAME:-}"
tool_name_lc="${tool_name_raw,,}"

# ---------------------------------------------------------------------------
# Fix A: exact allow-list for capability tools.
#
# Only canonical xenia-tickets server forms are accepted.
# Foreign tools ending in send_response / execute_approved do NOT match.
#
# Accepted forms (lowercased):
#   xenia-tickets.send_response          (Claude Code native)
#   xenia-tickets.execute_approved
#   mcp__xenia-tickets__send_response    (Hydra gateway)
#   mcp__xenia-tickets__execute_approved
#   xenia_tickets.send_response          (underscore variant)
#   xenia_tickets.execute_approved
#   mcp__xenia_tickets__send_response
#   mcp__xenia_tickets__execute_approved
# ---------------------------------------------------------------------------
is_capability_tool=0
mint_tool_name=""

case "$tool_name_lc" in
    "xenia-tickets.send_response" \
    | "mcp__xenia-tickets__send_response" \
    | "xenia_tickets.send_response" \
    | "mcp__xenia_tickets__send_response")
        is_capability_tool=1
        mint_tool_name="xenia-tickets.send_response"
        ;;
    "xenia-tickets.execute_approved" \
    | "mcp__xenia-tickets__execute_approved" \
    | "xenia_tickets.execute_approved" \
    | "mcp__xenia_tickets__execute_approved")
        is_capability_tool=1
        mint_tool_name="xenia-tickets.execute_approved"
        ;;
esac

# Fix 1 (tightened): fail-closed capability-keyword guard.
# ANY tool name that was NOT matched by the exact allow-list above but
# contains a capability action keyword (send_response / execute_approved)
# in any position is BLOCKED — regardless of what server segment it has.
# This prevents any foreign tool (some-other-server.send_response,
# mcp__evil__execute_approved, bare send_response, etc.) from silently
# falling through to the unprotected non-capability path.
# Genuinely unrelated tools (no capability keyword at all) pass through.
if [ "$is_capability_tool" -eq 0 ] && [ -n "$tool_name_raw" ]; then
    _raw_lc="${tool_name_raw,,}"
    case "$_raw_lc" in
        *send_response*|*execute_approved*)
            log 'CAPABILITY_TOOL_NOT_IN_ALLOWLIST'
            audit 'BLOCK_CAPABILITY_TOOL_NOT_IN_ALLOWLIST'
            exit 2
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# Parse tool input JSON — fail closed on parse error for capability tools.
# Fix B: python3 invocation checked with explicit return code.
# ---------------------------------------------------------------------------
payload_text="${CLAUDE_HOOK_TOOL_INPUT:-}"
payload_parse_ok=0

if [ -n "$payload_text" ]; then
    python3 -c "import json,sys; json.loads(sys.argv[1])" "$payload_text" 2>/dev/null
    _parse_rc=$?
    if [ "$_parse_rc" -eq 0 ]; then
        payload_parse_ok=1
    else
        if [ "$is_capability_tool" -eq 1 ]; then
            log 'PAYLOAD_PARSE_ERROR'
            audit 'BLOCK_PAYLOAD_PARSE_ERROR'
            exit 2
        fi
        log 'PAYLOAD_PARSE_WARN'
    fi
fi

# ---------------------------------------------------------------------------
# Extract ticket_id from TOP-LEVEL JSON field ONLY.
# Fix B: python3 output captured with explicit check.
# ---------------------------------------------------------------------------
ticket_id=""
if [ "$payload_parse_ok" -eq 1 ] && [ -n "$payload_text" ]; then
    _tid_out=$(python3 - "$payload_text" 2>/dev/null <<'PYEOF'
import json, sys
try:
    obj = json.loads(sys.argv[1])
    v = obj.get("ticket_id", "")
    if isinstance(v, str) and v.strip():
        print(v.strip())
except Exception:
    pass
PYEOF
    ) || _tid_out=""
    ticket_id="$_tid_out"
fi

# ---------------------------------------------------------------------------
# Monetary pattern detection (Rule 2).
# Fix 8: action_word used for approval matching ONLY — never logged.
# Fix 2: replaced `grep | head -1 | tr` pipeline with a fail-closed form.
#   Under set -o pipefail, head -1 closing the pipe causes grep SIGPIPE ->
#   exit 141 -> pipeline non-zero -> action_word="" -> is_monetary=0, which
#   would bypass Article V.  Fix: use python3 (no pipeline) to extract the
#   first match; on ANY error from python3, default is_monetary=1 (fail
#   closed: treat as monetary, require approval).
# ---------------------------------------------------------------------------
_monetary_detect_ok=0
action_word=$(python3 - "$payload_text" 2>/dev/null <<'PYEOF'
import re, sys
text = sys.argv[1] if len(sys.argv) > 1 else ''
pat = r'(?i)\b(refund|credit|chargeback|plan[_ -]?change|upgrade|downgrade|cancel(?:lation)?|terminate|delete|deletion|purge|entitlement|comp(?:ensate|ensation))\b'
m = re.search(pat, text)
if m:
    print(m.group(1).lower())
PYEOF
) && _monetary_detect_ok=1 || _monetary_detect_ok=0

is_monetary=0
if [ "$_monetary_detect_ok" -eq 0 ]; then
    # Fix 2: python3 failed (env issue) — fail CLOSED: treat as monetary so
    # Article V approval is required.  Never default to "not monetary" on error.
    is_monetary=1
    action_word=""
elif [ -n "$action_word" ]; then
    is_monetary=1
fi

# ---------------------------------------------------------------------------
# Rule 1: caller allow-list.
# Fix 8: no agent slug in any log/audit line.
# Fix C: same list as ps1.
# ---------------------------------------------------------------------------
is_allowed=0
for _a in iris intake-router soteria retention-success hermes escalation-handoff; do
    if [ "$agent_slug" = "$_a" ]; then is_allowed=1; break; fi
done

if [ "$is_allowed" -eq 0 ]; then
    log 'AGENT_NOT_ALLOWED'
    audit 'BLOCK_AGENT_NOT_ALLOWED'
    exit 2
fi

# ---------------------------------------------------------------------------
# Rule 2: monetary / irreversible actions.
# Fix 8: no action_word, no agent_slug, no filename, no reason in logs.
# Fix C: same hermes/escalation-handoff check as ps1.
# ---------------------------------------------------------------------------
if [ "$is_monetary" -eq 1 ]; then
    is_hermes=0
    for _h in hermes escalation-handoff; do
        [ "$agent_slug" = "$_h" ] && is_hermes=1 && break
    done

    if [ "$is_hermes" -eq 0 ]; then
        log 'MONETARY_NOT_HERMES'
        audit 'BLOCK_NOT_HERMES'
        exit 2
    fi

    approvals_dir="${root}/hearth/approvals"
    valid=0

    if [ -d "$approvals_dir" ]; then
        # Fix 1: mktemp_tracked called in parent scope (not inside $()).
        # Fix 2 (tightened): two-step find then sort — separate RC checks.
        # `find | sort` with pipefail captures only sort's exit; a find
        # failure (permissions error) propagates sort's 0 and silently
        # produces partial results.  Run find and sort as separate steps
        # so each failure is independently detected.
        mktemp_tracked tmp_find_raw
        mktemp_tracked tmp_find

        find "$approvals_dir" \( -name 'APPROVAL-*.yaml' -o -name 'APPROVAL-*.json' \) \
            > "$tmp_find_raw" 2>/dev/null
        _find_rc=$?
        if [ "$_find_rc" -ne 0 ]; then
            log 'APPROVAL_ENUM_ERROR'
            audit 'BLOCK_APPROVAL_ENUM_ERROR'
            exit 2
        fi

        sort "$tmp_find_raw" > "$tmp_find"
        _sort_rc=$?
        if [ "$_sort_rc" -ne 0 ]; then
            log 'APPROVAL_ENUM_ERROR'
            audit 'BLOCK_APPROVAL_ENUM_ERROR'
            exit 2
        fi

        while IFS= read -r fpath; do
            [ -f "$fpath" ] || continue
            txt=$(cat "$fpath" 2>/dev/null) || continue
            [ -z "$txt" ] && continue
            printf '%s' "$txt" | grep -qiE 'status:[[:space:]]*approved' 2>/dev/null || continue
            if [ -n "$ticket_id" ]; then
                printf '%s' "$txt" | grep -qF "$ticket_id" 2>/dev/null || continue
            fi
            _action_matched=0
            if [ -n "$action_word" ]; then
                printf '%s' "$txt" | grep -qiE "action:[[:space:]]*[\"']?${action_word}" 2>/dev/null && _action_matched=1
            fi
            if [ "$_action_matched" -eq 0 ]; then
                printf '%s' "$txt" | grep -qiE 'action:[[:space:]]*["\x27]?(refund|credit|plan-change|cancellation|deletion)' 2>/dev/null && _action_matched=1
            fi
            [ "$_action_matched" -eq 1 ] || continue
            # Fix 2: replace grep|head|sed pipeline with python3 (no SIGPIPE risk).
            # On expiry parse error, default EXPIRED=true (fail closed for expiry).
            _exp_ok=$(python3 - "$txt" 2>/dev/null <<'PYEOF'
import re, sys
from datetime import datetime, timezone
txt = sys.argv[1] if len(sys.argv) > 1 else ''
m = re.search(r'(?i)expires_at:\s*["\x27]?([0-9T:.Z+\-]+)', txt)
if not m:
    print('ok')   # no expiry field -> treat as valid
    sys.exit(0)
raw = m.group(1).rstrip('"\'')
for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ',
            '%Y-%m-%dT%H:%M:%S.%f+00:00', '%Y-%m-%dT%H:%M:%S+00:00',
            '%Y-%m-%dT%H:%M:%S'):
    try:
        dt = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        if dt < datetime.now(timezone.utc):
            print('expired')
        else:
            print('ok')
        sys.exit(0)
    except ValueError:
        pass
# Unparseable -> treat as expired (fail closed)
print('expired')
PYEOF
            ) || _exp_ok="expired"   # python3 itself failed -> fail closed = expired
            [ "$_exp_ok" = "expired" ] && continue
            valid=1
            audit 'ALLOW_APPROVED'
            break
        done < "$tmp_find"
    fi

    if [ "$valid" -eq 0 ]; then
        log 'NO_VALID_APPROVAL'
        audit 'BLOCK_NO_APPROVAL'
        exit 2
    fi
fi

# ---------------------------------------------------------------------------
# WS-AUTH Phase 2: mint + inject capability_token
# ---------------------------------------------------------------------------

if [ "$is_capability_tool" -eq 1 ]; then

    # Top-level ticket_id required.
    if [ -z "$ticket_id" ]; then
        log 'TICKET_ID_ABSENT'
        audit 'BLOCK_NO_TICKET_ID'
        exit 2
    fi

    # Locate mint_for_tool.py.
    mint_script=""
    if [ -n "$hydra_root" ] && [ -f "${hydra_root}/mcp_servers/xenia_tickets/mint_for_tool.py" ]; then
        mint_script="${hydra_root}/mcp_servers/xenia_tickets/mint_for_tool.py"
    fi
    if [ -z "$mint_script" ]; then
        log 'MINT_SCRIPT_MISSING'
        audit 'BLOCK_MINT_MISSING'
        exit 2
    fi

    # Mint EXACTLY ONCE. Temp files registered in parent scope (Fix 1).
    # Fix 8: mint stderr discarded — never relayed.
    mktemp_tracked tmp_out
    mktemp_tracked tmp_err
    token_json=""

    python3 "$mint_script" \
        --tool-name "$mint_tool_name" \
        --ticket-id "$ticket_id" \
        >"$tmp_out" 2>"$tmp_err"
    mint_rc=$?

    # Fix B: explicit return code check — never rely on set -e here.
    token_json=$(tr -d '\n\r' < "$tmp_out" 2>/dev/null) || token_json=""
    # Fix 8: mint stderr NOT relayed.

    if [ "$mint_rc" -ne 0 ] || [ -z "$token_json" ]; then
        log 'MINT_FAILED'
        audit 'BLOCK_MINT_FAILED'
        exit 2
    fi

    # Fix 3 (corrected): token delivered via STDIN pipe, script via -c.
    #
    # `printf | python3 - <<'PYEOF'` is BROKEN: the heredoc (<<) supplies
    # python3's stdin (the "-" means "read script from stdin"), so the pipe
    # is discarded and python3 never sees the token+payload envelope.
    #
    # Correct pattern: script goes in -c '...' (not secret), sensitive data
    # (token) arrives via the pipe -> sys.stdin.  The -c script string is
    # single-quoted to avoid shell interpolation; no secrets are in it.
    #
    # Envelope format: payload JSON on line 1, token JSON on line 2.
    # Both are compact single-line JSON (no embedded newlines).
    # Fix 1: mktemp_tracked called in parent scope.
    mktemp_tracked tmp_merged

    # shellcheck disable=SC2016  (single-quoted -c script, not expanded)
    printf '%s\n%s\n' "$payload_text" "$token_json" \
        | python3 -c '
import json, sys

lines = sys.stdin.read().split("\n", 1)
raw_payload = lines[0] if lines else "{}"
raw_token   = lines[1].rstrip("\n") if len(lines) > 1 else ""

try:
    payload = json.loads(raw_payload) if raw_payload.strip() else {}
    if not isinstance(payload, dict):
        payload = {}
except Exception:
    payload = {}

try:
    token_obj = json.loads(raw_token)
except Exception as exc:
    import sys as _sys
    print("WS-AUTH-PHASE2-ERROR: TOKEN_PARSE type=" + type(exc).__name__, file=_sys.stderr)
    sys.exit(1)

if not isinstance(token_obj, dict):
    print("WS-AUTH-PHASE2-ERROR: TOKEN_NOT_OBJECT", file=sys.stderr)
    sys.exit(1)

payload["capability_token"] = token_obj
print(json.dumps(payload))
' >"$tmp_merged" 2>/dev/null
    merge_rc=$?

    updated_input=$(cat "$tmp_merged" 2>/dev/null) || updated_input=""

    # Fix B: explicit check — any failure -> exit 2.
    if [ "$merge_rc" -ne 0 ] || [ -z "$updated_input" ]; then
        log 'MERGE_FAILED'
        audit 'BLOCK_MERGE_FAILED'
        exit 2
    fi

    # Build and emit the final JSON response.
    # Fix 3: updated_input (contains the token) delivered via STDIN pipe,
    # script via -c (not secret).  Same pipe-not-heredoc pattern.
    _response_out=$(printf '%s\n' "$updated_input" \
        | python3 -c '
import json, sys
raw = sys.stdin.read().rstrip("\n")
try:
    ui = json.loads(raw)
    print(json.dumps({"permissionDecision": "allow", "updatedInput": ui}, separators=(",",":")))
except Exception as exc:
    print("WS-AUTH-PHASE2-ERROR: RESPONSE_BUILD type=" + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
' 2>/dev/null)
    _response_rc=$?

    if [ "$_response_rc" -ne 0 ] || [ -z "$_response_out" ]; then
        log 'RESPONSE_BUILD_FAILED'
        audit 'BLOCK_RESPONSE_BUILD_FAILED'
        exit 2
    fi

    audit 'ALLOW_CAP_INJECTED'

    # STDOUT = EXACTLY ONE JSON object, nothing else.
    printf '%s\n' "$_response_out"
    exit 0
fi

# ---------------------------------------------------------------------------
# Non-capability tools: plain allow (no stdout JSON).
# ---------------------------------------------------------------------------

if [ "$is_monetary" -eq 1 ]; then
    audit 'ALLOW_MONETARY_APPROVED'
else
    audit 'ALLOW_NON_MONETARY'
fi
exit 0
