---
name: weekly-repricing
description: Weekly Rap-based repricing for a lab-grown diamond wholesaler. Recomputes the price for every available stone when a new Rap sheet drops, applying 15 factors (Rap rate, position preference, aging triage tag, age-in-stock, category velocity, demand signals, realized sales comps, marketplace depth, margin floor, cost basis, active memos, open quotes, inventory depth, customer deals, FX). Use whenever the user says "Rap just updated", "run the weekly repricing", "reprice the inventory", "what should our new prices be", or asks what changed after a Rap drop — even if they don't say "Rap" or "repricing". Also use as the downstream consumer of Skill 5 (Inventory Aging Triage) output.
---

# Weekly Rap-Based Repricing Agent

Runs every time a new Rap sheet drops (weekly) or on demand. Produces a
**reviewable batch**: proposed price for every available stone, with a
primary-driver explanation, margin classification, and freeze/flag status.
The desk reviews, overrides any rows, then approves — at which point the
marketplace sync engine pushes new prices atomically to all platforms.

## When to trigger

- "Run the weekly repricing."
- "Rap just updated — reprice the inventory."
- "What should our new prices be this week?"
- "Reprice everything older than 60 days."
- "Show me stones whose price would breach the margin floor."
- "What changed after today's Rap?"

Do **not** trigger on:
- Questions about a single customer's value (use Skill 3 — CLV).
- Questions about which stones to clear (use Skill 5 — Aging Triage).

## Inputs the script needs

The script reads six CSVs from `data/Milestone_2/` directly. You do **not**
need to gather inputs from the user beyond optional flags below.

| User says | Map to flag |
| --- | --- |
| "reprice only rounds" / "just ovals" | `--category-contains "Round"` |
| "older than 90 days only" | `--age-min 90` |
| "use rank-1 positioning" | `--position rank_1` |
| "target page 2 / hold prices" | `--position page_2` |
| "use 8% minimum margin" | `--min-margin 0.08` |
| "show only margin flags" | `--filter-flag MARGIN` |
| "show frozen stones" | `--filter-flag FROZEN` |
| "explain it" / "narrate" | `--model api-llama-4-scout` |
| "give me JSON" / "for the next step" | `--json` |
| "use Skill 5 tags" | `--triage-json <path-to-skill5-output.json>` |
| "show top 50" | `--top 50` |

Defaults: all available stones, `page_1` position, 5% minimum margin,
top 20, no narration, table output.

### Feeding Skill 5 tags (recommended for weekly run)

Run Skill 5 first with `--json` to capture triage tags, then pipe them in:

```bash
source .venv/bin/activate

# Step 1: get triage tags
uv run python skills/inventory-aging-triage/scripts/inventory_aging_skill.py \
    --json --top 9999 > /tmp/triage.json

# Step 2: reprice with tags
uv run python skills/weekly-repricing/scripts/repricing_skill.py \
    --triage-json /tmp/triage.json --model api-llama-4-scout
```

## The 15 pricing factors

| # | Factor | Prototype source | Effect on price |
|---|--------|-----------------|-----------------|
| 1 | **New Rap rate** | `rap_weekly_seed.csv` (latest week) | Recomputes base via `carat × rap_per_carat × (1 − discount)` |
| 2 | **Position preference** | `--position` flag | rank_1 = −3%; page_1 = 0%; page_2 = +2% |
| 3 | **Aging triage tag** | Skill 5 JSON or none | CLEAR = −5%; DISCOUNT = −3%; HOLD/WATCH = 0% |
| 4 | **Age in stock** | `inventory_seed.csv` | 90–179d = −3%; ≥180d = −6% |
| 5 | **Category velocity** | `sales_transactions_seed.csv` (60d) | 0 sales = −2%; ≥5 sales = +1% |
| 6 | **Demand score** | `demand_signals_seed.csv` (60d) | <0.40 = −2%; ≥0.60 = +1% |
| 7 | **Realized sales comps** | `sales_transactions_seed.csv` | Drives category velocity signal |
| 8 | **Marketplace depth** | `demand_signals_seed.csv` (listing_count) | ≥150 listings = −1% (crowded) |
| 9 | **Margin floor** | `cost_basis` + `--min-margin` | Hard cap: never below cost × 1.05 → MARGIN flag |
| 10 | **Cost basis** | `inventory_seed.csv` | Used for margin % calculation |
| 11 | **Active memos** | `memos_seed.csv` | Stone frozen → proposed = old price, FROZEN flag |
| 12 | **In-flight quotes** | `quotes_seed.csv` | If proposed < open quote price → QUOTE flag |
| 13 | **Inventory depth** | `demand_signals_seed.csv` | Subsumed in factor 8 |
| 14 | **Customer-specific deals** | _(deferred for prototype)_ | — |
| 15 | **Currency/FX** | _(deferred for prototype)_ | — |

