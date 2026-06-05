/**
 * server/kpi.ts — KPI engine, ported from tools/dashboard/generate.py
 * (compute_kpis). Pure functions over the file-reader shapes (server/files.ts).
 *
 * Parity contract: `tests/server/kpi-parity.test.ts` asserts this reproduces
 * `tools/dashboard/generate.py` over the shared fixture (tests/fixtures/),
 * verified by `tests/fixtures/dump_oracle.py`.
 *
 * ONE DELIBERATE DIVERGENCE (documented, gated):
 *   generate.py computes `escalation_precision` via a regex over `str(dr)`,
 *   but its flat DecisionRecord parser never captures the nested
 *   `escalation.triggered` field — so warranted_esc is ALWAYS 0 and the
 *   metric is stuck at 0.0 (a latent bug in the current dashboard). This port
 *   reads `dr.escalation.triggered` from the js-yaml-parsed record and
 *   computes the metric CORRECTLY. The parity test pins both: the oracle's
 *   0.0 and this engine's corrected value, so the divergence is intentional
 *   and visible.
 *
 * Anti-Goodhart contract preserved: containment is always paired with
 * false-deflection; cost carries an explicit coverage percentage.
 */

import type { XeniaEvent, DecisionRecord } from './files.js';

// Expected model tier per head (generate.py EXPECTED_TIERS) — tier-laundering.
const EXPECTED_TIERS: Record<string, string> = {
  hestia: 'opus', hermes: 'opus', themis: 'opus', eunomia: 'opus',
  metis: 'sonnet', asclepius: 'sonnet', harmonia: 'sonnet',
  soteria: 'sonnet', plutus: 'sonnet',
  iris: 'haiku', echo: 'haiku',
};

export interface SlaCounts {
  ok: number;
  warn: number;
  breach: number;
}

export interface TierLaunderingFlag {
  agent: string;
  expected_tier: string;
  actual_tier: string;
}

export interface WorstRun {
  ticket_id: string;
  terminal_state: string;
  score: number;
}

export interface IntentStat {
  total: number;
  resolved: number;
  escalated: number;
  sla_ok: number;
  sla_breach: number;
  cost_samples: number[];
}

