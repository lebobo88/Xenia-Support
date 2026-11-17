---
doc_id: account-and-team-management
title: "Account and Team Management"
as_of: "2026-03-01"
topic_class: active
owner: kb-team
---

## Overview

This article covers Lumenboard account settings, user roles, team management, and organizational administration for Pro and Team plan customers.

## User Roles

Lumenboard has three user roles at the account level:

| Role | Description | Who can assign |
|------|-------------|---------------|
| **Member** | Standard user; can create and edit their own dashboards | Admin, Owner |
| **Admin** | Can manage users, integrations, and billing | Owner |
| **Owner** | Full control; can delete the account | Only one per account |

Role changes take effect immediately. You cannot demote yourself from Owner without first promoting another user to Owner.

## Inviting Team Members

1. Go to **Account Settings → Team**.
2. Click **Invite members**.
3. Enter email addresses (comma-separated for bulk invites).
4. Assign a role (Member or Admin).
5. Click **Send invitations**.

Invitations expire after 7 days. You can resend an invitation from the Team page.

**Seat limits**: Pro plan supports 1–5 seats. Team plan starts at 5 seats with no cap. Adding more members beyond your current seat count will prompt you to purchase additional seats; billing is prorated for the current month.

## Removing Team Members

1. Go to **Account Settings → Team**.
2. Find the member and click the three-dot menu.
3. Select **Remove from team**.

Removing a member immediately revokes their access. Their dashboards and saved queries are transferred to the account Owner. The vacated seat becomes available immediately; billing for the removed seat credits the next invoice.

## Single Sign-On (SSO)

SSO is available on Team plan. Lumenboard supports:

- **SAML 2.0**: Configure under **Account Settings → Security → SAML SSO**. Provide your IdP's metadata URL or XML.
- **OIDC**: Configure under **Account Settings → Security → OIDC**. Provide the issuer URL, client ID, and client secret.

When SSO is enabled, you can optionally enforce it so that password-based login is disabled for all non-Owner accounts.

## Two-Factor Authentication

All users can enable 2FA under **Profile → Security → Two-Factor Authentication**. Supported methods:

- Authenticator app (TOTP, e.g., Google Authenticator, Authy)
- SMS backup code (not recommended as primary)

Admins can enforce 2FA organization-wide under **Account Settings → Security → Require 2FA**. Users without 2FA set up will be prompted to configure it on next login.

## Billing and Seat Management

The account Owner and Admins can manage billing from **Account Settings → Billing**:

- View current plan, seat count, and next invoice date.
- Add or remove seats.
- Update payment method.
- Download past invoices.

Lumenboard accepts Visa, Mastercard, American Express, and ACH bank transfers (annual plans only).

## Transferring Account Ownership

To transfer the Owner role to another user:

1. Go to **Account Settings → Team**.
2. Find the target user and click **Promote to Owner**.
3. Confirm the transfer.

Your role is automatically downgraded to Admin after the transfer.

## Deleting the Account

Account deletion is permanent and cannot be undone. To delete your account:

1. Go to **Account Settings → Danger Zone → Delete Account**.
2. Type the account name to confirm.
3. Click **Delete permanently**.

All data is deleted within 30 days of account deletion. Export any data you wish to retain before deleting.
