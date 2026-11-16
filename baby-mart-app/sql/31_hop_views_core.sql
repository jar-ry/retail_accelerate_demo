-- ============================================================
-- Head of Planning — core views: the calendar and the store plan engine
--
-- Separated from 36_hop_views.sql because the WSSI budget (33_) is phased off
-- VW_STORE_PLAN_WEEKLY: the store plan must exist before the WSSI can be built,
-- and the WSSI views must exist after it.
--
-- AGGREGATION, the rule every view below follows:
--   FLOW     (sales, margin, units, receipts)  summed across the period's weeks
--   BALANCE  (stock, on order)                 taken at the period's CLOSING week
--   RATIO    (LFL %, margin %, ASP, cover)     rebuilt as SUM(num) / SUM(denom),
--                                              never an average of rates
-- Summing a balance across weeks overstates it by the week count; averaging a
-- rate silently re-weights it. Both look plausible, which is why they are rules.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ---------- Period spine at every grain ----------
-- WEEK, MONTH (fiscal period), QUARTER, HALF and YEAR, all composed from
-- DIM_CALENDAR_WEEK. EXPECTED_WEEKS is calendar membership, not data
-- availability -- the WSSI compares the two to mark an incomplete period.
--
-- PERIOD_KEY is a string ('M:FY27P01'), deliberately not a YYYYMM number: 202701
-- would read as January 2027 to anyone, when FY27 P01 is July 2026. That is the
-- exact confusion this calendar exists to prevent.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_TIME_PERIOD
  COMMENT = 'Canonical period spine at WEEK, MONTH, QUARTER, HALF and YEAR. Every period carries a fiscal label and the calendar months it covers.'
AS
WITH base AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_CALENDAR_WEEK
)
SELECT 'WEEK'                                              AS TIME_GRAIN,
       'W:' || TO_CHAR(WEEK_END_DATE, 'YYYYMMDD')          AS PERIOD_KEY,
       TO_NUMBER(TO_CHAR(WEEK_END_DATE, 'YYYYMMDD'))       AS SORT_KEY,
       'W/e ' || TO_CHAR(WEEK_END_DATE, 'DD Mon')          AS PERIOD_LABEL,
       TO_CHAR(WEEK_END_DATE, 'DD Mon YYYY')               AS CAL_LABEL,
       WEEK_START_DATE AS PERIOD_START_DATE, WEEK_END_DATE AS PERIOD_END_DATE,
       FY_YEAR, FY_LABEL, FY_HALF, FY_QUARTER, FY_PERIOD_NO, MONTH_NAME,
       FY_WEEK_NO, WEEK_IN_PERIOD, 1                       AS EXPECTED_WEEKS
FROM base
UNION ALL
SELECT 'MONTH', 'M:' || PERIOD_KEY, FY_YEAR * 100 + FY_PERIOD_NO,
       MONTH_NAME || ' ' || FY_LABEL,
       -- Built from the first and last week rather than LISTAGG: a 4-4-5 period
       -- spans at most two calendar months, and LISTAGG sorts month names
       -- alphabetically, which renders a June-July period as "Jul/Jun".
       TO_CHAR(MIN(WEEK_END_DATE), 'Mon')
         || IFF(MONTH(MIN(WEEK_END_DATE)) <> MONTH(MAX(WEEK_END_DATE)), '/' || TO_CHAR(MAX(WEEK_END_DATE), 'Mon'), '')
         || ' ' || YEAR(MAX(WEEK_END_DATE)),
       MIN(WEEK_START_DATE), MAX(WEEK_END_DATE),
       FY_YEAR, FY_LABEL, FY_HALF, FY_QUARTER, FY_PERIOD_NO, MONTH_NAME,
       NULL, NULL, COUNT(*)
