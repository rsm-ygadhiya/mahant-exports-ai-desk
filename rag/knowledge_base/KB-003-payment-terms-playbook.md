---
doc_id: KB-003
title: Payment terms playbook
type: policy
owner: Finance
audience: sales_desk
last_updated: 2026-04-01
classification: internal
related_systems: Mahant Admin, Scintilla
---

# Payment terms playbook

This is the canonical list of payment terms Pramukh Gems extends.
Sales reps may **offer** any term from this list to an approved
customer without further sign-off. Anything outside the list — longer
horizon, partial advance, custom finance — requires Owner approval and
must be logged in the audit trail.

## Standard terms

| Code     | Days | Eligibility                       | Discount adjustment |
| ---      | ---: | ---                               | ---                 |
| `ADVANCE` | 0   | Anyone; required for first 3 orders by export buyers | +1% discount |
| `NET30`   | 30  | Approved customers with payment_score ≥ 75            | 0 |
| `NET60`   | 60  | Top / High tier; payment_score ≥ 85                   | −0.5% (effectively a 0.5% premium for the longer credit) |
| `NET75`   | 75  | Top tier only; > 2 yrs relationship                   | −1% |
| `FINANCE` | 90  | Top tier export buyers only; via Drip Capital channel | priced separately, see KB-011 |

## Late-payment escalation

Days past due (DPD) is computed nightly by the collections automation
in Scintilla.

| Bucket    | DPD range | Action |
| ---       | ---: | --- |
| Upcoming  | < 0   | No action |
| Just due  | 0–7   | Auto soft reminder via WhatsApp |
| Aging     | 8–29  | Phone call from sales rep; log outcome in CRM notes |
| Overdue   | 30–59 | Finance takes over; suspend any new memo requests |
| Critical  | ≥ 60  | Pause storefront access; only Owner can reactivate |

## Payment scoring

`payment_score` (0–100) is recomputed weekly and visible on the
customer detail page. It moves up by 2 points per on-time payment and
down by 5 × (days late / 30) per late payment. New customers start at
70.

## Bank channels

Wire transfer (SBI / HDFC), local NEFT, RTGS, Drip Capital for export
finance. Bitcoin / crypto is explicitly **not** accepted. Cheques are
not accepted for first-time orders.
