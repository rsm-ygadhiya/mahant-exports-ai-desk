"""Inventory aging & clearance triage.

Pure polars. No LLM in the math path — the orchestration (which flags to set,
how to present results) lives in `../SKILL.md`.

Public API:
- `triage_inventory(...)` → polars DataFrame with one row per available stone,
  tagged HOLD/WATCH/DISCOUNT/CLEAR with a suggested_price_move_pct and reason.
- `summarize_triage(...)` → optional LLM narration of the result.

CLI:
- `python inventory_aging_skill.py [--age-min N] [--filter-tag TAG]
   [--category-contains STR] [--top N] [--today YYYY-MM-DD] [--model M]
   [--json] [--data-dir PATH]`
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Iterable

import polars as pl

# Repo root, so utils.connect can be imported when run as `python <path>`.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Default location of the Milestone_2 CSVs relative to repo root.
_DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"

# Tag ordering, used to sort the output (most urgent first).
_TAG_PRIORITY = {"CLEAR": 0, "DISCOUNT": 1, "WATCH": 2, "HOLD": 3}

# Allowed tag set — used as a soft enum elsewhere.
ACTION_TAGS = ("HOLD", "WATCH", "DISCOUNT", "CLEAR")


# ----------------------------------------------------------------------------
# Pure-data scoring functions (testable in isolation)
# ----------------------------------------------------------------------------


def classify_stone(
    age_days: int,
    demand_score: float,
    velocity: int,
    inquiries: int,
) -> tuple[str, float, str]:
    """Return ``(action_tag, suggested_price_move_pct, reason)`` for one stone.

    Rules — in priority order:

    1. age < 30 → HOLD ("young — leave alone").
    2. age 30–89 →
        - high demand OR velocity ≥ 2: HOLD.
        - everything else: WATCH.
    3. age 90–179 →
        - high demand: WATCH (still hot, just unlucky).
        - mid demand: DISCOUNT 7%.
        - low demand: DISCOUNT 12%.
    4. age ≥ 180 →
        - high demand: DISCOUNT 10%.
        - mid demand AND any inquiries: DISCOUNT 15%.
        - mid demand AND no inquiries: CLEAR 22%.
        - low demand: CLEAR 28%.

    Thresholds: ``demand_score`` "high" ≥ 0.60, "mid" ≥ 0.40, else "low".
    ``velocity`` is sales count in the same category over the last
    ``velocity_window_days`` (defaults applied at the wrapper level).
    """
    # Bucket demand
    if demand_score >= 0.60:
        demand_bucket = "high"
    elif demand_score >= 0.40:
        demand_bucket = "mid"
    else:
        demand_bucket = "low"

    # Young
    if age_days < 30:
        return ("HOLD", 0.0, "Young — leave alone (<30 days in stock).")

    # Mid-age
    if age_days < 90:
        if demand_bucket == "high" or velocity >= 2:
            return (
                "HOLD",
                0.0,
                f"Mid-age but active category (demand {demand_score:.2f}, "
                f"{velocity} recent sales).",
            )
        return (
            "WATCH",
            0.0,
            f"Mid-age, soft signals (demand {demand_score:.2f}, "
            f"{velocity} recent sales) — monitor.",
        )

    # Old
    if age_days < 180:
        if demand_bucket == "high":
            return (
                "WATCH",
                0.0,
                f"Aging ({age_days} days) but category still hot "
                f"(demand {demand_score:.2f}) — monitor.",
            )
        if demand_bucket == "mid":
            return (
                "DISCOUNT",
                7.0,
                f"Aging ({age_days} days), demand cooling ({demand_score:.2f}) — "
                f"trim ~7% to capture remaining interest.",
            )
        return (
            "DISCOUNT",
            12.0,
            f"Aging ({age_days} days) and weak demand ({demand_score:.2f}) — "
            f"drop ~12% to move it.",
        )

    # Very old (≥180)
    if demand_bucket == "high":
        return (
            "DISCOUNT",
            10.0,
            f"Very old ({age_days} days) but category still active "
            f"(demand {demand_score:.2f}) — drop ~10%.",
        )
    if demand_bucket == "mid":
        if inquiries > 0:
            return (
                "DISCOUNT",
                15.0,
                f"Very old ({age_days} days), mid demand "
                f"({demand_score:.2f}), {inquiries} active inquiries — "
                f"drop ~15% to close.",
            )
        return (
            "CLEAR",
            22.0,
            f"Very old ({age_days} days), mid demand ({demand_score:.2f}), "
            f"no recent inquiries — clear at ~22% off.",
        )
    return (
        "CLEAR",
        28.0,
        f"Very old ({age_days} days) and weak demand "
        f"({demand_score:.2f}) — clear aggressively (~28% off).",
    )


# ----------------------------------------------------------------------------
# Aggregation pipeline
# ----------------------------------------------------------------------------


def _category_velocity(
    sales: pl.DataFrame, today: dt.date, window_days: int
) -> pl.DataFrame:
    """Sales count per category in the trailing ``window_days`` ending at ``today``."""
    cutoff = today - dt.timedelta(days=window_days)
    return (
        sales.with_columns(pl.col("transaction_date").str.to_date())
        .filter(pl.col("transaction_date") >= cutoff)
        .group_by("category_simple")
        .agg(pl.len().alias("velocity"))
    )


def _category_demand(
    demand: pl.DataFrame, today: dt.date, window_days: int
) -> pl.DataFrame:
    """Mean demand_score per category in the trailing ``window_days``."""
    cutoff = today - dt.timedelta(days=window_days)
    return (
        demand.with_columns(pl.col("signal_date").str.to_date())
        .filter(pl.col("signal_date") >= cutoff)
        .group_by("category_simple")
        .agg(pl.col("demand_score").mean().alias("demand_score"))
    )


def _category_inquiries(
    comms: pl.DataFrame, today: dt.date, window_days: int
) -> pl.DataFrame:
    """Open/Negotiating message count per category in the trailing ``window_days``.

    Communication logs may have either ``message_date`` as an ISO datetime
    string or a plain date — handle both.
    """
    cutoff = today - dt.timedelta(days=window_days)
    open_statuses = ("Open", "Negotiating", "Inquiry", "Follow-Up")
    return (
        comms.with_columns(
            pl.col("message_date").cast(pl.Utf8).str.slice(0, 10).str.to_date()
        )
        .filter(pl.col("message_date") >= cutoff)
        .filter(pl.col("negotiation_status").is_in(open_statuses))
        .group_by("category_simple")
        .agg(pl.len().alias("inquiries"))
    )


def triage_inventory(
    inventory: pl.DataFrame,
    sales: pl.DataFrame,
    demand: pl.DataFrame,
    comms: pl.DataFrame,
    today: dt.date | None = None,
    velocity_window_days: int = 60,
    demand_window_days: int = 60,
    inquiry_window_days: int = 30,
) -> pl.DataFrame:
    """Tag every Available stone HOLD / WATCH / DISCOUNT / CLEAR.

    Returns a DataFrame with one row per available stone:
      stock_id, age_in_stock_days, category_simple, list_price,
      demand_score, velocity, inquiries, action_tag,
      suggested_price_move_pct, reason.
    Rows are sorted by tag urgency (CLEAR first), then by age desc.
    """
    if today is None:
        today = dt.date.today()

    available = inventory.filter(pl.col("status") == "Available")

    velocity = _category_velocity(sales, today, velocity_window_days)
    demand_score = _category_demand(demand, today, demand_window_days)
    inquiries = _category_inquiries(comms, today, inquiry_window_days)

    enriched = (
        available.select(
            "stock_id",
            "age_in_stock_days",
            "category_simple",
            pl.col("p_pcs").alias("list_price"),
        )
        .join(demand_score, on="category_simple", how="left")
        .join(velocity, on="category_simple", how="left")
        .join(inquiries, on="category_simple", how="left")
        .with_columns(
            pl.col("demand_score").fill_null(0.0),
            pl.col("velocity").fill_null(0).cast(pl.Int64),
            pl.col("inquiries").fill_null(0).cast(pl.Int64),
        )
    )

    # Apply the rules row-by-row. Polars doesn't have a clean apply-many here
    # so we materialize tuples in pure Python — the ~1k row scale is fine.
    rows = enriched.to_dicts()
    tagged: list[dict] = []
    for r in rows:
        tag, move_pct, reason = classify_stone(
            age_days=int(r["age_in_stock_days"]),
            demand_score=float(r["demand_score"]),
            velocity=int(r["velocity"]),
            inquiries=int(r["inquiries"]),
        )
        tagged.append(
            {
                **r,
                "action_tag": tag,
                "suggested_price_move_pct": move_pct,
                "reason": reason,
            }
        )

    out = pl.DataFrame(tagged) if tagged else _empty_result()
    return out.with_columns(
        pl.col("action_tag")
        .replace_strict(_TAG_PRIORITY, return_dtype=pl.Int64)
        .alias("_priority")
    ).sort(["_priority", "age_in_stock_days"], descending=[False, True]).drop(
        "_priority"
    )


def _empty_result() -> pl.DataFrame:
    return pl.DataFrame(
        schema={
            "stock_id": pl.Utf8,
            "age_in_stock_days": pl.Int64,
            "category_simple": pl.Utf8,
            "list_price": pl.Float64,
            "demand_score": pl.Float64,
            "velocity": pl.Int64,
            "inquiries": pl.Int64,
            "action_tag": pl.Utf8,
            "suggested_price_move_pct": pl.Float64,
            "reason": pl.Utf8,
        }
    )


# ----------------------------------------------------------------------------
# Counts + presentation helpers
# ----------------------------------------------------------------------------


def aggregate_counts(triaged: pl.DataFrame) -> dict[str, int]:
    """Counts per action tag. Always includes all four keys."""
    counts = {tag: 0 for tag in ACTION_TAGS}
    if triaged.is_empty():
        return counts
    grouped = triaged.group_by("action_tag").agg(pl.len().alias("count"))
    for row in grouped.iter_rows(named=True):
        counts[row["action_tag"]] = int(row["count"])
    return counts


def header_line(triaged: pl.DataFrame) -> str:
    counts = aggregate_counts(triaged)
    total = len(triaged)
    return (
        f"{total} available stones — "
        f"CLEAR: {counts['CLEAR']} | "
        f"DISCOUNT: {counts['DISCOUNT']} | "
        f"WATCH: {counts['WATCH']} | "
        f"HOLD: {counts['HOLD']}"
    )


def format_table(triaged: pl.DataFrame, top: int = 20) -> str:
    """Pretty-print the top-N rows as a markdown table."""
    if triaged.is_empty():
        return "_(no available stones to triage)_"
    cols = [
        "stock_id",
        "age_in_stock_days",
        "category_simple",
        "list_price",
        "action_tag",
        "suggested_price_move_pct",
        "reason",
    ]
    head = triaged.head(top).select(cols)
    headers = [
        "Stock",
        "Days",
        "Category",
        "Price",
        "Tag",
        "Move %",
        "Reason",
    ]
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for row in head.iter_rows(named=True):
        lines.append(
            "| "
            + " | ".join(
                [
                    row["stock_id"],
                    str(row["age_in_stock_days"]),
                    row["category_simple"],
                    f"${row['list_price']:,.0f}",
                    row["action_tag"],
                    f"{row['suggested_price_move_pct']:.1f}%",
                    row["reason"],
                ]
            )
            + " |"
        )
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# LLM narration (optional)
# ----------------------------------------------------------------------------


def summarize_triage(
    triaged: pl.DataFrame, model: str = "api-llama-4-scout"
) -> str:
    """Ask an LLM to write a 2–3 sentence executive summary of the triage."""
    try:
        from dotenv import load_dotenv

        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    counts = aggregate_counts(triaged)
    top_clear_count = counts["CLEAR"]
    top_discount_count = counts["DISCOUNT"]
    sample = triaged.head(10).select(
        ["stock_id", "age_in_stock_days", "action_tag", "suggested_price_move_pct"]
    )
    sample_json = json.dumps(sample.to_dicts())

    prompt = (
        "You are summarizing a weekly inventory aging triage for a lab-grown "
        "diamond wholesaler.\n\n"
        f"Counts: {json.dumps(counts)}.\n"
        f"Total available stones: {len(triaged)}.\n"
        f"Top 10 most urgent rows: {sample_json}.\n\n"
        "Write 2–3 sentences for the desk: how concentrated is the action this "
        f"week (CLEAR={top_clear_count}, DISCOUNT={top_discount_count}), what "
        "categories are over-represented if any, and the one thing the desk "
        "should do first. No preamble, no bullet points."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ----------------------------------------------------------------------------
# CSV loading
# ----------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    """Load the four CSVs the triage needs from ``data_dir``."""
    return {
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "sales": pl.read_csv(data_dir / "sales_transactions_seed.csv"),
        "demand": pl.read_csv(data_dir / "demand_signals_seed.csv"),
        "comms": pl.read_csv(data_dir / "communication_logs_seed.csv"),
    }


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Tag every available stone HOLD / WATCH / DISCOUNT / CLEAR with a "
            "suggested price move."
        )
    )
    p.add_argument(
        "--data-dir",
        type=Path,
        default=_DEFAULT_DATA_DIR,
        help="Folder containing the *_seed.csv files. Default: data/Milestone_2/",
    )
    p.add_argument("--top", type=int, default=20, help="Rows to print (default 20).")
    p.add_argument(
        "--age-min",
        type=int,
        default=None,
        help="Filter to stones older than this many days.",
    )
    p.add_argument(
        "--filter-tag",
        choices=list(ACTION_TAGS),
        default=None,
        help="Filter to one tag.",
    )
    p.add_argument(
        "--category-contains",
        default=None,
        help="Substring filter on category_simple (case-insensitive).",
    )
    p.add_argument(
        "--today",
        type=lambda s: dt.date.fromisoformat(s),
        default=None,
        help="Override 'today' for reproducible runs (YYYY-MM-DD).",
    )
    p.add_argument(
        "--model",
        default=None,
        help="If set, also ask this model to narrate the result via utils.connect.ask.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit the full triaged frame as JSON instead of a table.",
    )
    return p


def _apply_filters(
    triaged: pl.DataFrame,
    age_min: int | None,
    filter_tag: str | None,
    category_contains: str | None,
) -> pl.DataFrame:
    out = triaged
    if age_min is not None:
        out = out.filter(pl.col("age_in_stock_days") >= age_min)
    if filter_tag is not None:
        out = out.filter(pl.col("action_tag") == filter_tag)
    if category_contains is not None:
        needle = category_contains.lower()
        out = out.filter(pl.col("category_simple").str.to_lowercase().str.contains(needle))
    return out


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    triaged = triage_inventory(
        inventory=csvs["inventory"],
        sales=csvs["sales"],
        demand=csvs["demand"],
        comms=csvs["comms"],
        today=args.today,
    )
    filtered = _apply_filters(
        triaged,
        age_min=args.age_min,
        filter_tag=args.filter_tag,
        category_contains=args.category_contains,
    )

    if args.json:
        print(json.dumps(filtered.head(args.top).to_dicts(), default=str))
        return 0

    print(header_line(filtered))
    print()
    print(format_table(filtered, top=args.top))
    if args.model:
        print()
        print(summarize_triage(filtered, model=args.model))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
