"""Skill: Decide Memo — fully deterministic FIFO + HITL gate.

Step 4 of the Pramukh Gems workflow.

The desk no longer hand-picks who receives a stone. Each pending memo is
auto-routed into one of three buckets by first-come (FIFO) allocation plus
two guardrails:

  auto_reject  — the requester already received this stone on a prior memo,
                 OR the stone was already allocated (FIFO) to an earlier
                 request / is actively held by another customer.
  needs_review — the *only* human case: a mid-CLV customer (``Mid`` tier)
                 asking for more than one stone at once.
  auto_approve — the earliest pending request for the stone (FIFO winner).

Rule precedence, per pending memo:
  1. (customer, stone) already received before          → auto_reject
  2. mid-CLV (Mid tier) customer requesting >1 stone     → needs_review
  3. earliest pending request for the stone (FIFO win)   → auto_approve
  4. stone already taken by an earlier request / hold    → auto_reject

Reliability + opportunity scores from ``_memo_core`` are still computed and
written for display continuity, but they no longer drive the routing.
Writes per-row decisions to ``data/working/memo_decisions.csv``.

No LLM. The decision and its rationale are both rule-based.
"""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import sys
from pathlib import Path

import polars as pl

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from utils.pramukh_common import (  # noqa: E402
    Envelope, append_rows, audit_log, emit_envelope,
    error_envelope, make_skill_parser, parse_today,
)

_CORE_PATH = Path(__file__).with_name("_memo_core.py")
_spec = importlib.util.spec_from_file_location("_memo_core", _CORE_PATH)
assert _spec and _spec.loader
_memo_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_memo_core)

decide_memo_core = _memo_core.decide_memo

SKILL_NAME = "decide-memo"
NEXT_STEP = "done"

DEFAULT_AUTO_TIERS = ("Top", "High")
DEFAULT_OPP_CEILING = 70


# ---------------------------------------------------------------------------
# Hand-off file loaders
# ---------------------------------------------------------------------------


def _load_lookup(path: Path, key: str, value: str) -> dict[str, str]:
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    with path.open() as f:
        for row in csv.DictReader(f):
            k, v = row.get(key, ""), row.get(value, "")
            if k:
                out[k] = v
    return out


# ---------------------------------------------------------------------------
# FIFO + HITL gate
# ---------------------------------------------------------------------------

# clv_tiers.csv tier that counts as "mid CLV" for the manual-review gate.
# (Top = high, Mid = mid, High sits between; Low = low.)
MID_CLV_TIERS = ("Mid",)

# Prior memo states that mean the customer already took possession of a stone.
_RECEIVED_DECISIONS = ("Approved", "ApprovedWithConditions")


def _parse_ts(value: str):
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return dt.datetime.min


def _build_received_pairs(memos: pl.DataFrame) -> set[tuple[str, str]]:
    """(customer_id, stock_id) pairs already received on a prior (non-pending) memo."""
    pairs: set[tuple[str, str]] = set()
    for r in memos.iter_rows(named=True):
        if r.get("decision") == "Pending":
            continue
        received = (
            r.get("decision") in _RECEIVED_DECISIONS
            or (r.get("closed_outcome") or "").strip() == "Sold"
        )
        if received:
            pairs.add((r.get("customer_id", ""), r.get("stock_id", "")))
    return pairs


def _multi_request_customers(pending: pl.DataFrame) -> dict[str, int]:
    """customer_id → number of distinct stones pending (only those with >1)."""
    seen: dict[str, set[str]] = {}
    for r in pending.iter_rows(named=True):
        seen.setdefault(r.get("customer_id", ""), set()).add(r.get("stock_id", ""))
    return {c: len(s) for c, s in seen.items() if len(s) > 1}


