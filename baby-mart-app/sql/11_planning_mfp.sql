-- ============================================================
-- Anko Global Planning — Merchandise Financial Plan (MFP) fact
--
-- Scenario 1: AI-Enabled Merchandise Financial Planning. This is the single
-- fact behind the /planning/mfp pages and the MFP half of the Cortex Agent's
-- planning tool.
--
-- SHAPE: long / narrow, deliberately mirroring the customer's "Final Roll Ups"
-- sheet (NAME, RBU, LEVEL, METRIC, Version, then period columns). Keeping the
-- customer's own shape means the wide MFP grid is a pivot in a view
-- (13_planning_views.sql) rather than a schema decision baked into the fact,
-- so adding a metric or a version never needs a DDL change.
--
--   VERSION  LY   = last year actual        BUD  = signed-off budget
--            MRCH = merchandise plan        FC   = current forecast
--
-- TWO CORRECTNESS RULES THIS SCRIPT EXISTS TO ENFORCE
--
-- 1. The hierarchy reconciles. Values are seeded ONCE at CLASS level and then
--    summed upward to DEPARTMENT and RBU. Generating each level independently
--    would let a planner drill from a department into its classes and find the
--    children don't add up to the parent, which destroys trust in the demo
--    faster than any missing feature.
--
-- 2. Ratios are recomputed, never summed. SLS_ASP, POS_GP_PCT and
--    FIRST_MARGIN_PCT are non-additive: summing three classes' margin
--    percentages gives ~135%. They are derived at every level from the
--    additive numerator/denominator aggregates instead.
--
-- DETERMINISM: no RANDOM(), no CURRENT_DATE(). Per-class variation comes from
-- ABS(HASH(...)) on the class code, which is stable across deploys AND across
-- row order (a seeded RANDOM() is only stable if the scan order is). See the
-- header of 10_planning_dimensions.sql for why this matters here.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN (
    RBU              VARCHAR(50),
    DEPARTMENT       VARCHAR(50),    -- NULL at RBU level
    DEPARTMENT_CODE  VARCHAR(10),
    CLASS            VARCHAR(50),    -- NULL at RBU and DEPARTMENT level
    CLASS_CODE       VARCHAR(10),
    PLAN_LEVEL       VARCHAR(12),    -- RBU | DEPARTMENT | CLASS
    LFL_STRATEGY     VARCHAR(1),     -- G/D at class level, dominant strategy above
    FISCAL_YEAR      VARCHAR(4),
    PERIOD_CODE      VARCHAR(10),
    PERIOD_NO        INT,
    HALF             VARCHAR(2),
    PERIOD_TYPE      VARCHAR(10),
    VERSION          VARCHAR(6),
    METRIC           VARCHAR(30),
    METRIC_TYPE      VARCHAR(10),    -- CURRENCY | UNITS | PERCENT | COUNT
    VALUE_PHP        NUMBER(18,2),
    VALUE_AUD        NUMBER(18,2)    -- = VALUE_PHP for non-CURRENCY metrics
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
WITH
-- ---------- 1. Monthly grain (MFP plans by period, not week) ----------
periods AS (
    SELECT DISTINCT FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE,
           FX_RATE_PHP_AUD
    FROM BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD
),
versions AS (
    SELECT * FROM VALUES ('LY'), ('BUD'), ('MRCH'), ('FC') AS t(VERSION)
),

-- ---------- 2. Per-class stable characteristics ----------
-- Independent pseudo-random streams from the same stable key by salting the
-- HASH with a purpose string.
class_profile AS (
    SELECT
        h.RBU, h.DEPARTMENT, h.DEPARTMENT_CODE, h.CLASS, h.CLASS_CODE,
        h.LFL_STRATEGY,
        -- LY monthly sales run rate, PHP 6M - 34M
        6000000 + (ABS(HASH(h.CLASS_CODE, 'sales')) % 28000001)        AS LY_MONTHLY_PHP,
        -- Average selling price, PHP 180 - 1,180
        180 + (ABS(HASH(h.CLASS_CODE, 'asp')) % 1001)                  AS BASE_ASP_PHP,
        -- First margin 38.0% - 53.9%
        38.0 + (ABS(HASH(h.CLASS_CODE, 'margin')) % 160) / 10.0        AS BASE_FIRST_MARGIN,
        -- Markdown / shrink drag between first margin and realised POS margin
        3.0 + (ABS(HASH(h.CLASS_CODE, 'md')) % 50) / 10.0              AS BASE_MD_DRAG,
        -- Option count 40 - 139
        40 + (ABS(HASH(h.CLASS_CODE, 'opt')) % 100)                    AS BASE_OPTIONS
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
),

-- ---------- 3. Seeded storylines ----------
-- The AI insight procedure and the exceptions view must have something TRUE to
-- find. Rather than hoping random noise produces an interesting variance, the
-- three planner conversations we want the demo to have are seeded explicitly:
--   behind budget  -> PRAMS & STROLLERS, CAR SEATS, CLOTHING
--   ahead of budget-> NAPPIES & WIPES, FEEDING
--   margin erosion -> CLOTHING holds sales but loses ~3pp of POS margin
-- Every other department lands within +/-2% of budget, i.e. business as usual.
--
-- The hardgoods departments carry the shortfall and the consumables ones trade
-- ahead, which is the shape a baby-goods planner expects: nappies and feeding
-- are repeat-purchase and defensive, while prams and car seats are
-- high-ticket, discretionary and the first thing a shopper defers. CLOTHING is
-- deliberately the one department that is BOTH behind budget and losing margin
-- -- apparel missing plan and getting marked down together is the most
-- plausible double signal in the mix, and it gives the AI assessment a case
-- where sales and margin have to be explained as one problem, not two.
storyline AS (
    SELECT
        cp.*,
        CASE cp.DEPARTMENT
            WHEN 'PRAMS & STROLLERS' THEN -0.142
            WHEN 'CAR SEATS'         THEN -0.115
            WHEN 'CLOTHING'          THEN -0.083
            WHEN 'NAPPIES & WIPES'   THEN  0.088
            WHEN 'FEEDING'           THEN  0.061
            ELSE (ABS(HASH(cp.CLASS_CODE, 'fcvar')) % 41 - 20) / 1000.0
        END AS FC_SALES_VAR,
        IFF(cp.DEPARTMENT = 'CLOTHING', 3.1, 0.0) AS FC_MARGIN_EROSION_PP
    FROM class_profile cp
),

-- ---------- 4. Class x period x version additive quantities ----------
-- Additive base only. Ratios are derived in step 6 so they stay correct at
-- every level of the hierarchy.
seasonality AS (
    SELECT * FROM VALUES
        (1,  1.05), (2,  0.95), (3,  0.98), (4,  1.02), (5,  1.15), (6,  1.45),
        (7,  1.20), (8,  0.85), (9,  0.95), (10, 1.00), (11, 1.10), (12, 1.18)
    AS t(PERIOD_NO, SEASON_FACTOR)
),
class_version AS (
    SELECT
        s.RBU, s.DEPARTMENT, s.DEPARTMENT_CODE, s.CLASS, s.CLASS_CODE,
        s.LFL_STRATEGY,
        p.FISCAL_YEAR, p.PERIOD_CODE, p.PERIOD_NO, p.HALF, p.PERIOD_TYPE,
        v.VERSION,

        -- Sales PHP -------------------------------------------------------
        -- LY   : run rate x seasonality x small stable period noise
        -- BUD  : LY grown per the like-for-like strategy (G grows, D declines)
        -- MRCH : budget with a small merchandising re-cut
        -- FC   : merchandise plan moved by the seeded storyline
        (s.LY_MONTHLY_PHP
          * sn.SEASON_FACTOR
          * (1 + (ABS(HASH(s.CLASS_CODE, p.PERIOD_CODE, 'noise')) % 121 - 60) / 1000.0)
          * IFF(p.FISCAL_YEAR = 'F27', 1.045, 1.0)   -- F27 sits above F26 overall
          * CASE v.VERSION
                WHEN 'LY'  THEN 1.0
                WHEN 'BUD' THEN 1.0 + IFF(s.LFL_STRATEGY = 'G',
                                          0.06 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 81) / 1000.0,
                                         -0.08 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 61) / 1000.0)
                WHEN 'MRCH' THEN 1.0 + IFF(s.LFL_STRATEGY = 'G',
                                          0.06 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 81) / 1000.0,
                                         -0.08 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 61) / 1000.0)
                                     + (ABS(HASH(s.CLASS_CODE, 'mrch')) % 31 - 15) / 1000.0
                ELSE        1.0 + IFF(s.LFL_STRATEGY = 'G',
                                          0.06 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 81) / 1000.0,
                                         -0.08 + (ABS(HASH(s.CLASS_CODE, 'bud')) % 61) / 1000.0)
                                     + (ABS(HASH(s.CLASS_CODE, 'mrch')) % 31 - 15) / 1000.0
                                     + s.FC_SALES_VAR
            END
        ) AS SLS_PHP,

        s.BASE_ASP_PHP
          * (1 + (ABS(HASH(s.CLASS_CODE, v.VERSION, 'aspv')) % 61 - 20) / 1000.0)
          AS ASP_PHP,

        -- Margin rates ----------------------------------------------------
        -- Margin rates ----------------------------------------------------
        -- The buy-side gain the plan assumes varies by class rather than being a
        -- flat constant. With a fixed uplift every department reported an
        -- identical GP gap to budget (-0.4pp across nine of ten), which reads as
        -- obviously generated the moment anyone scans the column.
        s.BASE_FIRST_MARGIN
          + IFF(v.VERSION IN ('BUD', 'MRCH'),
                0.15 + (ABS(HASH(s.CLASS_CODE, 'uplift')) % 111) / 100.0, 0.0)
          - IFF(v.VERSION = 'FC', s.FC_MARGIN_EROSION_PP, 0.0)
          AS FIRST_MARGIN_PCT,
        s.BASE_MD_DRAG
          + IFF(v.VERSION = 'FC', s.FC_MARGIN_EROSION_PP * 0.5, 0.0)
          -- A class-specific markdown difference between plan and forecast. The
          -- range is deliberately wide enough to swing the resulting GP gap
          -- either side of zero: with a narrower band every single department
          -- came out below budget on margin, which is not plausible.
          + IFF(v.VERSION = 'FC',
                (ABS(HASH(s.CLASS_CODE, 'mdvar')) % 161 - 110) / 100.0, 0.0)
          AS MD_DRAG_PP,

        s.BASE_OPTIONS AS BASE_OPTIONS,
        p.FX_RATE_PHP_AUD AS FX
    FROM storyline s
    CROSS JOIN periods p
    CROSS JOIN versions v
    JOIN seasonality sn ON sn.PERIOD_NO = p.PERIOD_NO
),

