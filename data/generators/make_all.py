#!/usr/bin/env python
"""
Pipeline runner: generates all seed CSVs in dependency order.
Run from data/Milestone_2/ directory.
"""
import subprocess
import sys
from pathlib import Path

# Ordered list of generators
generators = [
    "generate_customers.py",
    "generate_inventory.py",
    "generate_sales.py",
    "generate_threads.py",
    "generate_communication_logs.py",
    "generate_quotes.py",
    "generate_payment_history.py",
    "generate_memos.py",
    "generate_demand.py",
    "generate_orders_queue.py",
    "generate_index_price_history.py",
    "generate_rap_weekly.py",
    "generate_forecast_outputs.py",
    "generate_cut_simulations.py",
]

script_dir = Path(__file__).parent
failed = []

for gen in generators:
    script_path = script_dir / gen
    print(f"\n{'='*70}")
    print(f"Running: {gen}")
    print(f"{'='*70}")

    result = subprocess.run(
        ["python", str(script_path)],
        cwd=script_dir,
        capture_output=False
    )

    if result.returncode != 0:
        print(f"ERROR: {gen} failed with code {result.returncode}")
        failed.append(gen)
        break  # Stop on first failure
    else:
        print(f"✓ {gen} completed successfully")

print(f"\n{'='*70}")
if failed:
    print(f"FAILED: {', '.join(failed)}")
    sys.exit(1)
else:
    print("All generators completed successfully!")
    print(f"Generated {len(generators)} seed CSVs")
    sys.exit(0)
