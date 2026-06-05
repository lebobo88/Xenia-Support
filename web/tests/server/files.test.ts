/**
 * tests/server/files.test.ts — hearth file readers (tolerant, read-only).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvents, readDecisionRecords, readApprovals } from '../../server/files.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'xenia-files-'));
  mkdirSync(join(root, 'hearth', 'progress'), { recursive: true });
  mkdirSync(join(root, 'hearth', 'output', 'tickets'), { recursive: true });
  mkdirSync(join(root, 'hearth', 'approvals'), { recursive: true });

  writeFileSync(
    join(root, 'hearth', 'progress', 'events.jsonl'),
    [
      JSON.stringify({ event_id: 'e1', ts: '2026-06-01T00:00:00Z', kind: 'xenia.ticket_resolved', cost_usd: 0.5 }),
      'NOT JSON {{{',
      JSON.stringify({ event_id: 'e2', ts: '2026-06-04T00:00:00Z', kind: 'xenia.escalated' }),
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(root, 'hearth', 'output', 'tickets', 'TICKET-1-2026-06-01.md'),
    [
      '# DecisionRecord — TICKET-1',
      '',
      '```yaml',
      'decision_id: DR-1',
      'ticket_id: TICKET-1',
      'terminal_state: RESOLVED',
      'rubric_verdicts:',
      '  - {rubric_id: empathy-tone-required, pass: true, dims: {clarity: 3}}',
      'sla:',
      '  received_at: 2026-06-01T00:00:00Z',
      '  first_response_at: 2026-06-01T00:30:00Z',
      '  sla_state: ok',
      '  breached: false',
      'escalation:',
      '  triggered: false',
      '```',
    ].join('\n'),
  );
  writeFileSync(join(root, 'hearth', 'output', 'tickets', 'no-yaml.md'), '# no block here');

  writeFileSync(
    join(root, 'hearth', 'approvals', 'APPROVAL-TICKET-1-refund.yaml'),
    ['ticket_id: TICKET-1', 'status: approved', 'action: refund', 'scope: order-42', 'issued_by: ops-lead', 'expires_at: 2099-01-01T00:00:00Z'].join('\n'),
  );
  writeFileSync(
    join(root, 'hearth', 'approvals', 'APPROVAL-TICKET-2-dup.yaml'),
    ['ticket_id: TICKET-2', 'status: approved', 'status: approved', 'action: refund', 'scope: x', 'issued_by: a', 'expires_at: 2099-01-01T00:00:00Z'].join('\n'),
  );
  writeFileSync(
    join(root, 'hearth', 'approvals', 'APPROVAL-TICKET-3-expired.yaml'),
    ['ticket_id: TICKET-3', 'status: approved', 'action: credit', 'scope: y', 'issued_by: b', 'expires_at: 2020-01-01T00:00:00Z'].join('\n'),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readEvents', () => {
  it('parses valid lines, counts skipped garbage', () => {
    const { events, skipped } = readEvents(root);
    expect(events).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('honors the since cutoff', () => {
    const { events } = readEvents(root, new Date('2026-06-03T00:00:00Z').getTime());
    expect(events).toHaveLength(1);
    expect(events[0]!.event_id).toBe('e2');
  });
});

describe('readDecisionRecords', () => {
  it('extracts the fenced yaml block; skips files without one', () => {
    const { records, skipped } = readDecisionRecords(root);
    expect(records).toHaveLength(1);
    expect(skipped).toBe(1);
    const dr = records[0]!;
    expect(dr.decision_id).toBe('DR-1');
    expect(dr.terminal_state).toBe('RESOLVED');
    expect(dr.rubric_verdicts?.[0]?.dims?.['clarity']).toBe(3);
    expect(dr.sla?.breached).toBe(false);
    expect(dr.source_file).toBe('TICKET-1-2026-06-01.md');
  });
});

describe('readApprovals (display-only — never executes)', () => {
  it('classifies valid / duplicate-key / expired artifacts', () => {
    const approvals = readApprovals(root);
    const byFile = Object.fromEntries(approvals.map((a) => [a.approval_file, a]));
    expect(byFile['APPROVAL-TICKET-1-refund.yaml']?.display_state).toBe('valid');
    expect(byFile['APPROVAL-TICKET-1-refund.yaml']?.issued_by).toBe('ops-lead');
    expect(byFile['APPROVAL-TICKET-2-dup.yaml']?.display_state).toBe('duplicate-key');
    expect(byFile['APPROVAL-TICKET-3-expired.yaml']?.display_state).toBe('expired');
  });
});
