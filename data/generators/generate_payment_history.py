import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

# Load dependencies
sales_path = Path(__file__).parent / "sales_transactions_seed.csv"

if not sales_path.exists():
    raise FileNotFoundError("Run generate_sales.py first")

sales_df = pl.read_csv(sales_path)
sales_list = sales_df.to_dicts()

terms_options = ["Net 30", "Net 60", "Memo", "Deposit", "Finance"]
payment_behaviors = ["Early", "OnTime", "Late"]

# Map to days
terms_days_map = {
    "Net 30": 30,
    "Net 60": 60,
    "Memo": 75,
    "Deposit": 14,
    "Finance": 45
}

payment_rows = []
payment_counter = 1

# ~70% of sales have a payment record; 30% are open (no payment_history row)
for sale in sales_list:
    if random.random() > 0.70:
        continue  # Skip this invoice (leave it open)

    payment_id = f"PAY{payment_counter:05d}"
    payment_counter += 1

    invoice_id = sale["invoice_id"]
    customer_id = sale["customer_id"]
    invoice_date = datetime.fromisoformat(sale["invoice_date"]).date()
    payment_terms_days = sale["payment_terms_days"]
    due_date = invoice_date + timedelta(days=payment_terms_days)

    # Payment date randomized: -10 to +35 days from due date
    payment_date = due_date + timedelta(days=random.randint(-10, 35))
    days_early_late = (payment_date - due_date).days

    if days_early_late < 0:
        behavior = "Early"
    elif days_early_late == 0:
        behavior = "OnTime"
    else:
        behavior = "Late"

    payment_amount = round(random.uniform(1000, 75000), 2)
    terms_type = random.choice(terms_options)

    payment_rows.append({
        "payment_id": payment_id,
        "invoice_id": invoice_id,
        "customer_id": customer_id,
        "order_id": f"ORD{random.randint(1, 500):05d}",
        "invoice_date": invoice_date.isoformat(),
        "due_date": due_date.isoformat(),
        "payment_date": payment_date.isoformat(),
        "payment_amount": payment_amount,
        "terms_type": terms_type,
        "days_early_late": days_early_late,
        "payment_behavior_label": behavior,
        "late_incident_flag": True if days_early_late > 0 else False,
        "month_bucket": f"{invoice_date.year}-{invoice_date.month:02d}"
    })

df = pl.DataFrame(payment_rows)
out_path = Path(__file__).parent / "payment_history_seed.csv"
df.write_csv(out_path)

print(f"Created payment_history_seed.csv: {len(df)} rows (out of {len(sales_list)} sales)")
print(f"Open invoices: {len(sales_list) - len(df)}")


def main():
    pass


if __name__ == "__main__":
    main()
