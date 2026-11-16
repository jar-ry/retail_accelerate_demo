-- ============================================================
-- Head of Planning — views: MFP, chain, WSSI, range, governance, AI
--
-- The interface holds no business logic worth the name. Rules live here so the
-- SQL and the screen cannot disagree, and every app query reads these views.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ============================================================
-- MFP
-- ============================================================

-- The three MFP identities recomputed from components and compared with the
-- stated values, plus the growth break: Total Growth % is a MANUAL input and does
-- not have to reconcile to what the committed range delivers. Both are shown;
-- neither is silently corrected.
--
-- Growth against a zero prior-year base is NULL (undefined), not -100%. Dollar
-- variances are NULL, not zero, when a side is absent: a department with no
-- product plan has no variance, and 0 would read as "on budget".
--
-- The plan is VERSIONED: an edit or an upload inserts new rows and supersedes
-- the old ones, which are kept. Only the latest current row per measure is read,
-- so a half-finished supersede can never double count.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_IDENTITY
  COMMENT = 'MFP identities recomputed from components, the growth break, ASP vs units, first-margin move, options and sales at risk. Latest current row per measure.'
AS
WITH cur AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_MFP_PRODUCT_PLAN
  WHERE NVL(IS_CURRENT, TRUE)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY PLAN_LEVEL, ENTITY_CODE, MEASURE_CODE ORDER BY LOADED_AT DESC) = 1
), p AS (
  SELECT PLAN_LEVEL, ENTITY_CODE, MIN(ENTITY_NAME) AS ENTITY_NAME, MIN(RBU_CODE) AS RBU_CODE,
         MIN(LFL_STRATEGY) AS LFL_STRATEGY,
         MAX(UPLOAD_ID) AS UPLOAD_ID, MAX(LOADED_AT) AS LOADED_AT,
         MAX(IFF(MEASURE_CODE = 'F26_ACTUAL_SALES_AUD',       MEASURE_VALUE, NULL)) AS F26_ACTUAL,
         MAX(IFF(MEASURE_CODE = 'F26_POS_ACTUAL_AUD',         MEASURE_VALUE, NULL)) AS F26_POS_ACTUAL,
         MAX(IFF(MEASURE_CODE = 'F27_LFL_FORECAST_AUD',       MEASURE_VALUE, NULL)) AS LFL_FORECAST,
         MAX(IFF(MEASURE_CODE = 'LFL_GROWTH_PCT',             MEASURE_VALUE, NULL)) AS LFL_PCT,
         MAX(IFF(MEASURE_CODE = 'TOTAL_GROWTH_PCT_STATED',    MEASURE_VALUE, NULL)) AS GROWTH_STATED,
         MAX(IFF(MEASURE_CODE = 'TPR_BUDGET_AUD',             MEASURE_VALUE, NULL)) AS TPR_BUDGET,
         MAX(IFF(MEASURE_CODE = 'F27_TPR_UNIT_SALES',         MEASURE_VALUE, NULL)) AS TPR_UNITS,
         MAX(IFF(MEASURE_CODE = 'F27_TPR_ASP_AUD',            MEASURE_VALUE, NULL)) AS TPR_ASP,
         MAX(IFF(MEASURE_CODE = 'F27_POS_SALES_AUD',          MEASURE_VALUE, NULL)) AS POS_SALES,
         MAX(IFF(MEASURE_CODE = 'F27_POS_PCT',                MEASURE_VALUE, NULL)) AS POS_PCT,
         MAX(IFF(MEASURE_CODE = 'EXIT_POS_MARGIN_PCT',        MEASURE_VALUE, NULL)) AS EXIT_MARGIN_PCT,
         MAX(IFF(MEASURE_CODE = 'F26_MIX_PCT',                MEASURE_VALUE, NULL)) AS F26_MIX_PCT,
         MAX(IFF(MEASURE_CODE = 'F27_TPR_MIX_PCT',            MEASURE_VALUE, NULL)) AS F27_TPR_MIX_PCT,
         MAX(IFF(MEASURE_CODE = 'F26_FIRST_MARGIN_PCT',       MEASURE_VALUE, NULL)) AS F26_FIRST_MARGIN_PCT,
         MAX(IFF(MEASURE_CODE = 'F27_TPR_FIRST_MARGIN_PCT',   MEASURE_VALUE, NULL)) AS F27_FIRST_MARGIN_PCT,
         MAX(IFF(MEASURE_CODE = 'F26_ASP_AUD',                MEASURE_VALUE, NULL)) AS F26_ASP,
         MAX(IFF(MEASURE_CODE = 'F26_UNIT_SALES',             MEASURE_VALUE, NULL)) AS F26_UNITS,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_PRESENTED',          MEASURE_VALUE, NULL)) AS OPT_PRESENTED,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_NEW',                MEASURE_VALUE, NULL)) AS OPT_NEW,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_ONGOING',            MEASURE_VALUE, NULL)) AS OPT_ONGOING,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_DESELECTED',         MEASURE_VALUE, NULL)) AS OPT_DESELECTED,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_NEW_DESELECTED',     MEASURE_VALUE, NULL)) AS OPT_NEW_DESELECTED,
         MAX(IFF(MEASURE_CODE = 'OPTIONS_ONGOING_DESELECTED', MEASURE_VALUE, NULL)) AS OPT_ONGOING_DESELECTED
  FROM cur
  GROUP BY PLAN_LEVEL, ENTITY_CODE
)
SELECT p.*,
  (SELECT MIN(RBU_DESCRIPTION) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_MERCH_HIERARCHY h WHERE h.RBU_CODE = p.RBU_CODE) AS RBU_DESCRIPTION,
  F26_ACTUAL * (1 + LFL_PCT)                                            AS ID1_LFL_DERIVED,
  ROUND(F26_ACTUAL * (1 + LFL_PCT) - LFL_FORECAST, 2)                   AS ID1_VARIANCE,
  TPR_UNITS * TPR_ASP                                                   AS ID2_TPR_DERIVED,
  ROUND(TPR_UNITS * TPR_ASP - TPR_BUDGET, 2)                            AS ID2_VARIANCE,
  TPR_BUDGET * POS_PCT                                                  AS ID3_POS_DERIVED,
  ROUND(TPR_BUDGET * POS_PCT - POS_SALES, 2)                            AS ID3_VARIANCE,
  IFF(NVL(F26_ACTUAL, 0) = 0, NULL, TPR_BUDGET / F26_ACTUAL - 1)        AS GROWTH_DERIVED,
  IFF(NVL(F26_ACTUAL, 0) = 0, NULL, TPR_BUDGET / F26_ACTUAL - 1 - GROWTH_STATED) AS GROWTH_BREAK_PTS,
  NVL(F26_ACTUAL, 0) = 0                                                AS IS_NEW_ENTITY,
  IFF(NVL(LFL_FORECAST, 0) = 0, NULL, (TPR_BUDGET - LFL_FORECAST) / LFL_FORECAST) AS EXPANSION_PREMIUM_PCT,
  F27_FIRST_MARGIN_PCT - F26_FIRST_MARGIN_PCT                           AS FIRST_MARGIN_MOVE_PTS,
  IFF(NVL(F26_ASP, 0) = 0, NULL, TPR_ASP / F26_ASP - 1)                 AS ASP_GROWTH_PCT,
  IFF(NVL(F26_UNITS, 0) = 0, NULL, TPR_UNITS / F26_UNITS - 1)           AS UNIT_GROWTH_PCT,
  OPT_NEW + OPT_ONGOING                                                 AS OPT_COMMITTED,
  DIV0(OPT_DESELECTED, OPT_PRESENTED)                                   AS DESELECT_PCT,
  DIV0(OPT_NEW, OPT_NEW + OPT_ONGOING)                                  AS NEW_PCT_OF_COMMITTED,
  IFF(TPR_BUDGET IS NULL OR F26_ACTUAL IS NULL, NULL, TPR_BUDGET - F26_ACTUAL)   AS VAR_TO_LY_AUD,
  IFF(TPR_BUDGET IS NULL OR LFL_FORECAST IS NULL, NULL, TPR_BUDGET - LFL_FORECAST) AS VAR_BUD_TO_TPR_AUD,
  IFF(TPR_ASP IS NULL OR F26_ASP IS NULL, NULL, TPR_ASP - F26_ASP)      AS ASP_VAR_LY_AUD,
  -- Dropped options valued at the average COMMITTED option. Whether it should be
  -- the average PRESENTED option instead is an open decision (DESIGN_DECISION 9),
  -- so the formula is stated on screen rather than buried here.
  TPR_BUDGET * DIV0(OPT_DESELECTED, OPT_NEW + OPT_ONGOING)              AS SALES_AT_RISK_AUD
