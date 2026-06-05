/**
 * tests/server/redact.test.ts — Layer-4 redaction unit suite + corpus pen-check.
 * Policy: web/docs/REDACTION-POLICY.md (P1, HITL-approved).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scrubText, redactPayload } from '../../server/redact.js';

describe('scrubText — policy table 2', () => {
  it('emails', () => {
    expect(scrubText('contact me at jane.doe+test@example.co.uk please')).toBe(
      'contact me at [EMAIL] please',
    );
  });
  it('phones (NANP + separators)', () => {
    expect(scrubText('call 555-867-5309 today')).toContain('[PHONE]');
    expect(scrubText('call +1 (555) 867 5309 today')).toContain('[PHONE]');
  });
  it('SSNs', () => {
    expect(scrubText('ssn 123-45-6789.')).toBe('ssn [SSN].');
  });
  it('payment cards only when Luhn-valid', () => {
    expect(scrubText('card 4111 1111 1111 1111 thanks')).toBe('card [PAN] thanks'); // valid Visa test number
    expect(scrubText('order id 1234 5678 9012 3456')).not.toContain('[PAN]'); // fails Luhn
  });
  it('IBANs', () => {
    expect(scrubText('pay to DE89370400440532013000 now')).toBe('pay to [IBAN] now');
  });
  it('credential shapes', () => {
    expect(scrubText('my api_key: abc123SECRETxyz')).toContain('[CREDENTIAL]');
    expect(scrubText('token sk-aaaaaaaaaaaaaaaaaaaaaaaa leaked')).toContain('[CREDENTIAL]');
  });
  it('street addresses', () => {
    expect(scrubText('I live at 1234 Maple Grove Street.')).toContain('[ADDRESS]');
  });
});

describe('redactPayload — keep-list & default-scrub', () => {
  it('keeps identifiers/enums/timestamps verbatim', () => {
    const out = redactPayload({
      ticket_id: '000123',
      status: 'open',
      priority: 'P1',
      created_at: '2026-06-05T12:00:00Z',
    }) as Record<string, unknown>;
    expect(out).toEqual({
      ticket_id: '000123',
      status: 'open',
      priority: 'P1',
      created_at: '2026-06-05T12:00:00Z',
    });
  });

  it('keeps OPAQUE customer_ref but kills non-opaque refs', () => {
    expect(
      (redactPayload({ customer_ref: 'customer:2f8b6c44' }) as { customer_ref: string })
        .customer_ref,
    ).toBe('customer:2f8b6c44');
    expect(
      (redactPayload({ customer_ref: 'jane@example.com' }) as { customer_ref: string })
        .customer_ref,
    ).toBe('[INVALID-REF]');
  });

  it('keeps approval issued_by verbatim (accountability exemption, NB-6 §7.2)', () => {
    const out = redactPayload({ issued_by: 'ops-lead@example.com' }) as { issued_by: string };
    expect(out.issued_by).toBe('ops-lead@example.com');
  });

  it('default-scrubs UNKNOWN string fields (default-scrub posture)', () => {
    const out = redactPayload({ some_new_field: 'reach me at foo@bar.com' }) as Record<
      string,
      string
    >;
    expect(out['some_new_field']).toBe('reach me at [EMAIL]');
  });

  it('scrubs free-text fields: subject, history bodies, snippets', () => {
    const out = redactPayload({
      subject: 'refund to jane@x.io',
      history: [{ ts: 't', actor: 'customer:abc123', kind: 'created', body: 'my ssn is 123-45-6789' }],
      snippet: 'card 4111 1111 1111 1111',
    }) as { subject: string; history: Array<{ body: string }>; snippet: string };
    expect(out.subject).toBe('refund to [EMAIL]');
    expect(out.history[0]!.body).toBe('my ssn is [SSN]');
    expect(out.snippet).toBe('card [PAN]');
  });

  it('passes numbers/booleans/null; fail-closes exotic types', () => {
    const out = redactPayload({
      cost_usd: 1.23,
      breached: false,
      outcome: null,
      weird: (() => 1) as unknown,
    }) as Record<string, unknown>;
    expect(out['cost_usd']).toBe(1.23);
    expect(out['breached']).toBe(false);
    expect(out['outcome']).toBeNull();
    expect(out['weird']).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Pen-check: the redteam corpus must come out clean
// ---------------------------------------------------------------------------

const CORPUS = resolve(__dirname, '..', '..', '..', 'hearth', 'redteam', 'attack-corpus.jsonl');

const LEAK_SCAN = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // any surviving email
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
];

describe.skipIf(!existsSync(CORPUS))('redaction pen-check vs hearth/redteam/attack-corpus.jsonl', () => {
  it('no email/SSN survives redaction of any attack ticket_body', () => {
    const lines = readFileSync(CORPUS, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const attack = JSON.parse(line) as { ticket_body?: string; attack_id?: string };
      if (!attack.ticket_body) continue;
      const out = redactPayload({
        subject: attack.ticket_body,
        history: [{ ts: 'x', actor: 'customer:abc123', kind: 'created', body: attack.ticket_body }],
      }) as { subject: string; history: Array<{ body: string }> };
      for (const re of LEAK_SCAN) {
        expect(out.subject, `${attack.attack_id} subject leaked ${re}`).not.toMatch(re);
        expect(out.history[0]!.body, `${attack.attack_id} body leaked ${re}`).not.toMatch(re);
      }
    }
  });

  it('synthetic PII gauntlet comes out clean', () => {
    const gauntlet =
      'Jane Doe, jane.doe@corp.example, +1 555-123-4567, SSN 987-65-4320, ' +
      'card 5500 0000 0000 0004, IBAN GB82WEST12345698765432, ' +
      'api_key: sk-livefake1234567890abcdef, 1600 Pennsylvania Avenue';
    const out = (redactPayload({ body: gauntlet }) as { body: string }).body;
    expect(out).not.toMatch(/@corp\.example/);
    expect(out).not.toMatch(/555-123-4567/);
    expect(out).not.toMatch(/987-65-4320/);
    expect(out).not.toMatch(/5500 0000 0000 0004/);
    expect(out).not.toMatch(/GB82WEST/);
    expect(out).not.toMatch(/sk-livefake/);
  });
});
