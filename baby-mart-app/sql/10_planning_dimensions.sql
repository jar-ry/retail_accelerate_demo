-- ============================================================
-- Baby Mart Global Planning — merchandise hierarchy + fiscal calendar
--
-- Reference dimensions for the Global Planning persona (Head of Central
-- Planning & Inventory, Planning Manager, Merchandise Planner). Everything
-- in the planning use case plans and drills RBU -> DEPARTMENT -> CLASS,
-- so these two tables are the spine that 11_/12_/13_ all join back to.
--
--   DIM_MERCH_HIERARCHY  2 RBUs, 5 departments, 25 classes
--   DIM_FISCAL_PERIOD    F26 + F27, monthly and weekly grain, PHP/AUD FX
--
-- FISCAL CALENDAR CONVENTION (derived from the customer's Final Roll Ups
-- sheet, where PD07F26 = JANUARY ... PD12F26 = JUNE):
--   * the fiscal year starts in JULY, so PD01 = Jul ... PD12 = Jun
--   * HALF is the CALENDAR half, which is why H1 = Jan-Jun = PD07..PD12
--     and H2 = Jul-Dec = PD01..PD06. That inversion looks wrong at a
--     glance but it is what makes the plan title "F27H1 Jan-Jun Merch
--     Financial Plan" line up with PD07F27..PD12F27.
--
-- DETERMINISM: unlike 02_/03_/04_ in this directory, nothing here (or in
-- 11_/12_) uses bare RANDOM() or CURRENT_DATE(). A financial plan has to
-- reproduce exactly across deploys: if a variance the Cortex Agent quotes
-- does not match the number on the grid after a redeploy, the demo breaks.
-- All randomness downstream is seeded, and PERIOD_TYPE below is pinned to
-- fixed periods rather than the wall clock for the same reason.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Merchandise hierarchy ----------
-- Hand-seeded rather than generated: this is reference data, so it follows the
-- literal VALUES pattern from 01_dim_supplier.sql. The department and class
-- names mirror CURATED.DIM_PRODUCT so planning and category reporting agree on
-- what the merchandise is called.
--
-- DEPARTMENT_CODE reproduces the "NNN - NAME" display convention from the
-- customer's MFP sheet (e.g. "500 - FOOD/EVENTS"). LFL_STRATEGY carries the
-- G(row) / D(ecline) like-for-like flag shown in that sheet's first column
-- group, and drives which classes the AI treats as intentional declines
-- versus genuine risks.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY (
    RBU              VARCHAR(50),
    DEPARTMENT       VARCHAR(50),
    DEPARTMENT_CODE  VARCHAR(10),
    CLASS            VARCHAR(50),
    CLASS_CODE       VARCHAR(10),
    LFL_STRATEGY     VARCHAR(1)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY VALUES
-- THE CLASS CODES ARE LOAD-BEARING. Every generated figure downstream -- option
-- count, sales, ASP, margin, the shape of the productivity tail -- derives from
-- ABS(HASH(CLASS_CODE, ...)). Renaming a class is safe; RENUMBERING one silently
-- changes its whole commercial profile. The codes follow DDCC: department code
-- then class ordinal within it.
--
-- The hierarchy mirrors the real Baby Mart POS hierarchy in
-- CURATED.DIM_PRODUCT (CATEGORY -> CLASS), so the planning persona and the
-- category persona name the same merchandise. ONE DELIBERATE DEVIATION: the POS
-- data calls four separate classes "Accessories", one per category. A duplicate
-- class name breaks PARSE_SCENARIO_PROMPT (which resolves on class name alone),
-- the class-only /planning/options/{class} route, VW_PLANNING_EXCEPTIONS.NODE
-- and the agent's class dimension -- so each is prefixed with its department.
--
-- TWO RBUs, deliberately. Four separate read paths once assumed there was only
-- ever one (the assessment's SELECT ... INTO, the MFP headline's totalRows[0],
-- the f26 like-for-like join, and the RBU-level insight scoping). Keeping a
-- second RBU means those stay exercised instead of rotting -- see VW_MFP_TOTAL
-- in 13_planning_views.sql.
('BABY-CONSUMABLES', 'NAPPIES & WIPES',   '010', 'NEWBORN NAPPIES',      '0101', 'G'),
('BABY-CONSUMABLES', 'NAPPIES & WIPES',   '010', 'CRAWLER NAPPIES',      '0102', 'G'),
('BABY-CONSUMABLES', 'NAPPIES & WIPES',   '010', 'TODDLER NAPPIES',      '0103', 'G'),
('BABY-CONSUMABLES', 'NAPPIES & WIPES',   '010', 'PULL-UPS',             '0104', 'G'),
('BABY-CONSUMABLES', 'NAPPIES & WIPES',   '010', 'WIPES',                '0105', 'D'),
('BABY-CONSUMABLES', 'FEEDING',           '020', 'BOTTLES',              '0201', 'G'),
('BABY-CONSUMABLES', 'FEEDING',           '020', 'BREAST PUMPS',         '0202', 'G'),
('BABY-CONSUMABLES', 'FEEDING',           '020', 'HIGHCHAIRS',           '0203', 'G'),
('BABY-CONSUMABLES', 'FEEDING',           '020', 'STERILISERS',          '0204', 'D'),
('BABY-CONSUMABLES', 'FEEDING',           '020', 'FEEDING ACCESSORIES',  '0205', 'G'),
('BABY-HARDGOODS',   'CLOTHING',          '030', 'BODYSUITS & ONESIES',  '0301', 'G'),
('BABY-HARDGOODS',   'CLOTHING',          '030', 'SLEEPWEAR',            '0302', 'G'),
('BABY-HARDGOODS',   'CLOTHING',          '030', 'OUTERWEAR',            '0303', 'D'),
('BABY-HARDGOODS',   'CLOTHING',          '030', 'FOOTWEAR',             '0304', 'G'),
('BABY-HARDGOODS',   'CLOTHING',          '030', 'CLOTHING ACCESSORIES', '0305', 'G'),
('BABY-HARDGOODS',   'CAR SEATS',         '040', 'CAPSULE 0-6M',         '0401', 'G'),
('BABY-HARDGOODS',   'CAR SEATS',         '040', 'CONVERTIBLE 0-4Y',     '0402', 'G'),
('BABY-HARDGOODS',   'CAR SEATS',         '040', 'BOOSTER 4-8Y',         '0403', 'G'),
('BABY-HARDGOODS',   'CAR SEATS',         '040', 'HARNESS BOOSTER',      '0404', 'D'),
('BABY-HARDGOODS',   'CAR SEATS',         '040', 'CAR SEAT ACCESSORIES', '0405', 'G'),
-- 0504 TRAVEL SYSTEM is the demo's hero class: a planned decline, inside the
-- department furthest behind budget, and flagged OVERBUY in 12_planning_otb.sql.
-- Travel systems being wound back in favour of modular strollers while stock
-- keeps arriving is a story a baby-goods planner recognises immediately, and
-- prams are high-ticket so cutting the tail releases real money.
('BABY-HARDGOODS',   'PRAMS & STROLLERS', '050', 'SINGLE STROLLER',      '0501', 'G'),
('BABY-HARDGOODS',   'PRAMS & STROLLERS', '050', 'DOUBLE STROLLER',      '0502', 'G'),
('BABY-HARDGOODS',   'PRAMS & STROLLERS', '050', 'CAPSULE STROLLER',     '0503', 'G'),
('BABY-HARDGOODS',   'PRAMS & STROLLERS', '050', 'TRAVEL SYSTEM',        '0504', 'D'),
('BABY-HARDGOODS',   'PRAMS & STROLLERS', '050', 'PRAM ACCESSORIES',     '0505', 'G');

-- ---------- 2. Fiscal calendar ----------
-- Weekly grain, 4 weeks per period (48 weeks/year). A real 4-4-5 retail
-- calendar has 52, but the OTB pages only ever compare week-on-week within
-- a period, so an even 4 keeps the weekly roll-ups clean without changing
-- any of the planning arithmetic.
--
-- FX_RATE_PHP_AUD is held here as DATA, not hardcoded in the app or the
-- views, so the PHP/AUD toggle on the planning pages has a single source of
-- truth. 36.1 is the rate on the customer's Final Roll Ups sheet.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD (
    FISCAL_YEAR       VARCHAR(4),
    PERIOD_NO         INT,
    PERIOD_CODE       VARCHAR(10),
    MONTH_NAME        VARCHAR(20),
    PERIOD_START      DATE,
    HALF              VARCHAR(2),
    WEEK_NO           INT,
    WEEK_LABEL        VARCHAR(20),
    WEEK_ENDING_DATE  DATE,
    FX_RATE_PHP_AUD   NUMBER(10,4),
    PERIOD_TYPE       VARCHAR(10)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD
WITH spine AS (
    -- 2 fiscal years x 12 periods x 4 weeks = 96 rows
    SELECT
        FLOOR(SEQ4() / 48)              AS FY_OFFSET,
        MOD(FLOOR(SEQ4() / 4), 12) + 1  AS PERIOD_NO,
        MOD(SEQ4(), 4) + 1              AS WEEK_NO
    FROM TABLE(GENERATOR(ROWCOUNT => 96))
),
dated AS (
    SELECT
        'F' || (26 + FY_OFFSET)::STRING AS FISCAL_YEAR,
        PERIOD_NO,
        WEEK_NO,
        -- F26 starts 2025-07-01, F27 starts 2026-07-01
        DATEADD(MONTH, PERIOD_NO - 1,
            DATEADD(YEAR, FY_OFFSET, '2025-07-01'::DATE)) AS PERIOD_START
    FROM spine
)
SELECT
    FISCAL_YEAR,
    PERIOD_NO,
    'PD' || LPAD(PERIOD_NO::STRING, 2, '0') || FISCAL_YEAR AS PERIOD_CODE,
    UPPER(MONTHNAME(PERIOD_START))                          AS MONTH_NAME,
    PERIOD_START,
    -- Calendar half, not fiscal half: see the header note.
    IFF(PERIOD_NO <= 6, 'H2', 'H1')                         AS HALF,
    WEEK_NO,
    'W' || WEEK_NO::STRING                                  AS WEEK_LABEL,
    DATEADD(DAY, (WEEK_NO * 7) - 1, PERIOD_START)           AS WEEK_ENDING_DATE,
    36.1                                                    AS FX_RATE_PHP_AUD,
    -- Pinned to periods, never CURRENT_DATE(), so the actual/plan split
    -- cannot drift as the demo ages:
    --   F26            -> closed year, full actuals
    --   F27 PD01-PD06  -> Jul-Dec 2026, trading in flight
    --   F27 PD07-PD12  -> Jan-Jun 2027, THE PLAN HORIZON
    CASE
        WHEN FISCAL_YEAR = 'F26'  THEN 'ACTUAL'
        WHEN PERIOD_NO   <= 6     THEN 'IN_FLIGHT'
        ELSE 'PLAN'
    END                                                     AS PERIOD_TYPE
FROM dated;
