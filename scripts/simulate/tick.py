"""Simulate fresh daily / weekly data for the Pramukh Gems CSVs.

Appends realistic rows to `data/raw/*_seed.csv` so the M03 skills + the
Mahant UI see new state every run. Idempotent — keeps a clock in
`data/working/sim_state.json` so repeated calls advance one day each.

Usage
-----
  python scripts/simulate/tick.py --reset            # restore from _baseline/
  python scripts/simulate/tick.py --daily            # advance one day
  python scripts/simulate/tick.py --weekly           # one weekly Rap + forecast drop
  python scripts/simulate/tick.py --days 7           # 7 daily ticks; weekly fires on Mondays
  python scripts/simulate/tick.py --status           # print current sim date + row counts
  python scripts/simulate/tick.py --snapshot NAME    # freeze current CSVs into data/scenarios/NAME/
  python scripts/simulate/tick.py --load NAME        # copy data/scenarios/NAME/ → data/raw/

The simulator only writes CSV files. The Mahant Next.js UI reads
PostgreSQL, not CSVs — see SIMULATION.md for how to sync if you want
the UI to show this simulated state.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import random
import shutil
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW = REPO_ROOT / "data" / "raw"
BASELINE = RAW / "_baseline"
SCENARIOS = REPO_ROOT / "data" / "scenarios"
WORKING = REPO_ROOT / "data" / "working"
STATE_FILE = WORKING / "sim_state.json"

CSV_FILES = [
    "communication_logs_seed.csv",
    "customers_seed.csv",
    "cut_simulations_seed.csv",
    "demand_signals_seed.csv",
    "forecast_outputs_seed.csv",
    "index_price_history_seed.csv",
    "inventory_seed.csv",
    "memos_seed.csv",
    "negotiation_threads_seed.csv",
    "orders_queue_seed.csv",
    "payment_history_seed.csv",
    "quotes_seed.csv",
    "rap_weekly_seed.csv",
    "sales_transactions_seed.csv",
]


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def read_csv(name: str) -> tuple[list[str], list[dict[str, str]]]:
    path = RAW / name
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(name: str, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path = RAW / name
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def append_csv(name: str, fieldnames: list[str], new_rows: list[dict[str, str]]) -> None:
    if not new_rows:
        return
    path = RAW / name
    with path.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writerows(new_rows)


def next_id(rows: list[dict[str, str]], col: str, prefix: str, width: int) -> str:
    used = 0
    for r in rows:
        v = r.get(col, "") or ""
        if v.startswith(prefix):
            try:
                used = max(used, int(v[len(prefix):]))
            except ValueError:
                continue
    return f"{prefix}{used + 1:0{width}d}"


def load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict[str, Any]) -> None:
    WORKING.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def current_sim_date() -> dt.date:
    s = load_state()
    if "today" in s:
        return dt.date.fromisoformat(s["today"])
    # First run: start from the day after the latest date we can find in the
    # operational tables.
    _, sales = read_csv("sales_transactions_seed.csv")
    latest = max(dt.date.fromisoformat(r["transaction_date"]) for r in sales)
    return latest + dt.timedelta(days=1)


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------


def cmd_reset() -> None:
    if not BASELINE.exists():
        sys.exit("No baseline snapshot at data/raw/_baseline/. Cannot reset.")
    for name in CSV_FILES:
        src = BASELINE / name
        if src.exists():
            shutil.copy2(src, RAW / name)
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    print(f"Reset {len(CSV_FILES)} CSVs from baseline. Sim clock cleared.")


# ---------------------------------------------------------------------------
# Daily tick
# ---------------------------------------------------------------------------


def daily_tick(today: dt.date, rng: random.Random) -> dict[str, int]:
    """Append one simulated day's worth of activity. Returns {table: rows_added}."""
    counts: dict[str, int] = {}

    # --- Load reference tables ---
    inv_fields, inv_rows = read_csv("inventory_seed.csv")
    cust_fields, cust_rows = read_csv("customers_seed.csv")
    sales_fields, sales_rows = read_csv("sales_transactions_seed.csv")
    pay_fields, pay_rows = read_csv("payment_history_seed.csv")
    quote_fields, quote_rows = read_csv("quotes_seed.csv")
    memo_fields, memo_rows = read_csv("memos_seed.csv")
    thread_fields, thread_rows = read_csv("negotiation_threads_seed.csv")
    msg_fields, msg_rows = read_csv("communication_logs_seed.csv")
    demand_fields, demand_rows = read_csv("demand_signals_seed.csv")

    customers_by_id = {r["customer_id"]: r for r in cust_rows}
    available = [r for r in inv_rows if r["status"] == "Available"]
    end_customers = [r for r in cust_rows if r["is_broker"].lower() != "true"]
    brokers = [r for r in cust_rows if r["is_broker"].lower() == "true"]
    categories = sorted({r["category_simple"] for r in inv_rows})

    # ------- 1. Inventory age — increment age_in_stock_days for Available
    for r in inv_rows:
        if r["status"] == "Available":
            try:
                r["age_in_stock_days"] = str(int(r["age_in_stock_days"]) + 1)
            except ValueError:
                pass

    # ------- 2. Sales: pick 3-7 available stones, sell them
    n_sales = rng.randint(3, 7)
    new_sales: list[dict[str, str]] = []
    sold_today: set[str] = set()
    sale_pool = [s for s in available if s["stock_id"] not in sold_today]
    rng.shuffle(sale_pool)
    for stone in sale_pool[:n_sales]:
        cust = rng.choice(end_customers) if end_customers else rng.choice(cust_rows)
        broker = (
            customers_by_id.get(cust["broker_id"]) if cust.get("broker_id") else None
        )
        ppc = float(stone["ppc"] or 0)
        carat = float(stone["carat"] or 1)
        # apply a 0–25% discount off list ppc
        discount_pct = round(rng.uniform(0, 25), 2)
        sold_ppc = round(ppc * (1 - discount_pct / 100), 2)
        sold_price = round(sold_ppc * carat, 2)
        cost_basis = float(stone["cost_basis"] or 0)
        gross_profit = round(sold_price - cost_basis, 2)
        terms = int(cust.get("payment_terms_days") or 60)
        due = today + dt.timedelta(days=terms)
        txn_id = next_id(sales_rows + new_sales, "transaction_id", "TXN", 5)
        inv_id = next_id(sales_rows + new_sales, "invoice_id", "INV", 5)
        new_sales.append({
            "transaction_id": txn_id,
            "transaction_date": today.isoformat(),
            "stock_id": stone["stock_id"],
            "category_simple": stone["category_simple"],
            "customer_id": cust["customer_id"],
            "broker_id": broker["customer_id"] if broker else "",
            "sold_price": str(sold_price),
            "sold_ppc": str(sold_ppc),
            "cost_at_sale": str(cost_basis),
            "gross_profit": str(gross_profit),
            "discount_pct": str(discount_pct),
            "customer_type": cust["customer_type"],
            "sales_channel": "Broker" if broker else "Direct",
            "destination_market": cust.get("market", ""),
            "payment_status": "Open",
            "invoice_id": inv_id,
            "invoice_date": today.isoformat(),
            "payment_terms_days": str(terms),
            "due_date": due.isoformat(),
            "quote_id": "",
            "memo_id": "",
        })
        # flip inventory status
        stone["status"] = "Sold"
        sold_today.add(stone["stock_id"])
    append_csv("sales_transactions_seed.csv", sales_fields, new_sales)
    counts["sales_transactions_seed.csv"] = len(new_sales)

    # ------- 3. Payments: settle any Open invoices whose due_date hits today
    invoices_paid = {p["invoice_id"] for p in pay_rows}
    new_payments: list[dict[str, str]] = []
    for s in sales_rows + new_sales:
        if s.get("payment_status") not in ("Open", "Partial"):
            continue
        if s["invoice_id"] in invoices_paid:
            continue
        try:
            due = dt.date.fromisoformat(s["due_date"])
        except (KeyError, ValueError):
            continue
        if due != today:
            continue
        # decide on-time vs late based on customer's payment score
        cust = customers_by_id.get(s["customer_id"])
        score = int(cust["payment_score"]) if cust and cust.get("payment_score") else 70
        if rng.random() < score / 100:
            offset = rng.randint(-7, 2)  # mostly early/on-time
            label = "Early" if offset < 0 else "On-Time"
            late_flag = "false"
        else:
            offset = rng.randint(3, 45)
            label = "Late"
            late_flag = "true"
        pay_date = due + dt.timedelta(days=offset)
        terms_type = cust.get("payment_terms", "Net 60") if cust else "Net 60"
        pay_id = next_id(pay_rows + new_payments, "payment_id", "PAY", 5)
        new_payments.append({
            "payment_id": pay_id,
            "invoice_id": s["invoice_id"],
            "customer_id": s["customer_id"],
            "order_id": "",
            "invoice_date": s["invoice_date"],
            "due_date": s["due_date"],
            "payment_date": pay_date.isoformat(),
            "payment_amount": s["sold_price"],
            "terms_type": terms_type,
            "days_early_late": str(offset),
            "payment_behavior_label": label,
            "late_incident_flag": late_flag,
            "month_bucket": s["invoice_date"][:7],
        })
        s["payment_status"] = "Paid"
    if any(s.get("payment_status") == "Paid" and s["transaction_date"] <= today.isoformat() for s in sales_rows):
        # rewrite sales file so payment_status flips are persisted
        write_csv("sales_transactions_seed.csv", sales_fields, sales_rows + new_sales)
    append_csv("payment_history_seed.csv", pay_fields, new_payments)
    counts["payment_history_seed.csv"] = len(new_payments)

    # ------- 4. Quotes: 4-8 new quotes against Available stones
    n_quotes = rng.randint(4, 8)
    still_available = [r for r in inv_rows if r["status"] == "Available"]
    rng.shuffle(still_available)
    new_quotes: list[dict[str, str]] = []
    new_threads: list[dict[str, str]] = []
    for stone in still_available[:n_quotes]:
        cust = rng.choice(cust_rows)
        ppc = float(stone["ppc"] or 0)
        carat = float(stone["carat"] or 1)
        list_price = round(ppc * carat, 2)
        base_disc = round(rng.uniform(0, 3), 2)
        pay_bonus = rng.choice([0, 0, 1, 1, 2])
        vol_disc = rng.choice([0, 3, 5, 10, 15])
        final_disc = round(base_disc + pay_bonus + vol_disc, 2)
        offered = round(list_price * (1 - final_disc / 100), 2)
        margin_pct = round(rng.uniform(8, 25), 2)
        thread_id = next_id(thread_rows + new_threads, "thread_id", "THRD", 5)
        quote_id = next_id(quote_rows + new_quotes, "quote_id", "QTE", 5)
        new_quotes.append({
            "quote_id": quote_id,
            "quote_date": today.isoformat(),
            "customer_id": cust["customer_id"],
            "stock_id": stone["stock_id"],
            "category_simple": stone["category_simple"],
            "list_price": str(list_price),
            "base_discount_pct": str(base_disc),
            "payment_bonus_discount_pct": str(pay_bonus),
            "volume_discount_pct": str(vol_disc),
            "final_discount_pct": str(final_disc),
            "offered_price": str(offered),
            "margin_pct": str(margin_pct),
            "approval_status": "Pending",
            "quote_outcome": "Negotiating",
            "tier_sent": rng.choice(["target", "stretch", "floor"]),
            "customer_offer": "",
            "final_agreed_price": "",
            "thread_id": thread_id,
        })
        new_threads.append({
            "thread_id": thread_id,
            "opened_date": today.isoformat() + "T00:00:00Z",
            "customer_id": cust["customer_id"],
            "stock_id": stone["stock_id"],
            "category_simple": stone["category_simple"],
            "memo_id": "",
            "quote_id": quote_id,
            "status": "Open",
            "last_message_date": today.isoformat() + "T00:00:00Z",
            "last_offer": str(offered),
            "closed_transaction_id": "",
        })
    append_csv("quotes_seed.csv", quote_fields, new_quotes)
    counts["quotes_seed.csv"] = len(new_quotes)

    # ------- 5. Memos: 0-2 new memo requests
    n_memos = rng.choices([0, 1, 2], weights=[3, 4, 2])[0]
    still_available = [r for r in inv_rows if r["status"] == "Available"]
    rng.shuffle(still_available)
    new_memos: list[dict[str, str]] = []
    for stone in still_available[:n_memos]:
        cust = rng.choice(end_customers) if end_customers else rng.choice(cust_rows)
        broker = (
            customers_by_id.get(cust["broker_id"])
            if cust.get("broker_id") else (rng.choice(brokers) if brokers else None)
        )
        hold_days = rng.choice([3, 5, 7, 10, 14])
        expiry = today + dt.timedelta(days=hold_days)
        memo_id = next_id(memo_rows + new_memos, "memo_id", "MEMO", 5)
        thread_id = next_id(thread_rows + new_threads, "thread_id", "THRD", 5)
        new_memos.append({
            "memo_id": memo_id,
            "request_date": today.isoformat() + "T00:00:00Z",
            "customer_id": cust["customer_id"],
            "broker_id": broker["customer_id"] if broker else "",
            "stock_id": stone["stock_id"],
            "requested_hold_days": str(hold_days),
            "decision": "Pending",
            "decision_date": "",
            "decision_reason": "",
            "condition_minimum_price": "",
            "condition_max_hold_days": "",
            "expiry_date": expiry.isoformat() + "T00:00:00Z",
            "closed_outcome": "",
            "closed_transaction_id": "",
            "marketplace_lock_status": "NotLocked",
            "thread_id": thread_id,
        })
        new_threads.append({
            "thread_id": thread_id,
            "opened_date": today.isoformat() + "T00:00:00Z",
            "customer_id": cust["customer_id"],
            "stock_id": stone["stock_id"],
            "category_simple": stone["category_simple"],
            "memo_id": memo_id,
            "quote_id": "",
            "status": "Open",
            "last_message_date": today.isoformat() + "T00:00:00Z",
            "last_offer": "",
            "closed_transaction_id": "",
        })
    append_csv("memos_seed.csv", memo_fields, new_memos)
    counts["memos_seed.csv"] = len(new_memos)

    append_csv("negotiation_threads_seed.csv", thread_fields, new_threads)
    counts["negotiation_threads_seed.csv"] = len(new_threads)

    # ------- 6. Communication logs: 5-12 messages tied to open threads
    all_threads = thread_rows + new_threads
    open_threads = [t for t in all_threads if t["status"] == "Open"]
    rng.shuffle(open_threads)
    n_msgs = rng.randint(5, 12)
    new_msgs: list[dict[str, str]] = []
    sample_notes = [
        "Customer requested certificate details.",
        "Asked about additional discount for volume.",
        "Inquired about matching pair availability.",
        "Confirmed shipping address for memo dispatch.",
        "Requested 24h to consult buyer.",
        "Pushed back on price; asked for 5% more off.",
        "Confirmed interest, awaiting final approval internally.",
        "Asked for video link of the stone.",
        "Wants to combine with previous order for shipping.",
        "Considering alternate stone in same category.",
    ]
    for t in open_threads[:n_msgs]:
        cust = customers_by_id.get(t["customer_id"])
        direction = rng.choice(["Inbound", "Outbound"])
        msg_id = next_id(msg_rows + new_msgs, "message_id", "MSG", 5)
        hour = rng.randint(8, 19)
        minute = rng.randint(0, 59)
        ts = f"{today.isoformat()}T{hour:02d}:{minute:02d}:00Z"
        new_msgs.append({
            "message_id": msg_id,
            "message_date": ts,
            "thread_id": t["thread_id"],
            "customer_id": t["customer_id"],
            "stock_id": t["stock_id"],
            "counterparty_name": cust["customer_name"] if cust else "Partner",
            "counterparty_type": cust["customer_type"] if cust else "Dealer",
            "channel": rng.choice(["In-App", "Email", "WhatsApp", "Phone"]),
            "direction": direction,
            "category_simple": t["category_simple"],
            "quoted_price": t.get("last_offer", "") or "",
            "negotiated_price": t.get("last_offer", "") or "",
            "quantity_requested": "1",
            "negotiation_status": "Open",
            "notes": rng.choice(sample_notes),
        })
        t["last_message_date"] = ts
    append_csv("communication_logs_seed.csv", msg_fields, new_msgs)
    counts["communication_logs_seed.csv"] = len(new_msgs)

    # ------- 7. Demand signals: one row per category for today
    new_demand: list[dict[str, str]] = []
    # build a recent baseline by category from existing demand rows
    recent_by_cat: dict[str, list[dict[str, str]]] = {}
    for r in demand_rows[-2000:]:
        recent_by_cat.setdefault(r["category_simple"], []).append(r)
    for cat in categories:
        recent = recent_by_cat.get(cat, [])
        if recent:
            avg_listing = sum(int(r["listing_count"]) for r in recent[-7:]) / max(1, min(7, len(recent)))
            avg_price = sum(float(r["avg_market_price"]) for r in recent[-7:]) / max(1, min(7, len(recent)))
            avg_demand = sum(float(r["demand_score"]) for r in recent[-7:]) / max(1, min(7, len(recent)))
        else:
            avg_listing, avg_price, avg_demand = 50, 1500.0, 0.5
        new_demand.append({
            "signal_date": today.isoformat(),
            "category_simple": cat,
            "listing_count": str(max(0, int(avg_listing + rng.gauss(0, 4)))),
            "avg_market_price": str(round(max(50.0, avg_price * (1 + rng.gauss(0, 0.02))), 2)),
            "demand_score": str(round(max(0.0, min(1.0, avg_demand + rng.gauss(0, 0.04))), 2)),
        })
    append_csv("demand_signals_seed.csv", demand_fields, new_demand)
    counts["demand_signals_seed.csv"] = len(new_demand)

    # ------- Rewrite inventory (age increments + status flips)
    write_csv("inventory_seed.csv", inv_fields, inv_rows)
    counts["inventory_seed.csv"] = 0  # in-place mutations, not appends

    return counts


