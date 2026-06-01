"""Automation: Propose Repricing.

Step 2 of the Pramukh Gems workflow. Deterministic — no LLM.

Reads the triage_decisions.csv produced by step 1, then re-prices every
available stone using the weekly RapNet benchmark + demand + velocity. Splits
the proposals into two queues using the auto-apply threshold:

  - ``auto_apply``  — |pct_change| within threshold and a safe flag
  - ``needs_review`` — bigger moves OR flagged frozen/margin/quote

Writes both queues to ``data/working/repricing_proposals.csv``.

If ``needs_review`` > 0, sets ``review_required=true`` and
``next_action="rank-customer-clv"`` (humans review asynchronously; the
chain still proceeds).
"""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import sys
from pathlib import Path

import polars as pl

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from utils.pramukh_common import (  # noqa: E402
    Envelope, append_rows, audit_log, emit_envelope,
    error_envelope, make_skill_parser, parse_today,
)

_CORE_PATH = Path(__file__).with_name("_repricing_core.py")
_spec = importlib.util.spec_from_file_location("_repricing_core", _CORE_PATH)
assert _spec and _spec.loader
_repricing_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_repricing_core)

compute_repricing = _repricing_core.compute_repricing


SKILL_NAME = "propose-repricing"
NEXT_STEP = "rank-customer-clv"
DEFAULT_AUTO_THRESHOLD_PCT = 7.0
_UNSAFE_FLAGS = {"frozen", "margin", "quote"}


def _split_auto_review(repriced: pl.DataFrame, threshold_pct: float
                       ) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Auto-apply if flag safe AND 0 < |pct_change| <= threshold; else review."""
    if repriced.is_empty():
        return repriced, repriced
    flag_lower = pl.col("flag").cast(pl.Utf8).str.to_lowercase()
    abs_change = pl.col("pct_change").abs()
    unsafe = flag_lower.is_in(list(_UNSAFE_FLAGS))
    auto_mask   = (~unsafe) & (abs_change > 0) & (abs_change <= threshold_pct)
    review_mask = unsafe | (abs_change > threshold_pct)
    return repriced.filter(auto_mask), repriced.filter(review_mask)


def _load_triage_lookup(out_dir: Path) -> dict[str, str]:
    """Read upstream triage_decisions.csv and return {stock_id: action_tag}."""
    path = out_dir / "triage_decisions.csv"
    if not path.exists():
        return {}
    lookup: dict[str, str] = {}
    with path.open() as f:
        for row in csv.DictReader(f):
            sid = row.get("stock_id", "")
            tag = row.get("action_tag", "")
            if sid and tag:
                lookup[sid] = tag        # last write wins (most recent run)
    return lookup


def main() -> int:
    parser = make_skill_parser(
        description="Propose new prices and split into auto-apply vs review.",
        entity_flag="--stock-id",
    )
    parser.add_argument("--threshold-pct", type=float,
                        default=DEFAULT_AUTO_THRESHOLD_PCT,
                        help="Auto-apply cap on |%% change| (default 7).")
    args = parser.parse_args()
    today = parse_today(args.today)

    out_path = args.out_dir / "repricing_proposals.csv"

    try:
        raw = args.data_dir / "raw"
        inventory = pl.read_csv(raw / "inventory_seed.csv")
        rap       = pl.read_csv(raw / "rap_weekly_seed.csv")
        sales     = pl.read_csv(raw / "sales_transactions_seed.csv")
        demand    = pl.read_csv(raw / "demand_signals_seed.csv")
        memos     = pl.read_csv(raw / "memos_seed.csv")
        quotes    = pl.read_csv(raw / "quotes_seed.csv")

        triage_lookup = _load_triage_lookup(args.out_dir)

        repriced = compute_repricing(
            inventory, rap, sales, demand, memos, quotes,
            triage_tags=triage_lookup, today=today,
        )
        auto, review = _split_auto_review(repriced, args.threshold_pct)

        # ── Write both queues to one CSV with a `queue` column ──────────
        all_rows = []
        for queue_label, df in (("auto", auto), ("review", review)):
            for r in df.to_dicts():
                all_rows.append({
                    "workflow_run_id": args.workflow_run_id or "",
                    "step_id":         args.step_id or "",
                    "ts":              dt.datetime.now().isoformat(timespec="seconds"),
                    "queue":           queue_label,
                    "stock_id":        r["stock_id"],
                    "category_simple": r.get("category_simple", ""),
                    "old_price":       float(r.get("old_price", 0) or 0),
                    "proposed_price":  float(r.get("proposed_price", 0) or 0),
                    "pct_change":      float(r.get("pct_change", 0) or 0),
                    "flag":            r.get("flag", ""),
                    "primary_driver":  r.get("primary_driver", ""),
                })
        n_written = append_rows(out_path, all_rows,
                                fieldnames=list(all_rows[0].keys())) if all_rows else 0

        env = Envelope(
            status="ok",
            skill_name=SKILL_NAME,
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.stock_id,
            next_action=NEXT_STEP,
            confidence=1.0,
            review_required=len(review) > 0,
            artifact_refs=[f"working/{out_path.name}"],
            outputs={
                "today": today.isoformat(),
                "threshold_pct": args.threshold_pct,
                "auto_count": len(auto),
                "review_count": len(review),
                "rows_written": n_written,
            },
        )

    except Exception as exc:                # pragma: no cover
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
            f"[{SKILL_NAME}] auto={env.outputs['auto_count']} "
            f"review={env.outputs['review_count']} → next: {NEXT_STEP}"
        ),
        as_json=args.json,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
