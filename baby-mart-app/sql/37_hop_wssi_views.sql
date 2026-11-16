-- ============================================================
-- Head of Planning — WSSI views
--
-- Five versions, one week grain:
--   TY        this year's actuals, as they land
--   LY        last year, the same week 364 days earlier (real POS)
--   BUD       the half's budget, locked: the store plan the board signed off
--   MERCH_FC  the merch forecast, reviewed monthly
--   LE        the LATEST ESTIMATE: actuals for the weeks that have traded, then the
--             merch forecast, with its stock re-based onto the last actual closing
--             position. The WSSI rows that name no version -- stock, purchases, cover,
--             markdown, OTB -- read this one.
--
-- Why LE exists. The reference implementation read every unversioned row from this
-- year's actuals, so stock, cover and OTB went blank the moment a period had not
-- traded -- exactly the periods a head of planning reads them for. And the forecast
-- carries its own opening stock, which is not where stock actually closed: here it
-- is $31K to $198K away by department. Rolling forward from the forecast's own
-- position would ignore what actually happened. The offset is applied as a constant,
-- so the stock roll-forward still holds exactly across the splice.
--
-- Planner inputs (markdown, shrink, stock adjustments) apply to LE, and only to weeks
-- that have not traded. They never restate a traded week, last year, or the locked
-- budget. The reference implementation applied them to every version.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- Forward windows and the roll-forward, per version per department per week.
--
-- FORWARD COVER is stock against FUTURE sales. LE looks forward over itself;
-- this year's cover looks forward through LE too, because for a traded week the
-- future is the forecast. Other versions look forward over themselves. The count of
-- forward weeks actually in frame (FWD_N) is carried so cover is not overstated at
-- the end of a series.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_DERIVED
  COMMENT = 'WSSI weekly facts plus the latest estimate (LE), with forward 4-week flows, prior stock and the stock roll-forward.'
AS
WITH last_actual AS (
  SELECT DEPARTMENT_NUM, MAX(WEEK_END_DATE) AS LAST_ACTUAL_WEEK
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY
  WHERE VERSION = 'TY'
  GROUP BY DEPARTMENT_NUM
), rebase AS (
  SELECT t.DEPARTMENT_NUM, l.LAST_ACTUAL_WEEK,
         t.C_CLS_INV_AUD   - fc.C_CLS_INV_AUD   AS C_OFFSET,
         t.U_CLS_INV       - fc.U_CLS_INV       AS U_OFFSET,
         t.U_CLS_INV_STORE - fc.U_CLS_INV_STORE AS U_STORE_OFFSET,
         t.U_CLS_INV_DC    - fc.U_CLS_INV_DC    AS U_DC_OFFSET
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY t
  JOIN last_actual l ON l.DEPARTMENT_NUM = t.DEPARTMENT_NUM AND l.LAST_ACTUAL_WEEK = t.WEEK_END_DATE
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY fc
    ON fc.VERSION = 'MERCH_FC' AND fc.DEPARTMENT_NUM = t.DEPARTMENT_NUM AND fc.WEEK_END_DATE = t.WEEK_END_DATE
  WHERE t.VERSION = 'TY'
), base AS (
  SELECT f.*, f.VERSION IN ('TY', 'LY') AS IS_ACTUAL
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY f
  UNION ALL
  SELECT t.* REPLACE ('LE' AS VERSION), TRUE
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY t
  WHERE t.VERSION = 'TY'
  UNION ALL
  SELECT fc.* REPLACE (
           'LE'                                   AS VERSION,
           fc.C_CLS_INV_AUD   + r.C_OFFSET        AS C_CLS_INV_AUD,
           fc.U_CLS_INV       + r.U_OFFSET        AS U_CLS_INV,
           fc.U_CLS_INV_STORE + r.U_STORE_OFFSET  AS U_CLS_INV_STORE,
           fc.U_CLS_INV_DC    + r.U_DC_OFFSET     AS U_CLS_INV_DC),
         FALSE
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY fc
  JOIN rebase r ON r.DEPARTMENT_NUM = fc.DEPARTMENT_NUM
  WHERE fc.VERSION = 'MERCH_FC' AND fc.WEEK_END_DATE > r.LAST_ACTUAL_WEEK
), series AS (
  SELECT VERSION, DEPARTMENT_NUM, WEEK_END_DATE, SLS_AUD AS SLS, SLS_U AS U,
         SLS_AUD - POS_GP_AUD AS COGS, SLS_FP_AUD - FP_GP_AUD AS FP_COGS, SLS_CL_AUD - CL_GP_AUD AS CL_COGS
  FROM base WHERE VERSION <> 'TY'
  UNION ALL
  SELECT 'TY', DEPARTMENT_NUM, WEEK_END_DATE, SLS_AUD, SLS_U,
         SLS_AUD - POS_GP_AUD, SLS_FP_AUD - FP_GP_AUD, SLS_CL_AUD - CL_GP_AUD
  FROM base WHERE VERSION = 'LE'
), fwd AS (
  -- Snowflake has no named WINDOW clause, so the frame is repeated on each.
  SELECT VERSION, DEPARTMENT_NUM, WEEK_END_DATE,
    SUM(SLS)     OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_SLS4_AUD,
    SUM(COGS)    OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_COGS4_AUD,
    SUM(FP_COGS) OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_FP_COGS4_AUD,
    SUM(CL_COGS) OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_CL_COGS4_AUD,
    SUM(U)       OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_U4,
    COUNT(SLS)   OVER (PARTITION BY VERSION, DEPARTMENT_NUM ORDER BY WEEK_END_DATE ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING) AS FWD_N
  FROM series
)
SELECT b.*,
  l.LAST_ACTUAL_WEEK,
  b.SLS_AUD - b.POS_GP_AUD                                     AS TTL_COGS_AUD,
  b.SLS_FP_AUD - b.FP_GP_AUD                                   AS FP_COGS_AUD,
  b.SLS_CL_AUD - b.CL_GP_AUD                                   AS CL_COGS_AUD,
  w.FWD_SLS4_AUD, w.FWD_COGS4_AUD, w.FWD_FP_COGS4_AUD, w.FWD_CL_COGS4_AUD, w.FWD_U4, w.FWD_N,
  -- The first week of a series has no prior and stays NULL: defaulting it to zero
  -- would fabricate an opening stock and report a phantom breach.
  LAG(b.C_CLS_INV_AUD) OVER (PARTITION BY b.VERSION, b.DEPARTMENT_NUM ORDER BY b.WEEK_END_DATE) AS PRIOR_C_CLS_INV_AUD,
  LAG(b.C_CLS_INV_AUD) OVER (PARTITION BY b.VERSION, b.DEPARTMENT_NUM ORDER BY b.WEEK_END_DATE)
    - (b.SLS_AUD - b.POS_GP_AUD) + b.C_REC_AUD                 AS C_CLS_INV_ROLLFWD_AUD
