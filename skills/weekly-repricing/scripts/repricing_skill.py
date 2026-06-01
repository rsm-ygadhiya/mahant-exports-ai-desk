"""Weekly Rap-Based Repricing Agent — Skill 6.

Pure polars. No LLM in the math path — orchestration lives in `../SKILL.md`.

Public API:
- `compute_repricing(...)` → polars DataFrame with one row per available stone:
  stock_id, category_simple, carat, old_price, proposed_price, pct_change,
  rap_change_pct, margin_class, flag, primary_driver.
- `batch_summary(repriced)` → header line string.
- `narrate_repricing(repriced, model)` → optional LLM executive summary.

CLI:
- `python repricing_skill.py [--position rank_1|page_1|page_2]
   [--min-margin N] [--age-min N] [--filter-flag FLAG]
   [--category-contains STR] [--stock-id ID]
   [--triage-json PATH] [--today YYYY-MM-DD] [--model M]
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

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

_DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"

DEFAULT_POSITION = "page_1"
DEFAULT_MIN_MARGIN = 0.05
DEFAULT_VELOCITY_WINDOW = 60
DEFAULT_DEMAND_WINDOW = 60

# Position preference → price multiplier applied on top of Rap-based target.
# rank_1: cut 3% below target to lead the category.
# page_1: neutral (default, stay at Rap-target price).
# page_2: hold 2% above target to protect margin.
POSITION_ADJUSTMENTS: dict[str, float] = {
    "rank_1": -0.03,
    "page_1": 0.00,
    "page_2": 0.02,
}

FLAG_FROZEN = "FROZEN"       # stone is on an active memo — do not reprice
FLAG_MARGIN = "MARGIN"       # proposed price breaches margin floor, capped
FLAG_QUOTE = "QUOTE"         # proposed price is below an open quote price
FLAG_UNCHANGED = "UNCHANGED" # proposed price within 0.5% of old price


# ---------------------------------------------------------------------------
# Pure factor functions (each returns (adjustment_fraction, label))
# ---------------------------------------------------------------------------


def _age_adjustment(age_days: int) -> tuple[float, str]:
    """Older stones get progressively deeper cuts."""
    if age_days >= 180:
        return (-0.06, f"very old ({age_days}d) → −6%")
    if age_days >= 90:
        return (-0.03, f"aging ({age_days}d) → −3%")
    return (0.0, "")


def _tag_adjustment(tag: str | None) -> tuple[float, str]:
    """Skill-5 triage tag overrides (more aggressive if tagged)."""
    if tag == "CLEAR":
        return (-0.05, "CLEAR tag → −5%")
    if tag == "DISCOUNT":
        return (-0.03, "DISCOUNT tag → −3%")
    return (0.0, "")


def _velocity_adjustment(velocity: int) -> tuple[float, str]:
    """Category sales velocity in the trailing 60-day window."""
    if velocity >= 5:
        return (0.01, f"fast category ({velocity} sales) → +1%")
    if velocity == 0:
        return (-0.02, "no category sales (60d) → −2%")
    return (0.0, "")


def _demand_adjustment(demand_score: float) -> tuple[float, str]:
    """Category-level demand score (0–1 from demand_signals)."""
    if demand_score >= 0.60:
        return (0.01, f"high demand ({demand_score:.2f}) → +1%")
    if demand_score < 0.40:
        return (-0.02, f"weak demand ({demand_score:.2f}) → −2%")
    return (0.0, "")


def _depth_adjustment(listing_count: int) -> tuple[float, str]:
    """Deep marketplace = more competition = edge price down slightly."""
    if listing_count >= 150:
        return (-0.01, f"crowded market ({listing_count} listings) → −1%")
    return (0.0, "")


def _pick_primary_driver(factors: list[tuple[float, str]], rap_wow: float) -> str:
    """Return the dominant narrative reason for the price change."""
    # If Rap moved significantly, that takes precedence.
    if abs(rap_wow) >= 1.5:
        direction = "up" if rap_wow > 0 else "down"
        label = f"Rap moved {rap_wow:+.1f}% this week"
    else:
        label = ""

    # Find the largest-magnitude factor adjustment.
    dominant = max(factors, key=lambda t: abs(t[0]), default=(0.0, ""))
    if dominant[1]:
        if label:
            label = f"{label}; {dominant[1]}"
        else:
            label = dominant[1]

    return label or "no significant driver"


# ---------------------------------------------------------------------------
# Per-stone repricing (pure function, no I/O)
# ---------------------------------------------------------------------------


def price_stone(
    *,
    cost_basis: float,
    old_price: float,
    rap_wow_change_pct: float,
    age_days: int,
    demand_score: float,
    velocity: int,
    listing_count: int,
    action_tag: str | None,
    on_active_memo: bool,
    open_quote_price: float | None,
    position: str,
    min_margin_pct: float,
) -> dict[str, object]:
    """Compute a repricing proposal for one stone.

    The Rap signal is ``rap_wow_change_pct`` — the week-over-week % change in
    the Rap rate for this stone's category.  ``rap_weekly.rap_per_carat`` is
    a market comp price (seeded from avg ppc), not a Rap list price, so we
    apply the percentage *change* to the current price rather than
    recomputing from a list price and discount.

    Returns a dict with keys: proposed_price, pct_change, rap_change_pct,
    margin_class, flag, primary_driver.

    Frozen stones (active memo) are returned with flag=FROZEN and
    proposed_price = old_price.
    """
    # Stones on an active memo must not be repriced.
    if on_active_memo:
        return {
            "proposed_price": old_price,
            "pct_change": 0.0,
            "rap_change_pct": rap_wow_change_pct,
            "margin_class": "Safe",
            "flag": FLAG_FROZEN,
            "primary_driver": "active memo — frozen",
        }

    # Base target: roll the current price forward by this week's Rap movement.
    base_price = old_price * (1.0 + rap_wow_change_pct / 100.0)

    # Collect factor adjustments (each is a fractional multiplier delta).
    factors: list[tuple[float, str]] = [
        _age_adjustment(age_days),
        _tag_adjustment(action_tag),
        _velocity_adjustment(velocity),
        _demand_adjustment(demand_score),
        _depth_adjustment(listing_count),
    ]

    total_adj = sum(f[0] for f in factors) + POSITION_ADJUSTMENTS.get(position, 0.0)
    proposed = base_price * (1.0 + total_adj)

    # Margin floor guard.
    floor_price = cost_basis * (1.0 + min_margin_pct)
    flag: str | None = None
    if proposed < floor_price:
        proposed = floor_price
        margin_class = "Conditional" if floor_price >= cost_basis else "Unsafe"
        flag = FLAG_MARGIN
    else:
        margin_class = "Safe"

    # Open-quote guard: warn if proposed would undercut an active quote.
    if flag is None and open_quote_price is not None and proposed < open_quote_price:
        flag = FLAG_QUOTE

    # Treat micro-changes as unchanged to avoid noise.
    pct_change = (proposed - old_price) / old_price * 100.0 if old_price else 0.0
    if flag is None and abs(pct_change) < 0.5:
        flag = FLAG_UNCHANGED

    primary_driver = _pick_primary_driver(
        [f for f in factors if f[0] != 0.0],
        rap_wow_change_pct,
    )

    return {
        "proposed_price": round(proposed, 2),
        "pct_change": round(pct_change, 2),
        "rap_change_pct": round(rap_wow_change_pct, 2),
        "margin_class": margin_class,
        "flag": flag or "",
        "primary_driver": primary_driver,
    }


# ---------------------------------------------------------------------------
# Data aggregation helpers
# ---------------------------------------------------------------------------


def _latest_rap(rap: pl.DataFrame) -> pl.DataFrame:
    """Keep only the most recent rap_week row per category."""
    return (
        rap.with_columns(pl.col("rap_week").str.to_date())
        .sort("rap_week", descending=True)
        .unique(subset=["category_simple"], keep="first")
        .select(["category_simple", "wow_change_pct"])
    )


def _active_memo_stocks(memos: pl.DataFrame, today: dt.date) -> set[str]:
    """Set of stock_ids on an approved memo that hasn't closed yet."""
    active_decisions = {"Approved", "ApprovedWithConditions"}
    return set(
        memos.with_columns(
            pl.col("expiry_date").cast(pl.Utf8).str.slice(0, 10).str.to_date()
        )
        .filter(
            pl.col("decision").is_in(list(active_decisions))
            & (pl.col("closed_outcome").is_null() | (pl.col("closed_outcome") == ""))
            & (pl.col("expiry_date") >= today)
        )["stock_id"]
        .to_list()
    )


