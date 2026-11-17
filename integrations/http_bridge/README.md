# Xenia voice bridge (HTTP shim)

A small FastAPI service that lets a **cloud voice agent** open and annotate
Xenia tickets. It exists because the `xenia-tickets` MCP server is
file-backed and local: ElevenLabs runs in their cloud and cannot reach a
stdio MCP server on a workstation.

Version 2.0 — rewritten after an adversarial review. See "What changed" at
the bottom for the defects that drove it.

## Schema: verified against the server source

The ticket shape was checked field-by-field against
`Hydra/mcp_servers/xenia_tickets/server.py` (the `create` and `comment`
handlers and `_save_ticket`) on 2026-09-07. What that diff found:

| Thing | Server | This bridge |
|---|---|---|
| Ticket id | `str(n).zfill(6)` | six-digit, normalised on input |
| History entry keys | `ts`, `actor`, `kind`, `body` | same (was `at`/`type` — fixed) |
| Created entry actor | the `customer_ref` | same (was `intake-router` — fixed) |
| `sla` | `first_response_due` **and** `breached: false` | same (`breached` was missing — fixed) |
| Top-level `body` | not stored; body lives in `history[0].body` | same (a top-level `body` was being written — removed) |
| Status at create | always `open` | always `open` |

`channel` and `voice_handle` are additive keys this bridge writes. The
server's `_load_ticket` is a plain `json.loads` and nothing rejects unknown
ticket keys, so they ride along harmlessly.

`XENIA_SCHEMA_VERIFIED=1` is still required to start. Keep the gate: it is
what forces a re-diff the next time the server's schema moves.

**Two things the server does that this bridge does not copy, deliberately.**
Its `_next_ticket_id` uses a `threading.Lock`, and its `_save_ticket` writes
in place with no temp-file rename — so the server itself is not safe against
a second process or a crash mid-write. This bridge takes an OS-level lock and
writes atomically. That protects the bridge's own writes; it does not protect
you from the server racing itself. Worth fixing there too.

## What it deliberately does not expose

| Operation | Exposed? | Why |
|---|---|---|
| `create` | yes | intake privilege (Iris-level) |
| `comment` | yes, scoped to the call that opened the ticket | reversible, no field changes |
| `get` / `list` | **no** | a public endpoint must not enumerate customers |
| `update_fields` | **no** | status/priority are the pipeline's to move |
| `recommend` | **no** | Plutus/Soteria surface, not a voice surface |
| `send_response` | **no** | capability-gated, Hermes + WS-AUTH only |
| `execute_approved` | **no** | Article V; nothing internet-reachable executes money |

Nothing this service can do is irreversible, so a stolen bearer token
costs you spam tickets, not a refund.

## Identity discipline (Article IV)

Two layers, because the agent's free text is the leak nobody predicts:

1. **Structured fields.** `caller_name` and `caller_contact` are hashed
   into a salted `customer:<hash>` ref. Only the hash reaches the ticket.
2. **Free text.** Every narrative field — `summary`, `scope`, `location`,
   `unconfirmed`, `shoot_type`, `shoot_date`, and comment bodies — is
   scrubbed of emails, phone numbers, and card/SSN shapes before it is
   written (HTML-unescaped and NFKC-normalised first, so encoded and
   separator-stripped variants are caught). A spoken **name** is not
   pattern-matchable, so the shim additionally rejects any request whose
   `caller_name` or `caller_contact` appears inside the narrative.

The raw contact appears in the operator notification email and nowhere
else. The voice agent's prompt also instructs it to keep names and
numbers out of `summary` — that instruction is a courtesy; this service
does not rely on it.

## Comment scoping

`create` returns a 24-character `handle`. `comment` requires it. Without
that, a token holder could append arbitrary text to any ticket in the
store — including Hermes escalations — and use 404-vs-200 to enumerate
it. Every rejection returns the same 404 as a miss, so there is no oracle.
Comments on `closed` tickets are refused: closed is terminal.

## Run it

```bash
pip install -r requirements.txt        # Python 3.10+
cp .env.example .env                   # fill in token, salt, schema gate
set -a && . ./.env && set +a
uvicorn app:app --host 127.0.0.1 --port 8137 --workers 1
```

**`--workers 1` is required.** Counter allocation takes an OS-level file
lock, which is safe across processes, but running single-worker keeps the
contention window small and matches how the MCP server behaves. A voice
line does not need concurrency.

Put it behind TLS (nginx/Caddy) and expose only `/v1/voice/*` and
`/healthz`. **Required proxy config**, not optional:

```nginx
client_max_body_size 64k;              # chunked bodies carry no Content-Length
limit_req zone=voice burst=5 nodelay;  # a phone line needs a few req/min
```