FROM base GROUP BY PERIOD_KEY, FY_YEAR, FY_LABEL, FY_HALF, FY_QUARTER, FY_PERIOD_NO, MONTH_NAME
UNION ALL
SELECT 'QUARTER', 'Q:' || FY_LABEL || FY_QUARTER, FY_YEAR * 10 + TRY_TO_NUMBER(REPLACE(FY_QUARTER, 'Q', '')),
       FY_QUARTER || ' ' || FY_LABEL,
       TO_CHAR(MIN(WEEK_END_DATE), 'Mon') || '-' || TO_CHAR(MAX(WEEK_END_DATE), 'Mon YYYY'),
       MIN(WEEK_START_DATE), MAX(WEEK_END_DATE),
       FY_YEAR, FY_LABEL, MIN(FY_HALF), FY_QUARTER, NULL, NULL, NULL, NULL, COUNT(*)
FROM base GROUP BY FY_YEAR, FY_LABEL, FY_QUARTER
UNION ALL
SELECT 'HALF', 'H:' || FY_LABEL || FY_HALF, FY_YEAR * 10 + TRY_TO_NUMBER(REPLACE(FY_HALF, 'H', '')),
       FY_LABEL || ' ' || FY_HALF,
       TO_CHAR(MIN(WEEK_END_DATE), 'Mon') || '-' || TO_CHAR(MAX(WEEK_END_DATE), 'Mon YYYY'),
       MIN(WEEK_START_DATE), MAX(WEEK_END_DATE),
       FY_YEAR, FY_LABEL, FY_HALF, NULL, NULL, NULL, NULL, NULL, COUNT(*)
FROM base GROUP BY FY_YEAR, FY_LABEL, FY_HALF
UNION ALL
SELECT 'YEAR', 'Y:' || FY_LABEL, FY_YEAR, FY_LABEL,
       TO_CHAR(MIN(WEEK_END_DATE), 'Mon YYYY') || '-' || TO_CHAR(MAX(WEEK_END_DATE), 'Mon YYYY'),
       MIN(WEEK_START_DATE), MAX(WEEK_END_DATE),
       FY_YEAR, FY_LABEL, NULL, NULL, NULL, NULL, NULL, NULL, COUNT(*)
FROM base GROUP BY FY_YEAR, FY_LABEL;

-- ---------- Month spine with both keys ----------
-- One row per fiscal period. LABEL_DUAL is what every month-level column header
-- renders, so the two conventions are always shown together.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_CALENDAR_PERIOD
  COMMENT = 'One row per fiscal period with its calendar months. SPANS_TWO_CAL_MONTHS marks a 4-4-5 period that crosses a calendar month boundary rather than hiding it.'
AS
SELECT
  PERIOD_KEY, FY_YEAR, FY_LABEL, FY_PERIOD_NO, MONTH_NAME, FY_HALF, FY_QUARTER,
  MIN(WEEK_START_DATE)                                       AS PERIOD_START_DATE,
  MAX(WEEK_END_DATE)                                         AS PERIOD_END_DATE,
  COUNT(*)                                                   AS WEEKS_IN_PERIOD,
  COUNT(DISTINCT CAL_MONTH_NO) > 1                           AS SPANS_TWO_CAL_MONTHS,
  COUNT(DISTINCT CAL_YEAR) > 1                               AS STRADDLES_CAL_YEAR,
  TO_CHAR(MIN(WEEK_END_DATE), 'Mon')
    || IFF(MONTH(MIN(WEEK_END_DATE)) <> MONTH(MAX(WEEK_END_DATE)), '/' || TO_CHAR(MAX(WEEK_END_DATE), 'Mon'), '')
    || ' ' || YEAR(MAX(WEEK_END_DATE))                       AS CAL_LABEL,
  MONTH_NAME || ' ' || FY_LABEL                              AS LABEL_FISCAL,
  FY_LABEL || ' ' || FY_HALF || ' - ' || MONTH_NAME          AS LABEL_DUAL
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_CALENDAR_WEEK
GROUP BY PERIOD_KEY, FY_YEAR, FY_LABEL, FY_PERIOD_NO, MONTH_NAME, FY_HALF, FY_QUARTER;

