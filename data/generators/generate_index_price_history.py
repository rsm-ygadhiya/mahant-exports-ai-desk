import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

shapes = ["Round", "Princess", "Oval", "Pear", "Emerald", "Radiant"]
size_buckets = ["0.25-0.49", "0.50-0.99", "1.00-1.49", "1.50-1.99", "2.00-2.99", "3.00+"]
color_ranges = ["DEF", "GH", "IJK"]
clarity_ranges = ["VVS+", "VS", "SI"]

today = datetime.now().date()
start = today - timedelta(days=365)

# Generate weekly dates
rows = []
current = start
while current <= today:
    for shape in shapes:
        for size in size_buckets:
            for color in color_ranges:
                for clarity in clarity_ranges:
                    rows.append({
                        "index_date": current.isoformat(),
                        "shape": shape,
                        "size_bucket": size,
                        "color_range": color,
                        "clarity_range": clarity,
                        "index_price": round(random.uniform(250, 2200), 2),
                        "index_source": "Simulated IDEX",
                        "wow_change_pct": round(random.uniform(-0.08, 0.08), 4),
                        "mom_change_pct": round(random.uniform(-0.15, 0.15), 4),
                        "yoy_change_pct": round(random.uniform(-0.30, 0.25), 4)
                    })
    current = current + timedelta(days=7)

df = pl.DataFrame(rows)
out_path = Path(__file__).parent / "index_price_history_seed.csv"
df.write_csv(out_path)

print(f"Created index_price_history_seed.csv: {len(df)} rows")


def main():
    pass


if __name__ == "__main__":
    main()