FROM base b
JOIN last_actual l ON l.DEPARTMENT_NUM = b.DEPARTMENT_NUM
LEFT JOIN fwd w ON w.VERSION = b.VERSION AND w.DEPARTMENT_NUM = b.DEPARTMENT_NUM AND w.WEEK_END_DATE = b.WEEK_END_DATE;

-- The effective planner input per DEPARTMENT, week and measure.
--
-- An input is scoped to one RBU or to all of them. Where an all-RBU input and an
-- RBU input cover the same week, the LATEST wins for the departments both cover --
-- resolving at department grain is what stops the two from being double-counted.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_PLANNED_INPUT
  COMMENT = 'Latest planner input per department / week / measure. Overlapping scopes resolve to the latest input.'
AS
SELECT h.DEPARTMENT_NUM, h.RBU_CODE, i.RBU_CODE AS INPUT_RBU_SCOPE,
       i.WEEK_END_DATE, i.MEASURE_CODE, i.VALUE_FORM, i.NEW_VALUE,
       i.BATCH_ID, i.TYPED_GRAIN, i.TYPED_PERIOD_KEY, i.TYPED_VALUE,
       i.REASON_CODE, i.RATIONALE, i.CHANGED_BY, i.CHANGED_AT, i.INPUT_ID
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.WSSI_PLANNED_INPUT i
JOIN (SELECT DISTINCT RBU_CODE, DEPARTMENT_NUM FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_MERCH_HIERARCHY) h
  ON i.RBU_CODE IS NULL OR i.RBU_CODE = h.RBU_CODE
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY h.DEPARTMENT_NUM, i.WEEK_END_DATE, i.MEASURE_CODE
  ORDER BY i.CHANGED_AT DESC, i.INPUT_ID DESC) = 1;

-- Every measure the 140-row layout reads, at week grain.
--
-- LAST YEAR IS RE-DATED onto this year's week (ALIGNED_WEEK_END_DATE = +364 days),
-- so it buckets into the same period as the week it is compared with and every LY
-- rate is computed like any other version's. The reference implementation instead
-- joined LY onto this year's row as LY_* columns, and every LY rate whose column
-- name had no matching entry rendered as a dash.
--
-- Rates are NOT computed here. Each rate in the layout is rebuilt from components
-- for each period (VW_WSSI_GRAIN, then src/lib/hop/wssi-model.ts), so a month's ASP
-- is never an average of weeks' ASPs. The planning rates carry a WEIGHT for that
-- reason: markdown depth is weighted by clearance sales, shrink by stock.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_EXTENDED
  COMMENT = 'WSSI weekly measures for the 140-row layout: real flows, modelled stock, assumptions applied, planner inputs resolved. LY re-dated onto this year.'
