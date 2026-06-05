/**
 * server/xenia-client.ts — stdio MCP clients for the two python servers.
 *
 * Mirrors the sibling MeshClient pattern (AgentMesh web/server/mesh-client.ts):
 * spawn the server as a child process, JSON-RPC over stdio (loopback-only by
 * construction), single-flight mutex, one busy-retry. One client per server:
 * xenia-tickets and xenia-kb (Hydra-hosted, HYDRA_XENIA_ROOT into Xenia).
 *
 * Tool calls are gated by server/whitelist.ts BEFORE reaching this client
 * (and there are no write tools to call — UI-SPEC §3).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Roots — overridable for tests
// ---------------------------------------------------------------------------

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..'); // web/server → Xenia root
}

export function hydraRoot(): string {
  return process.env['HYDRA_ROOT'] ?? 'C:/AiAppDeployments/Hydra';
}

export function xeniaRoot(): string {
  return process.env['HYDRA_XENIA_ROOT'] ?? repoRoot();
}

// ---------------------------------------------------------------------------
// Fixed read envelope (UI-SPEC §2) — browser can never influence this
// ---------------------------------------------------------------------------

export function observatoryEnvelope(): Record<string, unknown> {
  return {
    actor: 'xenia-observatory',
    project: 'Xenia',
    traceId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

// ---------------------------------------------------------------------------
// XeniaMcpClient
// ---------------------------------------------------------------------------

export type ServerKind = 'xenia_tickets' | 'xenia_kb';

export class XeniaMcpClient {
  private proc: (ChildProcess & { stdin: Writable; stdout: Readable }) | null = null;
  private nextId = 1;
  private buffer = '';
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private callChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly kind: ServerKind) {}

  get connected(): boolean {
    return this.proc !== null;
  }

  async connect(): Promise<void> {
    const cwd = hydraRoot();
    if (!existsSync(cwd)) {
      throw new Error(`Hydra root not found at ${cwd} (set HYDRA_ROOT)`);
    }
    const p = spawn('python', ['-m', `mcp_servers.${this.kind}`], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...process.env,
        PYTHONPATH: cwd,
        HYDRA_XENIA_ROOT: xeniaRoot(),
      },
    });
    if (!p.stdin || !p.stdout) throw new Error(`failed to attach stdio to ${this.kind}`);
    this.proc = p as ChildProcess & { stdin: Writable; stdout: Readable };
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onChunk(chunk));
    this.proc.on('exit', () => {
      this.proc = null;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`${this.kind} exited`));
      }
      this.pending.clear();
    });

    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'xenia-observatory', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
  }

  /** Call a whitelisted tool. The envelope is fixed server-side. */
  async call<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected) await this.connect();
    return this.serialize<T>(async () => {
      const result = (await this.send('tools/call', {
        name: tool,
        arguments: { ...args, envelope: observatoryEnvelope() },
      })) as { content?: Array<{ text?: string }>; isError?: boolean };
      const text = result.content?.[0]?.text ?? '{}';
      const parsed = JSON.parse(text) as unknown;
      if (result.isError) {
        throw new Error(
          typeof (parsed as { error?: { message?: string } }).error === 'object'
            ? JSON.stringify((parsed as { error: unknown }).error)
            : JSON.stringify(parsed),
        );
      }
      return parsed as T;
    });
  }

  async close(): Promise<void> {
    if (!this.proc) return;
    this.proc.stdin.end();
    this.proc.kill();
    this.proc = null;
  }

  // -------------------------------------------------------------------------

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.callChain.then(fn, fn) as Promise<T>;
    this.callChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error(`${this.kind} not connected`));
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.proc!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message: string };
        };
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) handler.reject(new Error(msg.error.message));
          else handler.resolve(msg.result);
        }
      } catch {
        /* non-JSON line — skip */
      }
    }
  }
}
