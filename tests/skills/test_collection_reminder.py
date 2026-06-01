"""Tests for `skills/collection-reminder/scripts/collection_reminder.py`."""

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
    / "collection-reminder"
    / "scripts"
    / "collection_reminder.py"
)
_spec = importlib.util.spec_from_file_location("collection_reminder", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

classify_invoice = mod.classify_invoice
bucket_invoices = mod.bucket_invoices
daily_report = mod.daily_report
header_line = mod.header_line
format_table = mod.format_table
BUCKETS = mod.BUCKETS

TODAY = dt.date(2026, 5, 2)


# ---------------------------------------------------------------------------
# Minimal fixture builders
# ---------------------------------------------------------------------------


def _sales(*rows):
    return pl.DataFrame(list(rows), schema={
        "transaction_id": pl.Utf8,
        "invoice_id": pl.Utf8,
        "customer_id": pl.Utf8,
        "broker_id": pl.Utf8,
        "sold_price": pl.Float64,
        "payment_status": pl.Utf8,
        "invoice_date": pl.Utf8,
        "due_date": pl.Utf8,
        "payment_terms_days": pl.Int64,
    })


def _txn(tid, inv, cid, bid, price, status, due):
    return {
        "transaction_id": tid, "invoice_id": inv, "customer_id": cid,
        "broker_id": bid, "sold_price": price, "payment_status": status,
        "invoice_date": "2026-01-01", "due_date": due, "payment_terms_days": 30,
    }


def _pay(*rows):
    return pl.DataFrame(list(rows), schema={
        "invoice_id": pl.Utf8,
        "payment_amount": pl.Float64,
    })


def _customers(*rows):
    return pl.DataFrame(list(rows), schema={
        "customer_id": pl.Utf8,
        "customer_name": pl.Utf8,
        "is_broker": pl.Utf8,
        "broker_id": pl.Utf8,
        "churn_risk_pct": pl.Float64,
    })


# ---------------------------------------------------------------------------
# classify_invoice — bucket rules
# ---------------------------------------------------------------------------


def test_classify_far_future_is_future():
    assert classify_invoice(-30) == "future"


def test_classify_within_5_days_is_upcoming():
    assert classify_invoice(-5) == "upcoming"
    assert classify_invoice(0) == "upcoming"


def test_classify_1_to_7_is_just_due():
    assert classify_invoice(1) == "just_due"
    assert classify_invoice(7) == "just_due"


def test_classify_8_to_30_is_aging():
    assert classify_invoice(8) == "aging"
    assert classify_invoice(30) == "aging"


def test_classify_31_to_60_is_overdue():
    assert classify_invoice(31) == "overdue"
    assert classify_invoice(60) == "overdue"


def test_classify_over_60_is_critical():
    assert classify_invoice(61) == "critical"
    assert classify_invoice(200) == "critical"


# ---------------------------------------------------------------------------
# bucket_invoices
# ---------------------------------------------------------------------------


def test_paid_invoices_excluded():
    sales = _sales(
        _txn("T1", "INV1", "C1", "B1", 1000.0, "Paid", "2026-01-01"),
        _txn("T2", "INV2", "C1", "B1", 500.0, "Open", "2026-01-01"),
    )
    result = bucket_invoices(sales, _pay(), TODAY)
    assert len(result) == 1
    assert result["invoice_id"][0] == "INV2"


def test_future_invoices_excluded():
    # Due 30 days from today → far future → excluded
    future = (TODAY + dt.timedelta(days=30)).isoformat()
    sales = _sales(_txn("T1", "INV1", "C1", "B1", 500.0, "Open", future))
    result = bucket_invoices(sales, _pay(), TODAY)
    assert result.is_empty()


def test_upcoming_invoice_included():
    # Due in 3 days → upcoming
    soon = (TODAY + dt.timedelta(days=3)).isoformat()
    sales = _sales(_txn("T1", "INV1", "C1", "B1", 500.0, "Open", soon))
    result = bucket_invoices(sales, _pay(), TODAY)
    assert len(result) == 1
    assert result["bucket"][0] == "upcoming"


def test_critical_invoice_bucket():
    # Due 90 days ago → critical
    old = (TODAY - dt.timedelta(days=90)).isoformat()
    sales = _sales(_txn("T1", "INV1", "C1", "B1", 1000.0, "Open", old))
    result = bucket_invoices(sales, _pay(), TODAY)
    assert result["bucket"][0] == "critical"


def test_amount_outstanding_equals_sold_price_for_partial():
    # Prototype: payment_history is batch-level, not per-invoice, so
    # amount_outstanding = sold_price regardless of payment_history entries.
    due = (TODAY - dt.timedelta(days=10)).isoformat()
    sales = _sales(_txn("T1", "INV1", "C1", "B1", 1000.0, "Partial", due))
    payments = _pay({"invoice_id": "INV1", "payment_amount": 400.0})
    result = bucket_invoices(sales, payments, TODAY)
    assert result["amount_outstanding"][0] == pytest.approx(1000.0)


def test_amount_outstanding_full_price_when_no_payment():
    due = (TODAY - dt.timedelta(days=10)).isoformat()
    sales = _sales(_txn("T1", "INV1", "C1", "B1", 800.0, "Open", due))
    result = bucket_invoices(sales, _pay(), TODAY)
    assert result["amount_outstanding"][0] == pytest.approx(800.0)


def test_sorted_critical_before_overdue():
    critical_date = (TODAY - dt.timedelta(days=90)).isoformat()
    overdue_date = (TODAY - dt.timedelta(days=40)).isoformat()
    sales = _sales(
        _txn("T1", "INV1", "C1", "B1", 500.0, "Open", overdue_date),
        _txn("T2", "INV2", "C1", "B1", 500.0, "Open", critical_date),
    )
    result = bucket_invoices(sales, _pay(), TODAY)
    assert result["bucket"][0] == "critical"
    assert result["bucket"][1] == "overdue"


def test_empty_sales_returns_empty():
    result = bucket_invoices(_sales(), _pay(), TODAY)
    assert result.is_empty()


# ---------------------------------------------------------------------------
# daily_report
# ---------------------------------------------------------------------------


def test_daily_report_counts_all_buckets():
    sales = _sales(
        _txn("T1", "INV1", "C1", "B1", 500.0, "Open",
             (TODAY - dt.timedelta(days=90)).isoformat()),  # critical
        _txn("T2", "INV2", "C1", "B1", 200.0, "Open",
             (TODAY - dt.timedelta(days=40)).isoformat()),  # overdue
        _txn("T3", "INV3", "C1", "B1", 100.0, "Open",
             (TODAY - dt.timedelta(days=3)).isoformat()),   # just_due
    )
    counts, df = daily_report(sales, _pay(), _customers(), TODAY)
    assert counts["critical"] == 1
    assert counts["overdue"] == 1
    assert counts["just_due"] == 1
    assert counts["total_outstanding_amount"] == pytest.approx(800.0)  # 500 + 200 + 100


def test_daily_report_empty_sales():
    counts, df = daily_report(_sales(), _pay(), _customers(), TODAY)
    assert df.is_empty()
    assert counts["total_outstanding_amount"] == 0.0


# ---------------------------------------------------------------------------
# header_line
# ---------------------------------------------------------------------------


def test_header_line_format():
    counts = {b: 0 for b in BUCKETS}
    counts["critical"] = 5
    counts["total_outstanding_amount"] = 12000.0
    line = header_line(counts)
    assert "Critical: 5" in line
    assert "$12,000" in line


# ---------------------------------------------------------------------------
# format_table
# ---------------------------------------------------------------------------


def test_format_table_empty():
    assert "no open invoices" in format_table(mod._empty_bucketed())


def test_format_table_contains_invoice_id():
    due = (TODAY - dt.timedelta(days=70)).isoformat()
    sales = _sales(_txn("T1", "INV_TEST", "C1", "B1", 999.0, "Open", due))
    df = bucket_invoices(sales, _pay(), TODAY)
    table = format_table(df)
    assert "INV_TEST" in table


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------


def _data_dir():
    return Path(__file__).resolve().parents[2] / "data" / "Milestone_2"


def test_cli_daily_report(capsys):
    if not (_data_dir() / "sales_transactions_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main([
        "--data-dir", str(_data_dir()),
        "--today", "2026-05-02",
        "--top", "5",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "open invoices" in out
    assert "|" in out


def test_cli_bucket_filter(capsys):
    if not (_data_dir() / "sales_transactions_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main([
        "--data-dir", str(_data_dir()),
        "--today", "2026-05-02",
        "--bucket", "critical",
        "--top", "5",
    ])
    out = capsys.readouterr().out
    # All visible rows should be critical
    for line in out.split("\n"):
        if "| CUST" in line:
            assert "critical" in line


def test_cli_json_output(capsys):
    if not (_data_dir() / "sales_transactions_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main([
        "--data-dir", str(_data_dir()),
        "--today", "2026-05-02",
        "--json",
        "--top", "3",
    ])
    out = capsys.readouterr().out
    data = json.loads(out)
    assert "summary" in data
    assert "invoices" in data
    assert len(data["invoices"]) <= 3
