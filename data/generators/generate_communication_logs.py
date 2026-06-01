import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

# Load dependencies
customers_path = Path(__file__).parent / "customers_seed.csv"
threads_path = Path(__file__).parent / "negotiation_threads_seed.csv"
inventory_path = Path(__file__).parent / "inventory_seed.csv"

if not customers_path.exists() or not threads_path.exists():
    raise FileNotFoundError("Run generate_threads.py first (and generate_customers.py, generate_inventory.py)")

customers_df = pl.read_csv(customers_path)
threads_df = pl.read_csv(threads_path)
inventory_df = pl.read_csv(inventory_path)

customers_list = customers_df.to_dicts()
threads_list = threads_df.to_dicts()
inventory_list = inventory_df.to_dicts()

counterparty_types = ["Broker", "Wholesaler", "Jeweler", "Dealer"]
channels = ["WhatsApp", "Email", "Call", "Platform Chat", "In-App"]
directions = ["Inbound", "Outbound"]

note_templates = [
    "Buyer requested better discount.",
    "Asked for repeat order pricing.",
    "Interested in matching pair availability.",
    "Requested certificate details.",
    "Negotiation paused pending approval.",
    "Buyer asked for video and image.",
    "Requested stone in similar category.",
    "Counterparty asked for bulk deal terms.",
    "Discussion on repeat order potential.",
    "Buyer comparing with another supplier."
]

today = datetime.now().date()
messages_rows = []

# Generate ~600 messages linked to threads
for i in range(1, 601):
    message_id = f"MSG{i:05d}"

    # Pick a thread
    thread = random.choice(threads_list)
    thread_id = thread["thread_id"]
    customer_id = thread.get("customer_id")
    stock_id = thread.get("stock_id")
    category_simple = thread.get("category_simple")

    # Message date within thread's opened_date to now
    opened = datetime.fromisoformat(thread["opened_date"].replace("Z", "+00:00")).date()
    msg_date_offset = random.randint(0, (today - opened).days) if opened <= today else 0
    message_date = opened + timedelta(days=msg_date_offset)
    message_time = datetime.min.time().replace(hour=random.randint(8, 20), minute=random.randint(0, 59))
    message_datetime = datetime.combine(message_date, message_time).isoformat() + "Z"

    quoted_price = round(random.uniform(200, 2500), 2) if random.random() < 0.7 else None
    negotiated_price = round(quoted_price * random.uniform(0.90, 1.00), 2) if quoted_price else None

    messages_rows.append({
        "message_id": message_id,
        "message_date": message_datetime,
        "thread_id": thread_id,
        "customer_id": customer_id,
        "stock_id": stock_id,
        "counterparty_name": f"Partner-{i % 30}",
        "counterparty_type": random.choice(counterparty_types),
        "channel": random.choice(channels),
        "direction": random.choice(directions),
        "category_simple": category_simple,
        "quoted_price": quoted_price,
        "negotiated_price": negotiated_price,
        "quantity_requested": random.randint(1, 20) if random.random() < 0.7 else None,
        "negotiation_status": thread["status"],  # Inherit from thread
        "notes": random.choice(note_templates)
    })

df = pl.DataFrame(messages_rows)
out_path = Path(__file__).parent / "communication_logs_seed.csv"
df.write_csv(out_path)

print(f"Created communication_logs_seed.csv: {len(df)} rows")
print(f"Threads linked: {df['thread_id'].n_unique()}")


def main():
    pass


if __name__ == "__main__":
    main()
