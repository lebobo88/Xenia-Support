---
name: support-kpi-monitoring
description: "The KPI frame: containment, FCR, AHT, CSAT-proxy, escalation precision/recall, cost-per-resolution, SLA attainment — and the Agent-Manager dashboard contract over events.jsonl. Owned by Hestia; consumed by Themis, Soteria, Echo."
user-invocable: false
argument-hint: "<compute-kpis|trend-report>"
allowed-tools:
  - Read
  - Grep
---

# Support KPI Monitoring

What the hearth measures, it becomes. This skill defines the metric set,
the honest way to compute each from the squad's own telemetry, and the
anti-Goodhart rules that keep the numbers serving the covenant.

## Purpose

Give supervisors (human "Agent Managers" and Hestia alike) one shared KPI
vocabulary computed from `hearth/progress/events.jsonl` and the
DecisionRecords, with explicit guards against metric gaming.

## When to use

- Hestia at run close (SLA stamping) and in periodic review.
- Echo for VoC briefs and trend sections.
- Themis when a quality pattern (false deflection) needs quantifying.
- `/support-shadow` when scoring crawl-phase performance.

## The KPI set

| KPI | Definition | Source |
|---|---|---|
| **Containment** | runs ending RESOLVED without human handoff / all runs | terminal_state in DecisionRecords |
| **FCR** (first-contact resolution) | RESOLVED with no follow-up ticket on the same issue within 7 days | DecisionRecords + ticket links |
| **AHT proxy** | received_at → terminal-state timestamp | sla block |
| **SLA attainment** | P1 <60min first response; P2 <4h; P3 <1bd; P4 <2bd | sla block + events |
| **Escalation precision** | escalations a human judged warranted / all escalations | human feedback on packets |
| **Escalation recall** | warranted escalations caught / (caught + missed: bounced resolutions, complaint reopens) | reopen + complaint signals |
| **False-deflection rate** | Themis `no-false-deflection` 0-scores / judged artifacts | verdict artifacts |
| **Grounding rate** | drafts fully cited / drafts with factual claims | verdict artifacts |
| **Cost per resolution** | model + tool cost per terminal state, by tier | cost records (Hydra: governance.record_cost) |
| **KB gap velocity** | gaps filed vs. gaps closed per period | kb-gaps outputs |

## Anti-Goodhart rules

1. **Containment is bounded, not maximized.** Containment above target
   with rising false-deflection or complaint signals is a WORSE state
   than lower containment — the pair is read together, always.
2. **Escalation is a success path.** A correct escalation counts toward
   escalation precision, never against the resolving head.
3. **AHT pressure never edits the pipeline.** Themis and Eunomia gates
   are not "overhead to optimize"; a fast unjudged answer is a defect.
4. **CSAT-proxy honesty.** Without a real survey channel, sentiment
   trajectory at close is a proxy and is labeled as one.

## The Agent-Manager dashboard contract

Supervisors get, per period and per intent class: the KPI table, trend
vs. prior period, the worst 3 runs by rubric score (trace refs for
replay), open HITL items with age, and active KB gaps. Echo's VoC brief
covers the customer-voice half; this covers the operational half. Both
are computable offline from events.jsonl + outputs — no external
analytics dependency in degraded mode.

## Failure modes

- **Survivorship reporting**: KPIs computed only over RESOLVED runs.
- **Tier laundering**: cost per resolution hidden by silent model
  downgrades (`loop-budget-control` requires recorded downgrades).
- **Metric theater**: dashboards nobody acts on; every review names one
  change or explicitly states "no change warranted".
