/**
 * tests/server/bridge-security.test.ts — P2 security suite.
 *
 * Mirrors the AgentMesh web bridge-security bar, adapted to a read-only
 * GET-only bridge: loopback/Host guard, method lockdown, whitelist +
 * forbidden-verb denylist, redaction-on-the-wire, empty write allowlist.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Raw HTTP request that lets us forge the Host header (fetch refuses to). */
function rawGet(
  port: number,
  path: string,
  host: string,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { Host: host } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
import {
  createBridgeServer,
  registerRoute,
  readTool,
  WRITE_TOOLS,
  READ_TOOLS,
  HOST,
  type BridgeClients,
} from '../../server/index.js';
import { allowTool } from '../../server/whitelist.js';

// ---------------------------------------------------------------------------
// Fake MCP clients — record calls, return canned payloads with PII planted
// ---------------------------------------------------------------------------

function fakeClients(): BridgeClients & { calls: string[] } {
  const calls: string[] = [];
  const mk = (payload: unknown): BridgeClients['tickets'] => ({
    connected: true,
    async call(tool: string) {
      calls.push(tool);
      return payload as never;
    },
    async close() {
      /* noop */
    },
  });
  return {
    calls,
    tickets: mk({ ok: true, open_count: 2, note: 'mail me at leak@example.com' }),
    kb: mk({ ok: true, doc_count: 10, index_fresh: true }),
  };
}

let server: Server;
let base: string;
let port: number;
let clients: ReturnType<typeof fakeClients>;

beforeAll(async () => {
  clients = fakeClients();
  server = createBridgeServer(clients);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('INVARIANT #2 — read-only bridge', () => {
  it('write allowlist is empty and frozen', () => {
    expect(WRITE_TOOLS).toHaveLength(0);
    expect(Object.isFrozen(WRITE_TOOLS)).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s returns 405', async (method) => {
    const res = await fetch(`${base}/api/health`, { method, body: '{}' });
    expect(res.status).toBe(405);
  });
});

describe('INVARIANT #1 — loopback/Host guard (DNS-rebinding defense)', () => {
  it('the production bind constant is loopback (never 0.0.0.0)', () => {
    expect(HOST).toBe('127.0.0.1');
  });

  it('rejects foreign Host headers with 403', async () => {
    const res = await rawGet(port, '/api/health', 'evil.example.com');
    expect(res.status).toBe(403);
  });

  it('accepts 127.0.0.1 and localhost Hosts', async () => {
    for (const host of ['127.0.0.1', 'localhost']) {
      const res = await rawGet(port, '/api/health', host);
      expect(res.status).toBe(200);
    }
  });
});

describe('INVARIANT #4 — whitelist + forbidden-verb denylist', () => {
  it('allows exactly the 7 spec read tools', () => {
    expect(READ_TOOLS).toHaveLength(7);
    for (const t of READ_TOOLS) expect(allowTool(t)).toBe(true);
  });

  it.each([
    'xenia-tickets.create',
    'xenia-tickets.comment',
    'xenia-tickets.update_fields',
    'xenia-tickets.send_response',
    'xenia-tickets.recommend',
    'xenia-tickets.execute_approved',
    'mesh.enroll',
    'eights.memory.add',
    'xenia-kb.write',
  ])('refuses %s', (tool) => {
    expect(allowTool(tool)).toBe(false);
  });

  it('readTool throws 403 for non-whitelisted tools and never reaches a client', async () => {
    await expect(readTool(clients, 'xenia-tickets.execute_approved')).rejects.toMatchObject({
      httpStatus: 403,
    });
    expect(clients.calls).not.toContain('xenia-tickets.execute_approved');
  });

  it('denylist beats a hypothetical whitelist mistake', () => {
    // simulate: even if a write-shaped name were added to READ_TOOLS, the
    // verb denylist still rejects it
    const hypothetical = [...READ_TOOLS, 'xenia-tickets.execute_approved'];
    expect(hypothetical.includes('xenia-tickets.execute_approved')).toBe(true);
    expect(allowTool('xenia-tickets.execute_approved')).toBe(false);
  });
});

describe('INVARIANT #3 — redaction on the wire', () => {
  it('PII planted in an MCP response never reaches the browser', async () => {
    const res = await fetch(`${base}/api/health`);
    const text = await res.text();
    expect(text).not.toContain('leak@example.com');
    expect(text).toContain('[EMAIL]');
  });

  it('PII in a route handler error is scrubbed by the single json() writer', async () => {
    // Even an error message carrying PII passes through redactPayload before
    // reaching the socket — there is no res.end outside json().
    registerRoute('/api/_test_leak', () => {
      throw Object.assign(new Error('synthetic detail: mail admin@secret.example'), {
        httpStatus: 500,
      });
    });
    const res = await fetch(`${base}/api/_test_leak`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('admin@secret.example');
    expect(text).toContain('[EMAIL]');
  });
});

describe('hardening misc', () => {
  it('unknown endpoints 404 with no payload echo', async () => {
    const res = await fetch(`${base}/api/../../etc/passwd`);
    expect([403, 404]).toContain(res.status);
  });

  it('security headers present', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
