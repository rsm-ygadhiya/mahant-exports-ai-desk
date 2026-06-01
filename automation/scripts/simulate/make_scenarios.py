"""Build three named simulated CSV snapshots under `data/scenarios/`.

Each scenario starts from the frozen baseline and applies a different
amount + shape of simulated activity. The skills can then be demoed
against each snapshot to show how their output changes with business
conditions.

Scenarios
---------
1. **scenario_a_normal_day**     — baseline + 1 daily tick (Tue +1).
   Quiet typical weekday: ~5 sales, ~6 quotes, ~10 messages, no Rap drop.
   Use to show "first-day" behavior of each skill on fresh data.

2. **scenario_b_monday_rap_drop** — baseline + 7 daily ticks (Mon +7).
   A full business week of activity, ending on a Monday with the weekly
   Rap rate drop already applied. Use to demo the weekly-repricing
   skill specifically + see how a week of aging affects the triage.

3. **scenario_c_month_end_stress** — baseline + 30 daily ticks.
   A month of compounded activity, ~4 Rap drops, ~150 new sales,
   ~200 new quotes, ~30 new memos, lots of aging. Use to demo
   collection-reminder (many invoices past due), inventory-aging-triage
   (lots of CLEAR-eligible stones), and the morning-briefing chaining
   them together.

Run
---
  python scripts/simulate/make_scenarios.py            # build all three
  python scripts/simulate/make_scenarios.py --only b   # rebuild scenario B
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TICK = ROOT / "scripts" / "simulate" / "tick.py"

# Fixed seeds so each scenario is reproducible
SCENARIOS = {
    "a": {
        "name": "scenario_a_normal_day",
        "days": 1,
        "seed": 42,
        "desc": "1 daily tick — quiet weekday",
    },
    "b": {
        "name": "scenario_b_monday_rap_drop",
        "days": 7,
        "seed": 101,
        "desc": "7 daily ticks — full week, Monday Rap drop fires automatically",
    },
    "c": {
        "name": "scenario_c_month_end_stress",
        "days": 30,
        "seed": 2025,
        "desc": "30 daily ticks — compounded aging, ~4 Rap drops, heavy backlog",
    },
}


def run(*args: str) -> None:
    cmd = [sys.executable, str(TICK), *args]
    print(f"  $ {' '.join(args)}")
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr, file=sys.stderr)
        sys.exit(f"tick.py failed: {' '.join(args)}")


def build(scenario_key: str) -> None:
    cfg = SCENARIOS[scenario_key]
    print(f"\n=== Building {cfg['name']} — {cfg['desc']} ===")
    run("--reset")
    run("--days", str(cfg["days"]), "--seed", str(cfg["seed"]))
    run("--snapshot", cfg["name"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--only",
        choices=list(SCENARIOS.keys()),
        help="build a single scenario by key (a / b / c). Default: all.",
    )
    args = ap.parse_args()

    keys = [args.only] if args.only else list(SCENARIOS.keys())
    for k in keys:
        build(k)

    # Leave the working tree on the baseline at the end — easier to reason
    # about. Use --load NAME to bring a scenario back.
    run("--reset")
    print("\nAll done. Restore any scenario with:")
    for k, cfg in SCENARIOS.items():
        if k in keys:
            print(f"  python scripts/simulate/tick.py --load {cfg['name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
