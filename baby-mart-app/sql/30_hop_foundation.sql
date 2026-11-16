-- ============================================================
-- Head of Planning (WSSI and MFP) — foundation
--
-- Rebuilds the planning chain the head of planning asked one question of --
-- "does the product plan deliver the budget?" -- on Baby Mart's own data:
--
--   store plan  ->  RBU mix  ->  MFP product plan  ->  committed range
--
-- Lives in its own schema, BABY_MART_DEMO.HEAD_OF_PLANNING. Three object names
-- (DIM_MERCH_HIERARCHY, PLANNING_SETTING, PLANNING_REASON_CODE) already exist in
-- ANALYTICS with different shapes for the Global Planning tab, so sharing a
-- schema would break that tab rather than extend it.
--
-- PROVENANCE, stated once here and carried to every cell:
--   REAL       last-year store x week sales, this-year actuals, the FP/CL split,
--              first and exit margin, option counts, supplier short-ship
--   GENERATED  every PLAN: drivers, budget, forecast, product plan, targets.
--              Seeded rules only -- no RANDOM(), no CURRENT_DATE() -- so a figure
--              the AI quotes still matches the grid after a redeploy.
--   MODELLED   weekly stock. The store SOH feed implies 60-113 weeks of cover
--              against POS (see DATA_QUALITY_FINDING), which no planner would
--              trade on, so stock is modelled at plan cover and flagged.
--
-- CURRENCY is AUD throughout: Baby Mart's stores, POS and margins are AUD, so the
-- last-year base ties to real transactions to the cent.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;

CREATE SCHEMA IF NOT EXISTS BABY_MART_DEMO.HEAD_OF_PLANNING
  COMMENT = 'Head of Planning - WSSI and MFP. Store plan -> RBU mix -> MFP -> range, on Baby Mart data, AUD.';
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ---------- 1. The calendar spine ----------
-- THE ONE CALENDAR OBJECT. Every surface derives its columns from this table (and
-- the views over it) rather than building period logic locally.
--
-- WHY TWO KEYS ON EVERY WEEK. "FY27 H1" means different weeks in different places
-- in this very app: the Global Planning tab labels Jan-Jun 2027 as F27 H1, while
-- Baby Mart's own DIM_DATE runs a Jul-Jun fiscal year, which makes FY27 H1
-- Jul-Dec 2026. A bare "FY27" is therefore never rendered: every half carries
-- both its fiscal key and its calendar months ("FY27 H1 - Jul-Dec 2026").
--
-- 4-4-5 retail calendar, weeks Monday to Sunday. FY25 week 1 is Mon 1 Jul 2024 --
-- the first day of Baby Mart's POS -- and every year is exactly 52 weeks, so
-- last year is always the same week 364 days earlier. A 53rd week is not modelled
-- (stated here so it is not mistaken for an oversight: none falls in FY25-FY27).
--
-- Periods are named by month (P1 = JUL) but a 4-4-5 period starts on a Monday,
-- so P1 JUL FY27 begins on 29 Jun 2026 and P3 SEP spans calendar August and
-- September. SPANS_TWO_CAL_MONTHS in VW_CALENDAR_PERIOD says so rather than
-- hiding it.
CREATE OR REPLACE TABLE DIM_CALENDAR_WEEK
  COMMENT = 'Week spine FY25-FY27, 4-4-5, Mon-Sun. Carries both the Baby Mart fiscal key and the calendar key on every week.'
