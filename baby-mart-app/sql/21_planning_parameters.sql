-- ============================================================
-- Baby Mart Global Planning — planning parameters and per-class targets
--
-- Every threshold and calculation constant the planning pages depend on, held as
-- DATA with the metadata the settings UI needs to present it honestly.
--
--   PLANNING_SETTING        upgraded in place with category / range / provenance
--   PLANNING_CLASS_TARGET   editable cover target per class
--   VW_PLANNING_PARAM       ONE-ROW pivot the views CROSS JOIN
--   SAVE_PLANNING_SETTING   validated write
--   SAVE_CLASS_TARGET       validated write
--
-- THE PROBLEM THIS SOLVES
--
-- The overbuy / underbuy multipliers were written out THREE times: in
-- 12_planning_otb.sql, again in 13_planning_views.sql, and a third time in the
-- class page's KPI colour logic. Three copies of one business rule means the
-- pill, the colour and the exception list can silently disagree the moment
-- anyone edits one of them. After this script there is exactly one copy, in a
-- row of a table.
--
-- WHY A ONE-ROW PIVOT AND NOT A UDF
--
-- Views cannot take parameters. Three ways to get a setting into a view:
--
--   * a scalar UDF called per row -- risks re-running the lookup for every row
--     of a 1,440-row scan;
--   * rebuilding the views on every settings save -- turns a UI edit into DDL,
--     and a failed save leaves no view at all;
--   * CROSS JOIN a one-row pivot -- evaluated once, no DDL, and the parameter is
--     visibly part of the query.
--
-- The third. Every consuming view does `CROSS JOIN VW_PLANNING_PARAM p` and
-- references `p.OVERBUY_MULT`.
--
-- QUERY_TIME VERSUS GENERATION
--
-- `AFFECTS` is the column that lets the settings page tell the truth. A
-- QUERY_TIME parameter takes effect on the next page load. A GENERATION
-- parameter -- the seasonality curve, the option-count formula, the LLY growth
-- band -- is baked into a fact by 11_/12_/17_/18_ and cannot change without
-- re-running those scripts. Presenting the second kind as an editable dial would
-- be a lie the first time someone moved one and nothing happened, so they are
-- listed read-only instead. `SAVE_PLANNING_SETTING` refuses them outright rather
-- than trusting the form to disable the input.
--
-- RERUN SAFETY AND ORDERING
--
-- This script is the SINGLE OWNER of PLANNING_SETTING. 17_ and 20_ used to seed
-- their own keys, which created a metadata ordering problem: whichever script
-- ran last won, and the category and range columns could end up NULL depending
-- on deploy order. Now every key is declared here, in one place, with its
-- metadata attached.
--
-- It therefore runs BEFORE 13_planning_views.sql, which CROSS JOINs the pivot
-- created below. See the SCRIPTS array in scripts/deploy_data.sh.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. The settings table ----------
-- CREATE OR REPLACE with the full schema, rather than CREATE IF NOT EXISTS plus
-- an ALTER to bolt on the metadata columns. ADD COLUMN IF NOT EXISTS does not
-- cover a multi-column list once those columns already exist, so the ALTER route
-- fails on the second run -- and a deploy script that only works once is worse
-- than no deploy script.
--
-- Replacing the table is safe because this script re-declares every key
-- immediately below. PLANNING_SETTING is seeded configuration, so a data redeploy
-- resetting it to the shipped defaults is the expected behaviour. Per-class cover
-- targets are deliberately NOT in this table: those are planner-authored, live in
-- PLANNING_CLASS_TARGET, and are MERGEd rather than replaced.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING (
    SETTING_KEY    VARCHAR(60)   NOT NULL,
    SETTING_VALUE  VARCHAR(200),
    VALUE_TYPE     VARCHAR(10),            -- DATE | NUMBER | STRING
    CATEGORY       VARCHAR(30),            -- BUY_POSITION | EXCEPTIONS | CURRENCY | GRID | SCENARIO | GENERATION
    AFFECTS        VARCHAR(12),            -- QUERY_TIME | GENERATION
    MIN_VALUE      FLOAT,
    MAX_VALUE      FLOAT,
    DRIVES         VARCHAR(500),           -- plain English, shown in the tooltip
    DESCRIPTION    VARCHAR(400),
    SORT_ORDER     INT,
    UPDATED_BY     VARCHAR(100),
    UPDATED_AT     TIMESTAMP_NTZ
);

-- ---------- 2. Every parameter, in one place ----------

INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
    (SETTING_KEY, SETTING_VALUE, VALUE_TYPE, CATEGORY, AFFECTS,
     MIN_VALUE, MAX_VALUE, DRIVES, DESCRIPTION, SORT_ORDER, UPDATED_BY, UPDATED_AT)
SELECT COLUMN1, COLUMN2, COLUMN3, COLUMN4, COLUMN5, COLUMN6, COLUMN7,
       COLUMN8, COLUMN9, COLUMN10, 'SYSTEM', '2026-08-21 15:34:00'::TIMESTAMP_NTZ
FROM VALUES
-- ---- Buy position ----
('BUY_OVERBUY_MULT', '1.6', 'NUMBER', 'BUY_POSITION', 'QUERY_TIME', 1.05, 4.0,
 'A class is flagged OVERBUY when stock plus on-order cover exceeds its target cover by this multiple.',
 'Overbuy threshold as a multiple of target cover.', 10),
('BUY_UNDERBUY_MULT', '0.6', 'NUMBER', 'BUY_POSITION', 'QUERY_TIME', 0.1, 0.95,
 'A class is flagged UNDERBUY when stock plus on-order cover falls below its target cover by this multiple. 0.6 rather than 0.5 because at half of target a class is already missing sales.',
 'Underbuy threshold as a multiple of target cover.', 20),
('OTB_PLANNED_FACTOR', '0.35', 'NUMBER', 'BUY_POSITION', 'QUERY_TIME', 0.05, 1.0,
 'Share of the target stock position treated as already planned spend when computing open-to-buy.',
 'Planned-spend factor for open-to-buy.', 30),
-- ---- Exceptions ----
('EXC_SALES_RISK_PCT', '-5', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', -25, -0.5,
 'A department raises a SALES_RISK exception when its forecast is this far below budget.',
 'Sales shortfall threshold, percent to budget.', 10),
('EXC_SALES_RISK_HIGH_PCT', '-10', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', -40, -1,
 'A sales shortfall at or beyond this becomes HIGH severity rather than MEDIUM.',
 'Sales shortfall HIGH severity threshold.', 20),
('EXC_SALES_OPP_PCT', '5', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', 0.5, 25,
 'A department raises a SALES_OPPORTUNITY exception when its forecast is this far above budget.',
 'Sales upside threshold, percent to budget.', 30),
('EXC_SALES_OPP_HIGH_PCT', '10', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', 1, 40,
 'A sales upside at or beyond this becomes HIGH severity.',
 'Sales upside HIGH severity threshold.', 40),
('EXC_MARGIN_GAP_PP', '-1.5', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', -10, -0.1,
 'A department raises a MARGIN_EROSION exception when its POS margin rate is this many percentage points below budget.',
 'Margin gap threshold in percentage points.', 50),
('EXC_MARGIN_GAP_HIGH_PP', '-3', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', -15, -0.2,
 'A margin gap at or beyond this becomes HIGH severity.',
 'Margin gap HIGH severity threshold.', 60),
('EXC_SUPPLIER_DELAY_MIN', '3', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', 1, 30,
 'A supplier raises a DELIVERY_RISK exception at this many delayed purchase orders.',
 'Delayed PO count that raises an exception.', 70),
('EXC_SUPPLIER_DELAY_HIGH', '6', 'NUMBER', 'EXCEPTIONS', 'QUERY_TIME', 2, 50,
 'A delayed PO count at or beyond this becomes HIGH severity.',
 'Delayed PO HIGH severity threshold.', 80),
-- ---- Scenario ----
('SCENARIO_HORIZON_WEEKS', '26', 'NUMBER', 'SCENARIO', 'QUERY_TIME', 4, 52,
 'Weeks in the plan horizon, used to convert a scenario sales figure into a weekly rate when sizing required stock.',
 'Plan horizon length in weeks.', 60),
('SCENARIO_PRICE_ELASTICITY', '-1.4', 'NUMBER', 'SCENARIO', 'QUERY_TIME', -5, -0.1,
 'Unit demand response to a 1% retail price rise. Sets how much volume a goal-seek price move gives back, and therefore whether a GP target is reachable at all.',
 'Price elasticity of demand.', 10),
('SCENARIO_DEMAND_TRANSFER_PCT', '35', 'NUMBER', 'SCENARIO', 'QUERY_TIME', 0, 100,
 'Share of a deleted option''s demand assumed to move to surviving options. The most consequential assumption in a range rationalisation.',
 'Demand transfer on deletion.', 20),
