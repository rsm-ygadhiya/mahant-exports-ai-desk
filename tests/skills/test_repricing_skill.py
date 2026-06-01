"""Tests for `skills/weekly-repricing/scripts/repricing_skill.py`."""

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
    / "weekly-repricing"
    / "scripts"
    / "repricing_skill.py"
)
_spec = importlib.util.spec_from_file_location("repricing_skill", _MODULE_PATH)
assert _spec and _spec.loader
repricing_skill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(repricing_skill)

price_stone = repricing_skill.price_stone
compute_repricing = repricing_skill.compute_repricing
batch_summary = repricing_skill.batch_summary
format_table = repricing_skill.format_table
FLAG_FROZEN = repricing_skill.FLAG_FROZEN
FLAG_MARGIN = repricing_skill.FLAG_MARGIN
FLAG_QUOTE = repricing_skill.FLAG_QUOTE
FLAG_UNCHANGED = repricing_skill.FLAG_UNCHANGED


# ---------------------------------------------------------------------------
# Fixtures — minimal DataFrames for compute_repricing
# ---------------------------------------------------------------------------

TODAY = dt.date(2026, 5, 2)


def _make_inventory(rows: list[dict]) -> pl.DataFrame:
    schema = {
        "stock_id": pl.Utf8,
        "category_simple": pl.Utf8,
        "carat": pl.Float64,
        "age_in_stock_days": pl.Int64,
        "status": pl.Utf8,
        "p_pcs": pl.Float64,
        "cost_basis": pl.Float64,
    }
    return pl.DataFrame(rows, schema=schema)


def _make_rap(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "rap_week": pl.Utf8,
            "category_simple": pl.Utf8,
            "rap_per_carat": pl.Float64,
            "wow_change_pct": pl.Float64,
        },
    )


def _make_sales(rows: list[dict] | None = None) -> pl.DataFrame:
    return pl.DataFrame(
        rows or [],
        schema={
            "transaction_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "sold_price": pl.Float64,
        },
    )


def _make_demand(rows: list[dict] | None = None) -> pl.DataFrame:
    return pl.DataFrame(
        rows or [],
        schema={
            "signal_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "listing_count": pl.Float64,
            "avg_market_price": pl.Float64,
            "demand_score": pl.Float64,
        },
    )


def _make_memos(rows: list[dict] | None = None) -> pl.DataFrame:
    return pl.DataFrame(
        rows or [],
        schema={
            "memo_id": pl.Utf8,
            "stock_id": pl.Utf8,
            "decision": pl.Utf8,
            "closed_outcome": pl.Utf8,
            "expiry_date": pl.Utf8,
            "marketplace_lock_status": pl.Utf8,
        },
    )


def _make_quotes(rows: list[dict] | None = None) -> pl.DataFrame:
    return pl.DataFrame(
        rows or [],
        schema={
            "stock_id": pl.Utf8,
            "offered_price": pl.Float64,
            "quote_outcome": pl.Utf8,
            "approval_status": pl.Utf8,
        },
    )


# ---------------------------------------------------------------------------
# price_stone — unit tests for each factor
# ---------------------------------------------------------------------------


def _base_kwargs(**overrides):
    defaults = dict(
        cost_basis=1000.0,
        old_price=1200.0,
        rap_wow_change_pct=0.0,  # flat Rap week → base_price = old_price = 1200
        age_days=10,
        demand_score=0.5,
        velocity=2,
        listing_count=50,
        action_tag=None,
        on_active_memo=False,
        open_quote_price=None,
        position="page_1",
        min_margin_pct=0.05,
    )
    defaults.update(overrides)
    return defaults


def test_frozen_on_active_memo():
    result = price_stone(**_base_kwargs(on_active_memo=True))
    assert result["flag"] == FLAG_FROZEN
    assert result["proposed_price"] == 1200.0
    assert result["pct_change"] == 0.0


def test_frozen_ignores_all_other_factors():
    # Even if stone is very old and CLEAR-tagged, memo freeze wins.
    result = price_stone(**_base_kwargs(on_active_memo=True, age_days=300, action_tag="CLEAR"))
    assert result["flag"] == FLAG_FROZEN


def test_rap_increase_raises_price():
    # Positive wow_change_pct → base price rises.
    flat = price_stone(**_base_kwargs(rap_wow_change_pct=0.0))
    up = price_stone(**_base_kwargs(rap_wow_change_pct=5.0))
    assert up["proposed_price"] > flat["proposed_price"]


def test_rap_decrease_lowers_price():
    # Negative wow_change_pct → base price falls.
    flat = price_stone(**_base_kwargs(rap_wow_change_pct=0.0))
    down = price_stone(**_base_kwargs(rap_wow_change_pct=-5.0))
    assert down["proposed_price"] < flat["proposed_price"]


