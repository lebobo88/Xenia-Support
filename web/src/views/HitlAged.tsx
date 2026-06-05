import type { JSX } from 'react';
import { api, type HitlResponse } from '../api.ts';
import { usePolling } from '../usePolling.ts';
import { StateGate, Badge, ago } from '../components.tsx';

const bandKind: Record<string, string> = { fresh: 'ok', warn: 'warn', old: 'breach', unknown: '' };

export function HitlAged({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const state = usePolling<HitlResponse>((s) => api.hitl(s), { isEmpty: (d) => d.count === 0 });

  return (
    <StateGate state={state} emptyLabel="No open escalations — the HITL queue is clear.">
      {(data) => (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Ticket</th><th>Severity</th><th>Age</th><th>Band</th><th>Agent</th><th>Trigger</th></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.ticket_id} className="clickable" onClick={() => onOpen(it.ticket_id)} tabIndex={0} role="button"
                    aria-label={`Open ticket ${it.ticket_id}`}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpen(it.ticket_id); }}>
                  <td className="mono">{it.ticket_id}</td>
                  <td><Badge kind={it.severity === 'P1' ? 'breach' : it.severity === 'P2' ? 'warn' : ''}>{it.severity ?? '—'}</Badge></td>
                  <td className="mono">{it.age_hours === null ? '—' : `${it.age_hours}h`} <span className="note">({ago(it.ts)})</span></td>
                  <td><Badge kind={bandKind[it.age_band] ?? ''}>{it.age_band}</Badge></td>
                  <td className="mono">{it.agent ?? '—'}</td>
                  <td style={{ maxWidth: 320 }}>{it.trigger ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StateGate>
  );
}
