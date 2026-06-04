#!/bin/sh
# =============================================================================
# post-output-sla-stamp.sh - PostToolUse hook for Xenia (telemetry single-writer)
#
# MIRRORS: .claude/hooks/post-output-sla-stamp.ps1  (POSIX equivalent)
# PLATFORM NOTE: A deployment runs EITHER the .ps1 (Windows) OR the .sh set
#   (POSIX/Linux/macOS), never both.  The single-writer rule applies per
#   platform: whichever script is active for the deployment is the ONLY writer
#   of hearth/progress/events.jsonl.  Never run both simultaneously.
#
# CONTRACT
#   Triggered after any successful Write / xenia.output.write tool call that
#   targets hearth/output/**. Appends ONE event line to
#   hearth/progress/events.jsonl. This hook is the ONLY writer of
#   events.jsonl for this platform (single-writer rule; TheEights watcher
#   tails this file).
#
#   Environment variables consumed:
#     CLAUDE_HOOK_AGENT_NAME / CLAUDE_AGENT_NAME - calling agent slug
#     CLAUDE_HOOK_TOOL_INPUT                     - JSON write payload
#     XENIA_ROOT                                 - pack root (default: two
#                                                  levels above this script)
#     CLAUDE_HOOK_TOKENS_IN  - integer token count in  (optional)
#     CLAUDE_HOOK_TOKENS_OUT - integer token count out (optional)
#     CLAUDE_HOOK_COST_USD   - explicit cost override in USD (optional)
#     CLAUDE_HOOK_MODEL_TIER - opus | sonnet | haiku (optional)
#
#   Event schema (consumed by TheEights xenia-bridge; keep stable):
#     event_id   - monotonic-ish: x-<epoch_nanoseconds>-<4 random hex>
#     ts         - ISO-8601 UTC
#     kind       - xenia.ticket_created | xenia.ticket_resolved |
#                  xenia.escalated | xenia.voc_report | xenia.output_written
#     agent      - calling agent slug
#     phase      - tickets | escalations | voc | quality | kb-gaps | other
#     ticket_id  - parsed from path or body when present, else null
#     severity   - P1..P4 | unknown
#     category   - intent label | general
#     customer_ref - customer:<hash> | null
#     outcome    - delight | resolved | null
#     path       - pack-relative output path
#     sla_state  - ok | warn | breach | n/a
#     tokens     - {"in":<int>,"out":<int>} | null
#     cost_usd   - <number> | null
#     model_tier - opus | sonnet | haiku | null
#
#   Rate table (approx public list pricing per 1M tokens, USD):
#     opus:   $15.00 in / $75.00 out per 1M tokens
#     sonnet: $3.00  in / $15.00 out per 1M tokens
#     haiku:  $0.80  in / $4.00  out per 1M tokens
#
#   Exit codes: always 0 (non-blocking telemetry; failures degrade silently
#   to stderr so a telemetry outage can never block customer work).
#
#   Dependencies: sh, date, printf, od or /dev/urandom, mkdir, cat (POSIX).
#                 Uses awk for arithmetic (available everywhere).
# =============================================================================

