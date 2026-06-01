"""Admin Dashboard — KPIs + plotnine analytics charts."""

from __future__ import annotations

import datetime as dt
import io
import sys
from pathlib import Path

import polars as pl
import streamlit as st
from plotnine import (
    ggplot, aes, geom_bar, geom_col, geom_line, geom_point,
    geom_histogram, geom_tile, scale_fill_manual, scale_fill_gradient,
    scale_color_manual, coord_flip, labs, theme_minimal, theme,
    element_text, element_blank, facet_wrap, stat_count,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import kpis, read_table
from app.components.auth import require_admin


def _fig_to_img(fig):
    buf = io.BytesIO()
    fig.save(buf, format="png", dpi=150)
    buf.seek(0)
    return buf


def render():
    st.title("📊 Company Dashboard")
    if not require_admin():
        return

    # ── KPI strip ─────────────────────────────────────────────────────────
    k = kpis()
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("💎 Available Stones", f"{k['available_stones']:,}")
    c2.metric("📋 On Memo",          f"{k['on_memo']:,}")
    c3.metric("⏳ Pending Memos",    f"{k['pending_memos']:,}")
    c4.metric("🤝 Open Negotiations",f"{k['open_quotes']:,}")
    c5.metric("⚠️ Overdue Invoices", f"{k['overdue_invoices']:,}")
    c6.metric("💰 Outstanding",      f"${k['total_outstanding']:,.0f}")

    st.markdown("---")

    # ── Load data ─────────────────────────────────────────────────────────
    inv      = read_table("inventory")
    invoices = read_table("invoices")
    sales    = read_table("sales_transactions")
    demand   = read_table("demand_signals")

    tab1, tab2, tab3, tab4 = st.tabs([
        "📦 Inventory", "💳 Collections", "📈 Sales Trend", "🔥 Demand"
    ])

    # ── Tab 1: Inventory age distribution ─────────────────────────────────
    with tab1:
        st.subheader("Inventory Age Distribution")
        if not inv.is_empty():
            col_a, col_b = st.columns(2)
            with col_a:
                # Age histogram
                age_df = inv.select(["age_in_stock_days","status"]).to_pandas()
                import pandas as _pd  # plotnine needs pandas internally
                fig = (
                    ggplot(age_df, aes(x="age_in_stock_days", fill="status"))
                    + geom_histogram(bins=30, alpha=0.8, position="stack")
                    + labs(title="Stones by Age in Stock",
                           x="Days in Stock", y="Count", fill="Status")
                    + theme_minimal()
                    + theme(figure_size=(6, 4))
                )
                st.image(_fig_to_img(fig), use_container_width=True)

            with col_b:
                # Status breakdown bar
                status_df = (
                    inv.group_by("status")
                    .agg(pl.len().alias("count"))
                    .sort("count", descending=True)
                    .to_pandas()
                )
                fig2 = (
                    ggplot(status_df, aes(x="status", y="count", fill="status"))
                    + geom_col(alpha=0.85)
                    + coord_flip()
                    + labs(title="Stones by Status", x="", y="Count")
                    + theme_minimal()
                    + theme(legend_position="none", figure_size=(6, 4))
                )
                st.image(_fig_to_img(fig2), use_container_width=True)

            # Shape + avg price table
            st.subheader("Average Price by Shape")
            shape_df = (
                inv.filter(pl.col("status") == "Available")
                .group_by("shape")
                .agg([
                    pl.len().alias("count"),
                    pl.col("p_pcs").mean().round(0).alias("avg_price"),
                    pl.col("age_in_stock_days").mean().round(0).alias("avg_age_days"),
                ])
                .sort("count", descending=True)
            )
            st.dataframe(shape_df, use_container_width=True)

    # ── Tab 2: Collection aging ────────────────────────────────────────────
    with tab2:
        st.subheader("Outstanding Invoices by Age Bucket")
        if not invoices.is_empty():
            today = dt.date.today()
            aged = (
                invoices
                .filter(pl.col("payment_status").is_in(["Open", "Partial"]))
                .with_columns(
                    pl.col("due_date").str.slice(0, 10).str.to_date().alias("_due")
                )
                .with_columns(
                    ((pl.lit(today) - pl.col("_due")).dt.total_days()).alias("days_overdue")
                )
                .with_columns(
                    pl.when(pl.col("days_overdue") < 0).then(pl.lit("Upcoming"))
                    .when(pl.col("days_overdue") <= 7).then(pl.lit("Just Due"))
                    .when(pl.col("days_overdue") <= 30).then(pl.lit("Aging"))
                    .when(pl.col("days_overdue") <= 60).then(pl.lit("Overdue"))
                    .otherwise(pl.lit("Critical"))
                    .alias("bucket")
                )
            )
            bucket_df = (
                aged.group_by("bucket")
                .agg([
                    pl.len().alias("invoices"),
                    (pl.col("amount") - pl.col("amount_paid")).sum().alias("outstanding"),
                ])
                .sort("outstanding", descending=True)
            )

            col_a, col_b = st.columns(2)
            with col_a:
                colors = {
                    "Critical": "#d62728", "Overdue": "#ff7f0e",
                    "Aging": "#f7c948", "Just Due": "#2ca02c", "Upcoming": "#1f77b4"
                }
                bpd = bucket_df.to_pandas()
                fig = (
                    ggplot(bpd, aes(x="bucket", y="outstanding", fill="bucket"))
                    + geom_col(alpha=0.85)
                    + scale_fill_manual(values=colors)
                    + coord_flip()
                    + labs(title="Outstanding $ by Bucket",
                           x="", y="Amount ($)")
                    + theme_minimal()
                    + theme(legend_position="none", figure_size=(6, 4))
                )
                st.image(_fig_to_img(fig), use_container_width=True)

            with col_b:
                st.dataframe(
                    bucket_df.with_columns(
                        pl.col("outstanding").round(0)
                    ),
                    use_container_width=True
                )

    # ── Tab 3: Sales trend ────────────────────────────────────────────────
    with tab3:
        st.subheader("Monthly Sales Revenue")
        if not sales.is_empty():
            monthly = (
                sales
                .with_columns(
                    pl.col("transaction_date").str.slice(0, 7).alias("month")
                )
                .group_by("month")
                .agg([
                    pl.col("sold_price").sum().alias("revenue"),
                    pl.col("gross_profit").sum().alias("profit"),
                    pl.len().alias("transactions"),
                ])
                .sort("month")
            )
            mpd = monthly.to_pandas()
            fig = (
                ggplot(mpd, aes(x="month", y="revenue", group=1))
                + geom_line(color="#1f77b4", size=1.2)
                + geom_point(color="#1f77b4", size=3)
                + labs(title="Monthly Revenue", x="Month", y="Revenue ($)")
                + theme_minimal()
                + theme(axis_text_x=element_text(rotation=45, hjust=1),
                        figure_size=(8, 4))
            )
            st.image(_fig_to_img(fig), use_container_width=True)

            # Gross profit overlay
            fig2 = (
                ggplot(mpd, aes(x="month", y="profit", group=1))
                + geom_line(color="#2ca02c", size=1.2)
                + geom_point(color="#2ca02c", size=3)
                + labs(title="Monthly Gross Profit", x="Month", y="Profit ($)")
                + theme_minimal()
                + theme(axis_text_x=element_text(rotation=45, hjust=1),
                        figure_size=(8, 4))
            )
            st.image(_fig_to_img(fig2), use_container_width=True)

    # ── Tab 4: Demand heatmap ─────────────────────────────────────────────
    with tab4:
        st.subheader("Demand Heatmap (Last 90 Days)")
        if not demand.is_empty():
            cutoff = (dt.date.today() - dt.timedelta(days=90)).isoformat()
            recent = demand.filter(pl.col("signal_date") >= cutoff)

            # Split "Shape | Carat band | Color | Clarity" into parts
            recent = recent.with_columns([
                pl.col("category_simple").str.split(" | ").list.get(0).alias("shape"),
                pl.col("category_simple").str.split(" | ").list.get(1).alias("carat_band"),
                pl.col("category_simple").str.split(" | ").list.get(2).alias("color_band"),
                pl.col("category_simple").str.split(" | ").list.get(3).alias("clarity_band"),
            ])

            # ── Heatmap 1: Shape × Carat band ──────────────────────────────
            st.markdown("**Shape × Carat Band** — average demand score")
            grid1 = (
                recent.group_by(["shape", "carat_band"])
                .agg(pl.col("demand_score").mean().round(2).alias("avg_demand"))
                .sort(["shape", "carat_band"])
            )
            g1 = grid1.to_pandas()
            fig1 = (
                ggplot(g1, aes(x="carat_band", y="shape", fill="avg_demand"))
                + geom_tile(color="white", size=0.5)
                + scale_fill_gradient(low="#fff5f0", high="#a50f15")
                + labs(title="Demand by Shape × Carat", x="Carat Band", y="", fill="Demand")
                + theme_minimal()
                + theme(axis_text_x=element_text(rotation=0, size=10),
                        axis_text_y=element_text(size=10),
                        figure_size=(9, 4))
            )
            st.image(_fig_to_img(fig1), use_container_width=True)

            # ── Heatmap 2: Color × Clarity ─────────────────────────────────
            st.markdown("**Color × Clarity** — average demand score")
            grid2 = (
                recent.group_by(["color_band", "clarity_band"])
                .agg(pl.col("demand_score").mean().round(2).alias("avg_demand"))
                .sort(["color_band", "clarity_band"])
            )
            g2 = grid2.to_pandas()
            fig2 = (
                ggplot(g2, aes(x="clarity_band", y="color_band", fill="avg_demand"))
                + geom_tile(color="white", size=0.5)
                + scale_fill_gradient(low="#f7fbff", high="#08519c")
                + labs(title="Demand by Color × Clarity",
                       x="Clarity", y="Color", fill="Demand")
                + theme_minimal()
                + theme(axis_text_x=element_text(size=10),
                        axis_text_y=element_text(size=10),
                        figure_size=(7, 4))
            )
            st.image(_fig_to_img(fig2), use_container_width=True)

            # ── Top 20 hottest categories ──────────────────────────────────
            st.markdown("**Top 20 Hottest Categories** (last 90 days)")
            top20 = (
                recent.group_by("category_simple")
                .agg(pl.col("demand_score").mean().round(2).alias("avg_demand"))
                .sort("avg_demand", descending=True)
                .head(20)
            )
            t20 = top20.to_pandas()
            fig3 = (
                ggplot(t20, aes(x="reorder(category_simple, avg_demand)",
                                y="avg_demand", fill="avg_demand"))
                + geom_col(alpha=0.9)
                + coord_flip()
                + scale_fill_gradient(low="#fee5d9", high="#a50f15")
                + labs(title="Top 20 Categories by Demand",
                       x="", y="Avg Demand Score", fill="Demand")
                + theme_minimal()
                + theme(axis_text_y=element_text(size=9),
                        legend_position="none",
                        figure_size=(9, 6))
            )
            st.image(_fig_to_img(fig3), use_container_width=True)
