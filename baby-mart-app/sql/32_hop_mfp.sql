-- ============================================================
-- Head of Planning — MFP product plan, RBU mix and range inputs
--
-- The MFP is the bridge between the store plan (top-down: how much the business
-- will sell) and the range (bottom-up: what Buying has actually committed to sell).
-- The one question it answers: does the product plan deliver the budget?
--
-- LAST YEAR IS REAL. FY26 H1 (Jul-Dec 2025) by department from POS: sales, units,
-- ASP, exit margin (what the till realised after discount) and FIRST margin (struck
-- at full retail on intake, before any discount). The two margins are different
-- measures -- first margin is the plan's, exit margin belongs to the WSSI -- and
-- are reported separately, never conflated.
--
-- THE PLAN IS GENERATED, but the three MFP identities hold by construction:
--   ID1  LY x (1 + LFL %)      = top-down budget     (F27_LFL_FORECAST)
--   ID2  units x ASP           = bottom-up budget    (TPR_BUDGET)
--   ID3  bottom-up x POS %     = POS gross profit    (F27_POS_SALES)
-- and departments sum exactly to their RBU. VW_MFP_IDENTITY recomputes all three
-- from components, so a figure that does not tie is visible, not assumed.
--
-- MEASURE CODES keep the reference model's F26 / F27 names on purpose: Baby Mart's
-- fiscal year runs July to June, so FY26 H1 is last year and FY27 H1 is the plan --
-- the labels mean exactly what they say. Only the currency suffix changes.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ---------- 1. The product plan, long format ----------
-- One row per entity (RBU or department) x measure. PLAN_LEVEL is PRE-ROLLED:
-- an RBU row already contains its departments, so filter to one level or figures
-- double count.
--
-- UPLOAD_ID / IS_CURRENT: a re-load SUPERSEDES rows rather than deleting them, so
-- every plan that ever entered the model is still here. NULL UPLOAD_ID is the
-- original load; every consumer filters on IS_CURRENT.
CREATE OR REPLACE TABLE FACT_MFP_PRODUCT_PLAN (
  MARKET_CODE     VARCHAR,
  PLAN_LEVEL      VARCHAR COMMENT 'RBU | DEPARTMENT. Pre-rolled: never sum across levels.',
  RBU_CODE        VARCHAR,
  ENTITY_CODE     VARCHAR,
  ENTITY_NAME     VARCHAR,
  LFL_STRATEGY    VARCHAR,
  FY_YEAR         NUMBER(4,0),
  FY_HALF         VARCHAR,
  SOURCE_COLUMN   VARCHAR COMMENT 'The workbook column this measure is pasted from (A-Z). The upload maps by it.',
  MEASURE_CODE    VARCHAR,
  MEASURE_VALUE   FLOAT,
  PROVENANCE      VARCHAR COMMENT 'DATA = from POS | BUYING | PLANNING | JOINT | CALC',
  NOTE            VARCHAR,
  UPLOAD_ID       NUMBER COMMENT 'The upload that produced this row. NULL = the original load.',
  IS_CURRENT      BOOLEAN COMMENT 'FALSE once a later upload supersedes this entity x measure.',
  LOADED_AT       TIMESTAMP_NTZ
) COMMENT = 'MFP product plan for FY27 H1, long format, RBU and department. Last year is real POS; the plan is generated with all three identities holding.';

