---
doc_id: KB-004
title: Weekly Rapaport repricing rules
type: policy
owner: Sales Head
audience: sales_desk
last_updated: 2026-04-26
classification: internal
related_systems: Scintilla, Mahant Pricing
---

# Weekly Rapaport repricing rules

The Rapaport price list drops every **Friday around 18:00 IST**. Our
weekly repricing run (decision-point A inside Scintilla) recomputes
the proposed price for every Available stone, applies 15 secondary
factors on top of the new Rap rate, and splits the proposals into
`auto_apply` vs `review` buckets.

## The 15 factors (in order of weight)

1. **Rap rate** — the base, refreshed every Friday.
2. **Position preference** — `rank_1` cuts 3% below target; `page_1`
   neutral; `page_2` holds 2% above to protect margin.
3. **Triage tag override** — `CLEAR` adds −5%; `DISCOUNT` adds −3%;
   `HOLD` no change.
4. **Age in stock** — 90–179 days: −3%; ≥ 180 days: −6%.
5. **Category velocity** (last 60 d sales) — 0 sales: −2%; ≥ 5 sales: +1%.
6. **Demand score** (last 60 d) — < 0.40: −2%; ≥ 0.60: +1%.
7. **Realized sales comps** — feeds velocity.
8. **Marketplace depth** — ≥ 150 competing listings: −1%.
9. **Margin floor** — proposed price can never breach `min_margin_pct`
   (default 5%); if it would, clip and emit `MARGIN` flag.
10. **Cost basis** — used for the margin computation.
11. **Active memos** — stone is **frozen** at old price; flag `FROZEN`.
12. **Open quotes** — if proposed price falls below an active quoted
    price, hold at the quote and flag `QUOTE`.
13. **Inventory depth** — subsumed in factor 8.
14. **Customer deals** — currently unused; reserved for tier-priced
    contracts.
15. **FX rate** — only applied to USD-quoted stones; defaults to
    yesterday's RBI reference.

## Auto-apply threshold

A proposal auto-applies iff:

- The flag is **not** in `{ FROZEN, MARGIN, QUOTE }`, AND
- `|pct_change| ≤ threshold_pct` (default 7%).

Anything else routes to human review. The Sales Head approves the
review queue from `/admin/scintilla` (the repricing column) before
prices go live on the storefront.

## When **not** to run

- Public holidays. The Rapaport sheet still publishes, but the desk
  postpones the run by 24 h so the team can review the next morning.
- During an active price freeze (declared by Owner in writing for any
  reason — usually a market shock).
