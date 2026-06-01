"""Admin — AI Skills Panel: run all 6 skills with human-in-loop approval."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import (
    read_table, apply_repricing_batch, save_triage_tags,
    update_memo_decision, log_skill_run,
)
from app.components.auth import require_admin
from app.components.skill_runner import run_skill_card
from app import skill_loader


# ---------------------------------------------------------------------------
# Skill adapters — bridge DB tables → skill functions → (DataFrame, summary)
# ---------------------------------------------------------------------------

def _run_repricing() -> tuple[pl.DataFrame, str]:
    compute_repricing = skill_loader.repricing().compute_repricing
    inv    = read_table("inventory")
    rap    = pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "rap_weekly_seed.csv")
    sales  = read_table("sales_transactions")
    dem    = read_table("demand_signals")
    memos  = read_table("memos")
    quotes = read_table("quotes")
    tags   = read_table("triage_tags")
    tag_dict = {r["stock_id"]: r["action_tag"] for r in tags.to_dicts()} if not tags.is_empty() else {}
    df = compute_repricing(inv, rap, sales, dem, memos, quotes,
                           triage_tags=tag_dict, today=dt.date.today())
    changed = df.filter(pl.col("flag") != "frozen")
    up   = int((changed["proposed_price"] > changed["old_price"]).sum())
    down = int((changed["proposed_price"] < changed["old_price"]).sum())
    unch = len(changed) - up - down
    summary = f"{len(df)} stones: {up} up, {down} down, {unch} unchanged"
    return df, summary


def _approve_repricing(df: pl.DataFrame) -> None:
    rows = df.filter(pl.col("flag") != "frozen").select(
        ["stock_id", "proposed_price"]
    ).rename({"proposed_price": "proposed_price"}).to_dicts()
    apply_repricing_batch([{"stock_id": r["stock_id"],
                            "proposed_price": r["proposed_price"]} for r in rows])


def _run_triage() -> tuple[pl.DataFrame, str]:
    triage_inventory = skill_loader.triage().triage_inventory
    inv   = read_table("inventory")
    sales = read_table("sales_transactions")
    dem   = read_table("demand_signals")
    comms = pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "communication_logs_seed.csv")
    df    = triage_inventory(inv, sales, dem, comms, today=dt.date.today())
    counts = df.group_by("action_tag").agg(pl.len().alias("n")).to_dicts()
    summary = " | ".join(f"{r['action_tag']}: {r['n']}" for r in counts)
    return df, summary


def _approve_triage(df: pl.DataFrame) -> None:
    tags = df.select(["stock_id", "action_tag"]).to_dicts()
    save_triage_tags(tags, approved_by="admin")


def _run_memo_approval() -> tuple[pl.DataFrame, str]:
    review_pending = skill_loader.memo_approval().review_pending
    memos = read_table("memos")
    inv   = read_table("inventory")
    pays  = read_table("payment_history")
    dem   = read_table("demand_signals")
    custs = read_table("customers")
    tags  = read_table("triage_tags")
    tag_dict = {r["stock_id"]: r["action_tag"] for r in tags.to_dicts()} if not tags.is_empty() else {}
    decisions = review_pending(memos, inv, pays, dem, custs, tag_dict, dt.date.today())
    if not decisions:
        return pl.DataFrame(), "No pending memos."
    rows = [d._asdict() for d in decisions]
    df   = pl.DataFrame(rows)
    approve_count = int((df["decision"] == "APPROVE").sum())
    reject_count  = int((df["decision"] == "REJECT").sum())
    cond_count    = int((df["decision"] == "APPROVE_WITH_CONDITIONS").sum())
    summary = (f"{len(decisions)} memos — APPROVE: {approve_count} | "
               f"CONDITIONS: {cond_count} | REJECT: {reject_count}")
    return df, summary


def _approve_memo_decisions(df: pl.DataFrame) -> None:
    if df.is_empty():
        return
    for row in df.iter_rows(named=True):
        decision_map = {
            "APPROVE": "Approved",
            "APPROVE_WITH_CONDITIONS": "ApprovedWithConditions",
            "REJECT": "Rejected",
        }
        db_decision = decision_map.get(row["decision"], "Rejected")
        update_memo_decision(
            memo_id=row["memo_id"],
            decision=db_decision,
            reason=row["reason"],
            cond_price=row.get("condition_min_price"),
            cond_hold=row.get("condition_max_hold_days"),
        )


def _run_quote_negotiation() -> tuple[pl.DataFrame, str]:
    batch_negotiating = skill_loader.quote_negotiation().batch_negotiating
    quotes = read_table("quotes")
    inv    = read_table("inventory")
    custs  = read_table("customers")
    dem    = read_table("demand_signals")
    decisions = batch_negotiating(quotes, inv, custs, dem, dt.date.today())
    if not decisions:
        return pl.DataFrame(), "No negotiating quotes."
    rows = [d._asdict() for d in decisions]
    df   = pl.DataFrame(rows)
    summary = (f"{len(decisions)} quotes — "
               f"ACCEPT: {int((df['decision']=='ACCEPT').sum())} | "
               f"COUNTER: {int((df['decision']=='COUNTER').sum())} | "
               f"HOLD: {int((df['decision']=='HOLD').sum())} | "
               f"WALK_AWAY: {int((df['decision']=='WALK_AWAY').sum())}")
    return df, summary


def _approve_quote_decisions(df: pl.DataFrame) -> None:
    from app.db import update_quote_outcome  # noqa: PLC0415
    if df.is_empty():
        return
    for row in df.iter_rows(named=True):
        if row["decision"] == "ACCEPT":
            update_quote_outcome(row["quote_id"], "Accepted",
                                 final_price=row.get("response_price"))
        elif row["decision"] == "WALK_AWAY":
            update_quote_outcome(row["quote_id"], "Lost")


def _run_collection_reminder() -> tuple[pl.DataFrame, str]:
    daily_report = skill_loader.collection_reminder().daily_report
    sales = read_table("sales_transactions")
    pays  = read_table("payment_history")
    custs = read_table("customers")
    counts, df = daily_report(sales, pays, custs, dt.date.today())
    summary = (f"{counts.get('total_outstanding_amount', 0):,.0f} outstanding — "
               f"Critical: {counts.get('critical',0)} | "
               f"Overdue: {counts.get('overdue',0)} | "
               f"Aging: {counts.get('aging',0)}")
    return df, summary


def _run_clv() -> tuple[pl.DataFrame, str]:
    compute_all_clv = skill_loader.clv_broker().compute_all_clv
    sales = read_table("sales_transactions")
    custs = read_table("customers")
    # Skill expects is_broker as "true"/"false" string; DB stores 1/0 — coerce.
    custs = custs.with_columns(
        pl.when(pl.col("is_broker").cast(pl.Utf8).is_in(["1", "true", "True"]))
        .then(pl.lit("true"))
        .otherwise(pl.lit("false"))
        .alias("is_broker")
    )
    df    = compute_all_clv("broker", sales, custs)
    if df.is_empty():
        return df, "No CLV data."
    top_clv = float(df["clv"].max())
    summary = f"{len(df)} brokers ranked | Top CLV: ${top_clv:,.0f}"
    return df, summary


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

def render():
    st.title("🤖 AI Skills Panel")
    st.caption("Run AI skills and approve/reject their outputs. Changes only apply when you click Approve.")
    if not require_admin():
        return

    st.markdown("---")

    # Skill 6 — Repricing
    run_skill_card(
        skill_name="Weekly Repricing",
        icon="📈",
        description="Re-prices all Available stones using Rap market movement, demand, velocity, triage tags, and age.",
        run_fn=_run_repricing,
        approve_fn=_approve_repricing,
        result_cols=["stock_id","category_simple","old_price","proposed_price",
                     "pct_change","margin_class","flag","primary_driver"],
    )

    # Skill 5 — Triage
    run_skill_card(
        skill_name="Inventory Aging Triage",
        icon="🏷️",
        description="Tags every stone as CLEAR / DISCOUNT / WATCH / HOLD based on age and demand.",
        run_fn=_run_triage,
        approve_fn=_approve_triage,
        result_cols=["stock_id","category_simple","age_in_stock_days",
                     "action_tag","suggested_price_move_pct","reason"],
    )

    # Skill 1 — Memo Approval
    run_skill_card(
        skill_name="Memo Approval",
        icon="📋",
        description="Reviews all Pending memo requests and recommends APPROVE / CONDITIONS / REJECT.",
        run_fn=_run_memo_approval,
        approve_fn=_approve_memo_decisions,
        result_cols=["memo_id","stock_id","customer_id","decision",
                     "reliability_score","opportunity_score","reason"],
    )

    # Skill 2 — Quote Negotiation
    run_skill_card(
        skill_name="Quote Negotiation",
        icon="🤝",
        description="Evaluates all Negotiating quotes and recommends ACCEPT / COUNTER / HOLD / WALK_AWAY.",
        run_fn=_run_quote_negotiation,
        approve_fn=_approve_quote_decisions,
        result_cols=["quote_id","stock_id","customer_id","clv_tier","decision",
                     "offered_price","customer_offer","response_price"],
    )

    # Skill 4 — Collection Reminder (output only — no approve action)
    run_skill_card(
        skill_name="Collection Reminder",
        icon="💳",
        description="Buckets all open invoices by days-past-due and shows outstanding amounts.",
        run_fn=_run_collection_reminder,
        approve_fn=None,   # output only
        result_cols=["invoice_id","customer_id","amount_outstanding",
                     "due_date","days_past_due","bucket","payment_status"],
    )

    # Skill 3 — CLV (output only)
    run_skill_card(
        skill_name="CLV Analysis",
        icon="💰",
        description="Ranks all brokers by Customer Lifetime Value.",
        run_fn=_run_clv,
        approve_fn=None,
        result_cols=["entity_id","entity_name","clv","avg_monthly_profit",
                     "transactions","churn_rate"],
    )
