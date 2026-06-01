"""Admin — Customer/Broker Dashboard with CLV, discount recommendation, charts."""

from __future__ import annotations

import io
import sys
from pathlib import Path

import polars as pl
import streamlit as st
from plotnine import (
    ggplot, aes, geom_col, geom_line, geom_point, geom_bar,
    coord_flip, labs, theme_minimal, theme, element_text,
    scale_fill_manual, scale_fill_gradient, annotate,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table
from app.components.auth import require_admin


def _fig_to_img(fig):
    buf = io.BytesIO()
    fig.save(buf, format="png", dpi=150)
    buf.seek(0)
    return buf


# ---------------------------------------------------------------------------
# Discount recommendation engine
# ---------------------------------------------------------------------------

_TIER_BASE_DISCOUNT: dict[str, float] = {
    "Diamond": 8.0,
    "Gold":    5.0,
    "Silver":  3.0,
    "New":     1.0,
}


def recommend_discount(customer: dict, sales_df: pl.DataFrame) -> dict:
    """Return a discount recommendation for an in-person visit."""
    tier          = customer.get("clv_tier") or "New"
    churn_risk    = float(customer.get("churn_risk_pct") or 0.5)
    pay_score     = float(customer.get("payment_score") or 70)
    annual_spend  = float(customer.get("annual_spend") or 0)
    clv           = float(customer.get("risk_adjusted_clv") or 0)

    base = _TIER_BASE_DISCOUNT.get(tier, 1.0)
    notes = [f"Base discount for {tier} tier: {base:.1f}%"]

    # Churn risk modifier
    if churn_risk > 0.4:
        churn_adj = 2.0
        notes.append(f"High churn risk ({churn_risk:.0%}) → +2% to retain")
    elif churn_risk < 0.15:
        churn_adj = -1.0
        notes.append(f"Low churn risk ({churn_risk:.0%}) → −1% (loyal customer)")
    else:
        churn_adj = 0.0

    # Payment score modifier
    if pay_score >= 90:
        pay_adj = 1.0
        notes.append(f"Excellent payment score ({pay_score:.0f}) → +1%")
    elif pay_score < 60:
        pay_adj = -1.5
        notes.append(f"Poor payment score ({pay_score:.0f}) → −1.5% caution")
    else:
        pay_adj = 0.0

    # High spender bonus
    if annual_spend > 500_000:
        spend_adj = 1.5
        notes.append(f"High annual spend (${annual_spend:,.0f}) → +1.5%")
    elif annual_spend > 100_000:
        spend_adj = 0.5
        notes.append(f"Good annual spend (${annual_spend:,.0f}) → +0.5%")
    else:
        spend_adj = 0.0

    total = max(0.0, min(15.0, base + churn_adj + pay_adj + spend_adj))
    notes.append(f"**Total recommended discount: {total:.1f}%**")

    # Volume thresholds
    if annual_spend > 200_000:
        vol_msg = "Eligible for volume incentive: extra 1% on orders > $50K"
    elif annual_spend > 50_000:
        vol_msg = "Offer free shipping on orders > $10K"
    else:
        vol_msg = "Standard terms apply"
    notes.append(f"Volume note: {vol_msg}")

    return {
        "base_discount_pct": base,
        "recommended_discount_pct": total,
        "churn_adjustment": churn_adj,
        "payment_adjustment": pay_adj,
        "spend_adjustment": spend_adj,
        "volume_note": vol_msg,
        "notes": notes,
        "clv": clv,
        "tier": tier,
    }


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

def render():
    st.title("👤 Customer / Broker Dashboard")
    if not require_admin():
        return

    customers = read_table("customers")
    if customers.is_empty():
        st.warning("No customer data loaded.")
        return

    sales = read_table("sales_transactions")
    invoices = read_table("invoices")
    memos = read_table("memos")
    quotes = read_table("quotes")

    # ── Customer selector ─────────────────────────────────────────────────
    cust_list = customers.sort("customer_name").to_dicts()
    options = [f"{c['customer_name']}  ({c['customer_id']})" for c in cust_list]
    selected = st.selectbox("Select Customer / Broker", options)
    idx = options.index(selected)
    cust = cust_list[idx]
    cid = cust["customer_id"]

    st.markdown("---")

    # ── Top metrics ───────────────────────────────────────────────────────
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("CLV Tier", cust.get("clv_tier") or "—")
    m2.metric("Risk-Adj CLV", f"${float(cust.get('risk_adjusted_clv') or 0):,.0f}")
    m3.metric("Annual Spend", f"${float(cust.get('annual_spend') or 0):,.0f}")
    m4.metric("Churn Risk", f"{float(cust.get('churn_risk_pct') or 0):.0%}")
    m5.metric("Payment Score", f"{float(cust.get('payment_score') or 0):.0f}/100")

    # ── Two columns: discount rec + CLV breakdown ──────────────────────────
    col_left, col_right = st.columns([1, 1])

    with col_left:
        st.subheader("🎯 In-Person Visit Discount Recommendation")
        rec = recommend_discount(cust, sales)

        st.markdown(f"""
| Signal | Value |
|---|---|
| **CLV Tier** | {rec['tier']} |
| **Base discount** | {rec['base_discount_pct']:.1f}% |
| **Churn adjustment** | {rec['churn_adjustment']:+.1f}% |
| **Payment adjustment** | {rec['payment_adjustment']:+.1f}% |
| **Spend adjustment** | {rec['spend_adjustment']:+.1f}% |
| **✅ Recommended discount** | **{rec['recommended_discount_pct']:.1f}%** |
""")
        st.info(rec["volume_note"])

        # Notes expander
        with st.expander("📝 Reasoning"):
            for note in rec["notes"]:
                st.markdown(f"- {note}")

    with col_right:
        st.subheader("📊 CLV Benchmark")
        # Show where this customer sits vs all customers in same tier
        tier = cust.get("clv_tier") or "New"
        tier_peers = customers.filter(pl.col("clv_tier") == tier)
        if not tier_peers.is_empty():
            peer_clvs = tier_peers.select("risk_adjusted_clv").to_pandas()
            cust_clv = float(cust.get("risk_adjusted_clv") or 0)

            fig = (
                ggplot(peer_clvs, aes(x="risk_adjusted_clv"))
                + geom_bar(fill="#1f77b4", alpha=0.6, stat="bin", bins=15)
                + annotate("vline", xintercept=cust_clv,
                           color="#d62728", linetype="dashed", size=1)
                + labs(title=f"CLV Distribution — {tier} Tier",
                       x="Risk-Adjusted CLV ($)", y="# Customers")
                + theme_minimal()
                + theme(figure_size=(5, 3))
            )
            st.image(_fig_to_img(fig), use_container_width=True)
            pct = (tier_peers.filter(
                pl.col("risk_adjusted_clv") <= cust_clv
            ).height / tier_peers.height * 100)
            st.caption(f"This customer is in the **{pct:.0f}th percentile** of {tier} tier peers.")

    st.markdown("---")

    # ── Purchase history chart ─────────────────────────────────────────────
    st.subheader("📈 Purchase History")
    if not sales.is_empty():
        cust_sales = (
            sales.filter(
                (pl.col("customer_id") == cid) | (pl.col("broker_id") == cid)
            )
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

        if not cust_sales.is_empty():
            col_a, col_b = st.columns(2)
            with col_a:
                spd = cust_sales.to_pandas()
                fig = (
                    ggplot(spd, aes(x="month", y="revenue", group=1))
                    + geom_line(color="#1f77b4", size=1.2)
                    + geom_point(color="#1f77b4", size=3)
                    + labs(title="Monthly Revenue", x="", y="$")
                    + theme_minimal()
                    + theme(axis_text_x=element_text(rotation=45, hjust=1),
                            figure_size=(5, 3))
                )
                st.image(_fig_to_img(fig), use_container_width=True)

            with col_b:
                fig2 = (
                    ggplot(spd, aes(x="month", y="transactions", group=1))
                    + geom_line(color="#2ca02c", size=1.2)
                    + geom_point(color="#2ca02c", size=3)
                    + labs(title="Transaction Count", x="", y="Transactions")
                    + theme_minimal()
                    + theme(axis_text_x=element_text(rotation=45, hjust=1),
                            figure_size=(5, 3))
                )
                st.image(_fig_to_img(fig2), use_container_width=True)
        else:
            st.info("No sales history for this customer.")
    else:
        st.info("No sales data loaded.")

    # ── Memo + quote activity ──────────────────────────────────────────────
    col_m, col_q = st.columns(2)
    with col_m:
        st.subheader("📋 Memo History")
        if not memos.is_empty():
            cust_memos = memos.filter(
                (pl.col("customer_id") == cid) | (pl.col("broker_id") == cid)
            ).select(["memo_id", "stock_id", "decision",
                      "request_date", "closed_outcome"])
            if not cust_memos.is_empty():
                st.dataframe(cust_memos, use_container_width=True)
            else:
                st.info("No memo history.")
        else:
            st.info("No memo data.")

    with col_q:
        st.subheader("🤝 Quote History")
        if not quotes.is_empty():
            cust_quotes = quotes.filter(
                pl.col("customer_id") == cid
            ).select(["quote_id", "stock_id", "offered_price",
                      "customer_offer", "quote_outcome", "final_agreed_price"])
            if not cust_quotes.is_empty():
                st.dataframe(cust_quotes, use_container_width=True)
            else:
                st.info("No quote history.")
        else:
            st.info("No quote data.")

    # ── Top N CLV leaderboard ──────────────────────────────────────────────
    st.markdown("---")
    st.subheader("🏆 CLV Leaderboard — Top 20 Customers")
    top = (
        customers.sort("risk_adjusted_clv", descending=True)
        .head(20)
        .select(["customer_name", "clv_tier", "risk_adjusted_clv",
                 "annual_spend", "churn_risk_pct", "payment_score"])
        .with_columns([
            pl.col("risk_adjusted_clv").round(0),
            pl.col("annual_spend").round(0),
            pl.col("churn_risk_pct").round(3),
        ])
    )
    tpd = top.to_pandas()
    fig = (
        ggplot(tpd, aes(x="customer_name", y="risk_adjusted_clv", fill="clv_tier"))
        + geom_col(alpha=0.85)
        + coord_flip()
        + scale_fill_manual(values={
            "Diamond": "#4e79a7", "Gold": "#f28e2b",
            "Silver": "#76b7b2", "New": "#b4b4b4",
        })
        + labs(title="Top 20 by Risk-Adjusted CLV",
               x="", y="CLV ($)", fill="Tier")
        + theme_minimal()
        + theme(axis_text_y=element_text(size=8), figure_size=(9, 6))
    )
    st.image(_fig_to_img(fig), use_container_width=True)
