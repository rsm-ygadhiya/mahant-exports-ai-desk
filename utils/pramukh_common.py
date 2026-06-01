"""Shared helpers for Pramukh Gems skills + automations.

Every skill and automation imports these so:

- They all accept the **same CLI flags** (the orchestrator drives them the same way).
- They all emit the **same JSON envelope** on stdout.
- They all write to ``data/working/`` with the same idempotency rules.

Reference: ``mgta495-milestone03-Group-10/skills/README.md``.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "working"


# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------


def make_skill_parser(
    description: str,
    entity_flag: str = "--case-id",
) -> argparse.ArgumentParser:
    """Build the standard CLI parser every skill / automation must accept.

    Parameters
    ----------
    description
        Human-readable description for ``--help``.
    entity_flag
        Rename ``--case-id`` to match your domain (we use ``--stock-id``,
        ``--memo-id`` etc. inside individual scripts that need it).

    Returns
    -------
    An ``argparse.ArgumentParser`` with every flag listed in
    ``skills/README.md``.
    """
    p = argparse.ArgumentParser(description=description)
    p.add_argument(entity_flag, default="ALL",
                   help="The entity this step acts on (or 'ALL' to scan).")
    p.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                   help="Read source data from here.")
    p.add_argument("--out-dir",  type=Path, default=DEFAULT_OUT_DIR,
                   help="Write working CSVs here.")
    p.add_argument("--workflow-run-id", default=None,
                   help="Identifier for one end-to-end run (set by orchestrator).")
    p.add_argument("--step-id", default=None,
                   help="Identifier for this step within the run.")
    p.add_argument("--mode", choices=("live", "demo"), default="demo",
                   help="live = only fresh working data; demo = also accept seeds.")
    p.add_argument("--idempotency-mode", choices=("skip", "replace"),
                   default="skip",
                   help="Re-running the same (run_id, step_id) — skip or rewrite.")
    p.add_argument("--json", action="store_true",
                   help="Emit a JSON envelope on stdout instead of plain text.")
    p.add_argument("--today", default=None,
                   help="ISO date to pin the run to (default: today).")
    return p


# ---------------------------------------------------------------------------
# JSON envelope
# ---------------------------------------------------------------------------


@dataclass
class Envelope:
    """Standard JSON envelope every step emits with ``--json``."""

    status: str                                 # "ok" | "error" | "needs_review"
    skill_name: str
    workflow_run_id: str | None = None
    step_id: str | None = None
    case_id: str | None = None
    next_action: str | None = None              # name of next step (or "done")
    confidence: float | None = None             # 0..1
    review_required: bool = False
    artifact_refs: list[str] = field(default_factory=list)
    outputs: dict[str, Any] = field(default_factory=dict)
    error: dict[str, str] | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)


def emit_envelope(env: Envelope, print_human: str | None = None,
                  as_json: bool = False) -> None:
    """Print either the JSON envelope or a human-readable summary."""
    if as_json:
        print(env.to_json())
    else:
        # Friendly fallback when --json was NOT requested
        print(print_human or
              f"[{env.skill_name}] status={env.status} "
              f"next={env.next_action} review={env.review_required}")


def error_envelope(skill_name: str, code: str, message: str,
                   workflow_run_id: str | None = None,
                   step_id: str | None = None,
                   case_id: str | None = None) -> Envelope:
    return Envelope(
        status="error",
        skill_name=skill_name,
        workflow_run_id=workflow_run_id,
        step_id=step_id,
        case_id=case_id,
        error={"code": code, "message": message},
    )


# ---------------------------------------------------------------------------
# Working CSV append helpers
# ---------------------------------------------------------------------------


def append_rows(out_path: Path, rows: Iterable[dict[str, Any]],
                fieldnames: list[str]) -> int:
    """Append rows to a CSV in ``data/working/`` (creates the file if missing).

    Returns the number of rows written.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not out_path.exists() or out_path.stat().st_size == 0
    n = 0
    with out_path.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        if write_header:
            w.writeheader()
        for r in rows:
            w.writerow(r)
            n += 1
    return n


def already_ran(out_path: Path, workflow_run_id: str | None,
                step_id: str | None) -> bool:
    """Return True if this (run_id, step_id) is already in ``out_path``."""
    if not out_path.exists() or workflow_run_id is None or step_id is None:
        return False
    with out_path.open() as f:
        reader = csv.DictReader(f)
        for r in reader:
            if r.get("workflow_run_id") == workflow_run_id and r.get("step_id") == step_id:
                return True
    return False


def audit_log(out_dir: Path, env: Envelope) -> None:
    """Append a row to ``data/working/workflow_action_log.csv`` for every step."""
    row = {
        "ts": dt.datetime.now().isoformat(timespec="seconds"),
        "workflow_run_id": env.workflow_run_id or "",
        "step_id": env.step_id or "",
        "skill_name": env.skill_name,
        "status": env.status,
        "next_action": env.next_action or "",
        "review_required": "1" if env.review_required else "0",
        "case_id": env.case_id or "",
        "artifact_refs": ";".join(env.artifact_refs),
    }
    append_rows(
        out_dir / "workflow_action_log.csv",
        [row],
        fieldnames=list(row.keys()),
    )


# ---------------------------------------------------------------------------
# Convenience: parse_today
# ---------------------------------------------------------------------------


def parse_today(s: str | None) -> dt.date:
    return dt.date.fromisoformat(s) if s else dt.date.today()


def new_run_id() -> str:
    return f"wf-{uuid.uuid4().hex[:12]}"
