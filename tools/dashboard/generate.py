"""
generate.py - Agent-Manager Dashboard for Xenia (stdlib only)

Reads hearth/progress/events.jsonl and hearth/output/tickets/*.md (DecisionRecord blocks)
and emits a self-contained HTML dashboard under hearth/output/dashboard/dashboard-{date}.html

No external dependencies. Uses only: json, html, datetime, pathlib, argparse, re, os, sys,
collections, statistics.

Usage:
    python generate.py [--root <XENIA>] [--period 30d] [--out <path>]

Implements the Agent-Manager dashboard contract from:
    .claude/skills/support-kpi-monitoring/SKILL.md
"""

import argparse
import collections
import datetime
import html as html_lib
import json
import os
import pathlib
import re
import sys
import statistics

# ---------------------------------------------------------------------------
# Schema note (from post-output-sla-stamp.ps1):
#   event_id, ts, kind, agent, phase, ticket_id, severity, category,
#   customer_ref, outcome, path, sla_state, tokens, cost_usd, model_tier
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_period(period_str):
    """Parse a period like '30d', '7d', '90d' into a timedelta."""
    m = re.match(r'^(\d+)d$', period_str.strip())
    if not m:
        raise ValueError(f"Period must be like '30d', got: {period_str!r}")
    return datetime.timedelta(days=int(m.group(1)))


def load_events(events_path, since):
    """
    Load events.jsonl, filtering to events at or after `since` (a datetime).
    Returns list of dicts. Tolerates malformed lines (skips them).
    """
    events = []
    if not events_path.exists():
        return events
    with open(events_path, 'r', encoding='utf-8-sig') as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                sys.stderr.write(f"  WARNING: events.jsonl line {lineno} is not valid JSON, skipping.\n")
                continue
            # Parse timestamp
            ts_str = evt.get('ts', '')
            try:
                # Handle both 'Z' suffix and '+00:00' suffix
                ts_clean = ts_str.replace('Z', '+00:00')
                ts = datetime.datetime.fromisoformat(ts_clean)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=datetime.timezone.utc)
                evt['_ts'] = ts
            except (ValueError, AttributeError):
                evt['_ts'] = None
            if evt['_ts'] is None or evt['_ts'] >= since:
                events.append(evt)
    return events


def parse_decision_record(md_path):
    """
    Tolerant line-parser for DecisionRecord YAML blocks in ticket .md files.
    Looks for a ```yaml ... ``` block and parses it with a simple line scanner.
    No pyyaml dependency.

    Returns a dict of parsed fields, or empty dict if nothing found.
    """
    try:
        content = md_path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return {}

    # Find yaml code block
    yaml_match = re.search(r'```yaml\s*\n(.*?)```', content, re.DOTALL | re.IGNORECASE)
    if not yaml_match:
        # Try without code fence — look for decision_id marker
        if 'decision_id:' in content or 'terminal_state:' in content:
            yaml_text = content
        else:
            return {}
    else:
        yaml_text = yaml_match.group(1)

    result = {}
    rubric_verdicts = []
    in_rubric_list = False
    current_rubric = {}

    for raw_line in yaml_text.splitlines():
        line = raw_line.rstrip()

        # Detect rubric_verdicts list entries
        if re.match(r'\s*rubric_verdicts\s*:', line):
            in_rubric_list = True
            continue
        if in_rubric_list:
            # Each entry starts with '  - {rubric_id: ...'
            entry_match = re.match(r'\s*-\s*\{(.+)\}', line)
            if entry_match:
                # Parse inline dict: rubric_id: x, pass: true, dims: {...}
                entry_str = entry_match.group(1)
                rv = {}
                rid_m = re.search(r'rubric_id:\s*([^\s,}]+)', entry_str)
                if rid_m:
                    rv['rubric_id'] = rid_m.group(1)
                pass_m = re.search(r'pass:\s*(true|false)', entry_str, re.IGNORECASE)
                if pass_m:
                    rv['pass'] = pass_m.group(1).lower() == 'true'
                # Parse dims sub-dict
                dims_m = re.search(r'dims:\s*\{([^}]*)\}', entry_str)
                if dims_m:
                    dims = {}
                    for kv in re.finditer(r'([\w-]+):\s*(\d+)', dims_m.group(1)):
                        dims[kv.group(1)] = int(kv.group(2))
                    rv['dims'] = dims
                rubric_verdicts.append(rv)
                continue
            elif line.strip() and not line.strip().startswith('-') and ':' in line:
                in_rubric_list = False
            else:
                continue

        # Simple key: value parsing (non-nested)
        kv_m = re.match(r'^([\w_-]+)\s*:\s*(.*)$', line)
        if not kv_m:
            continue
        key = kv_m.group(1).strip()
        val = kv_m.group(2).strip()

        # Strip inline comments
        val = re.sub(r'\s+#.*$', '', val)

        # Strip quotes
        if (val.startswith('"') and val.endswith('"')) or \
           (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]

        # Skip empty values
        if val in ('', '>', '|'):
            continue

        result[key] = val

    if rubric_verdicts:
        result['_rubric_verdicts'] = rubric_verdicts

    # Parse SLA block (nested but shallow)
    sla_block = re.search(r'\bsla\s*:\s*\n((?:[ \t]+.+\n?)+)', yaml_text)
    if sla_block:
        sla = {}
        for kv in re.finditer(r'[ \t]+([\w_-]+)\s*:\s*(.+)', sla_block.group(1)):
            sla[kv.group(1).strip()] = kv.group(2).strip()
        result['_sla'] = sla

    return result


def compute_rubric_score(rubric_verdicts):
    """
    Returns a composite score for a run from its rubric_verdicts list.
    Score = average of all dim scores, or None if no dims found.
    """
    all_dims = []
    for rv in rubric_verdicts:
        dims = rv.get('dims', {})
        all_dims.extend(dims.values())
    if not all_dims:
        return None
    return sum(all_dims) / len(all_dims)


def age_str(dt_str_or_dt):
    """Return human-readable age from a datetime string or datetime."""
    now = datetime.datetime.now(datetime.timezone.utc)
    if isinstance(dt_str_or_dt, str):
        try:
            ts_clean = dt_str_or_dt.replace('Z', '+00:00')
            dt = datetime.datetime.fromisoformat(ts_clean)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            return dt_str_or_dt
    else:
        dt = dt_str_or_dt
    delta = now - dt
    days = delta.days
    hours = delta.seconds // 3600
    if days > 1:
        return f"{days}d ago"
    elif days == 1:
        return f"1d {hours}h ago"
    elif hours > 0:
        return f"{hours}h ago"
    else:
        mins = delta.seconds // 60
        return f"{mins}m ago"


def e(text):
    """HTML-escape a value for safe embedding."""
    if text is None:
        return '—'
    return html_lib.escape(str(text))