-- ---------- 5. Additive measures at class level ----------
class_additive AS (
    SELECT
        RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
        FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE, VERSION, FX,
        ROUND(SLS_PHP, 0)                                        AS SLS_PHP,
        ROUND(SLS_PHP * 0.955, 0)                                AS NET_SLS,
        GREATEST(1, ROUND(SLS_PHP / NULLIF(ASP_PHP, 0), 0))      AS SLS_UNITS,
        ROUND(SLS_PHP * (FIRST_MARGIN_PCT - MD_DRAG_PP) / 100.0, 0) AS POS_GP_AMT,
        ROUND(SLS_PHP * FIRST_MARGIN_PCT / 100.0, 0)             AS FIRST_MARGIN_AMT,
        -- Full price vs promotional split: G classes trade at full price more.
        ROUND(SLS_PHP * IFF(LFL_STRATEGY = 'G', 0.72, 0.58), 0)  AS FP_PHP,
        GREATEST(1, ROUND(SLS_PHP * IFF(LFL_STRATEGY = 'G', 0.72, 0.58)
                          / NULLIF(ASP_PHP * 1.08, 0), 0))       AS FP_UNITS,
        -- Option counts only carry on the plan versions; LY reports actuals.
        BASE_OPTIONS                                             AS OPT_TOTAL,
        ROUND(BASE_OPTIONS * (0.25 + (ABS(HASH(CLASS_CODE, 'new')) % 110) / 1000.0), 0) AS OPT_NEW,
        ROUND(BASE_OPTIONS * (0.08 + (ABS(HASH(CLASS_CODE, 'des')) % 70) / 1000.0), 0)  AS OPT_DESELECTED
    FROM class_version
),