-- ---------- The budget engine ----------
-- One row per store per plan week.
--   comparable store:  sales  = LY same week x (1 + LFL %)
--                      margin = sales x margin %
--   new store:         sales  = monthly plan x the mix source's LY weekly share
--                      margin = sales x the new-store margin curve
--
-- ONE DEFINITION. The reference implementation shipped two versions of this view,
-- and on its one-command deploy path a week-level edit was audited but changed
-- nothing. Week overrides are read here, and precedence is by TIME: an override
-- wins only if it is newer than the monthly driver. So a later month edit
-- supersedes earlier week edits in that month, and a later week edit beats the
-- month -- neither silently shadows the other.
--
-- HALO is bounded at both ends: from the opening to opening + HALO_WEEKS. Where no
-- opening date was recorded the first planned week stands in for it and
-- OPENING_DATE_IS_DERIVED says so, so the UI can state the date is inferred
-- rather than present it as fact.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY
  COMMENT = 'The store plan engine, store x plan week. Comparable stores grow off their own LY week; new stores are phased off a comparable store. Week overrides newer than the monthly driver take precedence.'
AS
WITH slot AS (
  SELECT * FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_SLOT
), wk_ovr AS (
  SELECT STORE_CODE, WEEK_END_DATE, MEASURE_CODE, NEW_VALUE, CHANGED_AT
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_OVERRIDE
  WHERE SCENARIO_ID IS NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY STORE_CODE, WEEK_END_DATE, MEASURE_CODE
    ORDER BY CHANGED_AT DESC, OVERRIDE_ID DESC) = 1
), open_wk AS (
  SELECT ns.STORE_CODE, MIN(s.TY_WEEK_END_DATE) AS FIRST_PLANNED_WEEK
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_NEW_STORE ns
  JOIN slot s ON s.MONTH_NAME = ns.MONTH_NAME AND s.FY_YEAR = ns.FY_YEAR
  WHERE ns.MONTHLY_SALES_AUD > 0
  GROUP BY ns.STORE_CODE
), ly AS (
  SELECT a.STORE_CODE, s.WEEK_SLOT, s.MONTH_NAME,
         a.SALES_AUD AS LY_SALES_AUD, a.MARGIN_AUD AS LY_MARGIN_AUD, a.UNITS AS LY_UNITS
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_ACTUAL a
  JOIN slot s ON s.LY_WEEK_END_DATE = a.WEEK_END_DATE
), mix AS (
  SELECT STORE_CODE, WEEK_SLOT,
         LY_SALES_AUD / NULLIF(SUM(LY_SALES_AUD) OVER (PARTITION BY STORE_CODE, MONTH_NAME), 0) AS WEEK_MIX_PCT
  FROM ly
), comparable_drivers AS (
  SELECT
    st.STORE_CODE, st.STORE_NAME, s.WEEK_SLOT, s.TY_WEEK_END_DATE, s.LY_WEEK_END_DATE,
    s.FY_YEAR, s.FY_PERIOD_NO, s.MONTH_NAME, s.WEEK_IN_MONTH, s.FY_HALF, s.PERIOD_KEY,
    l.LY_SALES_AUD, l.LY_MARGIN_AUD,
    IFF(lo.CHANGED_AT > d.LFL_CHANGED_AT,    lo.NEW_VALUE, d.LFL_PCT)    AS LFL_PCT,
    IFF(mo.CHANGED_AT > d.MARGIN_CHANGED_AT, mo.NEW_VALUE, d.MARGIN_PCT) AS MARGIN_PCT,
    (lo.CHANGED_AT > d.LFL_CHANGED_AT OR mo.CHANGED_AT > d.MARGIN_CHANGED_AT) AS IS_WEEK_OVERRIDDEN,
    d.RATIONALE
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_STORE st
  JOIN slot s ON TRUE
  JOIN ly l ON l.STORE_CODE = st.STORE_CODE AND l.WEEK_SLOT = s.WEEK_SLOT
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_DRIVER d
    ON d.STORE_CODE = st.STORE_CODE AND d.MONTH_NAME = s.MONTH_NAME AND d.FY_YEAR = s.FY_YEAR
  LEFT JOIN wk_ovr lo ON lo.STORE_CODE = st.STORE_CODE AND lo.WEEK_END_DATE = s.TY_WEEK_END_DATE AND lo.MEASURE_CODE = 'LFL_PCT'
  LEFT JOIN wk_ovr mo ON mo.STORE_CODE = st.STORE_CODE AND mo.WEEK_END_DATE = s.TY_WEEK_END_DATE AND mo.MEASURE_CODE = 'MARGIN_PCT'
  WHERE NOT st.IS_NEW_STORE
), comparable AS (
  SELECT
    STORE_CODE, STORE_NAME, WEEK_SLOT, TY_WEEK_END_DATE AS WEEK_END_DATE, LY_WEEK_END_DATE,
    FY_YEAR, FY_PERIOD_NO, MONTH_NAME, WEEK_IN_MONTH, FY_HALF, PERIOD_KEY,
    'COMPARABLE'                                     AS PLAN_METHOD,
    LY_SALES_AUD, LY_MARGIN_AUD, LFL_PCT, MARGIN_PCT,
    LY_SALES_AUD * (1 + LFL_PCT)                     AS PLAN_SALES_AUD,
    LY_SALES_AUD * (1 + LFL_PCT) * MARGIN_PCT        AS PLAN_MARGIN_AUD,
    FALSE                                            AS IS_HALO_WEEK,
    NULL::VARCHAR AS BENCHMARK_STORE_CODE, NULL::FLOAT AS BENCHMARK_PCT,
    RATIONALE, TRUE AS IS_LY_BASE, TRUE AS IS_LFL_UNIVERSE,
    NULL::DATE AS OPENING_WEEK_BASIS, FALSE AS OPENING_DATE_IS_DERIVED,
    NULL::NUMBER AS HALO_WEEKS, NVL(IS_WEEK_OVERRIDDEN, FALSE) AS IS_WEEK_OVERRIDDEN
  FROM comparable_drivers
), new_store AS (
  SELECT
    st.STORE_CODE, st.STORE_NAME, s.WEEK_SLOT, s.TY_WEEK_END_DATE AS WEEK_END_DATE, s.LY_WEEK_END_DATE,
    s.FY_YEAR, s.FY_PERIOD_NO, s.MONTH_NAME, s.WEEK_IN_MONTH, s.FY_HALF, s.PERIOD_KEY,
    'NEW_STORE_BENCHMARK'                            AS PLAN_METHOD,
    NULL::FLOAT AS LY_SALES_AUD, NULL::FLOAT AS LY_MARGIN_AUD,
    NULL::FLOAT                                      AS LFL_PCT,
    IFF(mo.CHANGED_AT > nm.CHANGED_AT, mo.NEW_VALUE, nm.MARGIN_PCT) AS MARGIN_PCT,
    -- A store opening mid-month trades only the weeks from its opening week, so
    -- the month is phased over those weeks alone: weeks before it are zero, and
    -- the shares of the weeks it trades still sum to one. (A month wholly before
    -- the opening reads zero, not NULL.)
    NVL(ns.MONTHLY_SALES_AUD * m.WEEK_MIX_PCT * IFF(st.OPENING_DATE IS NULL OR s.TY_WEEK_END_DATE >= st.OPENING_DATE, 1, 0)
      / NULLIF(SUM(m.WEEK_MIX_PCT * IFF(st.OPENING_DATE IS NULL OR s.TY_WEEK_END_DATE >= st.OPENING_DATE, 1, 0))
               OVER (PARTITION BY st.STORE_CODE, s.MONTH_NAME), 0), 0)  AS PLAN_SALES_AUD,
    NVL(ns.MONTHLY_SALES_AUD * m.WEEK_MIX_PCT * IFF(st.OPENING_DATE IS NULL OR s.TY_WEEK_END_DATE >= st.OPENING_DATE, 1, 0)
      / NULLIF(SUM(m.WEEK_MIX_PCT * IFF(st.OPENING_DATE IS NULL OR s.TY_WEEK_END_DATE >= st.OPENING_DATE, 1, 0))
               OVER (PARTITION BY st.STORE_CODE, s.MONTH_NAME), 0), 0)
      * IFF(mo.CHANGED_AT > nm.CHANGED_AT, mo.NEW_VALUE, nm.MARGIN_PCT) AS PLAN_MARGIN_AUD,
    (COALESCE(st.OPENING_DATE, ow.FIRST_PLANNED_WEEK) IS NOT NULL
      AND s.TY_WEEK_END_DATE >= COALESCE(st.OPENING_DATE, ow.FIRST_PLANNED_WEEK)
      AND s.TY_WEEK_END_DATE <  DATEADD(week,
            COALESCE(st.HALO_WEEKS, (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.PLANNING_SETTING WHERE SETTING_KEY = 'NEW_STORE_HALO_WEEKS'), 9),
            COALESCE(st.OPENING_DATE, ow.FIRST_PLANNED_WEEK)))  AS IS_HALO_WEEK,
    st.BENCHMARK_STORE_CODE, st.BENCHMARK_PCT,
    NULL::VARCHAR AS RATIONALE,
    FALSE AS IS_LY_BASE, FALSE AS IS_LFL_UNIVERSE,
    COALESCE(st.OPENING_DATE, ow.FIRST_PLANNED_WEEK)::DATE AS OPENING_WEEK_BASIS,
    (st.OPENING_DATE IS NULL)                        AS OPENING_DATE_IS_DERIVED,
    COALESCE(st.HALO_WEEKS, (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.PLANNING_SETTING WHERE SETTING_KEY = 'NEW_STORE_HALO_WEEKS'), 9)::NUMBER AS HALO_WEEKS,
    NVL(mo.CHANGED_AT > nm.CHANGED_AT, FALSE)        AS IS_WEEK_OVERRIDDEN
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.DIM_STORE st
  JOIN slot s ON TRUE
  LEFT JOIN open_wk ow ON ow.STORE_CODE = st.STORE_CODE
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_NEW_STORE ns
    ON ns.STORE_CODE = st.STORE_CODE AND ns.MONTH_NAME = s.MONTH_NAME AND ns.FY_YEAR = s.FY_YEAR
  JOIN mix m ON m.STORE_CODE = st.MIX_SOURCE_STORE_CODE AND m.WEEK_SLOT = s.WEEK_SLOT
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_NEW_STORE_MARGIN nm
    ON nm.STORE_CODE = st.STORE_CODE AND nm.MONTH_NAME = s.MONTH_NAME AND nm.FY_YEAR = s.FY_YEAR
  LEFT JOIN wk_ovr mo ON mo.STORE_CODE = st.STORE_CODE AND mo.WEEK_END_DATE = s.TY_WEEK_END_DATE AND mo.MEASURE_CODE = 'MARGIN_PCT'
  WHERE st.IS_NEW_STORE
)
SELECT * FROM comparable
UNION ALL
SELECT * FROM new_store;

