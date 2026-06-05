/**
 * src/App.tsx — Support Observatory shell: hash router, nav, live health chip.
 * Read-only console (UI-SPEC). Accessible: single h1 per view, nav landmark,
 * aria-current, polite live region for the connection state.
 */

import { useEffect, useState, type JSX } from 'react';
import './styles.css';
import { api, type Health } from './api.ts';
import { usePolling } from './usePolling.ts';
import { Queue } from './views/Queue.tsx';
import { TicketDetail } from './views/TicketDetail.tsx';
import { Kpis } from './views/Kpis.tsx';
import { KbView } from './views/KbHealth.tsx';
import { HitlAged } from './views/HitlAged.tsx';

type Route =
  | { view: 'queue' }
  | { view: 'ticket'; id: string }
  | { view: 'kpis' }
  | { view: 'kb' }
  | { view: 'hitl' };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [seg, arg] = h.split('/');
  if (seg === 'ticket' && arg) return { view: 'ticket', id: decodeURIComponent(arg) };
  if (seg === 'kpis') return { view: 'kpis' };
  if (seg === 'kb') return { view: 'kb' };
  if (seg === 'hitl') return { view: 'hitl' };
  return { view: 'queue' };
}

const NAV = [
  { key: 'queue', href: '#/', label: 'Queue' },
  { key: 'kpis', href: '#/kpis', label: 'KPIs' },
  { key: 'kb', href: '#/kb', label: 'KB health' },
  { key: 'hitl', href: '#/hitl', label: 'HITL aged' },
] as const;

const TITLES: Record<Route['view'], string> = {
  queue: 'Ticket Queue',
  ticket: 'Ticket Detail',
  kpis: 'KPI Dashboard',
  kb: 'Knowledge Base Health',
  hitl: 'Aged HITL Escalations',
};

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const on = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (hash: string): void => { window.location.hash = hash; };
  const openTicket = (id: string): void => go(`#/ticket/${encodeURIComponent(id)}`);

  const health = usePolling<Health>((s) => api.health(s), { intervalMs: 8000 });
  const conn =
    health.kind === 'live' ? (health.data.ok ? 'live' : 'degraded') :
    health.kind === 'offline' ? 'offline' : health.kind === 'error' ? 'degraded' : 'live';

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">Xenia<span className="x">·</span>Observatory</div>
        <div className="brand-sub">support · read-only</div>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className={route.view === n.key ? 'active' : ''}
               aria-current={route.view === n.key ? 'page' : undefined}>
              <span className="dot" aria-hidden />{n.label}
            </a>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{TITLES[route.view]}</h1>
          <span className={`chip ${conn}`} role="status" aria-live="polite">
            <span className="live-dot" aria-hidden />
            {conn === 'live' ? 'live' : conn === 'degraded' ? 'degraded' : 'offline'}
            {health.kind === 'live' ? <span className="note"> · {health.data.writeTools} write tools</span> : null}
          </span>
        </header>

        {route.view === 'queue' && <Queue onOpen={openTicket} />}
        {route.view === 'ticket' && <TicketDetail id={route.id} onBack={() => go('#/')} />}
        {route.view === 'kpis' && <Kpis />}
        {route.view === 'kb' && <KbView />}
        {route.view === 'hitl' && <HitlAged onOpen={openTicket} />}
      </main>
    </div>
  );
}
