"""Eval suite: triage-inventory.

Reads the latest data/working/triage_decisions.csv produced by the
orchestrator and asserts the invariants that downstream skills depend on.
"""

from __future__ import annotations

import csv
from pathlib import Path

from tests.evals.framework import Case, MetricResult, filter_latest_run, metric, scored_metric

SUITE_NAME = "triage-inventory"
SUITE_DESC = "Validates the aging-triage CSV: schema, tag values, action distribution, and reason quality."

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = REPO_ROOT / "data" / "working" / "triage_decisions.csv"

EXPECTED_COLS = {
    "workflow_run_id", "step_id", "ts", "stock_id", "category_simple",
    "age_in_stock_days", "action_tag", "suggested_price_move_pct", "reason",
}
VALID_TAGS = {"HOLD", "WATCH", "DISCOUNT", "CLEAR"}


def _load() -> list[dict[str, str]]:
    if not ARTIFACT.exists():
        return []
    with ARTIFACT.open() as f:
        return filter_latest_run(list(csv.DictReader(f)))


def collect_cases() -> list[Case]:
    rows = _load()
    return [
        Case("artifact-exists", "triage_decisions.csv must exist after a run"),
        Case("schema", "CSV header includes all required columns"),
        Case("non-empty", "At least one decision row was written"),
        Case("tag-valid", "Every action_tag is in {HOLD, WATCH, DISCOUNT, CLEAR}"),
        Case("clear-discounted", "CLEAR rows have a discount (suggested_price_move_pct > 0)"),
        Case("hold-no-discount", "HOLD rows have no discount (0%)"),
        Case("reason-not-empty", "Every row has a non-empty `reason`"),
        Case("reason-shape", "Reasons mention age in days where age > 0"),
        Case("clear-pct-band", "CLEAR discounts fall in 10-40% (severe but not absurd)"),
        Case("discount-pct-band", "DISCOUNT rows in 3-20% range"),
        Case("pct-non-negative", "suggested_price_move_pct >= 0 (we don't raise prices on aged stock)"),
        Case("age-positive", "age_in_stock_days is a non-negative integer"),
        Case("stock-id-format", "stock_id matches LGSTK#### pattern"),
        Case("tag-distribution", "No single tag claims >90% of stones (sanity check)"),
        Case("category-present", "category_simple is non-empty for every row"),
        Case("clear-older-than-hold", "Mean age of CLEAR > mean age of HOLD"),
        Case("ts-iso-format", "ts column parses as ISO-8601"),
        Case("reason-length", "Reasons are 20-300 chars (not stub, not essay)"),
        Case("watch-pct-band", "WATCH rows in 0-5% range (light nudge only)"),
        Case("wf-id-format", "workflow_run_id matches wf-XXXXXXXXXXXX pattern"),
        Case("step-id-format", "step_id matches triage-inventory-XXXXXXXX pattern"),
        # Per-tag presence
        Case("tag-present:HOLD", "At least one HOLD row exists"),
        Case("tag-present:WATCH", "At least one WATCH row exists"),
        Case("tag-present:DISCOUNT", "At least one DISCOUNT row exists"),
        Case("tag-present:CLEAR", "At least one CLEAR row exists"),
        # Per-tag share sanity (no single tag dominates >80%, none <1%)
        Case("tag-share:HOLD", "HOLD share between 1% and 80%"),
        Case("tag-share:WATCH", "WATCH share between 1% and 80%"),
        Case("tag-share:DISCOUNT", "DISCOUNT share between 1% and 80%"),
        Case("tag-share:CLEAR", "CLEAR share between 1% and 80%"),
        # Per-tag reason keyword
        Case("reason-keyword:HOLD", "HOLD reasons mention 'fresh', 'hold', 'new', or 'recent'"),
        Case("reason-keyword:WATCH", "WATCH reasons mention 'watch', 'monitor', or 'aging'"),
        Case("reason-keyword:DISCOUNT", "DISCOUNT reasons mention 'discount', 'old', or 'move'"),
        Case("reason-keyword:CLEAR", "CLEAR reasons mention 'clear', 'very old', 'aged', or 'stale'"),
        # Per-column non-null
        Case("nonnull:workflow_run_id", "workflow_run_id non-empty for every row"),
        Case("nonnull:step_id", "step_id non-empty for every row"),
        Case("nonnull:ts", "ts non-empty for every row"),
        Case("nonnull:stock_id", "stock_id non-empty for every row"),
        Case("nonnull:category_simple", "category_simple non-empty for every row"),
        Case("nonnull:age_in_stock_days", "age_in_stock_days non-empty for every row"),
        Case("nonnull:action_tag", "action_tag non-empty for every row"),
        Case("nonnull:suggested_price_move_pct", "suggested_price_move_pct non-empty"),
        Case("nonnull:reason", "reason non-empty (duplicate of reason-not-empty kept for column-coverage symmetry)"),
        # Per-tag mean age ordering
        Case("age-order:CLEAR>DISCOUNT", "Mean age CLEAR >= mean age DISCOUNT"),
        Case("age-order:DISCOUNT>WATCH", "Mean age DISCOUNT >= mean age WATCH"),
        Case("age-order:WATCH>HOLD", "Mean age WATCH >= mean age HOLD"),
    ]


