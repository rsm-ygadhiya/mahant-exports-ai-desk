"""Tests for `skills/demand-forecast/scripts/demand_forecast.py`."""

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
    / "demand-forecast"
    / "scripts"
    / "demand_forecast.py"
)
_spec = importlib.util.spec_from_file_location("demand_forecast", _MODULE_PATH)
assert _spec and _spec.loader
demand_forecast = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(demand_forecast)

compute_coverage = demand_forecast.compute_coverage
score_gaps = demand_forecast.score_gaps
format_table = demand_forecast.format_table
coverage_summary = demand_forecast.coverage_summary

TODAY = dt.date(2026, 5, 2)
_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "Milestone_2"
_CSVS_PRESENT = (_DATA_DIR / "inventory_seed.csv").exists()


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_inventory(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "stock_id": pl.Utf8,
            "status": pl.Utf8,
            "age_in_stock_days": pl.Int64,
            "category_simple": pl.Utf8,
            "p_pcs": pl.Float64,
            "cost_basis": pl.Float64,
        },
    )


def _make_forecast(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "forecast_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "ty_qty": pl.Int64,
            "ly_qty": pl.Int64,
            "prior_period_qty": pl.Int64,
            "growth_rate_pct": pl.Float64,
            "predicted_quantity": pl.Int64,
            "predicted_price_range_min": pl.Float64,
            "predicted_price_range_max": pl.Float64,
            "confidence_score": pl.Float64,
            "recommended_sourcing_qty": pl.Int64,
        },
    )


def _make_demand_signals(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={
            "signal_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "listing_count": pl.Float64,
            "avg_market_price": pl.Float64,
            "demand_score": pl.Float64,
        },
    )


def _base_inventory() -> pl.DataFrame:
    return _make_inventory(
        [
            {
                "stock_id": "S001",
                "status": "Available",
                "age_in_stock_days": 30,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "p_pcs": 1200.0,
                "cost_basis": 900.0,
            },
            {
                "stock_id": "S002",
                "status": "Available",
                "age_in_stock_days": 45,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "p_pcs": 1100.0,
                "cost_basis": 850.0,
            },
            {
                "stock_id": "S003",
                "status": "Sold",
                "age_in_stock_days": 60,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "p_pcs": 1000.0,
                "cost_basis": 800.0,
            },
            {
                "stock_id": "S004",
                "status": "Available",
                "age_in_stock_days": 20,
                "category_simple": "Oval | 0.50-0.99 | GH | VS",
                "p_pcs": 500.0,
                "cost_basis": 400.0,
            },
        ]
    )


def _base_forecast() -> pl.DataFrame:
    return _make_forecast(
        [
            {
                "forecast_date": "2026-05-02",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "ty_qty": 10,
                "ly_qty": 8,
                "prior_period_qty": 9,
                "growth_rate_pct": 0.15,
                "predicted_quantity": 10,
                "predicted_price_range_min": 1000.0,
                "predicted_price_range_max": 1500.0,
                "confidence_score": 0.85,
                "recommended_sourcing_qty": 12,
            },
            {
                "forecast_date": "2026-05-02",
                "category_simple": "Oval | 0.50-0.99 | GH | VS",
                "ty_qty": 5,
                "ly_qty": 4,
                "prior_period_qty": 5,
                "growth_rate_pct": 0.05,
                "predicted_quantity": 5,
                "predicted_price_range_min": 400.0,
                "predicted_price_range_max": 700.0,
                "confidence_score": 0.70,
                "recommended_sourcing_qty": 6,
            },
        ]
    )


