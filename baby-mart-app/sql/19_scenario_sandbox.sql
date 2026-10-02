-- ============================================================
-- Anko Global Planning — scenario sandbox, annotations and approval lineage
--
-- Backs the three steps of the SIMULATE SCENARIOS narrative and the editing
-- chrome of the weekly grid:
--
--   Step 1  range rationalisation, prompted in natural language
--   Step 2  goal seek, returning multiple costed options
--   Step 3  the options sit in a SANDBOX and are compared on sales, GP and stock
--
-- THE CENTRAL DESIGN DECISION: A SCENARIO IS AN OVERLAY, NOT A WRITE
--
-- Nothing here ever updates FACT_MFP_WEEKLY or FACT_MFP_PLAN. A scenario stores
-- only the cells it CHANGES, and every read resolves as
-- COALESCE(scenario_cell, fact). That is what makes the slide's requirement --
-- "applies a scenario assumption without changing the approved forecast" --
-- structurally true rather than a promise someone has to remember to keep:
--
--   * the approved forecast cannot be corrupted by an experiment, because no
--     code path writes to it;
--   * an abandoned scenario costs one DELETE, with no restore-from-baseline
--     step that could half-fail;
--   * twenty scenarios cost twenty small overlays, not twenty copies of a
--     100k-row fact, so "generate lots of scenarios" stays cheap;
--   * APP_FC keeps reading from the fact, so the grid's "Var App. FC" row shows
--     the scenario's divergence from the approved plan for free.
--
-- WHY SALES/GP IMPACT AND STOCK IMPACT COME FROM DIFFERENT TABLES
--
-- Sales, units and GP impact are derived from PLANNING_SCENARIO_CELL, because
-- those are the numbers the grid displays and the two must not be able to
-- disagree. Stock impact is derived from PLANNING_SCENARIO_OPTION, because the
-- weekly grid has no stock row at all -- stock lives at option level and in the
-- OTB fact. Deriving stock from the cells would mean inventing it.
--
-- ONE SCHEMA NOTE ON REASON CODES
--
-- REASON_CODE is nullable per cell and deliberately not enforced. Forcing a
-- dropdown on every keystroke makes a 200-cell grid unusable, and the result is
-- planners picking OTHER on everything, which is worse than an honest NULL.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Reason codes ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE (
    REASON_CODE  VARCHAR(30),
    LABEL        VARCHAR(80),
    DESCRIPTION  VARCHAR(300),
    SORT_ORDER   INT
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE VALUES
('MARKETING_CAMPAIGN',  'Marketing campaign',    'Confirmed activity not in the ML baseline.',                     1),
('SUPPLIER_CONSTRAINT', 'Supplier constraint',   'Supply cannot support the forecast quantity.',                   2),
('RANGE_CHANGE',        'Range change',          'Options added, deleted or re-ranged.',                           3),
('PRICE_CHANGE',        'Price or promo change', 'Retail price or promotional plan moved.',                        4),
('COMPETITOR_ACTION',   'Competitor action',     'Response to competitor pricing or range activity.',              5),
('MACRO',               'Macro / consumer',      'Consumer demand shift not specific to the range.',               6),
('ML_OVERRIDE',         'ML override',           'Planner judgement overriding the model, reason stated in note.',  7),
('SPACE_CHANGE',        'Space / store change',  'Store openings, relocations or bay count changes.',               8),
('OTHER',               'Other',                 'Anything not covered above. Note required to be useful.',         9);

-- ---------- 2. Scenario header ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO (
    SCENARIO_ID        VARCHAR(40)  NOT NULL,
    SCENARIO_NAME      VARCHAR(200),
    SCENARIO_TYPE      VARCHAR(40),
        -- MANUAL                    planner typed into the grid
        -- RANGE_RATIONALISATION     slide step 1
        -- GOAL_SEEK_PRICE_PROMO     slide step 2, option a
        -- GOAL_SEEK_RANGE_INCREMENT slide step 2, option b
        -- LEVER                     the existing slider model
    -- Goal seek returns SEVERAL options to one question. They share a parent so
    -- the sandbox can present them as alternatives to each other rather than as
    -- unrelated scenarios a user has to remember are mutually exclusive.
    PARENT_SCENARIO_ID VARCHAR(40),
    SIBLING_LABEL      VARCHAR(10),          -- '1', '2a', '2b' as on the slide
    PROMPT_TEXT        VARCHAR(2000),        -- the planner's own words, kept verbatim
    RBU                VARCHAR(50),
    DEPARTMENT         VARCHAR(50),          -- NULL = whole RBU
    CLASS              VARCHAR(50),          -- NULL = whole department
    FISCAL_YEAR        VARCHAR(4),
    HALF               VARCHAR(2),           -- NULL = full year
    LEVERS             VARIANT,              -- slider values, when type = LEVER
    ASSUMPTIONS        VARIANT,              -- what was held constant, and why
    NARRATIVE          VARCHAR(4000),        -- AI-written framing of the option
    STATUS             VARCHAR(12),          -- DRAFT | SUBMITTED | APPROVED | REJECTED
    CREATED_BY         VARCHAR(100),
    CREATED_AT         TIMESTAMP_NTZ,
    UPDATED_AT         TIMESTAMP_NTZ,
    NOTES              VARCHAR(2000)
);

-- ---------- 3. Scenario cells: the editable grid overlay ----------
-- Week grain, class level, additive metrics only. Class level because each sheet
-- in the source workbook is a single class and the roll-up must stay
-- SUM(children); additive metrics only because storing a margin PERCENTAGE would
-- make the grid's month subtotal an average of four percentages.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL (
    SCENARIO_ID   VARCHAR(40)  NOT NULL,
    DEPARTMENT    VARCHAR(50),
    CLASS         VARCHAR(50),
    CLASS_CODE    VARCHAR(10),
    FISCAL_YEAR   VARCHAR(4),
    PERIOD_CODE   VARCHAR(10),
    WEEK_NO       INT,
    WEEK_SEQ      INT,
    METRIC        VARCHAR(30),   -- SLS_PHP | SLS_UNITS | POS_GP_AMT
    VALUE_PHP     NUMBER(18,2),  -- the scenario value
    BASELINE_PHP  NUMBER(18,2),  -- FC at the moment of the edit, for the delta
    -- A hand-typed cell is PINNED: re-running a lever or a generated scenario
    -- recalculates only unpinned cells. Without this, a planner who types a
    -- number learned from a supplier call loses it the next time anyone moves a
    -- slider, which is the fastest way to make people stop using the tool.
    IS_PINNED     BOOLEAN,
    REASON_CODE   VARCHAR(30),
    REASON_NOTE   VARCHAR(1000),
    EDITED_BY     VARCHAR(100),
    EDITED_AT     TIMESTAMP_NTZ
);

