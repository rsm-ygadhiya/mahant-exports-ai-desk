"""Memo Approval Assistant — Skill 1.

When a broker/buyer requests a memo hold on a stone, decide:
  APPROVE / APPROVE_WITH_CONDITIONS / REJECT

Three signal groups drive the decision:
  1. Stone state   — available? triage tag? age? category demand?
  2. Requester     — memo conversion rate, payment behavior, open memos count.
  3. Opportunity   — demand score for the category (high demand = higher opp cost).

The math lives here. Orchestration (which memo to review, how to present the
output) lives in ``../SKILL.md``.

Public API
----------
- ``score_requester(customer_id, memos, payment_history)`` → ReliabilityScore
- ``score_opportunity(stock_id, inventory, demand, triage_tags)`` → OpportunityScore
- ``decide_memo(memo_row, inventory, memos, payment_history, demand, customers,
                triage_tags, today)`` → MemoDecision
- ``review_pending(memos, inventory, payment_history, demand, customers,
                   triage_tags, today)`` → list[MemoDecision]

CLI
---
  python memo_approval.py --memo MEMO00001
  python memo_approval.py --all-pending
  python memo_approval.py --all-pending
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Iterable, NamedTuple

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"

DECISIONS = ("APPROVE", "APPROVE_WITH_CONDITIONS", "REJECT")

# Demand thresholds for opportunity cost.
_HIGH_DEMAND = 0.65
_LOW_DEMAND  = 0.40

# Reliability thresholds.
_HIGH_RELIABILITY = 65
_LOW_RELIABILITY  = 35

# Max concurrent open memos before we add a condition.
_MAX_OPEN_MEMOS = 3


# ---------------------------------------------------------------------------
# Score data classes
# ---------------------------------------------------------------------------


class ReliabilityScore(NamedTuple):
    score: int           # 0–100
    conversion_rate: float  # fraction of closed memos that became sales
    late_payment_rate: float  # fraction of payments that were Late
    open_memos: int      # currently open (approved, not closed) memos
    total_closed_memos: int
    notes: list[str]     # human-readable signal labels


class OpportunityScore(NamedTuple):
    score: int           # 0–100  (higher = more opportunity cost = be more careful)
    demand_score: float
    triage_tag: str | None
    age_days: int
    stone_status: str
    notes: list[str]


class MemoDecision(NamedTuple):
    memo_id: str
    stock_id: str
    customer_id: str
    broker_id: str
    requested_hold_days: int
    decision: str        # APPROVE / APPROVE_WITH_CONDITIONS / REJECT
    reason: str          # 2–4 sentence explanation
    condition_min_price: float | None
    condition_max_hold_days: int | None
    marketplace_lock_fired: bool
    reliability_score: int
    opportunity_score: int


# ---------------------------------------------------------------------------
# Requester reliability
# ---------------------------------------------------------------------------


def score_requester(
    customer_id: str,
    memos: pl.DataFrame,
    payment_history: pl.DataFrame,
) -> ReliabilityScore:
    """Score requester reliability 0–100.

    Components (each 0–100, combined with weights):
    - Memo conversion rate (50%): Sold / closed_memos.
    - Payment behavior (30%): fraction of payments that are OnTime or Early.
    - Open memos penalty (20%): fewer concurrent holds = better.
    """
    notes: list[str] = []

    # ── Memo conversion ──────────────────────────────────────────────────
    past = memos.filter(
        (pl.col("customer_id") == customer_id)
        | (pl.col("broker_id") == customer_id)
    )
    closed = past.filter(
        pl.col("closed_outcome").is_not_null()
        & (pl.col("closed_outcome") != "")
    )
    sold = past.filter(pl.col("closed_outcome") == "Sold")
    total_closed = len(closed)
    conversion_rate = float(len(sold)) / total_closed if total_closed > 0 else 0.5
    # New customers get a neutral 0.5 by default.
    if total_closed == 0:
        notes.append("no memo history — neutral score")
    else:
        notes.append(f"memo conversion {len(sold)}/{total_closed} = {conversion_rate:.0%}")

    conv_score = int(conversion_rate * 100)

    # ── Payment behavior ─────────────────────────────────────────────────
    cust_pay = payment_history.filter(pl.col("customer_id") == customer_id)
    if cust_pay.is_empty():
        pay_score = 70  # no history → assume decent
        late_rate = 0.0
        notes.append("no payment history — neutral score")
    else:
        late = cust_pay.filter(pl.col("payment_behavior_label") == "Late")
        late_rate = len(late) / len(cust_pay)
        pay_score = int((1.0 - late_rate) * 100)
        notes.append(f"payment: {late_rate:.0%} late ({len(late)}/{len(cust_pay)})")

    # ── Open memos count ─────────────────────────────────────────────────
    open_memos = past.filter(
        pl.col("decision").is_in(["Approved", "ApprovedWithConditions"])
        & (pl.col("closed_outcome").is_null() | (pl.col("closed_outcome") == ""))
    )
    n_open = len(open_memos)
    if n_open >= _MAX_OPEN_MEMOS:
        open_score = max(0, 100 - (n_open - _MAX_OPEN_MEMOS + 1) * 20)
        notes.append(f"{n_open} open memos already — capacity concern")
    else:
        open_score = 100
        if n_open > 0:
            notes.append(f"{n_open} open memo(s) currently")

    # ── Combine ───────────────────────────────────────────────────────────
    score = int(conv_score * 0.50 + pay_score * 0.30 + open_score * 0.20)
    return ReliabilityScore(
        score=score,
        conversion_rate=conversion_rate,
        late_payment_rate=late_rate,
        open_memos=n_open,
        total_closed_memos=total_closed,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Opportunity cost
# ---------------------------------------------------------------------------


def score_opportunity(
    stock_id: str,
    inventory: pl.DataFrame,
    demand: pl.DataFrame,
    triage_tags: dict[str, str] | None = None,
    demand_window_days: int = 60,
    today: dt.date | None = None,
) -> OpportunityScore:
    """Score opportunity cost of memo'ing this stone (0 = free, 100 = very costly).

    High score = hot stone, high demand, young → be careful about memos.
    Low score  = slow-mover, CLEAR/DISCOUNT tag, old → happy to memo.
    """
    if today is None:
        today = dt.date.today()

    notes: list[str] = []
    stone = inventory.filter(pl.col("stock_id") == stock_id)

    if stone.is_empty():
        return OpportunityScore(
            score=100, demand_score=0.5, triage_tag=None,
            age_days=0, stone_status="Unknown",
            notes=["stone not found in inventory"],
        )

    row = stone.to_dicts()[0]
    status = row["status"]
    age_days = int(row["age_in_stock_days"])
    category = row["category_simple"]

    # ── Stone availability (hard signal) ─────────────────────────────────
    if status != "Available":
        return OpportunityScore(
            score=100, demand_score=0.5, triage_tag=None,
            age_days=age_days, stone_status=status,
            notes=[f"stone is {status} — not available for memo"],
        )

    # ── Demand signal ─────────────────────────────────────────────────────
    cutoff = today - dt.timedelta(days=demand_window_days)
    recent_demand = (
        demand.with_columns(pl.col("signal_date").str.to_date())
        .filter(
            (pl.col("category_simple") == category)
            & (pl.col("signal_date") >= cutoff)
        )
    )
    if recent_demand.is_empty():
        demand_score = 0.5
        notes.append("no recent demand signal — neutral")
    else:
        demand_score = float(recent_demand["demand_score"].mean())
        notes.append(f"category demand {demand_score:.2f}")

    if demand_score >= _HIGH_DEMAND:
        demand_component = 80
        notes.append("high demand → elevated opportunity cost")
    elif demand_score < _LOW_DEMAND:
        demand_component = 20
        notes.append("weak demand → low opportunity cost")
    else:
        demand_component = 50

    # ── Triage tag ────────────────────────────────────────────────────────
    tag = (triage_tags or {}).get(stock_id)
    if tag == "CLEAR":
        tag_component = 10
        notes.append("CLEAR tag → push it out, memo welcome")
    elif tag == "DISCOUNT":
        tag_component = 25
        notes.append("DISCOUNT tag → aging stone, memo acceptable")
    elif tag == "HOLD":
        tag_component = 80
        notes.append("HOLD tag → active stone, memo has opportunity cost")
    else:
        tag_component = 50  # WATCH or unknown

    # ── Age component ─────────────────────────────────────────────────────
    if age_days >= 180:
        age_component = 10
        notes.append(f"very old ({age_days}d) → low opportunity cost")
    elif age_days >= 90:
        age_component = 30
    else:
        age_component = 70
        notes.append(f"young stone ({age_days}d) → higher opportunity cost")

    score = int(demand_component * 0.50 + tag_component * 0.30 + age_component * 0.20)
    return OpportunityScore(
        score=score,
        demand_score=demand_score,
        triage_tag=tag,
        age_days=age_days,
        stone_status=status,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Decision engine
# ---------------------------------------------------------------------------


def decide_memo(
    memo_row: dict,
    inventory: pl.DataFrame,
    memos: pl.DataFrame,
    payment_history: pl.DataFrame,
    demand: pl.DataFrame,
    customers: pl.DataFrame,
    triage_tags: dict[str, str] | None = None,
    today: dt.date | None = None,
) -> MemoDecision:
    """Produce a decision for one pending memo request."""
    if today is None:
        today = dt.date.today()

    memo_id   = memo_row["memo_id"]
    stock_id  = memo_row["stock_id"]
    customer_id = memo_row["customer_id"]
    broker_id   = memo_row["broker_id"] or customer_id
    req_days  = int(memo_row["requested_hold_days"] or 7)

    # Stone opportunity cost check first (includes availability gate).
    opp = score_opportunity(stock_id, inventory, demand,
                            triage_tags=triage_tags, today=today)
    rel = score_requester(customer_id, memos, payment_history)

    # Customer metadata for pricing floor reference.
    stone_row = inventory.filter(pl.col("stock_id") == stock_id)
    current_price = float(stone_row["p_pcs"][0]) if not stone_row.is_empty() else 0.0
    cost_basis    = float(stone_row["cost_basis"][0]) if not stone_row.is_empty() else 0.0
    min_safe_price = round(cost_basis * 1.05, 2)

    # ── Hard REJECT: stone not available ─────────────────────────────────
    if opp.stone_status != "Available":
        return MemoDecision(
            memo_id=memo_id, stock_id=stock_id,
            customer_id=customer_id, broker_id=broker_id,
            requested_hold_days=req_days,
            decision="REJECT",
            reason=(
                f"Stone {stock_id} is currently {opp.stone_status} and cannot be placed on memo. "
                "Please check availability before resubmitting."
            ),
            condition_min_price=None, condition_max_hold_days=None,
            marketplace_lock_fired=False,
            reliability_score=rel.score,
            opportunity_score=opp.score,
        )

    # ── Hard REJECT: very unreliable requester ────────────────────────────
    if rel.score < _LOW_RELIABILITY:
        reason_parts = [
            f"Memo request from {customer_id} declined due to low reliability score ({rel.score}/100)."
        ]
        if rel.late_payment_rate > 0.5:
            reason_parts.append(
                f"Payment history shows {rel.late_payment_rate:.0%} late payments."
            )
        if rel.conversion_rate < 0.2 and rel.total_closed_memos >= 3:
            reason_parts.append(
                f"Only {rel.conversion_rate:.0%} of past memos converted to sales "
                f"({rel.total_closed_memos} closed total)."
            )
        return MemoDecision(
            memo_id=memo_id, stock_id=stock_id,
            customer_id=customer_id, broker_id=broker_id,
            requested_hold_days=req_days,
            decision="REJECT",
            reason=" ".join(reason_parts),
            condition_min_price=None, condition_max_hold_days=None,
            marketplace_lock_fired=False,
            reliability_score=rel.score,
            opportunity_score=opp.score,
        )

    # ── APPROVE (clean) ───────────────────────────────────────────────────
    if rel.score >= _HIGH_RELIABILITY and opp.score < 60:
        return MemoDecision(
            memo_id=memo_id, stock_id=stock_id,
            customer_id=customer_id, broker_id=broker_id,
            requested_hold_days=req_days,
            decision="APPROVE",
            reason=(
                f"Stone {stock_id} is available with low opportunity cost "
                f"(demand {opp.demand_score:.2f}, age {opp.age_days}d). "
                f"{customer_id} has strong reliability ({rel.score}/100, "
                f"conversion {rel.conversion_rate:.0%}). "
                f"Approved for {req_days}-day hold. Marketplace lock fired."
            ),
            condition_min_price=None, condition_max_hold_days=None,
            marketplace_lock_fired=True,
            reliability_score=rel.score,
            opportunity_score=opp.score,
        )

    # ── APPROVE_WITH_CONDITIONS ────────────────────────────────────────────
    conditions: list[str] = []
    cond_hold = None
    cond_price = None

    # High opportunity cost → shorten the hold.
    # Threshold 60 matches the APPROVE boundary so every APPROVE_WITH_CONDITIONS
    # case triggers at least a hold reduction or a price floor.
    if opp.score >= 60:
        cond_hold = min(req_days, 3)
        conditions.append(f"maximum hold reduced to {cond_hold} days (high-demand stone)")

    # Moderate reliability or many open memos → add a price floor.
    if rel.score < _HIGH_RELIABILITY or rel.open_memos >= _MAX_OPEN_MEMOS:
        cond_price = max(min_safe_price, round(current_price * 0.97, 2))
        conditions.append(
            f"minimum purchase price of ${cond_price:,.0f} "
            f"(reliability score {rel.score}/100)"
        )

    reason = (
        f"Stone {stock_id} approved with conditions for {customer_id} "
        f"(reliability {rel.score}/100, opportunity cost {opp.score}/100). "
        f"Conditions: {'; '.join(conditions)}. "
        f"Marketplace lock fired pending acceptance of conditions."
    )
    return MemoDecision(
        memo_id=memo_id, stock_id=stock_id,
        customer_id=customer_id, broker_id=broker_id,
        requested_hold_days=req_days,
        decision="APPROVE_WITH_CONDITIONS",
        reason=reason,
        condition_min_price=cond_price,
        condition_max_hold_days=cond_hold,
        marketplace_lock_fired=True,
        reliability_score=rel.score,
        opportunity_score=opp.score,
    )


# ---------------------------------------------------------------------------
# Batch review of all pending memos
# ---------------------------------------------------------------------------


def review_pending(
    memos: pl.DataFrame,
    inventory: pl.DataFrame,
    payment_history: pl.DataFrame,
    demand: pl.DataFrame,
    customers: pl.DataFrame,
    triage_tags: dict[str, str] | None = None,
    today: dt.date | None = None,
) -> list[MemoDecision]:
    """Process every Pending memo and return a list of MemoDecision objects."""
    if today is None:
        today = dt.date.today()

    pending = memos.filter(pl.col("decision") == "Pending")
    results = []
    for row in pending.iter_rows(named=True):
        decision = decide_memo(
            row, inventory, memos, payment_history,
            demand, customers, triage_tags, today,
        )
        results.append(decision)
    return results


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_decision(d: MemoDecision) -> str:
    lines = [
        f"**{d.memo_id}** — {d.stock_id} — {d.customer_id}",
        f"Decision: **{d.decision}**",
        f"Reason: {d.reason}",
    ]
    if d.condition_min_price is not None:
        lines.append(f"Min price: ${d.condition_min_price:,.0f}")
    if d.condition_max_hold_days is not None:
        lines.append(f"Max hold: {d.condition_max_hold_days} days")
    lines.append(
        f"Scores: reliability={d.reliability_score}/100, "
        f"opportunity={d.opportunity_score}/100 | "
        f"Marketplace lock: {'fired' if d.marketplace_lock_fired else 'NOT fired'}"
    )
    return "\n".join(lines)


def format_batch(decisions: list[MemoDecision]) -> str:
    if not decisions:
        return "_(no pending memos)_"
    counts = {d: 0 for d in DECISIONS}
    for dec in decisions:
        counts[dec.decision] = counts.get(dec.decision, 0) + 1
    header = (
        f"{len(decisions)} pending memos reviewed — "
        f"APPROVE: {counts['APPROVE']} | "
        f"CONDITIONS: {counts['APPROVE_WITH_CONDITIONS']} | "
        f"REJECT: {counts['REJECT']}"
    )
    rows = ["| Memo | Stock | Customer | Decision | Rel | Opp | Lock |",
            "|---|---|---|---|---|---|---|"]
    for d in decisions:
        rows.append(
            f"| {d.memo_id} | {d.stock_id} | {d.customer_id} | {d.decision} "
            f"| {d.reliability_score} | {d.opportunity_score} "
            f"| {'✓' if d.marketplace_lock_fired else '✗'} |"
        )
    return header + "\n\n" + "\n".join(rows)


# ---------------------------------------------------------------------------
# Deterministic explanation (no LLM)
# ---------------------------------------------------------------------------


def narrate_decision(decision: MemoDecision) -> str:
    """Compose a plain-English rationale from the decision's signals."""
    parts = [
        f"{decision.memo_id}: {decision.decision}. "
        f"Reliability {decision.reliability_score}/100, "
        f"opportunity cost {decision.opportunity_score}/100."
    ]
    parts.append(f"Machine reason: {decision.reason}")
    if decision.decision == "APPROVE_WITH_CONDITIONS":
        parts.append("Attach a min-price floor and a short hold window in the memo terms.")
    elif decision.decision == "REJECT":
        parts.append("Suggest the requester improve payment history or switch to a less-contested stone.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        "memos": pl.read_csv(data_dir / "memos_seed.csv"),
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "payment_history": pl.read_csv(data_dir / "payment_history_seed.csv"),
        "demand": pl.read_csv(data_dir / "demand_signals_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Memo approval assistant.")
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--memo", metavar="ID", help="Review one memo by ID.")
    mode.add_argument("--all-pending", action="store_true",
                      help="Review all Pending memos.")

    p.add_argument("--triage-json", type=Path, default=None,
                   help="JSON from Skill 5 --json output to supply triage tags.")
    p.add_argument("--today", type=lambda s: dt.date.fromisoformat(s), default=None)
    p.add_argument("--json", action="store_true")
    return p


def _load_triage(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    rows = json.loads(path.read_text())
    return {r["stock_id"]: r["action_tag"] for r in rows if "action_tag" in r}


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    today = args.today or dt.date.today()
    triage = _load_triage(args.triage_json)

    if args.all_pending:
        decisions = review_pending(
            csvs["memos"], csvs["inventory"], csvs["payment_history"],
            csvs["demand"], csvs["customers"], triage or None, today,
        )
        if args.json:
            print(json.dumps([d._asdict() for d in decisions], default=str))
            return 0
        print(format_batch(decisions))
        if decisions:
            # Show the rule-based rationale for the most interesting cases.
            interesting = [d for d in decisions
                           if d.decision in ("APPROVE_WITH_CONDITIONS", "REJECT")][:3]
            for d in interesting:
                print()
                print(f"---\n{format_decision(d)}")
                print(narrate_decision(d))
    else:
        memo_row = (
            csvs["memos"].filter(pl.col("memo_id") == args.memo)
            .to_dicts()
        )
        if not memo_row:
            print(f"Memo {args.memo} not found.", file=sys.stderr)
            return 1
        decision = decide_memo(
            memo_row[0], csvs["inventory"], csvs["memos"],
            csvs["payment_history"], csvs["demand"],
            csvs["customers"], triage or None, today,
        )
        if args.json:
            print(json.dumps(decision._asdict(), default=str))
            return 0
        print(format_decision(decision))
        print()
        print(narrate_decision(decision))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