AS
WITH n AS (
  SELECT SEQ4() AS N FROM TABLE(GENERATOR(ROWCOUNT => 156))
), b AS (
  SELECT N,
         DATEADD(day, 7 * N,     '2024-07-01'::DATE) AS WEEK_START_DATE,
         DATEADD(day, 7 * N + 6, '2024-07-01'::DATE) AS WEEK_END_DATE,
         2025 + FLOOR(N / 52)::INT                   AS FY_YEAR,
         MOD(N, 52) + 1                              AS FY_WEEK_NO
  FROM n
), q AS (
  SELECT b.*,
         CEIL(FY_WEEK_NO / 13)::INT                              AS FY_QUARTER_NO,
         FY_WEEK_NO - 13 * (CEIL(FY_WEEK_NO / 13)::INT - 1)      AS WEEK_IN_QUARTER
  FROM b
), p AS (
  SELECT q.*,
         3 * (FY_QUARTER_NO - 1)
           + CASE WHEN WEEK_IN_QUARTER <= 4 THEN 1 WHEN WEEK_IN_QUARTER <= 8 THEN 2 ELSE 3 END
                                                                 AS FY_PERIOD_NO,
         WEEK_IN_QUARTER
           - CASE WHEN WEEK_IN_QUARTER <= 4 THEN 0 WHEN WEEK_IN_QUARTER <= 8 THEN 4 ELSE 8 END
                                                                 AS WEEK_IN_PERIOD,
         IFF(WEEK_IN_QUARTER <= 8, 4, 5)                         AS WEEKS_IN_PERIOD
  FROM q
)
SELECT
  WEEK_START_DATE,
  WEEK_END_DATE,
  FY_YEAR,
  'FY' || RIGHT(FY_YEAR::STRING, 2)                              AS FY_LABEL,
  IFF(FY_PERIOD_NO <= 6, 'H1', 'H2')                             AS FY_HALF,
  'Q' || FY_QUARTER_NO                                           AS FY_QUARTER,
  FY_PERIOD_NO,
  FY_WEEK_NO,
  WEEK_IN_PERIOD,
  WEEKS_IN_PERIOD,
  DECODE(FY_PERIOD_NO, 1,'JUL', 2,'AUG', 3,'SEP', 4,'OCT', 5,'NOV', 6,'DEC',
                       7,'JAN', 8,'FEB', 9,'MAR', 10,'APR', 11,'MAY', 12,'JUN') AS MONTH_NAME,
  'FY' || RIGHT(FY_YEAR::STRING, 2) || 'P' || LPAD(FY_PERIOD_NO, 2, '0')        AS PERIOD_KEY,
  YEAR(WEEK_END_DATE)                                            AS CAL_YEAR,
  MONTH(WEEK_END_DATE)                                           AS CAL_MONTH_NO,
  IFF(MONTH(WEEK_END_DATE) <= 6, 'H1', 'H2')                     AS CAL_HALF,
  TO_CHAR(WEEK_END_DATE, 'Mon YYYY')                             AS CAL_MONTH_LABEL
FROM p;

-- ---------- 2. The merchandise hierarchy ----------
-- A VIEW over ANALYTICS.DIM_MERCH_HIERARCHY, not a copy, so this tab and the Global
-- Planning tab can never name the same merchandise differently. It only reshapes
-- the columns to the RBU / DEPARTMENT_NUM shape the planning chain is written
-- against. RBU codes are assigned here because the source carries names only.
CREATE OR REPLACE VIEW DIM_MERCH_HIERARCHY
  COMMENT = 'Baby Mart merchandise hierarchy (2 RBUs, 5 departments, 25 classes), reshaped from ANALYTICS.DIM_MERCH_HIERARCHY. The single source of truth stays in ANALYTICS.'
AS
SELECT
  DECODE(h.RBU, 'BABY-CONSUMABLES', '100', 'BABY-HARDGOODS', '200')            AS RBU_CODE,
  h.RBU                                                                        AS RBU_DESCRIPTION,
  DECODE(h.RBU, 'BABY-CONSUMABLES', '100', 'BABY-HARDGOODS', '200') || ' ' || h.RBU AS RBU_LABEL,
  h.DEPARTMENT_CODE                                                            AS DEPARTMENT_NUM,
  h.DEPARTMENT_CODE || ' - ' || h.DEPARTMENT                                   AS DEPARTMENT_NAME_CODED,
  h.DEPARTMENT                                                                 AS DEPARTMENT_NAME_BARE,
  h.DEPARTMENT_CODE || ' ' || h.DEPARTMENT                                     AS DEPARTMENT_LABEL,
  TRUE                                                                         AS IS_TRADED_RBU,
  FALSE                                                                        AS HAS_RBU_CONFLICT,
  h.CLASS_CODE,
  h.CLASS                                                                      AS CLASS_NAME,
  h.LFL_STRATEGY                                                               AS CLASS_LFL_STRATEGY,
  -- Departments carry no strategy of their own in the source. None is in managed
  -- decline (only individual classes are), so every department plans to grow.
  'G'                                                                          AS LFL_STRATEGY
FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h;

-- ---------- 3. Market ----------
CREATE OR REPLACE TABLE DIM_MARKET (
  MARKET_CODE        VARCHAR,
  MARKET_NAME        VARCHAR,
  COUNTRY            VARCHAR,
  LOCAL_CURRENCY     VARCHAR,
  FISCAL_CONVENTION  VARCHAR,
  STATUS             VARCHAR,
  NOTE               VARCHAR
) COMMENT = 'Market dimension. Baby Mart trades one market; the column exists so a second one is additive, not a remodel.';

INSERT INTO DIM_MARKET VALUES
  ('AU', 'Baby Mart Australia', 'Australia', 'AUD', 'Jul-Jun fiscal year, 4-4-5 weeks Mon-Sun', 'TRADING',
   'The only market. Every query is still market-scoped so a second market is a row here, not a code change.');

-- ---------- 4. Stores ----------
-- 60 trading stores from CURATED.DIM_STORE plus FOUR planned openings in FY27 H1.
--
-- The openings are generated -- Baby Mart has no new stores of its own (all 60
-- carry OPEN_DATE 2020-01-01) -- because new-store planning is half of the store
-- plan engine. A new store has no history, so it is planned off a COMPARABLE
-- store at a declared percentage and phased on that store's last-year weekly
-- shape, never on a generic ramp curve. Each opening exercises one path:
--
--   S061 Marsden Park  off S010 Parramatta at 90%, a 12-week halo (large format)
--   S062 Craigieburn   off S006 Southland at 85%, the default 9-week halo
--   S063 Ripley        off S020 Gold Coast at 80%, and NO recorded opening date:
--                      the opening is derived from the first planned week and
--                      OPENING_DATE_IS_DERIVED says so
--   S064 Mernda        off S062 -- itself a new store -- at 90%. A new store has no
--                      weekly history of its own, so the phasing source follows
--                      the benchmark to ITS comparable (MIX_SOURCE_STORE_CODE)
CREATE OR REPLACE TABLE DIM_STORE (
  STORE_CODE             VARCHAR,
  STORE_NAME             VARCHAR,
  MARKET_CODE            VARCHAR,
  STATE                  VARCHAR,
  REGION                 VARCHAR,
  STORE_FORMAT           VARCHAR,
  OPENING_DATE           DATE,
  CLOSING_DATE           DATE,
  IS_NEW_STORE           BOOLEAN,
  IS_COMPARABLE_BASE     BOOLEAN,
  BENCHMARK_STORE_CODE   VARCHAR,
  BENCHMARK_PCT          FLOAT,
  MIX_SOURCE_STORE_CODE  VARCHAR COMMENT 'The comparable store whose LY weekly shape a new store is phased on.',
  HALO_WEEKS             NUMBER(3,0) COMMENT 'Opening halo weeks. NULL falls back to the NEW_STORE_HALO_WEEKS setting (9).',
  SELLING_AREA_SQM       NUMBER(8,0) COMMENT 'Not held in the source. NULL means not recorded, never zero.',
  STORE_STATUS           VARCHAR,
  NOTE                   VARCHAR
) COMMENT = 'The 60 trading stores plus 4 planned FY27 H1 openings, benchmarked off comparable stores.';

INSERT INTO DIM_STORE
SELECT s.STORE_CODE, s.STORE_NAME, 'AU', s.STATE, s.REGION, s.STORE_FORMAT,
       s.OPEN_DATE, NULL, FALSE, TRUE, NULL, NULL, NULL, NULL, NULL, 'OPEN', NULL
FROM BABY_MART_DEMO.CURATED.DIM_STORE s;