-- ---------- 4. Scenario option actions ----------
-- Which options a scenario drops, adds or reprices, WITH the quantities each
-- one contributes. This is both the explanation ("these eleven SKUs, by name")
-- and the source of stock impact.
--
-- OPTION_ID is nullable because a range INCREMENT adds options that do not exist
-- yet; those rows carry a synthetic label and their deltas directly.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION (
    SCENARIO_ID      VARCHAR(40) NOT NULL,
    OPTION_ID        VARCHAR(20),
    OPTION_LABEL     VARCHAR(120),   -- name shown in the UI, synthetic for ADD
    CLASS            VARCHAR(50),
    ACTION           VARCHAR(10),    -- DROP | ADD | REPRICE
    -- Share of a dropped option's demand assumed to move to surviving options.
    -- The single most consequential assumption in a rationalisation, so it is
    -- stored per option rather than buried in a procedure constant.
    TRANSFER_PCT     NUMBER(6,2),
    SLS_DELTA_PHP    NUMBER(18,2),
    UNITS_DELTA      NUMBER(18,0),
    GP_DELTA_PHP     NUMBER(18,2),
    STOCK_DELTA_PHP  NUMBER(18,2),
    PRODUCTIVITY_RANK INT,
    GP_PER_OPTION_WEEK NUMBER(18,2),
    COVER_WEEKS      NUMBER(10,1)
);