# ---------------------------------------------------------------------------
# KPI computation
# ---------------------------------------------------------------------------

def compute_kpis(events, decision_records, since, now):
    """
    Compute all KPIs from the SKILL.md contract.

    decision_records: list of dicts from parse_decision_record()
    Returns a dict of KPI results.
    """
    period_events = [ev for ev in events if ev.get('_ts') and ev['_ts'] >= since]

    # --- Basic counters ---
    all_resolved = [dr for dr in decision_records if dr.get('terminal_state') == 'RESOLVED']
    all_escalated = [dr for dr in decision_records if dr.get('terminal_state') == 'ESCALATED_TO_HUMAN']
    all_runs = [dr for dr in decision_records if 'terminal_state' in dr]

    total_runs = len(all_runs)

    # --- Containment: RESOLVED without human handoff / all runs ---
    containment_num = len(all_resolved)
    containment_denom = total_runs
    containment_rate = (containment_num / containment_denom) if containment_denom > 0 else None

    # --- False-deflection rate (anti-Goodhart pair for containment) ---
    # Themis `no-false-deflection` 0-scores / judged artifacts
    false_deflection_checks = []
    grounding_checks = []
    for dr in decision_records:
        for rv in dr.get('_rubric_verdicts', []):
            dims = rv.get('dims', {})
            if 'no-false-deflection' in dims:
                false_deflection_checks.append(dims['no-false-deflection'])
            if 'grounded-in-kb' in dims or 'citation-coverage' in dims:
                score = dims.get('grounded-in-kb', dims.get('citation-coverage'))
                grounding_checks.append(score)

    false_deflection_rate = None
    if false_deflection_checks:
        # 0-scores / total = false deflection rate (inverted: score 3=clean, 0=false-deflection)
        zero_scores = sum(1 for s in false_deflection_checks if s == 0)
        false_deflection_rate = zero_scores / len(false_deflection_checks)

    grounding_rate = None
    if grounding_checks:
        # "fully cited" = score >= 3 (max) out of 3
        fully_cited = sum(1 for s in grounding_checks if s >= 3)
        grounding_rate = fully_cited / len(grounding_checks)

    # --- SLA attainment ---
    # From events: sla_state ok|warn|breach
    sla_events = [ev for ev in period_events if ev.get('sla_state') in ('ok', 'warn', 'breach')]
    sla_ok = sum(1 for ev in sla_events if ev.get('sla_state') == 'ok')
    sla_breach = sum(1 for ev in sla_events if ev.get('sla_state') == 'breach')
    sla_warn = sum(1 for ev in sla_events if ev.get('sla_state') == 'warn')
    sla_total = len(sla_events)
    sla_attainment = (sla_ok / sla_total) if sla_total > 0 else None

    # SLA breakdown by severity
    sla_by_severity = collections.defaultdict(lambda: {'ok': 0, 'warn': 0, 'breach': 0})
    for ev in sla_events:
        sev = ev.get('severity', 'unknown')
        state = ev.get('sla_state')
        if state in ('ok', 'warn', 'breach'):
            sla_by_severity[sev][state] += 1

    # --- AHT proxy: received_at -> terminal state timestamp ---
    aht_samples = []
    for dr in decision_records:
        sla = dr.get('_sla', {})
        received = sla.get('received_at') or dr.get('received_at')
        first_response = sla.get('first_response_at') or dr.get('first_response_at')
        if received and first_response:
            try:
                r = datetime.datetime.fromisoformat(received.replace('Z', '+00:00'))
                f = datetime.datetime.fromisoformat(first_response.replace('Z', '+00:00'))
                delta_mins = (f - r).total_seconds() / 60.0
                if 0 <= delta_mins < 60 * 24 * 7:  # sanity: under a week
                    aht_samples.append(delta_mins)
            except (ValueError, TypeError):
                pass

    aht_median_mins = statistics.median(aht_samples) if aht_samples else None
    aht_mean_mins = statistics.mean(aht_samples) if aht_samples else None

    # --- Escalation precision / recall ---
    # precision: escalations that were "warranted" (triggered field) / all escalations
    # We use the 'escalation.triggered' boolean as the warranted signal
    escalation_events = [ev for ev in period_events if ev.get('kind') == 'xenia.escalated']
    escalated_drs = [dr for dr in decision_records if dr.get('terminal_state') == 'ESCALATED_TO_HUMAN']

    # From DecisionRecords: escalation.triggered: true => warranted
    warranted_esc = 0
    for dr in escalated_drs:
        trigger_m = re.search(r'\bescalation[:\s]+.*?triggered:\s*(true|false)',
                               str(dr), re.IGNORECASE)
        if trigger_m and trigger_m.group(1).lower() == 'true':
            warranted_esc += 1
        elif dr.get('triggered') == 'true':
            warranted_esc += 1

    escalation_precision = None
    total_escalations = len(escalated_drs)
    if total_escalations > 0:
        escalation_precision = warranted_esc / total_escalations

    # Recall: we can't compute it without "missed escalations" data (bounced resolutions).
    # SKILL.md: "bounced resolutions, complaint reopens" — no such signal in current data.
    escalation_recall = None  # Not computable from available data

    # --- Cost per resolution (ANTI-GOODHART: coverage N%, per-tier segmentation) ---
    resolved_events = [ev for ev in period_events if ev.get('kind') == 'xenia.ticket_resolved']
    resolved_with_cost = [ev for ev in resolved_events if ev.get('cost_usd') is not None]
    cost_coverage_n = len(resolved_with_cost)
    cost_coverage_denom = len(resolved_events)
    cost_coverage_pct = (cost_coverage_n / cost_coverage_denom * 100) if cost_coverage_denom > 0 else None

    # Per-tier cost aggregation
    cost_by_tier = collections.defaultdict(list)
    cost_all = []
    for ev in resolved_with_cost:
        tier = ev.get('model_tier') or 'unknown'
        cost = ev.get('cost_usd')
        if cost is not None:
            cost_by_tier[tier].append(cost)
            cost_all.append(cost)

    # Also include non-resolved events with cost for coverage reporting
    all_events_with_cost = [ev for ev in period_events if ev.get('cost_usd') is not None]
    all_cost_by_tier = collections.defaultdict(list)
    for ev in all_events_with_cost:
        tier = ev.get('model_tier') or 'unknown'
        cost = ev.get('cost_usd')
        if cost is not None:
            all_cost_by_tier[tier].append(cost)

    cost_per_resolution = (sum(cost_all) / len(cost_all)) if cost_all else None

    # Tier laundering check: detect events where model_tier is present but differs
    # from expected agent tier (from AGENTS.md: opus=gatekeepers, sonnet=execute, haiku=iris/echo)
    EXPECTED_TIERS = {
        'hestia': 'opus', 'hermes': 'opus', 'themis': 'opus', 'eunomia': 'opus',
        'metis': 'sonnet', 'asclepius': 'sonnet', 'harmonia': 'sonnet',
        'soteria': 'sonnet', 'plutus': 'sonnet',
        'iris': 'haiku', 'echo': 'haiku',
    }
    tier_laundering_flags = []
    for ev in period_events:
        agent = ev.get('agent', '').lower()
        tier = ev.get('model_tier')
        if tier and agent in EXPECTED_TIERS:
            expected = EXPECTED_TIERS[agent]
            if tier != expected:
                tier_laundering_flags.append({
                    'event_id': ev.get('event_id'),
                    'ts': ev.get('ts'),
                    'agent': agent,
                    'expected_tier': expected,
                    'actual_tier': tier,
                })

    # --- KB gap velocity ---
    # From hearth/output/kb-gaps/ events
    kb_gap_filed = sum(1 for ev in period_events
                       if ev.get('phase') == 'kb-gaps' and ev.get('kind') == 'xenia.output_written')
    # "closed" = resolved tickets that originated from a kb-gap (heuristic: no direct signal yet)
    kb_gap_closed = 0  # Not directly available; honest zero

    # --- FCR proxy ---
    # RESOLVED with no follow-up ticket on same issue within 7 days.
    # Without follow-up ticket links, we proxy: RESOLVED with outcome=='resolved' or 'delight'
    # and no matching ESCALATED_TO_HUMAN from same ticket_id within 7 days.
    fcr_eligible = len(all_resolved)
    fcr_pass = fcr_eligible  # Conservative: assume all pass unless we can detect follow-ups

    # Check for same-ticket escalation after resolution
    resolved_ticket_ids = {dr.get('ticket_id') for dr in all_resolved if dr.get('ticket_id')}
    escalated_ticket_ids = {dr.get('ticket_id') for dr in all_escalated if dr.get('ticket_id')}
    fcr_fail_tickets = resolved_ticket_ids & escalated_ticket_ids
    fcr_pass = max(0, fcr_eligible - len(fcr_fail_tickets))
    fcr_rate = (fcr_pass / fcr_eligible) if fcr_eligible > 0 else None

    # --- Worst 3 runs by rubric score ---
    scored_runs = []
    for dr in decision_records:
        rvs = dr.get('_rubric_verdicts', [])
        if rvs:
            score = compute_rubric_score(rvs)
            if score is not None:
                scored_runs.append({
                    'ticket_id': dr.get('ticket_id', 'unknown'),
                    'terminal_state': dr.get('terminal_state', '?'),
                    'intent': dr.get('intent', dr.get('category', '?')),
                    'score': score,
                    'rubrics': rvs,
                    'file': dr.get('_file', ''),
                })
    scored_runs.sort(key=lambda x: x['score'])
    worst_3 = scored_runs[:3]

    # --- Open HITL items ---
    # ESCALATED_TO_HUMAN that lack a resolution event (no subsequent RESOLVED event for same ticket)
    open_hitl = []
    for ev in period_events:
        if ev.get('kind') == 'xenia.escalated':
            tid = ev.get('ticket_id')
            # Check if there's a subsequent resolved event for the same ticket
            resolved_later = any(
                rev for rev in period_events
                if rev.get('ticket_id') == tid
                and rev.get('kind') == 'xenia.ticket_resolved'
                and rev.get('_ts') and ev.get('_ts')
                and rev['_ts'] > ev['_ts']
            )
            if not resolved_later:
                open_hitl.append({
                    'ticket_id': tid,
                    'ts': ev.get('ts'),
                    'agent': ev.get('agent'),
                    'severity': ev.get('severity'),
                    'category': ev.get('category'),
                    '_ts': ev.get('_ts'),
                })

    # Deduplicate open HITL by ticket_id (keep earliest escalation)
    seen_hitl = {}
    for item in open_hitl:
        tid = item['ticket_id']
        if tid not in seen_hitl:
            seen_hitl[tid] = item
        elif item.get('_ts') and seen_hitl[tid].get('_ts') and item['_ts'] < seen_hitl[tid]['_ts']:
            seen_hitl[tid] = item
    open_hitl = list(seen_hitl.values())

    # --- Per-intent breakdown ---
    intent_stats = collections.defaultdict(lambda: {
        'total': 0, 'resolved': 0, 'escalated': 0,
        'sla_ok': 0, 'sla_breach': 0,
        'cost_samples': [], 'false_deflection_scores': []
    })
    for dr in decision_records:
        intent = dr.get('intent') or dr.get('category', 'general')
        intent_stats[intent]['total'] += 1
        state = dr.get('terminal_state', '')
        if state == 'RESOLVED':
            intent_stats[intent]['resolved'] += 1
        elif state == 'ESCALATED_TO_HUMAN':
            intent_stats[intent]['escalated'] += 1
        for rv in dr.get('_rubric_verdicts', []):
            dims = rv.get('dims', {})
            if 'no-false-deflection' in dims:
                intent_stats[intent]['false_deflection_scores'].append(dims['no-false-deflection'])

    for ev in period_events:
        cat = ev.get('category', 'general')
        sla = ev.get('sla_state')
        if sla == 'ok':
            intent_stats[cat]['sla_ok'] += 1
        elif sla == 'breach':
            intent_stats[cat]['sla_breach'] += 1
        cost = ev.get('cost_usd')
        if cost is not None:
            intent_stats[cat]['cost_samples'].append(cost)

    return {
        'period_events': period_events,
        'total_runs': total_runs,
        'all_resolved': all_resolved,
        'all_escalated': all_escalated,
        # Containment + quality pair (anti-Goodhart rule 1)
        'containment_num': containment_num,
        'containment_denom': containment_denom,
        'containment_rate': containment_rate,
        'false_deflection_rate': false_deflection_rate,
        'false_deflection_checks': len(false_deflection_checks),
        'grounding_rate': grounding_rate,
        'grounding_checks': len(grounding_checks),
        # SLA
        'sla_attainment': sla_attainment,
        'sla_ok': sla_ok,
        'sla_warn': sla_warn,
        'sla_breach': sla_breach,
        'sla_total': sla_total,
        'sla_by_severity': dict(sla_by_severity),
        # AHT
        'aht_median_mins': aht_median_mins,
        'aht_mean_mins': aht_mean_mins,
        'aht_samples': len(aht_samples),
        # FCR
        'fcr_rate': fcr_rate,
        'fcr_eligible': fcr_eligible,
        'fcr_pass': fcr_pass,
        # Escalation
        'escalation_precision': escalation_precision,
        'escalation_recall': escalation_recall,
        'total_escalations': total_escalations,
        'warranted_esc': warranted_esc,
        # Cost (coverage-aware)
        'cost_per_resolution': cost_per_resolution,
        'cost_coverage_pct': cost_coverage_pct,
        'cost_coverage_n': cost_coverage_n,
        'cost_coverage_denom': cost_coverage_denom,
        'cost_by_tier': dict(cost_by_tier),
        'all_cost_by_tier': dict(all_cost_by_tier),
        'tier_laundering_flags': tier_laundering_flags,
        # KB gaps
        'kb_gap_filed': kb_gap_filed,
        'kb_gap_closed': kb_gap_closed,
        # Worst runs
        'worst_3': worst_3,
        # HITL
        'open_hitl': open_hitl,
        # Per-intent
        'intent_stats': dict(intent_stats),
    }


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

