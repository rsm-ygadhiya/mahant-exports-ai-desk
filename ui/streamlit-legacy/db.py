"""Database layer — SQLite via stdlib sqlite3.

All reads/writes go through this module. Skills read via polars;
app pages read/write via this module's helpers.

On first run, call init_db() which creates all tables and seeds them
from the Milestone_2 CSV files.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

import polars as pl

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DATA_DIR  = _REPO_ROOT / "data" / "Milestone_2"
_DB_PATH   = _DATA_DIR / "app.db"


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

@contextmanager
def get_conn():
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS inventory (
    stock_id TEXT PRIMARY KEY,
    sr_no INTEGER,
    add_date TEXT,
    rep_date TEXT,
    age_in_stock_days INTEGER,
    status TEXT,
    report_no TEXT,
    shape TEXT,
    carat REAL,
    color TEXT,
    clarity TEXT,
    cut TEXT,
    polish TEXT,
    sym TEXT,
    category_simple TEXT,
    rap REAL,
    discounts_pct REAL,
    ppc REAL,
    p_pcs REAL,
    cost_basis REAL,
    measurement TEXT,
    table_pct REAL,
    depth_pct REAL,
    c_a REAL,
    fl TEXT,
    growth_type TEXT,
    video TEXT,
    image TEXT,
    lab TEXT,
    inscri TEXT,
    location TEXT,
    country_of_origin TEXT,
    shade TEXT,
    luster TEXT,
    eyeclean TEXT,
    milky TEXT
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY,
    customer_name TEXT,
    is_broker TEXT,
    broker_id TEXT,
    customer_type TEXT,
    market TEXT,
    join_date TEXT,
    relationship_owner TEXT,
    payment_terms_days INTEGER,
    payment_terms TEXT,
    payment_score REAL,
    active_status TEXT,
    annual_spend REAL,
    avg_order_value REAL,
    purchase_frequency REAL,
    gross_margin_pct REAL,
    account_lifespan_years REAL,
    churn_risk_pct REAL,
    raw_clv REAL,
    risk_adjusted_clv REAL,
    clv_tier TEXT
);

CREATE TABLE IF NOT EXISTS memos (
    memo_id TEXT PRIMARY KEY,
    request_date TEXT,
    customer_id TEXT,
    broker_id TEXT,
    stock_id TEXT,
    requested_hold_days INTEGER,
    decision TEXT DEFAULT 'Pending',
    decision_date TEXT,
    decision_reason TEXT,
    condition_minimum_price REAL,
    condition_max_hold_days INTEGER,
    expiry_date TEXT,
    closed_outcome TEXT,
    closed_transaction_id TEXT,
    marketplace_lock_status TEXT DEFAULT 'NotLocked',
    thread_id TEXT
);

CREATE TABLE IF NOT EXISTS quotes (
    quote_id TEXT PRIMARY KEY,
    quote_date TEXT,
    customer_id TEXT,
    stock_id TEXT,
    category_simple TEXT,
    list_price REAL,
    base_discount_pct REAL,
    payment_bonus_discount_pct REAL,
    volume_discount_pct REAL,
    final_discount_pct REAL,
    offered_price REAL,
    margin_pct REAL,
    approval_status TEXT,
    quote_outcome TEXT,
    tier_sent TEXT,
    customer_offer REAL,
    final_agreed_price REAL,
    thread_id TEXT
);

CREATE TABLE IF NOT EXISTS sales_transactions (
    transaction_id TEXT PRIMARY KEY,
    transaction_date TEXT,
    stock_id TEXT,
    category_simple TEXT,
    customer_id TEXT,
    broker_id TEXT,
    sold_price REAL,
    sold_ppc REAL,
    cost_at_sale REAL,
    gross_profit REAL,
    discount_pct REAL,
    customer_type TEXT,
    sales_channel TEXT,
    destination_market TEXT,
    payment_status TEXT,
    invoice_id TEXT,
    invoice_date TEXT,
    payment_terms_days INTEGER,
    due_date TEXT,
    quote_id TEXT,
    memo_id TEXT
);

CREATE TABLE IF NOT EXISTS payment_history (
    payment_id TEXT PRIMARY KEY,
    invoice_id TEXT,
    customer_id TEXT,
    order_id TEXT,
    invoice_date TEXT,
    due_date TEXT,
    payment_date TEXT,
    payment_amount REAL,
    terms_type TEXT,
    days_early_late INTEGER,
    payment_behavior_label TEXT,
    late_incident_flag TEXT,
    month_bucket TEXT
);

CREATE TABLE IF NOT EXISTS demand_signals (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_date TEXT,
    category_simple TEXT,
    listing_count INTEGER,
    avg_market_price REAL,
    demand_score REAL
);

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id TEXT PRIMARY KEY,
    customer_id TEXT,
    stock_id TEXT,
    quote_id TEXT,
    transaction_id TEXT,
    invoice_date TEXT,
    due_date TEXT,
    amount REAL,
    payment_terms_days INTEGER,
    payment_status TEXT DEFAULT 'Open',
    amount_paid REAL DEFAULT 0.0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketplace_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pushed_at TEXT DEFAULT (datetime('now')),
    pushed_by TEXT,
    stones_pushed INTEGER,
    stones_excluded INTEGER,
    platform TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS triage_tags (
    stock_id TEXT PRIMARY KEY,
    action_tag TEXT,
    tagged_at TEXT DEFAULT (datetime('now')),
    approved_by TEXT
);

CREATE TABLE IF NOT EXISTS skill_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT,
    run_at TEXT DEFAULT (datetime('now')),
    run_by TEXT,
    status TEXT,
    result_summary TEXT
);

CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sent_at TEXT DEFAULT (datetime('now')),
    recipient_id TEXT,
    subject TEXT,
    body TEXT,
    email_type TEXT
);

CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


# ---------------------------------------------------------------------------
# Init + seed
# ---------------------------------------------------------------------------

def init_db(force_reseed: bool = False) -> None:
    """Create tables and seed from CSVs if not already done."""
    with get_conn() as conn:
        conn.executescript(_SCHEMA)

    # Check if already seeded
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM _meta WHERE key='seeded'"
        ).fetchone()
        already_seeded = row is not None and not force_reseed

    if already_seeded:
        return

    _seed_table("inventory",          _DATA_DIR / "inventory_seed.csv")
    _seed_table("customers",          _DATA_DIR / "customers_seed.csv")
    _seed_table("memos",              _DATA_DIR / "memos_seed.csv")
    _seed_table("quotes",             _DATA_DIR / "quotes_seed.csv")
    _seed_table("sales_transactions", _DATA_DIR / "sales_transactions_seed.csv")
    _seed_table("payment_history",    _DATA_DIR / "payment_history_seed.csv")
    _seed_table("demand_signals",     _DATA_DIR / "demand_signals_seed.csv")
    _seed_invoices_from_sales()

    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('seeded','1')"
        )


def _seed_table(table: str, csv_path: Path) -> None:
    if not csv_path.exists():
        return
    df = pl.read_csv(csv_path, infer_schema_length=500, null_values=["", "NA", "N/A"])
    rows = df.to_dicts()
    if not rows:
        return
    cols = list(rows[0].keys())
    placeholders = ", ".join(["?"] * len(cols))
    col_names    = ", ".join(cols)
    sql = f"INSERT OR IGNORE INTO {table} ({col_names}) VALUES ({placeholders})"
    with get_conn() as conn:
        conn.execute(f"DELETE FROM {table}")
        conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])


def _seed_invoices_from_sales() -> None:
    """Build the invoices table from sales_transactions (unique invoice_ids)."""
    csv_path = _DATA_DIR / "sales_transactions_seed.csv"
    if not csv_path.exists():
        return
    df = pl.read_csv(csv_path, null_values=["", "NA"])
    inv = (
        df.filter(pl.col("invoice_id").is_not_null())
        .select([
            "invoice_id", "customer_id", "stock_id",
            pl.col("quote_id").alias("quote_id"),
            pl.col("transaction_id").alias("transaction_id"),
            "invoice_date", "due_date",
            pl.col("sold_price").alias("amount"),
            "payment_terms_days",
            "payment_status",
        ])
        .unique("invoice_id")
    )
    rows = inv.to_dicts()
    with get_conn() as conn:
        conn.execute("DELETE FROM invoices")
        conn.executemany(
            """INSERT OR IGNORE INTO invoices
               (invoice_id,customer_id,stock_id,quote_id,transaction_id,
                invoice_date,due_date,amount,payment_terms_days,payment_status)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            [(r["invoice_id"], r["customer_id"], r["stock_id"],
              r.get("quote_id"), r.get("transaction_id"),
              r["invoice_date"], r["due_date"], r["amount"],
              r["payment_terms_days"], r["payment_status"]) for r in rows]
        )


