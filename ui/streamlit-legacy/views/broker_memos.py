"""Broker — My Memo Requests: status, conditions, expiry countdown."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table
from app.components.auth import current_user

_DECISION_COLOR = {
    "Pending":                 "🟡 Pending",
    "Approved":                "🟢 Approved",
    "ApprovedWithConditions":  "🔵 Approved w/ Conditions",
    "Rejected":                "🔴 Rejected",
}


def render():
    st.title("📋 My Memo Requests")
    user = current_user()

    memos = read_table("memos")
    if memos.is_empty():
        st.info("No memo data found.")
        return

    cid = user.get("customer_id")
    if cid:
        my_memos = memos.filter(
            (pl.col("customer_id") == cid) | (pl.col("broker_id") == cid)
        )
    else:
        # Admin sees all
        my_memos = memos

    if my_memos.is_empty():
        st.info("No memo requests found for your account.")
        return

    today = dt.date.today()

    # ── Summary metrics ───────────────────────────────────────────────────
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total",    len(my_memos))
    m2.metric("🟡 Pending",  int((my_memos["decision"] == "Pending").sum()))
    m3.metric("🟢 Approved", int((my_memos["decision"].is_in(
        ["Approved","ApprovedWithConditions"])).sum()))
    m4.metric("🔴 Rejected", int((my_memos["decision"] == "Rejected").sum()))

    st.markdown("---")

    # ── Status filter ──────────────────────────────────────────────────────
    status_filter = st.multiselect(
        "Filter by status",
        ["Pending","Approved","ApprovedWithConditions","Rejected"],
        default=["Pending","Approved","ApprovedWithConditions"],
    )
    shown = my_memos
    if status_filter:
        shown = shown.filter(pl.col("decision").is_in(status_filter))

    # ── Memo cards ────────────────────────────────────────────────────────
    for row in shown.sort("request_date", descending=True).iter_rows(named=True):
        decision_label = _DECISION_COLOR.get(row["decision"], row["decision"])
        expiry_str = row.get("expiry_date") or ""
        expiry_short = expiry_str[:10] if expiry_str else "—"
        days_left = ""
        if expiry_short != "—":
            try:
                exp_date = dt.date.fromisoformat(expiry_short)
                delta = (exp_date - today).days
                days_left = f" ({delta}d left)" if delta >= 0 else " (expired)"
            except ValueError:
                days_left = ""

        with st.expander(
            f"{decision_label}  |  {row['memo_id']}  —  {row['stock_id']}"
            f"  |  Expiry: {expiry_short}{days_left}"
        ):
            col_a, col_b = st.columns(2)
            with col_a:
                st.markdown(f"**Memo ID:** {row['memo_id']}")
                st.markdown(f"**Stone:** {row['stock_id']}")
                st.markdown(f"**Customer:** {row['customer_id']}")
                st.markdown(f"**Hold requested:** {row.get('requested_hold_days',7)} days")
                st.markdown(f"**Request date:** {str(row.get('request_date',''))[:10]}")

            with col_b:
                st.markdown(f"**Decision:** {decision_label}")
                if row.get("decision_reason"):
                    st.markdown(f"**Reason:** {row['decision_reason']}")
                if row.get("decision_date"):
                    st.markdown(f"**Decided:** {str(row['decision_date'])[:10]}")
                if row.get("condition_minimum_price"):
                    st.warning(
                        f"⚠️ **Condition:** Minimum purchase price "
                        f"${float(row['condition_minimum_price']):,.2f}"
                    )
                if row.get("condition_max_hold_days"):
                    st.warning(
                        f"⏱️ **Condition:** Maximum hold {row['condition_max_hold_days']} days"
                    )
                if row.get("closed_outcome"):
                    st.markdown(f"**Outcome:** {row['closed_outcome']}")
