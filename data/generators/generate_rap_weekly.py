import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

# Load inventory to get unique categories
inventory_path = Path(__file__).parent / "inventory_seed.csv"

if not inventory_path.exists():
    raise FileNotFoundError("Run generate_inventory.py first")

inventory_df = pl.read_csv(inventory_path)
unique_categories = inventory_df.select("category_simple").unique().to_series().to_list()

today = datetime.now().date()
# Generate 52 weeks of Mondays (go back 52 weeks)
mondays = []
for week_offset in range(52):
    monday = today - timedelta(weeks=week_offset)
    # Find the actual Monday of that week
    days_since_monday = monday.weekday()
    monday = monday - timedelta(days=days_since_monday)
    mondays.append(monday)

mondays.sort()  # Oldest first

rap_rows = []

# Base Rap per category (from inventory distribution)
base_rap_by_category = {}
for cat in unique_categories:
    cat_stones = inventory_df.filter(pl.col("category_simple") == cat)
    if len(cat_stones) > 0:
        avg_ppc = cat_stones["ppc"].mean()
        base_rap_by_category[cat] = round(avg_ppc * random.uniform(0.95, 1.05), 2)
    else:
        base_rap_by_category[cat] = round(random.uniform(500, 2500), 2)

# Generate weekly Rap with mean-reverting noise
last_rap_by_category = base_rap_by_category.copy()

for monday in mondays:
    for category in unique_categories:
        base_rap = base_rap_by_category[category]
        last_rap = last_rap_by_category[category]

        # Mean-reverting noise: -3% to +3%
        wow_change_pct = round(random.uniform(-3.0, 3.0), 2)
        rap_per_carat = round(last_rap * (1 + wow_change_pct / 100), 2)

        # Mean revert slightly toward base
        rap_per_carat = round(rap_per_carat * 0.9 + base_rap * 0.1, 2)

        last_rap_by_category[category] = rap_per_carat

        rap_rows.append({
            "rap_week": monday.isoformat(),
            "category_simple": category,
            "rap_per_carat": rap_per_carat,
            "wow_change_pct": wow_change_pct,
            "source": "Simulated RapNet"
        })

df = pl.DataFrame(rap_rows)
out_path = Path(__file__).parent / "rap_weekly_seed.csv"
df.write_csv(out_path)

print(f"Created rap_weekly_seed.csv: {len(df)} rows")
print(f"Weeks: {len(mondays)}, Categories: {len(unique_categories)}")


def main():
    pass


if __name__ == "__main__":
    main()