# ---------------------------------------------------------------------------
# Generic read helper → polars DataFrame
# ---------------------------------------------------------------------------

def read_table(table: str, where: str = "", params: tuple = ()) -> pl.DataFrame:
    sql = f"SELECT * FROM {table}"
    if where:
        sql += f" WHERE {where}"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        if not rows:
            return pl.DataFrame()
        keys = rows[0].keys()
        return pl.DataFrame([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Inventory helpers
# ---------------------------------------------------------------------------

def update_inventory_price(stock_id: str, new_price: float, updated_by: str = "admin") -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE inventory SET p_pcs=? WHERE stock_id=?",
            (new_price, stock_id)
        )


def update_inventory_status(stock_id: str, new_status: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE inventory SET status=? WHERE stock_id=?",
            (new_status, stock_id)
        )


def apply_repricing_batch(rows: list[dict]) -> int:
    """Apply a list of {stock_id, new_price} dicts. Returns count updated."""
    with get_conn() as conn:
        conn.executemany(
            "UPDATE inventory SET p_pcs=? WHERE stock_id=?",
            [(r["proposed_price"], r["stock_id"]) for r in rows]
        )
    return len(rows)


# ---------------------------------------------------------------------------
# Memo helpers
# ---------------------------------------------------------------------------

def create_memo(memo_id: str, customer_id: str, broker_id: str,
                stock_id: str, hold_days: int, expiry_date: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO memos
               (memo_id,request_date,customer_id,broker_id,stock_id,
                requested_hold_days,expiry_date,decision,marketplace_lock_status)
               VALUES (datetime('now'),datetime('now'),?,?,?,?,?,'Pending','NotLocked')""",
            (customer_id, broker_id, stock_id, hold_days, expiry_date)
        )


def update_memo_decision(memo_id: str, decision: str, reason: str,
                         cond_price: float | None = None,
                         cond_hold: int | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            """UPDATE memos SET
               decision=?, decision_date=datetime('now'), decision_reason=?,
               condition_minimum_price=?, condition_max_hold_days=?,
               marketplace_lock_status=?
               WHERE memo_id=?""",
            (decision, reason, cond_price, cond_hold,
             "Locked" if decision in ("Approved","ApprovedWithConditions") else "NotLocked",
             memo_id)
        )
        if decision in ("Approved", "ApprovedWithConditions"):
            stock_id_row = conn.execute(
                "SELECT stock_id FROM memos WHERE memo_id=?", (memo_id,)
            ).fetchone()
            if stock_id_row:
                conn.execute(
                    "UPDATE inventory SET status='OnMemo' WHERE stock_id=?",
                    (stock_id_row["stock_id"],)
                )


# ---------------------------------------------------------------------------
# Quote helpers
# ---------------------------------------------------------------------------

def update_quote_counter(quote_id: str, customer_offer: float) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE quotes SET customer_offer=?, quote_outcome='Negotiating' WHERE quote_id=?",
            (customer_offer, quote_id)
        )


def update_quote_outcome(quote_id: str, outcome: str,
                         final_price: float | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE quotes SET quote_outcome=?, final_agreed_price=? WHERE quote_id=?",
            (outcome, final_price, quote_id)
        )


# ---------------------------------------------------------------------------
# Invoice helpers
# ---------------------------------------------------------------------------

def create_invoice(invoice_id: str, customer_id: str, stock_id: str,
                   amount: float, due_date: str,
                   payment_terms_days: int = 30,
                   quote_id: str | None = None) -> None:
    import datetime as dt
    today = dt.date.today().isoformat()
    with get_conn() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO invoices
               (invoice_id,customer_id,stock_id,quote_id,
                invoice_date,due_date,amount,payment_terms_days,payment_status)
               VALUES (?,?,?,?,?,?,?,?,'Open')""",
            (invoice_id, customer_id, stock_id, quote_id,
             today, due_date, amount, payment_terms_days)
        )


def record_payment(invoice_id: str, amount_paid: float,
                   payment_date: str | None = None) -> None:
    import datetime as dt
    payment_date = payment_date or dt.date.today().isoformat()
    with get_conn() as conn:
        conn.execute(
            """UPDATE invoices SET
               amount_paid = amount_paid + ?,
               payment_status = CASE
                   WHEN amount_paid + ? >= amount THEN 'Paid'
                   ELSE 'Partial'
               END
               WHERE invoice_id=?""",
            (amount_paid, amount_paid, invoice_id)
        )
        # Also log to payment_history
        conn.execute(
            """INSERT INTO payment_history
               (payment_id,invoice_id,customer_id,payment_date,payment_amount,
                payment_behavior_label,late_incident_flag,month_bucket)
               SELECT
                 'PAY-'||invoice_id||'-'||?,
                 invoice_id, customer_id, ?, ?,
                 'OnTime', 'false',
                 substr(?,1,7)
               FROM invoices WHERE invoice_id=?""",
            (payment_date, payment_date, amount_paid, payment_date, invoice_id)
        )


# ---------------------------------------------------------------------------
# Triage tag helpers
# ---------------------------------------------------------------------------

def save_triage_tags(tags: list[dict], approved_by: str = "admin") -> int:
    with get_conn() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO triage_tags(stock_id,action_tag,approved_by)
               VALUES (?,?,?)""",
            [(r["stock_id"], r["action_tag"], approved_by) for r in tags]
        )
    return len(tags)


# ---------------------------------------------------------------------------
# Marketplace log
# ---------------------------------------------------------------------------

def log_marketplace_push(pushed_by: str, stones_pushed: int,
                          stones_excluded: int, platform: str,
                          notes: str = "") -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO marketplace_log
               (pushed_by,stones_pushed,stones_excluded,platform,notes)
               VALUES (?,?,?,?,?)""",
            (pushed_by, stones_pushed, stones_excluded, platform, notes)
        )


