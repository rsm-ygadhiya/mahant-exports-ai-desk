# How each `.claude` skill uses today's data

This document covers the **8 business skills** in
`~/.claude/skills/` that run against the Pramukh Gems / Mahant Exports
CSVs in [`data/raw/`](../../data/raw/). It explains for each:

1. The exact CSV files the script reads
2. How "today" is used to filter / age the data
3. What output the skill produces
4. Which Mahant UI page exposes the same skill (`/admin/ai/<slug>`)

The four utility skills in the same folder
(`git-workflow`, `setup-doctor`, `workspace-check`, `clv-example`) are
unrelated to the diamond data and not covered here.

---

## At-a-glance — reads per skill

Every business skill reads one or more `*_seed.csv` files from
`data/raw/` via `polars.read_csv()`. The table below is taken straight
from each skill's `scripts/*.py`:

| Skill | Reads | Refresh expected |
| --- | --- | --- |
| `clv-broker-company` | `customers_seed`, `sales_transactions_seed` | daily (sales arrive) |
| `collection-reminder` | `customers_seed`, `sales_transactions_seed`, `payment_history_seed` | daily (invoices age, payments land) |
| `demand-forecast` | `inventory_seed`, `forecast_outputs_seed`, `demand_signals_seed` | weekly (forecast re-run) + daily (signals) |
| `memo-approval` | `memos_seed`, `inventory_seed`, `payment_history_seed`, `demand_signals_seed`, `customers_seed` | daily (new memo requests) |
| `morning-briefing` | `inventory_seed`, `sales_transactions_seed`, `negotiation_threads_seed`, `quotes_seed`, `demand_signals_seed`, `customers_seed` | daily |
| `negotiation-threads` | `negotiation_threads_seed`, `communication_logs_seed`, `quotes_seed`, `customers_seed` | daily (new messages) |
| `quote-negotiation` | `quotes_seed`, `inventory_seed`, `customers_seed`, `demand_signals_seed` | daily |
| `weekly-repricing` | `rap_weekly_seed`, `inventory_seed`, `sales_transactions_seed`, `demand_signals_seed`, `memos_seed`, `quotes_seed` | **weekly** (Rap drop) |

---

## 1 · `clv-broker-company` — Customer Lifetime Value

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/clv` |
| **Reads** | `customers_seed.csv`, `sales_transactions_seed.csv` |
| **How `today` is used** | Anchor for "account lifespan" and the monthly-revenue window — sales after today are ignored. |
| **What it produces** | One CLV ($) per customer or broker, ranked. For brokers, also a per-company breakdown of who is feeding the broker's book. |
| **Why daily refresh matters** | Every new TXN row in `sales_transactions_seed` shifts the customer's monthly revenue → their CLV moves. |

**Inputs derived from the CSVs**

| CLV formula input | Derived from |
| --- | --- |
| `monthly_revenue` | sum of `sales_transactions_seed.sold_price` / months-active |
| `service_cost` | `customers_seed.gross_margin_pct` and category mix |
| `transaction_frequency` | count(`sales_transactions_seed`) per month |
| `churn_rate` | `customers_seed.churn_risk_pct / 100` |
| `discount_rate` | constant 0.8% / month |

---

## 2 · `collection-reminder` — Overdue invoice triage

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/collections` |
| **Reads** | `sales_transactions_seed.csv`, `payment_history_seed.csv`, `customers_seed.csv` |
| **How `today` is used** | `today − sales.due_date` produces the days-past-due bucket. |
| **What it produces** | Each open / partial invoice bucketed into Upcoming / Just Due / Aging / Overdue / Critical + an optional drafted reminder message per row. |
| **Why daily refresh matters** | Buckets advance one day per business day; payments arriving in `payment_history_seed` remove rows from the report. |

Bucket cutoffs (in days past due): `Upcoming < 0`, `Just Due 0–7`,
`Aging 8–29`, `Overdue 30–59`, `Critical ≥ 60`.

---

## 3 · `demand-forecast` — Sourcing gaps

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/demand` |
| **Reads** | `inventory_seed.csv`, `forecast_outputs_seed.csv`, `demand_signals_seed.csv` |
| **How `today` is used** | Selects the most recent `forecast_outputs_seed.forecast_date` ≤ today; demand signals are also filtered to recent window ending today. |
| **What it produces** | Per-category gap table — `predicted_quantity − available_in_inventory` → categories with the deepest gaps are "source more". |
| **Why weekly refresh matters** | The forecast re-runs once a week; daily demand-signal rows let the script see directional change inside the week. |

---

## 4 · `memo-approval` — APPROVE / APPROVE_WITH_CONDITIONS / REJECT

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/memo` |
| **Reads** | `memos_seed.csv`, `inventory_seed.csv`, `payment_history_seed.csv`, `demand_signals_seed.csv`, `customers_seed.csv` |
| **How `today` is used** | Filters `memos_seed` to rows where `decision = "Pending"` and `expiry_date ≥ today`. Reliability and demand windows are also anchored on today. |
| **What it produces** | One decision per pending memo + reasoning. Auto-approve gated on tier + opportunity score; everything else goes to a review queue. |
| **Why daily refresh matters** | Memo requests are inbound — they arrive throughout the day. |

