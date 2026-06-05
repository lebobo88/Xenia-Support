/**
 * tests/ui/app.test.tsx — P0 shell smoke.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/App.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Support Observatory shell (P0)', () => {
  it('renders live state with 0 write tools when the bridge responds', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            service: 'xenia-observatory-bridge',
            phase: 'P0-scaffold',
            writeTools: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent('read-only by construction');
    expect(screen.getByRole('status')).toHaveTextContent('write tools: 0');
  });

  it('renders offline state when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('bridge offline');
  });
});
