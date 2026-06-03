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
  granted_memory_scopes, payload), `HITL_REQUEST` (resumed approvals).
- **emits**: `DECISION_RECORD` (terminal artifact per run), `PRD`
  (Asclepius's defect fragments toward the engineering squad).
- **Portable context travels INSIDE the HANDOFF payload** (field
  `portable_context`, schema in the `portable-context-token` skill).
  There is deliberately no custom envelope type in this pass; if
  SUPPORT_TICKET / VOC_REPORT envelope types are ever added to
  `hydra_core/schemas.py`, the squad upgrade is: add them to
  `accepts`/`emits` and lift the payload fields one level. Standalone
  and orchestrated modes share the same inner schema either way.

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
