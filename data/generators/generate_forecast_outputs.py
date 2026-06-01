import polars as pl
import random
import numpy as np
from datetime import datetime
from pathlib import Path

random.seed(42)
np.random.seed(42)

demand_path = Path(__file__).parent / "demand_signals_seed.csv"

if not demand_path.exists():
    raise FileNotFoundError("Run generate_demand.py first")

demand_df = pl.read_csv(demand_path)
categories = demand_df.select("category_simple").unique().to_series().to_list()

today = datetime.now().date()
rows = []

for category in categories:
    ty_qty = random.randint(5, 120)
    ly_qty = max(1, int(ty_qty * random.uniform(0.7, 1.2)))
    prior_qty = max(1, int(ty_qty * random.uniform(0.6, 1.1)))
    pred_qty = max(1, int(ty_qty * random.uniform(0.9, 1.3)))

    rows.append({
        "forecast_date": today.isoformat(),
        "category_simple": category,
        "ty_qty": ty_qty,
        "ly_qty": ly_qty,
        "prior_period_qty": prior_qty,
        "growth_rate_pct": round((ty_qty - ly_qty) / max(ly_qty, 1), 4),
        "predicted_quantity": pred_qty,
        "predicted_price_range_min": round(random.uniform(200, 1200), 2),
        "predicted_price_range_max": round(random.uniform(1200, 3000), 2),
        "confidence_score": round(random.uniform(0.55, 0.95), 2),
        "recommended_sourcing_qty": max(0, pred_qty - random.randint(0, 20))
    })

df = pl.DataFrame(rows)
out_path = Path(__file__).parent / "forecast_outputs_seed.csv"
df.write_csv(out_path)

print(f"Created forecast_outputs_seed.csv: {len(df)} rows")


def main():
    pass


if __name__ == "__main__":
    main()
