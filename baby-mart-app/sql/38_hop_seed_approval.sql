-- ============================================================
-- Head of Planning — the approved baseline and what happened after it
--
-- The FY27 H1 store plan was approved at the 27 May board. This seeds that
-- approval as it would have happened, then the edits made after the lock:
--   S048 Sunshine Coast OCT LFL   JOINT, amended with an escalation note: COMPLIANT
--   S020 Gold Coast NOV margin    PLANNING, which stays open after the lock: COMPLIANT
--   S009 Sydney CBD DEC LFL       JOINT, loaded from a spreadsheet with no escalation:
--                                 the compliance view must catch it, because a lock
--                                 that exists only in the interface is a suggestion
-- plus an amendment to the approval narrative and three WSSI planner inputs.
--
-- Runs after 30-37. Guarded: if an approval already exists it does nothing, because
-- re-applying post-lock edits would compound them. Re-run 30 and 35 to reset.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

EXECUTE IMMEDIATE $$
DECLARE
  n         NUMBER;
  appr      NUMBER;
  b_depth   VARCHAR DEFAULT UUID_STRING();
  b_shrink  VARCHAR DEFAULT UUID_STRING();
  b_spend   VARCHAR DEFAULT UUID_STRING();
  nov_sales FLOAT;
  nov_old   FLOAT;
