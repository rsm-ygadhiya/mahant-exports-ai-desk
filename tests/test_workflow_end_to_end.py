"""End-to-end tests for the chained workflow.

Each step is exercised as a subprocess (just like the orchestrator drives it)
and the JSON envelope is parsed and asserted on. The final test runs the
whole orchestrator and verifies the four envelopes flow correctly.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
WORKING = REPO / "data" / "working"


@pytest.fixture(autouse=True)
def _clean_working_dir():
    """Wipe data/working/ before each test so envelopes don't bleed."""
    if WORKING.exists():
        for p in WORKING.glob("*.csv"):
            p.unlink()
    yield


def _run_step(script: Path, extra: list[str]) -> dict:
    """Run a step with --json and parse the envelope."""
    cmd = [
        sys.executable, str(script),
        "--json",
        "--data-dir", str(REPO / "data"),
        "--out-dir",  str(WORKING),
        "--workflow-run-id", "wf-test1234567",
        "--step-id", "step-test",
        "--today", "2026-05-14",
        *extra,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO), check=False)
    assert proc.returncode == 0, f"non-zero exit: {proc.stderr}"
    out = (proc.stdout or "").strip().splitlines()[-1]
    return json.loads(out)


# ---------------------------------------------------------------------------
# Per-step envelope tests
# ---------------------------------------------------------------------------


def test_triage_envelope_ok_and_handoff():
    env = _run_step(
        REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py",
        ["--stock-id", "ALL"],
    )
    assert env["status"] == "ok"
    assert env["skill_name"] == "triage-inventory"
    assert env["next_action"] == "propose-repricing"
    assert env["confidence"] == 1.0
    assert env["review_required"] is False
    # Hand-off file exists and is non-empty
    out = WORKING / "triage_decisions.csv"
    assert out.exists() and out.stat().st_size > 0
    # By-tag counts add up to stones_tagged
    by_tag = env["outputs"]["by_tag"]
    assert sum(by_tag.values()) == env["outputs"]["stones_tagged"]


def test_repricing_envelope_consumes_triage_output():
    # Step 1 first…
    _run_step(
        REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py",
        ["--stock-id", "ALL"],
    )
    # …then step 2
    env = _run_step(
        REPO / "automations" / "propose-repricing" / "scripts" / "propose_repricing.py",
        ["--stock-id", "ALL", "--threshold-pct", "7.0"],
    )
    assert env["status"] == "ok"
    assert env["next_action"] == "rank-customer-clv"
    assert env["outputs"]["threshold_pct"] == 7.0
    # rows_written = auto_count + review_count
    o = env["outputs"]
    assert o["rows_written"] == o["auto_count"] + o["review_count"]


def test_clv_envelope_quartiles_sum_correctly():
    env = _run_step(
        REPO / "automations" / "rank-customer-clv" / "scripts" / "rank_customer_clv.py",
        ["--entity-id", "ALL"],
    )
    assert env["status"] == "ok"
    assert env["next_action"] == "decide-memo"
    counts = env["outputs"]["tier_counts"]
    assert sum(counts.values()) == env["outputs"]["entities_ranked"]


def test_decide_memo_envelope_deterministic():
    env = _run_step(
        REPO / "automations" / "decide-memo" / "scripts" / "decide_memo.py",
        ["--memo-id", "ALL"],
    )
    assert env["status"] == "ok"
    assert env["skill_name"] == "decide-memo"
    assert env["next_action"] == "done"
    # Deterministic — confidence is 1.0, no narration toggle
    assert env["confidence"] == 1.0
    assert "narration_used" not in env["outputs"]
    # auto_approve + auto_reject + needs_review = total (3-bucket routing)
    o = env["outputs"]
    assert o["auto_approved"] + o["auto_rejected"] + o["needs_review"] == o["memos_reviewed"]


# ---------------------------------------------------------------------------
# Chained orchestrator test
# ---------------------------------------------------------------------------


def test_orchestrator_runs_full_chain():
    cmd = [
        sys.executable,
        str(REPO / "scripts" / "orchestrator.py"),
        "--today", "2026-05-14",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          cwd=str(REPO), check=False)
    assert proc.returncode == 0, f"orchestrator failed:\n{proc.stderr}"
    out = proc.stdout
    # Every step name appears in the output
    for step in ("triage-inventory", "propose-repricing",
                 "rank-customer-clv", "decide-memo"):
        assert f"step: {step}" in out, f"missing step: {step}"
    # Final completion line
    assert "Workflow finished after decide-memo" in out


# ---------------------------------------------------------------------------
# Cross-step invariants on the produced CSVs
# ---------------------------------------------------------------------------


def test_workflow_action_log_records_every_step():
    # Run the orchestrator
    subprocess.run(
        [sys.executable, str(REPO / "scripts" / "orchestrator.py"),
         "--today", "2026-05-14"],
        capture_output=True, text=True, cwd=str(REPO), check=True,
    )
    log = WORKING / "workflow_action_log.csv"
    assert log.exists()
    lines = log.read_text().splitlines()
    # header + at least 4 step rows
    assert len(lines) >= 5
    text = "\n".join(lines)
    for step in ("triage-inventory", "propose-repricing",
                 "rank-customer-clv", "decide-memo"):
        assert step in text


def test_repricing_auto_and_review_are_disjoint_in_csv():
    # Need step 1 first so the hand-off exists
    _run_step(
        REPO / "automations" / "triage-inventory" / "scripts" / "triage_inventory.py",
        ["--stock-id", "ALL"],
    )
    _run_step(
        REPO / "automations" / "propose-repricing" / "scripts" / "propose_repricing.py",
        ["--stock-id", "ALL"],
    )
    import csv
    rows = list(csv.DictReader((WORKING / "repricing_proposals.csv").open()))
    auto_ids   = {r["stock_id"] for r in rows if r["queue"] == "auto"}
    review_ids = {r["stock_id"] for r in rows if r["queue"] == "review"}
    assert auto_ids.isdisjoint(review_ids), (
        f"{len(auto_ids & review_ids)} stones ended up in BOTH auto AND review"
    )
