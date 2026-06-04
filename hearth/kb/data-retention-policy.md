---
doc_id: data-retention-policy
title: "Lumenboard Data Retention Policy"
as_of: "2026-05-20"
topic_class: volatile
owner: kb-team
---

## Overview

This document defines how long Lumenboard retains customer data, query history, exported files, and account-related records across each subscription tier.

## Query and Dashboard History

Data retention for query history and dashboard snapshots is plan-dependent:

| Plan | Query History | Dashboard Snapshots |
|------|--------------|---------------------|
| Free | 30 days | Not retained |
| Pro | 12 months | 90 days |
| Team | 36 months | 12 months |

After the retention period, historical records are automatically purged from Lumenboard's production databases within 7 days of the expiration date.

## Exported Files

CSV export files generated through the Lumenboard UI are stored temporarily for download purposes:

- Files are available for download for 72 hours after export generation.
- After 72 hours, export files are deleted from Lumenboard's servers.
- Scheduled exports are delivered to the configured destination (email or webhook) and are not stored on Lumenboard's servers beyond the 72-hour download window.

## Account Data After Cancellation

When a subscription is cancelled or an account is closed:

- **Active data** (dashboards, integrations, saved queries) is placed in read-only mode immediately.
- **Data deletion**: All account data is permanently deleted 30 days after cancellation.
- **Export window**: Customers have 30 days post-cancellation to export their data before deletion.

Lumenboard will send two email reminders: one at day 7 and one at day 25 of the deletion countdown.

## Audit Logs (Team Plan)

Audit logs for Team plan accounts are retained for 90 days on Lumenboard's servers. Customers may export audit logs at any time during the retention period. After 90 days, audit logs are purged unless exported.

## Compliance Holds

For customers subject to legal hold requirements, Lumenboard offers a Compliance Hold add-on (available on Team plan) that suspends automatic deletion. Contact legal@lumenboard.io to activate a compliance hold.

## Data Residency

By default, Lumenboard stores all customer data in US-East data centers. EU data residency is available for Team plan customers as an opt-in configuration. Contact support to request EU data residency.

## Changes to This Policy

Lumenboard will notify customers via email and in-app banner at least 30 days before any material reduction in retention periods.
