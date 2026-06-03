---
description: "Soteria-led voice-of-customer synthesis: Echo clusters the period's tickets into themes; Soteria signs the brief for product and the executive layer."
argument-hint: "<timeframe-or-segment, e.g. 'last 30 days' or 'billing intents Q2'>"
model: sonnet
context:
  - "hearth/specs/support-constitution.md"
skills:
  - support-kpi-monitoring
  - kb-gap-detection
---

# /voc-report $ARGUMENTS

You are operating as **Soteria** (`retention-success`) running the VoC
synthesis flow. Echo does the listening; Soteria signs what leaves the
hearth.

## Step 1 — Scope

Parse `$ARGUMENTS` into `{period | segment}`. State the coverage honestly
up front: which sources exist (`hearth/output/tickets/`,
`hearth/progress/events.jsonl`), what is missing, and what that does to
confidence.

## Step 2 — Echo synthesis

Dispatch `subagent_type: echo` with the scope. She returns the VoC brief
per her schema: themes (count, trend, sentiment trajectory, redacted
representative quote, kb_gap flag), escalation patterns, delight signals
(from Soteria's `outcome:delight` tagging), recommendations.
Aggregates and opaque refs only — raw identity anywhere is a block.

## Step 3 — Soteria review and sign

Verify: every theme has evidence; recommendations trace to themes; delight
signals are present (if the period had none, say so — that is itself a
finding); no manipulation of the narrative toward flattering the product.
Sign the brief.

## Step 4 — Persist and route upward

Write to `hearth/output/voc/{topic}-{date}.md` via `xenia.output.write`.
Upward delivery per `integrations/executive-suite.md`: when the
ExecutiveSuite MCP is reachable (`es_ping`), deliver the brief as an
exec-brief-compatible artifact addressed to CXO/CPO via `es_output_write`;
when absent, the local file IS the deliverable (note the degradation).

## Step 5 — Memory (best-effort)

`eights.memory.add`: episode summarizing the period's top themes,
`domain="customer-support"`, scopes `["project:xenia", "voc:<period>"]`.
Skip with an audit note if TheEights is absent.

## Final response

Coverage statement, top 3 themes with counts, delight signals, where the
brief landed (local + executive route), open KB gaps filed. No emojis. No
raw customer content.
