# Automation — `propose-repricing`

**Workflow step 2 of 4.** Reads the upstream `triage_decisions.csv`,
re-prices every available stone using the weekly Rapaport benchmark
plus 14 secondary factors, and splits the proposals at
**decision point A** into `auto` vs `review`.

## Why this is a non-GenAI automation

The pricing math is a 15-factor weighted-adjustment formula spelled
out in `_repricing_core.py` (Rap rate, position preference, age,
velocity, demand, marketplace depth, margin floor, active memos, etc.).
Every factor is numerical; every adjustment is rule-based. An LLM in
this loop would (a) be slower than the math, (b) destroy
reproducibility of the same input producing the same proposed price,
and (c) introduce hallucinated price moves the desk would have to
manually verify anyway. The 15 factors are documented in
[`rag/knowledge_base/KB-004-rapaport-repricing-rules.md`](../../rag/knowledge_base/KB-004-rapaport-repricing-rules.md).

## Reads

| Source CSV | Columns used |
| --- | --- |
| `data/raw/inventory_seed.csv`           | `stock_id`, `status`, `carat`, `ppc`, `cost_basis`, `age_in_stock_days`, `category_simple` |
| `data/raw/rap_weekly_seed.csv`          | latest `rap_week ≤ today` per `category_simple`, `rap_per_carat`, `wow_change_pct` |
| `data/raw/sales_transactions_seed.csv`  | `transaction_date`, `category_simple` (60-day velocity) |
| `data/raw/demand_signals_seed.csv`      | `signal_date`, `category_simple`, `demand_score`, `listing_count` (60-day) |
| `data/raw/memos_seed.csv`               | `stock_id`, `decision` (`FROZEN` flag if active memo) |
| `data/raw/quotes_seed.csv`              | `stock_id`, `offered_price`, `quote_outcome` (`QUOTE` flag if open quote below proposed price) |
| `data/working/triage_decisions.csv`     | `stock_id`, `action_tag` — applied as factor 3 |

## Writes

`data/working/repricing_proposals.csv` — one row per Available stone.

| Column | Type | Notes |
| --- | --- | --- |
| `workflow_run_id`, `step_id`, `ts` | string | from the orchestrator |
| `stock_id`        | string | FK → `inventory_seed.stock_id` |
| `category_simple` | string | denormalized |
| `old_price`       | float  | current `ppc × carat` |
| `proposed_price`  | float  | after 15-factor recipe |
| `pct_change`      | float  | signed % delta |
| `flag`            | enum   | `''` / `FROZEN` / `MARGIN` / `QUOTE` / `UNCHANGED` |
| `primary_driver`  | string | dominant factor that moved the price |
| `queue`           | enum   | `auto` / `review` (the decision-point A routing) |

Plus one envelope row appended to `data/working/workflow_action_log.csv`.

## Decision-point A (the gate)

```
queue = "auto"   iff flag ∉ {FROZEN, MARGIN, QUOTE} AND 0 < |pct_change| ≤ threshold_pct
queue = "review" iff flag ∈ {FROZEN, MARGIN, QUOTE} OR |pct_change| > threshold_pct
```

`--threshold-pct` defaults to 7. The Sales Head re-tunes it from the
Mahant Scintilla settings popover. Any non-empty `review` queue sets
`review_required=true` on the envelope.

## Python helpers

Local (`scripts/_repricing_core.py`):

| Function | Returns |
| --- | --- |
| `compute_repricing(inventory, rap, sales, demand, memos, quotes, triage_tags, today, position, min_margin_pct)` | `polars.DataFrame` |
| `batch_summary(repriced)` | header line string |
| `narrate_repricing(repriced)` | rule-based one-liner (no LLM) |
| 15 internal `_*_adjustment(...)` factor functions | `(adjustment_fraction, label)` |

Shared (`utils.pramukh_common`):
`Envelope`, `append_rows`, `audit_log`, `emit_envelope`, `make_skill_parser`, `parse_today`.

## M01 connection

**Step 11 — Vault Inventory and Pricing.** Replaces the *"Sales Head
prices each parcel using the Rapaport Price List"* line of the M01
process doc. Addresses pain point **#4 Manual Pricing with No
Analytics**.

## Run

```bash
uv run python automations/propose-repricing/scripts/propose_repricing.py \
    --threshold-pct 7.0 --today 2026-05-14 --json
```

## Envelope shape

```json
{
  "status": "ok",
  "skill_name": "propose-repricing",
  "next_action": "rank-customer-clv",
  "confidence": 1.0,
  "review_required": true,
  "artifact_refs": ["working/repricing_proposals.csv"],
  "outputs": {
    "today": "2026-05-14",
    "threshold_pct": 7.0,
    "auto_count": 303,
    "review_count": 348,
    "rows_written": 651
  },
  "error": null
}
```