INSERT INTO DIM_STORE VALUES
  ('S061', 'Baby Mart Marsden Park', 'AU', 'NSW', 'Metro', 'Large Format', '2026-06-29', NULL, TRUE, FALSE,
   'S010', 0.90, 'S010', 12, NULL, 'PLANNED',
   'Benchmark reason: same north-west Sydney growth corridor as Parramatta, at 90% while the catchment builds. Sizing: Large.'),
  ('S062', 'Baby Mart Craigieburn', 'AU', 'VIC', 'Metro', 'Standard', '2026-08-24', NULL, TRUE, FALSE,
   'S006', 0.85, 'S006', NULL, NULL, 'PLANNED',
   'Benchmark reason: Southland is the closest standard-format centre of the same grade. Sizing: Standard.'),
  ('S063', 'Baby Mart Ripley', 'AU', 'QLD', 'Regional', 'Standard', NULL, NULL, TRUE, FALSE,
   'S020', 0.80, 'S020', NULL, NULL, 'PLANNED',
   'Benchmark reason: Gold Coast is the nearest regional standard store. Sizing: Standard.'),
  ('S064', 'Baby Mart Mernda', 'AU', 'VIC', 'Metro', 'Standard', '2026-10-26', NULL, TRUE, FALSE,
   'S062', 0.90, 'S006', NULL, NULL, 'PLANNED',
   'Benchmark reason: Craigieburn is the next centre along the same growth corridor. Sizing: Standard.');

-- ---------- 5. Week slots ----------
-- The plan's 26 weeks (FY27 H1) paired with the same week last year (FY26 H1),
-- exactly 364 days earlier. Positional, so a store's LY week and plan week always
-- line up even where a calendar month boundary would not.
CREATE OR REPLACE TABLE STORE_PLAN_WEEK_SLOT
  COMMENT = 'FY27 H1 plan weeks paired with the same FY26 H1 week, 364 days earlier.'
AS
SELECT
  ty.FY_WEEK_NO                 AS WEEK_SLOT,
  ly.WEEK_END_DATE              AS LY_WEEK_END_DATE,
  ty.WEEK_END_DATE              AS TY_WEEK_END_DATE,
  ty.FY_PERIOD_NO,
  ty.MONTH_NAME,
  ty.WEEK_IN_PERIOD             AS WEEK_IN_MONTH,
  ty.FY_YEAR,
  ty.FY_HALF,
  ty.PERIOD_KEY
FROM DIM_CALENDAR_WEEK ty
JOIN DIM_CALENDAR_WEEK ly
  ON ly.WEEK_END_DATE = DATEADD(day, -364, ty.WEEK_END_DATE)
WHERE ty.FY_YEAR = 2027 AND ty.FY_HALF = 'H1';

-- ---------- 6. Last year, store x week (REAL) ----------
-- FY26 H1 (Jul-Dec 2025) from POS. Every figure the store plan grows from is a
-- real transaction total: VW_STORE_PLAN_RECON re-derives this from
-- FACT_TRANSACTION_LINES and ties it to the cent.
CREATE OR REPLACE TABLE STORE_PLAN_ACTUAL
  COMMENT = 'REAL. FY26 H1 store x week actuals from FACT_TRANSACTION_LINES, AUD.'
AS
SELECT
  s.STORE_CODE,
  s.STORE_NAME,
  w.LY_WEEK_END_DATE                           AS WEEK_END_DATE,
  SUM(tl.NET_REVENUE)                          AS SALES_AUD,
  SUM(tl.QUANTITY)                             AS UNITS,
  SUM(tl.MARGIN_AMOUNT)                        AS MARGIN_AUD,
  SUM(tl.MARGIN_AMOUNT) / NULLIF(SUM(tl.NET_REVENUE), 0) AS MARGIN_PCT
FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
JOIN BABY_MART_DEMO.CURATED.DIM_DATE d   ON d.DATE_KEY = tl.DATE_KEY
JOIN BABY_MART_DEMO.CURATED.DIM_STORE s  ON s.STORE_KEY = tl.STORE_KEY
JOIN STORE_PLAN_WEEK_SLOT w
  ON d.CALENDAR_DATE BETWEEN DATEADD(day, -6, w.LY_WEEK_END_DATE) AND w.LY_WEEK_END_DATE