INSERT INTO FACT_MFP_PRODUCT_PLAN
WITH ly AS (
  -- REAL. FY26 H1 by department.
  SELECT h.DEPARTMENT_NUM, MIN(h.DEPARTMENT_NAME_BARE) AS DEPT, MIN(h.RBU_CODE) AS RBU_CODE,
         SUM(tl.NET_REVENUE)                                              AS SALES,
         SUM(tl.QUANTITY)                                                 AS UNITS,
         SUM(tl.MARGIN_AMOUNT)                                            AS POS_GP,
         SUM(tl.QUANTITY * (p.UNIT_RETAIL - p.UNIT_COST))
           / NULLIF(SUM(tl.QUANTITY * p.UNIT_RETAIL), 0)                  AS FIRST_MARGIN
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  JOIN (SELECT DISTINCT DEPARTMENT_NUM, DEPARTMENT_NAME_BARE, RBU_CODE FROM DIM_MERCH_HIERARCHY) h
    ON h.DEPARTMENT_NAME_BARE = UPPER(p.CATEGORY)
  WHERE d.CALENDAR_DATE BETWEEN (SELECT DATEADD(day, -6, MIN(LY_WEEK_END_DATE)) FROM STORE_PLAN_WEEK_SLOT)
                            AND (SELECT MAX(LY_WEEK_END_DATE) FROM STORE_PLAN_WEEK_SLOT)
  GROUP BY h.DEPARTMENT_NUM
), story AS (
  -- THE STORYLINE, set declaratively so every surface tells the same story:
  --   PRAMS & STROLLERS  states +8.0% growth but the committed range delivers +0.5%:
  --                      ASP up 4.7%, units down 4%. A 7.5-point growth break, the
  --                      largest in the plan, and the bottom-up falls short of even
  --                      the like-for-like top-down.
  --   CLOTHING           plans a 10.6-point first-margin step-up (direct-sourced
  --                      private label). The single largest assumption in the plan.
  --   NAPPIES & WIPES,   the bottom-up range exceeds the top-down: repeat-purchase
  --   FEEDING            consumables, deliberately grown in the mix.
  --   CAR SEATS          close to plan.
  -- Stated growth is like-for-like plus the ~4 points new stores add to every department.
  SELECT * FROM VALUES
    --  dept   LFL    stated  derived  units   first-margin move  POS move
    ('010', 0.080, 0.120, 0.180,  0.150,  0.002, 0.003),
    ('020', 0.060, 0.100, 0.135,  0.100,  0.005, 0.004),
    ('030', 0.050, 0.090, 0.080,  0.040,  0.106, 0.080),
    ('040', 0.035, 0.075, 0.060,  0.025,  0.003, 0.003),
    ('050', 0.040, 0.080, 0.005, -0.040,  0.004, 0.003)
  AS t(DEPARTMENT_NUM, LFL, STATED, DERIVED, UNIT_G, FM_MOVE, POS_MOVE)
), opt AS (
  -- Option counts from the range review, ANALYTICS.DIM_PLAN_OPTION. The source does
  -- not say whether a deselected option was new or ongoing, so that split is
  -- assigned by a seeded hash (40% new) and flagged in the NOTE.
  SELECT DEPARTMENT_CODE AS DEPARTMENT_NUM,
         COUNT(*)                                                         AS PRESENTED,
         SUM(IFF(OPTION_STATUS = 'NEW', 1, 0))                            AS NEW,
         SUM(IFF(OPTION_STATUS = 'ONGOING', 1, 0))                        AS ONGOING,
         SUM(IFF(OPTION_STATUS = 'DESELECTED', 1, 0))                     AS DESELECTED,
         SUM(IFF(OPTION_STATUS = 'DESELECTED' AND ABS(HASH(OPTION_CODE, 'dsel')) % 10 < 4, 1, 0)) AS NEW_DESELECTED
  FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION
  GROUP BY DEPARTMENT_CODE
), dept AS (
  SELECT l.DEPARTMENT_NUM, l.DEPT, l.RBU_CODE,
         l.SALES                                                         AS F26_ACTUAL,
         l.UNITS                                                         AS F26_UNITS,
         l.SALES::FLOAT / NULLIF(l.UNITS, 0)                             AS F26_ASP,
         l.POS_GP                                                        AS F26_POS,
         l.POS_GP / NULLIF(l.SALES, 0)                                   AS EXIT_MARGIN,
         l.FIRST_MARGIN                                                  AS F26_FM,
         l.SALES / SUM(l.SALES) OVER ()                                  AS F26_MIX,
         s.LFL, s.STATED, s.FM_MOVE, s.POS_MOVE,
         l.SALES * (1 + s.LFL)                                           AS LFL_FORECAST,
         ROUND(l.SALES * (1 + s.DERIVED), 0)                             AS TPR_BUDGET,
         ROUND(l.UNITS * (1 + s.UNIT_G), 0)                              AS TPR_UNITS,
         o.PRESENTED, o.NEW, o.ONGOING, o.DESELECTED, o.NEW_DESELECTED
  FROM ly l
  JOIN story s ON s.DEPARTMENT_NUM = l.DEPARTMENT_NUM
  JOIN opt o   ON o.DEPARTMENT_NUM = l.DEPARTMENT_NUM
), dept_full AS (
  SELECT d.*,
         -- ::FLOAT before dividing: NUMBER division keeps 6 decimals, which on
         -- ~100k units leaves units x ASP five cents off the budget and breaks ID2.
         TPR_BUDGET::FLOAT / NULLIF(TPR_UNITS, 0)                        AS TPR_ASP,
         EXIT_MARGIN + POS_MOVE                                          AS POS_PCT,
         TPR_BUDGET * (EXIT_MARGIN + POS_MOVE)                           AS POS_SALES,
         F26_FM + FM_MOVE                                                AS F27_FM,
         TPR_BUDGET / SUM(TPR_BUDGET) OVER ()                            AS F27_MIX
  FROM dept d
), rbu AS (
  -- RBU rows rebuilt from their departments: additive measures summed, every rate
  -- re-derived from its components. An averaged rate would be silently re-weighted.
  SELECT RBU_CODE,
         SUM(F26_ACTUAL) AS F26_ACTUAL, SUM(F26_UNITS) AS F26_UNITS, SUM(F26_POS) AS F26_POS,
         SUM(F26_ACTUAL)::FLOAT / NULLIF(SUM(F26_UNITS), 0)              AS F26_ASP,
         SUM(F26_POS) / NULLIF(SUM(F26_ACTUAL), 0)                       AS EXIT_MARGIN,
         SUM(F26_FM * F26_ACTUAL) / NULLIF(SUM(F26_ACTUAL), 0)           AS F26_FM,
         SUM(F26_MIX)                                                    AS F26_MIX,
         SUM(LFL_FORECAST)                                               AS LFL_FORECAST,
         SUM(LFL_FORECAST) / NULLIF(SUM(F26_ACTUAL), 0) - 1              AS LFL,
         SUM(F26_ACTUAL * (1 + STATED)) / NULLIF(SUM(F26_ACTUAL), 0) - 1 AS STATED,
         SUM(TPR_BUDGET) AS TPR_BUDGET, SUM(TPR_UNITS) AS TPR_UNITS,
         SUM(TPR_BUDGET)::FLOAT / NULLIF(SUM(TPR_UNITS), 0)              AS TPR_ASP,
         SUM(POS_SALES) AS POS_SALES,
         SUM(POS_SALES) / NULLIF(SUM(TPR_BUDGET), 0)                     AS POS_PCT,
         SUM(F27_FM * TPR_BUDGET) / NULLIF(SUM(TPR_BUDGET), 0)           AS F27_FM,
         SUM(F27_MIX)                                                    AS F27_MIX,
         SUM(PRESENTED) AS PRESENTED, SUM(NEW) AS NEW, SUM(ONGOING) AS ONGOING,
         SUM(DESELECTED) AS DESELECTED, SUM(NEW_DESELECTED) AS NEW_DESELECTED
  FROM dept_full GROUP BY RBU_CODE
), entities AS (
  SELECT 'DEPARTMENT' AS PLAN_LEVEL, RBU_CODE, DEPARTMENT_NUM AS ENTITY_CODE, DEPT AS ENTITY_NAME,
         F26_ACTUAL, F26_UNITS, F26_ASP, F26_POS, EXIT_MARGIN, F26_FM, F26_MIX, LFL_FORECAST, LFL, STATED,
         TPR_BUDGET, TPR_UNITS, TPR_ASP, POS_SALES, POS_PCT, F27_FM, F27_MIX,
         PRESENTED, NEW, ONGOING, DESELECTED, NEW_DESELECTED
  FROM dept_full
  UNION ALL
  SELECT 'RBU', r.RBU_CODE, r.RBU_CODE, h.RBU_DESCRIPTION,
         F26_ACTUAL, F26_UNITS, F26_ASP, F26_POS, EXIT_MARGIN, F26_FM, F26_MIX, LFL_FORECAST, LFL, STATED,
         TPR_BUDGET, TPR_UNITS, TPR_ASP, POS_SALES, POS_PCT, F27_FM, F27_MIX,
         PRESENTED, NEW, ONGOING, DESELECTED, NEW_DESELECTED
  FROM rbu r
  JOIN (SELECT DISTINCT RBU_CODE, RBU_DESCRIPTION FROM DIM_MERCH_HIERARCHY) h ON h.RBU_CODE = r.RBU_CODE
)
SELECT 'AU', e.PLAN_LEVEL, e.RBU_CODE, e.ENTITY_CODE, e.ENTITY_NAME, 'G', 2027, 'H1',
       m.SOURCE_COLUMN, m.MEASURE_CODE,
       CASE m.MEASURE_CODE
         WHEN 'F26_ACTUAL_SALES_AUD' THEN e.F26_ACTUAL
         WHEN 'F27_LFL_FORECAST_AUD' THEN e.LFL_FORECAST
         WHEN 'LFL_GROWTH_PCT' THEN e.LFL
         WHEN 'TOTAL_GROWTH_PCT_STATED' THEN e.STATED
         WHEN 'TPR_BUDGET_AUD' THEN e.TPR_BUDGET
         WHEN 'F27_TPR_UNIT_SALES' THEN e.TPR_UNITS
         WHEN 'F27_TPR_ASP_AUD' THEN e.TPR_ASP
         WHEN 'F27_POS_SALES_AUD' THEN e.POS_SALES
         WHEN 'F27_POS_PCT' THEN e.POS_PCT
         WHEN 'EXIT_POS_MARGIN_PCT' THEN e.EXIT_MARGIN
         WHEN 'F26_MIX_PCT' THEN e.F26_MIX
         WHEN 'F27_TPR_MIX_PCT' THEN e.F27_MIX
         WHEN 'F26_FIRST_MARGIN_PCT' THEN e.F26_FM
         WHEN 'F27_TPR_FIRST_MARGIN_PCT' THEN e.F27_FM
         WHEN 'F26_ASP_AUD' THEN e.F26_ASP
         WHEN 'F26_UNIT_SALES' THEN e.F26_UNITS
         WHEN 'F26_POS_ACTUAL_AUD' THEN e.F26_POS
         WHEN 'OPTIONS_PRESENTED' THEN e.PRESENTED
         WHEN 'OPTIONS_NEW' THEN e.NEW
         WHEN 'OPTIONS_ONGOING' THEN e.ONGOING
         WHEN 'OPTIONS_DESELECTED' THEN e.DESELECTED
         WHEN 'OPTIONS_NEW_DESELECTED' THEN e.NEW_DESELECTED
         WHEN 'OPTIONS_ONGOING_DESELECTED' THEN e.DESELECTED - e.NEW_DESELECTED
       END::FLOAT,
       m.PROVENANCE, m.NOTE,
       NULL, TRUE, '2026-05-22 10:00:00'::TIMESTAMP_NTZ
