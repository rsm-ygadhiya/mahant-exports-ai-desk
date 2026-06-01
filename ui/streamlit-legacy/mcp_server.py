"""MCP server for Pramukh Gems — Milestone 03, Section 2.

Exposes three tools that wrap M02 skill functions so an LLM can invoke them
through the Model Context Protocol. Each tool maps to one step of the M01
daily-workflow diagram.

Run as a stdio server:
    uv run python -m app.mcp_server

Register with Claude Code (or any MCP client) by pointing the client at the
command above.

Public tools (see also docs/M03_MCP.md for full reference):

- ``get_triage_tags(today)``        — Step 1 of workflow
- ``propose_repricing(today, ...)`` — Step 2 of workflow
- ``review_memo(memo_id, today)``   — Step 4 of workflow
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from typing import Any

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from mcp.server.fastmcp import FastMCP  # noqa: E402

# Reuse the inline skill-loader and threshold helpers from autopilot — they're
# the exact same code that the orchestrator already uses.
from app.autopilot import _load_skill, split_repricing  # noqa: E402
from app.db import read_table  # noqa: E402


mcp = FastMCP("pramukh-gems")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_today(today: str | None) -> dt.date:
    if not today:
        return dt.date.today()
    return dt.date.fromisoformat(today)


def _seed(path: Path) -> pl.DataFrame:
    """Read a seed CSV file from the project's data directory."""
    return pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / path)


# ---------------------------------------------------------------------------
# Tool 1 — Triage (Workflow Step 1)
# ---------------------------------------------------------------------------


@mcp.tool()
def get_triage_tags(today: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """Tag every available stone HOLD / WATCH / DISCOUNT / CLEAR.

    Wraps the M02 skill ``triage_inventory`` from
    ``skills/inventory-aging-triage``. Use this BEFORE proposing prices or
    deciding memo requests — the tag drives both downstream decisions.

    Args:
        today: ISO date (YYYY-MM-DD). Empty string = use current date.
        limit: Max number of rows to return (most-urgent first). Default 50.

    Returns:
        List of dicts with: stock_id, category_simple, age_in_stock_days,
        action_tag, suggested_price_move_pct, reason.
    """
    triage_mod = _load_skill("inventory-aging-triage", "inventory_aging_skill")
    inventory = read_table("inventory")
    sales = read_table("sales_transactions")
    demand = read_table("demand_signals")
    comms = _seed(Path("communication_logs_seed.csv"))

    triaged = triage_mod.triage_inventory(
        inventory, sales, demand, comms,
        today=_parse_today(today),
    )
    if triaged.is_empty():
        return []
    cols = [c for c in
            ["stock_id", "category_simple", "age_in_stock_days",
             "action_tag", "suggested_price_move_pct", "reason"]
            if c in triaged.columns]
    return triaged.select(cols).head(limit).to_dicts()


# ---------------------------------------------------------------------------
# Tool 2 — Repricing (Workflow Step 2)
# ---------------------------------------------------------------------------


@mcp.tool()
def propose_repricing(
    today: str = "",
    threshold_pct: float = 7.0,
    limit: int = 50,
) -> dict[str, Any]:
    """Propose new prices for every available stone and split into auto vs review.

    Wraps the M02 skill ``compute_repricing`` from ``skills/weekly-repricing``,
    then applies the Autopilot threshold rule: a move is safe to auto-apply
    only if ``|pct_change| <= threshold_pct`` and the flag is not in
    {frozen, margin, quote}. Everything else routes to a human review queue.

    Args:
        today: ISO date. Empty = use current date.
        threshold_pct: Auto-apply cap on |% change|. Default 7.0.
        limit: Max rows in each returned list.

    Returns:
        Dict with two keys:
          - ``auto_apply``  : list of safe price moves (apply without asking)
          - ``needs_review``: list of larger / flagged moves (human-in-loop)
        Each entry has: stock_id, category_simple, old_price, proposed_price,
        pct_change, flag, primary_driver.
    """
    reprice_mod = _load_skill("weekly-repricing", "repricing_skill")

    inventory = read_table("inventory")
    sales = read_table("sales_transactions")
    demand = read_table("demand_signals")
    memos = read_table("memos")
    quotes = read_table("quotes")
    triage_tags_tbl = read_table("triage_tags")
    rap = _seed(Path("rap_weekly_seed.csv"))

    triage_lookup = (
        {r["stock_id"]: r["action_tag"] for r in triage_tags_tbl.to_dicts()}
        if not triage_tags_tbl.is_empty()
        else {}
    )

    repriced = reprice_mod.compute_repricing(
        inventory, rap, sales, demand, memos, quotes,
        triage_tags=triage_lookup,
        today=_parse_today(today),
    )
    auto, review = split_repricing(repriced, threshold_pct=threshold_pct)

    cols = ["stock_id", "category_simple", "old_price", "proposed_price",
            "pct_change", "flag", "primary_driver"]

    def _proj(df: pl.DataFrame) -> list[dict[str, Any]]:
        if df.is_empty():
            return []
        present = [c for c in cols if c in df.columns]
        return df.select(present).head(limit).to_dicts()

    return {
        "threshold_pct": threshold_pct,
        "auto_apply": _proj(auto),
        "needs_review": _proj(review),
        "summary": {
            "auto_count": len(auto),
            "review_count": len(review),
        },
    }


# ---------------------------------------------------------------------------
# Tool 3 — Memo Approval (Workflow Step 4)
# ---------------------------------------------------------------------------


@mcp.tool()
def review_memo(memo_id: str, today: str = "") -> dict[str, Any]:
    """Score a single pending memo request and return APPROVE / WITH_CONDITIONS / REJECT.

    Wraps the M02 skill ``decide_memo`` from ``skills/memo-approval``. The
    skill computes a reliability score for the requester and an opportunity-
    cost score for the stone, then issues a recommendation. The caller (a
    human or a higher-level workflow) decides whether to act on it.

    Args:
        memo_id: ID of the memo to review (e.g. "MEMO00042"). Must exist
                 in the ``memos`` table with decision='Pending'.
        today: ISO date. Empty = use current date.

    Returns:
        Dict with: memo_id, stock_id, customer_id, decision, reason,
        reliability_score, opportunity_score,
        condition_min_price, condition_max_hold_days.

    Raises:
        ValueError: if memo_id is not found.
    """
    memo_mod = _load_skill("memo-approval", "memo_approval")

    memos = read_table("memos")
    inventory = read_table("inventory")
    payments = read_table("payment_history")
    demand = read_table("demand_signals")
    customers = read_table("customers")
    triage_tags_tbl = read_table("triage_tags")

    row_df = memos.filter(pl.col("memo_id") == memo_id)
    if row_df.is_empty():
        raise ValueError(f"memo_id {memo_id!r} not found")
    memo_row = row_df.to_dicts()[0]

    triage_lookup = (
        {r["stock_id"]: r["action_tag"] for r in triage_tags_tbl.to_dicts()}
        if not triage_tags_tbl.is_empty()
        else {}
    )

    decision = memo_mod.decide_memo(
        memo_row, inventory, memos, payments, demand, customers,
        triage_lookup, _parse_today(today),
    )
    return decision._asdict()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the MCP server over stdio (the protocol's default transport)."""
    mcp.run()


if __name__ == "__main__":
    main()
