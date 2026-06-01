"""Tests for `skills/memo-approval/scripts/memo_approval.py` (FIFO + HITL gate)."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path

import polars as pl

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "memo-approval"
    / "scripts"
    / "memo_approval.py"
)
_spec = importlib.util.spec_from_file_location("memo_approval", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

build_received_pairs = mod.build_received_pairs
multi_request_customers = mod.multi_request_customers
decide_memo = mod.decide_memo
review_pending = mod.review_pending
format_decision = mod.format_decision
format_batch = mod.format_batch
MemoDecision = mod.MemoDecision

TODAY = dt.date(2026, 5, 26)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _memos(*rows):
    return pl.DataFrame(list(rows), schema={
        "memo_id": pl.Utf8,
        "request_date": pl.Utf8,
        "customer_id": pl.Utf8,
        "broker_id": pl.Utf8,
        "stock_id": pl.Utf8,
        "requested_hold_days": pl.Int64,
        "decision": pl.Utf8,
        "decision_date": pl.Utf8,
        "decision_reason": pl.Utf8,
        "condition_minimum_price": pl.Float64,
        "condition_max_hold_days": pl.Int64,
        "expiry_date": pl.Utf8,
        "closed_outcome": pl.Utf8,
        "closed_transaction_id": pl.Utf8,
        "marketplace_lock_status": pl.Utf8,
        "thread_id": pl.Utf8,
    })


def _memo_row(memo_id="MEMO00001", customer_id="CUST0001", broker_id="BROK0001",
              stock_id="STK0001", hold_days=7, decision="Pending",
              request_date="2026-05-01T09:00:00Z", closed_outcome=None):
    return {
        "memo_id": memo_id,
        "request_date": request_date,
        "customer_id": customer_id,
        "broker_id": broker_id,
        "stock_id": stock_id,
        "requested_hold_days": hold_days,
        "decision": decision,
        "decision_date": None,
        "decision_reason": None,
        "condition_minimum_price": None,
        "condition_max_hold_days": None,
        "expiry_date": "2026-05-08T00:00:00Z",
        "closed_outcome": closed_outcome,
        "closed_transaction_id": None,
        "marketplace_lock_status": "NotLocked",
        "thread_id": None,
    }


def _customers(*pairs):
    """pairs of (customer_id, tier) — canonical CLV quartile Top/High/Mid/Low."""
    return pl.DataFrame(
        [{"customer_id": c, "tier": t} for c, t in pairs],
        schema={"customer_id": pl.Utf8, "tier": pl.Utf8},
    )


# ---------------------------------------------------------------------------
# build_received_pairs
# ---------------------------------------------------------------------------


def test_received_pairs_from_approved():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Approved"),
        _memo_row("M2", "CUST0002", stock_id="S2", decision="Pending"),
    )
    assert build_received_pairs(memos) == {("CUST0001", "S1")}


def test_received_pairs_from_sold_outcome():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Rejected",
                  closed_outcome="Sold"),
    )
    assert ("CUST0001", "S1") in build_received_pairs(memos)


def test_received_pairs_ignores_pending():
    memos = _memos(_memo_row("M1", "CUST0001", stock_id="S1", decision="Pending"))
    assert build_received_pairs(memos) == set()


# ---------------------------------------------------------------------------
# multi_request_customers
# ---------------------------------------------------------------------------


def test_multi_request_counts_distinct_stones():
    pending = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1"),
        _memo_row("M2", "CUST0001", stock_id="S2"),
        _memo_row("M3", "CUST0002", stock_id="S3"),
    )
    assert multi_request_customers(pending) == {"CUST0001": 2}


def test_multi_request_ignores_duplicate_same_stone():
    pending = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1"),
        _memo_row("M2", "CUST0001", stock_id="S1"),
    )
    # Same stone twice is not "multiple stones".
    assert multi_request_customers(pending) == {}


# ---------------------------------------------------------------------------
# AUTO_REJECT — already received
# ---------------------------------------------------------------------------


def test_already_received_auto_rejects():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Approved",
                  closed_outcome="Sold"),
        _memo_row("M2", "CUST0001", stock_id="S1", decision="Pending",
                  request_date="2026-05-20T09:00:00Z"),
    )
    custs = _customers(("CUST0001", "Top"))
    d = decide_memo("M2", memos, custs, TODAY)
    assert d.decision == "AUTO_REJECT"
    assert "already received" in d.reason


def test_already_received_beats_review_gate():
    # Mid-tier customer with 2 stones (would be review) but one is already received.
    memos = _memos(
        _memo_row("M0", "CUST0001", stock_id="S1", decision="Approved"),
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Pending",
                  request_date="2026-05-20T09:00:00Z"),
        _memo_row("M2", "CUST0001", stock_id="S2", decision="Pending",
                  request_date="2026-05-20T10:00:00Z"),
    )
    custs = _customers(("CUST0001", "Mid"))
    d = decide_memo("M1", memos, custs, TODAY)
    assert d.decision == "AUTO_REJECT"
    assert "already received" in d.reason


# ---------------------------------------------------------------------------
# NEEDS_REVIEW — mid-CLV multi-request
# ---------------------------------------------------------------------------


def test_gold_multi_request_needs_review():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Pending",
                  request_date="2026-05-20T09:00:00Z"),
        _memo_row("M2", "CUST0001", stock_id="S2", decision="Pending",
                  request_date="2026-05-20T10:00:00Z"),
    )
    custs = _customers(("CUST0001", "Mid"))
    results = {d.memo_id: d for d in review_pending(memos, custs, TODAY)}
    assert results["M1"].decision == "NEEDS_REVIEW"
    assert results["M2"].decision == "NEEDS_REVIEW"


def test_gold_single_request_auto_approves():
    memos = _memos(_memo_row("M1", "CUST0001", stock_id="S1", decision="Pending"))
    custs = _customers(("CUST0001", "Mid"))
    d = decide_memo("M1", memos, custs, TODAY)
    assert d.decision == "AUTO_APPROVE"


def test_diamond_multi_request_not_reviewed():
    # High-CLV (Top) multi-request is NOT a review case — auto FIFO.
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Pending"),
        _memo_row("M2", "CUST0001", stock_id="S2", decision="Pending"),
    )
    custs = _customers(("CUST0001", "Top"))
    results = {d.memo_id: d for d in review_pending(memos, custs, TODAY)}
    assert results["M1"].decision == "AUTO_APPROVE"
    assert results["M2"].decision == "AUTO_APPROVE"


# ---------------------------------------------------------------------------
# FIFO allocation
# ---------------------------------------------------------------------------


def test_fifo_winner_and_loser():
    memos = _memos(
        _memo_row("M_late", "CUST0002", stock_id="S1", decision="Pending",
                  request_date="2026-05-20T12:00:00Z"),
        _memo_row("M_early", "CUST0001", stock_id="S1", decision="Pending",
                  request_date="2026-05-20T09:00:00Z"),
    )
    custs = _customers(("CUST0001", "Low"), ("CUST0002", "Low"))
    results = {d.memo_id: d for d in review_pending(memos, custs, TODAY)}
    assert results["M_early"].decision == "AUTO_APPROVE"
    assert results["M_early"].fifo_rank == 1
    assert results["M_early"].marketplace_lock_fired is True
    assert results["M_late"].decision == "AUTO_REJECT"
    assert results["M_late"].fifo_rank == 2
    assert "M_early" in results["M_late"].reason


def test_distinct_stones_both_approve():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Pending"),
        _memo_row("M2", "CUST0002", stock_id="S2", decision="Pending"),
    )
    custs = _customers(("CUST0001", "Low"), ("CUST0002", "Low"))
    results = {d.memo_id: d for d in review_pending(memos, custs, TODAY)}
    assert results["M1"].decision == "AUTO_APPROVE"
    assert results["M2"].decision == "AUTO_APPROVE"


# ---------------------------------------------------------------------------
# review_pending plumbing
# ---------------------------------------------------------------------------


def test_review_pending_only_processes_pending():
    memos = _memos(
        _memo_row("M1", "CUST0001", stock_id="S1", decision="Pending"),
        _memo_row("M2", "CUST0002", stock_id="S2", decision="Approved",
                  closed_outcome="Sold"),
    )
    custs = _customers(("CUST0001", "Low"), ("CUST0002", "Low"))
    results = review_pending(memos, custs, TODAY)
    assert len(results) == 1
    assert results[0].memo_id == "M1"


def test_review_pending_empty_returns_empty():
    assert review_pending(_memos(), _customers(), TODAY) == []


def test_decide_memo_unknown_returns_none():
    memos = _memos(_memo_row("M1", "CUST0001", decision="Pending"))
    custs = _customers(("CUST0001", "Low"))
    assert decide_memo("NOPE", memos, custs, TODAY) is None


def test_decide_memo_returns_memodecision():
    memos = _memos(_memo_row("M1", "CUST0001", decision="Pending"))
    custs = _customers(("CUST0001", "Low"))
    d = decide_memo("M1", memos, custs, TODAY)
    assert isinstance(d, MemoDecision)
    assert d.decision in mod.DECISIONS


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def test_format_decision_contains_key_fields():
    memos = _memos(_memo_row("M1", "CUST0001", decision="Pending"))
    custs = _customers(("CUST0001", "Low"))
    d = decide_memo("M1", memos, custs, TODAY)
    text = format_decision(d)
    assert "M1" in text
    assert d.decision in text
    assert "Arrived" in text


def test_format_batch_empty():
    assert "no pending memos" in format_batch([])


def test_format_batch_summary_line():
    memos = _memos(_memo_row("M1", "CUST0001", decision="Pending"))
    custs = _customers(("CUST0001", "Low"))
    d = decide_memo("M1", memos, custs, TODAY)
    text = format_batch([d])
    assert "1 pending memos auto-decided" in text
    assert "|" in text


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------


def _data_dir():
    return Path(__file__).resolve().parents[2] / "data" / "Milestone_2"


def test_cli_all_pending(capsys):
    if not (_data_dir() / "memos_seed.csv").exists():
        import pytest
        pytest.skip("seed CSVs not present")
    exit_code = mod.main([
        "--data-dir", str(_data_dir()),
        "--all-pending",
        "--today", "2026-05-26",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "pending memos auto-decided" in out
    assert "|" in out


def test_cli_json_output(capsys):
    if not (_data_dir() / "memos_seed.csv").exists():
        import pytest
        pytest.skip("seed CSVs not present")
    mod.main([
        "--data-dir", str(_data_dir()),
        "--all-pending",
        "--today", "2026-05-26",
        "--json",
    ])
    out = capsys.readouterr().out
    data = json.loads(out)
    assert isinstance(data, list)
    if data:
        assert "decision" in data[0]
        assert "fifo_rank" in data[0]