FROM entities e
CROSS JOIN (
  -- The column contract: which workbook column each measure is pasted from. The
  -- MFP upload reads this mapping back from the table, so it is defined once.
  SELECT * FROM VALUES
    ('D', 'F26_ACTUAL_SALES_AUD', 'DATA', 'FY26 H1 POS sales'),
    ('E', 'F27_LFL_FORECAST_AUD', 'PLANNING', 'Top-down: LY x (1 + LFL %)'),
    ('F', 'LFL_GROWTH_PCT', 'JOINT', 'Agreed at the budget review'),
    ('G', 'TOTAL_GROWTH_PCT_STATED', 'JOINT', 'Manual input: the growth presented at range review'),
    ('H', 'TPR_BUDGET_AUD', 'BUYING', 'Bottom-up: units x ASP from the range review'),
    ('I', 'F27_TPR_UNIT_SALES', 'BUYING', 'Range review unit plan'),
    ('J', 'F27_TPR_ASP_AUD', 'BUYING', 'Range review ASP'),
    ('K', 'F27_POS_SALES_AUD', 'CALC', 'Bottom-up x POS %'),
    ('L', 'F27_POS_PCT', 'JOINT', 'Planned POS margin'),
    ('M', 'EXIT_POS_MARGIN_PCT', 'DATA', 'FY26 H1 realised margin after discount'),
    ('N', 'F26_MIX_PCT', 'CALC', 'Share of FY26 H1 sales'),
    ('O', 'F27_TPR_MIX_PCT', 'CALC', 'Share of the bottom-up plan'),
    ('P', 'F26_FIRST_MARGIN_PCT', 'DATA', 'FY26 H1 intake margin at full retail'),
    ('Q', 'F27_TPR_FIRST_MARGIN_PCT', 'JOINT', 'Planned intake margin'),
    ('R', 'F26_ASP_AUD', 'DATA', 'FY26 H1 realised ASP'),
    ('S', 'F26_UNIT_SALES', 'DATA', 'FY26 H1 units'),
    ('T', 'F26_POS_ACTUAL_AUD', 'DATA', 'FY26 H1 POS gross profit'),
    ('U', 'OPTIONS_PRESENTED', 'JOINT', 'Presented at range review'),
    ('V', 'OPTIONS_NEW', 'JOINT', 'Committed new options'),
    ('W', 'OPTIONS_ONGOING', 'JOINT', 'Committed ongoing options'),
    ('X', 'OPTIONS_DESELECTED', 'JOINT', 'Dropped at range review'),
    ('Y', 'OPTIONS_NEW_DESELECTED', 'JOINT', 'New/ongoing split of drops is assigned, not sourced'),
    ('Z', 'OPTIONS_ONGOING_DESELECTED', 'JOINT', 'New/ongoing split of drops is assigned, not sourced')
  AS v(SOURCE_COLUMN, MEASURE_CODE, PROVENANCE, NOTE)
) m;

