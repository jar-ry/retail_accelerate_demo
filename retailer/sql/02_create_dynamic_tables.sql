-- ============================================================
-- Baby Mart Supplier Collaboration Platform
-- 02_create_dynamic_tables.sql
-- Pre-aggregated analytics layer
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA ANALYTICS;
USE WAREHOUSE DEMO_ANALYTICS_WH;

CREATE OR REPLACE DYNAMIC TABLE DT_SELLTHROUGH_WEEKLY
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
SELECT
    s.supplier_key,
    sup.supplier_name,
    b.brand_key,
    b.brand_name,
    p.category,
    p.class,
    st.store_key,
    st.store_name,
    st.state,
    st.region,
    d.fiscal_week,
    d.fiscal_month,
    d.fiscal_quarter,
    d.fiscal_year,
    SUM(f.quantity) AS units_sold,
    SUM(f.net_revenue) AS revenue,
    AVG(f.unit_price) AS avg_price,
    SUM(f.margin_amount) AS margin,
    NULL AS stock_on_hand,
    NULL AS sell_through_rate,
    NULL AS weeks_of_cover,
    SUM(f.quantity) / COUNT(DISTINCT d.calendar_date) * 7 AS rate_of_sale
FROM CURATED.FACT_TRANSACTION_LINES f
JOIN CURATED.DIM_DATE d ON f.date_key = d.date_key
JOIN CURATED.DIM_PRODUCT p ON f.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
JOIN CURATED.DIM_SUPPLIER sup ON p.supplier_key = sup.supplier_key
JOIN CURATED.DIM_STORE st ON f.store_key = st.store_key
CROSS JOIN (SELECT DISTINCT supplier_key FROM CURATED.DIM_SUPPLIER) s
WHERE p.supplier_key = s.supplier_key
GROUP BY ALL;

CREATE OR REPLACE DYNAMIC TABLE DT_BRAND_SWITCHING
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
WITH customer_brand_history AS (
    SELECT
        f.customer_key,
        p.category,
        p.class,
        b.brand_name,
        d.calendar_date,
        ROW_NUMBER() OVER (PARTITION BY f.customer_key, p.category, p.class ORDER BY d.calendar_date) AS purchase_seq
    FROM CURATED.FACT_TRANSACTION_LINES f
    JOIN CURATED.DIM_DATE d ON f.date_key = d.date_key
    JOIN CURATED.DIM_PRODUCT p ON f.product_key = p.product_key
    JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
    WHERE f.customer_key IS NOT NULL
),
switches AS (
    SELECT
        curr.customer_key,
        curr.category,
        curr.class,
        prev.brand_name AS from_brand,
        curr.brand_name AS to_brand
    FROM customer_brand_history curr
    JOIN customer_brand_history prev
        ON curr.customer_key = prev.customer_key
        AND curr.category = prev.category
        AND curr.class = prev.class
        AND curr.purchase_seq = prev.purchase_seq + 1
    WHERE curr.brand_name != prev.brand_name
)
SELECT
    category,
    class,
    from_brand,
    to_brand,
    COUNT(*) AS switch_count,
    COUNT(DISTINCT customer_key) AS customer_count
FROM switches
GROUP BY category, class, from_brand, to_brand;

CREATE OR REPLACE DYNAMIC TABLE DT_CUSTOMER_SEGMENT_PERFORMANCE
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
SELECT
    sup.supplier_key,
    sup.supplier_name,
    b.brand_name,
    seg.segment_name,
    d.fiscal_year,
    d.fiscal_quarter,
    COUNT(DISTINCT f.customer_key) AS customer_count,
    SUM(f.net_revenue) AS revenue,
    SUM(f.quantity) AS units,
    AVG(f.quantity) AS avg_items_per_txn,
    COUNT(DISTINCT f.transaction_id) AS transaction_count
FROM CURATED.FACT_TRANSACTION_LINES f
JOIN CURATED.DIM_DATE d ON f.date_key = d.date_key
JOIN CURATED.DIM_PRODUCT p ON f.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
JOIN CURATED.DIM_SUPPLIER sup ON p.supplier_key = sup.supplier_key
JOIN CURATED.DIM_CUSTOMER c ON f.customer_key = c.customer_key
JOIN CURATED.DIM_CUSTOMER_SEGMENT seg ON c.segment_key = seg.segment_key
WHERE f.customer_key IS NOT NULL
GROUP BY ALL;

CREATE OR REPLACE DYNAMIC TABLE DT_PROMOTIONAL_EFFECTIVENESS
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
SELECT
    pr.promotion_key,
    pr.promotion_name,
    pr.mechanic,
    pr.discount_pct,
    p.product_key,
    p.product_name,
    b.brand_name,
    p.category,
    SUM(f.quantity) AS promo_units,
    SUM(f.net_revenue) AS promo_revenue,
    SUM(f.discount_amount) AS total_discount,
    SUM(f.margin_amount) AS promo_margin
FROM CURATED.FACT_TRANSACTION_LINES f
JOIN CURATED.DIM_PROMOTION pr ON f.promotion_key = pr.promotion_key
JOIN CURATED.DIM_PRODUCT p ON f.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
WHERE f.promotion_key IS NOT NULL
GROUP BY ALL;

CREATE OR REPLACE DYNAMIC TABLE DT_CLV_BY_BRAND
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
SELECT
    p.category,
    b.brand_name,
    b.brand_key,
    COUNT(DISTINCT c.customer_key) AS customer_count,
    AVG(c.lifetime_spend) AS avg_clv,
    MEDIAN(c.lifetime_spend) AS median_clv,
    AVG(c.total_transactions) AS avg_transactions
FROM CURATED.DIM_CUSTOMER c
JOIN CURATED.FACT_TRANSACTION_LINES f ON c.customer_key = f.customer_key
JOIN CURATED.DIM_PRODUCT p ON f.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
GROUP BY p.category, b.brand_name, b.brand_key;

CREATE OR REPLACE DYNAMIC TABLE DT_COMPETITIVE_POSITION
  TARGET_LAG = '1 hour'
  WAREHOUSE = DEMO_ANALYTICS_WH
AS
SELECT
    d.fiscal_week,
    d.fiscal_year,
    p.product_key,
    p.product_name,
    p.category,
    b.brand_name,
    cp.competitor_name,
    AVG(cp.competitor_price) AS avg_competitor_price,
    AVG(cp.our_price) AS avg_our_price,
    AVG(cp.price_gap_pct) AS avg_price_gap_pct
FROM CURATED.FACT_COMPETITOR_PRICING cp
JOIN CURATED.DIM_DATE d ON cp.date_key = d.date_key
JOIN CURATED.DIM_PRODUCT p ON cp.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
GROUP BY ALL;
