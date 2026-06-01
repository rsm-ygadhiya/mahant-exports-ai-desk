"""Demand Forecast & Sourcing Advisor — Skill 7.

Pure polars. Compares available inventory against forecast demand to surface
sourcing gaps.  LLM narration is optional (``--model``).

Public API:
- ``compute_coverage(inventory, forecast, today)`` → DataFrame:
      category_simple, available_count, recommended_sourcing_qty,
      coverage_ratio, gap
- ``score_gaps(coverage, demand_signals, forecast, today)`` → DataFrame:
      adds demand_score, growth_rate_pct, confidence_score, priority_score
- ``format_table(gaps, top)`` → markdown table string
- ``coverage_summary(gaps)`` → one-line coverage summary string
- ``narrate_gaps(gaps, model)`` → LLM bullet recommendations string

CLI:
    uv run python skills/demand-forecast/scripts/demand_forecast.py
    [--top N] [--min-confidence FLOAT] [--model MODEL]
    [--chart-out PATH] [--today YYYY-MM-DD] [--data-dir PATH]
    [--json] [--category-contains STR]
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

DEFAULT_TOP = 15
DEFAULT_MIN_CONFIDENCE = 0.0
DEFAULT_DEMAND_WINDOW = 60
DEFAULT_MODEL = "api-llama-4-scout"


# ---------------------------------------------------------------------------
# Core analytics
# ---------------------------------------------------------------------------


def compute_coverage(
    inventory: pl.DataFrame,
    forecast: pl.DataFrame,
    today: dt.date,
) -> pl.DataFrame:
    """Compare available stone counts against forecast recommendations.

    Steps:
    1. Count stones with status == "Available" per category_simple.
    2. Join with the most recent forecast record per category.
    3. Compute coverage_ratio and gap.

    Returns columns:
        category_simple, available_count, recommended_sourcing_qty,
        coverage_ratio, gap
    """
    # Step 1: available stone counts
    available_counts = (
        inventory.filter(pl.col("status") == "Available")
        .group_by("category_simple")
        .agg(pl.len().cast(pl.Int64).alias("available_count"))
    )

    # Step 2: latest forecast record per category
    latest_forecast = (
        forecast.with_columns(pl.col("forecast_date").str.to_date())
        .sort("forecast_date", descending=True)
        .unique(subset=["category_simple"], keep="first")
        .select(
            [
                "category_simple",
                "recommended_sourcing_qty",
                "growth_rate_pct",
                "confidence_score",
            ]
        )
        .with_columns(
            pl.col("recommended_sourcing_qty").cast(pl.Int64),
        )
    )

    # Step 3: join and compute ratios
    coverage = (
        latest_forecast.join(available_counts, on="category_simple", how="left")
        .with_columns(pl.col("available_count").fill_null(0).cast(pl.Int64))
        .with_columns(
            pl.when(pl.col("recommended_sourcing_qty") > 0)
            .then(
                pl.col("available_count").cast(pl.Float64)
                / pl.col("recommended_sourcing_qty").cast(pl.Float64)
            )
            .otherwise(pl.lit(0.0))
            .alias("coverage_ratio"),
            (
                (pl.col("recommended_sourcing_qty") - pl.col("available_count")).clip(
                    lower_bound=0
                )
            ).alias("gap"),
        )
        .select(
            [
                "category_simple",
                "available_count",
                "recommended_sourcing_qty",
                "coverage_ratio",
                "gap",
                "growth_rate_pct",
                "confidence_score",
            ]
        )
    )

    return coverage


def score_gaps(
    coverage: pl.DataFrame,
    demand_signals: pl.DataFrame,
    today: dt.date,
    demand_window_days: int = DEFAULT_DEMAND_WINDOW,
) -> pl.DataFrame:
    """Score each category gap by demand urgency.

    Steps:
    1. Average demand_score per category over last ``demand_window_days``.
    2. Join with coverage DataFrame.
    3. Compute priority_score = gap * demand_score.
    4. Sort by priority_score descending.

    Returns columns:
        category_simple, available_count, recommended_sourcing_qty,
        coverage_ratio, gap, demand_score, growth_rate_pct,
        confidence_score, priority_score
    """
    cutoff = today - dt.timedelta(days=demand_window_days)

    demand_agg = (
        demand_signals.with_columns(pl.col("signal_date").str.to_date())
        .filter(pl.col("signal_date") >= cutoff)
        .group_by("category_simple")
        .agg(pl.col("demand_score").mean().alias("demand_score"))
    )

    scored = (
        coverage.join(demand_agg, on="category_simple", how="left")
        .with_columns(pl.col("demand_score").fill_null(0.5))
        .with_columns(
            (pl.col("gap").cast(pl.Float64) * pl.col("demand_score")).alias(
                "priority_score"
            )
        )
        .sort("priority_score", descending=True)
    )

    return scored


def format_table(gaps: pl.DataFrame, top: int = DEFAULT_TOP) -> str:
    """Render the top-N gap rows as a markdown table.

    Returns a string with headers and pipe-delimited rows.
    Always includes columns: Available, Recommended, Gap, Demand, Growth %, Priority.
    """
    if gaps.is_empty():
        return "_(no sourcing gaps found)_"

    head = gaps.head(top)
    headers = [
        "Category",
        "Available",
        "Recommended",
        "Gap",
        "Demand",
        "Growth %",
        "Priority",
    ]
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for row in head.iter_rows(named=True):
        priority_score = row.get("priority_score", 0.0) or 0.0
        priority_label = (
            "HIGH" if priority_score >= 5.0 else "MED" if priority_score >= 1.0 else "LOW"
        )
        growth_pct = row.get("growth_rate_pct", 0.0) or 0.0
        demand_score = row.get("demand_score", 0.5) or 0.5
        lines.append(
            "| "
            + " | ".join(
                [
                    str(row["category_simple"]),
                    str(row["available_count"]),
                    str(row["recommended_sourcing_qty"]),
                    str(row["gap"]),
                    f"{demand_score:.2f}",
                    f"{growth_pct:+.1f}%",
                    priority_label,
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def coverage_summary(gaps: pl.DataFrame) -> str:
    """One-line coverage summary: fully covered / understocked / overstocked counts."""
    if gaps.is_empty():
        return "Coverage summary: no forecast data available."

    fully = int((gaps["gap"] == 0).sum())
    understocked = int((gaps["gap"] > 0).sum())
    overstocked = int(
        (
            (gaps["gap"] == 0) & (gaps["available_count"] > gaps["recommended_sourcing_qty"])
        ).sum()
    )
    return (
        f"Coverage summary: {fully} categories fully covered | "
        f"{understocked} understocked | {overstocked} overstocked"
    )


# ---------------------------------------------------------------------------
# Chart helpers (plotnine)
# ---------------------------------------------------------------------------


def _make_coverage_chart(gaps: pl.DataFrame, chart_path: str) -> None:
    """Horizontal bar chart — available vs recommended, ordered by gap desc."""
    from plotnine import (
        aes,
        coord_flip,
        element_text,
        geom_col,
        ggplot,
        labs,
        scale_fill_manual,
        theme,
        theme_minimal,
    )

    top15 = gaps.sort("gap", descending=True).head(15)

    # Build long-form data for overlapping bars
    avail_rows = [
        {
            "category_simple": r["category_simple"],
            "count": float(r["available_count"]),
            "type": "Available",
            "gap": float(r["gap"]),
        }
        for r in top15.iter_rows(named=True)
    ]
    rec_rows = [
        {
            "category_simple": r["category_simple"],
            "count": float(r["recommended_sourcing_qty"]),
            "type": "Recommended",
            "gap": float(r["gap"]),
        }
        for r in top15.iter_rows(named=True)
    ]
    long_df = pl.DataFrame(avail_rows + rec_rows)

    # Order categories by gap descending so largest gap is at top
    cat_order = top15.sort("gap", descending=False)["category_simple"].to_list()

    import pandas as pd

    pdf = long_df.to_pandas()
    pdf["category_simple"] = pd.Categorical(
        pdf["category_simple"], categories=cat_order, ordered=True
    )

    p = (
        ggplot(pdf, aes(x="category_simple", y="count", fill="type", alpha="type"))
        + geom_col(position="identity")
        + coord_flip()
        + scale_fill_manual(values={"Available": "#4472C4", "Recommended": "#FF0000"})
        + labs(
            title="Inventory Coverage vs Forecast Demand",
            x="Category",
            y="Stone Count",
            fill="",
            alpha="",
        )
        + theme_minimal()
        + theme(
            axis_text_y=element_text(size=7),
            figure_size=(10, 7),
        )
    )
    p.save(chart_path)


def _make_demand_chart(gaps: pl.DataFrame, chart_path: str) -> None:
    """Scatter plot — coverage ratio vs demand score, sized by gap, colored by growth bucket."""
    from plotnine import (
        aes,
        element_text,
        geom_point,
        ggplot,
        labs,
        scale_color_manual,
        theme,
        theme_minimal,
    )

    scored = gaps.filter(pl.col("demand_score").is_not_null())

    def _growth_bucket(g: float) -> str:
        if g < -2.0:
            return "shrinking"
        if g > 2.0:
            return "growing"
        return "flat"

    plot_rows = [
        {
            "category_simple": r["category_simple"],
            "coverage_ratio": float(r["coverage_ratio"]),
            "demand_score": float(r.get("demand_score", 0.5) or 0.5),
            "gap": max(float(r["gap"]), 0.1),  # keep 0-gap points visible
            "growth_bucket": _growth_bucket(float(r.get("growth_rate_pct", 0.0) or 0.0)),
        }
        for r in scored.iter_rows(named=True)
    ]

    pdf = pl.DataFrame(plot_rows).to_pandas()

    p = (
        ggplot(pdf, aes(x="coverage_ratio", y="demand_score", size="gap", color="growth_bucket"))
        + geom_point(alpha=0.7)
        + scale_color_manual(
            values={"shrinking": "#d73027", "flat": "#fee090", "growing": "#1a9850"}
        )
        + labs(
            title="Coverage vs Demand Score by Category",
            x="Coverage Ratio (available / recommended)",
            y="Demand Score (60d avg)",
            size="Gap",
            color="Growth",
        )
        + theme_minimal()
        + theme(
            axis_text=element_text(size=9),
            figure_size=(8, 6),
        )
    )
    p.save(chart_path)


def save_charts(gaps: pl.DataFrame, base_path: str) -> None:
    """Save coverage and demand charts using ``base_path`` as the file prefix."""
    _make_coverage_chart(gaps, f"{base_path}_coverage.png")
    _make_demand_chart(gaps, f"{base_path}_demand.png")


# ---------------------------------------------------------------------------
# LLM narration
# ---------------------------------------------------------------------------


def narrate_gaps(gaps: pl.DataFrame, model: str = DEFAULT_MODEL) -> str:
    """Ask an LLM to write 3–5 bullet sourcing recommendations from the top gaps."""
    try:
        from dotenv import load_dotenv

        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    top5 = gaps.head(5)
    data = top5.select(
        [
            "category_simple",
            "available_count",
            "recommended_sourcing_qty",
            "gap",
            "demand_score",
            "growth_rate_pct",
            "priority_score",
        ]
    ).to_dicts()

    prompt = (
        "You are a sourcing advisor for a lab-grown diamond wholesaler.\n\n"
        "Here are the top 5 sourcing gap categories (demand forecast vs current inventory):\n"
        f"{json.dumps(data, default=str)}\n\n"
        "Write 3–5 concise bullet point sourcing recommendations. "
        "Each bullet must: name the category, state the gap number (stones needed), "
        "and give a one-line rationale referencing demand score or growth rate. "
        "Use plain English. No preamble. Cap the total response at 200 words."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    """Load the three required seed CSVs from ``data_dir``."""
    return {
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "forecast": pl.read_csv(data_dir / "forecast_outputs_seed.csv"),
        "demand": pl.read_csv(data_dir / "demand_signals_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Demand forecast vs inventory coverage — sourcing gap advisor."
    )
    p.add_argument(
        "--data-dir",
        type=Path,
        default=_DEFAULT_DATA_DIR,
        help="Folder containing *_seed.csv files.",
    )
    p.add_argument(
        "--top",
        type=int,
        default=DEFAULT_TOP,
        help=f"Number of top gap categories to display (default {DEFAULT_TOP}).",
    )
    p.add_argument(
        "--min-confidence",
        type=float,
        default=DEFAULT_MIN_CONFIDENCE,
        help="Minimum forecast confidence_score to include (default 0.0 = all).",
    )
    p.add_argument(
        "--model",
        default=None,
        help="If set, ask this LLM model to narrate sourcing recommendations.",
    )
    p.add_argument(
        "--chart-out",
        default=None,
        help=(
            "Base path for output chart files. "
            "Saves {base}_coverage.png and {base}_demand.png."
        ),
    )
    p.add_argument(
        "--today",
        type=lambda s: dt.date.fromisoformat(s),
        default=None,
        help="Override today's date for reproducible runs (YYYY-MM-DD).",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit gap records as a JSON array instead of a table.",
    )
    p.add_argument(
        "--category-contains",
        default=None,
        help="Filter to categories containing this substring (case-insensitive).",
    )
    return p


def main(argv: Iterable[str] | None = None) -> int:
    """Entry point.  Returns 0 on success."""
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    today = args.today or dt.date.today()

    csvs = load_csvs(args.data_dir)

    inventory = csvs["inventory"]
    forecast = csvs["forecast"]
    demand = csvs["demand"]

    # Apply confidence filter
    if args.min_confidence > 0.0:
        forecast = forecast.filter(pl.col("confidence_score") >= args.min_confidence)

    # Apply category filter
    if args.category_contains:
        needle = args.category_contains.lower()
        inventory = inventory.filter(
            pl.col("category_simple").str.to_lowercase().str.contains(needle)
        )
        forecast = forecast.filter(
            pl.col("category_simple").str.to_lowercase().str.contains(needle)
        )

    coverage = compute_coverage(inventory, forecast, today)
    gaps = score_gaps(coverage, demand, today)

    # Stats for header
    total_available = int(
        inventory.filter(pl.col("status") == "Available").height
    )
    total_categories = inventory["category_simple"].n_unique()
    total_forecast_records = csvs["forecast"].height  # pre-filter count

    if args.json:
        output_rows = gaps.head(args.top).to_dicts()
        summary = {
            "total_available": total_available,
            "total_categories": total_categories,
            "total_forecast_records": total_forecast_records,
            "run_date": today.isoformat(),
        }
        print(json.dumps({"summary": summary, "gaps": output_rows}, default=str))
        return 0

    # Print header
    print(f"Sourcing Gap Analysis — {today}")
    print(
        f"{total_available} available stones across {total_categories} categories "
        f"| {total_forecast_records} forecast records"
    )
    print()

    # Print top gaps table
    print("TOP SOURCING PRIORITIES (by demand × gap):")
    print(format_table(gaps, top=args.top))
    print()

    # Print coverage summary
    print(coverage_summary(gaps))

    # Optional chart output
    if args.chart_out:
        save_charts(gaps, args.chart_out)
        print(f"\nCharts saved: {args.chart_out}_coverage.png, {args.chart_out}_demand.png")

    # Optional LLM narration
    if args.model:
        print()
        print("SOURCING RECOMMENDATIONS:")
        print(narrate_gaps(gaps, model=args.model))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