FROM p;

-- The MFP is a HALF-level plan. Phased to month on the store plan's monthly shape
-- so it can be set beside the WSSI. BASIS says it is an allocation: these are not
-- figures anyone supplied, and must not be presented as if they were.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_PHASED
  COMMENT = 'MFP department budget phased from half to month on the store plan shape. An allocation, never a source figure.'
AS
SELECT
  i.ENTITY_CODE AS DEPARTMENT_NUM, i.ENTITY_NAME AS DEPARTMENT_NAME, i.RBU_CODE,
  s.PERIOD_KEY, s.FY_YEAR, s.FY_PERIOD_NO, s.MONTH_NAME, s.SHARE_OF_HALF,
  i.TPR_BUDGET                         AS HALF_BUDGET_AUD,
  i.TPR_BUDGET * s.SHARE_OF_HALF       AS MONTH_BUDGET_AUD,
  i.LFL_FORECAST * s.SHARE_OF_HALF     AS MONTH_LFL_FORECAST_AUD,
  'ALLOCATED_ON_STORE_PLAN_SHAPE'      AS BASIS,
  FALSE                                AS IS_SOURCE_FIGURE
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_IDENTITY i
CROSS JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_MONTH_SHAPE s
WHERE i.PLAN_LEVEL = 'DEPARTMENT';