def _open_quote_prices(quotes: pl.DataFrame) -> pl.DataFrame:
    """Max offered_price per stock_id where quote is still Negotiating."""
    return (
        quotes.filter(pl.col("quote_outcome") == "Negotiating")
        .with_columns(pl.col("offered_price").cast(pl.Float64))
        .group_by("stock_id")
        .agg(pl.col("offered_price").max().alias("open_quote_price"))
    )


def _category_velocity(
    sales: pl.DataFrame, today: dt.date, window_days: int
) -> pl.DataFrame:
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
    cutoff = today - dt.timedelta(days=window_days)
    return (
        demand.with_columns(pl.col("signal_date").str.to_date())
        .filter(pl.col("signal_date") >= cutoff)
        .group_by("category_simple")
        .agg(
            pl.col("demand_score").mean().alias("demand_score"),
            pl.col("listing_count").mean().alias("listing_count"),
        )
    )


# ---------------------------------------------------------------------------
# Main repricing pipeline
# ---------------------------------------------------------------------------


def compute_repricing(
    inventory: pl.DataFrame,
    rap: pl.DataFrame,
    sales: pl.DataFrame,
    demand: pl.DataFrame,
    memos: pl.DataFrame,
    quotes: pl.DataFrame,
    triage_tags: dict[str, str] | None = None,
    today: dt.date | None = None,
    position: str = DEFAULT_POSITION,
    min_margin_pct: float = DEFAULT_MIN_MARGIN,
    velocity_window_days: int = DEFAULT_VELOCITY_WINDOW,
    demand_window_days: int = DEFAULT_DEMAND_WINDOW,
) -> pl.DataFrame:
    """Price every Available stone and return a repricing proposal DataFrame.

    Columns returned:
      stock_id, category_simple, carat, old_price, proposed_price, pct_change,
      rap_change_pct, cost_basis, margin_class, flag, primary_driver.

    Sorted: MARGIN > QUOTE > FROZEN > changed stones (largest |pct_change| first)
    > UNCHANGED.
    """
    if today is None:
        today = dt.date.today()

    available = inventory.filter(pl.col("status") == "Available")

    rap_latest = _latest_rap(rap)
    active_memos = _active_memo_stocks(memos, today)
    open_quotes = _open_quote_prices(quotes)
    velocity = _category_velocity(sales, today, velocity_window_days)
    demand_agg = _category_demand(demand, today, demand_window_days)

    enriched = (
        available.select(
            "stock_id",
            "category_simple",
            "carat",
            "age_in_stock_days",
            pl.col("p_pcs").alias("old_price"),
            "cost_basis",
        )
        .join(rap_latest, on="category_simple", how="left")
        .join(velocity, on="category_simple", how="left")
        .join(demand_agg, on="category_simple", how="left")
        .join(open_quotes, on="stock_id", how="left")
        .with_columns(
            pl.col("wow_change_pct").fill_null(0.0),
            pl.col("velocity").fill_null(0).cast(pl.Int64),
            pl.col("demand_score").fill_null(0.5),
            pl.col("listing_count").fill_null(0.0),
            pl.col("open_quote_price").fill_null(0.0),
        )
    )

    rows = enriched.to_dicts()
    results: list[dict] = []
    for r in rows:
        action_tag = (triage_tags or {}).get(r["stock_id"])
        result = price_stone(
            cost_basis=float(r["cost_basis"]),
            old_price=float(r["old_price"]),
            rap_wow_change_pct=float(r["wow_change_pct"]),
            age_days=int(r["age_in_stock_days"]),
            demand_score=float(r["demand_score"]),
            velocity=int(r["velocity"]),
            listing_count=int(r["listing_count"]),
            action_tag=action_tag,
            on_active_memo=r["stock_id"] in active_memos,
            open_quote_price=(
                float(r["open_quote_price"]) if r["open_quote_price"] else None
            ),
            position=position,
            min_margin_pct=min_margin_pct,
        )
        results.append(
            {
                "stock_id": r["stock_id"],
                "category_simple": r["category_simple"],
                "carat": r["carat"],
                "old_price": r["old_price"],
                "cost_basis": r["cost_basis"],
                **result,
            }
        )

    if not results:
        return _empty_result()

    out = pl.DataFrame(results)

    # Sort: margin/quote flags first (most urgent), then frozen, then by
    # absolute price change desc, unchanged last.
    priority_map = {
        FLAG_MARGIN: 0,
        FLAG_QUOTE: 1,
        FLAG_FROZEN: 2,
        "": 3,
        FLAG_UNCHANGED: 4,
    }
    return (
        out.with_columns(
            pl.col("flag")
            .replace_strict(priority_map, default=3, return_dtype=pl.Int64)
            .alias("_sort_priority"),
            pl.col("pct_change").abs().alias("_abs_change"),
        )
        .sort(["_sort_priority", "_abs_change"], descending=[False, True])
        .drop(["_sort_priority", "_abs_change"])
    )


