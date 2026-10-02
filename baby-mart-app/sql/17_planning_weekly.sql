-- ============================================================
-- Anko Global Planning — weekly MFP fact and the full version set
--
-- Why this exists: the Excel workbook this app replaces plans at WEEK grain
-- with a bold month subtotal column interleaved after every fourth week, and
-- carries seven version rows per metric block. FACT_MFP_PLAN is monthly and
-- carries four versions, so neither the columns nor the rows of that grid can
-- be built from it.
--
--   COLUMNS  week, from DIM_FISCAL_PERIOD which is already weekly (4 weeks per
--            period, 96 weeks across F26 + F27). No calendar change needed.
--
--   ROWS     LLY  | LY  | BUD | APP_FC | FC | ACT       stored here
--            ACT_FC                                      derived in VW_MFP_WEEKLY
--            Var LY / Var Bud / Var App. FC / CAGR       derived in the app
--
-- THE ONE RULE THIS SCRIPT EXISTS TO ENFORCE
--
--   The four weeks of a period sum EXACTLY to that period's monthly value.
--
-- Not approximately. Every figure in the MFP talk track -- the RBU forecast,
-- the hero class's sales, each department's variance to budget -- is read from
-- FACT_MFP_PLAN. If the weekly grid rolled up a few hundred thousand out, the demo would show
-- two different totals for the same plan on two different pages, which is the
-- exact failure this codebase has already had to fix once for forward cover.
--
-- The allocation therefore works on a CUMULATIVE share and differences it:
--
--   cum_share      = running weight / total weight   (week 4 is exactly 1.0)
--   cum_allocated  = ROUND(monthly * cum_share)
--   week_value     = cum_allocated - previous cum_allocated
--
-- Because week 4's cum_share is 1.0, its cum_allocated is ROUND(monthly) and
-- the differences telescope back to the monthly total with zero residual. The
-- obvious alternative -- rounding each week independently -- leaks up to 2 PHP
-- per period, which is 4,608 PHP across the fact and would fail the
-- reconciliation check in verification step 1.
--
-- ONLY ADDITIVE METRICS ARE STORED. SLS_PHP, SLS_UNITS and POS_GP_AMT are
-- summable; SLS_ASP and POS_GP_PCT are not. Storing a weekly margin percentage
-- would make the July subtotal the mean of four percentages instead of
-- SUM(gp)/SUM(sales), which is wrong whenever the four weeks differ in size --
-- i.e. always. The ratios are derived on read, at every level and every
-- subtotal, from the additive pair.
--
-- DETERMINISM: ABS(HASH(...)) throughout, never RANDOM() or CURRENT_DATE(), per
-- the convention set in 10_planning_dimensions.sql.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Settings ----------
-- PLANNING_SETTING and VW_PLANNING_PARAM are owned by 21_planning_parameters.sql,
-- which runs before this script. The defensive CREATE below only exists so this
-- file can be run standalone against an account that has never seen 21_; the
-- allocation reads the cut-off through the pivot view, which supplies a
-- documented default when the row is missing.
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING (
    SETTING_KEY    VARCHAR(60)   NOT NULL,
    SETTING_VALUE  VARCHAR(200),
    VALUE_TYPE     VARCHAR(10),
    DESCRIPTION    VARCHAR(400),
    UPDATED_BY     VARCHAR(100),
    UPDATED_AT     TIMESTAMP_NTZ
);

