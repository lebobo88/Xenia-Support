---
doc_id: product-architecture-concepts
title: "Lumenboard Product Architecture Concepts"
as_of: "2025-01-15"
topic_class: stable
owner: kb-team
---

## Overview

This article explains the core architectural concepts underlying Lumenboard's data platform. Understanding these concepts helps users build more effective dashboards and troubleshoot data pipeline issues.

## The Query Engine

Lumenboard's query engine is a stateless, distributed system that translates Lumenboard query definitions into native queries for each connected data source. When you run a dashboard, each panel issues an independent query to the query engine.

The query engine does NOT store copies of your source data. It passes queries through to the underlying data source at query time and returns results to the dashboard. This means:

- Dashboard freshness depends on the freshness of your underlying data source.
- Lumenboard's query engine latency adds typically 50–200ms on top of your data source's query latency.
- You can query very large datasets without storing them in Lumenboard, provided your data source can handle the query.

## Data Sources and Connectors

A **data source** in Lumenboard is a configured connection to an external system (database, SaaS API, file store). A **connector** is the software driver that handles authentication and query translation for a specific data source type.

Connectors translate Lumenboard's internal query representation (LQL — Lumenboard Query Language) into the target system's native query format (SQL, REST API calls, etc.).

## LQL (Lumenboard Query Language)

LQL is Lumenboard's declarative query language, designed to be source-agnostic. Key concepts:

- **Measures**: Aggregated numeric values (sums, counts, averages, percentiles).
- **Dimensions**: Categorical or time-based groupings.
- **Filters**: Row-level conditions applied before aggregation.
- **Time ranges**: All LQL queries support a time dimension; Lumenboard standardizes time-zone handling across sources.

LQL compiles to SQL for database sources and to API-specific parameter sets for SaaS sources.

## Dashboard Rendering Pipeline

When a user opens a dashboard:

1. The browser requests the dashboard definition from the Lumenboard API.
2. For each panel, the browser sends a query execution request to the query engine.
3. The query engine translates the panel's LQL into native queries and dispatches them to the respective data source connections.
4. Results are returned to the query engine, post-processed (type coercion, null handling, sorting), and streamed back to the browser.
5. The browser renders each panel as results arrive.

Panels render independently, so a slow data source on one panel does not block other panels from rendering.

## Caching

Lumenboard caches query results at two levels:

- **Browser cache**: Panel results are stored in session storage for the duration of the browser session. Refreshing the page evicts the browser cache.
- **Server-side cache**: Frequently executed queries are cached server-side for up to 5 minutes. This improves performance for shared dashboards with many simultaneous viewers.

The server-side cache is keyed on the exact query + data source credentials identifier. Changing a filter or time range produces a different cache key and triggers a fresh query.

## Alerts and Monitoring

Lumenboard's alert system evaluates alert conditions on a schedule (minimum 5-minute intervals for Pro, 1-minute for Team). Alert evaluation runs the associated LQL query and checks the result against the defined threshold.

Alerts are stateful: once triggered, an alert will not re-notify until it resolves and triggers again, unless configured in "always notify" mode.

## Data Security Model

All data source credentials are encrypted at rest using AES-256 and in transit using TLS 1.2+. Lumenboard employees cannot access customer data source credentials. The query engine uses short-lived connection tokens that are never logged.

Row-level security for data sources that support it (e.g., PostgreSQL row security policies) is enforced at the data source level, not in Lumenboard — Lumenboard queries run with whatever permissions the configured credentials provide.
