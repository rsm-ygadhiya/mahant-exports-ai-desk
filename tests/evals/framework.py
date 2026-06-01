"""Lightweight DeepEval-style harness for the Scintilla skills.

Why not raw deepeval? Most of our skills emit structured CSVs and JSON
envelopes — the bulk of the eval value is deterministic schema/value
assertions, not LLM-judged free text. So we mirror DeepEval's
TestCase/Metric/Score idiom but keep it dependency-free, and reach for
DeepEval's GEval only on the few metrics that actually need an LLM judge
(see `try_deepeval_geval`).

Each suite module exposes:

    SUITE_NAME: str
    SUITE_DESC: str
    def collect_cases() -> list[Case]
    def evaluate(case: Case) -> list[MetricResult]

The runner (run_evals.py) imports the suite and prints results as JSON.
"""

from __future__ import annotations

import dataclasses
import time
import traceback
from typing import Any, Callable


@dataclasses.dataclass
class Case:
    name: str
    description: str = ""
    # Free-form inputs / expected — interpretation is up to the suite.
    input: dict[str, Any] = dataclasses.field(default_factory=dict)
    expected: dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class MetricResult:
    metric: str
    score: float       # 0.0 .. 1.0
    threshold: float   # pass if score >= threshold
    passed: bool
    reason: str = ""


def metric(name: str, passed: bool, threshold: float = 1.0, reason: str = "") -> MetricResult:
    """Convenience constructor for binary pass/fail metrics."""
    return MetricResult(
        metric=name,
        score=1.0 if passed else 0.0,
        threshold=threshold,
        passed=passed,
        reason=reason,
    )


def scored_metric(name: str, score: float, threshold: float = 0.7, reason: str = "") -> MetricResult:
    """Convenience for graded metrics (score in [0,1])."""
    s = max(0.0, min(1.0, score))
    return MetricResult(
        metric=name,
        score=s,
        threshold=threshold,
        passed=s >= threshold,
        reason=reason,
    )


def try_deepeval_geval(
    *,
    name: str,
    criteria: str,
    actual_output: str,
    threshold: float = 0.7,
) -> MetricResult | None:
    """If deepeval + an OpenAI key are available, run a real GEval check.
    Returns None when the dependency or key is missing, so the suite can
    decide to skip rather than fail."""
    try:
        import os
        if not os.environ.get("OPENAI_API_KEY"):
            return None
        from deepeval.metrics import GEval  # type: ignore
        from deepeval.test_case import LLMTestCase, LLMTestCaseParams  # type: ignore
    except Exception:
        return None

    try:
        m = GEval(
            name=name,
            criteria=criteria,
            evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
            threshold=threshold,
        )
        tc = LLMTestCase(input="", actual_output=actual_output)
        m.measure(tc)
        return scored_metric(name, m.score or 0.0, threshold=threshold, reason=m.reason or "")
    except Exception as e:  # pragma: no cover — keep eval robust
        return MetricResult(
            metric=name, score=0.0, threshold=threshold,
            passed=False, reason=f"GEval failed: {e!r}",
        )


def run_case(case: Case, evaluate: Callable[[Case], list[MetricResult]]) -> dict[str, Any]:
    t0 = time.perf_counter()
    error: str | None = None
    metrics: list[MetricResult] = []
    try:
        metrics = evaluate(case)
    except Exception as e:
        error = f"{e.__class__.__name__}: {e}\n{traceback.format_exc(limit=3)}"
    dt_ms = int((time.perf_counter() - t0) * 1000)

    passed = bool(metrics) and all(m.passed for m in metrics) and error is None
    return {
        "name": case.name,
        "description": case.description,
        "passed": passed,
        "duration_ms": dt_ms,
        "error": error,
        "metrics": [dataclasses.asdict(m) for m in metrics],
    }


def run_suite(suite_module) -> dict[str, Any]:
    """Top-level entry point. Returns a JSON-able results bundle."""
    name = getattr(suite_module, "SUITE_NAME", suite_module.__name__)
    desc = getattr(suite_module, "SUITE_DESC", "")
    cases: list[Case] = suite_module.collect_cases()
    evaluate = suite_module.evaluate

    results = [run_case(c, evaluate) for c in cases]
    passed = sum(1 for r in results if r["passed"])
    return {
        "suite": name,
        "description": desc,
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "cases": results,
        "deepeval_available": _deepeval_available(),
    }


def filter_latest_run(rows: list[dict]) -> list[dict]:
    """Working CSVs accumulate across orchestrator runs. Most eval invariants
    (FIFO uniqueness, entity uniqueness, tier balance) are only meaningful
    within a single run, so suites filter to the latest workflow_run_id
    when one is present."""
    if not rows:
        return rows
    run_ids = [r.get("workflow_run_id") for r in rows if r.get("workflow_run_id")]
    if not run_ids:
        return rows
    # Use max() over the ts column to pick the latest run rather than
    # relying on insertion order.
    by_run: dict[str, list[dict]] = {}
    for r in rows:
        by_run.setdefault(r.get("workflow_run_id") or "", []).append(r)
    latest_run = max(by_run.keys(), key=lambda k: max(
        (r.get("ts") or "") for r in by_run[k]
    ))
    return by_run[latest_run]


def _deepeval_available() -> bool:
    try:
        import os
        import deepeval  # type: ignore  # noqa: F401
        return bool(os.environ.get("OPENAI_API_KEY"))
    except Exception:
        return False
