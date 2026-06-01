"""Tests for `skills/inventory-aging-triage/scripts/inventory_aging_skill.py`."""

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
    / "inventory-aging-triage"
    / "scripts"
    / "inventory_aging_skill.py"
)
_spec = importlib.util.spec_from_file_location("inventory_aging_skill", _MODULE_PATH)
assert _spec and _spec.loader
inventory_aging_skill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inventory_aging_skill)

classify_stone = inventory_aging_skill.classify_stone
triage_inventory = inventory_aging_skill.triage_inventory
aggregate_counts = inventory_aging_skill.aggregate_counts
header_line = inventory_aging_skill.header_line
format_table = inventory_aging_skill.format_table
ACTION_TAGS = inventory_aging_skill.ACTION_TAGS


# ----------------------------------------------------------------------------
# classify_stone — rule branches
# ----------------------------------------------------------------------------


def test_young_stone_is_held():
    tag, move, _ = classify_stone(age_days=10, demand_score=0.1, velocity=0, inquiries=0)
    assert tag == "HOLD"
    assert move == 0.0


def test_young_stone_held_even_with_low_demand():
    # Age dominates: anything <30 days is HOLD regardless.
    tag, move, _ = classify_stone(
        age_days=29, demand_score=0.05, velocity=0, inquiries=0
    )
    assert tag == "HOLD"
    assert move == 0.0


def test_mid_age_high_demand_is_held():
    tag, move, _ = classify_stone(age_days=60, demand_score=0.8, velocity=0, inquiries=0)
    assert tag == "HOLD"
    assert move == 0.0


def test_mid_age_high_velocity_is_held():
    # Even with low demand score, ≥2 recent sales keeps it on HOLD.
    tag, _, _ = classify_stone(age_days=60, demand_score=0.2, velocity=2, inquiries=0)
    assert tag == "HOLD"


def test_mid_age_soft_signals_is_watched():
    tag, move, _ = classify_stone(age_days=60, demand_score=0.3, velocity=0, inquiries=0)
    assert tag == "WATCH"
    assert move == 0.0


def test_old_high_demand_is_watched():
    tag, _, _ = classify_stone(age_days=120, demand_score=0.7, velocity=0, inquiries=0)
    assert tag == "WATCH"


def test_old_mid_demand_discounts_seven():
    tag, move, _ = classify_stone(
        age_days=120, demand_score=0.5, velocity=0, inquiries=0
    )
    assert tag == "DISCOUNT"
    assert move == 7.0


def test_old_low_demand_discounts_twelve():
    tag, move, _ = classify_stone(
        age_days=150, demand_score=0.2, velocity=0, inquiries=0
    )
    assert tag == "DISCOUNT"
    assert move == 12.0


def test_very_old_high_demand_discounts_ten():
    tag, move, _ = classify_stone(
        age_days=200, demand_score=0.7, velocity=0, inquiries=0
    )
    assert tag == "DISCOUNT"
    assert move == 10.0


def test_very_old_mid_demand_with_inquiries_discounts():
    # Active inquiries pull it off the CLEAR pile.
    tag, move, _ = classify_stone(
        age_days=210, demand_score=0.5, velocity=0, inquiries=3
    )
    assert tag == "DISCOUNT"
    assert move == 15.0


def test_very_old_mid_demand_no_inquiries_clears():
    tag, move, _ = classify_stone(
        age_days=210, demand_score=0.5, velocity=0, inquiries=0
    )
    assert tag == "CLEAR"
    assert move == 22.0


def test_very_old_low_demand_clears_aggressively():
    tag, move, _ = classify_stone(
        age_days=400, demand_score=0.1, velocity=0, inquiries=0
    )
    assert tag == "CLEAR"
    assert move == 28.0


def test_classify_stone_always_returns_known_tag():
    # Property check: every reasonable input must map to a known tag.
    for age in (5, 30, 89, 90, 179, 180, 365):
        for demand in (0.0, 0.39, 0.40, 0.59, 0.60, 1.0):
            for velocity in (0, 1, 5):
                for inquiries in (0, 1, 10):
                    tag, _, _ = classify_stone(
                        age_days=age,
                        demand_score=demand,
                        velocity=velocity,
                        inquiries=inquiries,
                    )
                    assert tag in ACTION_TAGS


# ----------------------------------------------------------------------------
# triage_inventory — full pipeline on synthetic data
# ----------------------------------------------------------------------------


def _make_inventory(rows: list[dict]) -> pl.DataFrame:
    """Build a minimal inventory frame with just the columns triage reads."""
    return pl.DataFrame(rows, schema_overrides={"age_in_stock_days": pl.Int64})


def _empty_sales() -> pl.DataFrame:
    return pl.DataFrame(
        schema={"transaction_date": pl.Utf8, "category_simple": pl.Utf8}
    )


