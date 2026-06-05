/**
 * src/components.tsx — shared presentational primitives.
 */

import type { JSX } from 'react';
import type { PollState } from './usePolling.ts';

export function StateGate<T>(props: {
  state: PollState<T>;
  emptyLabel?: string;
  children: (data: T) => JSX.Element;
}): JSX.Element {
  const { state, emptyLabel = 'No data in range.', children } = props;
  switch (state.kind) {
    case 'loading':
      return (
        <div className="state" role="status" aria-live="polite">
          <div className="skeleton" style={{ width: '100%' }} />
          <div className="skeleton" style={{ width: '100%' }} />
          <span className="note">loading…</span>
        </div>
      );
    case 'offline':
      return (
        <div className="state error" role="alert">
          <span className="glyph" aria-hidden>⚠</span>
          <strong>Bridge offline</strong>
          <span className="note">start it with <code>npm run bridge</code> — {state.error}</span>
        </div>
      );
    case 'error':
      return (
        <div className="state error" role="alert">
          <span className="glyph" aria-hidden>■</span>
          <strong>Error</strong>
          <span className="note">{state.error}</span>
        </div>
      );
    case 'empty':
      return (
        <div className="state" role="status">
          <span className="glyph" aria-hidden>○</span>
          <span>{emptyLabel}</span>
        </div>
      );
    case 'live':
      return children(state.data);
  }
}

export function Badge({ kind, children }: { kind?: string; children: React.ReactNode }): JSX.Element {
  return <span className={`badge${kind ? ` ${kind}` : ''}`}>{children}</span>;
}

export function priorityClass(p?: string): string {
  return p ? p.toLowerCase() : '';
}

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${(x * 100).toFixed(0)}%`;
}

export function num(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined ? '—' : x.toFixed(digits);
}

/** Relative age from an ISO timestamp; never renders "Invalid Date". */
export function ago(iso: string | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 0) return 'in the future';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** SLA countdown string from remaining minutes. */
export function countdown(remainingMin: number | null | undefined): string {
  if (remainingMin === null || remainingMin === undefined) return '—';
  if (remainingMin < 0) return `${Math.abs(remainingMin)}m over`;
  if (remainingMin < 60) return `${remainingMin}m left`;
  return `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m left`;
}
