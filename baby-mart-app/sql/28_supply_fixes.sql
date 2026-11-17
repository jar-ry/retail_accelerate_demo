-- ============================================================
-- Supply Chain — data fixes before any agent can reason over supply
--
-- The persona review found four problems that would make a supply agent's
-- answers wrong or empty:
--
-- 1. NO DEMO CLOCK. The supply pages filtered on CURRENT_DATE(), but the supply
--    data ends 11 June 2026 (last delivered PO, last DC dispatch, last forecast
--    actual), so "today's inbound" and "last 7 days" were empty. SUPPLY_AS_OF()
--    is the supply persona's clock, like CAMPAIGN.CMP_AS_OF() is the campaign's.
--    (POS still ends 7 May 2026; the supply feeds run five weeks further.)
-- 2. ONE SUPPLIER, THREE NAMES. Rascal + Friends was "Rascal & Co" (14-day lead)
--    in DIM_DISTRIBUTOR and the POs, "Rascal + Friends NZ" (12-day lead) in
--    BRAND_SUPPLY_PROFILE and the alert. The supply profiles now take the
--    distributor's name and lead time for every brand.
-- 3. POs IN A CLASS NOBODY SELLS. Every Rascal + Friends PO was "Eco Nappies";
--    POS sells Crawler, Toddler, Newborn Nappies, Pull-Ups and Wipes. The POs are
--    spread across the real classes.
-- 4. A SHORTAGE WITH NO CAUSE. The NSW Rascal + Friends shortage (CAMPAIGN.
--    SUPPLY_POSITION, which blocks camp-001) had nothing behind it on the supply
--    side. Now: Rascal & Co short-shipped every NSW Crawler Nappies PO since
--    1 May (38% filled), and its DIFOT drifts from ~95% to 74.5% over FY2026
--    weeks 14-19. That is the drift the review asked for, and the cause the
--    stockout recovery builder (sql/46) works from.
--
-- Idempotent: safe to re-run.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. The supply clock ----------
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.SUPPLY_SETTING (
  SETTING_KEY VARCHAR PRIMARY KEY, SETTING_VALUE VARCHAR, VALUE_TYPE VARCHAR, LABEL VARCHAR, DESCRIPTION VARCHAR
) COMMENT = 'Operator settings for the supply persona. AS_OF_DATE is the supply demo clock.';

MERGE INTO BABY_MART_DEMO.ANALYTICS.SUPPLY_SETTING t
USING (SELECT * FROM VALUES
  ('AS_OF_DATE', '2026-06-11', 'DATE', 'Supply as-of date', 'Demo clock: the last day of PO, DC and forecast actuals. "Today", "this week" and "last 7 days" on the supply pages are measured from here.'),
  ('TRANSFER_COST_PER_UNIT_AUD', '1.15', 'NUMBER', 'Inter-DC transfer cost per unit', 'Linehaul plus double handling for moving a unit between DCs. ASSUMPTION: no freight rate card is loaded.'),
  ('TARGET_COVER_WEEKS', '4', 'NUMBER', 'Recovery target cover (weeks)', 'Cover a recovery plan rebuilds the short DC region to.'),
  ('EXPEDITE_PREMIUM_PCT', '12', 'NUMBER', 'Expedite premium (% of stock value)', 'Extra cost of moving a PO through a 3PL instead of the supplier''s own freight. ASSUMPTION: no 3PL rate card is loaded.'),
  ('SOURCE_FLOOR_WEEKS', '3', 'NUMBER', 'Minimum cover left at a source DC', 'A transfer may not take a source DC below this many weeks of its own demand.')
  AS s(SETTING_KEY, SETTING_VALUE, VALUE_TYPE, LABEL, DESCRIPTION)) s
ON t.SETTING_KEY = s.SETTING_KEY
WHEN NOT MATCHED THEN INSERT VALUES (s.SETTING_KEY, s.SETTING_VALUE, s.VALUE_TYPE, s.LABEL, s.DESCRIPTION);

CREATE OR REPLACE FUNCTION BABY_MART_DEMO.ANALYTICS.SUPPLY_AS_OF()
RETURNS DATE
COMMENT = 'The supply demo clock (SUPPLY_SETTING.AS_OF_DATE). Use instead of CURRENT_DATE() on supply data.'
AS
$$
  SELECT SETTING_VALUE::DATE FROM BABY_MART_DEMO.ANALYTICS.SUPPLY_SETTING WHERE SETTING_KEY = 'AS_OF_DATE'