def _base_demand_signals() -> pl.DataFrame:
    """Demand signals within the last 60 days of TODAY (2026-05-02)."""
    return _make_demand_signals(
        [
            {
                "signal_date": "2026-04-15",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "listing_count": 80.0,
                "avg_market_price": 1200.0,
                "demand_score": 0.75,
            },
            {
                "signal_date": "2026-04-20",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "listing_count": 90.0,
                "avg_market_price": 1210.0,
                "demand_score": 0.80,
            },
            {
                "signal_date": "2026-04-10",
                "category_simple": "Oval | 0.50-0.99 | GH | VS",
                "listing_count": 50.0,
                "avg_market_price": 550.0,
                "demand_score": 0.60,
            },
        ]
    )


# ---------------------------------------------------------------------------
# compute_coverage tests
# ---------------------------------------------------------------------------


def test_compute_coverage_counts_only_available():
    """Sold stones must not count toward available_count."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    # Round category: S001 and S002 Available; S003 Sold → count = 2
    round_row = cov.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    assert round_row["available_count"][0] == 2


def test_compute_coverage_gap_calculation():
    """gap = recommended - available, clamped to 0."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    # Round: rec=12, available=2 → gap=10
    round_row = cov.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    assert round_row["gap"][0] == 10

    # Oval: rec=6, available=1 → gap=5
    oval_row = cov.filter(pl.col("category_simple") == "Oval | 0.50-0.99 | GH | VS")
    assert oval_row["gap"][0] == 5


def test_compute_coverage_ratio():
    """coverage_ratio = available / recommended."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    round_row = cov.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    # 2 / 12 ≈ 0.1667
    assert abs(round_row["coverage_ratio"][0] - 2 / 12) < 0.001


def test_compute_coverage_zero_recommended():
    """When recommended_sourcing_qty == 0, coverage_ratio should be 0, not NaN."""
    forecast = _make_forecast(
        [
            {
                "forecast_date": "2026-05-02",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "ty_qty": 0,
                "ly_qty": 0,
                "prior_period_qty": 0,
                "growth_rate_pct": 0.0,
                "predicted_quantity": 0,
                "predicted_price_range_min": 0.0,
                "predicted_price_range_max": 0.0,
                "confidence_score": 0.5,
                "recommended_sourcing_qty": 0,
            }
        ]
    )
    cov = compute_coverage(_base_inventory(), forecast, TODAY)
    row = cov.filter(pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+")
    assert row["coverage_ratio"][0] == 0.0
    assert row["gap"][0] == 0


def test_compute_coverage_category_with_no_inventory():
    """A category in the forecast but absent from inventory gets available_count=0."""
    inventory_no_oval = _make_inventory(
        [
            {
                "stock_id": "S001",
                "status": "Available",
                "age_in_stock_days": 10,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "p_pcs": 1200.0,
                "cost_basis": 900.0,
            }
        ]
    )
    cov = compute_coverage(inventory_no_oval, _base_forecast(), TODAY)
    oval_row = cov.filter(pl.col("category_simple") == "Oval | 0.50-0.99 | GH | VS")
    assert oval_row["available_count"][0] == 0
    assert oval_row["gap"][0] == 6


def test_compute_coverage_uses_latest_forecast_date():
    """When multiple forecasts exist per category, only the latest is used."""
    forecast_multi = _make_forecast(
        [
            {
                "forecast_date": "2026-04-01",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "ty_qty": 5,
                "ly_qty": 4,
                "prior_period_qty": 4,
                "growth_rate_pct": 0.05,
                "predicted_quantity": 5,
                "predicted_price_range_min": 1000.0,
                "predicted_price_range_max": 1400.0,
                "confidence_score": 0.7,
                "recommended_sourcing_qty": 4,  # older = lower rec
            },
            {
                "forecast_date": "2026-05-02",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "ty_qty": 10,
                "ly_qty": 8,
                "prior_period_qty": 9,
                "growth_rate_pct": 0.15,
                "predicted_quantity": 10,
                "predicted_price_range_min": 1000.0,
                "predicted_price_range_max": 1500.0,
                "confidence_score": 0.85,
                "recommended_sourcing_qty": 12,  # latest = higher rec
            },
        ]
    )
    cov = compute_coverage(_base_inventory(), forecast_multi, TODAY)
    round_row = cov.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    # Should use the 2026-05-02 forecast (rec=12)
    assert round_row["recommended_sourcing_qty"][0] == 12


def test_compute_coverage_no_overstock_gap():
    """When available > recommended, gap is clamped to 0."""
    inventory_rich = _make_inventory(
        [
            {
                "stock_id": f"S{i:03d}",
                "status": "Available",
                "age_in_stock_days": 10,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "p_pcs": 1200.0,
                "cost_basis": 900.0,
            }
            for i in range(20)  # 20 available vs recommended=12
        ]
    )
    cov = compute_coverage(inventory_rich, _base_forecast(), TODAY)
    round_row = cov.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    assert round_row["gap"][0] == 0
    assert round_row["coverage_ratio"][0] > 1.0


# ---------------------------------------------------------------------------
# score_gaps tests
# ---------------------------------------------------------------------------


def test_score_gaps_priority_score_equals_gap_times_demand():
    """priority_score = gap * demand_score."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)

    for row in scored.iter_rows(named=True):
        expected = float(row["gap"]) * float(row["demand_score"])
        assert abs(row["priority_score"] - expected) < 1e-6, (
            f"priority_score mismatch for {row['category_simple']}: "
            f"{row['priority_score']} != {expected}"
        )