# ---------------------------------------------------------------------------
# Weekly tick: new Rap sheet + new forecast row per category
# ---------------------------------------------------------------------------


def weekly_tick(today: dt.date, rng: random.Random) -> dict[str, int]:
    counts: dict[str, int] = {}

    rap_fields, rap_rows = read_csv("rap_weekly_seed.csv")
    fc_fields, fc_rows = read_csv("forecast_outputs_seed.csv")
    inv_fields, inv_rows = read_csv("inventory_seed.csv")
    sales_fields, sales_rows = read_csv("sales_transactions_seed.csv")

    categories = sorted({r["category_simple"] for r in inv_rows})

    # Find the latest rap_per_carat per category to extend from
    latest_rap: dict[str, float] = {}
    for r in rap_rows:
        try:
            latest_rap[r["category_simple"]] = float(r["rap_per_carat"])
        except (KeyError, ValueError):
            pass

    new_rap: list[dict[str, str]] = []
    for cat in categories:
        base = latest_rap.get(cat)
        if base is None:
            continue
        wow = rng.gauss(0, 1.5)  # ±~1.5% weekly drift
        new_rate = round(base * (1 + wow / 100), 2)
        new_rap.append({
            "rap_week": today.isoformat(),
            "category_simple": cat,
            "rap_per_carat": str(new_rate),
            "wow_change_pct": str(round(wow, 2)),
            "source": "Simulated RapNet",
        })
    append_csv("rap_weekly_seed.csv", rap_fields, new_rap)
    counts["rap_weekly_seed.csv"] = len(new_rap)

    # Forecast — one row per category with a 4-week forward look
    sales_by_cat_recent: dict[str, int] = {}
    cutoff = today - dt.timedelta(days=30)
    for s in sales_rows:
        try:
            d = dt.date.fromisoformat(s["transaction_date"])
        except ValueError:
            continue
        if d >= cutoff:
            sales_by_cat_recent[s["category_simple"]] = sales_by_cat_recent.get(s["category_simple"], 0) + 1

    new_fc: list[dict[str, str]] = []
    for cat in categories:
        ty = sales_by_cat_recent.get(cat, 0)
        ly = max(1, int(ty * rng.uniform(0.7, 1.3)))
        prior = max(1, int(ly * rng.uniform(0.8, 1.2)))
        growth = (ty - ly) / ly if ly else 0
        predicted = max(0, int(ty * (1 + growth) + rng.gauss(0, 2)))
        base_rap = latest_rap.get(cat, 1000)
        new_fc.append({
            "forecast_date": today.isoformat(),
            "category_simple": cat,
            "ty_qty": str(ty),
            "ly_qty": str(ly),
            "prior_period_qty": str(prior),
            "growth_rate_pct": str(round(growth, 4)),
            "predicted_quantity": str(predicted),
            "predicted_price_range_min": str(round(base_rap * 0.7, 2)),
            "predicted_price_range_max": str(round(base_rap * 1.3, 2)),
            "confidence_score": str(round(rng.uniform(0.6, 0.95), 2)),
            "recommended_sourcing_qty": str(max(0, predicted - ty)),
        })
    append_csv("forecast_outputs_seed.csv", fc_fields, new_fc)
    counts["forecast_outputs_seed.csv"] = len(new_fc)

    return counts