GROUP BY s.STORE_CODE, s.STORE_NAME, w.LY_WEEK_END_DATE;

-- ---------- 7. Store plan drivers (GENERATED PLAN) ----------
-- THE ONLY REAL INPUTS IN THE WHOLE BUDGET: two per comparable store per month.
--   sales  = LY same week x (1 + LFL %)
--   margin = sales x margin %
-- Everything else in the store plan is derived from these.
--
-- LFL is set by format and region, shaped by month (November and December carry
-- Christmas), and varied per store by a seeded hash so no two stores read alike.
-- A handful of store-months carry a deliberate, explained move -- the rationale a
-- planner would otherwise leave in a spreadsheet cell comment:
--   S002 Melbourne CBD   refurbishment closes a floor for six weeks in AUG-SEP
--   S010 Parramatta      cannibalised by the Marsden Park opening from JUL
--   S006 Southland       cannibalised by Craigieburn from SEP
--   S009 Sydney CBD      extended Christmas trading in NOV-DEC
--   S048 Sunshine Coast  a pram launch lands in week 1 of OCT
--   S020 Gold Coast      takes the Car Seats run-out as a clearance hub in DEC
--
-- Margin starts from each store's own real LY margin for that month, plus a planned
-- 0.3pt improvement, so a driver is a statement about the store and not a guess.
--
-- LFL_CHANGED_AT / MARGIN_CHANGED_AT decide precedence against week-level edits:
-- a week override wins only if it is NEWER than the monthly driver. That is what
-- lets a later month edit supersede earlier week edits in the same month, without
-- either one silently shadowing the other.
CREATE OR REPLACE TABLE STORE_PLAN_DRIVER (
  STORE_CODE          VARCHAR,
  MONTH_NAME          VARCHAR,
  FY_YEAR             NUMBER(4,0),
  LFL_PCT             FLOAT,
  MARGIN_PCT          FLOAT,
  RATIONALE           VARCHAR COMMENT 'Why this driver is what it is. Every future edit should supply one.',
  REASON_CODE         VARCHAR,
  LFL_CHANGED_AT      TIMESTAMP_NTZ,
  MARGIN_CHANGED_AT   TIMESTAMP_NTZ
) COMMENT = 'GENERATED PLAN. The store plan input drivers: LFL % and margin % per comparable store per month.';