-- ---------- 2. MFP upload audit and cell overrides ----------
CREATE OR REPLACE TABLE MFP_PLAN_UPLOAD (
  UPLOAD_ID         NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  MARKET_CODE       VARCHAR,
  FY_YEAR           NUMBER(4,0),
  FY_HALF           VARCHAR,
  PLAN_LEVELS       VARCHAR,
  ENTITIES          VARCHAR,
  ROW_COUNT         NUMBER,
  MEASURE_COUNT     NUMBER,
  SUPERSEDED_ROWS   NUMBER,
  SOURCE_FILE       VARCHAR,
  SOURCE_SHEET      VARCHAR,
  SOURCE_PULLED_ON  DATE,
  RATIONALE         VARCHAR,
  CHECK_RESULTS     VARIANT,
  HAS_SOFT_FAILURE  BOOLEAN,
  UPLOADED_BY       VARCHAR,
  UPLOADED_AT       TIMESTAMP_NTZ,
  RAW_PASTE         VARCHAR
) COMMENT = 'One row per product plan upload: the audit record of how a plan entered the model.';

CREATE OR REPLACE TABLE MFP_CELL_OVERRIDE (
  OVERRIDE_ID       NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  MARKET_CODE       VARCHAR,
  FY_YEAR           NUMBER(4,0),
  FY_HALF           VARCHAR,
  PLAN_LEVEL        VARCHAR,
  ENTITY_CODE       VARCHAR,
  GRID_COLUMN       VARCHAR,
  OLD_VALUE         FLOAT,
  NEW_VALUE         FLOAT,
  REASON_CODE       VARCHAR,
  RATIONALE         VARCHAR,
  CHANGED_BY        VARCHAR,
  CHANGED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  SOURCE_UPLOAD_ID  NUMBER COMMENT 'The upload this override was made against. A re-load drops it from view, deliberately.'
) COMMENT = 'Append-only overrides of values displayed in the product plan grid. Uploaded rows are never changed by them.';

