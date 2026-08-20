-- ============================================================
-- Baby Mart Demo - ANALYTICS views + semantic view (extracted snapshot)
-- Source: BABY_MART_DEMO.ANALYTICS
--
-- These were created interactively in the original account and were never
-- captured in the numbered scripts. Snapshotted here so the demo is
-- reproducible. Order matters: V_STORE_DEMAND_WEEKLY feeds V_DEMAND_ROLLUP.
--
-- NOTE: V_STORE_DEMAND_WEEKLY's REVENUE expression falls back to
-- SUM(UNITS_SOLD) in its ELSE branch. That is faithful to the original demo
-- (all published figures derive from it) so it is preserved verbatim.
-- ============================================================

USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ----------------------------------------------------------
-- V_STORE_DEMAND_WEEKLY
-- ----------------------------------------------------------
create or replace view V_STORE_DEMAND_WEEKLY(
	BRAND_NAME,
	SKU_CLASS,
	STATE,
	STORE_NAME,
	FISCAL_WEEK,
	FISCAL_YEAR,
	UNITS,
	REVENUE,
	ROS
) as
SELECT BRAND_NAME, CLASS AS SKU_CLASS, STATE, STORE_NAME, FISCAL_WEEK, FISCAL_YEAR,
       CASE 
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 15 THEN SUM(UNITS_SOLD) * 1.35
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 16 THEN SUM(UNITS_SOLD) * 1.50
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 17 THEN SUM(UNITS_SOLD) * 1.72
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18 THEN SUM(UNITS_SOLD) * 2.20
         ELSE SUM(UNITS_SOLD)
       END AS UNITS,
       CASE
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 15 THEN SUM(REVENUE) * 1.35
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 16 THEN SUM(REVENUE) * 1.50
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 17 THEN SUM(REVENUE) * 1.72
         WHEN BRAND_NAME = 'Huggies' AND CLASS = 'Crawler Nappies' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18 THEN SUM(REVENUE) * 2.20
         ELSE SUM(UNITS_SOLD)
       END AS REVENUE,
       AVG(RATE_OF_SALE) AS ROS
FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
GROUP BY 1,2,3,4,5,6;

-- ----------------------------------------------------------
-- V_DEMAND_ROLLUP
-- ----------------------------------------------------------
create or replace view V_DEMAND_ROLLUP(
	BRAND_NAME,
	SKU_CLASS,
	STATE,
	FISCAL_WEEK,
	FISCAL_YEAR,
	UNITS,
	REVENUE,
	STORE_COUNT,
	AVG_ROS
) as
SELECT
    BRAND_NAME,
    SKU_CLASS,
    CASE
        WHEN STATE = 'ACT' THEN 'NSW'
        WHEN STATE = 'NT' THEN 'QLD'
        WHEN STATE = 'TAS' THEN 'VIC'
        ELSE STATE
    END AS STATE,
    FISCAL_WEEK,
    FISCAL_YEAR,
    SUM(UNITS) AS UNITS,
    SUM(REVENUE) AS REVENUE,
    COUNT(DISTINCT STORE_NAME) AS STORE_COUNT,
    AVG(ROS) AS AVG_ROS
FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
GROUP BY BRAND_NAME, SKU_CLASS,
    CASE WHEN STATE = 'ACT' THEN 'NSW' WHEN STATE = 'NT' THEN 'QLD' WHEN STATE = 'TAS' THEN 'VIC' ELSE STATE END,
    FISCAL_WEEK, FISCAL_YEAR;

-- ----------------------------------------------------------
-- VW_SUPPLIER_CATEGORY_RANK
-- ----------------------------------------------------------
create or replace secure view VW_SUPPLIER_CATEGORY_RANK(
	SUPPLIER_NAME,
	BRAND_NAME,
	CATEGORY,
	TOTAL_UNITS,
	TOTAL_REVENUE,
	UNITS_RANK,
	REVENUE_RANK,
	BRANDS_IN_CATEGORY
) as
SELECT
    s.supplier_name,
    s.brand_name,
    s.category,
    SUM(s.units_sold) AS total_units,
    SUM(s.revenue) AS total_revenue,
    RANK() OVER (PARTITION BY s.category ORDER BY SUM(s.units_sold) DESC) AS units_rank,
    RANK() OVER (PARTITION BY s.category ORDER BY SUM(s.revenue) DESC) AS revenue_rank,
    COUNT(DISTINCT s.brand_name) OVER (PARTITION BY s.category) AS brands_in_category
FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY s
WHERE s.fiscal_year = 2026
GROUP BY s.supplier_name, s.brand_name, s.category;

-- ----------------------------------------------------------
-- VW_SUPPLIER_CLASS_RANK
-- ----------------------------------------------------------
create or replace secure view VW_SUPPLIER_CLASS_RANK(
	SUPPLIER_NAME,
	BRAND_NAME,
	CATEGORY,
	CLASS,
	TOTAL_UNITS,
	TOTAL_REVENUE,
	UNITS_RANK,
	REVENUE_RANK,
	BRANDS_IN_CLASS
) as
SELECT
    supplier_name,
    brand_name,
    category,
    class,
    SUM(units_sold) AS total_units,
    SUM(revenue) AS total_revenue,
    RANK() OVER (PARTITION BY category, class ORDER BY SUM(units_sold) DESC) AS units_rank,
    RANK() OVER (PARTITION BY category, class ORDER BY SUM(revenue) DESC) AS revenue_rank,
    COUNT(DISTINCT brand_name) OVER (PARTITION BY category, class) AS brands_in_class
FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
WHERE fiscal_year = 2026
GROUP BY supplier_name, brand_name, category, class;

-- ----------------------------------------------------------
-- NOTE: CATEGORY_INTELLIGENCE_VIEW (semantic view) is intentionally
-- NOT snapshotted here.
--
-- GET_DDL for semantic views omits the facts/metrics sections, so a
-- snapshot would silently drop every measure and leave the Cortex
-- Agent unable to answer aggregate questions. The authoritative
-- definition is the YAML in retailer/sql/05_create_agent.sql, which
-- is created via SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML.
-- ----------------------------------------------------------
