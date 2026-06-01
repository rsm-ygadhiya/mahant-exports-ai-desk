"""Per-automation tests for triage-inventory."""

from __future__ import annotations

import pytest

from tests.automations._helpers import (
    REPO, WORKING, clean_working, read_csv, run_script,
)

SCRIPT = REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py"


@pytest.fixture(autouse=True)
def _clean():
    clean_working()
    yield


def test_envelope_shape():
    env = run_script(SCRIPT, ["--stock-id", "ALL"])
    assert env["status"] == "ok"
    assert env["skill_name"] == "triage-inventory"
    assert env["next_action"] == "propose-repricing"
    assert env["confidence"] == 1.0
    assert env["review_required"] is False
    assert env["artifact_refs"] == ["working/triage_decisions.csv"]


def test_outputs_complete():
    env = run_script(SCRIPT, ["--stock-id", "ALL"])
    o = env["outputs"]
    assert o["today"] == "2026-05-14"
    # by_tag is a dict — sum equals stones_tagged
    assert sum(o["by_tag"].values()) == o["stones_tagged"]
    assert o["rows_written"] == o["stones_tagged"]


def test_csv_columns_match_envelope():
    run_script(SCRIPT, ["--stock-id", "ALL"])
    rows = read_csv(WORKING / "triage_decisions.csv")
    assert len(rows) > 0
    required = {
        "workflow_run_id", "step_id", "stock_id", "category_simple",
        "age_in_stock_days", "action_tag", "suggested_price_move_pct", "reason",
    }
    assert required.issubset(set(rows[0].keys()))


def test_every_tag_is_valid():
    """Every action_tag in the output must be one of the 4 known tags."""
    run_script(SCRIPT, ["--stock-id", "ALL"])
    rows = read_csv(WORKING / "triage_decisions.csv")
    valid = {"HOLD", "WATCH", "DISCOUNT", "CLEAR"}
    for r in rows:
        assert r["action_tag"] in valid, f"unknown tag: {r['action_tag']!r}"


def test_clear_tags_have_aggressive_price_move():
    """CLEAR-tagged stones should always suggest a non-trivial discount.

    Convention in this codebase: `suggested_price_move_pct` is the
    magnitude of the discount to apply (positive number = N% off).
    """
    run_script(SCRIPT, ["--stock-id", "ALL"])
    rows = read_csv(WORKING / "triage_decisions.csv")
    clears = [r for r in rows if r["action_tag"] == "CLEAR"]
    assert len(clears) > 0, "expected at least one CLEAR-tagged stone in the baseline"
    for r in clears:
        # CLEAR cuts are >= 20% per the triage rule
        assert float(r["suggested_price_move_pct"]) >= 20, \
            f"CLEAR stone {r['stock_id']} has weak discount {r['suggested_price_move_pct']}"


def test_hold_tags_have_no_price_move():
    """HOLD = leave alone, so suggested_price_move_pct should be 0."""
    run_script(SCRIPT, ["--stock-id", "ALL"])
    rows = read_csv(WORKING / "triage_decisions.csv")
    holds = [r for r in rows if r["action_tag"] == "HOLD"]
    assert len(holds) > 0
    for r in holds:
        assert float(r["suggested_price_move_pct"]) == 0, \
            f"HOLD stone {r['stock_id']} has non-zero move {r['suggested_price_move_pct']}"


def test_run_is_deterministic():
    """Two runs with the same data should produce the same tags."""
    run_script(SCRIPT, ["--stock-id", "ALL"])
    a = sorted(
        (r["stock_id"], r["action_tag"]) for r in read_csv(WORKING / "triage_decisions.csv")
    )
    clean_working()
    run_script(SCRIPT, ["--stock-id", "ALL"])
    b = sorted(
        (r["stock_id"], r["action_tag"]) for r in read_csv(WORKING / "triage_decisions.csv")
    )
    assert a == b
