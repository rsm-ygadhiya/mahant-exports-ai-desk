"""Memo Approval Assistant — Skill 1.

When a broker/buyer requests a memo hold on a stone, the desk no longer
hand-picks who gets it. The HITL gate auto-decides:

  AUTO_APPROVE   — granted automatically in FIFO (first-come) order.
  AUTO_REJECT    — requester already received this stone before, OR the
                   stone was already allocated (FIFO) to an earlier request.
  NEEDS_REVIEW   — the *only* case left for a human: a mid-CLV customer
                   asking for more than one stone at once.

Decision rules (in precedence order, per pending memo)
------------------------------------------------------
  1. (customer, stone) already received on a prior memo      → AUTO_REJECT
  2. mid-CLV customer with >1 concurrent stone request       → NEEDS_REVIEW
  3. FIFO winner for the stone (earliest request_date)        → AUTO_APPROVE
  4. FIFO loser (stone already taken by an earlier request)   → AUTO_REJECT

"Mid CLV" = the ``Mid`` CLV quartile — the project-wide canonical tiering
(Top / High / Mid / Low), shared with the CLV skill and the autopilot.

Public API
----------
- ``build_received_pairs(memos)`` → set[(customer_id, stock_id)]
- ``multi_request_customers(pending)`` → dict[customer_id, int]
- ``review_pending(memos, customers, today)`` → list[MemoDecision]
- ``decide_memo(memo_id, memos, customers, today)`` → MemoDecision | None

CLI
---
  python memo_approval.py --memo MEMO00001
  python memo_approval.py --all-pending
  python memo_approval.py --all-pending --model api-llama-4-scout
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

DECISIONS = ("AUTO_APPROVE", "NEEDS_REVIEW", "AUTO_REJECT")

# CLV tier(s) that count as "mid CLV" for the manual-review gate.
# Canonical tiering is the project-wide CLV quartile: Top / High / Mid / Low
# (see skills/clv-broker-company assign_quartile_tiers + automation/rank-customer-clv).
MID_CLV_TIERS = {"Mid"}

# A stone counts as "already received" if a prior memo reached one of these
# states (broker took possession) or the linked deal closed as Sold.
_RECEIVED_DECISIONS = {"Approved", "ApprovedWithConditions"}


# ---------------------------------------------------------------------------
# Decision record
# ---------------------------------------------------------------------------


class MemoDecision(NamedTuple):
    memo_id: str
    stock_id: str
    customer_id: str
    broker_id: str
    clv_tier: str
    request_ts: str            # ISO timestamp the request arrived (FIFO key)
    requested_hold_days: int
    decision: str              # AUTO_APPROVE / NEEDS_REVIEW / AUTO_REJECT
    reason: str
    fifo_rank: int | None      # 1 = first in line for the stone; None if N/A
    marketplace_lock_fired: bool


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------


def build_received_pairs(memos: pl.DataFrame) -> set[tuple[str, str]]:
    """Every (customer_id, stock_id) pair where the customer already received
    that stone on a prior (non-pending) memo."""
    prior = memos.filter(pl.col("decision") != "Pending")
    received = prior.filter(
        pl.col("decision").is_in(list(_RECEIVED_DECISIONS))
        | (pl.col("closed_outcome") == "Sold")
    )
    return {
        (r["customer_id"], r["stock_id"])
        for r in received.iter_rows(named=True)
    }


def multi_request_customers(pending: pl.DataFrame) -> dict[str, int]:
    """customer_id → number of *distinct* stones they have pending (only those
    requesting more than one)."""
    counts: dict[str, set[str]] = {}
    for r in pending.iter_rows(named=True):
        counts.setdefault(r["customer_id"], set()).add(r["stock_id"])
    return {c: len(s) for c, s in counts.items() if len(s) > 1}


def _tier_of(customer_id: str, customers: pl.DataFrame) -> str:
    """Resolve a customer's CLV tier from the customers frame.

    Prefers the canonical quartile ``tier`` column (Top/High/Mid/Low). Falls
    back to a legacy ``clv_tier`` column if that's all that's present.
    """
    row = customers.filter(pl.col("customer_id") == customer_id)
    if row.is_empty():
        return "Unknown"
    col = "tier" if "tier" in customers.columns else (
        "clv_tier" if "clv_tier" in customers.columns else None)
    return row[col][0] if col else "Unknown"


def canonical_tiers(
    sales: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
) -> dict[str, str]:
    """Compute the project-wide CLV quartile tier for every entity.

    Delegates to the CLV skill (single source of truth) so the memo gate buckets
    customers identically to the autopilot. Returns ``{entity_id: tier}`` for both
    company and broker levels (broker wins on conflict, matching the automation).
    """
    import importlib.util
    clv_path = (Path(__file__).resolve().parents[2]
                / "clv-broker-company" / "scripts" / "clv_broker_company.py")
    spec = importlib.util.spec_from_file_location("clv_broker_company", clv_path)
    clv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(clv)

    def _tiers(level: str) -> dict[str, str]:
        df = clv.compute_all_clv(level, sales, customers, today=today)
        return {r["entity_id"]: r["tier"] for r in df.iter_rows(named=True)}

    return {**_tiers("company"), **_tiers("broker")}


def _parse_ts(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Decision engine
# ---------------------------------------------------------------------------


def review_pending(
    memos: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
    tiers: dict[str, str] | None = None,
) -> list[MemoDecision]:
    """Auto-decide every Pending memo using FIFO order + the HITL gate.

    ``tiers`` is an optional ``{entity_id: tier}`` lookup of canonical CLV
    quartile tiers (Top/High/Mid/Low). When supplied it is the source of truth
    for the mid-CLV gate (broker id preferred, then customer id); otherwise the
    tier is read off the ``customers`` frame.

    Returns decisions sorted by request timestamp (the order they arrived).
    """
    if today is None:
        today = dt.date.today()

    pending = memos.filter(pl.col("decision") == "Pending")
    if pending.is_empty():
        return []

    received = build_received_pairs(memos)
    multi = multi_request_customers(pending)

    def _tier(cust: str, broker: str) -> str:
        if tiers:
            return tiers.get(broker) or tiers.get(cust) or "Unknown"
        return _tier_of(cust, customers)

    # Sort all pending requests by arrival time so FIFO is well-defined.
    rows = sorted(pending.iter_rows(named=True), key=lambda r: _parse_ts(r["request_date"]))

    # First pass: classify; collect FIFO candidates per stone.
    prelim: dict[str, dict] = {}
    fifo_candidates: dict[str, list[dict]] = {}
    for r in rows:
        memo_id = r["memo_id"]
        cust = r["customer_id"]
        stock = r["stock_id"]
        tier = _tier(cust, r.get("broker_id") or cust)
        ctx = {"row": r, "tier": tier}
        prelim[memo_id] = ctx

        if (cust, stock) in received:
            ctx["decision"] = "AUTO_REJECT"
            ctx["reason"] = (
                f"{cust} already received {stock} on a prior memo. "
                "Duplicate request auto-rejected."
            )
        elif tier in MID_CLV_TIERS and cust in multi:
            ctx["decision"] = "NEEDS_REVIEW"
            ctx["reason"] = (
                f"{cust} is mid-CLV ({tier}) and has {multi[cust]} concurrent "
                "stone requests — routed to manual HITL review."
            )
        else:
            # Eligible for FIFO allocation on this stone.
            fifo_candidates.setdefault(stock, []).append(r)

    # Second pass: FIFO allocate each contested stone.
    for stock, reqs in fifo_candidates.items():
        reqs.sort(key=lambda r: _parse_ts(r["request_date"]))
        winner = reqs[0]
        prelim[winner["memo_id"]].update(
            decision="AUTO_APPROVE",
            fifo_rank=1,
            reason=(
                f"FIFO winner: earliest request for {stock} "
                f"(arrived {winner['request_date']}). "
                f"Auto-approved for {winner['requested_hold_days']}-day hold; "
                "marketplace lock fired."
            ),
        )
        for rank, loser in enumerate(reqs[1:], start=2):
            prelim[loser["memo_id"]].update(
                decision="AUTO_REJECT",
                fifo_rank=rank,
                reason=(
                    f"{stock} already allocated via FIFO to earlier request "
                    f"{winner['memo_id']} (arrived {winner['request_date']}). "
                    "Auto-rejected."
                ),
            )

    # Build decision records in arrival order.
    out: list[MemoDecision] = []
    for r in rows:
        ctx = prelim[r["memo_id"]]
        decision = ctx["decision"]
        out.append(MemoDecision(
            memo_id=r["memo_id"],
            stock_id=r["stock_id"],
            customer_id=r["customer_id"],
            broker_id=r["broker_id"] or r["customer_id"],
            clv_tier=ctx["tier"],
            request_ts=r["request_date"],
            requested_hold_days=int(r["requested_hold_days"] or 7),
            decision=decision,
            reason=ctx["reason"],
            fifo_rank=ctx.get("fifo_rank"),
            marketplace_lock_fired=(decision == "AUTO_APPROVE"),
        ))
    return out


def decide_memo(
    memo_id: str,
    memos: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
    tiers: dict[str, str] | None = None,
) -> MemoDecision | None:
    """Decide a single memo by running the FIFO review over full context."""
    for d in review_pending(memos, customers, today, tiers=tiers):
        if d.memo_id == memo_id:
            return d
    return None


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_decision(d: MemoDecision) -> str:
    lines = [
        f"**{d.memo_id}** — {d.stock_id} — {d.customer_id} ({d.clv_tier})",
        f"Decision: **{d.decision}**",
        f"Reason: {d.reason}",
        f"Arrived: {d.request_ts}"
        + (f" | FIFO rank: {d.fifo_rank}" if d.fifo_rank is not None else "")
        + f" | Marketplace lock: {'fired' if d.marketplace_lock_fired else 'NOT fired'}",
    ]
    return "\n".join(lines)


def format_batch(decisions: list[MemoDecision]) -> str:
    if not decisions:
        return "_(no pending memos)_"
    counts = {d: 0 for d in DECISIONS}
    for dec in decisions:
        counts[dec.decision] = counts.get(dec.decision, 0) + 1
    header = (
        f"{len(decisions)} pending memos auto-decided — "
        f"AUTO_APPROVE: {counts['AUTO_APPROVE']} | "
        f"NEEDS_REVIEW: {counts['NEEDS_REVIEW']} | "
        f"AUTO_REJECT: {counts['AUTO_REJECT']}"
    )
    rows = ["| Memo | Stock | Customer | Tier | Arrived | Decision | Lock |",
            "|---|---|---|---|---|---|---|"]
    for d in decisions:
        rows.append(
            f"| {d.memo_id} | {d.stock_id} | {d.customer_id} | {d.clv_tier} "
            f"| {d.request_ts} | {d.decision} "
            f"| {'✓' if d.marketplace_lock_fired else '✗'} |"
        )
    return header + "\n\n" + "\n".join(rows)


# ---------------------------------------------------------------------------
# LLM narration (optional, single memo)
# ---------------------------------------------------------------------------


def narrate_decision(
    decision: MemoDecision,
    model: str = "api-llama-4-scout",
) -> str:
    """Ask an LLM to expand the decision reason into a polished explanation."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    prompt = (
        "You are a diamond wholesale desk assistant explaining an automated "
        "memo decision made by a FIFO + HITL gate.\n\n"
        f"Memo: {decision.memo_id}. Stone: {decision.stock_id}. "
        f"Requester: {decision.customer_id} (CLV tier {decision.clv_tier}).\n"
        f"Request arrived: {decision.request_ts}. "
        f"FIFO rank: {decision.fifo_rank}.\n"
        f"Decision: {decision.decision}\n"
        f"Machine reason: {decision.reason}\n\n"
        "Write 3–4 sentences explaining this decision to the desk in plain English. "
        "Name the rule that fired (already-received, mid-CLV multi-request review, "
        "or FIFO allocation). "
        "For NEEDS_REVIEW, tell the desk what they must decide manually. "
        "For AUTO_REJECT, state why and what the requester could do next. "
        "No preamble."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    out = {
        "memos": pl.read_csv(data_dir / "memos_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
    }
    # Sales drive the canonical CLV quartile tiers; optional if absent.
    sales_path = data_dir / "sales_transactions_seed.csv"
    if sales_path.exists():
        out["sales"] = pl.read_csv(sales_path)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Memo approval assistant (FIFO + HITL gate).")
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--memo", metavar="ID", help="Review one memo by ID.")
    mode.add_argument("--all-pending", action="store_true",
                      help="Review all Pending memos.")

    p.add_argument("--today", type=lambda s: dt.date.fromisoformat(s), default=None)
    p.add_argument("--model", default=None,
                   help="Add LLM narration via utils.connect.ask.")
    p.add_argument("--json", action="store_true")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    today = args.today or dt.date.today()

    # Canonical CLV quartile tiers (Top/High/Mid/Low) from sales, when available.
    tiers = (canonical_tiers(csvs["sales"], csvs["customers"], today)
             if "sales" in csvs else None)

    if args.all_pending:
        decisions = review_pending(csvs["memos"], csvs["customers"], today, tiers=tiers)
        if args.json:
            print(json.dumps([d._asdict() for d in decisions], default=str))
            return 0
        print(format_batch(decisions))
        if args.model and decisions:
            interesting = [d for d in decisions
                           if d.decision in ("NEEDS_REVIEW", "AUTO_REJECT")][:3]
            for d in interesting:
                print()
                print(f"---\n{format_decision(d)}")
                print(narrate_decision(d, model=args.model))
    else:
        decision = decide_memo(args.memo, csvs["memos"], csvs["customers"], today, tiers=tiers)
        if decision is None:
            print(f"Memo {args.memo} not found among pending memos.", file=sys.stderr)
            return 1
        if args.json:
            print(json.dumps(decision._asdict(), default=str))
            return 0
        print(format_decision(decision))
        if args.model:
            print()
            print(narrate_decision(decision, model=args.model))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
