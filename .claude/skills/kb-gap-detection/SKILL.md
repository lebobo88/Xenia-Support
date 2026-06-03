---
name: kb-gap-detection
description: "Detecting and filing knowledge-base gaps from failed groundings, conflicts, staleness, and ticket-theme analysis; drafting KB stubs with evidence. Owned by Metis; consumed by Echo."
user-invocable: false
argument-hint: "<file-gap|draft-stub|gap-report>"
allowed-tools:
  - Read
  - Grep
  - Glob
---

# KB Gap Detection

Every NO_ANSWER_SAFE_FALLBACK is the KB telling the house where it is
thin. This skill turns grounding failures into a curation pipeline: the
squad does not edit the KB, it files evidence the KB team can act on.

## Purpose

Detect gaps systematically, file them with enough evidence to fix, and
draft candidate KB stubs from resolved tickets — the "Knowledge
Management Agent" function from the research taxonomy.

## When to use

- Metis whenever grounding fails (mandatory — part of the fail-closed
  protocol in `kb-rag-citation`).
- Echo during VoC synthesis (theme-level gap patterns).
- `/kb-gap-report` for the periodic roll-up.

## Gap classes

| Class | Signal |
|---|---|
| **Missing** | retrieval returned nothing usable for a real intent |
| **Stale** | volatile-class source disqualified by age (`freshness-aware-retrieval`) |
| **Conflicting** | two sources disagree on currently-true facts |
| **Unfindable** | the content exists but retrieval missed it (vocabulary mismatch between customer language and doc language) |
| **Wrong-altitude** | doc exists but answers the adjacent question (reference where how-to is needed, or vice versa) |

## The gap note

Filed to `hearth/output/kb-gaps/{topic}-{date}.md`:

```yaml
kb_gap:
  gap_id: GAP-<date>-<seq>
  class: missing | stale | conflicting | unfindable | wrong-altitude
  intent: <triage intent class>
  customer_phrasing: [<redacted phrasings customers actually used>]
  tickets: [<ticket ids>]            # evidence trail
  sources_involved: [<doc refs + as-of dates>]   # for stale/conflicting
  frequency: <count this period>
  proposed_fix: <new doc | update + which | retire + which | retitle/alias>
```

## Drafting KB stubs

For `missing` gaps with a RESOLVED ticket trail, draft a candidate stub
from the resolution: problem statement in customer phrasing, the verified
steps (from Asclepius's diagnosis or Metis's eventual grounded answer),
applicability bounds, and an explicit `DRAFT — needs owner review` header.
Stubs are candidates for the KB team, never silently published; the
squad's authority ends at evidence.

## Vocabulary harvesting

The `customer_phrasing` field is the quiet gold: docs written in product
vocabulary fail retrieval against customer vocabulary. Echo aggregates
phrasings per theme so fixes get titled in the words customers will
search with.

## Failure modes

- **Gap spam**: filing every miss without dedup — gaps roll up by
  intent + class; frequency counts, duplicates merge.
- **Fix overreach**: writing final KB content instead of evidence-backed
  drafts.
- **Silent self-healing**: answering from model knowledge to paper over
  a gap instead of filing it (Article VI violation AND a lost curation
  signal).