-- The reconciliation spine the head of planning asked for: does the product plan
-- deliver the budget? Store plan total -> RBU mix -> MFP product plan per RBU ->
-- departments, with the variance at each hop.
--
-- Hop 2 applies the agreed mix to the CURRENT store plan total, not the stored
-- RBU figure, so the hops add up to the live plan. The stored figure and its drift
-- are shown on the MFP page instead.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_PLANNING_CHAIN
  COMMENT = 'Store plan -> RBU mix -> MFP per RBU -> departments, with variance at each hop.'
AS
WITH sp AS (
  SELECT SUM(PLAN_SALES_AUD) AS TOTAL FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY
), rbu AS (
  SELECT t.RBU_CODE, t.RBU_DESCRIPTION, t.PLAN_MIX_PCT_STATED, t.PLAN_MIX_PCT_STATED * sp.TOTAL AS TARGET_AUD
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.RBU_MIX_TARGET t CROSS JOIN sp WHERE t.IS_TRADED
), mfp AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_IDENTITY
)
SELECT 1 AS HOP, 'STORE PLAN' AS STAGE, NULL::VARCHAR AS RBU_CODE, 'Baby Mart total' AS ENTITY,
       sp.TOTAL AS VALUE_AUD, NULL::FLOAT AS PARENT_VALUE_AUD, NULL::FLOAT AS SHARE_OF_PARENT, NULL::FLOAT AS VARIANCE_AUD,
       'The live store plan for FY27 H1 (Jul-Dec 2026). The board-approved figure is on Approve & lock' AS NOTE
FROM sp
UNION ALL
SELECT 2, 'RBU MIX', r.RBU_CODE, r.RBU_CODE || ' ' || r.RBU_DESCRIPTION,
       r.TARGET_AUD, sp.TOTAL, r.PLAN_MIX_PCT_STATED, NULL,
       'Agreed mix applied to the current store plan total'
FROM rbu r CROSS JOIN sp
UNION ALL
SELECT 3, 'MFP PRODUCT PLAN', m.ENTITY_CODE, m.ENTITY_CODE || ' ' || m.ENTITY_NAME,
       m.TPR_BUDGET, r.TARGET_AUD, DIV0(m.TPR_BUDGET, r.TARGET_AUD), m.TPR_BUDGET - r.TARGET_AUD,
       'Bottom-up: range review units x ASP (identity 2), against the RBU''s mix target'
FROM mfp m JOIN rbu r ON r.RBU_CODE = m.ENTITY_CODE
WHERE m.PLAN_LEVEL = 'RBU'
UNION ALL
SELECT 4, 'MFP DEPARTMENT', m.RBU_CODE, m.ENTITY_CODE || ' ' || m.ENTITY_NAME,
       m.TPR_BUDGET, rb.TPR_BUDGET, DIV0(m.TPR_BUDGET, rb.TPR_BUDGET), NULL,
       'Departments sum exactly to their RBU'
FROM mfp m JOIN mfp rb ON rb.PLAN_LEVEL = 'RBU' AND rb.ENTITY_CODE = m.RBU_CODE
WHERE m.PLAN_LEVEL = 'DEPARTMENT';

