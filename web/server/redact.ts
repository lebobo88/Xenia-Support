/**
 * server/redact.ts — Layer-4 redaction chokepoint (Art IV §2).
 *
 * Implements web/docs/REDACTION-POLICY.md exactly (P1, HITL-approved).
 * Pure (no I/O). Fail-closed: any error on a field collapses that field to
 * '[REDACTED]'. Default-scrub posture: every string NOT under a keep-list
 * key gets the regex scrub.
 */

// ---------------------------------------------------------------------------
// Keep-list — keys whose string values pass verbatim (policy table 1)
// ---------------------------------------------------------------------------

const KEEP_KEYS = new Set<string>([
  // identifiers
  'ticket_id', 'doc_id', 'decision_id', 'event_id', 'attack_id', 'approval_file',
  'rubric_id', 'ref', 'packet_ref', 'path', 'section',
  // enums & flags
  'status', 'priority', 'intent', 'kind', 'topic_class', 'terminal_state',
  'sla_state', 'seal', 'eunomia_seal', 'outcome', 'phase', 'severity',
  'category', 'disposition', 'action', 'scope', 'service', 'state', 'class',
  // timestamps
  'ts', 'created_at', 'updated_at', 'as_of', 'as_of_date', 'received_at',
  'first_response_at', 'first_response_due', 'expires_at', 'executed_at',
  'issued_at', 'indexed_at',
  // system actor names (head names / 'system' — never operator email)
  'agent', 'actor', 'owner', 'heads_dispatched', 'model_tier',
  // accountability exemption (policy table 1 last row; NB-6 §7.2):
  // approval issued_by is staff personal data kept deliberately
  'issued_by',
]);

/** customer_ref keeps ONLY the opaque shape; anything else is invalid. */
const OPAQUE_REF = /^customer:[0-9a-f]{6,}$/;

// ---------------------------------------------------------------------------
// Scrub regexes (policy table 2)
// ---------------------------------------------------------------------------

const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Tolerates +CC, (NPA), and -. space separators; anchors on the final digit.
const RE_PHONE = /(\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g;
const RE_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// 13–19 digits, separator-tolerant, but MUST start and end on a digit so a
// trailing space/dash is never swallowed into the [PAN] replacement.
const RE_CARDISH = /\b\d(?:[ -]?\d){12,18}\b/g;
const RE_IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const RE_CRED_KV = /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*\S+/gi;
const RE_CRED_PREFIX = /\b(sk|pk|ghp|xox[bap])-[A-Za-z0-9_-]{16,}\b/g;
const RE_ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Ct|Court|Way)\b\.?/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Scrub PII patterns from a free-text string (policy table 2). */
export function scrubText(input: string): string {
  let s = input;
  s = s.replace(RE_CRED_KV, '[CREDENTIAL]');
  s = s.replace(RE_CRED_PREFIX, '[CREDENTIAL]');
  s = s.replace(RE_EMAIL, '[EMAIL]');
  s = s.replace(RE_IBAN, '[IBAN]');
  s = s.replace(RE_SSN, '[SSN]');
  // Card numbers: only replace when Luhn-valid (policy: Luhn-validate first)
  s = s.replace(RE_CARDISH, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return '[PAN]';
    return match;
  });
  s = s.replace(RE_PHONE, '[PHONE]');
  s = s.replace(RE_ADDRESS, '[ADDRESS]');
  return s;
}

// ---------------------------------------------------------------------------
// Recursive payload redactor
// ---------------------------------------------------------------------------

function redactValue(key: string | null, value: unknown): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      if (key === 'customer_ref' || key === 'customer') {
        return OPAQUE_REF.test(value) ? value : '[INVALID-REF]';
      }
      if (key !== null && KEEP_KEYS.has(key)) return value;
      return scrubText(value);
    }

    if (Array.isArray(value)) {
      // Arrays under a keep-key (e.g. heads_dispatched) keep string members
      // only if they are simple tokens; nested objects still recurse.
      return value.map((v) =>
        typeof v === 'string' && key !== null && KEEP_KEYS.has(key)
          ? v
          : redactValue(key, v),
      );
    }

    if (typeof value === 'object') {
      // Fail-closed for exotic object types (Date, Map, Set, RegExp, class
      // instances): they have no enumerable own string keys, so the generic
      // branch would emit `{}` and silently drop content. Only PLAIN objects
      // (the shapes our JSON-derived payloads actually use) are recursed.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        return '[REDACTED]';
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactValue(k, v);
      }
      return out;
    }

    // functions/symbols/bigints have no business in a payload — fail closed
    return '[REDACTED]';
  } catch {
    return '[REDACTED]'; // fail-closed rule 1
  }
}

/**
 * The chokepoint. Every payload leaving the bridge passes through here
 * (called inside the single json() writer in server/index.ts).
 */
export function redactPayload<T>(payload: T): unknown {
  return redactValue(null, payload);
}
