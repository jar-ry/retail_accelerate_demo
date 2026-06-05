"""Vendor Economics endpoints — profitability, benchmarking, scorecards."""
from fastapi import APIRouter
from backend.routes.supply import execute_query

router = APIRouter()


@router.get("/suppliers")
def get_suppliers():
    sql = """
        SELECT s.SUPPLIER_KEY, s.SUPPLIER_NAME, s.PAYMENT_TERMS, s.LEAD_TIME_DAYS,
               COUNT(DISTINCT p.PRODUCT_KEY) AS PRODUCT_COUNT,
               COUNT(DISTINCT p.CATEGORY) AS CATEGORY_COUNT
        FROM BABY_MART_DEMO.CURATED.DIM_SUPPLIER s
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON s.SUPPLIER_KEY = p.SUPPLIER_KEY
        GROUP BY s.SUPPLIER_KEY, s.SUPPLIER_NAME, s.PAYMENT_TERMS, s.LEAD_TIME_DAYS
        ORDER BY s.SUPPLIER_NAME
    """
    rows = execute_query(sql)
    return [{"key": r["SUPPLIER_KEY"], "name": r["SUPPLIER_NAME"], "paymentTerms": r["PAYMENT_TERMS"], "leadTimeDays": r["LEAD_TIME_DAYS"], "products": r["PRODUCT_COUNT"], "categories": r["CATEGORY_COUNT"]} for r in rows]


@router.get("/profitability")
def get_profitability(supplier: str = ""):
    supplier_safe = supplier.replace("'", "''")
    supplier_filter = f"AND s.SUPPLIER_NAME = '{supplier_safe}'" if supplier else ""

    # Waterfall data
    waterfall_sql = f"""
        SELECT
            SUM(t.NET_REVENUE + t.DISCOUNT_AMOUNT) AS GROSS_SALES,
            SUM(t.DISCOUNT_AMOUNT) AS TOTAL_DISCOUNTS,
            SUM(CASE WHEN pr.PROMOTION_KEY IS NOT NULL THEN t.DISCOUNT_AMOUNT ELSE 0 END) AS PROMO_ALLOWANCES,
            SUM(t.NET_REVENUE) AS NET_SALES,
            SUM(t.COST_AMOUNT) AS COGS,
            SUM(t.MARGIN_AMOUNT) AS GROSS_MARGIN
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        LEFT JOIN BABY_MART_DEMO.CURATED.DIM_PROMOTION pr ON t.PROMOTION_KEY = pr.PROMOTION_KEY AND pr.PROMOTION_KEY > 0
        WHERE 1=1 {supplier_filter}
    """

    # SKU-level P&L
    sku_sql = f"""
        SELECT p.PRODUCT_NAME, p.CATEGORY, p.CLASS,
               SUM(t.NET_REVENUE + t.DISCOUNT_AMOUNT) AS GROSS_SALES,
               SUM(t.DISCOUNT_AMOUNT) AS DISCOUNTS,
               SUM(t.NET_REVENUE) AS NET_SALES,
               SUM(t.COST_AMOUNT) AS COGS,
               SUM(t.MARGIN_AMOUNT) AS MARGIN,
               ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT,
               SUM(t.QUANTITY) AS UNITS
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE 1=1 {supplier_filter}
        GROUP BY p.PRODUCT_NAME, p.CATEGORY, p.CLASS
        ORDER BY NET_SALES DESC
        LIMIT 20
    """

    # Monthly trend (using DATE_KEY as YYYYMMDD — format as YYYY-MM)
    trend_sql = f"""
        SELECT TO_CHAR(TO_DATE(CAST(t.DATE_KEY AS VARCHAR), 'YYYYMMDD'), 'YYYY-MM') AS MONTH_LABEL,
               SUM(t.NET_REVENUE) AS REVENUE,
               SUM(t.MARGIN_AMOUNT) AS MARGIN,
               ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE 1=1 {supplier_filter}
        GROUP BY MONTH_LABEL
        ORDER BY MONTH_LABEL
    """

    waterfall = execute_query(waterfall_sql)
    skus = execute_query(sku_sql)
    trend = execute_query(trend_sql)

    w = waterfall[0] if waterfall else {}
    gross = float(w.get("GROSS_SALES", 0) or 0)
    discounts = float(w.get("TOTAL_DISCOUNTS", 0) or 0)
    promo = float(w.get("PROMO_ALLOWANCES", 0) or 0)
    net_sales = float(w.get("NET_SALES", 0) or 0)
    cogs = float(w.get("COGS", 0) or 0)
    margin = float(w.get("GROSS_MARGIN", 0) or 0)
    # Estimate rebates as ~2% of net sales for demo
    rebates = round(net_sales * 0.02)
    net_margin = margin - rebates

    return {
        "waterfall": {
            "grossSales": round(gross),
            "discounts": round(discounts),
            "promoAllowances": round(promo),
            "netSales": round(net_sales),
            "cogs": round(cogs),
            "grossMargin": round(margin),
            "rebates": round(rebates),
            "netMargin": round(net_margin),
        },
        "kpis": {
            "netRevenue": round(net_sales),
            "grossMarginPct": round(margin / net_sales * 100, 1) if net_sales > 0 else 0,
            "netMarginPct": round(net_margin / net_sales * 100, 1) if net_sales > 0 else 0,
            "promoSpendPct": round(promo / gross * 100, 1) if gross > 0 else 0,
            "discountPct": round(discounts / gross * 100, 1) if gross > 0 else 0,
        },
        "skus": [
            {"product": r["PRODUCT_NAME"], "category": r["CATEGORY"], "class": r["CLASS"], "grossSales": round(float(r["GROSS_SALES"])), "discounts": round(float(r["DISCOUNTS"])), "netSales": round(float(r["NET_SALES"])), "cogs": round(float(r["COGS"])), "margin": round(float(r["MARGIN"])), "marginPct": float(r["MARGIN_PCT"] or 0), "units": int(r["UNITS"])}
            for r in skus
        ],
        "trend": [
            {"month": str(r["MONTH_LABEL"]), "revenue": round(float(r["REVENUE"])), "margin": round(float(r["MARGIN"])), "marginPct": float(r["MARGIN_PCT"] or 0)}
            for r in trend
        ],
    }