$$;

-- ---------- 2. One name and lead time per supplier ----------
UPDATE BABY_MART_DEMO.ANALYTICS.BRAND_SUPPLY_PROFILE p
SET SUPPLIER_NAME = d.SUPPLIER_NAME, LEAD_TIME_DAYS = d.STD_LEAD_TIME_DAYS
FROM BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR d
WHERE ARRAY_CONTAINS(p.BRAND_NAME::VARIANT, SPLIT(d.BRANDS, ','))
  AND (p.SUPPLIER_NAME <> d.SUPPLIER_NAME OR p.LEAD_TIME_DAYS <> d.STD_LEAD_TIME_DAYS);

UPDATE BABY_MART_DEMO.ANALYTICS.SKU_SUPPLY_PROFILE p
SET SUPPLIER_NAME = d.SUPPLIER_NAME, LEAD_TIME_DAYS = d.STD_LEAD_TIME_DAYS
FROM BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR d
WHERE ARRAY_CONTAINS(p.BRAND_NAME::VARIANT, SPLIT(d.BRANDS, ','))
  AND (p.SUPPLIER_NAME <> d.SUPPLIER_NAME OR p.LEAD_TIME_DAYS <> d.STD_LEAD_TIME_DAYS);

UPDATE BABY_MART_DEMO.ANALYTICS.STOCK_ALERTS
SET RECOMMENDED_ACTION = 'Place an emergency order with Rascal & Co (14-day lead time) and move stock from a DC with cover to spare.',
    DESCRIPTION = 'Rascal & Co has short-shipped NSW Crawler Nappies since May and demand is outpacing supply. NSW stores are running out.'
WHERE ALERT_ID = 'ALT-001';

-- ---------- 3. Rascal + Friends POs in the classes POS sells ----------
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC t
SET SKU_CLASS = c.CLS
FROM (
  SELECT PO_NUMBER,
         DECODE(MOD(ROW_NUMBER() OVER (PARTITION BY DC_STATE ORDER BY ORDER_DATE, PO_NUMBER) - 1, 5),
                0, 'Crawler Nappies', 1, 'Toddler Nappies', 2, 'Newborn Nappies', 3, 'Pull-Ups', 'Wipes') AS CLS
  FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
  WHERE BRAND_NAME = 'Rascal + Friends' AND SKU_CLASS = 'Eco Nappies'
) c
WHERE t.PO_NUMBER = c.PO_NUMBER;

-- ---------- 4. The cause: NSW Crawler Nappies short-shipped since 1 May ----------
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
SET DELIVERED_UNITS = ROUND(ORDERED_UNITS * 0.38), IS_IN_FULL = FALSE, IS_DIFOT = FALSE,
    HAS_DISCREPANCY = TRUE, DISCREPANCY_TYPE = 'SHORT_SHIPPED', DISCREPANCY_UNITS = ORDERED_UNITS - ROUND(ORDERED_UNITS * 0.38)
WHERE BRAND_NAME = 'Rascal + Friends' AND SKU_CLASS = 'Crawler Nappies' AND DC_STATE = 'NSW'
  AND STATUS = 'DELIVERED' AND EXPECTED_DELIVERY_DATE >= '2026-05-01';

-- An open NSW Crawler PO would arrive short too: the supplier has confirmed it
-- can ship only part of it, so it cannot be counted on to recover the stores.
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
SET FORECAST_UNITS = ROUND(ORDERED_UNITS * 0.38)
WHERE BRAND_NAME = 'Rascal + Friends' AND SKU_CLASS = 'Crawler Nappies' AND DC_STATE = 'NSW' AND STATUS IN ('ON_ORDER', 'IN_TRANSIT', 'OVERDUE');

-- DIFOT drift for the brand (weekly brand rows, CLASS IS NULL): ~95% to 74.5%.
UPDATE BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
SET DIFOT_PCT = DECODE(FISCAL_WEEK, 14, 91.0, 15, 87.5, 16, 84.0, 17, 80.5, 18, 77.0, 19, 74.5),
    ORDERS_ON_TIME = ROUND(ORDERS_TOTAL * DECODE(FISCAL_WEEK, 14, 91.0, 15, 87.5, 16, 84.0, 17, 80.5, 18, 77.0, 19, 74.5) / 100)
WHERE BRAND_NAME = 'Rascal + Friends' AND CLASS IS NULL AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 14 AND 19;
