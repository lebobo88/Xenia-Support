---
doc_id: dashboard-sharing-howto
title: "Dashboard Sharing How-To"
as_of: "2026-03-15"
topic_class: active
owner: kb-team
---

## Overview

Lumenboard supports several methods for sharing dashboards with teammates and external stakeholders. This article covers each sharing method, permission levels, and best practices.

## Sharing with Team Members

To share a dashboard with someone who has a Lumenboard account in your organization:

1. Open the dashboard you want to share.
2. Click the **Share** button in the top-right toolbar.
3. In the **Share with people** field, enter the teammate's email address.
4. Choose a permission level: **Viewer** or **Editor**.
5. Click **Send invite**.

The teammate will receive an email invitation and the dashboard will appear in their **Shared with me** section.

### Permission Levels

| Permission | Can view | Can comment | Can edit | Can share |
|------------|----------|-------------|----------|-----------|
| Viewer | Yes | Yes | No | No |
| Editor | Yes | Yes | Yes | Yes (up to Viewer) |
| Owner | Yes | Yes | Yes | Yes (any level) |

## Public Share Links

Pro and Team plan users can generate a public share link that allows anyone with the URL to view the dashboard (read-only, no login required).

1. Click **Share** → **Get link**.
2. Toggle **Anyone with the link can view** to ON.
3. Copy the generated URL.

Public share links can be revoked at any time from the same dialog. Revoking a link immediately invalidates it; existing viewers will see a "Dashboard not found" error.

**Note**: Public links expose the dashboard data to anyone who has the URL. Do not use public links for dashboards containing sensitive business metrics without understanding the exposure.

## Embedding Dashboards

Team plan users can embed Lumenboard dashboards into external applications using an iframe embed code.

1. Click **Share** → **Embed**.
2. Configure the embed: choose visible panels, set a fixed time range if desired, and optionally restrict the embed to specific domains.
3. Copy the `<iframe>` snippet and paste it into your application.

Embedded dashboards respect the viewer's authentication state. For public embeds (no login required), enable **Public embed** mode, which generates a signed URL. Signed embed URLs expire after 24 hours by default; this can be extended up to 30 days in embed settings.

## Sharing via Scheduled Reports

To automatically share dashboard snapshots on a recurring schedule:

1. Click **Share** → **Schedule report**.
2. Set the frequency (daily, weekly, monthly).
3. Add recipients (email addresses, comma-separated).
4. Choose the format: PDF snapshot or CSV data export.
5. Click **Save schedule**.

Scheduled reports are delivered from reports@lumenboard.io. Recipients do not need a Lumenboard account to receive scheduled report emails.

## Revoking Access

To remove someone's access to a dashboard:

1. Click **Share** → **Manage access**.
2. Find the person in the list.
3. Click the three-dot menu next to their name and select **Remove access**.

Access is revoked immediately. The person will no longer see the dashboard in their Shared with me list.

## Troubleshooting Sharing Issues

**Invited user says they don't see the dashboard**: Check whether the invite email landed in spam. Alternatively, resend the invite from **Share → Manage access → Resend invite**.

**Embed not rendering**: Verify your application is not blocking iframe content via a Content-Security-Policy header. Lumenboard embeds require `frame-src https://*.lumenboard.io`.

**Public link not working after sharing**: If the link was revoked and re-generated, the recipient needs the new URL. Old links are permanently invalidated on revocation.