-- ---------- 3. RBU mix ----------
-- The bridge from the store plan total to RBU budgets. LY_MIX_PCT_MEASURED comes
-- from POS; the STATED columns are the targets agreed at the end-of-half review.
-- Where measured and stated disagree, both are shown and neither is preferred.
--
-- The plan shifts mix toward consumables -- repeat purchase, defensive -- from a
-- measured 10.9% to a stated 11.5%.
--
-- PLAN_SALES_AUD is STORED, and deliberately struck against the store plan as it
-- stood before Ripley (S063) was added. Applying the agreed mix to today's total
-- gives a different figure; the grid shows both and the drift between them,
-- because that is exactly how a stored derived figure goes stale in practice.
CREATE OR REPLACE TABLE RBU_MIX_TARGET (
  MARKET_CODE           VARCHAR,
  RBU_CODE              VARCHAR,
  RBU_DESCRIPTION       VARCHAR,
  FY_YEAR               NUMBER(4,0),
  FY_HALF               VARCHAR,
  LY_MIX_PCT_MEASURED   FLOAT,
  LY_MIX_PCT_STATED     FLOAT,
  PLAN_MIX_PCT_STATED   FLOAT,
  PLAN_SALES_AUD        FLOAT,
  IS_TRADED             BOOLEAN,
  PROVENANCE            VARCHAR,
  NOTE                  VARCHAR
) COMMENT = 'Store plan total -> RBU budgets. Measured LY mix from POS beside the stated targets; neither silently preferred.';