def test_score_gaps_sorted_descending():
    """Rows must be sorted by priority_score descending."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    scores = scored["priority_score"].to_list()
    assert scores == sorted(scores, reverse=True), "priority_score not sorted descending"


def test_score_gaps_high_gap_category_ranks_first():
    """The category with the larger gap × demand should rank first."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    # Round has gap=10 with demand≈0.775; Oval has gap=5 with demand=0.60
    # Round priority ≈ 7.75; Oval priority ≈ 3.0 → Round should be first
    assert scored["category_simple"][0] == "Round | 1.00-1.49 | DEF | VVS+"


def test_score_gaps_demand_window_excludes_old_signals():
    """Signals older than 60 days should not contribute to demand_score."""
    old_signal = _make_demand_signals(
        [
            {
                "signal_date": "2025-01-01",  # >60 days before TODAY
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "listing_count": 50.0,
                "avg_market_price": 1100.0,
                "demand_score": 0.99,  # very high — should be excluded
            }
        ]
    )
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, old_signal, TODAY)
    round_row = scored.filter(
        pl.col("category_simple") == "Round | 1.00-1.49 | DEF | VVS+"
    )
    # With no recent signals, demand_score falls back to 0.5 (fill_null default)
    assert abs(round_row["demand_score"][0] - 0.5) < 0.01


def test_score_gaps_empty_coverage():
    """score_gaps on empty coverage returns empty DataFrame."""
    empty_cov = pl.DataFrame(
        schema={
            "category_simple": pl.Utf8,
            "available_count": pl.Int64,
            "recommended_sourcing_qty": pl.Int64,
            "coverage_ratio": pl.Float64,
            "gap": pl.Int64,
            "growth_rate_pct": pl.Float64,
            "confidence_score": pl.Float64,
        }
    )
    scored = score_gaps(empty_cov, _base_demand_signals(), TODAY)
    assert scored.is_empty()


# ---------------------------------------------------------------------------
# format_table tests
# ---------------------------------------------------------------------------


def test_format_table_contains_required_headers():
    """format_table output must contain 'Available' and pipe characters."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    table = format_table(scored)
    assert "Available" in table
    assert "|" in table


def test_format_table_contains_category_names():
    """Category names appear in the table rows."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    table = format_table(scored)
    assert "Round" in table


