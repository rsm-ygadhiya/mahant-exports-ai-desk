---
name: negotiation-threads
description: Negotiation thread summarizer for a lab-grown diamond wholesaler. Reads communication log notes (free text) and uses an LLM to summarize the current negotiation status and recommend the next action. Use when the user says "what's happening with CUST0013", "summarize the negotiation for LGSTK00115", "show open negotiations", "which deals are going stale", "what did the customer say", "catch me up on thread TH0042", or "which negotiations need follow-up".
---

# Negotiation Thread Summarizer

Reads `communication_logs_seed.csv` and `negotiation_threads_seed.csv` to surface the full message history for a negotiation thread, then optionally uses an LLM to summarize the current state and recommend the next action.

## When to trigger

- "What's happening with CUST0013?"
- "Catch me up on thread THRD00042."
- "Summarize the negotiation for LGSTK00115."
- "Show all open negotiations."
- "Which deals are going stale / need follow-up?"
- "What did the customer say in the last message?"

Do **not** trigger for: quote decisions (Skill 2), collection reminders (Skill 4), memo holds (Skill 1), or repricing (Skill 6).

## Key LLM use case

The `notes` field in `communication_logs_seed.csv` is free-text written by sales reps. Rules cannot parse it. The LLM reads the chronological notes and writes:
1. **Current status** (1 sentence)
2. **Key points** from the negotiation (2–3 bullets)
3. **Recommended next action** (1 sentence starting with a verb)

## Inputs the script needs

| User says | Map to flag |
|---|---|
| "thread THRD00042" | `--thread THRD00042` |
| "all threads for CUST0013" | `--customer CUST0013` |
| "negotiation for LGSTK00115" | `--stock LGSTK00115` |
| "show all open" / "which are stale" | `--all-open` |
| "summarize it" / "what should we do" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |

## How to run

```bash
# Single thread by ID
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --thread THRD00042

# All threads for a customer
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --customer CUST0013

# Thread for a specific stone
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --stock LGSTK00115

# All open threads (most neglected first)
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --all-open --top 20

# Single thread with LLM summary
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --thread THRD00042 --model api-llama-4-scout

# JSON output
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --all-open --json

# Reproducible date
uv run python skills/negotiation-threads/scripts/negotiation_threads.py \
    --all-open --today 2026-05-02
```

## Output format

### Single thread

```
Thread THRD00042 — CUST0013 (Blue Star Jewels, Diamond) / LGSTK00115
Status: Open | Opened: 2026-03-15 (50 days ago) | Last activity: 12 days ago
Last offer: $280 | Our price: $315 | Quote: QTE00001

Messages (4):
  2026-03-15 [outbound/email] Sent initial quote at $315.
  2026-03-22 [inbound/email] Customer said they'd check with their buyer, seemed interested.
  2026-03-28 [outbound/call] Followed up, no answer.
  2026-04-22 [inbound/email] Counter-offered $280, mentioned competitor has similar for $270.

--- LLM Summary ---
[LLM output when --model is set]
```

### Batch (`--all-open`)

```
14 open negotiation threads — avg 18 days open, 6 neglected 7+ days

| Thread | Customer | Tier | Stock | Days Open | Last Activity | Last Offer | Status |
|---|---|---|---|---|---|---|---|
| THRD00042 | Blue Star B1 | Diamond | LGSTK00115 | 50 | 12d ago | $280 | Open |
```

## How to present to the user

1. Run the script and echo the thread header.
2. Show all messages chronologically.
3. If `--model` was used, display the LLM summary verbatim under `--- LLM Summary ---`.
4. For batch mode, show the summary line and the table sorted by `Last Activity` descending.
5. Flag threads with `Last Activity > 7 days` as potentially stale.
6. After showing the recommended next action, **pause and ask the user to confirm** before they act on it:
   > "The recommended action is: [action]. Confirm you'd like to proceed, or adjust the approach?"
   This skill recommends — the rep decides and acts.
7. Never reveal internal cost or margin fields to customers.
