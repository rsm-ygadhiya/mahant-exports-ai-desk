"""Tests for `skills/clv-broker-company/scripts/clv_broker_company.py`."""

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
    / "clv-broker-company"
    / "scripts"
    / "clv_broker_company.py"
)
_spec = importlib.util.spec_from_file_location("clv_broker_company", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

clv_inputs_for_entity = mod.clv_inputs_for_entity
compute_entity_clv = mod.compute_entity_clv
compute_all_clv = mod.compute_all_clv
broker_breakdown = mod.broker_breakdown
format_single = mod.format_single
format_table = mod.format_table
CLVResult = mod.CLVResult

TODAY = dt.date(2026, 5, 2)


# ---------------------------------------------------------------------------
# Minimal fixture builders
# ---------------------------------------------------------------------------


def _customers(*rows):
    return pl.DataFrame(list(rows), schema={
        "customer_id": pl.Utf8,
        "customer_name": pl.Utf8,
        "is_broker": pl.Utf8,
        "broker_id": pl.Utf8,
        "churn_risk_pct": pl.Float64,
    })


def _broker(cid, name, churn=10.0):
    return {"customer_id": cid, "customer_name": name, "is_broker": "true",
            "broker_id": cid, "churn_risk_pct": churn}


def _company(cid, name, broker_id, churn=15.0):
    return {"customer_id": cid, "customer_name": name, "is_broker": "false",
            "broker_id": broker_id, "churn_risk_pct": churn}


def _sales(*rows):
    return pl.DataFrame(list(rows), schema={
        "transaction_id": pl.Utf8,
        "transaction_date": pl.Utf8,
        "customer_id": pl.Utf8,
        "broker_id": pl.Utf8,
        "gross_profit": pl.Float64,
    })


def _txn(tid, date, cid, bid, gp):
    return {"transaction_id": tid, "transaction_date": date,
            "customer_id": cid, "broker_id": bid, "gross_profit": gp}


# ---------------------------------------------------------------------------
# clv_inputs_for_entity
# ---------------------------------------------------------------------------


def test_inputs_no_sales_returns_zero_revenue():
    cust = _customers(_broker("B1", "Broker One"))
    sales = _sales()
    inp = clv_inputs_for_entity("B1", "broker", sales, cust, TODAY)
    assert inp["monthly_revenue"] == 0.0
    assert inp["transactions"] == 0
    assert inp["note"] == "no sales history"


def test_inputs_broker_aggregates_company_sales():
    # B1 acts as broker for company C1; the sale has broker_id=B1
    cust = _customers(_broker("B1", "Broker One"), _company("C1", "Company One", "B1"))
    sales = _sales(
        _txn("T1", "2026-01-01", "C1", "B1", 500.0),
        _txn("T2", "2026-02-01", "C1", "B1", 300.0),
    )
    inp = clv_inputs_for_entity("B1", "broker", sales, cust, TODAY)
    assert inp["transactions"] == 2
    assert inp["monthly_revenue"] > 0


def test_inputs_company_only_sees_own_sales():
    cust = _customers(_broker("B1", "Broker One"), _company("C1", "Co1", "B1"),
                      _company("C2", "Co2", "B1"))
    sales = _sales(
        _txn("T1", "2026-01-01", "C1", "B1", 500.0),
        _txn("T2", "2026-02-01", "C2", "B1", 300.0),
    )
    inp_c1 = clv_inputs_for_entity("C1", "company", sales, cust, TODAY)
    inp_c2 = clv_inputs_for_entity("C2", "company", sales, cust, TODAY)
    assert inp_c1["transactions"] == 1
    assert inp_c2["transactions"] == 1


def test_inputs_monthly_revenue_is_gp_divided_by_months():
    cust = _customers(_broker("B1", "Broker One", churn=5.0))
    # Two sales spanning ~3 months (Jan 1 → Apr 1 = 91 days ≈ 3 months)
    sales = _sales(
        _txn("T1", "2026-01-01", "B1", "B1", 900.0),
        _txn("T2", "2026-04-01", "B1", "B1", 300.0),
    )
    inp = clv_inputs_for_entity("B1", "broker", sales, cust, TODAY)
    # months_active ≈ (TODAY - 2026-01-01).days / 30.44
    months = max(1.0, (TODAY - dt.date(2026, 1, 1)).days / 30.44)
    expected_mr = (900.0 + 300.0) / months
    assert inp["monthly_revenue"] == pytest.approx(expected_mr, rel=0.01)


def test_inputs_uses_churn_risk_pct_from_customers():
    cust = _customers(_broker("B1", "Broker One", churn=20.0))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 1000.0))
    inp = clv_inputs_for_entity("B1", "broker", sales, cust, TODAY)
    assert inp["churn_rate"] == pytest.approx(0.20)