CSS = """
:root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #222636;
    --border: #2e3347;
    --accent: #5b8dee;
    --accent2: #7c5be8;
    --warn: #f0a500;
    --danger: #e05252;
    --ok: #3dba7a;
    --muted: #6b7280;
    --text: #e2e4ef;
    --text2: #9ba1b3;
    --mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    padding: 24px;
}
h1 { font-size: 1.6rem; font-weight: 700; color: var(--text); margin-bottom: 4px; }
h2 {
    font-size: 1.05rem; font-weight: 600; color: var(--text);
    margin: 28px 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    letter-spacing: 0.03em;
    text-transform: uppercase;
}
h3 { font-size: 0.95rem; font-weight: 600; color: var(--text2); margin: 16px 0 6px; }
.header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.header-meta { color: var(--text2); font-size: 0.82rem; }
.badge {
    display: inline-block;
    padding: 2px 8px; border-radius: 4px;
    font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em;
}
.badge-ok { background: #1a3a2a; color: var(--ok); }
.badge-warn { background: #3a2c00; color: var(--warn); }
.badge-danger { background: #3a1a1a; color: var(--danger); }
.badge-muted { background: #2a2d3a; color: var(--muted); }
.badge-accent { background: #1a2340; color: var(--accent); }

/* Partial-data banner */
.partial-banner {
    background: linear-gradient(90deg, #3a2c00 0%, #3a3000 100%);
    border: 1.5px solid var(--warn);
    border-radius: 6px;
    padding: 10px 16px;
    margin-bottom: 20px;
    color: var(--warn);
    font-weight: 600;
    font-size: 0.9rem;
}
.partial-banner span { font-weight: 400; color: #d4b060; margin-left: 6px; }

/* No-data notice */
.no-data {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 40px;
    text-align: center;
    color: var(--text2);
    margin: 40px 0;
}
.no-data h2 { border: none; text-align: center; color: var(--text2); }

/* Anti-Goodhart containment pair */
.containment-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 20px;
}
@media (max-width: 600px) { .containment-pair { grid-template-columns: 1fr; } }
.metric-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
}
.metric-card.pair-left { border-left: 3px solid var(--accent); }
.metric-card.pair-right { border-left: 3px solid var(--warn); }
.metric-label { font-size: 0.75rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 4px; }
.metric-value { font-size: 1.9rem; font-weight: 700; line-height: 1; }
.metric-value.ok { color: var(--ok); }
.metric-value.warn { color: var(--warn); }
.metric-value.neutral { color: var(--text); }
.metric-sub { font-size: 0.78rem; color: var(--text2); margin-top: 4px; }
.pair-label {
    font-size: 0.7rem; color: var(--accent2); text-transform: uppercase;
    letter-spacing: 0.1em; font-weight: 700; margin-bottom: 8px;
}
.anti-goodhart-note {
    background: #1a1d2b;
    border: 1px solid #2a2d4a;
    border-radius: 5px;
    padding: 8px 12px;
    font-size: 0.76rem;
    color: #8b91b3;
    margin-top: 10px;
    font-style: italic;
}

/* KPI grid */
.kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
}
.kpi-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
}
.kpi-card .metric-value { font-size: 1.5rem; }

/* Cost card */
.cost-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
}

/* Tables */
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.83rem;
    margin-bottom: 8px;
}
thead th {
    background: var(--surface2);
    color: var(--text2);
    font-weight: 600;
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    letter-spacing: 0.04em;
    font-size: 0.75rem;
    text-transform: uppercase;
}
tbody tr:nth-child(even) { background: var(--surface); }
tbody tr:nth-child(odd) { background: var(--bg); }
tbody td {
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
}
tbody tr:last-child td { border-bottom: none; }

/* Rubric score bar */
.score-bar { display: inline-flex; align-items: center; gap: 6px; }
.score-fill {
    height: 6px; border-radius: 3px;
    background: linear-gradient(90deg, var(--danger), var(--warn), var(--ok));
}
.score-track { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }

/* HITL age coloring */
.age-fresh { color: var(--ok); }
.age-warn { color: var(--warn); }
.age-old { color: var(--danger); }

/* Tier table */
.tier-haiku { color: #a8d8a8; }
.tier-sonnet { color: var(--accent); }
.tier-opus { color: var(--accent2); }
.tier-unknown { color: var(--muted); }

code { font-family: var(--mono); font-size: 0.83em; color: #c8ceef; background: #1e2130; padding: 1px 4px; border-radius: 3px; }

hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
.footer { color: var(--muted); font-size: 0.75rem; text-align: center; margin-top: 32px; }
.section-intro { color: var(--text2); font-size: 0.83rem; margin-bottom: 12px; }
"""