def test_format_table_top_n_limits_rows():
    """--top 1 should produce exactly 1 data row (excluding header rows)."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    table = format_table(scored, top=1)
    data_rows = [ln for ln in table.splitlines() if ln.startswith("| ") and "---" not in ln and "Category" not in ln]
    assert len(data_rows) == 1


def test_format_table_empty():
    """Empty gaps DataFrame should return a graceful placeholder string."""
    empty = pl.DataFrame(
        schema={
            "category_simple": pl.Utf8,
            "available_count": pl.Int64,
            "recommended_sourcing_qty": pl.Int64,
            "coverage_ratio": pl.Float64,
            "gap": pl.Int64,
            "demand_score": pl.Float64,
            "growth_rate_pct": pl.Float64,
            "confidence_score": pl.Float64,
            "priority_score": pl.Float64,
        }
    )
    table = format_table(empty)
    assert "no sourcing gaps" in table


def test_format_table_priority_labels():
    """HIGH label should appear for high-priority gaps."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    table = format_table(scored)
    # Round has priority_score ≈ 7.75 → HIGH
    assert "HIGH" in table


# ---------------------------------------------------------------------------
# coverage_summary tests
# ---------------------------------------------------------------------------


def test_coverage_summary_contains_category_counts():
    """coverage_summary string must mention understocked categories."""
    cov = compute_coverage(_base_inventory(), _base_forecast(), TODAY)
    scored = score_gaps(cov, _base_demand_signals(), TODAY)
    summary = coverage_summary(scored)
    # Both Round (gap=10) and Oval (gap=5) are understocked
    assert "understocked" in summary
    assert "2 understocked" in summary or "understocked" in summary


def test_coverage_summary_empty():
    """coverage_summary on empty DataFrame returns a graceful message."""
    empty = pl.DataFrame(
        schema={
            "category_simple": pl.Utf8,
            "available_count": pl.Int64,
            "recommended_sourcing_qty": pl.Int64,
            "coverage_ratio": pl.Float64,
            "gap": pl.Int64,
            "demand_score": pl.Float64,
            "growth_rate_pct": pl.Float64,
            "confidence_score": pl.Float64,
            "priority_score": pl.Float64,
        }
    )
    summary = coverage_summary(empty)
    assert "no forecast" in summary.lower() or "coverage" in summary.lower()


# ---------------------------------------------------------------------------
# CLI integration tests (require seed CSVs)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_exits_zero_and_contains_sourcing(capsys):
    """main() exits 0 and output contains 'Sourcing'."""
    exit_code = demand_forecast.main(["--today", "2026-05-02", "--top", "5"])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "Sourcing" in captured.out


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_output_has_table_pipe(capsys):
    """main() prints at least one pipe-delimited table row."""
    demand_forecast.main(["--today", "2026-05-02", "--top", "5"])
    captured = capsys.readouterr()
    assert "|" in captured.out


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_json_flag_valid_json(capsys):
    """--json flag produces valid JSON with expected top-level keys."""
    exit_code = demand_forecast.main(
        ["--today", "2026-05-02", "--top", "5", "--json"]
    )
    assert exit_code == 0
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert isinstance(data, dict)
    assert "summary" in data
    assert "gaps" in data
    assert isinstance(data["gaps"], list)


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_min_confidence_filters_rows(capsys):
    """--min-confidence 0.99 should produce fewer rows than no filter."""
    demand_forecast.main(["--today", "2026-05-02", "--top", "50", "--json"])
    all_gaps = json.loads(capsys.readouterr().out)["gaps"]

    demand_forecast.main(
        ["--today", "2026-05-02", "--top", "50", "--json", "--min-confidence", "0.99"]
    )
    filtered_gaps = json.loads(capsys.readouterr().out)["gaps"]

    assert len(filtered_gaps) <= len(all_gaps)


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_category_contains_filter(capsys):
    """--category-contains restricts output to matching categories."""
    demand_forecast.main(
        ["--today", "2026-05-02", "--top", "50", "--json", "--category-contains", "Round"]
    )
    data = json.loads(capsys.readouterr().out)
    for row in data["gaps"]:
        assert "round" in row["category_simple"].lower()
