-- ============================================================
-- Anko Global Planning — rollup views
--
--   VW_MFP_SUMMARY         wide MFP grid (the customer's spreadsheet layout)
--   VW_OTB_SUMMARY         current OTB / buy position by class and department
--   VW_PLANNING_EXCEPTIONS deterministic risks and opportunities
--
-- Requires 10_/11_/12_ to have run.
--
-- VERSION SEMANTICS FOR CLOSED PERIODS
-- FACT_MFP_PLAN carries all four versions for every period. For F26 (a closed
-- year) the version that represents the realised ACTUAL is FC: a forecast
-- converges on the actual as the period closes, which is how planning systems
-- normally reconcile. So "F26 actual" below reads VERSION = 'FC' on F26 rows.
-- The LY version on F27 rows is the like-for-like comparative the plan itself
-- carries, and it is what LFL growth is measured against.
--
-- WHY VW_PLANNING_EXCEPTIONS IS SQL AND NOT AN LLM CALL
-- Every risk and opportunity the app or the agent surfaces is detected here, in
-- deterministic SQL with an explicit threshold. The LLM in
-- 14_planning_insights_procedure.sql only writes the narrative around these
-- rows. Letting the model decide what counts as a risk would make the
-- exception list change between runs and put numbers on screen that nothing
-- can reproduce -- the same grounding discipline as 09_battlecard_procedure.sql.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. MFP summary ----------
-- Pivots the long fact into the wide layout of the customer's
-- "F27H1 Jan-Jun Merch Financial Plan" sheet. Scoped to the H1 plan horizon
-- (F27 PD07-PD12) with the like-for-like F26 H1 actual alongside.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY AS
WITH f27 AS (
    SELECT
        RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL,
        LFL_STRATEGY,
        -- Sales
        SUM(IFF(VERSION='LY'   AND METRIC='SLS_PHP',    VALUE_PHP, 0)) AS SLS_LY_PHP,
        SUM(IFF(VERSION='BUD'  AND METRIC='SLS_PHP',    VALUE_PHP, 0)) AS SLS_BUD_PHP,
        SUM(IFF(VERSION='MRCH' AND METRIC='SLS_PHP',    VALUE_PHP, 0)) AS SLS_MRCH_PHP,
        SUM(IFF(VERSION='FC'   AND METRIC='SLS_PHP',    VALUE_PHP, 0)) AS SLS_FC_PHP,
        SUM(IFF(VERSION='FC'   AND METRIC='NET_SLS',    VALUE_PHP, 0)) AS NET_SLS_FC_PHP,
        -- Units
        SUM(IFF(VERSION='LY'   AND METRIC='SLS_UNITS',  VALUE_PHP, 0)) AS UNITS_LY,
        SUM(IFF(VERSION='FC'   AND METRIC='SLS_UNITS',  VALUE_PHP, 0)) AS UNITS_FC,
        SUM(IFF(VERSION='FC'   AND METRIC='FP_UNITS',   VALUE_PHP, 0)) AS FP_UNITS_FC,
        SUM(IFF(VERSION='FC'   AND METRIC='FP_PHP',     VALUE_PHP, 0)) AS FP_PHP_FC,
        -- Gross profit (amounts are additive, so percentages get rebuilt below)
        SUM(IFF(VERSION='LY'   AND METRIC='POS_GP_AMT', VALUE_PHP, 0)) AS GP_LY_PHP,
        SUM(IFF(VERSION='BUD'  AND METRIC='POS_GP_AMT', VALUE_PHP, 0)) AS GP_BUD_PHP,
        SUM(IFF(VERSION='FC'   AND METRIC='POS_GP_AMT', VALUE_PHP, 0)) AS GP_FC_PHP,
        -- Option counts are a POINT-IN-TIME count, not a flow, so they are
        -- averaged across the six plan periods rather than summed. Summing them
        -- reports a 3-class department as carrying ~1,500 options (3 classes x
        -- ~84 options x 6 periods), which is obvious nonsense on screen.
        -- AVG(IFF(cond, val, NULL)) averages only the matching rows; using 0 as
        -- the else would drag the average toward zero across the other versions.
        AVG(IFF(VERSION='FC' AND METRIC='OPTION_COUNT_TOTAL',      VALUE_PHP, NULL)) AS OPT_TOTAL_FC,
        AVG(IFF(VERSION='FC' AND METRIC='OPTION_COUNT_NEW',        VALUE_PHP, NULL)) AS OPT_NEW_FC,
        AVG(IFF(VERSION='FC' AND METRIC='OPTION_COUNT_ONGOING',    VALUE_PHP, NULL)) AS OPT_ONGOING_FC,
        AVG(IFF(VERSION='FC' AND METRIC='OPTION_COUNT_DESELECTED', VALUE_PHP, NULL)) AS OPT_DESELECTED_FC,
        MAX(VALUE_PHP / NULLIF(VALUE_AUD, 0))                                     AS FX
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE FISCAL_YEAR = 'F27' AND PERIOD_TYPE = 'PLAN'
    GROUP BY RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL, LFL_STRATEGY
),
f26 AS (
    -- Like-for-like H1 actual: same six calendar months, prior fiscal year.
    --
    -- RBU IS PART OF THE GRAIN, and must be. At PLAN_LEVEL = 'RBU' both
    -- DEPARTMENT and CLASS are NULL, so grouping on those alone collapsed every
    -- RBU into ONE row holding the whole company's F26 sales -- which then joined
    -- to EVERY f27 RBU row. Each RBU reported the entire company's prior year
    -- (4,336.8M against its own 427.9M forecast, a nonsense -90% growth), and the
    -- whole-of-business total double-counted it to 8,673.6M.
    SELECT
        PLAN_LEVEL, RBU, DEPARTMENT, CLASS,
        SUM(IFF(METRIC='SLS_PHP',    VALUE_PHP, 0)) AS SLS_F26_PHP,
        SUM(IFF(METRIC='SLS_UNITS',  VALUE_PHP, 0)) AS UNITS_F26,
        SUM(IFF(METRIC='POS_GP_AMT', VALUE_PHP, 0)) AS GP_F26_PHP
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE FISCAL_YEAR = 'F26' AND HALF = 'H1' AND VERSION = 'FC'
    GROUP BY PLAN_LEVEL, RBU, DEPARTMENT, CLASS
)
SELECT
    a.RBU, a.DEPARTMENT, a.DEPARTMENT_CODE, a.CLASS, a.CLASS_CODE,
    a.PLAN_LEVEL, a.LFL_STRATEGY,

    -- Sales, both currencies
    a.SLS_LY_PHP, a.SLS_BUD_PHP, a.SLS_MRCH_PHP, a.SLS_FC_PHP, a.NET_SLS_FC_PHP,
    ROUND(a.SLS_BUD_PHP / a.FX, 2)                          AS SLS_BUD_AUD,
    ROUND(a.SLS_FC_PHP  / a.FX, 2)                          AS SLS_FC_AUD,
    b.SLS_F26_PHP,
    ROUND(b.SLS_F26_PHP / a.FX, 2)                          AS SLS_F26_AUD,

    -- Growth and variance. Guarded denominators throughout: a zero LY or
    -- budget must yield NULL, not a division error or a fake 0%.
    ROUND(100.0 * (a.SLS_FC_PHP - a.SLS_LY_PHP) / NULLIF(a.SLS_LY_PHP, 0), 1)   AS LFL_GROWTH_PCT,
    ROUND(100.0 * (a.SLS_FC_PHP - b.SLS_F26_PHP) / NULLIF(b.SLS_F26_PHP, 0), 1) AS TOTAL_GROWTH_PCT,
    ROUND(a.SLS_FC_PHP - a.SLS_BUD_PHP, 2)                                      AS VAR_TO_BUD_PHP,
    ROUND(100.0 * (a.SLS_FC_PHP - a.SLS_BUD_PHP) / NULLIF(a.SLS_BUD_PHP, 0), 1) AS VAR_TO_BUD_PCT,

    -- Units and ASP
    a.UNITS_LY, a.UNITS_FC, a.FP_UNITS_FC, a.FP_PHP_FC,
    ROUND(100.0 * (a.UNITS_FC - a.UNITS_LY) / NULLIF(a.UNITS_LY, 0), 1)         AS UNIT_GROWTH_PCT,
    ROUND(a.SLS_LY_PHP / NULLIF(a.UNITS_LY, 0), 2)                             AS ASP_LY_PHP,
    ROUND(a.SLS_FC_PHP / NULLIF(a.UNITS_FC, 0), 2)                             AS ASP_FC_PHP,

    -- Margin: percentages rebuilt from the additive amounts, never averaged.
    a.GP_LY_PHP, a.GP_BUD_PHP, a.GP_FC_PHP,
    ROUND(100.0 * a.GP_LY_PHP  / NULLIF(a.SLS_LY_PHP, 0), 1)                   AS GP_PCT_LY,
    ROUND(100.0 * a.GP_BUD_PHP / NULLIF(a.SLS_BUD_PHP, 0), 1)                  AS GP_PCT_BUD,
    ROUND(100.0 * a.GP_FC_PHP  / NULLIF(a.SLS_FC_PHP, 0), 1)                   AS GP_PCT_FC,
    ROUND((100.0 * a.GP_FC_PHP  / NULLIF(a.SLS_FC_PHP, 0))
        - (100.0 * a.GP_BUD_PHP / NULLIF(a.SLS_BUD_PHP, 0)), 1)                AS GP_GAP_PP,

    -- Option counts
    ROUND(a.OPT_TOTAL_FC, 0)       AS OPT_TOTAL_FC,
    ROUND(a.OPT_NEW_FC, 0)         AS OPT_NEW_FC,
    ROUND(a.OPT_ONGOING_FC, 0)     AS OPT_ONGOING_FC,
    ROUND(a.OPT_DESELECTED_FC, 0)  AS OPT_DESELECTED_FC,
    ROUND(100.0 * a.OPT_NEW_FC / NULLIF(a.OPT_TOTAL_FC, 0), 1)                 AS OPT_NEW_PCT,

    -- Share of business. Departments are measured against the RBU, classes
    -- against their own department, so each row's mix sums to 100% within its
    -- own parent.
    ROUND(100.0 * a.SLS_FC_PHP / NULLIF(
        SUM(IFF(a.PLAN_LEVEL = 'DEPARTMENT', a.SLS_FC_PHP, 0))
            OVER (PARTITION BY a.PLAN_LEVEL)
      + SUM(IFF(a.PLAN_LEVEL = 'CLASS', a.SLS_FC_PHP, 0))
            OVER (PARTITION BY a.PLAN_LEVEL, a.DEPARTMENT), 0), 1)             AS MIX_PCT,
    a.FX AS FX_RATE_PHP_AUD
FROM f27 a
LEFT JOIN f26 b
       ON b.PLAN_LEVEL = a.PLAN_LEVEL
      AND b.RBU = a.RBU
      AND COALESCE(b.DEPARTMENT, '~') = COALESCE(a.DEPARTMENT, '~')
      AND COALESCE(b.CLASS, '~')      = COALESCE(a.CLASS, '~');

-- ---------- 1b. Whole-of-business total ----------
-- ONE ROW, ALWAYS. This view exists because PLAN_LEVEL = 'RBU' stopped being a
-- single row the moment BABY-CONSUMABLES was added alongside BABY-HARDGOODS.
--
-- Two read paths assumed a lone RBU row and both broke silently or loudly:
--   * 16_assessment_procedure.sql did SELECT ... INTO over PLAN_LEVEL = 'RBU',
--     which raises "expects exactly 1 returned row, but got 2" and takes the
--     whole AI assessment down.
--   * the MFP landing API took totalRows[0] with no ORDER BY, so the headline
--     showed ONE RBU's sales above a department list covering BOTH -- a headline
--     that did not equal the sum of the rows printed underneath it.
--
-- Rolling up here rather than in each caller keeps the ratio rules in one place.
-- Every percentage is rebuilt from summed components; none is averaged across
-- the RBUs, because an average of two ratios over different sales bases is not
-- the ratio of the whole.
--
-- Option counts ARE summed here, unlike the period-averaging in VW_MFP_SUMMARY:
-- each RBU row already holds a point-in-time count, and the two RBUs range
-- disjoint products, so the business carries the sum of the two.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_MFP_TOTAL AS
WITH r AS (
    SELECT *
    FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
    WHERE PLAN_LEVEL = 'RBU'
),
t AS (
    SELECT
        SUM(NVL(SLS_LY_PHP, 0))     AS SLS_LY_PHP,
        SUM(NVL(SLS_BUD_PHP, 0))    AS SLS_BUD_PHP,
        SUM(NVL(SLS_MRCH_PHP, 0))   AS SLS_MRCH_PHP,
        SUM(NVL(SLS_FC_PHP, 0))     AS SLS_FC_PHP,
        SUM(NVL(NET_SLS_FC_PHP, 0)) AS NET_SLS_FC_PHP,
        SUM(NVL(SLS_F26_PHP, 0))    AS SLS_F26_PHP,
        SUM(NVL(UNITS_LY, 0))       AS UNITS_LY,
        SUM(NVL(UNITS_FC, 0))       AS UNITS_FC,
        SUM(NVL(FP_UNITS_FC, 0))    AS FP_UNITS_FC,
        SUM(NVL(FP_PHP_FC, 0))      AS FP_PHP_FC,
        SUM(NVL(GP_LY_PHP, 0))      AS GP_LY_PHP,
        SUM(NVL(GP_BUD_PHP, 0))     AS GP_BUD_PHP,
        SUM(NVL(GP_FC_PHP, 0))      AS GP_FC_PHP,
        SUM(NVL(OPT_TOTAL_FC, 0))       AS OPT_TOTAL_FC,
        SUM(NVL(OPT_NEW_FC, 0))         AS OPT_NEW_FC,
        SUM(NVL(OPT_ONGOING_FC, 0))     AS OPT_ONGOING_FC,
        SUM(NVL(OPT_DESELECTED_FC, 0))  AS OPT_DESELECTED_FC,
        MAX(FX_RATE_PHP_AUD)        AS FX
    FROM r
)
SELECT
    'BABY MART'    AS RBU,
    NULL           AS DEPARTMENT,
    NULL           AS DEPARTMENT_CODE,
    NULL           AS CLASS,
    NULL           AS CLASS_CODE,
    'TOTAL'        AS PLAN_LEVEL,
    NULL           AS LFL_STRATEGY,

    SLS_LY_PHP, SLS_BUD_PHP, SLS_MRCH_PHP, SLS_FC_PHP, NET_SLS_FC_PHP,
    ROUND(SLS_BUD_PHP / NULLIF(FX, 0), 2)  AS SLS_BUD_AUD,
    ROUND(SLS_FC_PHP  / NULLIF(FX, 0), 2)  AS SLS_FC_AUD,
    SLS_F26_PHP,
    ROUND(SLS_F26_PHP / NULLIF(FX, 0), 2)  AS SLS_F26_AUD,

    ROUND(100.0 * (SLS_FC_PHP - SLS_LY_PHP)  / NULLIF(SLS_LY_PHP, 0), 1)  AS LFL_GROWTH_PCT,
    ROUND(100.0 * (SLS_FC_PHP - SLS_F26_PHP) / NULLIF(SLS_F26_PHP, 0), 1) AS TOTAL_GROWTH_PCT,
    ROUND(SLS_FC_PHP - SLS_BUD_PHP, 2)                                    AS VAR_TO_BUD_PHP,
    ROUND(100.0 * (SLS_FC_PHP - SLS_BUD_PHP) / NULLIF(SLS_BUD_PHP, 0), 1) AS VAR_TO_BUD_PCT,

    UNITS_LY, UNITS_FC, FP_UNITS_FC, FP_PHP_FC,
    ROUND(100.0 * (UNITS_FC - UNITS_LY) / NULLIF(UNITS_LY, 0), 1)         AS UNIT_GROWTH_PCT,
    ROUND(SLS_LY_PHP / NULLIF(UNITS_LY, 0), 2)                            AS ASP_LY_PHP,
    ROUND(SLS_FC_PHP / NULLIF(UNITS_FC, 0), 2)                            AS ASP_FC_PHP,

    GP_LY_PHP, GP_BUD_PHP, GP_FC_PHP,
    ROUND(100.0 * GP_LY_PHP  / NULLIF(SLS_LY_PHP, 0), 1)                  AS GP_PCT_LY,
    ROUND(100.0 * GP_BUD_PHP / NULLIF(SLS_BUD_PHP, 0), 1)                 AS GP_PCT_BUD,
    ROUND(100.0 * GP_FC_PHP  / NULLIF(SLS_FC_PHP, 0), 1)                  AS GP_PCT_FC,
    ROUND((100.0 * GP_FC_PHP  / NULLIF(SLS_FC_PHP, 0))
        - (100.0 * GP_BUD_PHP / NULLIF(SLS_BUD_PHP, 0)), 1)               AS GP_GAP_PP,

    ROUND(OPT_TOTAL_FC, 0)      AS OPT_TOTAL_FC,
    ROUND(OPT_NEW_FC, 0)        AS OPT_NEW_FC,
    ROUND(OPT_ONGOING_FC, 0)    AS OPT_ONGOING_FC,
    ROUND(OPT_DESELECTED_FC, 0) AS OPT_DESELECTED_FC,
    ROUND(100.0 * OPT_NEW_FC / NULLIF(OPT_TOTAL_FC, 0), 1)                AS OPT_NEW_PCT,

    -- The whole business is by definition all of itself.
    100.0          AS MIX_PCT,
    FX             AS FX_RATE_PHP_AUD
FROM t;

-- ---------- 2. OTB summary ----------
-- The current buy position: the last week of the plan horizon, which is the
-- forward-looking position a planner acts on. Class rows and department rows
-- via GROUPING SETS so cover and OTB stay correct at both levels -- cover is a
-- ratio and must be rebuilt from summed stock over summed sales.
--
-- TARGET COVER AND THE BUY BANDS ARE NOW PARAMETERS, NOT CONSTANTS.
--
-- The target comes from PLANNING_CLASS_TARGET, where a planner can edit it, and
-- the overbuy / underbuy multipliers come from VW_PLANNING_PARAM. Both used to be
-- written out here AND in 12_planning_otb.sql AND in the class page's KPI colour
-- logic -- three copies of one rule.
--
-- FACT_OTB_POSITION still carries baked TARGET_COVER_WEEKS and BUY_STATUS
-- columns. They are the SEED SOURCE for PLANNING_CLASS_TARGET and nothing more:
-- the moment a planner edits a target they are stale, so no read path may use
-- them. VW_OTB_WEEKLY below exists precisely so the weekly table has a live
-- alternative.
--
-- OTB is likewise recomputed rather than summed from the fact, because it is a
-- function of the target: OTB is the gap between the stock the plan wants to hold
-- and what is already owned or committed. A fact column computed against the old
-- target would contradict the cover figure printed beside it.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY AS
WITH latest AS (
    SELECT MAX(WEEK_ENDING_DATE) AS WK
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION
    WHERE PERIOD_TYPE = 'PLAN'
),
current_pos AS (
    SELECT o.*
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION o
    CROSS JOIN latest l
    WHERE o.WEEK_ENDING_DATE = l.WK
),
-- Forward sales over the whole plan horizon, for a cover figure that reflects
-- the season rather than a single week.
horizon AS (
    SELECT CLASS_CODE,
           AVG(SALES_PHP)    AS AVG_WK_SLS_PHP,
           SUM(SALES_PHP)    AS HORIZON_SLS_PHP,
           SUM(MARKDOWN_PHP) AS HORIZON_MD_PHP
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION
    WHERE PERIOD_TYPE = 'PLAN'
    GROUP BY CLASS_CODE
),
-- Per-class target, editable. COALESCE back to the generated value so a class
-- added to the hierarchy without a target row still resolves.
targets AS (
    SELECT h.CLASS_CODE,
           COALESCE(t.TARGET_COVER_WEEKS, 8.0) AS TARGET_COVER_WEEKS
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
    LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET t
           ON t.CLASS_CODE = h.CLASS_CODE
)
SELECT
    c.RBU,
    c.DEPARTMENT,
    MAX(c.DEPARTMENT_CODE)                                  AS DEPARTMENT_CODE,
    c.CLASS,
    MAX(c.CLASS_CODE)                                       AS CLASS_CODE,
    IFF(c.CLASS IS NOT NULL, 'CLASS', 'DEPARTMENT')         AS PLAN_LEVEL,
    MAX(c.WEEK_ENDING_DATE)                                 AS AS_AT_WEEK,
    SUM(c.CLOSING_STOCK_UNITS)                              AS STOCK_UNITS,
    SUM(c.CLOSING_STOCK_PHP)                                AS STOCK_PHP,
    SUM(c.ON_ORDER_UNITS)                                   AS ON_ORDER_UNITS,
    SUM(c.ON_ORDER_PHP)                                     AS ON_ORDER_PHP,
    SUM(h.HORIZON_SLS_PHP)                                  AS HORIZON_SLS_PHP,
    SUM(h.HORIZON_MD_PHP)                                   AS HORIZON_MD_PHP,
    SUM(h.AVG_WK_SLS_PHP)                                   AS AVG_WK_SLS_PHP,
    -- Cover rebuilt from the aggregates, so a department's cover is its total
    -- stock over its total weekly sales -- not the average of its classes'
    -- cover figures, which would weight a tiny class the same as a huge one.
    ROUND(SUM(c.CLOSING_STOCK_PHP) / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0), 1) AS FORWARD_COVER_WEEKS,
    -- Total cover includes stock already on order. This is what BUY_STATUS is
    -- judged on, because OTB_AVAILABLE also subtracts on-order. Reporting
    -- stock-only cover alongside it is still useful ("what I hold" vs "what I
    -- have committed"), so both are exposed.
    ROUND(SUM(c.CLOSING_STOCK_PHP + c.ON_ORDER_PHP)
          / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0), 1)            AS TOTAL_COVER_WEEKS,
    -- Weighted by each class's own weekly sales, so a department's target is the
    -- target of the stock it actually holds. A plain AVG would let a tiny class
    -- pull a large department's target around.
    ROUND(SUM(t.TARGET_COVER_WEEKS * h.AVG_WK_SLS_PHP)
          / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0), 1)            AS TARGET_COVER_WEEKS,
    ROUND(SUM(h.AVG_WK_SLS_PHP * t.TARGET_COVER_WEEKS)
          - SUM(c.CLOSING_STOCK_PHP + c.ON_ORDER_PHP), 2)   AS OTB_AVAILABLE_PHP,
    ROUND(SUM(h.AVG_WK_SLS_PHP * t.TARGET_COVER_WEEKS)
          * MAX(v.OTB_PLANNED_FACTOR), 2)                   AS OTB_PLANNED_PHP,
    ROUND((SUM(h.AVG_WK_SLS_PHP * t.TARGET_COVER_WEEKS)
           - SUM(c.CLOSING_STOCK_PHP + c.ON_ORDER_PHP))
          / MAX(v.FX_RATE_PHP_AUD), 2)                      AS OTB_AVAILABLE_AUD,
    CASE
        WHEN SUM(c.CLOSING_STOCK_PHP + c.ON_ORDER_PHP) / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0)
             > (SUM(t.TARGET_COVER_WEEKS * h.AVG_WK_SLS_PHP) / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0))
               * MAX(v.OVERBUY_MULT)  THEN 'OVERBUY'
        WHEN SUM(c.CLOSING_STOCK_PHP + c.ON_ORDER_PHP) / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0)
             < (SUM(t.TARGET_COVER_WEEKS * h.AVG_WK_SLS_PHP) / NULLIF(SUM(h.AVG_WK_SLS_PHP), 0))
               * MAX(v.UNDERBUY_MULT) THEN 'UNDERBUY'
        ELSE 'BALANCED'
    END                                                     AS BUY_STATUS,
    MAX(v.OVERBUY_MULT)                                     AS OVERBUY_MULT,
    MAX(v.UNDERBUY_MULT)                                    AS UNDERBUY_MULT,
    MAX(v.FX_RATE_PHP_AUD)                                  AS FX_RATE_PHP_AUD
