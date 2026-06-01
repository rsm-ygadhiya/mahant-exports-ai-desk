"""Autopilot — a thin orchestrator that chains the four daily skills.

What this file is:
  - A trigger that calls each skill in order: Triage → Repricing → CLV → Memos.
  - The threshold logic that decides which results are safe to auto-apply
    and which need a human to look at them.

What this file is NOT:
  - It doesn't talk to the database, Streamlit, or the LLM directly.
  - It doesn't render anything. Callers (the UI or the cron script) take the
    returned ``AutopilotReport`` and decide what to do with it.

Thresholds that escalate to a human
-----------------------------------
- A repricing row stays automatic only when:
    flag not in {frozen, margin, quote}  AND
    0 < |pct_change| <= price_auto_threshold_pct  (default 7 %)
- A memo decision stays automatic only when:
    decision == "APPROVE"                AND
    customer tier in auto_approve_tiers  (default {"Top", "High"})  AND
    triage tag of the stone != "HOLD"    AND
    opportunity_score <= opp_score_ceiling  (default 70)

Anything that fails a threshold is returned in the ``*_review`` DataFrame on
the report — that's the queue the human-in-the-loop UI shows.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from typing import NamedTuple

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ---------------------------------------------------------------------------
# Skill loader (inline — keeps this script standalone)
# ---------------------------------------------------------------------------

import importlib.util  # noqa: E402

_skill_cache: dict[str, object] = {}


def _load_skill(skill_dir: str, script_name: str) -> object:
    """Import a skill module from ``skills/<skill_dir>/scripts/<script_name>.py``.

    Skill directory names contain hyphens (e.g. ``weekly-repricing``), so they
    can't be loaded with a normal ``import``. We use ``importlib`` and cache
    the result so repeated calls within the same process are free.
    """
    if script_name in _skill_cache:
        return _skill_cache[script_name]
    path = _REPO_ROOT / "skills" / skill_dir / "scripts" / f"{script_name}.py"
    spec = importlib.util.spec_from_file_location(script_name, path)
    assert spec and spec.loader, f"cannot load skill from {path}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _skill_cache[script_name] = mod
    return mod


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_PRICE_AUTO_THRESHOLD_PCT = 7.0
DEFAULT_AUTO_APPROVE_TIERS: tuple[str, ...] = ("Top", "High")
DEFAULT_OPP_SCORE_CEILING = 70


# ---------------------------------------------------------------------------
# Return container
# ---------------------------------------------------------------------------


class AutopilotReport(NamedTuple):
    today: dt.date
    triage: pl.DataFrame              # full triage table (auto-applied)
    triage_counts: dict[str, int]     # {"CLEAR": n, "DISCOUNT": n, ...}
    repricing_auto: pl.DataFrame      # safe price moves — auto-apply
    repricing_review: pl.DataFrame    # bigger / margin / unusual — human-in-loop
    memo_auto: pl.DataFrame           # auto-approve list
    memo_review: pl.DataFrame         # human-in-loop memo decisions
    clv_tiers: dict[str, str]         # entity_id -> tier
    headline: str                     # one-line summary
    config: dict                      # snapshot of thresholds used


# ---------------------------------------------------------------------------
# CLV → tier
# ---------------------------------------------------------------------------


def classify_clv_tiers(clv_df: pl.DataFrame) -> dict[str, str]:
    """Bucket entities into Top / High / Mid / Low by CLV quartiles.

    - Top  = top 25 % by CLV
    - High = next 25 %
    - Mid  = next 25 %
    - Low  = bottom 25 %

    Empty / single-entity inputs → everyone is "Top" (no signal to rank).
    """
    if clv_df.is_empty():
        return {}

    rows = clv_df.sort("clv", descending=True).to_dicts()
    n = len(rows)
    if n == 0:
        return {}

    # Cutoff indices for top/high/mid in sorted-desc order
    top_cut = max(1, n // 4)
    high_cut = max(top_cut + 1, n // 2)
    mid_cut = max(high_cut + 1, (3 * n) // 4)

    tiers: dict[str, str] = {}
    for i, r in enumerate(rows):
        eid = r["entity_id"]
        if i < top_cut:
            tiers[eid] = "Top"
        elif i < high_cut:
            tiers[eid] = "High"
        elif i < mid_cut:
            tiers[eid] = "Mid"
        else:
            tiers[eid] = "Low"
    return tiers


# ---------------------------------------------------------------------------
# Repricing split
# ---------------------------------------------------------------------------


# The repricing skill emits flags in UPPERCASE ("FROZEN", "MARGIN", "QUOTE",
# "UNCHANGED"). We match case-insensitively so the policy is robust if the
# skill's convention changes.
_UNSAFE_FLAGS = {"frozen", "margin", "quote"}


def _is_unsafe_flag(flag: str | None) -> bool:
    return bool(flag) and flag.lower() in _UNSAFE_FLAGS


def split_repricing(
    repriced: pl.DataFrame,
    threshold_pct: float = DEFAULT_PRICE_AUTO_THRESHOLD_PCT,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Split repricing output into auto-apply vs review.

    Auto-apply if:
      - flag is not FROZEN, MARGIN, or QUOTE (case-insensitive)
      - 0 < |pct_change| <= threshold_pct
    Review otherwise (unsafe flag OR |pct_change| > threshold).
    """
    if repriced.is_empty():
        return repriced, repriced

    flag_lower = pl.col("flag").cast(pl.Utf8).str.to_lowercase()
    abs_change = pl.col("pct_change").abs()
    unsafe = flag_lower.is_in(list(_UNSAFE_FLAGS))

    auto_mask = (~unsafe) & (abs_change > 0) & (abs_change <= threshold_pct)
    review_mask = unsafe | (abs_change > threshold_pct)

    auto = repriced.filter(auto_mask)
    review = repriced.filter(review_mask)
    return auto, review


