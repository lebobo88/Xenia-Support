"""
dump_oracle.py — emit the canonical KPI snapshot from generate.py over the
parity fixture. The TS port (server/kpi.ts) MUST reproduce this exactly.

Usage:
    python tests/fixtures/dump_oracle.py > tests/fixtures/kpi-oracle.json

Pins `now` to 2026-06-05T00:00:00Z and period to 30d so the snapshot is
deterministic (open-HITL aging is computed by the UI from ts, not here).
"""

import datetime
import importlib.util
import json
import pathlib
import sys

WEB = pathlib.Path(__file__).resolve().parents[2]   # .../Xenia/web
XENIA = WEB.parent                                   # .../Xenia
FIXTURE = pathlib.Path(__file__).resolve().parent / "hearth"
GEN = XENIA / "tools" / "dashboard" / "generate.py"

spec = importlib.util.spec_from_file_location("generate", GEN)
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

NOW = datetime.datetime(2026, 6, 5, 0, 0, 0, tzinfo=datetime.timezone.utc)
SINCE = NOW - datetime.timedelta(days=30)

events = gen.load_events(FIXTURE / "progress" / "events.jsonl", SINCE)

drs = []
tickets_dir = FIXTURE / "output" / "tickets"
if tickets_dir.exists():
    for md in sorted(tickets_dir.glob("*.md")):
        dr = gen.parse_decision_record(md)
        if dr:
            dr["_file"] = md.name
            drs.append(dr)

k = gen.compute_kpis(events, drs, SINCE, NOW)


def num(x):
    """Round floats to 6 dp for stable cross-language comparison."""
    return round(x, 6) if isinstance(x, float) else x


# Project the scalar KPI surface the UI consumes (drop heavy nested objects
# that carry datetime internals; the UI computes HITL aging itself).
snapshot = {
    "total_runs": k["total_runs"],
    "containment_num": k["containment_num"],
    "containment_denom": k["containment_denom"],
    "containment_rate": num(k["containment_rate"]),
    "false_deflection_rate": num(k["false_deflection_rate"]),
    "false_deflection_checks": k["false_deflection_checks"],
    "grounding_rate": num(k["grounding_rate"]),
    "grounding_checks": k["grounding_checks"],
    "sla_attainment": num(k["sla_attainment"]),
    "sla_ok": k["sla_ok"],
    "sla_warn": k["sla_warn"],
    "sla_breach": k["sla_breach"],
    "sla_total": k["sla_total"],
    "sla_by_severity": k["sla_by_severity"],
    "aht_median_mins": num(k["aht_median_mins"]),
    "aht_mean_mins": num(k["aht_mean_mins"]),
    "aht_samples": k["aht_samples"],
    "fcr_rate": num(k["fcr_rate"]),
    "fcr_eligible": k["fcr_eligible"],
    "fcr_pass": k["fcr_pass"],
    "escalation_precision": num(k["escalation_precision"]),
    "escalation_recall": k["escalation_recall"],
    "total_escalations": k["total_escalations"],
    "warranted_esc": k["warranted_esc"],
    "cost_per_resolution": num(k["cost_per_resolution"]),
    "cost_coverage_pct": num(k["cost_coverage_pct"]),
    "cost_coverage_n": k["cost_coverage_n"],
    "cost_coverage_denom": k["cost_coverage_denom"],
    "cost_by_tier": {t: [num(c) for c in v] for t, v in k["cost_by_tier"].items()},
    "tier_laundering_flags": [
        {"agent": f["agent"], "expected_tier": f["expected_tier"], "actual_tier": f["actual_tier"]}
        for f in k["tier_laundering_flags"]
    ],
    "kb_gap_filed": k["kb_gap_filed"],
    "kb_gap_closed": k["kb_gap_closed"],
    "worst_3": [
        {"ticket_id": w["ticket_id"], "terminal_state": w["terminal_state"], "score": num(w["score"])}
        for w in k["worst_3"]
    ],
    "open_hitl_ticket_ids": sorted(h["ticket_id"] for h in k["open_hitl"]),
    "intent_stats": {
        intent: {
            "total": s["total"],
            "resolved": s["resolved"],
            "escalated": s["escalated"],
            "sla_ok": s["sla_ok"],
            "sla_breach": s["sla_breach"],
            "cost_samples": [num(c) for c in s["cost_samples"]],
        }
        for intent, s in k["intent_stats"].items()
    },
}

json.dump(snapshot, sys.stdout, indent=2, sort_keys=True, default=str)
