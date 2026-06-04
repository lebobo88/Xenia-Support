# Integration: Channel Adapters

Contract for deployment-supplied adapters that normalize inbound channel
messages (email, chat, voice, web form, API webhook) into artifacts the
Xenia pack can process. Channel adapters are **deployment-time
integrations, not pack code** — reference implementations belong with the
CCaaS/CRM deployment, not in this repository.

## Adapter responsibility

A channel adapter is any component (serverless function, middleware
service, CRM workflow, or CCaaS connector) that:

1. Receives a raw inbound message from a channel.
2. Extracts the required fields listed below.
3. **Hashes all raw customer identity at the edge** (see Identity
   redaction rule).
4. Delivers the normalized artifact to the pack via one of the two
   delivery paths below.

The adapter owns the channel-specific protocol (IMAP/SMTP, WebSocket,
telephony SIP/PSTN, form POST). The pack owns nothing channel-specific.

## Delivery paths

### Path A — SUPPORT_TICKET envelope (Hydra mode)

Construct a `SUPPORT_TICKET` envelope (defined in
`hydra_core/schemas.py`, registered in `SCHEMA_REGISTRY`) and post it
to Hydra's supervisor. The squad accepts `SUPPORT_TICKET` directly; no
HANDOFF wrapper is required for this path.

Required `SUPPORT_TICKET` fields:

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Adapter-assigned; must be stable for dedup |
| `customer_ref` | string | `customer:<sha256-of-canonical-identity>` — see Identity redaction rule |
| `subject` | string | One-line summary; adapter may derive from email Subject or chat opener |
| `body` | string | Full message text; PII already redacted or hashed |
| `priority` | P0–P3 | Adapter maps channel SLA class; default P2 |
| `intent` | string (optional) | Pre-classified intent if the CCaaS provides it |
| `channel` | string (optional) | `"email"` \| `"chat"` \| `"voice"` \| `"web-form"` \| `"api"` |
| `portable_context` | object (optional) | Populated only when the channel session already carries a live context token (e.g. a resumed chat) |

Envelope base fields (`origin_squad`, `workflow_id`) are set by the
adapter before delivery; `type` is `"SUPPORT_TICKET"`.

### Path B — hearth/tasks ticket (degraded / standalone mode)

When Hydra is absent or the adapter targets a standalone Xenia
deployment, create a file at
`hearth/tasks/TICKET-<id>.md` with the same fields in YAML frontmatter:

```yaml
---
ticket_id: TKT-<id>
customer_ref: customer:<hash>
subject: <one-line summary>
body: <message text>
priority: P2
intent: <optional>
channel: <optional>
created: <ISO-8601>
status: open
---
## Body

<message text>
```

Alternatively, call `xenia-tickets.create` (the MCP tool) with the same
field set. The MCP server normalizes to the file format above when the
backing ticket system is unavailable.

## Identity redaction at ingress (Article IV — edge enforcement)

Raw PII from a channel — names, email addresses, phone numbers, account
numbers, IP addresses, device IDs — **must be hashed before it enters
the pack**. This is the Article IV obligation enforced at the very edge:

- Compute `customer_ref = "customer:" + sha256(canonical_identity)`.
  The canonical form is adapter-defined (e.g. lowercase trimmed email)
  and must be stable so the same customer produces the same ref across
  sessions.
- The `body` and `subject` fields must be scrubbed of direct identifiers
  before delivery. If the adapter cannot guarantee scrubbing, it must set
  a `pii_scrub: false` annotation in the envelope's `context_refs` so
  Eunomia (the compliance gate) applies a second-pass redaction before
  any output.
- The raw identity mapping (hash → identity) lives in the CCaaS/CRM
  system of record, never in the pack. Eunomia's hook cannot look it up;
  it only enforces that `customer_ref` matches `customer:<hex>` and no
  raw identity pattern appears in outbound text.

This rule applies to every channel. There is no exception for internal
tools or test environments — test adapters must use synthetic hashes.

## Degraded path (no adapter present)

When no adapter is wired, Iris can triage pasted text directly via
`/support-ticket` or `/triage-queue`. The operator pastes the customer's
message; Iris constructs a local ticket and portable-context token in
`hearth/`. This path is already supported and requires no adapter. The
operator is responsible for manual identity redaction before pasting.

## What adapters are NOT responsible for

- Routing, triage, KB lookup, escalation — all handled by pack agents.
- SLA timing — Hestia owns SLA enforcement from ticket-open time.
- Response delivery back to the channel — the pack produces a response
  artifact; the adapter (or a separate delivery component) is responsible
  for writing it back to the originating channel. The response artifact
  is written to `hearth/output/` and optionally to the ticket system via
  `xenia-tickets`; it does not re-enter the adapter contract.

## Deployment note

Reference implementations for common channels belong with the CCaaS/CRM
deployment, not in this repository. Examples of where they live:

- **Zendesk / HubSpot / Freshdesk**: a trigger + webhook that calls a
  Lambda/Cloud Function hosting the normalization + hash logic.
- **Intercom / LiveChat**: a platform app or middleware service.
- **Voice (telephony)**: a post-call webhook from the IVR/CCaaS that
  delivers a transcript already normalized by the STT pipeline.
- **Internal API**: a thin wrapper in the product's backend that fires on
  ticket creation events.

The pack's contract (this document) is the interface boundary. The
adapter is an implementation detail of the deployment environment.
