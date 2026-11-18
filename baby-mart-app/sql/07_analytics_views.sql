-- ============================================================
-- Baby Mart Demo - ANALYTICS views + semantic view (extracted snapshot)
-- Source: BABY_MART_DEMO.ANALYTICS
--
-- These were created interactively in the original account and were never
-- captured in the numbered scripts. Snapshotted here so the demo is
-- reproducible. Order matters: V_STORE_DEMAND_WEEKLY feeds V_DEMAND_ROLLUP.
--
-- V_STORE_DEMAND_WEEKLY is POS sell-through with any ACTIVE planner override
-- from DEMAND_OVERRIDE applied on top; the supply pages read it as "reported
-- demand". It used to hardcode the Huggies Crawler factors in a CASE and fall
-- back to SUM(UNITS_SOLD) for REVENUE; the factors are now recorded overrides
-- (same reported units) and REVENUE is revenue.
-- ============================================================

USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ----------------------------------------------------------
-- DEMAND_OVERRIDE
-- ----------------------------------------------------------
-- The Huggies Crawler "surge": a demand planner ramped the class up for FY2026
-- weeks 15-18 ahead of a supplier TV campaign, with a review date of 30 April.
-- POS never moved and the override was never reviewed, so it is still ACTIVE.
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.DEMAND_OVERRIDE (
  OVERRIDE_ID  VARCHAR(20) PRIMARY KEY,
  BRAND_NAME   VARCHAR(100),
  CLASS        VARCHAR(100),
  FISCAL_YEAR  NUMBER(4,0),
  FISCAL_WEEK  NUMBER(2,0),
  FACTOR       NUMBER(6,3),
  REASON       VARCHAR(500),
  ENTERED_BY   VARCHAR(100),
  ENTERED_AT   TIMESTAMP_NTZ,
  REVIEW_BY    DATE,
  STATUS       VARCHAR(20)   -- ACTIVE | REMOVED
) COMMENT = 'Manual demand overrides a planner layered on POS sell-through. V_STORE_DEMAND_WEEKLY applies every ACTIVE row.';

MERGE INTO BABY_MART_DEMO.ANALYTICS.DEMAND_OVERRIDE t
USING (SELECT * FROM VALUES
  ('DOV-26-0415', 'Huggies', 'Crawler Nappies', 2026, 15, 1.35),
  ('DOV-26-0416', 'Huggies', 'Crawler Nappies', 2026, 16, 1.50),
  ('DOV-26-0417', 'Huggies', 'Crawler Nappies', 2026, 17, 1.72),
  ('DOV-26-0418', 'Huggies', 'Crawler Nappies', 2026, 18, 2.20)
  AS v(OVERRIDE_ID, BRAND_NAME, CLASS, FISCAL_YEAR, FISCAL_WEEK, FACTOR)) s
ON t.OVERRIDE_ID = s.OVERRIDE_ID
WHEN NOT MATCHED THEN INSERT VALUES (s.OVERRIDE_ID, s.BRAND_NAME, s.CLASS, s.FISCAL_YEAR, s.FISCAL_WEEK, s.FACTOR,
  'Uplift ahead of the Kimberly-Clark Crawler Nappies TV campaign (supplier advised a mid-April launch); ramped weekly.',
  'Sam Patel (Demand Planning)', '2026-04-02 09:14:00'::TIMESTAMP_NTZ, '2026-04-30'::DATE, 'ACTIVE');

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
SELECT s.BRAND_NAME, s.CLASS AS SKU_CLASS, s.STATE, s.STORE_NAME, s.FISCAL_WEEK, s.FISCAL_YEAR,
       SUM(s.UNITS_SOLD) * COALESCE(MAX(o.FACTOR), 1) AS UNITS,
       SUM(s.REVENUE) * COALESCE(MAX(o.FACTOR), 1) AS REVENUE,
       AVG(s.RATE_OF_SALE) AS ROS
FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY s
-- Pre-aggregated so two overrides on one week compound instead of fanning out the join.
LEFT JOIN (SELECT BRAND_NAME, CLASS, FISCAL_YEAR, FISCAL_WEEK, EXP(SUM(LN(FACTOR))) AS FACTOR
           FROM BABY_MART_DEMO.ANALYTICS.DEMAND_OVERRIDE WHERE STATUS = 'ACTIVE' AND FACTOR > 0
           GROUP BY 1, 2, 3, 4) o
  ON o.BRAND_NAME = s.BRAND_NAME AND o.CLASS = s.CLASS AND o.FISCAL_YEAR = s.FISCAL_YEAR AND o.FISCAL_WEEK = s.FISCAL_WEEK
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
