"""Admin — Marketplace Publisher: mock Rapnet/VDB push log."""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table, log_marketplace_push
from app.components.auth import require_admin


def render():
    st.title("🌐 Marketplace Publisher")
    st.caption("Simulate pushing inventory to Rapnet, VDB, and IDEX. "
               "Stones on active memo are excluded.")
    if not require_admin():
        return

    inv = read_table("inventory")
    log = read_table("marketplace_log")

    if inv.is_empty():
        st.warning("No inventory data.")
        return

    available  = inv.filter(pl.col("status") == "Available")
    on_memo    = inv.filter(pl.col("status") == "OnMemo")
    hold_stones= inv.filter(pl.col("status") == "Hold")

    col1, col2, col3 = st.columns(3)
    col1.metric("✅ Will Publish",  f"{len(available):,}")
    col2.metric("🔒 Excluded (Memo)", f"{len(on_memo):,}")
    col3.metric("⏸️ On Hold",       f"{len(hold_stones):,}")

    st.markdown("---")

    # Platform selector
    platforms = st.multiselect(
        "Select platforms",
        ["Rapnet", "VDB", "IDEX", "Nivoda"],
        default=["Rapnet", "VDB"],
    )
    notes = st.text_input("Notes (optional)", placeholder="Weekly sync — May 2026")

    col_a, col_b = st.columns([2, 4])
    with col_a:
        if st.button("🚀 Publish to Marketplace", type="primary",
                     disabled=not platforms):
            for platform in platforms:
                log_marketplace_push(
                    pushed_by="admin",
                    stones_pushed=len(available),
                    stones_excluded=len(on_memo) + len(hold_stones),
                    platform=platform,
                    notes=notes,
                )
            st.success(
                f"✅ Published {len(available):,} stones to "
                f"{', '.join(platforms)}. "
                f"{len(on_memo):,} stones excluded (OnMemo)."
            )
            st.rerun()

    # Preview of what would be published
    st.subheader("📋 Preview — Stones to Publish")
    preview_cols = ["stock_id","shape","carat","color","clarity",
                    "p_pcs","status","location","lab"]
    st.dataframe(
        available.select([c for c in preview_cols if c in available.columns]).head(50),
        use_container_width=True, height=350,
    )

    if not on_memo.is_empty():
        with st.expander(f"🔒 {len(on_memo)} Excluded Stones (OnMemo)"):
            st.dataframe(
                on_memo.select([c for c in preview_cols if c in on_memo.columns]),
                use_container_width=True,
            )

    # Push log
    st.markdown("---")
    st.subheader("📜 Push History")
    if log.is_empty():
        st.info("No pushes yet.")
    else:
        st.dataframe(
            log.sort("pushed_at", descending=True),
            use_container_width=True,
        )