-- ============================================================
-- Range
-- ============================================================

-- Gate 4: range lost AFTER commitment, measured from real purchase orders. The
-- gap between ordered and delivered units is supplier SHORT-SHIP. Open orders
-- (on order, in transit, overdue) are excluded: an order that has not arrived
-- yet has not been short-shipped, and counting it would overstate loss tenfold.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_SOURCING_ATTRITION
  COMMENT = 'Supplier short-ship on DELIVERED purchase orders: ordered vs delivered units by department, supplier and class.'
AS
SELECT UPPER(r.CATEGORY)                                      AS DEPARTMENT_NAME,
       r.SUPPLIER_NAME, r.SKU_CLASS, r.DC_STATE,
       COUNT(*)                                               AS POS,
       COUNT(DISTINCT r.BRAND_NAME)                           AS BRANDS,
       SUM(r.ORDERED_UNITS)                                   AS ORDERED_UNITS,
       SUM(r.DELIVERED_UNITS)                                 AS DELIVERED_UNITS,
       SUM(GREATEST(r.ORDERED_UNITS - r.DELIVERED_UNITS, 0))  AS UNITS_LOST,
       1 - DIV0(SUM(r.DELIVERED_UNITS), SUM(r.ORDERED_UNITS)) AS ATTRITION_PCT,
       COUNT_IF(r.DELIVERED_UNITS < r.ORDERED_UNITS)          AS SHORT_POS,
       COUNT_IF(r.DELIVERED_UNITS = 0 AND r.ORDERED_UNITS > 0) AS POS_FULLY_LOST,
       AVG(r.ACTUAL_LEAD_TIME_DAYS)                           AS AVG_LEAD_DAYS,
       AVG(r.STD_LEAD_TIME_DAYS)                              AS AVG_STD_LEAD_DAYS
FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC r
WHERE r.STATUS = 'DELIVERED'
GROUP BY UPPER(r.CATEGORY), r.SUPPLIER_NAME, r.SKU_CLASS, r.DC_STATE;

CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_RANGE_FUNNEL
  COMMENT = 'The four-gate range funnel. Gate 1 is unavailable and shown so rather than estimated.'
AS
WITH mfp AS (
  SELECT SUM(OPT_PRESENTED) AS PRESENTED, SUM(OPT_COMMITTED) AS COMMITTED,
         SUM(OPT_DESELECTED) AS DESELECTED, SUM(SALES_AT_RISK_AUD) AS AT_RISK
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_IDENTITY WHERE PLAN_LEVEL = 'DEPARTMENT'
), src AS (
  SELECT SUM(ORDERED_UNITS) AS ORD, SUM(DELIVERED_UNITS) AS DLV, SUM(UNITS_LOST) AS LOST, SUM(POS_FULLY_LOST) AS FULLY
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_SOURCING_ATTRITION
)
SELECT g.GATE_SEQ, g.GATE_CODE, g.GATE_NAME, g.OWNER, g.IS_MEASURABLE_TODAY,
  CASE g.GATE_CODE WHEN 'RANGE_PRESENTED' THEN mfp.PRESENTED WHEN 'RANGE_COMMITTED' THEN mfp.COMMITTED END AS OPTIONS_AT_GATE,
  CASE g.GATE_CODE WHEN 'RANGE_COMMITTED' THEN mfp.DESELECTED END                                         AS OPTIONS_LOST_AT_GATE,
  CASE g.GATE_CODE WHEN 'RANGE_COMMITTED' THEN DIV0(mfp.DESELECTED, mfp.PRESENTED)
                   WHEN 'DELIVERED'       THEN 1 - DIV0(src.DLV, src.ORD) END                            AS LOSS_PCT,
  CASE g.GATE_CODE WHEN 'DELIVERED' THEN src.LOST END                                                    AS UNITS_LOST,
  CASE g.GATE_CODE WHEN 'DELIVERED' THEN src.FULLY END                                                   AS POS_FULLY_LOST,
  CASE g.GATE_CODE WHEN 'RANGE_COMMITTED' THEN mfp.AT_RISK END                                           AS SALES_AT_RISK_AUD,
  g.INDICATIVE_SKU_COUNT,
  IFF(g.IS_MEASURABLE_TODAY, 'MEASURED', 'UNAVAILABLE - source not held')                               AS STATUS,
  g.DATA_SOURCE
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_RANGE_GATE g CROSS JOIN mfp CROSS JOIN src;

