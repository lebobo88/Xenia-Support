# Integration: Hydra

How Xenia registers as and operates within Hydra's `customer-support`
squad. Xenia is standalone-first; everything here is additive.

## Squad registration

- Manifest: `squad.yaml` at the Xenia root (`source_pack: .`). The same
  file is installed at `Hydra/squads/customer-support/squad.yaml` with
  `source_pack: C:\AiAppDeployments\Xenia` (project-level discovery wins;
  the original stub is preserved as `squad.yaml.stub-backup`).
- Entrypoint: `claude-skill` — Hydra's dispatcher invokes the squad via
  its commands (`invoke.command_hint: /support-ticket`).
- Router: `hydra_core/router.py` `_KEYWORDS["customer-support"]`
  fingerprints route goals here (ticket, support, sla, refund, csat,
  churn, help desk, ...).

## Envelope contract

- **accepts**: `HANDOFF` (the normal entry; carries granted_tools,
  granted_memory_scopes, payload), `HITL_REQUEST` (resumed approvals),
  `SUPPORT_TICKET` (first-class inbound ticket; see R7-1), `PORTABLE_CONTEXT`
  (first-class context token; see R7-1).
- **emits**: `DECISION_RECORD` (terminal artifact per run), `PRD`
  (Asclepius's defect fragments toward the engineering squad), `VOC_REPORT`
  (Echo's voice-of-customer brief to the executive layer; see R7-1).
- **First-class Xenia envelope types (implemented, R7-1):** `SUPPORT_TICKET`,
  `PORTABLE_CONTEXT`, and `VOC_REPORT` are now defined in
  `hydra_core/schemas.py` and registered in `SCHEMA_REGISTRY`. Cross-squad
  validation via `validate_envelope` covers all three. The squad's
  `accepts`/`emits` lists in both `squad.yaml` copies have been updated
  accordingly.
- **HANDOFF-tunneled portable_context remains supported (backward compat).**
  A `HANDOFF` whose target artifact carries a `portable_context` field still
  validates cleanly — `SupportTicket.portable_context` is `Optional`, and
  the `HANDOFF` envelope itself is unchanged. Operators do not need to migrate
  existing workflows that tunnel context through HANDOFF payloads.

## Envelope schemas (field-by-field)

The three first-class Xenia envelope types are defined in
`hydra_core/schemas.py` and registered in `SCHEMA_REGISTRY`. All three extend
the shared `HydraEnvelope` base (`id: UUID`, `type`, `origin_squad`,
`target_squad?`, `workflow_id: UUID`, `parent_id?`, `context_refs:
[MemoryRef]`, `constraints`, `created_at`, `do_not_touch: [str]`). Validate at
the boundary with `hydra_core.schemas.validate_envelope`.

### SUPPORT_TICKET

A normalised inbound support request — from a channel adapter, an operator
paste, or a `HANDOFF` lift — entering the customer-support squad.

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"SUPPORT_TICKET"` | yes | literal discriminator |
| `ticket_id` | str | yes | |
| `customer_ref` | str | yes | `customer:<hash>` — never raw PII (Article IV) |
| `subject` | str | yes | |
| `body` | str | yes | |
| `priority` | `P0`/`P1`/`P2`/`P3` | no | default `P2` |
| `intent` | str | no | |
| `channel` | str | no | e.g. `email`, `chat`, `voice`, `api` |
| `portable_context` | `PortableContextPayload` | no | present when lifted from an in-progress session |

```json
{
  "type": "SUPPORT_TICKET",
  "origin_squad": "customer-support",
  "workflow_id": "5e2b1c00-0000-4000-8000-000000000001",
  "ticket_id": "000123",
  "customer_ref": "customer:9f3ab21c",
  "subject": "Dashboard access lost during launch",
  "body": "My team lost dashboard access this morning…",
  "priority": "P1",
  "intent": "access_issue",
  "channel": "email"
}
```

### PORTABLE_CONTEXT

The portable-context token as a standalone first-class envelope (it may also
travel inside a `HANDOFF` payload — backward compatible). The inner `payload`
is a `PortableContextPayload`:

| `payload` field | Type | Notes |
|---|---|---|
| `ctx_id` | str | `CTX-<ticket-id>-<rev>` |
| `ticket_id` | str | |
| `customer_ref` | str | `customer:<hash>` only |
| `goal` | str | |
| `active_objects` | `[{type, ref, state}]` | |
| `constraints` | `[str]` | |
| `sentiment` | `{current, trajectory}` | `current ∈ positive/neutral/negative/hostile` |
| `history_digest` | str | |
| `actions_attempted` | `[{action, by, executed, result?}]` | |
| `minted_by` | str | default `iris` |
| `minted_at` | datetime? | |
| `updated_by` | str? | |
| `rev` | int | default 1 |

```json
{
  "type": "PORTABLE_CONTEXT",
  "origin_squad": "customer-support",
  "workflow_id": "5e2b1c00-0000-4000-8000-000000000001",
  "payload": {
    "ctx_id": "CTX-000123-2",
    "ticket_id": "000123",
    "customer_ref": "customer:9f3ab21c",
    "goal": "Restore dashboard access for the customer's team",
    "active_objects": [{"type": "ticket", "ref": "000123", "state": "open"}],
    "constraints": ["no monetary action without approval"],
    "sentiment": {"current": "negative", "trajectory": "improving"},
    "history_digest": "Reported access loss; verified plan tier; checking SSO.",
    "actions_attempted": [
      {"action": "kb_lookup", "by": "metis", "executed": true, "result": "found SSO runbook"}
    ],
    "minted_by": "iris",
    "rev": 2
  }
}
```

### VOC_REPORT

The Voice-of-Customer report, produced by Echo (Soteria sub-agent) and
delivered upward to the executive layer. All fields are aggregates / opaque
refs — raw identity MUST NOT appear (Article IV).

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"VOC_REPORT"` | yes | |
| `period` | `{from, to}` | yes | ISO-8601 strings |
| `coverage` | str | yes | e.g. `47 tickets, 2026-05-01 to 2026-06-01` |
| `themes` | `[VocTheme]` | no | each: `{theme, count, trend?, sentiment_trajectory?, representative_quote_redacted?, kb_gap}` |
| `escalation_patterns` | str | no | |
| `delight_signals` | str | no | |
| `recommendations` | `[str]` | no | |

```json
{
  "type": "VOC_REPORT",
  "origin_squad": "customer-support",
  "target_squad": "executive",
  "workflow_id": "5e2b1c00-0000-4000-8000-000000000099",
  "period": {"from": "2026-05-01", "to": "2026-06-01"},
  "coverage": "47 tickets, 2026-05-01 to 2026-06-01",
  "themes": [
    {"theme": "SSO access after plan change", "count": 9,
     "trend": "+12% vs prior period", "kb_gap": true}
  ],
  "escalation_patterns": "3 P1s all traced to the same SSO regression.",
  "delight_signals": "Retention saves up 4%.",
  "recommendations": ["File a PRD fragment for the SSO regression."]
}
```

## Portable-context token signing

Portable-context tokens (and the customer-facing **clearance** tokens that
gate `send_response`) are signed by `tools/context_token/sign.py`. This is a
DISTINCT signing path from WS-AUTH caller-capability tokens (those use
`HYDRA_OPERATOR_KEY`; see [auth.md](auth.md)).

- **Key**: `XENIA_CONTEXT_SIGNING_KEY` (hex preferred, else UTF-8). Optional
  `XENIA_CONTEXT_KEY_ID` (default `default`). The key is never written to the
  token, repo, or any log.
- **Algorithm**: `HMAC-SHA256`.
- **Canonicalisation**: `json.dumps(body_minus_sig, sort_keys=True,
  separators=(',',':'), ensure_ascii=True)` — byte-identical to Hydra's
  `hydra_core/auth/capability.py`, so a token is verifiable by both systems
  when they share a key.
- **Signature value**: base64url, no padding.
- **Envelope**: `token["sig"] = {"alg": "HMAC-SHA256", "key_id": <id>,
  "value": <b64url-nopad>}`.

CLI / API:

```
python tools/context_token/sign.py mint   < token.json   # → signed token JSON
python tools/context_token/sign.py verify < signed.json  # → {"valid": ..., "reason": ...}
```

```python
from tools.context_token.sign import mint, verify
signed = mint(token_dict)          # adds the sig envelope (copy; never mutates)
result = verify(signed)            # {"valid": bool, "reason": str}
```

**Degraded mode**: when `XENIA_CONTEXT_SIGNING_KEY` is unset, `mint()` returns
the token with `sig.value=None, sig.degraded=True`, and `verify()` returns
`valid=True, reason="unsigned (degraded mode)"` so a pipeline that worked under
v1.0 convention-enforced behaviour never blocks. Note the asymmetry: the
`xenia-tickets` server's clearance check (`clearance.py`) is **fail-closed** —
it rejects degraded/unsigned clearance tokens outright (a degraded token there
is treated as a bypass attempt), and a tampered signature is reported as a
context-poisoning / injection finding.

## Gates and judging

`gates:` in squad.yaml reference rubric ids that exist BOTH as local
files (`rubrics/*.yaml`, used by Themis standalone) and as entries in
Hydra's judge registry (`hydra_core/judge/registry.py`), so cross-model
judging at the squad boundary scores the same dimensions Themis scored
in-line. `support-deflection-quality@1` pre-exists in the registry; the
other five are registered by the Xenia integration.

## HITL

`hitl_trigger: true` heads: Hermes, Themis, Eunomia. A Hermes
`HITL_REQUEST` pauses the workflow; `/hydra:approve <workflow_id>`
resumes it, and the resume handler's decision is recorded by Hermes as
the approval artifact (`hearth/approvals/APPROVAL-*.yaml`) before any
execution — the artifact is the single source of execution authority in
both modes (constitution Article V).

## Governance obligations (CONTRIBUTING-SQUADS checklist)

- Outbound text crosses `governance.redact_for_squad_boundary(...)`
  (Hydra side) — Eunomia + hooks have already cleared it (defense in
  depth, both run).
- Billable calls record costs (`governance.record_cost`).
- Results persist via episodic memory handles, never raw blobs.
- Telemetry: the squad's own `events.jsonl` plus Hydra's node events.

## MCP server

`Hydra/mcp_servers/xenia/` exposes the pack metadata to the gateway:
`xenia.ping`, `xenia.agent.list/get`, `xenia.skill.list/get`,
`xenia.command.list/get`, `xenia.output.write/read`. Root resolved from
`HYDRA_XENIA_ROOT` (default `C:/AiAppDeployments/Xenia`). Registered in
`~/.hydra/backends.json`; tools surface as
`mcp__hydra_gateway__xenia__*`. The server writes ONLY under
`hearth/output/` — `events.jsonl` belongs to the stamp hook alone.

The **data-plane** servers are separate: `xenia-kb` (RAG, 4 tools) and
`xenia-tickets` (ticket bridge, 9 tools — two capability-gated). Full API
reference in [mcp-servers.md](mcp-servers.md); the WS-AUTH token flow that
gates `send_response`/`execute_approved` is in [auth.md](auth.md); the
Layer-3 hooks in [hooks.md](hooks.md).

## AgentMesh enrollment

Xenia enrolls into the AgentMesh control plane via
[`mesh-manifest.yaml`](../mesh-manifest.yaml) (`kind: SiblingManifest`,
`apiVersion: agentmesh/v1`, `metadata.id: xenia`). The manifest is the
declarative source the control plane reads to register the sibling:

- **backendsKey** `xenia` — the flat-dict key in `~/.hydra/backends.json`.
- **runtime**: `python -m mcp_servers.xenia` from the Hydra cwd, with
  `HYDRA_XENIA_ROOT` pointing back at this repo.
- **healthProbe**: `mcp-tool-call` against `xenia.ping` (20 s interval, 8 s
  timeout, failure threshold 3) — a cheap connectivity read, not a chain
  walk. (The companion TheEights manifest similarly switched its healthProbe
  from `eights.audit.verify` to the cheap `eights.constitution.get`.)
- **mcp.tools**: the nine metadata tools of the thin `xenia` server (above).
- **governance**: the constitution path resolves to
  `hearth/specs/support-constitution.md`; formal hash attestation routes
  through TheEights (`eights.constitution.attest` with `consumer=xenia`)
  because the thin server exposes no dedicated attest tool.

## Degraded mode (Hydra absent)

The slash commands ARE the orchestrator. HITL pauses become printed
approval-request blocks + in-chat halt. Envelopes degrade to local
markdown artifacts with the same inner schemas. `squad.yaml` is inert
metadata. Nothing in the pack imports Hydra code.