def _empty_result() -> pl.DataFrame:
    return pl.DataFrame(
        schema={
            "stock_id": pl.Utf8,
            "category_simple": pl.Utf8,
            "carat": pl.Float64,
            "old_price": pl.Float64,
            "cost_basis": pl.Float64,
            "proposed_price": pl.Float64,
            "pct_change": pl.Float64,
            "rap_change_pct": pl.Float64,
            "margin_class": pl.Utf8,
            "flag": pl.Utf8,
            "primary_driver": pl.Utf8,
        }
    )


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------


def batch_summary(repriced: pl.DataFrame) -> str:
    """One-line header: counts of up/down/unchanged/frozen/flagged."""
    if repriced.is_empty():
        return "0 stones repriced."
    total = len(repriced)
    up = int((repriced["pct_change"] > 0.5).sum())
    down = int((repriced["pct_change"] < -0.5).sum())
    unchanged = int(repriced["flag"].is_in([FLAG_UNCHANGED, FLAG_FROZEN]).sum())
    flagged_margin = int((repriced["flag"] == FLAG_MARGIN).sum())
    frozen = int((repriced["flag"] == FLAG_FROZEN).sum())
    return (
        f"{total} stones repriced: {up} up, {down} down, {unchanged} unchanged "
        f"({frozen} frozen on memo). "
        f"{flagged_margin} flagged for review (margin breach)."
    )


