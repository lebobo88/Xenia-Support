# Integration: MCP Servers (xenia-kb, xenia-tickets)

API reference for the two MCP servers that back the Xenia squad's grounded
retrieval and ticket actions.

## Where the server code lives

Both servers are implemented on the **Hydra** side (they share Hydra's
`_pack_shim` runner and `hydra_core.auth.capability`), but they operate
entirely on the **Xenia** repo's working tree via `HYDRA_XENIA_ROOT`
(default `C:/AiAppDeployments/Xenia`):

| Server | Code path | Root env | KB/store path |
|---|---|---|---|
| `xenia-kb` | `Hydra/mcp_servers/xenia_kb/server.py` | `HYDRA_XENIA_ROOT` | `hearth/kb/*.md` + `.kb-index.db` |
| `xenia-tickets` | `Hydra/mcp_servers/xenia_tickets/server.py` | `HYDRA_XENIA_ROOT` | `hearth/tasks/TICKET-*.json` |

Tool names surface natively as `xenia-kb.*` / `xenia-tickets.*` and, through
the Hydra gateway, as `mcp__hydra_gateway__xenia_kb__*` /
`mcp__hydra_gateway__xenia_tickets__*`. The `xenia-tickets` server name
matches the `mcp__.*ticket.*` hook matcher (see [hooks.md](hooks.md)).