## How to run

From the repo root:

```bash
source .venv/bin/activate

# Standard weekly run
uv run python skills/weekly-repricing/scripts/repricing_skill.py

# With narration
uv run python skills/weekly-repricing/scripts/repricing_skill.py \
    --model api-llama-4-scout

# rank_1 positioning, stones over 90 days, higher margin floor
uv run python skills/weekly-repricing/scripts/repricing_skill.py \
    --position rank_1 --age-min 90 --min-margin 0.08

# Show only margin-flagged stones (need human review)
uv run python skills/weekly-repricing/scripts/repricing_skill.py \
    --filter-flag MARGIN

# Reproduce last week's run
uv run python skills/weekly-repricing/scripts/repricing_skill.py \
    --today 2026-04-25
```

## Output format

### Header line

```
187 stones repriced: 64 up, 98 down, 25 unchanged (3 frozen on memo). 3 flagged for review (margin breach).
```

### Per-stone table (top N, sorted by urgency)

| Stock | Category | Old $ | New $ | Chg % | Margin | Flag | Driver |
|---|---|---|---|---|---|---|---|
| LGSTK00042 | Round \| 1.00-1.49 \| DEF \| VVS+ | $1,240 | $1,128 | −9.1% | Safe | — | Rap fell −3.2%; aging (120d) → −3% |
| LGSTK00099 | Oval \| 2.00-2.99 \| GH \| VS | $4,800 | $4,800 | 0.0% | Safe | FROZEN | active memo — frozen |
| LGSTK00017 | Princess \| 0.50-0.99 \| IJK \| SI | $320 | $340 | 0.0% | Conditional | MARGIN | price capped at margin floor |

**Flag values:**

- *(empty)* — clean change, no review needed.
- `UNCHANGED` — proposed price within ±0.5% of old price; informational only.
- `FROZEN` — stone on an active approved memo; price not changed.
- `MARGIN` — proposed price would breach margin floor; capped and requires review.
- `QUOTE` — proposed price is below an open quote already sent to a customer.

**Margin class:**

- `Safe` — proposed price yields ≥ min_margin (default 5%) above cost.
- `Conditional` — price was capped at the floor; desk should review stone economics.
- `Unsafe` — floor price itself is below cost (data anomaly — flag for data team).

## How to present to the user

1. Run the script with flags inferred from the user's message.
2. Echo the header line verbatim.
3. Show the table as markdown. If the user asked about a specific stone or
   category not in the top-N, rerun with `--stock-id` or `--category-contains`.
4. If narration was requested, show it as a one-paragraph summary **before** the table.
5. After showing the full batch, **pause and require explicit human approval before any prices are pushed**:
   > "Batch ready. Review the table above — flag any rows to override, then type **'approve'** to push prices to all marketplaces, or specify overrides."
   Do not treat the batch as approved until the user explicitly confirms.
6. **MARGIN-flagged stones require separate confirmation** — call them out individually:
   > "⚠️ [N] stones are MARGIN-flagged (price capped at floor). These need desk review before approval."
7. **QUOTE-flagged stones**: warn that a proposed price is below a live customer quote and ask whether to freeze that stone's price until the quote closes.

Keep currency to `$X,XXX` (no decimals) and percentages to one decimal.
