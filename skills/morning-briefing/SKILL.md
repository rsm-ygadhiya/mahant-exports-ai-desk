---
name: morning-briefing
description: Morning desk briefing for a lab-grown diamond wholesaler. Chains inventory aging, overdue collections, open negotiations, and pending quote responses into a single prioritized action list. Use when the user says "what needs my attention today", "morning briefing", "daily summary", "what's urgent", "what should I work on first", or "show me today's priorities".
---

# Morning Desk Briefing

Runs on demand (or as a daily cron). Chains four data pulls — inventory aging actions, overdue collection alerts, open negotiation threads, and quotes awaiting response — into a single prioritized "what needs my attention today" report.

## When to trigger

- "What needs my attention today?"
- "Morning briefing" / "Give me the morning briefing."
- "Daily summary" / "What's my daily summary?"
- "What's urgent?" / "What should I work on first?"
- "Show me today's priorities."
- "What do I need to do today?"

Do **not** trigger for: weekly repricing (Skill 6), detailed CLV analysis (Skill 3), full collection reminders (Skill 4), or memo decisions (Skill 1).

## Four sections in the briefing

| Section | Source | What it flags |
|---|---|---|
| **Inventory** | inventory_seed + demand_signals_seed | Available stones aged ≥ 90d needing CLEAR or DISCOUNT action |
| **Collections** | sales_transactions_seed | Open/Partial invoices > 30 days past due |
| **Negotiations** | negotiation_threads_seed | Open threads sorted by last activity (oldest first) |
| **Quotes** | quotes_seed | Pending quotes where the customer has countered |

## Inputs the script needs

All data comes from CSVs under `data/Milestone_2/` — no user input required beyond optional filters.

| User says | Map to flag |
|---|---|
| "top 10" / "show more" | `--top 10` |
| "use llama" / "draft a summary" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |
| "as of last week" | `--today 2026-04-25` |
| "save charts" | `--chart-out morning_briefing_chart.png` |

## How to run

```bash
# Quick daily briefing
uv run python skills/morning-briefing/scripts/morning_briefing.py

# With LLM-synthesized 3-5 bullet summary
uv run python skills/morning-briefing/scripts/morning_briefing.py --model api-llama-4-scout

# Show top 10 rows per section
uv run python skills/morning-briefing/scripts/morning_briefing.py --top 10

# JSON output for downstream use
uv run python skills/morning-briefing/scripts/morning_briefing.py --json

# Save charts (two PNGs)
uv run python skills/morning-briefing/scripts/morning_briefing.py --chart-out morning_briefing_chart.png

# Reproducible run for a past date
uv run python skills/morning-briefing/scripts/morning_briefing.py --today 2026-04-25
```

## Output format

```
=== Morning Desk Briefing — 2026-05-04 ===

INVENTORY (84 CLEAR | 293 DISCOUNT of 654 available)
  LGSTK00350 — Radiant 3.00+ DEF SI — 364d — CLEAR (−22% suggested)
  ...

COLLECTIONS (132 critical | $756,919 total outstanding)
  INV00323 — CUST0078 — $1,462 — 151 days overdue
  ...

NEGOTIATIONS (N open threads)
  Thread THRD0001 — CUST0013 / LGSTK00XXX — last activity 8 days ago
  ...

QUOTES AWAITING RESPONSE (N quotes)
  QTE00045 — CUST0031 — offered $48 (our price $51)
  ...
```

## How to present to the user

1. Run the script with the appropriate flags.
2. Echo each section header verbatim.
3. Show the top N rows per section (default 5).
4. If `--model` was used, append the LLM-synthesized bullet summary at the bottom.
5. If `--chart-out` was passed, mention the chart filenames saved.
6. After the summary, **call out items that require human action before proceeding**:
   - **Collections — Critical**: "⚠️ [N] Critical invoices require management sign-off before reminders go out. Route these now?"
   - **Quotes — ESCALATE**: "⚠️ [N] quotes are over $50K and need senior manager approval before any response."
   - **Memos — APPROVE_WITH_CONDITIONS**: "These conditional approvals need your confirmation before the marketplace lock fires."
7. For all other items, the briefing is read-only — the desk decides what to action from the list.
