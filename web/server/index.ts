/**
 * web/server/index.ts — Xenia Support Observatory bridge (P0 scaffold).
 *
 * P0 ships the security skeleton only: loopback-only bind, Host-header
 * guard (DNS-rebinding defense), port-file convention, and a /api/health
 * stub. The MCP multiplex (xenia-tickets + xenia-kb), file readers,
 * redaction chokepoint, and KPI engine land in P2/P3 per the campaign plan.
 *
 * INVARIANTS (inherited from the sibling pattern + support-constitution):
 *   #1 LOOPBACK ONLY — binds 127.0.0.1, never 0.0.0.0 (Art IV / NB-6).
 *   #2 READ-ONLY — the write allowlist is EMPTY BY CONSTRUCTION in v1
 *      (Art V: approvals are YAML artifacts issued by a human, never a UI
 *      button). Tests assert emptiness.
 *   #3 REDACTION CHOKEPOINT — every outbound payload passes through
 *      redact() inside json() (Layer 4, Art IV §2). P0 stubs it as identity
 *      for the health endpoint only; P2 implements the scrub set.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1'; // loopback only — NEVER 0.0.0.0
const PREFERRED_PORT = Number(process.env['XENIA_OBS_BRIDGE_PORT'] ?? 8791);
const PORT_PINNED = process.env['XENIA_OBS_BRIDGE_PORT'] != null;
const PORT_MAX_PROBES = 25;
const PORT_FILE = fileURLToPath(new URL('../.xenia-bridge-port', import.meta.url));

// ---------------------------------------------------------------------------
// Write allowlist — EMPTY BY CONSTRUCTION (v1 read-only; see header)
// ---------------------------------------------------------------------------
export const WRITE_TOOLS: readonly string[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Port management (sibling pattern)
// ---------------------------------------------------------------------------

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function choosePort(): Promise<number> {
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  if (PORT_PINNED) {
    throw new Error(
      `XENIA_OBS_BRIDGE_PORT=${PREFERRED_PORT} is already in use. Free it or pick another.`,
    );
  }
  for (let p = PREFERRED_PORT + 1; p <= PREFERRED_PORT + PORT_MAX_PROBES; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`no free port in ${PREFERRED_PORT}..${PREFERRED_PORT + PORT_MAX_PROBES}`);
}

// ---------------------------------------------------------------------------
// DNS-rebinding defense
// ---------------------------------------------------------------------------

function isLoopbackHost(req: IncomingMessage): boolean {
  const host = (req.headers['host'] ?? '').split(':')[0]?.toLowerCase() ?? '';
  return host === '127.0.0.1' || host === 'localhost';
}

// ---------------------------------------------------------------------------
// Outbound chokepoint — P2 replaces the identity redactor with the Art IV
// Layer-4 scrub (server/redact.ts). EVERYTHING leaves through json().
// ---------------------------------------------------------------------------

function redact<T>(payload: T): T {
  return payload; // P0 stub — /api/health only carries non-PII status fields
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(redact(body)));
}

// ---------------------------------------------------------------------------
// HTTP server — P0 surface: /api/health only
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (!isLoopbackHost(req)) {
    json(res, 403, { error: 'loopback only' });
    return;
  }
  const url = (req.url ?? '/').split('?')[0];

  if (req.method === 'GET' && url === '/api/health') {
    json(res, 200, {
      ok: true,
      service: 'xenia-observatory-bridge',
      phase: 'P0-scaffold',
      writeTools: WRITE_TOOLS.length, // 0 — asserted by tests
    });
    return;
  }

  json(res, 404, { error: 'not found' });
});

async function main(): Promise<void> {
  const port = await choosePort();
  server.listen(port, HOST, () => {
    writeFileSync(PORT_FILE, String(port), 'utf8');
    console.log(
      `[xenia-obs] Support Observatory bridge listening on http://${HOST}:${port} ` +
        `(loopback only · read-only · 0 write tools)`,
    );
  });

  const cleanup = (): void => {
    try {
      rmSync(PORT_FILE, { force: true });
    } catch {
      /* best effort */
    }
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Only run when invoked directly (tests import the exports above)
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '',
);
if (isMain) {
  void main();
}
