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

if not all(p.exists() for p in [customers_path, inventory_path]):
    raise FileNotFoundError("Run generate_customers.py and generate_inventory.py first")

customers_df = pl.read_csv(customers_path)
inventory_df = pl.read_csv(inventory_path)

customers_list = customers_df.to_dicts()
# Filter inventory to Hold/OnMemo status
inventory_list = inventory_df.filter(pl.col("status").is_in(["Hold", "OnMemo"])).to_dicts()

if len(inventory_list) < 80:
    # Use all available memo-eligible stones and sample more
    inventory_list = inventory_df.sample(n=80, seed=42).to_dicts()

today = datetime.now().date()
decisions = ["Pending", "Approved", "ApprovedWithConditions", "Rejected"]
closed_outcomes = [None, "Sold", "Returned", "Lapsed"]
marketplace_locks = ["NotLocked", "Locked", "Unlocked"]

memos_rows = []

# Generate ~80 memo records
for i in range(1, 81):
    memo_id = f"MEMO{i:05d}"

    # Pick customer and stone
    customer = random.choice(customers_list)
    customer_id = customer["customer_id"]
    broker_id = customer.get("broker_id")  # Denormalized
    stone = random.choice(inventory_list)
    stock_id = stone["stock_id"]

    request_date = today - timedelta(days=random.randint(0, 180))
    requested_hold_days = random.choice([3, 5, 7])

    # Decision distribution: 60% Approved, 25% Pending, 15% Rejected
    decision = random.choices(decisions, weights=[0.60, 0.25, 0.10, 0.05])[0]

    decision_date = None
    decision_reason = None
    condition_minimum_price = None
    condition_max_hold_days = None

    if decision != "Pending":
        decision_date = request_date + timedelta(days=random.randint(0, 2))
        if decision == "Approved":
            decision_reason = "Customer has excellent payment history and is a valued partner."
        elif decision == "ApprovedWithConditions":
            decision_reason = "Approved pending minimum purchase price verification."
            condition_minimum_price = round(random.uniform(5000, 50000), 2)
            condition_max_hold_days = random.choice([3, 5, 7])
        else:  # Rejected
            decision_reason = "Inventory committed to another buyer; cannot support memo at this time."

    expiry_date = request_date + timedelta(days=requested_hold_days)

    # Closed outcome (if memo already closed)
    closed_outcome = None
    closed_transaction_id = None
    if decision != "Pending" and random.random() < 0.5:  # 50% of decided memos are closed
        closed_outcome = random.choices(closed_outcomes[1:], weights=[0.70, 0.20, 0.10])[0]
        if closed_outcome == "Sold":
            closed_transaction_id = f"TXN{random.randint(1, 400):05d}"

    marketplace_lock = random.choice(marketplace_locks)

    memos_rows.append({
        "memo_id": memo_id,
        "request_date": request_date.isoformat() + "T00:00:00Z",
        "customer_id": customer_id,
        "broker_id": broker_id,
        "stock_id": stock_id,
        "requested_hold_days": requested_hold_days,
        "decision": decision,
        "decision_date": decision_date.isoformat() + "T00:00:00Z" if decision_date else None,
        "decision_reason": decision_reason,
        "condition_minimum_price": condition_minimum_price,
        "condition_max_hold_days": condition_max_hold_days,
        "expiry_date": expiry_date.isoformat() + "T00:00:00Z",
        "closed_outcome": closed_outcome,
        "closed_transaction_id": closed_transaction_id,
        "marketplace_lock_status": marketplace_lock,
        "thread_id": None  # Optional linkage to negotiation thread
    })

df = pl.DataFrame(memos_rows)
out_path = Path(__file__).parent / "memos_seed.csv"
df.write_csv(out_path)

print(f"Created memos_seed.csv: {len(df)} rows")
print(f"Decision distribution: {df['decision'].value_counts().sort('decision')}")


def main():
    pass


if __name__ == "__main__":
    main()