**Signal groups** (per the skill's `SKILL.md`):

| Group | Pulled from |
| --- | --- |
| Stone state | `inventory_seed`, optional triage-tags JSON |
| Requester reliability | `memos_seed` (past conversion), `payment_history_seed` (late rate) |
| Opportunity cost | `demand_signals_seed` (recent demand_score), `customers_seed` (CLV tier) |

---

## 5 · `morning-briefing` — Daily prioritized to-do

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/briefing` |
| **Reads** | `inventory_seed.csv`, `sales_transactions_seed.csv`, `negotiation_threads_seed.csv`, `quotes_seed.csv`, `demand_signals_seed.csv`, `customers_seed.csv` |
| **How `today` is used** | Used to compute "≥ 90 days old", "> 30 days past due", and "open ≥ N days" filters across the four input categories. |
| **What it produces** | Five priority bullets across Inventory / Collections / Negotiations / Quotes, rendered as the morning briefing card on the Mahant dashboard. |
| **Why daily refresh matters** | The briefing is the chained downstream of the other skills — its value is "what changed overnight". |

Source mapping for each section of the briefing:

| Section | Source CSV(s) | Filter rule |
| --- | --- | --- |
| Inventory | `inventory_seed` + `demand_signals_seed` | Available stones aged ≥ 90 d needing CLEAR / DISCOUNT |
| Collections | `sales_transactions_seed` | Open / Partial invoices > 30 d past due |
| Negotiations | `negotiation_threads_seed` | Open threads, sorted by oldest activity |
| Quotes | `quotes_seed` | Pending quotes where the customer has countered |

---

## 6 · `negotiation-threads` — Thread summarizer + next-best-action

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/threads` |
| **Reads** | `negotiation_threads_seed.csv`, `communication_logs_seed.csv`, `quotes_seed.csv`, `customers_seed.csv` |
| **How `today` is used** | Threads are scored "going stale" if `today − last_message_date > 5 days`. |
| **What it produces** | Per-thread: a short summary of the chronological notes, current state, and recommended next action. Always uses the LLM — `notes` are free-text. |
| **Why daily refresh matters** | Each new MSG row in `communication_logs_seed` changes the summary; stale-detection is a function of today. |

---

## 7 · `quote-negotiation` — ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE

| | |
| --- | --- |
| **Mahant UI** | `/admin/ai/quote` |
| **Reads** | `quotes_seed.csv`, `inventory_seed.csv`, `customers_seed.csv`, `demand_signals_seed.csv` |
| **How `today` is used** | Filters quotes to `quote_outcome = "Negotiating"` and freshness windows on demand signals. |
| **What it produces** | One decision per open quote + the drafted counter-reply message. |
| **Why daily refresh matters** | New counter-offers arrive as new QTE rows; demand-signal recency drives the floor. |

Decision drivers, in order: customer's offered price vs. margin floor →
demand score → stone tier (triage tag) → customer CLV tier.

---

## 8 · `weekly-repricing` — Rap-anchored price recompute

| | |
| --- | --- |
| **Mahant UI** | `/admin/pricing` |
| **Reads** | `rap_weekly_seed.csv`, `inventory_seed.csv`, `sales_transactions_seed.csv`, `demand_signals_seed.csv`, `memos_seed.csv`, `quotes_seed.csv` |
| **How `today` is used** | Picks the most recent `rap_week ≤ today`. 60-day velocity & demand windows end at today. |
| **What it produces** | One row per Available stone: `old_price`, `proposed_price`, `pct_change`, `flag` (FROZEN / MARGIN / QUOTE / UNCHANGED), `primary_driver`. |
| **Why weekly refresh matters** | This is the only skill that is *driven* by a weekly event (new Rap sheet) rather than just sensitive to one. |

The 15-factor recipe lives in the skill's `SKILL.md`. The most
data-hungry factors:

| Factor | CSV |
| --- | --- |
| New Rap rate | `rap_weekly_seed` (latest week) |
| Age in stock | `inventory_seed` |
| Category velocity | `sales_transactions_seed` (60 d window) |
| Demand score / depth | `demand_signals_seed` (60 d window) |
| Active memos / quotes | `memos_seed`, `quotes_seed` (sets FROZEN / QUOTE flag) |
| Cost basis & margin floor | `inventory_seed` |

---

## Three simulated datasets — what to substitute the real daily data with

Because the real production data won't exist until the platform goes
live, we generate three named CSV snapshots under
[`data/scenarios/`](../../data/scenarios/) that stand in for "what next
week / next month would look like". Each is a full set of the 14 CSVs at
a specific simulated business date.

| Scenario | Sim date reached | Built by | Best for demoing |
| --- | --- | --- | --- |
| **`scenario_a_normal_day`** | 2026-05-04 | reset + 1 daily tick (seed 42) | First-pass behavior of every skill on a quiet weekday; small delta from baseline |
| **`scenario_b_monday_rap_drop`** | 2026-05-10 | reset + 7 daily ticks (seed 101) — the embedded Monday tick auto-fires the weekly Rap + forecast drop | `weekly-repricing` (new Rap rates), `demand-forecast` (new forecast row) |
| **`scenario_c_month_end_stress`** | 2026-06-02 | reset + 30 daily ticks (seed 2025) — covers 4–5 Rap drops + heavy aging | `collection-reminder` (many invoices past due), `morning-briefing` (everything compounded), aged inventory |

### How much new data each scenario adds vs. baseline

| Table | Baseline | A (+1 day) | B (+7 days) | C (+30 days) |
| --- | ---: | ---: | ---: | ---: |
| `sales_transactions_seed` | 400 | 403 | 437 | 541 |
| `quotes_seed` | 800 | 807 | 843 | 977 |
| `memos_seed` | 80 | 80 | 88 | 114 |
| `negotiation_threads_seed` | 150 | 157 | 201 | 361 |
| `communication_logs_seed` | 600 | 612 | 656 | 834 |
| `payment_history_seed` | 290 | 290 | 291 | 304 |
| `demand_signals_seed` | 2 000 | 2 227 | 3 589 | 8 810 |
| `rap_weekly_seed` | 11 804 | 11 804 | 12 031 | 12 939 |
| `forecast_outputs_seed` | 227 | 227 | 454 | 1 362 |

### Loading a scenario

```bash
# Bring scenario B into data/raw/, sim clock set to 2026-05-10
python3 scripts/simulate/tick.py --load scenario_b_monday_rap_drop

# Now run any skill — it sees the post-Rap-drop state
uv run python automations/propose-repricing/scripts/propose_repricing.py --json --today 2026-05-10

# Or chain the whole orchestrator
uv run python scripts/orchestrator.py --no-narration --today 2026-05-10

# Restore baseline when done
python3 scripts/simulate/tick.py --reset
```

### Rebuilding the scenarios

If the baseline changes, regenerate:

```bash
python3 scripts/simulate/make_scenarios.py            # all three
python3 scripts/simulate/make_scenarios.py --only b   # just scenario B
```

Seeds are fixed in `make_scenarios.py` so the snapshots are
byte-reproducible — useful when you commit them and want a clean diff
next time you regenerate.

### Why three scenarios, not one

Each skill is sensitive to different parts of the data, so a single
snapshot can't show all of them under load:

| Skill | Best demoed in |
| --- | --- |
| `inventory-aging-triage` (M03 step 1) | C — month of aging makes CLEAR tags appear |
| `weekly-repricing` | B — Monday Rap drop is the trigger |
| `demand-forecast` | B (new forecast row) or C (compounded signals) |
| `quote-negotiation` | A or B — fresh negotiating quotes, demand still close to baseline |
| `memo-approval` | B or C — multiple pending memos accumulated |
| `collection-reminder` | C — invoices have crossed 30/60-day buckets |
| `clv-broker-company` | C — enough new sales to shift CLV |
| `negotiation-threads` | B or C — multi-message threads with simulated notes |
| `morning-briefing` | C — most input categories non-empty |

---

## File map

```
mgt449-milestone03-Group-10/
├── scripts/simulate/
│   ├── tick.py                ← simulator (--reset / --daily / --weekly / --days / --snapshot / --load / --status)
│   ├── make_scenarios.py      ← builds the 3 named snapshots
│   ├── SIMULATION.md          ← simulator design + Mahant UI integration options
│   └── SKILLS_DATA_FLOW.md    ← THIS DOC
├── data/
│   ├── raw/                   ← mutable CSVs the skills read
│   ├── raw/_baseline/         ← frozen original seeds (committed, used by --reset)
│   ├── scenarios/             ← the 3 snapshots (committed)
│   │   ├── scenario_a_normal_day/
│   │   ├── scenario_b_monday_rap_drop/
│   │   └── scenario_c_month_end_stress/
│   └── working/
│       └── sim_state.json     ← simulator clock (gitignored)
```
