"""Per-automation tests for decide-memo — decision point B."""

from __future__ import annotations

import pytest

from tests.automations._helpers import (
    REPO, WORKING, clean_working, read_csv, run_script,
)

TRIAGE = REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py"
CLV    = REPO / "automations" / "rank-customer-clv" / "scripts" / "rank_customer_clv.py"
MEMO   = REPO / "automations" / "decide-memo" / "scripts" / "decide_memo.py"


@pytest.fixture(autouse=True)
def _clean():
    """decide-memo consumes triage_decisions.csv + clv_tiers.csv."""
    clean_working()
    run_script(TRIAGE, ["--stock-id", "ALL"])
    run_script(CLV, ["--entity-id", "ALL"])
    yield


def test_envelope_shape_no_narration():
    env = run_script(MEMO, ["--memo-id", "ALL"])
    assert env["status"] == "ok"
    assert env["skill_name"] == "decide-memo"
    assert env["next_action"] == "done"
    assert env["confidence"] == 1.0
    # narration_used should no longer be in the envelope (LLM ripped out)
    assert "narration_used" not in env["outputs"]


def test_three_buckets_sum_to_total():
    """auto_approved + auto_rejected + needs_review = memos_reviewed."""
    env = run_script(MEMO, ["--memo-id", "ALL"])
    o = env["outputs"]
    assert o["auto_approved"] + o["auto_rejected"] + o["needs_review"] == o["memos_reviewed"]


def test_queue_column_has_three_buckets():
    """The CSV's queue column should only contain the 3 known values."""
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    queues = {r["queue"] for r in rows}
    assert queues.issubset({"auto_approve", "auto_reject", "needs_review"})


def test_auto_reject_for_low_tier_or_stone_conflict():
    """auto_reject either targets a low-tier customer with a clear REJECT,
    or any-tier customer whose stone is held by someone else."""
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    for r in rows:
        if r["queue"] == "auto_reject":
            assert r["decision"] == "REJECT"
            is_conflict = "already held" in r["route_reason"]
            if not is_conflict:
                # Non-conflict auto-rejects must be low-tier only
                assert r["tier"] not in ("Top", "High"), (
                    f"non-conflict auto-rejected a {r['tier']} customer "
                    f"(memo {r['memo_id']})"
                )


def test_route_reason_is_populated():
    """Every row gets a route_reason explaining which bucket and why."""
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    assert len(rows) > 0
    for r in rows:
        assert r["route_reason"].strip() != "", f"empty route_reason on {r['memo_id']}"


def test_already_memo_stone_auto_rejects():
    """A pending memo on a stone that's already on another active memo
    should be auto_rejected with a 'held by another customer' message."""
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    conflicts = [r for r in rows if "already held" in r["route_reason"]]
    assert len(conflicts) > 0, (
        "expected at least one auto-reject due to stock conflict in the baseline"
    )
    for r in conflicts:
        assert r["queue"] == "auto_reject"
        assert r["decision"] == "REJECT"
        # The route_reason should name the competing memo id
        assert "MEMO" in r["route_reason"]


def test_threshold_b_tightening_reduces_auto_approve():
    """Lower opp-ceiling → fewer rows in auto_approved."""
    env_loose = run_script(MEMO, ["--memo-id", "ALL", "--opp-ceiling", "100"])
    clean_working()
    run_script(TRIAGE, ["--stock-id", "ALL"])
    run_script(CLV, ["--entity-id", "ALL"])
    env_tight = run_script(MEMO, ["--memo-id", "ALL", "--opp-ceiling", "0"])
    assert env_tight["outputs"]["auto_approved"] <= env_loose["outputs"]["auto_approved"]


def test_decisions_are_in_known_set():
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    valid = {"APPROVE", "APPROVE_WITH_CONDITIONS", "REJECT"}
    for r in rows:
        assert r["decision"] in valid


def test_rationale_is_populated():
    """Every row must have a non-empty deterministic rationale."""
    run_script(MEMO, ["--memo-id", "ALL"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    assert len(rows) > 0
    for r in rows:
        assert r["rationale"].strip() != "", \
            f"empty rationale on memo {r['memo_id']}"


def test_auto_approve_only_top_high_with_low_opp():
    """Routing rule: auto only if APPROVE + tier in {Top,High} + opp <= ceiling."""
    env = run_script(MEMO, ["--memo-id", "ALL", "--opp-ceiling", "70"])
    rows = read_csv(WORKING / "memo_decisions.csv")
    for r in rows:
        if r["queue"] == "auto_approve":
            assert r["decision"] == "APPROVE"
            assert r["tier"] in ("Top", "High")
            assert int(r["opportunity_score"]) <= 70
            assert r["triage_tag"] != "HOLD"


def test_review_required_when_any_in_review_queue():
    env = run_script(MEMO, ["--memo-id", "ALL"])
    if env["outputs"]["needs_review"] > 0:
        assert env["review_required"] is True