# ---------------------------------------------------------------------------
# Memo split
# ---------------------------------------------------------------------------


def split_memos(
    memo_df: pl.DataFrame,
    tier_lookup: dict[str, str],
    triage_lookup: dict[str, str],
    auto_tiers: tuple[str, ...] = DEFAULT_AUTO_APPROVE_TIERS,
    opp_score_ceiling: int = DEFAULT_OPP_SCORE_CEILING,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Split memo decisions into auto-approve vs review.

    Auto-approve only when ALL of:
      - skill decision == "APPROVE"
      - customer (or broker) tier is in auto_tiers
      - stone is not tagged HOLD by triage
      - opportunity_score <= opp_score_ceiling

    Everything else (APPROVE_WITH_CONDITIONS, REJECT, low-CLV approvals,
    HOLD-tagged stones, hot stones) routes to review.
    """
    if memo_df.is_empty():
        return memo_df, memo_df

    rows = memo_df.to_dicts()
    auto_rows: list[dict] = []
    review_rows: list[dict] = []

    for r in rows:
        cust_id = r.get("customer_id", "")
        broker_id = r.get("broker_id", "")
        stock_id = r.get("stock_id", "")

        # Prefer broker tier if the broker is the "rolling-up" entity in CLV.
        tier = tier_lookup.get(broker_id) or tier_lookup.get(cust_id) or "Unknown"
        triage_tag = triage_lookup.get(stock_id, "")
        opp = int(r.get("opportunity_score", 100))
        decision = r.get("decision", "")

        r_enriched = {**r, "tier": tier, "triage_tag": triage_tag}

        is_auto = (
            decision == "APPROVE"
            and tier in auto_tiers
            and triage_tag != "HOLD"
            and opp <= opp_score_ceiling
        )

        if is_auto:
            auto_rows.append(r_enriched)
        else:
            review_rows.append(r_enriched)

    schema = {**memo_df.schema, "tier": pl.Utf8, "triage_tag": pl.Utf8}
    auto_out = pl.DataFrame(auto_rows, schema=schema) if auto_rows else pl.DataFrame(schema=schema)
    review_out = pl.DataFrame(review_rows, schema=schema) if review_rows else pl.DataFrame(schema=schema)
    return auto_out, review_out


# ---------------------------------------------------------------------------
# Triage counts
# ---------------------------------------------------------------------------


def triage_counts(triage_df: pl.DataFrame) -> dict[str, int]:
    """Return {CLEAR, DISCOUNT, WATCH, HOLD} counts. Missing tags default to 0."""
    base = {"CLEAR": 0, "DISCOUNT": 0, "WATCH": 0, "HOLD": 0}
    if triage_df.is_empty() or "action_tag" not in triage_df.columns:
        return base
    grouped = triage_df.group_by("action_tag").agg(pl.len().alias("n")).to_dicts()
    for r in grouped:
        base[r["action_tag"]] = int(r["n"])
    return base


# ---------------------------------------------------------------------------
# Headline
# ---------------------------------------------------------------------------


def build_headline(
    triage_n: dict[str, int],
    repricing_auto: pl.DataFrame,
    repricing_review: pl.DataFrame,
    memo_auto: pl.DataFrame,
    memo_review: pl.DataFrame,
) -> str:
    parts = [
        f"{sum(triage_n.values())} stones triaged",
        f"{len(repricing_auto)} prices auto-applied",
        f"{len(memo_auto)} memos auto-approved",
        f"{len(repricing_review) + len(memo_review)} items need review",
    ]
    return " • ".join(parts)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run_autopilot(
    inventory: pl.DataFrame,
    rap: pl.DataFrame,
    sales: pl.DataFrame,
    demand: pl.DataFrame,
    memos: pl.DataFrame,
    quotes: pl.DataFrame,
    payment_history: pl.DataFrame,
    customers: pl.DataFrame,
    comms: pl.DataFrame,
    today: dt.date | None = None,
    price_auto_threshold_pct: float = DEFAULT_PRICE_AUTO_THRESHOLD_PCT,
    auto_approve_tiers: tuple[str, ...] = DEFAULT_AUTO_APPROVE_TIERS,
    opp_score_ceiling: int = DEFAULT_OPP_SCORE_CEILING,
    progress_cb=None,
) -> AutopilotReport:
    """Chain the four skills and apply the auto-vs-human thresholds.

    ``progress_cb(step_name, status, payload)`` is called between steps so
    callers (e.g. the Streamlit UI) can show a live ticker. Pass ``None`` for
    headless / test runs.

    step_name: "triage" | "repricing" | "clv" | "memos"
    status:    "running" | "done"
    payload:   dict with step-specific counts (only on "done")
    """
    if today is None:
        today = dt.date.today()

    def _say(step: str, status: str, payload: dict | None = None) -> None:
        if progress_cb is not None:
            progress_cb(step, status, payload or {})

    # Load skills directly from disk so this script has no app-package deps.
    triage_mod = _load_skill("inventory-aging-triage", "inventory_aging_skill")
    reprice_mod = _load_skill("weekly-repricing", "repricing_skill")
    memo_mod = _load_skill("memo-approval", "memo_approval")
    clv_mod = _load_skill("clv-broker-company", "clv_broker_company")

    # ── 1. Triage ────────────────────────────────────────────────────────
    _say("triage", "running")
    triage_df = triage_mod.triage_inventory(inventory, sales, demand, comms, today=today)
    triage_lookup = (
        {r["stock_id"]: r["action_tag"] for r in triage_df.to_dicts()}
        if not triage_df.is_empty()
        else {}
    )
    counts = triage_counts(triage_df)
    _say("triage", "done", {"total": sum(counts.values()), "by_tag": counts})

    # ── 2. Repricing ─────────────────────────────────────────────────────
    _say("repricing", "running")
    repriced = reprice_mod.compute_repricing(
        inventory, rap, sales, demand, memos, quotes,
        triage_tags=triage_lookup, today=today,
    )
    repricing_auto, repricing_review = split_repricing(repriced, price_auto_threshold_pct)
    _say("repricing", "done",
         {"auto": len(repricing_auto), "review": len(repricing_review)})

    # ── 3. CLV tiering ───────────────────────────────────────────────────
    _say("clv", "running")
    customers_clv = customers.with_columns(
        pl.when(pl.col("is_broker").cast(pl.Utf8).is_in(["1", "true", "True"]))
        .then(pl.lit("true"))
        .otherwise(pl.lit("false"))
        .alias("is_broker")
    )
    broker_clv = clv_mod.compute_all_clv("broker", sales, customers_clv, today=today)
    company_clv = clv_mod.compute_all_clv("company", sales, customers_clv, today=today)
    tier_lookup = {**classify_clv_tiers(company_clv), **classify_clv_tiers(broker_clv)}
    _say("clv", "done", {"ranked": len(tier_lookup)})

    # ── 4. Memo approval ─────────────────────────────────────────────────
    _say("memos", "running")
    decisions = memo_mod.review_pending(
        memos, inventory, payment_history, demand, customers,
        triage_lookup, today,
    )
    memo_df = (
        pl.DataFrame([d._asdict() for d in decisions]) if decisions else pl.DataFrame()
    )
    memo_auto, memo_review = split_memos(
        memo_df, tier_lookup, triage_lookup,
        auto_tiers=auto_approve_tiers,
        opp_score_ceiling=opp_score_ceiling,
    )
    _say("memos", "done",
         {"auto": len(memo_auto), "review": len(memo_review)})

    headline = build_headline(counts, repricing_auto, repricing_review, memo_auto, memo_review)

    return AutopilotReport(
        today=today,
        triage=triage_df,
        triage_counts=counts,
        repricing_auto=repricing_auto,
        repricing_review=repricing_review,
        memo_auto=memo_auto,
        memo_review=memo_review,
        clv_tiers=tier_lookup,
        headline=headline,
        config={
            "price_auto_threshold_pct": price_auto_threshold_pct,
            "auto_approve_tiers": list(auto_approve_tiers),
            "opp_score_ceiling": opp_score_ceiling,
        },
    )
