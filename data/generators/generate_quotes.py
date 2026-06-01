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
threads_path = Path(__file__).parent / "negotiation_threads_seed.csv"

if not all(p.exists() for p in [customers_path, inventory_path, threads_path]):
    raise FileNotFoundError("Run generate_customers.py, generate_inventory.py, generate_threads.py first")

customers_df = pl.read_csv(customers_path)
inventory_df = pl.read_csv(inventory_path)
threads_df = pl.read_csv(threads_path)

customers_list = customers_df.to_dicts()
inventory_list = inventory_df.to_dicts()
threads_list = threads_df.to_dicts()

today = datetime.now().date()
tiers = ["floor", "target", "aspirational"]
approval_statuses = ["Approved", "Pending", "Rejected"]
quote_outcomes = ["Negotiating", "Accepted", "Lost", "Expired"]

quotes_rows = []

# Generate ~800 quotes
for i in range(1, 801):
    quote_id = f"QTE{i:05d}"

    # Pick customer and stone
    customer = random.choice(customers_list)
    customer_id = customer["customer_id"]
    stone = random.choice(inventory_list)
    stock_id = stone["stock_id"]
    category_simple = stone["category_simple"]

    list_price = round(float(stone["p_pcs"]), 2)
    base_discount = round(random.uniform(0, 12), 2)
    payment_bonus = round(random.choice([0, 0, 1, 2]), 2)
    volume_discount = round(random.choice([0, 3, 6, 10, 15]), 2)
    final_discount = min(base_discount + payment_bonus + volume_discount, 25)
    offered_price = round(list_price * (1 - final_discount / 100), 2)

    margin_pct = round(random.uniform(15, 35), 2)
    approval_status = random.choice(approval_statuses)
    quote_outcome = random.choice(quote_outcomes)

    # Tier: 20% floor, 60% target, 20% aspirational
    tier_sent = random.choices(tiers, weights=[0.2, 0.6, 0.2])[0]

    # customer_offer: some quotes have customer counters
    customer_offer = None
    if quote_outcome in ["Negotiating", "Accepted"] and random.random() < 0.6:
        customer_offer = round(offered_price * random.uniform(0.85, 0.98), 2)

    # final_agreed_price: only when quote_outcome = Accepted
    final_agreed_price = None
    if quote_outcome == "Accepted":
        final_agreed_price = customer_offer if customer_offer else round(offered_price * random.uniform(0.95, 1.00), 2)

    # thread_id: optional link to a negotiation thread
    thread_id = None
    if random.random() < 0.40:
        thread = random.choice(threads_list)
        thread_id = thread["thread_id"]

    quote_date = today - timedelta(days=random.randint(0, 120))

    quotes_rows.append({
        "quote_id": quote_id,
        "quote_date": quote_date.isoformat(),
        "customer_id": customer_id,
        "stock_id": stock_id,
        "category_simple": category_simple,
        "list_price": list_price,
        "base_discount_pct": base_discount,
        "payment_bonus_discount_pct": payment_bonus,
        "volume_discount_pct": volume_discount,
        "final_discount_pct": final_discount,
        "offered_price": offered_price,
        "margin_pct": margin_pct,
        "approval_status": approval_status,
        "quote_outcome": quote_outcome,
        "tier_sent": tier_sent,
        "customer_offer": customer_offer,
        "final_agreed_price": final_agreed_price,
        "thread_id": thread_id
    })

df = pl.DataFrame(quotes_rows)
out_path = Path(__file__).parent / "quotes_seed.csv"
df.write_csv(out_path)

print(f"Created quotes_seed.csv: {len(df)} rows")
print(f"Tier distribution: {df['tier_sent'].value_counts().sort('tier_sent')}")


def main():
    pass


if __name__ == "__main__":
    main()