-- A department falls below a credible offer when it commits too little of what
-- was presented. Fails CLOSED: a department with no threshold reads NO THRESHOLD
-- SET, never CREDIBLE.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_RANGE_CREDIBILITY
  COMMENT = 'Committed range against the minimum credible offer per department. Thresholds are assumptions.'
AS
SELECT m.ENTITY_CODE AS DEPARTMENT_NUM, m.ENTITY_NAME AS DEPARTMENT_NAME, m.LFL_STRATEGY,
       m.OPT_PRESENTED, m.OPT_COMMITTED, m.OPT_DESELECTED,
       m.OPT_COMMITTED / NULLIF(m.OPT_PRESENTED, 0) AS ADOPTION_PCT,
       r.MIN_CREDIBLE_ADOPTION_PCT,
       CASE
         WHEN NVL(m.OPT_PRESENTED, 0) = 0                  THEN 'NO RANGE'
         WHEN m.LFL_STRATEGY = 'D'                         THEN 'ON STRATEGY (planned decline)'
         WHEN r.MIN_CREDIBLE_ADOPTION_PCT IS NULL          THEN 'NO THRESHOLD SET'
         WHEN m.OPT_COMMITTED / NULLIF(m.OPT_PRESENTED, 0) < r.MIN_CREDIBLE_ADOPTION_PCT THEN 'BELOW CREDIBLE OFFER'
         ELSE 'CREDIBLE'
       END AS CREDIBILITY_STATUS,
       m.SALES_AT_RISK_AUD, m.NEW_PCT_OF_COMMITTED,
       r.IS_ASSUMPTION AS THRESHOLD_IS_ASSUMPTION, r.RATIONALE AS THRESHOLD_RATIONALE
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_IDENTITY m
LEFT JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.RANGE_CREDIBILITY_RULE r ON r.DEPARTMENT_NUM = m.ENTITY_CODE
WHERE m.PLAN_LEVEL = 'DEPARTMENT';

-- ============================================================
-- Governance
-- ============================================================

-- The live plan against the immutable approved baseline. LEFT-joined and pinned to
-- the latest APPROVED snapshot, so a store-week added after the lock reads NOT IN
-- BASELINE instead of vanishing, and a second approval cannot double the rows.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_VARIANCE_TO_APPROVED
  COMMENT = 'Live store plan against the latest approved snapshot, store x week.'
AS
WITH latest AS (
  SELECT MAX(APPROVAL_ID) AS APPROVAL_ID FROM BABY_MART_DEMO.HEAD_OF_PLANNING.PLAN_APPROVAL
  WHERE PLAN_KIND = 'STORE_PLAN' AND STATE = 'APPROVED'
), ap AS (
  SELECT s.APPROVAL_ID, s.STORE_CODE, s.WEEK_END_DATE,
         MAX(IFF(s.MEASURE_CODE = 'PLAN_SALES_AUD',  s.MEASURE_VALUE, NULL)) AS APPROVED_SALES_AUD,
         MAX(IFF(s.MEASURE_CODE = 'PLAN_MARGIN_AUD', s.MEASURE_VALUE, NULL)) AS APPROVED_MARGIN_AUD,
         MAX(IFF(s.MEASURE_CODE = 'LFL_PCT',         s.MEASURE_VALUE, NULL)) AS APPROVED_LFL_PCT
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.PLAN_APPROVAL_SNAPSHOT s JOIN latest l ON l.APPROVAL_ID = s.APPROVAL_ID
  GROUP BY s.APPROVAL_ID, s.STORE_CODE, s.WEEK_END_DATE
)
SELECT a.APPROVAL_ID, c.STORE_CODE, c.STORE_NAME, c.FY_YEAR, c.MONTH_NAME, c.FY_PERIOD_NO, c.WEEK_END_DATE,
       IFF(a.APPROVAL_ID IS NULL, 'NOT IN BASELINE', 'APPROVED') AS BASELINE_STATUS,
       a.APPROVED_SALES_AUD, c.PLAN_SALES_AUD AS CURRENT_SALES_AUD,
       c.PLAN_SALES_AUD - a.APPROVED_SALES_AUD AS SALES_VARIANCE_AUD,
       a.APPROVED_MARGIN_AUD, c.PLAN_MARGIN_AUD AS CURRENT_MARGIN_AUD,
       c.PLAN_MARGIN_AUD - a.APPROVED_MARGIN_AUD AS MARGIN_VARIANCE_AUD,
       a.APPROVED_LFL_PCT, c.LFL_PCT AS CURRENT_LFL_PCT, c.LFL_PCT - a.APPROVED_LFL_PCT AS LFL_VARIANCE_PTS
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY c
LEFT JOIN ap a ON a.STORE_CODE = c.STORE_CODE AND a.WEEK_END_DATE = c.WEEK_END_DATE;

