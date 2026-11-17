-- ============================================================
-- Category Manager — class-level supplier DIFOT for Huggies (snapshot)
--
-- DT_SUPPLIER_DIFOT holds one row per brand per week (CLASS IS NULL). On the
-- canonical account it also carries FY2026 class-level rows for Huggies, added
-- interactively and never scripted: Crawler Nappies deliveries collapse in
-- weeks 15-18 (84% -> 72% -> 61% -> 54%) while the other Huggies classes hold
-- ~93%. The brand investigator (sql/26) and the widened semantic view (sql/27)
-- read them. Snapshotted here so every account has the same story.
--
-- Idempotent: adds the column if it is missing and inserts only rows that are
-- not already there.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

ALTER TABLE BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT ADD COLUMN IF NOT EXISTS CLASS VARCHAR(100);

INSERT INTO BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT (BRAND_NAME, CATEGORY, CLASS, FISCAL_YEAR, FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME)
SELECT v.* FROM (VALUES
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 1, 98.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 2, 96.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 3, 93.0, 38, 37),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 4, 96.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 5, 92.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 6, 91.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 7, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 8, 93.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 9, 88.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 10, 92.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 11, 98.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 12, 93.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 13, 97.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 14, 92.0, 42, 23),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 15, 84.0, 38, 21),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 16, 72.0, 42, 18),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 17, 61.0, 38, 15),
  ('Huggies', 'Nappies & Wipes', 'Crawler Nappies', 2026, 18, 54.0, 42, 13),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 1, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 2, 96.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 3, 93.0, 38, 37),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 4, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 5, 93.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 6, 95.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 7, 97.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 8, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 9, 88.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 10, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 11, 93.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 12, 91.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 13, 97.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 14, 88.5, 42, 34),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 15, 87.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 16, 97.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 17, 93.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Newborn Nappies', 2026, 18, 91.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 1, 92.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 2, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 3, 92.0, 38, 37),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 4, 98.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 5, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 6, 93.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 7, 94.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 8, 93.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 9, 90.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 10, 98.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 11, 92.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 12, 92.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 13, 94.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 14, 88.5, 42, 34),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 15, 87.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 16, 97.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 17, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Pull-Ups', 2026, 18, 93.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 1, 92.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 2, 96.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 3, 93.0, 38, 37),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 4, 96.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 5, 93.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 6, 93.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 7, 94.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 8, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 9, 88.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 10, 93.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 11, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 12, 91.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 13, 94.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 14, 88.5, 42, 34),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 15, 86.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 16, 98.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 17, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Toddler Nappies', 2026, 18, 91.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 1, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 2, 97.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 3, 93.0, 38, 37),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 4, 97.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 5, 97.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 6, 95.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 7, 93.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 8, 92.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 9, 89.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 10, 93.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 11, 95.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 12, 95.0, 42, 37),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 13, 98.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 14, 90.5, 42, 34),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 15, 89.5, 38, 34),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 16, 95.0, 42, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 17, 94.0, 38, 39),
  ('Huggies', 'Nappies & Wipes', 'Wipes', 2026, 18, 93.0, 42, 37)
) AS v (BRAND_NAME, CATEGORY, CLASS, FISCAL_YEAR, FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME)
WHERE NOT EXISTS (SELECT 1 FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT d
  WHERE d.BRAND_NAME = v.BRAND_NAME AND d.CLASS = v.CLASS AND d.FISCAL_YEAR = v.FISCAL_YEAR AND d.FISCAL_WEEK = v.FISCAL_WEEK);