AS
WITH a AS (
  SELECT
    MAX(IFF(MEASURE_CODE = 'MD_EXIT_AUD',        FACTOR, NULL)) AS F_MD_EXIT,
    MAX(IFF(MEASURE_CODE = 'MD_EXIT_FP_GP_PCT',  FACTOR, NULL)) AS F_MD_EXIT_GP,
    MAX(IFF(MEASURE_CODE = 'MD_DEPTH_PCT',       FACTOR, NULL)) AS F_MD_DEPTH,
    MAX(IFF(MEASURE_CODE = 'MD_SPEND_AUD',       FACTOR, NULL)) AS F_MD_SPEND,
    MAX(IFF(MEASURE_CODE = 'MD_UNITS',           FACTOR, NULL)) AS F_MD_UNITS,
    MAX(IFF(MEASURE_CODE = 'SHRINK_PCT',         FACTOR, NULL)) AS F_SHRINK,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_R_AUD', FACTOR, NULL)) AS F_FP_ADJ_R,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_R_AUD', FACTOR, NULL)) AS F_CL_ADJ_R,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_C_AUD', FACTOR, NULL)) AS F_FP_ADJ_C,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_C_AUD', FACTOR, NULL)) AS F_CL_ADJ_C,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_UNITS', FACTOR, NULL)) AS F_FP_ADJ_U,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_UNITS', FACTOR, NULL)) AS F_CL_ADJ_U,
    MAX(IFF(MEASURE_CODE = 'TTL_CSOH_R_AUD',     FACTOR, NULL)) AS F_CSOH_R,
    MAX(IFF(MEASURE_CODE = 'FP_CSOH_C_AUD',      FACTOR, NULL)) AS F_FP_CSOH_C,
    MAX(IFF(MEASURE_CODE = 'FP_CSOH_U',          FACTOR, NULL)) AS F_FP_CSOH_U,
    MAX(IFF(MEASURE_CODE = 'CL_CSOH_C_AUD',      FACTOR, NULL)) AS F_CL_CSOH_C,
    MAX(IFF(MEASURE_CODE = 'CL_CSOH_U',          FACTOR, NULL)) AS F_CL_CSOH_U,
    MAX(IFF(MEASURE_CODE = 'ON_ORDER_C_AUD',     FACTOR, NULL)) AS F_OO_C,
    MAX(IFF(MEASURE_CODE = 'ON_ORDER_R_AUD',     FACTOR, NULL)) AS F_OO_R,
    MAX(IFF(MEASURE_CODE = 'ON_ORDER_UNITS',     FACTOR, NULL)) AS F_OO_U,
    MAX(IFF(MEASURE_CODE = 'UNCOMMITTED_C_AUD',  FACTOR, NULL)) AS F_UC_C,
    MAX(IFF(MEASURE_CODE = 'UNCOMMITTED_R_AUD',  FACTOR, NULL)) AS F_UC_R,
    MAX(IFF(MEASURE_CODE = 'UNCOMMITTED_UNITS',  FACTOR, NULL)) AS F_UC_U,
    MAX(IFF(MEASURE_CODE = 'BUD_SLS_FP_AUD',     FACTOR, NULL)) AS F_BUD_FP
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.MISSING_WSSI_MEASURES
), pin AS (
  SELECT DEPARTMENT_NUM, WEEK_END_DATE,
    MAX(IFF(MEASURE_CODE = 'MD_EXIT_AUD',        NEW_VALUE, NULL)) AS P_MD_EXIT,
    MAX(IFF(MEASURE_CODE = 'MD_EXIT_FP_GP_PCT',  NEW_VALUE, NULL)) AS P_MD_EXIT_GP,
    MAX(IFF(MEASURE_CODE = 'MD_DEPTH_PCT',       NEW_VALUE, NULL)) AS P_MD_DEPTH,
    MAX(IFF(MEASURE_CODE = 'MD_SPEND_AUD',       NEW_VALUE, NULL)) AS P_MD_SPEND,
    MAX(IFF(MEASURE_CODE = 'MD_UNITS',           NEW_VALUE, NULL)) AS P_MD_UNITS,
    MAX(IFF(MEASURE_CODE = 'SHRINK_PCT',         NEW_VALUE, NULL)) AS P_SHRINK,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_R_AUD', NEW_VALUE, NULL)) AS P_FP_ADJ_R,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_R_AUD', NEW_VALUE, NULL)) AS P_CL_ADJ_R,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_C_AUD', NEW_VALUE, NULL)) AS P_FP_ADJ_C,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_C_AUD', NEW_VALUE, NULL)) AS P_CL_ADJ_C,
    MAX(IFF(MEASURE_CODE = 'FP_STOCK_ADJ_UNITS', NEW_VALUE, NULL)) AS P_FP_ADJ_U,
    MAX(IFF(MEASURE_CODE = 'CL_STOCK_ADJ_UNITS', NEW_VALUE, NULL)) AS P_CL_ADJ_U
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_PLANNED_INPUT
  GROUP BY DEPARTMENT_NUM, WEEK_END_DATE
), d AS (
  SELECT d.*, a.*, p.* EXCLUDE (DEPARTMENT_NUM, WEEK_END_DATE),
         IFF(d.VERSION = 'LY', DATEADD(day, 364, d.WEEK_END_DATE), d.WEEK_END_DATE) AS ALIGNED_WEEK_END_DATE,
         d.VERSION = 'LE' AND NOT d.IS_ACTUAL AS ACCEPTS_PLANNER_INPUT
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_DERIVED d
  CROSS JOIN a
  LEFT JOIN pin p
    ON d.VERSION = 'LE' AND NOT d.IS_ACTUAL
   AND p.DEPARTMENT_NUM = d.DEPARTMENT_NUM AND p.WEEK_END_DATE = d.WEEK_END_DATE
)
SELECT
  MARKET_CODE, RBU_CODE, RBU_DESCRIPTION, DEPARTMENT_NUM, DEPARTMENT_NAME, VERSION,
  WEEK_END_DATE, ALIGNED_WEEK_END_DATE, IS_ACTUAL, LAST_ACTUAL_WEEK, ACCEPTS_PLANNER_INPUT, STOCK_BASIS,
  -- flows
  SLS_AUD, SLS_U, POS_GP_AUD, SLS_FP_AUD, SLS_FP_U, FP_GP_AUD, SLS_CL_AUD, SLS_CL_U, CL_GP_AUD,
  TTL_COGS_AUD, FP_COGS_AUD, CL_COGS_AUD,
  C_REC_AUD, R_REC_AUD, U_REC, STORE_REC_UNIT,
  IFF(VERSION = 'BUD', SLS_AUD * F_BUD_FP, NULL)                 AS BUD_SLS_FP_AUD,
  -- markdown: an amount is a factor on its basis; a rate travels with its weight
  SLS_CL_AUD * NVL(P_MD_EXIT, F_MD_EXIT)                         AS MD_EXIT_AUD,
  SLS_CL_AUD * NVL(P_MD_EXIT, F_MD_EXIT) * NVL(P_MD_EXIT_GP, F_MD_EXIT_GP) AS MD_EXIT_GP_W_AUD,
  NVL(P_MD_EXIT_GP, F_MD_EXIT_GP)                                AS MD_EXIT_FP_GP_PCT,
  SLS_CL_AUD * NVL(P_MD_DEPTH, F_MD_DEPTH)                       AS MD_DEPTH_W_AUD,
  NVL(P_MD_DEPTH, F_MD_DEPTH)                                    AS MD_DEPTH_PCT,
  SLS_AUD * NVL(P_MD_SPEND, F_MD_SPEND)                          AS MD_SPEND_AUD,
  SLS_U * NVL(P_MD_UNITS, F_MD_UNITS)                            AS MD_UNITS,
  -- stock adjustments and shrink: reported against the modelled stock, not
  -- deducted from it (the closing stock is a model, not a stock ledger)
  C_CLS_INV_AUD * NVL(P_FP_ADJ_R, F_FP_ADJ_R)                    AS FP_STOCK_ADJ_R_AUD,
  C_CLS_INV_AUD * NVL(P_CL_ADJ_R, F_CL_ADJ_R)                    AS CL_STOCK_ADJ_R_AUD,
  C_CLS_INV_AUD * (NVL(P_FP_ADJ_R, F_FP_ADJ_R) + NVL(P_CL_ADJ_R, F_CL_ADJ_R)) AS TTL_STOCK_ADJ_R_AUD,
  C_CLS_INV_AUD * NVL(P_FP_ADJ_C, F_FP_ADJ_C)                    AS FP_STOCK_ADJ_C_AUD,
  C_CLS_INV_AUD * NVL(P_CL_ADJ_C, F_CL_ADJ_C)                    AS CL_STOCK_ADJ_C_AUD,
  C_CLS_INV_AUD * (NVL(P_FP_ADJ_C, F_FP_ADJ_C) + NVL(P_CL_ADJ_C, F_CL_ADJ_C)) AS TTL_STOCK_ADJ_C_AUD,
  U_CLS_INV * NVL(P_FP_ADJ_U, F_FP_ADJ_U)                        AS FP_STOCK_ADJ_UNITS,
  U_CLS_INV * NVL(P_CL_ADJ_U, F_CL_ADJ_U)                        AS CL_STOCK_ADJ_UNITS,
  U_CLS_INV * (NVL(P_FP_ADJ_U, F_FP_ADJ_U) + NVL(P_CL_ADJ_U, F_CL_ADJ_U)) AS TTL_STOCK_ADJ_UNITS,
  NVL(P_SHRINK, F_SHRINK)                                        AS SHRINK_PCT,
  C_CLS_INV_AUD * NVL(P_SHRINK, F_SHRINK)                        AS SHRINK_C_AUD,
  C_CLS_INV_AUD                                                  AS SHRINK_BASE_AUD,
  -- On order and uncommitted are shares of THIS PERIOD'S PURCHASES, so they are
  -- flows like the purchases they split. Treating them as closing balances while
  -- purchases sum across the period would make OTB = four weeks of purchases less
  -- one week of orders.
  C_REC_AUD * F_OO_C                                             AS ON_ORDER_C_AUD,
  R_REC_AUD * F_OO_R                                             AS ON_ORDER_R_AUD,
  U_REC * F_OO_U                                                 AS ON_ORDER_UNITS,
  C_REC_AUD * F_UC_C                                             AS UNCOMMITTED_C_AUD,
  R_REC_AUD * F_UC_R                                             AS UNCOMMITTED_R_AUD,
  U_REC * F_UC_U                                                 AS UNCOMMITTED_UNITS,
  C_REC_AUD - C_REC_AUD * F_OO_C                                 AS OTB_C_AUD,
  R_REC_AUD - R_REC_AUD * F_OO_R                                 AS OTB_R_AUD,
  U_REC - U_REC * F_OO_U                                         AS OTB_UNITS,
  -- balances (closing positions)
  C_CLS_INV_AUD, U_CLS_INV, U_CLS_INV_STORE, U_CLS_INV_DC,
  C_CLS_INV_AUD * F_CSOH_R                                       AS TTL_CSOH_R_AUD,
  C_CLS_INV_AUD * F_FP_CSOH_C                                    AS FP_CSOH_C_AUD,
  U_CLS_INV * F_FP_CSOH_U                                        AS FP_CSOH_U,
  C_CLS_INV_AUD * F_CL_CSOH_C                                    AS CL_CSOH_C_AUD,
  U_CLS_INV * F_CL_CSOH_U                                        AS CL_CSOH_U,
  COMMIT_R_AUD, COMMIT_C_AUD, U_COMMIT,
  FWD_SLS4_AUD, FWD_COGS4_AUD, FWD_FP_COGS4_AUD, FWD_CL_COGS4_AUD, FWD_U4, FWD_N,
  -- which planning rows carry a typed input this week
  P_MD_EXIT IS NOT NULL    AS IN_MD_EXIT,
  P_MD_EXIT_GP IS NOT NULL AS IN_MD_EXIT_GP,
  P_MD_DEPTH IS NOT NULL   AS IN_MD_DEPTH,
  P_MD_SPEND IS NOT NULL   AS IN_MD_SPEND,
  P_MD_UNITS IS NOT NULL   AS IN_MD_UNITS,
  P_SHRINK IS NOT NULL     AS IN_SHRINK,
  P_FP_ADJ_R IS NOT NULL   AS IN_FP_ADJ_R,
  P_CL_ADJ_R IS NOT NULL   AS IN_CL_ADJ_R,
  P_FP_ADJ_C IS NOT NULL   AS IN_FP_ADJ_C,
  P_CL_ADJ_C IS NOT NULL   AS IN_CL_ADJ_C,
  P_FP_ADJ_U IS NOT NULL   AS IN_FP_ADJ_U,
  P_CL_ADJ_U IS NOT NULL   AS IN_CL_ADJ_U,
  C_SOH_FEED_AUD
