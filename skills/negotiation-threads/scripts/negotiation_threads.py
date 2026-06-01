"""Negotiation Thread Summarizer — Skill 7.

Reads communication log notes (free text) and negotiation thread metadata,
then uses an LLM to summarize the current state and recommend the next action.

Public API
----------
- ``get_thread_messages(logs, thread_id)`` → list[dict]
- ``get_thread_metadata(threads, quotes, customers, thread_id, today)`` → dict
- ``get_open_threads(threads, customers, today)`` → pl.DataFrame
- ``summarize_thread_with_llm(messages, metadata, model)`` → str
- ``format_thread_header(metadata)`` → str
- ``format_messages(messages)`` → str
- ``format_open_threads_table(df)`` → str

CLI
---
  python negotiation_threads.py --thread THRD00042
  python negotiation_threads.py --customer CUST0013
  python negotiation_threads.py --stock LGSTK00115
  python negotiation_threads.py --all-open --top 20
  python negotiation_threads.py --thread THRD00042 --model api-llama-4-scout
  python negotiation_threads.py --all-open --json
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

_DEFAULT_MODEL = "api-llama-4-scout"
_STALE_DAYS = 7


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    """Load the four seed CSVs needed by this skill."""
    return {
        "logs": pl.read_csv(data_dir / "communication_logs_seed.csv"),
        "threads": pl.read_csv(data_dir / "negotiation_threads_seed.csv"),
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
        "quotes": pl.read_csv(data_dir / "quotes_seed.csv"),
    }


# ---------------------------------------------------------------------------
# Core data functions
# ---------------------------------------------------------------------------


def get_thread_messages(logs: pl.DataFrame, thread_id: str) -> list[dict]:
    """Filter communication logs for a thread and return sorted message dicts.

    Parameters
    ----------
    logs : pl.DataFrame
        Full communication_logs_seed DataFrame.
    thread_id : str
        Thread identifier to filter on (e.g. "THRD00042").

    Returns
    -------
    list[dict]
        Messages sorted by message_date ascending. Each dict contains:
        message_date, direction, channel, notes, quoted_price,
        negotiated_price, negotiation_status.
    """
    if logs.is_empty() or "thread_id" not in logs.columns:
        return []

    subset = logs.filter(pl.col("thread_id") == thread_id)
    if subset.is_empty():
        return []

    # Parse dates for sorting; handle both ISO-8601 with Z and plain date strings
    if subset["message_date"].dtype == pl.Utf8:
        try:
            subset = subset.with_columns(
                pl.col("message_date")
                .str.replace(r"Z$", "")
                .str.to_datetime(format="%Y-%m-%dT%H:%M:%S", strict=False)
                .alias("_dt")
            )
        except Exception:
            subset = subset.with_columns(
                pl.col("message_date")
                .str.to_datetime(strict=False)
                .alias("_dt")
            )
    else:
        subset = subset.with_columns(pl.col("message_date").alias("_dt"))

    subset = subset.sort("_dt")

    keep = [
        "message_date",
        "direction",
        "channel",
        "notes",
        "quoted_price",
        "negotiated_price",
        "negotiation_status",
    ]
    available = [c for c in keep if c in subset.columns]
    return subset.select(available).to_dicts()


def get_thread_metadata(
    threads: pl.DataFrame,
    quotes: pl.DataFrame,
    customers: pl.DataFrame,
    thread_id: str,
    today: dt.date,
) -> dict:
    """Build a metadata dict for a single thread.

    Parameters
    ----------
    threads : pl.DataFrame
        negotiation_threads_seed DataFrame.
    quotes : pl.DataFrame
        quotes_seed DataFrame.
    customers : pl.DataFrame
        customers_seed DataFrame.
    thread_id : str
        Thread to look up.
    today : dt.date
        Reference date for computing days_open / days_since_last_message.

    Returns
    -------
    dict with keys: thread_id, customer_id, stock_id, category_simple,
    status, last_offer, opened_date, last_message_date, days_open,
    days_since_last_message, quote_id, offered_price, customer_offer,
    customer_name, clv_tier, churn_risk_pct.
    """
    if threads.is_empty() or "thread_id" not in threads.columns:
        return {}

    row = threads.filter(pl.col("thread_id") == thread_id)
    if row.is_empty():
        return {}

    r = row.to_dicts()[0]

    # Parse dates
    def _parse_date(val: str | None) -> dt.date | None:
        if not val:
            return None
        try:
            return dt.date.fromisoformat(str(val).replace("Z", "").split("T")[0])
        except ValueError:
            return None

    opened = _parse_date(r.get("opened_date"))
    last_msg = _parse_date(r.get("last_message_date"))

    days_open = (today - opened).days if opened else None
    days_since = (today - last_msg).days if last_msg else None

    # Quote join
    offered_price: float | None = None
    customer_offer: float | None = None
    quote_id = r.get("quote_id") or None
    if quote_id and not quotes.is_empty() and "quote_id" in quotes.columns:
        qrow = quotes.filter(pl.col("quote_id") == quote_id)
        if not qrow.is_empty():
            qd = qrow.to_dicts()[0]
            offered_price = _safe_float(qd.get("offered_price"))
            customer_offer = _safe_float(qd.get("customer_offer"))

    # Customer join
    customer_id = r.get("customer_id", "")
    customer_name: str | None = None
    clv_tier: str | None = None
    churn_risk_pct: float | None = None
    if customer_id and not customers.is_empty() and "customer_id" in customers.columns:
        crow = customers.filter(pl.col("customer_id") == customer_id)
        if not crow.is_empty():
            cd = crow.to_dicts()[0]
            customer_name = cd.get("customer_name")
            clv_tier = cd.get("clv_tier")
            churn_risk_pct = _safe_float(cd.get("churn_risk_pct"))

    return {
        "thread_id": thread_id,
        "customer_id": customer_id,
        "stock_id": r.get("stock_id"),
        "category_simple": r.get("category_simple"),
        "status": r.get("status"),
        "last_offer": _safe_float(r.get("last_offer")),
        "opened_date": opened,
        "last_message_date": last_msg,
        "days_open": days_open,
        "days_since_last_message": days_since,
        "quote_id": quote_id,
        "offered_price": offered_price,
        "customer_offer": customer_offer,
        "customer_name": customer_name,
        "clv_tier": clv_tier,
        "churn_risk_pct": churn_risk_pct,
    }


def get_open_threads(
    threads: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date,
) -> pl.DataFrame:
    """Return all open threads sorted by days_since_last_message descending.

    Parameters
    ----------
    threads : pl.DataFrame
        negotiation_threads_seed DataFrame.
    customers : pl.DataFrame
        customers_seed DataFrame.
    today : dt.date
        Reference date.

    Returns
    -------
    pl.DataFrame with columns: thread_id, customer_id, stock_id, status,
    last_offer, opened_date, last_message_date, days_open,
    days_since_last_message, customer_name, clv_tier.
    Sorted by days_since_last_message descending (most neglected first).
    """
    if threads.is_empty():
        return pl.DataFrame()

    open_threads = threads.filter(pl.col("status") == "Open")
    if open_threads.is_empty():
        return pl.DataFrame()

    # Parse date columns into actual date values for arithmetic
    def _days_since(col: str) -> pl.Expr:
        return (
            pl.lit(today)
            .cast(pl.Date)
            .sub(
                pl.col(col)
                .str.replace(r"Z$", "")
                .str.slice(0, 10)
                .str.to_date(format="%Y-%m-%d", strict=False)
            )
            .dt.total_days()
        )

    open_threads = open_threads.with_columns(
        _days_since("opened_date").alias("days_open"),
        _days_since("last_message_date").alias("days_since_last_message"),
    )

    # Join customer info
    if not customers.is_empty() and "customer_id" in customers.columns:
        cust_cols = ["customer_id"]
        if "customer_name" in customers.columns:
            cust_cols.append("customer_name")
        if "clv_tier" in customers.columns:
            cust_cols.append("clv_tier")
        open_threads = open_threads.join(
            customers.select(cust_cols),
            on="customer_id",
            how="left",
        )

    open_threads = open_threads.sort("days_since_last_message", descending=True)
    return open_threads


# ---------------------------------------------------------------------------
# LLM summarization
# ---------------------------------------------------------------------------


def summarize_thread_with_llm(
    messages: list[dict],
    metadata: dict,
    model: str = _DEFAULT_MODEL,
) -> str:
    """Call the LLM to summarize a thread's notes and recommend next action.

    Parameters
    ----------
    messages : list[dict]
        Output of get_thread_messages().
    metadata : dict
        Output of get_thread_metadata().
    model : str
        LLM model id to use.

    Returns
    -------
    str
        LLM response capped at ~200 words covering: current status,
        key points, and recommended next action.
    """
    try:
        from dotenv import load_dotenv

        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    thread_id = metadata.get("thread_id", "unknown")
    customer_id = metadata.get("customer_id", "unknown")
    customer_name = metadata.get("customer_name") or customer_id
    stock_id = metadata.get("stock_id", "unknown")
    clv_tier = metadata.get("clv_tier") or "unknown"
    days_open = metadata.get("days_open")
    days_since = metadata.get("days_since_last_message")
    last_offer = metadata.get("last_offer")
    offered_price = metadata.get("offered_price")

    header_lines = [
        f"Thread: {thread_id}",
        f"Customer: {customer_name} ({customer_id}), CLV tier: {clv_tier}",
        f"Stone: {stock_id}",
        f"Days open: {days_open}",
        f"Days since last message: {days_since}",
    ]
    if last_offer:
        header_lines.append(f"Customer's last offer: ${last_offer:,.2f}")
    if offered_price:
        header_lines.append(f"Our offered price: ${offered_price:,.2f}")

    message_lines = []
    for i, m in enumerate(messages, 1):
        date_str = str(m.get("message_date", ""))[:10]
        direction = (m.get("direction") or "").lower()
        channel = (m.get("channel") or "").lower()
        notes = m.get("notes") or "(no notes)"
        message_lines.append(f"  {i}. [{date_str}] [{direction}/{channel}] {notes}")

    prompt = (
        "You are a sales assistant for Pramukh Gems, a lab-grown diamond wholesaler.\n\n"
        "Below is the metadata and message history for a negotiation thread. "
        "Read the notes carefully — they are free-text written by sales reps after each interaction.\n\n"
        "--- THREAD METADATA ---\n"
        + "\n".join(header_lines)
        + "\n\n--- MESSAGE HISTORY (chronological) ---\n"
        + "\n".join(message_lines)
        + "\n\n"
        "Write a concise summary (max 200 words) with exactly three sections:\n"
        "1. Current status (1 sentence)\n"
        "2. Key points from the negotiation (2–3 bullet points, each starting with •)\n"
        "3. Recommended next action (1 sentence starting with a verb)\n\n"
        "Be specific, reference the notes directly. Do not add preamble or section headers beyond the numbers."
    )

    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_thread_header(metadata: dict) -> str:
    """Format the one-line header for a thread.

    Returns a string like:
    Thread THRD00042 — CUST0013 (Blue Star Jewels, Diamond) / LGSTK00115
    Status: Open | Opened: 2026-03-15 (50 days ago) | Last activity: 12 days ago
    Last offer: $280 | Our price: $315 | Quote: QTE00001
    """
    thread_id = metadata.get("thread_id", "unknown")
    customer_id = metadata.get("customer_id", "unknown")
    customer_name = metadata.get("customer_name") or ""
    clv_tier = metadata.get("clv_tier") or ""
    stock_id = metadata.get("stock_id") or "unknown"
    status = metadata.get("status") or "unknown"
    opened = metadata.get("opened_date")
    days_open = metadata.get("days_open")
    days_since = metadata.get("days_since_last_message")
    last_offer = metadata.get("last_offer")
    offered_price = metadata.get("offered_price")
    quote_id = metadata.get("quote_id")

    # Line 1
    cust_label_parts = [customer_id]
    if customer_name:
        tier_part = f", {clv_tier}" if clv_tier else ""
        cust_label_parts.append(f"({customer_name}{tier_part})")
    cust_label = " ".join(cust_label_parts)
    line1 = f"Thread {thread_id} — {cust_label} / {stock_id}"

    # Line 2
    opened_str = str(opened) if opened else "unknown"
    days_open_str = f" ({days_open} days ago)" if days_open is not None else ""
    days_since_str = f"{days_since} days ago" if days_since is not None else "unknown"
    line2 = (
        f"Status: {status} | Opened: {opened_str}{days_open_str} | "
        f"Last activity: {days_since_str}"
    )

    # Line 3
    parts3 = []
    if last_offer is not None:
        parts3.append(f"Last offer: ${last_offer:,.0f}")
    if offered_price is not None:
        parts3.append(f"Our price: ${offered_price:,.0f}")
    if quote_id:
        parts3.append(f"Quote: {quote_id}")
    line3 = " | ".join(parts3) if parts3 else ""

    lines = [line1, line2]
    if line3:
        lines.append(line3)
    return "\n".join(lines)


def format_messages(messages: list[dict]) -> str:
    """Format a message list as an indented block."""
    if not messages:
        return "  (no messages found)"
    lines = [f"Messages ({len(messages)}):"]
    for m in messages:
        date_str = str(m.get("message_date", ""))[:10]
        direction = (m.get("direction") or "").lower()
        channel = (m.get("channel") or "").lower()
        notes = m.get("notes") or "(no notes)"
        lines.append(f"  {date_str} [{direction}/{channel}] {notes}")
    return "\n".join(lines)


def format_open_threads_table(df: pl.DataFrame, top: int = 20) -> str:
    """Format the batch open-threads output."""
    if df.is_empty():
        return "_(no open negotiation threads)_"

    total = len(df)
    df_top = df.head(top)

    # Summary stats
    days_open_col = "days_open"
    stale_count = 0
    avg_days = 0
    if days_open_col in df.columns:
        valid = df[days_open_col].drop_nulls()
        avg_days = int(valid.mean()) if len(valid) > 0 else 0
    if "days_since_last_message" in df.columns:
        stale_count = int(
            (df["days_since_last_message"].drop_nulls() >= _STALE_DAYS).sum()
        )

    header_line = (
        f"{total} open negotiation threads — "
        f"avg {avg_days} days open, "
        f"{stale_count} neglected {_STALE_DAYS}+ days"
    )

    # Table
    table_rows = [
        "| Thread | Customer | Tier | Stock | Days Open | Last Activity | Last Offer | Status |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in df_top.to_dicts():
        thread_id = row.get("thread_id", "")
        customer_id = row.get("customer_id", "")
        customer_name = row.get("customer_name") or customer_id
        # Truncate long names
        short_name = customer_name[:12] + "…" if len(str(customer_name)) > 13 else customer_name
        tier = row.get("clv_tier") or "—"
        stock_id = row.get("stock_id") or "—"
        days_open = row.get("days_open")
        days_since = row.get("days_since_last_message")
        last_offer = row.get("last_offer")
        status = row.get("status") or "Open"

        days_open_str = str(days_open) if days_open is not None else "—"
        days_since_str = f"{days_since}d ago" if days_since is not None else "—"
        last_offer_str = f"${last_offer:,.0f}" if last_offer is not None else "—"

        table_rows.append(
            f"| {thread_id} | {short_name} | {tier} | {stock_id} "
            f"| {days_open_str} | {days_since_str} | {last_offer_str} | {status} |"
        )

    return header_line + "\n\n" + "\n".join(table_rows)


# ---------------------------------------------------------------------------
# Single-thread rendering
# ---------------------------------------------------------------------------


def render_single_thread(
    logs: pl.DataFrame,
    threads: pl.DataFrame,
    quotes: pl.DataFrame,
    customers: pl.DataFrame,
    thread_id: str,
    today: dt.date,
    model: str | None = None,
    as_json: bool = False,
) -> tuple[int, str]:
    """Render one thread; return (exit_code, output_string)."""
    metadata = get_thread_metadata(threads, quotes, customers, thread_id, today)
    if not metadata:
        return 1, f"Thread {thread_id!r} not found."

    messages = get_thread_messages(logs, thread_id)

    if as_json:
        payload = {
            "metadata": {
                k: str(v) if isinstance(v, dt.date) else v
                for k, v in metadata.items()
            },
            "messages": messages,
        }
        return 0, json.dumps(payload, default=str)

    parts = [
        format_thread_header(metadata),
        "",
        format_messages(messages),
    ]

    if model:
        summary = summarize_thread_with_llm(messages, metadata, model=model)
        parts += ["", "--- LLM Summary ---", summary]

    return 0, "\n".join(parts)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return None if f != f else f  # guard NaN
    except (TypeError, ValueError):
        return None


def _threads_for_customer(threads: pl.DataFrame, customer_id: str) -> list[str]:
    if threads.is_empty() or "customer_id" not in threads.columns:
        return []
    rows = threads.filter(pl.col("customer_id") == customer_id)
    return rows["thread_id"].to_list()


def _thread_for_stock(threads: pl.DataFrame, stock_id: str) -> str | None:
    if threads.is_empty() or "stock_id" not in threads.columns:
        return None
    rows = threads.filter(pl.col("stock_id") == stock_id)
    if rows.is_empty():
        return None
    return rows["thread_id"][0]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Negotiation thread summarizer for a lab-grown diamond wholesaler."
    )
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--thread", metavar="THREAD_ID", help="Single thread by ID.")
    mode.add_argument("--customer", metavar="CUST_ID", help="All threads for a customer.")
    mode.add_argument("--stock", metavar="STOCK_ID", help="Thread for a specific stone.")
    mode.add_argument("--all-open", action="store_true", help="All open threads.")

    p.add_argument(
        "--model",
        default=None,
        metavar="MODEL",
        help="LLM model for summarization (e.g. api-llama-4-scout).",
    )
    p.add_argument(
        "--top",
        type=int,
        default=20,
        metavar="N",
        help="Max threads to show in batch mode (default 20).",
    )
    p.add_argument(
        "--today",
        type=lambda s: dt.date.fromisoformat(s),
        default=None,
        metavar="YYYY-MM-DD",
        help="Override today's date for reproducibility.",
    )
    p.add_argument("--json", action="store_true", help="Output as JSON.")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    today = args.today or dt.date.today()

    csvs = load_csvs(args.data_dir)
    logs = csvs["logs"]
    threads = csvs["threads"]
    quotes = csvs["quotes"]
    customers = csvs["customers"]

    # ── Single thread ─────────────────────────────────────────────────────
    if args.thread:
        code, text = render_single_thread(
            logs, threads, quotes, customers,
            args.thread, today,
            model=args.model,
            as_json=args.json,
        )
        print(text)
        return code

    # ── Customer mode: show all threads for this customer ─────────────────
    if args.customer:
        thread_ids = _threads_for_customer(threads, args.customer)
        if not thread_ids:
            print(f"No threads found for customer {args.customer!r}.", file=sys.stderr)
            return 1
        if args.json:
            all_payloads = []
            for tid in thread_ids:
                metadata = get_thread_metadata(threads, quotes, customers, tid, today)
                messages = get_thread_messages(logs, tid)
                all_payloads.append({
                    "metadata": {
                        k: str(v) if isinstance(v, dt.date) else v
                        for k, v in metadata.items()
                    },
                    "messages": messages,
                })
            print(json.dumps(all_payloads, default=str))
            return 0
        for i, tid in enumerate(thread_ids):
            if i > 0:
                print()
            code, text = render_single_thread(
                logs, threads, quotes, customers,
                tid, today,
                model=args.model,
            )
            print(text)
        return 0

    # ── Stock mode: find thread for this stone ────────────────────────────
    if args.stock:
        tid = _thread_for_stock(threads, args.stock)
        if not tid:
            print(f"No thread found for stock {args.stock!r}.", file=sys.stderr)
            return 1
        code, text = render_single_thread(
            logs, threads, quotes, customers,
            tid, today,
            model=args.model,
            as_json=args.json,
        )
        print(text)
        return code

    # ── All-open batch mode ───────────────────────────────────────────────
    open_df = get_open_threads(threads, customers, today)

    if args.json:
        # Return top N as list of dicts
        rows = open_df.head(args.top).to_dicts()
        # Convert date objects to strings
        print(json.dumps(rows, default=str))
        return 0

    print(format_open_threads_table(open_df, top=args.top))

    if args.model and not open_df.is_empty():
        print()
        top_threads = open_df.head(args.top)["thread_id"].to_list()
        for tid in top_threads:
            metadata = get_thread_metadata(threads, quotes, customers, tid, today)
            messages = get_thread_messages(logs, tid)
            print(format_thread_header(metadata))
            print(format_messages(messages))
            summary = summarize_thread_with_llm(messages, metadata, model=args.model)
            print()
            print("--- LLM Summary ---")
            print(summary)
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
