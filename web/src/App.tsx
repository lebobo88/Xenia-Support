/**
 * src/App.tsx — Xenia Support Observatory shell (P0 scaffold).
 *
 * P4 replaces this with the 5 views (Queue · Ticket detail · KPIs ·
 * KB health · HITL aged). P0 proves the wire: fetch /api/health through
 * the vite proxy and render the bridge state.
 */

import { useEffect, useState } from 'react';

interface HealthResponse {
  ok: boolean;
  service: string;
  phase: string;
  writeTools: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'live'; health: HealthResponse }
  | { kind: 'offline'; error: string };

export function App(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`bridge responded ${res.status}`);
        const health = (await res.json()) as HealthResponse;
        if (!cancelled) setState({ kind: 'live', health });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'offline', error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'Geist, system-ui, sans-serif', padding: 32 }}>
      <h1>
        Xenia · <span style={{ color: '#27b3a5' }}>Support Observatory</span>
      </h1>
      <p style={{ color: '#888', fontSize: 13 }}>
        read-only observability · loopback only · campaign xenia-observability-ui
      </p>
      {state.kind === 'loading' ? (
        <p role="status">connecting to bridge…</p>
      ) : state.kind === 'live' ? (
        <p role="status">
          bridge <strong>{state.health.service}</strong> live — phase{' '}
          <code>{state.health.phase}</code> · write tools:{' '}
          <strong>{state.health.writeTools}</strong> (read-only by construction)
        </p>
      ) : (
        <p role="alert">bridge offline: {state.error} — start it with <code>npm run bridge</code></p>
      )}
    </main>
  );
}
