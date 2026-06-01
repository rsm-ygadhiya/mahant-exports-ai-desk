"""Tests for `skills/morning-briefing/scripts/morning_briefing.py`."""

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
    / "morning-briefing"
    / "scripts"
    / "morning_briefing.py"
)
_spec = importlib.util.spec_from_file_location("morning_briefing", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

get_aging_actions = mod.get_aging_actions
get_collection_alerts = mod.get_collection_alerts
get_open_negotiations = mod.get_open_negotiations
get_expiring_quotes = mod.get_expiring_quotes
format_briefing = mod.format_briefing
_triage_tag = mod._triage_tag
_demand_by_category = mod._demand_by_category

TODAY = dt.date(2026, 5, 4)


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _inventory(*rows):
    return pl.DataFrame(
        list(rows),
        schema={
            "stock_id": pl.Utf8,
            "status": pl.Utf8,
            "age_in_stock_days": pl.Int64,
            "category_simple": pl.Utf8,
            "p_pcs": pl.Float64,
            "cost_basis": pl.Float64,
        },
    )


def _inv_row(sid, status, age, cat="Round | 1.00-1.49 | DEF | VVS+", ppc=1000.0, cost=800.0):
    return {
        "stock_id": sid,
        "status": status,
        "age_in_stock_days": age,
        "category_simple": cat,
        "p_pcs": ppc,
        "cost_basis": cost,
    }


def _demand_signals(*rows):
    return pl.DataFrame(
        list(rows),
        schema={
            "signal_date": pl.Utf8,
            "category_simple": pl.Utf8,
            "listing_count": pl.Int64,
            "demand_score": pl.Float64,
        },
    )


def _demand_row(date, cat, score, count=50):
    return {
        "signal_date": date,
        "category_simple": cat,
        "listing_count": count,
        "demand_score": score,
    }


def _sales(*rows):
    return pl.DataFrame(
        list(rows),
        schema={
            "invoice_id": pl.Utf8,
            "customer_id": pl.Utf8,
            "sold_price": pl.Float64,
            "payment_status": pl.Utf8,
            "due_date": pl.Utf8,
            "invoice_date": pl.Utf8,
        },
    )


def _sale_row(inv, cust, price, status, due):
    return {
        "invoice_id": inv,
        "customer_id": cust,
        "sold_price": price,
        "payment_status": status,
        "due_date": due,
        "invoice_date": "2026-01-01",
    }


def _threads(*rows):
    return pl.DataFrame(
        list(rows),
        schema={
            "thread_id": pl.Utf8,
            "customer_id": pl.Utf8,
            "stock_id": pl.Utf8,
            "category_simple": pl.Utf8,
            "status": pl.Utf8,
            "last_message_date": pl.Utf8,
            "last_offer": pl.Float64,
        },
    )


def _thread_row(tid, cust, sid, status, last_date, offer=0.0):
    return {
        "thread_id": tid,
        "customer_id": cust,
        "stock_id": sid,
        "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
        "status": status,
        "last_message_date": last_date,
        "last_offer": offer,
    }


def _quotes(*rows):
    return pl.DataFrame(
        list(rows),
        schema={
            "quote_id": pl.Utf8,
            "quote_date": pl.Utf8,
            "customer_id": pl.Utf8,
            "stock_id": pl.Utf8,
            "offered_price": pl.Float64,
            "quote_outcome": pl.Utf8,
            "customer_offer": pl.Float64,
            "category_simple": pl.Utf8,
        },
    )


def _quote_row(qid, date, cust, sid, offered, outcome, counter=None):
    return {
        "quote_id": qid,
        "quote_date": date,
        "customer_id": cust,
        "stock_id": sid,
        "offered_price": offered,
        "quote_outcome": outcome,
        "customer_offer": counter,
        "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
    }


def _empty_customers():
    return pl.DataFrame(
        schema={
            "customer_id": pl.Utf8,
            "customer_name": pl.Utf8,
            "clv_tier": pl.Utf8,
        }
    )


# ---------------------------------------------------------------------------
# _triage_tag — unit tests
# ---------------------------------------------------------------------------


def test_triage_tag_clear_at_180():
    assert _triage_tag(180, 0.3) == "CLEAR"


def test_triage_tag_clear_above_180():
    assert _triage_tag(365, 0.8) == "CLEAR"


def test_triage_tag_discount_at_90():
    assert _triage_tag(90, 0.2) == "DISCOUNT"


def test_triage_tag_discount_at_179():
    assert _triage_tag(179, 0.6) == "DISCOUNT"


def test_triage_tag_hold_below_90():
    assert _triage_tag(89, 0.1) == "HOLD"


def test_triage_tag_hold_at_zero():
    assert _triage_tag(0, 0.0) == "HOLD"


# ---------------------------------------------------------------------------
# _demand_by_category — unit tests
# ---------------------------------------------------------------------------


def test_demand_by_category_basic():
    signals = _demand_signals(
        _demand_row("2026-04-20", "Round | 1.00-1.49 | DEF | VVS+", 0.7),
        _demand_row("2026-04-15", "Round | 1.00-1.49 | DEF | VVS+", 0.3),
    )
    result = _demand_by_category(signals, TODAY)
    cat = "Round | 1.00-1.49 | DEF | VVS+"
    assert cat in result
    assert abs(result[cat] - 0.5) < 0.01


def test_demand_by_category_excludes_old_signals():
    signals = _demand_signals(
        _demand_row("2025-01-01", "Round | 1.00-1.49 | DEF | VVS+", 0.9),
    )
    result = _demand_by_category(signals, TODAY)
    assert "Round | 1.00-1.49 | DEF | VVS+" not in result


def test_demand_by_category_empty():
    result = _demand_by_category(_demand_signals(), TODAY)
    assert result == {}


# ---------------------------------------------------------------------------
# get_aging_actions
# ---------------------------------------------------------------------------


def test_aging_actions_returns_dataframe():
    inv = _inventory(
        _inv_row("LGSTK001", "Available", 200),
        _inv_row("LGSTK002", "Available", 50),
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    assert isinstance(result, pl.DataFrame)


def test_aging_actions_clear_stones_have_age_ge_180():
    inv = _inventory(
        _inv_row("LGSTK001", "Available", 200),
        _inv_row("LGSTK002", "Available", 100),
        _inv_row("LGSTK003", "Available", 30),
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    clear = result.filter(pl.col("tag") == "CLEAR")
    for row in clear.iter_rows(named=True):
        assert row["age_in_stock_days"] >= 180


def test_aging_actions_excludes_stones_under_90_days():
    inv = _inventory(
        _inv_row("LGSTK001", "Available", 89),
        _inv_row("LGSTK002", "Available", 50),
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    assert result.is_empty()


def test_aging_actions_excludes_non_available():
    inv = _inventory(
        _inv_row("LGSTK001", "Sold", 200),
        _inv_row("LGSTK002", "On Memo", 200),
        _inv_row("LGSTK003", "Available", 200),
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    assert len(result) == 1
    assert result["stock_id"][0] == "LGSTK003"


def test_aging_actions_clear_comes_before_discount():
    inv = _inventory(
        _inv_row("LGSTK001", "Available", 100),  # DISCOUNT
        _inv_row("LGSTK002", "Available", 200),  # CLEAR
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    assert result["tag"][0] == "CLEAR"
    assert result["tag"][1] == "DISCOUNT"


def test_aging_actions_oldest_first_within_tag():
    inv = _inventory(
        _inv_row("LGSTK001", "Available", 200),
        _inv_row("LGSTK002", "Available", 350),
        _inv_row("LGSTK003", "Available", 250),
    )
    signals = _demand_signals()
    result = get_aging_actions(inv, signals, TODAY)
    clear_rows = result.filter(pl.col("tag") == "CLEAR")
    ages = clear_rows["age_in_stock_days"].to_list()
    assert ages == sorted(ages, reverse=True)


def test_aging_actions_empty_inventory():
    result = get_aging_actions(_inventory(), _demand_signals(), TODAY)
    assert isinstance(result, pl.DataFrame)
    assert result.is_empty()


def test_aging_actions_top_n_respected():
    rows = [_inv_row(f"LGSTK{i:03d}", "Available", 200 + i) for i in range(20)]
    inv = pl.DataFrame(
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
    result = get_aging_actions(inv, _demand_signals(), TODAY, top_n=5)
    assert len(result) <= 5


# ---------------------------------------------------------------------------
# get_collection_alerts
# ---------------------------------------------------------------------------


def test_collection_alerts_returns_dataframe():
    sales = _sales(
        _sale_row("INV001", "C001", 500.0, "Open", "2026-03-01"),
    )
    result = get_collection_alerts(sales, TODAY)
    assert isinstance(result, pl.DataFrame)


def test_collection_alerts_only_over_30_days_past_due():
    # 30 days past due — exactly 30, should be excluded (>30 required)
    due_30 = (TODAY - dt.timedelta(days=30)).isoformat()
    # 31 days past due — included
    due_31 = (TODAY - dt.timedelta(days=31)).isoformat()
    # 10 days past due — excluded
    due_10 = (TODAY - dt.timedelta(days=10)).isoformat()

    sales = _sales(
        _sale_row("INV001", "C001", 500.0, "Open", due_30),
        _sale_row("INV002", "C002", 600.0, "Open", due_31),
        _sale_row("INV003", "C003", 700.0, "Open", due_10),
    )
    result = get_collection_alerts(sales, TODAY)
    assert len(result) == 1
    assert result["invoice_id"][0] == "INV002"


def test_collection_alerts_sorted_desc_by_days_past_due():
    due_60 = (TODAY - dt.timedelta(days=60)).isoformat()
    due_45 = (TODAY - dt.timedelta(days=45)).isoformat()
    due_35 = (TODAY - dt.timedelta(days=35)).isoformat()

    sales = _sales(
        _sale_row("INV001", "C001", 500.0, "Open", due_35),
        _sale_row("INV002", "C002", 600.0, "Open", due_60),
        _sale_row("INV003", "C003", 700.0, "Partial", due_45),
    )
    result = get_collection_alerts(sales, TODAY)
    days = result["days_past_due"].to_list()
    assert days == sorted(days, reverse=True)


def test_collection_alerts_excludes_paid():
    due = (TODAY - dt.timedelta(days=60)).isoformat()
    sales = _sales(
        _sale_row("INV001", "C001", 500.0, "Paid", due),
        _sale_row("INV002", "C002", 600.0, "Open", due),
    )
    result = get_collection_alerts(sales, TODAY)
    assert len(result) == 1
    assert result["invoice_id"][0] == "INV002"


def test_collection_alerts_empty_sales():
    result = get_collection_alerts(_sales(), TODAY)
    assert isinstance(result, pl.DataFrame)
    assert result.is_empty()


def test_collection_alerts_partial_invoices_included():
    due = (TODAY - dt.timedelta(days=45)).isoformat()
    sales = _sales(
        _sale_row("INV001", "C001", 500.0, "Partial", due),
    )
    result = get_collection_alerts(sales, TODAY)
    assert len(result) == 1


# ---------------------------------------------------------------------------
# get_open_negotiations
# ---------------------------------------------------------------------------


def test_open_negotiations_returns_dataframe():
    threads = _threads(
        _thread_row("TH001", "C001", "LGSTK001", "Open", "2026-04-01"),
    )
    result = get_open_negotiations(threads, _empty_customers(), TODAY)
    assert isinstance(result, pl.DataFrame)


def test_open_negotiations_only_open_status():
    threads = _threads(
        _thread_row("TH001", "C001", "LGSTK001", "Open", "2026-04-01"),
        _thread_row("TH002", "C002", "LGSTK002", "Closed-Won", "2026-04-10"),
        _thread_row("TH003", "C003", "LGSTK003", "Closed-Lost", "2026-04-15"),
        _thread_row("TH004", "C004", "LGSTK004", "Open", "2026-03-15"),
    )
    result = get_open_negotiations(threads, _empty_customers(), TODAY)
    assert len(result) == 2
    for row in result.iter_rows(named=True):
        assert row["thread_id"] in {"TH001", "TH004"}


def test_open_negotiations_oldest_first():
    threads = _threads(
        _thread_row("TH001", "C001", "LGSTK001", "Open", "2026-04-20"),
        _thread_row("TH002", "C002", "LGSTK002", "Open", "2026-03-01"),
        _thread_row("TH003", "C003", "LGSTK003", "Open", "2026-04-10"),
    )
    result = get_open_negotiations(threads, _empty_customers(), TODAY)
    # Oldest activity → highest days_since_activity → sorted desc
    days = result["days_since_activity"].to_list()
    assert days == sorted(days, reverse=True)
    # TH002 (2026-03-01) should be first — most neglected
    assert result["thread_id"][0] == "TH002"


def test_open_negotiations_empty_threads():
    result = get_open_negotiations(_threads(), _empty_customers(), TODAY)
    assert isinstance(result, pl.DataFrame)
    assert result.is_empty()


def test_open_negotiations_computes_days_since_activity():
    last_date = (TODAY - dt.timedelta(days=10)).isoformat()
    threads = _threads(
        _thread_row("TH001", "C001", "LGSTK001", "Open", last_date),
    )
    result = get_open_negotiations(threads, _empty_customers(), TODAY)
    assert result["days_since_activity"][0] == 10


# ---------------------------------------------------------------------------
# get_expiring_quotes
# ---------------------------------------------------------------------------


def test_expiring_quotes_returns_dataframe():
    quotes = _quotes(
        _quote_row("QTE001", TODAY.isoformat(), "C001", "LGSTK001", 1000.0, "Pending", 950.0),
    )
    result = get_expiring_quotes(quotes, TODAY)
    assert isinstance(result, pl.DataFrame)


def test_expiring_quotes_only_pending_with_counter():
    # Pending + counter → included
    # Pending + no counter → excluded
    # Expired + counter → excluded
    # Accepted + counter → excluded
    q_date = (TODAY - dt.timedelta(days=5)).isoformat()
    quotes = _quotes(
        _quote_row("QTE001", q_date, "C001", "LGSTK001", 1000.0, "Pending", 950.0),
        _quote_row("QTE002", q_date, "C002", "LGSTK002", 1200.0, "Pending", None),
        _quote_row("QTE003", q_date, "C003", "LGSTK003", 800.0, "Expired", 750.0),
        _quote_row("QTE004", q_date, "C004", "LGSTK004", 600.0, "Accepted", 580.0),
    )
    result = get_expiring_quotes(quotes, TODAY)
    assert len(result) == 1
    assert result["quote_id"][0] == "QTE001"


def test_expiring_quotes_excludes_old_quotes():
    # Older than 14 days → excluded even if Pending + counter
    old_date = (TODAY - dt.timedelta(days=20)).isoformat()
    recent_date = (TODAY - dt.timedelta(days=7)).isoformat()
    quotes = _quotes(
        _quote_row("QTE001", old_date, "C001", "LGSTK001", 1000.0, "Pending", 950.0),
        _quote_row("QTE002", recent_date, "C002", "LGSTK002", 800.0, "Pending", 770.0),
    )
    result = get_expiring_quotes(quotes, TODAY)
    assert len(result) == 1
    assert result["quote_id"][0] == "QTE002"


def test_expiring_quotes_empty():
    result = get_expiring_quotes(_quotes(), TODAY)
    assert isinstance(result, pl.DataFrame)
    assert result.is_empty()


# ---------------------------------------------------------------------------
# format_briefing
# ---------------------------------------------------------------------------


def _make_aging_df():
    return pl.DataFrame(
        [
            {
                "stock_id": "LGSTK001",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "age_in_stock_days": 200,
                "p_pcs": 1000.0,
                "cost_basis": 800.0,
                "demand_score": 0.4,
                "tag": "CLEAR",
                "suggested_discount_pct": -22.0,
            }
        ]
    )


def _make_collections_df():
    return pl.DataFrame(
        [
            {
                "invoice_id": "INV001",
                "customer_id": "CUST001",
                "sold_price": 5000.0,
                "payment_status": "Open",
                "due_date": dt.date(2026, 3, 1),
                "days_past_due": 64,
                "invoice_bucket": "Critical 60+d",
            }
        ]
    )


def _make_negotiations_df():
    return pl.DataFrame(
        [
            {
                "thread_id": "TH001",
                "customer_id": "CUST002",
                "stock_id": "LGSTK002",
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
                "last_message_date": "2026-03-15",
                "last_offer": 900.0,
                "days_since_activity": 50,
            }
        ]
    )


def _make_quotes_df():
    return pl.DataFrame(
        [
            {
                "quote_id": "QTE001",
                "quote_date": "2026-04-28",
                "customer_id": "CUST003",
                "stock_id": "LGSTK003",
                "offered_price": 1200.0,
                "customer_offer": 1100.0,
                "category_simple": "Round | 1.00-1.49 | DEF | VVS+",
            }
        ]
    )


def test_format_briefing_contains_briefing_header():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        top_n=5,
        inventory_summary={"total_available": 654},
    )
    assert "Morning Desk Briefing" in result


def test_format_briefing_contains_inventory_section():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "INVENTORY" in result


def test_format_briefing_contains_collections_section():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "COLLECTIONS" in result


def test_format_briefing_contains_negotiations_section():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "NEGOTIATIONS" in result


def test_format_briefing_contains_quotes_section():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "QUOTES" in result


def test_format_briefing_names_specific_stone():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "LGSTK001" in result


def test_format_briefing_names_specific_invoice():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "INV001" in result


def test_format_briefing_empty_sections():
    aging_empty = pl.DataFrame(
        schema={
            "stock_id": pl.Utf8,
            "category_simple": pl.Utf8,
            "age_in_stock_days": pl.Int64,
            "p_pcs": pl.Float64,
            "cost_basis": pl.Float64,
            "demand_score": pl.Float64,
            "tag": pl.Utf8,
            "suggested_discount_pct": pl.Float64,
        }
    )
    coll_empty = pl.DataFrame(
        schema={
            "invoice_id": pl.Utf8,
            "customer_id": pl.Utf8,
            "sold_price": pl.Float64,
            "payment_status": pl.Utf8,
            "due_date": pl.Date,
            "days_past_due": pl.Int64,
            "invoice_bucket": pl.Utf8,
        }
    )
    neg_empty = pl.DataFrame(
        schema={
            "thread_id": pl.Utf8,
            "customer_id": pl.Utf8,
            "stock_id": pl.Utf8,
            "category_simple": pl.Utf8,
            "last_message_date": pl.Utf8,
            "last_offer": pl.Float64,
            "days_since_activity": pl.Int64,
        }
    )
    q_empty = pl.DataFrame(
        schema={
            "quote_id": pl.Utf8,
            "quote_date": pl.Utf8,
            "customer_id": pl.Utf8,
            "stock_id": pl.Utf8,
            "offered_price": pl.Float64,
            "customer_offer": pl.Float64,
            "category_simple": pl.Utf8,
        }
    )
    result = format_briefing(
        aging_empty,
        coll_empty,
        neg_empty,
        q_empty,
        TODAY,
        inventory_summary={"total_available": 0},
    )
    assert "Morning Desk Briefing" in result
    assert "no aging actions" in result
    assert "no overdue collections" in result


def test_format_briefing_date_appears_in_header():
    result = format_briefing(
        _make_aging_df(),
        _make_collections_df(),
        _make_negotiations_df(),
        _make_quotes_df(),
        TODAY,
        inventory_summary={"total_available": 654},
    )
    assert "2026-05-04" in result


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------


def _data_dir():
    return Path(__file__).resolve().parents[2] / "data" / "Milestone_2"


def test_cli_exits_zero(capsys):
    if not (_data_dir() / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main(
        [
            "--data-dir",
            str(_data_dir()),
            "--today",
            "2026-05-02",
            "--top",
            "3",
        ]
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Briefing" in out


def test_cli_output_contains_sections(capsys):
    if not (_data_dir() / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main(
        [
            "--data-dir",
            str(_data_dir()),
            "--today",
            "2026-05-02",
            "--top",
            "3",
        ]
    )
    out = capsys.readouterr().out
    assert "INVENTORY" in out
    assert "COLLECTIONS" in out
    assert "NEGOTIATIONS" in out
    assert "QUOTES" in out


def test_cli_json_output(capsys):
    if not (_data_dir() / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main(
        [
            "--data-dir",
            str(_data_dir()),
            "--today",
            "2026-05-02",
            "--top",
            "3",
            "--json",
        ]
    )
    out = capsys.readouterr().out
    data = json.loads(out)
    assert "aging" in data
    assert "collections" in data
    assert "negotiations" in data
    assert "quotes" in data
    assert "summary" in data


def test_cli_top_limits_json_rows(capsys):
    if not (_data_dir() / "inventory_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main(
        [
            "--data-dir",
            str(_data_dir()),
            "--today",
            "2026-05-02",
            "--top",
            "2",
            "--json",
        ]
    )
    out = capsys.readouterr().out
    data = json.loads(out)
    assert len(data["aging"]) <= 2
    assert len(data["collections"]) <= 2