def test_very_old_stone_discounted():
    young = price_stone(**_base_kwargs(age_days=10))
    old = price_stone(**_base_kwargs(age_days=200))
    assert old["proposed_price"] < young["proposed_price"]


def test_aging_stone_discounted_less_than_very_old():
    aging = price_stone(**_base_kwargs(age_days=100))
    very_old = price_stone(**_base_kwargs(age_days=200))
    assert aging["proposed_price"] > very_old["proposed_price"]


def test_clear_tag_lowers_price_more_than_discount_tag():
    watch = price_stone(**_base_kwargs(action_tag="WATCH"))
    discount = price_stone(**_base_kwargs(action_tag="DISCOUNT"))
    clear = price_stone(**_base_kwargs(action_tag="CLEAR"))
    assert clear["proposed_price"] < discount["proposed_price"] <= watch["proposed_price"]


def test_no_velocity_lowers_price():
    active = price_stone(**_base_kwargs(velocity=5))
    dead = price_stone(**_base_kwargs(velocity=0))
    assert dead["proposed_price"] < active["proposed_price"]


def test_high_demand_raises_price():
    low = price_stone(**_base_kwargs(demand_score=0.2))
    high = price_stone(**_base_kwargs(demand_score=0.9))
    assert high["proposed_price"] > low["proposed_price"]


def test_rank1_position_lowers_price():
    page1 = price_stone(**_base_kwargs(position="page_1"))
    rank1 = price_stone(**_base_kwargs(position="rank_1"))
    assert rank1["proposed_price"] < page1["proposed_price"]


def test_page2_position_raises_price():
    page1 = price_stone(**_base_kwargs(position="page_1"))
    page2 = price_stone(**_base_kwargs(position="page_2"))
    assert page2["proposed_price"] > page1["proposed_price"]


def test_margin_floor_applied_when_proposed_too_low():
    # Rap drops 20% + very old + CLEAR + weak demand → proposed price falls
    # well below cost × 1.05 floor.
    # old_price=1200, cost=1000, floor=1050.
    # base = 1200 * 0.80 = 960; factors add −6% −5% −2% −2% = −15% → 960*0.85 = 816 < 1050.
    result = price_stone(**_base_kwargs(
        cost_basis=1000.0,
        old_price=1200.0,
        rap_wow_change_pct=-20.0,
        age_days=200,
        action_tag="CLEAR",
        demand_score=0.1,
        velocity=0,
        min_margin_pct=0.05,
    ))
    assert result["flag"] == FLAG_MARGIN
    assert result["proposed_price"] == pytest.approx(1050.0, abs=1.0)
    assert result["margin_class"] in ("Conditional", "Unsafe")


def test_quote_flag_when_proposed_below_open_quote():
    # Rap −10% drops price from 1200 to ~1080; open quote is at 1150 → QUOTE flag.
    result = price_stone(**_base_kwargs(
        old_price=1200.0,
        rap_wow_change_pct=-10.0,
        open_quote_price=1150.0,
    ))
    assert result["flag"] == FLAG_QUOTE


def test_no_quote_flag_when_proposed_above_open_quote():
    # Rap +5% raises price from 1200 to ~1260, above the open quote of 1100.
    result = price_stone(**_base_kwargs(
        rap_wow_change_pct=5.0,
        open_quote_price=1100.0,
    ))
    assert result["flag"] != FLAG_QUOTE


def test_unchanged_flag_for_tiny_price_change():
    # Same Rap, no adjustments → price unchanged → UNCHANGED flag.
    result = price_stone(**_base_kwargs(
        age_days=10,
        demand_score=0.5,
        velocity=2,
        listing_count=50,
        position="page_1",
        action_tag=None,
    ))
    assert result["flag"] == FLAG_UNCHANGED


# ---------------------------------------------------------------------------
# compute_repricing — integration tests
# ---------------------------------------------------------------------------


def _one_stone_inventory(stock_id="S001", age=30, status="Available"):
    return _make_inventory([{
        "stock_id": stock_id,
        "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
        "carat": 1.0,
        "age_in_stock_days": age,
        "status": status,
        "p_pcs": 1200.0,
        "cost_basis": 900.0,
    }])


def _one_rap():
    return _make_rap([{
        "rap_week": "2026-05-01",
        "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
        "rap_per_carat": 1200.0,  # unused after formula fix, but kept for schema
        "wow_change_pct": 0.0,
    }])


