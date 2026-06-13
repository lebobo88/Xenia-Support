# Integration: ExecutiveSuite

How the support crown exchanges signal with the executive crown
([`ExecutiveSuite`](https://github.com/lebobo88/ExecutiveSuite)). The natural counterparts are the
**CXO** (customer experience), **CPO** (product), **CRO** (revenue), and
**COO** (operating cadence).

## Downward — executive decisions into the hearth

ExecutiveSuite emits `C_SUITE_DECISION_PACKET` envelopes; Hydra's planner
converts them into `HANDOFF`s for this squad. Field mapping into the
squad's working context:

| CSuiteDecisionPacket | Xenia consumption |
|---|---|
| `objective` (support policy change, SLA target, crisis directive) | Hestia updates `hearth/progress/.current-context.md`; SLA targets feed `support-kpi-monitoring` thresholds |
| retention-offer envelopes (approved offer classes, limits) | Soteria's `policy_basis` space — offers she may RECOMMEND; execution still requires per-ticket approval artifacts (Article V is not waived by class-level approval) |
| crisis-mode directives | P1 handling notes; approved incident-comms language for `policy-compliance-awareness` |
| `approvals_required` | maps to Hermes's HITL gates |

Class-level executive approval widens what may be *recommended*, never
what may be *executed* — the per-ticket approval artifact remains the
only execution authority.

## Upward — the hearth into the executive layer

Three flows, all Eunomia-cleared before leaving the squad:

1. **Executive escalations** (Hermes): angry-customer/regulatory
   escalations that warrant CXO attention (named accounts, press risk,
   regulator contact). Delivered as a brief via `es_output_write` when
   the ExecutiveSuite MCP is reachable; addressed to CXO, cc CRO when
   revenue-material.
2. **VoC briefs** (Echo via Soteria, `/voc-report`): addressed to
   CXO/CPO in exec-brief-compatible format (summary first, themes table,
   recommendations with evidence refs).
3. **Churn-risk summaries** (Soteria, periodic): segment-level
   aggregates to CRO/CXO — opaque refs only, never account-level PII.

## Transport

- Reachability probe: `es_ping`.
- Delivery: `es_output_write` (the ExecutiveSuite MCP output surface).
- In Hydra mode these may also ride DECISION_RECORD artifacts that the
  synthesizer routes; the direct MCP path covers standalone operation.

## Degraded mode (ExecutiveSuite absent)

The local file IS the deliverable: briefs land in
`hearth/output/voc/` and `hearth/output/escalations/` with an
`executive-routing: degraded-local` note in the body. Nothing queues,
nothing blocks; on reconnection, delivery is a manual or scripted copy of
the accumulated briefs.
