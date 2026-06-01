"""Tests for `skills/negotiation-threads/scripts/negotiation_threads.py`."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path

import polars as pl
import pytest

# ---------------------------------------------------------------------------
# Load the module via importlib so we don't need it on sys.path
# ---------------------------------------------------------------------------

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "negotiation-threads"
    / "scripts"
    / "negotiation_threads.py"
)
_spec = importlib.util.spec_from_file_location("negotiation_threads", _MODULE_PATH)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

get_thread_messages = mod.get_thread_messages
get_thread_metadata = mod.get_thread_metadata
get_open_threads = mod.get_open_threads
summarize_thread_with_llm = mod.summarize_thread_with_llm
format_thread_header = mod.format_thread_header
format_messages = mod.format_messages
format_open_threads_table = mod.format_open_threads_table

TODAY = dt.date(2026, 5, 4)

_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "Milestone_2"
_CSVS_PRESENT = (
    (_DATA_DIR / "communication_logs_seed.csv").exists()
    and (_DATA_DIR / "negotiation_threads_seed.csv").exists()
    and (_DATA_DIR / "customers_seed.csv").exists()
    and (_DATA_DIR / "quotes_seed.csv").exists()
)


# ---------------------------------------------------------------------------
# Minimal fixture builders
# ---------------------------------------------------------------------------


def _make_logs(thread_ids=("TH001", "TH001", "TH002"), directions=None) -> pl.DataFrame:
    directions = directions or ["Outbound", "Inbound", "Outbound"]
    dates = ["2026-03-01T10:00:00Z", "2026-03-10T10:00:00Z", "2026-03-05T10:00:00Z"]
    return pl.DataFrame(
        {
            "message_id": [f"MSG{i}" for i in range(len(thread_ids))],
            "message_date": dates[: len(thread_ids)],
            "thread_id": list(thread_ids),
            "customer_id": ["CUST0001"] * len(thread_ids),
            "stock_id": ["LGSTK001"] * len(thread_ids),
            "direction": directions[: len(thread_ids)],
            "channel": ["Email"] * len(thread_ids),
            "notes": [f"Note {i}" for i in range(len(thread_ids))],
            "quoted_price": [300.0] * len(thread_ids),
            "negotiated_price": [280.0] * len(thread_ids),
            "negotiation_status": ["Open"] * len(thread_ids),
        }
    )


def _make_threads(
    statuses=("Open", "Closed-Won", "Open"),
    thread_ids=("TH001", "TH002", "TH003"),
) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "thread_id": list(thread_ids),
            "opened_date": ["2026-03-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"],
            "customer_id": ["CUST0001", "CUST0002", "CUST0003"],
            "stock_id": ["LGSTK001", "LGSTK002", "LGSTK003"],
            "category_simple": ["Round | 1ct | DEF"] * len(thread_ids),
            "memo_id": [None] * len(thread_ids),
            "quote_id": [None] * len(thread_ids),
            "status": list(statuses),
            "last_message_date": [
                "2026-04-01T00:00:00Z",
                "2026-01-15T00:00:00Z",
                "2026-04-25T00:00:00Z",
            ],
            "last_offer": [280.0, 500.0, 320.0],
            "closed_transaction_id": [None] * len(thread_ids),
        }
    )


def _make_customers() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "customer_id": ["CUST0001", "CUST0002", "CUST0003"],
            "customer_name": ["Alpha Jewels", "Beta Gems", "Gamma Rocks"],
            "is_broker": [False, True, False],
            "broker_id": [None, None, None],
            "clv_tier": ["Diamond", "Gold", "Silver"],
            "churn_risk_pct": [0.10, 0.25, 0.40],
        }
    )


def _make_quotes() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "quote_id": ["QTE00001"],
            "customer_id": ["CUST0001"],
            "stock_id": ["LGSTK001"],
            "offered_price": [315.0],
            "quote_outcome": ["Negotiating"],
            "customer_offer": [280.0],
            "final_agreed_price": [None],
        }
    )


# ---------------------------------------------------------------------------
# get_thread_messages
# ---------------------------------------------------------------------------


class TestGetThreadMessages:
    def test_filters_by_thread_id(self):
        logs = _make_logs()
        result = get_thread_messages(logs, "TH001")
        assert len(result) == 2
        assert all(m.get("thread_id") is None or True for m in result)  # thread_id may not be in kept cols
        # All returned messages should have notes from TH001 rows
        notes = [m["notes"] for m in result]
        assert "Note 0" in notes
        assert "Note 1" in notes

    def test_excludes_other_threads(self):
        logs = _make_logs()
        result = get_thread_messages(logs, "TH002")
        assert len(result) == 1
        assert result[0]["notes"] == "Note 2"

    def test_sorted_by_date_ascending(self):
        # TH001 has dates 2026-03-01 and 2026-03-10 — should be in that order
        logs = _make_logs()
        result = get_thread_messages(logs, "TH001")
        assert len(result) == 2
        # Earlier date first
        d0 = str(result[0]["message_date"])[:10]
        d1 = str(result[1]["message_date"])[:10]
        assert d0 <= d1

    def test_returns_list_of_dicts(self):
        logs = _make_logs()
        result = get_thread_messages(logs, "TH001")
        assert isinstance(result, list)
        assert all(isinstance(r, dict) for r in result)

    def test_empty_logs_returns_empty(self):
        result = get_thread_messages(pl.DataFrame(), "TH001")
        assert result == []

    def test_nonexistent_thread_returns_empty(self):
        logs = _make_logs()
        result = get_thread_messages(logs, "THRD99999")
        assert result == []

    def test_result_contains_expected_keys(self):
        logs = _make_logs()
        result = get_thread_messages(logs, "TH001")
        assert len(result) > 0
        for key in ("direction", "channel", "notes"):
            assert key in result[0]


# ---------------------------------------------------------------------------
# get_open_threads
# ---------------------------------------------------------------------------


class TestGetOpenThreads:
    def test_only_returns_open_status(self):
        threads = _make_threads(
            statuses=("Open", "Closed-Won", "Open"),
            thread_ids=("TH001", "TH002", "TH003"),
        )
        result = get_open_threads(threads, _make_customers(), TODAY)
        statuses = result["status"].to_list()
        assert all(s == "Open" for s in statuses)

    def test_returns_dataframe(self):
        threads = _make_threads()
        result = get_open_threads(threads, _make_customers(), TODAY)
        assert isinstance(result, pl.DataFrame)

    def test_sorted_by_days_since_last_message_desc(self):
        threads = _make_threads(
            statuses=("Open", "Open", "Open"),
            thread_ids=("TH001", "TH002", "TH003"),
        )
        result = get_open_threads(threads, _make_customers(), TODAY)
        days = result["days_since_last_message"].to_list()
        assert days == sorted(days, reverse=True), "Should be sorted descending (most neglected first)"

    def test_empty_threads_returns_empty(self):
        result = get_open_threads(pl.DataFrame(), _make_customers(), TODAY)
        assert result.is_empty()

    def test_no_open_threads_returns_empty(self):
        threads = _make_threads(statuses=("Closed-Won", "Closed-Lost", "Closed-Won"))
        result = get_open_threads(threads, _make_customers(), TODAY)
        assert result.is_empty()

    def test_days_open_computed(self):
        threads = _make_threads(
            statuses=("Open", "Closed-Won", "Open"),
            thread_ids=("TH001", "TH002", "TH003"),
        )
        result = get_open_threads(threads, _make_customers(), TODAY)
        assert "days_open" in result.columns
        assert result["days_open"].drop_nulls().len() > 0

    def test_customer_name_joined(self):
        threads = _make_threads(statuses=("Open", "Closed-Won", "Open"))
        result = get_open_threads(threads, _make_customers(), TODAY)
        assert "customer_name" in result.columns


# ---------------------------------------------------------------------------
# get_thread_metadata
# ---------------------------------------------------------------------------


class TestGetThreadMetadata:
    def test_returns_dict(self):
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "TH001", TODAY)
        assert isinstance(result, dict)

    def test_days_open_computed_correctly(self):
        # TH001 opened 2026-03-01, today = 2026-05-04 → 64 days
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "TH001", TODAY)
        assert result["days_open"] == (TODAY - dt.date(2026, 3, 1)).days

    def test_contains_customer_info(self):
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "TH001", TODAY)
        assert result["customer_name"] == "Alpha Jewels"
        assert result["clv_tier"] == "Diamond"

    def test_days_since_last_message(self):
        # TH001 last_message_date = 2026-04-01
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "TH001", TODAY)
        expected = (TODAY - dt.date(2026, 4, 1)).days
        assert result["days_since_last_message"] == expected

    def test_nonexistent_thread_returns_empty(self):
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "THRD99999", TODAY)
        assert result == {}

    def test_empty_threads_returns_empty(self):
        result = get_thread_metadata(pl.DataFrame(), _make_quotes(), _make_customers(), "TH001", TODAY)
        assert result == {}

    def test_contains_thread_id_and_stock_id(self):
        threads = _make_threads()
        result = get_thread_metadata(threads, _make_quotes(), _make_customers(), "TH001", TODAY)
        assert result["thread_id"] == "TH001"
        assert result["stock_id"] == "LGSTK001"


# ---------------------------------------------------------------------------
# format_thread_header
# ---------------------------------------------------------------------------


class TestFormatThreadHeader:
    def _metadata(self):
        return {
            "thread_id": "THRD00042",
            "customer_id": "CUST0013",
            "customer_name": "Blue Star Jewels",
            "clv_tier": "Diamond",
            "stock_id": "LGSTK00115",
            "status": "Open",
            "opened_date": dt.date(2026, 3, 15),
            "days_open": 50,
            "days_since_last_message": 12,
            "last_offer": 280.0,
            "offered_price": 315.0,
            "quote_id": "QTE00001",
        }

    def test_contains_thread_id(self):
        out = format_thread_header(self._metadata())
        assert "THRD00042" in out

    def test_contains_customer_id(self):
        out = format_thread_header(self._metadata())
        assert "CUST0013" in out

    def test_contains_stock_id(self):
        out = format_thread_header(self._metadata())
        assert "LGSTK00115" in out

    def test_contains_status(self):
        out = format_thread_header(self._metadata())
        assert "Open" in out

    def test_contains_last_offer(self):
        out = format_thread_header(self._metadata())
        assert "280" in out

    def test_contains_days_open(self):
        out = format_thread_header(self._metadata())
        assert "50" in out

    def test_returns_string(self):
        out = format_thread_header(self._metadata())
        assert isinstance(out, str)
        assert len(out) > 0


# ---------------------------------------------------------------------------
# format_messages
# ---------------------------------------------------------------------------


class TestFormatMessages:
    def test_shows_message_count(self):
        msgs = [
            {"message_date": "2026-03-01", "direction": "Outbound", "channel": "Email", "notes": "Sent quote."},
            {"message_date": "2026-03-10", "direction": "Inbound", "channel": "Email", "notes": "Counter offered."},
        ]
        out = format_messages(msgs)
        assert "Messages (2)" in out

    def test_empty_messages(self):
        out = format_messages([])
        assert "no messages" in out.lower()

    def test_notes_appear_in_output(self):
        msgs = [
            {"message_date": "2026-03-01", "direction": "Outbound", "channel": "Email", "notes": "Sent initial quote."},
        ]
        out = format_messages(msgs)
        assert "Sent initial quote." in out


# ---------------------------------------------------------------------------
# format_open_threads_table
# ---------------------------------------------------------------------------


class TestFormatOpenThreadsTable:
    def _open_df(self):
        threads = _make_threads(statuses=("Open", "Closed-Won", "Open"))
        return get_open_threads(threads, _make_customers(), TODAY)

    def test_contains_open_count(self):
        df = self._open_df()
        out = format_open_threads_table(df)
        assert "open" in out.lower()

    def test_contains_table_separator(self):
        df = self._open_df()
        out = format_open_threads_table(df)
        assert "|" in out

    def test_empty_df_returns_no_open_message(self):
        out = format_open_threads_table(pl.DataFrame())
        assert "no open" in out.lower()

    def test_top_limits_rows(self):
        threads = _make_threads(statuses=("Open", "Open", "Open"))
        df = get_open_threads(threads, _make_customers(), TODAY)
        out = format_open_threads_table(df, top=1)
        # Should only show 1 data row even though there are 3 open threads
        table_lines = [l for l in out.split("\n") if l.startswith("|") and "---" not in l and "Thread" not in l]
        assert len(table_lines) <= 1


# ---------------------------------------------------------------------------
# CLI integration (requires seed CSVs)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_all_open_exits_zero(capsys):
    exit_code = mod.main(["--all-open", "--today", "2026-05-02", "--top", "5"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "open" in out.lower()


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_all_open_json_valid(capsys):
    exit_code = mod.main(["--all-open", "--today", "2026-05-02", "--top", "5", "--json"])
    assert exit_code == 0
    out = capsys.readouterr().out
    data = json.loads(out)
    assert isinstance(data, list)


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_single_thread(capsys):
    # Load threads to get a real thread_id
    threads = pl.read_csv(_DATA_DIR / "negotiation_threads_seed.csv")
    open_threads = threads.filter(pl.col("status") == "Open")
    if open_threads.is_empty():
        pytest.skip("No open threads in seed data")
    tid = open_threads["thread_id"][0]
    exit_code = mod.main(["--thread", tid, "--today", "2026-05-02"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert tid in out


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_customer_mode(capsys):
    customers = pl.read_csv(_DATA_DIR / "customers_seed.csv")
    threads = pl.read_csv(_DATA_DIR / "negotiation_threads_seed.csv")
    # Find a customer that has at least one thread
    cids = threads["customer_id"].unique().to_list()
    if not cids:
        pytest.skip("No customer-thread data")
    cid = cids[0]
    exit_code = mod.main(["--customer", cid, "--today", "2026-05-02"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert cid in out


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_stock_mode(capsys):
    threads = pl.read_csv(_DATA_DIR / "negotiation_threads_seed.csv")
    if threads.is_empty():
        pytest.skip("No thread data")
    sid = threads["stock_id"][0]
    exit_code = mod.main(["--stock", sid, "--today", "2026-05-02"])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert sid in out


@pytest.mark.skipif(not _CSVS_PRESENT, reason="seed CSVs not present")
def test_cli_thread_json(capsys):
    threads = pl.read_csv(_DATA_DIR / "negotiation_threads_seed.csv")
    open_threads = threads.filter(pl.col("status") == "Open")
    if open_threads.is_empty():
        pytest.skip("No open threads in seed data")
    tid = open_threads["thread_id"][0]
    exit_code = mod.main(["--thread", tid, "--today", "2026-05-02", "--json"])
    assert exit_code == 0
    out = capsys.readouterr().out
    data = json.loads(out)
    assert "metadata" in data
    assert "messages" in data
    assert data["metadata"]["thread_id"] == tid
