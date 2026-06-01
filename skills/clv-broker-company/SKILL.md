---
name: clv-broker-company
description: Customer Lifetime Value calculator for a lab-grown diamond wholesaler — at both broker level (rolls up all companies that buy through the broker) and company level (individual end-buyer). Use when the user asks about CLV, lifetime value, "how much is X worth", "who are our most valuable customers", "top brokers by value", or "which companies should we protect". Also use when the user gives a specific broker or company ID and wants a value estimate. Do NOT use for stone pricing (use Skill 6) or memo approvals (use Skill 1).
---

# CLV Calculator — Broker + Company

Computes Customer Lifetime Value at two levels using actual sales history:
- **Broker** — aggregates all transactions where `broker_id` matches, covering both the broker's own direct purchases and any companies buying through them. Shows a per-company breakdown.
- **Company** — aggregates transactions where `customer_id` matches the company.

The CLV formula is the same discounted cash-flow model as the generic CLV skill. Inputs are **derived automatically** from the sales ledger and customer table — no manual entry needed.

## When to trigger

- "What's broker B0007's CLV?" / "How much is CUST0003 worth?"
- "Show CLV for company CUST0042."
- "Which brokers are most valuable?" / "Top 10 brokers by lifetime value."
- "Which 5 companies should we protect most?"
- "Why did broker CUST0001's CLV drop?" (run `--broker CUST0001` and check churn / months active)

## Inputs the script needs

The script reads `customers_seed.csv` and `sales_transactions_seed.csv` automatically. You only need to ask the user for:

| User says | Map to flag |
|---|---|
| "broker CUST0007" / "broker B7" | `--broker CUST0007` |
| "company CUST0042" | `--company CUST0042` |
| "top 10 brokers" | `--top-brokers 10` |
| "top 20 companies" | `--top-companies 20` |
| "use 48-month horizon" | `--time-horizon 48` |
| "explain it" / "narrate" | `--model api-llama-4-scout` |
| "give me JSON" | `--json` |

Defaults: 36-month horizon, 0.8% monthly discount rate.

## How to run

From the repo root with `.venv` activated:

```bash
source .venv/bin/activate

# Single broker with company breakdown
uv run python skills/clv-broker-company/scripts/clv_broker_company.py \
    --broker CUST0001

# Single company
uv run python skills/clv-broker-company/scripts/clv_broker_company.py \
    --company CUST0042

# Top 10 brokers
uv run python skills/clv-broker-company/scripts/clv_broker_company.py \
    --top-brokers 10

# Top 20 companies with narration
uv run python skills/clv-broker-company/scripts/clv_broker_company.py \
    --top-companies 20 --model api-llama-4-scout

# 48-month horizon, specific broker, JSON output
uv run python skills/clv-broker-company/scripts/clv_broker_company.py \
    --broker CUST0003 --time-horizon 48 --json
```

## How CLV inputs are derived

| CLV input | Derived from |
|---|---|
| `monthly_revenue` | `sum(gross_profit) / months_active` (avg monthly gross profit) |
| `service_cost` | 0 — gross_profit already nets out cost |
| `transaction_frequency` | 1 (already embedded in monthly_revenue) |
| `churn_rate` | `churn_risk_pct / 100` from `customers_seed.csv` |
| `discount_rate` | 0.008 (0.8 %/month default, overridable) |
| `time_horizon` | 36 months default, overridable |
| `churn_assumption` | optimistic (churn at end of month) |
| `discount_assumption` | pessimistic (paid at end of month) |

`months_active` = days from first sale to today ÷ 30.44 (minimum 1).

## Output format

### Single entity

```
**Blue Star Jewels B1** (`CUST0001`) — Broker
CLV (36mo): **$1,842,300**
Avg monthly gross profit: $68,600
Transactions: 25 over 84 months
Churn rate: 11.0% / month | Discount rate: 0.80% / month
Sales range: 2018-09-15 → 2026-04-28
```

If narration requested, a 2–3 sentence LLM summary follows.

### Broker view — company breakdown table

```
Companies under Blue Star Jewels B1:
| ID | Name | CLV | Avg Mo. Profit | Txns | Mo. Active | Churn % |
|...
```

### Ranking table (top-N)

```
Top 10 brokers by CLV (out of 30):
| ID | Name | CLV | Avg Mo. Profit | Txns | Mo. Active | Churn % |
|...
```

## How to present to the user

1. Run the script with flags inferred from the user's request.
2. For a single entity: show the `format_single` output, then the company breakdown table if it's a broker.
3. For a ranking: show the header line + table.
4. If narration was requested, show it as a short paragraph before the table.
5. If the user asks "why did CLV drop?", look at `avg_monthly_profit` and `churn_rate` — those are the two main levers.
6. Keep currency to `$X,XXX` (no decimals) and percentages to one decimal.

## Caveats to mention if relevant

- CLV is a **forward-looking estimate**. It uses historical average gross profit and the customer's churn risk score — both can change.
- Entities with fewer than 3 transactions have very noisy estimates.
- Negative `avg_monthly_profit` (net loss on the account) produces a near-zero or negative CLV — flag for the desk.
