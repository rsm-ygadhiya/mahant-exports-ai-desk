"""Shared helpers for the per-automation tests."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKING = REPO / "data" / "working"


def clean_working() -> None:
    """Wipe data/working/*.csv between tests so artifacts don't bleed."""
    if WORKING.exists():
        for p in WORKING.glob("*.csv"):
            p.unlink()


def run_script(script: Path, extra: list[str]) -> dict:
    """Run a step script with --json + standard orchestrator-style args."""
    cmd = [
        sys.executable, str(script),
        "--json",
        "--data-dir", str(REPO / "data"),
        "--out-dir",  str(WORKING),
        "--workflow-run-id", "wf-test1234567",
        "--step-id", "step-test",
        "--today", "2026-05-14",
        *extra,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO), check=False)
    assert proc.returncode == 0, f"{script.name} failed:\n{proc.stderr}"
    last = proc.stdout.strip().splitlines()[-1]
    return json.loads(last)


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))
