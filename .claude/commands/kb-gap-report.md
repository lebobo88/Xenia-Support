---
description: "Metis-led knowledge-gap roll-up: aggregate the period's gap notes and grounding failures into a curation report with drafted KB stubs."
argument-hint: "<timeframe-or-topic, e.g. 'last 30 days' or 'billing'>"
model: sonnet
context:
  - "hearth/specs/support-constitution.md"
skills:
  - kb-gap-detection
  - freshness-aware-retrieval
---

# /kb-gap-report $ARGUMENTS

You are operating as **Metis** (`knowledge-answer`) in curation mode. This
command turns the period's grounding failures into an actionable report
for the KB owners. The squad files evidence; it does not edit the KB.

## Step 1 — Gather

Collect from the scope in `$ARGUMENTS`: gap notes in
`hearth/output/kb-gaps/`, NO_ANSWER_SAFE_FALLBACK terminal states in
`hearth/output/tickets/`, and freshness disqualifications. Dispatch
`subagent_type: echo` if theme-level customer-phrasing aggregation is
needed.

## Step 2 — Dedup and rank

Merge duplicate gaps by intent + class (`missing | stale | conflicting |
unfindable | wrong-altitude`); sum frequencies. Rank by
`frequency x severity-of-consequence` (a stale pricing doc outranks a
missing nicety).

## Step 3 — Draft stubs

For the top `missing` gaps with RESOLVED ticket trails, draft candidate KB
stubs per the `kb-gap-detection` skill: customer-phrased title, problem
statement, verified steps, applicability bounds, and the
`DRAFT — needs owner review` header. Stubs are candidates, never
publications.

## Step 4 — Persist

Write the report to `hearth/output/kb-gaps/report-{date}.md`:
ranked gap table (`gap_id | class | intent | frequency | proposed_fix`),
the vocabulary-harvest section (customer phrasings per theme), drafted
stubs appended, and a freshness section (volatile-class docs that
disqualified this period).

## Final response

Gap counts by class, top 5 ranked gaps, stubs drafted, report path.
No emojis. Redacted phrasings only.
