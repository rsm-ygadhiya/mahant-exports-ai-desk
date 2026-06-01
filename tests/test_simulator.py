"""Tests for the data simulator (scripts/simulate/tick.py).

The simulator mutates data/raw/*.csv. To keep these tests isolated from
the rest of the suite (and reproducible), each test snapshots the
current raw/ before running, then restores it after.
"""

from __future__ import annotations

import csv
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TICK = REPO / "scripts" / "simulate" / "tick.py"
RAW = REPO / "data" / "raw"
WORKING = REPO / "data" / "working"
STATE = WORKING / "sim_state.json"


def _row_count(name: str) -> int:
    p = RAW / name
    if not p.exists():
        return 0
    with p.open() as f:
        return sum(1 for _ in f) - 1


def _snapshot_raw(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for p in RAW.glob("*.csv"):
        shutil.copy2(p, dest / p.name)


def _restore_raw(src: Path) -> None:
    for p in RAW.glob("*.csv"):
        if not (src / p.name).exists():
            p.unlink()
    for p in src.glob("*.csv"):
        shutil.copy2(p, RAW / p.name)


@pytest.fixture
def isolated_sim(tmp_path):
    """Snapshot raw/ + sim state before each test, restore after."""
    snap = tmp_path / "raw_snapshot"
    _snapshot_raw(snap)
    state_backup = None
    if STATE.exists():
        state_backup = STATE.read_text()
        STATE.unlink()
    try:
        yield
    finally:
        _restore_raw(snap)
        if state_backup is not None:
            WORKING.mkdir(parents=True, exist_ok=True)
            STATE.write_text(state_backup)
        elif STATE.exists():
            STATE.unlink()


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(TICK), *args],
        capture_output=True, text=True, cwd=str(REPO), check=False,
    )


def test_reset_restores_baseline(isolated_sim):
    """--reset brings every raw CSV back to baseline row counts."""
    proc = _run(["--reset"])
    assert proc.returncode == 0, proc.stderr
    # Baseline counts known from the repo
    assert _row_count("inventory_seed.csv") == 1000
    assert _row_count("sales_transactions_seed.csv") == 400
    assert _row_count("quotes_seed.csv") == 800
    assert _row_count("memos_seed.csv") == 80


def test_daily_tick_appends_rows(isolated_sim):
    """A single --daily tick appends rows to sales/quotes/demand/threads/comms."""
    _run(["--reset"])
    before = {
        "sales":   _row_count("sales_transactions_seed.csv"),
        "quotes":  _row_count("quotes_seed.csv"),
        "demand":  _row_count("demand_signals_seed.csv"),
        "threads": _row_count("negotiation_threads_seed.csv"),
        "comms":   _row_count("communication_logs_seed.csv"),
    }
    proc = _run(["--daily", "--seed", "42"])
    assert proc.returncode == 0, proc.stderr
    after = {
        "sales":   _row_count("sales_transactions_seed.csv"),
        "quotes":  _row_count("quotes_seed.csv"),
        "demand":  _row_count("demand_signals_seed.csv"),
        "threads": _row_count("negotiation_threads_seed.csv"),
        "comms":   _row_count("communication_logs_seed.csv"),
    }
    # Every table should grow (demand_signals grows by N_categories ≈ 227)
    for k in before:
        assert after[k] > before[k], f"{k} did not grow: {before[k]} → {after[k]}"


def test_weekly_tick_appends_rap_and_forecast(isolated_sim):
    """A single --weekly tick adds a row per category to rap + forecast."""
    _run(["--reset"])
    rap_before = _row_count("rap_weekly_seed.csv")
    fc_before  = _row_count("forecast_outputs_seed.csv")
    proc = _run(["--weekly", "--seed", "7"])
    assert proc.returncode == 0, proc.stderr
    rap_after = _row_count("rap_weekly_seed.csv")
    fc_after  = _row_count("forecast_outputs_seed.csv")
    # Both should grow by the same number of rows (≈ N categories)
    assert rap_after > rap_before
    assert fc_after > fc_before
    assert (rap_after - rap_before) == (fc_after - fc_before)


def test_daily_seed_is_reproducible(isolated_sim, tmp_path):
    """Same --seed produces identical sales appended."""
    _run(["--reset"])
    _run(["--daily", "--seed", "42"])
    a = (RAW / "sales_transactions_seed.csv").read_text()
    _run(["--reset"])
    _run(["--daily", "--seed", "42"])
    b = (RAW / "sales_transactions_seed.csv").read_text()
    assert a == b


def test_snapshot_then_load_roundtrip(isolated_sim, tmp_path):
    """--snapshot freezes state, --load restores it identically."""
    _run(["--reset"])
    _run(["--daily", "--seed", "99"])
    proc = _run(["--snapshot", "test_scenario_zz"])
    assert proc.returncode == 0, proc.stderr
    state_a = (RAW / "sales_transactions_seed.csv").read_text()

    # Mutate state, then load back
    _run(["--daily", "--seed", "200"])
    state_b = (RAW / "sales_transactions_seed.csv").read_text()
    assert state_a != state_b  # sanity check

    proc = _run(["--load", "test_scenario_zz"])
    assert proc.returncode == 0, proc.stderr
    state_c = (RAW / "sales_transactions_seed.csv").read_text()
    assert state_a == state_c

    # Clean up the test snapshot
    test_snap = REPO / "data" / "scenarios" / "test_scenario_zz"
    if test_snap.exists():
        shutil.rmtree(test_snap)
