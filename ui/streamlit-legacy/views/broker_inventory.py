"""Broker — Browse available inventory and request memo holds."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table, create_memo
from app.components.auth import current_user


def render():
    st.title("💎 Browse Stock")
    user = current_user()

    inv = read_table("inventory")
    if inv.is_empty():
        st.warning("No inventory data.")
        return

    # Only show Available stones to brokers
    available = inv.filter(pl.col("status") == "Available")

    # ── Filters ───────────────────────────────────────────────────────────
    with st.expander("🔍 Filter Stones", expanded=True):
        r1c1, r1c2, r1c3, r1c4 = st.columns(4)
        shapes   = sorted(available["shape"].unique().to_list())
        colors   = sorted(available["color"].drop_nulls().unique().to_list())
        claritys = sorted(available["clarity"].drop_nulls().unique().to_list())
        cuts     = sorted(available["cut"].drop_nulls().unique().to_list())

        sel_shapes  = r1c1.multiselect("Shape",   shapes)
        sel_colors  = r1c2.multiselect("Color",   colors)
        sel_clar    = r1c3.multiselect("Clarity", claritys)
        sel_cut     = r1c4.multiselect("Cut",     cuts)

        r2c1, r2c2, r2c3 = st.columns(3)
        min_c = float(available["carat"].min())
        max_c = float(available["carat"].max())
        carat_range = r2c1.slider("Carat", min_c, max_c, (min_c, max_c), step=0.05)

        min_p = 0.0
        max_p = float(available["p_pcs"].max())
        price_range = r2c2.slider("Price ($)", min_p, max_p,
                                  (min_p, max_p), step=50.0)

        labs_list = sorted(available["lab"].drop_nulls().unique().to_list())
        sel_lab = r2c3.multiselect("Lab", labs_list)

    filtered = available
    if sel_shapes:  filtered = filtered.filter(pl.col("shape").is_in(sel_shapes))
    if sel_colors:  filtered = filtered.filter(pl.col("color").is_in(sel_colors))
    if sel_clar:    filtered = filtered.filter(pl.col("clarity").is_in(sel_clar))
    if sel_cut:     filtered = filtered.filter(pl.col("cut").is_in(sel_cut))
    if sel_lab:     filtered = filtered.filter(pl.col("lab").is_in(sel_lab))
    filtered = filtered.filter(
        (pl.col("carat") >= carat_range[0]) & (pl.col("carat") <= carat_range[1]) &
        (pl.col("p_pcs") >= price_range[0]) & (pl.col("p_pcs") <= price_range[1])
    )

    st.caption(f"**{len(filtered):,}** stones available  (of {len(available):,} total)")

    display_cols = ["stock_id","shape","carat","color","clarity","cut",
                    "polish","sym","p_pcs","fl","lab","location"]
    st.dataframe(
        filtered.select([c for c in display_cols if c in filtered.columns])
                .sort("p_pcs"),
        use_container_width=True, height=400,
    )

    # ── Memo request ──────────────────────────────────────────────────────
    st.markdown("---")
    st.subheader("📋 Request a Memo Hold")

    if filtered.is_empty():
        st.info("Adjust filters to find a stone.")
        return

    stock_ids = filtered["stock_id"].to_list()
    sel_stock = st.selectbox("Select stone for memo", stock_ids)
    stone     = filtered.filter(pl.col("stock_id") == sel_stock).to_dicts()[0]

    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown(f"**{sel_stock}** — {stone['shape']} {stone['carat']}ct "
                    f"{stone['color']} {stone['clarity']}")
        st.markdown(f"Price: **${float(stone['p_pcs']):,.2f}** | Lab: {stone.get('lab','—')}")
        if stone.get("video"):
            st.markdown(f"[▶ View Video]({stone['video']})")
        if stone.get("image"):
            st.markdown(f"[🖼 View Image]({stone['image']})")

    with col_b:
        hold_days = st.slider("Hold duration (days)", 3, 14, 7)
        expiry = (dt.date.today() + dt.timedelta(days=hold_days)).isoformat()
        st.caption(f"Expiry: {expiry}")

        customer_id = user.get("customer_id") or ""
        if not customer_id:
            customer_id = st.text_input("Your Customer ID")

        if st.button("📋 Submit Memo Request", type="primary"):
            if not customer_id:
                st.error("Customer ID required.")
            else:
                import uuid
                memo_id = f"MEMO-{uuid.uuid4().hex[:8].upper()}"
                create_memo(
                    memo_id=memo_id,
                    customer_id=customer_id,
                    broker_id=customer_id,
                    stock_id=sel_stock,
                    hold_days=hold_days,
                    expiry_date=expiry,
                )
                st.success(
                    f"✅ Memo request **{memo_id}** submitted for {sel_stock}. "
                    f"You'll see the decision in 'My Memos'."
                )