def test_inputs_unknown_entity_defaults_churn_10pct():
    cust = _customers()
    sales = _sales()
    inp = clv_inputs_for_entity("UNKNOWN", "broker", sales, cust, TODAY)
    assert inp["churn_rate"] == pytest.approx(0.10)


# ---------------------------------------------------------------------------
# compute_entity_clv
# ---------------------------------------------------------------------------


def test_compute_entity_clv_returns_clvresult():
    cust = _customers(_broker("B1", "Broker One", churn=5.0))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 1200.0))
    result = compute_entity_clv("B1", "broker", sales, cust, TODAY)
    assert isinstance(result, CLVResult)
    assert result.clv >= 0
    assert result.entity_id == "B1"
    assert result.level == "broker"


def test_positive_gross_profit_yields_positive_clv():
    cust = _customers(_broker("B1", "Broker One", churn=5.0))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 5000.0))
    result = compute_entity_clv("B1", "broker", sales, cust, TODAY)
    assert result.clv > 0


def test_no_sales_yields_zero_clv():
    cust = _customers(_broker("B1", "Broker One"))
    sales = _sales()
    result = compute_entity_clv("B1", "broker", sales, cust, TODAY)
    assert result.clv == 0.0


def test_higher_churn_lowers_clv():
    cust_low = _customers(_broker("B1", "B", churn=5.0))
    cust_high = _customers(_broker("B1", "B", churn=40.0))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 5000.0))
    low = compute_entity_clv("B1", "broker", sales, cust_low, TODAY)
    high = compute_entity_clv("B1", "broker", sales, cust_high, TODAY)
    assert low.clv > high.clv


def test_longer_horizon_raises_clv():
    cust = _customers(_broker("B1", "B", churn=5.0))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 5000.0))
    short = compute_entity_clv("B1", "broker", sales, cust, TODAY, time_horizon=12)
    long_ = compute_entity_clv("B1", "broker", sales, cust, TODAY, time_horizon=60)
    assert long_.clv > short.clv


# ---------------------------------------------------------------------------
# compute_all_clv
# ---------------------------------------------------------------------------


def test_compute_all_clv_brokers_returns_one_row_per_broker():
    cust = _customers(
        _broker("B1", "Broker One"),
        _broker("B2", "Broker Two"),
        _company("C1", "Co1", "B1"),
    )
    sales = _sales(
        _txn("T1", "2026-01-01", "B1", "B1", 1000.0),
        _txn("T2", "2026-02-01", "C1", "B1", 500.0),
    )
    df = compute_all_clv("broker", sales, cust, TODAY)
    # B2 has no sales → min_transactions=1 filters it out
    assert len(df) == 1
    assert df["entity_id"][0] == "B1"


def test_compute_all_clv_sorted_descending():
    cust = _customers(
        _broker("B1", "BigBroker", churn=5.0),
        _broker("B2", "SmallBroker", churn=5.0),
    )
    sales = _sales(
        _txn("T1", "2026-01-01", "B1", "B1", 10000.0),
        _txn("T2", "2026-01-01", "B2", "B2", 100.0),
    )
    df = compute_all_clv("broker", sales, cust, TODAY)
    assert df["entity_id"][0] == "B1"
    assert df["clv"][0] > df["clv"][1]


def test_compute_all_clv_companies():
    cust = _customers(
        _broker("B1", "Broker"),
        _company("C1", "Co1", "B1"),
        _company("C2", "Co2", "B1"),
    )
    sales = _sales(
        _txn("T1", "2026-01-01", "C1", "B1", 2000.0),
        _txn("T2", "2026-02-01", "C2", "B1", 500.0),
    )
    df = compute_all_clv("company", sales, cust, TODAY)
    assert len(df) == 2


