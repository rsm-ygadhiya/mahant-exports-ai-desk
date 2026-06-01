import polars as pl
import random
import numpy as np
from pathlib import Path

random.seed(42)
np.random.seed(42)

forecast_path = Path(__file__).parent / "forecast_outputs_seed.csv"
inventory_path = Path(__file__).parent / "inventory_seed.csv"

if not all(p.exists() for p in [inventory_path]):
    raise FileNotFoundError("Run generate_inventory.py first")

forecast_df = pl.read_csv(forecast_path) if forecast_path.exists() else None
inventory_df = pl.read_csv(inventory_path)

target_categories = forecast_df.select("category_simple").to_series().to_list() if forecast_df is not None else ["Round | 1.00-1.49 | DEF | VS"]
inventory_list = inventory_df.to_dicts()

rows = []
for i in range(1, 401):
    stock_row = random.choice(inventory_list)
    projected_carat = round(max(0.2, float(stock_row["carat"]) * random.uniform(0.65, 1.05)), 2)
    projected_ppc = round(random.uniform(250, 2500), 2)
    demand_match = round(random.uniform(0.4, 1.0), 2)
    yield_score = round(random.uniform(0.4, 1.0), 2)

    rows.append({
        "simulation_id": f"SIM{i:05d}",
        "rough_stone_id": stock_row["stock_id"],
        "target_category": random.choice(target_categories),
        "proposed_cut_shape": random.choice(["Round", "Oval", "Princess", "Emerald", "Radiant", "Pear"]),
        "projected_carat": projected_carat,
        "projected_quality": random.choice(["DEF | VVS+", "DEF | VS", "GH | VVS+", "GH | VS", "IJK | SI"]),
        "projected_price_per_carat": projected_ppc,
        "projected_total_value": round(projected_ppc * projected_carat, 2),
        "demand_match_score": demand_match,
        "yield_score": yield_score,
        "combined_score": round((demand_match * 0.6) + (yield_score * 0.4), 2),
        "selected_flag": random.choice([0, 0, 1])
    })

df = pl.DataFrame(rows)
out_path = Path(__file__).parent / "cut_simulations_seed.csv"
df.write_csv(out_path)

print(f"Created cut_simulations_seed.csv: {len(df)} rows")


def main():
    pass


if __name__ == "__main__":
    main()
