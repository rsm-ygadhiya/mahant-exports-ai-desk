"""Tests for `app/autopilot.py` policy helpers.

The end-to-end ``run_autopilot`` is exercised against the real seed CSVs and
checked for invariants (output schema, non-overlap between auto and review
splits, headline content).
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import polars as pl
import pytest

from app import autopilot

_REPO_ROOT = Path(__file__).resolve().parents[1]

classify_clv_tiers = autopilot.classify_clv_tiers
split_repricing = autopilot.split_repricing
split_memos = autopilot.split_memos
triage_counts = autopilot.triage_counts
build_headline = autopilot.build_headline
run_autopilot = autopilot.run_autopilot


# ---------------------------------------------------------------------------
# classify_clv_tiers
# ---------------------------------------------------------------------------


def test_classify_clv_tiers_empty():
    assert classify_clv_tiers(pl.DataFrame({"entity_id": [], "clv": []})) == {}


def test_classify_clv_tiers_quartiles():
    df = pl.DataFrame(
        {
            "entity_id": [f"E{i}" for i in range(8)],
            "clv": [800.0, 700, 600, 500, 400, 300, 200, 100],
        }
    )
    tiers = classify_clv_tiers(df)
    # 8 entities → 2 Top, 2 High, 2 Mid, 2 Low
    assert tiers["E0"] == "Top"
    assert tiers["E1"] == "Top"
    assert tiers["E2"] == "High"
    assert tiers["E3"] == "High"
    assert tiers["E4"] == "Mid"
    assert tiers["E5"] == "Mid"
    assert tiers["E6"] == "Low"
    assert tiers["E7"] == "Low"


def test_classify_clv_tiers_single_entity():
    df = pl.DataFrame({"entity_id": ["E1"], "clv": [1000.0]})
    tiers = classify_clv_tiers(df)
    assert tiers["E1"] == "Top"


# ---------------------------------------------------------------------------
# split_repricing
# ---------------------------------------------------------------------------


def _repricing_df(rows):
    """Build a minimal repricing DataFrame for tests."""
    schema = {
        "stock_id": pl.Utf8,
        "old_price": pl.Float64,
        "proposed_price": pl.Float64,
        "pct_change": pl.Float64,
        "flag": pl.Utf8,
    }
    return pl.DataFrame(rows, schema=schema)


def test_split_repricing_empty():
    df = _repricing_df([])
    auto, review = split_repricing(df, threshold_pct=7.0)
    assert auto.is_empty() and review.is_empty()


def test_split_repricing_small_move_auto_applies():
    df = _repricing_df([
        {"stock_id": "S1", "old_price": 1000.0, "proposed_price": 1050.0,
         "pct_change": 5.0, "flag": ""},
    ])
    auto, review = split_repricing(df, threshold_pct=7.0)
    assert len(auto) == 1 and len(review) == 0
    assert auto["stock_id"].to_list() == ["S1"]


def test_split_repricing_large_move_needs_review():
    df = _repricing_df([
        {"stock_id": "S1", "old_price": 1000.0, "proposed_price": 1150.0,
         "pct_change": 15.0, "flag": ""},
    ])
    auto, review = split_repricing(df, threshold_pct=7.0)
    assert len(auto) == 0 and len(review) == 1


def test_split_repricing_frozen_margin_quote_route_to_review():
    df = _repricing_df([
        {"stock_id": "F1", "old_price": 1000.0, "proposed_price": 1000.0,
         "pct_change": 0.0, "flag": "frozen"},
        {"stock_id": "M1", "old_price": 1000.0, "proposed_price": 900.0,
         "pct_change": -10.0, "flag": "margin"},
        {"stock_id": "Q1", "old_price": 1000.0, "proposed_price": 1020.0,
         "pct_change": 2.0, "flag": "quote"},
    ])
    auto, review = split_repricing(df, threshold_pct=7.0)
    assert len(auto) == 0
    assert set(review["stock_id"].to_list()) == {"F1", "M1", "Q1"}


def test_split_repricing_uppercase_flags_also_route_to_review():
    """The repricing skill emits flags as 'MARGIN' / 'FROZEN' / 'QUOTE' (uppercase).
    Without case-insensitive matching, these would silently leak into auto.
    """
    df = _repricing_df([
        {"stock_id": "F1", "old_price": 1000.0, "proposed_price": 1000.0,
         "pct_change": 0.0, "flag": "FROZEN"},
        {"stock_id": "M1", "old_price": 1000.0, "proposed_price": 1010.0,
         "pct_change": 1.0, "flag": "MARGIN"},
        {"stock_id": "Q1", "old_price": 1000.0, "proposed_price": 1020.0,
         "pct_change": 2.0, "flag": "QUOTE"},
    ])
    auto, review = split_repricing(df, threshold_pct=7.0)
    assert auto.is_empty()
    assert set(review["stock_id"].to_list()) == {"F1", "M1", "Q1"}


def test_split_repricing_zero_change_not_auto_applied():
    df = _repricing_df([
        {"stock_id": "Z1", "old_price": 1000.0, "proposed_price": 1000.0,
         "pct_change": 0.0, "flag": "unchanged"},
    ])
    auto, review = split_repricing(df, threshold_pct=7.0)
    # No move = nothing to apply, but also not a review item — falls out of both
    assert auto.is_empty()
    assert review.is_empty()


def test_split_repricing_threshold_is_inclusive():
    df = _repricing_df([
        {"stock_id": "E1", "old_price": 100.0, "proposed_price": 107.0,
         "pct_change": 7.0, "flag": ""},
    ])
    auto, _ = split_repricing(df, threshold_pct=7.0)
    assert len(auto) == 1


# ---------------------------------------------------------------------------
# split_memos
# ---------------------------------------------------------------------------


def _memo_df(rows):
    schema = {
        "memo_id": pl.Utf8,
        "stock_id": pl.Utf8,
        "customer_id": pl.Utf8,
        "broker_id": pl.Utf8,
        "decision": pl.Utf8,
        "opportunity_score": pl.Int64,
        "reliability_score": pl.Int64,
    }
    return pl.DataFrame(rows, schema=schema)


def test_split_memos_empty():
    auto, review = split_memos(_memo_df([]), {}, {})
    assert auto.is_empty() and review.is_empty()


def test_split_memos_top_clv_approve_auto():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "B1",
         "decision": "APPROVE", "opportunity_score": 40, "reliability_score": 80},
    ])
    auto, review = split_memos(
        df,
        tier_lookup={"B1": "Top"},
        triage_lookup={"S1": "WATCH"},
    )
    assert len(auto) == 1 and len(review) == 0


def test_split_memos_low_clv_routes_to_review():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "B1",
         "decision": "APPROVE", "opportunity_score": 40, "reliability_score": 80},
    ])
    auto, review = split_memos(
        df,
        tier_lookup={"B1": "Low"},
        triage_lookup={"S1": "WATCH"},
    )
    assert len(auto) == 0 and len(review) == 1


def test_split_memos_hold_stone_blocks_auto_even_for_top_customer():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "B1",
         "decision": "APPROVE", "opportunity_score": 40, "reliability_score": 80},
    ])
    auto, review = split_memos(
        df,
        tier_lookup={"B1": "Top"},
        triage_lookup={"S1": "HOLD"},
    )
    assert len(auto) == 0 and len(review) == 1


def test_split_memos_conditions_and_rejects_always_review():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "B1",
         "decision": "APPROVE_WITH_CONDITIONS", "opportunity_score": 40, "reliability_score": 80},
        {"memo_id": "M2", "stock_id": "S2", "customer_id": "C2", "broker_id": "B2",
         "decision": "REJECT", "opportunity_score": 90, "reliability_score": 20},
    ])
    auto, review = split_memos(
        df,
        tier_lookup={"B1": "Top", "B2": "Top"},
        triage_lookup={},
    )
    assert auto.is_empty()
    assert len(review) == 2


def test_split_memos_high_opportunity_score_blocks_auto():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "B1",
         "decision": "APPROVE", "opportunity_score": 95, "reliability_score": 80},
    ])
    auto, review = split_memos(
        df,
        tier_lookup={"B1": "Top"},
        triage_lookup={"S1": "WATCH"},
        opp_score_ceiling=70,
    )
    assert auto.is_empty() and len(review) == 1


def test_split_memos_customer_id_fallback_when_no_broker_tier():
    df = _memo_df([
        {"memo_id": "M1", "stock_id": "S1", "customer_id": "C1", "broker_id": "",
         "decision": "APPROVE", "opportunity_score": 40, "reliability_score": 80},
    ])
    auto, _ = split_memos(
        df,
        tier_lookup={"C1": "High"},
        triage_lookup={},
    )
    assert len(auto) == 1


# ---------------------------------------------------------------------------
# triage_counts + headline
# ---------------------------------------------------------------------------


def test_triage_counts_empty_returns_zero_buckets():
    counts = triage_counts(pl.DataFrame())
    assert counts == {"CLEAR": 0, "DISCOUNT": 0, "WATCH": 0, "HOLD": 0}


def test_triage_counts_aggregates():
    df = pl.DataFrame({"action_tag": ["CLEAR", "CLEAR", "HOLD", "WATCH"]})
    counts = triage_counts(df)
    assert counts == {"CLEAR": 2, "DISCOUNT": 0, "WATCH": 1, "HOLD": 1}


def test_build_headline_mentions_counts():
    empty = pl.DataFrame()
    h = build_headline({"CLEAR": 1, "DISCOUNT": 2, "WATCH": 3, "HOLD": 4}, empty, empty, empty, empty)
    assert "10 stones triaged" in h
    assert "0 prices auto-applied" in h
    assert "0 memos auto-approved" in h
    assert "0 items need review" in h


# ---------------------------------------------------------------------------
# End-to-end smoke test against seed CSVs
# ---------------------------------------------------------------------------


_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"
_SEED_DATE = dt.date(2026, 5, 4)


@pytest.fixture(scope="module")
def seeds():
    """Load every seed CSV once for the chain-invariant tests."""
    if not (_DATA_DIR / "inventory_seed.csv").exists():
        pytest.skip("seed data not present")
    return {
        "inv":       pl.read_csv(_DATA_DIR / "inventory_seed.csv"),
        "rap":       pl.read_csv(_DATA_DIR / "rap_weekly_seed.csv"),
        "sales":     pl.read_csv(_DATA_DIR / "sales_transactions_seed.csv"),
        "demand":    pl.read_csv(_DATA_DIR / "demand_signals_seed.csv"),
        "memos":     pl.read_csv(_DATA_DIR / "memos_seed.csv"),
        "quotes":    pl.read_csv(_DATA_DIR / "quotes_seed.csv"),
        "payments":  pl.read_csv(_DATA_DIR / "payment_history_seed.csv"),
        "customers": pl.read_csv(_DATA_DIR / "customers_seed.csv"),
        "comms":     pl.read_csv(_DATA_DIR / "communication_logs_seed.csv"),
    }


@pytest.fixture(scope="module")
def chain_report(seeds):
    """Run the whole chain once and reuse the report across invariant tests."""
    return run_autopilot(
        seeds["inv"], seeds["rap"], seeds["sales"], seeds["demand"],
        seeds["memos"], seeds["quotes"], seeds["payments"],
        seeds["customers"], seeds["comms"],
        today=_SEED_DATE,
    )


def test_run_autopilot_smoke_against_seeds(chain_report):
    """The chain runs end-to-end and the report has the expected shape."""
    report = chain_report
    assert isinstance(report.headline, str) and report.headline
    assert sum(report.triage_counts.values()) >= 0
    assert report.repricing_auto.is_empty() or "stock_id" in report.repricing_auto.columns
    assert report.repricing_review.is_empty() or "stock_id" in report.repricing_review.columns
    assert isinstance(report.clv_tiers, dict)
    assert report.config["price_auto_threshold_pct"] == 7.0
    assert "Top" in report.config["auto_approve_tiers"]


def test_chain_progress_cb_fires_in_order(seeds):
    """Each step fires a 'running' then 'done' event, in workflow order."""
    events: list[tuple[str, str]] = []
    run_autopilot(
        seeds["inv"], seeds["rap"], seeds["sales"], seeds["demand"],
        seeds["memos"], seeds["quotes"], seeds["payments"],
        seeds["customers"], seeds["comms"],
        today=_SEED_DATE,
        progress_cb=lambda step, status, payload: events.append((step, status)),
    )
    assert events == [
        ("triage",    "running"), ("triage",    "done"),
        ("repricing", "running"), ("repricing", "done"),
        ("clv",       "running"), ("clv",       "done"),
        ("memos",     "running"), ("memos",     "done"),
    ]


# ---------------------------------------------------------------------------
# Chain-invariant tests — assert handoffs are correct, not just each skill
# ---------------------------------------------------------------------------


def test_chain_repricing_auto_review_disjoint(chain_report):
    """A stone is never in both repricing_auto and repricing_review."""
    auto_ids = set(chain_report.repricing_auto["stock_id"].to_list()) \
        if not chain_report.repricing_auto.is_empty() else set()
    review_ids = set(chain_report.repricing_review["stock_id"].to_list()) \
        if not chain_report.repricing_review.is_empty() else set()
    overlap = auto_ids & review_ids
    assert overlap == set(), (
        f"{len(overlap)} stones leaked into both auto and review queues — "
        f"the threshold split is not exclusive."
    )


def test_chain_repricing_auto_obeys_threshold(chain_report):
    """Every auto-applied price move is within the threshold and has a safe flag.

    This proves the handoff to decision point A produced a clean partition.
    """
    if chain_report.repricing_auto.is_empty():
        pytest.skip("no auto-applied repricing rows in this run")
    threshold = chain_report.config["price_auto_threshold_pct"]
    for row in chain_report.repricing_auto.iter_rows(named=True):
        assert abs(row["pct_change"]) <= threshold, (
            f"{row['stock_id']} auto-applied at "
            f"{row['pct_change']:+.2f}% > ±{threshold}%"
        )
        assert (row["flag"] or "").lower() not in ("frozen", "margin", "quote"), (
            f"{row['stock_id']} auto-applied with unsafe flag {row['flag']!r}"
        )
        assert row["pct_change"] != 0, "no-op rows should not be in auto queue"


def test_chain_memo_auto_never_hold_or_low_tier(chain_report):
    """Every auto-approved memo: stone is not HOLD AND customer is Top/High.

    This proves the cross-skill handoff (triage tags + CLV tiers) reaches the
    final auto-approve decision correctly.
    """
    if chain_report.memo_auto.is_empty():
        pytest.skip("no auto-approved memos in this run")
    allowed_tiers = set(chain_report.config["auto_approve_tiers"])
    for row in chain_report.memo_auto.iter_rows(named=True):
        assert row.get("triage_tag") != "HOLD", (
            f"memo {row['memo_id']} auto-approved on a HOLD-tagged stone "
            f"({row['stock_id']})"
        )
        assert row.get("tier") in allowed_tiers, (
            f"memo {row['memo_id']} auto-approved for tier "
            f"{row.get('tier')!r} (allowed: {allowed_tiers})"
        )
        assert row.get("decision") == "APPROVE", (
            f"memo {row['memo_id']} auto-approved despite skill decision "
            f"{row.get('decision')!r}"
        )


def test_chain_triage_tags_consumed_by_repricing(seeds):
    """Cross-skill handoff: a CLEAR-tagged stone should get a different
    proposed price than the same stone without a tag.

    We run repricing twice — once with the real triage output, once with no
    tags — and assert the prices differ for at least some CLEAR stones.
    """
    from app import autopilot as _ap

    triage_mod = _ap._load_skill("inventory-aging-triage", "inventory_aging_skill")
    reprice_mod = _ap._load_skill("weekly-repricing", "repricing_skill")

    triage_df = triage_mod.triage_inventory(
        seeds["inv"], seeds["sales"], seeds["demand"], seeds["comms"],
        today=_SEED_DATE,
    )
    if triage_df.is_empty():
        pytest.skip("no triage output")

    clear_stocks = (
        triage_df.filter(pl.col("action_tag") == "CLEAR")["stock_id"].to_list()
    )
    if not clear_stocks:
        pytest.skip("no CLEAR-tagged stones in this run")

    triage_lookup = {r["stock_id"]: r["action_tag"] for r in triage_df.to_dicts()}

    with_tags = reprice_mod.compute_repricing(
        seeds["inv"], seeds["rap"], seeds["sales"], seeds["demand"],
        seeds["memos"], seeds["quotes"],
        triage_tags=triage_lookup, today=_SEED_DATE,
    )
    without_tags = reprice_mod.compute_repricing(
        seeds["inv"], seeds["rap"], seeds["sales"], seeds["demand"],
        seeds["memos"], seeds["quotes"],
        triage_tags={}, today=_SEED_DATE,
    )

    # Build {stock_id: proposed_price} from both runs for the CLEAR stones
    def _prices_for(df, ids):
        sub = df.filter(pl.col("stock_id").is_in(ids))
        return {r["stock_id"]: r["proposed_price"] for r in sub.to_dicts()}

    a = _prices_for(with_tags, clear_stocks)
    b = _prices_for(without_tags, clear_stocks)

    differing = [s for s in clear_stocks if s in a and s in b and a[s] != b[s]]
    assert differing, (
        "Triage tags did not change any CLEAR-stone price in repricing — "
        "the Step 1 → Step 2 handoff is not actually being applied."
    )
