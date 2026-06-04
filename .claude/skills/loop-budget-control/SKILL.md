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

## Mechanical enforcement (Layer 3)

The ceilings above are enforced at three independent layers:

| Layer | Mechanism |
|---|---|
| 1 | Constitution (Article VIII) — normative rule, always in effect |
| 2 | Stop-hook — post-response signal that halts the current turn |
| 3 | Pre-dispatch runtime counter (this section) |

**Layer 3 details — `pre-dispatch-budget.ps1`.**
A `PreToolUse` hook (matcher `Task|Agent`) fires before every subagent dispatch.
It maintains a per-run counter in `hearth/progress/.budget-<run_id>.json`
(schema: `run_id`, `command`, `ceiling`, `count`, `terminal`, `last_ts`).
The run ID is read from `CLAUDE_HOOK_RUN_ID`; when absent a per-UTC-day
fallback key is used.  The command context is read from `CLAUDE_HOOK_COMMAND`
and mapped to the ceiling table above; unknown commands default to 8.

On each dispatch the counter is incremented and persisted atomically
(temp-file swap).  When `count >= ceiling` the hook exits 2 and emits an
audit line and a stderr message citing "budget ceiling N reached — escalate,
do not spin (constitution Article VIII)".

**Absorbing-terminal-state rule.**  Once `terminal: true` is written into the
counter file (by Hestia or any orchestrator that reaches a terminal state), all
further dispatches for that run ID are blocked regardless of count.  A new
`run_id` starts a fresh counter with a fresh ceiling.

**Fail-open property.**  Every I/O or parse failure inside the hook is caught
by an outermost `try/catch`; the hook logs to stderr and exits 0 (allow).
A budget-counter outage never blocks support work — it only removes the
mechanical backstop, leaving the constitution (Layer 1) and Stop-hook
(Layer 2) in place.

**Concurrency & race safety.**  In the Claude Code single-supervisor dispatch
model the `PreToolUse` hook fires synchronously before each Task/Agent dispatch
within a single supervisor session.  Dispatches are therefore effectively
serial from the counter's perspective: no two increments race within the same
run.  The atomic temp-file swap (`WriteAllText` to `.budget-<id>.json.tmp`
then `Move-Item -Force`) guards against the narrow case of two independent
supervisor sessions sharing a `run_id` (e.g. the per-day fallback key).
If the swap races, the result is at worst a missed increment — a count that
reads slightly low — which is fail-open (it extends the run, not blocks it).
The strictly bad case — a legitimate dispatch blocked because of a bad count
— is prevented by three mechanisms: (1) the corrupt-JSON path sets `$state =
$null` and resets to `count=0` (fresh start, always allow); (2) the persist
failure path logs and continues (counter outage = allow); (3) the outermost
`try/catch` converts any unhandled internal error to exit 0.  A miscount that
*extends* a run beyond ceiling by one dispatch is acceptable; a miscount that
*blocks* a legitimate dispatch is not — the hook is biased accordingly.

## Failure modes

- **Budget laundering**: splitting one ticket into many runs to reset
  ceilings. The ticket_id binds the budget.
- **Ceiling-as-target**: 8 dispatches is a ceiling, not a plan; most runs
  should use 3-4.
- **Silent downgrade**: degrading to a cheaper model without recording it
  corrupts cost attribution.