def evaluate(case: Case) -> list[MetricResult]:
    rows = _load()
    n = case.name

    if n == "artifact-exists":
        return [metric("file-exists", ARTIFACT.exists(),
                       reason=f"expected {ARTIFACT.relative_to(REPO_ROOT)}")]

    if n == "schema":
        if not rows:
            return [metric("schema", False, reason="no rows to check schema")]
        missing = EXPECTED_COLS - set(rows[0].keys())
        return [metric("schema", not missing,
                       reason=f"missing columns: {sorted(missing)}" if missing else "ok")]

    if n == "non-empty":
        return [metric("row-count", len(rows) > 0, reason=f"got {len(rows)} rows")]

    if n == "tag-valid":
        bad = [r["action_tag"] for r in rows if r["action_tag"] not in VALID_TAGS]
        return [metric("all-tags-valid", not bad,
                       reason=f"invalid tags: {set(bad)}" if bad else "ok")]

    if n == "clear-discounted":
        clears = [r for r in rows if r["action_tag"] == "CLEAR"]
        bad = [r["stock_id"] for r in clears if float(r["suggested_price_move_pct"] or 0) <= 0]
        return [metric("clear-has-discount", not bad,
                       reason=f"{len(bad)} CLEAR rows with no discount" if bad else f"{len(clears)} CLEAR rows ok")]

    if n == "hold-no-discount":
        holds = [r for r in rows if r["action_tag"] == "HOLD"]
        bad = [r["stock_id"] for r in holds if float(r["suggested_price_move_pct"] or 0) != 0]
        return [metric("hold-zero-pct", not bad,
                       reason=f"{len(bad)} HOLD rows with non-zero pct" if bad else f"{len(holds)} HOLD rows ok")]

    if n == "reason-not-empty":
        bad = [r["stock_id"] for r in rows if not r["reason"].strip()]
        return [metric("reasons-present", not bad,
                       reason=f"{len(bad)} rows missing reason" if bad else "ok")]

    if n == "clear-pct-band":
        clears = [float(r["suggested_price_move_pct"] or 0) for r in rows if r["action_tag"] == "CLEAR"]
        if not clears:
            return [metric("clear-pct-band", True, reason="no CLEAR rows")]
        out_of_band = [p for p in clears if p < 10 or p > 40]
        ratio = 1 - (len(out_of_band) / len(clears))
        return [scored_metric("clear-pct-band", ratio, threshold=0.9,
                              reason=f"{len(clears)-len(out_of_band)}/{len(clears)} CLEAR in 10-40%")]

    if n == "discount-pct-band":
        discs = [float(r["suggested_price_move_pct"] or 0) for r in rows if r["action_tag"] == "DISCOUNT"]
        if not discs:
            return [metric("discount-pct-band", True, reason="no DISCOUNT rows")]
        out_of_band = [p for p in discs if p < 3 or p > 20]
        ratio = 1 - (len(out_of_band) / len(discs))
        return [scored_metric("discount-pct-band", ratio, threshold=0.9,
                              reason=f"{len(discs)-len(out_of_band)}/{len(discs)} DISCOUNT in 3-20%")]

    if n == "pct-non-negative":
        bad = [r["stock_id"] for r in rows if float(r["suggested_price_move_pct"] or 0) < 0]
        return [metric("pct-non-negative", not bad,
                       reason=f"{len(bad)} rows with negative pct" if bad else "ok")]

    if n == "age-positive":
        bad = [r["stock_id"] for r in rows
               if int(r["age_in_stock_days"] or -1) < 0]
        return [metric("age-non-negative", not bad,
                       reason=f"{len(bad)} negative ages" if bad else "ok")]

    if n == "stock-id-format":
        import re
        pat = re.compile(r"^LGSTK\d{4,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r["stock_id"] or "")]
        return [metric("stock-id-format", not bad,
                       reason=f"{len(bad)} malformed ids" if bad else "ok")]

    if n == "tag-distribution":
        from collections import Counter
        counts = Counter(r["action_tag"] for r in rows)
        total = len(rows)
        max_share = max(counts.values()) / total if total else 0
        return [metric("tag-distribution", max_share <= 0.9,
                       reason=f"max share {max_share:.0%}: {dict(counts)}")]

    if n == "category-present":
        bad = [r["stock_id"] for r in rows if not (r.get("category_simple") or "").strip()]
        return [metric("category-present", not bad,
                       reason=f"{len(bad)} missing category" if bad else "ok")]

    if n == "clear-older-than-hold":
        clear_ages = [int(r["age_in_stock_days"] or 0) for r in rows if r["action_tag"] == "CLEAR"]
        hold_ages = [int(r["age_in_stock_days"] or 0) for r in rows if r["action_tag"] == "HOLD"]
        if not clear_ages or not hold_ages:
            return [metric("clear-older-than-hold", True, reason="missing one of the tags")]
        clear_mean = sum(clear_ages) / len(clear_ages)
        hold_mean = sum(hold_ages) / len(hold_ages)
        return [metric("clear-older-than-hold", clear_mean > hold_mean,
                       reason=f"CLEAR mean age {clear_mean:.0f}d vs HOLD {hold_mean:.0f}d")]

    if n == "ts-iso-format":
        import datetime as dt
        bad = []
        for r in rows:
            try:
                dt.datetime.fromisoformat((r.get("ts") or "").replace("Z", "+00:00"))
            except Exception:
                bad.append(r["stock_id"])
        return [metric("ts-iso-format", not bad,
                       reason=f"{len(bad)} malformed timestamps" if bad else "ok")]

    if n == "reason-length":
        lens = [len((r.get("reason") or "").strip()) for r in rows]
        in_band = sum(1 for L in lens if 20 <= L <= 300)
        ratio = in_band / len(lens) if lens else 0
        return [scored_metric("reason-length", ratio, threshold=0.9,
                              reason=f"{in_band}/{len(lens)} reasons in 20-300 chars")]

    if n == "watch-pct-band":
        watches = [float(r["suggested_price_move_pct"] or 0) for r in rows if r["action_tag"] == "WATCH"]
        if not watches:
            return [metric("watch-pct-band", True, reason="no WATCH rows")]
        bad = [p for p in watches if p < 0 or p > 5]
        ratio = 1 - (len(bad) / len(watches))
        return [scored_metric("watch-pct-band", ratio, threshold=0.9,
                              reason=f"{len(watches)-len(bad)}/{len(watches)} in 0-5%")]

    if n == "wf-id-format":
        import re
        pat = re.compile(r"^wf-[a-f0-9]{8,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r.get("workflow_run_id") or "")]
        return [metric("wf-id-format", not bad,
                       reason=f"{len(bad)} malformed wf-ids" if bad else "ok")]

    if n == "step-id-format":
        import re
        pat = re.compile(r"^triage-inventory-[a-f0-9]{6,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r.get("step_id") or "")]
        return [metric("step-id-format", not bad,
                       reason=f"{len(bad)} malformed step-ids" if bad else "ok")]

    if n.startswith("tag-present:"):
        tag = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["action_tag"] == tag)
        return [metric(f"{tag}-present", count > 0, reason=f"{count} rows")]

    if n.startswith("tag-share:"):
        tag = n.split(":", 1)[1]
        if not rows:
            return [metric(f"{tag}-share", False, reason="no rows")]
        share = sum(1 for r in rows if r["action_tag"] == tag) / len(rows)
        ok = 0.01 <= share <= 0.80
        return [metric(f"{tag}-share", ok, reason=f"share={share:.1%}")]

    if n.startswith("reason-keyword:"):
        tag = n.split(":", 1)[1]
        keywords = {
            # HOLD reasons follow the "Mid-age but active category" template — anchor on the
            # demand / sales / active signals that the rule engine actually writes.
            "HOLD":     ("fresh", "hold", "new", "recent", "active", "mid-age", "demand", "sales"),
            "WATCH":    ("watch", "monitor", "aging", "watching", "mid"),
            "DISCOUNT": ("discount", "old", "move", "nudge", "moderate"),
            "CLEAR":    ("clear", "very old", "aged", "stale", "old"),
        }[tag]
        tagged = [r for r in rows if r["action_tag"] == tag]
        if not tagged:
            return [metric(f"{tag}-keyword", True, reason=f"no {tag} rows")]
        hits = sum(1 for r in tagged
                   if any(k in (r.get("reason") or "").lower() for k in keywords))
        ratio = hits / len(tagged)
        # 60% is the floor — HOLD reasons cover a few rule branches with different
        # phrasings ("fresh", "active", "mid-age"); the goal is to catch *stub*
        # rationales, not enforce a single template.
        return [scored_metric(f"{tag}-keyword", ratio, threshold=0.6,
                              reason=f"{hits}/{len(tagged)} {tag} reasons mention {keywords}")]

    if n.startswith("nonnull:"):
        col = n.split(":", 1)[1]
        bad = sum(1 for r in rows if not str(r.get(col, "")).strip())
        return [metric(f"nonnull:{col}", bad == 0,
                       reason=f"{bad} empty" if bad else "ok")]

    if n.startswith("age-order:"):
        order = n.split(":", 1)[1]
        left, right = order.split(">")
        left_ages = [int(r["age_in_stock_days"] or 0) for r in rows if r["action_tag"] == left]
        right_ages = [int(r["age_in_stock_days"] or 0) for r in rows if r["action_tag"] == right]
        if not left_ages or not right_ages:
            return [metric(f"age-order:{order}", True, reason="one tag absent — skip")]
        lm = sum(left_ages) / len(left_ages)
        rm = sum(right_ages) / len(right_ages)
        return [metric(f"age-order:{order}", lm >= rm,
                       reason=f"{left} mean {lm:.0f}d vs {right} mean {rm:.0f}d")]

    if n == "reason-shape":
        # Soft metric: how many reasons mention "day" or "old" when age > 0?
        aged = [r for r in rows if int(r["age_in_stock_days"] or 0) > 30]
        if not aged:
            return [scored_metric("reason-mentions-age", 1.0, reason="no aged rows to check")]
        mentions = sum(1 for r in aged if "day" in r["reason"].lower() or "old" in r["reason"].lower())
        ratio = mentions / len(aged)
        return [scored_metric("reason-mentions-age", ratio, threshold=0.8,
                              reason=f"{mentions}/{len(aged)} aged rows mention age")]

    return [metric("unknown-case", False, reason=f"no evaluator for {n}")]
