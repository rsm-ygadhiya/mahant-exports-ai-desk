# `data/` — Pramukh Gems operational data

The operational state the four M03 automations read and the
per-run artifacts they write. **This folder is separate from
[`../rag/knowledge_base/`](../rag/README.md)** — `data/` is the
ground-truth records the workflow processes; `rag/` is the
proprietary reference material the AI would cite.

---

## Layout

```
data/
├── raw/                         # source-of-truth synthetic tables (14 CSVs, ~38 k rows). Committed.
│   ├── _baseline/               # immutable copy of raw/, used by simulator --reset. Committed.
│   ├── inventory_seed.csv       # ← committed
│   ├── customers_seed.csv       # ← committed
│   └── ...12 more *_seed.csv files
├── scenarios/                   # 3 named pre-simulated snapshots. Committed.
│   ├── scenario_a_normal_day/
│   ├── scenario_b_monday_rap_drop/
│   └── scenario_c_month_end_stress/
├── processed/                   # reserved for pre-seeded synthetic history per step. Currently empty.
├── dictionaries/                # reference enumerations (categories, tiers). Currently empty.
└── working/                     # written by every automation run. Gitignored.
    ├── triage_decisions.csv
    ├── repricing_proposals.csv
    ├── clv_tiers.csv
    ├── memo_decisions.csv
    ├── workflow_action_log.csv
    └── sim_state.json
```

---

## Storage & access plan (the M02 1.4 ask)

| Layer | Where | Who **reads** | Who **writes** | Refresh cadence | Format | Gitignored? |
| --- | --- | --- | --- | ---: | --- | :---: |
| **Frozen baseline** | `data/raw/_baseline/` | `scripts/simulate/tick.py --reset` only | nobody (manually snapshotted once from M02) | one-time | CSV | no |
| **Live raw** | `data/raw/*_seed.csv` | All 4 automations, MCP server, Mahant Scintilla, simulator | Simulator (`tick.py --daily`, `--weekly`, `--load`) | daily / weekly / on-demand | CSV | no |
| **Named scenarios** | `data/scenarios/<name>/` | `tick.py --load <name>` | `tick.py --snapshot <name>` (and `make_scenarios.py`) | rebuilt on demand | CSV | no |
| **Per-run artifacts** | `data/working/*_decisions.csv` | Downstream steps (`decide-memo` reads `triage_decisions.csv` + `clv_tiers.csv`) and the Scintilla UI | The automation that owns the file (one per step) | every workflow run | CSV (header + rows) | **yes** |
| **Audit log** | `data/working/workflow_action_log.csv` | The Mahant audit page; debugging | Every step appends its envelope via `utils.pramukh_common.audit_log()` | every workflow run | CSV | **yes** |
| **Simulator clock** | `data/working/sim_state.json` | Simulator only | Simulator | every tick | JSON | **yes** |

### Access patterns

- **Read** — every script reads CSVs with `polars.read_csv()` (one
  shot, no streaming). Reads are concurrent-safe — the live raw layer
  is mutated by the simulator only, never by the automations.
- **Write** — every write to `data/working/` goes through
  `utils.pramukh_common.append_rows()` which uses
  `csv.DictWriter` plus a POSIX advisory lock (`fcntl.flock`) so two
  parallel runs can't corrupt a row mid-write.
- **Schema stability** — `append_rows()` accepts a `fieldnames=`
  argument; if a step ever changes its columns, the helper fails fast
  rather than silently mis-aligning rows.
- **Idempotency** — every per-step CSV row carries
  `workflow_run_id` + `step_id` so a re-run of the same step in the
  same workflow can be deduped downstream. The orchestrator generates
  a fresh `workflow_run_id` per invocation; the per-step `step_id` is
  derived from the run id + step name.

### Refresh cadences (which CSV moves when)

| Cadence | Tables touched | Driver |
| --- | --- | --- |
| **Daily** | `inventory_seed` (age++), `sales_transactions_seed`, `payment_history_seed`, `quotes_seed`, `memos_seed`, `negotiation_threads_seed`, `communication_logs_seed`, `demand_signals_seed` | `tick.py --daily` |
| **Weekly (Mon)** | `rap_weekly_seed`, `forecast_outputs_seed` | `tick.py --weekly` |
| **Static** | `customers_seed`, `cut_simulations_seed`, `orders_queue_seed`, `index_price_history_seed` | never (M02 produced them; treat as reference) |
| **Per run** | every `working/*_decisions.csv` + `workflow_action_log.csv` | the four step scripts |