('SCENARIO_NEW_OPTION_RAMP', '0.75', 'NUMBER', 'SCENARIO', 'QUERY_TIME', 0.1, 1.5,
 'Trading level a newly ranged option is assumed to reach, as a fraction of the median of the top half of the existing range.',
 'New option ramp factor.', 30),
('SCENARIO_CANNIBALISATION_PCT', '20', 'NUMBER', 'SCENARIO', 'QUERY_TIME', 0, 90,
 'Share of a new option''s sales assumed to come from existing options rather than being incremental.',
 'Cannibalisation on range increment.', 40),
('SCENARIO_TOP_DECILE_COUNT', '3', 'NUMBER', 'SCENARIO', 'QUERY_TIME', 1, 9,
 'Number of top productivity deciles treated as "popular SKUs" and therefore in scope for targeted price and promo activity.',
 'Popular-SKU decile count.', 50),
-- ---- Currency ----
('FX_RATE_PHP_AUD', '36.1', 'NUMBER', 'CURRENCY', 'QUERY_TIME', 1, 200,
 'Divisor applied to every PHP figure when the currency toggle is set to AUD.',
 'PHP to AUD conversion rate.', 10),
-- ---- Grid ----
('ACTUALS_CUTOFF_DATE', '2026-08-17', 'DATE', 'GRID', 'QUERY_TIME', NULL, NULL,
 'Weeks ending on or before this date carry an Act figure. Later weeks show a dash, and the Act/FC row falls back to FC from here on.',
 'Actuals cut-off for the weekly grid.', 10),
('GRID_DEFAULT_HALF', 'F27-H2', 'STRING', 'GRID', 'QUERY_TIME', NULL, NULL,
 'Half the weekly planning grid opens on. F27 H2 is Jul-Dec 2026, the in-flight half, so Act and FC are both visible.',
 'Default half for the grid.', 20),
('DEFAULT_PLANNER_NAME', 'Wensi Cai', 'STRING', 'GRID', 'QUERY_TIME', NULL, NULL,
 'Planner shown in the grid provenance block when an edit carries no explicit author.',
 'Default planner name.', 30),
-- ---- Generation only: listed so the assumptions are visible, not editable ----
('GEN_TARGET_COVER_MIN_W', '6.0', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Lowest per-class target cover the generator produces. Baked into FACT_OTB_POSITION by 12_planning_otb.sql. Per-class targets are editable in the table below; this only sets the seed floor.',
 'Generated target cover floor.', 10),
('GEN_TARGET_COVER_RANGE_W', '5.0', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Width of the generated target cover band above the floor, giving 6.0 to 11.0 weeks.',
 'Generated target cover band width.', 20),
('GEN_LLY_GROWTH_MIN_PCT', '2.0', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Lowest per-class year-on-year growth used to derive the LLY comparative from LY in 17_planning_weekly.sql.',
 'LLY de-growth floor.', 30),
('GEN_LLY_GROWTH_MAX_PCT', '9.9', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Highest per-class year-on-year growth used to derive LLY. Sets the spread of the CAGR row.',
 'LLY de-growth ceiling.', 40),
('GEN_OPTION_COUNT_MIN', '40', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Smallest option count a class can be generated with. Changing this changes how many SKUs "the bottom 10%" names.',
 'Generated option count floor.', 50),
('GEN_OPTION_COUNT_RANGE', '100', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Width of the generated option count band, giving 40 to 139 options per class.',
 'Generated option count band width.', 60),
('GEN_WEEK_SHAPE_MIN', '220', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Base weight used to spread a monthly plan across its four weeks. Any single week lands between roughly 21% and 29% of its month.',
 'Weekly allocation base weight.', 70),
('GEN_WEEK_SHAPE_RANGE', '81', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Width of the weekly allocation weight band. Wider gives more visible weekly shape.',
 'Weekly allocation weight band.', 80),
('GEN_ACT_VARIANCE_PCT', '7.0', 'NUMBER', 'GENERATION', 'GENERATION', NULL, NULL,
 'Maximum absolute per-week variance applied to the approved forecast to synthesise actuals on closed weeks.',
 'Actuals variance band.', 90)
AS t;

-- ---------- 3. Per-class cover targets ----------
-- Seeded from the values 12_planning_otb.sql generated, so nothing moves on the
-- day this ships. From here on the TABLE is authoritative and the fact's
-- TARGET_COVER_WEEKS column is only the seed source -- see the note in
-- 13_planning_views.sql about why that distinction matters.
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET (
    RBU                 VARCHAR(50),
    DEPARTMENT          VARCHAR(50),
    CLASS               VARCHAR(50),
    CLASS_CODE          VARCHAR(10) NOT NULL,
    TARGET_COVER_WEEKS  NUMBER(10,1),
    UPDATED_BY          VARCHAR(100),
    UPDATED_AT          TIMESTAMP_NTZ,
    NOTE                VARCHAR(500)
);

