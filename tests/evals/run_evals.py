"""CLI: `uv run python tests/evals/run_evals.py --suite memo`

Prints a single JSON object to stdout. The Next.js admin UI shells out to
this and pipes the JSON straight back to the browser.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import traceback
from pathlib import Path

# Make the repo root importable so `tests.evals.*` resolves regardless of cwd.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

SUITES = {
    "triage":        "tests.evals.suites.triage",
    "repricing":     "tests.evals.suites.repricing",
    "clv":           "tests.evals.suites.clv",
    "memo":          "tests.evals.suites.memo",
    "opportunities": "tests.evals.suites.opportunities",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True, choices=sorted(SUITES))
    args = ap.parse_args()

    try:
        suite_module = importlib.import_module(SUITES[args.suite])
        from tests.evals.framework import run_suite
        result = run_suite(suite_module)
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        # Exit 0 even if some cases failed — the UI displays them; non-zero
        # is reserved for "runner itself broke".
        return 0
    except Exception as e:
        json.dump(
            {
                "suite": args.suite,
                "error": f"{e.__class__.__name__}: {e}",
                "traceback": traceback.format_exc(),
            },
            sys.stdout, indent=2,
        )
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
