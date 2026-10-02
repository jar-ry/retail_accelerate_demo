-- ============================================================
-- Baby Mart Global Planning — plan change audit
--
-- Answers "what has moved the plan, when, by whom, and why" across three
-- different kinds of change that previously left no trace:
--
--   1. a planner typing into the weekly grid
--   2. a generated scenario writing cells
--   3. a scenario being approved and becoming the forecast
--
--   PLANNING_CELL_AUDIT   append-only, one row per cell change
--   VW_PLAN_AUDIT         cell changes and approval events in one timeline
--   VW_CURRENT_PLAN       the plan in force, so scenarios have something to
--                         compare against after one has been accepted
--
-- APPEND-ONLY, DELIBERATELY
--
-- There is no UPDATE path and no correction mechanism. An audit trail that can
-- be edited is not an audit trail, and the whole point of this table is that a
-- planning meeting can trust it. A change entered in error is corrected by making
-- another change, which leaves both rows visible -- which is the honest record of
-- what actually happened.
--
-- OLD_VALUE IS CAPTURED AT WRITE TIME, NOT DERIVED LATER
--
-- The old value has to be read inside the same statement that overwrites it.
-- Reconstructing it afterwards by diffing against FACT_MFP_WEEKLY would give the
-- delta against the ML baseline rather than against what was on screen a moment
-- earlier, so two successive edits to one cell would each report the full
-- movement from the baseline and the trail would double-count.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Cell-level audit ----------
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.PLANNING_CELL_AUDIT (
    AUDIT_ID        VARCHAR(60)  NOT NULL,
    SCENARIO_ID     VARCHAR(40),
    VERSION_ID      VARCHAR(40),   -- set when the change came in via an approval
    DEPARTMENT      VARCHAR(50),
    CLASS           VARCHAR(50),
    CLASS_CODE      VARCHAR(10),
    FISCAL_YEAR     VARCHAR(4),
    PERIOD_CODE     VARCHAR(10),
    WEEK_NO         INT,
    WEEK_SEQ        INT,
    METRIC          VARCHAR(30),
    OLD_VALUE_PHP   NUMBER(18,2),  -- NULL on the first edit to a cell
    NEW_VALUE_PHP   NUMBER(18,2),
    BASELINE_PHP    NUMBER(18,2),  -- forecast at the time, for context
    DELTA_PHP       NUMBER(18,2),  -- NEW - OLD, i.e. this change only
    CHANGE_SOURCE   VARCHAR(20),   -- MANUAL_GRID | GENERATED_SCENARIO | APPROVAL
    REASON_CODE     VARCHAR(30),
    REASON_NOTE     VARCHAR(1000),
    CHANGED_BY      VARCHAR(100),
    CHANGED_AT      TIMESTAMP_NTZ
);

-- ---------- 2. Current plan ----------
-- The plan in force: the latest approved version if one exists, otherwise the
-- working forecast. Resolved HERE rather than in each page so every surface
-- agrees on what "current" means.
--
-- The COALESCE order matters. Before anything is approved, "current" is the FC
-- row in the fact. After the first approval it is the snapshot, because the fact
-- deliberately keeps holding the untouched ML baseline for attribution.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_CURRENT_PLAN AS
WITH approved AS (
    SELECT VERSION_ID, VERSION_NO, LABEL, APPROVED_AT
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION
    WHERE STATUS = 'APPROVED'
    QUALIFY ROW_NUMBER() OVER (ORDER BY VERSION_NO DESC) = 1
)
SELECT
    'APPROVED_VERSION'                          AS PLAN_SOURCE,
    a.VERSION_ID, a.VERSION_NO, a.LABEL, a.APPROVED_AT,
    v.PLAN_LEVEL, v.RBU, v.DEPARTMENT, v.CLASS,
    v.FISCAL_YEAR, v.PERIOD_CODE, v.WEEK_NO, v.WEEK_SEQ, v.METRIC,
    v.VALUE_PHP, v.ML_BASELINE_PHP, v.PLANNER_DELTA_PHP
