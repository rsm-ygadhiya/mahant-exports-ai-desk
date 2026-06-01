"""Tests for the MCP tools in mcp_servers/tools_server.py.

The tools are FastMCP-decorated; we test the underlying functions through
``.fn`` (FastMCP exposes the raw callable on its Tool wrapper).
"""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from mcp_servers.tools_server import (
    get_triage_tags, propose_repricing, review_memo,
)

REPO = Path(__file__).resolve().parents[1]

_triage  = getattr(get_triage_tags,  "fn", get_triage_tags)
_reprice = getattr(propose_repricing, "fn", propose_repricing)
_memo    = getattr(review_memo,      "fn", review_memo)


# ── Tool 1 ──────────────────────────────────────────────────────────────
def test_get_triage_tags_returns_valid_tags():
    rows = _triage(today="2026-05-14", limit=20)
    assert len(rows) > 0
    valid = {"HOLD", "WATCH", "DISCOUNT", "CLEAR"}
    for r in rows:
        assert r["action_tag"] in valid
        assert "stock_id" in r


def test_get_triage_tags_limit_honored():
    rows = _triage(today="2026-05-14", limit=3)
    assert len(rows) <= 3


def test_get_triage_tags_bad_date_raises():
    with pytest.raises(ValueError):
        _triage(today="not-a-date")


# ── Tool 2 ──────────────────────────────────────────────────────────────
def test_propose_repricing_shape():
    out = _reprice(today="2026-05-14", threshold_pct=7.0, limit=10)
    assert set(out.keys()) >= {"auto_apply", "needs_review", "summary"}
    assert isinstance(out["auto_apply"], list)
    assert isinstance(out["needs_review"], list)


def test_propose_repricing_auto_obeys_threshold_and_safe_flag():
    out = _reprice(today="2026-05-14", threshold_pct=7.0, limit=500)
    for r in out["auto_apply"]:
        assert abs(r["pct_change"]) <= 7.0
        assert (r.get("flag") or "").lower() not in {"frozen", "margin", "quote"}


def test_propose_repricing_tighter_threshold_doesnt_decrease_review():
    loose = _reprice(today="2026-05-14", threshold_pct=20.0, limit=500)
    tight = _reprice(today="2026-05-14", threshold_pct=3.0,  limit=500)
    assert tight["summary"]["review_count"] >= loose["summary"]["review_count"]


# ── Tool 3 ──────────────────────────────────────────────────────────────
def test_review_memo_unknown_id_raises():
    with pytest.raises(ValueError):
        _memo(memo_id="MEMO-NOPE")


def test_review_memo_returns_valid_decision():
    memos = pl.read_csv(REPO / "data" / "raw" / "memos_seed.csv")
    pending = memos.filter(pl.col("decision") == "Pending")
    if pending.is_empty():
        pytest.skip("no pending memos in seed")
    mid = pending.row(0, named=True)["memo_id"]
    out = _memo(memo_id=mid, today="2026-05-14")
    assert out["memo_id"] == mid
    assert out["decision"] in {"APPROVE", "APPROVE_WITH_CONDITIONS", "REJECT"}
    assert 0 <= out["reliability_score"] <= 100
    assert 0 <= out["opportunity_score"] <= 100
    assert isinstance(out["reason"], str) and out["reason"]
