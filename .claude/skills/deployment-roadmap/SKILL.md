---
name: deployment-roadmap
description: "The crawl/walk/run rollout discipline: phase definitions, promotion criteria (containment, hallucination rate, redaction record), demotion triggers, and the shadow-mode contract. Owned by Hestia; drives /support-shadow."
user-invocable: false
argument-hint: "<assess-phase|check-promotion|check-demotion>"
allowed-tools:
  - Read
---

# Deployment Roadmap — Crawl, Walk, Run

Authority is earned in phases, with evidence. This skill defines the
three phases, the hard criteria for promotion between them, and the
triggers that demote — because trust that cannot be lost is not trust.

## Purpose

Operationalize the research doc's crawl→walk→run funnel into checkable
criteria, so "are we ready for the next phase?" is a measurement, not a
feeling.

## The phases

### Crawl — shadow mode (offline)

- The full graph runs on historical or copied tickets via
  `/support-shadow`. No customer ever sees an output; ticket-system
  writes are forced dry-run.
- Themis scores every shadow resolution; hallucination rate, grounding
  rate, and false-deflection rate are computed per intent class.
- HITL pattern: **shadow** (humans compare squad answers to what was
  actually done).

### Walk — assisted mode

- The squad drafts; humans review and send (**co-pilot** pattern) for
  external responses. Simple, low-risk intent classes may go AI-first
  with aggressive escalation thresholds.
- All monetary recommendations carry human execution (which Article V
  makes permanent anyway).
- Escalation thresholds set deliberately low; precision tuned upward
  from data.

### Run — AI-first with escalation

- The squad resolves low/medium-complexity intents end-to-end through
  the full pipeline; humans supervise via the Agent-Manager dashboard
  and own all escalations.
- Article V never relaxes: money and irreversibility stay
  human-approved in every phase, forever.

## Promotion criteria (ALL must hold, per intent class)

| Criterion | Crawl → Walk | Walk → Run |
|---|---|---|
| Shadow/live sample size | >= 50 tickets in class | >= 100 live-assisted tickets |
| Containment-quality pair | grounding rate >= 95% | containment at target AND false-deflection rate < 2% |
| Hallucination rate (Themis: uncited or wrong-cited claims) | < 2% | < 1% |
| Redaction record | zero hook-blocked PII residuals in final artifacts | zero, sustained |
| Escalation correctness | recall >= 95% on seeded must-escalate cases | precision >= 80% on live escalations |
| Human sign-off | named supervisor approves the promotion in writing | same, recorded as an approval artifact |

Promotion is per intent class, not global: billing may walk while
defect-diagnosis still crawls.

## Demotion triggers (any one, immediate, per class)

- A manipulation finding (Article II violation) shipped to a customer.
- PII residual found in a shipped artifact (Layer 1-3 all missed).
- False-deflection pattern: 3+ Themis zero-scores in a rolling 50.
- Complaint/reopen spike above 2x baseline on the class.
- A regulated-claim improvisation shipped.

Demotion is one phase down, with the gap analyzed before re-promotion.

## Failure modes

- **Promotion by enthusiasm**: "it has been fine for a week" is not a
  criterion; the table is.
- **Global promotion**: promoting all classes because the easy ones
  passed.
- **Demotion debt**: staying demoted without analyzing the gap — the
  point of demotion is the analysis, not the punishment.