-- MERGE, not TRUNCATE + INSERT: a rerun of this script must not silently discard
-- a target a planner has edited. New classes are added; existing rows are left
-- exactly as they are.
MERGE INTO BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET t
USING (
    SELECT h.RBU, h.DEPARTMENT, h.CLASS, h.CLASS_CODE,
           ROUND(AVG(o.TARGET_COVER_WEEKS), 1) AS TARGET_COVER_WEEKS
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
    LEFT JOIN BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION o
           ON o.CLASS_CODE = h.CLASS_CODE AND o.FISCAL_YEAR = 'F27'
    GROUP BY h.RBU, h.DEPARTMENT, h.CLASS, h.CLASS_CODE
) s
ON t.CLASS_CODE = s.CLASS_CODE
WHEN NOT MATCHED THEN INSERT
    (RBU, DEPARTMENT, CLASS, CLASS_CODE, TARGET_COVER_WEEKS, UPDATED_BY, UPDATED_AT, NOTE)
    VALUES (s.RBU, s.DEPARTMENT, s.CLASS, s.CLASS_CODE,
            NVL(s.TARGET_COVER_WEEKS, 8.0), 'SYSTEM', CURRENT_TIMESTAMP(),
            'Seeded from the generated plan.')
-- Labels follow a hierarchy rename; the target and its provenance do not.
WHEN MATCHED THEN UPDATE SET
    t.RBU = s.RBU, t.DEPARTMENT = s.DEPARTMENT, t.CLASS = s.CLASS;

