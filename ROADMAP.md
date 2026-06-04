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

## Residual risks & deployment dependencies (recorded, not silently accepted)

These are accepted residuals where a control is documented-as-contract or
operator-configured rather than code-enforced. They are listed so a
deployment closes them deliberately.

- **Layer-3 hook single-writer is operator-config, not code-enforced (R7-3).**
  `events.jsonl` has one writer by rule. In this deployment `hooks.json`
  references only the `.ps1` set, so the rule holds inherently (the `.sh`
  ports are dormant until a POSIX `hooks.json` is authored). A POSIX
  deployment MUST reference the `.sh` set XOR the `.ps1` set — never both.
  Each hook header states this; there is no runtime guard that detects a
  misconfigured both-sets deployment. Mitigation if needed later: a
  platform-marker check in the stamp hooks.
- **Channel ingress redaction is contract-only, deployment-supplied (R7-4).**
  `integrations/channels.md` requires PII to be hashed to `customer:<hash>`
  at the channel edge before it enters the pack (Article IV at ingress).
  This depends on the deployment's adapter, not pack code. The pack's own
  layers (Eunomia L2, hooks L3, bridge L4) still redact anything that slips
  through, but the cleanest control — never letting raw identity enter —
  lives in deployment-supplied adapter code. A deployment without a
  conforming adapter falls back to Iris triaging pasted text with
  operator-applied redaction.
- **Jurisdiction data is reference, not legal advice (R7-5).**
  `hearth/reference/jurisdiction-mandates.json` carries named statutory
  bases and `verify-with-counsel` notes on uncertain entries. The
  operational consequence is deliberately conservative: unknown region +
  regulated intent assumes the stricter right-to-human rule. Counsel
  verification is still required before the table is treated as
  policy-complete for any specific deployment's jurisdictions.

## Campaign closeout — residual-risk accounting (2026-06-04)

Every deferred or deployment-supplied surface, the invariant that contains
it, the failure mode if a deployer bypasses that invariant, and the
terminal governance stance.

| Deferred surface | Containing invariant | Failure mode if bypassed | Governance stance |
|---|---|---|---|
| **Live-traffic experimentation** (R8-2 is offline-only) | experiment-harness: OFFLINE-ONLY rule; winners file as evolution proposals, never self-commit | A deployment A/B-testing on real customers could ship an unjudged variant | NOT implemented here. The harness cannot self-authorize live tests; live experimentation requires deployment controls + the governed propose→evaluate→commit/HITL path |
| **Channel adapters** (R7-4) | `integrations/channels.md`: PII hashed to `customer:<hash>` at ingress (Article IV at the edge) | Raw identity enters the pack if an adapter skips ingress hashing | DEPLOYMENT-SUPPLIED. Pack layers (Eunomia L2, hooks L3, bridge L4) still redact slip-through; no-adapter fallback = Iris triages pasted text |
| **Churn-propensity signal** (R8-1) | `integrations/churn-propensity.md`: signal is INPUT only; Article V holds (high churn never authorizes autonomous action) | A deployment wiring churn score to auto-retention would breach recommend-only | DEPLOYMENT-SUPPLIED. CANNOT self-authorize a monetary/retention action; degraded = Soteria's text-based reading |
| **Proactive outreach** (R8-3) | `integrations/proactive-outreach.md`: 6 non-negotiable gates (consent, Eunomia, Themis, Article III disclosure, Article II no-manipulation, opt-out) | Outbound without consent/clearance violates Articles II/III + consent law | DEPLOYMENT-SUPPLIED, out-of-scope v1. Each gate is a hard precondition; a deployment bypassing any gate violates the constitution |
| **Layer-3 single-writer** (R7-3) | `events.jsonl` one-writer rule; `.ps1` XOR `.sh` per platform | A misconfigured POSIX deployment referencing both hook sets double-writes telemetry | OPERATOR-CONFIG. This deployment's `hooks.json` references only `.ps1` (single-writer-correct as shipped); no runtime guard for a both-sets misconfig |
| **Jurisdiction table** (R7-5) | `jurisdiction-mandates.json`: named bases + verify-with-counsel; unknown region assumes stricter | Treating the table as policy-complete without counsel review | REFERENCE, not legal advice. Unknown-region fallback is conservative (assume right-to-human); counsel verification required before policy-complete |
| **Real KB corpus / ticket backend** (R5-1/R5-2 servers are live; production data is not) | `kb-rag-citation` fail-closed; `ticket-system` Article V at server Layer 0 | Thin/stale KB → low containment (fails safe, not unsafe); a real CRM swaps in behind the same contract | IN-REPO with synthetic corpus; production KB/CRM is deployment-supplied behind the proven contract |

### Closeout verdict

- **Complete in-repo (built, Codex-approved, committed):** 11-head crew +
  constitution; live `xenia-kb` + `xenia-tickets` MCP servers with Article V
  at server Layer 0; billing head; cost telemetry; Agent-Manager dashboard;
  32-attack recurring red-team + `--red-team` mode; mechanical fail-open
  budget counter; first-class envelope types; HMAC-signed portable-context
  token; cross-platform `.sh` Layer-3 hooks; jurisdiction lookup; A/B
  experiment harness. KB + shadow + attack + jurisdiction corpora.
- **Intentionally deferred (documented as binding deployment contracts):**
  channel adapters, churn-propensity signal, proactive outreach — each with
  non-negotiable safety gates that a deployment MUST honor.
- **Non-operational until deployment supplies the external control plane:**
  live experimentation, real channel ingress, churn ML, outbound outreach,
  production KB/CRM data. The pack provides the contract and the safety
  floor; the deployment provides the data plane and adapters.
- **Constitution: never modified across any phase.** Article V enforcement
  grew from 1 point (constitution) to 4+ (constitution + agent prompt +
  Layer-3 hook + server Layer-0). No roadmap item weakened a safety invariant;
  several strengthened them.

## Non-goals (recorded so they stay decisions, not omissions)

- Formal SOC 2 / ISO 27001 certification work — referenced as context in
  `policy-compliance-awareness`; a business process, not a pack feature.
- Cross-organization A2A delegation — industry-immature per the research
  doc; Hydra envelopes remain the interop boundary.
- Autonomous monetary execution under any future phase — **never**. The
  approval-artifact contract (constitution Article V) is permanent; no
  roadmap item may weaken it.
