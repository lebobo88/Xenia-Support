# Integration: Ticket System

The `ticket-system-bridge` tool contract and its degraded mode. Xenia is
ticket-system-agnostic: any helpdesk (Zendesk, HubSpot Service, Jira SM,
Intercom, a database) can stand behind this contract via an MCP server.

## The bridge contract

```yaml
tool: ticket-system-bridge
privilege: write
allowed_callers: [intake-router, retention-success, escalation-handoff]
operations:
  read:        # ticket fetch, history, customer-context (opaque refs)
    side_effects: none
  comment/update-fields:   # status, priority, tags, internal notes
    side_effects: reversible
  send-response:           # customer-facing reply
    side_effects: reversible-ish (it was seen) -> full pipeline required first
  refund/credit/plan-change/cancel/delete:
    side_effects: irreversible  ->  Article V: deny-by-default
```

Enforcement layers on irreversible operations: agent prompts (Layer 1),
Hermes-only carriage + approval artifact (Layer 2),
`pre-tool-privilege.ps1` (Layer 3: caller allow-list, monetary-pattern
detection, artifact validation including expiry).

## Implementing a real bridge

Provide an MCP server exposing the operations above with typed schemas
(`tool-execution-standards` skill defines the contract shape:
preconditions, typed errors, side-effect declarations). Wire it into
`squad.yaml`'s `tools:` entry (add `mcp_server: <name>`), and the agents'
frontmatter allowlists. The hook's monetary regex and allow-list apply to
any tool whose name matches `mcp__.*ticket.*` — name the server
accordingly.

## Degraded mode (no ticket system)

Local file fallback under `hearth/tasks/`:

- A ticket is `hearth/tasks/TICKET-NNN.md`: frontmatter
  `{ticket_id, status, priority, intent, customer_ref(hash), created,
  updated}` + body sections `## History`, `## Actions attempted`,
  `## Recommendations`.
- read = parse the file; comment/update = append to History; respond =
  the pipeline's output artifact doubles as the response record.
- Irreversible operations remain deny-by-default: the file records the
  RECOMMENDATION and the approval state; a human executes in whatever
  real system exists and notes it back.
- Iris can triage pasted text without any file at all (`/triage-queue`).

## Identity discipline

The bridge returns customer identity as opaque refs (`customer:<hash>`)
wherever possible; where a real system returns raw PII, the consuming
agent redacts at ingestion (Layer 1) and Eunomia re-checks at every
boundary (Layer 2). Raw identity never enters outputs, events.jsonl, or
memory (constitution Article IV).