-- ---------- 2. Weekly fact ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY (
    RBU               VARCHAR(50),
    DEPARTMENT        VARCHAR(50),    -- NULL at RBU level
    DEPARTMENT_CODE   VARCHAR(10),
    CLASS             VARCHAR(50),    -- NULL at RBU and DEPARTMENT level
    CLASS_CODE        VARCHAR(10),
    PLAN_LEVEL        VARCHAR(12),    -- RBU | DEPARTMENT | CLASS
    LFL_STRATEGY      VARCHAR(1),
    FISCAL_YEAR       VARCHAR(4),
    PERIOD_CODE       VARCHAR(10),
    PERIOD_NO         INT,
    MONTH_NAME        VARCHAR(20),
    HALF              VARCHAR(2),
    PERIOD_TYPE       VARCHAR(10),    -- ACTUAL | IN_FLIGHT | PLAN
    WEEK_NO           INT,            -- 1-4 within the period
    WEEK_SEQ          INT,            -- 1-96, fiscal order across F26 + F27
    WEEK_LABEL        VARCHAR(20),
    WEEK_ENDING_DATE  DATE,
    IS_CLOSED         BOOLEAN,        -- week ending on or before the actuals cut-off
    VERSION           VARCHAR(8),     -- LLY | LY | BUD | MRCH | APP_FC | FC | ACT
    METRIC            VARCHAR(30),    -- SLS_PHP | SLS_UNITS | POS_GP_AMT
    VALUE_PHP         NUMBER(18,2)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY
WITH
settings AS (
    -- Read through VW_PLANNING_PARAM so a missing row degrades to the documented
    -- default rather than making every week's IS_CLOSED flag NULL.
    SELECT ACTUALS_CUTOFF_DATE AS CUTOFF
    FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM
),

-- ---------- 2a. Week spine with a global fiscal sequence ----------
-- WEEK_SEQ is what the grid orders columns by and what CAGR walks along. It has
-- to be derived from (fiscal_year, period_no, week_no) rather than from
-- WEEK_ENDING_DATE, because a date sort would be identical here but would
-- silently break if a future calendar ever had a 53rd week.
weeks AS (
    SELECT
        p.FISCAL_YEAR, p.PERIOD_CODE, p.PERIOD_NO, p.MONTH_NAME, p.HALF,
        p.PERIOD_TYPE, p.WEEK_NO, p.WEEK_LABEL, p.WEEK_ENDING_DATE,
        ROW_NUMBER() OVER (
            ORDER BY p.FISCAL_YEAR, p.PERIOD_NO, p.WEEK_NO
        )                                                     AS WEEK_SEQ,
        (p.WEEK_ENDING_DATE <= s.CUTOFF)                      AS IS_CLOSED,
        -- Weight 220-300 before normalising, i.e. any single week sits between
        -- roughly 21% and 29% of its month. Wide enough that the weekly line
        -- has visible shape, narrow enough that no week looks like a data error.
        220 + (ABS(HASH(p.PERIOD_CODE, p.WEEK_NO, 'wkshape')) % 81) AS BASE_WEIGHT
    FROM BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD p
    CROSS JOIN settings s
),

-- ---------- 2b. Monthly class-level source, additive metrics only ----------
-- Read at CLASS level and rolled up in 2f, never read from the pre-rolled
-- DEPARTMENT and RBU rows of FACT_MFP_PLAN. Allocating a parent independently
-- of its children is how a hierarchy stops reconciling.
monthly AS (
    SELECT
        f.RBU, f.DEPARTMENT, f.DEPARTMENT_CODE, f.CLASS, f.CLASS_CODE,
        f.LFL_STRATEGY, f.FISCAL_YEAR, f.PERIOD_CODE, f.VERSION, f.METRIC,
        f.VALUE_PHP
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN f
    WHERE f.PLAN_LEVEL = 'CLASS'
      AND f.VERSION IN ('LY', 'BUD', 'MRCH', 'FC')
      AND f.METRIC  IN ('SLS_PHP', 'SLS_UNITS', 'POS_GP_AMT')
),

-- ---------- 2c. Derive the three versions the workbook needs ----------
-- LLY   two years back. Modelled exactly as LY already is: a comparative
--       stored against the same period codes, not a calendar extension. The
--       per-class growth factor is what makes the CAGR row meaningful rather
--       than a flat line.
-- APP_FC the approved forecast, seeded equal to FC. This is deliberately an
--       exact copy: it is why the source workbook's "Var App. FC" row reads
--       0.00% all the way across. Nobody has edited yet. The row comes alive
--       on its own the first time a planner changes an FC cell, with no
--       further data work.
-- ACT   actuals. Present only where the week is closed. Generated as APP_FC
--       moved by a per-week variance so the closed weeks show a real variance
--       to the approved plan -- a zero-variance actual would make the whole
--       Act block pointless to look at.
derived_versions AS (
    SELECT RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
           FISCAL_YEAR, PERIOD_CODE, VERSION, METRIC, VALUE_PHP
    FROM monthly

    UNION ALL
    -- LLY: LY discounted by 2.0% - 9.9% of class-specific growth.
    SELECT RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
           FISCAL_YEAR, PERIOD_CODE, 'LLY' AS VERSION, METRIC,
           ROUND(VALUE_PHP
                 / (1 + (20 + (ABS(HASH(CLASS_CODE, 'llygrow')) % 80)) / 1000.0), 2)
    FROM monthly
    WHERE VERSION = 'LY'

    UNION ALL
    -- APP_FC: exact copy of FC.
    SELECT RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
           FISCAL_YEAR, PERIOD_CODE, 'APP_FC' AS VERSION, METRIC, VALUE_PHP
    FROM monthly
    WHERE VERSION = 'FC'
),

-- ---------- 2d. Allocate to weeks on a cumulative share ----------
-- See the header: differencing a rounded cumulative share is what makes the
-- four weeks sum to the month exactly.
spread AS (
    SELECT
        d.RBU, d.DEPARTMENT, d.DEPARTMENT_CODE, d.CLASS, d.CLASS_CODE,
        d.LFL_STRATEGY, d.FISCAL_YEAR, d.PERIOD_CODE, d.VERSION, d.METRIC,
        w.PERIOD_NO, w.MONTH_NAME, w.HALF, w.PERIOD_TYPE,
        w.WEEK_NO, w.WEEK_SEQ, w.WEEK_LABEL, w.WEEK_ENDING_DATE, w.IS_CLOSED,
        d.VALUE_PHP AS MONTH_VALUE,
        -- Weight is salted with the class code as well as the period so two
        -- classes in the same month do not share an identical weekly shape.
        (w.BASE_WEIGHT + (ABS(HASH(d.CLASS_CODE, w.WEEK_NO, 'clswk')) % 41) - 20)
            AS WEIGHT
    FROM derived_versions d
    JOIN weeks w
      ON w.FISCAL_YEAR = d.FISCAL_YEAR
     AND w.PERIOD_CODE = d.PERIOD_CODE
),
cum AS (
    SELECT
        s.*,
        SUM(WEIGHT) OVER (
            PARTITION BY CLASS_CODE, PERIOD_CODE, VERSION, METRIC
            ORDER BY WEEK_NO
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                                   AS CUM_WEIGHT,
        SUM(WEIGHT) OVER (
            PARTITION BY CLASS_CODE, PERIOD_CODE, VERSION, METRIC
        )                                                   AS TOT_WEIGHT
    FROM spread s
),
allocated AS (
    SELECT
        c.*,
        -- Week 4's CUM_WEIGHT equals TOT_WEIGHT, so its CUM_ALLOC is exactly
        -- ROUND(MONTH_VALUE) and the differences below telescope to the month.
        ROUND(MONTH_VALUE * CUM_WEIGHT / NULLIF(TOT_WEIGHT, 0), 0) AS CUM_ALLOC
    FROM cum c
),
weekly_class AS (
    SELECT
        RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
        FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
        WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED,
        VERSION, METRIC,
        CUM_ALLOC - LAG(CUM_ALLOC, 1, 0) OVER (
            PARTITION BY CLASS_CODE, PERIOD_CODE, VERSION, METRIC
            ORDER BY WEEK_NO
        ) AS VALUE_PHP
    FROM allocated
),

-- ---------- 2e. ACT, only on closed weeks ----------
-- Built after the allocation rather than before it so the variance is genuinely
-- per week. Applying it to the monthly value first and then spreading would
-- produce four weeks that all miss the plan by the same percentage, which is
-- not what actuals look like.
--
-- Units move with sales but not identically, so ASP drifts between plan and
-- actual and the ASP line has something to say.
with_act AS (
    SELECT * FROM weekly_class

    UNION ALL
    SELECT
        RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
        FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
        WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED,
        'ACT' AS VERSION, METRIC,
        ROUND(VALUE_PHP * (1 + (
            (ABS(HASH(CLASS_CODE, WEEK_SEQ, METRIC, 'actvar')) % 141 - 70) / 1000.0
        )), 0) AS VALUE_PHP
    FROM weekly_class
    WHERE VERSION = 'APP_FC'
      AND IS_CLOSED
),

-- ---------- 2f. Roll up to all three levels in one pass ----------
rolled AS (
    SELECT
        RBU,
        DEPARTMENT,
        MAX(DEPARTMENT_CODE)  AS DEPARTMENT_CODE,
        CLASS,
        MAX(CLASS_CODE)       AS CLASS_CODE,
        CASE
            WHEN CLASS      IS NOT NULL THEN 'CLASS'
            WHEN DEPARTMENT IS NOT NULL THEN 'DEPARTMENT'
            ELSE 'RBU'
        END                   AS PLAN_LEVEL,
        MODE(LFL_STRATEGY)    AS LFL_STRATEGY,
        FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
        WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED,
        VERSION, METRIC,
        SUM(VALUE_PHP)        AS VALUE_PHP
    FROM with_act
    GROUP BY GROUPING SETS (
        (RBU, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
         WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED, VERSION, METRIC),
        (RBU, DEPARTMENT, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
         WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED, VERSION, METRIC),
        (RBU, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF, PERIOD_TYPE,
         WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED, VERSION, METRIC)
    )
)
SELECT
    RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL,
    LFL_STRATEGY, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF,
    PERIOD_TYPE, WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED,
    VERSION, METRIC, VALUE_PHP
FROM rolled;

-- ---------- 3. Read view: adds the derived ACT_FC blend ----------
-- ACT_FC is never stored. It is Act where the week is closed and FC after, so
-- storing it would create a third copy of numbers that already exist twice and
-- guarantee drift the first time either input changed.
--
-- The workbook's remaining rows -- Var LY, Var Bud, Var App. FC, CAGR -- are
-- derived in the app rather than here, because each of them is a ratio and the
-- app already has to recompute ratios live as a planner edits an FC cell.
-- Materialising them would mean the saved value and the on-screen value
-- disagreed for as long as an edit was uncommitted.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_MFP_WEEKLY AS
SELECT * FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY

UNION ALL

SELECT
    RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL,
    LFL_STRATEGY, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, MONTH_NAME, HALF,
    PERIOD_TYPE, WEEK_NO, WEEK_SEQ, WEEK_LABEL, WEEK_ENDING_DATE, IS_CLOSED,
    'ACT_FC' AS VERSION,
    METRIC,
    VALUE_PHP
FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY
WHERE (IS_CLOSED     AND VERSION = 'ACT')
   OR (NOT IS_CLOSED AND VERSION = 'FC');

-- ---------- 4. Reconciliation guard ----------
-- Deliberately a view rather than a comment promising the invariant holds. The
-- deploy script and verification step 1 both read it, and it must return zero
-- rows. Any non-zero row means a weekly column no longer adds up to its month,
-- which is the one failure mode that would put two different totals for the
-- same plan on two different pages.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_WEEKLY_RECONCILIATION AS
WITH wk AS (
    SELECT PLAN_LEVEL, DEPARTMENT, CLASS, PERIOD_CODE, VERSION, METRIC,
           SUM(VALUE_PHP) AS WEEKLY_TOTAL
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY
    WHERE VERSION IN ('LY', 'BUD', 'MRCH', 'FC')
    GROUP BY 1, 2, 3, 4, 5, 6
),
mo AS (
    SELECT PLAN_LEVEL, DEPARTMENT, CLASS, PERIOD_CODE, VERSION, METRIC,
           SUM(VALUE_PHP) AS MONTHLY_TOTAL
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE VERSION IN ('LY', 'BUD', 'MRCH', 'FC')
      AND METRIC  IN ('SLS_PHP', 'SLS_UNITS', 'POS_GP_AMT')
    GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
    COALESCE(wk.PLAN_LEVEL, mo.PLAN_LEVEL)   AS PLAN_LEVEL,
    COALESCE(wk.DEPARTMENT, mo.DEPARTMENT)   AS DEPARTMENT,
    COALESCE(wk.CLASS, mo.CLASS)             AS CLASS,
    COALESCE(wk.PERIOD_CODE, mo.PERIOD_CODE) AS PERIOD_CODE,
    COALESCE(wk.VERSION, mo.VERSION)         AS VERSION,
    COALESCE(wk.METRIC, mo.METRIC)           AS METRIC,
    wk.WEEKLY_TOTAL,
    mo.MONTHLY_TOTAL,
    COALESCE(wk.WEEKLY_TOTAL, 0) - COALESCE(mo.MONTHLY_TOTAL, 0) AS DIFF
FROM wk
FULL OUTER JOIN mo
  ON  wk.PLAN_LEVEL  = mo.PLAN_LEVEL
  AND wk.PERIOD_CODE = mo.PERIOD_CODE
  AND wk.VERSION     = mo.VERSION
  AND wk.METRIC      = mo.METRIC
  AND EQUAL_NULL(wk.DEPARTMENT, mo.DEPARTMENT)
  AND EQUAL_NULL(wk.CLASS, mo.CLASS)
WHERE COALESCE(wk.WEEKLY_TOTAL, 0) <> COALESCE(mo.MONTHLY_TOTAL, 0);
