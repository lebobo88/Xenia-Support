# Xenia Agent-Manager Dashboard

`tools/dashboard/generate.py` — stdlib-only Python generator for the
supervisor operational surface defined by
`.claude/skills/support-kpi-monitoring/SKILL.md`.

## Usage

```
python tools/dashboard/generate.py [--root <XENIA>] [--period 30d] [--out <path>]
```

| Flag | Default | Description |
|---|---|---|
| `--root` | two levels up from this script | Xenia pack root |
| `--period` | `30d` | Reporting window (e.g. `7d`, `30d`, `90d`) |
| `--out` | `hearth/output/dashboard/dashboard-<date>.html` | Output HTML path |

Output lands under `hearth/output/dashboard/` by default. Writing there
will trip the `post-output-sla-stamp.ps1` hook (kind=`xenia.output_written`).
That is expected behaviour in a live harness.

## Inputs

| Path | Content |
|---|---|
| `hearth/progress/events.jsonl` | One JSON object per line; fields: `event_id ts kind agent phase ticket_id severity category customer_ref outcome path sla_state tokens cost_usd model_tier` |
| `hearth/output/tickets/*.md` | DecisionRecord YAML blocks (tolerant line-parser; no pyyaml) |

## KPI set (from SKILL.md)

| KPI | Definition | Data source |
|---|---|---|
| Containment | RESOLVED / all runs | terminal_state in DecisionRecords |
| False-deflection rate | Themis no-false-deflection 0-scores / judged | rubric_verdicts dims |
| FCR (proxy) | RESOLVED with no same-ticket re-escalation | DecisionRecord + escalation events |
| AHT proxy | received_at → first_response_at (median) | sla block |
| SLA attainment | ok events / all sla-tracked events | sla_state field |
| Escalation precision | warranted escalations / all escalations | escalation block |
| Escalation recall | N/A (bounced-resolution signal not yet instrumented) | — |
| Grounding rate | dims grounded-in-kb or citation-coverage ≥3 / all checks | rubric_verdicts dims |
| Cost per resolution | mean cost_usd of resolved events | cost_usd + model_tier fields |
| KB gap velocity | kb-gaps events filed vs closed per period | phase=kb-gaps events |

## Anti-Goodhart rules enforced in the UI

1. **Containment is never shown alone.** The false-deflection rate is
   displayed in a two-pane paired card alongside containment with an
   explicit note: high containment + rising false-deflection is a worse
   state than lower containment.
2. **Escalation is a success path.** Escalation precision is shown as a
   positive KPI; warranted escalations count in favour.
3. **AHT pressure** — AHT proxy is informational; no pipeline gates are
   modified to optimise it.
4. **CSAT-proxy honesty** — no real survey channel; proxy label used.
5. **Cost coverage always reported** — N% displayed alongside cost figure.
   A conspicuous "partial data" banner is shown when coverage < 80%.
   Null `cost_usd` is treated as "no data for this run", never zero.
6. **Tier laundering detectable** — cost breakdown is segmented by
   `model_tier`; events where actual tier differs from configured agent
   tier are flagged as potential cost-hiding events.

## No external dependencies

The script imports only Python stdlib modules:

```
json, html, datetime, pathlib, argparse, re, os, sys,
collections, statistics
```

## Honest-empty behaviour

If `events.jsonl` is absent or empty **and** no DecisionRecords are
found for the period, the generator emits a valid HTML file with a
"no data for period" notice and exits 0. It never crashes on missing
files and never fabricates KPI values.

## Running the verification

```powershell
# Against real data
python tools\dashboard\generate.py --root . --period 30d

# Against empty data (pass a non-existent events path via --root pointing to
# a temp dir, or simply rename events.jsonl temporarily)
python tools\dashboard\generate.py --root C:\tmp\empty-xenia --period 30d
```
