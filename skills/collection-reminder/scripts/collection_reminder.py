"""Collection & Payment Reminder Agent — Skill 4.

Watches every open/partial invoice, buckets it by days-past-due, and
drafts a tone-appropriate reminder message. Designed to run daily.

Public API
----------
- ``bucket_invoices(sales, payment_history, today)``
  → polars DataFrame: one row per unpaid invoice with bucket + days_past_due.
- ``draft_reminder(row, customer_name, model)``
  → reminder string via LLM (optional).
- ``daily_report(sales, payment_history, customers, today)``
  → summary dict + full bucketed DataFrame.

CLI
---
  python collection_reminder.py                       # daily report
  python collection_reminder.py --invoice INV00042    # drill into one invoice
  python collection_reminder.py --customer CUST0013   # all open invoices for a customer
  python collection_reminder.py --bucket overdue      # filter by bucket
  python collection_reminder.py --model api-llama-4-scout  # add LLM reminders
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Iterable

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"

# Bucket definitions: (label, min_days_past_due, max_days_past_due_inclusive)
# "upcoming"  = not yet due but within 5 days
# "just_due"  = 0–7 days past due
# "aging"     = 8–30 days past due
# "overdue"   = 31–60 days past due
# "critical"  = 60+ days past due
BUCKETS = ["upcoming", "just_due", "aging", "overdue", "critical"]

_BUCKET_TONE: dict[str, str] = {
    "upcoming": "friendly heads-up",
    "just_due": "polite nudge",
    "aging": "firm reminder",
    "overdue": "escalation",
    "critical": "urgent — flag for management",
}


# ---------------------------------------------------------------------------
# Pure bucketing logic
# ---------------------------------------------------------------------------


def classify_invoice(days_past_due: int) -> str:
    """Return the bucket label for an invoice given days past due.

    Negative values = not yet due.
    """
    if days_past_due < -5:
        return "future"       # too early to remind — skip
    if days_past_due <= 0:
        return "upcoming"
    if days_past_due <= 7:
        return "just_due"
    if days_past_due <= 30:
        return "aging"
    if days_past_due <= 60:
        return "overdue"
    return "critical"


# ---------------------------------------------------------------------------
# Amount-still-owed helper
# ---------------------------------------------------------------------------


def _amount_paid_per_invoice(payment_history: pl.DataFrame) -> pl.DataFrame:
    """Sum of payment_amount per invoice_id from payment_history."""
    if payment_history.is_empty():
        return pl.DataFrame(schema={"invoice_id": pl.Utf8, "amount_paid": pl.Float64})
    return (
        payment_history.group_by("invoice_id")
        .agg(pl.col("payment_amount").sum().alias("amount_paid"))
    )


# ---------------------------------------------------------------------------
# Main bucketing pipeline
# ---------------------------------------------------------------------------


def bucket_invoices(
    sales: pl.DataFrame,
    payment_history: pl.DataFrame,
    today: dt.date,
) -> pl.DataFrame:
    """Return every actionable unpaid invoice with bucket + amount_outstanding.

    Columns: invoice_id, transaction_id, customer_id, broker_id,
    sold_price, amount_paid, amount_outstanding, invoice_date, due_date,
    days_past_due, bucket, payment_status.

    Excludes 'Paid' rows and 'future' bucket (more than 5 days before due).
    Sorted by bucket urgency (critical first), then days_past_due desc.

    Note: the seed data's payment_history records batch/customer-level payments,
    not per-invoice line items, so payment amounts cannot be reliably subtracted
    from sold_price in the prototype. amount_outstanding = sold_price for all
    unpaid invoices; partial-payment tracking is a production-only feature.
    """
    unpaid = sales.filter(
        pl.col("payment_status").is_in(["Open", "Partial", "Advance"])
    ).select([
        "transaction_id", "invoice_id", "customer_id", "broker_id",
        "sold_price", "payment_status", "invoice_date", "due_date",
        "payment_terms_days",
    ]).with_columns(pl.col("due_date").str.to_date())

    enriched = (
        unpaid
        .with_columns(
            pl.lit(0.0).alias("amount_paid"),
            pl.col("sold_price").alias("amount_outstanding"),
        )
        .with_columns(
            (pl.lit(today) - pl.col("due_date")).dt.total_days()
            .cast(pl.Int64)
            .alias("days_past_due")
        )
    )

    # Apply bucket classification row-by-row (small dataset ~300 rows).
    rows = enriched.to_dicts()
    bucketed: list[dict] = []
    for r in rows:
        b = classify_invoice(int(r["days_past_due"]))
        if b == "future":
            continue
        bucketed.append({**r, "bucket": b})

    if not bucketed:
        return _empty_bucketed()

    # Priority: critical(4) > overdue(3) > aging(2) > just_due(1) > upcoming(0).
    # Sort _bp descending so critical (highest number) appears first.
    bucket_priority = {b: i for i, b in enumerate(BUCKETS)}
    return (
        pl.DataFrame(bucketed)
        .with_columns(
            pl.col("bucket")
            .replace_strict(bucket_priority, return_dtype=pl.Int64)
            .alias("_bp")
        )
        .sort(["_bp", "days_past_due"], descending=[True, True])
        .drop("_bp")
    )


def _empty_bucketed() -> pl.DataFrame:
    return pl.DataFrame(schema={
        "transaction_id": pl.Utf8,
        "invoice_id": pl.Utf8,
        "customer_id": pl.Utf8,
        "broker_id": pl.Utf8,
        "sold_price": pl.Float64,
        "payment_status": pl.Utf8,
        "invoice_date": pl.Utf8,
        "due_date": pl.Date,
        "payment_terms_days": pl.Int64,
        "amount_paid": pl.Float64,
        "amount_outstanding": pl.Float64,
        "days_past_due": pl.Int64,
        "bucket": pl.Utf8,
    })


# ---------------------------------------------------------------------------
# Daily report summary
# ---------------------------------------------------------------------------


def daily_report(
    sales: pl.DataFrame,
    payment_history: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date,
) -> tuple[dict, pl.DataFrame]:
    """Return (summary_counts, bucketed_df).

    summary_counts keys: upcoming, just_due, aging, overdue, critical,
    total_outstanding_amount.
    """
    df = bucket_invoices(sales, payment_history, today)
    counts: dict = {b: 0 for b in BUCKETS}
    total_outstanding = 0.0
    if not df.is_empty():
        for b in BUCKETS:
            counts[b] = int((df["bucket"] == b).sum())
        total_outstanding = float(df["amount_outstanding"].sum())
    counts["total_outstanding_amount"] = total_outstanding
    return counts, df


# ---------------------------------------------------------------------------
# Header + table formatting
# ---------------------------------------------------------------------------


def header_line(counts: dict) -> str:
    total = sum(counts[b] for b in BUCKETS)
    return (
        f"{total} open invoices — "
        f"Critical: {counts['critical']} | "
        f"Overdue: {counts['overdue']} | "
        f"Aging: {counts['aging']} | "
        f"Just Due: {counts['just_due']} | "
        f"Upcoming: {counts['upcoming']} | "
        f"Total outstanding: ${counts['total_outstanding_amount']:,.0f}"
    )


def format_table(df: pl.DataFrame, top: int = 20) -> str:
    if df.is_empty():
        return "_(no open invoices)_"
    cols = ["invoice_id", "customer_id", "amount_outstanding",
            "due_date", "days_past_due", "bucket", "payment_status"]
    head = df.head(top).select(cols)
    headers = ["Invoice", "Customer", "Outstanding", "Due Date",
               "Days Past Due", "Bucket", "Status"]
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for row in head.iter_rows(named=True):
        lines.append(
            "| " + " | ".join([
                row["invoice_id"],
                row["customer_id"],
                f"${row['amount_outstanding']:,.0f}",
                str(row["due_date"]),
                str(row["days_past_due"]),
                row["bucket"],
                row["payment_status"],
            ]) + " |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM reminder drafting (optional)
# ---------------------------------------------------------------------------


def draft_reminder(
    invoice_row: dict,
    customer_name: str,
    model: str = "api-llama-4-scout",
    prior_reminder_count: int = 0,
) -> str:
    """Ask an LLM to draft a tone-appropriate reminder message."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    bucket = invoice_row.get("bucket", "aging")
    tone = _BUCKET_TONE.get(bucket, "firm reminder")
    days = invoice_row.get("days_past_due", 0)
    amount = invoice_row.get("amount_outstanding", 0.0)
    invoice_id = invoice_row.get("invoice_id", "")
    due_date = str(invoice_row.get("due_date", ""))

    prompt = (
        "You are drafting a payment reminder for Pramukh Gems, a lab-grown diamond wholesaler.\n\n"
        f"Customer: {customer_name}\n"
        f"Invoice: {invoice_id}\n"
        f"Amount outstanding: ${amount:,.2f}\n"
        f"Original due date: {due_date}\n"
        f"Days past due: {days}\n"
        f"Tone required: {tone} (bucket: {bucket})\n"
        f"Prior reminders sent: {prior_reminder_count}\n\n"
        "Write a single short paragraph (3–5 sentences) as the reminder message. "
        "Address the customer by name. Be professional. "
        "For 'critical' bucket, mention that the account will be escalated to management "
        "if not resolved within 5 business days. No preamble or subject line."
    )
    return ask(prompt, model=model, temperature=0.4) or ""


