"""Headless daily runner for Autopilot.

Invoked by macOS launchd (or any other scheduler). Runs the full orchestrator,
writes auto-apply rows to the DB, and appends a row to ``skill_runs``.

Manual run:
    uv run python -m app.autopilot_daily
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import (  # noqa: E402
    init_db,
    read_table,
    apply_repricing_batch,
    save_triage_tags,
    update_memo_decision,
    log_skill_run,
)
from app.autopilot import run_autopilot  # noqa: E402


def _gather_data() -> dict[str, pl.DataFrame]:
    return {
        "inventory": read_table("inventory"),
        "rap": pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "rap_weekly_seed.csv"),
        "sales": read_table("sales_transactions"),
        "demand": read_table("demand_signals"),
        "memos": read_table("memos"),
        "quotes": read_table("quotes"),
        "payments": read_table("payment_history"),
        "customers": read_table("customers"),
        "comms": pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "communication_logs_seed.csv"),
    }


def apply_auto_actions(report) -> dict[str, int]:
    """Write the auto-applied rows to the DB. Pure I/O — return counts."""
    counts = {"triage": 0, "prices": 0, "memos": 0}

    if not report.triage.is_empty():
        rows = report.triage.select(["stock_id", "action_tag"]).to_dicts()
        counts["triage"] = save_triage_tags(rows, approved_by="autopilot_cron")

    if not report.repricing_auto.is_empty():
        rows = [
            {"stock_id": r["stock_id"], "proposed_price": r["proposed_price"]}
            for r in report.repricing_auto.to_dicts()
        ]
        counts["prices"] = apply_repricing_batch(rows)

    if not report.memo_auto.is_empty():
        for r in report.memo_auto.to_dicts():
            update_memo_decision(
                memo_id=r["memo_id"],
                decision="Approved",
                reason=f"[Autopilot/cron] {r.get('reason', '')}",
            )
            counts["memos"] += 1

    return counts


def run_daily() -> int:
    init_db()
    data = _gather_data()
    report = run_autopilot(
        data["inventory"], data["rap"], data["sales"], data["demand"],
        data["memos"], data["quotes"], data["payments"],
        data["customers"], data["comms"],
        today=dt.date.today(),
    )
    counts = apply_auto_actions(report)
    summary = f"{report.headline} | applied: {counts}"
    log_skill_run("Autopilot", "cron", "auto_applied", summary)
    print(f"[{dt.datetime.now().isoformat(timespec='seconds')}] {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_daily())
