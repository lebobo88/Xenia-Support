# ROADMAP — Xenia

Gap analysis against the research dossier ("Building Production-Grade
Multi-Agent AI Teams for Customer Support", in this repo). Xenia v1.0
implements the **orchestration, governance, and skills layer** in full;
the items below are the **infrastructure layer** (contract-defined,
degraded-mode-covered, not yet built) and consciously deferred work.

Tracked as TheEights evolution proposals where a governed artifact will
change; tracked here regardless. Status values: `planned`, `proposed`
(evolution proposal filed), `blocked`, `done`.

---

## Phase 5 — Grounding & Systems (highest value)

| ID | Item | Why it matters | Changes | Status |
|----|------|----------------|---------|--------|
| R5-1 | **Real KB / RAG MCP server** (vector store + corpus + freshness-aware ranking) | Metis currently fails closed honestly on every volatile-topic question — containment is near-zero until retrieval exists. The single highest-value gap. | New MCP server; `squad.yaml` tools gain `mcp_server:` binding for `kb-rag`; Metis/Asclepius frontmatter tool names | proposed (`prop_b66b4af6`) |
| R5-2 | **Real ticket-system MCP bridge** (Zendesk / HubSpot Service / Jira SM adapter per `integrations/ticket-system.md`) | Live queue intake, real `actions_attempted` flags, real SLA clocks. Local-file degraded mode stops being the only mode. | New MCP server; `squad.yaml` `ticket-system-bridge` gains `mcp_server:`; hook matcher already covers `mcp__.*ticket.*` | proposed (`prop_b66b4af6`) |
| R5-3 | **Billing & account head or tool grant** (research doc's dedicated Billing Agent) | Billing intents currently route to Metis/Soteria with no billing API access; refund recommendations carry no invoice context. | Either a new head (slug `billing-account`, mythic candidate: **Hera** as keeper of contracts, or fold into Soteria's tools) + billing API MCP, recommend-only preserved | planned |
| R5-4 | **Per-resolution cost computation** (standalone) | Cost-per-resolution is a KPI we define but only Hydra-mode records. | `post-output-sla-stamp.ps1` gains token/cost fields when the harness exposes them; `support-kpi-monitoring` consumes | proposed (`prop_36000c5c`) |

## Phase 6 — Operations & Observability

| ID | Item | Why it matters | Changes | Status |
|----|------|----------------|---------|--------|
| R6-1 | **Agent-Manager dashboard** (web UI over events.jsonl + DecisionRecords: KPI table, trends, worst-3 replay, open HITL age, KB-gap velocity) | The contract exists in `support-kpi-monitoring`; supervisors need the surface. | New `dashboard/` app (read-only over hearth/) | planned |
| R6-2 | **Recurring red-team program** (the research doc calls for continuous agent-chain red-teaming, not one pass) | One 10/10 adversarial pass at build time decays; injection patterns evolve. | Scheduled `/support-shadow --red-team` variant + seeded attack corpus in `hearth/redteam/`; AgentSmith sentinel signatures | planned |
| R6-3 | **Token/step budget mechanical enforcement** (standalone) | Budgets are constitution + stop-hook enforced; a runtime counter is stronger. | Hook-side dispatch counter in `hearth/progress/`; block at ceiling | planned |
| R6-4 | **Sample shadow corpus** | `/support-shadow` requires user-supplied historical tickets; ship a synthetic 50-ticket corpus so crawl-phase scoring works out of the box. | `hearth/corpus/shadow-tickets.jsonl` | planned |

## Phase 7 — Reach & Interop

| ID | Item | Why it matters | Changes | Status |
|----|------|----------------|---------|--------|
| R7-1 | **Custom Hydra envelope types** (`SUPPORT_TICKET`, `PORTABLE_CONTEXT`, `VOC_REPORT`) | Portable context currently rides inside HANDOFF payloads (documented in `integrations/hydra.md`); first-class types improve cross-squad validation. | `hydra_core/schemas.py` + squad.yaml accepts/emits + planner routing | planned |
| R7-2 | **Signed portable-context token** | The research doc proposes a SAML-like signed assertion; ours is convention-enforced (append-only + rev). Signing defeats token forgery in multi-squad flows. | `portable-context-token` skill + signing helper + Eunomia verification step | proposed (`prop_d15f4b4b`) |
| R7-3 | **`.sh` hook ports** (Layer-3 on non-Windows harnesses) | Hooks are PowerShell; Layers 1-2 are harness-neutral but Layer 3 should travel. | `.claude/hooks/*.sh` mirroring each `.ps1` contract (documented in script headers) | planned |
| R7-4 | **Channel adapters** (email/chat/voice ingestion → Iris) | Xenia is text-in-harness; omnichannel is the research doc's table stakes for CCaaS parity. | New `channels/` adapters emitting tickets into the queue | planned |
| R7-5 | **Jurisdiction → right-to-human mandate lookup** | `regulatory_flag` exists; the region→mandate table doesn't. Until then, unknown-region + regulated intent assumes the stricter rule (per `policy-compliance-awareness`). | Data file + Iris triage consult | planned |

## Phase 8 — Intelligence

| ID | Item | Why it matters | Changes | Status |
|----|------|----------------|---------|--------|
| R8-1 | **Churn-propensity signal feed** (ML model or heuristic service for Soteria) | Soteria reads churn from ticket text only; account-level signals (usage decline) are invisible. | Tool grant + `retention-success` workflow step | planned |
| R8-2 | **A/B experimentation for prompts/policies** (research doc's Analytics & Optimization agent) | Echo reports; nobody experiments. Pairs with TheEights evolution loop (propose → evaluate → commit). | Evolution-driven prompt variants + KPI comparison in shadow mode | planned |
| R8-3 | **Proactive outreach flows** (opportunity-class, research doc §SWOT) | Out of scope for reactive support v1; revisit after R5-1/R5-2. | New command + Soteria/Echo workflows; consent gates via Eunomia | planned |

---

## Standing activation caveats (close on next restart — not feature gaps)

- ~~TheEights daemon restart surfaces `eights.adapters.xenia.*` adapter tools~~
  **Done 2026-06-03** — daemon cycled; xenia consumer + adapters live; four
  resources registered (roadmap, squad, stamp-hook, portable-context skill).
- Fresh Claude session in this cwd registers the heads as native subagent
  types (`iris`, `hestia`, ...).
- Harnesses that load `hooks.json` fire Layer-3 hooks automatically; the
  build session invoked them explicitly with the same env contract.

## Non-goals (recorded so they stay decisions, not omissions)

- Formal SOC 2 / ISO 27001 certification work — referenced as context in
  `policy-compliance-awareness`; a business process, not a pack feature.
- Cross-organization A2A delegation — industry-immature per the research
  doc; Hydra envelopes remain the interop boundary.
- Autonomous monetary execution under any future phase — **never**. The
  approval-artifact contract (constitution Article V) is permanent; no
  roadmap item may weaken it.