export interface KpiSnapshot {
  total_runs: number;
  containment_num: number;
  containment_denom: number;
  containment_rate: number | null;
  false_deflection_rate: number | null;
  false_deflection_checks: number;
  grounding_rate: number | null;
  grounding_checks: number;
  sla_attainment: number | null;
  sla_ok: number;
  sla_warn: number;
  sla_breach: number;
  sla_total: number;
  sla_by_severity: Record<string, SlaCounts>;
  aht_median_mins: number | null;
  aht_mean_mins: number | null;
  aht_samples: number;
  fcr_rate: number | null;
  fcr_eligible: number;
  fcr_pass: number;
  /** CORRECTED vs generate.py (see header) */
  escalation_precision: number | null;
  escalation_recall: null;
  total_escalations: number;
  warranted_esc: number;
  cost_per_resolution: number | null;
  cost_coverage_pct: number | null;
  cost_coverage_n: number;
  cost_coverage_denom: number;
  cost_by_tier: Record<string, number[]>;
  tier_laundering_flags: TierLaunderingFlag[];
  kb_gap_filed: number;
  kb_gap_closed: number;
  worst_3: WorstRun[];
  open_hitl_ticket_ids: string[];
  intent_stats: Record<string, IntentStat>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Timestamp → epoch ms. Tolerates the three shapes our readers produce:
 * JSON strings (events.jsonl), Date objects (js-yaml auto-parses ISO
 * timestamps in DecisionRecord blocks), and numbers.
 */
function tsMs(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  if (s instanceof Date) {
    const t = s.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof s === 'number') return Number.isNaN(s) ? null : s;
  if (typeof s !== 'string') return null;
  const t = new Date(s.replace('Z', '+00:00')).getTime();
  return Number.isNaN(t) ? null : t;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Composite run score = average of every dim across every rubric verdict. */
function rubricScore(dr: DecisionRecord): number | null {
  const dims: number[] = [];
  for (const rv of dr.rubric_verdicts ?? []) {
    for (const v of Object.values(rv.dims ?? {})) dims.push(v);
  }
  return dims.length === 0 ? null : dims.reduce((a, b) => a + b, 0) / dims.length;
}

// ---------------------------------------------------------------------------
// compute
// ---------------------------------------------------------------------------

export function computeKpiSnapshot(
  events: XeniaEvent[],
  decisionRecords: DecisionRecord[],
  sinceMs: number,
): KpiSnapshot {
  // period filter: events with no ts are kept (generate.py: _ts None passes)
  const periodEvents = events.filter((ev) => {
    const t = tsMs(ev.ts);
    return t === null || t >= sinceMs;
  });

  const allResolved = decisionRecords.filter((dr) => dr.terminal_state === 'RESOLVED');
  const allEscalated = decisionRecords.filter(
    (dr) => dr.terminal_state === 'ESCALATED_TO_HUMAN',
  );
  const allRuns = decisionRecords.filter((dr) => dr.terminal_state !== undefined);
  const totalRuns = allRuns.length;

  // containment + anti-Goodhart pair (over ALL records, not period-filtered —
  // matches generate.py which iterates decision_records directly)
  const containmentNum = allResolved.length;
  const containmentDenom = totalRuns;
  const containmentRate = containmentDenom > 0 ? containmentNum / containmentDenom : null;

  const fdChecks: number[] = [];
  const groundChecks: number[] = [];
  for (const dr of decisionRecords) {
    for (const rv of dr.rubric_verdicts ?? []) {
      const dims = rv.dims ?? {};
      if ('no-false-deflection' in dims) fdChecks.push(dims['no-false-deflection']!);
      if ('grounded-in-kb' in dims || 'citation-coverage' in dims) {
        groundChecks.push(dims['grounded-in-kb'] ?? dims['citation-coverage']!);
      }
    }
  }
  const falseDeflectionRate =
    fdChecks.length > 0 ? fdChecks.filter((s) => s === 0).length / fdChecks.length : null;
  const groundingRate =
    groundChecks.length > 0 ? groundChecks.filter((s) => s >= 3).length / groundChecks.length : null;

  // SLA from period events
  const slaStates = new Set(['ok', 'warn', 'breach']);
  const slaEvents = periodEvents.filter((ev) => slaStates.has(ev.sla_state ?? ''));
  const slaOk = slaEvents.filter((ev) => ev.sla_state === 'ok').length;
  const slaWarn = slaEvents.filter((ev) => ev.sla_state === 'warn').length;
  const slaBreach = slaEvents.filter((ev) => ev.sla_state === 'breach').length;
  const slaTotal = slaEvents.length;
  const slaAttainment = slaTotal > 0 ? slaOk / slaTotal : null;
  const slaBySeverity: Record<string, SlaCounts> = {};
  for (const ev of slaEvents) {
    const sev = ev.severity ?? 'unknown';
    const bucket = (slaBySeverity[sev] ??= { ok: 0, warn: 0, breach: 0 });
    const st = ev.sla_state as keyof SlaCounts;
    bucket[st] += 1;
  }

  // AHT from DR sla block
  const ahtSamples: number[] = [];
  for (const dr of decisionRecords) {
    const r = tsMs(dr.sla?.received_at);
    const f = tsMs(dr.sla?.first_response_at);
    if (r !== null && f !== null) {
      const mins = (f - r) / 60000;
      if (mins >= 0 && mins < 60 * 24 * 7) ahtSamples.push(mins);
    }
  }

  // escalation precision — CORRECTED (header note): read nested triggered
  const totalEscalations = allEscalated.length;
  const warrantedEsc = allEscalated.filter((dr) => dr.escalation?.triggered === true).length;
  const escalationPrecision = totalEscalations > 0 ? warrantedEsc / totalEscalations : null;

  // cost (coverage-aware)
  const resolvedEvents = periodEvents.filter((ev) => ev.kind === 'xenia.ticket_resolved');
  const resolvedWithCost = resolvedEvents.filter(
    (ev) => ev.cost_usd !== null && ev.cost_usd !== undefined,
  );
  const costCoverageN = resolvedWithCost.length;
  const costCoverageDenom = resolvedEvents.length;
  const costCoveragePct = costCoverageDenom > 0 ? (costCoverageN / costCoverageDenom) * 100 : null;
  const costByTier: Record<string, number[]> = {};
  const costAll: number[] = [];
  for (const ev of resolvedWithCost) {
    const tier = ev.model_tier ?? 'unknown';
    (costByTier[tier] ??= []).push(ev.cost_usd!);
    costAll.push(ev.cost_usd!);
  }
  const costPerResolution = costAll.length > 0 ? costAll.reduce((a, b) => a + b, 0) / costAll.length : null;

  const tierLaunderingFlags: TierLaunderingFlag[] = [];
  for (const ev of periodEvents) {
    const agent = (ev.agent ?? '').toLowerCase();
    const tier = ev.model_tier;
    if (tier && agent in EXPECTED_TIERS) {
      const expected = EXPECTED_TIERS[agent]!;
      if (tier !== expected) {
        tierLaunderingFlags.push({ agent, expected_tier: expected, actual_tier: tier });
      }
    }
  }

  // KB gaps
  const kbGapFiled = periodEvents.filter(
    (ev) => ev.phase === 'kb-gaps' && ev.kind === 'xenia.output_written',
  ).length;

  // FCR proxy
  const fcrEligible = allResolved.length;
  const resolvedIds = new Set(allResolved.map((dr) => dr.ticket_id).filter(Boolean));
  const escalatedIds = new Set(allEscalated.map((dr) => dr.ticket_id).filter(Boolean));
  const fcrFail = [...resolvedIds].filter((id) => escalatedIds.has(id)).length;
  const fcrPass = Math.max(0, fcrEligible - fcrFail);
  const fcrRate = fcrEligible > 0 ? fcrPass / fcrEligible : null;

  // worst 3 by rubric score
  const scored = decisionRecords
    .map((dr) => ({ dr, score: rubricScore(dr) }))
    .filter((x): x is { dr: DecisionRecord; score: number } => x.score !== null)
    .map(({ dr, score }) => ({
      ticket_id: dr.ticket_id ?? 'unknown',
      terminal_state: dr.terminal_state ?? '?',
      score,
    }))
    .sort((a, b) => a.score - b.score);
  const worst3 = scored.slice(0, 3);

  // open HITL — escalations with no later resolution for the same ticket
  const openByTicket = new Map<string, number>(); // ticket_id -> earliest escalation ts
  for (const ev of periodEvents) {
    if (ev.kind !== 'xenia.escalated') continue;
    const tid = ev.ticket_id ?? undefined;
    if (!tid) continue;
    const evt = tsMs(ev.ts);
    const resolvedLater = periodEvents.some(
      (r) =>
        r.ticket_id === tid &&
        r.kind === 'xenia.ticket_resolved' &&
        tsMs(r.ts) !== null &&
        evt !== null &&
        tsMs(r.ts)! > evt,
    );
    if (resolvedLater) continue;
    const prev = openByTicket.get(tid);
    if (prev === undefined || (evt !== null && evt < prev)) openByTicket.set(tid, evt ?? Infinity);
  }
  const openHitlTicketIds = [...openByTicket.keys()].sort();

  // per-intent breakdown (DR loop uses intent; event loop uses category)
  const intentStats: Record<string, IntentStat> = {};
  const ensureIntent = (key: string): IntentStat =>
    (intentStats[key] ??= {
      total: 0,
      resolved: 0,
      escalated: 0,
      sla_ok: 0,
      sla_breach: 0,
      cost_samples: [],
    });
  for (const dr of decisionRecords) {
    const intent = dr.intent ?? 'general';
    const s = ensureIntent(intent);
    s.total += 1;
    if (dr.terminal_state === 'RESOLVED') s.resolved += 1;
    else if (dr.terminal_state === 'ESCALATED_TO_HUMAN') s.escalated += 1;
  }
  for (const ev of periodEvents) {
    // Mirror generate.py's defaultdict: only materialize an intent bucket when
    // there is actually something to record (an ok/breach SLA state or a cost
    // sample). An event with sla_state='n/a' and no cost must NOT create a key.
    const cat = ev.category ?? 'general';
    const hasCost = ev.cost_usd !== null && ev.cost_usd !== undefined;
    if (ev.sla_state === 'ok') ensureIntent(cat).sla_ok += 1;
    else if (ev.sla_state === 'breach') ensureIntent(cat).sla_breach += 1;
    if (hasCost) ensureIntent(cat).cost_samples.push(ev.cost_usd!);
  }

  return {
    total_runs: totalRuns,
    containment_num: containmentNum,
    containment_denom: containmentDenom,
    containment_rate: containmentRate === null ? null : round6(containmentRate),
    false_deflection_rate: falseDeflectionRate === null ? null : round6(falseDeflectionRate),
    false_deflection_checks: fdChecks.length,
    grounding_rate: groundingRate === null ? null : round6(groundingRate),
    grounding_checks: groundChecks.length,
    sla_attainment: slaAttainment === null ? null : round6(slaAttainment),
    sla_ok: slaOk,
    sla_warn: slaWarn,
    sla_breach: slaBreach,
    sla_total: slaTotal,
    sla_by_severity: slaBySeverity,
    aht_median_mins: ((m) => (m === null ? null : round6(m)))(median(ahtSamples)),
    aht_mean_mins: ((m) => (m === null ? null : round6(m)))(mean(ahtSamples)),
    aht_samples: ahtSamples.length,
    fcr_rate: fcrRate === null ? null : round6(fcrRate),
    fcr_eligible: fcrEligible,
    fcr_pass: fcrPass,
    escalation_precision: escalationPrecision === null ? null : round6(escalationPrecision),
    escalation_recall: null,
    total_escalations: totalEscalations,
    warranted_esc: warrantedEsc,
    cost_per_resolution: costPerResolution === null ? null : round6(costPerResolution),
    cost_coverage_pct: costCoveragePct === null ? null : round6(costCoveragePct),
    cost_coverage_n: costCoverageN,
    cost_coverage_denom: costCoverageDenom,
    cost_by_tier: Object.fromEntries(
      Object.entries(costByTier).map(([t, v]) => [t, v.map(round6)]),
    ),
    tier_laundering_flags: tierLaunderingFlags,
    kb_gap_filed: kbGapFiled,
    kb_gap_closed: 0,
    worst_3: worst3.map((w) => ({ ...w, score: round6(w.score) })),
    open_hitl_ticket_ids: openHitlTicketIds,
    intent_stats: intentStats,
  };
}
