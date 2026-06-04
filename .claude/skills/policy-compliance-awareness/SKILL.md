---
name: policy-compliance-awareness
description: "Encoded policy constraints: refunds/disclosures/consent, GDPR/CCPA data-minimization themes, right-to-human mandates, regulated-claim language rules, AI-disclosure requirements. Consumed by Harmonia, Soteria, Hermes, Eunomia."
user-invocable: false
argument-hint: "<check-claim|check-action|check-disclosure>"
allowed-tools:
  - Read
  - Grep
---

# Policy & Compliance Awareness

The covenant is not only kindness; it is law-shaped kindness. This skill
encodes the regulatory and policy constraints that bound what any head may
say or recommend.

## Purpose

Give every head a single reference for: what requires disclosure, what
requires consent, what requires a human, what language is permitted for
regulated topics, and what data handling the law assumes.

## When to use

- Harmonia and Soteria before any de-escalation or retention language ships.
- Hermes when evaluating regulatory triggers and recording approvals.
- Eunomia on every clearance pass.

## Disclosure rules (Article III)

- AI involvement is disclosed on every customer-facing body:
  `[AI-assisted response]` or channel equivalent. Removal is never an
  optimization.
- When an action was taken on the account (even read-only lookups in some
  jurisdictions), the reply says so plainly.

## Right-to-human mandates (Article I)

- An explicit request for a human is honored immediately — this is both
  covenant and, increasingly, codified law (EU AI Act consumer pathways,
  state-level automated-decision statutes).
- Jurisdictional flags (customer region known to mandate human review for
  the intent class) set `regulatory_flag: true` at triage.
- Every customer-facing response carries a discoverable escape hatch.

**Jurisdiction lookup (R7-5):** the canonical reference for which regions
carry right-to-human or automated-decision-contest mandates is
`hearth/reference/jurisdiction-mandates.json`. Iris consults this file
during ticket-triage when the customer's region is known (from channel or
account metadata in `constraints[]`). Each entry provides:
- `right_to_human` (bool) — whether the region mandates a human-review pathway
- `automated_decision_contest` (bool) — opt-out/contest rights for automated decisions
- `basis` — the statute or regulation name (e.g., "GDPR Art. 22", "CPRA §1798.185")
- `regulated_intent_classes` — intents that trigger the mandate in that region

If the customer's region is in the file and `right_to_human=true`, and the
classified intent matches a `regulated_intent_class` for that region,
Iris sets `regulatory_flag=true`.

**Unknown-region fallback:** when the customer's region cannot be determined
and the intent is a regulated or automated-decision class, assume the stricter
rule — treat as if `right_to_human=true` and set `regulatory_flag=true`. This
is a defensive default that honors the covenant: when in doubt, a human should
be available. The classification block notes the unknown-region fallback.

## Regulated-claim language

| Domain | Rule |
|---|---|
| Financial (fees, refunds, interest, credit) | pre-approved policy language only; numbers cited to the policy doc |
| Medical / health | no advice; approved referral language only |
| Legal | no interpretation; approved referral language only |
| Security incidents | approved incident-comms language; never speculate about scope |

Anything improvised in these domains is an Eunomia block + Hermes referral.

## Monetary and account actions (Article V)

- Refunds, credits, plan changes, cancellations, deletions: recommend-only
  for every head, always. The recommendation states action, scope, amount,
  and policy basis (cited).
- Execution requires the approval artifact, carried by Hermes alone.
- Promises are actions: "we will refund you" without an approval artifact
  is a violation; "I am recommending a refund, a human will confirm" is
  the correct form.

## Data minimization (GDPR/CCPA themes)

- Collect nothing beyond the need of the ticket; ask for the minimum
  identifier that disambiguates.
- Purpose limitation: ticket data serves the ticket; VoC synthesis uses
  aggregates and opaque refs.
- Deletion requests are irreversible actions: Article V flow, plus a
  `FOLLOW_UP_TICKET` confirming completion through the human channel.
- Cross-border awareness: data residency flags ride the portable-context
  token's `constraints[]`.

## No-manipulation test (Article II)

Before any retention or de-escalation language ships, ask: would this
sentence survive being read back to the customer as a description of what
we did? False urgency, fabricated scarcity, guilt framing, and friction
mazes all fail this test. Empathy serves the customer, never the
containment metric.

## Failure modes

- **Policy paraphrase drift**: restating policy from memory instead of
  citing the current doc.
- **Kind lies**: softening a hard policy answer into something untrue.
- **Jurisdiction blindness**: applying home-region rules to a customer in
  a mandate region; when region is unknown and the intent is regulated,
  assume the stricter rule.