# Always exit 0 — wrap everything so failures degrade silently
{

# ---------- resolve root -------------------------------------------------------
if [ -n "${XENIA_ROOT:-}" ]; then
    root="$XENIA_ROOT"
else
    script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
    root=$(cd "$script_dir/../.." 2>/dev/null && pwd)
fi

# ---------- resolve agent + payload --------------------------------------------
agent_name="${CLAUDE_HOOK_AGENT_NAME:-}"
if [ -z "$agent_name" ]; then agent_name="${CLAUDE_AGENT_NAME:-}"; fi
if [ -z "$agent_name" ]; then agent_name="unknown"; fi
agent_slug=$(printf '%s' "$agent_name" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

target_path=""
body=""
if [ -n "${CLAUDE_HOOK_TOOL_INPUT:-}" ]; then
    raw="$CLAUDE_HOOK_TOOL_INPUT"
    for field in file_path path; do
        val=$(printf '%s' "$raw" | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"[^"]*"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
        if [ -n "$val" ]; then target_path="$val"; break; fi
    done
    for field in content body new_string; do
        chk=$(printf '%s' "$raw" | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"" | head -1)
        if [ -n "$chk" ]; then
            body=$(printf '%s' "$raw" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\(.*\)\".*/\1/p" | head -1)
            body=$(printf '%s' "$body" | sed 's/\\n/\n/g; s/\\t/\t/g; s/\\"/"/g; s/\\\\/\\/g')
            break
        fi
    done
fi

norm_path=$(printf '%s' "$target_path" | tr '\\' '/')

# Only stamp writes under hearth/output/
printf '%s' "$norm_path" | grep -qiE 'hearth/output/' || { printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%S.000Z') | agent=${agent_slug} | event=skipped | kind=skip | stamped" ; exit 0; }

# ---------- derive fields ------------------------------------------------------
phase="other"
phase_match=$(printf '%s' "$norm_path" | grep -oiE 'hearth/output/(tickets|escalations|voc|quality|kb-gaps)/' | head -1 | sed 's|hearth/output/||' | tr '[:upper:]' '[:lower:]' | tr -d '/')
if [ -n "$phase_match" ]; then
    case "$phase_match" in
        tickets|escalations|voc|quality|kb-gaps) phase="$phase_match" ;;
    esac
fi

# ticket_id: prefer body field, fall back to path
ticket_id="null"
t=$(printf '%s' "$body" | grep -oiE 'ticket_id:[[:space:]]*[A-Za-z0-9_-]+' | head -1 | sed 's/ticket_id:[[:space:]]*//')
if [ -n "$t" ]; then
    ticket_id="\"$t\""
else
    t=$(printf '%s' "$norm_path" | grep -oiE '(TICKET[-_][A-Za-z0-9]+(-[0-9]{1,4})?|[A-Z]{2,5}-[0-9]{2,8})' | head -1)
    if [ -n "$t" ]; then ticket_id="\"$t\""; fi
fi

# kind
kind="xenia.output_written"
case "$phase" in
    escalations) kind="xenia.escalated" ;;
    voc)         kind="xenia.voc_report" ;;
    tickets)
        if printf '%s' "$body" | grep -qiE 'terminal_state:[[:space:]]*RESOLVED'; then
            kind="xenia.ticket_resolved"
        elif printf '%s' "$body" | grep -qiE 'terminal_state:[[:space:]]*ESCALATED_TO_HUMAN'; then
            kind="xenia.escalated"
        else
            kind="xenia.ticket_created"
        fi
        ;;
esac

# sla_state
sla_state="n/a"
sla_m=$(printf '%s' "$body" | grep -oiE 'sla[_-]?state:[[:space:]]*(ok|warn|breach)' | head -1 | grep -oiE '(ok|warn|breach)$' | tr '[:upper:]' '[:lower:]')
if [ -n "$sla_m" ]; then
    sla_state="$sla_m"
elif printf '%s' "$body" | grep -qiE 'breached:[[:space:]]*true'; then
    sla_state="breach"
fi

# severity
severity="unknown"
sev_m=$(printf '%s' "$body" | grep -oiE 'priority:[[:space:]]*(P[1-4])' | head -1 | grep -oiE 'P[1-4]$' | tr '[:lower:]' '[:upper:]')
if [ -n "$sev_m" ]; then severity="$sev_m"; fi

# category
category="general"
cat_m=$(printf '%s' "$body" | grep -oiE 'intent:[[:space:]]*[a-z-]+' | head -1 | sed 's/intent:[[:space:]]*//' | tr '[:upper:]' '[:lower:]')
if [ -n "$cat_m" ]; then category="$cat_m"; fi

# customer_ref (opaque hash only — Article IV)
customer_ref="null"
cref=$(printf '%s' "$body" | grep -oiE 'customer:[0-9a-f]{6,}' | head -1 | tr '[:upper:]' '[:lower:]')
if [ -n "$cref" ]; then customer_ref="\"$cref\""; fi

# outcome
outcome="null"
if printf '%s' "$body" | grep -qiE 'outcome:[[:space:]]*delight'; then
    outcome='"delight"'
elif printf '%s' "$body" | grep -qiE 'terminal_state:[[:space:]]*RESOLVED'; then
    outcome='"resolved"'
fi

# ---------- cost / token fields ------------------------------------------------
# Rate table per 1M tokens (USD): opus 15/75  sonnet 3/15  haiku 0.80/4
model_tier="null"
tier_raw="${CLAUDE_HOOK_MODEL_TIER:-}"
if [ -n "$tier_raw" ]; then
    tier_norm=$(printf '%s' "$tier_raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
    case "$tier_norm" in
        opus|sonnet|haiku) model_tier="\"$tier_norm\"";;
    esac
fi

