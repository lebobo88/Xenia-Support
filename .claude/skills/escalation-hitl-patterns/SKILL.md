---
name: escalation-hitl-patterns
description: "Escalation triggers, HITL deployment patterns (co-pilot, shadow, AI-first-with-escalation), the human approval artifact contract, and handoff packet requirements. Owned by Hermes; consumed by Hestia."
user-invocable: false
argument-hint: "<evaluate-trigger|build-packet|record-approval>"
allowed-tools:
  - Read
  - Write
  - Grep
---

# Escalation & HITL Patterns

Humans are collaborators, not fallbacks. Escalation is a terminal state
and a success of the covenant — the moment the house correctly recognizes
a matter beyond its authority.

## Purpose

Define when the workflow crosses to humans, how it crosses (packet
requirements), and the only mechanism by which human authority flows back
in (the approval artifact).

## When to use

- Hermes on every trigger evaluation, packet build, and approval record.
- Hestia when deciding dispatch and terminal states.
- `/escalate` and `/support-ticket` commands.

## The three HITL deployment patterns

| Pattern | What it means | When |
|---|---|---|
| **Co-pilot** | AI drafts; human agent reviews and sends | walk phase; high-risk intents |
| **Shadow** | AI runs the full graph offline on live/past tickets; humans compare | crawl phase; `/support-shadow` |
| **AI-first with escalation** | AI resolves low/medium complexity; escalates on triggers | run phase; the default production mode |

Promotion between patterns follows `deployment-roadmap` criteria — never
promote on enthusiasm.

## Escalation triggers (canonical list)

1. Explicit human request (Article I — immediate, no persuasion).
2. Regulatory flag (jurisdictional right-to-human, sector mandates).
3. Monetary/irreversible action without an approval artifact (Article V).
4. Low confidence: thin retrieval coverage, low self-assessment, or two
   failed Themis cycles.
5. Sustained negative sentiment (2+ turns) despite de-escalation.
6. SLA breach risk: P1 at 45 minutes unresolved.
7. Pipeline failure: Themis or Eunomia unable to run (fail closed).

Precision matters as much as recall: false escalations train humans to
ignore true ones (`escalation-correctness` rubric).

## The handoff packet

A customer must NEVER have to repeat themselves after escalation. The
packet (schema in `hermes.md`) always carries: the portable-context token,
a history digest, every attempted action with `executed: true|false`
flags, the KB passages already consulted (cited), the named trigger, and
the squad's recommendation. Eunomia clears the packet before it crosses
the boundary.

## The approval artifact contract (Article V)

The ONLY mechanism by which monetary/irreversible authority enters the
squad:

```yaml
# hearth/approvals/APPROVAL-<ticket-id>-<seq>.yaml
approval_id: APPROVAL-<ticket-id>-<seq>
ticket_id: ...
action: <refund | credit | plan-change | cancellation | deletion>
scope: <exact object>
amount_limit: <number | null>
issued_by: <named human>
issued_at: <ISO-8601>
expires_at: <ISO-8601, default +24h>
status: approved | denied
```

- Issuer: a human, via `/hydra:approve` (orchestrated) or explicit in-chat
  confirmation that Hermes records verbatim (standalone).
- Consumers: the `pre-tool-privilege.ps1` hook and Hermes's PreToolUse
  gate. Both require match on `ticket_id` + `action` + `scope`, status
  `approved`, and `expires_at` in the future.
- Deny-by-default: absent, expired, mismatched, or denied = the action
  does not execute, in every mode, degraded or not.

## Failure modes

- **Bot wall**: containment metrics suppressing trigger 1. Forbidden;
  Themis scores it as false deflection.
- **Context-poor handoff**: a packet missing attempted-actions flags
  forces the human to re-derive state — `escalation-correctness` fails on
  packet-completeness.
- **Approval drift**: reusing an approval for a second action or a larger
  amount. The artifact binds to exact action + scope + limit.
