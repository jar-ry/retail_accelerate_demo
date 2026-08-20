-- ============================================================
-- Baby Mart Demo - DIFOT realism pass
--
-- The raw generation in 03_forecast_replenishment_supplier_dc.sql produces
-- unrealistically poor supplier performance (combined DIFOT in the 30-50%
-- range) because late-delivery and short-ship probabilities compound.
--
-- Real grocery/retail DIFOT sits ~70-90%, with on-time performance degrading
-- as lead time grows. This pass rewrites the DIFOT component flags so the
-- demo tells the intended story:
--   * domestic short-lead distributors are the strong performers (~88%)
--   * long-lead international distributors are the problem cases (~70%)
--   * DI% (in-full) stays consistently high, so the gap is driven by OT%
--
-- Run AFTER 03_forecast_replenishment_supplier_dc.sql.
-- ============================================================

USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- On-time probability scales with lead time; in-full is uniformly high.
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
SET
  IS_ON_TIME = CASE
    -- Domestic, short lead (e.g. Kimberly-Clark 7d): best performers
    WHEN STD_LEAD_TIME_DAYS <= 7  THEN ABS(HASH(PO_NUMBER || 'ot2')) % 100 < 95
    -- Domestic, medium lead
    WHEN STD_LEAD_TIME_DAYS <= 14 THEN ABS(HASH(PO_NUMBER || 'ot2')) % 100 < 90
    -- International, medium lead
    WHEN STD_LEAD_TIME_DAYS <= 21 THEN ABS(HASH(PO_NUMBER || 'ot2')) % 100 < 82
    -- International, long lead (28-35d): the problem area
    ELSE ABS(HASH(PO_NUMBER || 'ot2')) % 100 < 75
  END,
  IS_IN_FULL = ABS(HASH(PO_NUMBER || 'if2')) % 100 < 92
WHERE STATUS = 'DELIVERED';

-- Actual lead time must agree with the on-time flag.
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
SET ACTUAL_LEAD_TIME_DAYS = CASE
      WHEN IS_ON_TIME THEN STD_LEAD_TIME_DAYS - (ABS(HASH(PO_NUMBER || 'early')) % 2)
      ELSE STD_LEAD_TIME_DAYS + 1 + (ABS(HASH(PO_NUMBER || 'late2')) % 4)
    END
WHERE STATUS = 'DELIVERED';

-- DIFOT is the conjunction of its two components.
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
SET IS_DIFOT = IS_ON_TIME AND IS_IN_FULL
WHERE STATUS = 'DELIVERED';