tokens_field="null"
tokens_in_val=""
tokens_out_val=""
if [ -n "${CLAUDE_HOOK_TOKENS_IN:-}" ] && [ -n "${CLAUDE_HOOK_TOKENS_OUT:-}" ]; then
    # Validate integers
    ti=$(printf '%s' "$CLAUDE_HOOK_TOKENS_IN"  | grep -oE '^[0-9]+$')
    to=$(printf '%s' "$CLAUDE_HOOK_TOKENS_OUT" | grep -oE '^[0-9]+$')
    if [ -n "$ti" ] && [ -n "$to" ]; then
        tokens_in_val="$ti"
        tokens_out_val="$to"
        tokens_field="{\"in\":${ti},\"out\":${to}}"
    fi
fi

cost_usd="null"
if [ -n "${CLAUDE_HOOK_COST_USD:-}" ]; then
    # Accept decimal numbers; round to 9 decimal places via awk
    parsed=$(printf '%s' "$CLAUDE_HOOK_COST_USD" | grep -oE '^[0-9]+(\.[0-9]+)?$')
    if [ -n "$parsed" ]; then
        cost_usd=$(awk -v v="$parsed" 'BEGIN{printf "%.9f", v+0}')
        # Remove trailing zeros but keep at least one decimal place
        cost_usd=$(printf '%s' "$cost_usd" | sed 's/0*$//' | sed 's/\.$/.0/')
    fi
elif [ -n "$tokens_in_val" ] && [ -n "$tokens_out_val" ] && [ "$model_tier" != "null" ]; then
    # Derive from rate table
    tier_plain=$(printf '%s' "$model_tier" | tr -d '"')
    case "$tier_plain" in
        opus)   rate_in="15.0";  rate_out="75.0"  ;;
        sonnet) rate_in="3.0";   rate_out="15.0"  ;;
        haiku)  rate_in="0.80";  rate_out="4.0"   ;;
        *)      rate_in="";      rate_out=""       ;;
    esac
    if [ -n "$rate_in" ]; then
        cost_usd=$(awk -v ti="$tokens_in_val" -v to="$tokens_out_val" \
                       -v ri="$rate_in" -v ro="$rate_out" \
                   'BEGIN{printf "%.9f", (ti/1000000*ri) + (to/1000000*ro)}')
        cost_usd=$(printf '%s' "$cost_usd" | sed 's/0*$//' | sed 's/\.$/.0/')
    fi
fi

# ---------- monotonic-ish event_id --------------------------------------------
# date +%s%N gives epoch-nanoseconds on Linux; on macOS %N is literal.
# Fall back to epoch + random 6-hex if %N not available.
epoch_ns=$(date -u '+%s%N' 2>/dev/null)
if printf '%s' "$epoch_ns" | grep -qE 'N$'; then
    # macOS: %N not supported — use epoch seconds
    epoch_ns=$(date -u '+%s')
fi
# 4 random hex chars
rand_hex=$(od -An -N2 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | head -c 4)
if [ -z "$rand_hex" ]; then
    rand_hex=$(awk 'BEGIN{srand(); printf "%04x", int(rand()*65536)}')
fi
event_id="x-${epoch_ns}-${rand_hex}"

ts=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ')

# ---------- build JSON event line (no jq — hand-rolled) ----------------------
# json_str: escape a plain string value for embedding in JSON
json_str() {
    # Escape backslash, double-quote, then common control chars
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g'
}

# Build the JSON object (fields in the same order as the .ps1)
line=$(printf '{"event_id":"%s","ts":"%s","kind":"%s","agent":"%s","phase":"%s","ticket_id":%s,"severity":"%s","category":"%s","customer_ref":%s,"outcome":%s,"path":"%s","sla_state":"%s","tokens":%s,"cost_usd":%s,"model_tier":%s}' \
    "$(json_str "$event_id")" \
    "$(json_str "$ts")" \
    "$(json_str "$kind")" \
    "$(json_str "$agent_slug")" \
    "$(json_str "$phase")" \
    "$ticket_id" \
    "$(json_str "$severity")" \
    "$(json_str "$category")" \
    "$customer_ref" \
    "$outcome" \
    "$(json_str "$norm_path")" \
    "$(json_str "$sla_state")" \
    "$tokens_field" \
    "$cost_usd" \
    "$model_tier")

# ---------- append to events.jsonl (BOM-less UTF-8) ---------------------------
progress_dir="${root}/hearth/progress"
mkdir -p "$progress_dir" 2>/dev/null
events_file="${progress_dir}/events.jsonl"

# printf ensures no BOM; >> is atomic for short lines on POSIX filesystems
printf '%s\n' "$line" >> "$events_file"

printf '%s | agent=%s | event=%s | kind=%s | stamped\n' \
    "$ts" "$agent_slug" "$event_id" "$kind"

} 2>/dev/null || printf 'post-output-sla-stamp WARNING (non-blocking): hook internal error\n' >&2

exit 0