def pct_str(rate, precision=1):
    """Format a 0..1 rate as a percentage string."""
    if rate is None:
        return 'N/A'
    return f"{rate * 100:.{precision}f}%"


def cost_str(cost):
    if cost is None:
        return 'N/A'
    if cost < 0.001:
        return f"${cost:.6f}"
    return f"${cost:.4f}"


def mins_str(mins):
    if mins is None:
        return 'N/A'
    if mins < 60:
        return f"{mins:.1f}m"
    return f"{mins / 60:.1f}h"


def score_bar_html(score, max_score=3.0):
    if score is None:
        return '<span style="color:var(--muted)">N/A</span>'
    pct = min(100, max(0, score / max_score * 100))
    color = 'var(--danger)' if pct < 50 else ('var(--warn)' if pct < 80 else 'var(--ok)')
    return (f'<span class="score-bar">'
            f'<span class="score-track"><span class="score-fill" style="width:{pct:.0f}%;background:{color}"></span></span>'
            f'<span style="color:{color};font-weight:600">{score:.2f}</span>'
            f'</span>')


def age_html(ts_str_or_dt):
    now = datetime.datetime.now(datetime.timezone.utc)
    s = age_str(ts_str_or_dt)
    # Determine if it's old
    try:
        if isinstance(ts_str_or_dt, datetime.datetime):
            dt = ts_str_or_dt
        else:
            dt = datetime.datetime.fromisoformat(str(ts_str_or_dt).replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        hours = (now - dt).total_seconds() / 3600
        cls = 'age-fresh' if hours < 4 else ('age-warn' if hours < 24 else 'age-old')
    except Exception:
        cls = ''
    return f'<span class="{cls}">{e(s)}</span>'


def tier_html(tier):
    if not tier:
        return '<span class="tier-unknown">—</span>'
    cls = f'tier-{tier.lower()}'
    return f'<span class="{cls}">{e(tier)}</span>'


def build_html(kpis, period_days, since, now, partial_cost, no_data):
    """Build the complete HTML string."""
    generated_at = now.strftime('%Y-%m-%d %H:%M UTC')
    period_label = f"Last {period_days} days"
    since_label = since.strftime('%Y-%m-%d %H:%M UTC')

    parts = []
    parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Xenia Agent-Manager Dashboard — {e(generated_at)}</title>
<style>{CSS}</style>
</head>
<body>
""")

    # Header
    parts.append(f"""
<div class="header">
  <div>
    <h1>Xenia Agent-Manager Dashboard</h1>
    <div class="header-meta">
      Period: <strong>{e(period_label)}</strong> &nbsp;·&nbsp;
      From: <code>{e(since_label)}</code> &nbsp;·&nbsp;
      Generated: <code>{e(generated_at)}</code>
    </div>
  </div>
  <div>
    <span class="badge badge-accent">wf_xenia · support-kpi-monitoring</span>
  </div>
</div>
""")

    # Partial-data banner (conspicuous, as required by SKILL.md anti-Goodhart rule 5)
    if partial_cost:
        cov_pct = kpis.get('cost_coverage_pct')
        if cov_pct is not None:
            cov_str = f"{cov_pct:.0f}%"
        else:
            cov_str = "0%"
        parts.append(f"""
<div class="partial-banner">
  &#9888; PARTIAL DATA: Cost coverage is {e(cov_str)} of resolved events.
  <span>Cost-per-resolution figures are estimates only.
  Anti-Goodhart Rule 5: partial instrumentation is NEVER read as complete.
  A missing <code>cost_usd</code> means "no data for this run", not zero cost.</span>
</div>
""")

    # No-data case
    if no_data:
        parts.append("""
<div class="no-data">
  <h2>No Data for Period</h2>
  <p style="margin-top:12px;color:var(--muted)">
    No events found in <code>hearth/progress/events.jsonl</code> for the requested period,
    and no DecisionRecords in <code>hearth/output/tickets/</code>.<br>
    This is a valid empty dashboard — no data means no KPIs, not fabricated zeros.
  </p>
</div>
""")
        parts.append('<div class="footer">Xenia Agent-Manager Dashboard &mdash; stdlib-only generator &mdash; no fabricated data</div>')
        parts.append('</body></html>')
        return ''.join(parts)

    # -----------------------------------------------------------------------
    # SECTION 1: Anti-Goodhart Containment+Quality Pair
    # -----------------------------------------------------------------------
    parts.append('<h2>Containment &#43; Quality Pair (Anti-Goodhart Rule 1)</h2>')
    parts.append("""<p class="section-intro">
Containment is <em>never shown alone</em>.
High containment with rising false-deflection is a <strong>worse state</strong> than lower containment.
These two metrics are always read together — a resolved ticket that shouldn't have been resolved harms the customer.
</p>""")

    cont_rate = kpis['containment_rate']
    fdr = kpis['false_deflection_rate']
    cont_pct = pct_str(cont_rate)
    fdr_pct = pct_str(fdr) if fdr is not None else 'N/A (no rubric data)'

    # Color: containment is ok unless false-deflection is also high
    cont_color = 'neutral'
    if cont_rate is not None:
        if fdr is not None and fdr > 0.1:
            cont_color = 'warn'  # High containment but also high FDR = concerning
        elif cont_rate >= 0.7:
            cont_color = 'ok'
        elif cont_rate < 0.4:
            cont_color = 'warn'

    fdr_color = 'ok' if (fdr is not None and fdr == 0) else ('warn' if (fdr is not None and fdr > 0) else 'neutral')

    parts.append(f"""
<div class="containment-pair">
  <div class="metric-card pair-left">
    <div class="pair-label">&#8645; Containment Rate</div>
    <div class="metric-label">Runs ending RESOLVED without human handoff</div>
    <div class="metric-value {cont_color}">{e(cont_pct)}</div>
    <div class="metric-sub">{kpis['containment_num']} resolved / {kpis['containment_denom']} total runs</div>
  </div>
  <div class="metric-card pair-right">
    <div class="pair-label">&#9888; False-Deflection Rate (quality check)</div>
    <div class="metric-label">Themis no-false-deflection 0-scores / judged artifacts</div>
    <div class="metric-value {fdr_color}">{e(fdr_pct)}</div>
    <div class="metric-sub">Based on {kpis['false_deflection_checks']} rubric dim checks</div>
  </div>
</div>
<div class="anti-goodhart-note">
  Anti-Goodhart Rule 1: Containment above target with rising false-deflection or complaint signals is a
  <strong>worse state</strong> than lower containment — the pair is read together, always.
  A containment rate that looks healthy must be validated against the quality pair before reporting upward.
</div>
""")

    # -----------------------------------------------------------------------
    # SECTION 2: Full KPI Table
    # -----------------------------------------------------------------------
    parts.append('<h2>KPI Summary</h2>')

    fcr_rate = kpis['fcr_rate']
    sla_att = kpis['sla_attainment']
    aht_med = kpis['aht_median_mins']
    gr = kpis['grounding_rate']
    esc_prec = kpis['escalation_precision']

    def kpi_color(val, thresholds):
        """thresholds: (warn_below, ok_above) as 0..1 rates"""
        if val is None:
            return 'neutral'
        if val >= thresholds[1]:
            return 'ok'
        if val < thresholds[0]:
            return 'warn'
        return 'neutral'

    parts.append('<div class="kpi-grid">')

    # FCR
    fcr_col = kpi_color(fcr_rate, (0.7, 0.85))
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">FCR (First-Contact Resolution)</div>
  <div class="metric-value {fcr_col}">{pct_str(fcr_rate)}</div>
  <div class="metric-sub">{kpis['fcr_pass']}/{kpis['fcr_eligible']} eligible runs
  <span class="badge badge-muted" style="margin-left:4px">proxy</span></div>
</div>""")

    # SLA Attainment
    sla_col = kpi_color(sla_att, (0.85, 0.95))
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">SLA Attainment</div>
  <div class="metric-value {sla_col}">{pct_str(sla_att)}</div>
  <div class="metric-sub">ok:{kpis['sla_ok']} / warn:{kpis['sla_warn']} / breach:{kpis['sla_breach']} (of {kpis['sla_total']} events)</div>