-- ---------- 6. Roll up additive measures to all three levels ----------
-- GROUPING SETS gives the three levels in one pass and guarantees the parents
-- are literally SUM(children), which is the reconciliation rule above.
rolled AS (
    SELECT
        RBU,
        DEPARTMENT,
        MAX(DEPARTMENT_CODE)                              AS DEPARTMENT_CODE,
        CLASS,
        MAX(CLASS_CODE)                                   AS CLASS_CODE,
        CASE
            WHEN CLASS      IS NOT NULL THEN 'CLASS'
            WHEN DEPARTMENT IS NOT NULL THEN 'DEPARTMENT'
            ELSE 'RBU'
        END                                               AS PLAN_LEVEL,
        -- Above class level, report the dominant strategy rather than NULL so
        -- the grid can still colour a department row.
        MODE(LFL_STRATEGY)                                AS LFL_STRATEGY,
        FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE, VERSION,
        MAX(FX)                                           AS FX,
        SUM(SLS_PHP)                                      AS SLS_PHP,
        SUM(NET_SLS)                                      AS NET_SLS,
        SUM(SLS_UNITS)                                    AS SLS_UNITS,
        SUM(POS_GP_AMT)                                   AS POS_GP_AMT,
        SUM(FIRST_MARGIN_AMT)                             AS FIRST_MARGIN_AMT,
        SUM(FP_PHP)                                       AS FP_PHP,
        SUM(FP_UNITS)                                     AS FP_UNITS,
        SUM(OPT_TOTAL)                                    AS OPT_TOTAL,
        SUM(OPT_NEW)                                      AS OPT_NEW,
        SUM(OPT_DESELECTED)                               AS OPT_DESELECTED
    FROM class_additive
    GROUP BY GROUPING SETS (
        (RBU, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE, VERSION),
        (RBU, DEPARTMENT, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE, VERSION),
        (RBU, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE, VERSION)
    )
),

