"""Scintilla — the daily sales-desk run.

`Scintilla` (Latin: "a spark"; in gemmology: the flashes of light a
diamond throws off when it moves) is the human-facing wrapper around
the ``scripts.orchestrator`` chain. Same engine, friendlier output:
each step's headline numbers print as a one-line summary plus the top
rows of every artifact so the desk can read what happened without
opening a CSV.

The plain orchestrator still works (and the Mahant UI calls it
directly) — Scintilla is the script you point a human at on demo day.

Run::

    uv run python scripts/scintilla.py
    uv run python scripts/scintilla.py --today 2026-05-14 \\
        --threshold-pct 5 --opp-ceiling 60
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATOR = REPO_ROOT / "scripts" / "orchestrator.py"
WORKING = REPO_ROOT / "data" / "working"

STEP_EMOJI = {
    "triage-inventory":  "⏳",
    "propose-repricing": "💎",
    "rank-customer-clv": "👑",
    "decide-memo":       "📝",
}

# (step_name, artifact_csv, columns to surface in the per-step preview)
STEP_PREVIEW: list[tuple[str, str, list[str]]] = [
    ("triage-inventory",  "triage_decisions.csv",   ["stock_id", "action_tag", "age_in_stock_days", "reason"]),
    ("propose-repricing", "repricing_proposals.csv", ["stock_id", "queue", "old_price", "proposed_price", "pct_change", "primary_driver"]),
    ("rank-customer-clv", "clv_tiers.csv",          ["entity_id", "entity_name", "tier", "clv", "transactions"]),
    ("decide-memo",       "memo_decisions.csv",     ["memo_id", "queue", "decision", "tier", "triage_tag", "rationale"]),
]


def _read_top(path: Path, n: int = 10) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))[:n]


def _short(val: str, width: int) -> str:
    s = str(val)
    return s if len(s) <= width else s[:width - 1] + "…"


def _print_table(rows: list[dict[str, str]], cols: list[str], widths: dict[str, int]) -> None:
    header = " | ".join(c.ljust(widths[c]) for c in cols)
    print("  " + header)
    print("  " + "-+-".join("-" * widths[c] for c in cols))
    for r in rows:
        print("  " + " | ".join(_short(r.get(c, ""), widths[c]).ljust(widths[c]) for c in cols))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--today", default=None, help="ISO date (YYYY-MM-DD).")
    parser.add_argument("--threshold-pct", type=float, default=None,
                        help="Repricing |%% change| auto-apply cap (decision point A).")
    parser.add_argument("--opp-ceiling", type=int, default=None,
                        help="Memo opportunity-score ceiling for auto-approve (decision point B).")
    parser.add_argument("--auto-tiers", default=None,
                        help="Comma list of CLV tiers eligible for memo auto-approve.")
    parser.add_argument("--top", type=int, default=10,
                        help="Number of rows to preview per step (default 10).")
    args = parser.parse_args()

    # Build the orchestrator command
    cmd = [sys.executable, str(ORCHESTRATOR)]
    if args.today:         cmd += ["--today", args.today]
    if args.threshold_pct is not None: cmd += ["--threshold-pct", str(args.threshold_pct)]
    if args.opp_ceiling is not None:   cmd += ["--opp-ceiling", str(args.opp_ceiling)]
    if args.auto_tiers:    cmd += ["--auto-tiers", args.auto_tiers]

    print("┌" + "─" * 60 + "┐")
    print("│ ✦  SCINTILLA  ·  Pramukh Gems daily sales-desk run         │")
    print("└" + "─" * 60 + "┘")
    if args.today:         print(f"   today        : {args.today}")
    if args.threshold_pct is not None: print(f"   threshold A  : ±{args.threshold_pct:.1f}%")
    if args.opp_ceiling is not None:   print(f"   threshold B  : opp ≤ {args.opp_ceiling}")
    if args.auto_tiers:    print(f"   auto tiers   : {args.auto_tiers}")
    print()

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT), check=False)
    if proc.returncode != 0:
        print(f"❌ Scintilla failed (orchestrator exit {proc.returncode})")
        print(proc.stderr or proc.stdout)
        return proc.returncode

    # Parse the four envelopes from stdout
    envelopes: dict[str, dict] = {}
    current_step = None
    buf: list[str] = []
    depth = 0
    for line in proc.stdout.splitlines():
        if line.startswith("--- step:"):
            current_step = line.replace("--- step:", "").replace("---", "").strip()
            buf = []
            depth = 0
            continue
        if current_step is None:
            continue
        if not buf and not line.lstrip().startswith("{"):
            continue
        buf.append(line)
        depth += line.count("{") - line.count("}")
        if depth <= 0 and buf:
            try:
                envelopes[current_step] = json.loads("\n".join(buf))
            except json.JSONDecodeError:
                pass
            buf = []
            current_step = None

    # Render each step in turn
    review_anywhere = False
    for step_name, fname, cols in STEP_PREVIEW:
        env = envelopes.get(step_name) or {}
        outputs = env.get("outputs") or {}
        emoji = STEP_EMOJI.get(step_name, "•")
        print()
        print(f"━━━ {emoji} {step_name.upper()} ━━━")
        if env.get("status") != "ok":
            print(f"   ⚠  step did not finish cleanly: {env.get('error')}")
            continue

        # Headline outputs as bullets
        headline = []
        for k, v in outputs.items():
            if isinstance(v, (int, float)) and k not in {"today"}:
                headline.append(f"{k}={v}")
            elif isinstance(v, dict):
                # by_tag, tier_counts
                inner = " ".join(f"{kk}:{vv}" for kk, vv in v.items())
                headline.append(f"{k}={{{inner}}}")
        print("   " + " · ".join(headline[:6]))

        if env.get("review_required"):
            review_anywhere = True
            print(f"   ⚠  some rows need human review — open {env['artifact_refs'][0]}")

        # Top-N preview of the artifact
        rows = _read_top(WORKING / fname, args.top)
        if rows:
            widths = {c: max(len(c), *(min(40, len(str(r.get(c, "")))) for r in rows)) for c in cols}
            print()
            print(f"   Top {len(rows)} rows of {fname}:")
            _print_table(rows, cols, widths)

    print()
    print("─" * 62)
    if review_anywhere:
        print("⚠  Some decisions need a human. Look in data/working/ for queue='needs_review' / 'review'.")
    else:
        print("✅ Full auto — no decisions waiting on a human this run.")
    print("─" * 62)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