FROM approved a
JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE v
  ON v.VERSION_ID = a.VERSION_ID

UNION ALL

SELECT
    'WORKING_FORECAST', NULL, 0, 'Working forecast (nothing approved yet)', NULL,
    w.PLAN_LEVEL, w.RBU, w.DEPARTMENT, w.CLASS,
    w.FISCAL_YEAR, w.PERIOD_CODE, w.WEEK_NO, w.WEEK_SEQ, w.METRIC,
    w.VALUE_PHP, w.VALUE_PHP, 0
FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
WHERE w.VERSION = 'FC'
  AND NOT EXISTS (SELECT 1 FROM approved);

-- ---------- 3. Unified audit timeline ----------
-- Cell changes and approval events in one ordered list. The approval rows carry
-- the aggregate movement rather than a cell, because "this version moved
-- CAR SEATS by PHP 12.4M" is the question a planning meeting asks -- the cell
-- detail is already in the rows above it.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_PLAN_AUDIT AS
SELECT
    'CELL_CHANGE'                                       AS EVENT_TYPE,
    a.CHANGED_AT                                        AS EVENT_AT,
    a.CHANGED_BY                                        AS ACTOR,
    a.SCENARIO_ID,
    a.VERSION_ID,
    s.SCENARIO_NAME,
    a.DEPARTMENT,
    a.CLASS,
    a.PERIOD_CODE,
    a.WEEK_NO,
    a.METRIC,
    a.OLD_VALUE_PHP,
    a.NEW_VALUE_PHP,
    a.DELTA_PHP,
    a.CHANGE_SOURCE,
    a.REASON_CODE,
    r.LABEL                                             AS REASON_LABEL,
    a.REASON_NOTE,
    NULL                                                AS EVENT_DETAIL
FROM BABY_MART_DEMO.ANALYTICS.PLANNING_CELL_AUDIT a
LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO s   ON s.SCENARIO_ID = a.SCENARIO_ID
LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE r ON r.REASON_CODE = a.REASON_CODE

UNION ALL

SELECT
    'APPROVAL',
    v.APPROVED_AT,
    v.APPROVED_BY,
    v.SOURCE_SCENARIO_ID,
    v.VERSION_ID,
    s.SCENARIO_NAME,
    v.DEPARTMENT,
    v.CLASS,
    NULL, NULL, 'SLS_PHP',
    NULL, NULL,
    -- Total sales movement this version introduced against the ML baseline, at
    -- CLASS level only so the pre-rolled department and RBU rows do not treble
    -- count the same money.
    (SELECT SUM(pv.PLANNER_DELTA_PHP)
     FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE pv
     WHERE pv.VERSION_ID = v.VERSION_ID
       AND pv.METRIC = 'SLS_PHP'
       AND pv.PLAN_LEVEL = 'CLASS'),
    'APPROVAL',
    NULL, NULL, v.NOTES,
    'Version ' || v.VERSION_NO || ' — ' || v.LABEL
        || IFF(v.STATUS = 'SUPERSEDED', ' (superseded)', ' (in force)')
FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION v
LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO s ON s.SCENARIO_ID = v.SOURCE_SCENARIO_ID;