# ---------------------------------------------------------------------------
# Snapshot / load — capture or restore a named CSV state
# ---------------------------------------------------------------------------


def cmd_snapshot(name: str) -> None:
    dest = SCENARIOS / name
    dest.mkdir(parents=True, exist_ok=True)
    for fname in CSV_FILES:
        src = RAW / fname
        if src.exists():
            shutil.copy2(src, dest / fname)
    # also stash the sim clock so the scenario remembers "what day is it"
    if STATE_FILE.exists():
        shutil.copy2(STATE_FILE, dest / "sim_state.json")
    today = current_sim_date()
    (dest / "README.txt").write_text(
        f"Scenario: {name}\nSim date: {today.isoformat()}\n"
    )
    print(f"Snapshotted {len(CSV_FILES)} CSVs → data/scenarios/{name}/ (sim date {today})")


def cmd_load(name: str) -> None:
    src = SCENARIOS / name
    if not src.exists():
        sys.exit(f"No scenario at {src}")
    for fname in CSV_FILES:
        f = src / fname
        if f.exists():
            shutil.copy2(f, RAW / fname)
    state_src = src / "sim_state.json"
    if state_src.exists():
        WORKING.mkdir(parents=True, exist_ok=True)
        shutil.copy2(state_src, STATE_FILE)
    elif STATE_FILE.exists():
        STATE_FILE.unlink()
    print(f"Loaded data/scenarios/{name}/ → data/raw/")


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def cmd_status() -> None:
    state = load_state()
    today = current_sim_date()
    print(f"Sim clock: {today.isoformat()}")
    print(f"Last advanced: {state.get('last_run', '<never>')}")
    print()
    for name in CSV_FILES:
        path = RAW / name
        if not path.exists():
            continue
        with path.open() as f:
            n = sum(1 for _ in f) - 1
        print(f"  {name:<35s} {n:>6d} rows")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--reset", action="store_true", help="restore baseline seeds")
    g.add_argument("--daily", action="store_true", help="advance one day")
    g.add_argument("--weekly", action="store_true", help="weekly Rap + forecast drop only")
    g.add_argument("--days", type=int, help="advance N days (weekly fires every Monday)")
    g.add_argument("--status", action="store_true", help="show sim clock + row counts")
    g.add_argument("--snapshot", metavar="NAME", help="freeze current CSVs into data/scenarios/NAME/")
    g.add_argument("--load", metavar="NAME", help="restore CSVs from data/scenarios/NAME/")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed (for reproducibility)")
    args = ap.parse_args()

    rng = random.Random(args.seed)

    if args.reset:
        cmd_reset()
        return 0
    if args.status:
        cmd_status()
        return 0
    if args.snapshot:
        cmd_snapshot(args.snapshot)
        return 0
    if args.load:
        cmd_load(args.load)
        return 0

    today = current_sim_date()

    if args.weekly:
        counts = weekly_tick(today, rng)
        print(f"Weekly tick @ {today.isoformat()}")
        for k, v in counts.items():
            print(f"  + {v:>4d}  {k}")
        save_state({"today": today.isoformat(), "last_run": dt.datetime.now().isoformat()})
        return 0

    n_days = args.days if args.days else 1
    for i in range(n_days):
        counts = daily_tick(today, rng)
        # Monday weekly drop
        if today.weekday() == 0:
            wc = weekly_tick(today, rng)
            counts.update({f"[weekly] {k}": v for k, v in wc.items()})
        print(f"Daily tick @ {today.isoformat()}")
        for k, v in counts.items():
            if v:
                print(f"  + {v:>4d}  {k}")
        today += dt.timedelta(days=1)

    save_state({"today": today.isoformat(), "last_run": dt.datetime.now().isoformat()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
