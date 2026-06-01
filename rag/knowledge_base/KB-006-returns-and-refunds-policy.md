---
doc_id: KB-006
title: Returns, refunds, and re-takes policy
type: policy
owner: Sales Head
audience: sales_desk
last_updated: 2026-01-22
classification: internal
related_systems: Mahant Admin, Vault App
---

# Returns, refunds, and re-takes policy

A polished diamond can leave the vault in three states: **Sold**,
**OnMemo**, or **Sample dispatch**. This policy covers what happens
when any of them comes back.

## Memo returns

Memos are a **lend**, not a sale, so a memo return is the default
expected outcome. The customer ships the stone back inside the
agreed hold window via insured courier (typically Malca-Amit or
Brink's).

| Condition on intake | Action |
| --- | --- |
| Identical to dispatch photos, weight within ±0.003 ct | Restock to original vault slot. Set `Diamond.status = Available`. Close memo with `closed_outcome = Returned`. |
| Hairline chip < 0.05 mm, weight within tolerance | Restock to row F (see KB-005). Owner decides re-polish vs sell as-is. Customer is **not** charged. |
| Visible chip > 0.05 mm OR weight drift > 0.005 ct | Charge the customer the **damage fee** (see schedule below). |
| Stone is missing or mis-identified | **Page Owner immediately.** Initiate insurance claim. Suspend the customer (KB-002). |

### Damage fee schedule

| Value bracket | Fee |
| --- | --- |
| up to ₹50 000 | 5% of last-listed price |
| ₹50 000 – ₹500 000 | 8% |
| over ₹500 000 | 10% (Owner sign-off required) |

## Sale returns

Only honoured within **7 calendar days** of dispatch and only when
the stone matches the original certificate in carat, colour, clarity,
and cut. No returns on stones that have been re-certified by a
different lab in the interim — that voids the warranty.

A returned sale reverses the invoice (`Payment.refund`) and restocks
the stone. The `payment_score` for the customer is **not** affected;
the sales rep's commission for the original deal is clawed back.

## Disputes

Escalate to KB-014 (Dispute resolution matrix). Anything involving an
export buyer routes through the broker on record, never the end buyer
directly.
