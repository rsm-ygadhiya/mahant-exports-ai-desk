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

# Filter to Sold stones only
sold_stones = inventory_df.filter(pl.col("status") == "Sold").to_dicts()

if len(sold_stones) < 400:
    # If not enough sold stones, sample from all and mark them sold
    sold_stones = inventory_df.sample(n=400, seed=42).to_dicts()

today = datetime.now().date()
sales_channels = ["Direct", "Broker", "Marketplace", "Memo"]
payment_statuses = ["Paid", "Advance", "Open", "Partial"]

# Build customer lookup
customers_list = customers_df.to_dicts()
customer_ids = [c["customer_id"] for c in customers_list]
customer_map = {c["customer_id"]: c for c in customers_list}

sales_rows = []
txn_counter = 1

# Loop through customers weighted by purchase_frequency
# to create customer-aware sales distribution
for _ in range(400):
    # Pick a customer weighted by purchase_frequency
    weights = [c["purchase_frequency"] for c in customers_list]
    customer = random.choices(customers_list, weights=weights)[0]
    customer_id = customer["customer_id"]
    customer_type = customer["customer_type"]
    payment_terms_days = customer["payment_terms_days"]
    is_broker = customer["is_broker"]
    broker_id = customer["broker_id"] if not is_broker else None

    # Pick a sold stone
    stone = random.choice(sold_stones)

    # Compute sold price and discount
    rap = float(stone["rap"])
    carat = float(stone["carat"])
    base_discount = float(stone["discounts_pct"])
    cost_basis = float(stone["cost_basis"])

    # Simulate negotiated discount
    sold_discount = round(max(88.0, min(98.0, base_discount + random.uniform(-2.0, 2.0))), 2)
    sold_ppc = round(rap * (1 - sold_discount / 100), 2)
    sold_price = round(sold_ppc * carat, 2)

    # Cost at sale = snapshot of cost_basis
    cost_at_sale = cost_basis
    gross_profit = round(sold_price - cost_at_sale, 2)

    transaction_date = today - timedelta(days=random.randint(0, 180))
    invoice_date = transaction_date  # For prototype, same day
    due_date = invoice_date + timedelta(days=payment_terms_days)

    transaction_id = f"TXN{txn_counter:05d}"
    invoice_id = f"INV{txn_counter:05d}"
    txn_counter += 1

    sales_rows.append({
        "transaction_id": transaction_id,
        "transaction_date": transaction_date.isoformat(),
        "stock_id": stone["stock_id"],
        "category_simple": stone["category_simple"],
        "customer_id": customer_id,
        "broker_id": broker_id,
        "sold_price": sold_price,
        "sold_ppc": sold_ppc,
        "cost_at_sale": cost_at_sale,
        "gross_profit": gross_profit,
        "discount_pct": sold_discount,
        "customer_type": customer_type,
        "sales_channel": random.choice(sales_channels),
        "destination_market": customer["market"],
        "payment_status": random.choice(payment_statuses),
        "invoice_id": invoice_id,
        "invoice_date": invoice_date.isoformat(),
        "payment_terms_days": payment_terms_days,
        "due_date": due_date.isoformat(),
        "quote_id": None,  # Optional; populated by quote generator if linkage desired
        "memo_id": None  # Optional; populated by memo generator if linkage desired
    })

df = pl.DataFrame(sales_rows)
out_path = Path(__file__).parent / "sales_transactions_seed.csv"
df.write_csv(out_path)

print(f"Created sales_transactions_seed.csv: {len(df)} rows")
print(f"Invoice IDs unique: {df['invoice_id'].n_unique()}")


def main():
    pass


if __name__ == "__main__":
    main()
