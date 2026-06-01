"""Automation: Triage Inventory.

Step 1 of the Pramukh Gems workflow. Deterministic — no LLM.

Tags every available stone HOLD / WATCH / DISCOUNT / CLEAR based on age in
stock, category demand, recent sales velocity, and inquiry count. Writes a
row per stone to ``data/working/triage_decisions.csv`` and emits a standard
JSON envelope on stdout.

Hand-off: the downstream propose-repricing step reads triage_decisions.csv
to pick up the action_tag for each stone.

Run::

    uv run python automations/triage-inventory/scripts/triage_inventory.py --json
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import polars as pl

# Make repo root importable
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from utils.pramukh_common import (  # noqa: E402
    Envelope, append_rows, audit_log, emit_envelope,
    error_envelope, make_skill_parser, parse_today,
)

# Local logic: ported core from M02
import importlib.util  # noqa: E402

_CORE_PATH = Path(__file__).with_name("_triage_core.py")
_spec = importlib.util.spec_from_file_location("_triage_core", _CORE_PATH)
assert _spec and _spec.loader
_triage_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_triage_core)

triage_inventory = _triage_core.triage_inventory


SKILL_NAME = "triage-inventory"
NEXT_STEP = "propose-repricing"


def main() -> int:
    parser = make_skill_parser(
        description="Tag each available stone HOLD/WATCH/DISCOUNT/CLEAR.",
        entity_flag="--stock-id",
    )
    args = parser.parse_args()
    today = parse_today(args.today)

    out_path = args.out_dir / "triage_decisions.csv"

    try:
        # ── Load source data ─────────────────────────────────────────────
        raw = args.data_dir / "raw"
        inventory = pl.read_csv(raw / "inventory_seed.csv")
        sales     = pl.read_csv(raw / "sales_transactions_seed.csv")
        demand    = pl.read_csv(raw / "demand_signals_seed.csv")
        comms     = pl.read_csv(raw / "communication_logs_seed.csv")

        # ── Run deterministic triage ─────────────────────────────────────
        df = triage_inventory(inventory, sales, demand, comms, today=today)

        # ── Project to output schema ────────────────────────────────────
        if df.is_empty():
            counts = {"CLEAR": 0, "DISCOUNT": 0, "WATCH": 0, "HOLD": 0}
            n_written = 0
        else:
            grouped = df.group_by("action_tag").agg(pl.len().alias("n")).to_dicts()
            counts = {"CLEAR": 0, "DISCOUNT": 0, "WATCH": 0, "HOLD": 0}
            for r in grouped:
                counts[r["action_tag"]] = int(r["n"])

            rows = []
            for r in df.to_dicts():
                rows.append({
                    "workflow_run_id": args.workflow_run_id or "",
                    "step_id":         args.step_id or "",
                    "ts":              dt.datetime.now().isoformat(timespec="seconds"),
                    "stock_id":        r["stock_id"],
                    "category_simple": r.get("category_simple", ""),
                    "age_in_stock_days": int(r.get("age_in_stock_days", 0) or 0),
                    "action_tag":      r["action_tag"],
                    "suggested_price_move_pct": float(r.get("suggested_price_move_pct", 0) or 0),
                    "reason":          r.get("reason", ""),
                })
            n_written = append_rows(
                out_path, rows,
                fieldnames=list(rows[0].keys()),
            )

        env = Envelope(
            status="ok",
            skill_name=SKILL_NAME,
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.stock_id,
            next_action=NEXT_STEP,
            confidence=1.0,                 # deterministic — confidence is 1
            review_required=False,
            artifact_refs=[f"working/{out_path.name}"],
            outputs={
                "today": today.isoformat(),
                "stones_tagged": sum(counts.values()),
                "by_tag": counts,
                "rows_written": n_written,
            },
        )

    except Exception as exc:                # pragma: no cover (defensive)
        env = error_envelope(
            SKILL_NAME, "runtime_error", str(exc),
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.stock_id,
        )
        audit_log(args.out_dir, env)
        emit_envelope(env, as_json=args.json)
        return 1

    audit_log(args.out_dir, env)
    emit_envelope(
        env,
        print_human=(
            f"[{SKILL_NAME}] {env.outputs['stones_tagged']} stones tagged "
            f"({env.outputs['by_tag']}) → next: {NEXT_STEP}"
        ),
        as_json=args.json,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