-- ---------- 5. Annotations: the workbook's comment and tag furniture ----------
-- The source workbook carries a comment button, region tags (VIC / ALL / NSW)
-- and event markers (NEW / RE-LOC) on header rows above the numbers, plus the
-- owning planner and a last-edited timestamp.
--
-- These are stored as ANNOTATIONS AGAINST A WEEK, not as a data split. The
-- planning model has no regional forecast: there is no VIC number to show. A tag
-- that looked clickable and then revealed nothing would be worse than no tag, so
-- a region tag here means exactly what it means in the spreadsheet -- a note
-- that this week's number is driven by something regional.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION (
    ANNOTATION_ID   VARCHAR(40) NOT NULL,
    SCENARIO_ID     VARCHAR(40),   -- NULL = against the live plan, not a scenario
    DEPARTMENT      VARCHAR(50),
    CLASS           VARCHAR(50),
    FISCAL_YEAR     VARCHAR(4),
    PERIOD_CODE     VARCHAR(10),
    WEEK_NO         INT,           -- NULL = applies to the whole class
    METRIC          VARCHAR(30),   -- NULL = not tied to one metric block
    VERSION         VARCHAR(8),    -- NULL = not tied to one version row
    ANNOTATION_TYPE VARCHAR(20),   -- COMMENT | REGION_TAG | EVENT_MARKER
    ANNOTATION_VALUE VARCHAR(1000),-- free text, or VIC/NSW/ALL, or NEW/RE-LOC
    AUTHOR          VARCHAR(100),
    CREATED_AT      TIMESTAMP_NTZ
);

-- Seed the annotations visible in the source workbook so the grid opens looking
-- like the sheet it replaces, rather than looking like an empty version of it.
INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION
    (ANNOTATION_ID, SCENARIO_ID, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE,
     WEEK_NO, METRIC, VERSION, ANNOTATION_TYPE, ANNOTATION_VALUE, AUTHOR, CREATED_AT)
SELECT
    'SEED-' || h.CLASS_CODE || '-' || s.SUFFIX,
    NULL, h.DEPARTMENT, h.CLASS, 'F27',
    'PD0' || s.PD || 'F27', s.WK, s.METRIC, s.VERSION,
    s.ATYPE, s.AVAL, s.AUTHOR, '2026-08-21 15:34:00'::TIMESTAMP_NTZ
FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
JOIN (
    SELECT * FROM VALUES
        ('R1', 2, 1,    NULL,      NULL,  'REGION_TAG',   'VIC',    'SYSTEM'),
        ('R2', 2, 3,    NULL,      NULL,  'REGION_TAG',   'ALL',    'SYSTEM'),
        ('R3', 3, 2,    NULL,      NULL,  'REGION_TAG',   'NSW',    'SYSTEM'),
        ('E1', 2, 2,    NULL,      NULL,  'EVENT_MARKER', 'NEW',    'SYSTEM'),
        ('E2', 3, 4,    NULL,      NULL,  'EVENT_MARKER', 'RE-LOC', 'SYSTEM'),
        ('C1', 2, 1, 'SLS_PHP',    'FC',  'COMMENT',
         'Range review pending. Holding forecast flat until the buy is confirmed.', 'Wensi Cai')
    AS t(SUFFIX, PD, WK, METRIC, VERSION, ATYPE, AVAL, AUTHOR)
) s;

-- ---------- 6. Approved forecast versions ----------
-- The App. FC lineage. Approving a scenario snapshots it here; the fact stays
-- the ML-generated baseline. Rewriting the fact on approval would destroy the
-- baseline that the ML-versus-planner attribution depends on, and with it any
-- future ability to show whether manual intervention improved accuracy.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION (
    VERSION_ID         VARCHAR(40) NOT NULL,
    VERSION_NO         INT,
    LABEL              VARCHAR(200),
    STATUS             VARCHAR(12),   -- APPROVED | SUPERSEDED
    SOURCE_SCENARIO_ID VARCHAR(40),
    RBU                VARCHAR(50),
    DEPARTMENT         VARCHAR(50),
    CLASS              VARCHAR(50),
    APPROVED_BY        VARCHAR(100),
    APPROVED_AT        TIMESTAMP_NTZ,
    NOTES              VARCHAR(2000),
    -- FX rate and cover targets in force at approval, frozen onto the version.
    -- Without this a historical forecast becomes uninterpretable the moment
    -- someone changes the FX setting: its AUD figures would silently re-state.
    SETTINGS_SNAPSHOT  VARIANT
);

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE (
    VERSION_ID        VARCHAR(40) NOT NULL,
    PLAN_LEVEL        VARCHAR(12),
    RBU               VARCHAR(50),
    DEPARTMENT        VARCHAR(50),
    CLASS             VARCHAR(50),
    FISCAL_YEAR       VARCHAR(4),
    PERIOD_CODE       VARCHAR(10),
    WEEK_NO           INT,
    WEEK_SEQ          INT,
    METRIC            VARCHAR(30),
    VALUE_PHP         NUMBER(18,2),
    -- The attribution the history page reads: what the model said, and what the
    -- planner moved. Kept separate so a version-over-version move can be
    -- explained rather than merely observed.
    ML_BASELINE_PHP   NUMBER(18,2),
    PLANNER_DELTA_PHP NUMBER(18,2)
);