BEGIN
  n := (SELECT COUNT(*) FROM PLAN_APPROVAL);
  IF (n > 0) THEN
    RETURN 'Skipped: an approval is already seeded. Re-run 30 and 35 to reset first.';
  END IF;

  -- ---------- 1. Approve at the board ----------
  -- The narrative is built from the figures, so it cannot disagree with them.
  INSERT INTO PLAN_APPROVAL
    (MARKET_CODE, PLAN_KIND, SCOPE, FY_YEAR, FY_HALF, STATE, SUBMITTED_BY, SUBMITTED_AT,
     APPROVED_BY, APPROVED_AT, BOARD_MEETING_DATE, NARRATIVE, TOTAL_SALES_AUD, TOTAL_MARGIN_AUD)
  WITH s AS (
    SELECT SUM(TOTAL_SALES_AUD) AS SALES, SUM(TOTAL_MARGIN_AUD) AS MARGIN, SUM(LY_SALES_AUD) AS LY,
           SUM(LFL_SALES_AUD) AS LFL, SUM(LY_SALES_LFL_AUD) AS LY_LFL, SUM(NEW_STORE_SALES_AUD) AS NEW_SALES
    FROM VW_STORE_PLAN_SUMMARY
  ), ns AS (
    SELECT LISTAGG(REPLACE(STORE_NAME, 'Baby Mart ', ''), ', ') WITHIN GROUP (ORDER BY STORE_CODE) AS NAMES,
           COUNT(*) AS N
    FROM DIM_STORE WHERE IS_NEW_STORE
  ), prams AS (
    SELECT GROWTH_STATED, GROWTH_DERIVED FROM VW_MFP_IDENTITY
    WHERE PLAN_LEVEL = 'DEPARTMENT' AND ENTITY_CODE = '050'
  ), comp AS (
    SELECT COUNT(*) AS N FROM DIM_STORE WHERE NOT IS_NEW_STORE
  )
  SELECT 'AU', 'STORE_PLAN', 'All stores', 2027, 'H1', 'APPROVED',
         'Planning Manager', '2026-05-25 17:10:00'::TIMESTAMP_NTZ,
         'Head of Planning', '2026-05-27 16:30:00'::TIMESTAMP_NTZ, '2026-05-27'::DATE,
         'FY27 H1 (Jul-Dec 2026) store plan approved at the 27 May board: $'
           || ROUND(s.SALES / 1e6, 2)::NUMBER(10,2)::VARCHAR || 'M sales, '
           || IFF(s.SALES >= s.LY, '+', '') || ROUND(100 * (s.SALES / s.LY - 1), 1)::NUMBER(10,1)::VARCHAR
           || '% on FY26 H1. Like-for-like ' || IFF(s.LFL >= s.LY_LFL, '+', '')
           || ROUND(100 * (s.LFL / s.LY_LFL - 1), 1)::NUMBER(10,1)::VARCHAR || '% across ' || comp.N::VARCHAR
           || ' comparable stores; ' || ns.N::VARCHAR || ' openings (' || ns.NAMES || ') add $'
           || ROUND(s.NEW_SALES / 1e6, 2)::NUMBER(10,2)::VARCHAR || 'M. Margin '
           || ROUND(100 * s.MARGIN / s.SALES, 1)::NUMBER(10,1)::VARCHAR
           || '%. Condition of approval: Buying to bring back a Prams & Strollers range that supports the '
           || ROUND(100 * prams.GROWTH_STATED, 1)::NUMBER(10,1)::VARCHAR
           || '% growth stated at range review. The committed buy delivers '
           || ROUND(100 * prams.GROWTH_DERIVED, 1)::NUMBER(10,1)::VARCHAR || '%.',
         ROUND(s.SALES, 2), ROUND(s.MARGIN, 2)
  FROM s, ns, prams, comp;

  appr := (SELECT MAX(APPROVAL_ID) FROM PLAN_APPROVAL);

  -- ---------- 2. The immutable snapshot ----------
  INSERT INTO PLAN_APPROVAL_SNAPSHOT
    (APPROVAL_ID, SNAPSHOT_AT, MARKET_CODE, STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME, MEASURE_CODE, MEASURE_VALUE)
  SELECT :appr, '2026-05-27 16:30:00'::TIMESTAMP_NTZ, 'AU', STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME,
         MEASURE_CODE, MEASURE_VALUE
  FROM (
    SELECT STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME,
           PLAN_SALES_AUD::FLOAT AS PLAN_SALES_AUD, PLAN_MARGIN_AUD::FLOAT AS PLAN_MARGIN_AUD,
           LFL_PCT::FLOAT AS LFL_PCT, MARGIN_PCT::FLOAT AS MARGIN_PCT
    FROM VW_STORE_PLAN_WEEKLY
  ) UNPIVOT (MEASURE_VALUE FOR MEASURE_CODE IN (PLAN_SALES_AUD, PLAN_MARGIN_AUD, LFL_PCT, MARGIN_PCT));

  -- ---------- 3. Edits after the lock ----------
  INSERT INTO PLAN_CELL_OVERRIDE
    (MARKET_CODE, PLAN_KIND, ENTITY_CODE, FY_YEAR, MONTH_NAME, MEASURE_CODE, OLD_VALUE, NEW_VALUE,
     REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, APPROVAL_ID, SURFACE, EDIT_CLASS, OWNING_PARTY,
     ON_BEHALF_OF, IS_POST_LOCK_AMENDMENT, ESCALATION_NOTE)
  SELECT 'AU', 'STORE_PLAN', e.STORE_CODE, d.FY_YEAR, e.MONTH_NAME, e.MEASURE_CODE,
         IFF(e.MEASURE_CODE = 'LFL_PCT', d.LFL_PCT, d.MARGIN_PCT),
         ROUND(IFF(e.MEASURE_CODE = 'LFL_PCT', d.LFL_PCT, d.MARGIN_PCT) + e.DELTA, 4),
         e.REASON_CODE, e.RATIONALE, e.CHANGED_BY, e.CHANGED_AT::TIMESTAMP_NTZ, :appr, e.SURFACE,
         e.EDIT_CLASS, e.OWNING_PARTY, NULL, e.IS_POST_LOCK, NULLIF(e.ESCALATION, '')
  FROM (SELECT * FROM VALUES
    ('S048', 'OCT', 'LFL_PCT', 0.015, 'RANGE_REVIEW_AGREED',
     'Bugaboo confirmed a launch allocation 1.5x the original buy for the October pram event at Sunshine Coast. Agreed with Buying on 3 June.',
     'Head of Planning', '2026-06-03 10:15:00', 'STORE_PLAN', 'JOINT', 'BOTH', TRUE,
     'The allocation was confirmed after the board met. Holding it to the next cycle would leave the October launch under-planned.'),
    ('S020', 'NOV', 'MARGIN_PCT', -0.010, 'CLEARANCE_PUSH',
     'Car seat run-out brought forward a month: the new range lands in December, so clearance at the regional hub starts in November.',
     'Planning Manager', '2026-06-04 14:40:00', 'STORE_PLAN', 'PLANNING', 'PLANNING', FALSE, ''),
    ('S009', 'DEC', 'LFL_PCT', 0.010, 'CENTRE_EVENT',
     'Centre confirmed 10pm trading runs to 24 December.',
     'spreadsheet-import', '2026-06-05 09:05:00', 'IMPORT', 'JOINT', 'BOTH', TRUE, '')
    AS v(STORE_CODE, MONTH_NAME, MEASURE_CODE, DELTA, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT,
         SURFACE, EDIT_CLASS, OWNING_PARTY, IS_POST_LOCK, ESCALATION)) e
  JOIN STORE_PLAN_DRIVER d ON d.STORE_CODE = e.STORE_CODE AND d.MONTH_NAME = e.MONTH_NAME AND d.FY_YEAR = 2027;

  UPDATE STORE_PLAN_DRIVER d
     SET LFL_PCT = o.NEW_VALUE, LFL_CHANGED_AT = o.CHANGED_AT, RATIONALE = o.RATIONALE, REASON_CODE = o.REASON_CODE
    FROM PLAN_CELL_OVERRIDE o
   WHERE o.APPROVAL_ID = :appr AND o.PLAN_KIND = 'STORE_PLAN' AND o.MEASURE_CODE = 'LFL_PCT'
     AND d.STORE_CODE = o.ENTITY_CODE AND d.MONTH_NAME = o.MONTH_NAME AND d.FY_YEAR = o.FY_YEAR;

  UPDATE STORE_PLAN_DRIVER d
     SET MARGIN_PCT = o.NEW_VALUE, MARGIN_CHANGED_AT = o.CHANGED_AT, RATIONALE = o.RATIONALE, REASON_CODE = o.REASON_CODE
    FROM PLAN_CELL_OVERRIDE o
   WHERE o.APPROVAL_ID = :appr AND o.PLAN_KIND = 'STORE_PLAN' AND o.MEASURE_CODE = 'MARGIN_PCT'
     AND d.STORE_CODE = o.ENTITY_CODE AND d.MONTH_NAME = o.MONTH_NAME AND d.FY_YEAR = o.FY_YEAR;

  -- ---------- 4. A correction to the narrative, appended, never edited ----------
  INSERT INTO PLAN_APPROVAL_AMENDMENT
    (APPROVAL_ID, PRIOR_NARRATIVE, AMENDMENT_NOTE, AMENDED_BY, AMENDED_AT, CHANGED_FIGURES)
  SELECT APPROVAL_ID, NARRATIVE,
         'Correction: Ripley has no confirmed opening date. The plan assumes it trades from October, as approved. The figures are unchanged.',
         'Head of Planning', '2026-06-02 08:45:00'::TIMESTAMP_NTZ, FALSE
  FROM PLAN_APPROVAL WHERE APPROVAL_ID = :appr;

  -- ---------- 5. WSSI planner inputs ----------
  -- Stored per week in the default's own form: a rate as a rate, an amount as a
  -- factor on its basis, so the month adds back to exactly what was typed.

  -- Black Friday falls in fiscal December (week ending 29 Nov). Hardgoods only.
  INSERT INTO WSSI_PLANNED_INPUT
    (BATCH_ID, MARKET_CODE, RBU_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE_FORM, OLD_VALUE, NEW_VALUE,
     TYPED_GRAIN, TYPED_PERIOD_KEY, TYPED_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
  SELECT :b_depth, 'AU', '200', '2026-11-29'::DATE, 'MD_DEPTH_PCT', 'RATE', m.FACTOR, 0.30,
         'WEEK', 'W:20261129', 0.30, 'PEAK_TRADING',
         'Black Friday: 30% off the outgoing pram and car seat ranges, against 20% on a normal clearance line.',
         'Planning Manager', '2026-06-08 11:20:00'::TIMESTAMP_NTZ
  FROM MISSING_WSSI_MEASURES m WHERE m.MEASURE_CODE = 'MD_DEPTH_PCT';

  -- Christmas shrink, every RBU, all five weeks of fiscal December.
  INSERT INTO WSSI_PLANNED_INPUT
    (BATCH_ID, MARKET_CODE, RBU_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE_FORM, OLD_VALUE, NEW_VALUE,
     TYPED_GRAIN, TYPED_PERIOD_KEY, TYPED_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
  SELECT :b_shrink, 'AU', NULL, c.WEEK_END_DATE, 'SHRINK_PCT', 'RATE', m.FACTOR, 0.0025,
         'MONTH', 'M:FY27P06', 0.0025, 'PEAK_TRADING',
         'Peak trading: casual staff and crowded stores. Shrink planned at 0.25% of stock a week through December, against 0.15% normally.',
         'Head of Planning', '2026-06-08 11:35:00'::TIMESTAMP_NTZ
  FROM DIM_CALENDAR_WEEK c CROSS JOIN MISSING_WSSI_MEASURES m
  WHERE c.PERIOD_KEY = 'FY27P06' AND m.MEASURE_CODE = 'SHRINK_PCT';

  -- A supplier-funded multi-buy in November, typed as a dollar amount for Consumables.
  nov_sales := (SELECT SUM(e.SLS_AUD) FROM VW_WSSI_EXTENDED e
                JOIN DIM_CALENDAR_WEEK c ON c.WEEK_END_DATE = e.WEEK_END_DATE
                WHERE e.VERSION = 'LE' AND e.ACCEPTS_PLANNER_INPUT AND e.RBU_CODE = '100' AND c.PERIOD_KEY = 'FY27P05');
  nov_old   := (SELECT SUM(e.MD_SPEND_AUD) FROM VW_WSSI_EXTENDED e
                JOIN DIM_CALENDAR_WEEK c ON c.WEEK_END_DATE = e.WEEK_END_DATE
                WHERE e.VERSION = 'LE' AND e.ACCEPTS_PLANNER_INPUT AND e.RBU_CODE = '100' AND c.PERIOD_KEY = 'FY27P05');
  INSERT INTO WSSI_PLANNED_INPUT
    (BATCH_ID, MARKET_CODE, RBU_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE_FORM, OLD_VALUE, NEW_VALUE,
     TYPED_GRAIN, TYPED_PERIOD_KEY, TYPED_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
  SELECT :b_spend, 'AU', '100', c.WEEK_END_DATE, 'MD_SPEND_AUD', 'FACTOR', :nov_old, 65000 / :nov_sales,
         'MONTH', 'M:FY27P05', 65000, 'RANGE_REVIEW_AGREED',
         'Agreed with Buying at range review: a supplier-funded nappy and wipes multi-buy runs the first three weeks of November.',
         'Planning Manager', '2026-06-09 15:05:00'::TIMESTAMP_NTZ
  FROM DIM_CALENDAR_WEEK c WHERE c.PERIOD_KEY = 'FY27P05';

  -- Every planner input is also in the plan audit trail, at the grain it was typed.
  INSERT INTO PLAN_CELL_OVERRIDE
    (MARKET_CODE, PLAN_KIND, ENTITY_CODE, FY_YEAR, MONTH_NAME, MEASURE_CODE, OLD_VALUE, NEW_VALUE,
     REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, APPROVAL_ID, SURFACE, EDIT_CLASS, OWNING_PARTY,
     ON_BEHALF_OF, IS_POST_LOCK_AMENDMENT, ESCALATION_NOTE)
  SELECT 'AU', 'WSSI_INPUT', NVL(i.RBU_CODE, 'ALL'), 2027, i.TYPED_PERIOD_KEY, o.MEASURE_CODE,
         MIN(i.OLD_VALUE), MIN(i.TYPED_VALUE), MIN(i.REASON_CODE), MIN(i.RATIONALE), MIN(i.CHANGED_BY),
         MIN(i.CHANGED_AT), :appr, 'WSSI', o.EDIT_CLASS, o.OWNING_PARTY, NULL, FALSE, NULL
  FROM WSSI_PLANNED_INPUT i
  JOIN WSSI_ROW_MEASURE_MAP r ON r.MEASURE_CODE = i.MEASURE_CODE AND r.ROW_KIND = 'PLANNED'
  JOIN MEASURE_OWNERSHIP o ON o.SURFACE = 'WSSI'
   AND o.MEASURE_CODE = 'WSSI:' || LPAD(r.DISPLAY_ORDER, 3, '0') || ':' || r.ROW_LABEL
  GROUP BY i.BATCH_ID, i.RBU_CODE, i.TYPED_PERIOD_KEY, o.MEASURE_CODE, o.EDIT_CLASS, o.OWNING_PARTY;

  RETURN 'Seeded approval ' || appr::VARCHAR;
END;
$$;