FROM d;

-- The WSSI at any grain: one row per period, version and RBU scope ('ALL' or an
-- RBU code). FLOWS sum across weeks. BALANCES are taken at the period's closing
-- week -- never summed across weeks, which overstates a month's stock four- or
-- five-fold -- but summed across departments. Forward measures are taken at the
-- closing week too. Rates are rebuilt from these components on the client.
--
-- *_TD columns are the same flows restricted to weeks that have traded, so a
-- part-traded period compares actuals with the plan for the SAME weeks rather than
-- with a whole month the actuals have not reached yet.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_GRAIN
  COMMENT = 'WSSI components by grain, period, version and RBU scope. Flows summed, balances at the closing week, to-date comparators for part-traded periods.'
AS
WITH e AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_EXTENDED
), win AS (
  SELECT MIN(WEEK_END_DATE) AS MIN_WEEK, MAX(WEEK_END_DATE) AS MAX_WEEK
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.FACT_WSSI_WEEKLY
  WHERE VERSION IN ('BUD', 'MERCH_FC')
), asat AS (
  SELECT MAX(LAST_ACTUAL_WEEK) AS LAST_ACTUAL_WEEK FROM e
), p AS (
  SELECT t.*
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_TIME_PERIOD t CROSS JOIN win w
  WHERE t.PERIOD_END_DATE >= w.MIN_WEEK AND t.PERIOD_START_DATE <= w.MAX_WEEK
), j AS (
  SELECT p.TIME_GRAIN, p.PERIOD_KEY, e.*,
         MAX(e.ALIGNED_WEEK_END_DATE) OVER (PARTITION BY p.TIME_GRAIN, p.PERIOD_KEY, e.VERSION) AS CLOSING_WEEK,
         e.ALIGNED_WEEK_END_DATE <= s.LAST_ACTUAL_WEEK AS IS_TO_DATE
  FROM p
  JOIN e ON e.ALIGNED_WEEK_END_DATE BETWEEN p.PERIOD_START_DATE AND p.PERIOD_END_DATE
  CROSS JOIN asat s
), agg AS (
  SELECT TIME_GRAIN, PERIOD_KEY, VERSION,
    IFF(GROUPING(RBU_CODE) = 1, 'ALL', RBU_CODE)                 AS RBU_SCOPE,
    COUNT(DISTINCT ALIGNED_WEEK_END_DATE)                        AS AVAILABLE_WEEKS,
    COUNT(DISTINCT IFF(IS_ACTUAL, ALIGNED_WEEK_END_DATE, NULL))  AS ACTUAL_WEEKS,
    COUNT(DISTINCT IFF(ACCEPTS_PLANNER_INPUT, ALIGNED_WEEK_END_DATE, NULL)) AS OPEN_WEEKS,
    MAX(CLOSING_WEEK)                                            AS CLOSING_WEEK,
    MAX(STOCK_BASIS)                                             AS STOCK_BASIS,
    -- flows
    SUM(SLS_AUD) AS SLS_AUD, SUM(SLS_U) AS SLS_U, SUM(POS_GP_AUD) AS POS_GP_AUD,
    SUM(SLS_FP_AUD) AS SLS_FP_AUD, SUM(SLS_FP_U) AS SLS_FP_U, SUM(FP_GP_AUD) AS FP_GP_AUD,
    SUM(SLS_CL_AUD) AS SLS_CL_AUD, SUM(SLS_CL_U) AS SLS_CL_U, SUM(CL_GP_AUD) AS CL_GP_AUD,
    SUM(TTL_COGS_AUD) AS TTL_COGS_AUD, SUM(FP_COGS_AUD) AS FP_COGS_AUD, SUM(CL_COGS_AUD) AS CL_COGS_AUD,
    SUM(C_REC_AUD) AS C_REC_AUD, SUM(R_REC_AUD) AS R_REC_AUD, SUM(U_REC) AS U_REC,
    SUM(STORE_REC_UNIT) AS STORE_REC_UNIT, SUM(BUD_SLS_FP_AUD) AS BUD_SLS_FP_AUD,
    SUM(MD_EXIT_AUD) AS MD_EXIT_AUD, SUM(MD_EXIT_GP_W_AUD) AS MD_EXIT_GP_W_AUD,
    SUM(MD_DEPTH_W_AUD) AS MD_DEPTH_W_AUD, SUM(MD_SPEND_AUD) AS MD_SPEND_AUD, SUM(MD_UNITS) AS MD_UNITS,
    SUM(FP_STOCK_ADJ_R_AUD) AS FP_STOCK_ADJ_R_AUD, SUM(CL_STOCK_ADJ_R_AUD) AS CL_STOCK_ADJ_R_AUD,
    SUM(TTL_STOCK_ADJ_R_AUD) AS TTL_STOCK_ADJ_R_AUD,
    SUM(FP_STOCK_ADJ_C_AUD) AS FP_STOCK_ADJ_C_AUD, SUM(CL_STOCK_ADJ_C_AUD) AS CL_STOCK_ADJ_C_AUD,
    SUM(TTL_STOCK_ADJ_C_AUD) AS TTL_STOCK_ADJ_C_AUD,
    SUM(FP_STOCK_ADJ_UNITS) AS FP_STOCK_ADJ_UNITS, SUM(CL_STOCK_ADJ_UNITS) AS CL_STOCK_ADJ_UNITS,
    SUM(TTL_STOCK_ADJ_UNITS) AS TTL_STOCK_ADJ_UNITS,
    SUM(SHRINK_C_AUD) AS SHRINK_C_AUD, SUM(SHRINK_BASE_AUD) AS SHRINK_BASE_AUD,
    SUM(ON_ORDER_C_AUD) AS ON_ORDER_C_AUD, SUM(ON_ORDER_R_AUD) AS ON_ORDER_R_AUD, SUM(ON_ORDER_UNITS) AS ON_ORDER_UNITS,
    SUM(UNCOMMITTED_C_AUD) AS UNCOMMITTED_C_AUD, SUM(UNCOMMITTED_R_AUD) AS UNCOMMITTED_R_AUD,
    SUM(UNCOMMITTED_UNITS) AS UNCOMMITTED_UNITS,
    SUM(OTB_C_AUD) AS OTB_C_AUD, SUM(OTB_R_AUD) AS OTB_R_AUD, SUM(OTB_UNITS) AS OTB_UNITS,
    -- to-date flows: the comparator for a part-traded period
    SUM(IFF(IS_TO_DATE, SLS_AUD, NULL))    AS SLS_AUD_TD,
    SUM(IFF(IS_TO_DATE, SLS_U, NULL))      AS SLS_U_TD,
    SUM(IFF(IS_TO_DATE, POS_GP_AUD, NULL)) AS POS_GP_AUD_TD,
    SUM(IFF(IS_TO_DATE, SLS_FP_AUD, NULL)) AS SLS_FP_AUD_TD,
    SUM(IFF(IS_TO_DATE, FP_GP_AUD, NULL))  AS FP_GP_AUD_TD,
    SUM(IFF(IS_TO_DATE, SLS_CL_AUD, NULL)) AS SLS_CL_AUD_TD,
    SUM(IFF(IS_TO_DATE, CL_GP_AUD, NULL))  AS CL_GP_AUD_TD,
    -- balances at the closing week, summed across departments
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, C_CLS_INV_AUD, NULL))   AS C_CLS_INV_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, U_CLS_INV, NULL))       AS U_CLS_INV,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, U_CLS_INV_STORE, NULL)) AS U_CLS_INV_STORE,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, U_CLS_INV_DC, NULL))    AS U_CLS_INV_DC,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, TTL_CSOH_R_AUD, NULL))  AS TTL_CSOH_R_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FP_CSOH_C_AUD, NULL))   AS FP_CSOH_C_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FP_CSOH_U, NULL))       AS FP_CSOH_U,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, CL_CSOH_C_AUD, NULL))   AS CL_CSOH_C_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, CL_CSOH_U, NULL))       AS CL_CSOH_U,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, COMMIT_R_AUD, NULL))    AS COMMIT_R_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, COMMIT_C_AUD, NULL))    AS COMMIT_C_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, U_COMMIT, NULL))        AS U_COMMIT,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, C_SOH_FEED_AUD, NULL))  AS C_SOH_FEED_AUD,
    -- forward position from the closing week
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_SLS4_AUD, NULL))     AS FWD_SLS4_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_COGS4_AUD, NULL))    AS FWD_COGS4_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_FP_COGS4_AUD, NULL)) AS FWD_FP_COGS4_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_CL_COGS4_AUD, NULL)) AS FWD_CL_COGS4_AUD,
    SUM(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_U4, NULL))           AS FWD_U4,
    MAX(IFF(ALIGNED_WEEK_END_DATE = CLOSING_WEEK, FWD_N, NULL))            AS FWD_N,
    -- department-weeks carrying a typed planner input, per planning row
    COUNT_IF(IN_MD_EXIT) AS IN_MD_EXIT, COUNT_IF(IN_MD_EXIT_GP) AS IN_MD_EXIT_GP,
    COUNT_IF(IN_MD_DEPTH) AS IN_MD_DEPTH, COUNT_IF(IN_MD_SPEND) AS IN_MD_SPEND,
    COUNT_IF(IN_MD_UNITS) AS IN_MD_UNITS, COUNT_IF(IN_SHRINK) AS IN_SHRINK,
    COUNT_IF(IN_FP_ADJ_R) AS IN_FP_ADJ_R, COUNT_IF(IN_CL_ADJ_R) AS IN_CL_ADJ_R,
    COUNT_IF(IN_FP_ADJ_C) AS IN_FP_ADJ_C, COUNT_IF(IN_CL_ADJ_C) AS IN_CL_ADJ_C,
    COUNT_IF(IN_FP_ADJ_U) AS IN_FP_ADJ_U, COUNT_IF(IN_CL_ADJ_U) AS IN_CL_ADJ_U
  FROM j
  GROUP BY GROUPING SETS ((TIME_GRAIN, PERIOD_KEY, VERSION, RBU_CODE), (TIME_GRAIN, PERIOD_KEY, VERSION))
)
SELECT p.TIME_GRAIN, p.PERIOD_KEY, p.SORT_KEY, p.PERIOD_LABEL, p.CAL_LABEL,
       p.PERIOD_START_DATE, p.PERIOD_END_DATE, p.FY_YEAR, p.FY_LABEL, p.FY_HALF, p.FY_QUARTER,
       p.FY_PERIOD_NO, p.MONTH_NAME, p.EXPECTED_WEEKS,
       s.LAST_ACTUAL_WEEK,
       a.AVAILABLE_WEEKS = p.EXPECTED_WEEKS AS IS_COMPLETE_PERIOD,
       CASE
         WHEN p.PERIOD_END_DATE <= s.LAST_ACTUAL_WEEK  THEN 'TRADED'
         WHEN p.PERIOD_START_DATE > s.LAST_ACTUAL_WEEK THEN 'FUTURE'
         ELSE 'PART_TRADED'
       END AS PERIOD_STATE,
       a.* EXCLUDE (TIME_GRAIN, PERIOD_KEY)
