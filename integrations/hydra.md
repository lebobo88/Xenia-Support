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

`Hydra/mcp_servers/xenia/` exposes the pack to the gateway:
`xenia.ping`, `xenia.agent.list/get`, `xenia.skill.list/get`,
`xenia.command.list/get`, `xenia.output.write/read`. Root resolved from
`HYDRA_XENIA_ROOT` (default `C:/AiAppDeployments/Xenia`). Registered in
`~/.hydra/backends.json`; tools surface as
`mcp__hydra_gateway__xenia__*`. The server writes ONLY under
`hearth/output/` — `events.jsonl` belongs to the stamp hook alone.

## Degraded mode (Hydra absent)

The slash commands ARE the orchestrator. HITL pauses become printed
approval-request blocks + in-chat halt. Envelopes degrade to local
markdown artifacts with the same inner schemas. `squad.yaml` is inert
metadata. Nothing in the pack imports Hydra code.