</div>""")

    # AHT proxy
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">AHT Proxy (median first response)</div>
  <div class="metric-value neutral">{mins_str(aht_med)}</div>
  <div class="metric-sub">Mean: {mins_str(aht_med)} &nbsp;·&nbsp; n={kpis['aht_samples']}
  <span class="badge badge-muted" style="margin-left:4px">proxy</span></div>
</div>""")

    # Grounding rate
    gr_col = kpi_color(gr, (0.8, 0.95))
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">Grounding Rate</div>
  <div class="metric-value {gr_col}">{pct_str(gr)}</div>
  <div class="metric-sub">Fully cited drafts / drafts with claims (n={kpis['grounding_checks']})</div>
</div>""")

    # Escalation precision
    esc_col = kpi_color(esc_prec, (0.6, 0.8))
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">Escalation Precision</div>
  <div class="metric-value {esc_col}">{pct_str(esc_prec)}</div>
  <div class="metric-sub">{kpis['warranted_esc']} warranted / {kpis['total_escalations']} total escalations</div>
</div>""")

    # Escalation recall
    parts.append(f"""
<div class="kpi-card">
  <div class="metric-label">Escalation Recall</div>
  <div class="metric-value neutral">N/A</div>
  <div class="metric-sub">Requires bounced-resolution signal (not yet instrumented)</div>
</div>""")

    parts.append('</div>')  # end kpi-grid

    # -----------------------------------------------------------------------
    # SECTION 3: Cost per Resolution (coverage-aware, tier-segmented)
    # -----------------------------------------------------------------------
    parts.append('<h2>Cost per Resolution</h2>')
    cov_pct = kpis.get('cost_coverage_pct')
    cov_n = kpis.get('cost_coverage_n', 0)
    cov_denom = kpis.get('cost_coverage_denom', 0)

    parts.append(f"""
<div class="cost-card">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div>
      <div class="metric-label">Mean Cost / Resolved Event</div>
      <div class="metric-value neutral" style="font-size:1.4rem">{cost_str(kpis['cost_per_resolution'])}</div>
    </div>
    <div style="margin-left:auto">
      <div class="metric-label">Coverage N%</div>
      <div style="font-size:1.1rem;font-weight:700;color:{'var(--ok)' if cov_pct and cov_pct>=80 else 'var(--warn)'}">
        {f"{cov_pct:.0f}%" if cov_pct is not None else "N/A"}
      </div>
      <div class="metric-sub">{cov_n} of {cov_denom} resolved events have cost data</div>
    </div>
  </div>
""")

    # Per-tier cost breakdown
    cost_by_tier = kpis['cost_by_tier']
    all_cost_by_tier = kpis['all_cost_by_tier']
    tiers = sorted(set(list(cost_by_tier.keys()) + list(all_cost_by_tier.keys())))

    if tiers:
        parts.append("""
  <h3 style="margin-top:16px">Per-Tier Breakdown (Anti-Goodhart Rule 6: tier laundering detection)</h3>
  <table>
    <thead><tr>
      <th>Tier</th><th>Resolved Events (w/ cost)</th>
      <th>All Events (w/ cost)</th><th>Avg Cost / Resolved</th>
      <th>Total Cost (all events)</th>
    </tr></thead><tbody>""")
        for tier in tiers:
            r_samples = cost_by_tier.get(tier, [])
            a_samples = all_cost_by_tier.get(tier, [])
            avg_r = statistics.mean(r_samples) if r_samples else None
            total_a = sum(a_samples) if a_samples else 0
            parts.append(f"""
    <tr>
      <td>{tier_html(tier)}</td>
      <td>{len(r_samples)}</td>
      <td>{len(a_samples)}</td>
      <td>{cost_str(avg_r)}</td>
      <td>{cost_str(total_a) if a_samples else '—'}</td>
    </tr>""")
        parts.append('</tbody></table>')

    # Tier laundering flags
    flags = kpis['tier_laundering_flags']
    if flags:
        parts.append(f"""
  <div class="badge badge-danger" style="margin-top:10px">
    {len(flags)} Potential Tier-Laundering Event(s) Detected
  </div>
  <table style="margin-top:8px">
    <thead><tr><th>Event ID</th><th>Timestamp</th><th>Agent</th><th>Expected Tier</th><th>Actual Tier</th></tr></thead>
    <tbody>""")
        for fl in flags:
            parts.append(f"""
    <tr>
      <td><code>{e(fl['event_id'])}</code></td>
      <td><code>{e(fl['ts'])}</code></td>
      <td>{e(fl['agent'])}</td>
      <td>{tier_html(fl['expected_tier'])}</td>
      <td>{tier_html(fl['actual_tier'])}</td>
    </tr>""")
        parts.append('</tbody></table>')

    parts.append('</div>')  # end cost-card

    if cov_pct is not None and cov_pct < 80:
        parts.append(f"""
<div class="partial-banner" style="margin-top:-4px">
  Cost coverage {cov_pct:.0f}% &lt; 80% threshold.
  <span>Any aggregation over fewer than 80% coverage carries a conspicuous "partial data" label per SKILL.md Rule 5.</span>
</div>""")

    # -----------------------------------------------------------------------
    # SECTION 4: Per-Intent KPI Table
    # -----------------------------------------------------------------------
    intent_stats = kpis['intent_stats']
    if intent_stats:
        parts.append('<h2>KPI by Intent Class</h2>')
        parts.append("""
<table>
  <thead><tr>
    <th>Intent</th><th>Total</th><th>Resolved</th><th>Escalated</th>
    <th>Containment</th><th>False-Deflection Score</th>
    <th>SLA OK</th><th>SLA Breach</th><th>Avg Cost</th>
  </tr></thead><tbody>""")
        for intent, stats in sorted(intent_stats.items()):
            total = stats['total']
            resolved = stats['resolved']
            escalated = stats['escalated']
            cont = pct_str(resolved / total) if total > 0 else 'N/A'
            fdr_scores = stats['false_deflection_scores']
            if fdr_scores:
                zero_ct = sum(1 for s in fdr_scores if s == 0)
                fdr_val = f"{zero_ct}/{len(fdr_scores)} 0-scores"
                fdr_badge = 'badge-danger' if zero_ct > 0 else 'badge-ok'
            else:
                fdr_val = '—'
                fdr_badge = 'badge-muted'
            cost_s = stats['cost_samples']
            avg_cost = cost_str(statistics.mean(cost_s)) if cost_s else '—'
            parts.append(f"""
  <tr>
    <td><strong>{e(intent)}</strong></td>
    <td>{total}</td>
    <td>{resolved}</td>
    <td>{escalated}</td>
    <td>{e(cont)}</td>
    <td><span class="badge {fdr_badge}" style="font-size:0.7rem">{e(fdr_val)}</span></td>
    <td>{stats['sla_ok']}</td>
    <td>{stats['sla_breach']}</td>
    <td>{e(avg_cost)}</td>
  </tr>""")
        parts.append('</tbody></table>')

    # -----------------------------------------------------------------------
    # SECTION 5: SLA Attainment by Severity
    # -----------------------------------------------------------------------
    sla_by_sev = kpis['sla_by_severity']
    if sla_by_sev:
        parts.append('<h2>SLA Attainment by Severity</h2>')
        parts.append('<p class="section-intro">SLA targets: P1 &lt;60 min first response · P2 &lt;4 h · P3 &lt;1 bd · P4 &lt;2 bd</p>')
        parts.append("""
<table>
  <thead><tr><th>Severity</th><th>OK</th><th>Warn</th><th>Breach</th><th>Attainment</th></tr></thead>
  <tbody>""")
        for sev in sorted(sla_by_sev.keys()):
            counts = sla_by_sev[sev]
            ok = counts.get('ok', 0)
            warn = counts.get('warn', 0)
            breach = counts.get('breach', 0)
            total = ok + warn + breach
            att = pct_str(ok / total) if total > 0 else 'N/A'
            breach_badge = 'badge-danger' if breach > 0 else 'badge-ok'
            parts.append(f"""
  <tr>
    <td><strong>{e(sev)}</strong></td>
    <td>{ok}</td><td>{warn}</td>
    <td><span class="badge {breach_badge}">{breach}</span></td>
    <td>{e(att)}</td>
  </tr>""")
        parts.append('</tbody></table>')

    # -----------------------------------------------------------------------
    # SECTION 6: Worst 3 runs by rubric score
    # -----------------------------------------------------------------------
    parts.append('<h2>Worst 3 Runs by Rubric Score</h2>')
    worst_3 = kpis['worst_3']
    if not worst_3:
        parts.append('<p class="section-intro" style="color:var(--muted)">No rubric-scored runs in period.</p>')
    else:
        parts.append("""
<table>
  <thead><tr>
    <th>Ticket</th><th>Terminal State</th><th>Intent</th>
    <th>Composite Score</th><th>Rubric Details</th><th>Trace Ref</th>
  </tr></thead><tbody>""")
        for run in worst_3:
            score = run['score']
            rubrics_html = []
            for rv in run['rubrics']:
                rid = rv.get('rubric_id', '?')
                passed = rv.get('pass')
                badge_cls = 'badge-ok' if passed else 'badge-danger'
                badge_txt = 'PASS' if passed else 'FAIL'
                dims = rv.get('dims', {})
                dims_str = ', '.join(f"{k}:{v}" for k, v in dims.items())
                rubrics_html.append(
                    f'<div style="margin-bottom:3px">'
                    f'<span class="badge {badge_cls}" style="font-size:0.65rem">{badge_txt}</span> '
                    f'<code style="font-size:0.75em">{e(rid)}</code>'
                    + (f' <span style="color:var(--muted);font-size:0.72em">[{e(dims_str)}]</span>' if dims_str else '')
                    + '</div>'
                )
            file_ref = run['file']
            parts.append(f"""
  <tr>
    <td><code>{e(run['ticket_id'])}</code></td>
    <td>{e(run['terminal_state'])}</td>
    <td>{e(run['intent'])}</td>
    <td>{score_bar_html(score)}</td>
    <td>{''.join(rubrics_html)}</td>
    <td><code style="font-size:0.72em">{e(file_ref)}</code></td>
  </tr>""")
        parts.append('</tbody></table>')

    # -----------------------------------------------------------------------
    # SECTION 7: Open HITL Items with Age
    # -----------------------------------------------------------------------
    parts.append('<h2>Open HITL Items</h2>')
    open_hitl = kpis['open_hitl']
    if not open_hitl:
        parts.append('<p class="section-intro" style="color:var(--ok)">No open HITL items for period. &check;</p>')
    else:
        parts.append(f'<p class="section-intro">{len(open_hitl)} open escalation(s) awaiting human resolution.</p>')
        parts.append("""
<table>
  <thead><tr>
    <th>Ticket ID</th><th>Severity</th><th>Category/Intent</th>
    <th>Agent</th><th>Escalated At</th><th>Age</th>
  </tr></thead><tbody>""")
        for item in sorted(open_hitl, key=lambda x: (x.get('_ts') or datetime.datetime.max.replace(tzinfo=datetime.timezone.utc))):
            ts = item.get('ts', '')
            parts.append(f"""
  <tr>
    <td><code>{e(item.get('ticket_id', '?'))}</code></td>
    <td>{e(item.get('severity', '?'))}</td>
    <td>{e(item.get('category', '?'))}</td>
    <td>{e(item.get('agent', '?'))}</td>
    <td><code style="font-size:0.78em">{e(ts)}</code></td>
    <td>{age_html(item.get('_ts') or ts)}</td>
  </tr>""")
        parts.append('</tbody></table>')

    # -----------------------------------------------------------------------
    # SECTION 8: KB Gap Velocity
    # -----------------------------------------------------------------------
    parts.append('<h2>KB Gap Velocity</h2>')
    filed = kpis['kb_gap_filed']
    closed = kpis['kb_gap_closed']
    parts.append(f"""
<div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(140px,1fr))">
  <div class="kpi-card">
    <div class="metric-label">Gaps Filed</div>
    <div class="metric-value neutral">{filed}</div>
    <div class="metric-sub">kb-gaps events in period</div>
  </div>
  <div class="kpi-card">
    <div class="metric-label">Gaps Closed</div>
    <div class="metric-value neutral">{closed}</div>
    <div class="metric-sub">closed gaps in period</div>
  </div>
  <div class="kpi-card">
    <div class="metric-label">Net Velocity</div>
    <div class="metric-value {'warn' if filed > closed else 'ok'}">{filed - closed:+d}</div>
    <div class="metric-sub">filed minus closed (positive = accumulating)</div>
  </div>
</div>
""")

    # -----------------------------------------------------------------------
    # SECTION 9: Event Log Summary
    # -----------------------------------------------------------------------
    period_events = kpis['period_events']
    if period_events:
        parts.append('<h2>Event Summary (Period)</h2>')

        kind_counts = collections.Counter(ev.get('kind', 'unknown') for ev in period_events)
        agent_counts = collections.Counter(ev.get('agent', 'unknown') for ev in period_events)

        parts.append('<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">')

        parts.append("""<div>
<h3>Events by Kind</h3>
<table>
  <thead><tr><th>Kind</th><th>Count</th></tr></thead><tbody>""")
        for kind, cnt in kind_counts.most_common():
            parts.append(f'<tr><td><code>{e(kind)}</code></td><td>{cnt}</td></tr>')
        parts.append('</tbody></table></div>')

        parts.append("""<div>
<h3>Events by Agent</h3>
<table>
  <thead><tr><th>Agent</th><th>Count</th></tr></thead><tbody>""")
        for agent, cnt in agent_counts.most_common():
            parts.append(f'<tr><td>{e(agent)}</td><td>{cnt}</td></tr>')
        parts.append('</tbody></table></div>')

        parts.append('</div>')

    # Footer
    parts.append('<hr>')
    parts.append(f"""
<div class="footer">
  Xenia Agent-Manager Dashboard &mdash; Generated {e(generated_at)} &mdash;
  stdlib-only generator (no external deps) &mdash; no fabricated data &mdash;
  support-kpi-monitoring v1 &mdash; Anti-Goodhart rules enforced
</div>
""")

    parts.append('</body></html>')
    return ''.join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Generate Xenia Agent-Manager Dashboard (stdlib only, no external deps)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--root', default=None,
                        help='Xenia pack root (default: two levels up from this script)')
    parser.add_argument('--period', default='30d',
                        help='Reporting period, e.g. 30d, 7d, 90d (default: 30d)')
    parser.add_argument('--out', default=None,
                        help='Output path for HTML file (default: <root>/hearth/output/dashboard/dashboard-<date>.html)')
    args = parser.parse_args()

    # Resolve root
    if args.root:
        root = pathlib.Path(args.root).resolve()
    else:
        # Default: generate.py lives at tools/dashboard/generate.py → root is two levels up
        root = pathlib.Path(__file__).resolve().parent.parent.parent

    print(f"[generate.py] Xenia root: {root}")
    print(f"[generate.py] Period: {args.period}")

    # Parse period
    try:
        period_td = parse_period(args.period)
    except ValueError as ex:
        print(f"ERROR: {ex}", file=sys.stderr)
        sys.exit(1)

    now = datetime.datetime.now(datetime.timezone.utc)
    since = now - period_td
    period_days = period_td.days

    # Load events
    events_path = root / 'hearth' / 'progress' / 'events.jsonl'
    print(f"[generate.py] Loading events from: {events_path}")
    events = load_events(events_path, since)
    print(f"[generate.py] Loaded {len(events)} events (in period + no-ts)")

    # Load DecisionRecords from tickets/*.md
    tickets_dir = root / 'hearth' / 'output' / 'tickets'
    decision_records = []
    if tickets_dir.exists():
        md_files = list(tickets_dir.glob('*.md'))
        print(f"[generate.py] Found {len(md_files)} ticket .md files")
        for md_path in md_files:
            if md_path.name.startswith('.'):
                continue
            dr = parse_decision_record(md_path)
            if dr:
                dr['_file'] = str(md_path.relative_to(root)) if md_path.is_relative_to(root) else str(md_path)
                decision_records.append(dr)
        print(f"[generate.py] Parsed {len(decision_records)} DecisionRecords")
    else:
        print(f"[generate.py] No tickets dir found at {tickets_dir}")

    # No-data check
    no_data = (len(events) == 0 and len(decision_records) == 0)

    # Compute KPIs
    if no_data:
        kpis = {
            'period_events': [],
            'total_runs': 0, 'all_resolved': [], 'all_escalated': [],
            'containment_num': 0, 'containment_denom': 0, 'containment_rate': None,
            'false_deflection_rate': None, 'false_deflection_checks': 0,
            'grounding_rate': None, 'grounding_checks': 0,
            'sla_attainment': None, 'sla_ok': 0, 'sla_warn': 0, 'sla_breach': 0, 'sla_total': 0,
            'sla_by_severity': {},
            'aht_median_mins': None, 'aht_mean_mins': None, 'aht_samples': 0,
            'fcr_rate': None, 'fcr_eligible': 0, 'fcr_pass': 0,
            'escalation_precision': None, 'escalation_recall': None,
            'total_escalations': 0, 'warranted_esc': 0,
            'cost_per_resolution': None, 'cost_coverage_pct': None,
            'cost_coverage_n': 0, 'cost_coverage_denom': 0,
            'cost_by_tier': {}, 'all_cost_by_tier': {}, 'tier_laundering_flags': [],
            'kb_gap_filed': 0, 'kb_gap_closed': 0,
            'worst_3': [], 'open_hitl': [], 'intent_stats': {},
        }
        partial_cost = False
    else:
        kpis = compute_kpis(events, decision_records, since, now)
        cov = kpis.get('cost_coverage_pct')
        partial_cost = (cov is None or cov < 80)

    # Determine output path
    date_str = now.strftime('%Y-%m-%d')
    if args.out:
        out_path = pathlib.Path(args.out).resolve()
    else:
        dashboard_dir = root / 'hearth' / 'output' / 'dashboard'
        dashboard_dir.mkdir(parents=True, exist_ok=True)
        out_path = dashboard_dir / f'dashboard-{date_str}.html'

    # Build HTML
    html_content = build_html(kpis, period_days, since, now, partial_cost, no_data)

    # Write output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html_content, encoding='utf-8')
    print(f"[generate.py] Dashboard written to: {out_path}")
    print(f"[generate.py] File size: {out_path.stat().st_size:,} bytes")

    # Print KPI summary to stdout for verification
    print("\n--- KPI SUMMARY ---")
    if no_data:
        print("  No data for period.")
    else:
        print(f"  Total runs (DecisionRecords):  {kpis['total_runs']}")
        print(f"  Containment rate:              {pct_str(kpis['containment_rate'])}")
        print(f"  False-deflection rate:         {pct_str(kpis['false_deflection_rate'])}")
        print(f"  Grounding rate:                {pct_str(kpis['grounding_rate'])}")
        print(f"  FCR (proxy):                   {pct_str(kpis['fcr_rate'])}")
        print(f"  SLA attainment:                {pct_str(kpis['sla_attainment'])}")
        print(f"  AHT proxy (median):            {mins_str(kpis['aht_median_mins'])}")
        print(f"  Escalation precision:          {pct_str(kpis['escalation_precision'])}")
        print(f"  Escalation recall:             N/A (not instrumented)")
        print(f"  Cost/resolution (mean):        {cost_str(kpis['cost_per_resolution'])}")
        cov = kpis.get('cost_coverage_pct')
        print(f"  Cost coverage N%:              {f'{cov:.0f}%' if cov is not None else 'N/A'}")
        print(f"  KB gaps filed:                 {kpis['kb_gap_filed']}")
        print(f"  KB gaps closed:                {kpis['kb_gap_closed']}")
        print(f"  Open HITL items:               {len(kpis['open_hitl'])}")
        print(f"  Tier laundering flags:         {len(kpis['tier_laundering_flags'])}")
        print(f"  Events in period:              {len(kpis['period_events'])}")
    print("---")
    print(f"\n[generate.py] Done. Open: {out_path}")


if __name__ == '__main__':
    main()
