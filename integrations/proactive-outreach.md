# Integration: Proactive Outreach (R8-3)

**Status: deployment-supplied contract — NOT built in the pack.**
**Explicit out of scope for v1.**

This document defines the contract and the NON-NEGOTIABLE PRECONDITION
GATES that would bind any deployment that builds proactive/outbound
outreach on top of this pack. These gates are not suggestions. A
deployment that bypasses any of them is operating outside the governed
framework and violates the constitution.

---

## What this is (and is not)

**What this pack is:** reactive support. A customer arrives with a need;
the pack responds. The entire pipeline — Iris triage, squad dispatch,
Themis judging, Eunomia clearance, Hermes HITL boundary — is designed
for inbound traffic.

**What this contract covers:** proactive/outbound outreach — messages
initiated by the system to a customer without a customer request. Examples:
onboarding nudges, renewal reminders, health-check pings, win-back
campaigns, satisfaction follow-ups. This is an OPPORTUNITY-CLASS deployment
capability, not a reactive-support capability.

**Who builds it:** a deployment, not the pack. The pack provides no
outbound initiation mechanism, no contact-list reader, no campaign
scheduler, and no channel delivery integration. A deployment builds those.
This document defines the gates that MUST bind whatever a deployment builds.

---

## The hard gates (NON-NEGOTIABLE preconditions)

These gates are structural prerequisites. A deployment must satisfy ALL
of them before sending a single outbound message. They are not a checklist
to complete and move past; they are permanent invariants that apply to
every outbound send, forever.

### Gate 1 — Explicit consent, on record, before contact

No outreach message may be sent to a customer without a consent record
that explicitly covers:
- The channel (email, SMS, in-app, push — consent is channel-specific).
- The purpose class (transactional vs. marketing vs. retention — consent
  is purpose-specific).
- The customer identity (opaque hash matching the portable-context token's
  `customer:<hash>` ref).
- The consent timestamp and source (where and when the customer opted in).

Consent records live in a deployment-managed consent store, referenced by
the opaque customer hash. The pack never reads raw contact lists. Outreach
is gated on consent lookup returning a valid, non-expired, non-revoked
record for the channel + purpose combination.

This gate is binding under GDPR Art. 6 and Art. 7 (lawful basis /
freely given consent for non-transactional contact), CCPA/CPRA opt-in
requirements for sensitive categories, and the CAN-SPAM / TCPA
channel-specific consent rules. The deployment is responsible for
jurisdictional compliance; the pack provides the enforcement point.

**Degraded path:** if the consent store is unavailable, the outreach
attempt is BLOCKED. No outreach on an unverifiable consent record.

### Gate 2 — Eunomia clearance on every outbound draft

Every outbound draft — regardless of how it was generated — passes
through Eunomia's clearance gate before delivery. This applies even to
templated, non-AI-generated messages. Eunomia checks:
- AI-disclosure present (see Gate 4).
- No PII in the outbound body beyond the minimum necessary.
- No injection content from retrieved context (the customer's prior
  ticket content, KB passages) carried verbatim into the outbound body
  as if it were trusted instruction.
- No Article V violation (no promise or execution of a monetary action
  without the approval artifact path).

Eunomia clearance is the final step before delivery, exactly as in
the reactive pipeline. There is no shortcut path for "automated"
or "templated" outbound messages.

### Gate 3 — Themis judging on AI-drafted outbound content

If the outbound message body is AI-drafted (not a static template),
Themis judges it before Eunomia clearance:
- `grounded-in-kb`: any factual claim in the outbound body must be
  KB-cited. No improvised claims about pricing, features, policy, or
  account status.
- `no-false-deflection` equivalent: an outbound message must not make
  a claim that leads the customer to an incorrect conclusion or forecloses
  a legitimate request.
- `empathy-tone-required`: the empathy and tone rubric applies to outbound
  exactly as it does to reactive responses.

A Themis fail on an outbound draft blocks delivery and creates an HITL
item for human review — same as in the reactive pipeline.

### Gate 4 — AI disclosure on every outbound body (Article III)

Every outbound message body carries the AI-disclosure marker:
`[AI-assisted message]` or the channel-appropriate equivalent.

