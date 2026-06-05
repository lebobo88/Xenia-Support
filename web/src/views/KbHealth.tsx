import type { JSX } from 'react';
import { api, type KbHealth } from '../api.ts';
import { usePolling } from '../usePolling.ts';
import { StateGate, Badge, ago } from '../components.tsx';

export function KbView(): JSX.Element {
  const state = usePolling<KbHealth>((s) => api.kb(s), { isEmpty: (d) => d.docs.length === 0 });

  return (
    <StateGate state={state} emptyLabel="No KB documents.">
      {(kb) => (
        <div>
          <div className="grid metric-grid" style={{ marginBottom: 18 }}>
            <div className="card"><h3>Documents</h3><div className="metric-val small">{kb.doc_count}</div></div>
            <div className="card"><h3>Index</h3><div className="metric-val small" style={{ color: kb.index_fresh ? 'var(--ok)' : 'var(--warn)' }}>{kb.index_fresh === null ? '—' : kb.index_fresh ? 'fresh' : 'stale'}</div></div>
            <div className="card"><h3>KB gaps filed</h3><div className="metric-val small">{kb.kb_gap_filed}</div></div>
          </div>
          <div className="banner ok" role="note" style={{ marginBottom: 14 }}>
            Staleness thresholds: volatile &gt; 90d · active &gt; 180d · stable &gt; 730d
          </div>
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Doc</th><th>Title</th><th>Class</th><th>As of</th><th>State</th></tr></thead>
              <tbody>
                {kb.docs.map((d) => (
                  <tr key={d.doc_id}>
                    <td className="mono">{d.doc_id}</td>
                    <td>{d.title}</td>
                    <td><Badge>{d.topic_class}</Badge></td>
                    <td className="mono">{d.as_of_date} <span className="note">({ago(d.as_of_date)})</span></td>
                    <td><Badge kind={d.stale ? 'warn' : 'ok'}>{d.stale ? 'STALE' : 'fresh'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </StateGate>
  );
}
