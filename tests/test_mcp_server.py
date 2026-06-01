"""Tests for the MCP server tools defined in ``app/mcp_server.py``.

The MCP framework wraps tool functions, but the underlying callables are still
directly invokable for testing. We exercise each tool through ``.fn(...)``
(FastMCP exposes the raw function on its Tool wrapper) with realistic inputs.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import polars as pl
import pytest

from app.db import init_db, read_table
from app.mcp_server import get_triage_tags, propose_repricing, review_memo

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"


@pytest.fixture(scope="module", autouse=True)
def _db_ready():
    """Ensure the DB is initialized before any MCP tool runs."""
    init_db()
    yield


# A FastMCP tool object exposes the raw function as `.fn`. Tests target the
# raw function for clean assertions.
_triage_fn  = get_triage_tags.fn  if hasattr(get_triage_tags, "fn")  else get_triage_tags
_reprice_fn = propose_repricing.fn if hasattr(propose_repricing, "fn") else propose_repricing
_memo_fn    = review_memo.fn       if hasattr(review_memo, "fn")       else review_memo


# ---------------------------------------------------------------------------
# Tool 1 — get_triage_tags
# ---------------------------------------------------------------------------


def test_get_triage_tags_returns_list_of_dicts():
    rows = _triage_fn(limit=10)
    assert isinstance(rows, list)
    assert len(rows) > 0
    sample = rows[0]
    for col in ("stock_id", "action_tag", "age_in_stock_days"):
        assert col in sample, f"missing column {col}"
    assert sample["action_tag"] in {"HOLD", "WATCH", "DISCOUNT", "CLEAR"}


def test_get_triage_tags_respects_limit():
    rows = _triage_fn(limit=3)
    assert len(rows) <= 3


def test_get_triage_tags_accepts_iso_date():
    # Should not raise for a valid ISO date.
    rows = _triage_fn(today="2026-05-04", limit=1)
    assert isinstance(rows, list)


def test_get_triage_tags_bad_date_raises():
    with pytest.raises(ValueError):
        _triage_fn(today="not-a-date")


# ---------------------------------------------------------------------------
# Tool 2 — propose_repricing
# ---------------------------------------------------------------------------


def test_propose_repricing_has_auto_and_review_keys():
    out = _reprice_fn(threshold_pct=7.0, limit=10)
    assert set(out.keys()) >= {"auto_apply", "needs_review", "summary"}
    assert isinstance(out["auto_apply"], list)
    assert isinstance(out["needs_review"], list)


def test_propose_repricing_auto_obeys_threshold():
    """Every row in auto_apply has |pct_change| within the threshold AND a
    safe flag — proves the tool applies the M03 decision-point rule."""
    out = _reprice_fn(threshold_pct=7.0, limit=200)
    for row in out["auto_apply"]:
        assert abs(row["pct_change"]) <= 7.0, (
            f"{row['stock_id']} auto with {row['pct_change']}% > 7%"
        )
        flag = (row.get("flag") or "").lower()
        assert flag not in {"frozen", "margin", "quote"}, (
            f"{row['stock_id']} auto with unsafe flag {row.get('flag')!r}"
        )


def test_propose_repricing_lower_threshold_moves_rows_to_review():
    """Tightening the threshold should never decrease the review count."""
    loose = _reprice_fn(threshold_pct=20.0, limit=500)
    tight = _reprice_fn(threshold_pct=3.0,  limit=500)
    assert tight["summary"]["review_count"] >= loose["summary"]["review_count"]


# ---------------------------------------------------------------------------
# Tool 3 — review_memo
# ---------------------------------------------------------------------------


def _first_pending_memo_id() -> str | None:
    memos = read_table("memos")
    pending = memos.filter(pl.col("decision") == "Pending")
    if pending.is_empty():
        return None
    return pending.row(0, named=True)["memo_id"]


def test_review_memo_unknown_id_raises():
    with pytest.raises(ValueError):
        _memo_fn(memo_id="MEMO-DOES-NOT-EXIST")


def test_review_memo_returns_valid_decision():
    mid = _first_pending_memo_id()
    if mid is None:
        pytest.skip("no pending memos in DB to review")
    out = _memo_fn(memo_id=mid)
    assert out["memo_id"] == mid
    assert out["decision"] in {"APPROVE", "APPROVE_WITH_CONDITIONS", "REJECT"}
    # Scores are 0..100 ints
    assert 0 <= out["reliability_score"] <= 100
    assert 0 <= out["opportunity_score"] <= 100
    assert isinstance(out["reason"], str) and out["reason"]
