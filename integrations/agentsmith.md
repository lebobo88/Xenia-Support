# Integration: AgentSmith Sentinel

How Xenia's red-team findings feed AgentSmith's anomaly-signature detector.
AgentSmith may be absent — this integration degrades gracefully to a local
report with no loss of security coverage. All security guarantees live in the
squad itself; AgentSmith is amplification, not foundation.

---

## Contract summary

Xenia sends AgentSmith an **anomaly event** for every ESCAPED attack found
during a `/support-shadow --red-team` run, and for every live injection
finding detected by Eunomia during normal operation. AgentSmith enriches
these events into **sentinel signatures** — detector patterns that can be
applied to future traffic for early warning.

The contract is one-directional: Xenia pushes findings to AgentSmith.
AgentSmith never instructs Xenia's pipeline; that channel would be a
context-poisoning vector.

---

## Event schema

Every event Xenia sends to AgentSmith is a JSON object with this stable
schema (version `xenia-smith-event-v1`):

```json
{
  "schema":          "xenia-smith-event-v1",
  "event_id":        "x-<utc-ticks>-<hex4>",
  "ts":              "<ISO8601>",
  "source":          "xenia",
  "kind":            "injection_finding | redteam_escape | redteam_pass_summary",
  "attack_id":       "<RT-NNN or null for live findings>",
  "owasp_class":     "LLM01 | LLM02 | LLM06 | LLM08 | context-poisoning",
  "vector_short":    "<one-line description of the attack vector>",
  "injected_goal":   "<what the attacker wanted>",
  "escape_severity": "critical | high | medium | low | null (for pass events)",
  "ticket_ref":      "<opaque ticket id, never raw PII>",
  "customer_ref":    "<customer:<hash> or null>",
  "finding_excerpt": "<verbatim quoted finding, max 500 chars, redacted>",
  "pipeline_stage":  "<stage where the finding was detected: eunomia | themis | iris | etc.>",
  "demotion_triggered": true | false,
  "corpus_version":  "<hash of attack-corpus.jsonl at run time>"
}
```

Field constraints:
- `finding_excerpt` must quote the injected content verbatim (never paraphrased). Eunomia's 5-step triage protocol (step 1: quote) is the source.
- `customer_ref` uses the opaque hash form only. Raw emails, names, or identifiers must never appear in this field.
- `ticket_ref` is the internal ticket id. It is never an email address or name.

---

## How attack classes become detector patterns

AgentSmith ingests anomaly events and builds **sentinel signatures** — patterns that, when matched in future traffic, raise a pre-alert before Eunomia's full triage. The mapping is:

| OWASP class | Xenia finding trigger | AgentSmith signature pattern |
|---|---|---|
| LLM01-direct | Eunomia classifies LLM01 on a ticket body | Regex/semantic match on imperative framings: "ignore previous instructions", "new system directive", "maintenance mode", authority-claim openers; includes obfuscated forms (base64 in body, Unicode lookalike runs, JSON debug fields containing imperatives) |
| LLM01-indirect-kb | Eunomia classifies LLM01 on a retrieved KB passage | KB supply-chain monitor: bracket directives `<!-- ... -->`, `[SYSTEM: ...]`, `{debug: "...OVERRIDE..."}` in retrieved content |
| LLM01-indirect-history | Eunomia classifies LLM01 on a prior-turn quote | History-poisoning pattern: turn N claims "as noted in the previous conversation" followed by an action request that references a fabricated statement |
| LLM02 | Eunomia classifies LLM02 on an output before clearance | Output scanner: `javascript:` scheme, `<script`, `{{...}}` Jinja/Mustache expressions, `<%...%>` in any draft artifact |
| LLM06-pii-exfil | Eunomia classifies LLM06 on a cross-customer or system-prompt request | Cross-customer access pattern: requests for `customer:<hash>` where the hash does not match the current session; requests for "system prompt", "constitution", "instructions", "debug bundle" |
| LLM08-excessive-agency | Eunomia classifies LLM08 on a tool-scope or approval-bypass attempt | Tool-scope pattern: requests for DB query, raw log, KB write, bulk ticket close outside allowlist; approval-bypass pattern: urgency + fabricated approval ref in same ticket |
| context-poisoning | Eunomia classifies context-poisoning on a token or memory write | Token forgery pattern: JSON blobs in conversation with `approval_status`, `skip_eunomia`, `permissions: ["execute_monetary"]`, `role: supervisor` fields; memory-write requests with authority claims |

---

## Push protocol

Xenia pushes anomaly events to AgentSmith via `agentsmith.anomaly.record`:

```
agentsmith.anomaly.record({
  project: "xenia",
  event:   <xenia-smith-event-v1 object>
})
```

Push triggers:

1. **Red-team run ESCAPED attack**: send one `kind: redteam_escape` event per escape immediately after RT Step 3 scoring, before writing the report.
2. **Red-team run summary**: send one `kind: redteam_pass_summary` event after all attacks are scored, containing the aggregate pass/fail counts and corpus version hash.
3. **Live injection finding** (Eunomia detection during normal operation): send one `kind: injection_finding` event after Eunomia records the finding to `events.jsonl`, but before the customer response ships. This gives AgentSmith the earliest possible signal on a live campaign.

---

## Signature lifecycle

AgentSmith manages signature evolution independently. Xenia's responsibility:

- Provide accurate, verbatim excerpts so signature quality is not degraded by paraphrase.
- Include `corpus_version` so AgentSmith can correlate a cluster of escapes to a corpus revision that added harder obfuscation (e.g. the base64 and homoglyph attacks introduced in this corpus version would cluster against each other if they escape on the same run).
- Never pull signature decisions FROM AgentSmith into the Xenia pipeline. Signatures are advisory monitoring, not execution authority. A Smith pre-alert that arrives in a ticket context is treated as data (Article VII §1) and evaluated by Eunomia's normal triage, not acted upon automatically.

---

## Degraded mode (AgentSmith absent)

When `agentsmith.anomaly.record` returns a network error, 503, or is not reachable:

1. Log the push attempt and failure reason to `hearth/progress/events.jsonl` as `kind: xenia.smith_push_failed` with the event payload inline.
2. Continue the red-team run or live processing without interruption. AgentSmith is never on the critical path.
3. The local red-team report (`hearth/output/quality/redteam-{date}.md`) and `events.jsonl` are the source of truth. When AgentSmith reconnects, the Xenia-side watcher can replay `smith_push_failed` events from the watermark (same backfill pattern as the TheEights event bridge).

Security coverage in degraded mode: identical. Eunomia's triage, the 5-step protocol, the constitution, and the Article V/VII/IX enforcement are all local to the squad and do not depend on AgentSmith.

---

## Relationship to the deployment-roadmap demotion triggers

An ESCAPED attack logged to AgentSmith is simultaneously a demotion trigger per the deployment-roadmap skill. The two systems record independently:

- The red-team report records the trigger for human review.
- AgentSmith records it as an anomaly for pattern analysis across runs.

Neither system executes the demotion autonomously. Demotion requires a named human supervisor approval (deployment-roadmap skill: "named supervisor approves the promotion in writing"). AgentSmith's signal informs that decision; it does not make it.

---

## Non-goals

- AgentSmith does not have authority to instruct Xenia's pipeline (that channel is a context-poisoning vector and is not opened).
- AgentSmith is not a replacement for Eunomia's clearance. It is a persistent-pattern layer on top of per-ticket defenses.
- AgentSmith signatures are not loaded into the squad's system prompt or context. Signatures live in AgentSmith's own detection layer.