def _build_rationale(queue: str, decision, tier: str, route_reason: str) -> str:
    """Plain-English explanation of the rule that fired (no LLM)."""
    rel = int(decision.reliability_score)
    opp = int(decision.opportunity_score)
    lead = {
        "auto_approve": "Auto-approved (FIFO winner).",
        "auto_reject":  "Auto-rejected.",
        "needs_review": "Routed to human sign-off.",
    }.get(queue, "Decision.")
    tier_note = f" CLV tier: {tier}." if tier and tier != "Unknown" else ""
    return (
        f"{lead} {route_reason}.{tier_note} "
        f"(context: reliability {rel}/100, opportunity {opp}/100)"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = make_skill_parser(
        description="Decide pending memo requests — fully deterministic, no LLM.",
        entity_flag="--memo-id",
    )
    parser.add_argument("--auto-approve-tiers", default="Top,High",
                        help="Comma list of CLV tiers eligible for auto-approve.")
    parser.add_argument("--opp-ceiling", type=int, default=DEFAULT_OPP_CEILING,
                        help="Max opportunity_score eligible for auto-approve.")
    args = parser.parse_args()
    today = parse_today(args.today)

    auto_tiers = tuple(t.strip() for t in args.auto_approve_tiers.split(",") if t.strip())
    out_path = args.out_dir / "memo_decisions.csv"

    try:
        raw = args.data_dir / "raw"
        memos       = pl.read_csv(raw / "memos_seed.csv")
        inventory   = pl.read_csv(raw / "inventory_seed.csv")
        payments    = pl.read_csv(raw / "payment_history_seed.csv")
        demand      = pl.read_csv(raw / "demand_signals_seed.csv")
        customers   = pl.read_csv(raw / "customers_seed.csv")

        triage_lookup = _load_lookup(args.out_dir / "triage_decisions.csv",
                                     "stock_id", "action_tag")
        tier_lookup   = _load_lookup(args.out_dir / "clv_tiers.csv",
                                     "entity_id", "tier")

        # Which memos to process?
        if args.memo_id and args.memo_id != "ALL":
            pending = memos.filter(pl.col("memo_id") == args.memo_id)
        else:
            pending = memos.filter(pl.col("decision") == "Pending")

        # ── Context for the FIFO + HITL gate ──────────────────────────────
        # Stones already received by a customer on a prior memo.
        received_pairs = _build_received_pairs(memos)
        # Mid-CLV customers asking for more than one stone (the review case).
        multi_full = _multi_request_customers(memos.filter(pl.col("decision") == "Pending"))
        # Stones actively held by another customer from a prior approved memo.
        active_holds: dict[str, str] = {}
        for r in memos.iter_rows(named=True):
            if (r.get("decision") in _RECEIVED_DECISIONS
                and not (r.get("closed_outcome") or "").strip()):
                sid = r.get("stock_id", "")
                if sid and sid not in active_holds:
                    active_holds[sid] = r.get("customer_id", "")

        # Sort pending requests by arrival time so FIFO is well-defined.
        pending_rows = sorted(
            pending.iter_rows(named=True),
            key=lambda r: (_parse_ts(r.get("request_date", "")), r.get("memo_id", "")),
        )

        # First pass: classify by rule precedence; collect FIFO candidates.
        classified: dict[str, dict] = {}   # memo_id -> {queue, route_reason, decision_str}
        fifo_candidates: dict[str, list[dict]] = {}
        for r in pending_rows:
            memo_id = r.get("memo_id", "")
            cust = r.get("customer_id", "")
            stock = r.get("stock_id", "")
            tier = (tier_lookup.get(r.get("broker_id", ""))
                    or tier_lookup.get(cust) or "Unknown")

            if (cust, stock) in received_pairs:
                classified[memo_id] = dict(
                    queue="auto_reject", decision_str="REJECT",
                    route_reason=(f"{cust} already received {stock} on a prior memo — "
                                  "duplicate request"),
                )
            elif active_holds.get(stock) and active_holds[stock] != cust:
                classified[memo_id] = dict(
                    queue="auto_reject", decision_str="REJECT",
                    route_reason=(f"Stone {stock} is already held by another customer "
                                  f"({active_holds[stock]}) — pick another stone"),
                )
            elif tier in MID_CLV_TIERS and cust in multi_full:
                classified[memo_id] = dict(
                    queue="needs_review", decision_str="REVIEW",
                    route_reason=(f"{cust} is mid-CLV ({tier}) requesting "
                                  f"{multi_full[cust]} stones — needs human sign-off"),
                )
            else:
                fifo_candidates.setdefault(stock, []).append(r)

        # Second pass: FIFO allocate each contested stone.
        for stock, reqs in fifo_candidates.items():
            reqs.sort(key=lambda r: (_parse_ts(r.get("request_date", "")), r.get("memo_id", "")))
            winner = reqs[0]
            classified[winner["memo_id"]] = dict(
                queue="auto_approve", decision_str="APPROVE",
                route_reason=(f"Earliest request for {stock} "
                              f"(arrived {winner.get('request_date', '')}) — FIFO winner"),
            )
            for loser in reqs[1:]:
                classified[loser["memo_id"]] = dict(
                    queue="auto_reject", decision_str="REJECT",
                    route_reason=(f"{stock} allocated via FIFO to earlier request "
                                  f"{winner['memo_id']} (arrived {winner.get('request_date', '')})"),
                )

        rows: list[dict] = []
        n_auto_approve = n_auto_reject = n_review = 0

        for memo_row in pending_rows:
            decision = decide_memo_core(
                memo_row, inventory, memos, payments, demand, customers,
                triage_lookup, today,
            )
            tier = (tier_lookup.get(memo_row.get("broker_id", ""))
                    or tier_lookup.get(memo_row.get("customer_id", ""))
                    or "Unknown")
            triage_tag = triage_lookup.get(decision.stock_id, "")

            cls = classified[decision.memo_id]
            queue = cls["queue"]
            route_reason = cls["route_reason"]
            # Override the core decision label to reflect the FIFO/HITL gate.
            decision = decision._replace(decision=cls["decision_str"])

            if queue == "auto_approve":
                n_auto_approve += 1
            elif queue == "auto_reject":
                n_auto_reject += 1
            else:
                n_review += 1

            rationale = _build_rationale(queue, decision, tier, route_reason)

            rows.append({
                "workflow_run_id":    args.workflow_run_id or "",
                "step_id":            args.step_id or "",
                "ts":                 dt.datetime.now().isoformat(timespec="seconds"),
                "queue":              queue,
                "route_reason":       route_reason,
                "memo_id":            decision.memo_id,
                "stock_id":           decision.stock_id,
                "customer_id":        decision.customer_id,
                "broker_id":          decision.broker_id,
                "tier":               tier,
                "triage_tag":         triage_tag,
                "decision":           decision.decision,
                "reliability_score":  decision.reliability_score,
                "opportunity_score":  decision.opportunity_score,
                "reason":             decision.reason,
                "rationale":          rationale,
            })

        n_written = append_rows(out_path, rows,
                                fieldnames=list(rows[0].keys())) if rows else 0

        env = Envelope(
            status="ok",
            skill_name=SKILL_NAME,
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.memo_id,
            next_action=NEXT_STEP,
            confidence=1.0,
            review_required=(n_review > 0),
            artifact_refs=[f"working/{out_path.name}"],
            outputs={
                "today": today.isoformat(),
                "memos_reviewed": len(rows),
                "auto_approved": n_auto_approve,
                "auto_rejected": n_auto_reject,
                "needs_review": n_review,
                "rows_written": n_written,
                "opp_ceiling": args.opp_ceiling,
                "auto_tiers": list(auto_tiers),
            },
        )
    except Exception as exc:                # pragma: no cover
        env = error_envelope(
            SKILL_NAME, "runtime_error", str(exc),
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.memo_id,
        )
        audit_log(args.out_dir, env)
        emit_envelope(env, as_json=args.json)
        return 1

    audit_log(args.out_dir, env)
    emit_envelope(
        env,
        print_human=(
            f"[{SKILL_NAME}] reviewed {env.outputs['memos_reviewed']} "
            f"(auto-approve={env.outputs['auto_approved']}, "
            f"auto-reject={env.outputs['auto_rejected']}, "
            f"review={env.outputs['needs_review']}) → next: {NEXT_STEP}"
        ),
        as_json=args.json,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
