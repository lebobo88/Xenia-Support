# Xenia Support Observatory — UI Specification (P1)

Campaign `xenia-observability-ui`, Hydra workflow `8ce793bd-7004-43bd-a9cc-56af09bd50d0`.
RFC 2119 keywords are normative. Read-only v1: the UI MUST NOT expose any
write path (support-constitution Art V; NB-6 — see `NB-6-data-flow-map.md`).

## 1. Topology

```
Browser (127.0.0.1:5197, Vite) ── /api proxy ──> Bridge (127.0.0.1:8791, Node)
                                                   ├─ stdio MCP child: python -m mcp_servers.xenia_tickets (cwd Hydra)
                                                   ├─ stdio MCP child: python -m mcp_servers.xenia_kb      (cwd Hydra)
                                                   └─ file readers (read-only) under HYDRA_XENIA_ROOT/hearth/:
                                                        progress/events.jsonl · output/tickets/*.md · approvals/*.yaml
```

- The bridge MUST bind 127.0.0.1 only and MUST reject non-loopback Host headers.
- Every outbound payload MUST pass the Layer-4 redaction chokepoint
  (`server/redact.ts`, see `REDACTION-POLICY.md`) inside the single `json()` writer.
- Single-flight mutex per MCP child; one busy-retry (sibling pattern).

## 2. Envelopes

- Read envelope (fixed, injected server-side): `actor: 'xenia-observatory'`,
  `project: 'Xenia'`, traceId per call. The browser MUST NOT be able to
  influence envelope fields.
- There is NO write envelope in v1 (no write tools exist).

## 3. Tool whitelist (frozen)

| Direction | Tools |
|---|---|
| READ | `xenia-tickets.list`, `xenia-tickets.get`, `xenia-tickets.ping`, `xenia-kb.list`, `xenia-kb.search`, `xenia-kb.get`, `xenia-kb.ping` |
| WRITE | **(empty — frozen; asserted by test)** |

Forbidden-verb denylist (defense-in-depth): any tool name containing
`.create`, `.comment`, `.update`, `.send`, `.recommend`, `.execute`, `.delete`
MUST be rejected even if mistakenly whitelisted.

## 4. Endpoints (bridge)

| Endpoint | Source | Notes |
|---|---|---|
| `GET /api/health` | bridge + both MCP pings | service, phase, children status, writeTools:0 |
| `GET /api/queue?status=&priority=` | `xenia-tickets.list` | queue rows; SLA countdown computed bridge-side from `first_response_due` |
| `GET /api/ticket/:id` | `xenia-tickets.get` + DecisionRecord file + approval files | full redacted ticket: history timeline, recommendations, DR verdicts/seals/injection findings, approval-artifact status (read-only display, path + status + issued_by + expires_at) |
| `GET /api/kpi/snapshot?period=30d` | `server/kpi.ts` over events.jsonl + DecisionRecords | full generate.py KPI contract (parity-tested) |
| `GET /api/kb/health` | `xenia-kb.list` + `ping` | docs w/ as_of, topic_class, stale (90/180/730d), index_fresh, gap velocity |
| `GET /api/hitl/aged` | events.jsonl + DecisionRecords | open escalations (no subsequent resolve) sorted by age |

All endpoints are GET. POST/PUT/DELETE MUST return 405.

## 5. Views (v1)

1. **Queue** — table: ticket_id, priority badge, status, intent, opaque
   customer ref, subject (redacted), created_at, SLA countdown / `BREACHED`
   badge. Default sort: P1 first, oldest first (matches sibling tool sort).
2. **Ticket detail** — redacted history timeline ({ts, actor, kind, body});
   recommendations with `recommend-only` framing (action, scope, amount,
   policy_basis, status badge); DecisionRecord panel (terminal_state, rubric
   verdicts + dims, themis_cycle, eunomia_seal, injection findings w/ OWASP
   refs, dissents); approval artifacts panel (READ-ONLY: filename, status,
   issued_by, expires_at — explicit copy: "approvals are issued as YAML
   artifacts by a human; this console cannot create or approve").
3. **KPI dashboard** — containment + false-deflection PAIRED (anti-Goodhart:
   never show one without the other); SLA attainment per severity; AHT
   median/mean; FCR proxy; escalation precision; cost-per-resolution with
   coverage % banner (<80% coverage ⇒ prominent "partial data" warning) and
   tier-laundering flags; KB-gap velocity; worst-3 runs; per-intent table.
4. **KB health** — doc table (doc_id, title, as_of, topic_class, stale flag
   with threshold context), index_fresh indicator, doc_count.
5. **HITL aged** — open escalations: ticket_id, trigger, age (h), severity;
   fresh/warn/old coloring (≤4h / ≤24h / >24h).

States per view (sibling 8-state bar, minimum): loading · live · empty ·
error · offline. UI MUST poll (5–10 s) — no websockets in v1.

## 6. Out of scope (v1)

Writes of any kind; approval creation; VoC narrative view; multi-period
trends; auth beyond loopback; any non-loopback exposure; export/download
endpoints (NB-6: ticket-derived data stays on the machine — no CSV/JSON
download buttons in v1).

## 7. Test bar

Mirror AgentMesh/web: bridge-security suite (loopback/Host, whitelist +
denylist, 405 on writes, oversized body, envelope injection, **redaction
pen-check against `hearth/redteam/attack-corpus.jsonl` + synthetic PII
fixtures**, KPI parity vs `tools/dashboard/generate.py`, empty-write-allowlist
assertion) + per-view UI state tests + PII-never-renders component tests.
