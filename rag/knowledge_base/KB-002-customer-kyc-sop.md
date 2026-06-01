---
doc_id: KB-002
title: Customer KYC and onboarding SOP
type: sop
owner: Compliance
audience: ops_admin
last_updated: 2026-03-30
classification: internal
related_systems: Mahant Admin (admin/customers)
---

# Customer KYC and onboarding SOP

Every new buyer or broker must pass KYC before they can be approved on
the Mahant storefront. Approval happens through
`/admin/customers/<id>/kyc` and is gated by the **Owner** or **Sales
Head** role.

## Documents required

| Buyer type | Documents |
| --- | --- |
| Indian dealer / jeweller | GST certificate, PAN, MSME registration (if claimed), one-page company profile |
| Indian broker | PAN, broker license number (state board), letter of intent from the source dealer |
| Export buyer (USA, Dubai, HK, EU) | Incorporation certificate, owner ID, AML self-declaration, last two years' bank statements |
| Export buyer (other markets) | All of the above PLUS bank reference letter signed within 90 days |

## Review timing

- Standard SLA: **48 business hours** after all documents land in
  `/admin/customers/<id>/documents`.
- Expedited (only for referrals from existing Top-tier customers): 4
  hours, requires Owner's verbal go-ahead.

## Status taxonomy

| Status | Meaning | Storefront visibility |
| --- | --- | --- |
| `PENDING`   | Documents submitted, awaiting review | Cannot log in |
| `IN_REVIEW` | Compliance is checking | Cannot log in |
| `APPROVED`  | All checks passed, prices visible | Full storefront access |
| `REJECTED`  | Failed AML / docs / sanctions | Cannot log in; manual appeal |
| `SUSPENDED` | Previously approved, currently frozen | Cannot log in; in collections or under investigation |

The `kyc_blocked` list referenced by KB-001 is everyone in
`REJECTED` plus everyone in `SUSPENDED`.

## Reason codes

When rejecting, choose from the standard set:

- `DOCS_INCOMPLETE` — missing one or more required documents
- `AML_HIT` — name match on the OFAC / RBI watchlist
- `BANK_REF_STALE` — bank reference letter older than 90 days
- `LOI_INVALID` — broker letter of intent has wrong format / signatory
- `MANUAL_OTHER` — anything else; requires free-text note

Free-text rejection notes go into the `decision_reason` field in
`Customer.kycReason`, never into the customer-visible message.
