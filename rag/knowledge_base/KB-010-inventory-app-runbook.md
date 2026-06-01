---
doc_id: KB-010
title: Inventory App — Tier-1 IT runbook
type: runbook
owner: IT
audience: tier_1_it
last_updated: 2026-04-25
classification: internal
related_systems: Mahant Admin, Vault App
---

# Inventory App — Tier-1 IT runbook

Tier-1 covers the first 30 minutes of any inventory app incident.
If unresolved at the 30-min mark, escalate per KB-014.

## Common incidents

### 1. "Cannot log in"

| Symptom | First check | Fix |
| --- | --- | --- |
| OTP not arriving | Is the user's phone country code correct? Some export buyers register with the wrong code | Update via `/admin/customers/<id>` |
| OTP expired | OTPs are valid for 5 min only | User requests a new one |
| Email + password fails | Check `Customer.status` — `SUSPENDED` users can't log in (KB-002) | If status is wrong, reset via Owner |
| Admin panel says "forbidden" | Check `Admin.role` + `Admin.permissions` via `/admin/team` | Owner grants the missing module |

### 2. "Stock count seems off"

Run the weekly vault audit script (KB-005). If the audit shows a
discrepancy:

1. Page Owner. **Do not** modify any `Diamond.status` row until the
   Owner approves.
2. Pull the last 30 days of `Diamond.statusHistory` entries for the
   stones in question.
3. Cross-check against `data/raw/memos_seed.csv` for any active
   memos that might explain the absence.

### 3. "Customer can't see a stone they expect"

| Reason | How to confirm |
| --- | --- |
| Stone is `OnMemo` or `Hold` (not Available) | `/admin/diamonds/<id>` shows the status |
| Customer's KYC is not `APPROVED` | `/admin/customers/<id>` |
| Per-customer price hide is in effect | check `PricingRule` for that customer |
| Storefront is in maintenance | banner on the homepage will say so |

### 4. "Excel import failed"

The admin upload page (`/admin/upload`) expects an .xlsx with a
sheet named `Inventory` and column names matching
`web/src/lib/excelImport.ts::COLUMN_ALIASES`. If a customer's
spreadsheet uses different names, edit the alias table — don't ask
the customer to rename columns.

### 5. "Scintilla button does nothing"

This is the most common new-incident report. Three usual causes:

1. The M3 repo isn't on disk at the path in `M3_REPO_PATH` (web/.env).
2. `uv` isn't on PATH on the server.
3. The user is inside a frozen storefront window (Owner declared a
   price freeze — see KB-004).

## Escalation

Anything not in the table above, or any incident still open at the
30-min mark, escalates to Tier-2 (IT Lead) via the escalation matrix
(KB-014).