-- Edits failing the rationale rule. Fails CLOSED: a reason code not in
-- PLAN_REASON_CODE reads UNKNOWN REASON CODE rather than certified compliant.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_OVERRIDE_COMPLIANCE
  COMMENT = 'Every plan edit with its compliance against the rationale and escalation rules.'
AS
SELECT o.OVERRIDE_ID, o.MARKET_CODE, o.PLAN_KIND, o.ENTITY_CODE, o.FY_YEAR, o.MONTH_NAME, o.MEASURE_CODE,
       o.OLD_VALUE, o.NEW_VALUE, o.REASON_CODE, o.RATIONALE, o.CHANGED_BY, o.CHANGED_AT, o.APPROVAL_ID,
       o.SURFACE, o.EDIT_CLASS, o.OWNING_PARTY, o.ON_BEHALF_OF, o.IS_POST_LOCK_AMENDMENT, o.ESCALATION_NOTE,
       r.REQUIRES_NARRATIVE,
       CASE
         WHEN o.REASON_CODE IS NULL OR o.REASON_CODE = 'NOT_SUPPLIED'            THEN 'NO REASON CODE'
         WHEN r.REASON_CODE IS NULL                                              THEN 'UNKNOWN REASON CODE'
         WHEN r.REQUIRES_NARRATIVE AND NVL(TRIM(o.RATIONALE), '') = ''           THEN 'REASON CODE WITHOUT NARRATIVE'
         WHEN o.IS_POST_LOCK_AMENDMENT AND NVL(TRIM(o.ESCALATION_NOTE), '') = '' THEN 'POST-LOCK AMENDMENT WITHOUT ESCALATION'
         ELSE 'COMPLIANT'
       END AS COMPLIANCE_STATUS
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.PLAN_CELL_OVERRIDE o
LEFT JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.PLAN_REASON_CODE r ON r.REASON_CODE = o.REASON_CODE;

-- The registry with its UI affordance resolved. The app reads EDITABLE_IN_APP and
-- CELL_TREATMENT and never re-derives them. Dense grids show a binary
-- editable / locked treatment; the five classes appear in full on the Ownership page.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MEASURE_OWNERSHIP
  COMMENT = 'Measure ownership with the cell treatment and hover hint resolved.'
AS
SELECT SURFACE, MEASURE_CODE, MEASURE_LABEL, EDIT_CLASS, OWNING_PARTY, EDITABLE_IN_APP, LOCK_BEHAVIOUR,
       REQUIRES_RATIONALE, IS_INFERRED, EVIDENCE, CONFIRMED_BY, CONFIRMED_AT,
       IFF(EDITABLE_IN_APP, 'EDITABLE', 'LOCKED') AS CELL_TREATMENT,
       CASE EDIT_CLASS
         WHEN 'INGESTED'   THEN 'Actuals or history: fed in from source, not editable.'
         WHEN 'CALCULATED' THEN 'Calculated: change the inputs, not the result.'
         WHEN 'JOINT'      THEN 'Agreed between Planning and Buying at range review: editable, say why.'
         WHEN 'PLANNING'   THEN 'Planning''s number: editable, say why.'
         WHEN 'BUYING'     THEN 'Buying''s number: you are keying it on their behalf.'
         ELSE 'No owner agreed yet: not editable until one is.'
       END AS OWNERSHIP_HINT
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.MEASURE_OWNERSHIP;

-- ============================================================
-- AI
-- ============================================================

-- The most recent insight per surface, verified or not. Unverified insights are
-- included on purpose: hiding them would be a silent failure.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_INSIGHT_LATEST
  COMMENT = 'Most recent successful insight per surface, verified or not.'
AS
SELECT r.*
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.INSIGHT_RUN r
WHERE r.RUN_ID = (SELECT MAX(r2.RUN_ID) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.INSIGHT_RUN r2
                  WHERE r2.SURFACE = r.SURFACE AND r2.ERROR_MESSAGE IS NULL);