FROM agg a
JOIN p ON p.TIME_GRAIN = a.TIME_GRAIN AND p.PERIOD_KEY = a.PERIOD_KEY
CROSS JOIN asat s;

-- The WSSI validates itself rather than asking to be trusted. These are problems
-- in the source or the model, surfaced in the WSSI so the head of planning can see
-- what not to rely on. LE's traded weeks are this year's rows again, so they are
-- checked once, as TY.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_INTEGRITY
  COMMENT = 'WSSI self-checks: stock roll-forward, total = FP + CL, ASP orientation, implausible and negative stock, and the SOH feed against the modelled stock.'
AS
WITH d AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_DERIVED
  WHERE NOT (VERSION = 'LE' AND IS_ACTUAL)
)
SELECT 'STOCK_ROLLFORWARD' AS CHECK_NAME, VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       C_CLS_INV_AUD AS REPORTED, C_CLS_INV_ROLLFWD_AUD AS EXPECTED,
       ROUND(C_CLS_INV_AUD - C_CLS_INV_ROLLFWD_AUD, 2) AS VARIANCE,
       'Closing stock should equal last closing - (sales - POS margin) + receipts at cost' AS RULE
FROM d
WHERE C_CLS_INV_ROLLFWD_AUD IS NOT NULL
  AND ABS(C_CLS_INV_AUD - C_CLS_INV_ROLLFWD_AUD) > GREATEST(ABS(C_CLS_INV_AUD) * 0.01, 1000)