def test_compute_repricing_returns_one_row_per_available_stone():
    inv = _make_inventory([
        {"stock_id": "S001", "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
         "carat": 1.0, "age_in_stock_days": 30, "status": "Available",
         "p_pcs": 1200.0, "cost_basis": 900.0},
        {"stock_id": "S002", "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
         "carat": 1.0, "age_in_stock_days": 30, "status": "Sold",
         "p_pcs": 1200.0, "cost_basis": 900.0},
    ])
    result = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), _make_memos(), _make_quotes(),
        today=TODAY,
    )
    assert len(result) == 1
    assert result["stock_id"][0] == "S001"


def test_compute_repricing_freezes_active_memo_stone():
    inv = _one_stone_inventory("S001")
    memos = _make_memos([{
        "memo_id": "M001",
        "stock_id": "S001",
        "decision": "Approved",
        "closed_outcome": "",
        "expiry_date": "2026-05-10",
        "marketplace_lock_status": "Locked",
    }])
    result = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), memos, _make_quotes(),
        today=TODAY,
    )
    assert result["flag"][0] == FLAG_FROZEN


def test_compute_repricing_does_not_freeze_expired_memo():
    inv = _one_stone_inventory("S001")
    memos = _make_memos([{
        "memo_id": "M001",
        "stock_id": "S001",
        "decision": "Approved",
        "closed_outcome": "",
        "expiry_date": "2026-01-01",  # already expired
        "marketplace_lock_status": "Unlocked",
    }])
    result = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), memos, _make_quotes(),
        today=TODAY,
    )
    assert result["flag"][0] != FLAG_FROZEN


def test_compute_repricing_triage_tags_applied():
    inv = _one_stone_inventory("S001", age=200)
    result_without = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), _make_memos(), _make_quotes(),
        today=TODAY,
    )
    result_with = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), _make_memos(), _make_quotes(),
        triage_tags={"S001": "CLEAR"},
        today=TODAY,
    )
    assert result_with["proposed_price"][0] <= result_without["proposed_price"][0]


def test_compute_repricing_empty_inventory_returns_empty():
    inv = _make_inventory([])
    result = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), _make_memos(), _make_quotes(),
        today=TODAY,
    )
    assert result.is_empty()


def test_compute_repricing_margin_flags_sorted_first():
    inv = _make_inventory([
        {"stock_id": "SAFE", "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
         "carat": 1.0, "age_in_stock_days": 30, "status": "Available",
         "p_pcs": 1200.0, "cost_basis": 900.0},
        {"stock_id": "MARGINED", "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
         "carat": 1.0, "age_in_stock_days": 30, "status": "Available",
         "p_pcs": 1200.0, "cost_basis": 2000.0},  # cost > old_price → margin breach
    ])
    result = compute_repricing(
        inv, _one_rap(), _make_sales(), _make_demand(), _make_memos(), _make_quotes(),
        today=TODAY,
    )
    assert result["flag"][0] == FLAG_MARGIN


# ---------------------------------------------------------------------------
# batch_summary
# ---------------------------------------------------------------------------


def test_batch_summary_counts_are_correct():
    result = compute_repricing(
        _one_stone_inventory("S001"),
        _one_rap(),
        _make_sales(),
        _make_demand(),
        _make_memos(),
        _make_quotes(),
        today=TODAY,
    )
    summary = batch_summary(result)
    assert "1 stones repriced" in summary


def test_batch_summary_empty():
    summary = batch_summary(repricing_skill._empty_result())
    assert "0 stones" in summary


# ---------------------------------------------------------------------------
# format_table
# ---------------------------------------------------------------------------


def test_format_table_contains_stock_id():
    result = compute_repricing(
        _one_stone_inventory("S001"),
        _one_rap(),
        _make_sales(),
        _make_demand(),
        _make_memos(),
        _make_quotes(),
        today=TODAY,
    )
    table = format_table(result, top=5)
    assert "S001" in table


def test_format_table_empty():
    table = format_table(repricing_skill._empty_result())
    assert "no available stones" in table


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------


def test_cli_runs_without_error(tmp_path, capsys):
    """Verify the CLI completes and prints a header + table line."""
    import importlib

    # Use real seed CSVs.
    data_dir = Path(__file__).resolve().parents[2] / "data" / "Milestone_2"
    if not (data_dir / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")

    exit_code = repricing_skill.main(["--data-dir", str(data_dir), "--top", "5"])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "stones repriced" in captured.out
    assert "|" in captured.out  # table rows


def test_cli_json_flag(tmp_path, capsys):
    data_dir = Path(__file__).resolve().parents[2] / "data" / "Milestone_2"
    if not (data_dir / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")

    repricing_skill.main(["--data-dir", str(data_dir), "--json", "--top", "3"])
    captured = capsys.readouterr()
    rows = json.loads(captured.out)
    assert isinstance(rows, list)
    assert len(rows) <= 3
    assert "stock_id" in rows[0]
    assert "proposed_price" in rows[0]
