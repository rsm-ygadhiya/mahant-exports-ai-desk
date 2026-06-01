import polars as pl
import random
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from _categorize import simplify_category

random.seed(42)
np.random.seed(42)

shapes = ["Round", "Princess", "Oval", "Pear", "Emerald", "Radiant"]
colors = ["D", "E", "F", "G", "H", "I", "J"]
clarities = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1"]
labs = ["IGI", "IGI", "IGI", "GIA"]
statuses = ["Available", "Hold", "OnMemo", "Sold", "Reserved"]

def random_date():
    return (datetime.now() - timedelta(days=random.randint(0, 365))).date()

def benchmark_rap_price(carat, color, clarity, shape):
    color_score = {"D": 1.18, "E": 1.14, "F": 1.10, "G": 1.05, "H": 1.00, "I": 0.94, "J": 0.88}[color]
    clarity_score = {"IF": 1.20, "VVS1": 1.15, "VVS2": 1.10, "VS1": 1.03, "VS2": 0.96, "SI1": 0.88}[clarity]
    shape_score = {"Round": 1.10, "Princess": 0.95, "Oval": 1.00, "Pear": 0.97, "Emerald": 1.02, "Radiant": 1.00}[shape]
    base_ppc = 6000 * (carat ** 0.9)
    return round(base_ppc * color_score * clarity_score * shape_score * random.uniform(0.92, 1.08), 2)

def generate_measurement(shape, carat, depth_pct):
    face_size = (carat ** (1/3)) * random.uniform(4.8, 6.2)
    if shape == "Round":
        length = round(face_size, 2)
        width = round(length + random.uniform(-0.03, 0.03), 2)
    elif shape in ["Princess", "Radiant", "Emerald"]:
        length = round(face_size * random.uniform(0.95, 1.10), 2)
        width = round(face_size * random.uniform(0.90, 1.05), 2)
    elif shape in ["Oval", "Pear"]:
        length = round(face_size * random.uniform(1.15, 1.35), 2)
        width = round(face_size * random.uniform(0.85, 1.00), 2)
    else:
        length = round(face_size, 2)
        width = round(face_size, 2)
    depth = round(((length + width) / 2) * (depth_pct / 100), 2)
    return f"{length}x{width}x{depth}"

today = datetime.now().date()
data = []

for i in range(1000):
    shape = random.choices(shapes, weights=[0.50, 0.12, 0.12, 0.08, 0.10, 0.08])[0]
    carat = round(random.uniform(0.25, 5.00), 2)
    color = random.choice(colors)
    clarity = random.choice(clarities)

    rap = benchmark_rap_price(carat, color, clarity, shape)
    discount = round(random.uniform(90.0, 97.5), 2)
    ppc = round(rap * (1 - discount / 100), 2)
    total_price = round(ppc * carat, 2)

    # Cost basis: 70-85% of list price (p_pcs)
    cost_basis = round(total_price * random.uniform(0.70, 0.85), 2)

    table_pct = round(random.uniform(55, 68), 2)
    depth_pct = round(random.uniform(58, 63), 2)
    crown_angle = round(random.uniform(33, 36.5), 2)

    add_date = random_date()
    rep_date = random_date()
    # age_in_stock_days: computed from add_date
    age_in_stock_days = max(0, (today - add_date).days)

    stock_id = f"LGSTK{i+1:05d}"
    report_no = f"LGREP{i+1:05d}"

    category_simple = simplify_category(shape, carat, color, clarity)

    measurement = generate_measurement(shape, carat, depth_pct)
    video_url = f"https://media.pramukh-demo.com/video/{stock_id}.mp4"
    image_url = f"https://media.pramukh-demo.com/image/{stock_id}.jpg"

    # Status distribution: 65% Available, 10% Hold, 8% OnMemo, 15% Sold, 2% Reserved
    status = random.choices(statuses, weights=[0.65, 0.10, 0.08, 0.15, 0.02])[0]

    data.append({
        "stock_id": stock_id,
        "sr_no": i + 1,
        "add_date": add_date.isoformat(),
        "rep_date": rep_date.isoformat(),
        "age_in_stock_days": age_in_stock_days,
        "status": status,
        "report_no": report_no,
        "shape": shape,
        "carat": carat,
        "color": color,
        "clarity": clarity,
        "cut": random.choice(["Excellent", "Very Good"]),
        "polish": random.choice(["Excellent", "Very Good"]),
        "sym": random.choice(["Excellent", "Very Good"]),
        "category_simple": category_simple,
        "rap": rap,
        "discounts_pct": discount,
        "ppc": ppc,
        "p_pcs": total_price,
        "cost_basis": cost_basis,
        "measurement": measurement,
        "table_pct": table_pct,
        "depth_pct": depth_pct,
        "c_a": crown_angle,
        "fl": random.choice(["None", "Faint"]),
        "growth_type": "Lab-Grown",
        "video": video_url,
        "image": image_url,
        "lab": random.choice(labs),
        "inscri": f"IGI-{random.randint(100000000, 999999999)}",
        "location": random.choice(["Surat", "Mumbai"]),
        "country_of_origin": "India",
        "shade": random.choice(["None", "Brown", "Blue", "Gray"]),
        "luster": random.choice(["High", "Medium"]),
        "eyeclean": random.choice(["Yes", "No"]),
        "milky": random.choice(["No", "Slight"])
    })

df = pl.DataFrame(data)
out_path = Path(__file__).parent / "inventory_seed.csv"
df.write_csv(out_path)

print(f"Created inventory_seed.csv: {len(df)} rows")
print(f"Status distribution: {df['status'].value_counts().sort('status')}")


def main():
    pass


if __name__ == "__main__":
    main()
