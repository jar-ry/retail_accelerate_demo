import numpy as np
import pandas as pd
from datetime import date, timedelta
import os
import snowflake.connector

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"

STORES = [
    ("S001", "Baby Mart Chadstone", "VIC", "Metro", "Melbourne", -37.886, 145.185, "Large Format"),
    ("S002", "Baby Mart Melbourne CBD", "VIC", "CBD", "Melbourne", -37.814, 144.963, "Standard"),
    ("S003", "Baby Mart South Yarra", "VIC", "Metro", "Melbourne", -37.838, 144.993, "Standard"),
    ("S004", "Baby Mart Geelong", "VIC", "Regional", "Geelong", -38.147, 144.361, "Standard"),
    ("S005", "Baby Mart Doncaster", "VIC", "Metro", "Melbourne", -37.784, 145.126, "Large Format"),
    ("S006", "Baby Mart Southland", "VIC", "Metro", "Melbourne", -37.959, 145.054, "Standard"),
    ("S007", "Baby Mart Fountain Gate", "VIC", "Metro", "Melbourne", -38.012, 145.295, "Standard"),
    ("S008", "Baby Mart Werribee", "VIC", "Metro", "Melbourne", -37.882, 144.662, "Standard"),
    ("S009", "Baby Mart Sydney CBD", "NSW", "CBD", "Sydney", -33.870, 151.208, "Standard"),
    ("S010", "Baby Mart Parramatta", "NSW", "Metro", "Sydney", -33.815, 151.001, "Large Format"),
    ("S011", "Baby Mart Bondi Junction", "NSW", "Metro", "Sydney", -33.893, 151.247, "Standard"),
    ("S012", "Baby Mart Castle Hill", "NSW", "Metro", "Sydney", -33.731, 150.998, "Standard"),
    ("S013", "Baby Mart Chatswood", "NSW", "Metro", "Sydney", -33.797, 151.181, "Standard"),
    ("S014", "Baby Mart Miranda", "NSW", "Metro", "Sydney", -34.039, 151.101, "Standard"),
    ("S015", "Baby Mart Newcastle", "NSW", "Regional", "Newcastle", -32.926, 151.776, "Standard"),
    ("S016", "Baby Mart Wollongong", "NSW", "Regional", "Wollongong", -34.424, 150.893, "Standard"),
    ("S017", "Baby Mart Brisbane CBD", "QLD", "CBD", "Brisbane", -27.470, 153.023, "Standard"),
    ("S018", "Baby Mart Chermside", "QLD", "Metro", "Brisbane", -27.385, 153.035, "Large Format"),
    ("S019", "Baby Mart Carindale", "QLD", "Metro", "Brisbane", -27.507, 153.102, "Standard"),
    ("S020", "Baby Mart Gold Coast", "QLD", "Regional", "Gold Coast", -28.017, 153.430, "Standard"),
    ("S021", "Baby Mart Toowoomba", "QLD", "Regional", "Toowoomba", -27.560, 151.954, "Standard"),
    ("S022", "Baby Mart Townsville", "QLD", "Regional", "Townsville", -19.258, 146.817, "Standard"),
    ("S023", "Baby Mart Adelaide CBD", "SA", "CBD", "Adelaide", -34.929, 138.601, "Standard"),
    ("S024", "Baby Mart Marion", "SA", "Metro", "Adelaide", -35.048, 138.556, "Large Format"),
    ("S025", "Baby Mart Tea Tree Plaza", "SA", "Metro", "Adelaide", -34.849, 138.698, "Standard"),
    ("S026", "Baby Mart Perth CBD", "WA", "CBD", "Perth", -31.951, 115.860, "Standard"),
    ("S027", "Baby Mart Karrinyup", "WA", "Metro", "Perth", -31.873, 115.778, "Large Format"),
    ("S028", "Baby Mart Joondalup", "WA", "Metro", "Perth", -31.748, 115.766, "Standard"),
    ("S029", "Baby Mart Cannington", "WA", "Metro", "Perth", -32.017, 115.935, "Standard"),
    ("S030", "Baby Mart Hobart", "TAS", "Metro", "Hobart", -42.880, 147.325, "Standard"),
    ("S031", "Baby Mart Launceston", "TAS", "Regional", "Launceston", -41.438, 147.135, "Standard"),
    ("S032", "Baby Mart Canberra", "ACT", "Metro", "Canberra", -35.282, 149.129, "Standard"),
    ("S033", "Baby Mart Belconnen", "ACT", "Metro", "Canberra", -35.239, 149.065, "Standard"),
    ("S034", "Baby Mart Darwin", "NT", "Metro", "Darwin", -12.462, 130.842, "Standard"),
    ("S035", "Baby Mart Ringwood", "VIC", "Metro", "Melbourne", -37.815, 145.229, "Standard"),
    ("S036", "Baby Mart Highpoint", "VIC", "Metro", "Melbourne", -37.773, 144.889, "Large Format"),
    ("S037", "Baby Mart Macquarie Centre", "NSW", "Metro", "Sydney", -33.774, 151.121, "Standard"),
    ("S038", "Baby Mart Hornsby", "NSW", "Metro", "Sydney", -33.703, 151.099, "Standard"),
    ("S039", "Baby Mart Indooroopilly", "QLD", "Metro", "Brisbane", -27.499, 152.975, "Standard"),
    ("S040", "Baby Mart Robina", "QLD", "Metro", "Gold Coast", -28.077, 153.385, "Standard"),
    ("S041", "Baby Mart Booragoon", "WA", "Metro", "Perth", -32.039, 115.837, "Standard"),
    ("S042", "Baby Mart Morley", "WA", "Metro", "Perth", -31.892, 115.903, "Standard"),
    ("S043", "Baby Mart Knox", "VIC", "Metro", "Melbourne", -37.862, 145.237, "Standard"),
    ("S044", "Baby Mart Frankston", "VIC", "Metro", "Melbourne", -38.143, 145.126, "Standard"),
    ("S045", "Baby Mart Liverpool", "NSW", "Metro", "Sydney", -33.921, 150.922, "Standard"),
    ("S046", "Baby Mart Penrith", "NSW", "Metro", "Sydney", -33.755, 150.687, "Standard"),
    ("S047", "Baby Mart Mt Gravatt", "QLD", "Metro", "Brisbane", -27.535, 153.079, "Standard"),
    ("S048", "Baby Mart Sunshine Coast", "QLD", "Regional", "Sunshine Coast", -26.680, 153.041, "Standard"),
    ("S049", "Baby Mart Elizabeth", "SA", "Metro", "Adelaide", -34.717, 138.670, "Standard"),
    ("S050", "Baby Mart Ballarat", "VIC", "Regional", "Ballarat", -37.562, 143.850, "Standard"),
    ("S051", "Baby Mart Bendigo", "VIC", "Regional", "Bendigo", -36.758, 144.279, "Standard"),
    ("S052", "Baby Mart Albury", "NSW", "Regional", "Albury", -36.081, 146.916, "Standard"),
    ("S053", "Baby Mart Cairns", "QLD", "Regional", "Cairns", -16.920, 145.771, "Standard"),
    ("S054", "Baby Mart Rockhampton", "QLD", "Regional", "Rockhampton", -23.381, 150.510, "Standard"),
    ("S055", "Baby Mart Mandurah", "WA", "Regional", "Mandurah", -32.524, 115.748, "Standard"),
    ("S056", "Baby Mart Epping", "VIC", "Metro", "Melbourne", -37.643, 145.014, "Standard"),
    ("S057", "Baby Mart Eastgardens", "NSW", "Metro", "Sydney", -33.943, 151.226, "Standard"),
    ("S058", "Baby Mart North Lakes", "QLD", "Metro", "Brisbane", -27.232, 153.002, "Standard"),
    ("S059", "Baby Mart Midland", "WA", "Metro", "Perth", -31.886, 116.012, "Standard"),
    ("S060", "Baby Mart Warringah", "NSW", "Metro", "Sydney", -33.768, 151.272, "Large Format"),
]

