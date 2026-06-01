import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from _categorize import simplify_category

random.seed(42)
np.random.seed(42)

# Load inventory seed data
inventory_path = Path(__file__).parent / "inventory_seed.csv"
if not inventory_path.exists():
    raise FileNotFoundError("Run generate_inventory.py first")

inventory_df = pl.read_csv(inventory_path)
unique_categories = inventory_df.select("category_simple").unique().to_series().to_list()

def random_date():
    return (datetime.now() - timedelta(days=random.randint(0, 180))).date()

def demand_profile(category):
    """Make demand more realistic based on category."""
    score = 0.4
    if "Round" in category:
        score += 0.2
    if "0.50-0.99" in category or "1.00-1.49" in category or "1.50-1.99" in category:
        score += 0.2
    if "DEF" in category or "GH" in category:
        score += 0.1
    if "VVS+" in category or "VS" in category:
        score += 0.1
    return min(score, 0.95)

data = []

# Generate 2000 market demand observations
for _ in range(2000):
    category = random.choice(unique_categories)
    base_demand = demand_profile(category)

    # Listing count depends somewhat on demand
    listing_count = int(random.uniform(20, 300) * (0.7 + base_demand))

    # Market price ranges should loosely align with wholesale lab-grown context
    avg_market_price = round(random.uniform(300, 2500) * (0.8 + base_demand / 2), 2)

    # Final demand score with noise
    demand_score = round(
        max(0.05, min(1.0, random.uniform(base_demand - 0.15, base_demand + 0.15))),
        2
    )

    data.append({
        "signal_date": random_date().isoformat(),
        "category_simple": category,
        "listing_count": listing_count,
        "avg_market_price": avg_market_price,
        "demand_score": demand_score
    })

df_out = pl.DataFrame(data)
out_path = Path(__file__).parent / "demand_signals_seed.csv"
df_out.write_csv(out_path)

print(f"Created demand_signals_seed.csv: {len(df_out)} rows")


def main():
    pass


if __name__ == "__main__":
    main()
