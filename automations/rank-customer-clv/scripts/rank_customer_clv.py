"""Automation: Rank Customer CLV.

Step 3 of the Pramukh Gems workflow. Deterministic — no LLM.

Computes Customer Lifetime Value for every broker and every company, then
sorts each entity into a quartile (Top / High / Mid / Low). The downstream
``decide-memo`` skill uses these tiers to decide whether a memo request is
safe to auto-approve.
"""

from __future__ import annotations

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

_CORE_PATH = Path(__file__).with_name("_clv_core.py")
_spec = importlib.util.spec_from_file_location("_clv_core", _CORE_PATH)
assert _spec and _spec.loader
_clv_core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_clv_core)

compute_all_clv = _clv_core.compute_all_clv


SKILL_NAME = "rank-customer-clv"
NEXT_STEP = "decide-memo"


def _quartile_tiers(clv_df: pl.DataFrame) -> dict[str, str]:
    if clv_df.is_empty():
        return {}
    rows = clv_df.sort("clv", descending=True).to_dicts()
    n = len(rows)
    top_cut, high_cut, mid_cut = max(1, n // 4), max(2, n // 2), max(3, (3 * n) // 4)
    out: dict[str, str] = {}
    for i, r in enumerate(rows):
        if i < top_cut:
            out[r["entity_id"]] = "Top"
        elif i < high_cut:
            out[r["entity_id"]] = "High"
        elif i < mid_cut:
            out[r["entity_id"]] = "Mid"
        else:
            out[r["entity_id"]] = "Low"
    return out


def main() -> int:
    parser = make_skill_parser(
        description="Rank every broker + company by CLV quartile.",
        entity_flag="--entity-id",
    )
    args = parser.parse_args()
    today = parse_today(args.today)

    out_path = args.out_dir / "clv_tiers.csv"

    try:
        raw = args.data_dir / "raw"
        sales = pl.read_csv(raw / "sales_transactions_seed.csv")
        customers = pl.read_csv(raw / "customers_seed.csv")

        # CLV skill needs is_broker as "true"/"false" string
        customers_norm = customers.with_columns(
            pl.when(pl.col("is_broker").cast(pl.Utf8).is_in(["1", "true", "True"]))
            .then(pl.lit("true"))
            .otherwise(pl.lit("false"))
            .alias("is_broker")
        )
        broker_clv  = compute_all_clv("broker",  sales, customers_norm, today=today)
        company_clv = compute_all_clv("company", sales, customers_norm, today=today)

        tier_lookup = {**_quartile_tiers(company_clv), **_quartile_tiers(broker_clv)}

        rows = []
        # zip tier with original CLV row for richer audit trail
        all_clv = pl.concat([broker_clv, company_clv], how="vertical_relaxed")
        for r in all_clv.to_dicts():
            rows.append({
                "workflow_run_id": args.workflow_run_id or "",
                "step_id":         args.step_id or "",
                "ts":              dt.datetime.now().isoformat(timespec="seconds"),
                "entity_id":       r["entity_id"],
                "entity_name":     r.get("entity_name", ""),
                "level":           r.get("level", ""),
                "clv":             float(r.get("clv", 0) or 0),
                "transactions":    int(r.get("transactions", 0) or 0),
                "tier":            tier_lookup.get(r["entity_id"], "Unknown"),
            })

        n_written = append_rows(out_path, rows,
                                fieldnames=list(rows[0].keys())) if rows else 0

        # Tier counts for the envelope
        tier_counts = {"Top": 0, "High": 0, "Mid": 0, "Low": 0}
        for t in tier_lookup.values():
            if t in tier_counts:
                tier_counts[t] += 1

        env = Envelope(
            status="ok",
            skill_name=SKILL_NAME,
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.entity_id,
            next_action=NEXT_STEP,
            confidence=1.0,
            review_required=False,
            artifact_refs=[f"working/{out_path.name}"],
            outputs={
                "today": today.isoformat(),
                "entities_ranked": len(tier_lookup),
                "tier_counts": tier_counts,
                "rows_written": n_written,
            },
        )
    except Exception as exc:                # pragma: no cover
        env = error_envelope(
            SKILL_NAME, "runtime_error", str(exc),
            workflow_run_id=args.workflow_run_id,
            step_id=args.step_id,
            case_id=args.entity_id,
        )
        audit_log(args.out_dir, env)
        emit_envelope(env, as_json=args.json)
        return 1

    audit_log(args.out_dir, env)
    emit_envelope(
        env,
        print_human=(
            f"[{SKILL_NAME}] ranked {env.outputs['entities_ranked']} "
            f"({env.outputs['tier_counts']}) → next: {NEXT_STEP}"
        ),
        as_json=args.json,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
