import type { JSX } from 'react';
import { useState } from 'react';
import { api, type QueueResponse } from '../api.ts';
import { usePolling } from '../usePolling.ts';
import { StateGate, Badge, priorityClass, countdown, ago } from '../components.tsx';

export function Queue({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (priority) qs.set('priority', priority);
  const query = qs.toString() ? `?${qs.toString()}` : '';

  const state = usePolling<QueueResponse>((s) => api.queue(query, s), {
    isEmpty: (d) => d.count === 0,
    deps: [query],
  });

  return (
    <section>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all statuses</option>
          {['open', 'pending', 'resolved', 'escalated', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">all priorities</option>
          {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <StateGate state={state} emptyLabel="No tickets match the filter.">
        {(data) => (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ticket</th><th>Pri</th><th>Status</th><th>Intent</th>
                  <th>Customer</th><th>Subject</th><th>SLA</th><th>Age</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.ticket_id} className="clickable" onClick={() => t.ticket_id && onOpen(t.ticket_id)}
                      tabIndex={0} role="button" aria-label={`Open ticket ${t.ticket_id}`}
                      onKeyDown={(e) => { if (e.key === 'Enter' && t.ticket_id) onOpen(t.ticket_id); }}>
                    <td className="mono">{t.ticket_id}</td>
                    <td><Badge kind={priorityClass(t.priority)}>{t.priority}</Badge></td>
                    <td><Badge>{t.status}</Badge></td>
                    <td className="mono">{t.intent ?? '—'}</td>
                    <td className="mono">{t.customer_ref}</td>
                    <td>{t.subject}</td>
                    <td><Badge kind={t.breached ? 'breach' : t.sla_remaining_min !== null && t.sla_remaining_min! < 60 ? 'warn' : 'ok'}>
                      {t.breached ? 'BREACHED' : countdown(t.sla_remaining_min)}</Badge></td>
                    <td className="mono" style={{ color: 'var(--ink-faint)' }}>{ago(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateGate>
    </section>
  );
}
