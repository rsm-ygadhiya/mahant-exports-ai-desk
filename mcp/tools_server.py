"""MCP server — Pramukh Gems tools.

Exposes three tools that wrap M02/M03 Python functions so an LLM client
(Claude Code, Codex, etc.) can drive parts of the workflow.

Each tool maps to one workflow step:

| Tool                | Wraps                           | Workflow step              |
| ------------------- | ------------------------------- | -------------------------- |
| ``get_triage_tags``  | triage-inventory automation    | Step 1 — tag stones        |
| ``propose_repricing``| propose-repricing automation   | Step 2 — reprice + decide  |
| ``review_memo``      | decide-memo skill              | Step 4 — memo judgement    |

Run as stdio (the default MCP transport):

    uv run python -m mcp_servers.tools_server
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import sys
from pathlib import Path
from typing import Any

import polars as pl

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from mcp.server.fastmcp import FastMCP  # noqa: E402


def _load(name: str, path: Path):
    """importlib helper for hyphenated package paths."""
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader, f"cannot load {path}"
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_TRIAGE   = _load("triage_core",   REPO_ROOT / "automations" / "triage-inventory"   / "scripts" / "_triage_core.py")
_REPRICE  = _load("reprice_core",  REPO_ROOT / "automations" / "propose-repricing"  / "scripts" / "_repricing_core.py")
_CLV      = _load("clv_core",      REPO_ROOT / "automations" / "rank-customer-clv"  / "scripts" / "_clv_core.py")
_MEMO     = _load("memo_core",     REPO_ROOT / "automations" / "decide-memo"        / "scripts" / "_memo_core.py")


def _seed(name: str) -> pl.DataFrame:
    return pl.read_csv(REPO_ROOT / "data" / "raw" / name)


def _parse_today(today: str | None) -> dt.date:
    return dt.date.fromisoformat(today) if today else dt.date.today()


# ---------------------------------------------------------------------------
mcp = FastMCP("pramukh-gems")


# ─── Tool 1 ──────────────────────────────────────────────────────────────
@mcp.tool()
def get_triage_tags(today: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """Tag every available stone HOLD / WATCH / DISCOUNT / CLEAR.

    Workflow Step 1. Wraps ``triage_inventory()``. Use this BEFORE pricing
    or memo decisions — the tag drives both.

    Args:
        today: ISO date (YYYY-MM-DD). Empty = today.
        limit: Max rows (most-urgent first). Default 50.

    Returns: List of dicts with stock_id, category_simple, age_in_stock_days,
    action_tag, suggested_price_move_pct, reason.
    """
    df = _TRIAGE.triage_inventory(
        _seed("inventory_seed.csv"),
        _seed("sales_transactions_seed.csv"),
        _seed("demand_signals_seed.csv"),
        _seed("communication_logs_seed.csv"),
        today=_parse_today(today),
    )
    if df.is_empty():
        return []
    cols = [c for c in
            ["stock_id", "category_simple", "age_in_stock_days",
             "action_tag", "suggested_price_move_pct", "reason"]
            if c in df.columns]
    return df.select(cols).head(limit).to_dicts()


# ─── Tool 2 ──────────────────────────────────────────────────────────────
@mcp.tool()
def propose_repricing(today: str = "", threshold_pct: float = 7.0,
                      limit: int = 50) -> dict[str, Any]:
    """Propose new prices and split into auto-apply vs needs-review.

    Workflow Step 2 + decision-point A. Wraps ``compute_repricing()`` from
    the M02 repricing skill, then applies the same threshold rule the
    automation uses (``|pct_change| ≤ threshold_pct`` AND a safe flag).

    Args:
        today: ISO date. Empty = today.
        threshold_pct: Auto-apply cap on |% change|. Default 7.0.
        limit: Max rows per returned list.

    Returns: dict with ``auto_apply``, ``needs_review`` (lists of dicts),
    ``threshold_pct``, and a ``summary`` with counts.
    """
    triage_lookup = {
        r["stock_id"]: r["action_tag"]
        for r in _TRIAGE.triage_inventory(
            _seed("inventory_seed.csv"),
            _seed("sales_transactions_seed.csv"),
            _seed("demand_signals_seed.csv"),
            _seed("communication_logs_seed.csv"),
            today=_parse_today(today),
        ).to_dicts()
    }
    df = _REPRICE.compute_repricing(
        _seed("inventory_seed.csv"),
        _seed("rap_weekly_seed.csv"),
        _seed("sales_transactions_seed.csv"),
        _seed("demand_signals_seed.csv"),
        _seed("memos_seed.csv"),
        _seed("quotes_seed.csv"),
        triage_tags=triage_lookup,
        today=_parse_today(today),
    )

    unsafe = {"frozen", "margin", "quote"}
    flag_lower = pl.col("flag").cast(pl.Utf8).str.to_lowercase()
    abs_change = pl.col("pct_change").abs()
    auto_mask = (~flag_lower.is_in(list(unsafe))) & (abs_change > 0) & (abs_change <= threshold_pct)
    review_mask = flag_lower.is_in(list(unsafe)) | (abs_change > threshold_pct)
    auto = df.filter(auto_mask)
    review = df.filter(review_mask)

    cols = ["stock_id", "category_simple", "old_price", "proposed_price",
            "pct_change", "flag", "primary_driver"]

    def _proj(d):
        if d.is_empty():
            return []
        present = [c for c in cols if c in d.columns]
        return d.select(present).head(limit).to_dicts()

    return {
        "threshold_pct": threshold_pct,
        "auto_apply":    _proj(auto),
        "needs_review":  _proj(review),
        "summary": {"auto_count": len(auto), "review_count": len(review)},
    }


# ─── Tool 3 ──────────────────────────────────────────────────────────────
@mcp.tool()
def review_memo(memo_id: str, today: str = "") -> dict[str, Any]:
    """Score one memo request and return the recommendation + reasons.

    Workflow Step 4. Wraps ``decide_memo()`` from the decide-memo skill.
    Pure scoring — does NOT write to the DB. The caller (or a human) decides
    whether to act.

    Args:
        memo_id: Memo ID (e.g. 'MEMO00042'). Must exist with decision='Pending'.
        today: ISO date. Empty = today.

    Returns: dict with memo_id, stock_id, customer_id, decision, reason,
    reliability_score, opportunity_score, condition_min_price,
    condition_max_hold_days, marketplace_lock_fired.

    Raises: ValueError if memo_id is not in memos_seed.csv.
    """
    memos = _seed("memos_seed.csv")
    row_df = memos.filter(pl.col("memo_id") == memo_id)
    if row_df.is_empty():
        raise ValueError(f"memo_id {memo_id!r} not found")
    memo_row = row_df.to_dicts()[0]

    decision = _MEMO.decide_memo(
        memo_row,
        _seed("inventory_seed.csv"),
        memos,
        _seed("payment_history_seed.csv"),
        _seed("demand_signals_seed.csv"),
        _seed("customers_seed.csv"),
        {},                          # triage lookup not needed for a one-off scoring call
        _parse_today(today),
    )
    return decision._asdict()


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
