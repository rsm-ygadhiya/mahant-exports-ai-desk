"""Per-automation tests for propose-repricing — decision point A."""

from __future__ import annotations

import pytest

from tests.automations._helpers import (
    REPO, WORKING, clean_working, read_csv, run_script,
)

TRIAGE   = REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py"
REPRICE  = REPO / "automations" / "propose-repricing" / "scripts" / "propose_repricing.py"


@pytest.fixture(autouse=True)
def _clean():
    clean_working()
    # Repricing consumes triage_decisions.csv → run upstream first
    run_script(TRIAGE, ["--stock-id", "ALL"])
    yield


def test_envelope_shape():
    env = run_script(REPRICE, ["--stock-id", "ALL"])
    assert env["status"] == "ok"
    assert env["skill_name"] == "propose-repricing"
    assert env["next_action"] == "rank-customer-clv"
    assert env["artifact_refs"] == ["working/repricing_proposals.csv"]


def test_auto_plus_review_equals_total():
    env = run_script(REPRICE, ["--stock-id", "ALL"])
    o = env["outputs"]
    assert o["auto_count"] + o["review_count"] == o["rows_written"]


def test_queue_column_is_disjoint():
    """Every row in the CSV is exactly one of auto_apply or review."""
    run_script(REPRICE, ["--stock-id", "ALL"])
    rows = read_csv(WORKING / "repricing_proposals.csv")
    queues = {r["queue"] for r in rows}
    assert queues.issubset({"auto", "review"})


def test_tightening_threshold_moves_rows_to_review():
    """Lower threshold → fewer rows in auto_apply, same total."""
    env_wide = run_script(REPRICE, ["--stock-id", "ALL", "--threshold-pct", "10"])
    clean_working()
    run_script(TRIAGE, ["--stock-id", "ALL"])
    env_tight = run_script(REPRICE, ["--stock-id", "ALL", "--threshold-pct", "1"])
    assert env_tight["outputs"]["auto_count"] <= env_wide["outputs"]["auto_count"]
    assert env_tight["outputs"]["rows_written"] == env_wide["outputs"]["rows_written"]


def test_threshold_pct_is_reported_in_envelope():
    env = run_script(REPRICE, ["--stock-id", "ALL", "--threshold-pct", "4.5"])
    assert env["outputs"]["threshold_pct"] == 4.5


def test_review_required_set_when_review_queue_has_rows():
    env = run_script(REPRICE, ["--stock-id", "ALL", "--threshold-pct", "1"])
    if env["outputs"]["review_count"] > 0:
        assert env["review_required"] is True
