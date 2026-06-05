/**
 * server/files.ts — read-only readers over the hearth file estate.
 *
 * Sources (UI-SPEC §1): progress/events.jsonl, output/tickets/*.md
 * (DecisionRecords with a fenced ```yaml block), approvals/APPROVAL-*.yaml
 * (flat YAML, mirroring xenia_tickets/_find_valid_approval semantics).
 *
 * STRICTLY read-only: this module MUST never write under hearth/.
 * Tolerant parsing: a malformed line/file is skipped (and counted), never
 * fatal — observability over a partially-corrupt estate beats crashing.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// events.jsonl
// ---------------------------------------------------------------------------

export interface XeniaEvent {
  event_id?: string;
  ts?: string;
  kind?: string;
  agent?: string;
  phase?: string;
  ticket_id?: string | null;
  severity?: string;
  category?: string;
  customer_ref?: string | null;
  outcome?: string | null;
  path?: string;
  sla_state?: string;
  tokens?: { in?: number; out?: number } | null;
  cost_usd?: number | null;
  model_tier?: string | null;
}

export interface EventsResult {
  events: XeniaEvent[];
  skipped: number;
}

export function readEvents(root: string, sinceMs?: number): EventsResult {
  const file = join(root, 'hearth', 'progress', 'events.jsonl');
  if (!existsSync(file)) return { events: [], skipped: 0 };
  const events: XeniaEvent[] = [];
  let skipped = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as XeniaEvent;
      if (sinceMs !== undefined && ev.ts !== undefined) {
        const t = new Date(ev.ts).getTime();
        if (!Number.isNaN(t) && t < sinceMs) continue;
      }
      events.push(ev);
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}

// ---------------------------------------------------------------------------
// DecisionRecords (output/tickets/*.md — first fenced ```yaml block)
// ---------------------------------------------------------------------------

export interface DecisionRecord {
  decision_id?: string;
  ticket_id?: string;
  terminal_state?: string;
  resolution_summary?: string;
  priority?: string;
  intent?: string;
  outcome?: string;
  heads_dispatched?: string[];
  dispatch_count?: number;
  rubric_verdicts?: Array<{
    rubric_id?: string;
    pass?: boolean;
    dims?: Record<string, number>;
    seal?: string;
  }>;
  themis_cycle?: number;
  eunomia_seal?: string;
  sla?: {
    received_at?: string;
    first_response_at?: string;
    sla_state?: string;
    breached?: boolean;
  };
  escalation?: { triggered?: boolean; trigger?: string; packet_ref?: string };
  approval_artifacts?: unknown[];
  injection_findings?: Array<{ ref?: string; owasp?: string[]; disposition?: string }>;
  dissenting_opinions?: unknown[];
  notes?: string;
  /** source file, for linking */
  source_file?: string;
}

const YAML_FENCE = /```yaml\r?\n([\s\S]*?)```/;

export interface DecisionRecordsResult {
  records: DecisionRecord[];
  skipped: number;
}

export function readDecisionRecords(root: string): DecisionRecordsResult {
  const dir = join(root, 'hearth', 'output', 'tickets');
  if (!existsSync(dir)) return { records: [], skipped: 0 };
  const records: DecisionRecord[] = [];
  let skipped = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    try {
      const text = readFileSync(join(dir, name), 'utf8');
      const match = YAML_FENCE.exec(text);
      if (!match || match[1] === undefined) {
        skipped += 1;
        continue;
      }
      const doc = yaml.load(match[1]) as DecisionRecord | null;
      if (doc === null || typeof doc !== 'object') {
        skipped += 1;
        continue;
      }
      doc.source_file = name;
      records.push(doc);
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

// ---------------------------------------------------------------------------
// Approval artifacts (approvals/APPROVAL-*.yaml — flat key: value)
//
// Mirrors xenia_tickets _find_valid_approval parsing posture: flat YAML,
// duplicate security-relevant keys poison the artifact (displayed as
// invalid), expiry computed against now. This reader DISPLAYS status only —
// it never executes anything (Art V).
// ---------------------------------------------------------------------------

export interface ApprovalArtifact {
  approval_file: string;
  ticket_id?: string;
  status?: string;
  action?: string;
  scope?: string;
  issued_by?: string;
  expires_at?: string;
  /** display verdict computed by this reader (no execution semantics) */
  display_state: 'valid' | 'expired' | 'malformed' | 'duplicate-key';
}

const SECURITY_KEYS = ['status', 'expires_at', 'issued_by', 'action', 'scope'];

export function readApprovals(root: string): ApprovalArtifact[] {
  const dir = join(root, 'hearth', 'approvals');
  if (!existsSync(dir)) return [];
  const out: ApprovalArtifact[] = [];
  for (const name of readdirSync(dir).filter(
    (f) => f.startsWith('APPROVAL-') && (f.endsWith('.yaml') || f.endsWith('.yml')),
  )) {
    const artifact: ApprovalArtifact = { approval_file: basename(name), display_state: 'malformed' };
    try {
      const text = readFileSync(join(dir, name), 'utf8');
      const seen = new Map<string, number>();
      const fields: Record<string, string> = {};
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line || !line.includes(':')) continue;
        const idx = line.indexOf(':');
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        seen.set(key, (seen.get(key) ?? 0) + 1);
        fields[key] = value;
      }
      if (fields['ticket_id'] !== undefined) artifact.ticket_id = fields['ticket_id'];
      if (fields['status'] !== undefined) artifact.status = fields['status'];
      if (fields['action'] !== undefined) artifact.action = fields['action'];
      if (fields['scope'] !== undefined) artifact.scope = fields['scope'];
      if (fields['issued_by'] !== undefined) artifact.issued_by = fields['issued_by'];
      if (fields['expires_at'] !== undefined) artifact.expires_at = fields['expires_at'];

      if (SECURITY_KEYS.some((k) => (seen.get(k) ?? 0) > 1)) {
        artifact.display_state = 'duplicate-key';
      } else if (
        artifact.status !== 'approved' ||
        !artifact.issued_by ||
        !artifact.expires_at
      ) {
        artifact.display_state = 'malformed';
      } else {
        const exp = new Date(artifact.expires_at).getTime();
        artifact.display_state =
          Number.isNaN(exp) ? 'malformed' : exp > Date.now() ? 'valid' : 'expired';
      }
    } catch {
      artifact.display_state = 'malformed';
    }
    out.push(artifact);
  }
  return out;
}