SUPPLIERS = [
    (1, "Bugaboo Australia", "SUP001", "James Wright", "james@bugaboo.com.au", "Net 30", 21),
    (2, "Uppababy ANZ", "SUP002", "Sarah Chen", "sarah@uppababy.com.au", "Net 30", 28),
    (3, "Silver Cross AU", "SUP003", "Michael Brown", "michael@silvercross.com.au", "Net 45", 35),
    (4, "Babyzen Pacific", "SUP004", "Lucy Kim", "lucy@babyzen.com.au", "Net 30", 42),
    (5, "Mountain Buggy", "SUP005", "Tom Wilson", "tom@mountainbuggy.co.nz", "Net 30", 14),
    (6, "Maxi-Cosi (Dorel)", "SUP006", "Emma Davis", "emma@dorel.com.au", "Net 30", 21),
    (7, "Britax Australia", "SUP007", "David Lee", "david@britax.com.au", "Net 30", 14),
    (8, "Cybex (Goodbaby)", "SUP008", "Anna Muller", "anna@cybex.com.au", "Net 45", 42),
    (9, "Nuna Baby", "SUP009", "Rachel Green", "rachel@nunababy.com.au", "Net 30", 35),
    (10, "Infasecure", "SUP010", "Mark Thompson", "mark@infasecure.com.au", "Net 14", 7),
    (11, "Kimberly-Clark (Huggies)", "SUP011", "Paul Anderson", "paul@kca.com.au", "Net 30", 7),
    (12, "P&G (Pampers)", "SUP012", "Nicole Wang", "nicole@pg.com.au", "Net 30", 7),
    (13, "Rascal + Friends", "SUP013", "Jack Morrison", "jack@rascalfriends.com.au", "Net 30", 14),
    (14, "Tooshies by TOM", "SUP014", "Hannah Scott", "hannah@tooshies.com.au", "Net 14", 7),
    (15, "ECO by Naty", "SUP015", "Erik Lindgren", "erik@naty.com", "Net 45", 56),
    (16, "Hanesbrands (Bonds Baby)", "SUP016", "Chris Martin", "chris@hanes.com.au", "Net 30", 14),
    (17, "Purebaby", "SUP017", "Miriam Katz", "miriam@purebaby.com.au", "Net 14", 7),
    (18, "Cotton On Group", "SUP018", "Tim Fletcher", "tim@cottonon.com.au", "Net 14", 7),
    (19, "Marquise", "SUP019", "Sophie Laurent", "sophie@marquise.com.au", "Net 30", 14),
    (20, "Bebe by Minihaha", "SUP020", "Grace Chen", "grace@minihaha.com.au", "Net 30", 14),
    (21, "Philips (Avent)", "SUP021", "Robert Hill", "robert@philips.com.au", "Net 30", 21),
    (22, "Mayborn (Tommee Tippee)", "SUP022", "Jessica Park", "jessica@mayborn.com.au", "Net 30", 21),
    (23, "Handi-Craft (Dr Browns)", "SUP023", "Andrew Kim", "andrew@handi-craft.com.au", "Net 45", 35),
    (24, "Pigeon Australia", "SUP024", "Yuki Tanaka", "yuki@pigeon.com.au", "Net 30", 28),
    (25, "NUK (Mapa)", "SUP025", "Stefan Weber", "stefan@nuk.com.au", "Net 45", 42),
]