UNION ALL
SELECT 'TOTAL_EQ_FP_PLUS_CL', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       SLS_AUD, NVL(SLS_FP_AUD, 0) + NVL(SLS_CL_AUD, 0),
       ROUND(SLS_AUD - NVL(SLS_FP_AUD, 0) - NVL(SLS_CL_AUD, 0), 2),
       'Total sales should equal full price plus clearance'
FROM d
WHERE SLS_FP_AUD IS NOT NULL
  AND ABS(SLS_AUD - NVL(SLS_FP_AUD, 0) - NVL(SLS_CL_AUD, 0)) > GREATEST(ABS(SLS_AUD) * 0.01, 100)
UNION ALL
SELECT 'ASP_ORIENTATION', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       SLS_AUD / NULLIF(SLS_U, 0), NULL, NULL,
       'ASP is sales over units. Below 1 with material sales means units and dollars are inverted'
FROM d
WHERE SLS_U > 0 AND SLS_AUD > 1000 AND SLS_AUD / SLS_U < 1
UNION ALL
SELECT 'IMPLAUSIBLE_COVER', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       C_CLS_INV_AUD / NULLIF(FWD_COGS4_AUD / NULLIF(FWD_N, 0), 0), NULL, NULL,
       'Forward cover above 104 weeks means stale stock or a broken denominator'