INSERT INTO STORE_PLAN_DRIVER
WITH ly_month AS (
  SELECT a.STORE_CODE, w.MONTH_NAME, w.FY_PERIOD_NO,
         SUM(a.MARGIN_AUD) / NULLIF(SUM(a.SALES_AUD), 0) AS LY_MARGIN_PCT
  FROM STORE_PLAN_ACTUAL a
  JOIN STORE_PLAN_WEEK_SLOT w ON w.LY_WEEK_END_DATE = a.WEEK_END_DATE
  GROUP BY a.STORE_CODE, w.MONTH_NAME, w.FY_PERIOD_NO
), base AS (
  SELECT
    m.STORE_CODE, m.MONTH_NAME, m.FY_PERIOD_NO, m.LY_MARGIN_PCT,
    CASE
      WHEN s.STORE_FORMAT = 'Large Format' THEN 0.055
      WHEN s.REGION = 'CBD'               THEN 0.025
      WHEN s.REGION = 'Regional'          THEN 0.030
      ELSE 0.042
    END
    + DECODE(m.MONTH_NAME, 'JUL', 0.000, 'AUG', 0.005, 'SEP', 0.000,
                           'OCT', -0.005, 'NOV', 0.010, 'DEC', 0.015)
    + (ABS(HASH(m.STORE_CODE, m.MONTH_NAME, 'lfl')) % 31 - 15) / 1000.0  AS LFL_BASE
  FROM ly_month m
  JOIN DIM_STORE s ON s.STORE_CODE = m.STORE_CODE
  WHERE NOT s.IS_NEW_STORE
)
SELECT
  b.STORE_CODE, b.MONTH_NAME, 2027,
  ROUND(CASE
    WHEN b.STORE_CODE = 'S002' AND b.MONTH_NAME = 'AUG'               THEN -0.060
    WHEN b.STORE_CODE = 'S002' AND b.MONTH_NAME = 'SEP'               THEN -0.040
    WHEN b.STORE_CODE = 'S010'                                        THEN b.LFL_BASE - 0.025
    WHEN b.STORE_CODE = 'S006' AND b.FY_PERIOD_NO >= 3                THEN b.LFL_BASE - 0.020
    WHEN b.STORE_CODE = 'S009' AND b.MONTH_NAME IN ('NOV', 'DEC')     THEN b.LFL_BASE + 0.030
    WHEN b.STORE_CODE = 'S048' AND b.MONTH_NAME = 'OCT'               THEN b.LFL_BASE + 0.020
    ELSE b.LFL_BASE
  END, 4)                                                             AS LFL_PCT,
  ROUND(b.LY_MARGIN_PCT + 0.003
        - IFF(b.STORE_CODE = 'S020' AND b.MONTH_NAME = 'DEC', 0.015, 0), 4) AS MARGIN_PCT,
  CASE
    WHEN b.STORE_CODE = 'S002' AND b.MONTH_NAME IN ('AUG', 'SEP')
      THEN 'Refurbishment closes the first floor for six weeks from 3 Aug. Prams and car seats trade from a temporary ground-floor bay.'
    WHEN b.STORE_CODE = 'S010' AND b.MONTH_NAME = 'JUL'
      THEN 'Marsden Park opens 25 minutes away. Assumed to take 2.5 points of Parramatta trade for the half.'
    WHEN b.STORE_CODE = 'S006' AND b.MONTH_NAME = 'SEP'
      THEN 'Craigieburn opens on the north side. Southland loses 2 points from September.'
    WHEN b.STORE_CODE = 'S009' AND b.MONTH_NAME = 'NOV'
      THEN 'Centre extends Christmas trading to 10pm from mid-November.'
    WHEN b.STORE_CODE = 'S048' AND b.MONTH_NAME = 'OCT'
      THEN 'New pram range launches in week 1 of October, with the regional launch event here.'
    WHEN b.STORE_CODE = 'S020' AND b.MONTH_NAME = 'DEC'
      THEN 'Takes the Car Seats run-out as the regional clearance hub, so margin gives up 1.5 points.'
  END                                                                 AS RATIONALE,
  CASE
    WHEN b.STORE_CODE = 'S002' AND b.MONTH_NAME IN ('AUG', 'SEP')     THEN 'STORE_REFURB'
    WHEN b.STORE_CODE = 'S010' AND b.MONTH_NAME = 'JUL'               THEN 'CANNIBALISATION'
    WHEN b.STORE_CODE = 'S006' AND b.MONTH_NAME = 'SEP'               THEN 'CANNIBALISATION'
    WHEN b.STORE_CODE = 'S009' AND b.MONTH_NAME = 'NOV'               THEN 'CENTRE_EVENT'
    WHEN b.STORE_CODE = 'S048' AND b.MONTH_NAME = 'OCT'               THEN 'NEWNESS_TIMING'
    WHEN b.STORE_CODE = 'S020' AND b.MONTH_NAME = 'DEC'               THEN 'CLEARANCE_PUSH'
  END                                                                 AS REASON_CODE,
  '2026-05-20 09:00:00'::TIMESTAMP_NTZ,
  '2026-05-20 09:00:00'::TIMESTAMP_NTZ
FROM base b;

-- ---------- 8. New-store monthly plan (GENERATED PLAN) ----------
-- Benchmark store's monthly sales x the declared percentage, from the opening
-- month. A comparable benchmark contributes its real LY month; a NEW benchmark
-- (S064 off S062) contributes its own planned month, so the chain resolves in
-- order. Phasing within the month is done by VW_STORE_PLAN_WEEKLY on the mix
-- source's LY weekly shape.
CREATE OR REPLACE TABLE STORE_PLAN_NEW_STORE (
  STORE_CODE          VARCHAR,
  FY_YEAR             NUMBER(4,0),
  MONTH_NAME          VARCHAR,
  MONTHLY_SALES_AUD   NUMBER(38,6),
  IS_DERIVED          BOOLEAN COMMENT 'TRUE = derived from the benchmark; FALSE = a value typed over it.',
  DERIVATION          VARCHAR,
  CHANGED_AT          TIMESTAMP_NTZ
) COMMENT = 'GENERATED PLAN. New-store monthly sales: benchmark monthly sales x BENCHMARK_PCT from the opening month.';