BRANDS = [
    (1, "Bugaboo", 1, "Premium", "Netherlands"),
    (2, "Uppababy", 2, "Premium", "USA"),
    (3, "Silver Cross", 3, "Premium", "UK"),
    (4, "Babyzen", 4, "Premium", "France"),
    (5, "Mountain Buggy", 5, "Mid", "New Zealand"),
    (6, "Maxi-Cosi", 6, "Premium", "Netherlands"),
    (7, "Britax", 7, "Mid", "Germany"),
    (8, "Cybex", 8, "Premium", "Germany"),
    (9, "Nuna", 9, "Premium", "Netherlands"),
    (10, "Infasecure", 10, "Value", "Australia"),
    (11, "Huggies", 11, "Mid", "USA"),
    (12, "Pampers", 12, "Mid", "USA"),
    (13, "Rascal + Friends", 13, "Mid", "Australia"),
    (14, "Tooshies", 14, "Premium", "Australia"),
    (15, "ECO by Naty", 15, "Premium", "Sweden"),
    (16, "Bonds Baby", 16, "Mid", "Australia"),
    (17, "Purebaby", 17, "Premium", "Australia"),
    (18, "Cotton On Baby", 18, "Value", "Australia"),
    (19, "Marquise", 19, "Mid", "Australia"),
    (20, "Bebe", 20, "Premium", "Australia"),
    (21, "Avent", 21, "Mid", "UK"),
    (22, "Tommee Tippee", 22, "Mid", "UK"),
    (23, "Dr Browns", 23, "Mid", "USA"),
    (24, "Pigeon", 24, "Mid", "Japan"),
    (25, "NUK", 25, "Mid", "Germany"),
]