FROM d
WHERE C_CLS_INV_AUD / NULLIF(FWD_COGS4_AUD / NULLIF(FWD_N, 0), 0) > 104
UNION ALL
SELECT 'NEGATIVE_STOCK', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       C_CLS_INV_AUD, NULL, NULL, 'Closing stock at cost should not be negative'
FROM d
WHERE C_CLS_INV_AUD < 0
UNION ALL
SELECT 'SOH_FEED_VS_MODEL', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       C_SOH_FEED_AUD, C_CLS_INV_AUD, ROUND(C_SOH_FEED_AUD - C_CLS_INV_AUD, 2),
       'The store SOH feed should agree with the modelled stock within 25%. It does not, which is why stock is modelled'
FROM d
WHERE VERSION = 'TY' AND C_SOH_FEED_AUD IS NOT NULL
  AND ABS(C_SOH_FEED_AUD - C_CLS_INV_AUD) > 0.25 * NULLIF(C_CLS_INV_AUD, 0)
UNION ALL
SELECT 'SOH_FEED_IMPLAUSIBLE_COVER', VERSION, DEPARTMENT_NAME, WEEK_END_DATE,
       C_SOH_FEED_AUD / NULLIF(FWD_COGS4_AUD / NULLIF(FWD_N, 0), 0), 26, NULL,
       'Cover implied by the SOH feed is above 26 weeks: the feed is not a stock position to trade on'
