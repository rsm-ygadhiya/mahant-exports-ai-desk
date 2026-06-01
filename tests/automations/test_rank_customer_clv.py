"""Per-automation tests for rank-customer-clv."""

from __future__ import annotations

import pytest

from tests.automations._helpers import (
    REPO, WORKING, clean_working, read_csv, run_script,
)

SCRIPT = REPO / "automations" / "rank-customer-clv" / "scripts" / "rank_customer_clv.py"


@pytest.fixture(autouse=True)
def _clean():
    clean_working()
    yield


def test_envelope_shape():
    env = run_script(SCRIPT, ["--entity-id", "ALL"])
    assert env["status"] == "ok"
    assert env["skill_name"] == "rank-customer-clv"
    assert env["next_action"] == "decide-memo"


def test_tier_counts_sum_to_entities_ranked():
    env = run_script(SCRIPT, ["--entity-id", "ALL"])
    o = env["outputs"]
    assert sum(o["tier_counts"].values()) == o["entities_ranked"]


def test_all_tiers_are_known():
    run_script(SCRIPT, ["--entity-id", "ALL"])
    rows = read_csv(WORKING / "clv_tiers.csv")
    valid = {"Top", "High", "Mid", "Low"}
    for r in rows:
        assert r["tier"] in valid, f"unknown tier: {r['tier']!r}"


def test_clv_values_are_numeric():
    """CLV may be negative (sub-margin customers); just check it's a real number."""
    run_script(SCRIPT, ["--entity-id", "ALL"])
    rows = read_csv(WORKING / "clv_tiers.csv")
    assert len(rows) > 0
    for r in rows:
        # If this raises, the column isn't numeric
        float(r["clv"])


def test_tiers_are_evenly_distributed():
    """The CLV ranking uses quartile bucketing, so tier counts should be close."""
    env = run_script(SCRIPT, ["--entity-id", "ALL"])
    counts = list(env["outputs"]["tier_counts"].values())
    spread = max(counts) - min(counts)
    # Quartile bucketing with N customers may have ±1 row in extreme tiers
    assert spread <= 2, f"tier counts too uneven: {env['outputs']['tier_counts']}"
