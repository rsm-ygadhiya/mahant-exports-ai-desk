# Data Schema Lock — Milestone 02

**Status:** **LOCKED** as of 2026-05-02. Decisions in §0; deltas to generator scripts in §5.
**Why this exists:** The 6 skills in `PROJECT_HANDOFF.md` all read from these CSVs today and from production API endpoints later. Locking field names/types/relationships now prevents skill-by-skill rewrites. Promotion from prototype CSV → production API is meant to be a data-source swap; that requires the contract not to drift.

---

## 0. Locked decisions

1. **`payment_terms_days` source of truth: per-sale snapshot.** Customer-level value seeds the default; each sale snapshots it at sale time. Skill 4 reads `sales_transactions.payment_terms_days`.
2. **`cost_basis` simulation: 70–85% of price, uniform.** Sold stones: `cost_basis = sold_price × Uniform(0.70, 0.85)`. Unsold stones: `cost_basis = p_pcs × Uniform(0.70, 0.85)`. Same ratio applied at generation time and frozen.
3. **Sales table: regenerate.** Rerun `generate_sales.py` with a customer-aware loop. New TXN IDs. Generator must populate `customer_id`, `broker_id`, `cost_at_sale`, `gross_profit`, `invoice_id`, `invoice_date`, `payment_terms_days`, `due_date` natively.
4. **`terms_type` and `payment_terms_days` are orthogonal — both kept.** `payment_terms_days` (int) drives Skill 4 date math. `terms_type` (`Finance`/`Memo`/`Advance`/`Net30`/`Net60`) carries arrangement category and informs Skill 4 tone.
5. **`min_margin_pct`: single repo default of 5.0%.** Per-stone override column NOT added in this milestone; revisit if a stone-specific case emerges.
6. **Existing CLV columns on `customers` (`raw_clv`, `risk_adjusted_clv`, `clv_tier`): kept as cached reference values.** Skill 3 will compute fresh CLV from sales and use these only for sanity-check reconciliation.

---

## 1. Conventions