FROM current_pos c
JOIN horizon h ON h.CLASS_CODE = c.CLASS_CODE
JOIN targets t ON t.CLASS_CODE = c.CLASS_CODE
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v
GROUP BY GROUPING SETS ((c.RBU, c.DEPARTMENT), (c.RBU, c.DEPARTMENT, c.CLASS));

-- ---------- 2b. Weekly OTB position, with a LIVE status ----------
-- The weekly buy-position table used to read FACT_OTB_POSITION directly, which
-- meant it printed the TARGET_COVER_WEEKS and BUY_STATUS baked in at generation
-- time. Editing a cover target would have left the weekly table disagreeing with
-- the KPI card directly above it -- the same class of defect as the three
-- different forward-cover figures this codebase already had to fix once.
--
-- WK_COVER keeps its own definition: stock over THAT WEEK'S forward sales rate,
-- which is genuinely different from the horizon-average cover on the summary and
-- is labelled "Wk cover" in the UI for that reason.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_OTB_WEEKLY AS
SELECT
    o.RBU, o.DEPARTMENT, o.DEPARTMENT_CODE, o.CLASS, o.CLASS_CODE, o.LFL_STRATEGY,
    o.FISCAL_YEAR, o.PERIOD_CODE, o.PERIOD_NO, o.WEEK_NO, o.WEEK_LABEL,
    o.WEEK_ENDING_DATE, o.PERIOD_TYPE,
    o.OPENING_STOCK_UNITS, o.OPENING_STOCK_PHP,
    o.SALES_UNITS, o.SALES_PHP, o.RECEIPTS_UNITS, o.RECEIPTS_PHP,
    o.MARKDOWN_UNITS, o.MARKDOWN_PHP, o.ON_ORDER_UNITS, o.ON_ORDER_PHP,
    o.CLOSING_STOCK_UNITS, o.CLOSING_STOCK_PHP,
    o.FORWARD_COVER_WEEKS,
    COALESCE(t.TARGET_COVER_WEEKS, 8.0)                     AS TARGET_COVER_WEEKS,
    -- OTB recomputed against the live target, for the same reason as above.
    ROUND((o.SALES_PHP * COALESCE(t.TARGET_COVER_WEEKS, 8.0))
          - (o.CLOSING_STOCK_PHP + o.ON_ORDER_PHP), 2)      AS OTB_AVAILABLE_PHP,
    ROUND(o.SALES_PHP * COALESCE(t.TARGET_COVER_WEEKS, 8.0)
          * v.OTB_PLANNED_FACTOR, 2)                        AS OTB_PLANNED_PHP,
    CASE
        WHEN (o.CLOSING_STOCK_PHP + o.ON_ORDER_PHP) / NULLIF(o.SALES_PHP, 0)
             > COALESCE(t.TARGET_COVER_WEEKS, 8.0) * v.OVERBUY_MULT  THEN 'OVERBUY'
        WHEN (o.CLOSING_STOCK_PHP + o.ON_ORDER_PHP) / NULLIF(o.SALES_PHP, 0)
             < COALESCE(t.TARGET_COVER_WEEKS, 8.0) * v.UNDERBUY_MULT THEN 'UNDERBUY'
        ELSE 'BALANCED'
    END                                                     AS BUY_STATUS,
    v.FX_RATE_PHP_AUD
FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION o
LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET t ON t.CLASS_CODE = o.CLASS_CODE
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v;

-- ---------- 2c. Buy-status preview for the settings page ----------
-- Reads VW_OTB_SUMMARY, NOT a hand-rolled cover calculation. An earlier draft
-- computed its own cover from a different denominator and reported 4 overbuy / 0
-- underbuy where the real view says 4 / 3 -- a settings preview that contradicts
-- the pages it is previewing is worse than no preview.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_BUY_STATUS_PREVIEW AS
SELECT DEPARTMENT, CLASS, TARGET_COVER_WEEKS, TOTAL_COVER_WEEKS,
       FORWARD_COVER_WEEKS, OTB_AVAILABLE_PHP, BUY_STATUS,
       OVERBUY_MULT, UNDERBUY_MULT
FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
WHERE PLAN_LEVEL = 'CLASS';

-- ---------- 3. Planning exceptions ----------
-- One row per detected risk or opportunity, with the threshold that fired it.
-- This is the proactive-insight surface for both the app and the agent.
--
-- EVERY THRESHOLD IS A PARAMETER, and each row now names the setting that fired
-- it in THRESHOLD_SETTING_KEY. That column is what lets the UI show "this fired
-- because EXC_SALES_RISK_PCT is -5" without hardcoding the number a second time
-- in the page -- which is exactly how the buy bands ended up with three copies.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_PLANNING_EXCEPTIONS AS
-- (a) Sales shortfall vs budget, department level
SELECT
    'SALES_RISK'                                            AS EXCEPTION_TYPE,
    IFF(m.VAR_TO_BUD_PCT <= v.SALES_RISK_HIGH_PCT, 'HIGH', 'MEDIUM') AS SEVERITY,
    'DEPARTMENT'                                            AS PLAN_LEVEL,
    m.DEPARTMENT                                            AS NODE,
    m.DEPARTMENT                                            AS DEPARTMENT,
    NULL                                                    AS CLASS,
    'Sales vs budget'                                       AS METRIC,
    m.VAR_TO_BUD_PCT                                        AS VARIANCE_PCT,
    m.VAR_TO_BUD_PHP                                        AS VARIANCE_PHP,
    'EXC_SALES_RISK_PCT'                                    AS THRESHOLD_SETTING_KEY,
    v.SALES_RISK_PCT                                        AS THRESHOLD_VALUE,
    m.DEPARTMENT || ' is forecast ' || ABS(m.VAR_TO_BUD_PCT) || '% below budget'
        || ' (PHP ' || TO_VARCHAR(ROUND(ABS(m.VAR_TO_BUD_PHP)/1e6, 1)) || 'M)'
                                                            AS HEADLINE
FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY m
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v
WHERE m.PLAN_LEVEL = 'DEPARTMENT' AND m.VAR_TO_BUD_PCT <= v.SALES_RISK_PCT

UNION ALL
-- (b) Sales upside vs budget
SELECT
    'SALES_OPPORTUNITY',
    IFF(m.VAR_TO_BUD_PCT >= v.SALES_OPP_HIGH_PCT, 'HIGH', 'MEDIUM'),
    'DEPARTMENT', m.DEPARTMENT, m.DEPARTMENT, NULL,
    'Sales vs budget', m.VAR_TO_BUD_PCT, m.VAR_TO_BUD_PHP,
    'EXC_SALES_OPP_PCT', v.SALES_OPP_PCT,
    m.DEPARTMENT || ' is forecast ' || m.VAR_TO_BUD_PCT || '% above budget'
        || ' (PHP ' || TO_VARCHAR(ROUND(m.VAR_TO_BUD_PHP/1e6, 1)) || 'M upside)'
FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY m
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v
WHERE m.PLAN_LEVEL = 'DEPARTMENT' AND m.VAR_TO_BUD_PCT >= v.SALES_OPP_PCT

UNION ALL
-- (c) Margin erosion: the plan holds sales but loses rate. Worth flagging
-- separately because a sales-only view shows these departments as healthy.
SELECT
    'MARGIN_EROSION',
    IFF(m.GP_GAP_PP <= v.MARGIN_GAP_HIGH_PP, 'HIGH', 'MEDIUM'),
    'DEPARTMENT', m.DEPARTMENT, m.DEPARTMENT, NULL,
    'POS margin vs budget', m.GP_GAP_PP,
    ROUND(m.SLS_FC_PHP * m.GP_GAP_PP / 100.0, 2),
    'EXC_MARGIN_GAP_PP', v.MARGIN_GAP_PP,
    m.DEPARTMENT || ' POS margin is ' || ABS(m.GP_GAP_PP) || 'pp below budget at '
        || m.GP_PCT_FC || '% vs ' || m.GP_PCT_BUD || '%'
FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY m
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v
WHERE m.PLAN_LEVEL = 'DEPARTMENT' AND m.GP_GAP_PP <= v.MARGIN_GAP_PP

UNION ALL
-- (d) Overbought classes. Quotes TOTAL cover (stock + on order), which is what
-- BUY_STATUS is judged on, so the headline explains the flag rather than citing
-- a different number to the one that triggered it.
--
-- HIGH severity at twice the overbuy multiplier rather than a flat 2x, so raising
-- the overbuy band raises the HIGH bar with it instead of leaving every newly
-- flagged class immediately HIGH.
SELECT
    'OVERBUY',
    IFF(o.TOTAL_COVER_WEEKS > o.TARGET_COVER_WEEKS * o.OVERBUY_MULT * 1.25,
        'HIGH', 'MEDIUM'),
    'CLASS', o.CLASS, o.DEPARTMENT, o.CLASS,
    'Cover incl. on order vs target',
    ROUND(o.TOTAL_COVER_WEEKS - o.TARGET_COVER_WEEKS, 1),
    o.OTB_AVAILABLE_PHP,
    'BUY_OVERBUY_MULT', o.OVERBUY_MULT,
    o.CLASS || ' is overbought at ' || o.TOTAL_COVER_WEEKS
        || ' weeks cover including on order, vs ' || o.TARGET_COVER_WEEKS || ' target'
FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY o
WHERE o.PLAN_LEVEL = 'CLASS' AND o.BUY_STATUS = 'OVERBUY'

UNION ALL
-- (e) Underbought classes
SELECT
    'UNDERBUY',
    IFF(o.TOTAL_COVER_WEEKS < o.TARGET_COVER_WEEKS * o.UNDERBUY_MULT * 0.6,
        'HIGH', 'MEDIUM'),
    'CLASS', o.CLASS, o.DEPARTMENT, o.CLASS,
    'Cover incl. on order vs target',
    ROUND(o.TOTAL_COVER_WEEKS - o.TARGET_COVER_WEEKS, 1),
    o.OTB_AVAILABLE_PHP,
    'BUY_UNDERBUY_MULT', o.UNDERBUY_MULT,
    o.CLASS || ' is underbought at ' || o.TOTAL_COVER_WEEKS
        || ' weeks cover including on order, vs ' || o.TARGET_COVER_WEEKS || ' target'
FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY o
WHERE o.PLAN_LEVEL = 'CLASS' AND o.BUY_STATUS = 'UNDERBUY'

UNION ALL
-- (f) Supply-side risk: a supplier with a cluster of slipped ETAs. The minimum
-- count exists so a single late delivery does not raise an exception.
SELECT
    'SUPPLIER_DELAY',
    IFF(COUNT(*) >= MAX(v.SUPPLIER_DELAY_HIGH), 'HIGH', 'MEDIUM'),
    'SUPPLIER', c.SUPPLIER_NAME, NULL, NULL,
    'Delayed purchase orders',
    ROUND(AVG(c.ETA_SLIP_DAYS), 1),
    SUM(c.COMMITTED_PHP),
    'EXC_SUPPLIER_DELAY_MIN', MAX(v.SUPPLIER_DELAY_MIN),
    c.SUPPLIER_NAME || ' has ' || COUNT(*) || ' delayed POs averaging '
        || ROUND(AVG(c.ETA_SLIP_DAYS), 0) || ' days late, PHP '
        || TO_VARCHAR(ROUND(SUM(c.COMMITTED_PHP)/1e6, 1)) || 'M committed'
FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT c
CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM v
WHERE c.STATUS = 'DELAYED'
GROUP BY c.SUPPLIER_NAME
HAVING COUNT(*) >= MAX(v.SUPPLIER_DELAY_MIN);
