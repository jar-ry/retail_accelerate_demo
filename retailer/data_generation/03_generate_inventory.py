import numpy as np
import pandas as pd
from datetime import date, timedelta
import os
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"
np.random.seed(46)


if __name__ == "__main__":
    print("Connecting to Snowflake...")
    conn = snowflake.connector.connect(connection_name=CONNECTION_NAME)
    cur = conn.cursor()
    cur.execute("USE DATABASE BABY_MART_DEMO")
    cur.execute("USE SCHEMA CURATED")
    cur.execute("USE WAREHOUSE DEMO_LOAD_WH")

    products_df = pd.read_sql("SELECT product_key FROM DIM_PRODUCT", conn)
    products_df.columns = [c.lower() for c in products_df.columns]
    product_keys = products_df["product_key"].tolist()
    store_count = 60
    num_products = len(product_keys)

    sample_dates = pd.date_range(date(2026, 4, 1), date(2026, 5, 7)).date
    print(f"Generating inventory for {len(sample_dates)} days x {store_count} stores x {num_products} products (sampled)...")

    rows = []
    key = 1
    for d in sample_dates:
        date_key = int(d.strftime("%Y%m%d"))
        sampled_products = np.random.choice(product_keys, size=min(500, num_products), replace=False)
        for store_key in range(1, store_count + 1):
            for prod_key in sampled_products:
                soh = max(0, int(np.random.lognormal(2.5, 1.2)))
                rows.append({
                    "inventory_key": key,
                    "date_key": date_key,
                    "store_key": store_key,
                    "product_key": int(prod_key),
                    "stock_on_hand": soh,
                    "stock_on_order": np.random.randint(0, 20) if soh < 5 else 0,
                    "receipts_qty": np.random.randint(0, 10) if np.random.random() < 0.3 else 0,
                    "days_since_last_sale": np.random.randint(0, 14),
                })
                key += 1

        if key > 5_000_000:
            break

    df = pd.DataFrame(rows)
    df.columns = [c.upper() for c in df.columns]
    print(f"  Generated {len(df):,} inventory rows")
    print("  Loading to Snowflake...")
    write_pandas(conn, df, "FACT_INVENTORY", auto_create_table=False, overwrite=True)
    print("  Done!")
    conn.close()
