"""Admin — Billing & Payments: invoices, payment collection, reminders."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import read_table, record_payment, create_invoice, log_email
from app.components.auth import require_admin

_BUCKET_COLOR = {
    "Critical": "🔴", "Overdue": "🟠",
    "Aging": "🟡", "Just Due": "🟢", "Upcoming": "🔵",
}


def _bucket(days: int) -> str:
    if days < 0:   return "Upcoming"
    if days <= 7:  return "Just Due"
    if days <= 30: return "Aging"
    if days <= 60: return "Overdue"
    return "Critical"


def render():
    st.title("💳 Billing & Payments")
    if not require_admin():
        return

    invoices  = read_table("invoices")
    customers = read_table("customers")
    email_log = read_table("email_log")

    tab1, tab2, tab3, tab4 = st.tabs([
        "📄 All Invoices", "💰 Record Payment",
        "📬 Send Reminders", "🆕 Create Invoice"
    ])

    # ── Tab 1: All Invoices ────────────────────────────────────────────────
    with tab1:
        if invoices.is_empty():
            st.info("No invoices found.")
        else:
            today = dt.date.today()
            inv_display = (
                invoices
                .with_columns(
                    pl.col("due_date").str.slice(0, 10).str.to_date().alias("_due")
                )
                .with_columns(
                    ((pl.lit(today) - pl.col("_due")).dt.total_days()).alias("days_overdue")
                )
                .with_columns(
                    pl.col("days_overdue").map_elements(_bucket, return_dtype=pl.Utf8)
                    .alias("bucket")
                )
                .with_columns(
                    (pl.col("amount") - pl.col("amount_paid")).alias("outstanding")
                )
                .drop("_due")
            )

            # Filter controls
            col_s, col_b = st.columns(2)
            status_filter = col_s.multiselect(
                "Payment status", ["Open","Partial","Paid"],
                default=["Open","Partial"]
            )
            bucket_filter = col_b.multiselect(
                "Aging bucket",
                ["Upcoming","Just Due","Aging","Overdue","Critical"],
                default=["Critical","Overdue","Aging"]
            )

            shown = inv_display
            if status_filter:
                shown = shown.filter(pl.col("payment_status").is_in(status_filter))
            if bucket_filter:
                shown = shown.filter(pl.col("bucket").is_in(bucket_filter))

            # Summary metrics
            m1, m2, m3 = st.columns(3)
            m1.metric("Invoices shown", len(shown))
            m2.metric("Total outstanding",
                      f"${float(shown['outstanding'].sum()):,.0f}")
            critical_n = int((shown["bucket"] == "Critical").sum())
            m3.metric("Critical 🔴", critical_n)

            display_cols = ["invoice_id","customer_id","amount","amount_paid",
                            "outstanding","invoice_date","due_date",
                            "payment_status","bucket","days_overdue"]
            st.dataframe(
                shown.select([c for c in display_cols if c in shown.columns])
                     .sort("days_overdue", descending=True),
                use_container_width=True, height=450,
            )

    # ── Tab 2: Record Payment ─────────────────────────────────────────────
    with tab2:
        st.subheader("Record a Payment")
        open_invs = invoices.filter(
            pl.col("payment_status").is_in(["Open","Partial"])
        )
        if open_invs.is_empty():
            st.success("All invoices are paid! 🎉")
        else:
            inv_ids = open_invs["invoice_id"].to_list()
            sel_inv = st.selectbox("Select Invoice", inv_ids)
            inv_row = open_invs.filter(pl.col("invoice_id") == sel_inv).to_dicts()[0]

            col_a, col_b = st.columns(2)
            with col_a:
                outstanding = float(inv_row["amount"]) - float(inv_row["amount_paid"] or 0)
                st.markdown(f"**Customer:** {inv_row['customer_id']}")
                st.markdown(f"**Invoice total:** ${float(inv_row['amount']):,.2f}")
                st.markdown(f"**Paid so far:** ${float(inv_row['amount_paid'] or 0):,.2f}")
                st.markdown(f"**Outstanding:** ${outstanding:,.2f}")
                st.markdown(f"**Due date:** {inv_row['due_date']}")

            with col_b:
                pay_amount = st.number_input(
                    "Payment amount ($)",
                    min_value=0.01,
                    max_value=outstanding + 0.01,
                    value=outstanding,
                    step=10.0,
                )
                pay_date = st.date_input("Payment date", value=dt.date.today())
                if st.button("✅ Record Payment", type="primary"):
                    record_payment(sel_inv, pay_amount, str(pay_date))
                    st.success(f"Payment of ${pay_amount:,.2f} recorded for {sel_inv}.")
                    st.rerun()

    # ── Tab 3: Send Reminders ─────────────────────────────────────────────
    with tab3:
        st.subheader("📬 Collection Reminders")
        st.caption("Drafts reminder messages using Skill 4. Click Send to log the email.")

        open_invs2 = invoices.filter(
            pl.col("payment_status").is_in(["Open","Partial"])
        )
        if open_invs2.is_empty():
            st.success("No open invoices.")
        else:
            today = dt.date.today()
            aged2 = (
                open_invs2
                .with_columns(
                    pl.col("due_date").str.slice(0, 10).str.to_date().alias("_due")
                )
                .with_columns(
                    ((pl.lit(today) - pl.col("_due")).dt.total_days()).alias("days_overdue")
                )
                .with_columns(
                    pl.col("days_overdue").map_elements(_bucket, return_dtype=pl.Utf8)
                    .alias("bucket")
                )
                .drop("_due")
                .sort("days_overdue", descending=True)
            )

            cust_map = {}
            if not customers.is_empty():
                cust_map = {
                    r["customer_id"]: r["customer_name"]
                    for r in customers.select(["customer_id","customer_name"]).to_dicts()
                }

            _TONE = {
                "Critical": "urgent — please pay within 5 business days or the account will be escalated",
                "Overdue":  "firm — payment is significantly overdue",
                "Aging":    "firm reminder",
                "Just Due": "polite nudge",
                "Upcoming": "friendly heads-up",
            }

            for row in aged2.head(10).iter_rows(named=True):
                bucket = row["bucket"]
                cname  = cust_map.get(row["customer_id"], row["customer_id"])
                outstanding = float(row["amount"]) - float(row["amount_paid"] or 0)
                emoji  = _BUCKET_COLOR.get(bucket, "⚪")

                with st.expander(
                    f"{emoji} {row['invoice_id']} — {cname} — "
                    f"${outstanding:,.0f} — {bucket} ({row['days_overdue']}d)"
                ):
                    tone = _TONE.get(bucket, "reminder")
                    draft = (
                        f"Dear {cname},\n\n"
                        f"This is a {tone} regarding invoice **{row['invoice_id']}** "
                        f"for **${outstanding:,.2f}**, which was due on "
                        f"**{row['due_date'][:10]}** "
                        f"({row['days_overdue']} days ago).\n\n"
                        f"Please arrange payment at your earliest convenience. "
                        f"If you have already sent payment, please disregard this notice.\n\n"
                        f"Thank you,\nPramukh Gems Accounts"
                    )
                    msg = st.text_area("Message", value=draft,
                                       key=f"msg_{row['invoice_id']}", height=180)
                    if st.button(f"📤 Send Reminder",
                                 key=f"send_{row['invoice_id']}"):
                        log_email(
                            recipient_id=row["customer_id"],
                            subject=f"Payment Reminder — {row['invoice_id']}",
                            body=msg,
                            email_type=f"reminder_{bucket.lower()}",
                        )
                        st.success(f"Reminder logged for {row['invoice_id']}")

        # Recent email log
        if not email_log.is_empty():
            st.markdown("---")
            st.subheader("📋 Recent Reminders Sent")
            st.dataframe(
                email_log.sort("sent_at", descending=True).head(20),
                use_container_width=True
            )

    # ── Tab 4: Create Invoice ─────────────────────────────────────────────
    with tab4:
        st.subheader("🆕 Create New Invoice")
        quotes = read_table("quotes")
        accepted = (
            quotes.filter(
                pl.col("quote_outcome").is_in(["Accepted"]) &
                pl.col("final_agreed_price").is_not_null()
            ) if not quotes.is_empty() else pl.DataFrame()
        )

        col_a, col_b = st.columns(2)
        with col_a:
            if not accepted.is_empty():
                st.markdown("**From accepted quote:**")
                qids = accepted["quote_id"].to_list()
                sel_q = st.selectbox("Select quote", ["(manual)"] + qids)
                if sel_q != "(manual)":
                    q = accepted.filter(pl.col("quote_id") == sel_q).to_dicts()[0]
                    st.info(f"Customer: {q['customer_id']} | "
                            f"Stone: {q['stock_id']} | "
                            f"Amount: ${float(q['final_agreed_price'] or q['offered_price']):,.2f}")
            else:
                sel_q = "(manual)"
                st.info("No accepted quotes found — use manual entry.")

        with col_b:
            default_cid = ""
            default_sid = ""
            default_amt = 0.0
            if sel_q != "(manual)" and not accepted.is_empty():
                q = accepted.filter(pl.col("quote_id") == sel_q).to_dicts()[0]
                default_cid = q["customer_id"]
                default_sid = q["stock_id"]
                default_amt = float(q.get("final_agreed_price") or q.get("offered_price") or 0)

            inv_id    = st.text_input("Invoice ID", value=f"INV-{dt.date.today().strftime('%Y%m%d')}-")
            cust_id   = st.text_input("Customer ID", value=default_cid)
            stock_id  = st.text_input("Stock ID",    value=default_sid)
            amount    = st.number_input("Amount ($)", min_value=0.0,
                                        value=default_amt, step=50.0)
            terms     = st.selectbox("Payment terms (days)", [30, 60, 90])
            due_date  = dt.date.today() + dt.timedelta(days=terms)
            st.caption(f"Due date: {due_date}")

            if st.button("📄 Create Invoice", type="primary"):
                if inv_id and cust_id and amount > 0:
                    create_invoice(
                        invoice_id=inv_id,
                        customer_id=cust_id,
                        stock_id=stock_id,
                        amount=amount,
                        due_date=str(due_date),
                        payment_terms_days=terms,
                        quote_id=sel_q if sel_q != "(manual)" else None,
                    )
                    st.success(f"Invoice {inv_id} created for ${amount:,.2f} — due {due_date}.")
                    st.rerun()
                else:
                    st.error("Invoice ID, Customer ID, and Amount are required.")
