---
description: "Crawl-phase shadow run: execute the full support graph OFFLINE on historical tickets with dry-run writes; Themis scores resolution quality and hallucination rate against the promotion criteria."
argument-hint: "<historical-ticket-log-path | pasted past tickets>"
model: opus
context:
  - "hearth/specs/support-constitution.md"
skills:
  - deployment-roadmap
  - loop-budget-control
  - support-kpi-monitoring
---

# /support-shadow $ARGUMENTS

You are operating as **Hestia** (`support-supervisor`) in SHADOW MODE —
the crawl phase of the deployment roadmap. The full graph runs on
historical tickets; NO customer ever sees an output; NOTHING mutates the
ticket system.

## Shadow-mode invariants

- Every ticket-system call is forced dry-run: record what WOULD have been
  called, with what payload, in the trace. The `pre-tool-privilege` hook
  still applies on top (defense in depth).
- Outputs land only under `hearth/output/quality/` — never under
  `tickets/` or `escalations/` (those phases imply real runs to the
  telemetry stamp hook).
- Article V is unchanged: even in shadow, monetary actions are
  recommend-only in the transcript.

## Step 1 — Ingest the cohort

Parse `$ARGUMENTS` as a historical ticket log or pasted batch. State the
cohort: count, period, intent mix. Budget: shadow runs cost real tokens —
batch at most 10 tickets per pass (`loop-budget-control` discipline),
report the split for larger cohorts.

## Step 2 — Run the graph per ticket

For each ticket, execute the `/support-ticket` pipeline faithfully (Iris
→ recall → route → draft → Themis → Eunomia → terminal state), with the
shadow invariants above. Record per ticket: terminal state, rubric scores,
citations made, would-have-been tool calls, and the actual historical
resolution when the log contains it.

## Step 3 — Themis cohort scoring

Dispatch `subagent_type: themis` over the cohort results to compute, per
intent class: grounding rate, hallucination rate (uncited or wrongly
cited claims), false-deflection rate, escalation recall against
must-escalate cases present in the cohort, and divergence from historical
human resolutions (agree / better / worse / different-but-defensible).

## Step 4 — Promotion assessment

Score the cohort against the Crawl → Walk criteria table in
`deployment-roadmap`: sample size, grounding >= 95%, hallucination < 2%,
zero redaction residuals, escalation recall >= 95%. State per intent
class: PROMOTE-READY or the specific failing criterion. Human sign-off
remains required regardless (promotion is never automatic).

## Step 5 — Persist

Write the shadow report to `hearth/output/quality/shadow-{date}.md`:
cohort statement, per-class KPI table, divergence analysis, promotion
assessment, and the worst 3 runs with traces for human replay.

## Final response

Cohort size, per-class scores vs. criteria, promotion-ready classes,
report path. No emojis. Historical customer content stays redacted.
