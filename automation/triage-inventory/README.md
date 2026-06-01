# Automation — `triage-inventory`

**Workflow step 1 of 4.** Tags every available stone HOLD / WATCH /
DISCOUNT / CLEAR based on age in stock, category demand, recent sales
velocity, and inquiry count.

## Why this is a non-GenAI automation

The decision is a pure function of four numeric inputs (age,
demand, velocity, inquiry count) mapped through a small rule table
in `_triage_core.py::classify_stone`. An LLM here would only
obscure the math, add latency, and make the output non-repeatable —
the desk needs to see the same tag for the same stone on every run.
There is no free-text input that would benefit from natural-language
understanding.

## Reads

| Source CSV | Columns used |
| --- | --- |
| `data/raw/inventory_seed.csv`           | `stock_id`, `status`, `age_in_stock_days`, `category_simple` |
| `data/raw/sales_transactions_seed.csv`  | `transaction_date`, `category_simple` (for 60-day velocity) |
| `data/raw/demand_signals_seed.csv`      | `signal_date`, `category_simple`, `demand_score` (for 60-day average) |
| `data/raw/communication_logs_seed.csv`  | `message_date`, `stock_id` (for inquiry count) |

## Writes

`data/working/triage_decisions.csv` — one row per Available stone.

| Column | Type | Notes |
| --- | --- | --- |
| `workflow_run_id`, `step_id`, `ts` | string | from the orchestrator |
| `stock_id`                 | string | FK → `inventory_seed.stock_id` |
| `category_simple`          | string | denormalized for downstream filters |
| `age_in_stock_days`        | int    | snapshot at run time |
| `action_tag`               | enum   | `HOLD` / `WATCH` / `DISCOUNT` / `CLEAR` |
| `suggested_price_move_pct` | float  | magnitude of suggested discount % (positive = N% off) |
| `reason`                   | string | rule-based human-readable explanation |

Plus one envelope row appended to `data/working/workflow_action_log.csv`.

## Python helpers

Local (`scripts/_triage_core.py`):

| Function | Returns |
| --- | --- |
| `classify_stone(age, demand, velocity, inquiries)` | `(tag, pct_move, reason)` |
| `triage_inventory(inventory, sales, demand, comms, today)` | `polars.DataFrame` |
| `aggregate_counts(triaged)` | `dict[tag, count]` |
| `summarize_triage(triaged)` | rule-based one-liner (no LLM) |

Shared (`utils.pramukh_common`):
`Envelope`, `append_rows`, `audit_log`, `emit_envelope`, `make_skill_parser`, `parse_today`.

## M01 connection

**Step 11 — Vault Inventory and Pricing.** Replaces the
spreadsheet-by-hand aging review the desk does on Friday mornings.
Addresses pain points **#1 Paper-Based Traceability** and **#2 Siloed
Data Systems** by producing a single canonical aging tag every stone
inherits everywhere downstream (repricing, memo decisions, the Mahant
storefront).

Policy reference: [`rag/knowledge_base/KB-004-rapaport-repricing-rules.md`](../../rag/knowledge_base/KB-004-rapaport-repricing-rules.md)
(factor 3 — triage tag override on price).

## Run

```bash
uv run python automations/triage-inventory/scripts/triage_inventory.py --json

# Pin the date for reproducibility:
uv run python automations/triage-inventory/scripts/triage_inventory.py \
    --today 2026-05-14 --json
```

## Envelope shape

```json
{
  "status": "ok",
  "skill_name": "triage-inventory",
  "next_action": "propose-repricing",
  "confidence": 1.0,
  "review_required": false,
  "artifact_refs": ["working/triage_decisions.csv"],
  "outputs": {
    "today": "2026-05-14",
    "stones_tagged": 650,
    "by_tag": {"CLEAR": 18, "DISCOUNT": 240, "WATCH": 50, "HOLD": 342},
    "rows_written": 650
  },
  "error": null
}
```