INSERT INTO RBU_MIX_TARGET
WITH ly AS (
  SELECT RBU_CODE, MEASURE_VALUE AS LY_MIX
  FROM FACT_MFP_PRODUCT_PLAN
  WHERE PLAN_LEVEL = 'RBU' AND MEASURE_CODE = 'F26_MIX_PCT'
), sp_before_ripley AS (
  SELECT SUM(PLAN_SALES_AUD) AS TOTAL FROM VW_STORE_PLAN_WEEKLY WHERE STORE_CODE <> 'S063'
)
SELECT 'AU', h.RBU_CODE, h.RBU_DESCRIPTION, 2027, 'H1',
       l.LY_MIX,
       DECODE(h.RBU_CODE, '100', 0.110, '200', 0.890),
       DECODE(h.RBU_CODE, '100', 0.115, '200', 0.885),
       DECODE(h.RBU_CODE, '100', 0.115, '200', 0.885) * sp.TOTAL,
       TRUE, 'JOINT',
       DECODE(h.RBU_CODE,
         '100', 'Consumables grow from 11.0% to 11.5% of the business: repeat purchase that holds up when prams are deferred.',
         '200', 'Hardgoods give up half a point of mix to consumables.')
FROM (SELECT DISTINCT RBU_CODE, RBU_DESCRIPTION FROM DIM_MERCH_HIERARCHY) h
JOIN ly l ON l.RBU_CODE = h.RBU_CODE
CROSS JOIN sp_before_ripley sp;

-- ---------- 4. Range funnel ----------
-- Four gates the range narrows through. Three are measurable from Baby Mart's own
-- data -- one more than the reference implementation, whose first two gates were
-- unavailable because the range-review sheets were never supplied.
CREATE OR REPLACE TABLE DIM_RANGE_GATE (
  GATE_SEQ              NUMBER,
  GATE_CODE             VARCHAR,
  GATE_NAME             VARCHAR,
  OWNER                 VARCHAR,
  DESCRIPTION           VARCHAR,
  IS_MEASURABLE_TODAY   BOOLEAN,
  DATA_SOURCE           VARCHAR,
  INDICATIVE_SKU_COUNT  NUMBER
) COMMENT = 'The four gates through which the range narrows. Gate 1 is not measurable: no supplier catalogue feed is held.';

