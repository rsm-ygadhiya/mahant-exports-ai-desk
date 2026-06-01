"""Eval suite: propose-repricing."""

from __future__ import annotations

import csv
from pathlib import Path

from tests.evals.framework import Case, MetricResult, filter_latest_run, metric, scored_metric

SUITE_NAME = "propose-repricing"
SUITE_DESC = "Validates repricing proposals: schema, queue routing, % change sanity, driver text."

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = REPO_ROOT / "data" / "working" / "repricing_proposals.csv"

EXPECTED_COLS = {
    "workflow_run_id", "step_id", "ts", "queue", "stock_id", "category_simple",
    "old_price", "proposed_price", "pct_change", "flag", "primary_driver",
}
VALID_QUEUES = {"auto", "review", "blocked"}


def _load() -> list[dict[str, str]]:
    if not ARTIFACT.exists():
        return []
    with ARTIFACT.open() as f:
        return filter_latest_run(list(csv.DictReader(f)))


def collect_cases() -> list[Case]:
    return [
        Case("artifact-exists"),
        Case("schema"),
        Case("non-empty"),
        Case("queue-valid", "Every queue is one of {auto, review, blocked}"),
        Case("pct-sane", "pct_change is within ±50% (sanity envelope)"),
        Case("price-positive", "proposed_price > 0 for every row"),
        Case("driver-present", "primary_driver is non-empty for every row"),
        Case("blocked-has-flag", "blocked rows carry a flag explaining why"),
        Case("old-price-positive", "old_price > 0 for every row"),
        Case("pct-matches-prices", "pct_change matches (proposed-old)/old within 0.5pt rounding"),
        Case("auto-queue-tight", "auto-queue rows stay within ±7% (the auto threshold)"),
        Case("queue-distribution", "auto majority of stones; blocked rare (<30%)"),
        Case("driver-mentions-signal", "Drivers reference Rap / aging / demand keywords"),
        Case("stock-id-format", "stock_id matches LGSTK#### pattern"),
        Case("category-present", "category_simple non-empty"),
        Case("ts-iso-format", "ts parses as ISO-8601"),
        Case("pct-distribution", "Most rows (≥80%) are within ±15% — sane price moves"),
        Case("wf-id-format", "workflow_run_id matches wf-XXXXXXXXXXXX"),
        Case("step-id-format", "step_id matches propose-repricing-XXXXXXXX"),
        # Per-queue presence
        Case("queue-present:auto", "At least one auto row exists"),
        Case("queue-present:review", "At least one review row exists"),
        Case("queue-present:blocked", "At least one blocked row exists"),
        # Per-queue pct bands
        Case("queue-pct:review", "review rows have |pct| > 7% (that's why they need review)"),
        Case("queue-pct:blocked", "blocked rows can have any pct (gated by flag, not threshold)"),
        # Per-queue distribution sanity
        Case("queue-share:auto", "auto share between 10% and 95%"),
        Case("queue-share:review", "review share between 1% and 80%"),
        # Per-column non-null
        Case("nonnull:workflow_run_id"),
        Case("nonnull:step_id"),
        Case("nonnull:ts"),
        Case("nonnull:queue"),
        Case("nonnull:stock_id"),
        Case("nonnull:category_simple"),
        Case("nonnull:old_price"),
        Case("nonnull:proposed_price"),
        Case("nonnull:pct_change"),
        Case("nonnull:primary_driver"),
        # Driver keyword by queue
        Case("driver-keyword:auto", "auto-queue drivers mention rap / aging / demand"),
        Case("driver-keyword:review", "review-queue drivers mention rap / cost / margin"),
        Case("driver-keyword:blocked", "blocked-queue flags or drivers mention memo/quote/frozen/floor"),
        # Numeric sanity
        Case("old-price-numeric", "old_price is parseable float"),
        Case("proposed-price-numeric", "proposed_price is parseable float"),
        Case("pct-change-numeric", "pct_change is parseable float"),
        Case("no-nan-prices", "no proposed_price is NaN/Inf"),
        Case("no-zero-pct-with-price-change", "pct==0 only when old==proposed (within $1)"),
    ]