INSERT INTO STORE_PLAN_NEW_STORE
WITH ly_month AS (
  SELECT a.STORE_CODE, w.MONTH_NAME, w.FY_PERIOD_NO, SUM(a.SALES_AUD) AS LY_SALES_AUD
  FROM STORE_PLAN_ACTUAL a
  JOIN STORE_PLAN_WEEK_SLOT w ON w.LY_WEEK_END_DATE = a.WEEK_END_DATE
  GROUP BY a.STORE_CODE, w.MONTH_NAME, w.FY_PERIOD_NO
), opening AS (
  -- Ripley has no recorded opening date; the plan says it trades from OCT.
  SELECT STORE_CODE, BENCHMARK_STORE_CODE, BENCHMARK_PCT,
         CASE STORE_CODE WHEN 'S061' THEN 1 WHEN 'S062' THEN 3 WHEN 'S063' THEN 4 WHEN 'S064' THEN 5 END AS FIRST_PERIOD
  FROM DIM_STORE WHERE IS_NEW_STORE
), direct AS (
  SELECT o.STORE_CODE, m.MONTH_NAME, m.FY_PERIOD_NO, m.LY_SALES_AUD * o.BENCHMARK_PCT AS MONTHLY_SALES_AUD,
         'Benchmark ' || o.BENCHMARK_STORE_CODE || ' LY ' || m.MONTH_NAME || ' x ' || ROUND(100 * o.BENCHMARK_PCT) || '%' AS DERIVATION
  FROM opening o
  JOIN ly_month m ON m.STORE_CODE = o.BENCHMARK_STORE_CODE AND m.FY_PERIOD_NO >= o.FIRST_PERIOD
  WHERE o.BENCHMARK_STORE_CODE NOT IN (SELECT STORE_CODE FROM opening)
), chained AS (
  SELECT o.STORE_CODE, d.MONTH_NAME, d.FY_PERIOD_NO, d.MONTHLY_SALES_AUD * o.BENCHMARK_PCT,
         'Benchmark ' || o.BENCHMARK_STORE_CODE || ' (new store) planned ' || d.MONTH_NAME || ' x ' || ROUND(100 * o.BENCHMARK_PCT) || '%'
  FROM opening o
  JOIN direct d ON d.STORE_CODE = o.BENCHMARK_STORE_CODE AND d.FY_PERIOD_NO >= o.FIRST_PERIOD
)
SELECT STORE_CODE, 2027, MONTH_NAME, ROUND(MONTHLY_SALES_AUD, 2), TRUE, DERIVATION, '2026-05-20 09:00:00'::TIMESTAMP_NTZ
FROM (SELECT * FROM direct UNION ALL SELECT * FROM chained);

-- New-store margin curve. All four share it: a new store trades below the chain's
-- 37.8% while the range beds in, and December carries the clearance of an
-- opening over-allocation.
CREATE OR REPLACE TABLE STORE_PLAN_NEW_STORE_MARGIN (
  STORE_CODE   VARCHAR,
  FY_YEAR      NUMBER(4,0),
  MONTH_NAME   VARCHAR,
  MARGIN_PCT   FLOAT,
  CHANGED_AT   TIMESTAMP_NTZ
) COMMENT = 'GENERATED PLAN. New-store margin curve, shared by all four openings: 34/35/36/37/37.5/36.';

INSERT INTO STORE_PLAN_NEW_STORE_MARGIN
SELECT n.STORE_CODE, 2027, n.MONTH_NAME,
       DECODE(n.MONTH_NAME, 'JUL', 0.340, 'AUG', 0.350, 'SEP', 0.360, 'OCT', 0.370, 'NOV', 0.375, 'DEC', 0.360),
       '2026-05-20 09:00:00'::TIMESTAMP_NTZ
FROM STORE_PLAN_NEW_STORE n;

