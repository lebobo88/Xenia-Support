# NB-6 — Xenia Customer-Data Flow Map (P1 — closes the DPIA carry-item)

**Carry-item being closed:** `AgentMesh/docs/spec/data-egress-review.md` NB-6
("Map Xenia customer-data flow: categories, lawful basis, special category
check") — open since the agentmesh-platform campaign and re-flagged when
`xenia-tickets` was enrolled into the mesh (GOVERNANCE-ROUTING §xenia-tickets).
This map covers the Xenia ticket/KB data estate as processed by (a) the Xenia
pack itself and (b) the Support Observatory UI. Owner: operator (sole data
controller). Date: 2026-06-05.

## 1. Data inventory & categories

| Data element | Where it lives | GDPR category | Personal data? |
|---|---|---|---|
| `customer_ref` (`customer:<hash>`) | tickets, events.jsonl, DecisionRecords | Pseudonymized identifier (Art 4(5)) | **Yes** — pseudonymous personal data (re-identifiable only via an external mapping the operator may hold; no mapping exists in this estate) |
| Ticket `subject` / `history[].body` | `hearth/tasks/TICKET-*.json` | Communication content | **Potentially** — customer-authored free text MAY contain identifiers, contact data, or volunteered sensitive info |
| `intent`, `priority`, `status`, SLA fields | tickets | Transactional metadata | No (once subject/body separated) |
| Recommendations (action/scope/amount) | tickets | Transactional (may reference refund amounts) | Linked-personal via customer_ref |
| events.jsonl rows | `hearth/progress/` | Telemetry (severity, outcome, cost, tier) + customer_ref | Linked-pseudonymous |
| DecisionRecords | `hearth/output/tickets/` | Quality/governance records (rubrics, seals, escalation reasons) | Linked-pseudonymous; free-text summary fields treated as content |
| Approval artifacts | `hearth/approvals/` | Authorization records: `issued_by` (HUMAN approver identity), action, scope, expiry | **Yes** — `issued_by` is operator/staff personal data |
| KB articles | `hearth/kb/` | Product documentation | No |

## 2. Flows (as-built, with the Observatory)

```
customer text ──> intake (Eunomia-redacted, Art IX) ──> TICKET-*.json (opaque refs)
TICKET/events/DRs ──> xenia-tickets / file readers ──> Observatory bridge (Layer-4 scrub)
                                                       └──> browser, 127.0.0.1 ONLY (display; no export endpoints)
TICKET summaries ──> AgentMesh federated audit (local stitch only; constrained per GOVERNANCE-ROUTING §xenia-tickets until this map was closed)
```

- **No egress off-machine.** Every consumer is loopback-bound. The Xenia repo
  is private. No cloud sync, no telemetry exporters (`otel exporter: none`).
- **No new storage.** The Observatory is stateless — it renders the existing
  artifacts; it creates no copies, caches, logs of payload content, or exports.

## 3. Lawful basis (GDPR Art 6)

**Art 6(1)(f) legitimate interest** — the operator (sole controller) processes
support-ticket data to provide customer support and supervise the AI agents
doing so. The Observatory adds *oversight of automated processing* — itself a
strong legitimate interest (and an accountability measure under Art 5(2)).
Balancing: local-only display of already-collected, already-pseudonymized
data introduces no new intrusion; safeguards below.

## 4. Special categories (Art 9) check

Structured fields contain none. Free-text MAY incidentally contain volunteered
special-category data. Controls: Eunomia clearance upstream (Art IX pipeline),
Layer-4 scrub at the bridge, display-only loopback UI, no export, private
repo. Incidental volunteered data under these controls is assessed as
**residual-acceptable**; no systematic special-category processing occurs.

## 5. Retention

The Observatory adds **zero retention** (stateless). Source artifacts follow
the existing Xenia/hearth lifecycle (operator-managed; tickets are the
business record). The AgentMesh federated-audit stitch retains per its
`retentionDays` config (90d default) with `meshctl audit purge` as the
operator-driven erasure path (DPIA Art 17 row).

## 6. Data-subject rights (Art 15/17 practical paths)

- Access: `xenia-tickets.get` / Observatory ticket-detail by opaque ref.
- Erasure: delete `TICKET-*.json` + correlated events (operator action,
  legal-hold permitting); mesh stitch purge via `meshctl audit purge`.

## 7. Conditions & follow-ups

1. The Observatory MUST remain read-only + loopback + export-free while this
   map is the operative assessment; adding writes, exports, or non-loopback
   exposure REOPENS NB-6.
2. `issued_by` in approval artifacts is staff personal data — displayed only
   in the approvals panel (accountability requires it); keep-list documents this.
3. On operator approval at the P1 HITL gate, update
   `AgentMesh/docs/spec/data-egress-review.md` NB-6 row → CLOSED (ref this
   file) and soften the GOVERNANCE-ROUTING §xenia-tickets OPEN-flag to
   "closed 2026-06-05, conditions above".
