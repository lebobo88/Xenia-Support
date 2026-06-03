---
name: loop-budget-control
description: "Hard budgets, bounded loops, and the four terminal states. Step/dispatch/retry ceilings per command, graph-level termination conditions, and cost-tiering rules. Owned by Hestia."
user-invocable: false
argument-hint: "<check-budget|declare-terminal>"
allowed-tools:
  - Read
---

# Loop & Budget Control

Multi-agent systems fail expensively in two ways: they spin (critic and
generator calling each other forever) and they sprawl (premium models doing
haiku work). This skill bounds both.

## Purpose

Enforce hard ceilings on dispatches, retries, and judge cycles; guarantee
every run ends in exactly one terminal state; and keep cost tiering honest.

## When to use

- Hestia at every dispatch decision and at run close.
- Every command's orchestration loop.
- `/support-shadow` when scoring cost-per-resolution.

## The four terminal states (Article VIII)

| State | Meaning |
|---|---|
| `RESOLVED` | answer shipped through the full pipeline; customer need met |
| `ESCALATED_TO_HUMAN` | a trigger fired; context-rich packet crossed the boundary |
| `FOLLOW_UP_TICKET` | work continues async; customer informed of the path |
| `NO_ANSWER_SAFE_FALLBACK` | grounding failed; honest partial answer + human offer |

Every run ends in exactly one. "The conversation just stopped" is not a
state; a run that cannot reach one escalates.

## Hard ceilings

| Budget | Ceiling | On exhaustion |
|---|---|---|
| Subagent dispatches per `/support-ticket` run | 8 | `ESCALATED_TO_HUMAN` |
| Critique-informed retries per head (Reflexion) | 1 | head's draft goes to judge as-is |
| Themis re-judge cycles | 2 | `ESCALATED_TO_HUMAN` (trigger: low confidence) |
| Re-triage events per run | 2 | `ESCALATED_TO_HUMAN` |
| Batch size per `/triage-queue` pass | 25 | split into phases, report the split |

In Hydra mode these nest inside the workflow's `Constraints.budget_usd`
and the 30-envelope ceiling; the stricter bound wins. After billable
calls in orchestrated mode, costs flow to `governance.record_cost`.

## Loop prevention rules

1. **No mutual recursion.** A head never dispatches the head that
   dispatched it. All fan-out flows through Hestia.
2. **Judges never draft.** Themis blocks and critiques; she does not
   rewrite (a judge that edits becomes a generator in a loop).
3. **Terminal states are absorbing.** Nothing reopens a closed run; new
   information = new ticket linked to the old (`FOLLOW_UP_TICKET`).
4. **Stuck detection.** Same head, same artifact, no rubric-score
   improvement = stuck; escalate, do not iterate.

## Cost tiering

| Tier | Work |
|---|---|
| haiku | classification (Iris), VoC clustering (Echo), hook prompt-checks |
| sonnet | drafting heads (Metis, Asclepius, Harmonia, Soteria) |
| opus | gatekeepers only (Hestia, Hermes, Themis, Eunomia) |

Tier upgrades require a reason on the record; "it might be better" is not
a reason. Per-resolution cost is a KPI (`support-kpi-monitoring`).

## Failure modes

- **Budget laundering**: splitting one ticket into many runs to reset
  ceilings. The ticket_id binds the budget.
- **Ceiling-as-target**: 8 dispatches is a ceiling, not a plan; most runs
  should use 3-4.
- **Silent downgrade**: degrading to a cheaper model without recording it
  corrupts cost attribution.
