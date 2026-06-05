/**
 * tests/ui/views.test.tsx — view rendering across states + the PII-never-
 * renders requirement (the server redacts; the UI must render the redacted
 * value as-is and never re-expose or linkify raw PII).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Queue } from '../../src/views/Queue.tsx';
import { Kpis } from '../../src/views/Kpis.tsx';
import { KbView } from '../../src/views/KbHealth.tsx';
import { HitlAged } from '../../src/views/HitlAged.tsx';
import { TicketDetail } from '../../src/views/TicketDetail.tsx';

function stubFetch(map: Record<string, unknown>, fail = false) {
  vi.stubGlobal('fetch', (url: string) => {
    if (fail) return Promise.reject(new TypeError('Failed to fetch'));
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return Promise.resolve(new Response('{}', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(map[key]), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('Queue', () => {
  it('renders rows with SLA badge + opaque customer ref', async () => {
    stubFetch({
      '/api/queue': {
        count: 1,
        tickets: [{ ticket_id: '000001', priority: 'P1', status: 'open', intent: 'outage', customer_ref: 'customer:2f8b6c44', subject: 'prod down', created_at: '2026-06-04T00:00:00Z', sla_remaining_min: -10, breached: true }],
      },
    });
    render(<Queue onOpen={() => undefined} />);
    expect(await screen.findByText('000001')).toBeInTheDocument();
    expect(screen.getByText('BREACHED')).toBeInTheDocument();
    expect(screen.getByText('customer:2f8b6c44')).toBeInTheDocument();
  });

  it('shows empty state when no tickets match', async () => {
    stubFetch({ '/api/queue': { count: 0, tickets: [] } });
    render(<Queue onOpen={() => undefined} />);
    expect(await screen.findByText(/no tickets match/i)).toBeInTheDocument();
  });

  it('shows offline state when the bridge is down', async () => {
    stubFetch({}, true);
    render(<Queue onOpen={() => undefined} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/bridge offline/i);
  });

  it('PII-never-renders: a redacted [EMAIL] token displays literally, raw email never appears', async () => {
    stubFetch({
      '/api/queue': {
        count: 1,
        tickets: [{ ticket_id: '000002', priority: 'P2', status: 'open', customer_ref: 'customer:abc123', subject: 'reach me at [EMAIL]', created_at: '2026-06-04T00:00:00Z', sla_remaining_min: 30, breached: false }],
      },
    });
    render(<Queue onOpen={() => undefined} />);
    expect(await screen.findByText('reach me at [EMAIL]')).toBeInTheDocument();
    // the component must not turn anything into a mailto: link or reveal raw PII
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

describe('Kpis', () => {
  const snap = {
    total_runs: 4, containment_rate: 0.5, containment_num: 2, containment_denom: 4,
    false_deflection_rate: 0.25, false_deflection_checks: 4, grounding_rate: 0.25, grounding_checks: 4,
    sla_attainment: 0.66, sla_ok: 4, sla_warn: 1, sla_breach: 1, sla_total: 6, sla_by_severity: {},
    aht_median_mins: 12.5, aht_mean_mins: 15, aht_samples: 4, fcr_rate: 1, fcr_eligible: 2, fcr_pass: 2,
    escalation_precision: 0.5, total_escalations: 2, warranted_esc: 1,
    cost_per_resolution: 0.3, cost_coverage_pct: 60, cost_coverage_n: 3, cost_coverage_denom: 5,
    cost_by_tier: {}, tier_laundering_flags: [{ agent: 'iris', expected_tier: 'haiku', actual_tier: 'opus' }],
    kb_gap_filed: 1, worst_3: [{ ticket_id: 'T-104', terminal_state: 'ESCALATED_TO_HUMAN', score: 0.33 }],
    open_hitl_ticket_ids: ['T-102'], intent_stats: { billing: { total: 1, resolved: 1, escalated: 0, sla_ok: 1, sla_breach: 0, cost_samples: [0.4] } },
  };

  it('shows the anti-Goodhart pair AND a low-coverage warning banner', async () => {
    stubFetch({ '/api/kpi/snapshot': snap });
    render(<Kpis />);
    expect(await screen.findByText(/containment — paired with false-deflection/i)).toBeInTheDocument();
    // containment never without its pair
    expect(screen.getByText(/false-deflection · 4 judged/i)).toBeInTheDocument();
    // coverage < 80 → warning banner
    expect(screen.getByText(/cost figures below are partial/i)).toBeInTheDocument();
    // tier-laundering surfaced
    expect(screen.getByText(/expected haiku, ran opus/i)).toBeInTheDocument();
  });

  it('empty when no runs', async () => {
    stubFetch({ '/api/kpi/snapshot': { ...snap, total_runs: 0 } });
    render(<Kpis />);
    expect(await screen.findByText(/KPIs populate once DecisionRecords exist/i)).toBeInTheDocument();
  });
});

describe('KbView', () => {
  it('renders staleness thresholds + a stale doc badge', async () => {
    stubFetch({ '/api/kb/health': { doc_count: 1, index_fresh: true, kb_gap_filed: 0, docs: [{ doc_id: 'sec', title: 'Security', as_of_date: '2025-12-01', topic_class: 'volatile', stale: true }] } });
    render(<KbView />);
    expect(await screen.findByText('STALE')).toBeInTheDocument();
    expect(screen.getByText(/volatile > 90d/i)).toBeInTheDocument();
  });
});

describe('HitlAged', () => {
  it('renders open escalations with age band; empty when clear', async () => {
    stubFetch({ '/api/hitl/aged': { count: 1, items: [{ ticket_id: 'T-102', severity: 'P1', age_hours: 50, age_band: 'old', agent: 'hestia', ts: '2026-06-03T00:00:00Z', trigger: 'P1 outage' }] } });
    render(<HitlAged onOpen={() => undefined} />);
    expect(await screen.findByText('T-102')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
  });
});

describe('TicketDetail', () => {
  it('renders history timeline + read-only approvals note (no write affordance)', async () => {
    stubFetch({
      '/api/ticket/': {
        ticket: { ticket_id: '000001', priority: 'P1', status: 'open', customer_ref: 'customer:abc123', subject: 's', created_at: '2026-06-04T00:00:00Z', history: [{ ts: '2026-06-04T00:00:00Z', actor: 'customer:abc123', kind: 'created', body: 'hello [EMAIL]' }], recommendations: [] },
        decisionRecord: null,
        approvals: [],
      },
    });
    render(<TicketDetail id="000001" onBack={() => undefined} />);
    expect(await screen.findByText('hello [EMAIL]')).toBeInTheDocument();
    expect(screen.getByText(/this console cannot create or approve/i)).toBeInTheDocument();
    // no buttons that would mutate state (only the back nav)
    const buttons = screen.getAllByRole('button');
    expect(buttons.every((b) => /queue/i.test(b.textContent ?? ''))).toBe(true);
  });
});
