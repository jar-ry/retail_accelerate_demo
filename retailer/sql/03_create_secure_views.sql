-- ============================================================
-- Baby Mart Supplier Collaboration Platform
-- 03_create_secure_views.sql
-- Supplier-filtered views for data sharing via Native App
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA ANALYTICS;

CREATE OR REPLACE SECURE VIEW VW_SUPPLIER_SELLTHROUGH AS
SELECT
    supplier_name,
    brand_name,
    category,
    class,
    store_name,
    state,
    region,
    fiscal_week,
    fiscal_month,
    fiscal_quarter,
    fiscal_year,
    units_sold,
    revenue,
    avg_price,
    margin,
    rate_of_sale
FROM ANALYTICS.DT_SELLTHROUGH_WEEKLY;

CREATE OR REPLACE SECURE VIEW VW_SUPPLIER_SEGMENTS AS
SELECT
    supplier_name,
    brand_name,
    segment_name,
    fiscal_year,
    fiscal_quarter,
    customer_count,
    revenue,
    units,
    avg_items_per_txn,
    transaction_count
FROM ANALYTICS.DT_CUSTOMER_SEGMENT_PERFORMANCE;

CREATE OR REPLACE SECURE VIEW VW_SUPPLIER_SWITCHING AS
SELECT
    category,
    class,
    from_brand,
    to_brand,
    switch_count,
    customer_count
FROM ANALYTICS.DT_BRAND_SWITCHING;

CREATE OR REPLACE SECURE VIEW VW_SUPPLIER_INVENTORY AS
SELECT
    d.fiscal_week,
    d.fiscal_year,
    st.store_name,
    st.state,
    st.region,
    p.product_name,
    b.brand_name,
    sup.supplier_name,
    p.category,
    i.stock_on_hand,
    i.stock_on_order,
    i.receipts_qty,
    i.days_since_last_sale
FROM CURATED.FACT_INVENTORY i
JOIN CURATED.DIM_DATE d ON i.date_key = d.date_key
JOIN CURATED.DIM_STORE st ON i.store_key = st.store_key
JOIN CURATED.DIM_PRODUCT p ON i.product_key = p.product_key
JOIN CURATED.DIM_BRAND b ON p.brand_key = b.brand_key
JOIN CURATED.DIM_SUPPLIER sup ON p.supplier_key = sup.supplier_key
WHERE d.calendar_date = (SELECT MAX(calendar_date) FROM CURATED.DIM_DATE WHERE date_key IN (SELECT DISTINCT date_key FROM CURATED.FACT_INVENTORY));
