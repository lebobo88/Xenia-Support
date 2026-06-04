---
doc_id: security-disclosure-policy
title: "Lumenboard Security Disclosure Policy"
as_of: "2025-12-01"
topic_class: volatile
owner: kb-team
---

## Overview

This document describes Lumenboard's responsible disclosure policy for security vulnerabilities, including how to report findings, our response timeline, and our safe harbor commitments.

This is the DELIBERATELY STALE article in the seed corpus. as_of is 2025-12-01,
which is more than 90 days before 2026-06-04, making it stale under the volatile threshold.

## Reporting a Security Vulnerability

Lumenboard takes all security reports seriously. If you believe you have discovered a security vulnerability in any Lumenboard product or service, please report it to us privately.

**Report via email**: security@lumenboard.io (PGP key available on our keyserver — fingerprint: `ABCD 1234 EFGH 5678 IJKL 9012 MNOP 3456 QRST 7890`)

**Bug Bounty Program**: We participate in a private bug bounty program. Qualifying researchers may be eligible for rewards ranging from $100 to $10,000 depending on severity. Contact us at the above address for an invitation.

Do NOT disclose vulnerabilities publicly before we have had the opportunity to investigate and remediate.

## Scope

In-scope for security research:

- lumenboard.io and all subdomains
- Lumenboard mobile applications (iOS and Android)
- Lumenboard REST API (api.lumenboard.io)
- Browser extensions published by Lumenboard

Out of scope:

- Third-party services integrated via Lumenboard connectors
- Social engineering attacks against Lumenboard employees
- Denial of service attacks
- Physical security

## Response Timeline

| Milestone | Target Time |
|-----------|-------------|
| Acknowledgement of report | 48 hours |
| Initial triage and severity assessment | 5 business days |
| Remediation for Critical/High severity | 30 days |
| Remediation for Medium/Low severity | 90 days |
| Public disclosure coordination | After remediation + 7 days |

## Safe Harbor

Lumenboard will not pursue legal action against security researchers who:

- Report findings to security@lumenboard.io before any public disclosure
- Make a good-faith effort to avoid privacy violations and service disruption
- Do not access, modify, or exfiltrate customer data beyond what is minimally necessary to demonstrate the vulnerability

Lumenboard commits to working with researchers in good faith and recognizes that security research benefits the entire community.

## Severity Classification

We use CVSSv3 scoring:

- **Critical** (9.0–10.0): Authentication bypass, remote code execution, mass data exposure
- **High** (7.0–8.9): Privilege escalation, significant data leak
- **Medium** (4.0–6.9): Limited data exposure, logic flaws
- **Low** (0.1–3.9): Minor information disclosure, hardening issues

## Hall of Fame

Researchers who responsibly disclose valid vulnerabilities are listed (with permission) on our Security Hall of Fame at lumenboard.io/security/hall-of-fame.
