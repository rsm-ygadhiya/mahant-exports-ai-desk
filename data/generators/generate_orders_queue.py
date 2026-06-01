import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

inventory_path = Path(__file__).parent / "inventory_seed.csv"
demand_path = Path(__file__).parent / "demand_signals_seed.csv"

if not inventory_path.exists():
    raise FileNotFoundError("Run generate_inventory.py first")

inventory_df = pl.read_csv(inventory_path)
demand_df = pl.read_csv(demand_path) if demand_path.exists() else None

categories = inventory_df.select("category_simple").unique().to_series().to_list()
if demand_df is not None:
    demand_cats = demand_df.select("category_simple").unique().to_series().to_list()
    categories = sorted(set(categories).union(demand_cats))

customer_ids = [f"CUST{i:04d}" for i in range(1, 101)]
statuses = ["Queued", "Approved", "Backordered", "Urgent", "Pending Confirmation"]
priorities = ["Low", "Medium", "High", "Critical"]
notes = [
    "Customer wants matching stones if available.",
    "Urgent for weekly dispatch.",
    "Flexible on color band.",
    "Strict on clarity requirement.",
    "Order tied to repeat buyer request.",
    "Prefers IGI-certified stones only.",
    "Can accept substitute shape if price is favorable.",
    "Priority order for overseas shipment."
]

today = datetime.now().date()
rows = []

# A year's worth of orders at ~8 orders/day (matches the prior 60-day density).
DAYS_BACK = 365
N_ORDERS = 3000

for i in range(N_ORDERS):
    order_date = today - timedelta(days=random.randint(0, DAYS_BACK))
    due_date = order_date + timedelta(days=random.randint(3, 30))
    req_min = round(random.uniform(150, 1200), 2)
    req_max = round(req_min * random.uniform(1.1, 1.8), 2)

    rows.append({
        "order_id": f"ORD{i+1:05d}",
        "customer_id": random.choice(customer_ids),
        "order_date": order_date.isoformat(),
        "category_simple": random.choice(categories),
        "quantity_requested": random.randint(1, 30),
        "requested_price_min": req_min,
        "requested_price_max": req_max,
        "due_date": due_date.isoformat(),
        "order_status": random.choice(statuses),
        "priority_level": random.choices(priorities, weights=[0.2, 0.4, 0.3, 0.1])[0],
        "special_notes": random.choice(notes)
    })

df = pl.DataFrame(rows)
out_path = Path(__file__).parent / "orders_queue_seed.csv"
df.write_csv(out_path)

print(f"Created orders_queue_seed.csv: {len(df)} rows")


def main():
    pass


if __name__ == "__main__":
    main()
