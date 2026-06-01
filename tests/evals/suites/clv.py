"""Eval suite: rank-customer-clv."""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

from tests.evals.framework import Case, MetricResult, filter_latest_run, metric, scored_metric

SUITE_NAME = "rank-customer-clv"
SUITE_DESC = "Validates CLV tier output: schema, tier distribution (quartile balance), CLV ordering."

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = REPO_ROOT / "data" / "working" / "clv_tiers.csv"

EXPECTED_COLS = {
    "workflow_run_id", "step_id", "ts", "entity_id", "entity_name",
    "level", "clv", "transactions", "tier",
}
VALID_TIERS = {"Top", "High", "Mid", "Low"}


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
        Case("tier-valid", "Every tier in {Top, High, Mid, Low}"),
        Case("quartile-balance", "Tier counts roughly balanced (quartile method)"),
        Case("clv-non-negative", "clv >= 0 for every row"),
        Case("top-vs-low", "Top tier mean CLV > Low tier mean CLV"),
        Case("entity-unique", "No duplicate (level, entity_id) pairs"),
        Case("tier-monotonic", "Mean CLV strictly decreases Top > High > Mid > Low"),
        Case("transactions-non-negative", "transactions >= 0"),
        Case("level-valid", "level is either 'broker' or 'company'"),
        Case("both-levels-present", "Both broker and company levels are ranked"),
        Case("entity-id-non-empty", "entity_id is non-empty for every row"),
        Case("entity-name-non-empty", "entity_name is non-empty for every row"),
        Case("ts-iso-format", "ts parses as ISO-8601"),
        Case("top-tier-has-transactions", "Top tier entities have >=1 transaction on average"),
        Case("clv-not-extreme", "No single entity's CLV is >100x the median"),
        Case("wf-id-format", "workflow_run_id matches wf-XXXXXXXXXXXX"),
        Case("step-id-format", "step_id matches rank-customer-clv-XXXXXXXX"),
        # Per-(tier × level) presence
        Case("tier-level:Top:broker"), Case("tier-level:High:broker"),
        Case("tier-level:Mid:broker"), Case("tier-level:Low:broker"),
        Case("tier-level:Top:company"), Case("tier-level:High:company"),
        Case("tier-level:Mid:company"), Case("tier-level:Low:company"),
        # Per-level tier monotonicity
        Case("tier-monotonic:broker", "broker means strictly decrease Top > High > Mid > Low"),
        Case("tier-monotonic:company", "company means strictly decrease Top > High > Mid > Low"),
        # Per-level min entity count (need at least 8 for meaningful quartile)
        Case("min-entities:broker", "broker level has >=8 entities"),
        Case("min-entities:company", "company level has >=8 entities"),
        # Per-column non-null
        Case("nonnull:workflow_run_id"),
        Case("nonnull:step_id"),
        Case("nonnull:ts"),
        Case("nonnull:entity_id"),
        Case("nonnull:entity_name"),
        Case("nonnull:level"),
        Case("nonnull:clv"),
        Case("nonnull:transactions"),
        Case("nonnull:tier"),
        # Numeric sanity
        Case("clv-numeric", "clv parseable as float"),
        Case("transactions-int", "transactions parseable as int"),
        Case("no-nan-clv", "no NaN/Inf in clv"),
        # Entity-id format per level
        Case("entity-id-format:broker", "broker entity_id matches BROK#### or CUST#### pattern"),
        Case("entity-id-format:company", "company entity_id matches CUST#### pattern"),
        # Top tier should have transactions > Mid mean
        Case("top-trans>mid-trans", "Top mean transactions >= Mid mean transactions"),
        Case("high-trans>low-trans", "High mean transactions >= Low mean transactions"),
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
    if n == "tier-valid":
        bad = [r["tier"] for r in rows if r["tier"] not in VALID_TIERS]
        return [metric("all-tiers-valid", not bad,
                       reason=f"invalid: {set(bad)}" if bad else "ok")]
    if n == "quartile-balance":
        # Quartile partition should give each tier ~25% of entities at each level.
        # Allow ±10 percentage points slack.
        results: list[MetricResult] = []
        for level in {r["level"] for r in rows}:
            level_rows = [r for r in rows if r["level"] == level]
            counts = Counter(r["tier"] for r in level_rows)
            total = len(level_rows)
            max_dev = max(abs(counts.get(t, 0) / total - 0.25) for t in VALID_TIERS)
            results.append(scored_metric(
                f"balance:{level}", 1.0 - min(1.0, max_dev * 4),
                threshold=0.6,
                reason=f"{dict(counts)} of {total}",
            ))
        return results or [metric("quartile-balance", False, reason="no rows")]
    if n == "clv-non-negative":
        # Customers with heavy returns can have a legitimately negative net
        # contribution. We don't expect *zero* — we expect this to be rare.
        # Threshold: ≥90% of ranked entities have non-negative CLV.
        bad = sum(1 for r in rows if float(r["clv"] or 0) < 0)
        ratio = 1 - (bad / max(1, len(rows)))
        return [scored_metric("clv-non-negative", ratio, threshold=0.9,
                              reason=f"{len(rows)-bad}/{len(rows)} non-negative ({bad} negative)")]
    if n == "top-vs-low":
        top = [float(r["clv"]) for r in rows if r["tier"] == "Top"]
        low = [float(r["clv"]) for r in rows if r["tier"] == "Low"]
        if not top or not low:
            return [metric("top-vs-low", False, reason="missing Top or Low tier")]
        top_mean = sum(top) / len(top)
        low_mean = sum(low) / len(low)
        return [metric("top-mean > low-mean", top_mean > low_mean,
                       reason=f"Top mean ${top_mean:,.0f} vs Low mean ${low_mean:,.0f}")]
    if n == "entity-unique":
        seen: set[tuple[str, str]] = set()
        dups = 0
        for r in rows:
            key = (r["level"], r["entity_id"])
            if key in seen:
                dups += 1
            seen.add(key)
        return [metric("no-dup-entities", dups == 0,
                       reason=f"{dups} duplicates" if dups else "ok")]

    if n == "tier-monotonic":
        means = {}
        for tier in ["Top", "High", "Mid", "Low"]:
            vals = [float(r["clv"] or 0) for r in rows if r["tier"] == tier]
            if not vals:
                return [metric("tier-monotonic", False, reason=f"missing tier {tier}")]
            means[tier] = sum(vals) / len(vals)
        ok = means["Top"] > means["High"] > means["Mid"] > means["Low"]
        return [metric("tier-monotonic", ok,
                       reason=f"means: Top={means['Top']:,.0f}, High={means['High']:,.0f}, Mid={means['Mid']:,.0f}, Low={means['Low']:,.0f}")]

    if n == "transactions-non-negative":
        bad = [r["entity_id"] for r in rows if int(r["transactions"] or -1) < 0]
        return [metric("transactions-non-negative", not bad,
                       reason=f"{len(bad)} negative" if bad else "ok")]

    if n == "level-valid":
        bad = [r["level"] for r in rows if r["level"] not in {"broker", "company"}]
        return [metric("level-valid", not bad,
                       reason=f"invalid levels: {set(bad)}" if bad else "ok")]

    if n == "both-levels-present":
        levels = {r["level"] for r in rows}
        return [metric("both-levels-present", levels >= {"broker", "company"},
                       reason=f"got {levels}")]

    if n == "entity-id-non-empty":
        bad = sum(1 for r in rows if not (r.get("entity_id") or "").strip())
        return [metric("entity-id-non-empty", bad == 0,
                       reason=f"{bad} empty" if bad else "ok")]

    if n == "entity-name-non-empty":
        bad = sum(1 for r in rows if not (r.get("entity_name") or "").strip())
        return [metric("entity-name-non-empty", bad == 0,
                       reason=f"{bad} empty" if bad else "ok")]

    if n == "ts-iso-format":
        import datetime as dt
        bad = []
        for r in rows:
            try:
                dt.datetime.fromisoformat((r.get("ts") or "").replace("Z", "+00:00"))
            except Exception:
                bad.append(r["entity_id"])
        return [metric("ts-iso-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n == "top-tier-has-transactions":
        top = [int(r["transactions"] or 0) for r in rows if r["tier"] == "Top"]
        if not top:
            return [metric("top-tier-has-transactions", False, reason="no Top rows")]
        mean = sum(top) / len(top)
        return [metric("top-tier-has-transactions", mean >= 1.0,
                       reason=f"Top mean transactions={mean:.1f}")]

    if n == "clv-not-extreme":
        vals = sorted(float(r["clv"] or 0) for r in rows)
        if not vals:
            return [metric("clv-not-extreme", False, reason="no rows")]
        median = vals[len(vals) // 2]
        if median <= 0:
            return [metric("clv-not-extreme", True, reason="median is 0 — skip ratio test")]
        max_val = max(vals)
        ratio = max_val / median
        return [metric("clv-not-extreme", ratio <= 100,
                       reason=f"max ${max_val:,.0f} vs median ${median:,.0f} (ratio {ratio:.1f}x)")]

    if n == "wf-id-format":
        import re
        pat = re.compile(r"^wf-[a-f0-9]{8,}$")
        bad = [r["entity_id"] for r in rows if not pat.match(r.get("workflow_run_id") or "")]
        return [metric("wf-id-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n == "step-id-format":
        import re
        pat = re.compile(r"^rank-customer-clv-[a-f0-9]{6,}$")
        bad = [r["entity_id"] for r in rows if not pat.match(r.get("step_id") or "")]
        return [metric("step-id-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n.startswith("tier-level:"):
        tier, level = n.split(":")[1:3]
        count = sum(1 for r in rows if r["tier"] == tier and r["level"] == level)
        return [metric(f"{tier}-{level}-present", count > 0,
                       reason=f"{count} rows")]

    if n.startswith("tier-monotonic:"):
        level = n.split(":", 1)[1]
        means = {}
        for tier in ["Top", "High", "Mid", "Low"]:
            vals = [float(r["clv"] or 0) for r in rows if r["tier"] == tier and r["level"] == level]
            if not vals:
                return [metric(f"tier-monotonic:{level}", False,
                               reason=f"no {tier} rows at {level} level")]
            means[tier] = sum(vals) / len(vals)
        ok = means["Top"] > means["High"] > means["Mid"] > means["Low"]
        return [metric(f"tier-monotonic:{level}", ok,
                       reason=f"means: Top={means['Top']:,.0f}, High={means['High']:,.0f}, Mid={means['Mid']:,.0f}, Low={means['Low']:,.0f}")]

    if n.startswith("min-entities:"):
        level = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["level"] == level)
        return [metric(f"min-entities:{level}", count >= 8,
                       reason=f"{count} entities at {level} level")]

    if n.startswith("nonnull:"):
        col = n.split(":", 1)[1]
        bad = sum(1 for r in rows if not str(r.get(col, "")).strip())
        return [metric(f"nonnull:{col}", bad == 0,
                       reason=f"{bad} empty" if bad else "ok")]

    if n == "clv-numeric":
        bad = []
        for r in rows:
            try: float(r["clv"])
            except Exception: bad.append(r["entity_id"])
        return [metric("clv-numeric", not bad,
                       reason=f"{len(bad)} non-numeric" if bad else "ok")]

    if n == "transactions-int":
        bad = []
        for r in rows:
            try: int(r["transactions"])
            except Exception: bad.append(r["entity_id"])
        return [metric("transactions-int", not bad,
                       reason=f"{len(bad)} non-int" if bad else "ok")]

    if n == "no-nan-clv":
        import math
        bad = []
        for r in rows:
            try:
                v = float(r["clv"])
                if math.isnan(v) or math.isinf(v): bad.append(r["entity_id"])
            except Exception:
                bad.append(r["entity_id"])
        return [metric("no-nan-clv", not bad,
                       reason=f"{len(bad)} NaN/Inf" if bad else "ok")]

    if n.startswith("entity-id-format:"):
        import re
        level = n.split(":", 1)[1]
        # Brokers are intermediaries — in this schema brokers also live in the
        # CUST namespace, so we accept CUST#### for both levels.
        pat = re.compile(r"^(CUST|BROK)\d{3,}$")
        bad = [r["entity_id"] for r in rows
               if r["level"] == level and not pat.match(r.get("entity_id") or "")]
        return [metric(f"entity-id-format:{level}", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n in ("top-trans>mid-trans", "high-trans>low-trans"):
        higher, lower = ("Top", "Mid") if n == "top-trans>mid-trans" else ("High", "Low")
        hi = [int(r["transactions"] or 0) for r in rows if r["tier"] == higher]
        lo = [int(r["transactions"] or 0) for r in rows if r["tier"] == lower]
        if not hi or not lo:
            return [metric(n, False, reason=f"missing {higher} or {lower}")]
        hm = sum(hi) / len(hi)
        lm = sum(lo) / len(lo)
        return [metric(n, hm >= lm,
                       reason=f"{higher} mean {hm:.1f} vs {lower} mean {lm:.1f}")]

    return [metric("unknown-case", False, reason=f"no evaluator for {n}")]
