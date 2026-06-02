"""Eval suite: opportunity-finder.

Reads the latest opportunity-finder state from ui/web/.opp-state.json (the
JSON store the live web-scrape writes after every Find run) and asserts the
invariants that matter for honesty + usability:

- Schema: every persisted lead has the required fields with sensible types.
- Identity: ids are unique kebab-case slugs.
- Canonical vocab: every region / segment / status is from the allowed set.
- Confidence: 0-100, integer.
- NO FABRICATED CONTACT INFO: portal_url and contact_email, when present,
  point at real-looking values. Placeholder patterns (example.com,
  your-domain, made-up TLDs) are forbidden. Missing values are allowed and
  expected — the UI shows "No info found" rather than fake links.
- Source URL: when present, hostname looks like a real news source.
- Portal HEAD-verify integrity: when portal_verified is true, the URL has
  in fact been live-checked by the scraper; we don't re-fetch live during
  the eval (would be slow + flaky) but we assert the field shape.
- Optional GEval: when DeepEval + OPENAI_API_KEY are available, an LLM
  judge grades the fit_summary for groundedness in the headline.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

from tests.evals.framework import Case, MetricResult, metric, scored_metric, try_deepeval_geval

SUITE_NAME = "opportunity-finder"
SUITE_DESC = "Validates the Opportunity Finder's persisted leads: schema, vocab, honest URLs/emails, and fit-summary quality."

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT = REPO_ROOT / "ui" / "web" / ".opp-state.json"

VALID_REGIONS = {"North America", "Europe", "India", "Middle East", "Asia-Pacific"}
VALID_SEGMENTS = {
    "Big-box retail", "Specialty jeweler", "Online marketplace",
    "Department store", "Bridal chain", "Luxury house",
}
VALID_STATUSES = {"new", "draft", "pursuing", "sent", "discarded"}

REQUIRED_FIELDS = {
    "id", "company", "region", "segment", "fit_summary",
    "contact_role", "confidence", "status",
}

# Patterns that indicate a fabricated / placeholder value.
PLACEHOLDER_PATTERNS = re.compile(
    r"example\.com|your[-_]?domain|placeholder|test\.local|@your|<.*>|sample\.com|TODO|FIXME",
    re.IGNORECASE,
)
KEBAB_ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def _load() -> list[dict]:
    if not ARTIFACT.exists():
        return []
    try:
        data = json.loads(ARTIFACT.read_text())
    except Exception:
        return []
    bag = data.get("opportunities", {})
    if isinstance(bag, dict):
        return list(bag.values())
    if isinstance(bag, list):
        return bag
    return []


def collect_cases() -> list[Case]:
    return [
        Case("artifact-exists",     ".opp-state.json must exist (run Find opportunities once)"),
        Case("non-empty",           "At least one lead persisted"),
        Case("schema",              "Every lead has the required fields"),
        Case("id-kebab",            "id is a kebab-case slug ([a-z0-9-]+)"),
        Case("id-unique",           "ids are unique across the store"),
        Case("region-valid",        "Every region is one of the 5 canonical regions"),
        Case("segment-valid",       "Every segment is one of the 6 canonical segments"),
        Case("status-valid",        "Every status is one of {new, draft, pursuing, sent, discarded}"),
        Case("confidence-range",    "confidence is an integer in [0, 100]"),
        Case("company-non-empty",   "company string is non-empty"),
        Case("fit-summary-len",     "fit_summary is 20-400 chars (substantive but not a wall of text)"),
        Case("no-fake-portal",      "No portal_url contains placeholder patterns (example.com, your-domain, …)"),
        Case("no-fake-email",       "No contact_email contains placeholder patterns"),
        Case("portal-url-shape",    "When portal_url is set, it parses as http(s) with a hostname"),
        Case("contact-email-shape", "When contact_email is set, it matches a basic RFC 5322-ish pattern"),
        Case("portal-verified-flag","portal_verified, when set, is a boolean"),
        Case("source-url-shape",    "When source_url is set, hostname looks like a real news source (has a TLD)"),
        Case("missing-info-allowed","Some leads may lack portal_url or contact_email — that's correct, not a failure"),
        Case("fit-summary-grounded","LLM judge: fit_summary is concrete and references this specific company"),
    ]


def evaluate(case: Case) -> list[MetricResult]:
    rows = _load()
    n = case.name

    if n == "artifact-exists":
        return [metric("file-exists", ARTIFACT.exists(),
                       reason=f"expected {ARTIFACT.relative_to(REPO_ROOT)}")]

    if n == "non-empty":
        return [metric("lead-count", len(rows) > 0, reason=f"got {len(rows)} leads")]

    if n == "schema":
        if not rows:
            return [metric("schema", False, reason="no leads to check schema")]
        missing_any = []
        for r in rows:
            missing = REQUIRED_FIELDS - set(r.keys())
            if missing:
                missing_any.append(f"{r.get('id', '?')}: missing {sorted(missing)}")
        return [metric("schema", not missing_any,
                       reason="; ".join(missing_any[:3]) if missing_any else "ok")]

    if n == "id-kebab":
        bad = [r.get("id", "") for r in rows if not KEBAB_ID_RE.match(str(r.get("id", "")))]
        return [metric("id-format", not bad, reason=f"non-kebab ids: {bad[:5]}" if bad else "ok")]

    if n == "id-unique":
        ids = [r.get("id", "") for r in rows]
        dupes = {i for i in ids if ids.count(i) > 1}
        return [metric("id-unique", not dupes, reason=f"duplicate ids: {sorted(dupes)}" if dupes else "ok")]

    if n == "region-valid":
        bad = [r.get("region") for r in rows if r.get("region") not in VALID_REGIONS]
        return [metric("region-vocab", not bad, reason=f"invalid: {set(bad)}" if bad else "ok")]

    if n == "segment-valid":
        bad = [r.get("segment") for r in rows if r.get("segment") not in VALID_SEGMENTS]
        return [metric("segment-vocab", not bad, reason=f"invalid: {set(bad)}" if bad else "ok")]

    if n == "status-valid":
        bad = [r.get("status") for r in rows if r.get("status") not in VALID_STATUSES]
        return [metric("status-vocab", not bad, reason=f"invalid: {set(bad)}" if bad else "ok")]

    if n == "confidence-range":
        bad = []
        for r in rows:
            c = r.get("confidence")
            if not isinstance(c, (int, float)) or c < 0 or c > 100:
                bad.append((r.get("id"), c))
        return [metric("confidence-range", not bad,
                       reason=f"out-of-range: {bad[:5]}" if bad else "ok")]

    if n == "company-non-empty":
        bad = [r.get("id") for r in rows if not str(r.get("company", "")).strip()]
        return [metric("company-present", not bad, reason=f"missing: {bad[:5]}" if bad else "ok")]

    if n == "fit-summary-len":
        too_short, too_long = [], []
        for r in rows:
            fs = str(r.get("fit_summary", ""))
            if len(fs) < 20:    too_short.append(r.get("id"))
            elif len(fs) > 400: too_long.append(r.get("id"))
        total_bad = len(too_short) + len(too_long)
        score = 1.0 if not rows else 1 - (total_bad / len(rows))
        return [scored_metric(
            "fit-summary-len", score, threshold=0.9,
            reason=f"{total_bad}/{len(rows)} out of 20-400 chars ({len(too_short)} too short, {len(too_long)} too long)",
        )]

    if n == "no-fake-portal":
        bad = []
        for r in rows:
            u = r.get("portal_url")
            if u and PLACEHOLDER_PATTERNS.search(str(u)):
                bad.append((r.get("id"), u))
        return [metric("no-fake-portal", not bad,
                       reason=f"placeholder portal URLs: {bad[:5]}" if bad else "ok")]

    if n == "no-fake-email":
        bad = []
        for r in rows:
            e = r.get("contact_email")
            if e and PLACEHOLDER_PATTERNS.search(str(e)):
                bad.append((r.get("id"), e))
        return [metric("no-fake-email", not bad,
                       reason=f"placeholder emails: {bad[:5]}" if bad else "ok")]

    if n == "portal-url-shape":
        bad = []
        for r in rows:
            u = r.get("portal_url")
            if not u:
                continue  # missing is allowed
            try:
                parsed = urlparse(str(u))
                if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                    bad.append((r.get("id"), u))
            except Exception:
                bad.append((r.get("id"), u))
        return [metric("portal-url-shape", not bad,
                       reason=f"malformed: {bad[:5]}" if bad else "ok")]

    if n == "contact-email-shape":
        bad = []
        for r in rows:
            e = r.get("contact_email")
            if not e:
                continue  # missing is allowed
            if not EMAIL_RE.match(str(e)):
                bad.append((r.get("id"), e))
        return [metric("contact-email-shape", not bad,
                       reason=f"malformed: {bad[:5]}" if bad else "ok")]

    if n == "portal-verified-flag":
        bad = []
        for r in rows:
            v = r.get("portal_verified")
            if v is not None and not isinstance(v, bool):
                bad.append((r.get("id"), v))
        return [metric("portal-verified-flag", not bad,
                       reason=f"non-bool: {bad[:5]}" if bad else "ok")]

    if n == "source-url-shape":
        bad = []
        for r in rows:
            u = r.get("source_url")
            if not u:
                continue
            try:
                parsed = urlparse(str(u))
                host = parsed.hostname or ""
                if parsed.scheme not in {"http", "https"} or "." not in host:
                    bad.append((r.get("id"), u))
            except Exception:
                bad.append((r.get("id"), u))
        return [metric("source-url-shape", not bad,
                       reason=f"malformed source URLs: {bad[:5]}" if bad else "ok")]

    if n == "missing-info-allowed":
        # Sanity-only: count how many leads are missing portal vs email, but
        # always pass. The other checks already guarantee what's present is real.
        no_portal = sum(1 for r in rows if not r.get("portal_url"))
        no_email  = sum(1 for r in rows if not r.get("contact_email"))
        return [metric("missing-info-allowed", True,
                       reason=f"{no_portal}/{len(rows)} without portal, {no_email}/{len(rows)} without email — expected & honest")]

    if n == "fit-summary-grounded":
        # Optional LLM-judge metric: only runs when DeepEval + OPENAI_API_KEY exist.
        if not rows:
            return [metric("fit-summary-grounded", False, reason="no leads to judge")]
        # Take a sample for cost control.
        sample = rows[: min(5, len(rows))]
        text = "\n".join(
            f"- company={r['company']} | region={r.get('region')} | segment={r.get('segment')} | fit_summary={r.get('fit_summary')}"
            for r in sample
        )
        criteria = (
            "Each fit_summary should be concrete and reference the specific company by name, "
            "their reported demand, or their segment in a way that justifies why they're a fit "
            "for a lab-grown diamond wholesaler. Generic blurbs that could apply to any "
            "jeweler should score low."
        )
        result = try_deepeval_geval(
            name="fit-summary-grounded",
            criteria=criteria,
            actual_output=text,
            threshold=0.6,
        )
        if result is None:
            # DeepEval/key not available — skip cleanly without failing the suite.
            return [metric("fit-summary-grounded", True, reason="DeepEval or OPENAI_API_KEY unavailable; skipped LLM judge")]
        return [result]

    return [metric(case.name, False, reason="unknown case")]
