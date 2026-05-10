import numpy as np
import pandas as pd
from datetime import date, timedelta
import os
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"
np.random.seed(47)

COMPETITORS = ["Coles", "Woolworths", "Amazon AU", "Chemist Warehouse"]


if __name__ == "__main__":
    print("Connecting to Snowflake...")
    conn = snowflake.connector.connect(connection_name=CONNECTION_NAME)
    cur = conn.cursor()
    cur.execute("USE DATABASE BABY_MART_DEMO")
    cur.execute("USE SCHEMA CURATED")
    cur.execute("USE WAREHOUSE DEMO_LOAD_WH")

    products_df = pd.read_sql(
        "SELECT product_key, unit_retail, category FROM DIM_PRODUCT WHERE category IN ('Nappies & Wipes', 'Feeding')",
        conn
    )
    products_df.columns = [c.lower() for c in products_df.columns]
    print(f"  {len(products_df)} products eligible for competitor pricing")

    weeks = pd.date_range(date(2024, 7, 1), date(2026, 5, 7), freq="W-MON").date
    print(f"  Generating pricing across {len(weeks)} weeks x {len(COMPETITORS)} competitors...")

    rows = []
    key = 1
    for week_date in weeks:
        date_key = int(week_date.strftime("%Y%m%d"))
        sampled = products_df.sample(min(50, len(products_df)))
        for _, prod in sampled.iterrows():
            our_price = prod["unit_retail"]
            for comp in COMPETITORS:
                gap = np.random.uniform(-0.15, 0.05)
                comp_price = round(our_price * (1 + gap), 2)
                rows.append({
                    "competitor_price_key": key,
                    "date_key": date_key,
                    "product_key": int(prod["product_key"]),
                    "competitor_name": comp,
                    "competitor_price": comp_price,
                    "our_price": round(our_price, 2),
                    "price_gap_pct": round((our_price - comp_price) / comp_price * 100, 2),
                    "scrape_timestamp": str(pd.Timestamp(week_date)),
                })

    df = pd.DataFrame(rows)
    df = df.drop(columns=["scrape_timestamp"], errors="ignore")
    df.columns = [c.upper() for c in df.columns]
    print(f"  Generated {len(df):,} competitor pricing rows")
    print("  Loading to Snowflake...")
    write_pandas(conn, df, "FACT_COMPETITOR_PRICING", auto_create_table=False, overwrite=True)
    print("  Done!")
    conn.close()
