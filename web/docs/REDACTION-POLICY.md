# Layer-4 Redaction Field Policy (P1 — HITL-gated)

Support-constitution **Article IV** mandates layered redaction; the bridge is
**Layer 4** (re-validation at the egress boundary). This layer ASSUMES
upstream layers (agent discipline, Eunomia, hooks) already redacted — it
exists to catch leaks and MUST fail closed.

## Chokepoint

One function — `server/redact.ts: redactPayload()` — applied inside the
single `json()` writer. There MUST be no other path that serializes data to
the browser. A test asserts the only `res.end` call site is `json()`.

## Keep verbatim (never scrubbed)

| Field class | Examples | Why safe |
|---|---|---|
| Opaque customer refs | `customer:2f8b6c44` | Pseudonymous by construction (Art IV) — displayed as-is, never resolved |
| Identifiers | `ticket_id`, `doc_id`, `decision_id`, `event_id`, approval filenames | System identifiers, no personal content |
| Enums & flags | status, priority, intent, kind, topic_class, terminal_state, sla_state, seals, stale | Closed vocabularies |
| Timestamps & numerics | created_at, first_response_due, KPI values, rubric dims, cost_usd, tokens | Non-personal |
| Agent/actor system names | `hestia`, `system`, head names | Internal system identities (NOT operator email — which never appears in these artifacts) |

## Scrub (regex pass over every free-text field)

Applied to: `subject`, `history[].body`, `recommendations[].policy_basis`,
KB `snippet`/`content`, DecisionRecord `resolution_summary`/`notes`/`trigger`,
and ANY string field not on the keep-list (default-scrub posture).

| Pattern | Regex (case-insensitive where applicable) | Replacement |
|---|---|---|
| Email | `[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}` | `[EMAIL]` |
| Phone (E.164/NANP, separators) | `(\+?\d{1,3}[-. (]?)?\d{3}[-. )]?\d{3}[-. ]?\d{4}\b` | `[PHONE]` |
| SSN | `\b\d{3}-\d{2}-\d{4}\b` | `[SSN]` |
| Payment card (13–19 digits, separator-tolerant) + Luhn check | `\b(?:\d[ -]?){13,19}\b` → Luhn-validate before replacing | `[PAN]` |
| IBAN | `\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b` | `[IBAN]` |
| Credential shapes | `(api[_-]?key|secret|token|password)\s*[:=]\s*\S+` ; `\b(sk|pk|ghp|xox[bap])-[A-Za-z0-9_-]{16,}\b` | `[CREDENTIAL]` |
| Street address heuristic | `\b\d{1,5}\s+([A-Z][a-z]+\s){1,3}(St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Ct|Court|Way)\b\.?` | `[ADDRESS]` |
| Raw (non-opaque) email-like customer refs | any `customer_ref` NOT matching `^customer:[0-9a-f]{6,}$` | `[INVALID-REF]` |

## Fail-closed rules

1. Regex engine error or non-string where a string is expected → field becomes `[REDACTED]`.
2. Unknown object keys carrying string values → scrubbed by default (keep-list is the only exemption).
3. Scrub runs AFTER serialization shaping, immediately before write — nothing can append post-scrub.
4. The redactor MUST be pure (no I/O) and unit-tested against
   `hearth/redteam/attack-corpus.jsonl` + synthetic PII fixtures (P2 test, P5 pen-check).

## Known accepted residual

Free-text may contain novel PII shapes no regex catches (names in prose,
unusual formats). Mitigations: upstream Eunomia clearance is the primary
control; this layer is backstop; UI is loopback-only display with no export
endpoints; repo is private. Residual risk accepted at the P1 HITL gate.