@router.get("/benchmarking")
def get_benchmarking(category: str = ""):
    category_safe = category.replace("'", "''")
    cat_filter = f"AND p.CATEGORY = '{category_safe}'" if category else ""

    sql = f"""
        WITH current_period AS (
            SELECT s.SUPPLIER_NAME,
                   SUM(t.NET_REVENUE) AS REVENUE,
                   SUM(t.MARGIN_AMOUNT) AS MARGIN,
                   SUM(t.QUANTITY) AS UNITS
            FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
            JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
            JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
            WHERE t.DATE_KEY >= 20260101 AND t.DATE_KEY <= 20260507 {cat_filter}
            GROUP BY s.SUPPLIER_NAME
        ),
        prior_period AS (
            SELECT s.SUPPLIER_NAME,
                   SUM(t.NET_REVENUE) AS REVENUE
            FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
            JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
            JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
            WHERE t.DATE_KEY >= 20250101 AND t.DATE_KEY <= 20250507 {cat_filter}
            GROUP BY s.SUPPLIER_NAME
        ),
        total AS (
            SELECT SUM(REVENUE) AS TOTAL_REV FROM current_period
        )
        SELECT c.SUPPLIER_NAME,
               c.REVENUE,
               c.MARGIN,
               c.UNITS,
               ROUND(c.MARGIN / NULLIF(c.REVENUE, 0) * 100, 1) AS MARGIN_PCT,
               ROUND((c.REVENUE - COALESCE(pp.REVENUE, c.REVENUE)) / NULLIF(COALESCE(pp.REVENUE, c.REVENUE), 0) * 100, 1) AS GROWTH_PCT,
               ROUND(c.REVENUE / NULLIF(t.TOTAL_REV, 0) * 100, 1) AS SHARE_PCT
        FROM current_period c
        LEFT JOIN prior_period pp ON c.SUPPLIER_NAME = pp.SUPPLIER_NAME
        CROSS JOIN total t
        ORDER BY c.REVENUE DESC
    """
    rows = execute_query(sql)
    return [
        {"supplier": r["SUPPLIER_NAME"], "revenue": round(float(r["REVENUE"])), "margin": round(float(r["MARGIN"])), "units": int(r["UNITS"]), "marginPct": float(r["MARGIN_PCT"] or 0), "growthPct": float(r["GROWTH_PCT"] or 0), "sharePct": float(r["SHARE_PCT"] or 0)}
        for r in rows
    ]