A third, thin server — `Hydra/mcp_servers/xenia/` — exposes pack metadata
(`xenia.agent.list/get`, `xenia.skill.*`, `xenia.command.*`,
`xenia.output.read/write`, `xenia.ping`) and is documented in
[hydra.md](hydra.md#mcp-server); it is the AgentMesh health-probe surface,
not a KB/ticket data plane.

---

## xenia-kb — SQLite FTS5 RAG (4 tools)

Index: SQLite FTS5 over `## `-section chunks of `hearth/kb/*.md`, stored at
`hearth/kb/.kb-index.db`, rebuilt lazily when any source file is newer than
the DB or when the file count changes (catches deletions). Staleness
thresholds: `volatile` 90 d, `active` 180 d, `stable` 730 d. Stale docs are
still returned but flagged `stale: true` and demoted (score × 0.01).

### `xenia-kb.search`

| Arg | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | empty → `{"error": "query is required"}` |
| `top_k` | int | no | default 5 |
| `topic_class` | string | no | filter to one class (`volatile`/`active`/`stable`) |

Returns `{ results: [...], total_candidates, query }`. Each result:
`{ doc_id, title, section, as_of_date, topic_class, snippet, score, stale }`.
Results are ordered fresh-first (descending score), stale-last.

Degraded/error behaviour: missing KB dir → `{"error": "KB directory not
found: <path>"}`. FTS5 syntax errors fall back to a `LIKE` scan automatically
(no error surfaced).

### `xenia-kb.get`

| Arg | Type | Required | Notes |
|---|---|---|---|
| `doc_id` | string | yes | matches filename stem or frontmatter `doc_id` |

Returns the full doc: `{ doc_id, title, as_of_date, topic_class, owner,
stale, content }`. Not found → `{"error": "not_found", "doc_id": ...}`.
Empty arg → `{"error": "doc_id is required"}`.

### `xenia-kb.list`

No args. Returns `{ docs: [ { doc_id, title, as_of_date, topic_class, stale }
... ] }`. Missing KB dir → `{ docs: [], error: ... }`.

### `xenia-kb.ping`

No args. Returns `{ ok, root, kb_dir, doc_count, index_fresh }`. Missing KB
dir → `{ ok: false, root, error: "KB directory not found" }`.

---

## xenia-tickets — file-backed ticket bridge (9 tools)

File-backed store: one JSON file per ticket at
`hearth/tasks/TICKET-<id>.json`; the counter at `hearth/tasks/.counter`.
SLA first-response windows: P1 = 60 m, P2 = 240 m, P3 = 480 m, P4 = 960 m.
Statuses: `open, pending, resolved, escalated, closed` (`closed` is
terminal — no resurrect). Priorities: `P1..P4`.

Every typed error has the shape `{"error": {"code": "<CODE>", "message":
"..."}}`.

### `xenia-tickets.create`

| Arg | Type | Required | Notes |
|---|---|---|---|
| `subject` | string | yes | |
| `body` | string | yes | |
| `customer_ref` | string | yes | MUST match `^customer:[0-9a-f]{6,}$` (Article IV) |
| `priority` | string | no | default `P3` |
| `intent` | any | no | |

Returns the full new ticket (with `sla.first_response_due`, `history`,
`recommendations: []`). Errors: `MISSING_FIELD`, `IDENTITY_REQUIRED` (raw
identity passed instead of an opaque hash), `INVALID_FIELD`.

### `xenia-tickets.get`

`{ ticket_id }` → full ticket, or `NOT_FOUND` / `MISSING_FIELD`.

### `xenia-tickets.list`

`{ status?, priority? }` → `{ tickets: [<summary>...], count }`, sorted by
priority then `created_at`. Summaries carry `ticket_id, status, priority,
intent, subject, customer_ref, created_at, updated_at, sla`.

### `xenia-tickets.comment`

`{ ticket_id, body, actor }` → appends a `comment` history entry. Errors:
`MISSING_FIELD`, `NOT_FOUND`.

### `xenia-tickets.update_fields`

`{ ticket_id, fields }` where `fields` may only contain `status`, `priority`,
`intent` (other keys → `INVALID_FIELD`). Status changes are validated against
the legal transition table (illegal → `INVALID_TRANSITION`; `closed` is
terminal). Returns `{ ok, ticket_id, changes, updated_at }`.

### `xenia-tickets.recommend`

`{ ticket_id, action, scope, policy_basis, amount? }` → records a
**recommend-only** entry (`status: pending`) on the ticket. This is how
billing/retention heads (Plutus, Soteria) propose monetary actions without
executing them. Errors: `MISSING_FIELD`, `NOT_FOUND`.

### `xenia-tickets.send_response` (capability-gated)

| Arg | Type | Required | Notes |
|---|---|---|---|
| `ticket_id` | string | yes | |
| `body` | string | yes | the customer-facing text |
| `capability_token` | object/JSON-string | yes (injected by hook) | WS-AUTH; see [auth.md](auth.md) |
| `clearance_token` | object/JSON-string | yes | signed by `sign.py` mint; binds `body` |
| `actor` | string | no | retained for logs; **overridden** by verified identity |
| `approval_id` | string | conditional | required when `body` contains monetary language |

Enforcement order (fail-closed at each step):

1. Field validation + ticket lookup.
2. **WS-AUTH** caller-capability verification (HMAC identity + single-use
   `jti`). Verified `actor_id` must be in `{hermes, escalation-handoff}`.
3. **Clearance token** (signed dict from `sign.py`, HMAC + body binding;
   degraded/unsigned rejected).
4. **PII scan** of the body (HTML-unescape + NFKC normalise; separator-
   stripped SSN/credit-card variants) → `PII_DETECTED` on any hit.
5. **Money/commitment** language → requires a valid Article V approval
   artifact (`APPROVAL-<ticket_id>-*.yaml`, status approved, unexpired,
   `action=send_response`, `scope=monetary`) → else `APPROVAL_REQUIRED`.
6. Append `response` history entry; `open` → `pending`.

Error codes: `MISSING_FIELD`, `NOT_FOUND`, `CALLER_CAPABILITY_INVALID`,
`CALLER_CAPABILITY_REPLAY`, `FORBIDDEN_ACTOR`, `CLEARANCE_INVALID`,
`PII_DETECTED`, `APPROVAL_REQUIRED`.

### `xenia-tickets.execute_approved` (capability-gated)

| Arg | Type | Required | Notes |
|---|---|---|---|
| `ticket_id` | string | yes | |
| `action` | string | yes | must match the approval artifact (case-sensitive) |
| `scope` | string | yes | must match the approval artifact |
| `approval_id` | string | yes | EXACT approval filename stem |
| `capability_token` | object/JSON-string | yes (injected by hook) | WS-AUTH |
| `actor` | string | no | overridden by verified identity |

**Deny-by-default** (constitution Article V, defense-in-depth Layer 0): the
server NEVER executes without a valid, unexpired, matching approval artifact
— even if the hook layer was bypassed. Order: field validation → WS-AUTH
capability verify (verified actor ∈ `{hermes, escalation-handoff}`) → ticket
lookup → `_find_valid_approval` (exact `ticket_id` + `action` + `scope` +
`approval_id` stem, `status: approved`, `issued_by` present, unexpired).

Returns `{ ok, ticket_id, action, scope, approval_id, executed_at }`. The
history entry records both the verified `actor` (executor) and the approval's
`issued_by`. Errors: `MISSING_FIELD`, `NOT_FOUND`,
`CALLER_CAPABILITY_INVALID`, `CALLER_CAPABILITY_REPLAY`, `FORBIDDEN_ACTOR`,
`ARTICLE_V_DENY`.

### `xenia-tickets.ping`

No args. Returns `{ ok, root, open_count }`.

---

## Tool grants by head

Reconciled against `heads.yaml`:

| Head | Granted ticket/KB tools |
|---|---|
| Iris | `create, get, list, comment, update_fields` |
| Metis | `xenia-kb.search/get/list` |
| Asclepius | `xenia-kb.search/get` |
| Soteria | `get, list, comment, recommend` |
| Plutus | `get, comment, recommend`, `xenia-kb.search/get` |
| Hermes | `get, comment, update_fields, send_response, recommend, execute_approved` |

Only **Hermes** (and the `escalation-handoff` slug it owns) holds
`send_response` and `execute_approved` — the two capability-gated tools.
