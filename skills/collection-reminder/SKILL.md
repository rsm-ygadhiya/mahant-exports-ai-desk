---
name: collection-reminder
description: Daily collection and payment reminder agent for a lab-grown diamond wholesaler. Buckets every open invoice by days-past-due (Upcoming / Just Due / Aging / Overdue / Critical) and drafts tone-appropriate reminder messages. Use whenever the user says "run today's collection reminders", "who owes us money", "show overdue invoices", "draft a reminder for INV-XXXX", "who's 60+ days overdue", or "show my aging report" — even if they don't use the word "collection" or "reminder".
---

# Collection & Payment Reminder Agent

Runs daily (or on demand). Buckets every open/partial invoice by how far past due it is, then drafts a tone-matched message for each. Designed as a daily cron in production; the same code works for ad-hoc queries.

## When to trigger

- "Run today's collection reminders."
- "Who owes us money?" / "Show me all open invoices."
- "Show everything 60+ days overdue."
- "Draft a reminder for INV00042."
- "Show open invoices for CUST0013."
- "How much total is outstanding right now?"

Do **not** trigger for: stone pricing (Skill 6), memo decisions (Skill 1), or customer value (Skill 3).

## Bucket definitions

| Bucket | Days past due | Tone |
|---|---|---|
| **Upcoming** | −5 to 0 | Friendly heads-up |
| **Just Due** | 1–7 | Polite nudge |
| **Aging** | 8–30 | Firm reminder |
| **Overdue** | 31–60 | Escalation |
| **Critical** | 60+ | Urgent — flag for management |

Invoices more than 5 days before due date are silently excluded (too early).

## Inputs the script needs

All data comes from CSVs — no user input required beyond optional filters.

| User says | Map to flag |
|---|---|
| "only overdue" / "just the critical ones" | `--bucket overdue` or `--bucket critical` |
| "invoice INV00042" | `--invoice INV00042` |
| "all invoices for CUST0013" | `--customer CUST0013` |
| "draft reminders" / "write the messages" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |
| "show top 50" | `--top 50` |

## How to run

```bash
source .venv/bin/activate

# Daily report
uv run python skills/collection-reminder/scripts/collection_reminder.py

# With LLM-drafted reminders for top 3 most urgent
uv run python skills/collection-reminder/scripts/collection_reminder.py \
    --model api-llama-4-scout

# Only critical invoices
uv run python skills/collection-reminder/scripts/collection_reminder.py \
    --bucket critical

# Drill into one customer
uv run python skills/collection-reminder/scripts/collection_reminder.py \
    --customer CUST0013

# Single invoice
uv run python skills/collection-reminder/scripts/collection_reminder.py \
    --invoice INV00042

# Reproducible run for a past date
uv run python skills/collection-reminder/scripts/collection_reminder.py \
    --today 2026-04-25
```

## Output format

### Header line

```
227 open invoices — Critical: 128 | Overdue: 51 | Aging: 36 | Just Due: 3 | Upcoming: 9 | Total outstanding: $1,842,300
```

### Table (sorted by urgency: Critical → Overdue → Aging → Just Due → Upcoming)

| Invoice | Customer | Outstanding | Due Date | Days Past Due | Bucket | Status |
|---|---|---|---|---|---|---|
| INV00015 | CUST0042 | $8,400 | 2025-12-01 | 122 | critical | Open |

### Drafted reminders (when `--model` is set)

For the 3 most urgent invoices, a tone-matched paragraph is printed:

> **INV00015 — Solitaire Source C42**
> Dear Solitaire Source team, this is an urgent notice regarding invoice INV00015 for $8,400 …

Followed by a 2–3 sentence executive summary from the LLM.

## How to present to the user

1. Run the script with the appropriate flags.
2. Echo the header line verbatim.
3. Show the table as markdown.
4. If `--model` was used, show the drafted reminders and the LLM summary.
5. For **Critical** invoices (60+ days), **pause after showing drafts** and ask for management confirmation before treating reminders as ready to send:
   > "⚠️ These [N] Critical invoices require **management review** before reminders go out. Please confirm escalation to management, or flag specific invoices to hold."
   Do not mark reminders as sent until the user explicitly approves.
6. For **Overdue** invoices (31–60 days), show the drafts and note:
   > "Overdue reminders are ready for your review. Confirm to log as sent."
7. For **Upcoming / Just Due / Aging**, drafts may be used at the desk's discretion — no explicit confirmation required.
8. Keep currency to `$X,XXX` (no decimals).
