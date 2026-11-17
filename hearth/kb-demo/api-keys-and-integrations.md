---
doc_id: api-keys-and-integrations
title: "API Keys and Integrations"
as_of: "2026-04-01"
topic_class: active
owner: kb-team
---

## Overview

Lumenboard's REST API allows programmatic access to dashboards, data sources, and export functionality. This article covers API key management and connecting third-party integrations.

## API Access by Plan

API access is available on Pro and Team plans.

| Plan | API Access | Rate Limit |
|------|-----------|------------|
| Free | No | N/A |
| Pro | Yes | 1,000 requests/hour |
| Team | Yes | 10,000 requests/hour |

Rate limits are enforced per API key. Exceeding the rate limit returns a `429 Too Many Requests` response with a `Retry-After` header indicating when the limit resets.

## Creating an API Key

1. Navigate to **Account Settings → API Keys**.
2. Click **New API Key**.
3. Give the key a descriptive name (e.g., "Data pipeline - production").
4. Choose the key's permission scope:
   - **Read-only**: Can retrieve dashboards and query data; cannot modify anything.
   - **Read-write**: Can create and update dashboards and data sources.
   - **Admin**: Full access, including user management (Team plan only).
5. Optionally set an expiration date.
6. Click **Create** and copy the key immediately — it will not be shown again.

Store API keys securely. Treat them like passwords.

## Rotating or Revoking an API Key

To rotate a key, create a new key with the same permissions, update your application, then revoke the old key. Both keys will work simultaneously during the transition.

To revoke a key, click the trash icon next to it in **Account Settings → API Keys**. Revocation is immediate and permanent.

## Authentication

Pass the API key in the `Authorization` header:

```
Authorization: Bearer lmb_your_api_key_here
```

All API calls must use HTTPS. HTTP requests are redirected to HTTPS.

## Connecting Integrations

Lumenboard supports connecting external data sources as integrations. Supported integration types:

- **Databases**: PostgreSQL, MySQL, BigQuery, Snowflake, Redshift
- **SaaS data sources**: Salesforce, HubSpot, Stripe, Google Analytics 4
- **File sources**: Amazon S3, Google Cloud Storage
- **Spreadsheets**: Google Sheets

### Adding an Integration

1. Go to **Data Sources → Add Integration**.
2. Select the integration type.
3. Follow the authentication flow for the specific integration (OAuth for SaaS sources, connection string for databases).
4. Name the integration and click **Test Connection** to verify.
5. Click **Save**.

### Integration Permissions

Each integration stores credentials encrypted at rest using AES-256. Connection credentials are never exposed via the API. If you need to update credentials, delete and re-create the integration.

## Webhooks (Team Plan)

Team plan customers can configure webhooks to receive notifications when specific events occur in Lumenboard:

- Dashboard updated
- Export completed
- Alert triggered
- User invited or removed

Configure webhooks at **Account Settings → Webhooks**. Each webhook includes a shared secret for HMAC-SHA256 signature verification. Always verify the `X-Lumenboard-Signature` header before processing webhook payloads.

## API Documentation

Full API reference is available at https://docs.lumenboard.io/api/v2. The reference includes interactive examples using your live API keys (when authenticated in the docs portal).