INSERT INTO DIM_RANGE_GATE
SELECT * FROM VALUES
  (1, 'SUPPLIER_CATALOGUE', 'Everything suppliers offer', 'Suppliers',
   'The full catalogue across Baby Mart''s 25 suppliers, before Buying makes any selection.', FALSE,
   'Not held: no supplier catalogue feed exists. Shown as unavailable rather than estimated.', NULL),
  (2, 'RANGE_PRESENTED', 'Options presented at range review', 'Buying',
   'What Buying brought to the range review.', TRUE,
   'ANALYTICS.DIM_PLAN_OPTION, every option regardless of outcome', NULL),
  (3, 'RANGE_COMMITTED', 'Range committed to the plan', 'Planning and Buying (joint)',
   'Options that survived the review: new plus ongoing.', TRUE,
   'ANALYTICS.DIM_PLAN_OPTION, status NEW or ONGOING', NULL),
  (4, 'DELIVERED', 'Range that survives supply', 'Supply chain',
   'What suppliers actually delivered against what was ordered.', TRUE,
   'ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC: ordered vs delivered units. This is supplier SHORT-SHIP, not a minimum-order constraint.', NULL)
AS t(GATE_SEQ, GATE_CODE, GATE_NAME, OWNER, DESCRIPTION, IS_MEASURABLE_TODAY, DATA_SOURCE, INDICATIVE_SKU_COUNT);

UPDATE DIM_RANGE_GATE g SET INDICATIVE_SKU_COUNT = x.N
FROM (
  SELECT 2 AS GATE_SEQ, COUNT(*) AS N FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION
  UNION ALL
  SELECT 3, COUNT_IF(OPTION_STATUS IN ('NEW', 'ONGOING')) FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION
  UNION ALL
  SELECT 1, (SELECT COUNT(*) FROM BABY_MART_DEMO.CURATED.DIM_PRODUCT)
  UNION ALL
  SELECT 4, COUNT_IF(OPTION_STATUS IN ('NEW', 'ONGOING')) FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION
) x
WHERE x.GATE_SEQ = g.GATE_SEQ;

-- Minimum credible offer. A department must be represented credibly, not merely
-- present. THRESHOLDS ARE ASSUMPTIONS: no planogram minimums are held. Prams sets a
-- higher bar because a pram floor without the full brand wall is not a credible
-- pram offer -- which is what puts it below threshold at 88% adoption.
CREATE OR REPLACE TABLE RANGE_CREDIBILITY_RULE (
  RBU_CODE                    VARCHAR,
  DEPARTMENT_NUM              VARCHAR,
  DEPARTMENT_NAME             VARCHAR,
  MIN_CREDIBLE_ADOPTION_PCT   FLOAT,
  PLANOGRAM_MIN_OPTIONS       NUMBER,
  IS_ASSUMPTION               BOOLEAN,
  RATIONALE                   VARCHAR
) COMMENT = 'Minimum credible offer thresholds. ASSUMPTIONS pending planogram minimums from category management.';

INSERT INTO RANGE_CREDIBILITY_RULE
SELECT DISTINCT RBU_CODE, DEPARTMENT_NUM, DEPARTMENT_NAME_BARE,
       IFF(DEPARTMENT_NUM = '050', 0.90, 0.60),
       NULL, TRUE,
       IFF(DEPARTMENT_NUM = '050',
           'A pram floor needs the full brand wall from each major supplier to be credible. 90% is an assumption pending planogram data.',
           '60% is a placeholder pending a real per-department minimum from category management.')
FROM DIM_MERCH_HIERARCHY;
