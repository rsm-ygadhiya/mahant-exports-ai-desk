---
doc_id: KB-007
title: Customer tier definitions (Top / High / Mid / Low)
type: policy
owner: Sales Head
audience: sales_desk
last_updated: 2026-03-15
classification: internal
related_systems: Scintilla, Mahant Admin
---

# Customer tier definitions

Every active customer is bucketed into one of four tiers based on
their CLV (Customer Lifetime Value) computed weekly by the
`rank-customer-clv` automation. Tiers drive **decision-point B**
(memo auto-approve eligibility), the **default payment terms** they
can request, and the **storefront merchandising** they see.

## CLV formula

CLV is computed as

```
CLV  =  Σ  (monthly_profit × retention_rate^t) / (1 + discount_rate)^t
       t=0..horizon
```

with:

- `monthly_profit`        = monthly_revenue − service_cost
- `monthly_revenue`       = sum of sold_price last 12 months / 12
- `service_cost`          = gross_margin_pct × monthly_revenue
- `retention_rate`        = 1 − (churn_risk_pct / 100)
- `discount_rate`         = 0.008 (0.8 % monthly, ≈ 10 % annualised)
- `horizon`               = 36 months

A new customer with < 3 transactions has a provisional CLV computed
against the cohort median and is locked to **Mid** tier until they
have history.

## Quartile cutoffs

Every Friday after the Rap drop, the desk recomputes the ranking and
sorts customers into quartiles **by CLV**:

| Tier | Percentile |
| --- | --- |
| Top  | 75th – 100th |
| High | 50th – 74th |
| Mid  | 25th – 49th |
| Low  | 0th – 24th |

## Tier benefits

| Privilege | Top | High | Mid | Low |
| --- | :---: | :---: | :---: | :---: |
| Memo auto-approve eligible (KB-001) | ✅ | ✅ | manual | manual |
| Max concurrent memos                | 5 | 5 | 3 | 1 |
| Net-75 payment terms (KB-003)        | ✅ | — | — | — |
| Net-60 payment terms                  | ✅ | ✅ | — | — |
| Custom finance via Drip Capital      | ✅ | — | — | — |
| Featured stones in storefront        | ✅ | ✅ | — | — |
| Early Rap-Friday preview            | ✅ | — | — | — |

## Tier downgrades

A customer can drop a tier mid-quarter if any of these fire:

- 2+ Late payments in the last 90 days
- Any single payment > 60 DPD
- KYC re-verification overdue by > 30 days
- A returned-sale fraud incident

A downgrade is recorded in `Customer.tierHistory` and the customer
gets a polite written notice within 48 hours.
