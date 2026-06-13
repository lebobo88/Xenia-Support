# Integration: AgentMesh (the binding control plane)

How Xenia enrolls into [AgentMesh](../../AgentMesh) — the thin, governed
**control plane** that binds the nine sibling AI systems into one mesh.
AgentMesh is the *tenth* layer: it unifies the siblings behind one registry,
one lifecycle supervisor, one observability plane, one federated read-only
audit timeline, one external protocol edge, and one operator web console.

AgentMesh **enforces no governance of its own**. Authority stays with the
substrate, in precedence order: **TheEights → AgentSmith → Hydra**. AgentMesh
routes and observes; it does not arbitrate. For Xenia this matters: nothing in
the mesh layer can widen what a support agent may *recommend* or *execute* —
the constitution (Article V, deny-by-default money) and WS-AUTH capability
enforcement still own that boundary (see [auth.md](auth.md)).

---

## Enrollment — `mesh-manifest.yaml`

Xenia enrolls by shipping a [`mesh-manifest.yaml`](../mesh-manifest.yaml) at
the repo root (`apiVersion: agentmesh/v1`, `kind: SiblingManifest`). AgentMesh
validates it **fail-closed** on three gates that must all pass:

1. **JSON-Schema validation** against `AgentMesh/mesh-manifest.schema.json`.
2. **Constitution attestation** via TheEights — the manifest's
   `governance.constitutionPath` resolves to
   `hearth/specs/support-constitution.md` (the immortal head; see the
   manifest's own validator-friction note on the `..` traversal).
3. **AgentSmith structural inspection** of the enrolled artifact set.

| Manifest field | Xenia value |
|---|---|
| `metadata.id` | `xenia` |
| `metadata.backendsKey` | `xenia` (gateway flat-dict key in `~/.hydra/backends.json`) |
| `runtime.type` | `python-langgraph` |
| `runtime.entrypoint` | `mcp_servers/xenia/__main__.py` (on the **Hydra** side; `cwd: ${HYDRA_ROOT}`) |
| `runtime.env.HYDRA_XENIA_ROOT` | `${HYDRA_XENIA_ROOT}` (servers operate on this repo's tree) |
| `governance.constitutionPath` | `../Xenia/hearth/specs/support-constitution.md` |

The registry is the sole writer of `~/.hydra/backends.json` — Xenia's gateway
backend entry (`xenia`) is owned by AgentMesh, not hand-edited.

---

## The enrolled surfaces

Three MCP surfaces front the Xenia squad, all enrolled through the one
manifest (server code lives Hydra-side, operates on the Xenia tree — see
[mcp-servers.md](mcp-servers.md)):

| Surface | Role in the mesh |
|---|---|
| `xenia` | pack-metadata + health/attest shim (`xenia.ping`, `xenia.output.read/write`, `xenia.agent/skill/command.*`) — the manifest's declared MCP surface |
| `xenia-kb` | grounded-retrieval data plane (SQLite FTS5 RAG) |
| `xenia-tickets` | ticket-action data plane (WS-AUTH-gated `send_response` / `execute_approved`) |

Through the Hydra gateway these surface as `mcp__hydra_gateway__xenia__*`,
`mcp__hydra_gateway__xenia_kb__*`, and `mcp__hydra_gateway__xenia_tickets__*`.

---

## Lifecycle supervision

AgentMesh's lifecycle supervisor (Win32 Job Objects + crash-loop breaker +
health probes) manages the Xenia backend per the manifest:

- **Health probe**: `xenia.ping` (an `mcp-tool-call` probe) every `20000` ms,
  `8000` ms timeout, `failureThreshold: 3`. `xenia.ping` confirms MCP
  connectivity only — it is **not** a constitution attestation.
- **Startup dependency**: `hydra` must be up first (`startTimeoutMs: 30000`).
- **Crash-loop breaker**: `threshold: 5` restarts in a `60000` ms window
  trips the breaker (mirrors AgentMesh's per-system breaker policy).
- **Graceful shutdown**: `gracefulShutdownMs: 10000`.

---

## Audit + attestation routing

AgentMesh provides one **federated, read-only** audit timeline, stitched from
the TheEights / AgentSmith / Hydra chains — it does not author audit records,
it stitches them. Xenia's contribution:

- **Export tool**: `xenia.output.read` (manifest `audit.exportTool`), dedupe
  key `relative`. This retrieves support-output artifacts for stitching.
- **Formal audit federation** routes through TheEights per governance
  precedence — the support telemetry truth still flows via the
  `events.jsonl` → xenia-bridge → TheEights path (see [eights.md](eights.md)),
  not directly into AgentMesh.
- **Attestation**: the manifest's `attestTool` is `xenia.ping` (connectivity
  only); the **real** constitution-hash attestation routes through TheEights
  (`eights.constitution.attest` with `consumer="xenia"`). AgentMesh consumes
  that attestation result during enrollment; it never re-derives or overrides
  it.

---

## What AgentMesh does NOT do for Xenia

- It does **not** redact. Layered redaction (4 layers) stays in the squad and
  the TheEights bridge re-redaction (Layer 4).
- It does **not** approve. Article V approval artifacts and Hermes's HITL
  boundary are untouched; AgentMesh has no path to mint execution authority.
- It does **not** widen capability. WS-AUTH caller-capability enforcement on
  `xenia-tickets` is unchanged.

In short: AgentMesh makes Xenia **discoverable, supervised, and observable**
across the mesh. Every governance guarantee remains exactly where the
constitution and the substrate (TheEights → AgentSmith → Hydra) put it.

---

## Degraded mode (AgentMesh absent)

Xenia is standalone-first; AgentMesh is additive. With no mesh control plane,
the squad runs exactly as documented elsewhere — Hydra (or the standalone
commands) drives the pipeline, `xenia.ping` is just a reachability probe, and
the gateway backend entry (if present) is read as-is. Nothing in Xenia's
runtime depends on AgentMesh being up; enrollment only adds cross-mesh
discovery, supervision, and a stitched audit view.