## Endpoints

### `POST /v1/voice/ticket`

```json
{
  "subject": "Headshots for a law firm, October",
  "summary": "Caller asked about headshots for twelve attorneys...",
  "intent": "new_inquiry",
  "priority": "P3",
  "caller_name": "Dana Whitfield",
  "caller_contact": "313-555-0147",
  "shoot_type": "headshots",
  "shoot_date": "mid-October",
  "location": "Southfield",
  "scope": "twelve attorneys, on-site, for the firm's website",
  "sentiment": "neutral",
  "escalate": false,
  "unconfirmed": "Asked for a per-head rate; told her Rob quotes after the discovery call."
}
```

Returns `{ok, reference, handle, priority, message}`. `reference` is the
speakable form (`TICKET-000123`) — hand the agent that, not a bare id.

`escalate: true` lifts the priority one step (P4→P2, P3→P2, P2→P1) and
appends an `escalation_requested` history entry. The ticket is still
created as `open`: `update_fields` is the validated status mover, and
creating directly into `escalated` would bypass the transition table.

### `POST /v1/voice/comment`

`{ "ticket_id": "000123", "handle": "<from create>", "body": "..." }`
Unpadded ids are normalised, because an LLM echoing `000123` will
sometimes send `123`.

### `GET /healthz` / `GET /v1/voice/status`

`/healthz` is unauthenticated and returns `{"ok": true}` and nothing else.
Readiness detail — store writability (probed with a real write, since
`os.access` is meaningless for directories on Windows) — is on the
authenticated `/v1/voice/status`.

## Errors

One shape for everything, including validation failures and unhandled
exceptions:

```json
{"ok": false, "error": {"code": "NOT_FOUND", "message": "..."}}
```

`code` is a string symbol matching the store's convention
(`INVALID_FIELD`, `UNAUTHORIZED`, `NOT_FOUND`, `MISSING_FIELD`,
`REQUEST_TOO_LARGE`, `UNAVAILABLE`, `INTERNAL`), and `message` is written
to be actionable by the voice agent rather than by a developer.

## Deployment checklist

- [ ] Schema verified against `xenia-tickets.get`, `XENIA_SCHEMA_VERIFIED=1`
- [ ] `HYDRA_XENIA_ROOT` points at the real Xenia checkout
- [ ] `XENIA_BRIDGE_TOKEN` and `XENIA_IDENTITY_SALT` set, 48+ random bytes each
- [ ] TLS in front; `client_max_body_size 64k`; rate limit configured
- [ ] `--workers 1`
- [ ] `/v1/voice/status` returns `store_writable: true`
- [ ] `python test_logic.py` passes
- [ ] TestClient tests added against the real FastAPI app (see below)
- [ ] SMTP set, or accept that escalations are queue-only

## Testing

`test_logic.py` runs without FastAPI installed by stubbing it, and unlike
its first version the stubs **do** enforce length caps, Literal enums,
required fields and field validators — the previous no-op stubs let a PII
bug pass a green suite. 57 checks, covering the store, id normalisation,
the scrubber, identity rejection, escalation lifts, comment scoping,
closed-ticket terminality, auth edge cases, and counter corruption.

It is still not enough. Before launch, install the requirements and add
`fastapi.testclient.TestClient` tests so the middleware, dependencies and
exception handlers are actually in the loop, plus a multiprocess test that
forks N concurrent creates and asserts N distinct ticket files.

## What changed in 2.0

Driven by review findings, in rough order of severity:

- Ticket ids are normalised through one function; `123` and `000123` no
  longer resolve to different files.
- Counter allocation takes an **OS-level** lock, not a `threading.Lock`
  that other processes cannot see; the counter is fsynced and written
  atomically, and a corrupt counter now fails closed instead of resetting
  to zero and overwriting the oldest ticket.
- Free-text PII scrubbing and the identity-in-narrative rejection (the
  first version wrote a phone number straight into the ticket if the agent
  put it in `summary` — and its test suite passed).
- Bearer comparison over bytes: a non-ASCII `Authorization` header used to
  raise `TypeError` and return an unauthenticated 500.
- A token shorter than 32 characters counts as unconfigured, so a stray
  whitespace value cannot become the entire perimeter.
- SMTP moved to a background task; the whole of `notify` is inside its
  `try`, so a newline in a subject can no longer 500 a request whose
  ticket was already written.
- Comment scoping by handle, plus the `closed` check.
- Typed error codes, and handlers for validation errors and unhandled
  exceptions, which previously escaped as pydantic or Starlette defaults.
- Escalation lifts every priority, not only P3.
- Request-size middleware, since body buffering happens before auth.
- `/healthz` no longer advertises configuration state, and readiness
  probes the tasks directory with a real write.
