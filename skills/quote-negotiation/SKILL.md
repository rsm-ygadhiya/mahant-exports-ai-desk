---
name: quote-negotiation
description: Quote and negotiation response agent for a lab-grown diamond wholesaler. When a customer counter-offers on a diamond quote, decides ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE and drafts the reply message. Use whenever the user says "how should we respond to this offer", "what should we counter at", "should we accept the customer's price", "review all negotiating quotes", "what's our floor on this stone", or "draft a reply to the counter-offer" — even if they don't use the word "negotiation" or "quote".
---

# Quote / Negotiation Response Agent

Evaluates active diamond quote negotiations and recommends ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE, then optionally drafts the customer reply.

## When to trigger

- "How should we respond to CUST0013's counter-offer on QTE00042?"
- "Review all our negotiating quotes."
- "Should we accept ${price} for {stone}?"
- "What's the minimum we can take on this stone?"
- "Draft a reply to the customer's counter-offer."

Do **not** trigger for: collection reminders (Skill 4), memo holds (Skill 1), or stone pricing/repricing (Skill 6).

## Decision rules

| Situation | Decision |
|---|---|
| Deal value > $50,000 | **ESCALATE** to senior manager |
| No customer counter yet | **HOLD** at current offer |
| Customer offer ≥ our asking price | **ACCEPT** |
| Customer offer ≥ max concession price (within CLV headroom) | **ACCEPT** |
| Customer offer ≥ floor price (above floor, below headroom) | **COUNTER** at max concession |
| Customer offer < floor price | **WALK_AWAY** |

## Price anatomy

```
list_price
    └── offered_price     ← what we sent (after base/volume/payment discounts)
         └── max_concession_price ← our best offer (offered × (1 − headroom))
              └── floor_price     ← cost_basis × 1.08 (8% minimum margin)
```

## Discount headroom by CLV tier

| Tier | Additional headroom off current offer |
|---|---|
| Diamond | 5.0% |
| Gold | 3.0% |
| Silver | 1.5% |
| New | 0.5% |

**Adjustments:**
- High demand category (score ≥ 0.65): −1% headroom (stone is hot, don't over-discount)
- Low demand category (score < 0.35): +1% headroom (willing to move slow-movers)
- High churn risk (> 30%): +0.5% headroom (retain the customer)

## Inputs the script needs

| User says | Map to flag |
|---|---|
| "quote QTE00042" | `--quote QTE00042` |
| "all negotiating quotes" | `--all-negotiating` |
| "draft a reply" / "write the message" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |

## How to run

```bash
source .venv/bin/activate

# Single quote
uv run python skills/quote-negotiation/scripts/quote_negotiation.py \
    --quote QTE00001

# All negotiating quotes
uv run python skills/quote-negotiation/scripts/quote_negotiation.py \
    --all-negotiating

# With LLM-drafted customer reply for COUNTER and WALK_AWAY cases
uv run python skills/quote-negotiation/scripts/quote_negotiation.py \
    --all-negotiating \
    --model api-llama-4-scout

# JSON output
uv run python skills/quote-negotiation/scripts/quote_negotiation.py \
    --all-negotiating --json

# Reproducible date
uv run python skills/quote-negotiation/scripts/quote_negotiation.py \
    --all-negotiating --today 2026-05-02
```

## Output format

### Single quote

```
**QTE00001** — LGSTK00115 — CUST0082 (Gold)
Decision: **COUNTER**
Reason: CUST0082 (Gold) offered $290, below our headroom floor of $305. Counter at $305 (22.1% margin, demand 0.48, headroom 3.0%). Going lower would breach our 8% floor.
Response price: $305
Offered: $315 | Customer offer: $290 | Floor: $270 | Max concession: $305 | Reliability: strong
```

### Batch (`--all-negotiating`)

```
214 negotiating quotes — ACCEPT: 87 | COUNTER: 63 | HOLD: 44 | WALK_AWAY: 18 | ESCALATE: 2

| Quote | Stock | Customer | Tier | Decision | Our Price | Customer Offer | Floor | Rec Price |
|---|---|---|---|---|---|---|---|---|
| QTE00001 | LGSTK00115 | CUST0082 | Gold | COUNTER | $315 | $290 | $270 | $305 |
```

## How to present to the user

1. Run the script and echo the header line.
2. Show the table as markdown.
3. For **COUNTER**: tell the user the recommended response price clearly. If `--model` was used, show the drafted reply, then **pause and ask for confirmation** before treating it as sent:
   > "The draft above is ready. Confirm you'd like to send this reply to [customer], or edit first?"
4. For **ACCEPT**: if `--model` was used, show the drafted acceptance reply, then **pause and ask for confirmation**:
   > "This will accept the deal at [price]. Confirm to close?"
5. For **WALK_AWAY**: if `--model` was used, show the warm close draft, then ask:
   > "This will mark the quote as Lost. Confirm to proceed?"
6. For **ESCALATE**: **stop immediately** — do not draft a customer reply. Display:
   > "⚠️ Deal value exceeds $50,000 — this requires **senior manager sign-off** before any response is sent to the customer. Route to your sales manager now. Do not reply until approved."
   Wait for the user to confirm escalation before doing anything else.
7. Never reveal `cost_basis`, `floor_price`, or `margin_pct` to customers — these are internal.