def _empty_demand() -> pl.DataFrame:
    return pl.DataFrame(
        schema={
            "signal_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "demand_score": pl.Float64,
        }
    )


def _empty_comms() -> pl.DataFrame:
    return pl.DataFrame(
        schema={
            "message_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "negotiation_status": pl.Utf8,
        }
    )


def test_only_available_stones_get_triaged():
    inv = _make_inventory(
        [
            {
                "stock_id": "A",
                "status": "Available",
                "age_in_stock_days": 10,
                "category_simple": "Round | 1.00-1.49 | DEF | VS",
                "p_pcs": 1000.0,
            },
            {
                "stock_id": "B",
                "status": "Sold",
                "age_in_stock_days": 200,
                "category_simple": "Round | 1.00-1.49 | DEF | VS",
                "p_pcs": 1000.0,
            },
            {
                "stock_id": "C",
                "status": "Hold",
                "age_in_stock_days": 200,
                "category_simple": "Round | 1.00-1.49 | DEF | VS",
                "p_pcs": 1000.0,
            },
        ]
    )
    out = triage_inventory(
        inv, _empty_sales(), _empty_demand(), _empty_comms(), today=dt.date(2026, 5, 2)
    )
    assert set(out["stock_id"].to_list()) == {"A"}


def test_empty_inventory_returns_empty_frame_with_schema():
    empty_inv = pl.DataFrame(
        schema={
            "stock_id": pl.Utf8,
            "status": pl.Utf8,
            "age_in_stock_days": pl.Int64,
            "category_simple": pl.Utf8,
            "p_pcs": pl.Float64,
        }
    )
    out = triage_inventory(
        empty_inv,
        _empty_sales(),
        _empty_demand(),
        _empty_comms(),
        today=dt.date(2026, 5, 2),
    )
    assert out.is_empty()
    # Schema columns should still be present
    for col in ("stock_id", "action_tag", "suggested_price_move_pct", "reason"):
        assert col in out.columns


def test_triage_sorts_by_urgency_then_age():
    # Same category for all rows so signals are consistent; age varies.
    cat = "Round | 1.00-1.49 | DEF | VS"
    rows = [
        {"stock_id": "young", "status": "Available", "age_in_stock_days": 5,
         "category_simple": cat, "p_pcs": 1000.0},
        {"stock_id": "old_b", "status": "Available", "age_in_stock_days": 200,
         "category_simple": cat, "p_pcs": 1000.0},
        {"stock_id": "old_a", "status": "Available", "age_in_stock_days": 365,
         "category_simple": cat, "p_pcs": 1000.0},
    ]
    out = triage_inventory(
        _make_inventory(rows),
        _empty_sales(),
        _empty_demand(),
        _empty_comms(),
        today=dt.date(2026, 5, 2),
    )
    ids = out["stock_id"].to_list()
    # Both old stones should be CLEAR (low demand, no inquiries) and come first;
    # within CLEAR, oldest first.
    assert ids == ["old_a", "old_b", "young"]


def test_triage_uses_demand_signal_to_avoid_clearing_active_categories():
    cat_hot = "Hot"
    cat_cold = "Cold"
    inv = _make_inventory(
        [
            {"stock_id": "hot", "status": "Available", "age_in_stock_days": 250,
             "category_simple": cat_hot, "p_pcs": 1000.0},
            {"stock_id": "cold", "status": "Available", "age_in_stock_days": 250,
             "category_simple": cat_cold, "p_pcs": 1000.0},
        ]
    )
    today = dt.date(2026, 5, 2)
    demand = pl.DataFrame(
        {
            "signal_date": [today.isoformat()] * 2,
            "category_simple": [cat_hot, cat_cold],
            "demand_score": [0.85, 0.10],
        }
    )
    out = triage_inventory(
        inv, _empty_sales(), demand, _empty_comms(), today=today
    )
    by_id = {r["stock_id"]: r for r in out.iter_rows(named=True)}
    assert by_id["hot"]["action_tag"] == "DISCOUNT"  # very old + high demand → DISCOUNT 10%
    assert by_id["cold"]["action_tag"] == "CLEAR"  # very old + low demand → CLEAR 28%


# ----------------------------------------------------------------------------
# aggregate_counts + header_line + format_table
# ----------------------------------------------------------------------------


def test_aggregate_counts_includes_all_tags_even_zero():
    empty = inventory_aging_skill._empty_result()
    counts = aggregate_counts(empty)
    assert set(counts.keys()) == set(ACTION_TAGS)
    assert all(v == 0 for v in counts.values())


