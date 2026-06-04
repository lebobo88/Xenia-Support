# Integration: Churn-Propensity Signal (R8-1)

**Status: deployment-supplied contract — NOT built in the pack.**

This document defines the contract for an OPTIONAL deployment-time
integration that supplies a churn-propensity signal to Soteria. The
pack does not implement the signal source; a deployment may implement
it and wire it in according to this contract.

---

## What this is

Soteria currently reads churn risk from ticket text only: explicit
statements ("I'm thinking of cancelling"), sentiment trajectory, account
context in the portable-context token, and prior escalation history.

A deployment MAY supply an external churn-propensity signal — an ML
model or heuristic service that scores accounts over usage telemetry,
billing history, login frequency, feature adoption, and similar
behavioral signals. This contract defines exactly how that signal
interacts with Soteria.

---

## The contract (inputs, not actions)

The churn-propensity signal is an INPUT to Soteria's recommend-only
reasoning. It is never an authorization for action.

### Signal shape

The signal arrives as fields on the portable-context token's
`constraints[]` array, populated by Iris during triage (or by the
ticket-system bridge if the deployment enriches the ticket envelope):

```yaml
constraints:
  - type: churn_risk
    score: 0.82            # float 0.0–1.0; higher = higher risk
    tier: high             # low | medium | high | critical (deployment-defined)
    factors:               # opaque list — see Privacy below
      - "usage_decline_30d"
      - "billing_overdue"
    signal_source: "churn-model-v3"
    signal_ts: "2026-06-04T10:00:00Z"
    ttl_seconds: 3600
```

Fields are all optional individually; if `churn_risk` is absent from
`constraints[]`, the degraded path applies (see below). The `factors`
array MUST use opaque, non-PII labels (feature names, behavioral
categories) — raw account identifiers, usage counts, or customer names
MUST NOT appear here.

### How Soteria uses it

Soteria reads `churn_risk.score` and `churn_risk.tier` to:
- Calibrate the empathy register and escalation threshold in its
  retention reasoning.
- Inform (not constrain) which retention options to surface to the
  human in a recommend-only recommendation.
- Flag the ticket for a higher-urgency human review path when
  `tier: critical` and the ticket intent warrants it.

Soteria DOES NOT:
- Take any autonomous retention action based on the signal.
- Offer a discount, credit, or contract extension autonomously — those
  remain recommend-only, subject to Article V (human approval artifact
  required for any execution).
- Share the signal score or factors with the customer in any customer-
  facing body.

### Recommend-only is unchanged

A high churn score (even `score: 1.0`, `tier: critical`) NEVER authorizes
an autonomous retention action. Article V holds without modification:
every monetary or account-change action (credit, discount, plan change,
cancellation reversal) requires the approval artifact, carried by Hermes
alone. The churn signal is additional context for the recommend-only
recommendation, not a trigger for execution.

This is a non-negotiable invariant. A deployment that wires the signal
differently — for example, using a high churn score to auto-approve a
retention credit — violates Article V and the constitution. The pack
provides no mechanism for such a path, and deployments that add one do
so outside the governed framework.

---

## Degraded path

If the `churn_risk` constraint is absent from the portable-context token
(no deployment signal, signal service unavailable, or triage did not
enrich), Soteria falls back to its built-in text-based reading:

- Explicit churn signals in ticket text ("I'm cancelling").
- Sentiment trajectory in the conversation.
- Prior escalation history from TheEights recall.

This degraded path is already supported and is the current production
behavior. The deployment-supplied signal is an enrichment, not a
dependency.

---

## Privacy requirements

The churn signal MUST arrive with opaque references. Specifically:

- `factors` MUST use behavioral-category labels only (e.g.,
  `"usage_decline_30d"`, `"billing_overdue"`, `"feature_adoption_low"`).
  Raw telemetry values, account usage counts, and customer identifiers
  MUST NOT appear in this field.
- `customer` identity in the portable-context token MUST already be
  opaque (`customer:<hash>` form, not raw email or account name) before
  the churn signal is attached.
- The signal source (`signal_source`) is recorded in the clearance
  artifact for audit, not in any customer-facing output.
- The Eunomia gate re-redacts the portable-context token on every
  clearance pass; it treats `churn_risk.factors` values as
  potentially-sensitive and applies its existing PII-check before
  any outbound write.

A deployment that enriches the portable-context token with a churn
signal that contains PII in `factors` has produced a pre-Eunomia Layer-1
violation. The constitution's layered redaction still applies, but the
deployment is responsible for not introducing raw PII at this layer.

---

## Deployment-supplied boundary

This integration is:
- **Deployment-supplied**: the pack defines the contract; a deployment
  builds the signal source, wires it to the ticket-system bridge or Iris
  enrichment step, and is responsible for the signal's accuracy, privacy
  compliance, and freshness.
- **Not pack-built**: no churn-model service, no usage-telemetry reader,
  and no billing-history connector ships in this pack. The pack only
  defines how the signal is consumed.
- **Optional**: the pack degrades gracefully to text-based churn reading
  when the signal is absent.

A deployment building this integration should:
1. Define the model or heuristic, its training data policy, and its
   GDPR/CCPA data-minimization compliance separately from this pack.
2. Wire the enrichment at the ticket-system bridge or at Iris's triage
   step, populating `constraints[]` before Iris mints the portable-context
   token.
3. Ensure `factors` labels are pre-approved and contain no PII.
4. Set a `ttl_seconds` appropriate to the signal's freshness — Iris
   should not apply a stale signal to a current ticket.

---

## Safety invariants (non-negotiable)

These invariants cannot be relaxed by a deployment:

1. **Article V holds**: no churn score, however high, authorizes an
   autonomous account or monetary action.
2. **Recommend-only is absolute**: Soteria's output is always a
   recommendation for a human to act on, never an executed instruction.
3. **Opaque refs**: the signal arrives and stays opaque — no raw PII
   in factors, no customer identifiers in any outbound body.
4. **Eunomia clears last**: even with a churn signal in context, the
   clearance gate (Eunomia) is the final step before any artifact ships.
5. **Right to human**: a high churn risk flag never suppresses a
   customer's right to a human agent (Article I).
