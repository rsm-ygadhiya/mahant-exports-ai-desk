"""Admin — Inventory Manager: browse, filter, edit prices and status."""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table, update_inventory_price, update_inventory_status
from app.components.auth import require_admin


def render():
    st.title("📦 Inventory Manager")
    if not require_admin():
        return

    inv = read_table("inventory")
    if inv.is_empty():
        st.warning("No inventory data. Run the database seed first.")
        return

    # ── Filters ───────────────────────────────────────────────────────────
    with st.expander("🔍 Filters", expanded=True):
        f1, f2, f3, f4 = st.columns(4)
        shapes     = ["All"] + sorted(inv["shape"].unique().to_list())
        statuses   = ["All"] + sorted(inv["status"].unique().to_list())
        colors_lst = ["All"] + sorted(inv["color"].drop_nulls().unique().to_list())
        claritys   = ["All"] + sorted(inv["clarity"].drop_nulls().unique().to_list())

        sel_shape  = f1.selectbox("Shape",   shapes)
        sel_status = f2.selectbox("Status",  statuses)
        sel_color  = f3.selectbox("Color",   colors_lst)
        sel_clar   = f4.selectbox("Clarity", claritys)

        f5, f6 = st.columns(2)
        min_c, max_c = float(inv["carat"].min()), float(inv["carat"].max())
        carat_range = f5.slider("Carat range", min_c, max_c,
                                (min_c, max_c), step=0.1)
        max_price_v = float(inv["p_pcs"].max())
        max_price   = f6.slider("Max price ($)", 0.0, max_price_v,
                                max_price_v, step=100.0)

    filtered = inv
    if sel_shape  != "All": filtered = filtered.filter(pl.col("shape")   == sel_shape)
    if sel_status != "All": filtered = filtered.filter(pl.col("status")  == sel_status)
    if sel_color  != "All": filtered = filtered.filter(pl.col("color")   == sel_color)
    if sel_clar   != "All": filtered = filtered.filter(pl.col("clarity") == sel_clar)
    filtered = filtered.filter(
        (pl.col("carat") >= carat_range[0]) & (pl.col("carat") <= carat_range[1])
    )
    filtered = filtered.filter(pl.col("p_pcs") <= max_price)

    st.caption(f"Showing {len(filtered):,} of {len(inv):,} stones")

    display_cols = ["stock_id","shape","carat","color","clarity","cut",
                    "status","p_pcs","cost_basis","age_in_stock_days","location"]
    available_cols = [c for c in display_cols if c in filtered.columns]
    st.dataframe(filtered.select(available_cols), use_container_width=True, height=400)

    st.markdown("---")

    # ── Edit panel ────────────────────────────────────────────────────────
    st.subheader("✏️ Edit a Stone")
    stock_ids = filtered["stock_id"].to_list()
    if not stock_ids:
        st.info("No stones match current filters.")
        return

    selected_id = st.selectbox("Select Stock ID to edit", stock_ids)
    stone = inv.filter(pl.col("stock_id") == selected_id).to_dicts()[0]

    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown(f"**Stone:** {selected_id}")
        st.markdown(f"Shape: {stone['shape']} | {stone['carat']}ct | "
                    f"{stone['color']} {stone['clarity']}")
        st.markdown(f"Cost basis: **${float(stone['cost_basis'] or 0):,.2f}**")
        floor = float(stone['cost_basis'] or 0) * 1.05
        st.caption(f"Margin floor (5%): ${floor:,.2f}")

    with col_b:
        new_price = st.number_input(
            "New price (p_pcs)",
            min_value=0.0,
            value=float(stone["p_pcs"] or 0),
            step=10.0,
            format="%.2f",
        )
        if new_price < floor:
            st.warning(f"⚠️ Price ${new_price:,.2f} is below floor ${floor:,.2f}")

        new_status = st.selectbox(
            "Status",
            ["Available", "OnMemo", "Hold", "Sold", "Returned"],
            index=["Available","OnMemo","Hold","Sold","Returned"].index(
                stone["status"]) if stone["status"] in
                ["Available","OnMemo","Hold","Sold","Returned"] else 0
        )

        if st.button("💾 Save Changes", type="primary"):
            update_inventory_price(selected_id, new_price)
            update_inventory_status(selected_id, new_status)
            st.success(f"✅ {selected_id} updated — price ${new_price:,.2f}, status: {new_status}")
            st.rerun()

    # ── Bulk status update ─────────────────────────────────────────────────
    with st.expander("🔄 Bulk Status Update"):
        st.caption("Update status for all stones matching current filters.")
        bulk_status = st.selectbox("Set status to", ["Available", "Hold"])
        if st.button(f"Apply '{bulk_status}' to {len(filtered):,} filtered stones"):
            for sid in stock_ids:
                update_inventory_status(sid, bulk_status)
            st.success(f"Updated {len(stock_ids):,} stones to '{bulk_status}'.")
            st.rerun()
