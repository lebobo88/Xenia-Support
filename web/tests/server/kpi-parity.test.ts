/**
 * tests/server/kpi-parity.test.ts — TS KPI engine == generate.py oracle.
 *
 * The oracle (tests/fixtures/kpi-oracle.json) is produced by
 * tests/fixtures/dump_oracle.py running generate.py over tests/fixtures/hearth.
 * This test reads the SAME fixture through server/files.ts and asserts the TS
 * engine reproduces every KPI — EXCEPT the one documented correction:
 * escalation_precision (generate.py's flat parser can't see nested
 * escalation.triggered, so its oracle value is the buggy 0.0; this engine
 * computes the correct value). Both are pinned here so the divergence is
 * intentional and visible.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEvents, readDecisionRecords } from '../../server/files.js';
import { computeKpiSnapshot } from '../../server/kpi.js';

const FIXTURE_ROOT = resolve(__dirname, '..', 'fixtures');
const ORACLE = JSON.parse(
  readFileSync(resolve(FIXTURE_ROOT, 'kpi-oracle.json'), 'utf8'),
) as Record<string, unknown>;

// Fixed window matching dump_oracle.py (now=2026-06-05, 30d back)
const NOW = new Date('2026-06-05T00:00:00Z').getTime();
const SINCE = NOW - 30 * 24 * 60 * 60 * 1000;

function snapshot() {
  const events = readEvents(FIXTURE_ROOT, undefined).events; // engine re-filters
  const drs = readDecisionRecords(FIXTURE_ROOT).records;
  return computeKpiSnapshot(events, drs, SINCE);
}

describe('KPI parity vs generate.py oracle', () => {
  const snap = snapshot();

  // Every KPI that must match the oracle byte-for-byte (the corrected
  // escalation metrics are asserted separately below).
  const PARITY_KEYS = [
    'total_runs', 'containment_num', 'containment_denom', 'containment_rate',
    'false_deflection_rate', 'false_deflection_checks', 'grounding_rate', 'grounding_checks',
    'sla_attainment', 'sla_ok', 'sla_warn', 'sla_breach', 'sla_total',
    'aht_median_mins', 'aht_mean_mins', 'aht_samples',
    'fcr_rate', 'fcr_eligible', 'fcr_pass',
    'cost_per_resolution', 'cost_coverage_pct', 'cost_coverage_n', 'cost_coverage_denom',
    'kb_gap_filed', 'kb_gap_closed',
  ] as const;

  it.each(PARITY_KEYS)('matches oracle: %s', (key) => {
    expect((snap as unknown as Record<string, unknown>)[key]).toEqual(ORACLE[key]);
  });

  it('matches oracle: cost_by_tier', () => {
    expect(snap.cost_by_tier).toEqual(ORACLE['cost_by_tier']);
  });

  it('matches oracle: worst_3 ordering + scores', () => {
    expect(snap.worst_3).toEqual(ORACLE['worst_3']);
  });

  it('matches oracle: open HITL ticket ids', () => {
    expect(snap.open_hitl_ticket_ids).toEqual(ORACLE['open_hitl_ticket_ids']);
  });

  it('matches oracle: tier-laundering flags', () => {
    expect(snap.tier_laundering_flags).toEqual(ORACLE['tier_laundering_flags']);
  });

  it('matches oracle: intent_stats', () => {
    expect(snap.intent_stats).toEqual(ORACLE['intent_stats']);
  });

  it('matches oracle: sla_by_severity', () => {
    expect(snap.sla_by_severity).toEqual(ORACLE['sla_by_severity']);
  });
});

describe('DOCUMENTED divergence — escalation_precision correction', () => {
  const snap = snapshot();

  it('oracle has the generate.py bug (precision stuck at 0.0, warranted 0)', () => {
    expect(ORACLE['escalation_precision']).toBe(0.0);
    expect(ORACLE['warranted_esc']).toBe(0);
  });

  it('TS engine corrects it: reads nested escalation.triggered', () => {
    // fixture: T-102 triggered=true, T-104 triggered=false → 1 of 2 warranted
    expect(snap.total_escalations).toBe(2);
    expect(snap.warranted_esc).toBe(1);
    expect(snap.escalation_precision).toBe(0.5);
  });
});

describe('anti-Goodhart contract', () => {
  const snap = snapshot();
  it('containment is never reported without its false-deflection pair', () => {
    // both present (or both null) — never one without the other
    const hasContainment = snap.containment_rate !== null;
    const hasPair = snap.false_deflection_rate !== null || snap.false_deflection_checks === 0;
    expect(hasContainment && hasPair).toBe(true);
  });
  it('cost always carries an explicit coverage percentage', () => {
    expect(snap.cost_coverage_pct).not.toBeUndefined();
  });
});