SEGMENTS = [
    (1, "First-time Parents", "New parents purchasing for their first child, high research, premium-leaning"),
    (2, "Second-time Parents", "Experienced parents, value-seeking, know what they want"),
    (3, "Gift Buyers", "Purchasing gifts for others, seasonal spikes, premium items"),
    (4, "Grandparents", "Big ticket purchases, infrequent but high AOV"),
    (5, "Expecting", "Registry-driven, discovery phase, building nursery"),
    (6, "Registry Shoppers", "Following someone else's list, diverse basket"),
]

CATEGORIES = {
    "Prams & Strollers": {
        "brands": [1, 2, 3, 4, 5],
        "classes": ["Single Stroller", "Double Stroller", "Travel System", "Capsule Stroller", "Accessories"],
        "price_range": (299, 2499),
    },
    "Car Seats": {
        "brands": [6, 7, 8, 9, 10],
        "classes": ["Capsule (0-6m)", "Convertible (0-4y)", "Booster (4-8y)", "Harness Booster", "Accessories"],
        "price_range": (149, 899),
    },
    "Nappies & Wipes": {
        "brands": [11, 12, 13, 14, 15],
        "classes": ["Newborn Nappies", "Crawler Nappies", "Toddler Nappies", "Pull-Ups", "Wipes"],
        "price_range": (8, 45),
    },
    "Clothing": {
        "brands": [16, 17, 18, 19, 20],
        "classes": ["Bodysuits & Onesies", "Sleepwear", "Outerwear", "Accessories", "Footwear"],
        "price_range": (12, 89),
    },
    "Feeding": {
        "brands": [21, 22, 23, 24, 25],
        "classes": ["Bottles", "Breast Pumps", "Sterilisers", "Highchairs", "Accessories"],
        "price_range": (9, 399),
    },
}


def generate_dim_date():
    start = date(2024, 7, 1)
    end = date(2026, 6, 30)
    dates = []
    d = start
    key = 20240701
    while d <= end:
        fiscal_year = d.year if d.month >= 7 else d.year - 1
        fiscal_year += 1
        fiscal_month = (d.month - 7) % 12 + 1
        fiscal_quarter = (fiscal_month - 1) // 3 + 1
        fiscal_week = d.isocalendar()[1]
        dates.append({
            "date_key": int(d.strftime("%Y%m%d")),
            "calendar_date": d,
            "day_of_week": d.strftime("%A"),
            "week_number": d.isocalendar()[1],
            "fiscal_week": fiscal_week,
            "fiscal_month": fiscal_month,
            "fiscal_quarter": fiscal_quarter,
            "fiscal_year": fiscal_year,
            "is_weekend": d.weekday() >= 5,
            "is_public_holiday": False,
        })
        d += timedelta(days=1)
    return pd.DataFrame(dates)