-- ---------- Store plan roll-up by month ----------
-- LFL growth is measured on the comparable universe only, against the MATCHED
-- denominator LY_SALES_LFL_PHP. Using the full LY base instead gives a different,
-- wrong number -- and an overview and a grid that disagree about the same plan.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_SUMMARY
  COMMENT = 'Store plan roll-up by month. Ratios rebuilt from components; LFL uses the comparable universe and the matched LY denominator only.'
AS
SELECT
  FY_YEAR, FY_PERIOD_NO, MONTH_NAME, FY_HALF, PERIOD_KEY,
  SUM(LY_SALES_AUD)                                                AS LY_SALES_AUD,
  SUM(IFF(IS_LFL_UNIVERSE, LY_SALES_AUD, 0))                       AS LY_SALES_LFL_AUD,
  SUM(IFF(IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0))                     AS LFL_SALES_AUD,
  SUM(IFF(NOT IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0))                 AS NEW_STORE_SALES_AUD,
  SUM(PLAN_SALES_AUD)                                              AS TOTAL_SALES_AUD,
  SUM(IFF(IS_LFL_UNIVERSE, PLAN_MARGIN_AUD, 0))                    AS LFL_MARGIN_AUD,
  SUM(PLAN_MARGIN_AUD)                                             AS TOTAL_MARGIN_AUD,
  DIV0(SUM(PLAN_MARGIN_AUD), SUM(PLAN_SALES_AUD))                  AS TOTAL_MARGIN_PCT,
  DIV0(SUM(LY_MARGIN_AUD), SUM(LY_SALES_AUD))                      AS LY_MARGIN_PCT,
  DIV0(SUM(IFF(IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0)),
       SUM(IFF(IS_LFL_UNIVERSE, LY_SALES_AUD, 0))) - 1             AS LFL_GROWTH_PCT,
  DIV0(SUM(PLAN_SALES_AUD), SUM(LY_SALES_AUD)) - 1                 AS TOTAL_GROWTH_PCT,
  DIV0(SUM(IFF(NOT IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0)), SUM(PLAN_SALES_AUD)) AS NEW_STORE_MIX_PCT,
  COUNT(DISTINCT STORE_CODE)                                       AS STORES,
  SUM(IFF(IS_HALO_WEEK, 1, 0))                                     AS HALO_STORE_WEEKS
FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY
GROUP BY FY_YEAR, FY_PERIOD_NO, MONTH_NAME, FY_HALF, PERIOD_KEY;

-- The store plan's monthly shape as a share of the half. Phases the half-level
-- MFP to month, and moves when the store plan moves.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_MONTH_SHAPE
  COMMENT = 'Monthly shape of the store plan as a share of the half. Used to phase the half-level MFP to month.'
AS
WITH m AS (
  SELECT FY_YEAR, FY_PERIOD_NO, MONTH_NAME, PERIOD_KEY, SUM(PLAN_SALES_AUD) AS SALES_AUD
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY
  GROUP BY FY_YEAR, FY_PERIOD_NO, MONTH_NAME, PERIOD_KEY
)
SELECT PERIOD_KEY, FY_YEAR, FY_PERIOD_NO, MONTH_NAME, SALES_AUD,
       SALES_AUD / NULLIF(SUM(SALES_AUD) OVER (PARTITION BY FY_YEAR), 0) AS SHARE_OF_HALF
FROM m;

-- ---------- Reconciliation to source ----------
-- The reference implementation reconciled its model to the customer's workbook
-- and attributed every difference to a named defect. Here the source is Baby
-- Mart's own POS, so the reconciliation re-derives each figure independently from
-- FACT_TRANSACTION_LINES and the plan inputs, and every line must tie to the cent.
-- A non-zero variance with no DEFECT is the question worth asking, and the UI
-- counts them.
CREATE OR REPLACE VIEW BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_RECON
  COMMENT = 'Reconciles the store plan to independently re-derived figures: LY to POS, LFL to its drivers, new stores to their benchmarks, and the total to its parts.'