-- ---------- 9. Week-level driver overrides ----------
-- Append-only. Starts empty: it is a log of edits, so there is nothing to seed.
CREATE OR REPLACE TABLE STORE_PLAN_WEEK_OVERRIDE (
  OVERRIDE_ID    NUMBER IDENTITY(1,1),
  MARKET_CODE    VARCHAR,
  SCENARIO_ID    NUMBER COMMENT 'NULL = the live plan.',
  STORE_CODE     VARCHAR,
  WEEK_END_DATE  DATE,
  MEASURE_CODE   VARCHAR COMMENT 'LFL_PCT | MARGIN_PCT',
  OLD_VALUE      FLOAT,
  NEW_VALUE      FLOAT,
  REASON_CODE    VARCHAR,
  RATIONALE      VARCHAR,
  CHANGED_BY     VARCHAR,
  CHANGED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Append-only week-level store plan driver edits. The latest row per store/week/measure wins, but only over a monthly driver changed BEFORE it.';

-- ---------- 10. Planning settings ----------
-- Created with the foundation because the store plan engine reads the halo default
-- from here, and a view cannot be created over a table that does not exist yet.
-- IS_ASSUMPTION = TRUE means judgement, not data: never present it as fact.
CREATE OR REPLACE TABLE PLANNING_SETTING (
  SETTING_KEY     VARCHAR,
  SETTING_VALUE   VARCHAR,
  VALUE_TYPE      VARCHAR,
  DESCRIPTION     VARCHAR,
  IS_ASSUMPTION   BOOLEAN,
  SOURCE          VARCHAR
) COMMENT = 'Parameterised planning assumptions. IS_ASSUMPTION = TRUE is judgement, not data.';

INSERT INTO PLANNING_SETTING VALUES
  ('NEW_STORE_HALO_WEEKS', '9', 'INT',
   'Weeks a new store trades above its settled run rate after opening. Halo weeks sit outside like-for-like.', TRUE,
   'Planning convention; no Baby Mart opening history exists to measure it from.'),
  ('FWD_COVER_WEEKS', '4', 'INT',
   'Forward weeks of sales that forward cover is measured against.', FALSE, 'WSSI definition'),
  ('IMPLAUSIBLE_COVER_WEEKS', '26', 'INT',
   'Forward cover above this is flagged as untrustworthy rather than presented as a position.', TRUE,
   'Head of planning rule of thumb: half a year of stock is a data problem before it is a stock problem.'),
  ('MATERIALITY_PTS', '7', 'NUMBER',
   'A top-down vs bottom-up growth gap inside this many points is not flagged on the MFP grid.', TRUE,
   'Merch forecasts habitually run a few points above budget; the band stops that reading as a finding.'),
  ('MERCH_ABOVE_BUDGET_BAND_LOW', '0.03', 'PCT',
   'Lower edge of the band a merch forecast normally runs above budget.', TRUE, 'Planning convention'),
  ('MERCH_ABOVE_BUDGET_BAND_HIGH', '0.07', 'PCT',
   'Upper edge of the same band.', TRUE, 'Planning convention'),
  ('CREDIBLE_ADOPTION_DEFAULT', '0.60', 'PCT',
   'Default minimum share of presented options a department must commit to for a credible offer.', TRUE,
   'Placeholder pending planogram minimums from category management.'),
  ('CLEARANCE_DEFINITION', 'DISCOUNTED_OR_PROMOTED', 'TEXT',
   'A POS line is clearance (CL) if it carries a discount or a promotion; everything else is full price (FP).', TRUE,
   'POS does not distinguish a promotion from a clearance markdown, so both are treated as clearance.'),
  ('STOCK_BASIS', 'MODELLED', 'TEXT',
   'Weekly stock is modelled at plan cover, not read from the SOH feed.', TRUE,
   'The store SOH feed implies 60-113 weeks of cover against POS. See the data quality findings.'),
  ('DEFAULT_UI_CALENDAR', 'FISCAL', 'TEXT',
   'Grids label periods by Baby Mart fiscal period and always show the calendar months beside them.', FALSE,
   'Design decision');
