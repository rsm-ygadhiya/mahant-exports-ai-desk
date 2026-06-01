"""Broker — Quotes & Negotiations: view quotes, submit counter-offers."""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table, update_quote_counter
from app.components.auth import current_user

_STATUS_ICON = {
    "Negotiating": "🟡",
    "Accepted":    "🟢",
    "Lost":        "🔴",
    "Expired":     "⚫",
    "Pending":     "🔵",
}


def render():
    st.title("🤝 Quotes & Negotiations")
    user = current_user()

    quotes = read_table("quotes")
    inv    = read_table("inventory")

    if quotes.is_empty():
        st.info("No quote data found.")
        return

    cid = user.get("customer_id")
    if cid:
        my_quotes = quotes.filter(pl.col("customer_id") == cid)
    else:
        my_quotes = quotes  # admin sees all

    if my_quotes.is_empty():
        st.info("No quotes found for your account.")
        return

    # ── Summary ───────────────────────────────────────────────────────────
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total Quotes", len(my_quotes))
    m2.metric("🟡 Negotiating", int((my_quotes["quote_outcome"] == "Negotiating").sum()))
    m3.metric("🟢 Accepted",    int((my_quotes["quote_outcome"] == "Accepted").sum()))
    m4.metric("🔴 Lost",        int((my_quotes["quote_outcome"] == "Lost").sum()))

    st.markdown("---")

    status_filter = st.multiselect(
        "Filter by status",
        ["Negotiating","Accepted","Lost","Expired","Pending"],
        default=["Negotiating","Pending"],
    )
    shown = my_quotes
    if status_filter:
        shown = shown.filter(pl.col("quote_outcome").is_in(status_filter))

    # ── Quote cards ────────────────────────────────────────────────────────
    for row in shown.sort("quote_date", descending=True).iter_rows(named=True):
        icon   = _STATUS_ICON.get(row["quote_outcome"], "⚪")
        offered = float(row.get("offered_price") or 0)
        cust_off= row.get("customer_offer")
        agreed  = row.get("final_agreed_price")

        with st.expander(
            f"{icon} {row['quote_id']}  —  {row['stock_id']}  "
            f"|  Our price: ${offered:,.0f}  "
            f"|  {row['quote_outcome']}"
        ):
            col_a, col_b = st.columns(2)
            with col_a:
                st.markdown(f"**Quote ID:** {row['quote_id']}")
                st.markdown(f"**Stone:** {row['stock_id']}")
                st.markdown(f"**Category:** {row.get('category_simple','—')}")
                st.markdown(f"**Our offered price:** ${offered:,.2f}")
                st.markdown(f"**Your last offer:** "
                            f"{'$' + f'{float(cust_off):,.2f}' if cust_off else '—'}")
                if agreed:
                    st.success(f"**Final agreed price:** ${float(agreed):,.2f}")
                st.markdown(f"**Status:** {icon} {row['quote_outcome']}")
                st.markdown(f"**Date:** {str(row.get('quote_date',''))[:10]}")

            with col_b:
                # Stone details
                if not inv.is_empty():
                    stone = inv.filter(pl.col("stock_id") == row["stock_id"])
                    if not stone.is_empty():
                        s = stone.to_dicts()[0]
                        st.markdown(f"**Shape:** {s.get('shape','—')} "
                                    f"{s.get('carat','—')}ct")
                        st.markdown(f"**Color / Clarity:** {s.get('color','—')} "
                                    f"/ {s.get('clarity','—')}")
                        st.markdown(f"**Lab:** {s.get('lab','—')}")
                        if s.get("image"):
                            st.markdown(f"[🖼 View Image]({s['image']})")

                # Counter-offer input (only when Negotiating)
                if row["quote_outcome"] == "Negotiating":
                    st.markdown("---")
                    st.markdown("**Submit Counter-Offer**")
                    counter = st.number_input(
                        "Your offer ($)",
                        min_value=0.0,
                        value=float(cust_off) if cust_off else offered * 0.95,
                        step=50.0,
                        key=f"counter_{row['quote_id']}",
                    )
                    if counter >= offered:
                        st.info(f"✅ Offering ${counter:,.0f} meets our ask — will be accepted.")
                    elif counter < offered * 0.7:
                        st.warning("⚠️ Offer is significantly below asking price.")

                    if st.button("📤 Submit Counter-Offer",
                                 key=f"submit_{row['quote_id']}", type="primary"):
                        update_quote_counter(row["quote_id"], counter)
                        st.success(
                            f"Counter-offer of ${counter:,.0f} submitted for "
                            f"{row['quote_id']}. Awaiting company response."
                        )
                        st.rerun()
