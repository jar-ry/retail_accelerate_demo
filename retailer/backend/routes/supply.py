import json
from fastapi import APIRouter
from backend.services.snowflake_client import execute_query

router = APIRouter()


@router.get("/brand/{brand_name}")
def get_brand_supply(brand_name: str):
    profile_sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_SUPPLY_PROFILE
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
    """
    profile_rows = execute_query(profile_sql)
    if not profile_rows:
        return {"error": "Brand not found"}

    profile = profile_rows[0]

    inventory_sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_INVENTORY_WEEKLY
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        ORDER BY WEEK_DATE
    """
    inventory = execute_query(inventory_sql)

    return {
        "brand": profile["BRAND_NAME"],
        "category": profile["CATEGORY"],
        "currentStock": profile["CURRENT_STOCK_UNITS"],
        "dailyDemand": float(profile["DAILY_DEMAND"]),
        "weeklyDemand": profile["WEEKLY_DEMAND"],
        "reorderPoint": profile["REORDER_POINT"],
        "safetyStock": profile["SAFETY_STOCK"],
        "leadTimeDays": profile["LEAD_TIME_DAYS"],
        "avgDeliveryQty": profile["AVG_DELIVERY_QTY"],
        "nextDelivery": str(profile["NEXT_DELIVERY_DATE"]),
        "nextDeliveryQty": profile["NEXT_DELIVERY_QTY"],
        "stockoutCostPerDay": profile["STOCKOUT_COST_PER_DAY"],
        "supplierName": profile["SUPPLIER_NAME"],
        "orderFrequencyDays": profile["ORDER_FREQUENCY_DAYS"],
        "minOrderQty": profile["MIN_ORDER_QTY"],
        "targetWoc": float(profile["TARGET_WOC"]),
        "weeklyForecast": [
            {
                "week": row["WEEK_LABEL"],
                "weekDate": str(row["WEEK_DATE"]),
                "isForecast": row["IS_FORECAST"],
                "openingStock": row["OPENING_STOCK"],
                "demand": row["DEMAND_UNITS"],
                "delivery": row["DELIVERY_UNITS"],
                "closingStock": row["CLOSING_STOCK"],
                "shelfPct": float(row["SHELF_STOCK_PCT"]),
                "reorderPoint": row["REORDER_POINT"],
            }
            for row in inventory
        ],
    }


