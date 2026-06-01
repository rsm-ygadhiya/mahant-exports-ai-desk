# Automation — `rank-customer-clv`

**Workflow step 3 of 4.** Computes Customer Lifetime Value (CLV) for
every broker and company, then sorts each entity into a
**Top / High / Mid / Low** quartile.

## Why this is a non-GenAI automation

CLV is a closed-form time-value formula
(`monthly_profit × retention ^ t / (1 + r) ^ t`, summed across the
horizon). Quartile bucketing is a pure rank operation. Both are
deterministic by construction; an LLM here would introduce noise into a
calculation the desk has used for decades and can verify by hand. The
formula and its inputs are documented in
[`rag/knowledge_base/KB-007-customer-tier-definitions.md`](../../rag/knowledge_base/KB-007-customer-tier-definitions.md).

## Reads

| Source CSV | Columns used |
| --- | --- |
| `data/raw/sales_transactions_seed.csv` | `customer_id`, `broker_id`, `transaction_date`, `sold_price`, `cost_at_sale`, `gross_profit` |
| `data/raw/customers_seed.csv`          | `customer_id`, `customer_name`, `is_broker`, `broker_id`, `payment_terms_days`, `churn_risk_pct`, `gross_margin_pct` |

## Writes

`data/working/clv_tiers.csv` — one row per ranked entity.

| Column | Type | Notes |
| --- | --- | --- |
| `workflow_run_id`, `step_id`, `ts` | string | from the orchestrator |
| `entity_id`           | string | FK → `customers_seed.customer_id` |
| `entity_name`         | string | denormalized for downstream display |
| `level`               | enum   | `broker` / `company` |
| `clv`                 | float  | dollar CLV over the configured horizon |
| `transactions`        | int    | sample size feeding the formula |
| `churn_rate`          | float  | derived from `churn_risk_pct / 100` |
| `monthly_profit`      | float  | derived from sales rollups |
| `tier`                | enum   | `Top` / `High` / `Mid` / `Low` (quartile) |

Plus one envelope row appended to `data/working/workflow_action_log.csv`.

## Python helpers

Local (`scripts/_clv_core.py`):

| Function | Returns |
| --- | --- |
| `calculate_clv(monthly_revenue, service_cost, transaction_frequency, churn_rate, discount_rate, time_horizon, …)` | scalar CLV |
| `clv_inputs_for_entity(entity_id, level, sales, customers, today)` | dict ready for `calculate_clv` |
| `compute_entity_clv(entity_id, level, sales, customers, today, **kw)` | `CLVResult` |
| `compute_all_clv(level, sales, customers, today, **kw)` | `polars.DataFrame` ranked by CLV |
| `broker_breakdown(broker_id, sales, customers, today, **kw)` | `(broker_result, company_df)` |
| `narrate_clv(result, company_df)` | rule-based one-liner (no LLM) |
| `narrate_ranking(df, level)` | rule-based one-liner (no LLM) |

Shared (`utils.pramukh_common`):
`Envelope`, `append_rows`, `audit_log`, `emit_envelope`, `make_skill_parser`, `parse_today`.

## M01 connection

**Step 12 — Sales, Export Documentation and Dispatch.** Replaces the
*"No CRM; buyer preferences held in salesperson's memory"* line in the
M01 process doc. Addresses pain point **#3 Procurement-to-Sales
Disconnect** by making the desk's ranking of who matters most an
explicit, persisted artifact rather than tribal knowledge.

## Hand-off

The downstream `decide-memo` automation reads `clv_tiers.csv` to map
each pending memo's customer/broker to a tier; that tier is one of the
three gates at decision-point B.

## Run

```bash
uv run python automations/rank-customer-clv/scripts/rank_customer_clv.py --json

# Single entity:
uv run python automations/rank-customer-clv/scripts/rank_customer_clv.py \
    --entity-id CUST0026 --json
```

## Envelope shape

```json
{
  "status": "ok",
  "skill_name": "rank-customer-clv",
  "next_action": "decide-memo",
  "confidence": 1.0,
  "review_required": false,
  "artifact_refs": ["working/clv_tiers.csv"],
  "outputs": {
    "today": "2026-05-14",
    "entities_ranked": 92,
    "tier_counts": {"Top": 23, "High": 23, "Mid": 23, "Low": 23},
    "rows_written": 92
  },
  "error": null
}
```