See [`scripts/simulate/SKILLS_DATA_FLOW.md`](../scripts/simulate/SKILLS_DATA_FLOW.md)
for the per-skill **column-level** dependency map.

---

## Schema

Every CSV under `raw/` is a M02 deliverable. Primary keys, foreign
keys, and the step that writes each `working/` file:

### Source-of-truth tables (`raw/`, committed)

| File | Rows | Primary key | Foreign keys to | Purpose |
| --- | ---: | --- | --- | --- |
| `inventory_seed.csv`           | 1 000 | `stock_id` | — | One row per polished stone (4Cs, rap, cost, age, status) |
| `customers_seed.csv`           |   100 | `customer_id` | `broker_id` → self | Customer + broker entities with pre-computed CLV + tier |
| `sales_transactions_seed.csv`  |   400 | `transaction_id` | `stock_id`, `customer_id`, `broker_id`, `quote_id`, `memo_id` | Closed deals |
| `quotes_seed.csv`              |   800 | `quote_id` | `stock_id`, `customer_id`, `thread_id` | Quote requests + counter-offers |
| `memos_seed.csv`               |    80 | `memo_id` | `stock_id`, `customer_id`, `broker_id`, `thread_id` | Memo (consignment) requests + decisions |
| `negotiation_threads_seed.csv` |   150 | `thread_id` | `customer_id`, `stock_id`, `memo_id`, `quote_id` | Multi-message negotiation threads |
| `communication_logs_seed.csv`  |   600 | `message_id` | `thread_id`, `customer_id`, `stock_id` | Free-text messages on threads |
| `orders_queue_seed.csv`        | 3 000 | `order_id` | `customer_id` | Open buy requests |
| `payment_history_seed.csv`     |   290 | `payment_id` | `invoice_id`, `customer_id`, `order_id` | Invoice payments + late/early labels |
| `rap_weekly_seed.csv`          | 11 804 | (`rap_week`, `category_simple`) | — | Rapaport price index per category, weekly |
| `index_price_history_seed.csv` | 17 172 | (`index_date`, `shape`, `size_bucket`, `color_range`, `clarity_range`) | — | Marketplace price history |
| `demand_signals_seed.csv`      | 2 000 | (`signal_date`, `category_simple`) | — | Daily demand score per category |
| `forecast_outputs_seed.csv`    |   227 | (`forecast_date`, `category_simple`) | — | Forward demand forecast per category |
| `cut_simulations_seed.csv`     |   400 | `simulation_id` | `rough_stone_id` | Rough-to-polished cut simulations (procurement; out of M03 scope) |

### Per-run output tables (`working/`, gitignored)

| File | Primary key | Written by | One row per |
| --- | --- | --- | --- |
| `triage_decisions.csv`     | (`workflow_run_id`, `stock_id`)  | `automations/triage-inventory`   | Available stone |
| `repricing_proposals.csv`  | (`workflow_run_id`, `stock_id`)  | `automations/propose-repricing`  | Available stone (+ a `queue` ∈ `{auto, review}` column) |
| `clv_tiers.csv`            | (`workflow_run_id`, `entity_id`) | `automations/rank-customer-clv`  | Customer / broker |
| `memo_decisions.csv`       | (`workflow_run_id`, `memo_id`)   | `automations/decide-memo`        | Pending memo (+ a `queue` ∈ `{auto_approve, auto_reject, needs_review}` column) |
| `workflow_action_log.csv`  | (`workflow_run_id`, `step_id`)   | every step (via `audit_log()`)    | Step invocation (full envelope JSON) |

---

## Regenerating the data

```bash
# Reset live raw/ back to the frozen baseline:
python3 scripts/simulate/tick.py --reset

# Advance one simulated day (writes ~250 new rows across 7 tables):
python3 scripts/simulate/tick.py --daily

# Load one of the 3 pre-built named scenarios:
python3 scripts/simulate/tick.py --load scenario_c_month_end_stress
```

Full simulator spec: [`scripts/simulate/SIMULATION.md`](../scripts/simulate/SIMULATION.md).

The simulator is deterministic — given the same `--seed` it produces
byte-identical CSVs across machines.