@router.get("/brand/{brand_name}/skus")
def get_brand_skus(brand_name: str):
    sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_SUPPLY_PROFILE
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        ORDER BY WEEKLY_DEMAND DESC
    """
    rows = execute_query(sql)
    if not rows:
        return []

    return [
        {
            "brand": row["BRAND_NAME"],
            "skuClass": row["SKU_CLASS"],
            "category": row["CATEGORY"],
            "dailyDemand": float(row["DAILY_DEMAND"]),
            "weeklyDemand": row["WEEKLY_DEMAND"],
            "currentStock": row["CURRENT_STOCK_NATIONAL"],
            "reorderPoint": row["REORDER_POINT"],
            "safetyStock": row["SAFETY_STOCK"],
            "leadTimeDays": row["LEAD_TIME_DAYS"],
            "avgDeliveryQty": row["AVG_DELIVERY_QTY"],
            "nextDelivery": str(row["NEXT_DELIVERY_DATE"]),
            "stockoutCostPerDay": row["STOCKOUT_COST_PER_DAY"],
            "supplierName": row["SUPPLIER_NAME"],
            "dcSplit": json.loads(row["DC_SPLIT"]) if row["DC_SPLIT"] else {},
            "woc": round(row["CURRENT_STOCK_NATIONAL"] / row["WEEKLY_DEMAND"], 1) if row["WEEKLY_DEMAND"] > 0 else 0,
        }
        for row in rows
    ]


@router.get("/brand/{brand_name}/sku/{sku_class}")
def get_sku_detail(brand_name: str, sku_class: str):
    profile_sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_SUPPLY_PROFILE
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND SKU_CLASS = '{sku_class.replace("'", "''")}'
    """
    profile_rows = execute_query(profile_sql)
    if not profile_rows:
        return {"error": "SKU not found"}

    profile = profile_rows[0]

    national_sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND SKU_CLASS = '{sku_class.replace("'", "''")}'
        AND DC_STATE = 'NATIONAL'
        ORDER BY WEEK_DATE
    """
    national = execute_query(national_sql)

    dc_sql = f"""
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND SKU_CLASS = '{sku_class.replace("'", "''")}'
        AND DC_STATE != 'NATIONAL'
        ORDER BY DC_STATE, WEEK_DATE
    """
    dc_rows = execute_query(dc_sql)

    dc_data = {}
    for row in dc_rows:
        state = row["DC_STATE"]
        if state not in dc_data:
            dc_data[state] = []
        dc_data[state].append({
            "week": row["WEEK_LABEL"],
            "closingStock": row["CLOSING_STOCK"],
            "demand": row["DEMAND_UNITS"],
            "delivery": row["DELIVERY_UNITS"],
            "shelfPct": float(row["SHELF_STOCK_PCT"]),
        })

    return {
        "brand": profile["BRAND_NAME"],
        "skuClass": profile["SKU_CLASS"],
        "category": profile["CATEGORY"],
        "dailyDemand": float(profile["DAILY_DEMAND"]),
        "weeklyDemand": profile["WEEKLY_DEMAND"],
        "currentStock": profile["CURRENT_STOCK_NATIONAL"],
        "reorderPoint": profile["REORDER_POINT"],
        "safetyStock": profile["SAFETY_STOCK"],
        "leadTimeDays": profile["LEAD_TIME_DAYS"],
        "avgDeliveryQty": profile["AVG_DELIVERY_QTY"],
        "nextDelivery": str(profile["NEXT_DELIVERY_DATE"]),
        "stockoutCostPerDay": profile["STOCKOUT_COST_PER_DAY"],
        "supplierName": profile["SUPPLIER_NAME"],
        "dcSplit": json.loads(profile["DC_SPLIT"]) if profile["DC_SPLIT"] else {},
        "woc": round(profile["CURRENT_STOCK_NATIONAL"] / profile["WEEKLY_DEMAND"], 1) if profile["WEEKLY_DEMAND"] > 0 else 0,
        "weeklyForecast": [
            {
                "week": row["WEEK_LABEL"],
                "weekDate": str(row["WEEK_DATE"]),
                "isForecast": row["IS_FORECAST"],
                "openingStock": row["OPENING_STOCK"],
                "demand": row["DEMAND_UNITS"],
                "delivery": row["DELIVERY_UNITS"],
                "closingStock": row["CLOSING_STOCK"],
                "shelfPct": float(row["SHELF_STOCK_PCT"]),
                "reorderPoint": row["REORDER_POINT"],
            }
            for row in national
        ],
        "dcInventory": dc_data,
    }


@router.get("/brand/{brand_name}/sku/{sku_class}/stores")
def get_sku_stores(brand_name: str, sku_class: str):
    sql = f"""
        SELECT STORE_NAME, STATE, 
               SUM(UNITS) AS TOTAL_UNITS, SUM(REVENUE) AS TOTAL_REVENUE,
               AVG(ROS) AS AVG_ROS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND SKU_CLASS = '{sku_class.replace("'", "''")}'
        AND FISCAL_YEAR = 2026
        GROUP BY STORE_NAME, STATE
        ORDER BY TOTAL_UNITS DESC
        LIMIT 20
    """
    rows = execute_query(sql)
    return [
        {
            "store": row["STORE_NAME"],
            "state": row["STATE"],
            "units": int(row["TOTAL_UNITS"]),
            "revenue": round(float(row["TOTAL_REVENUE"]), 0),
            "ros": round(float(row["AVG_ROS"]), 1),
        }
        for row in rows
    ]


@router.get("/difot/overview")
def get_difot_overview():
    sql = """
        SELECT BRAND_NAME, CATEGORY,
               AVG(DIFOT_PCT) AS AVG_DIFOT,
               MAX(CASE WHEN FISCAL_WEEK = (SELECT MAX(FISCAL_WEEK) FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NULL) THEN DIFOT_PCT END) AS LATEST_DIFOT,
               SUM(ORDERS_TOTAL) AS TOTAL_ORDERS,
               SUM(ORDERS_ON_TIME) AS TOTAL_ON_TIME,
               COUNT(CASE WHEN DIFOT_PCT < 96 THEN 1 END) AS WEEKS_BELOW_TARGET
        FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
        WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NULL
        GROUP BY BRAND_NAME, CATEGORY
        ORDER BY AVG_DIFOT
    """
    rows = execute_query(sql)
    return [
        {
            "brand": row["BRAND_NAME"],
            "category": row["CATEGORY"],
            "avgDifot": round(float(row["AVG_DIFOT"]), 1),
            "latestDifot": round(float(row["LATEST_DIFOT"]), 1) if row["LATEST_DIFOT"] else 0,
            "totalOrders": row["TOTAL_ORDERS"],
            "totalOnTime": row["TOTAL_ON_TIME"],
            "weeksBelowTarget": row["WEEKS_BELOW_TARGET"],
        }
        for row in rows
    ]


@router.get("/difot/{brand_name}/sku-trends")
def get_brand_difot_sku_trends(brand_name: str):
    sql = f"""
        SELECT CLASS, FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME
        FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NOT NULL
        ORDER BY CLASS, FISCAL_WEEK
    """
    rows = execute_query(sql)
    return [
        {"skuClass": row["CLASS"], "week": row["FISCAL_WEEK"], "difotPct": float(row["DIFOT_PCT"]), "ordersTotal": row["ORDERS_TOTAL"], "ordersOnTime": row["ORDERS_ON_TIME"]}
        for row in rows
    ]


@router.get("/difot/{brand_name}/skus")
def get_brand_difot_skus(brand_name: str):
    sql = f"""
        SELECT CLASS, AVG(DIFOT_PCT) AS AVG_DIFOT,
               SUM(ORDERS_TOTAL) AS TOTAL_ORDERS,
               SUM(ORDERS_ON_TIME) AS TOTAL_ON_TIME,
               COUNT(CASE WHEN DIFOT_PCT < 96 THEN 1 END) AS WEEKS_BELOW
        FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NOT NULL
        GROUP BY CLASS
        ORDER BY AVG_DIFOT
    """
    rows = execute_query(sql)
    return [
        {
            "skuClass": row["CLASS"],
            "avgDifot": round(float(row["AVG_DIFOT"]), 1),
            "totalOrders": row["TOTAL_ORDERS"],
            "totalOnTime": row["TOTAL_ON_TIME"],
            "weeksBelowTarget": row["WEEKS_BELOW"],
        }
        for row in rows
    ]


@router.get("/difot/{brand_name}")
def get_brand_difot(brand_name: str):
    sql = f"""
        SELECT FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME
        FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
        WHERE BRAND_NAME = '{brand_name.replace("'", "''")}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        AND (CLASS IS NULL OR CLASS = '')
        ORDER BY FISCAL_WEEK
    """
    rows = execute_query(sql)
    return [
        {"week": row["FISCAL_WEEK"], "difotPct": float(row["DIFOT_PCT"]), "ordersTotal": row["ORDERS_TOTAL"], "ordersOnTime": row["ORDERS_ON_TIME"]}
        for row in rows
    ]


@router.get("/demand/{brand_name}/{sku_class}/detail")
def get_demand_detail(brand_name: str, sku_class: str):
    brand_safe = brand_name.replace("'", "''")
    sku_safe = sku_class.replace("'", "''")

    state_weekly_sql = f"""
        SELECT STATE, FISCAL_WEEK, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
        WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        GROUP BY STATE, FISCAL_WEEK
        ORDER BY STATE, FISCAL_WEEK
    """

    top_stores_sql = f"""
        SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, AVG(ROS) AS ROS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
        GROUP BY STORE_NAME, STATE
        ORDER BY UNITS DESC
        LIMIT 15
    """

    growing_stores_sql = f"""
        WITH prior_period AS (
            SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS
            FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
            WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
            AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 11 AND 14
            GROUP BY STORE_NAME, STATE
        ),
        latest_period AS (
            SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS
            FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
            WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
            AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
            GROUP BY STORE_NAME, STATE
        )
        SELECT l.STORE_NAME, l.STATE, ROUND(p.UNITS, 0) AS PRIOR_UNITS, ROUND(l.UNITS, 0) AS LATEST_UNITS,
               ROUND(((l.UNITS - p.UNITS) / NULLIF(p.UNITS, 0)) * 100, 1) AS CHANGE_PCT
        FROM latest_period l JOIN prior_period p ON l.STORE_NAME = p.STORE_NAME
        WHERE p.UNITS > 0
        ORDER BY CHANGE_PCT DESC
        LIMIT 10
    """

    summary_sql = f"""
        SELECT
            SUM(CASE WHEN FISCAL_WEEK BETWEEN 15 AND 18 THEN UNITS ELSE 0 END) AS LATEST_UNITS,
            SUM(CASE WHEN FISCAL_WEEK BETWEEN 11 AND 14 THEN UNITS ELSE 0 END) AS PRIOR_UNITS,
            (SELECT SUM(STORE_COUNT) FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
             WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18) AS STORE_COUNT
        FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
        WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 11 AND 18
    """

    state_weekly = execute_query(state_weekly_sql)
    top_stores = execute_query(top_stores_sql)
    growing_stores = execute_query(growing_stores_sql)
    summary = execute_query(summary_sql)

    s = summary[0] if summary else {}
    latest = float(s.get("LATEST_UNITS", 0) or 0)
    prior = float(s.get("PRIOR_UNITS", 0) or 0)
    growth = round(((latest - prior) / prior) * 100, 1) if prior > 0 else 0

    # Build per-state forecast weeks 19-22
    state_latest: dict = {}
    for r in state_weekly:
        state = r["STATE"]
        wk = r["FISCAL_WEEK"]
        if wk >= 15:
            if state not in state_latest:
                state_latest[state] = []
            state_latest[state].append(float(r["UNITS"]))

    forecast_rows = []
    weekly_growth_rate = growth / 100 / 4 if growth > 0 else 0.05
    for state, vals in state_latest.items():
        avg = sum(vals) / len(vals) if vals else 0
        for i, fw in enumerate([19, 20, 21, 22]):
            forecast_rows.append({
                "state": state,
                "week": fw,
                "units": round(avg * (1 + weekly_growth_rate * (i + 1)), 0),
                "isForecast": True,
            })

    return {
        "brand": brand_name,
        "skuClass": sku_class,
        "summary": {
            "latestUnits": int(latest),
            "priorUnits": int(prior),
            "growthPct": growth,
            "storeCount": s.get("STORE_COUNT", 0),
        },
        "stateWeekly": [
            {"state": r["STATE"], "week": r["FISCAL_WEEK"], "units": round(float(r["UNITS"]), 0), "isForecast": False}
            for r in state_weekly
        ] + forecast_rows,
        "topStores": [
            {"store": r["STORE_NAME"], "state": r["STATE"], "units": round(float(r["UNITS"]), 0), "revenue": round(float(r["REVENUE"]), 0), "ros": round(float(r["ROS"]), 1)}
            for r in top_stores
        ],
        "growingStores": [
            {"store": r["STORE_NAME"], "state": r["STATE"], "priorUnits": int(r["PRIOR_UNITS"]), "latestUnits": int(r["LATEST_UNITS"]), "changePct": float(r["CHANGE_PCT"])}
            for r in growing_stores
        ],
    }


@router.get("/demand/trends")
def get_demand_trends():
    sql = """
        SELECT BRAND_NAME, FISCAL_WEEK, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
        WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        GROUP BY BRAND_NAME, FISCAL_WEEK
        ORDER BY BRAND_NAME, FISCAL_WEEK
    """
    rows = execute_query(sql)
    return [
        {"brand": row["BRAND_NAME"], "week": row["FISCAL_WEEK"], "units": int(row["UNITS"])}
        for row in rows
    ]


@router.get("/demand/acceleration")
def get_demand_acceleration():
    sql = """
        WITH weekly AS (
            SELECT BRAND_NAME, SKU_CLASS, FISCAL_WEEK, SUM(UNITS) AS UNITS
            FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
            WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
            GROUP BY BRAND_NAME, SKU_CLASS, FISCAL_WEEK
        ),
        periods AS (
            SELECT BRAND_NAME, SKU_CLASS,
                   AVG(CASE WHEN FISCAL_WEEK BETWEEN 11 AND 14 THEN UNITS END) AS PRIOR_AVG,
                   AVG(CASE WHEN FISCAL_WEEK BETWEEN 15 AND 18 THEN UNITS END) AS LATEST_AVG
            FROM weekly
            GROUP BY BRAND_NAME, SKU_CLASS
            HAVING PRIOR_AVG IS NOT NULL AND LATEST_AVG IS NOT NULL
        )
        SELECT BRAND_NAME, SKU_CLASS, ROUND(PRIOR_AVG) AS PRIOR_AVG, ROUND(LATEST_AVG) AS LATEST_AVG,
               ROUND(((LATEST_AVG - PRIOR_AVG) / NULLIF(PRIOR_AVG, 0)) * 100, 1) AS CHANGE_PCT
        FROM periods
        ORDER BY CHANGE_PCT DESC
    """
    rows = execute_query(sql)
    return [
        {
            "brand": row["BRAND_NAME"],
            "skuClass": row["SKU_CLASS"],
            "priorAvg": int(row["PRIOR_AVG"]),
            "latestAvg": int(row["LATEST_AVG"]),
            "changePct": float(row["CHANGE_PCT"]) if row["CHANGE_PCT"] is not None else 0,
            "signal": "accelerating" if (row["CHANGE_PCT"] or 0) > 5 else "declining" if (row["CHANGE_PCT"] or 0) < -5 else "stable",
        }
        for row in rows
    ]


@router.get("/demand/by-state")
def get_demand_by_state():
    sql = """
        SELECT STATE, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, SUM(STORE_COUNT) AS STORES
        FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
        WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        GROUP BY STATE
        ORDER BY UNITS DESC
    """
    rows = execute_query(sql)
    return [
        {"state": row["STATE"], "units": int(row["UNITS"]), "revenue": round(float(row["REVENUE"]), 0), "stores": row["STORES"]}
        for row in rows
    ]


@router.get("/stores/demand")
def get_store_demand():
    sql = """
        SELECT STORE_NAME, STATE, BRAND_NAME, SKU_CLASS,
               SUM(UNITS) AS TOTAL_UNITS, SUM(REVENUE) AS TOTAL_REVENUE,
               AVG(ROS) AS AVG_ROS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE FISCAL_YEAR = 2026
        GROUP BY STORE_NAME, STATE, BRAND_NAME, SKU_CLASS
        ORDER BY TOTAL_UNITS DESC
        LIMIT 50
    """
    rows = execute_query(sql)
    return [
        {
            "store": row["STORE_NAME"],
            "state": row["STATE"],
            "brand": row["BRAND_NAME"],
            "skuClass": row["SKU_CLASS"],
            "units": int(row["TOTAL_UNITS"]),
            "revenue": round(float(row["TOTAL_REVENUE"]), 0),
            "ros": round(float(row["AVG_ROS"]), 1),
        }
        for row in rows
    ]


@router.get("/demand/store/{store_name}/profile")
def get_store_profile(store_name: str, brand: str = "", sku: str = ""):
    store_safe = store_name.replace("'", "''")
    brand_safe = brand.replace("'", "''")
    sku_safe = sku.replace("'", "''")

    # Store info from DIM_STORE
    store_info_sql = f"""
        SELECT STORE_NAME, STATE, REGION, CITY, STORE_FORMAT
        FROM BABY_MART_DEMO.CURATED.DIM_STORE
        WHERE STORE_NAME LIKE '%{store_safe}%'
        LIMIT 1
    """

    # Weekly trend for this store + brand + SKU
    brand_filter = f"AND BRAND_NAME = '{brand_safe}'" if brand else ""
    sku_filter = f"AND SKU_CLASS = '{sku_safe}'" if sku else ""
    weekly_sql = f"""
        SELECT FISCAL_WEEK, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, AVG(ROS) AS ROS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE STORE_NAME LIKE '%{store_safe}%'
        {brand_filter} {sku_filter}
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        GROUP BY FISCAL_WEEK
        ORDER BY FISCAL_WEEK
    """

    # Customer demographics (segments, age bands, loyalty)
    brand_join = f"JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b ON p.BRAND_KEY = b.BRAND_KEY" if brand else ""
    brand_where = f"AND b.BRAND_NAME = '{brand_safe}'" if brand else ""
    demo_sql = f"""
        SELECT
            cs.SEGMENT_NAME,
            c.AGE_BAND,
            c.LOYALTY_TIER,
            COUNT(DISTINCT c.CUSTOMER_KEY) AS CUSTOMERS,
            SUM(t.NET_REVENUE) AS REVENUE
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ON t.CUSTOMER_KEY = c.CUSTOMER_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON t.STORE_KEY = s.STORE_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        {brand_join}
        WHERE s.STORE_NAME LIKE '%{store_safe}%'
        {brand_where}
        GROUP BY cs.SEGMENT_NAME, c.AGE_BAND, c.LOYALTY_TIER
    """

    # State average for comparison
    state_avg_sql = f"""
        SELECT AVG(UNITS) AS STATE_AVG
        FROM (
            SELECT STORE_NAME, SUM(UNITS) AS UNITS
            FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
            WHERE STATE = (SELECT STATE FROM BABY_MART_DEMO.CURATED.DIM_STORE WHERE STORE_NAME LIKE '%{store_safe}%' LIMIT 1)
            {brand_filter} {sku_filter}
            AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
            GROUP BY STORE_NAME
        )
    """

    store_info = execute_query(store_info_sql)
    weekly = execute_query(weekly_sql)
    try:
        demo_rows = execute_query(demo_sql)
    except Exception:
        demo_rows = []
    state_avg_rows = execute_query(state_avg_sql)

    # Process store info
    info = store_info[0] if store_info else {}

    # Process KPIs from weekly data
    recent = [r for r in weekly if r["FISCAL_WEEK"] >= 15]
    prior = [r for r in weekly if 11 <= r["FISCAL_WEEK"] <= 14]
    avg_units = sum(float(r["UNITS"]) for r in recent) / len(recent) if recent else 0
    avg_revenue = sum(float(r["REVENUE"]) for r in recent) / len(recent) if recent else 0
    avg_ros = sum(float(r["ROS"] or 0) for r in recent) / len(recent) if recent else 0
    prior_avg = sum(float(r["UNITS"]) for r in prior) / len(prior) if prior else 0
    growth_pct = round(((avg_units - prior_avg) / prior_avg) * 100, 1) if prior_avg > 0 else 0

    # Process demographics
    segments: dict = {}
    age_bands: dict = {}
    loyalty_tiers: dict = {}
    total_customers = 0

    for r in demo_rows:
        seg = r["SEGMENT_NAME"]
        age = r["AGE_BAND"] or "Unknown"
        tier = r["LOYALTY_TIER"] or "Unknown"
        custs = int(r["CUSTOMERS"] or 0)
        rev = float(r["REVENUE"] or 0)
        total_customers += custs

        if seg not in segments:
            segments[seg] = {"customers": 0, "revenue": 0}
        segments[seg]["customers"] += custs
        segments[seg]["revenue"] += rev

        if age not in age_bands:
            age_bands[age] = 0
        age_bands[age] += custs

        if tier not in loyalty_tiers:
            loyalty_tiers[tier] = 0
        loyalty_tiers[tier] += custs

    # State comparison
    state_avg = float(state_avg_rows[0]["STATE_AVG"] or 0) if state_avg_rows else 0
    store_total = sum(float(r["UNITS"]) for r in recent)
    index_vs_state = round(store_total / state_avg, 2) if state_avg > 0 else 1.0

    return {
        "storeInfo": {
            "name": info.get("STORE_NAME", store_name),
            "state": info.get("STATE", ""),
            "region": info.get("REGION", ""),
            "city": info.get("CITY", ""),
            "format": info.get("STORE_FORMAT", ""),
        },
        "kpis": {
            "avgUnits": round(avg_units, 1),
            "avgRevenue": round(avg_revenue, 0),
            "ros": round(avg_ros, 1),
            "growthPct": growth_pct,
        },
        "weeklyTrend": [
            {"week": int(r["FISCAL_WEEK"]), "units": round(float(r["UNITS"]), 1), "revenue": round(float(r["REVENUE"]), 0)}
            for r in weekly
        ],
        "demographics": {
            "segments": sorted(
                [{"name": k, "pct": round(v["customers"] / total_customers * 100) if total_customers > 0 else 0, "revenue": round(v["revenue"], 0)} for k, v in segments.items()],
                key=lambda x: x["pct"], reverse=True,
            ),
            "ageBands": sorted(
                [{"band": k, "pct": round(v / total_customers * 100) if total_customers > 0 else 0} for k, v in age_bands.items()],
                key=lambda x: x["pct"], reverse=True,
            ),
            "loyaltyTiers": sorted(
                [{"tier": k, "pct": round(v / total_customers * 100) if total_customers > 0 else 0} for k, v in loyalty_tiers.items()],
                key=lambda x: x["pct"], reverse=True,
            ),
        },
        "channelContext": {
            "region": info.get("REGION", ""),
            "format": info.get("STORE_FORMAT", ""),
            "indexVsState": index_vs_state,
        },
    }


@router.get("/dc/{brand_name}/{sku_class}/store-forecast")
def get_store_forecast(brand_name: str, sku_class: str, change: float = 0):
    brand_safe = brand_name.replace("'", "''")
    sku_safe = sku_class.replace("'", "''")

    # Get per-store weekly demand (latest 4 weeks average)
    # Map ACT→NSW, NT→QLD, TAS→VIC (served by nearest DC)
    store_demand_sql = f"""
        SELECT CASE WHEN STATE='ACT' THEN 'NSW' WHEN STATE='NT' THEN 'QLD' WHEN STATE='TAS' THEN 'VIC' ELSE STATE END AS STATE,
               STORE_NAME,
               SUM(UNITS) / COUNT(DISTINCT FISCAL_WEEK) AS AVG_WEEKLY_DEMAND,
               SUM(REVENUE) / COUNT(DISTINCT FISCAL_WEEK) AS AVG_WEEKLY_REVENUE
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
        GROUP BY CASE WHEN STATE='ACT' THEN 'NSW' WHEN STATE='NT' THEN 'QLD' WHEN STATE='TAS' THEN 'VIC' ELSE STATE END, STORE_NAME
        ORDER BY STATE, AVG_WEEKLY_DEMAND DESC
    """

    # Get DC stock by state
    dc_stock_sql = f"""
        SELECT DC_STATE AS STATE, SUM(CLOSING_STOCK) AS TOTAL_STOCK, SUM(DEMAND_UNITS) AS DC_WEEKLY_DEMAND
        FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
        WHERE BRAND_NAME = '{brand_safe}' AND SKU_CLASS = '{sku_safe}'
        AND DC_STATE != 'NATIONAL' AND WEEK_LABEL = 'W-1'
        GROUP BY DC_STATE
    """

    store_rows = execute_query(store_demand_sql)
    dc_rows = execute_query(dc_stock_sql)

    dc_stocks = {r["STATE"]: {"stock": r["TOTAL_STOCK"], "dcDemand": r["DC_WEEKLY_DEMAND"]} for r in dc_rows}

    growth_multiplier = 1 + change / 100
    avg_unit_price = 28.40  # Huggies avg unit price

    stores = []
    for r in store_rows:
        state = r["STATE"]
        store = r["STORE_NAME"]
        avg_demand = float(r["AVG_WEEKLY_DEMAND"] or 0)
        avg_revenue = float(r["AVG_WEEKLY_REVENUE"] or 0)

        dc = dc_stocks.get(state, {"stock": 0, "dcDemand": 1})
        dc_stock = dc["stock"]
        dc_demand = dc["dcDemand"] if dc["dcDemand"] > 0 else 1

        # Store's share of DC stock proportional to its demand share
        store_share = avg_demand / dc_demand if dc_demand > 0 else 0
        store_stock = dc_stock * store_share

        # Adjusted demand with growth
        adjusted_demand = avg_demand * growth_multiplier
        weeks_to_stockout = round(store_stock / adjusted_demand, 1) if adjusted_demand > 0 else 99

        # --- Shelf % model ---
        # Shelf % represents store inventory as % of target shelf capacity.
        # Target = 1 week of demand on shelves. Stores get replenished from DC
        # 2-3x per week, but with varying timing. Shelf % is based on:
        # 1. DC cover available to this store (lower DC = harder to replenish)
        # 2. Store-specific variation (replenishment cycle timing)
        SHELF_TARGET_DAYS = 7  # target shelf stock = 1 week of demand

        # DC cover for this store's share
        dc_wks_to_empty = store_stock / adjusted_demand if adjusted_demand > 0 else 99

        # Deterministic per-store variation (based on store name hash, +-10%)
        store_hash = sum(ord(c) for c in store) % 20  # 0-19
        store_variation = 0.85 + (store_hash / 20) * 0.15  # 0.85 to 1.0

        # Shelf % depends on how well the DC can supply this store
        if dc_wks_to_empty >= 4:
            # Healthy DC → shelf stays near target (85-97%)
            shelf_pct = round(min(97, 85 + dc_wks_to_empty * 2) * store_variation)
        elif dc_wks_to_empty >= 2:
            # Strained DC → shelf starts declining (65-85%)
            shelf_pct = round((65 + (dc_wks_to_empty - 2) * 10) * store_variation)
        elif dc_wks_to_empty >= 1:
            # Low DC → shelf notably low (45-65%)
            shelf_pct = round((45 + (dc_wks_to_empty - 1) * 20) * store_variation)
        elif dc_wks_to_empty > 0:
            # Critical DC → shelf depleting fast (20-45%)
            shelf_pct = round((20 + dc_wks_to_empty * 25) * store_variation)
        else:
            # DC empty → shelf near zero (5-20% residual)
            shelf_pct = round(5 + store_hash)

        shelf_pct = max(0, min(97, shelf_pct))

        # Sales loss: based on unfilled shelf causing missed sales
        # Lost sales = demand * (1 - shelf_pct/100) — empty shelves = lost customers
        lost_fraction = max(0, 1 - shelf_pct / 100)
        sales_loss_wk = round(adjusted_demand * lost_fraction * avg_unit_price, 0)

        # Predicted 4-week loss simulation
        # Track DC stock depletion → shelf % decline → lost sales
        total_predicted_loss = 0
        sim_dc_stock = store_stock
        for wk in range(1, 5):
            sim_dc_stock -= adjusted_demand
            sim_dc_wks = max(0, sim_dc_stock / adjusted_demand) if adjusted_demand > 0 else 0
            if sim_dc_wks >= 2:
                wk_shelf = min(97, 85 + sim_dc_wks * 2) * store_variation
            elif sim_dc_wks >= 1:
                wk_shelf = (45 + (sim_dc_wks - 1) * 20) * store_variation
            elif sim_dc_wks > 0:
                wk_shelf = (20 + sim_dc_wks * 25) * store_variation
            else:
                # DC exhausted — shelf rapidly empties
                wk_shelf = max(0, shelf_pct - wk * 20)
            wk_shelf = max(0, min(97, wk_shelf))
            wk_lost = adjusted_demand * (1 - wk_shelf / 100)
            total_predicted_loss += wk_lost * avg_unit_price

        stores.append({
            "store": store.replace("Baby Mart ", ""),
            "state": state,
            "dc": f"{state} DC",
            "weeklyDemand": round(adjusted_demand, 1),
            "shelfPct": int(shelf_pct),
            "weeksToStockout": weeks_to_stockout,
            "salesLossWeek": round(sales_loss_wk, 0),
            "predictedLoss4wk": round(total_predicted_loss, 0),
            "storeStock": round(store_stock, 0),
        })

    total_loss = sum(s["salesLossWeek"] for s in stores)
    at_risk = sum(1 for s in stores if s["weeksToStockout"] < 4)

    return {
        "stores": stores,
        "summary": {
            "totalStores": len(stores),
            "atRiskStores": at_risk,
            "weeklyLoss": round(total_loss, 0),
            "predicted4wkLoss": round(sum(s["predictedLoss4wk"] for s in stores), 0),
        },
        "dcStocks": _build_dc_forecast(dc_stocks, growth_multiplier),
    }


# Planned restocks: sized for pre-surge demand (won't cover the +64.7% surge)
PLANNED_RESTOCKS = {
    "NSW": {"week": 3, "qty": 200},
    "QLD": {"week": 3, "qty": 180},
    "VIC": {"week": 4, "qty": 220},
    "WA":  {"week": 4, "qty": 160},
    "SA":  {"week": 4, "qty": 80},
}


def _build_dc_forecast(dc_stocks: dict, growth_multiplier: float):
    results = []
    for state, data in dc_stocks.items():
        weekly_demand = round(data["dcDemand"] * growth_multiplier, 0)
        stock = data["stock"]
        restock = PLANNED_RESTOCKS.get(state, {"week": 4, "qty": 100})

        # Compute week-by-week stock trajectory (0-5 weeks)
        # Stock can never go below 0 (physical reality)
        trajectory = []
        current = stock
        for wk in range(6):
            if wk == restock["week"]:
                current += restock["qty"]
            trajectory.append(round(max(0, current)))
            # Consume demand, but floor at 0 (can't have negative physical stock)
            current -= weekly_demand
            if current < 0:
                current = 0

        weeks_left = round(stock / weekly_demand, 1) if weekly_demand > 0 else 99

        results.append({
            "state": state,
            "stock": stock,
            "weeklyDemand": weekly_demand,
            "weeksLeft": weeks_left,
            "restockWeek": restock["week"],
            "restockQty": restock["qty"],
            "trajectory": trajectory,
        })
    return results


@router.get("/dc/overview")
def get_dc_overview():
    sql = """
        SELECT DC_STATE AS STATE, BRAND_NAME, SKU_CLASS, CLOSING_STOCK, REORDER_POINT, DEMAND_UNITS
        FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
        WHERE DC_STATE != 'NATIONAL'
        AND WEEK_LABEL = 'W-1'
        ORDER BY CLOSING_STOCK DESC
    """
    rows = execute_query(sql)
    return [
        {
            "state": row["STATE"],
            "brand": row["BRAND_NAME"],
            "skuClass": row["SKU_CLASS"],
            "stock": row["CLOSING_STOCK"],
            "reorderPoint": row["REORDER_POINT"],
            "demandUnits": row["DEMAND_UNITS"] or 0,
        }
        for row in rows
    ]


@router.get("/alerts")
def get_alerts():
    sql = """
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.STOCK_ALERTS
        WHERE IS_RESOLVED = FALSE
        ORDER BY
            CASE ALERT_TYPE WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
            CREATED_AT DESC
    """
    rows = execute_query(sql)
    return [
        {
            "id": row["ALERT_ID"],
            "brand": row["BRAND_NAME"],
            "category": row["CATEGORY"],
            "type": row["ALERT_TYPE"],
            "title": row["TITLE"],
            "description": row["DESCRIPTION"],
            "timestamp": str(row["CREATED_AT"]),
            "woc": float(row["WOC_AT_TIME"]),
            "action": row["RECOMMENDED_ACTION"],
        }
        for row in rows
    ]


@router.get("/profiles")
def get_all_profiles():
    sql = """
        SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_SUPPLY_PROFILE
        ORDER BY BRAND_NAME
    """
    rows = execute_query(sql)
    return [
        {
            "brand": row["BRAND_NAME"],
            "category": row["CATEGORY"],
            "currentStock": row["CURRENT_STOCK_UNITS"],
            "dailyDemand": float(row["DAILY_DEMAND"]),
            "weeklyDemand": row["WEEKLY_DEMAND"],
            "reorderPoint": row["REORDER_POINT"],
            "leadTimeDays": row["LEAD_TIME_DAYS"],
            "avgDeliveryQty": row["AVG_DELIVERY_QTY"],
            "nextDelivery": str(row["NEXT_DELIVERY_DATE"]),
            "nextDeliveryQty": row["NEXT_DELIVERY_QTY"],
            "stockoutCostPerDay": row["STOCKOUT_COST_PER_DAY"],
            "supplierName": row["SUPPLIER_NAME"],
            "targetWoc": float(row["TARGET_WOC"]),
            "woc": round(row["CURRENT_STOCK_UNITS"] / row["WEEKLY_DEMAND"], 1) if row["WEEKLY_DEMAND"] > 0 else 0,
        }
        for row in rows
    ]
