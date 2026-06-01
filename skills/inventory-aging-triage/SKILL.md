---
name: inventory-aging-triage
description: Weekly inventory aging review for a lab-grown diamond wholesaler. Tags every available stone HOLD / WATCH / DISCOUNT / CLEAR with a suggested price action, anchored on age, category velocity, demand signal, and active inquiries. Use this whenever the user asks about slow movers, aging inventory, what to clear, what to discount, what's stuck on the desk, or wants a weekly inventory health review — even if they don't say "aging" or "triage." Also use it as the upstream input for Skill 6 (Weekly Rap-Based Repricing) and Skill 1 (Memo Approval).
---

# Inventory Aging & Clearance Triage

Weekly sweep over available inventory. For each stone, the script tags one of four actions:

- **HOLD** — young or in active category, leave alone.
- **WATCH** — mid-age, mixed signals, monitor next week.
- **DISCOUNT** — old but category still has demand → drop price to capture remaining interest.
- **CLEAR** — old + weak category → push out aggressively.

The math lives in `scripts/inventory_aging_skill.py`. Your job as Claude is to read the user's request, run the script with the right flags, and present results in the format below.

## When to trigger

Trigger on any phrasing that is about reviewing what's in inventory and what to do about it:

- "Run the weekly aging review"
- "What should I clear this week?"
- "Show me my slow movers"
- "Which stones need attention?"
- "Anything sitting older than 90 days?"
- "Show me everything in the DISCOUNT bucket"
- "Time for a triage" / "What's stuck?"

Do NOT trigger on:
- Questions about a single stone's price (use Skill 6 — Weekly Rap-Based Repricing).
- Questions about customer value (use Skill 3 — CLV).

## Inputs the script needs

The script reads four CSVs from `data/Milestone_2/` directly. You do not need to gather pricing inputs from the user. You DO need to ask if any of these are unclear:

| User says | Map to flag |
| --- | --- |
| "older than 90 days" / "over 60 days" | `--age-min 90` (or 60) |
| "show top 50" / "top ten" | `--top 50` (or 10) |
| "only the CLEAR ones" / "just discounts" | `--filter-tag CLEAR` (or DISCOUNT/WATCH/HOLD) |
| "show me a category" / "rounds only" | `--category-contains "Round"` (substring match on category_simple) |
| "explain it" / "narrate" / "summary" | `--model api-llama-4-scout` (cheap default) |
| "give me JSON" / "for the next skill" | `--json` |

Defaults: top 20, no age filter, no tag filter, no narration, table output.

## How to run

From the repo root, with `.env` set up for LLM narration:

```bash
source .venv/bin/activate && uv run python skills/inventory-aging-triage/scripts/inventory_aging_skill.py
```

Common variations:

```bash
# Older than 90 days, top 30, with narration
uv run python skills/inventory-aging-triage/scripts/inventory_aging_skill.py \
    --age-min 90 --top 30 --model api-llama-4-scout

# Only DISCOUNT-tagged stones, JSON output (e.g. piping into Skill 6)
uv run python skills/inventory-aging-triage/scripts/inventory_aging_skill.py \
    --filter-tag DISCOUNT --json

# Override which date "today" is for reproducible weekly runs
uv run python skills/inventory-aging-triage/scripts/inventory_aging_skill.py --today 2026-05-02
```

## Output format

The script prints two sections:

1. **Header line** with aggregate counts:
   `"187 available stones — CLEAR: 12 | DISCOUNT: 28 | WATCH: 41 | HOLD: 106"`

2. **Top-N action list**, ranked by urgency (CLEAR > DISCOUNT > WATCH > HOLD; within tag, oldest first). Each row shows: stock_id, days_in_stock, category_simple, current_price (`p_pcs`), action_tag, suggested_price_move_pct, reason.

When `--model` is set, a 2–3 sentence executive summary follows.

When `--json` is set, the full ranked DataFrame prints as a JSON array — useful for Skill 6 to read.

## How to present to the user

1. Run the script with the flags inferred from the user's message.
2. Echo the header line verbatim.
3. Show the table — keep it as a markdown table when responding in chat. Don't truncate.
4. If a narration was generated, include it before the table as a one-paragraph summary.
5. If the user asked about a specific stone or category that isn't in the top-N, rerun with `--filter-tag` or `--category-contains` so you don't have to caveat.

Always keep currency to `$X,XXX` (no decimals — these are wholesale prices, not retail) and percentages with one decimal.