# ---------------------------------------------------------------------------
# Email log
# ---------------------------------------------------------------------------

def log_email(recipient_id: str, subject: str, body: str,
              email_type: str = "reminder") -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO email_log(recipient_id,subject,body,email_type)
               VALUES (?,?,?,?)""",
            (recipient_id, subject, body, email_type)
        )


# ---------------------------------------------------------------------------
# Skill run log
# ---------------------------------------------------------------------------

def log_skill_run(skill_name: str, run_by: str,
                  status: str, summary: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO skill_runs(skill_name,run_by,status,result_summary)
               VALUES (?,?,?,?)""",
            (skill_name, run_by, status, summary)
        )


def last_skill_run(skill_name: str, status: str | None = None) -> dict | None:
    """Return the most recent skill_runs row for this skill (optionally
    filtered by status), or None if there is no matching row."""
    sql = "SELECT id, skill_name, run_by, status, result_summary, run_at FROM skill_runs WHERE skill_name=?"
    params: tuple = (skill_name,)
    if status is not None:
        sql += " AND status=?"
        params = (skill_name, status)
    sql += " ORDER BY run_at DESC LIMIT 1"
    with get_conn() as conn:
        row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# KPI helpers (used by dashboard)
# ---------------------------------------------------------------------------

def kpis() -> dict:
    with get_conn() as conn:
        inv      = conn.execute("SELECT COUNT(*) FROM inventory WHERE status='Available'").fetchone()[0]
        on_memo  = conn.execute("SELECT COUNT(*) FROM inventory WHERE status='OnMemo'").fetchone()[0]
        pending_memos = conn.execute("SELECT COUNT(*) FROM memos WHERE decision='Pending'").fetchone()[0]
        open_quotes   = conn.execute("SELECT COUNT(*) FROM quotes WHERE quote_outcome='Negotiating'").fetchone()[0]
        overdue_inv   = conn.execute(
            "SELECT COUNT(*) FROM invoices WHERE payment_status NOT IN ('Paid') "
            "AND due_date < date('now')"
        ).fetchone()[0]
        total_outstanding = conn.execute(
            "SELECT COALESCE(SUM(amount - amount_paid),0) FROM invoices "
            "WHERE payment_status NOT IN ('Paid')"
        ).fetchone()[0]
    return {
        "available_stones": inv,
        "on_memo": on_memo,
        "pending_memos": pending_memos,
        "open_quotes": open_quotes,
        "overdue_invoices": overdue_inv,
        "total_outstanding": total_outstanding,
    }
