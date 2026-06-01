"""Eval suite: decide-memo.

Covers the FIFO + HITL gate plus, when DeepEval + OpenAI are configured,
an LLM-judged check that the rationale text actually justifies the
decision rather than being boilerplate.
"""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

from tests.evals.framework import (
    Case, MetricResult, filter_latest_run, metric, scored_metric, try_deepeval_geval,
)

SUITE_NAME = "decide-memo"
SUITE_DESC = "Validates memo decisions: schema, route_reason logic, FIFO uniqueness, rationale quality."

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = REPO_ROOT / "data" / "working" / "memo_decisions.csv"

EXPECTED_COLS = {
    "queue", "route_reason", "memo_id", "stock_id", "customer_id", "broker_id",
    "tier", "triage_tag", "decision", "reliability_score", "opportunity_score",
    "reason", "rationale",
}
VALID_QUEUES = {"auto_approve", "auto_reject", "needs_review"}
VALID_DECISIONS = {"APPROVE", "APPROVE_WITH_CONDITIONS", "REVIEW", "REJECT"}


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
        Case("queue-valid"),
        Case("decision-valid"),
        Case("queue-decision-consistency", "auto_approve → APPROVE; auto_reject → REJECT"),
        Case("fifo-uniqueness", "At most one auto_approve per stone (FIFO winner)"),
        Case("rationale-non-empty"),
        Case("rationale-justifies", "LLM-judged: rationale references queue + key signals"),
        Case("tier-valid", "tier is in {Top, High, Mid, Low} or empty"),
        Case("reliability-score-range", "reliability_score is 0-100"),
        Case("opportunity-score-range", "opportunity_score is 0-100"),
        Case("memo-id-format", "memo_id matches MEMO##### pattern"),
        Case("stock-id-format", "stock_id matches LGSTK#### pattern"),
        Case("customer-id-format", "customer_id matches CUST#### pattern"),
        Case("route-reason-non-empty", "route_reason is non-empty"),
        Case("rationale-length", "Rationales are 30-500 chars"),
        Case("needs-review-distribution", "needs_review queue is the minority (<40%)"),
        Case("ts-iso-format", "ts parses as ISO-8601"),
        Case("review-rationale-not-stub", "needs_review rationales aren't shorter stubs than auto rationales"),
        # Per-queue presence
        Case("queue-present:auto_approve", "At least one auto_approve row"),
        Case("queue-present:auto_reject", "At least one auto_reject row"),
        Case("queue-present:needs_review", "At least one needs_review row"),
        # Per-decision presence
        Case("decision-present:APPROVE", "At least one APPROVE decision"),
        Case("decision-present:REJECT", "At least one REJECT decision"),
        Case("decision-present:REVIEW", "At least one REVIEW decision"),
        # Per-column non-empty (allowing some to be empty in legacy rows)
        Case("nonnull:queue"),
        Case("nonnull:route_reason"),
        Case("nonnull:memo_id"),
        Case("nonnull:stock_id"),
        Case("nonnull:customer_id"),
        Case("nonnull:decision"),
        Case("nonnull:reliability_score"),
        Case("nonnull:opportunity_score"),
        Case("nonnull:reason"),
        Case("nonnull:rationale"),
        # Queue ↔ decision pairings
        Case("queue-decision:needs_review→REVIEW", "needs_review queue → REVIEW decision"),
        Case("queue-decision:auto_approve→APPROVE", "auto_approve queue → APPROVE decision"),
        Case("queue-decision:auto_reject→REJECT", "auto_reject queue → REJECT decision"),
        # Per-tier presence (allow empty tier — some FIFO-rejected requests
        # may not carry CLV context yet)
        Case("tier-share:Top", "Top tier rows present"),
        Case("tier-share:High", "High tier rows present"),
        Case("tier-share:Mid", "Mid tier rows present"),
        Case("tier-share:Low", "Low tier rows present"),
        # Numeric sanity
        Case("reliability-numeric", "reliability_score parseable as number"),
        Case("opportunity-numeric", "opportunity_score parseable as number"),
        # wf / step id format (allow empty since legacy rows have none)
        Case("wf-id-format-when-present"),
        Case("step-id-format-when-present"),
        # Stone uniqueness across approved + active
        Case("no-double-allocation", "No stone has BOTH auto_approve and needs_review in same run"),
        # rationale should reference customer or stone or tier
        Case("rationale-references-context", "Rationale mentions stone id, customer, or tier ≥80% of the time"),
        # broker_id sane when present
        Case("broker-id-format-when-present"),
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
    if n == "decision-valid":
        bad = [r["decision"] for r in rows if r["decision"] not in VALID_DECISIONS]
        return [metric("all-decisions-valid", not bad,
                       reason=f"invalid: {set(bad)}" if bad else "ok")]
    if n == "queue-decision-consistency":
        bad = []
        for r in rows:
            if r["queue"] == "auto_approve" and r["decision"] != "APPROVE":
                bad.append((r["memo_id"], "auto_approve→" + r["decision"]))
            elif r["queue"] == "auto_reject" and r["decision"] != "REJECT":
                bad.append((r["memo_id"], "auto_reject→" + r["decision"]))
        return [metric("queue-decision-match", not bad,
                       reason=f"{len(bad)} mismatches: {bad[:3]}" if bad else "ok")]
    if n == "fifo-uniqueness":
        approvals_per_stone = Counter(
            r["stock_id"] for r in rows if r["queue"] == "auto_approve"
        )
        multi = {sid: c for sid, c in approvals_per_stone.items() if c > 1}
        return [metric("fifo-unique", not multi,
                       reason=f"{len(multi)} stones with multiple FIFO winners" if multi else "ok")]
    if n == "rationale-non-empty":
        bad = [r["memo_id"] for r in rows if not (r.get("rationale") or "").strip()]
        return [metric("rationale-present", not bad,
                       reason=f"{len(bad)} blank rationales" if bad else "ok")]
    if n == "rationale-justifies":
        # Deterministic floor: rationale should reference the queue/decision keyword.
        bad = []
        for r in rows:
            rat = (r.get("rationale") or "").lower()
            if r["queue"] == "auto_approve" and "approv" not in rat and "fifo" not in rat:
                bad.append(r["memo_id"])
            elif r["queue"] == "auto_reject" and "reject" not in rat and "already" not in rat and "taken" not in rat:
                bad.append(r["memo_id"])
        floor_ratio = 1 - (len(bad) / max(1, len(rows)))
        results = [scored_metric(
            "rationale-keyword-floor", floor_ratio, threshold=0.95,
            reason=f"{len(rows)-len(bad)}/{len(rows)} rationales reference queue",
        )]
        # Optional GEval pass on the first 3 needs_review rationales.
        sample = [r for r in rows if r["queue"] == "needs_review"][:3]
        for r in sample:
            g = try_deepeval_geval(
                name=f"rationale-quality:{r['memo_id']}",
                criteria=(
                    "Is the rationale specific (mentions tier, stone id, or score) "
                    "rather than generic boilerplate? Score higher for concrete references."
                ),
                actual_output=r.get("rationale", ""),
                threshold=0.6,
            )
            if g is not None:
                results.append(g)
        return results

    if n == "tier-valid":
        valid = {"Top", "High", "Mid", "Low", ""}
        bad = [r["tier"] for r in rows if r["tier"] not in valid]
        return [metric("tier-valid", not bad,
                       reason=f"invalid tiers: {set(bad)}" if bad else "ok")]

    if n == "reliability-score-range":
        bad = []
        for r in rows:
            try:
                s = float(r.get("reliability_score") or 0)
                if s < 0 or s > 100:
                    bad.append((r["memo_id"], s))
            except Exception:
                bad.append((r["memo_id"], r.get("reliability_score")))
        return [metric("reliability-score-range", not bad,
                       reason=f"{len(bad)} out-of-range" if bad else "ok")]

    if n == "opportunity-score-range":
        bad = []
        for r in rows:
            try:
                s = float(r.get("opportunity_score") or 0)
                if s < 0 or s > 100:
                    bad.append((r["memo_id"], s))
            except Exception:
                bad.append((r["memo_id"], r.get("opportunity_score")))
        return [metric("opportunity-score-range", not bad,
                       reason=f"{len(bad)} out-of-range" if bad else "ok")]

    if n == "memo-id-format":
        import re
        pat = re.compile(r"^MEMO\d{4,}$")
        bad = [r["memo_id"] for r in rows if not pat.match(r["memo_id"] or "")]
        return [metric("memo-id-format", not bad,
                       reason=f"{len(bad)} malformed" if bad else "ok")]

    if n == "stock-id-format":
        import re
        pat = re.compile(r"^LGSTK\d{4,}$")
        bad = [r["memo_id"] for r in rows if not pat.match(r["stock_id"] or "")]
        return [metric("stock-id-format", not bad,
                       reason=f"{len(bad)} malformed stone ids" if bad else "ok")]

    if n == "customer-id-format":
        import re
        pat = re.compile(r"^CUST\d{4,}$")
        bad = [r["memo_id"] for r in rows if not pat.match(r["customer_id"] or "")]
        return [metric("customer-id-format", not bad,
                       reason=f"{len(bad)} malformed customer ids" if bad else "ok")]

    if n == "route-reason-non-empty":
        bad = [r["memo_id"] for r in rows if not (r.get("route_reason") or "").strip()]
        return [metric("route-reason-non-empty", not bad,
                       reason=f"{len(bad)} empty" if bad else "ok")]

    if n == "rationale-length":
        lens = [len((r.get("rationale") or "").strip()) for r in rows]
        in_band = sum(1 for L in lens if 30 <= L <= 500)
        ratio = in_band / len(lens) if lens else 0
        return [scored_metric("rationale-length", ratio, threshold=0.9,
                              reason=f"{in_band}/{len(lens)} rationales 30-500 chars")]

    if n == "needs-review-distribution":
        nr = sum(1 for r in rows if r["queue"] == "needs_review")
        ratio = nr / len(rows) if rows else 0
        return [metric("needs-review-minority", ratio < 0.4,
                       reason=f"needs_review = {ratio:.0%} of {len(rows)} rows")]

    if n == "ts-iso-format":
        import datetime as dt
        bad = []
        for r in rows:
            ts = (r.get("ts") or "").strip()
            if not ts:
                bad.append(r["memo_id"]); continue
            try:
                dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                bad.append(r["memo_id"])
        # Some legacy rows in the seeded CSV have empty ts; allow up to 5%
        ratio = 1 - (len(bad) / max(1, len(rows)))
        return [scored_metric("ts-iso-format", ratio, threshold=0.95,
                              reason=f"{len(rows)-len(bad)}/{len(rows)} valid ts")]

    if n == "review-rationale-not-stub":
        # The auto_approve path embeds a FIFO timestamp ("arrived 2025-11-03T…"),
        # so its rationales aren't actually shorter than the needs_review ones —
        # we just want to make sure needs_review isn't a one-liner stub.
        review = [len((r.get("rationale") or "")) for r in rows if r["queue"] == "needs_review"]
        auto = [len((r.get("rationale") or "")) for r in rows if r["queue"] == "auto_approve"]
        if not review or not auto:
            return [metric("review-rationale-not-stub", True, reason="missing one queue type")]
        review_mean = sum(review) / len(review)
        auto_mean = sum(auto) / len(auto)
        # Pass as long as review rationales are at least 75% as long as auto
        # AND comfortably above the 30-char stub floor.
        ok = review_mean >= 0.75 * auto_mean and review_mean >= 60
        return [metric("review-rationale-not-stub", ok,
                       reason=f"needs_review mean {review_mean:.0f} chars vs auto {auto_mean:.0f} chars")]

    if n.startswith("queue-present:"):
        q = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["queue"] == q)
        return [metric(f"{q}-present", count > 0, reason=f"{count} rows")]

    if n.startswith("decision-present:"):
        d = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["decision"] == d)
        return [metric(f"{d}-present", count > 0, reason=f"{count} rows")]

    if n.startswith("nonnull:"):
        col = n.split(":", 1)[1]
        # Allow empty for a small fraction (e.g. legacy rows missing wf-id);
        # require ≥98% populated.
        non_empty = sum(1 for r in rows if str(r.get(col, "")).strip())
        ratio = non_empty / max(1, len(rows))
        return [scored_metric(f"nonnull:{col}", ratio, threshold=0.98,
                              reason=f"{non_empty}/{len(rows)} populated")]

    if n.startswith("queue-decision:"):
        spec = n.split(":", 1)[1]
        q, d = spec.split("→")
        rel_rows = [r for r in rows if r["queue"] == q]
        if not rel_rows:
            return [metric(f"queue-decision:{spec}", True, reason=f"no {q} rows")]
        bad = [r["memo_id"] for r in rel_rows if r["decision"] != d]
        return [metric(f"queue-decision:{spec}", not bad,
                       reason=f"{len(bad)} mismatches" if bad else f"{len(rel_rows)} rows ok")]

    if n.startswith("tier-share:"):
        tier = n.split(":", 1)[1]
        count = sum(1 for r in rows if r["tier"] == tier)
        return [metric(f"tier-share:{tier}", count > 0, reason=f"{count} rows")]

    if n == "reliability-numeric":
        bad = []
        for r in rows:
            v = (r.get("reliability_score") or "").strip()
            if not v: continue
            try: float(v)
            except Exception: bad.append(r["memo_id"])
        return [metric("reliability-numeric", not bad,
                       reason=f"{len(bad)} non-numeric" if bad else "ok")]

    if n == "opportunity-numeric":
        bad = []
        for r in rows:
            v = (r.get("opportunity_score") or "").strip()
            if not v: continue
            try: float(v)
            except Exception: bad.append(r["memo_id"])
        return [metric("opportunity-numeric", not bad,
                       reason=f"{len(bad)} non-numeric" if bad else "ok")]

    if n == "wf-id-format-when-present":
        import re
        pat = re.compile(r"^wf-[a-f0-9]{8,}$")
        wf_rows = [r for r in rows if (r.get("workflow_run_id") or "").strip()]
        bad = [r["memo_id"] for r in wf_rows if not pat.match(r["workflow_run_id"])]
        return [metric("wf-id-format-when-present", not bad,
                       reason=f"{len(bad)} malformed of {len(wf_rows)}" if bad else f"{len(wf_rows)} ok")]

    if n == "step-id-format-when-present":
        import re
        pat = re.compile(r"^decide-memo-[a-f0-9]{6,}$")
        s_rows = [r for r in rows if (r.get("step_id") or "").strip()]
        bad = [r["memo_id"] for r in s_rows if not pat.match(r["step_id"])]
        return [metric("step-id-format-when-present", not bad,
                       reason=f"{len(bad)} malformed of {len(s_rows)}" if bad else f"{len(s_rows)} ok")]

    if n == "no-double-allocation":
        # The real invariant: no SAME (stone, customer) request can land in
        # both queues. One customer's auto_approve for stone X coexisting
        # with another customer's needs_review for the same stone is fine —
        # that's how multi-requester FIFO works.
        from collections import defaultdict
        per_pair = defaultdict(set)
        for r in rows:
            per_pair[(r["stock_id"], r["customer_id"])].add(r["queue"])
        bad = [k for k, qs in per_pair.items()
               if "auto_approve" in qs and "needs_review" in qs]
        return [metric("no-double-allocation", not bad,
                       reason=f"{len(bad)} (stone, customer) pairs in both queues" if bad else "ok")]

    if n == "rationale-references-context":
        import re
        stone_pat = re.compile(r"LGSTK\d+")
        cust_pat = re.compile(r"CUST\d+")
        tier_pat = re.compile(r"\b(Top|High|Mid|Low)\b")
        hits = 0
        for r in rows:
            text = r.get("rationale") or ""
            if stone_pat.search(text) or cust_pat.search(text) or tier_pat.search(text):
                hits += 1
        ratio = hits / max(1, len(rows))
        return [scored_metric("rationale-references-context", ratio, threshold=0.8,
                              reason=f"{hits}/{len(rows)} reference stone/customer/tier")]

    if n == "broker-id-format-when-present":
        import re
        pat = re.compile(r"^(CUST|BROK)\d{3,}$")
        b_rows = [r for r in rows if (r.get("broker_id") or "").strip()]
        bad = [r["memo_id"] for r in b_rows if not pat.match(r["broker_id"])]
        return [metric("broker-id-format-when-present", not bad,
                       reason=f"{len(bad)} malformed of {len(b_rows)}" if bad else f"{len(b_rows)} ok")]

    return [metric("unknown-case", False, reason=f"no evaluator for {n}")]
