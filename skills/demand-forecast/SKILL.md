---
name: demand-forecast
description: Demand forecast and sourcing advisor for a lab-grown diamond wholesaler. Compares current available inventory against forecast demand to find sourcing gaps. Use when the user says "what should we source more of", "sourcing gaps", "demand forecast", "what categories are understocked", "show me the forecast", "inventory coverage", or "what's selling next month".
---

# Demand Forecast & Sourcing Advisor

Analyzes forecast demand vs current available inventory to surface **sourcing gaps** — categories where available stock falls short of what the market is projected to need.

## When to trigger

- "What should we be sourcing more of?"
- "Show me the sourcing gaps."
- "What categories are understocked?"
- "Run the demand forecast."
- "What's selling next month?"
- "Show me inventory coverage against the forecast."
- "Where are we short on inventory?"

Do **not** trigger on:
- Questions about pricing (use Skill 6 — Weekly Repricing).
- Questions about aging stones (use Skill 5 — Inventory Aging Triage).
- CLV or broker value questions (use Skill 3 — CLV).

## Inputs the script needs

The script reads three CSVs from `data/Milestone_2/` automatically. No user data entry is needed beyond optional flags.

| User says | Map to flag |
| --- | --- |
| "only show rounds" / "just ovals" | `--category-contains "Round"` |
| "top 10 gaps" | `--top 10` |
| "only confident forecasts" | `--min-confidence 0.7` |
| "explain it" / "give me recommendations" | `--model api-llama-4-scout` |
| "give me JSON" / "for the next step" | `--json` |
| "save the charts" | `--chart-out forecast_chart` |

## How to run

From the repo root:

```bash
# Standard sourcing gap report
uv run python skills/demand-forecast/scripts/demand_forecast.py

# With LLM sourcing recommendations
uv run python skills/demand-forecast/scripts/demand_forecast.py \
    --model api-llama-4-scout

# Filter to round diamonds only
uv run python skills/demand-forecast/scripts/demand_forecast.py \
    --category-contains "Round"

# Top 10 gaps with charts
uv run python skills/demand-forecast/scripts/demand_forecast.py \
    --top 10 --chart-out /tmp/forecast_chart

# JSON output for downstream tools
uv run python skills/demand-forecast/scripts/demand_forecast.py --json
```

## Output format

### Header line

```
Sourcing Gap Analysis — 2026-05-04
654 available stones across 87 categories | 227 forecast records
```

### Top sourcing priorities table

| Category | Available | Recommended | Gap | Demand | Growth % | Priority |
|---|---|---|---|---|---|---|
| Round \| 1.00-1.49 \| DEF \| VVS+ | 3 | 12 | 9 | 0.62 | +14.2% | HIGH |

### Coverage summary

```
Coverage summary: 23 categories fully covered | 41 understocked | 23 overstocked
```

## Charts

Two PNG files are saved when `--chart-out` is provided:

- `{base}_coverage.png` — Horizontal bar chart of top 15 categories by gap, showing available vs recommended
- `{base}_demand.png` — Scatter plot of coverage ratio vs demand score, sized by gap

## How to present to the user

1. Run the script with flags inferred from the user's message.
2. Echo the header line and summary verbatim.
3. Show the table as markdown.
4. If narration was requested, show it as bullets **after** the table.
5. For **HIGH priority** gaps, note that sourcing decisions of this scale require budget sign-off:
   > "HIGH priority gaps above suggest immediate sourcing action. Confirm with your sourcing team or budget owner before committing to purchases."
6. Do not make any sourcing commitments on the user's behalf — this skill is advisory only.