-- ---------- 7. Decision log ----------
-- The AI recommendation and the human decision are SEPARATE columns on purpose.
-- Overwriting one with the other would erase the most interesting fact in the
-- audit trail: whether the planner agreed with the model or overrode it.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION (
    DECISION_ID       VARCHAR(40) NOT NULL,
    SCENARIO_ID       VARCHAR(40),
    AI_RECOMMENDATION VARCHAR(12),    -- ACCEPT | REJECT | MODIFY
    AI_RATIONALE      VARCHAR(4000),
    AI_CONFIDENCE     VARCHAR(10),    -- HIGH | MEDIUM | LOW
    HUMAN_DECISION    VARCHAR(12),    -- ACCEPT | REJECT | MODIFY
    HUMAN_RATIONALE   VARCHAR(2000),
    DECIDED_BY        VARCHAR(100),
    DECIDED_AT        TIMESTAMP_NTZ,
    AGREED_WITH_AI    BOOLEAN,        -- derived at write time, for reporting
    RESULTING_VERSION_ID VARCHAR(40)
);

-- ---------- 8. Scenario-resolved weekly read ----------
-- The overlay resolution. One row per scenario per class/week/metric, with the
-- scenario value where a cell exists and the forecast underneath where it does
-- not. IS_EDITED drives the blue cell fill in the grid.
--
-- Scoped by the scenario's own DEPARTMENT / CLASS so a class-level scenario does
-- not fan out across all 33 classes.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_WEEKLY AS
SELECT
    s.SCENARIO_ID,
    s.SCENARIO_NAME,
    s.STATUS,
    w.RBU, w.DEPARTMENT, w.CLASS, w.CLASS_CODE, w.PLAN_LEVEL,
    w.FISCAL_YEAR, w.PERIOD_CODE, w.PERIOD_NO, w.MONTH_NAME, w.HALF,
    w.WEEK_NO, w.WEEK_SEQ, w.WEEK_LABEL, w.WEEK_ENDING_DATE, w.IS_CLOSED,
    w.METRIC,
    COALESCE(c.VALUE_PHP, w.VALUE_PHP)          AS VALUE_PHP,
    w.VALUE_PHP                                 AS BASELINE_PHP,
    (c.SCENARIO_ID IS NOT NULL)                 AS IS_EDITED,
    COALESCE(c.IS_PINNED, FALSE)                AS IS_PINNED,
    c.REASON_CODE,
    c.REASON_NOTE,
    c.EDITED_BY,
    c.EDITED_AT
FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO s
JOIN BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
  ON  w.VERSION    = 'FC'
 AND  w.PLAN_LEVEL = 'CLASS'
 AND  w.FISCAL_YEAR = COALESCE(s.FISCAL_YEAR, w.FISCAL_YEAR)
 AND (s.DEPARTMENT IS NULL OR w.DEPARTMENT = s.DEPARTMENT)
 AND (s.CLASS      IS NULL OR w.CLASS      = s.CLASS)
LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL c
  ON  c.SCENARIO_ID = s.SCENARIO_ID
 AND  c.CLASS       = w.CLASS
 AND  c.PERIOD_CODE = w.PERIOD_CODE
 AND  c.WEEK_NO     = w.WEEK_NO
 AND  c.METRIC      = w.METRIC;