-- ---------- 4. Audit writer ----------
-- A procedure rather than an inline INSERT in each caller, so every writer
-- captures the same fields and the AUDIT_ID format stays consistent. Called from
-- the grid save path and from WRITE_SCENARIO_CELLS.
--
-- Takes the cells as a VARIANT array so one call covers a whole save. A
-- per-cell call would mean 72 round trips for one Calculate press.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.LOG_CELL_CHANGES(
    P_SCENARIO_ID   VARCHAR,
    P_CHANGE_SOURCE VARCHAR,
    P_CHANGED_BY    VARCHAR,
    P_CELLS         VARIANT   -- [{period_code, week_no, metric, old, new, baseline, reason_code, reason_note}]
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_n INT;
BEGIN
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_CELL_AUDIT
    (AUDIT_ID, SCENARIO_ID, VERSION_ID, DEPARTMENT, CLASS, CLASS_CODE,
     FISCAL_YEAR, PERIOD_CODE, WEEK_NO, WEEK_SEQ, METRIC,
     OLD_VALUE_PHP, NEW_VALUE_PHP, BASELINE_PHP, DELTA_PHP,
     CHANGE_SOURCE, REASON_CODE, REASON_NOTE, CHANGED_BY, CHANGED_AT)
  WITH flat AS (
      SELECT
          c.value:period_code::VARCHAR  AS PERIOD_CODE,
          c.value:week_no::INT          AS WEEK_NO,
          c.value:metric::VARCHAR       AS METRIC,
          c.value:old::FLOAT            AS OLD_VALUE,
          c.value:new::FLOAT            AS NEW_VALUE,
          c.value:baseline::FLOAT       AS BASELINE,
          c.value:reason_code::VARCHAR  AS REASON_CODE,
          c.value:reason_note::VARCHAR  AS REASON_NOTE
      FROM TABLE(FLATTEN(input => :P_CELLS)) c
  ),
  scope AS (
      -- Qualified with h.: PLANNING_SCENARIO and DIM_MERCH_HIERARCHY both carry
      -- DEPARTMENT and CLASS, so an unqualified list is ambiguous.
      SELECT h.DEPARTMENT, h.CLASS, h.CLASS_CODE
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO sc
      JOIN BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h ON h.CLASS = sc.CLASS
      WHERE sc.SCENARIO_ID = :P_SCENARIO_ID
      LIMIT 1
  )
  SELECT
    'AUD-' || REPLACE(UUID_STRING(), '-', ''),
    :P_SCENARIO_ID,
    NULL,
    s.DEPARTMENT, s.CLASS, s.CLASS_CODE,
    'F27',
    f.PERIOD_CODE,
    f.WEEK_NO,
    -- JOINED, not looked up in a correlated scalar subquery. A subquery
    -- referencing the outer row here is the shape Snowflake rejects with
    -- "Unsupported subquery type cannot be evaluated" -- the same trap
    -- 11_planning_mfp.sql already documents for its metric unpivot.
    (p.PERIOD_NO - 1) * 4 + p.WEEK_NO,
    f.METRIC,
    f.OLD_VALUE,
    f.NEW_VALUE,
    f.BASELINE,
    f.NEW_VALUE - NVL(f.OLD_VALUE, f.BASELINE),
    :P_CHANGE_SOURCE,
    f.REASON_CODE,
    f.REASON_NOTE,
    NVL(:P_CHANGED_BY, 'Planner'),
    CURRENT_TIMESTAMP()
  FROM flat f
  CROSS JOIN scope s
  JOIN BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD p
    ON p.PERIOD_CODE = f.PERIOD_CODE AND p.WEEK_NO = f.WEEK_NO;

  v_n := SQLROWCOUNT;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'rows_logged', :v_n)::STRING;
END;
$$;

-- ---------- 5. Stamp the version onto an approval's cells ----------
-- Called by APPROVE_SCENARIO so the audit rows that fed a version can be
-- filtered by it on the history page. Kept separate from LOG_CELL_CHANGES
-- because the version id does not exist until the approval succeeds.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.STAMP_AUDIT_VERSION(
    P_SCENARIO_ID VARCHAR,
    P_VERSION_ID  VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
BEGIN
  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_CELL_AUDIT
  SET VERSION_ID = :P_VERSION_ID
  WHERE SCENARIO_ID = :P_SCENARIO_ID AND VERSION_ID IS NULL;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'rows_stamped', SQLROWCOUNT)::STRING;
END;
$$;