-- ---------- 4. The one-row parameter pivot ----------
-- One row, one column per QUERY_TIME parameter. CROSS JOIN this into any view
-- that needs a threshold. TO_DOUBLE with an NVL fallback so a missing or
-- malformed row degrades to the documented default rather than turning every
-- downstream comparison into NULL and silently emptying a page.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM AS
SELECT
    NVL(MAX(IFF(SETTING_KEY = 'BUY_OVERBUY_MULT',        TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 1.6)  AS OVERBUY_MULT,
    NVL(MAX(IFF(SETTING_KEY = 'BUY_UNDERBUY_MULT',       TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 0.6)  AS UNDERBUY_MULT,
    NVL(MAX(IFF(SETTING_KEY = 'OTB_PLANNED_FACTOR',      TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 0.35) AS OTB_PLANNED_FACTOR,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SALES_RISK_PCT',      TRY_TO_DOUBLE(SETTING_VALUE), NULL)), -5)   AS SALES_RISK_PCT,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SALES_RISK_HIGH_PCT', TRY_TO_DOUBLE(SETTING_VALUE), NULL)), -10)  AS SALES_RISK_HIGH_PCT,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SALES_OPP_PCT',       TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 5)    AS SALES_OPP_PCT,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SALES_OPP_HIGH_PCT',  TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 10)   AS SALES_OPP_HIGH_PCT,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_MARGIN_GAP_PP',       TRY_TO_DOUBLE(SETTING_VALUE), NULL)), -1.5) AS MARGIN_GAP_PP,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_MARGIN_GAP_HIGH_PP',  TRY_TO_DOUBLE(SETTING_VALUE), NULL)), -3)   AS MARGIN_GAP_HIGH_PP,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SUPPLIER_DELAY_MIN',  TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 3)    AS SUPPLIER_DELAY_MIN,
    NVL(MAX(IFF(SETTING_KEY = 'EXC_SUPPLIER_DELAY_HIGH', TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 6)    AS SUPPLIER_DELAY_HIGH,
    NVL(MAX(IFF(SETTING_KEY = 'SCENARIO_HORIZON_WEEKS',  TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 26)   AS HORIZON_WEEKS,
    NVL(MAX(IFF(SETTING_KEY = 'FX_RATE_PHP_AUD',         TRY_TO_DOUBLE(SETTING_VALUE), NULL)), 36.1) AS FX_RATE_PHP_AUD,
    NVL(MAX(IFF(SETTING_KEY = 'ACTUALS_CUTOFF_DATE',     TRY_TO_DATE(SETTING_VALUE),   NULL)),
        '2026-08-17'::DATE)                                                                          AS ACTUALS_CUTOFF_DATE
FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING;

-- ---------- 5. Validated writes ----------
-- Clamping happens HERE, not only in the form. An overbuy multiplier below the
-- underbuy multiplier would make every class simultaneously over- and
-- under-bought, and a disabled input is not a constraint.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.SAVE_PLANNING_SETTING(
    P_KEY        VARCHAR,
    P_VALUE      VARCHAR,
    P_UPDATED_BY VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_affects VARCHAR;
  v_type    VARCHAR;
  v_min     FLOAT;
  v_max     FLOAT;
  v_num     FLOAT;
  v_over    FLOAT;
  v_under   FLOAT;
BEGIN
  SELECT AFFECTS, VALUE_TYPE, MIN_VALUE, MAX_VALUE
    INTO :v_affects, :v_type, :v_min, :v_max
  FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
  WHERE SETTING_KEY = :P_KEY;

  IF (:v_affects IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Unknown setting: ' || :P_KEY)::STRING;
  END IF;

  IF (:v_affects = 'GENERATION') THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error',
      'This is a data-generation parameter. It is baked into the facts by the ' ||
      'SQL scripts, so editing it here would change nothing. Re-run the data ' ||
      'deployment to change it.')::STRING;
  END IF;

  IF (:v_type = 'DATE') THEN
    IF (TRY_TO_DATE(:P_VALUE) IS NULL) THEN
      RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Not a valid date: ' || :P_VALUE)::STRING;
    END IF;
  ELSEIF (:v_type = 'NUMBER') THEN
    v_num := TRY_TO_DOUBLE(:P_VALUE);
    IF (:v_num IS NULL) THEN
      RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Not a number: ' || :P_VALUE)::STRING;
    END IF;
    IF (:v_min IS NOT NULL AND :v_num < :v_min) THEN
      RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error',
        'Below the allowed minimum of ' || :v_min)::STRING;
    END IF;
    IF (:v_max IS NOT NULL AND :v_num > :v_max) THEN
      RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error',
        'Above the allowed maximum of ' || :v_max)::STRING;
    END IF;
  END IF;

  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
  SET SETTING_VALUE = :P_VALUE,
      UPDATED_BY    = NVL(:P_UPDATED_BY, 'Planner'),
      UPDATED_AT    = CURRENT_TIMESTAMP()
  WHERE SETTING_KEY = :P_KEY;

  -- Cross-field check AFTER the write, then roll the value back if the pair is
  -- now incoherent. Checking only the single field in isolation would let the
  -- two multipliers cross over one edit at a time.
  SELECT OVERBUY_MULT, UNDERBUY_MULT INTO :v_over, :v_under
  FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM;

  IF (:v_under >= :v_over) THEN
    UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
    SET SETTING_VALUE = CASE SETTING_KEY
                          WHEN 'BUY_OVERBUY_MULT'  THEN '1.6'
                          WHEN 'BUY_UNDERBUY_MULT' THEN '0.6'
                        END
    WHERE SETTING_KEY = :P_KEY;
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error',
      'The underbuy multiplier must be below the overbuy multiplier, or every ' ||
      'class would be flagged both over- and under-bought. Reverted to the default.')::STRING;
  END IF;

  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'key', :P_KEY, 'value', :P_VALUE)::STRING;
END;
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.SAVE_CLASS_TARGET(
    P_CLASS      VARCHAR,
    P_WEEKS      FLOAT,
    P_UPDATED_BY VARCHAR,
    P_NOTE       VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_n INT;
BEGIN
  -- 0.5 to 40 weeks. Below half a week the cover ratio is meaningless; beyond 40
  -- a "target" is really a decision to stop buying, which is a different action.
  IF (:P_WEEKS IS NULL OR :P_WEEKS < 0.5 OR :P_WEEKS > 40) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error',
      'Target cover must be between 0.5 and 40 weeks.')::STRING;
  END IF;

  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET
  SET TARGET_COVER_WEEKS = ROUND(:P_WEEKS, 1),
      UPDATED_BY         = NVL(:P_UPDATED_BY, 'Planner'),
      UPDATED_AT         = CURRENT_TIMESTAMP(),
      NOTE               = :P_NOTE
  WHERE UPPER(CLASS) = UPPER(:P_CLASS);

  v_n := SQLROWCOUNT;
  IF (:v_n = 0) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Unknown class: ' || :P_CLASS)::STRING;
  END IF;

  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'class', :P_CLASS, 'weeks', ROUND(:P_WEEKS, 1))::STRING;
END;
$$;