Removal of the disclosure is never an optimization. An outbound message
that omits the disclosure fails Eunomia's clearance gate.

This is a constitutional requirement (Article III) and, increasingly, a
statutory one (EU AI Act, several US state automated-communication
disclosure requirements). The deployment may style the disclosure marker
for the channel; it may not omit it.

### Gate 5 — No manipulation (Article II)

Outbound messages may not use manipulative techniques:
- No false urgency ("your account expires in 1 hour" when it does not).
- No fabricated scarcity ("only 3 slots left" when not true).
- No guilt framing ("you'll miss out if you don't act now").
- No friction mazes that make opt-out harder than opt-in.

The no-manipulation test from `policy-compliance-awareness`: would this
sentence survive being read back to the customer as a description of what
we did? Retention and engagement messaging must serve the customer's
interest, not manufacture pressure.

Harmonia's empathy-first constraint applies to outbound content: the
language acknowledges the customer's context, does not manufacture
emotional pressure, and treats the customer as a person to be helped,
not a conversion target.

A Themis judgment of "manipulation present" blocks the outbound draft
and creates an HITL item.

### Gate 6 — Suppression and opt-out honored, immediately

The deployment MUST maintain a suppression/opt-out list per channel and
purpose class. An opt-out must be:
- Honored before the next send (not "within N days").
- Global across the deployment's outreach system (opt-out of one campaign
  opts out of all campaigns of that purpose class on that channel).
- Reflected in the consent store so Eunomia's consent check catches it
  on the next attempt without a separate suppression lookup.

An attempt to send to a customer who has opted out is a consent violation.
The pack's Eunomia gate blocks any draft whose consent lookup returns
`revoked` or `opted_out`.

---

## What a deployment would build

A deployment building proactive outreach would be responsible for:

1. **Consent store**: a system that records opt-ins by customer hash,
   channel, and purpose class, with timestamps, source, and revocation.
2. **Contact eligibility check**: before drafting, verify consent + suppression.
3. **Outbound draft generation**: static templates or AI-drafted content.
4. **Themis + Eunomia wiring**: pipe every draft through the judging and
   clearance gates (these are the same gates as the reactive pipeline —
   the pack provides them; the deployment wires the call).
5. **Channel delivery**: email, SMS, in-app, push — the delivery
   infrastructure is deployment-owned.
6. **Opt-out capture**: a mechanism for customers to opt out, fed back
   into the consent store in real time.

The pack provides: Themis (judging), Eunomia (clearance), Hermes (HITL
boundary for cases requiring human review), the constitution context,
and the policy-compliance-awareness + owasp-llm-defenses skills.

The pack does NOT provide: consent management, contact eligibility,
campaign scheduling, channel delivery, suppression-list management, or
opt-out capture. These are deployment-owned.

---

## Explicit out-of-scope for v1

Proactive outreach is OUT OF SCOPE for the v1 pack. No outbound
initiation mechanism, no campaign scheduler, no contact reader, and no
channel integration ships in the pack. This document defines what
WOULD bind a deployment that builds it; it does not imply the pack
supports it today.

---

## Safety invariants (non-negotiable, permanent)

These invariants cannot be relaxed by a deployment, in any version:

1. **Consent is a hard prerequisite**: no outreach without a valid,
   non-revoked consent record. Not a soft check; a hard block.
2. **Eunomia clears last**: every outbound draft — template or AI —
   passes Eunomia before delivery.
3. **Article II holds**: no manipulation in outbound content, ever.
4. **Article III holds**: AI disclosure on every outbound body, always.
5. **Opt-out is immediate**: a revoked consent blocks the next send,
   not the next batch run.
6. **Article V holds**: no outbound message executes or promises a
   monetary or account-change action without the approval artifact.
   Outbound retention messaging is recommend-only, the same as inbound.
7. **Right to human (Article I)**: every outbound message includes a
   discoverable path to a human agent, especially for outbound messages
   on account status, billing, or retention topics.

A deployment that removes or bypasses any of these gates does so in
violation of the constitution. The gates are preconditions, not
suggestions.
