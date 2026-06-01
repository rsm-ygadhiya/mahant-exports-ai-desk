# Data Simulation Plan — Pramukh Gems / Mahant Exports

This doc maps every AI skill to the CSV tables it reads, the cadence on
which those tables get fresh data in real life, and the simulator that
mimics that refresh locally so we can demo the skills end-to-end.

The simulator lives at [`tick.py`](tick.py). It only touches CSVs under
`data/raw/`. The Mahant Next.js UI reads PostgreSQL via Prisma — see
[§ Mahant UI integration](#mahant-ui-integration) below for how to get the
simulated state into the UI.

---

## 1 · Skill → data map

Nine skills consume the operational tables. Each skill page on the Mahant
admin panel lives at `/admin/ai/<slug>`.

| # | Skill | Mahant UI page | Reads | Refresh cadence (real life) |
| - | --- | --- | --- | --- |
| 1 | **inventory-aging-triage** | `/admin/ai/aging` | `inventory_seed`, `demand_signals_seed`, `sales_transactions_seed` | **Daily** — ages advance, new sales remove stones |
| 2 | **weekly-repricing** | `/admin/pricing` | `rap_weekly_seed`, `inventory_seed`, `sales_transactions_seed`, `demand_signals_seed`, `memos_seed`, `quotes_seed` | **Weekly** — driven by Mon AM Rap drop |
| 3 | **demand-forecast** | `/admin/ai/demand` | `inventory_seed`, `forecast_outputs_seed`, `demand_signals_seed` | **Weekly** — forecast model re-runs |
| 4 | **quote-negotiation** | `/admin/ai/quote` | `quotes_seed`, `inventory_seed`, `customers_seed`, `demand_signals_seed` | **Daily** — new quotes + counter-offers |
| 5 | **memo-approval** | `/admin/ai/memo` | `memos_seed`, `inventory_seed`, `payment_history_seed`, `demand_signals_seed`, `customers_seed` | **Daily** — new memo requests |
| 6 | **collection-reminder** | `/admin/ai/collections` | `sales_transactions_seed`, `payment_history_seed`, `customers_seed` | **Daily** — invoices age, payments arrive |
| 7 | **clv-broker-company** | `/admin/ai/clv` | `customers_seed`, `sales_transactions_seed` | **Daily** (cheap) — recomputes from sales |
| 8 | **negotiation-threads** | `/admin/ai/threads` | `communication_logs_seed`, `negotiation_threads_seed` | **Daily** — new messages on threads |
| 9 | **morning-briefing** | `/admin/ai/briefing` | inventory + demand + sales + threads + quotes | **Daily** — chains the others |

The four M03 chained automations + skill (`triage-inventory`,
`propose-repricing`, `rank-customer-clv`, `decide-memo`) read the same
tables — they're the deterministic-Python implementation of skills 1, 2, 7,
and 5.

`customers_seed`, `cut_simulations_seed`, `orders_queue_seed`, and
`index_price_history_seed` are reference / out-of-scope for these 9 skills
and the simulator leaves them untouched.

---

## 2 · Refresh cadence — what arrives when

### Daily (every business morning, ~6 AM IST)

| Table | What changes | Simulator behavior |
| --- | --- | --- |
| `inventory_seed` | `age_in_stock_days` +1 for every Available stone; sold stones flip `status` → `Sold` | +1 day age across all rows; 3–7 stones flip to Sold |
| `sales_transactions_seed` | Yesterday's deals booked | Appends 3–7 TXN rows |
| `payment_history_seed` | Invoices whose `due_date == today` settle (mostly on-time, some late) | Appends PAY rows for due invoices, weighted by customer `payment_score` |
| `quotes_seed` | New quotes sent + counters received | Appends 4–8 QTE rows with `quote_outcome="Negotiating"` |
| `memos_seed` | Brokers/customers request new holds | Appends 0–2 MEMO rows with `decision="Pending"` |
| `negotiation_threads_seed` | New threads opened, existing threads' `last_message_date` bumped | One THRD row per new quote/memo |
| `communication_logs_seed` | 5–12 messages arrive on open threads | Appends MSG rows tied to recent open threads |
| `demand_signals_seed` | One row per category for today's marketplace state | Appends ~227 rows (one per category) with random-walk noise around recent 7-day average |

### Weekly (Mon AM)

| Table | What changes | Simulator behavior |
| --- | --- | --- |
| `rap_weekly_seed` | New Rapaport price sheet | Appends 227 rows (one per category) with ±1.5% WoW drift off latest rate |
| `forecast_outputs_seed` | Forecast model re-runs against last week's sales | Appends 227 rows with TY/LY/growth derived from real recent sales |

### Effectively static
`customers_seed` (rarely changes — onboarding only), `cut_simulations_seed`,
`orders_queue_seed`, `index_price_history_seed`.

---

## 3 · Using the simulator

```bash
cd mgt449-milestone03-Group-10

# Reset to the frozen baseline (clears the sim clock too)
python3 scripts/simulate/tick.py --reset

# Advance one simulated day (writes ~250–280 new rows across 7 tables)
python3 scripts/simulate/tick.py --daily

# Advance one week (just the Rap + forecast drop, no daily activity)
python3 scripts/simulate/tick.py --weekly

# Advance 7 days; the weekly drop fires automatically when the clock
# crosses a Monday
python3 scripts/simulate/tick.py --days 7

# Reproducible runs (same seed → same simulated activity)
python3 scripts/simulate/tick.py --daily --seed 42

# Current sim date + row counts
python3 scripts/simulate/tick.py --status
```

The simulator keeps state in `data/working/sim_state.json` so repeated
calls advance one day each time. The first call starts from the day after
the latest `transaction_date` in the baseline (`2026-05-03`).

`data/raw/_baseline/` holds the frozen original seeds and should be
committed; the simulator never writes there.

---

## 4 · Demo recipe — show skills working on fresh data

```bash
# 1. Clean slate
python3 scripts/simulate/tick.py --reset

# 2. Run the orchestrator on the baseline — capture "day 0"
uv run python scripts/orchestrator.py --no-narration --today 2026-05-03

# 3. Advance a week of activity
python3 scripts/simulate/tick.py --days 7 --seed 42

# 4. Re-run the orchestrator — outputs should differ:
#    - Triage: fewer Available stones, older ages, more CLEAR tags
#    - Repricing: new Rap rates ripple through proposed_price
#    - CLV: refreshed by the week of new sales
#    - Decide-memo: new pending memos appear in the review queue
uv run python scripts/orchestrator.py --no-narration --today 2026-05-10

# 5. Diff the working/ outputs from steps 2 and 4 to demonstrate the
#    skills actually reacted to the new data.
```

Each individual skill also accepts `--today YYYY-MM-DD` so you can run
them point-in-time against a specific simulated date.

---

## 5 · Mahant UI integration {#mahant-ui-integration}

The Mahant Next.js admin panel at [`web/src/app/admin/ai/`](../../../../Mahant/web/src/app/admin/ai)
already has one route per skill. Each page hits
`/api/admin/ai/[skill]` → `lib/ai-skills/<skillName>.ts` → **PostgreSQL via
Prisma**, *not* the CSVs in this repo. The two implementations are parallel
views over the same business state.

To show the simulated state in the UI, pick one:

1. **CSV-side demo only** *(simplest)* — present the JSON output from
   `scripts/orchestrator.py` or each skill's `--json` flag side-by-side
   with the UI screenshot. The UI shows real Postgres state; the CSVs
   show the simulated future state.

2. **Sync CSV → Postgres** — write a small import script that reads
   `data/raw/*_seed.csv` and `upsert`s into the Prisma tables
   (`Diamond`, `Customer`, `Enquiry`, `Memo`, `Quote`, `Payment`, etc.).
   The Mahant UI then reflects the simulated day immediately. Stub:

   ```ts
   // web/scripts/import-from-csv.ts
   import { prisma } from '../src/lib/db';
   import { parse } from 'csv-parse/sync';
   import fs from 'fs';

   const inv = parse(fs.readFileSync('.../inventory_seed.csv'), { columns: true });
   for (const row of inv) {
     await prisma.diamond.upsert({
       where: { stoneId: row.stock_id },
       create: { /* ...map fields... */ },
       update: { status: row.status, ageInStockDays: +row.age_in_stock_days },
     });
   }
   ```

3. **Wire the UI to Python** *(future)* — expose the MCP server at
   `mcp_servers/tools_server.py` over HTTP and have the Next.js API
   routes call it instead of running their own Prisma-based heuristics.
   This is closer to "one source of truth" but is more work.

For the May 21 demo, option 1 is the lowest-risk path: simulate, run the
Python skills, screenshot the matching UI page to show the UX, and
present them together.

---

## 6 · What the simulator does **not** do

- **No upstream M01 simulation** — no rough purchases, no factory yield,
  no QC reports. The skills don't need them.
- **No marketplace index** (`index_price_history_seed`) — not consumed by
  the 9 skills.
- **No customer onboarding** — `customers_seed` is treated as static.
  Add a row manually if you want to demo a new buyer.
- **No closing of memos/quotes** — new ones are added with status
  `Pending` / `Negotiating`; the `decide-memo` and `quote-negotiation`
  skills are what move them to terminal states.
- **No LLM-generated free text** — `communication_logs_seed` notes are
  drawn from a fixed 10-template pool. Good enough for the
  `negotiation-threads` skill to do real summarization; not good enough
  to test edge-case wording.

---

## 7 · Files

```
scripts/simulate/
├── SIMULATION.md       ← this doc
└── tick.py             ← single-file simulator (stdlib only)

data/raw/
├── _baseline/          ← frozen original seeds — used by --reset
└── *_seed.csv          ← mutable; simulator appends here

data/working/
└── sim_state.json      ← {today, last_run} — written by the simulator
```
