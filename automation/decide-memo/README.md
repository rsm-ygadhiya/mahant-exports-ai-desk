# Automation — `decide-memo`

**Workflow step 4 of 4.** Reviews every pending memo (consignment)
request and routes it at **decision point B** into one of three
buckets: `auto_approve` / `auto_reject` / `needs_review`.

> History: this step was originally an LLM-judgement **skill** under
> `skills/decide-memo/` in the M14 submission (with an LLM-written
> 1-2 sentence justification per memo). We refactored it to a fully
> deterministic rule-based router with a Python-generated rationale
> and moved the folder to `automations/` so the split matches the
> reference rule (skills = LLM, automations = deterministic).

## Why this is a non-GenAI automation

Two of the three signals (reliability score, opportunity score) are
already deterministic functions of the requester's payment history and
the stone's market position. The third signal (the routing decision
itself) is a clean rule against the CLV tier + triage tag + the two
scores. The plain-English `rationale` is composed from the same numeric
signals using templated clauses — re-running the same memo produces
byte-identical output. There is no free-text input that would benefit
from natural-language understanding; broker notes attached to a memo
are handled separately by the Mahant `negotiation-threads` skill.

## Reads

| Source CSV | Columns used |
| --- | --- |
| `data/raw/memos_seed.csv`             | `memo_id`, `customer_id`, `broker_id`, `stock_id`, `requested_hold_days`, `decision`, `closed_outcome`, `request_date` |
| `data/raw/inventory_seed.csv`         | `stock_id`, `status`, `age_in_stock_days`, `category_simple`, `ppc` |
| `data/raw/payment_history_seed.csv`   | `customer_id`, `days_early_late`, `payment_behavior_label` (feeds reliability score) |
| `data/raw/demand_signals_seed.csv`    | `signal_date`, `category_simple`, `demand_score` (feeds opportunity score) |
| `data/raw/customers_seed.csv`         | `customer_id`, `customer_name`, `clv_tier`, `payment_score`, `churn_risk_pct` |
| `data/working/triage_decisions.csv`   | `stock_id`, `action_tag` — used in the `HOLD` gate |
| `data/working/clv_tiers.csv`          | `entity_id`, `tier` — used in the tier gate |

## Writes

`data/working/memo_decisions.csv` — one row per pending memo.

| Column | Type | Notes |
| --- | --- | --- |
| `workflow_run_id`, `step_id`, `ts` | string | from the orchestrator |
| `queue`              | enum   | `auto_approve` / `auto_reject` / `needs_review` |
| `route_reason`       | string | which gate sent it to this bucket |
| `memo_id`, `stock_id`, `customer_id`, `broker_id` | string | FKs |
| `tier`               | enum   | `Top` / `High` / `Mid` / `Low` / `Unknown` |
| `triage_tag`         | enum   | `HOLD` / `WATCH` / `DISCOUNT` / `CLEAR` / `` |
| `decision`           | enum   | `APPROVE` / `APPROVE_WITH_CONDITIONS` / `REJECT` |
| `reliability_score`  | int    | 0–100 |
| `opportunity_score`  | int    | 0–100 (higher = stone is more contested) |
| `reason`             | string | the scoring-engine's reason |
| `rationale`          | string | composed plain-English explanation |

Plus one envelope row appended to `data/working/workflow_action_log.csv`.

## Decision-point B (the gate)

```
auto_approve  iff decision == APPROVE
              AND tier in --auto-approve-tiers (default Top, High)
              AND triage_tag != HOLD
              AND opportunity_score <= --opp-ceiling (default 70)

auto_reject   iff decision == REJECT AND tier not in {Top, High}
              OR the requested stock_id is already on another active memo
                 (the "stone held by another customer" rule from KB-001)

needs_review  everything else (APPROVE_WITH_CONDITIONS, APPROVE that
              fails a gate, REJECT against a Top/High customer)
```

Defaults are tightened or loosened from the Mahant Scintilla settings
popover. Any non-empty `needs_review` queue sets `review_required=true`.

## Python helpers

Local (`scripts/_memo_core.py` + `scripts/decide_memo.py`):

| Function | Returns |
| --- | --- |
| `decide_memo(memo_row, inventory, memos, payments, demand, customers, triage_lookup, today)` | `MemoDecision` (`NamedTuple`) |
| `score_requester(...)` | `ReliabilityScore` |
| `score_opportunity(...)` | `OpportunityScore` |
| `_route(decision, tier, triage_tag, auto_tiers, opp_ceiling)` | `(queue, route_reason)` |
| `_build_rationale(decision, tier, triage_tag, auto_eligible, opp_ceiling)` | string |
| `narrate_decision(decision)` | rule-based one-liner (no LLM) |
| `format_decision(decision)` / `format_batch(decisions)` | human-readable |

Shared (`utils.pramukh_common`):
`Envelope`, `append_rows`, `audit_log`, `emit_envelope`, `make_skill_parser`, `parse_today`.

## M01 connection

**Step 12 — Sales, Export Documentation and Dispatch.** Replaces the
*"Concessions negotiated informally over WhatsApp and never formally
recorded"* line in the M01 process doc. Addresses pain point
**#4 Manual Pricing leakage** by turning the desk's most opaque
decision (memos / consignment) into a structured, auditable record.

Policy reference: [`rag/knowledge_base/KB-001-broker-memo-policy.md`](../../rag/knowledge_base/KB-001-broker-memo-policy.md).

## Run

```bash
# All pending memos
uv run python automations/decide-memo/scripts/decide_memo.py --json

# Single memo
uv run python automations/decide-memo/scripts/decide_memo.py \
    --memo-id MEMO00042 --json

# Tighter auto-approve gates (Top only, opp ≤ 50)
uv run python automations/decide-memo/scripts/decide_memo.py \
    --auto-approve-tiers Top --opp-ceiling 50 --json
```

## Envelope shape

```json
{
  "status": "ok",
  "skill_name": "decide-memo",
  "next_action": "done",
  "confidence": 1.0,
  "review_required": true,
  "artifact_refs": ["working/memo_decisions.csv"],
  "outputs": {
    "today": "2026-05-14",
    "memos_reviewed": 53,
    "auto_approved": 0,
    "auto_rejected": 22,
    "needs_review": 31,
    "rows_written": 53,
    "opp_ceiling": 70,
    "auto_tiers": ["Top", "High"]
  },
  "error": null
}
```
