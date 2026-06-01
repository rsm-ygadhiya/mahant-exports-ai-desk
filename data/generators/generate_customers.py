import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)
np.random.seed(42)

customer_types = ["Wholesaler", "Jeweler", "Dealer", "Broker"]
markets = ["India", "Dubai", "Hong Kong", "USA"]
owners = ["Yug", "Amit", "Riya", "Neel", "Sara"]
names = [
    "Aarav Trading", "Blue Star Jewels", "Nova Brokers", "Zenith Gems",
    "HK Diamond House", "Dubai Stone Hub", "Shree Jewels", "Orion Traders",
    "Global Melee Co", "Prime Carat LLP", "Elite Carats", "Solitaire Source",
    "Radiant House", "Crown Impex", "Fine Spark LLP"
]

# Payment terms mapping: string → days
payment_terms_map = {
    "Net 30": 30,
    "Net 60": 60,
    "Memo": 75,
    "Deposit": 14,
    "Finance": 45
}

today = datetime.now().date()

# 30 brokers
brokers = []
for i in range(1, 31):
    join_date = today - timedelta(days=random.randint(180, 3650))
    annual_spend = round(random.uniform(100000, 5000000), 2)
    avg_order_value = round(random.uniform(15000, 100000), 2)
    purchase_frequency = random.randint(10, 50)
    gross_margin_pct = round(random.uniform(8, 20), 2)
    account_lifespan_years = round((today - join_date).days / 365.25, 2)
    churn_risk_pct = round(random.uniform(0.01, 0.15), 2)
    raw_clv = round(
        avg_order_value * purchase_frequency * (gross_margin_pct / 100) * max(account_lifespan_years, 1), 2
    )
    risk_adjusted_clv = round(raw_clv * (1 - churn_risk_pct), 2)

    if risk_adjusted_clv < 50000:
        tier = "Silver"
    elif risk_adjusted_clv < 500000:
        tier = "Gold"
    else:
        tier = "Diamond"

    payment_score = random.randint(60, 98)
    payment_terms_str = "Net 30" if payment_score >= 80 else "Net 60"
    payment_terms_days = payment_terms_map[payment_terms_str]

    brokers.append({
        "customer_id": f"CUST{i:04d}",
        "customer_name": random.choice(names) + f" B{i}",
        "is_broker": True,
        "broker_id": f"CUST{i:04d}",  # Self-reference
        "customer_type": "Broker",
        "market": random.choice(markets),
        "join_date": join_date.isoformat(),
        "relationship_owner": random.choice(owners),
        "payment_terms_days": payment_terms_days,
        "payment_terms": payment_terms_str,
        "payment_score": payment_score,
        "active_status": random.choice(["Active", "Active", "Active", "Inactive"]),
        "annual_spend": annual_spend,
        "avg_order_value": avg_order_value,
        "purchase_frequency": purchase_frequency,
        "gross_margin_pct": gross_margin_pct,
        "account_lifespan_years": account_lifespan_years,
        "churn_risk_pct": churn_risk_pct,
        "raw_clv": raw_clv,
        "risk_adjusted_clv": risk_adjusted_clv,
        "clv_tier": tier,
    })

# 70 companies: 60 assigned to brokers, 10 direct
companies = []
broker_ids = [f"CUST{i:04d}" for i in range(1, 31)]

for i in range(31, 101):
    join_date = today - timedelta(days=random.randint(180, 3650))
    annual_spend = round(random.uniform(10000, 800000), 2)
    avg_order_value = round(random.uniform(2000, 40000), 2)
    purchase_frequency = random.randint(1, 30)
    gross_margin_pct = round(random.uniform(10, 30), 2)
    account_lifespan_years = round((today - join_date).days / 365.25, 2)
    churn_risk_pct = round(random.uniform(0.05, 0.50), 2)
    raw_clv = round(
        avg_order_value * purchase_frequency * (gross_margin_pct / 100) * max(account_lifespan_years, 1), 2
    )
    risk_adjusted_clv = round(raw_clv * (1 - churn_risk_pct), 2)

    if risk_adjusted_clv < 10000:
        tier = "New"
    elif risk_adjusted_clv < 200000:
        tier = "Silver"
    elif risk_adjusted_clv < 500000:
        tier = "Gold"
    else:
        tier = "Diamond"

    payment_score = random.randint(35, 98)
    if payment_score >= 80 and tier == "Diamond":
        payment_terms_str = "Net 30"
    elif payment_score >= 60 and tier in ["Gold", "Diamond"]:
        payment_terms_str = "Net 60"
    elif payment_score >= 40:
        payment_terms_str = "Memo"
    else:
        payment_terms_str = "Deposit"

    payment_terms_days = payment_terms_map[payment_terms_str]

    # 10 direct companies (broker_id = None), 60 assigned to brokers
    if i <= 40:  # 10 direct (31-40)
        assigned_broker_id = None
    else:  # 60 assigned to brokers (41-100)
        # ~70% inherit from their broker, 30% random
        if random.random() < 0.7:
            # Inherit from a specific broker (deterministically)
            broker_idx = (i - 41) % 30
            assigned_broker_id = broker_ids[broker_idx]
        else:
            assigned_broker_id = random.choice(broker_ids)

    companies.append({
        "customer_id": f"CUST{i:04d}",
        "customer_name": random.choice(names) + f" C{i}",
        "is_broker": False,
        "broker_id": assigned_broker_id,
        "customer_type": random.choice(customer_types),
        "market": random.choice(markets),
        "join_date": join_date.isoformat(),
        "relationship_owner": random.choice(owners),
        "payment_terms_days": payment_terms_days,
        "payment_terms": payment_terms_str,
        "payment_score": payment_score,
        "active_status": random.choice(["Active", "Active", "Active", "Inactive"]),
        "annual_spend": annual_spend,
        "avg_order_value": avg_order_value,
        "purchase_frequency": purchase_frequency,
        "gross_margin_pct": gross_margin_pct,
        "account_lifespan_years": account_lifespan_years,
        "churn_risk_pct": churn_risk_pct,
        "raw_clv": raw_clv,
        "risk_adjusted_clv": risk_adjusted_clv,
        "clv_tier": tier,
    })

# Combine
all_customers = brokers + companies

# Convert to polars and write
df = pl.DataFrame(all_customers)
out_path = Path(__file__).parent / "customers_seed.csv"
df.write_csv(out_path)

print(f"Created customers_seed.csv: {len(df)} rows")
print(f"Brokers (is_broker=True): {len(brokers)}")
print(f"Companies (is_broker=False): {len(companies)}")


def main():
    pass


if __name__ == "__main__":
    main()