AS
WITH m AS (
  SELECT SUM(LY_SALES_AUD)                                   AS LY_SALES,
         SUM(LY_MARGIN_AUD)                                  AS LY_MARGIN,
         SUM(IFF(IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0))        AS LFL_SALES,
         SUM(IFF(NOT IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0))    AS NEW_SALES,
         SUM(PLAN_SALES_AUD)                                 AS TOTAL_SALES,
         COUNT(DISTINCT STORE_CODE)                          AS STORES
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY
), pos AS (
  SELECT SUM(tl.NET_REVENUE) AS SALES, SUM(tl.MARGIN_AMOUNT) AS MARGIN
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.DATE_KEY = tl.DATE_KEY
  WHERE d.CALENDAR_DATE BETWEEN (SELECT DATEADD(day, -6, MIN(LY_WEEK_END_DATE)) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_SLOT)
                            AND (SELECT MAX(LY_WEEK_END_DATE) FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_SLOT)
), lfl AS (
  -- LY x (1 + LFL) recomputed from the base tables, bypassing the view, so the
  -- engine is checked against its own definition.
  SELECT SUM(a.SALES_AUD * (1 + d.LFL_PCT)) AS SALES
  FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_ACTUAL a
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_SLOT s ON s.LY_WEEK_END_DATE = a.WEEK_END_DATE
  JOIN BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_DRIVER d ON d.STORE_CODE = a.STORE_CODE AND d.MONTH_NAME = s.MONTH_NAME
  WHERE NOT EXISTS (SELECT 1 FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_OVERRIDE o
                    WHERE o.SCENARIO_ID IS NULL AND o.STORE_CODE = a.STORE_CODE AND o.MEASURE_CODE = 'LFL_PCT')
), lfl_overridden AS (
  SELECT SUM(PLAN_SALES_AUD) AS SALES FROM BABY_MART_DEMO.HEAD_OF_PLANNING.VW_STORE_PLAN_WEEKLY w
  WHERE EXISTS (SELECT 1 FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_WEEK_OVERRIDE o
                WHERE o.SCENARIO_ID IS NULL AND o.STORE_CODE = w.STORE_CODE AND o.MEASURE_CODE = 'LFL_PCT')
), ns AS (
  SELECT SUM(MONTHLY_SALES_AUD) AS SALES FROM BABY_MART_DEMO.HEAD_OF_PLANNING.STORE_PLAN_NEW_STORE
)
SELECT 'LY base sales' AS LINE, m.LY_SALES AS MODEL_AUD, pos.SALES AS SOURCE_STATED_AUD,
       ROUND(m.LY_SALES - pos.SALES, 2) AS VARIANCE_AUD,
       'Re-derived from FACT_TRANSACTION_LINES over the same 26 LY weeks. Ties to the cent.' AS EXPLANATION,
       NULL::VARCHAR AS DEFECT