@router.get("/scorecard/{supplier_name}")
def get_scorecard(supplier_name: str):
    supplier_safe = supplier_name.replace("'", "''")

    # Summary metrics
    summary_sql = f"""
        SELECT
            SUM(t.NET_REVENUE) AS REVENUE,
            SUM(t.MARGIN_AMOUNT) AS MARGIN,
            ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT,
            SUM(t.QUANTITY) AS UNITS,
            COUNT(DISTINCT t.TRANSACTION_ID) AS TRANSACTIONS,
            COUNT(DISTINCT p.PRODUCT_KEY) AS PRODUCTS
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE s.SUPPLIER_NAME = '{supplier_safe}'
    """

    # Monthly sales trend
    trend_sql = f"""
        SELECT TO_CHAR(TO_DATE(CAST(t.DATE_KEY AS VARCHAR), 'YYYYMMDD'), 'YYYY-MM') AS MONTH_LABEL,
               SUM(t.NET_REVENUE) AS REVENUE,
               SUM(t.QUANTITY) AS UNITS
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE s.SUPPLIER_NAME = '{supplier_safe}'
        GROUP BY MONTH_LABEL ORDER BY MONTH_LABEL
    """

    # Category share
    share_sql = f"""
        SELECT p.CATEGORY,
               SUM(CASE WHEN s.SUPPLIER_NAME = '{supplier_safe}' THEN t.NET_REVENUE ELSE 0 END) AS VENDOR_REV,
               SUM(t.NET_REVENUE) AS CATEGORY_REV,
               ROUND(SUM(CASE WHEN s.SUPPLIER_NAME = '{supplier_safe}' THEN t.NET_REVENUE ELSE 0 END) / NULLIF(SUM(t.NET_REVENUE), 0) * 100, 1) AS SHARE_PCT
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE p.CATEGORY IN (SELECT DISTINCT CATEGORY FROM BABY_MART_DEMO.CURATED.DIM_PRODUCT WHERE SUPPLIER_KEY = (SELECT SUPPLIER_KEY FROM BABY_MART_DEMO.CURATED.DIM_SUPPLIER WHERE SUPPLIER_NAME = '{supplier_safe}'))
        GROUP BY p.CATEGORY
    """

    # Top products
    top_products_sql = f"""
        SELECT p.PRODUCT_NAME, p.CLASS, SUM(t.NET_REVENUE) AS REVENUE,
               ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100,1) AS MARGIN_PCT,
               SUM(t.QUANTITY) AS UNITS
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE s.SUPPLIER_NAME = '{supplier_safe}'
        GROUP BY p.PRODUCT_NAME, p.CLASS
        ORDER BY REVENUE DESC LIMIT 10
    """

    summary = execute_query(summary_sql)
    trend = execute_query(trend_sql)
    share = execute_query(share_sql)
    top_products = execute_query(top_products_sql)

    s = summary[0] if summary else {}
    return {
        "supplier": supplier_name,
        "summary": {
            "revenue": round(float(s.get("REVENUE", 0) or 0)),
            "margin": round(float(s.get("MARGIN", 0) or 0)),
            "marginPct": float(s.get("MARGIN_PCT", 0) or 0),
            "units": int(s.get("UNITS", 0) or 0),
            "transactions": int(s.get("TRANSACTIONS", 0) or 0),
            "products": int(s.get("PRODUCTS", 0) or 0),
        },
        "trend": [{"month": str(r["MONTH_LABEL"]), "revenue": round(float(r["REVENUE"])), "units": int(r["UNITS"])} for r in trend],
        "categoryShare": [{"category": r["CATEGORY"], "vendorRev": round(float(r["VENDOR_REV"])), "categoryRev": round(float(r["CATEGORY_REV"])), "sharePct": float(r["SHARE_PCT"] or 0)} for r in share],
        "topProducts": [{"product": r["PRODUCT_NAME"], "class": r["CLASS"], "revenue": round(float(r["REVENUE"])), "marginPct": float(r["MARGIN_PCT"] or 0), "units": int(r["UNITS"])} for r in top_products],
    }


@router.post("/insights")
def vendor_insights(body: dict = {}):
    """AI analysis of vendor performance."""
    prompt = body.get("prompt", "")
    if not prompt:
        return {"text": ""}
    try:
        escaped = prompt.replace("'", "''")
        sql = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '{escaped}') AS RESP"
        rows = execute_query(sql)
        return {"text": rows[0]["RESP"] if rows else ""}
    except Exception as e:
        return {"text": f"Error: {str(e)}"}