FROM d
WHERE VERSION = 'TY' AND C_SOH_FEED_AUD / NULLIF(FWD_COGS4_AUD / NULLIF(FWD_N, 0), 0) > 26;

-- Month-level WSSI flows by version and department, with last year bucketed into
-- the month it is compared with. The MFP reconciliation reads this.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_PERIOD
  COMMENT = 'WSSI flows by fiscal month, version and department. LY bucketed into the month it is compared with.'
AS
SELECT c.PERIOD_KEY, c.FY_YEAR, c.FY_LABEL, c.FY_HALF, c.FY_PERIOD_NO, c.MONTH_NAME,
       e.VERSION, e.RBU_CODE, e.DEPARTMENT_NUM, e.DEPARTMENT_NAME,
       SUM(e.SLS_AUD) AS SLS_AUD, SUM(e.SLS_U) AS SLS_U, SUM(e.POS_GP_AUD) AS POS_GP_AUD,
       SUM(e.SLS_CL_AUD) AS SLS_CL_AUD, COUNT(DISTINCT e.WEEK_END_DATE) AS WEEKS,
       COUNT_IF(e.IS_ACTUAL) AS ACTUAL_ROWS
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_EXTENDED e
JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_CALENDAR_WEEK c ON c.WEEK_END_DATE = e.ALIGNED_WEEK_END_DATE
GROUP BY c.PERIOD_KEY, c.FY_YEAR, c.FY_LABEL, c.FY_HALF, c.FY_PERIOD_NO, c.MONTH_NAME,
         e.VERSION, e.RBU_CODE, e.DEPARTMENT_NUM, e.DEPARTMENT_NAME;

-- Does the product plan add up to the budget being traded against? The MFP
-- (bottom-up, phased to month -- an allocation) against the WSSI budget line for
-- the same RBU and month. Unlike the reference implementation, the two overlap in
-- time, so they can be tied. A gap is the question worth asking, not a defect.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_WSSI_RECON
  COMMENT = 'MFP bottom-up (phased to month) against the WSSI budget, by RBU and month, FY27 H1.'
AS
WITH mfp AS (
  SELECT RBU_CODE, PERIOD_KEY, MONTH_NAME, FY_PERIOD_NO, SUM(MONTH_BUDGET_AUD) AS MFP_AUD
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_MFP_PHASED GROUP BY RBU_CODE, PERIOD_KEY, MONTH_NAME, FY_PERIOD_NO
), wssi AS (
  SELECT RBU_CODE, PERIOD_KEY, SUM(SLS_AUD) AS BUD_AUD
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_WSSI_PERIOD
  WHERE VERSION = 'BUD' AND FY_YEAR = 2027 AND FY_HALF = 'H1'
  GROUP BY RBU_CODE, PERIOD_KEY
)
SELECT COALESCE(m.RBU_CODE, w.RBU_CODE) AS RBU_CODE, COALESCE(m.PERIOD_KEY, w.PERIOD_KEY) AS PERIOD_KEY,
       m.MONTH_NAME, m.FY_PERIOD_NO, m.MFP_AUD, w.BUD_AUD,
       NVL(m.MFP_AUD, 0) - NVL(w.BUD_AUD, 0) AS VARIANCE_AUD,
       CASE
         WHEN m.MFP_AUD IS NULL THEN 'WSSI_ONLY'
         WHEN w.BUD_AUD IS NULL THEN 'MFP_ONLY'
         WHEN ABS(m.MFP_AUD - w.BUD_AUD) / NULLIF(w.BUD_AUD, 0) < 0.01 THEN 'TIES'
         ELSE 'DIFFERS'
       END AS STATUS
FROM mfp m FULL OUTER JOIN wssi w ON w.RBU_CODE = m.RBU_CODE AND w.PERIOD_KEY = m.PERIOD_KEY;
