"""Morning Desk Briefing — Skill 7.

Chains inventory aging, overdue collections, open negotiations, and pending
quote responses into a single "what needs my attention today?" report.

Public API
----------
- ``get_aging_actions(inventory, demand_signals, today, top_n)``
  → polars DataFrame: available stones aged ≥ 90d tagged CLEAR or DISCOUNT.
- ``get_collection_alerts(sales, today, top_n)``
  → polars DataFrame: unpaid invoices more than 30 days past due.
- ``get_open_negotiations(threads, customers, today)``
  → polars DataFrame: Open threads sorted by last_message_date asc.
- ``get_expiring_quotes(quotes, today)``
  → polars DataFrame: Pending quotes with a customer counter-offer.
- ``format_briefing(aging, collections, negotiations, quotes, today, top_n)``
  → formatted string report.
- ``synthesize_briefing(aging, collections, negotiations, quotes, model)``
  → LLM-generated 3–5 bullet action summary.

CLI
---
  python morning_briefing.py                         # plain text briefing
  python morning_briefing.py --model api-llama-4-scout  # + LLM summary
  python morning_briefing.py --top 10               # show top 10 per section
  python morning_briefing.py --chart-out chart.png  # save charts
  python morning_briefing.py --json                 # JSON output
  python morning_briefing.py --today 2026-04-25     # pin date
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

# Triage tag priority order for display
_TAG_ORDER = ["CLEAR", "DISCOUNT", "WATCH", "HOLD"]

# Invoice bucket labels for charts
_INVOICE_BUCKETS = ["Critical 60+d", "Overdue 31-60d", "Aging 8-30d"]


# ---------------------------------------------------------------------------
# Data pull 1 — Inventory aging actions
# ---------------------------------------------------------------------------


def _demand_by_category(demand_signals: pl.DataFrame, today: dt.date) -> dict[str, float]:
    """Compute mean demand_score per category over last 60 days."""
    cutoff = today - dt.timedelta(days=60)
    cutoff_str = cutoff.isoformat()
    recent = demand_signals.filter(pl.col("signal_date") >= cutoff_str)
    if recent.is_empty():
        return {}
    grouped = (
        recent.group_by("category_simple")
        .agg(pl.col("demand_score").mean().alias("mean_demand"))
    )
    return dict(zip(grouped["category_simple"].to_list(), grouped["mean_demand"].to_list()))


def _triage_tag(age: int, demand: float) -> str:
    """Return triage tag for one stone based on age and demand score."""
    if age >= 90:
        return "CLEAR" if age >= 180 else "DISCOUNT"
    return "HOLD"


def get_aging_actions(
    inventory: pl.DataFrame,
    demand_signals: pl.DataFrame,
    today: dt.date,
    top_n: int = 20,
) -> pl.DataFrame:
    """Return top_n available stones aged >= 90d, tagged CLEAR or DISCOUNT.

    Sorted by: CLEAR first, then DISCOUNT; oldest first within each tag.
    Columns: stock_id, category_simple, age_in_stock_days, p_pcs, cost_basis,
             demand_score, tag, suggested_discount_pct.
    """
    available = inventory.filter(pl.col("status") == "Available")
    demand_map = _demand_by_category(demand_signals, today)

    rows = available.to_dicts()
    tagged: list[dict] = []
    for r in rows:
        age = int(r.get("age_in_stock_days", 0) or 0)
        if age < 90:
            continue
        cat = r.get("category_simple", "")
        demand = float(demand_map.get(cat, 0.5))
        tag = _triage_tag(age, demand)

        # Suggested discount: CLEAR = -22%, DISCOUNT = -12%
        suggested_pct = -22.0 if tag == "CLEAR" else -12.0

        tagged.append(
            {
                "stock_id": r.get("stock_id", ""),
                "category_simple": cat,
                "age_in_stock_days": age,
                "p_pcs": float(r.get("p_pcs", 0) or 0),
                "cost_basis": float(r.get("cost_basis", 0) or 0),
                "demand_score": round(demand, 3),
                "tag": tag,
                "suggested_discount_pct": suggested_pct,
            }
        )

    if not tagged:
        return pl.DataFrame(
            schema={
                "stock_id": pl.Utf8,
                "category_simple": pl.Utf8,
                "age_in_stock_days": pl.Int64,
                "p_pcs": pl.Float64,
                "cost_basis": pl.Float64,
                "demand_score": pl.Float64,
                "tag": pl.Utf8,
                "suggested_discount_pct": pl.Float64,
            }
        )

    tag_priority = {"CLEAR": 0, "DISCOUNT": 1, "WATCH": 2, "HOLD": 3}
    return (
        pl.DataFrame(tagged)
        .with_columns(
            pl.col("tag")
            .replace_strict(tag_priority, return_dtype=pl.Int64)
            .alias("_tp")
        )
        .sort(["_tp", "age_in_stock_days"], descending=[False, True])
        .drop("_tp")
        .head(top_n)
    )


# ---------------------------------------------------------------------------
# Data pull 2 — Collection alerts
# ---------------------------------------------------------------------------


def get_collection_alerts(
    sales: pl.DataFrame,
    today: dt.date,
    top_n: int = 20,
) -> pl.DataFrame:
    """Return unpaid invoices more than 30 days past due, sorted desc.

    Columns: invoice_id, customer_id, sold_price, payment_status,
             due_date, days_past_due, invoice_bucket.
    """
    unpaid = sales.filter(
        pl.col("payment_status").is_in(["Open", "Partial"])
    )

    if unpaid.is_empty():
        return pl.DataFrame(
            schema={
                "invoice_id": pl.Utf8,
                "customer_id": pl.Utf8,
                "sold_price": pl.Float64,
                "payment_status": pl.Utf8,
                "due_date": pl.Date,
                "days_past_due": pl.Int64,
                "invoice_bucket": pl.Utf8,
            }
        )

    enriched = unpaid.with_columns(
        pl.col("due_date").str.to_date().alias("due_date")
    ).with_columns(
        (pl.lit(today) - pl.col("due_date")).dt.total_days()
        .cast(pl.Int64)
        .alias("days_past_due")
    )

    overdue = enriched.filter(pl.col("days_past_due") > 30)

    if overdue.is_empty():
        return pl.DataFrame(
            schema={
                "invoice_id": pl.Utf8,
                "customer_id": pl.Utf8,
                "sold_price": pl.Float64,
                "payment_status": pl.Utf8,
                "due_date": pl.Date,
                "days_past_due": pl.Int64,
                "invoice_bucket": pl.Utf8,
            }
        )

    def _inv_bucket(days: int) -> str:
        if days > 60:
            return "Critical 60+d"
        if days > 30:
            return "Overdue 31-60d"
        return "Aging 8-30d"

    rows = overdue.to_dicts()
    bucketed = [
        {
            "invoice_id": r["invoice_id"],
            "customer_id": r["customer_id"],
            "sold_price": float(r.get("sold_price", 0) or 0),
            "payment_status": r["payment_status"],
            "due_date": r["due_date"],
            "days_past_due": int(r["days_past_due"]),
            "invoice_bucket": _inv_bucket(int(r["days_past_due"])),
        }
        for r in rows
    ]

    return (
        pl.DataFrame(bucketed)
        .sort("days_past_due", descending=True)
        .head(top_n)
    )


# ---------------------------------------------------------------------------
# Data pull 3 — Open negotiations
# ---------------------------------------------------------------------------


def get_open_negotiations(
    threads: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date,
) -> pl.DataFrame:
    """Return all Open negotiation threads, sorted by last_message_date asc.

    Columns: thread_id, customer_id, stock_id, category_simple,
             last_message_date, last_offer, days_since_activity.
    """
    open_threads = threads.filter(pl.col("status") == "Open")

    if open_threads.is_empty():
        return pl.DataFrame(
            schema={
                "thread_id": pl.Utf8,
                "customer_id": pl.Utf8,
                "stock_id": pl.Utf8,
                "category_simple": pl.Utf8,
                "last_message_date": pl.Utf8,
                "last_offer": pl.Float64,
                "days_since_activity": pl.Int64,
            }
        )

    # Normalize last_message_date: strip time component if present
    result = open_threads.with_columns(
        pl.col("last_message_date")
        .str.slice(0, 10)
        .alias("last_message_date_str")
    )

    rows = result.to_dicts()
    enriched: list[dict] = []
    for r in rows:
        date_str = r.get("last_message_date_str", "") or ""
        try:
            last_dt = dt.date.fromisoformat(date_str)
            days_since = (today - last_dt).days
        except (ValueError, TypeError):
            days_since = 0

        enriched.append(
            {
                "thread_id": r.get("thread_id", ""),
                "customer_id": r.get("customer_id", ""),
                "stock_id": r.get("stock_id", ""),
                "category_simple": r.get("category_simple", ""),
                "last_message_date": date_str,
                "last_offer": float(r.get("last_offer") or 0),
                "days_since_activity": days_since,
            }
        )

    return (
        pl.DataFrame(enriched)
        .sort("days_since_activity", descending=True)
    )


# ---------------------------------------------------------------------------
# Data pull 4 — Expiring / awaiting-response quotes
# ---------------------------------------------------------------------------


def get_expiring_quotes(
    quotes: pl.DataFrame,
    today: dt.date,
) -> pl.DataFrame:
    """Return Pending quotes where the customer has already countered.

    Proxy for "still active": quote_date within last 14 days.
    Columns: quote_id, quote_date, customer_id, stock_id,
             offered_price, customer_offer, category_simple.
    """
    cutoff = (today - dt.timedelta(days=14)).isoformat()

    pending = quotes.filter(
        (pl.col("quote_outcome") == "Pending")
        & (pl.col("quote_date") >= cutoff)
        & pl.col("customer_offer").is_not_null()
        & (pl.col("customer_offer").cast(pl.Utf8).str.len_chars() > 0)
    )

    if pending.is_empty():
        return pl.DataFrame(
            schema={
                "quote_id": pl.Utf8,
                "quote_date": pl.Utf8,
                "customer_id": pl.Utf8,
                "stock_id": pl.Utf8,
                "offered_price": pl.Float64,
                "customer_offer": pl.Float64,
                "category_simple": pl.Utf8,
            }
        )

    return pending.select(
        [
            "quote_id",
            "quote_date",
            "customer_id",
            "stock_id",
            "offered_price",
            "customer_offer",
            "category_simple",
        ]
    ).sort("quote_date", descending=False)


# ---------------------------------------------------------------------------
# Chart generation
# ---------------------------------------------------------------------------


def build_charts(
    inventory: pl.DataFrame,
    aging_actions: pl.DataFrame,
    collection_alerts: pl.DataFrame,
    chart_out: Path,
) -> tuple[Path, Path]:
    """Build two horizontal bar charts and save them.

    Returns (inventory_chart_path, invoices_chart_path).
    """
    from plotnine import (
        aes,
        coord_flip,
        geom_bar,
        geom_col,
        ggplot,
        labs,
        scale_fill_manual,
        theme_minimal,
        theme,
        element_text,
    )

    base = str(chart_out)
    if base.endswith(".png"):
        base = base[:-4]
    inv_path = Path(base + "_inventory.png")
    inv_path_str = str(inv_path)
    inv_invoice_path = Path(base + "_invoices.png")
    inv_invoice_str = str(inv_invoice_path)

    # --- Panel 1: inventory triage tag counts ---
    available = inventory.filter(pl.col("status") == "Available")
    all_tags: list[dict] = []
    for r in available.to_dicts():
        age = int(r.get("age_in_stock_days", 0) or 0)
        if age >= 180:
            tag = "CLEAR"
        elif age >= 90:
            tag = "DISCOUNT"
        elif age >= 30:
            tag = "WATCH"
        else:
            tag = "HOLD"
        all_tags.append({"tag": tag})

    tag_df = pl.DataFrame(all_tags)
    tag_counts = (
        tag_df.group_by("tag")
        .agg(pl.len().alias("count"))
        .with_columns(
            pl.col("tag")
            .replace_strict(
                {"CLEAR": 0, "DISCOUNT": 1, "WATCH": 2, "HOLD": 3},
                return_dtype=pl.Int64,
            )
            .alias("_order")
        )
        .sort("_order")
        .drop("_order")
    )

    tag_colors = {
        "CLEAR": "#d62728",
        "DISCOUNT": "#ff7f0e",
        "WATCH": "#aec7e8",
        "HOLD": "#c7c7c7",
    }

    tag_pd = tag_counts.to_pandas()
    tag_pd["tag"] = pl.Series(tag_pd["tag"]).cast(pl.Utf8).to_list()

    p_inv = (
        ggplot(tag_pd, aes(x="tag", y="count", fill="tag"))
        + geom_col()
        + coord_flip()
        + scale_fill_manual(values=tag_colors)
        + labs(title="Inventory Action Required", x="", y="Stones")
        + theme_minimal()
        + theme(legend_position="none")
    )
    p_inv.save(inv_path_str, width=8, height=4, dpi=150, verbose=False)

    # --- Panel 2: invoice aging bucket counts ---
    if not collection_alerts.is_empty():
        bucket_counts = (
            collection_alerts.group_by("invoice_bucket")
            .agg(pl.len().alias("count"))
        )
    else:
        bucket_counts = pl.DataFrame(
            {"invoice_bucket": _INVOICE_BUCKETS, "count": [0, 0, 0]}
        )

    bucket_order = {"Critical 60+d": 0, "Overdue 31-60d": 1, "Aging 8-30d": 2}
    bucket_sorted = (
        bucket_counts
        .with_columns(
            pl.col("invoice_bucket")
            .replace_strict(bucket_order, default=99, return_dtype=pl.Int64)
            .alias("_order")
        )
        .sort("_order")
        .drop("_order")
    )
    inv_colors = {
        "Critical 60+d": "#d62728",
        "Overdue 31-60d": "#ff7f0e",
        "Aging 8-30d": "#ffbb78",
    }

    bucket_pd = bucket_sorted.to_pandas()
    p_inv2 = (
        ggplot(bucket_pd, aes(x="invoice_bucket", y="count", fill="invoice_bucket"))
        + geom_col()
        + coord_flip()
        + scale_fill_manual(values=inv_colors)
        + labs(title="Outstanding Invoices by Age", x="", y="Invoices")
        + theme_minimal()
        + theme(legend_position="none")
    )
    p_inv2.save(inv_invoice_str, width=8, height=4, dpi=150, verbose=False)

    return inv_path, inv_invoice_path


# ---------------------------------------------------------------------------
# Text formatting
# ---------------------------------------------------------------------------


def format_briefing(
    aging: pl.DataFrame,
    collections: pl.DataFrame,
    negotiations: pl.DataFrame,
    quotes: pl.DataFrame,
    today: dt.date,
    top_n: int = 5,
    inventory_summary: dict | None = None,
    collections_summary: dict | None = None,
) -> str:
    """Return the formatted morning briefing as a string."""
    lines: list[str] = []
    lines.append(f"=== Morning Desk Briefing — {today.isoformat()} ===")
    lines.append("")

    # --- INVENTORY section ---
    n_clear = int((aging["tag"] == "CLEAR").sum()) if not aging.is_empty() else 0
    n_discount = int((aging["tag"] == "DISCOUNT").sum()) if not aging.is_empty() else 0
    total_avail = inventory_summary.get("total_available", 0) if inventory_summary else 0
    lines.append(
        f"INVENTORY ({n_clear} CLEAR | {n_discount} DISCOUNT of {total_avail} available)"
    )

    show_aging = aging.head(top_n) if not aging.is_empty() else aging
    for r in show_aging.iter_rows(named=True):
        tag = r["tag"]
        age = r["age_in_stock_days"]
        cat = r["category_simple"]
        sid = r["stock_id"]
        disc = r["suggested_discount_pct"]
        if tag == "CLEAR":
            lines.append(
                f"  {sid} — {cat} — {age}d — CLEAR ({disc:+.0f}% suggested)"
            )
        else:
            lines.append(
                f"  {sid} — {cat} — {age}d — {tag} ({disc:+.0f}% suggested)"
            )
    if aging.is_empty():
        lines.append("  (no aging actions needed)")
    lines.append("")

    # --- COLLECTIONS section ---
    n_critical = (
        int((collections["invoice_bucket"] == "Critical 60+d").sum())
        if not collections.is_empty()
        else 0
    )
    total_outstanding = (
        float(collections["sold_price"].sum()) if not collections.is_empty() else 0.0
    )
    lines.append(
        f"COLLECTIONS ({n_critical} critical | ${total_outstanding:,.0f} total outstanding)"
    )

    show_coll = collections.head(top_n) if not collections.is_empty() else collections
    for r in show_coll.iter_rows(named=True):
        inv = r["invoice_id"]
        cust = r["customer_id"]
        price = r["sold_price"]
        days = r["days_past_due"]
        lines.append(f"  {inv} — {cust} — ${price:,.0f} — {days} days overdue")
    if collections.is_empty():
        lines.append("  (no overdue collections)")
    lines.append("")

    # --- NEGOTIATIONS section ---
    n_open = len(negotiations)
    lines.append(f"NEGOTIATIONS ({n_open} open threads)")
    show_neg = negotiations.head(top_n) if not negotiations.is_empty() else negotiations
    for r in show_neg.iter_rows(named=True):
        tid = r["thread_id"]
        cust = r["customer_id"]
        sid = r["stock_id"]
        days = r["days_since_activity"]
        lines.append(
            f"  Thread {tid} — {cust} / {sid} — last activity {days} days ago"
        )
    if negotiations.is_empty():
        lines.append("  (no open negotiations)")
    lines.append("")

    # --- QUOTES section ---
    n_quotes = len(quotes)
    lines.append(f"QUOTES AWAITING RESPONSE ({n_quotes} quotes)")
    show_q = quotes.head(top_n) if not quotes.is_empty() else quotes
    for r in show_q.iter_rows(named=True):
        qid = r["quote_id"]
        cust = r["customer_id"]
        offered = r["offered_price"]
        counter = r["customer_offer"]
        lines.append(
            f"  {qid} — {cust} — offered ${offered:,.0f} (customer counter ${counter:,.0f})"
        )
    if quotes.is_empty():
        lines.append("  (no quotes awaiting response)")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM synthesis
# ---------------------------------------------------------------------------


def synthesize_briefing(
    aging: pl.DataFrame,
    collections: pl.DataFrame,
    negotiations: pl.DataFrame,
    quotes: pl.DataFrame,
    model: str = "api-llama-4-scout",
) -> str:
    """Ask the LLM to write a 3–5 bullet morning action summary. Cap 150 words."""
    try:
        from dotenv import load_dotenv

        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    aging_sample = aging.head(3).select(["stock_id", "category_simple", "age_in_stock_days", "tag"]).to_dicts()
    coll_sample = collections.head(3).select(["invoice_id", "customer_id", "sold_price", "days_past_due"]).to_dicts()
    neg_sample = negotiations.head(3).select(["thread_id", "customer_id", "stock_id", "days_since_activity"]).to_dicts()
    quote_sample = quotes.head(3).select(["quote_id", "customer_id", "offered_price", "customer_offer"]).to_dicts()

    prompt = (
        "You are writing a morning desk briefing for Pramukh Gems, a lab-grown diamond wholesaler.\n\n"
        f"Inventory aging actions (top 3): {json.dumps(aging_sample, default=str)}\n"
        f"Overdue collections (top 3): {json.dumps(coll_sample, default=str)}\n"
        f"Open negotiations (top 3): {json.dumps(neg_sample, default=str)}\n"
        f"Quotes awaiting response (top 3): {json.dumps(quote_sample, default=str)}\n\n"
        "Write exactly 3–5 bullet points as a morning action list for the desk. "
        "Rules:\n"
        "- Each bullet starts with a strong action verb (e.g. Clear, Follow up, Respond, Escalate, Review).\n"
        "- Name specific stones, invoice IDs, thread IDs, or customer IDs where available.\n"
        "- Be concrete and specific — no vague advice.\n"
        "- Total length: 150 words maximum.\n"
        "- No preamble, no section headers — just the bullets."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    """Load all seed CSVs needed for the morning briefing."""
    return {
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "demand_signals": pl.read_csv(data_dir / "demand_signals_seed.csv"),
        "sales": pl.read_csv(data_dir / "sales_transactions_seed.csv"),
        "threads": pl.read_csv(data_dir / "negotiation_threads_seed.csv"),
        "quotes": pl.read_csv(data_dir / "quotes_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Morning desk briefing — inventory, collections, negotiations, quotes."
    )
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)
    p.add_argument(
        "--top",
        type=int,
        default=5,
        help="Max rows to show per section (default 5).",
    )
    p.add_argument(
        "--model",
        default=None,
        help="If set, adds an LLM-generated 3-5 bullet summary (e.g. api-llama-4-scout).",
    )
    p.add_argument(
        "--chart-out",
        type=Path,
        default=None,
        help="Save inventory + invoice charts to this base path (two PNGs).",
    )
    p.add_argument(
        "--today",
        type=lambda s: dt.date.fromisoformat(s),
        default=None,
        help="Override today's date (YYYY-MM-DD) for reproducible runs.",
    )
    p.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    return p


def main(argv: Iterable[str] | None = None) -> int:  # noqa: C901
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    today = args.today or dt.date.today()

    csvs = load_csvs(args.data_dir)

    # Run four data pulls
    aging = get_aging_actions(
        csvs["inventory"], csvs["demand_signals"], today, top_n=args.top * 4
    )
    collections = get_collection_alerts(csvs["sales"], today, top_n=args.top * 4)
    negotiations = get_open_negotiations(
        csvs["threads"], csvs["customers"], today
    )
    quotes = get_expiring_quotes(csvs["quotes"], today)

    # Inventory summary for header
    n_available = int(
        (csvs["inventory"]["status"] == "Available").sum()
    )
    inventory_summary = {"total_available": n_available}

    if args.json:
        out = {
            "aging": aging.head(args.top).to_dicts(),
            "collections": collections.head(args.top).to_dicts(),
            "negotiations": negotiations.head(args.top).to_dicts(),
            "quotes": quotes.head(args.top).to_dicts(),
            "summary": {
                "n_aging_clear": int((aging["tag"] == "CLEAR").sum())
                if not aging.is_empty()
                else 0,
                "n_aging_discount": int((aging["tag"] == "DISCOUNT").sum())
                if not aging.is_empty()
                else 0,
                "n_critical_invoices": int(
                    (collections["invoice_bucket"] == "Critical 60+d").sum()
                )
                if not collections.is_empty()
                else 0,
                "total_outstanding": float(collections["sold_price"].sum())
                if not collections.is_empty()
                else 0.0,
                "n_open_negotiations": len(negotiations),
                "n_quotes_awaiting": len(quotes),
            },
        }
        print(json.dumps(out, default=str))
        return 0

    # Build and print formatted report
    report = format_briefing(
        aging,
        collections,
        negotiations,
        quotes,
        today,
        top_n=args.top,
        inventory_summary=inventory_summary,
    )
    print(report)

    # Optional LLM summary
    if args.model:
        print()
        print(f"--- LLM Summary ({args.model}) ---")
        summary = synthesize_briefing(aging, collections, negotiations, quotes, args.model)
        print(summary)

    # Optional charts
    if args.chart_out:
        inv_path, inv2_path = build_charts(
            csvs["inventory"], aging, collections, args.chart_out
        )
        print()
        print(f"Charts saved:")
        print(f"  {inv_path}")
        print(f"  {inv2_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
