"""CLV Calculator — Skill 3 (broker + company).

Computes Customer Lifetime Value at two levels:
- **Company** — the actual end-buyer (customer_id is a company).
- **Broker** — rolls up all companies that transact through the broker,
  plus their own direct purchases.

The CLV math is the same time-value formula as the ``clv-example`` skill.
The difference here is that inputs are **derived from sales history** rather
than typed in by the user.

Public API
----------
- ``clv_inputs_for_entity(entity_id, level, sales, customers, today)``
  → dict of inputs suitable for ``calculate_clv``.
- ``compute_entity_clv(entity_id, level, sales, customers, today, **kwargs)``
  → ``CLVResult`` (namedtuple-like dataclass).
- ``compute_all_clv(level, sales, customers, today, **kwargs)``
  → polars DataFrame ranked by CLV, one row per entity.
- ``broker_breakdown(broker_id, sales, customers, today, **kwargs)``
  → tuple(broker_result, company_df) for the full broker view.

CLI
---
  python clv_broker_company.py --broker CUST0007
  python clv_broker_company.py --company CUST0042
  python clv_broker_company.py --top-brokers 10
  python clv_broker_company.py --top-companies 20
  python clv_broker_company.py --top-brokers 5 --model api-llama-4-scout
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Iterable, NamedTuple

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Reuse the core CLV formula from the example skill.
_CLV_SCRIPT = _REPO_ROOT / "skills" / "example" / "scripts" / "clv_skill.py"
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("clv_example", _CLV_SCRIPT)
assert _spec and _spec.loader
_clv_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_clv_mod)
calculate_clv = _clv_mod.calculate_clv

_DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "Milestone_2"

DEFAULT_DISCOUNT_RATE = 0.008   # 0.8 % monthly
DEFAULT_TIME_HORIZON = 36       # months
DEFAULT_MIN_TRANSACTIONS = 1    # include entities with at least this many sales


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


class CLVResult(NamedTuple):
    entity_id: str
    entity_name: str
    level: str           # "broker" or "company"
    clv: float
    avg_monthly_profit: float
    transactions: int
    months_active: float
    churn_rate: float
    discount_rate: float
    time_horizon: int
    first_sale: str      # ISO date string
    last_sale: str       # ISO date string
    note: str            # empty string or warning


# ---------------------------------------------------------------------------
# Input derivation
# ---------------------------------------------------------------------------


def _entity_sales(
    entity_id: str,
    level: str,
    sales: pl.DataFrame,
) -> pl.DataFrame:
    """Return all sales attributable to this entity.

    - broker  → sales where ``broker_id == entity_id``
      (covers both the broker buying directly and companies buying through them).
    - company → sales where ``customer_id == entity_id``.
    """
    if level == "broker":
        return sales.filter(pl.col("broker_id") == entity_id)
    return sales.filter(pl.col("customer_id") == entity_id)


def clv_inputs_for_entity(
    entity_id: str,
    level: str,
    sales: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date,
    discount_rate: float = DEFAULT_DISCOUNT_RATE,
    time_horizon: int = DEFAULT_TIME_HORIZON,
) -> dict:
    """Derive CLV inputs from sales history for one entity.

    Returns a dict with all inputs needed for ``calculate_clv``, plus
    diagnostic fields (transactions, months_active, first_sale, last_sale).

    Gross profit is used as the profit metric — it already deducts cost_at_sale
    from sold_price, so we set service_cost=0, transaction_frequency=1, and
    pass avg_monthly_gross_profit as monthly_revenue.
    """
    entity_sales_df = _entity_sales(entity_id, level, sales)

    # Look up customer metadata for churn_rate.
    cust_row = customers.filter(pl.col("customer_id") == entity_id)
    if len(cust_row) == 0:
        # Broker rollups may not have a direct customer row — use 10% default.
        churn_rate = 0.10
        entity_name = entity_id
    else:
        churn_pct = cust_row["churn_risk_pct"][0]
        churn_rate = float(churn_pct) / 100.0
        entity_name = cust_row["customer_name"][0]

    if entity_sales_df.is_empty():
        return {
            "entity_id": entity_id,
            "entity_name": entity_name,
            "monthly_revenue": 0.0,
            "service_cost": 0.0,
            "transaction_frequency": 1.0,
            "churn_rate": churn_rate,
            "discount_rate": discount_rate,
            "time_horizon": time_horizon,
            "churn_assumption": "optimistic",
            "discount_assumption": "pessimistic",
            "transactions": 0,
            "months_active": 0.0,
            "first_sale": "",
            "last_sale": "",
            "note": "no sales history",
        }

    entity_sales_df = entity_sales_df.with_columns(
        pl.col("transaction_date").str.to_date()
    )
    first_sale = entity_sales_df["transaction_date"].min()
    last_sale = entity_sales_df["transaction_date"].max()
    n_transactions = len(entity_sales_df)
    total_gp = float(entity_sales_df["gross_profit"].sum())

    # months_active: span from first sale to today (minimum 1 month).
    months_active = max(1.0, (today - first_sale).days / 30.44)
    avg_monthly_profit = total_gp / months_active

    note = ""
    if avg_monthly_profit <= 0:
        note = "negative avg gross profit — CLV may be zero or negative"

    return {
        "entity_id": entity_id,
        "entity_name": entity_name,
        "monthly_revenue": avg_monthly_profit,
        "service_cost": 0.0,
        "transaction_frequency": 1.0,
        "churn_rate": churn_rate,
        "discount_rate": discount_rate,
        "time_horizon": time_horizon,
        "churn_assumption": "optimistic",
        "discount_assumption": "pessimistic",
        "transactions": n_transactions,
        "months_active": round(months_active, 1),
        "first_sale": str(first_sale),
        "last_sale": str(last_sale),
        "note": note,
    }


# ---------------------------------------------------------------------------
# Per-entity CLV
# ---------------------------------------------------------------------------


def compute_entity_clv(
    entity_id: str,
    level: str,
    sales: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
    discount_rate: float = DEFAULT_DISCOUNT_RATE,
    time_horizon: int = DEFAULT_TIME_HORIZON,
) -> CLVResult:
    """Return a ``CLVResult`` for one broker or company."""
    if today is None:
        today = dt.date.today()

    inp = clv_inputs_for_entity(
        entity_id, level, sales, customers, today,
        discount_rate=discount_rate,
        time_horizon=time_horizon,
    )
    clv = calculate_clv(
        monthly_revenue=inp["monthly_revenue"],
        service_cost=inp["service_cost"],
        transaction_frequency=inp["transaction_frequency"],
        churn_rate=inp["churn_rate"],
        discount_rate=inp["discount_rate"],
        time_horizon=inp["time_horizon"],
        churn_assumption=inp["churn_assumption"],
        discount_assumption=inp["discount_assumption"],
    )
    return CLVResult(
        entity_id=entity_id,
        entity_name=inp["entity_name"],
        level=level,
        clv=round(clv, 2),
        avg_monthly_profit=round(inp["monthly_revenue"], 2),
        transactions=inp["transactions"],
        months_active=inp["months_active"],
        churn_rate=inp["churn_rate"],
        discount_rate=inp["discount_rate"],
        time_horizon=inp["time_horizon"],
        first_sale=inp["first_sale"],
        last_sale=inp["last_sale"],
        note=inp["note"],
    )


# ---------------------------------------------------------------------------
# Bulk ranking
# ---------------------------------------------------------------------------


def assign_quartile_tiers(clv_df: pl.DataFrame) -> pl.DataFrame:
    """Add a ``tier`` column by CLV quartile — Top / High / Mid / Low.

    This is the single canonical tiering for the whole project; it matches
    ``automation/rank-customer-clv`` exactly so the skill, the autopilot, and
    the UI all bucket customers the same way. "Mid CLV" everywhere means the
    ``Mid`` quartile.
    """
    if clv_df.is_empty():
        return clv_df.with_columns(pl.lit(None, dtype=pl.Utf8).alias("tier"))
    rows = clv_df.sort("clv", descending=True).to_dicts()
    n = len(rows)
    top_cut, high_cut, mid_cut = max(1, n // 4), max(2, n // 2), max(3, (3 * n) // 4)
    for i, r in enumerate(rows):
        r["tier"] = ("Top" if i < top_cut else
                     "High" if i < high_cut else
                     "Mid" if i < mid_cut else "Low")
    return pl.DataFrame(rows)


def compute_all_clv(
    level: str,
    sales: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
    discount_rate: float = DEFAULT_DISCOUNT_RATE,
    time_horizon: int = DEFAULT_TIME_HORIZON,
    min_transactions: int = DEFAULT_MIN_TRANSACTIONS,
) -> pl.DataFrame:
    """CLV for every broker or every company, ranked descending by CLV.

    Filters out entities with fewer than ``min_transactions`` sales.
    Output carries a ``tier`` column (Top/High/Mid/Low by CLV quartile).
    """
    if today is None:
        today = dt.date.today()

    if level == "broker":
        entity_ids = (
            customers.filter(pl.col("is_broker").cast(pl.Utf8).str.to_lowercase() == "true")["customer_id"]
            .to_list()
        )
    else:
        entity_ids = (
            customers.filter(pl.col("is_broker").cast(pl.Utf8).str.to_lowercase() != "true")["customer_id"]
            .to_list()
        )

    rows = []
    for eid in entity_ids:
        result = compute_entity_clv(eid, level, sales, customers, today,
                                    discount_rate=discount_rate,
                                    time_horizon=time_horizon)
        if result.transactions >= min_transactions:
            rows.append(result._asdict())

    if not rows:
        return pl.DataFrame(schema={
            "entity_id": pl.Utf8, "entity_name": pl.Utf8, "level": pl.Utf8,
            "clv": pl.Float64, "avg_monthly_profit": pl.Float64,
            "transactions": pl.Int64, "months_active": pl.Float64,
            "churn_rate": pl.Float64, "tier": pl.Utf8,
        })

    return assign_quartile_tiers(pl.DataFrame(rows).sort("clv", descending=True))


# ---------------------------------------------------------------------------
# Broker breakdown (broker + companies)
# ---------------------------------------------------------------------------


def broker_breakdown(
    broker_id: str,
    sales: pl.DataFrame,
    customers: pl.DataFrame,
    today: dt.date | None = None,
    discount_rate: float = DEFAULT_DISCOUNT_RATE,
    time_horizon: int = DEFAULT_TIME_HORIZON,
) -> tuple[CLVResult, pl.DataFrame]:
    """Broker-level CLV + per-company breakdown DataFrame.

    Returns (broker_result, company_df) where company_df has the same schema
    as ``compute_all_clv`` output but restricted to companies under this broker.
    """
    if today is None:
        today = dt.date.today()

    broker_result = compute_entity_clv(
        broker_id, "broker", sales, customers, today,
        discount_rate=discount_rate, time_horizon=time_horizon,
    )

    company_ids = (
        customers.filter(
            (pl.col("broker_id") == broker_id)
            & (pl.col("customer_id") != broker_id)
        )["customer_id"]
        .to_list()
    )

    company_rows = []
    for cid in company_ids:
        r = compute_entity_clv(cid, "company", sales, customers, today,
                               discount_rate=discount_rate,
                               time_horizon=time_horizon)
        company_rows.append(r._asdict())

    if not company_rows:
        company_df = pl.DataFrame(schema={
            "entity_id": pl.Utf8, "entity_name": pl.Utf8, "level": pl.Utf8,
            "clv": pl.Float64, "avg_monthly_profit": pl.Float64,
            "transactions": pl.Int64, "months_active": pl.Float64,
            "churn_rate": pl.Float64,
        })
    else:
        company_df = pl.DataFrame(company_rows).sort("clv", descending=True)

    return broker_result, company_df


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def format_single(result: CLVResult) -> str:
    lines = [
        f"**{result.entity_name}** (`{result.entity_id}`) — {result.level.capitalize()}",
        f"CLV ({result.time_horizon}mo): **${result.clv:,.0f}**",
        f"Avg monthly gross profit: ${result.avg_monthly_profit:,.0f}",
        f"Transactions: {result.transactions} over {result.months_active:.0f} months",
        f"Churn rate: {result.churn_rate*100:.1f}% / month | Discount rate: {result.discount_rate*100:.2f}% / month",
        f"Sales range: {result.first_sale} → {result.last_sale}",
    ]
    if result.note:
        lines.append(f"⚠ {result.note}")
    return "\n".join(lines)


def format_table(df: pl.DataFrame, top: int = 20) -> str:
    if df.is_empty():
        return "_(no data)_"
    cols = ["entity_id", "entity_name", "clv", "avg_monthly_profit",
            "transactions", "months_active", "churn_rate"]
    head = df.head(top).select([c for c in cols if c in df.columns])
    headers = ["ID", "Name", "CLV", "Avg Mo. Profit", "Txns", "Mo. Active", "Churn %"]
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for row in head.iter_rows(named=True):
        lines.append(
            "| " + " | ".join([
                row["entity_id"],
                row["entity_name"],
                f"${row['clv']:,.0f}",
                f"${row['avg_monthly_profit']:,.0f}",
                str(row["transactions"]),
                f"{row['months_active']:.0f}",
                f"{row['churn_rate']*100:.1f}%",
            ]) + " |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM narration
# ---------------------------------------------------------------------------


def narrate_clv(result: CLVResult, company_df: pl.DataFrame | None,
                model: str = "api-llama-4-scout") -> str:
    """2–3 sentence LLM narrative for a single entity result."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    context = result._asdict()
    if company_df is not None and not company_df.is_empty():
        top3 = company_df.head(3).select(["entity_name", "clv"]).to_dicts()
        context["top_companies"] = top3

    prompt = (
        "You are summarizing a CLV calculation for a lab-grown diamond wholesaler desk.\n\n"
        f"Data: {json.dumps(context, default=str)}\n\n"
        "Write 2–3 sentences: state the CLV in plain English, explain what drives it "
        "(monthly profit × retention × time), and flag anything the desk should act on "
        "(high churn risk, short history, negative margin). No preamble, no bullets."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


def narrate_ranking(df: pl.DataFrame, level: str,
                    model: str = "api-llama-4-scout") -> str:
    """2–3 sentence LLM narrative for a top-N ranking."""
    try:
        from dotenv import load_dotenv
        load_dotenv(_REPO_ROOT / ".env")
    except ImportError:
        pass

    from utils.connect import ask

    top5 = df.head(5).select(["entity_id", "entity_name", "clv",
                               "churn_rate", "transactions"]).to_dicts()
    prompt = (
        f"You are summarizing a {level} CLV ranking for a lab-grown diamond wholesaler.\n\n"
        f"Top 5 {level}s by CLV: {json.dumps(top5, default=str)}\n"
        f"Total {level}s ranked: {len(df)}.\n\n"
        "Write 2–3 sentences: who leads, what separates the top from the rest, "
        "and which entity the desk should protect most aggressively. No preamble."
    )
    return ask(prompt, model=model, temperature=0.3) or ""


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------


def load_csvs(data_dir: Path) -> dict[str, pl.DataFrame]:
    return {
        "customers": pl.read_csv(data_dir / "customers_seed.csv"),
        "sales": pl.read_csv(data_dir / "sales_transactions_seed.csv"),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Compute CLV at broker or company level."
    )
    p.add_argument("--data-dir", type=Path, default=_DEFAULT_DATA_DIR)

    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--broker", metavar="ID",
                      help="Single broker CLV + company breakdown.")
    mode.add_argument("--company", metavar="ID",
                      help="Single company CLV.")
    mode.add_argument("--top-brokers", type=int, metavar="N",
                      help="Rank all brokers by CLV and show top N.")
    mode.add_argument("--top-companies", type=int, metavar="N",
                      help="Rank all companies by CLV and show top N.")

    p.add_argument("--time-horizon", type=int, default=DEFAULT_TIME_HORIZON,
                   help=f"Months to project CLV over (default {DEFAULT_TIME_HORIZON}).")
    p.add_argument("--discount-rate", type=float, default=DEFAULT_DISCOUNT_RATE,
                   help=f"Monthly discount rate (default {DEFAULT_DISCOUNT_RATE}).")
    p.add_argument("--today", type=lambda s: dt.date.fromisoformat(s), default=None,
                   help="Override 'today' (YYYY-MM-DD).")
    p.add_argument("--model", default=None,
                   help="If set, add LLM narration via utils.connect.ask.")
    p.add_argument("--json", action="store_true",
                   help="Emit JSON instead of formatted text.")
    p.add_argument("--top", type=int, default=20,
                   help="Max rows in ranking tables (default 20).")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    csvs = load_csvs(args.data_dir)
    today = args.today or dt.date.today()
    kw = dict(discount_rate=args.discount_rate, time_horizon=args.time_horizon)

    if args.broker:
        result, company_df = broker_breakdown(
            args.broker, csvs["sales"], csvs["customers"], today, **kw
        )
        if args.json:
            out = result._asdict()
            out["companies"] = company_df.to_dicts() if not company_df.is_empty() else []
            print(json.dumps(out, default=str))
            return 0
        print(format_single(result))
        if not company_df.is_empty():
            print()
            print(f"Companies under {result.entity_name}:")
            print(format_table(company_df, top=args.top))
        if args.model:
            print()
            print(narrate_clv(result, company_df, model=args.model))

    elif args.company:
        result = compute_entity_clv(
            args.company, "company", csvs["sales"], csvs["customers"], today, **kw
        )
        if args.json:
            print(json.dumps(result._asdict(), default=str))
            return 0
        print(format_single(result))
        if args.model:
            print()
            print(narrate_clv(result, None, model=args.model))

    elif args.top_brokers:
        df = compute_all_clv("broker", csvs["sales"], csvs["customers"], today, **kw)
        if args.json:
            print(json.dumps(df.head(args.top_brokers).to_dicts(), default=str))
            return 0
        print(f"Top {args.top_brokers} brokers by CLV (out of {len(df)}):")
        print(format_table(df, top=args.top_brokers))
        if args.model:
            print()
            print(narrate_ranking(df, "broker", model=args.model))

    elif args.top_companies:
        df = compute_all_clv("company", csvs["sales"], csvs["customers"], today, **kw)
        if args.json:
            print(json.dumps(df.head(args.top_companies).to_dicts(), default=str))
            return 0
        print(f"Top {args.top_companies} companies by CLV (out of {len(df)}):")
        print(format_table(df, top=args.top_companies))
        if args.model:
            print()
            print(narrate_ranking(df, "company", model=args.model))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
