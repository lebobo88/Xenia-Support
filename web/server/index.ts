/**
 * web/server/index.ts — Xenia Support Observatory bridge (P2 core).
 *
 * INVARIANTS (support-constitution + UI-SPEC, P1 HITL-approved):
 *   #1 LOOPBACK ONLY — binds 127.0.0.1; Host-header guard (DNS-rebinding).
 *   #2 READ-ONLY — WRITE_TOOLS frozen empty; every non-GET returns 405.
 *   #3 REDACTION CHOKEPOINT — the single json() writer pipes every payload
 *      through redactPayload() (Layer 4, Art IV §2). No other res.end exists
 *      on the data path.
 *   #4 WHITELIST — only the 7 read tools in server/whitelist.ts are callable;
 *      tool names are server-side literals (the browser never names a tool).
 *
 * P2 surface: /api/health (bridge + children + estate file counts).
 * P3 adds: /api/queue /api/ticket/:id /api/kpi/snapshot /api/kb/health /api/hitl/aged.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XeniaMcpClient, xeniaRoot } from './xenia-client.js';
import { allowTool, READ_TOOLS, WRITE_TOOLS } from './whitelist.js';
import { redactPayload } from './redact.js';
import { readEvents, readDecisionRecords, readApprovals } from './files.js';

export { WRITE_TOOLS, READ_TOOLS };

/** Loopback-only bind address. Exported so tests assert the production constant. */
export const HOST = '127.0.0.1'; // loopback only — NEVER 0.0.0.0
const PREFERRED_PORT = Number(process.env['XENIA_OBS_BRIDGE_PORT'] ?? 8791);
const PORT_PINNED = process.env['XENIA_OBS_BRIDGE_PORT'] != null;
const PORT_MAX_PROBES = 25;
const PORT_FILE = fileURLToPath(new URL('../.xenia-bridge-port', import.meta.url));

// ---------------------------------------------------------------------------
// MCP clients (lazy-connected singletons)
// ---------------------------------------------------------------------------

export interface BridgeClients {
  tickets: Pick<XeniaMcpClient, 'call' | 'close' | 'connected'>;
  kb: Pick<XeniaMcpClient, 'call' | 'close' | 'connected'>;
}

function defaultClients(): BridgeClients {
  return {
    tickets: new XeniaMcpClient('xenia_tickets'),
    kb: new XeniaMcpClient('xenia_kb'),
  };
}

/** Whitelist-gated tool call — the ONLY path from HTTP to the MCP children. */
export async function readTool(
  clients: BridgeClients,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!allowTool(tool)) {
    throw Object.assign(new Error(`tool not whitelisted: ${tool}`), { httpStatus: 403 });
  }
  const client = tool.startsWith('xenia-kb.') ? clients.kb : clients.tickets;
  return client.call(tool, args);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function isLoopbackHost(req: IncomingMessage): boolean {
  const host = (req.headers['host'] ?? '').split(':')[0]?.toLowerCase() ?? '';
  return host === '127.0.0.1' || host === 'localhost';
}

/**
 * INVARIANT #3 — the SINGLE outbound writer. Every payload (health, all P3
 * route handlers, every error) leaves through here and passes redactPayload
 * first. Route modules import this rather than calling res.end themselves, so
 * there is exactly one res.end on the data path.
 */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(redactPayload(body)));
}

// ---------------------------------------------------------------------------
// Routes (P2: health only — P3 extends ROUTES)
// ---------------------------------------------------------------------------

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  clients: BridgeClients,
) => Promise<void> | void;

async function pingSafe(tool: string, clients: BridgeClients): Promise<unknown> {
  try {
    return await readTool(clients, tool);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'unreachable' };
  }
}

const ROUTES: Record<string, Handler> = {
  '/api/health': async (_req, res, _url, clients) => {
    const root = xeniaRoot();
    const [ticketsPing, kbPing] = [
      await pingSafe('xenia-tickets.ping', clients),
      await pingSafe('xenia-kb.ping', clients),
    ];
    const events = readEvents(root);
    const drs = readDecisionRecords(root);
    const approvals = readApprovals(root);
    json(res, 200, {
      ok: true,
      service: 'xenia-observatory-bridge',
      phase: 'P2-core',
      writeTools: WRITE_TOOLS.length, // 0 — asserted by tests
      children: { tickets: ticketsPing, kb: kbPing },
      estate: {
        events: events.events.length,
        eventsSkipped: events.skipped,
        decisionRecords: drs.records.length,
        approvals: approvals.length,
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Server factory (exported for in-process tests)
// ---------------------------------------------------------------------------

export function createBridgeServer(clients: BridgeClients = defaultClients()): Server {
  return createServer((req, res) => {
    // INVARIANT #1 — DNS-rebinding defense
    if (!isLoopbackHost(req)) {
      json(res, 403, { error: 'loopback only' });
      return;
    }
    // INVARIANT #2 — read-only bridge: nothing but GET exists
    if (req.method !== 'GET') {
      json(res, 405, { error: 'read-only bridge — GET only' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const handler = ROUTES[url.pathname];
    if (!handler) {
      json(res, 404, { error: 'not found' });
      return;
    }
    // Wrap in .then so a SYNCHRONOUS throw in a handler is still caught and
    // turned into a (redacted) error response rather than hanging the socket.
    Promise.resolve()
      .then(() => handler(req, res, url, clients))
      .catch((err: unknown) => {
        const status =
          typeof (err as { httpStatus?: number }).httpStatus === 'number'
            ? (err as { httpStatus: number }).httpStatus
            : 500;
        json(res, status, {
          error: err instanceof Error ? err.message.slice(0, 300) : 'internal error',
        });
      });
  });
}

/** Exported so P3 can register endpoints without touching the security shell. */
export function registerRoute(path: string, handler: Handler): void {
  ROUTES[path] = handler;
}

export type { Handler };

// ---------------------------------------------------------------------------
// Port management + main
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
    throw new Error(`XENIA_OBS_BRIDGE_PORT=${PREFERRED_PORT} is already in use.`);
  }
  for (let p = PREFERRED_PORT + 1; p <= PREFERRED_PORT + PORT_MAX_PROBES; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`no free port in ${PREFERRED_PORT}..${PREFERRED_PORT + PORT_MAX_PROBES}`);
}

async function main(): Promise<void> {
  // P3 route registration happens via side-effect import. The specifier is a
  // variable so TS does not resolve it at build time (the module is absent
  // until P3 lands); the catch tolerates its absence.
  const routesModule = './routes.js';
  await import(routesModule).catch(() => undefined);
  const server = createBridgeServer();
  const port = await choosePort();
  server.listen(port, HOST, () => {
    writeFileSync(PORT_FILE, String(port), 'utf8');
    console.log(
      `[xenia-obs] Support Observatory bridge listening on http://${HOST}:${port} ` +
        `(loopback only · read-only · ${READ_TOOLS.length} read tools · ${WRITE_TOOLS.length} write tools)`,
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

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '',
);
if (isMain) {
  void main();
}
