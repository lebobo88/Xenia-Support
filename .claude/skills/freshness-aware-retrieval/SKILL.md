---
name: freshness-aware-retrieval
description: "Staleness detection and freshness-weighted retrieval: recency preferences by topic class, stale-source quarantine for pricing/policy/security, and re-ingestion signals. Owned by Metis."
user-invocable: false
argument-hint: "<check-freshness|weight-results>"
allowed-tools:
  - Read
  - Grep
---

# Freshness-Aware Retrieval

A stale source on the wrong topic is worse than no source: it produces
confident, citable, wrong answers. This skill defines how the hearth
weights recency and when age disqualifies a source outright.

## Purpose

Prevent stale-context failures (the research doc's "stale context and
data drift" risk) by making freshness a first-class retrieval signal with
topic-dependent thresholds.

## When to use

- Metis on every retrieval pass.
- Asclepius when runbook age matters (infra changes fast).
- Themis when scoring `kb-citation-grounding`'s source-freshness
  dimension.

## Topic freshness classes

| Class | Examples | Stale threshold | On stale |
|---|---|---|---|
| **Volatile** | pricing, plan limits, policy terms, security advisories, legal language | 90 days or any newer conflicting doc | source disqualified → treat as no source (Article VI.3) |
| **Active** | product features, UI walkthroughs, integrations, runbooks | 6 months | usable with an "as of <date>" caveat in the draft |
| **Stable** | concepts, architecture, formats, troubleshooting fundamentals | 24 months | usable; prefer newer when scores tie |

When a topic spans classes, the most volatile component sets the class.

## Weighting rules

1. Retrieval ranking blends relevance with recency; on near-tie relevance,
   newer wins.
2. Every citation carries its `as-of-date` — the date is part of the
   citation form, so Themis and the customer can both see it.
3. A newer document that contradicts an older one wins, AND the conflict
   is filed as a KB gap (the older doc needs retirement — that is
   curation signal, not noise).
4. Unknown date = treat as oldest in its class; flag for curation.

## Re-ingestion signals

File a KB gap note (`kb-gap-detection`) tagged `freshness` when:
- a volatile-class answer had to fail closed for staleness,
- two sources conflicted on currently-true facts,
- a customer corrected the squad with newer reality than the KB holds.

These notes are the change-data-capture signal the KB pipeline consumes;
the squad does not edit the KB itself, it reports with evidence.

## Failure modes

- **Recency worship**: a fresh-but-thin doc outranking the definitive
  older one on a stable topic. Class thresholds exist precisely so
  stable topics keep their deep sources.
- **Caveat laundering**: "as of last year" buried in a footnote on a
  pricing answer. Volatile topics do not get caveats; they get fresh
  sources or fail closed.
- **Silent conflict resolution**: averaging the old and new price.
  Conflicts surface (Article VI.3); they are never averaged.