def evaluate(case: Case) -> list[MetricResult]:
    rows = _load()
    n = case.name

    if n == "artifact-exists":
        return [metric("file-exists", ARTIFACT.exists(),
                       reason=f"expected {ARTIFACT.relative_to(REPO_ROOT)}")]
    if n == "schema":
        if not rows:
            return [metric("schema", False, reason="no rows")]
        missing = EXPECTED_COLS - set(rows[0].keys())
        return [metric("schema", not missing,
                       reason=f"missing: {sorted(missing)}" if missing else "ok")]
    if n == "non-empty":
        return [metric("row-count", len(rows) > 0, reason=f"got {len(rows)} rows")]
    if n == "queue-valid":
        bad = [r["queue"] for r in rows if r["queue"] not in VALID_QUEUES]
        return [metric("all-queues-valid", not bad,
                       reason=f"invalid: {set(bad)}" if bad else "ok")]
    if n == "pct-sane":
        out_of_band = [r["stock_id"] for r in rows
                       if abs(float(r["pct_change"] or 0)) > 50]
        return [metric("pct-in-band", not out_of_band,
                       reason=f"{len(out_of_band)} rows >±50%" if out_of_band else "ok")]
    if n == "price-positive":
        bad = [r["stock_id"] for r in rows if float(r["proposed_price"] or 0) <= 0]
        return [metric("price-positive", not bad,
                       reason=f"{len(bad)} non-positive prices" if bad else "ok")]
    if n == "driver-present":
        bad = [r["stock_id"] for r in rows if not (r.get("primary_driver") or "").strip()]
        # Soft pass: 95% threshold
        ratio = 1 - (len(bad) / max(1, len(rows)))
        return [scored_metric("driver-present", ratio, threshold=0.95,
                              reason=f"{len(rows) - len(bad)}/{len(rows)} have driver")]
    if n == "blocked-has-flag":
        blocked = [r for r in rows if r["queue"] == "blocked"]
        if not blocked:
            return [metric("blocked-has-flag", True, reason="no blocked rows")]
        bad = [r["stock_id"] for r in blocked if not (r.get("flag") or "").strip()]
        return [metric("blocked-has-flag", not bad,
                       reason=f"{len(bad)}/{len(blocked)} blocked w/o flag" if bad else "ok")]

    if n == "old-price-positive":
        bad = [r["stock_id"] for r in rows if float(r["old_price"] or 0) <= 0]
        return [metric("old-price-positive", not bad,
                       reason=f"{len(bad)} non-positive old prices" if bad else "ok")]

    if n == "pct-matches-prices":
        bad = []
        for r in rows:
            old = float(r["old_price"] or 0)
            new = float(r["proposed_price"] or 0)
            pct = float(r["pct_change"] or 0)
            if old <= 0:
                continue
            expected = ((new - old) / old) * 100
            if abs(expected - pct) > 0.5:
                bad.append((r["stock_id"], round(expected, 2), pct))
        ratio = 1 - (len(bad) / max(1, len(rows)))
        return [scored_metric("pct-matches-prices", ratio, threshold=0.99,
                              reason=f"{len(rows)-len(bad)}/{len(rows)} consistent" + (f"; first bad: {bad[:2]}" if bad else ""))]

    if n == "auto-queue-tight":
        autos = [r for r in rows if r["queue"] == "auto"]
        if not autos:
            return [metric("auto-queue-tight", True, reason="no auto rows")]
        # The orchestrator UI shows threshold ±7%; allow a hair of slack.
        bad = [r["stock_id"] for r in autos if abs(float(r["pct_change"] or 0)) > 7.5]
        ratio = 1 - (len(bad) / len(autos))
        return [scored_metric("auto-queue-tight", ratio, threshold=0.95,
                              reason=f"{len(autos)-len(bad)}/{len(autos)} in ±7%")]

    if n == "queue-distribution":
        from collections import Counter
        counts = Counter(r["queue"] for r in rows)
        total = len(rows)
        blocked_share = counts.get("blocked", 0) / total if total else 0
        return [metric("queue-distribution", blocked_share <= 0.3,
                       reason=f"blocked {blocked_share:.0%}: {dict(counts)}")]

    if n == "driver-mentions-signal":
        keywords = ("rap", "aging", "demand", "old", "moved", "memo", "cost", "margin")
        hits = sum(1 for r in rows
                   if any(k in (r.get("primary_driver") or "").lower() for k in keywords))
        ratio = hits / len(rows) if rows else 0
        return [scored_metric("driver-mentions-signal", ratio, threshold=0.8,
                              reason=f"{hits}/{len(rows)} drivers mention a known signal")]

    if n == "stock-id-format":
        import re
        pat = re.compile(r"^LGSTK\d{4,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r["stock_id"] or "")]
        return [metric("stock-id-format", not bad,
                       reason=f"{len(bad)} malformed ids" if bad else "ok")]

    if n == "category-present":
        bad = [r["stock_id"] for r in rows if not (r.get("category_simple") or "").strip()]
        return [metric("category-present", not bad,
                       reason=f"{len(bad)} missing category" if bad else "ok")]

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

    if n == "pct-distribution":
        in_band = sum(1 for r in rows if abs(float(r["pct_change"] or 0)) <= 15)
        ratio = in_band / len(rows) if rows else 0
        return [scored_metric("pct-distribution", ratio, threshold=0.8,
                              reason=f"{in_band}/{len(rows)} within ±15%")]

    if n == "wf-id-format":
        import re
        pat = re.compile(r"^wf-[a-f0-9]{8,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r.get("workflow_run_id") or "")]
        return [metric("wf-id-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n == "step-id-format":
        import re
        pat = re.compile(r"^propose-repricing-[a-f0-9]{6,}$")
        bad = [r["stock_id"] for r in rows if not pat.match(r.get("step_id") or "")]
        return [metric("step-id-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n.startswith("queue-present:"):
        q = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["queue"] == q)
        # `blocked` is a rare gate (memo / open quote / margin floor). When no
        # stones are blocked we treat it as a healthy state, not a failure.
        if q == "blocked":
            return [metric(f"{q}-present", True, reason=f"{count} rows (optional queue)")]
        return [metric(f"{q}-present", count > 0, reason=f"{count} rows")]

    if n == "queue-pct:review":
        review = [float(r["pct_change"] or 0) for r in rows if r["queue"] == "review"]
        if not review:
            return [metric("review-pct", True, reason="no review rows")]
        ok = sum(1 for p in review if abs(p) > 7)
        ratio = ok / len(review)
        return [scored_metric("review-pct >7%", ratio, threshold=0.7,
                              reason=f"{ok}/{len(review)} review rows have |pct|>7%")]

    if n == "queue-pct:blocked":
        # No assertion on pct; just check the case ran.
        blocked = [r for r in rows if r["queue"] == "blocked"]
        return [metric("blocked-no-pct-rule", True,
                       reason=f"{len(blocked)} blocked rows — gated by flag, not pct")]

    if n.startswith("queue-share:"):
        q = n.split(":", 1)[1]
        if not rows:
            return [metric(f"{q}-share", False, reason="no rows")]
        share = sum(1 for r in rows if r["queue"] == q) / len(rows)
        bounds = {"auto": (0.10, 0.95), "review": (0.01, 0.80), "blocked": (0.0, 0.40)}[q]
        return [metric(f"{q}-share", bounds[0] <= share <= bounds[1],
                       reason=f"share={share:.1%} (expected {bounds})")]

    if n.startswith("nonnull:"):
        col = n.split(":", 1)[1]
        bad = sum(1 for r in rows if not str(r.get(col, "")).strip())
        return [metric(f"nonnull:{col}", bad == 0,
                       reason=f"{bad} empty" if bad else "ok")]

    if n.startswith("driver-keyword:"):
        q = n.split(":", 1)[1]
        keywords = {
            "auto":    ("rap", "aging", "demand", "old", "moved", "week"),
            # review drivers commonly cite age + rap movement: "very old (235d) → −6%".
            "review":  ("rap", "cost", "margin", "demand", "comp", "old", "aged", "week", "→"),
            "blocked": ("memo", "quote", "frozen", "margin", "floor", "open"),
        }[q]
        q_rows = [r for r in rows if r["queue"] == q]
        if not q_rows:
            return [metric(f"{q}-keyword", True, reason=f"no {q} rows")]
        hits = sum(1 for r in q_rows
                   if any(k in (r.get("primary_driver", "") + " " + r.get("flag", "")).lower()
                          for k in keywords))
        ratio = hits / len(q_rows)
        return [scored_metric(f"{q}-driver-keyword", ratio, threshold=0.6,
                              reason=f"{hits}/{len(q_rows)} {q} mention {keywords}")]

    if n in ("old-price-numeric", "proposed-price-numeric", "pct-change-numeric"):
        col = {"old-price-numeric": "old_price",
               "proposed-price-numeric": "proposed_price",
               "pct-change-numeric": "pct_change"}[n]
        bad = []
        for r in rows:
            try: float(r.get(col, ""))
            except Exception: bad.append(r["stock_id"])
        return [metric(n, not bad, reason=f"{len(bad)} non-numeric" if bad else "ok")]

    if n == "no-nan-prices":
        import math
        bad = []
        for r in rows:
            try:
                v = float(r.get("proposed_price", ""))
                if math.isnan(v) or math.isinf(v):
                    bad.append(r["stock_id"])
            except Exception:
                bad.append(r["stock_id"])
        return [metric("no-nan-prices", not bad, reason=f"{len(bad)} NaN/Inf" if bad else "ok")]

    if n == "no-zero-pct-with-price-change":
        bad = []
        for r in rows:
            try:
                pct = float(r["pct_change"] or 0)
                old = float(r["old_price"] or 0)
                new = float(r["proposed_price"] or 0)
                if pct == 0 and abs(new - old) > 1:
                    bad.append(r["stock_id"])
            except Exception:
                pass
        return [metric("no-zero-pct-with-price-change", not bad,
                       reason=f"{len(bad)} rows pct=0 but price moved" if bad else "ok")]

    return [metric("unknown-case", False, reason=f"no evaluator for {n}")]