def test_compute_all_clv_empty_sales_returns_empty():
    cust = _customers(_broker("B1", "Broker"))
    sales = _sales()
    df = compute_all_clv("broker", sales, cust, TODAY)
    assert df.is_empty()


# ---------------------------------------------------------------------------
# broker_breakdown
# ---------------------------------------------------------------------------


def test_broker_breakdown_returns_result_and_company_df():
    cust = _customers(
        _broker("B1", "Broker One"),
        _company("C1", "Co1", "B1"),
        _company("C2", "Co2", "B1"),
    )
    sales = _sales(
        _txn("T1", "2026-01-01", "C1", "B1", 1000.0),
        _txn("T2", "2026-02-01", "C2", "B1", 500.0),
    )
    result, company_df = broker_breakdown("B1", sales, cust, TODAY)
    assert isinstance(result, CLVResult)
    assert result.level == "broker"
    assert len(company_df) == 2  # C1 and C2


def test_broker_breakdown_company_df_sorted_by_clv():
    cust = _customers(
        _broker("B1", "Broker"),
        _company("C1", "BigCo", "B1", churn=5.0),
        _company("C2", "SmallCo", "B1", churn=5.0),
    )
    sales = _sales(
        _txn("T1", "2026-01-01", "C1", "B1", 5000.0),
        _txn("T2", "2026-01-01", "C2", "B1", 100.0),
    )
    _, company_df = broker_breakdown("B1", sales, cust, TODAY)
    assert company_df["entity_id"][0] == "C1"


def test_broker_breakdown_no_companies_returns_empty_df():
    cust = _customers(_broker("B1", "Loner Broker"))
    sales = _sales(_txn("T1", "2026-01-01", "B1", "B1", 1000.0))
    _, company_df = broker_breakdown("B1", sales, cust, TODAY)
    assert company_df.is_empty()


# ---------------------------------------------------------------------------
# format helpers
# ---------------------------------------------------------------------------


def test_format_single_contains_clv_and_name():
    result = CLVResult(
        entity_id="B1", entity_name="Broker One", level="broker",
        clv=123456.0, avg_monthly_profit=4500.0, transactions=10,
        months_active=24.0, churn_rate=0.05, discount_rate=0.008,
        time_horizon=36, first_sale="2024-01-01", last_sale="2026-01-01",
        note="",
    )
    text = format_single(result)
    assert "Broker One" in text
    assert "$123,456" in text


def test_format_single_shows_warning_when_note_set():
    result = CLVResult(
        entity_id="B1", entity_name="B", level="broker",
        clv=0.0, avg_monthly_profit=-100.0, transactions=2,
        months_active=1.0, churn_rate=0.10, discount_rate=0.008,
        time_horizon=36, first_sale="2026-01-01", last_sale="2026-01-02",
        note="negative avg gross profit",
    )
    text = format_single(result)
    assert "negative avg gross profit" in text


def test_format_table_empty():
    empty = pl.DataFrame(schema={"entity_id": pl.Utf8, "entity_name": pl.Utf8,
                                  "clv": pl.Float64, "avg_monthly_profit": pl.Float64,
                                  "transactions": pl.Int64, "months_active": pl.Float64,
                                  "churn_rate": pl.Float64})
    assert "no data" in format_table(empty)


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------


def _data_dir():
    return Path(__file__).resolve().parents[2] / "data" / "Milestone_2"


def test_cli_top_brokers(capsys):
    if not (_data_dir() / "customers_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main(["--top-brokers", "5", "--data-dir", str(_data_dir())])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "Top 5 brokers" in captured.out
    assert "|" in captured.out


def test_cli_top_companies(capsys):
    if not (_data_dir() / "customers_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main(["--top-companies", "5", "--data-dir", str(_data_dir())])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "Top 5 companies" in captured.out


def test_cli_broker_json(capsys):
    if not (_data_dir() / "customers_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    mod.main(["--broker", "CUST0001", "--json", "--data-dir", str(_data_dir())])
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert "clv" in data
    assert "entity_id" in data


def test_cli_company(capsys):
    if not (_data_dir() / "customers_seed.csv").exists():
        pytest.skip("seed CSVs not present")
    exit_code = mod.main(["--company", "CUST0041", "--data-dir", str(_data_dir())])
    assert exit_code == 0
    captured = capsys.readouterr()
    assert "CLV" in captured.out