def narrate_daily_report(
    counts: dict,
    df: pl.DataFrame,
    model: str = "api-llama-4-scout",
) -> str:
    """2–3 sentence LLM executive summary of today's collection picture."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    sample = df.filter(pl.col("bucket").is_in(["critical", "overdue"])).head(5)
    sample_rows = sample.select(["invoice_id", "customer_id",
                                  "amount_outstanding", "days_past_due",
                                  "bucket"]).to_dicts()

    prompt = (
        "You are summarizing today's collection report for a lab-grown diamond wholesaler.\n\n"
        f"Open invoice counts: {json.dumps({k: counts[k] for k in BUCKETS})}.\n"
        f"Total outstanding: ${counts['total_outstanding_amount']:,.0f}.\n"
        f"Most urgent invoices: {json.dumps(sample_rows, default=str)}.\n\n"
        "Write 2–3 sentences for the desk: total exposure, which bucket needs "
        "immediate attention, and any single customer the desk should call today. "
        "No preamble, no bullets."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        "sales": pl.read_csv(data_dir / "sales_transactions_seed.csv"),
        "payment_history": pl.read_csv(data_dir / "payment_history_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Daily collection & payment reminder agent."
    )
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)
    p.add_argument(
        "--bucket",
        choices=BUCKETS,
        default=None,
        help="Filter to one aging bucket.",
    )
    p.add_argument("--invoice", default=None, help="Drill into a single invoice ID.")
    p.add_argument("--customer", default=None,
                   help="Show all open invoices for this customer ID.")
    p.add_argument("--today", type=lambda s: dt.date.fromisoformat(s), default=None,
                   help="Override today's date (YYYY-MM-DD).")
    p.add_argument("--model", default=None,
                   help="If set, draft LLM reminders for top actionable invoices.")
    p.add_argument("--top", type=int, default=20,
                   help="Max rows to print (default 20).")
    p.add_argument("--json", action="store_true",
                   help="Emit JSON instead of formatted text.")
    return p


def _apply_filters(
    df: pl.DataFrame,
    bucket: str | None,
    invoice: str | None,
    customer: str | None,
) -> pl.DataFrame:
    out = df
    if bucket:
        out = out.filter(pl.col("bucket") == bucket)
    if invoice:
        out = out.filter(pl.col("invoice_id") == invoice)
    if customer:
        out = out.filter(
            (pl.col("customer_id") == customer)
            | (pl.col("broker_id") == customer)
        )
    return out


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    today = args.today or dt.date.today()

    counts, df = daily_report(
        csvs["sales"], csvs["payment_history"], csvs["customers"], today
    )
    filtered = _apply_filters(df, args.bucket, args.invoice, args.customer)

    if args.json:
        out = {
            "summary": counts,
            "invoices": filtered.head(args.top).to_dicts(),
        }
        print(json.dumps(out, default=str))
        return 0

    print(header_line(counts))
    print()
    print(format_table(filtered, top=args.top))

    # LLM reminders for top actionable rows (critical + overdue).
    if args.model and not filtered.is_empty():
        actionable = (
            filtered.filter(pl.col("bucket").is_in(["critical", "overdue"]))
            .head(3)
        )
        cust_map = dict(
            zip(csvs["customers"]["customer_id"].to_list(),
                csvs["customers"]["customer_name"].to_list())
        )
        if not actionable.is_empty():
            print()
            print("## Drafted reminders (top 3 most urgent)")
            for row in actionable.iter_rows(named=True):
                cname = cust_map.get(row["customer_id"], row["customer_id"])
                print(f"\n**{row['invoice_id']} — {cname}**")
                print(draft_reminder(row, cname, model=args.model))
        print()
        print(narrate_daily_report(counts, df, model=args.model))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
