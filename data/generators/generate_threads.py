import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

# Load dependencies
customers_path = Path(__file__).parent / "customers_seed.csv"
inventory_path = Path(__file__).parent / "inventory_seed.csv"

if not customers_path.exists() or not inventory_path.exists():
    raise FileNotFoundError("Run generate_customers.py and generate_inventory.py first")

customers_df = pl.read_csv(customers_path)
inventory_df = pl.read_csv(inventory_path)

customers_list = customers_df.to_dicts()
inventory_list = inventory_df.to_dicts()

today = datetime.now().date()
thread_statuses = ["Open", "Closed-Won", "Closed-Lost", "Stale"]

threads_rows = []

# Generate ~150 negotiation threads
for i in range(1, 151):
    thread_id = f"THRD{i:05d}"

    # ~60% Open, 30% Closed-Won, 10% Closed-Lost/Stale
    status = random.choices(thread_statuses, weights=[0.60, 0.30, 0.05, 0.05])[0]

    # Optional customer link
    if random.random() < 0.85:
        customer = random.choice(customers_list)
        customer_id = customer["customer_id"]
    else:
        customer_id = None

    # Optional stone link (stone-specific or category-level thread)
    if random.random() < 0.70:
        stone = random.choice(inventory_list)
        stock_id = stone["stock_id"]
        category_simple = stone["category_simple"]
    else:
        stock_id = None
        category_simple = None

    opened_date = today - timedelta(days=random.randint(0, 180))
    # For now, last_message_date is initialized; will be backfilled by communication_logs
    last_message_date = opened_date + timedelta(days=random.randint(0, 30))

    threads_rows.append({
        "thread_id": thread_id,
        "opened_date": opened_date.isoformat() + "T00:00:00Z",
        "customer_id": customer_id,
        "stock_id": stock_id,
        "category_simple": category_simple,
        "memo_id": None,  # Will be populated by memo generator if linkage exists
        "quote_id": None,  # Will be populated by quote generator if linkage exists
        "status": status,
        "last_message_date": last_message_date.isoformat() + "T00:00:00Z",
        "last_offer": None if random.random() < 0.4 else round(random.uniform(500, 5000), 2),
        "closed_transaction_id": None  # Will be populated if a sale closes the thread
    })

df = pl.DataFrame(threads_rows)
out_path = Path(__file__).parent / "negotiation_threads_seed.csv"
df.write_csv(out_path)

print(f"Created negotiation_threads_seed.csv: {len(df)} rows")
print(f"Status distribution: {df['status'].value_counts().sort('status')}")


def main():
    pass


if __name__ == "__main__":
    main()
