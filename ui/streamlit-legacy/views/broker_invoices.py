"""Broker — My Invoices: view bills and payment status."""

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

_STATUS_COLOR = {
    "Paid":    "🟢",
    "Partial": "🟡",
    "Open":    "🔴",
}


def render():
    st.title("🧾 My Invoices")
    user = current_user()

    invoices  = read_table("invoices")
    customers = read_table("customers")

    if invoices.is_empty():
        st.info("No invoice data found.")
        return

    cid = user.get("customer_id")
    if cid:
        my_inv = invoices.filter(pl.col("customer_id") == cid)
    else:
        my_inv = invoices  # admin sees all

    if my_inv.is_empty():
        st.info("No invoices found for your account.")
        return

    today = dt.date.today()

    # ── Summary ───────────────────────────────────────────────────────────
    total_due = float(
        my_inv.filter(pl.col("payment_status") != "Paid")
              .with_columns((pl.col("amount") - pl.col("amount_paid")).alias("out"))
              ["out"].sum()
    )
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total Invoices", len(my_inv))
    m2.metric("🟢 Paid",    int((my_inv["payment_status"] == "Paid").sum()))
    m3.metric("🟡 Partial", int((my_inv["payment_status"] == "Partial").sum()))
    m4.metric("💰 Outstanding", f"${total_due:,.0f}")

    st.markdown("---")

    # Status filter
    sf = st.multiselect("Filter by status", ["Open","Partial","Paid"],
                        default=["Open","Partial"])
    shown = my_inv.filter(pl.col("payment_status").is_in(sf)) if sf else my_inv

    # ── Invoice cards ──────────────────────────────────────────────────────
    for row in shown.sort("due_date", descending=False).iter_rows(named=True):
        status_icon = _STATUS_COLOR.get(row["payment_status"], "⚪")
        amount      = float(row["amount"] or 0)
        paid        = float(row["amount_paid"] or 0)
        outstanding = amount - paid
        due_str     = str(row.get("due_date",""))[:10]

        try:
            due_date = dt.date.fromisoformat(due_str)
            overdue  = (today - due_date).days
            overdue_str = f"({overdue}d overdue)" if overdue > 0 else f"(due in {-overdue}d)"
        except ValueError:
            overdue_str = ""

        with st.expander(
            f"{status_icon} {row['invoice_id']}  |  "
            f"${outstanding:,.0f} outstanding  |  Due: {due_str} {overdue_str}"
        ):
            col_a, col_b = st.columns(2)
            with col_a:
                st.markdown(f"**Invoice:** {row['invoice_id']}")
                st.markdown(f"**Stone:** {row.get('stock_id','—')}")
                st.markdown(f"**Invoice date:** {str(row.get('invoice_date',''))[:10]}")
                st.markdown(f"**Due date:** {due_str}")
                st.markdown(f"**Payment terms:** {row.get('payment_terms_days',30)} days")

            with col_b:
                st.markdown(f"**Total amount:** ${amount:,.2f}")
                st.markdown(f"**Amount paid:** ${paid:,.2f}")
                st.markdown(f"**Outstanding:** **${outstanding:,.2f}**")
                st.markdown(f"**Status:** {status_icon} {row['payment_status']}")

                if row["payment_status"] != "Paid":
                    st.markdown("---")
                    st.caption("To pay, contact your account manager or make a bank transfer to:")
                    st.code(
                        "Bank: HDFC Bank\n"
                        "Account: Pramukh Gems Pvt Ltd\n"
                        "IFSC: HDFC0001234\n"
                        f"Reference: {row['invoice_id']}"
                    )