- **IDs are strings, never integers.** Avoids accidental arithmetic and tolerates prefix changes. Format: `<TYPE><ZERO-PADDED-N>` — `LGSTK00001`, `CUST0001`, `BRK0007`, `COMP0042`, `TXN00001`, `INV00001`, `MEMO00001`, `THRD00001`, `MSG00001`, `QTE00001`, `ORD00001`, `PAY00001`.
- **Dates are ISO `YYYY-MM-DD`.** Timestamps add `T<HH:MM:SS>` (UTC) when intra-day matters (only memos/threads/messages today).
- **Currency is USD per stone.** No multi-currency until production track. Numeric, two decimals.
- **Percentages stored as decimals (0.05 not 5.0)** unless the column name ends in `_pct`, in which case it's already a 0–100 scale (preserved for existing columns to avoid breaking generators).
- **Booleans: `true`/`false`** strings on disk, parsed to `bool` in code.
- **Category key everywhere is `category_simple`** = `"Shape | Carat Bucket | Color Group | Clarity Group"` exactly as already defined in `sales_transactions_seed.csv`. Inventory must persist this column too (today it doesn't).
- **Soft enums (`status`, `tag`, `tier`, etc.) are documented per table.** Generators must emit only documented values.
- **Foreign keys are tested.** Every `*_id` column has a referential test in `tests/data/test_referential_integrity.py` (to be added).

---

## 2. Locked schemas

Legend: ✓ = already present, ⚠ = critical addition (skills break without it), ✱ = nice-to-have (defer if rushed).

### `inventory_seed.csv`

| Column | Type | Status | Notes |
|---|---|---|---|
| `stock_id` | str (PK) | ✓ | `LGSTK00001` |
| `sr_no` | int | ✓ | sequence # |
| `add_date` | date | ✓ | when stone entered inventory |
| `rep_date` | date | ✓ | report date |
| `age_in_stock_days` | int | ⚠ rename | currently `age` — rename for clarity (Skill 5 reads this) |
| `status` | enum | ✓ | `Available` / `Hold` / `OnMemo` / `Sold` / `Reserved` (lock the set) |
| `report_no` | str | ✓ | |
| `shape` | str | ✓ | |
| `carat` | float | ✓ | |
| `color` | str | ✓ | D, E, F, … |
| `clarity` | str | ✓ | FL, IF, VVS1, … |
| `cut` | str | ✓ | |
| `polish` | str | ✓ | |
| `sym` | str | ✓ | |
| `category_simple` | str | ⚠ add | derive on write: `"<shape> \| <carat_bucket> \| <color_group> \| <clarity_group>"` |
| `rap` | float | ✓ | per-stone Rap (USD/ct) |
| `discounts_pct` | float (0–100) | ✓ | discount off Rap |
| `ppc` | float | ✓ | price per carat |
| `p_pcs` | float | ✓ | total list price (currently `p_pcs`; consider rename to `list_price` later) |
| `cost_basis` | float | ⚠ add | per-stone cost (USD). Skill 6 margin floor (factor #9), Skill 3 GP, Skill 5 clearance pricing all need it |
| `min_margin_pct` | float | ✱ add | default 5.0; per-stone override. If absent, code uses repo default |
| `measurement` | str | ✓ | |
| `table_pct`, `depth_pct`, `c_a` | float | ✓ | |
| `fl` | str | ✓ | fluorescence |
| `growth_type` | str | ✓ | |
| `video`, `image` | url | ✓ | |
| `lab`, `inscri` | str | ✓ | |
| `location`, `country_of_origin`, `shade`, `luster`, `eyeclean`, `milky` | str | ✓ | |

### `customers_seed.csv`

The existing flat `customer_id` model collapses brokers and end-companies. Skill 3 requires the rollup. Proposal: keep `customer_id` as a stable stable PK, and **add `broker_id` + `is_broker`** so a customer row is either a broker (`is_broker=true`, `broker_id=customer_id`) or a company (`is_broker=false`, `broker_id=<their broker's customer_id>` or null for direct accounts).

| Column | Type | Status | Notes |
|---|---|---|---|
| `customer_id` | str (PK) | ✓ | |
| `customer_name` | str | ✓ | |
| `is_broker` | bool | ⚠ add | `true` for brokers, `false` for end-companies |
| `broker_id` | str (FK→customers.customer_id, nullable) | ⚠ add | for companies that buy through a broker; null if direct |
| `customer_type` | enum | ✓ | keep for compatibility (`Broker`/`Jeweler`/`Wholesaler`/`Retail`); but Skill 3 uses `is_broker`/`broker_id` |
| `market` | str | ✓ | |
| `join_date` | date | ✓ | |
| `relationship_owner` | str | ✓ | |
| `payment_terms_days` | int | ⚠ add (replaces string `payment_terms`) | 30 / 60 — drives Skill 4 date math |
| `payment_terms` | str | ✓ | keep for display ("Net 30"); skills should read `payment_terms_days` |
| `payment_score` | int | ✓ | 0–100 |
| `active_status` | enum | ✓ | `Active`/`Inactive` |
| `annual_spend`, `avg_order_value`, `purchase_frequency`, `gross_margin_pct`, `account_lifespan_years`, `churn_risk_pct`, `raw_clv`, `risk_adjusted_clv`, `clv_tier` | various | ✓ | precomputed cache; Skill 3 will recompute from sales (these become reference values, not source of truth) |

### `sales_transactions_seed.csv`

This file has the most structural gaps. It's the linchpin for Skills 1, 2, 3, 4.

| Column | Type | Status | Notes |
|---|---|---|---|
| `transaction_id` | str (PK) | ✓ | `TXN00001` |
| `transaction_date` | date | ✓ | sale date |
| `stock_id` | str (FK→inventory) | ✓ | |
| `category_simple` | str | ✓ | denormalized for query speed |
| `customer_id` | str (FK→customers) | ⚠ add | **CRITICAL** — currently only `customer_type` is stored; CLV / payment lookups break without this |
| `broker_id` | str (FK→customers) | ⚠ add | denormalized rollup so queries don't need self-join |
| `sold_price` | float | ✓ | |
| `sold_ppc` | float | ✓ | |
| `cost_at_sale` | float | ⚠ add | snapshot of `inventory.cost_basis` at sale time. Locks GP even if cost_basis later mutates |
| `gross_profit` | float | ⚠ add | `sold_price - cost_at_sale` (denormalized for Skill 3) |
| `discount_pct` | float | ✓ | |
| `customer_type` | enum | ✓ | redundant once customer_id exists; keep for backward compat |
| `sales_channel` | enum | ✓ | `Direct`/`Broker`/`Marketplace`/`Memo` |
| `destination_market` | str | ✓ | |
| `payment_status` | enum | ✓ | `Paid`/`Advance`/`Open`/`Partial` |
| `invoice_id` | str (FK→payment_history.invoice_id) | ⚠ add | links sale → invoice → payments. Skill 4 unusable without it |
| `invoice_date` | date | ⚠ add | usually = transaction_date but can lag |
| `payment_terms_days` | int | ⚠ add | snapshot from customer at sale time (terms can change) |
| `due_date` | date | ⚠ add | `invoice_date + payment_terms_days`; denormalized for Skill 4 |
| `quote_id` | str (FK→quotes, nullable) | ✱ add | links sale back to the closing quote — useful for Skill 2 retrospective |
| `memo_id` | str (FK→memos, nullable) | ✱ add | when sale closed out a memo |

### `quotes_seed.csv`

| Column | Type | Status | Notes |
|---|---|---|---|
| `quote_id` | str (PK) | ✓ | |
| `quote_date` | date | ✓ | |
| `customer_id` | str (FK) | ✓ | |
| `stock_id` | str (FK) | ✓ | |
| `category_simple` | str | ⚠ backfill | currently empty in many rows; derive from stock_id |
| `list_price` | float | ✓ | |
| `base_discount_pct`, `payment_bonus_discount_pct`, `volume_discount_pct`, `final_discount_pct` | float | ✓ | |
| `offered_price` | float | ✓ | |
| `margin_pct` | float | ✓ | |
| `approval_status` | enum | ✓ | `Pending`/`Approved`/`Rejected` |
| `quote_outcome` | enum | ✓ | `Negotiating`/`Accepted`/`Lost`/`Expired` |
| `tier_sent` | enum | ⚠ add | `floor`/`target`/`aspirational` — Skill 2 logs which tier it offered |
| `customer_offer` | float | ⚠ add | what the customer countered with |
| `final_agreed_price` | float | ⚠ add | populated when `quote_outcome=Accepted` (= sold_price on the resulting transaction) |
| `thread_id` | str (FK→negotiation_threads, nullable) | ⚠ add | quote belongs to a thread |

### `payment_history_seed.csv`

| Column | Type | Status | Notes |
|---|---|---|---|
| `payment_id` | str (PK) | ✓ | |
| `invoice_id` | str (FK→sales_transactions.invoice_id) | ✓ | |
| `customer_id` | str (FK) | ✓ | |
| `order_id` | str (FK, nullable) | ✓ | |
| `invoice_date`, `due_date`, `payment_date` | date | ✓ | |
| `payment_amount` | float | ✓ | |
| `terms_type` | enum | ✓ | `Finance`/`Memo`/`Advance`/`Net30`/`Net60` — clarify with Yug whether this is the terms structure (vs `payment_terms_days`) |
| `days_early_late` | int | ✓ | negative = early |
| `payment_behavior_label` | enum | ✓ | `Early`/`OnTime`/`Late` |
| `late_incident_flag` | bool | ✓ | |
| `month_bucket` | str | ✓ | `YYYY-MM` |

### `communication_logs_seed.csv`

Today this is per-message but has no link to a thread, customer record, or stone. Skill 5 wants per-stone inquiry signal; Skill 2 wants the whole back-and-forth on one quote. Solution: keep this as the **message-level** table, add `thread_id`, and introduce a new `negotiation_threads` table that groups them.

| Column | Type | Status | Notes |
|---|---|---|---|
| `message_id` | str (PK) | ✓ | |
| `message_date` | datetime | ⚠ promote | currently date; needs time for ordering within a thread |
| `thread_id` | str (FK→negotiation_threads) | ⚠ add | groups messages |
| `customer_id` | str (FK, nullable) | ⚠ add | look up from counterparty_name |
| `stock_id` | str (FK, nullable) | ⚠ add | when the message is about a specific stone |
| `counterparty_name` | str | ✓ | keep — sometimes a thread starts before a customer record exists |
| `counterparty_type` | enum | ✓ | |
| `channel` | enum | ✓ | `WhatsApp`/`Email`/`Call`/`Platform Chat`/`In-App` |
| `direction` | enum | ⚠ add | `Inbound`/`Outbound` — Skill 2 needs to know who said what |
| `category_simple` | str | ✓ | denormalized for category-level demand |
| `quoted_price`, `negotiated_price` | float | ✓ | |
| `quantity_requested` | int | ✓ | |
| `negotiation_status` | enum | ✓ | `Open`/`Closed-Won`/`Closed-Lost` |
| `notes` | str | ✓ | free text |

### `demand_signals_seed.csv`

No changes — already clean.

| Column | Type | Status |
|---|---|---|
| `signal_date` | date | ✓ |
| `category_simple` | str | ✓ |
| `listing_count` | int | ✓ |
| `avg_market_price` | float | ✓ |
| `demand_score` | float (0–1) | ✓ |

### `orders_queue_seed.csv`

No critical changes. Optional: add `quoted_to_transaction_id` to chase order → quote → sale lineage.

### `index_price_history_seed.csv`

This is IDEX-style index. Distinct from per-stone Rap. Skill 6 reads `rap_weekly` (new); this stays as broader market trend signal (Skill 5/6 secondary input).

### `forecast_outputs_seed.csv`, `cut_simulations_seed.csv`

Analytics outputs, not skill inputs in this milestone. No lock required.

---

## 3. New tables required

### `memos_seed.csv` (TODO — Skill 1)

| Column | Type | Notes |
|---|---|---|
| `memo_id` | str (PK) | `MEMO00001` |
| `request_date` | datetime | |
| `customer_id` | str (FK) | requester |
| `broker_id` | str (FK, nullable) | denorm |
| `stock_id` | str (FK→inventory) | |
| `requested_hold_days` | int | typical 3/5/7 |
| `decision` | enum | `Pending`/`Approved`/`ApprovedWithConditions`/`Rejected` |
| `decision_date` | datetime, nullable | |
| `decision_reason` | str | LLM-drafted by Skill 1 |
| `condition_minimum_price` | float, nullable | when ApprovedWithConditions |
| `condition_max_hold_days` | int, nullable | when ApprovedWithConditions |
| `expiry_date` | datetime, nullable | request_date + hold_days |
| `closed_outcome` | enum, nullable | `Sold`/`Returned`/`Lapsed` |
| `closed_transaction_id` | str (FK, nullable) | |
| `marketplace_lock_status` | enum | `NotLocked`/`Locked`/`Unlocked` |
| `thread_id` | str (FK, nullable) | linked negotiation |

### `negotiation_threads_seed.csv` (TODO — Skill 2)

| Column | Type | Notes |
|---|---|---|
| `thread_id` | str (PK) | `THRD00001` |
| `opened_date` | datetime | |
| `customer_id` | str (FK, nullable) | |
| `stock_id` | str (FK, nullable) | |
| `category_simple` | str, nullable | thread can be category-level not stone-specific |
| `memo_id` | str (FK, nullable) | |
| `quote_id` | str (FK, nullable) | latest active quote |
| `status` | enum | `Open`/`Closed-Won`/`Closed-Lost`/`Stale` |
| `last_message_date` | datetime | denorm for Skill 2 ordering |
| `last_offer` | float, nullable | denorm of latest customer offer |
| `closed_transaction_id` | str (FK, nullable) | |

### `rap_weekly_seed.csv` (TODO — Skill 6)

Per-category Rap rates per week. Skill 6 joins this against inventory at run time.

| Column | Type | Notes |
|---|---|---|
| `rap_week` | date | Monday of the week |
| `category_simple` | str | join key |
| `rap_per_carat` | float | the headline number |
| `wow_change_pct` | float | for context |
| `source` | str | `RapNet`/`Simulated` |

---

## 4. Production API endpoint mapping

| Table | GET (list) | GET (single) | POST | Notes |
|---|---|---|---|---|
| inventory | `/inventory?status=available` | `/inventory/{stock_id}` | `/inventory/{stock_id}/triage-tag` | Skills 5, 6 |
| customers | `/customers?role=broker` | `/customers/{customer_id}`, `/customers/{broker_id}/companies` | — | Skills 1, 3 |
| sales | `/sales?since=…&customer_id=…` | `/sales/{transaction_id}` | — | Skills 3, 4 |
| invoices | `/invoices?status=open` | `/invoices/{invoice_id}` | `/reminders` | Skill 4; invoice is a view over sale + payment_history |
| payment_history | `/payment-history?invoice_id=…` | — | — | Skill 4 |
| memos | `/memos?status=active`, `/memos?customer_id=…&status=closed` | `/memos/{memo_id}` | `/memos`, `/marketplace-sync/lock` | Skill 1 |
| quotes | `/quotes?customer_id=…&status=open` | `/quotes/{quote_id}` | `/quotes` | Skill 2 |
| negotiation_threads | `/negotiation-threads?since=…` | `/negotiation-thread/{thread_id}` | — | Skills 2, 5 |
| communication_logs | implicit via `/negotiation-thread/{thread_id}` | — | `/messages` | Skills 2, 5 |
| demand_signals | `/demand-signals?…` | — | — | Skills 5, 6 |
| rap_weekly | `/rap/current`, `/rap?week=…` | — | — | Skill 6 |
| pricing batch | — | `/pricing-batch/{id}` | `/pricing-batch/proposed`, `/pricing-batch/{id}/approve` | Skill 6 |

---

## 5. Implementation deltas (what generator scripts must change)

In rough priority order — first three are blocking for Skill 5, rest can land in parallel.

1. **`generate_inventory.py`** — add `category_simple`, `cost_basis` (≈ 70–85% of sold price for synth realism), and rename `age` → `age_in_stock_days`.
2. **`generate_sales.py`** — add `customer_id`, `broker_id`, `cost_at_sale`, `gross_profit`, `invoice_id`, `invoice_date`, `payment_terms_days`, `due_date`. Optional: `quote_id`, `memo_id`.
3. **`generate_communication_logs.py`** — add `thread_id`, `customer_id`, `stock_id`, `direction`; promote `message_date` to datetime.
4. **`generate_demand.py`** — no change.
5. **New: `generate_customers.py` rework** (or in-place edit) — add `is_broker`, `broker_id`, `payment_terms_days`. Existing computed-CLV columns can stay.
6. **New: `generate_memos.py`** — produces `memos_seed.csv`, with linkage to existing customers + inventory.
7. **New: `generate_threads.py`** — produces `negotiation_threads_seed.csv` and backfills `thread_id` into existing `communication_logs_seed.csv` and `quotes_seed.csv`.
8. **New: `generate_rap_weekly.py`** — produces `rap_weekly_seed.csv` from weekly walks of category Rap. Calibrate against `inventory.rap` distribution.

---

## 6. Open questions

All resolved as of 2026-05-02 — see §0 Locked decisions above.
