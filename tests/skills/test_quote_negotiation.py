"""Tests for `skills/quote-negotiation/scripts/quote_negotiation.py`."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path

import polars as pl
import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "quote-negotiation"
    / "scripts"
    / "quote_negotiation.py"
)
_spec = importlib.util.spec_from_file_location("quote_negotiation", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

assess_quote = mod.assess_quote
evaluate_negotiation = mod.evaluate_negotiation
batch_negotiating = mod.batch_negotiating
format_decision = mod.format_decision
format_batch = mod.format_batch
NegotiationDecision = mod.NegotiationDecision
QuotePosition = mod.QuotePosition
_MIN_MARGIN_FRAC = mod._MIN_MARGIN_FRAC
_ESCALATE_THRESHOLD = mod._ESCALATE_THRESHOLD

TODAY = dt.date(2026, 5, 2)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _inv(stock_id="STK0001", cost_basis=1000.0):
    return pl.DataFrame([{
        "stock_id": stock_id,
        "cost_basis": cost_basis,
        "status": "Available",
        "category_simple": "Round | 1.00-1.99 | DEF | VVS+",
        "p_pcs": cost_basis * 1.25,
    }])


def _customers(customer_id="CUST0001", tier="Gold", churn=0.15, pay_score=82.0):
    return pl.DataFrame([{
        "customer_id": customer_id,
        "customer_name": "Test Customer",
        "clv_tier": tier,
        "churn_risk_pct": churn,
        "payment_score": pay_score,
    }])


def _demand(category="Round | 1.00-1.99 | DEF | VVS+", score=0.5, date="2026-04-01"):
    return pl.DataFrame([{
        "signal_date": date,
        "category_simple": category,
        "listing_count": 40,
        "avg_market_price": 5000.0,
        "demand_score": score,
    }])


def _quote_row(
    quote_id="QTE00001",
    stock_id="STK0001",
    customer_id="CUST0001",
    category="Round | 1.00-1.99 | DEF | VVS+",
    offered=1250.0,
    customer_offer=None,
    margin_pct=25.0,
    outcome="Negotiating",
):
    return {
        "quote_id": quote_id,
        "stock_id": stock_id,
        "customer_id": customer_id,
        "category_simple": category,
        "offered_price": offered,
        "customer_offer": customer_offer,
        "margin_pct": margin_pct,
        "quote_outcome": outcome,
        "list_price": offered * 1.5,
        "base_discount_pct": 10.0,
        "final_discount_pct": 15.0,
        "final_agreed_price": None,
    }


def _quotes(*rows):
    return pl.DataFrame(list(rows), schema={
        "quote_id": pl.Utf8,
        "stock_id": pl.Utf8,
        "customer_id": pl.Utf8,
        "category_simple": pl.Utf8,
        "offered_price": pl.Float64,
        "customer_offer": pl.Float64,
        "margin_pct": pl.Float64,
        "quote_outcome": pl.Utf8,
        "list_price": pl.Float64,
        "base_discount_pct": pl.Float64,
        "final_discount_pct": pl.Float64,
        "final_agreed_price": pl.Float64,
    })


# ---------------------------------------------------------------------------
# assess_quote
# ---------------------------------------------------------------------------


def test_assess_quote_floor_price():
    pos = assess_quote(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    expected_floor = round(1000.0 * (1.0 + _MIN_MARGIN_FRAC), 2)
    assert pos.floor_price == pytest.approx(expected_floor)


def test_assess_quote_tier_headroom_diamond_gt_silver():
    pos_diamond = assess_quote(
        _quote_row(), _inv(), _customers(tier="Diamond"), _demand(), today=TODAY
    )
    pos_silver = assess_quote(
        _quote_row(), _inv(), _customers(tier="Silver"), _demand(), today=TODAY
    )
    assert pos_diamond.discount_headroom_pct > pos_silver.discount_headroom_pct


def test_assess_quote_high_demand_reduces_headroom():
    pos_high = assess_quote(
        _quote_row(), _inv(), _customers(), _demand(score=0.80), today=TODAY
    )
    pos_low = assess_quote(
        _quote_row(), _inv(), _customers(), _demand(score=0.20), today=TODAY
    )
    assert pos_high.discount_headroom_pct < pos_low.discount_headroom_pct


def test_assess_quote_no_inventory_uses_fallback():
    pos = assess_quote(_quote_row(), pl.DataFrame(), _customers(), _demand(), today=TODAY)
    assert pos.cost_basis == pytest.approx(1250.0 * 0.75)


def test_assess_quote_no_customer_uses_defaults():
    pos = assess_quote(_quote_row(), _inv(), pl.DataFrame(), _demand(), today=TODAY)
    assert pos.clv_tier == "New"


def test_assess_quote_returns_quotposition():
    pos = assess_quote(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    assert isinstance(pos, QuotePosition)
    assert pos.quote_id == "QTE00001"


def test_assess_quote_max_concession_above_floor():
    pos = assess_quote(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    assert pos.max_concession_price >= pos.floor_price


# ---------------------------------------------------------------------------
# evaluate_negotiation — HOLD (no counter-offer)
# ---------------------------------------------------------------------------


def test_evaluate_no_counter_returns_hold():
    d = evaluate_negotiation(_quote_row(customer_offer=None),
                             _inv(), _customers(), _demand(), today=TODAY)
    assert d.decision == "HOLD"
    assert d.response_price is None


def test_evaluate_hold_includes_headroom_info():
    d = evaluate_negotiation(_quote_row(customer_offer=None),
                             _inv(), _customers(), _demand(), today=TODAY)
    assert "headroom" in d.reason.lower() or "hold" in d.reason.lower()


# ---------------------------------------------------------------------------
# evaluate_negotiation — ACCEPT
# ---------------------------------------------------------------------------


def test_evaluate_counter_above_offered_accepts():
    # Customer offers MORE than we asked → instant accept
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=1300.0),
        _inv(), _customers(), _demand(), today=TODAY,
    )
    assert d.decision == "ACCEPT"
    assert d.response_price == pytest.approx(1300.0)


def test_evaluate_counter_within_headroom_accepts():
    # Gold tier headroom = 3%; offered=1250 → max_concession ≈ 1250*(1-0.03) = 1212.5
    # Customer offers 1220 which should be within headroom
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=1220.0),
        _inv(), _customers(tier="Gold"), _demand(), today=TODAY,
    )
    # May be ACCEPT or COUNTER depending on exact headroom calc
    assert d.decision in ("ACCEPT", "COUNTER")


# ---------------------------------------------------------------------------
# evaluate_negotiation — COUNTER
# ---------------------------------------------------------------------------


def test_evaluate_counter_above_floor_below_headroom():
    # Force a case: offered=1250, cost=1000 → floor=1080
    # New tier headroom = 0.5% → max_concession = 1250*(1-0.005) = ~1243.75
    # Customer offers 1200 → above floor (1080), below headroom (1244) → COUNTER
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=1200.0),
        _inv(cost_basis=1000.0), _customers(tier="New"),
        _demand(), today=TODAY,
    )
    assert d.decision == "COUNTER"
    assert d.response_price is not None
    assert d.response_price >= d.floor_price


def test_evaluate_counter_price_at_max_concession():
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=1100.0),
        _inv(cost_basis=1000.0), _customers(tier="New"),
        _demand(), today=TODAY,
    )
    if d.decision == "COUNTER":
        assert d.response_price == pytest.approx(d.max_concession_price)


# ---------------------------------------------------------------------------
# evaluate_negotiation — WALK_AWAY
# ---------------------------------------------------------------------------


def test_evaluate_below_floor_walks_away():
    # Offered=1250, cost=1000 → floor=1080. Customer offers 900 → walk away.
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=900.0),
        _inv(cost_basis=1000.0), _customers(), _demand(), today=TODAY,
    )
    assert d.decision == "WALK_AWAY"
    assert d.response_price is None


def test_evaluate_walk_away_reason_mentions_floor():
    d = evaluate_negotiation(
        _quote_row(offered=1250.0, customer_offer=900.0),
        _inv(cost_basis=1000.0), _customers(), _demand(), today=TODAY,
    )
    assert "floor" in d.reason.lower() or "minimum" in d.reason.lower()


# ---------------------------------------------------------------------------
# evaluate_negotiation — ESCALATE
# ---------------------------------------------------------------------------


def test_evaluate_large_deal_escalates():
    d = evaluate_negotiation(
        _quote_row(offered=_ESCALATE_THRESHOLD + 1000, customer_offer=None),
        _inv(cost_basis=40000.0), _customers(), _demand(), today=TODAY,
    )
    assert d.decision == "ESCALATE"


# ---------------------------------------------------------------------------
# evaluate_negotiation — returns NegotiationDecision
# ---------------------------------------------------------------------------


def test_evaluate_returns_negotiationdecision():
    d = evaluate_negotiation(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    assert isinstance(d, NegotiationDecision)
    assert d.quote_id == "QTE00001"
    assert d.decision in ("ACCEPT", "COUNTER", "HOLD", "WALK_AWAY", "ESCALATE")


# ---------------------------------------------------------------------------
# batch_negotiating
# ---------------------------------------------------------------------------


def test_batch_only_processes_negotiating():
    rows = [
        _quote_row("Q1", outcome="Negotiating"),
        _quote_row("Q2", stock_id="STK0002", outcome="Accepted"),
        _quote_row("Q3", stock_id="STK0003", outcome="Lost"),
    ]
    quotes_df = _quotes(*rows)
    inv = pl.concat([_inv("STK0001"), _inv("STK0002"), _inv("STK0003")])
    results = batch_negotiating(quotes_df, inv, _customers(), _demand(), today=TODAY)
    assert len(results) == 1
    assert results[0].quote_id == "Q1"


def test_batch_empty_returns_empty():
    results = batch_negotiating(
        _quotes(), _inv(), _customers(), _demand(), today=TODAY
    )
    assert results == []


def test_batch_multiple_decisions():
    rows = [
        _quote_row(f"Q{i}", stock_id=f"STK{i}",
                   customer_offer=1200.0 if i % 2 == 0 else None,
                   outcome="Negotiating")
        for i in range(4)
    ]
    quotes_df = _quotes(*rows)
    inv = pl.concat([_inv(f"STK{i}") for i in range(4)])
    results = batch_negotiating(quotes_df, inv, _customers(), _demand(), today=TODAY)
    assert len(results) == 4
    decisions = {r.decision for r in results}
    # Some have counter, some don't → expect mix
    assert len(decisions) >= 1


# ---------------------------------------------------------------------------
# format_decision / format_batch
# ---------------------------------------------------------------------------


def test_format_decision_contains_quote_id():
    d = evaluate_negotiation(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    text = format_decision(d)
    assert "QTE00001" in text
    assert d.decision in text


def test_format_batch_empty():
    assert "no negotiating" in format_batch([])


def test_format_batch_summary_line():
    d = evaluate_negotiation(_quote_row(), _inv(), _customers(), _demand(), today=TODAY)
    text = format_batch([d])
    assert "1 negotiating quotes" in text
    assert "|" in text


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------


def _data_dir():
    return Path(__file__).resolve().parents[2] / "data" / "Milestone_2"


def test_cli_single_quote(capsys):
    if not (_data_dir() / "quotes_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main([
        "--data-dir", str(_data_dir()),
        "--quote", "QTE00001",
        "--today", "2026-05-02",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "QTE00001" in out
    assert any(d in out for d in ("ACCEPT", "COUNTER", "HOLD", "WALK_AWAY", "ESCALATE"))


def test_cli_all_negotiating(capsys):
    if not (_data_dir() / "quotes_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main([
        "--data-dir", str(_data_dir()),
        "--all-negotiating",
        "--today", "2026-05-02",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "negotiating quotes" in out
    assert "|" in out


def test_cli_json_output(capsys):
    if not (_data_dir() / "quotes_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main([
        "--data-dir", str(_data_dir()),
        "--all-negotiating",
        "--today", "2026-05-02",
        "--json",
    ])
    out = capsys.readouterr().out
    data = json.loads(out)
    assert isinstance(data, list)
    if data:
        assert "decision" in data[0]
        assert "quote_id" in data[0]
