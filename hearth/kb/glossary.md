---
doc_id: glossary
title: "Lumenboard Glossary"
as_of: "2025-03-01"
topic_class: stable
owner: kb-team
---

## Overview

This glossary defines the key terms used across Lumenboard's product, documentation, and support channels.

## A–D

**Alert**: A monitoring rule that evaluates a query on a schedule and sends a notification when the result crosses a defined threshold.

**API Key**: A secret credential used to authenticate programmatic access to the Lumenboard REST API. API keys are scoped to a permission level (read-only, read-write, admin).

**Connector**: The software driver that handles authentication and query translation for a specific data source type (e.g., the PostgreSQL connector, the Salesforce connector).

**Dashboard**: A collection of visual panels arranged on a canvas. Each panel displays the result of a query against one or more data sources.

**Data Source**: A configured, authenticated connection to an external system such as a database, SaaS application, or file store.

**Dimension**: A categorical or time-based attribute used to group or filter data in a query. Examples: country, plan tier, date.

## E–L

**Embed**: A feature that allows a Lumenboard dashboard to be rendered inside an external web application using an `<iframe>` snippet.

**Export**: The process of generating a CSV or other file download from a dashboard's underlying query results.

**Filter**: A condition applied to a query that limits which rows are included in the result before aggregation.

**Integration**: See **Data Source**. "Integration" is used informally; "data source" is the formal term in the UI.

**LQL (Lumenboard Query Language)**: Lumenboard's internal, source-agnostic declarative query language. LQL is compiled to the native query format of each connected data source at execution time.

## M–P

**Measure**: An aggregated numeric value computed by a query. Examples: total revenue (sum), active users (count distinct), p95 latency (percentile).

**Panel**: A single visualization within a dashboard. Each panel has an independently configured query, visualization type, and display settings.

**Permissions**: Access control levels for dashboards (Viewer, Editor, Owner) and for API keys (read-only, read-write, admin).

**Plan**: A subscription tier that determines feature access, seat count, and usage limits. Current plans: Free, Pro, Team.

## Q–S

**Query Engine**: Lumenboard's distributed system that translates LQL queries into native data source queries and returns results. The query engine is stateless — it does not store copies of customer data.

**Rate Limit**: The maximum number of API requests allowed per hour per API key. Pro: 1,000/hour. Team: 10,000/hour.

**Row-Level Security (RLS)**: Access control at the data row level, enforced by the data source (not Lumenboard). Lumenboard queries run with the permissions of the configured data source credentials.

**Scheduled Export**: An automated export configured to run on a recurring schedule and deliver the result file to a specified email or webhook endpoint.

**Seat**: A licensed user slot in a Lumenboard account. The number of available seats is determined by the subscription plan and the number of purchased seats.

**Snippet**: In the context of KB search results, a short extract of text from a KB article that is most relevant to the search query.

**SSO (Single Sign-On)**: Authentication via an external identity provider (IdP), configured using SAML 2.0 or OIDC. Available on Team plan.

## T–Z

**Team Plan**: Lumenboard's highest standard subscription tier, designed for larger organizations. Includes SSO, audit logs, unlimited row exports, and a higher API rate limit.

**Time Range**: A filter applied to the time dimension of a query. Lumenboard standardizes time-zone handling across data sources.

**TLS**: Transport Layer Security. All data in transit between Lumenboard clients, the API, and data sources is encrypted using TLS 1.2 or higher.

**Visualization**: The chart or table type used to display a panel's query results. Supported types include line chart, bar chart, pie chart, table, single stat, and heatmap.

**Webhook**: An HTTP callback that Lumenboard sends to a configured URL when specific events occur (export completed, alert triggered, etc.). Available on Team plan.