def generate_dim_stores():
    rows = []
    for i, s in enumerate(STORES):
        rows.append({
            "store_key": i + 1,
            "store_code": s[0],
            "store_name": s[1],
            "state": s[2],
            "region": s[3],
            "city": s[4],
            "latitude": s[5],
            "longitude": s[6],
            "store_format": s[7],
            "open_date": date(2020, 1, 1),
        })
    return pd.DataFrame(rows)


def generate_dim_suppliers():
    rows = []
    for s in SUPPLIERS:
        rows.append({
            "supplier_key": s[0],
            "supplier_name": s[1],
            "supplier_code": s[2],
            "contact_name": s[3],
            "contact_email": s[4],
            "payment_terms": s[5],
            "lead_time_days": s[6],
        })
    return pd.DataFrame(rows)


def generate_dim_brands():
    rows = []
    for b in BRANDS:
        rows.append({
            "brand_key": b[0],
            "brand_name": b[1],
            "supplier_key": b[2],
            "price_tier": b[3],
            "brand_origin": b[4],
        })
    return pd.DataFrame(rows)


def generate_dim_segments():
    rows = []
    for s in SEGMENTS:
        rows.append({
            "segment_key": s[0],
            "segment_name": s[1],
            "segment_description": s[2],
        })
    return pd.DataFrame(rows)


def generate_dim_products():
    np.random.seed(42)
    rows = []
    product_key = 1
    for category, info in CATEGORIES.items():
        for brand_key in info["brands"]:
            brand = BRANDS[brand_key - 1]
            supplier_key = brand[2]
            for cls in info["classes"]:
                num_skus = np.random.randint(8, 20)
                for sku_idx in range(num_skus):
                    price_low, price_high = info["price_range"]
                    unit_retail = round(np.random.uniform(price_low, price_high), 2)
                    margin_pct = round(np.random.uniform(0.25, 0.55), 2)
                    unit_cost = round(unit_retail * (1 - margin_pct), 2)
                    rows.append({
                        "product_key": product_key,
                        "sku_code": f"SKU{product_key:05d}",
                        "product_name": f"{brand[1]} {cls} {sku_idx + 1}",
                        "brand_key": brand_key,
                        "supplier_key": supplier_key,
                        "category": category,
                        "class": cls,
                        "subclass": f"{cls} Type {chr(65 + sku_idx % 3)}",
                        "unit_cost": unit_cost,
                        "unit_retail": unit_retail,
                        "margin_pct": margin_pct,
                        "season": np.random.choice(["SS25", "AW25", "SS26", "AW26", "Continuity"]),
                        "lifecycle_stage": np.random.choice(["New", "Core", "Core", "Core", "Markdown", "Exit"]),
                    })
                    product_key += 1
    return pd.DataFrame(rows)


