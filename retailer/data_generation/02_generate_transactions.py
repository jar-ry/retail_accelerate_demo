import numpy as np
import pandas as pd
from datetime import date
import os
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"
np.random.seed(45)

NUM_ROWS = 500_000

BRAND_GROWTH_PROFILES = {
    1: -0.08,   # Bugaboo - declining (losing to Uppababy)
    2: +0.24,   # Uppababy - strong growth (gaining share)
    3: +0.03,   # Silver Cross - stable
    4: +0.06,   # Babyzen - moderate growth
    5: -0.02,   # Mountain Buggy - slight decline
    6: +0.07,   # Maxi-Cosi - growing
    7: +0.03,   # Britax - stable
    8: +0.15,   # Cybex - strong growth
    9: +0.05,   # Nuna - moderate growth
    10: -0.13,  # Infasecure - declining (value losing to mid-tier)
    11: +0.01,  # Huggies - flat (mature brand)
    12: -0.06,  # Pampers - declining (losing to eco brands)
    13: +0.19,  # Rascal + Friends - strong growth (eco trend)
    14: +0.09,  # Tooshies - growing (eco niche)
    15: +0.07,  # ECO by Naty - growing
    16: +0.04,  # Bonds Baby - stable growth
    17: +0.12,  # Purebaby - premium growth
    18: +0.04,  # Cotton On Baby - stable
    19: +0.01,  # Marquise - flat
    20: -0.09,  # Bebe - declining
    21: +0.05,  # Avent - moderate growth
    22: +0.03,  # Tommee Tippee - stable
    23: +0.12,  # Dr Browns - growing
    24: +0.02,  # Pigeon - stable
    25: -0.07,  # NUK - declining
}

BRAND_SIZE_WEIGHTS = {
    1: 3.0, 2: 2.5, 3: 1.5, 4: 1.2, 5: 1.0,
    6: 2.0, 7: 2.5, 8: 1.5, 9: 1.2, 10: 1.8,
    11: 5.0, 12: 3.0, 13: 4.0, 14: 1.5, 15: 1.0,
    16: 3.0, 17: 2.0, 18: 3.5, 19: 1.5, 20: 1.0,
    21: 2.5, 22: 2.0, 23: 1.5, 24: 1.2, 25: 0.8,
}


if __name__ == "__main__":
    print("Connecting to Snowflake to read product catalog...")
    conn = snowflake.connector.connect(connection_name=CONNECTION_NAME)
    cur = conn.cursor()
    cur.execute("USE DATABASE BABY_MART_DEMO")
    cur.execute("USE SCHEMA CURATED")
    cur.execute("USE WAREHOUSE DEMO_LOAD_WH")

    products_df = pd.read_sql("SELECT product_key, brand_key, unit_retail, unit_cost, category FROM DIM_PRODUCT", conn)
    products_df.columns = [c.lower() for c in products_df.columns]
    print(f"  Loaded {len(products_df)} products")

    start_date = date(2024, 7, 1)
    end_date = date(2026, 5, 7)
    date_range = pd.date_range(start_date, end_date)
    total_days = len(date_range)
    date_keys = np.array([int(d.strftime("%Y%m%d")) for d in date_range])

    brand_weights = np.array([BRAND_SIZE_WEIGHTS.get(bk, 1.0) for bk in products_df["brand_key"]])
    brand_weights = brand_weights / brand_weights.sum()

    print(f"\nGenerating {NUM_ROWS:,} transaction lines with growth patterns...")

    product_indices = np.random.choice(len(products_df), size=NUM_ROWS, p=brand_weights)
    brand_keys = products_df["brand_key"].values[product_indices]
    unit_retails = products_df["unit_retail"].values[product_indices]
    unit_costs = products_df["unit_cost"].values[product_indices]
    product_keys = products_df["product_key"].values[product_indices]

    growth_rates = np.array([BRAND_GROWTH_PROFILES.get(bk, 0.0) for bk in brand_keys])
    day_indices = np.random.randint(0, total_days, size=NUM_ROWS)

    time_factor = day_indices / total_days
    growth_bias = 1.0 + (growth_rates * time_factor)
    keep_mask = np.random.random(NUM_ROWS) < np.clip(growth_bias, 0.3, 1.7)

    kept_indices = np.where(keep_mask)[0][:NUM_ROWS]
    if len(kept_indices) < NUM_ROWS:
        extra = np.random.choice(np.where(keep_mask)[0], size=NUM_ROWS - len(kept_indices), replace=True)
        kept_indices = np.concatenate([kept_indices, extra])

    kept_indices = kept_indices[:NUM_ROWS]
    day_indices = day_indices[kept_indices]
    product_keys = product_keys[kept_indices]
    unit_retails = unit_retails[kept_indices]
    unit_costs = unit_costs[kept_indices]
    brand_keys = brand_keys[kept_indices]

    chosen_date_keys = date_keys[day_indices]
    store_keys = np.random.randint(1, 61, size=NUM_ROWS)
    quantities = np.random.choice([1, 1, 1, 2, 2, 3], size=NUM_ROWS)

    has_customer = np.random.random(NUM_ROWS) < 0.65
    customer_keys = np.where(has_customer, np.random.randint(1, 150001, size=NUM_ROWS), 0)

    has_promo = np.random.random(NUM_ROWS) < 0.15
    promo_keys = np.where(has_promo, np.random.randint(1, 501, size=NUM_ROWS), 0)

    discounts = np.where(has_promo, unit_retails * 0.2, 0.0)
    net_revenues = (unit_retails - discounts) * quantities
    cost_amounts = unit_costs * quantities
    margin_amounts = net_revenues - cost_amounts

    df = pd.DataFrame({
        "TRANSACTION_LINE_KEY": np.arange(1, NUM_ROWS + 1),
        "TRANSACTION_ID": [f"TXN{i:08d}" for i in range(1, NUM_ROWS + 1)],
        "DATE_KEY": chosen_date_keys,
        "STORE_KEY": store_keys,
        "PRODUCT_KEY": product_keys,
        "CUSTOMER_KEY": np.where(has_customer, customer_keys, None),
        "PROMOTION_KEY": np.where(has_promo, promo_keys, None),
        "QUANTITY": quantities,
        "UNIT_PRICE": np.round(unit_retails, 2),
        "DISCOUNT_AMOUNT": np.round(discounts * quantities, 2),
        "NET_REVENUE": np.round(net_revenues, 2),
        "COST_AMOUNT": np.round(cost_amounts, 2),
        "MARGIN_AMOUNT": np.round(margin_amounts, 2),
    })

    df["CUSTOMER_KEY"] = df["CUSTOMER_KEY"].astype("Int64")
    df["PROMOTION_KEY"] = df["PROMOTION_KEY"].astype("Int64")
    df.loc[df["CUSTOMER_KEY"] == 0, "CUSTOMER_KEY"] = pd.NA
    df.loc[df["PROMOTION_KEY"] == 0, "PROMOTION_KEY"] = pd.NA

    print(f"  Generated {len(df):,} rows")
    print(f"  Brand distribution sample:")
    brand_counts = pd.Series(brand_keys).value_counts().sort_index()
    for bk, count in brand_counts.head(5).items():
        growth = BRAND_GROWTH_PROFILES.get(bk, 0)
        print(f"    Brand {bk}: {count:,} txns (growth target: {growth:+.0%})")

    print("  Loading to Snowflake...")
    write_pandas(conn, df, "FACT_TRANSACTION_LINES", auto_create_table=False, overwrite=True)
    print("\nTransaction lines loaded with varied growth patterns!")
    conn.close()