-- ---------- 7. Unpivot to the long metric format ----------
-- Additive metrics pass through. Ratio metrics are DERIVED here from the
-- rolled-up numerator and denominator, which is what keeps a department's
-- margin % correct rather than the sum of its classes' percentages.
--
-- Deliberately CROSS JOIN + CASE rather than a correlated LATERAL over a
-- UNION ALL: a lateral that references outer columns is the shape Snowflake
-- rejects with "Unsupported subquery type cannot be evaluated" (the same trap
-- documented in 09_battlecard_procedure.sql).
metric_list AS (
    SELECT * FROM VALUES
        ('SLS_PHP',                  'CURRENCY'),
        ('NET_SLS',                  'CURRENCY'),
        ('SLS_UNITS',                'UNITS'),
        ('POS_GP_AMT',               'CURRENCY'),
        ('FP_PHP',                   'CURRENCY'),
        ('FP_UNITS',                 'UNITS'),
        ('OPTION_COUNT_TOTAL',       'COUNT'),
        ('OPTION_COUNT_NEW',         'COUNT'),
        ('OPTION_COUNT_ONGOING',     'COUNT'),
        ('OPTION_COUNT_DESELECTED',  'COUNT'),
        ('SLS_ASP',                  'CURRENCY'),
        ('POS_GP_PCT',               'PERCENT'),
        ('FIRST_MARGIN_PCT',         'PERCENT')
    AS t(METRIC, METRIC_TYPE)
),
long AS (
    SELECT
        r.*,
        m.METRIC,
        m.METRIC_TYPE,
        CASE m.METRIC
            WHEN 'SLS_PHP'                 THEN r.SLS_PHP
            WHEN 'NET_SLS'                 THEN r.NET_SLS
            WHEN 'SLS_UNITS'               THEN r.SLS_UNITS
            WHEN 'POS_GP_AMT'              THEN r.POS_GP_AMT
            WHEN 'FP_PHP'                  THEN r.FP_PHP
            WHEN 'FP_UNITS'                THEN r.FP_UNITS
            WHEN 'OPTION_COUNT_TOTAL'      THEN r.OPT_TOTAL
            WHEN 'OPTION_COUNT_NEW'        THEN r.OPT_NEW
            WHEN 'OPTION_COUNT_ONGOING'    THEN r.OPT_TOTAL - r.OPT_NEW
            WHEN 'OPTION_COUNT_DESELECTED' THEN r.OPT_DESELECTED
            -- Derived ratios
            WHEN 'SLS_ASP'          THEN ROUND(r.SLS_PHP / NULLIF(r.SLS_UNITS, 0), 2)
            WHEN 'POS_GP_PCT'       THEN ROUND(100.0 * r.POS_GP_AMT / NULLIF(r.SLS_PHP, 0), 2)
            WHEN 'FIRST_MARGIN_PCT' THEN ROUND(100.0 * r.FIRST_MARGIN_AMT / NULLIF(r.SLS_PHP, 0), 2)
        END AS VALUE_PHP
    FROM rolled r
    CROSS JOIN metric_list m
)
SELECT
    RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL,
    LFL_STRATEGY, FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, HALF, PERIOD_TYPE,
    VERSION, METRIC, METRIC_TYPE,
    VALUE_PHP,
    -- Only CURRENCY metrics convert. Units, counts and percentages are
    -- currency-invariant, so they carry the same value in both columns and the
    -- app can toggle currency without a per-metric special case.
    IFF(METRIC_TYPE = 'CURRENCY', ROUND(VALUE_PHP / FX, 2), VALUE_PHP) AS VALUE_AUD
FROM long;