def generate_dim_customers(n=150000):
    np.random.seed(43)
    segment_probs = [0.35, 0.25, 0.15, 0.10, 0.10, 0.05]
    states = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"]
    state_probs = [0.26, 0.32, 0.20, 0.07, 0.10, 0.02, 0.02, 0.01]
    rows = []
    for i in range(n):
        segment = np.random.choice([1, 2, 3, 4, 5, 6], p=segment_probs)
        first_purchase = date(2024, 7, 1) + timedelta(days=np.random.randint(0, 700))
        rows.append({
            "customer_key": i + 1,
            "customer_id": f"CUST{i + 1:06d}",
            "segment_key": segment,
            "first_purchase_date": first_purchase,
            "state": np.random.choice(states, p=state_probs),
            "age_band": np.random.choice(["18-24", "25-34", "35-44", "45-54", "55+"]),
            "gender": np.random.choice(["F", "M", "Other"], p=[0.7, 0.25, 0.05]),
            "loyalty_tier": np.random.choice(["Bronze", "Silver", "Gold", "Platinum"], p=[0.50, 0.30, 0.15, 0.05]),
            "lifetime_spend": round(np.random.lognormal(6.5, 1.0), 2),
            "total_transactions": np.random.randint(1, 30),
            "last_purchase_date": date(2026, 4, 1) + timedelta(days=np.random.randint(0, 37)),
        })
    return pd.DataFrame(rows)


def generate_dim_promotions():
    np.random.seed(44)
    mechanics = ["% Off", "% Off", "Multi-buy", "Bundle", "GWP", "BOGO"]
    rows = []
    start_date = date(2024, 7, 1)
    for i in range(500):
        mechanic = np.random.choice(mechanics)
        disc = {"% Off": np.random.choice([10, 15, 20, 25, 30]), "Multi-buy": 33, "Bundle": 15, "GWP": 0, "BOGO": 50}
        promo_start = start_date + timedelta(days=np.random.randint(0, 700))
        duration = int(np.random.choice([7, 14, 21]))
        rows.append({
            "promotion_key": i + 1,
            "promotion_name": f"Promo {i + 1} - {mechanic}",
            "mechanic": mechanic,
            "discount_pct": disc[mechanic],
            "start_date": promo_start,
            "end_date": promo_start + timedelta(days=duration),
            "channel": np.random.choice(["All", "All", "Online", "Instore"]),
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    print("Generating dimension tables...")
    df_dates = generate_dim_date()
    df_stores = generate_dim_stores()
    df_suppliers = generate_dim_suppliers()
    df_brands = generate_dim_brands()
    df_segments = generate_dim_segments()
    df_products = generate_dim_products()
    df_customers = generate_dim_customers()
    df_promotions = generate_dim_promotions()

    print(f"  DIM_DATE: {len(df_dates)} rows")
    print(f"  DIM_STORE: {len(df_stores)} rows")
    print(f"  DIM_SUPPLIER: {len(df_suppliers)} rows")
    print(f"  DIM_BRAND: {len(df_brands)} rows")
    print(f"  DIM_CUSTOMER_SEGMENT: {len(df_segments)} rows")
    print(f"  DIM_PRODUCT: {len(df_products)} rows")
    print(f"  DIM_CUSTOMER: {len(df_customers)} rows")
    print(f"  DIM_PROMOTION: {len(df_promotions)} rows")

    print("\nConnecting to Snowflake...")
    conn = snowflake.connector.connect(connection_name=CONNECTION_NAME)
    cur = conn.cursor()
    cur.execute("USE DATABASE BABY_MART_DEMO")
    cur.execute("USE SCHEMA CURATED")
    cur.execute("USE WAREHOUSE DEMO_LOAD_WH")

    from snowflake.connector.pandas_tools import write_pandas

    for table_name, df in [
        ("DIM_DATE", df_dates),
        ("DIM_STORE", df_stores),
        ("DIM_SUPPLIER", df_suppliers),
        ("DIM_BRAND", df_brands),
        ("DIM_CUSTOMER_SEGMENT", df_segments),
        ("DIM_PRODUCT", df_products),
        ("DIM_CUSTOMER", df_customers),
        ("DIM_PROMOTION", df_promotions),
    ]:
        print(f"  Loading {table_name}...")
        df.columns = [c.upper() for c in df.columns]
        write_pandas(conn, df, table_name, auto_create_table=False, overwrite=True)

    print("\nDimension tables loaded successfully!")
    conn.close()