-- ---------- 9. Scenario impact: the Step 3 comparison table ----------
-- Sales, units and GP come from the CELLS, so the comparison can never disagree
-- with what the grid shows. Stock comes from the OPTION actions, because the
-- weekly grid has no stock row and inventing one would be a lie.
--
-- Margin RATE is rebuilt as SUM(gp)/SUM(sales) at both baseline and scenario,
-- never as a difference of two averages. A rationalisation's whole point is that
-- it lifts the rate while lowering the dollars, so getting this wrong would
-- invert the headline finding.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_IMPACT AS
WITH cell_impact AS (
    SELECT
        v.SCENARIO_ID,
        SUM(IFF(v.METRIC = 'SLS_PHP',    v.BASELINE_PHP, 0)) AS BASE_SLS,
        SUM(IFF(v.METRIC = 'SLS_PHP',    v.VALUE_PHP,    0)) AS SCEN_SLS,
        SUM(IFF(v.METRIC = 'SLS_UNITS',  v.BASELINE_PHP, 0)) AS BASE_UNITS,
        SUM(IFF(v.METRIC = 'SLS_UNITS',  v.VALUE_PHP,    0)) AS SCEN_UNITS,
        SUM(IFF(v.METRIC = 'POS_GP_AMT', v.BASELINE_PHP, 0)) AS BASE_GP,
        SUM(IFF(v.METRIC = 'POS_GP_AMT', v.VALUE_PHP,    0)) AS SCEN_GP,
        COUNT_IF(v.IS_EDITED)                                AS EDITED_CELLS
    FROM BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_WEEKLY v
    GROUP BY v.SCENARIO_ID
),
stock_impact AS (
    SELECT SCENARIO_ID,
           SUM(STOCK_DELTA_PHP)              AS STOCK_DELTA_PHP,
           COUNT_IF(ACTION = 'DROP')         AS OPTIONS_DROPPED,
           COUNT_IF(ACTION = 'ADD')          AS OPTIONS_ADDED,
           COUNT_IF(ACTION = 'REPRICE')      AS OPTIONS_REPRICED
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
    GROUP BY SCENARIO_ID
)
SELECT
    s.SCENARIO_ID, s.SCENARIO_NAME, s.SCENARIO_TYPE, s.PARENT_SCENARIO_ID,
    s.SIBLING_LABEL, s.PROMPT_TEXT, s.RBU, s.DEPARTMENT, s.CLASS,
    s.FISCAL_YEAR, s.HALF, s.STATUS, s.NARRATIVE, s.ASSUMPTIONS,
    s.CREATED_BY, s.CREATED_AT,
    ci.BASE_SLS, ci.SCEN_SLS,
    ci.SCEN_SLS - ci.BASE_SLS                                             AS SLS_DELTA_PHP,
    ROUND(100.0 * (ci.SCEN_SLS - ci.BASE_SLS) / NULLIF(ci.BASE_SLS, 0), 2) AS SLS_DELTA_PCT,
    ci.BASE_UNITS, ci.SCEN_UNITS,
    ci.SCEN_UNITS - ci.BASE_UNITS                                         AS UNITS_DELTA,
    ci.BASE_GP, ci.SCEN_GP,
    ci.SCEN_GP - ci.BASE_GP                                               AS GP_DELTA_PHP,
    ROUND(100.0 * (ci.SCEN_GP - ci.BASE_GP) / NULLIF(ci.BASE_GP, 0), 2)   AS GP_DELTA_PCT,
    -- Ratios rebuilt from the additive pair at each side.
    ROUND(ci.BASE_SLS / NULLIF(ci.BASE_UNITS, 0), 2)                      AS BASE_ASP,
    ROUND(ci.SCEN_SLS / NULLIF(ci.SCEN_UNITS, 0), 2)                      AS SCEN_ASP,
    ROUND(100.0 * ci.BASE_GP / NULLIF(ci.BASE_SLS, 0), 2)                 AS BASE_GP_PCT,
    ROUND(100.0 * ci.SCEN_GP / NULLIF(ci.SCEN_SLS, 0), 2)                 AS SCEN_GP_PCT,
    ROUND(100.0 * ci.SCEN_GP / NULLIF(ci.SCEN_SLS, 0)
        - 100.0 * ci.BASE_GP / NULLIF(ci.BASE_SLS, 0), 2)                 AS GP_PCT_DELTA_PP,
    COALESCE(si.STOCK_DELTA_PHP, 0)                                       AS STOCK_DELTA_PHP,
    COALESCE(si.OPTIONS_DROPPED, 0)                                       AS OPTIONS_DROPPED,
    COALESCE(si.OPTIONS_ADDED, 0)                                         AS OPTIONS_ADDED,
    COALESCE(si.OPTIONS_REPRICED, 0)                                      AS OPTIONS_REPRICED,
    ci.EDITED_CELLS
FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO s
LEFT JOIN cell_impact  ci ON ci.SCENARIO_ID = s.SCENARIO_ID
LEFT JOIN stock_impact si ON si.SCENARIO_ID = s.SCENARIO_ID;
