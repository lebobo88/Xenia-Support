/**
 * tests/server/routes.test.ts — P3 endpoints over the in-process server with
 * fake MCP clients + the parity fixture as the file estate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createBridgeServer, type BridgeClients } from '../../server/index.js';
import { registerDataRoutes } from '../../server/routes.js';

// Point file readers at the parity fixture
process.env['HYDRA_XENIA_ROOT'] = resolve(__dirname, '..', 'fixtures');

// PII planted in ticket free-text so the redaction assertions actually PROVE
// the chokepoint runs on these endpoints (codex P3 finding).
const PLANTED_EMAIL = 'angry.customer@example.com';

function fakeClients(): BridgeClients {
  const ticketRow = {
    ticket_id: '000001',
    status: 'open',
    priority: 'P1',
    intent: 'outage',
    customer_ref: 'customer:2f8b6c44',
    subject: `prod down — reach me at ${PLANTED_EMAIL}`,
    created_at: '2026-06-04T13:29:47Z',
    sla: { first_response_due: '2000-01-01T00:00:00Z', breached: false },
  };
  const ticketFull = {
    ...ticketRow,
    history: [{ ts: '2026-06-04T13:30:00Z', actor: 'customer:2f8b6c44', kind: 'created', body: `call ${PLANTED_EMAIL}` }],
  };
  const mk = (payload: unknown): BridgeClients['tickets'] => ({
    connected: true,
    async call(tool: string) {
      if (tool === 'xenia-tickets.get') return ticketFull as never;
      return payload as never;
    },
    async close() {
      /* noop */
    },
  });
  return {
    tickets: mk({ tickets: [ticketRow], count: 1 }),
    kb: mk({ docs: [{ doc_id: 'd1', title: 'T', as_of_date: '2026-01-01', topic_class: 'stable', stale: false }], doc_count: 1, index_fresh: true }),
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  registerDataRoutes();
  server = createBridgeServer(fakeClients());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

describe('GET /api/queue', () => {
  it('computes SLA countdown + flags an elapsed window as breached', async () => {
    const res = await fetch(`${base}/api/queue`);
    const body = (await res.json()) as { tickets: Array<{ sla_remaining_min: number; breached: boolean; sla_window_min: number }> };
    expect(res.status).toBe(200);
    const row = body.tickets[0]!;
    expect(row.sla_window_min).toBe(60); // P1
    expect(row.sla_remaining_min).toBeLessThan(0); // due 2000 → long elapsed
    expect(row.breached).toBe(true); // honesty: elapsed window ⇒ breached
  });
});

describe('GET /api/kpi/snapshot', () => {
  it('returns the full KPI surface with anti-Goodhart pairing + coverage', async () => {
    const res = await fetch(`${base}/api/kpi/snapshot`);
    const k = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    // fixture estate → known parity values
    expect(k['total_runs']).toBe(4);
    expect(k['containment_rate']).toBe(0.5);
    expect(k['false_deflection_rate']).toBe(0.25); // pair present
    expect(k['cost_coverage_pct']).toBe(100); // coverage label present
    expect(k['escalation_precision']).toBe(0.5); // corrected value
  });
});

describe('GET /api/kb/health', () => {
  it('returns docs + index freshness', async () => {
    const res = await fetch(`${base}/api/kb/health`);
    const body = (await res.json()) as { doc_count: number; index_fresh: boolean };
    expect(res.status).toBe(200);
    expect(body.doc_count).toBe(1);
    expect(body.index_fresh).toBe(true);
  });
});

describe('GET /api/hitl/aged', () => {
  it('returns open escalations aged + banded', async () => {
    const res = await fetch(`${base}/api/hitl/aged`);
    const body = (await res.json()) as { items: Array<{ ticket_id: string; age_band: string }>; count: number };
    expect(res.status).toBe(200);
    // fixture: T-102 escalated, never resolved → open; T-104 resolved later → closed
    expect(body.items.map((i) => i.ticket_id)).toContain('T-102');
    expect(body.items.map((i) => i.ticket_id)).not.toContain('T-104');
  });
});

describe('GET /api/ticket/:id (path param)', () => {
  it('the path form /api/ticket/<id> routes (not only ?id=)', async () => {
    const res = await fetch(`${base}/api/ticket/000001`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: { ticket_id: string } };
    expect(body.ticket.ticket_id).toBe('000001');
  });
});

describe('redaction proven on data endpoints', () => {
  it('planted email in ticket subject/history is scrubbed on queue + ticket', async () => {
    // queue carries the planted email in subject; ticket carries it in history
    for (const path of ['/api/queue', '/api/ticket/000001']) {
      const text = await (await fetch(`${base}${path}`)).text();
      expect(text, `${path} leaked the planted email`).not.toContain(PLANTED_EMAIL);
      expect(text, `${path} did not run the scrubber`).toContain('[EMAIL]');
    }
  });

  it('no raw email survives ANY endpoint payload', async () => {
    for (const path of ['/api/queue', '/api/ticket/000001', '/api/kpi/snapshot', '/api/kb/health', '/api/hitl/aged']) {
      const text = await (await fetch(`${base}${path}`)).text();
      expect(text, `${path} leaked an email`).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });
});
