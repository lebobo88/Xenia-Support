# Xenia Support Observatory

A **read-only** observability console for the Xenia customer-support pack —
ticket queue, KPI dashboard, knowledge-base health, and aged HITL escalations,
served over a loopback-only bridge with bridge-side PII redaction.

Built by the `xenia-observability-ui` Hydra campaign. Mirrors the sibling
console pattern (`TheEights/web`, `AgentMesh/web`): React 18 + Vite front end,
a Node bridge that multiplexes the `xenia-tickets` / `xenia-kb` MCP servers and
reads the `hearth/` file estate.

## Read-only by construction

This console has **zero write tools** — the write allowlist is an empty frozen
array, asserted by tests and the pen-check. It cannot create, comment on,
respond to, or approve anything. Monetary/irreversible actions remain governed
by the support-constitution **Article V**: a human issues an
`APPROVAL-<ticket_id>-*.yaml` artifact; this console only *displays* approval
status, never mints or executes one.

Why so strict: **NB-6** (the Xenia customer-data-flow lawful-basis mapping) was
closed on the condition that this UI stays read-only, export-free, and
loopback-only. Adding any write path, export endpoint, or non-loopback bind
**reopens NB-6**. See `docs/NB-6-data-flow-map.md` and
`AgentMesh/docs/spec/data-egress-review.md`.

## Privacy — Layer-4 redaction

Every payload leaving the bridge passes a single redaction chokepoint
(`server/redact.ts`, support-constitution **Article IV §2**, "Layer 4"): a
default-scrub pass over all free text (email, phone, SSN, Luhn-validated PAN,
IBAN, credentials, addresses), fail-closed to `[REDACTED]`. Opaque
`customer:<hash>` refs, IDs, enums, timestamps, and numerics pass verbatim;
approval `issued_by` is the one documented accountability exemption. Policy:
`docs/REDACTION-POLICY.md`.

## Run it

```powershell
cd C:\AiAppDeployments\Xenia\web
npm install
npm run build      # tsc -b && vite build

# two terminals:
npm run bridge     # loopback bridge on 127.0.0.1:8791 (writes .xenia-bridge-port)
npm run dev        # Vite UI on 127.0.0.1:5197
# open http://127.0.0.1:5197
```

Ports (override via env; both roll forward if taken):

| Service | Default | Override |
|---|---|---|
| Bridge (HTTP, loopback) | 8791 | `XENIA_OBS_BRIDGE_PORT` |
| Vite (UI) | 5197 | `XENIA_OBS_DEV_PORT` |

The bridge spawns `python -m mcp_servers.{xenia_tickets,xenia_kb}` from
`HYDRA_ROOT` (default `C:/AiAppDeployments/Hydra`) with
`HYDRA_XENIA_ROOT` pointing at the Xenia repo, and reads
`hearth/{progress/events.jsonl, output/tickets/*.md, approvals/*.yaml}`.

## Endpoints (all GET; non-GET → 405)

| Endpoint | Source |
|---|---|
| `/api/health` | bridge + both MCP pings + estate file counts |
| `/api/queue?status=&priority=` | `xenia-tickets.list` + SLA countdown |
| `/api/ticket/<id>` | `xenia-tickets.get` + DecisionRecord + approval status |
| `/api/kpi/snapshot?period=30d` | `server/kpi.ts` over events + DecisionRecords |
| `/api/kb/health` | `xenia-kb.list` + `ping` |
| `/api/hitl/aged` | open escalations from the event timeline |

## KPI engine

`server/kpi.ts` ports `Xenia/tools/dashboard/generate.py` (`compute_kpis`).
`tests/server/kpi-parity.test.ts` asserts the TS engine reproduces the real
`generate.py` (via `tests/fixtures/dump_oracle.py`) on a shared fixture — with
**one documented correction**: `escalation_precision`. generate.py's flat
parser never sees the nested `escalation.triggered` field, so its value is
stuck at `0.0`; this engine reads it correctly. The parity test pins both
values so the divergence is intentional and visible.

KPIs preserve the anti-Goodhart contract: containment is always shown with its
false-deflection pair, and cost always carries an explicit coverage label.

## Tests

```powershell
npm test           # server: bridge security, redaction + corpus pen-check,
                   #   file readers, KPI parity, routes, P5 pen-check (111)
npm run test:ui    # views + state machine + PII-never-renders (16)
```

The P5 pen-check (`tests/server/pencheck.test.ts`) attacks every invariant:
non-loopback Host, write methods, tool smuggling, redaction bypass via the
redteam corpus, path traversal, and the empty-write-allowlist guarantee.

## Layout

```
web/
  server/   index.ts (loopback bridge, single redacting json() writer)
            xenia-client.ts (stdio MCP), whitelist.ts (7 read / 0 write),
            redact.ts (Layer 4), files.ts (read-only), kpi.ts, routes.ts
  src/      App.tsx (hash router), api.ts, usePolling.ts, components.tsx,
            views/{Queue,TicketDetail,Kpis,KbHealth,HitlAged}.tsx, styles.css
  docs/     UI-SPEC.md, REDACTION-POLICY.md, NB-6-data-flow-map.md
  tests/    server/ + ui/ + fixtures/ (hearth + dump_oracle.py + kpi-oracle.json)
```
