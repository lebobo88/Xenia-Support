/**
 * src/usePolling.ts — generic polling hook with a small state machine.
 * States: loading → live | empty | error | offline. Re-polls on an interval;
 * aborts in flight on unmount. (UI-SPEC §5: poll, no websockets in v1.)
 */

import { useEffect, useRef, useState } from 'react';

export type PollState<T> =
  | { kind: 'loading' }
  | { kind: 'live'; data: T }
  | { kind: 'empty'; data: T }
  | { kind: 'error'; error: string }
  | { kind: 'offline'; error: string };

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { intervalMs?: number; isEmpty?: (d: T) => boolean; deps?: unknown[] } = {},
): PollState<T> {
  const { intervalMs = 6000, isEmpty, deps = [] } = opts;
  const [state, setState] = useState<PollState<T>>({ kind: 'loading' });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const tick = async (): Promise<void> => {
      try {
        const data = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        setState(isEmpty?.(data) ? { kind: 'empty', data } : { kind: 'live', data });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        // distinguish "bridge down" (network) from a real error response
        const offline = /failed to fetch|networkerror|econnrefused/i.test(msg);
        setState(offline ? { kind: 'offline', error: msg } : { kind: 'error', error: msg });
      } finally {
        if (!cancelled) timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
