"""Quote / Negotiation Response Agent — Skill 2.

When a customer counter-offers on a diamond quote, decide:
  ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE

Signal inputs
-------------
1. Price position  — how far the customer offer is from our floor & current offer.
2. CLV tier        — Diamond/Gold/Silver/New drives discount headroom.
3. Demand          — hot category → less concession; slow-mover → more room.
4. Churn risk      — high-risk customer → slightly more generous to retain.

Public API
----------
- ``assess_quote(quote_row, inventory, customers, demand)`` → QuotePosition
- ``evaluate_negotiation(quote_row, inventory, customers, demand)`` → NegotiationDecision
- ``batch_negotiating(quotes, inventory, customers, demand)`` → list[NegotiationDecision]

CLI
---
  python quote_negotiation.py --quote QTE00001
  python quote_negotiation.py --all-negotiating
  python quote_negotiation.py --all-negotiating --model api-llama-4-scout
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

DECISIONS = ("ACCEPT", "COUNTER", "HOLD", "WALK_AWAY", "ESCALATE")

# Minimum margin floor as fraction over cost_basis (8% = cover overheads + thin profit).
_MIN_MARGIN_FRAC = 0.08

# Maximum absolute value for auto-decision (above this → ESCALATE to human).
_ESCALATE_THRESHOLD = 50_000.0

# Discount headroom (fraction of current offer) by CLV tier.
_TIER_HEADROOM: dict[str, float] = {
    "Diamond": 0.05,
    "Gold":    0.03,
    "Silver":  0.015,
    "New":     0.005,
}

# Demand thresholds.
_HIGH_DEMAND = 0.65
_LOW_DEMAND  = 0.35


# ---------------------------------------------------------------------------
# Named-tuple result types
# ---------------------------------------------------------------------------


class QuotePosition(NamedTuple):
    quote_id: str
    stock_id: str
    customer_id: str
    clv_tier: str
    offered_price: float
    customer_offer: float | None
    cost_basis: float
    floor_price: float          # cost_basis × (1 + _MIN_MARGIN_FRAC)
    max_concession_price: float # offered_price × (1 − headroom)  clamped to floor
    current_margin_pct: float
    demand_score: float
    churn_risk_pct: float
    discount_headroom_pct: float  # additional % we could give off current offer
    notes: list[str]


class NegotiationDecision(NamedTuple):
    quote_id: str
    stock_id: str
    customer_id: str
    clv_tier: str
    decision: str           # ACCEPT / COUNTER / HOLD / WALK_AWAY / ESCALATE
    response_price: float | None   # suggested price for COUNTER
    reason: str
    offered_price: float
    customer_offer: float | None
    floor_price: float
    max_concession_price: float
    reliability_signal: str  # "strong" / "moderate" / "weak"


# ---------------------------------------------------------------------------
# CLV / customer helpers
# ---------------------------------------------------------------------------


def _customer_info(customer_id: str, customers: pl.DataFrame) -> dict:
    if "customer_id" not in customers.columns:
        return {"clv_tier": "New", "churn_risk_pct": 0.50, "payment_score": 70}
    row = customers.filter(pl.col("customer_id") == customer_id)
    if row.is_empty():
        return {"clv_tier": "New", "churn_risk_pct": 0.50, "payment_score": 70}
    r = row.to_dicts()[0]
    return {
        "clv_tier":       r.get("clv_tier") or "New",
        "churn_risk_pct": float(r.get("churn_risk_pct") or 0.50),
        "payment_score":  float(r.get("payment_score") or 70),
    }


def _demand_for_category(
    category: str,
    demand: pl.DataFrame,
    today: dt.date,
    window_days: int = 60,
) -> float:
    if demand.is_empty():
        return 0.5
    cutoff = today - dt.timedelta(days=window_days)
    recent = (
        demand.with_columns(pl.col("signal_date").str.to_date())
        .filter(
            (pl.col("category_simple") == category)
            & (pl.col("signal_date") >= cutoff)
        )
    )
    if recent.is_empty():
        return 0.5
    return float(recent["demand_score"].mean())


# ---------------------------------------------------------------------------
# Core assessment
# ---------------------------------------------------------------------------


def assess_quote(
    quote_row: dict,
    inventory: pl.DataFrame,
    customers: pl.DataFrame,
    demand: pl.DataFrame,
    today: dt.date | None = None,
) -> QuotePosition:
    """Compute the price position and discount headroom for one quote.

    Parameters
    ----------
    quote_row : dict
        A row from quotes_seed.csv (keys: quote_id, stock_id, customer_id,
        offered_price, customer_offer, category_simple, margin_pct).
    inventory, customers, demand : pl.DataFrame
        Seed DataFrames.
    today : date
        Override today's date (default: dt.date.today()).
    """
    if today is None:
        today = dt.date.today()

    quote_id    = str(quote_row.get("quote_id", ""))
    stock_id    = str(quote_row.get("stock_id", ""))
    customer_id = str(quote_row.get("customer_id", ""))
    category    = str(quote_row.get("category_simple", ""))
    offered     = float(quote_row.get("offered_price") or 0.0)
    cust_offer  = quote_row.get("customer_offer")
    if cust_offer is not None:
        try:
            cust_offer = float(cust_offer)
        except (TypeError, ValueError):
            cust_offer = None

    notes: list[str] = []

    # ── Cost basis from inventory ─────────────────────────────────────────
    stone = (
        inventory.filter(pl.col("stock_id") == stock_id)
        if "stock_id" in inventory.columns
        else pl.DataFrame()
    )
    if stone.is_empty():
        cost_basis = offered * 0.75  # fallback assumption
        notes.append("stone not in inventory — cost estimated at 75% of offer")
    else:
        cost_basis = float(stone["cost_basis"][0])

    floor = round(cost_basis * (1.0 + _MIN_MARGIN_FRAC), 2)

    # ── Customer signals ──────────────────────────────────────────────────
    cinfo = _customer_info(customer_id, customers)
    tier  = cinfo["clv_tier"]
    churn = cinfo["churn_risk_pct"]
    pay   = cinfo["payment_score"]
    notes.append(f"CLV tier: {tier}, churn risk: {churn:.0%}, payment score: {pay:.0f}")

    # ── Demand ────────────────────────────────────────────────────────────
    demand_score = _demand_for_category(category, demand, today)
    notes.append(f"category demand: {demand_score:.2f}")

    # ── Discount headroom ─────────────────────────────────────────────────
    base_headroom = _TIER_HEADROOM.get(tier, 0.005)

    # Shrink headroom when demand is hot; widen a little for slow-movers.
    if demand_score >= _HIGH_DEMAND:
        demand_adj = -0.01   # hot stone — tighten headroom
        notes.append("high demand — headroom reduced")
    elif demand_score < _LOW_DEMAND:
        demand_adj = +0.01   # slow-mover — willing to give a bit more
        notes.append("low demand — headroom extended")
    else:
        demand_adj = 0.0

    # High churn risk: be slightly more generous to retain the customer.
    churn_adj = 0.005 if churn > 0.3 else 0.0
    if churn_adj:
        notes.append("elevated churn risk — small extra concession")

    effective_headroom = max(0.0, base_headroom + demand_adj + churn_adj)
    max_concession = max(floor, round(offered * (1.0 - effective_headroom), 2))

    current_margin = float(quote_row.get("margin_pct") or
                           ((offered - cost_basis) / cost_basis * 100))

    return QuotePosition(
        quote_id=quote_id,
        stock_id=stock_id,
        customer_id=customer_id,
        clv_tier=tier,
        offered_price=offered,
        customer_offer=cust_offer,
        cost_basis=cost_basis,
        floor_price=floor,
        max_concession_price=max_concession,
        current_margin_pct=current_margin,
        demand_score=demand_score,
        churn_risk_pct=churn,
        discount_headroom_pct=round(effective_headroom * 100, 2),
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Decision engine
# ---------------------------------------------------------------------------


def evaluate_negotiation(
    quote_row: dict,
    inventory: pl.DataFrame,
    customers: pl.DataFrame,
    demand: pl.DataFrame,
    today: dt.date | None = None,
) -> NegotiationDecision:
    """Return a negotiation decision for one quote row.

    Decision rules
    --------------
    - ESCALATE:   deal > $50K or stone not found.
    - ACCEPT:     customer_offer >= offered_price (they accepted ours or went higher).
    - ACCEPT:     customer_offer >= max_concession_price (within our headroom).
    - COUNTER:    customer_offer >= floor_price (below headroom but above floor).
                  → counter at max_concession_price.
    - WALK_AWAY:  customer_offer < floor_price.
    - HOLD:       no customer_offer yet → advise holding current offer.
    """
    if today is None:
        today = dt.date.today()

    pos = assess_quote(quote_row, inventory, customers, demand, today)

    # Payment reliability signal for the reason text.
    pay = _customer_info(pos.customer_id, customers).get("payment_score", 70)
    reliability = "strong" if pay >= 80 else ("moderate" if pay >= 60 else "weak")

    quote_id = pos.quote_id
    stock_id = pos.stock_id

    # ── ESCALATE: very large deal ─────────────────────────────────────────
    if pos.offered_price > _ESCALATE_THRESHOLD:
        return NegotiationDecision(
            quote_id=quote_id, stock_id=stock_id,
            customer_id=pos.customer_id, clv_tier=pos.clv_tier,
            decision="ESCALATE",
            response_price=None,
            reason=(
                f"Deal value ${pos.offered_price:,.0f} exceeds auto-approval limit "
                f"(${_ESCALATE_THRESHOLD:,.0f}). Route to senior sales manager."
            ),
            offered_price=pos.offered_price,
            customer_offer=pos.customer_offer,
            floor_price=pos.floor_price,
            max_concession_price=pos.max_concession_price,
            reliability_signal=reliability,
        )

    # ── No customer offer yet → HOLD ──────────────────────────────────────
    if pos.customer_offer is None:
        return NegotiationDecision(
            quote_id=quote_id, stock_id=stock_id,
            customer_id=pos.customer_id, clv_tier=pos.clv_tier,
            decision="HOLD",
            response_price=None,
            reason=(
                f"No counter-offer received for {stock_id}. "
                f"Hold at current offer of ${pos.offered_price:,.0f} "
                f"(margin {pos.current_margin_pct:.1f}%). "
                f"Headroom available: {pos.discount_headroom_pct:.1f}% "
                f"down to ${pos.max_concession_price:,.0f} if customer pushes back."
            ),
            offered_price=pos.offered_price,
            customer_offer=None,
            floor_price=pos.floor_price,
            max_concession_price=pos.max_concession_price,
            reliability_signal=reliability,
        )

    co = pos.customer_offer

    # ── ACCEPT: customer at or above our offer ─────────────────────────────
    if co >= pos.offered_price:
        return NegotiationDecision(
            quote_id=quote_id, stock_id=stock_id,
            customer_id=pos.customer_id, clv_tier=pos.clv_tier,
            decision="ACCEPT",
            response_price=co,
            reason=(
                f"{pos.customer_id} ({pos.clv_tier}) offered ${co:,.0f}, "
                f"meeting our ask of ${pos.offered_price:,.0f}. Accept immediately."
            ),
            offered_price=pos.offered_price,
            customer_offer=co,
            floor_price=pos.floor_price,
            max_concession_price=pos.max_concession_price,
            reliability_signal=reliability,
        )

    # ── ACCEPT: customer within concession headroom ────────────────────────
    if co >= pos.max_concession_price:
        margin_at_offer = (co - pos.cost_basis) / pos.cost_basis * 100
        return NegotiationDecision(
            quote_id=quote_id, stock_id=stock_id,
            customer_id=pos.customer_id, clv_tier=pos.clv_tier,
            decision="ACCEPT",
            response_price=co,
            reason=(
                f"{pos.customer_id} ({pos.clv_tier}) counter-offered ${co:,.0f}, "
                f"within {pos.discount_headroom_pct:.1f}% headroom "
                f"(floor ${pos.floor_price:,.0f}). "
                f"Accepting preserves {margin_at_offer:.1f}% margin. "
                f"Demand score {pos.demand_score:.2f}, churn risk {pos.churn_risk_pct:.0%}."
            ),
            offered_price=pos.offered_price,
            customer_offer=co,
            floor_price=pos.floor_price,
            max_concession_price=pos.max_concession_price,
            reliability_signal=reliability,
        )

    # ── COUNTER: above floor but below headroom ───────────────────────────
    if co >= pos.floor_price:
        margin_at_counter = (pos.max_concession_price - pos.cost_basis) / pos.cost_basis * 100
        return NegotiationDecision(
            quote_id=quote_id, stock_id=stock_id,
            customer_id=pos.customer_id, clv_tier=pos.clv_tier,
            decision="COUNTER",
            response_price=pos.max_concession_price,
            reason=(
                f"{pos.customer_id} ({pos.clv_tier}) offered ${co:,.0f}, "
                f"below our headroom floor of ${pos.max_concession_price:,.0f}. "
                f"Counter at ${pos.max_concession_price:,.0f} "
                f"({margin_at_counter:.1f}% margin, "
                f"demand {pos.demand_score:.2f}, headroom {pos.discount_headroom_pct:.1f}%). "
                f"Going lower would breach our {_MIN_MARGIN_FRAC*100:.0f}% floor."
            ),
            offered_price=pos.offered_price,
            customer_offer=co,
            floor_price=pos.floor_price,
            max_concession_price=pos.max_concession_price,
            reliability_signal=reliability,
        )

    # ── WALK_AWAY: below floor ────────────────────────────────────────────
    margin_gap = pos.floor_price - co
    return NegotiationDecision(
        quote_id=quote_id, stock_id=stock_id,
        customer_id=pos.customer_id, clv_tier=pos.clv_tier,
        decision="WALK_AWAY",
        response_price=None,
        reason=(
            f"{pos.customer_id} offered ${co:,.0f}, which is ${margin_gap:,.0f} "
            f"below our absolute floor of ${pos.floor_price:,.0f} (cost ${pos.cost_basis:,.0f} "
            f"+ {_MIN_MARGIN_FRAC*100:.0f}% minimum margin). "
            f"Politely decline and mark as Lost. "
            f"CLV tier {pos.clv_tier} — if Diamond/Gold, consider flagging for management review."
        ),
        offered_price=pos.offered_price,
        customer_offer=co,
        floor_price=pos.floor_price,
        max_concession_price=pos.max_concession_price,
        reliability_signal=reliability,
    )


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------


def batch_negotiating(
    quotes: pl.DataFrame,
    inventory: pl.DataFrame,
    customers: pl.DataFrame,
    demand: pl.DataFrame,
    today: dt.date | None = None,
) -> list[NegotiationDecision]:
    """Evaluate all quotes in 'Negotiating' status."""
    if today is None:
        today = dt.date.today()
    active = quotes.filter(pl.col("quote_outcome") == "Negotiating")
    results = []
    for row in active.iter_rows(named=True):
        results.append(evaluate_negotiation(row, inventory, customers, demand, today))
    return results


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_decision(d: NegotiationDecision) -> str:
    lines = [
        f"**{d.quote_id}** — {d.stock_id} — {d.customer_id} ({d.clv_tier})",
        f"Decision: **{d.decision}**",
        f"Reason: {d.reason}",
    ]
    if d.response_price is not None:
        lines.append(f"Response price: ${d.response_price:,.0f}")
    lines.append(
        f"Offered: ${d.offered_price:,.0f} | "
        f"Customer offer: {'$' + f'{d.customer_offer:,.0f}' if d.customer_offer else '—'} | "
        f"Floor: ${d.floor_price:,.0f} | "
        f"Max concession: ${d.max_concession_price:,.0f} | "
        f"Reliability: {d.reliability_signal}"
    )
    return "\n".join(lines)


def format_batch(decisions: list[NegotiationDecision]) -> str:
    if not decisions:
        return "_(no negotiating quotes)_"
    counts: dict[str, int] = {d: 0 for d in DECISIONS}
    for dec in decisions:
        counts[dec.decision] = counts.get(dec.decision, 0) + 1
    header = (
        f"{len(decisions)} negotiating quotes — "
        f"ACCEPT: {counts['ACCEPT']} | "
        f"COUNTER: {counts['COUNTER']} | "
        f"HOLD: {counts['HOLD']} | "
        f"WALK_AWAY: {counts['WALK_AWAY']} | "
        f"ESCALATE: {counts['ESCALATE']}"
    )
    rows = [
        "| Quote | Stock | Customer | Tier | Decision | Our Price | Customer Offer | Floor | Rec Price |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for d in decisions:
        rows.append(
            f"| {d.quote_id} | {d.stock_id} | {d.customer_id} | {d.clv_tier} "
            f"| {d.decision} "
            f"| ${d.offered_price:,.0f} "
            f"| {'$' + f'{d.customer_offer:,.0f}' if d.customer_offer else '—'} "
            f"| ${d.floor_price:,.0f} "
            f"| {'$' + f'{d.response_price:,.0f}' if d.response_price else '—'} |"
        )
    return header + "\n\n" + "\n".join(rows)


# ---------------------------------------------------------------------------
# LLM draft response (optional)
# ---------------------------------------------------------------------------


def draft_response_message(
    decision: NegotiationDecision,
    customer_name: str,
    model: str = "api-llama-4-scout",
) -> str:
    """Draft the actual reply email/message to send to the customer."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    action_map = {
        "ACCEPT":  "accept the customer's counter-offer",
        "COUNTER": f"counter at ${decision.response_price:,.0f}",
        "HOLD":    "hold at our current asking price",
        "WALK_AWAY": "politely decline and close the negotiation",
        "ESCALATE": "inform the customer you are escalating to a senior manager",
    }
    action = action_map.get(decision.decision, decision.decision)

    prompt = (
        "You are drafting a response on behalf of Pramukh Gems, a lab-grown diamond wholesaler.\n\n"
        f"Customer: {customer_name}\n"
        f"Stone ID: {decision.stock_id}\n"
        f"Our asking price: ${decision.offered_price:,.2f}\n"
        f"Customer counter-offer: {'$' + f'{decision.customer_offer:,.2f}' if decision.customer_offer else 'not yet received'}\n"
        f"Recommended action: {action}\n"
        f"Internal reasoning: {decision.reason}\n\n"
        "Write a short, professional response (3–5 sentences) to send to the customer. "
        "Do not reveal internal margin or floor prices. "
        "Be warm but firm. Address the customer by name. "
        "For WALK_AWAY, leave the door open for future business. "
        "No preamble, no subject line."
    )
    return ask(prompt, model=model, temperature=0.4) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        "quotes":    pl.read_csv(data_dir / "quotes_seed.csv"),
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
        "demand":    pl.read_csv(data_dir / "demand_signals_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Quote / negotiation response agent.")
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--quote", metavar="ID", help="Evaluate one quote by ID.")
    mode.add_argument("--all-negotiating", action="store_true",
                      help="Evaluate all Negotiating quotes.")

    p.add_argument("--today", type=lambda s: dt.date.fromisoformat(s), default=None)
    p.add_argument("--model", default=None,
                   help="Draft LLM response messages (api-llama-4-scout, etc).")
    p.add_argument("--json", action="store_true")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    today = args.today or dt.date.today()

    if args.all_negotiating:
        decisions = batch_negotiating(
            csvs["quotes"], csvs["inventory"], csvs["customers"],
            csvs["demand"], today,
        )
        if args.json:
            print(json.dumps([d._asdict() for d in decisions], default=str))
            return 0
        print(format_batch(decisions))
        if args.model and decisions:
            cust_map = dict(
                zip(csvs["customers"]["customer_id"].to_list(),
                    csvs["customers"]["customer_name"].to_list())
            )
            interesting = [d for d in decisions
                           if d.decision in ("COUNTER", "WALK_AWAY")][:3]
            for d in interesting:
                cname = cust_map.get(d.customer_id, d.customer_id)
                print()
                print(f"---\n{format_decision(d)}")
                print(draft_response_message(d, cname, model=args.model))
    else:
        rows = csvs["quotes"].filter(pl.col("quote_id") == args.quote).to_dicts()
        if not rows:
            print(f"Quote {args.quote} not found.", file=sys.stderr)
            return 1
        decision = evaluate_negotiation(rows[0], csvs["inventory"],
                                        csvs["customers"], csvs["demand"], today)
        if args.json:
            print(json.dumps(decision._asdict(), default=str))
            return 0
        print(format_decision(decision))
        if args.model:
            cust_map = dict(
                zip(csvs["customers"]["customer_id"].to_list(),
                    csvs["customers"]["customer_name"].to_list())
            )
            cname = cust_map.get(decision.customer_id, decision.customer_id)
            print()
            print(draft_response_message(decision, cname, model=args.model))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