FROM m, pos
UNION ALL
SELECT 'LY base margin', m.LY_MARGIN, pos.MARGIN, ROUND(m.LY_MARGIN - pos.MARGIN, 2),
       'POS margin over the same weeks.', NULL FROM m, pos
UNION ALL
SELECT 'Like-for-like plan sales', m.LFL_SALES, NVL(lfl.SALES, 0) + NVL(lfl_overridden.SALES, 0),
       ROUND(m.LFL_SALES - NVL(lfl.SALES, 0) - NVL(lfl_overridden.SALES, 0), 2),
       'LY same week x (1 + LFL %) recomputed from the drivers. Stores with week-level edits are taken from the engine, since their effective driver varies by week.',
       NULL FROM m, lfl, lfl_overridden
UNION ALL
SELECT 'New store plan sales', m.NEW_SALES, ns.SALES, ROUND(m.NEW_SALES - ns.SALES, 2),
       'Each opening''s monthly plan, phased on its mix source''s LY weekly shape. The weekly shares sum to one, so the months tie.',
       NULL FROM m, ns
UNION ALL
SELECT 'TOTAL plan sales', m.TOTAL_SALES, m.LFL_SALES + m.NEW_SALES,
       ROUND(m.TOTAL_SALES - m.LFL_SALES - m.NEW_SALES, 2),
       'Like-for-like plus new stores, across ' || m.STORES || ' stores.', NULL FROM m;