def test_header_line_format():
    cat = "C"
    inv = _make_inventory(
        [
            {"stock_id": str(i), "status": "Available", "age_in_stock_days": 250,
             "category_simple": cat, "p_pcs": 1000.0}
            for i in range(3)
        ]
    )
    out = triage_inventory(
        inv,
        _empty_sales(),
        _empty_demand(),
        _empty_comms(),
        today=dt.date(2026, 5, 2),
    )
    line = header_line(out)
    assert line.startswith("3 available stones")
    for tag in ACTION_TAGS:
        assert tag in line


def test_format_table_handles_empty():
    empty = inventory_aging_skill._empty_result()
    rendered = format_table(empty)
    assert "no available stones" in rendered.lower()


def test_format_table_top_truncates():
    cat = "C"
    inv = _make_inventory(
        [
            {"stock_id": f"s{i}", "status": "Available", "age_in_stock_days": 100,
             "category_simple": cat, "p_pcs": 1000.0}
            for i in range(50)
        ]
    )
    out = triage_inventory(
        inv,
        _empty_sales(),
        _empty_demand(),
        _empty_comms(),
        today=dt.date(2026, 5, 2),
    )
    rendered = format_table(out, top=5)
    # 5 data rows + 1 header row + 1 separator row = 7 lines
    assert rendered.count("\n") == 6


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def _write_minimal_csvs(tmp_path: Path) -> Path:
    """Drop minimal CSVs in the layout the script expects."""
    inv = pl.DataFrame(
        [
            {"stock_id": "A", "status": "Available", "age_in_stock_days": 250,
             "category_simple": "Round | 1.00-1.49 | DEF | VS", "p_pcs": 1500.0,
             "sr_no": 1, "add_date": "2025-08-01", "rep_date": "2025-08-01",
             "report_no": "R1", "shape": "Round", "carat": 1.0,
             "color": "F", "clarity": "VS1", "cut": "Excellent",
             "polish": "Excellent", "sym": "Excellent", "rap": 5000.0,
             "discounts_pct": 70.0, "ppc": 1500.0, "cost_basis": 1100.0,
             "measurement": "6.5x6.5x4.0", "table_pct": 60.0, "depth_pct": 60.0,
             "c_a": 34.0, "fl": "None", "growth_type": "Lab-Grown",
             "video": "x", "image": "x", "lab": "IGI", "inscri": "IGI-1",
             "location": "Surat", "country_of_origin": "India",
             "shade": "None", "luster": "High", "eyeclean": "Yes", "milky": "No"},
        ]
    )
    sales = pl.DataFrame(
        schema={"transaction_date": pl.Utf8, "category_simple": pl.Utf8}
    )
    demand = pl.DataFrame(
        {
            "signal_date": ["2026-04-15"],
            "category_simple": ["Round | 1.00-1.49 | DEF | VS"],
            "demand_score": [0.15],
        }
    )
    comms = pl.DataFrame(
        schema={
            "message_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "negotiation_status": pl.Utf8,
        }
    )

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    inv.write_csv(data_dir / "inventory_seed.csv")
    sales.write_csv(data_dir / "sales_transactions_seed.csv")
    demand.write_csv(data_dir / "demand_signals_seed.csv")
    comms.write_csv(data_dir / "communication_logs_seed.csv")
    return data_dir


def test_cli_prints_header_and_table(tmp_path, capsys):
    data_dir = _write_minimal_csvs(tmp_path)
    rc = inventory_aging_skill.main(
        ["--data-dir", str(data_dir), "--today", "2026-05-02"]
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "1 available stones" in out
    assert "CLEAR" in out  # header mentions every tag
    assert "A" in out  # stock_id present in the table


def test_cli_filter_tag_narrows_results(tmp_path, capsys):
    data_dir = _write_minimal_csvs(tmp_path)
    rc = inventory_aging_skill.main(
        [
            "--data-dir",
            str(data_dir),
            "--today",
            "2026-05-02",
            "--filter-tag",
            "HOLD",
        ]
    )
    assert rc == 0
    out = capsys.readouterr().out
    # Only stone is CLEAR-tagged (very old + low demand), so HOLD filter zeros it.
    assert "0 available stones" in out


def test_cli_json_output_is_parseable(tmp_path, capsys):
    data_dir = _write_minimal_csvs(tmp_path)
    rc = inventory_aging_skill.main(
        ["--data-dir", str(data_dir), "--today", "2026-05-02", "--json"]
    )
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert isinstance(payload, list)
    assert payload[0]["stock_id"] == "A"
    assert payload[0]["action_tag"] in ACTION_TAGS


def test_cli_age_min_filters(tmp_path, capsys):
    data_dir = _write_minimal_csvs(tmp_path)
    rc = inventory_aging_skill.main(
        [
            "--data-dir",
            str(data_dir),
            "--today",
            "2026-05-02",
            "--age-min",
            "300",
        ]
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "0 available stones" in out  # the only stone is 250 days old