def format_table(repriced: pl.DataFrame, top: int = 20) -> str:
    """Markdown table of the top-N rows (most urgent first)."""
    if repriced.is_empty():
        return "_(no available stones to reprice)_"
    cols = [
        "stock_id",
        "category_simple",
        "old_price",
        "proposed_price",
        "pct_change",
        "margin_class",
        "flag",
        "primary_driver",
    ]
    head = repriced.head(top).select(cols)
    headers = ["Stock", "Category", "Old $", "New $", "Chg %", "Margin", "Flag", "Driver"]
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
                    row["category_simple"],
                    f"${row['old_price']:,.0f}",
                    f"${row['proposed_price']:,.0f}",
                    f"{row['pct_change']:+.1f}%",
                    row["margin_class"],
                    row["flag"] or "—",
                    row["primary_driver"],
                ]
            )
            + " |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM narration (optional)
# ---------------------------------------------------------------------------


def narrate_repricing(
    repriced: pl.DataFrame, model: str = "api-llama-4-scout"
) -> str:
    """Ask an LLM for a 2–3 sentence executive summary of the repricing run."""
    try:
        from dotenv import load_dotenv

        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    total = len(repriced)
    up = int((repriced["pct_change"] > 0.5).sum())
    down = int((repriced["pct_change"] < -0.5).sum())
    margin_flags = int((repriced["flag"] == FLAG_MARGIN).sum())
    frozen = int((repriced["flag"] == FLAG_FROZEN).sum())
    sample = (
        repriced.filter(pl.col("flag").is_in([FLAG_MARGIN, FLAG_QUOTE]) | (pl.col("pct_change").abs() > 5))
        .head(8)
        .select(["stock_id", "old_price", "proposed_price", "pct_change", "flag", "primary_driver"])
    )
    sample_json = json.dumps(sample.to_dicts(), default=str)

    prompt = (
        "You are summarizing a weekly Rap-based repricing run for a lab-grown diamond wholesaler.\n\n"
        f"Total stones: {total}. Up: {up}. Down: {down}. "
        f"Margin-flagged: {margin_flags}. Frozen on memo: {frozen}.\n"
        f"Most notable changes: {sample_json}.\n\n"
        "Write 2–3 sentences for the desk: what drove the most price changes this week, "
        "what the desk must review immediately (margin flags), "
        "and any category-level pattern worth noting. No preamble, no bullets."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        "inventory": pl.read_csv(data_dir / "inventory_seed.csv"),
        "rap": pl.read_csv(data_dir / "rap_weekly_seed.csv"),
        "sales": pl.read_csv(data_dir / "sales_transactions_seed.csv"),
        "demand": pl.read_csv(data_dir / "demand_signals_seed.csv"),
        "memos": pl.read_csv(data_dir / "memos_seed.csv"),
        "quotes": pl.read_csv(data_dir / "quotes_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Reprice every available stone using the latest Rap rates."
    )
    p.add_argument(
        "--data-dir",
        type=Path,
        default=_DEFAULT_DATA_DIR,
        help="Folder containing *_seed.csv files.",
    )
    p.add_argument(
        "--position",
        choices=list(POSITION_ADJUSTMENTS),
        default=DEFAULT_POSITION,
        help="Preferred marketplace position (default: page_1).",
    )
    p.add_argument(
        "--min-margin",
        type=float,
        default=DEFAULT_MIN_MARGIN,
        help="Minimum acceptable gross margin as a fraction (default 0.05 = 5%%).",
    )
    p.add_argument("--top", type=int, default=20, help="Rows to print (default 20).")
    p.add_argument(
        "--age-min",
        type=int,
        default=None,
        help="Restrict to stones older than N days.",
    )
    p.add_argument(
        "--filter-flag",
        choices=[FLAG_FROZEN, FLAG_MARGIN, FLAG_QUOTE, FLAG_UNCHANGED, ""],
        default=None,
        help="Show only rows with this flag.",
    )
    p.add_argument(
        "--category-contains",
        default=None,
        help="Substring filter on category_simple (case-insensitive).",
    )
    p.add_argument(
        "--stock-id",
        default=None,
        help="Show only this specific stone.",
    )
    p.add_argument(
        "--triage-json",
        type=Path,
        default=None,
        help="JSON file (or stdin '-') output from Skill 5 --json flag.",
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
        help="If set, ask this model to narrate the result.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit the full repriced frame as JSON instead of a table.",
    )
    return p


def _load_triage_tags(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    text = path.read_text() if str(path) != "-" else sys.stdin.read()
    rows = json.loads(text)
    return {r["stock_id"]: r["action_tag"] for r in rows if "action_tag" in r}


def _apply_filters(
    repriced: pl.DataFrame,
    age_min: int | None,
    filter_flag: str | None,
    category_contains: str | None,
    stock_id: str | None,
) -> pl.DataFrame:
    out = repriced
    if age_min is not None:
        inv = _repo_inventory()  # lightweight: only need age column
        aged = inv.filter(pl.col("age_in_stock_days") >= age_min)["stock_id"]
        out = out.filter(pl.col("stock_id").is_in(aged))
    if filter_flag is not None:
        out = out.filter(pl.col("flag") == filter_flag)
    if category_contains is not None:
        needle = category_contains.lower()
        out = out.filter(pl.col("category_simple").str.to_lowercase().str.contains(needle))
    if stock_id is not None:
        out = out.filter(pl.col("stock_id") == stock_id)
    return out


_cached_inventory: pl.DataFrame | None = None


def _repo_inventory() -> pl.DataFrame:
    global _cached_inventory
    if _cached_inventory is None:
        _cached_inventory = pl.read_csv(_DEFAULT_DATA_DIR / "inventory_seed.csv")
    return _cached_inventory


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    triage_tags = _load_triage_tags(args.triage_json)

    repriced = compute_repricing(
        inventory=csvs["inventory"],
        rap=csvs["rap"],
        sales=csvs["sales"],
        demand=csvs["demand"],
        memos=csvs["memos"],
        quotes=csvs["quotes"],
        triage_tags=triage_tags or None,
        today=args.today,
        position=args.position,
        min_margin_pct=args.min_margin,
    )

    filtered = _apply_filters(
        repriced,
        age_min=args.age_min,
        filter_flag=args.filter_flag,
        category_contains=args.category_contains,
        stock_id=args.stock_id,
    )

    if args.json:
        print(json.dumps(filtered.head(args.top).to_dicts(), default=str))
        return 0

    print(batch_summary(repriced))
    print()
    print(format_table(filtered, top=args.top))
    if args.model:
        print()
        print(narrate_repricing(repriced, model=args.model))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
