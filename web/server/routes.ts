/**
 * server/routes.ts — P3 data endpoints (UI-SPEC §4).
 *
 * Imported for side-effects by index.ts main(). Every handler returns through
 * the shared json() writer (redaction chokepoint) by THROWING a value or
 * calling the writer the server passes — but since registerRoute handlers
 * receive (req,res,url,clients) and must use the same json() path, they call
 * the exported `sendJson` helper. All endpoints GET-only (enforced upstream),
 * read-only, whitelist-gated.
 */

import { registerRoute, readTool, json as send, type BridgeClients } from './index.js';
import { xeniaRoot } from './xenia-client.js';
import {
  readEvents,
  readDecisionRecords,
  readApprovals,
  type DecisionRecord,
} from './files.js';
import { computeKpiSnapshot } from './kpi.js';

function periodMs(url: URL): { sinceMs: number; nowMs: number } {
  const nowMs = Date.now();
  const m = /^(\d+)d$/.exec(url.searchParams.get('period') ?? '30d');
  const days = m ? Number(m[1]) : 30;
  return { sinceMs: nowMs - days * 24 * 60 * 60 * 1000, nowMs };
}

// SLA window minutes per priority (support pack: P1 60 / P2 240 / P3 480 / P4 960)
const SLA_MINUTES: Record<string, number> = { P1: 60, P2: 240, P3: 480, P4: 960 };

interface TicketRow {
  ticket_id?: string;
  status?: string;
  priority?: string;
  intent?: string;
  customer_ref?: string;
  subject?: string;
  created_at?: string;
  sla?: { first_response_due?: string; breached?: boolean };
}

export function registerDataRoutes(): void {
  // GET /api/queue?status=&priority=
  registerRoute('/api/queue', async (_req, res, url, clients: BridgeClients) => {
    const args: Record<string, unknown> = {};
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');
    if (status) args['status'] = status;
    if (priority) args['priority'] = priority;
    const result = (await readTool(clients, 'xenia-tickets.list', args)) as {
      tickets?: TicketRow[];
      count?: number;
    };
    const now = Date.now();
    const rows = (result.tickets ?? []).map((t) => {
      const dueMs = t.sla?.first_response_due ? new Date(t.sla.first_response_due).getTime() : NaN;
      const remainingMin = Number.isNaN(dueMs) ? null : Math.round((dueMs - now) / 60000);
      return {
        ticket_id: t.ticket_id,
        status: t.status,
        priority: t.priority,
        intent: t.intent,
        customer_ref: t.customer_ref,
        subject: t.subject,
        created_at: t.created_at,
        sla_due: t.sla?.first_response_due,
        sla_remaining_min: remainingMin,
        sla_window_min: t.priority ? SLA_MINUTES[t.priority] ?? null : null,
        // Observability honesty: breached if the ticket's own flag says so OR
        // the first-response window has already elapsed.
        breached: t.sla?.breached === true || (remainingMin !== null && remainingMin < 0),
      };
    });
    send(res, 200, { tickets: rows, count: rows.length });
  });

  // GET /api/ticket/:id
  registerRoute('/api/ticket', async (_req, res, url, clients: BridgeClients) => {
    // path form: /api/ticket?id=...  OR /api/ticket/<id>
    const id = url.searchParams.get('id') ?? url.pathname.split('/').filter(Boolean)[2];
    if (!id) {
      send(res, 400, { error: 'ticket id required' });
      return;
    }
    const ticket = await readTool(clients, 'xenia-tickets.get', { ticket_id: id });
    const root = xeniaRoot();
    const drs = readDecisionRecords(root).records;
    const decisionRecord: DecisionRecord | null =
      drs.find((d) => d.ticket_id === id) ?? null;
    const approvals = readApprovals(root).filter(
      (a) => a.ticket_id === id || a.approval_file.includes(id),
    );
    send(res, 200, { ticket, decisionRecord, approvals });
  });

  // GET /api/kpi/snapshot?period=30d
  registerRoute('/api/kpi/snapshot', (_req, res, url) => {
    const root = xeniaRoot();
    const { sinceMs } = periodMs(url);
    const events = readEvents(root).events;
    const drs = readDecisionRecords(root).records;
    const snapshot = computeKpiSnapshot(events, drs, sinceMs);
    send(res, 200, snapshot);
  });

  // GET /api/kb/health
  registerRoute('/api/kb/health', async (_req, res, _url, clients: BridgeClients) => {
    const list = (await readTool(clients, 'xenia-kb.list')) as {
      docs?: Array<{ doc_id?: string; title?: string; as_of_date?: string; topic_class?: string; stale?: boolean }>;
    };
    const ping = (await readTool(clients, 'xenia-kb.ping')) as {
      doc_count?: number;
      index_fresh?: boolean;
    };
    const root = xeniaRoot();
    const events = readEvents(root).events;
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const gapFiled = events.filter(
      (ev) =>
        ev.phase === 'kb-gaps' &&
        ev.kind === 'xenia.output_written' &&
        (ev.ts ? new Date(ev.ts).getTime() >= since : true),
    ).length;
    send(res, 200, {
      docs: list.docs ?? [],
      doc_count: ping.doc_count ?? (list.docs ?? []).length,
      index_fresh: ping.index_fresh ?? null,
      kb_gap_filed: gapFiled,
    });
  });

  // GET /api/hitl/aged
  registerRoute('/api/hitl/aged', (_req, res) => {
    const root = xeniaRoot();
    const events = readEvents(root).events;
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const period = events.filter((ev) => (ev.ts ? new Date(ev.ts).getTime() >= since : true));
    const drs = readDecisionRecords(root).records;
    const drByTicket = new Map(drs.map((d) => [d.ticket_id, d]));

    // open escalations: no later resolution for the same ticket
    const byTicket = new Map<
      string,
      { ts: string | undefined; severity: string | undefined; agent: string | undefined }
    >();
    for (const ev of period) {
      if (ev.kind !== 'xenia.escalated' || !ev.ticket_id) continue;
      const evt = ev.ts ? new Date(ev.ts).getTime() : NaN;
      const resolvedLater = period.some(
        (r) =>
          r.ticket_id === ev.ticket_id &&
          r.kind === 'xenia.ticket_resolved' &&
          r.ts &&
          !Number.isNaN(evt) &&
          new Date(r.ts).getTime() > evt,
      );
      if (resolvedLater) continue;
      const existing = byTicket.get(ev.ticket_id);
      if (!existing || (ev.ts && existing.ts && ev.ts < existing.ts)) {
        byTicket.set(ev.ticket_id, { ts: ev.ts ?? undefined, severity: ev.severity, agent: ev.agent });
      }
    }
    const now = Date.now();
    const items = [...byTicket.entries()]
      .map(([ticket_id, e]) => {
        const ageH = e.ts ? Math.round((now - new Date(e.ts).getTime()) / 3600000) : null;
        const dr = drByTicket.get(ticket_id);
        return {
          ticket_id,
          ts: e.ts,
          severity: e.severity,
          agent: e.agent,
          age_hours: ageH,
          age_band: ageH === null ? 'unknown' : ageH <= 4 ? 'fresh' : ageH <= 24 ? 'warn' : 'old',
          trigger: dr?.escalation?.trigger,
        };
      })
      .sort((a, b) => (b.age_hours ?? 0) - (a.age_hours ?? 0));
    send(res, 200, { items, count: items.length });
  });
}

registerDataRoutes();
