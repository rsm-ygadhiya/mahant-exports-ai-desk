---
name: memo-approval
description: Memo approval assistant for a lab-grown diamond wholesaler. Evaluates broker/customer memo hold requests and decides APPROVE / APPROVE_WITH_CONDITIONS / REJECT based on stone availability, requester reliability, and opportunity cost. Use whenever the user says "should we approve this memo", "review pending memos", "is CUST0013 reliable for a memo", "approve memo MEMO00042", "what memos are pending", or "run the memo review" — even if they don't use the word "memo".
---

# Memo Approval Assistant

Auto-decides memo hold requests (broker borrows a stone to show a buyer) so the
desk no longer hand-picks who receives a stone. The HITL gate emits one of
**AUTO_APPROVE / NEEDS_REVIEW / AUTO_REJECT** by applying first-come (FIFO)
allocation plus two guardrails.

## When to trigger

- "Review all pending memo requests."
- "Who gets stone LGSTK00279?" / "Run the memo approval for MEMO00042."
- "Which memos auto-rejected today?"
- "What memos still need my manual review?"
- "Show me the memo decision for MEMO00001."

Do **not** trigger for: collection reminders (Skill 4), stone pricing (Skill 6), or quote negotiation (Skill 2).

## Decision rules (precedence order, per pending memo)

| # | Condition | Decision |
|---|---|---|
| 1 | Requester already received this stone on a prior memo | **AUTO_REJECT** |
| 2 | Mid-CLV customer (`Gold` tier) requesting **>1** stone at once | **NEEDS_REVIEW** |
| 3 | Earliest pending request for the stone (FIFO winner) | **AUTO_APPROVE** |
| 4 | Stone already allocated to an earlier request (FIFO loser) | **AUTO_REJECT** |

Higher rule wins: an already-received request is rejected even if the customer is
also a mid-CLV multi-requester. **NEEDS_REVIEW is the only case left for a human.**

### Definitions

- **Already received** — a non-pending memo for the same `(customer_id, stock_id)`
  with decision `Approved`/`ApprovedWithConditions`, or `closed_outcome == Sold`.
- **FIFO order** — pending requests are sorted by `request_date` (now timestamped
  to the second, simulating arrivals over time). The earliest auto-eligible
  request for a stone wins; later ones are rejected. Requests pulled into
  `NEEDS_REVIEW` sit out of the auto pipeline until a human decides.
- **Mid CLV** — the `Gold` `clv_tier` (Diamond = high, Silver/New = low).
  Configurable via `MID_CLV_TIERS` in the script.

## Inputs the script needs

All data comes from two CSVs: `memos_seed.csv` (with timestamped `request_date`)
and `customers_seed.csv` (for `clv_tier`).

| User says | Map to flag |
|---|---|
| "memo MEMO00042" | `--memo MEMO00042` |
| "all pending memos" | `--all-pending` |
| "narrate the decisions" / "explain it" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |

## How to run

```bash
source .venv/bin/activate

# Decide a single memo
uv run python skills/memo-approval/scripts/memo_approval.py \
    --memo MEMO00001

# Auto-decide all pending memos
uv run python skills/memo-approval/scripts/memo_approval.py \
    --all-pending

# Add LLM narration for the review/reject cases
uv run python skills/memo-approval/scripts/memo_approval.py \
    --all-pending \
    --model api-llama-4-scout

# JSON output
uv run python skills/memo-approval/scripts/memo_approval.py \
    --all-pending --json

# Override today's date
uv run python skills/memo-approval/scripts/memo_approval.py \
    --all-pending --today 2026-05-26
```

## Output format

### Single memo

```
**MEMO00080** — LGSTK00279 — CUST0074 (Silver)
Decision: **AUTO_REJECT**
Reason: LGSTK00279 already allocated via FIFO to earlier request MEMO00009 (arrived 2025-11-03T14:33:33Z). Auto-rejected.
Arrived: 2025-11-05T13:20:40Z | FIFO rank: 2 | Marketplace lock: NOT fired
```

### Batch (`--all-pending`)

```
55 pending memos auto-decided — AUTO_APPROVE: 38 | NEEDS_REVIEW: 9 | AUTO_REJECT: 8

| Memo | Stock | Customer | Tier | Arrived | Decision | Lock |
|---|---|---|---|---|---|---|
| MEMO00009 | LGSTK00279 | CUST0074 | Silver | 2025-11-03T14:33:33Z | AUTO_APPROVE | ✓ |
```

## How to present to the user

1. Run with appropriate flags and echo the header line.
2. Show the table as markdown.
3. For **AUTO_REJECT** decisions, highlight the blocking reason (already received vs. lost the FIFO race).
4. For **NEEDS_REVIEW** (mid-CLV customer asking for multiple stones), this is the only thing left for the desk to decide by hand — list those memos clearly and ask the user which stone(s), if any, to grant. Do not mark them approved without an explicit decision.
5. For **AUTO_APPROVE** decisions, note that `marketplace_lock_fired: true` locks the stone from all other offers immediately. These are granted automatically in FIFO order — surface them so the desk is aware, but no manual confirmation is required.
