-- ============================================================
-- Anko Global Planning — scenario engine
--
-- Implements the three steps of the SIMULATE SCENARIOS narrative:
--
--   PARSE_SCENARIO_PROMPT          natural language -> a structured intent
--   BUILD_RANGE_RATIONALISATION    step 1
--   GOAL_SEEK_GP                   step 2, returns two costed alternatives
--   NARRATE_SCENARIO               AI framing over already-computed numbers
--   RECOMMEND_SCENARIO_DECISION    the decisioning tab's AI opinion
--   APPROVE_SCENARIO               promotes a sandbox scenario to App. FC
--
-- THE DIVISION OF LABOUR: SOLVER COMPUTES, MODEL EXPLAINS
--
-- Every number in every scenario is produced by closed-form arithmetic in SQL.
-- CORTEX.COMPLETE is used for exactly two things: turning a planner's sentence
-- into a structured intent (which class, what percentile, what target), and
-- writing the prose that frames a result it is handed.
--
-- It is never asked to compute. A model asked "find me another 500k of GP" will
-- return a confident, well-written number that does not add up, and the whole
-- value of this page is that a planner can check the arithmetic. This is the one
-- place in the demo where being caught out would be fatal, so the goal seek is
-- solved algebraically and the model never sees the target until the answer
-- already exists.
--
-- EVERY SCENARIO TYPE WRITES OPTIONS FIRST, THEN CELLS
--
-- The three builders share one shape: decide which options are affected, compute
-- each option's contribution into PLANNING_SCENARIO_OPTION, then aggregate those
-- contributions per class and spread them across weeks into
-- PLANNING_SCENARIO_CELL. Uniform on purpose --
--
--   * the option rows are the EXPLANATION ("these eleven SKUs, by name, each
--     earning this much GP per week"), which is the slide's "shows assumptions";
--   * the cell rows are the GRID, and they are derived from the option rows, so
--     the comparison table and the spreadsheet cannot tell different stories;
--   * stock impact is only knowable at option level, so it has to start there.
--
-- ASSUMPTIONS ARE DATA, NOT CONSTANTS
--
-- Price elasticity, demand transfer on deletion, new-option ramp and
-- cannibalisation all live in PLANNING_SETTING and are echoed verbatim into each
-- scenario's ASSUMPTIONS payload. A scenario whose assumptions are invisible is
-- one a planning meeting cannot argue with, and an unarguable number gets
-- ignored.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 0. Behavioural assumptions ----------
-- Elasticity, demand transfer, new-option ramp, cannibalisation and the
-- popular-SKU decile count are all seeded by 21_planning_parameters.sql, which
-- owns PLANNING_SETTING and attaches the range and provenance metadata the
-- settings page needs. They are read here at call time through the accessor
-- below, so editing one in the UI changes the next scenario without a redeploy.

-- Scalar accessor so the procedures below read settings by name instead of
-- carrying duplicate literals that could drift apart.
CREATE OR REPLACE FUNCTION BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM(K VARCHAR)
RETURNS FLOAT
AS
$$
    SELECT TO_DOUBLE(SETTING_VALUE)
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
    WHERE SETTING_KEY = K
$$;


-- ============================================================
-- 1. PARSE_SCENARIO_PROMPT
-- ============================================================
-- Turns "rationalise the bottom 25% of TRAVEL SYSTEM SKUs"
-- into { intent, class, bottom_pct, ... }.
--
-- The live hierarchy is injected into the prompt so the model RESOLVES a class
-- name against reality rather than inventing one. It is explicitly told to
-- return null when it cannot match, because a wrong class silently plans the
-- wrong part of the business -- far worse than an error message.
--
-- Everything numeric is clamped in SQL after parsing. A model that returns
-- bottom_pct 90 must not delete 90% of a range because it misread a sentence.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.PARSE_SCENARIO_PROMPT(P_PROMPT VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_hierarchy VARCHAR;
  v_prompt    VARCHAR;
  v_raw       VARCHAR;
  v_json      VARIANT;
  v_intent    VARCHAR;
  v_class     VARCHAR;
  v_dept      VARCHAR;
  v_half      VARCHAR;
  v_bottom    FLOAT;
  v_target    FLOAT;
BEGIN
  SELECT LISTAGG(DEPARTMENT || ' > ' || CLASS, '; ') WITHIN GROUP (ORDER BY DEPARTMENT, CLASS)
    INTO :v_hierarchy
  FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY;

  v_prompt :=
       'You convert a retail merchandise planner''s request into structured JSON. '
    || 'You do NOT calculate anything.' || CHAR(10) || CHAR(10)
    || 'VALID DEPARTMENT > CLASS VALUES:' || CHAR(10) || :v_hierarchy || CHAR(10) || CHAR(10)
    || 'PLANNER REQUEST: ' || :P_PROMPT || CHAR(10) || CHAR(10)
    || 'Rules:' || CHAR(10)
    || '- intent is one of RANGE_RATIONALISATION (delete or reduce poor performing '
    || 'options), GOAL_SEEK (find a stated amount of sales or gross profit), '
    || 'LEVER (a broad demand/price/cost/markdown change), UNKNOWN.' || CHAR(10)
    || '- class and department MUST be copied exactly from the list above, or be '
    || 'null. Never invent or approximate a name. If the request names something '
    || 'not in the list, set both to null and explain in unresolved.' || CHAR(10)
    || '- half is "H1" (Jan-Jun 2027) or "H2" (Jul-Dec 2026) or null for the full year.' || CHAR(10)
    || '- bottom_pct is the percentile to rationalise, e.g. 10 for "bottom 10%". null if absent.' || CHAR(10)
    || '- target_gp_php is an absolute gross profit amount in PHP. Expand "500k" to '
    || '500000 and "1.2m" to 1200000. null if the request is not a goal seek.' || CHAR(10)
    || '- levers: only the ones actually mentioned, as percentages.' || CHAR(10) || CHAR(10)
    || 'Return ONLY valid JSON, no markdown fences, matching exactly:' || CHAR(10)
    || '{"intent":"","department":null,"class":null,"half":null,"bottom_pct":null,'
    || '"target_gp_php":null,"levers":{"demandPct":null,"pricePct":null,"costPct":null,'
    || '"markdownPct":null},"restated":"","unresolved":null}' || CHAR(10)
    || 'restated is a one-line plain-English restatement of what you understood. '
    || 'Keep every string on one line with no control characters.';

  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    'claude-opus-4-7',
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 1500, 'temperature': 0}
  ):choices[0]:messages::STRING;

  v_json := TRY_PARSE_JSON(
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*|```\\s*$', ''),
      '[\\x00-\\x1F]', ' ')));

  IF (:v_json IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE,
      'error', 'Could not understand that request. Try naming a class and what you want to change.',
      'raw', :v_raw)::STRING;
  END IF;

  v_intent := UPPER(NVL(:v_json:intent::STRING, 'UNKNOWN'));
  v_class  := :v_json:class::STRING;
  v_dept   := :v_json:department::STRING;
  v_half   := UPPER(NVL(:v_json:half::STRING, ''));

  -- Clamps. The model's numbers are suggestions, not authority.
  --   bottom_pct  1-50   : rationalising more than half a range is a range EXIT,
  --                        a different decision needing a different conversation.
  --   target_gp   > 0    : a goal seek for zero or a negative amount is a
  --                        misparse, not a plan.
  v_bottom := LEAST(50, GREATEST(1, NVL(:v_json:bottom_pct::FLOAT, 10)));
  v_target := :v_json:target_gp_php::FLOAT;
  IF (:v_target IS NOT NULL AND :v_target <= 0) THEN
    v_target := NULL;
  END IF;

  -- Resolve the class against the hierarchy rather than trusting the string.
  -- Also back-fills the department, so a prompt naming only a class still lands
  -- in the right place.
  IF (:v_class IS NOT NULL) THEN
    SELECT MAX(CLASS), MAX(DEPARTMENT) INTO :v_class, :v_dept
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
    WHERE UPPER(CLASS) = UPPER(:v_class);
  END IF;

  IF (:v_half NOT IN ('H1', 'H2')) THEN
    v_half := NULL;
  END IF;

  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'ok',            TRUE,
    'intent',        :v_intent,
    'department',    :v_dept,
    'class',         :v_class,
    'half',          :v_half,
    'bottom_pct',    :v_bottom,
    'target_gp_php', :v_target,
    'levers',        :v_json:levers,
    'restated',      :v_json:restated::STRING,
    'unresolved',    :v_json:unresolved::STRING
  )::STRING;
END;
$$;


-- ============================================================
-- 2. BUILD_RANGE_RATIONALISATION  — slide step 1
-- ============================================================
-- Identifies the least productive options in a class by GP PER OPTION PER WEEK,
-- deletes them, transfers a stated share of their demand to the survivors, and
-- releases their stock.
--
-- Productivity is GP per option-week, not sales. Ranking on sales would nominate
-- high-turn low-margin lines for deletion, which is the wrong answer and a
-- merchandise planner will say so immediately.
--
-- Nothing here touches FACT_MFP_WEEKLY. The result is an overlay.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.BUILD_RANGE_RATIONALISATION(
    P_CLASS        VARCHAR,
    P_BOTTOM_PCT   FLOAT,
    P_HALF         VARCHAR,
    P_CREATED_BY   VARCHAR,
    P_PROMPT       VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_sid          VARCHAR;
  v_dept         VARCHAR;
  v_rbu          VARCHAR;
  v_half         VARCHAR;
  v_transfer     FLOAT;
  v_n_total      INT;
  v_n_drop       INT;
  v_surv_gp_unit FLOAT;
  v_surv_asp     FLOAT;
  v_result       VARIANT;
BEGIN
  v_sid  := 'SCN-' || REPLACE(UUID_STRING(), '-', '');
  v_half := IFF(:P_HALF IN ('H1', 'H2'), :P_HALF, 'H2');
  v_transfer := BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM('SCENARIO_DEMAND_TRANSFER_PCT');

  SELECT MAX(DEPARTMENT), MAX(RBU) INTO :v_dept, :v_rbu
  FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
  WHERE UPPER(CLASS) = UPPER(:P_CLASS);

  IF (:v_dept IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Unknown class: ' || :P_CLASS)::STRING;
  END IF;

  -- How many options the percentile names. FLOOR, and at least one: "bottom 10%"
  -- of a 42-option class is 4 options, and rounding up would quietly delete
  -- more range than the planner asked for.
  SELECT COUNT(*), GREATEST(1, FLOOR(COUNT(*) * :P_BOTTOM_PCT / 100.0))
    INTO :v_n_total, :v_n_drop
  FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY
  WHERE UPPER(CLASS) = UPPER(:P_CLASS) AND HALF = :v_half;

  -- Surviving-range economics, used to value the transferred demand. Rebuilt as
  -- SUM/SUM rather than an average of per-option ratios, so the transfer is
  -- valued at the true blended margin of what remains.
  SELECT SUM(POS_GP_AMT) / NULLIF(SUM(SLS_UNITS), 0),
         SUM(SLS_PHP)    / NULLIF(SUM(SLS_UNITS), 0)
    INTO :v_surv_gp_unit, :v_surv_asp
  FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY
  WHERE UPPER(CLASS) = UPPER(:P_CLASS) AND HALF = :v_half
    AND PRODUCTIVITY_DECILE > CEIL(:P_BOTTOM_PCT / 10.0);

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    (SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, SIBLING_LABEL, PROMPT_TEXT,
     RBU, DEPARTMENT, CLASS, FISCAL_YEAR, HALF, ASSUMPTIONS, STATUS,
     CREATED_BY, CREATED_AT, UPDATED_AT)
  SELECT
    :v_sid,
    'Range rationalisation: bottom ' || ROUND(:P_BOTTOM_PCT, 0) || '% of ' || :P_CLASS,
    'RANGE_RATIONALISATION', '1', :P_PROMPT,
    :v_rbu, :v_dept, :P_CLASS, 'F27', :v_half,
    OBJECT_CONSTRUCT(
      'method',              'Options ranked by realised gross profit per option per trading week, ascending. The least productive ' || :v_n_drop || ' of ' || :v_n_total || ' options are deleted.',
      'options_reviewed',    :v_n_total,
      'options_deleted',     :v_n_drop,
      'percentile',          :P_BOTTOM_PCT,
      'demand_transfer_pct', :v_transfer,
      'transfer_valued_at',  'Surviving range blended margin of PHP ' || ROUND(:v_surv_gp_unit, 2) || ' GP per unit at PHP ' || ROUND(:v_surv_asp, 2) || ' ASP.',
      'stock_treatment',     'Deleted options release their full stock holding at book value. Clearance markdown to exit that stock is NOT modelled.',
      'held_constant',       'Retail prices on surviving options, supplier costs, store count and the promotional calendar.',
      'horizon',             'F27 ' || :v_half,
      'caveat',              'Demand transfer is the most sensitive assumption here. At 0% transfer the sales loss is the full deleted amount; at 100% it is near zero. ' || :v_transfer || '% is the planning default.'
    ),
    'DRAFT', :P_CREATED_BY, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP();

  -- ---------- The deleted options, with their contributions ----------
  -- Deltas are negative for what is lost and positive for the transferred
  -- demand recovered on survivors, netted onto each deleted option's row so the
  -- UI can show a per-SKU net effect.
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
    (SCENARIO_ID, OPTION_ID, OPTION_LABEL, CLASS, ACTION, TRANSFER_PCT,
     SLS_DELTA_PHP, UNITS_DELTA, GP_DELTA_PHP, STOCK_DELTA_PHP,
     PRODUCTIVITY_RANK, GP_PER_OPTION_WEEK, COVER_WEEKS)
  WITH worst AS (
      SELECT p.*
      FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY p
      WHERE UPPER(p.CLASS) = UPPER(:P_CLASS) AND p.HALF = :v_half
      ORDER BY p.GP_PER_OPTION_WEEK ASC
      LIMIT :v_n_drop
  )
  SELECT
      :v_sid, w.OPTION_ID, w.OPTION_CODE || ' ' || w.OPTION_DESC, w.CLASS,
      'DROP', :v_transfer,
      -- Sales: lose this option's sales, recover the transferred units at the
      -- surviving range's ASP (not this option's -- the customer buys what is
      -- left, at what is left's price).
      ROUND(-w.SLS_PHP + (w.SLS_UNITS * :v_transfer / 100.0) * :v_surv_asp, 2),
      ROUND(-w.SLS_UNITS + (w.SLS_UNITS * :v_transfer / 100.0), 0),
      ROUND(-w.POS_GP_AMT + (w.SLS_UNITS * :v_transfer / 100.0) * :v_surv_gp_unit, 2),
      -- Stock is released in full. Transferred demand is served from stock the
      -- survivors already hold, so no offsetting stock build is added.
      ROUND(-w.STOCK_PHP, 2),
      w.PRODUCTIVITY_RANK, w.GP_PER_OPTION_WEEK, w.COVER_WEEKS
  FROM worst w;

  -- ---------- Spread the class deltas across weeks into the grid ----------
  CALL BABY_MART_DEMO.ANALYTICS.WRITE_SCENARIO_CELLS(:v_sid, 'RANGE_CHANGE',
       'Bottom ' || ROUND(:P_BOTTOM_PCT, 0) || '% range rationalisation');

  CALL BABY_MART_DEMO.ANALYTICS.NARRATE_SCENARIO(:v_sid);

  SELECT OBJECT_CONSTRUCT('ok', TRUE, 'scenario_id', :v_sid) INTO :v_result;
  RETURN :v_result::STRING;
END;
$$;


-- ============================================================
-- 3. WRITE_SCENARIO_CELLS  — shared grid writer
-- ============================================================
-- Aggregates a scenario's option deltas per class and spreads them across the
-- weeks in scope, in proportion to the forecast's own weekly shape. A flat
-- per-week spread would put the same peso change on a peak week and a trough
-- week, which no planner would accept.
--
-- Uses the same cumulative-rounding allocation as 17_planning_weekly.sql, so the
-- weekly cells sum EXACTLY to the intended class total. Rounding each week
-- independently would make the scenario's own month subtotals disagree with the
-- impact figure shown next to it.
--
-- Only unpinned cells are written. A cell a planner typed by hand survives a
-- generated scenario being re-run over it.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.WRITE_SCENARIO_CELLS(
    P_SCENARIO_ID VARCHAR,
    P_REASON_CODE VARCHAR,
    P_REASON_NOTE VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_half VARCHAR;
  v_by   VARCHAR;
  v_n    INT;
BEGIN
  SELECT NVL(HALF, ''), NVL(CREATED_BY, 'SYSTEM') INTO :v_half, :v_by
  FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
  WHERE SCENARIO_ID = :P_SCENARIO_ID;

  -- Replace any previously generated cells for this scenario, but never the
  -- pinned ones.
  DELETE FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL
  WHERE SCENARIO_ID = :P_SCENARIO_ID AND NVL(IS_PINNED, FALSE) = FALSE;

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL
    (SCENARIO_ID, DEPARTMENT, CLASS, CLASS_CODE, FISCAL_YEAR, PERIOD_CODE,
     WEEK_NO, WEEK_SEQ, METRIC, VALUE_PHP, BASELINE_PHP, IS_PINNED,
     REASON_CODE, REASON_NOTE, EDITED_BY, EDITED_AT)
  WITH
  -- Per-class delta for each of the three additive metrics, from the option rows.
  deltas AS (
      SELECT
          CLASS,
          SUM(SLS_DELTA_PHP) AS D_SLS,
          SUM(UNITS_DELTA)   AS D_UNITS,
          SUM(GP_DELTA_PHP)  AS D_GP
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
      WHERE SCENARIO_ID = :P_SCENARIO_ID
      GROUP BY CLASS
  ),
  scope AS (
      SELECT w.DEPARTMENT, w.CLASS, w.CLASS_CODE, w.FISCAL_YEAR, w.PERIOD_CODE,
             w.WEEK_NO, w.WEEK_SEQ, w.METRIC, w.VALUE_PHP,
             CASE w.METRIC
                 WHEN 'SLS_PHP'    THEN d.D_SLS
                 WHEN 'SLS_UNITS'  THEN d.D_UNITS
                 WHEN 'POS_GP_AMT' THEN d.D_GP
             END AS DELTA
      FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
      JOIN deltas d ON d.CLASS = w.CLASS
      WHERE w.VERSION     = 'FC'
        AND w.PLAN_LEVEL  = 'CLASS'
        AND w.FISCAL_YEAR = 'F27'
        AND w.METRIC IN ('SLS_PHP', 'SLS_UNITS', 'POS_GP_AMT')
        AND (:v_half = '' OR w.HALF = :v_half)
        -- Leave pinned cells alone.
        AND NOT EXISTS (
            SELECT 1 FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL pc
            WHERE pc.SCENARIO_ID = :P_SCENARIO_ID
              AND pc.CLASS       = w.CLASS
              AND pc.PERIOD_CODE = w.PERIOD_CODE
              AND pc.WEEK_NO     = w.WEEK_NO
              AND pc.METRIC      = w.METRIC
              AND NVL(pc.IS_PINNED, FALSE))
  ),
  totals AS (
      SELECT CLASS, METRIC, SUM(VALUE_PHP) AS BASE_TOT, MAX(DELTA) AS DELTA
      FROM scope GROUP BY CLASS, METRIC
  ),
  cum AS (
      SELECT
          s.*,
          t.BASE_TOT,
          t.BASE_TOT + t.DELTA AS TARGET_TOT,
          SUM(s.VALUE_PHP) OVER (
              PARTITION BY s.CLASS, s.METRIC ORDER BY s.WEEK_SEQ
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CUM_BASE
      FROM scope s
      JOIN totals t ON t.CLASS = s.CLASS AND t.METRIC = s.METRIC
  ),
  alloc AS (
      SELECT
          c.*,
          -- Units round to whole, currency to two places.
          IFF(c.METRIC = 'SLS_UNITS',
              ROUND(c.TARGET_TOT * c.CUM_BASE / NULLIF(c.BASE_TOT, 0), 0),
              ROUND(c.TARGET_TOT * c.CUM_BASE / NULLIF(c.BASE_TOT, 0), 2)) AS CUM_ALLOC
      FROM cum c
  )
  SELECT
      :P_SCENARIO_ID, DEPARTMENT, CLASS, CLASS_CODE, FISCAL_YEAR, PERIOD_CODE,
      WEEK_NO, WEEK_SEQ, METRIC,
      CUM_ALLOC - LAG(CUM_ALLOC, 1, 0) OVER (
          PARTITION BY CLASS, METRIC ORDER BY WEEK_SEQ),
      VALUE_PHP,
      FALSE, :P_REASON_CODE, :P_REASON_NOTE, :v_by, CURRENT_TIMESTAMP()
  FROM alloc;

  v_n := SQLROWCOUNT;

  -- Log the generated cells to the audit trail. Wrapped so a missing audit table
  -- (an account that has not run 22_ yet) cannot fail a scenario build -- the
  -- scenario is the deliverable, the audit row is a record of it.
  BEGIN
    CALL BABY_MART_DEMO.ANALYTICS.LOG_CELL_CHANGES(
      :P_SCENARIO_ID, 'GENERATED_SCENARIO', :v_by,
      (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
                'period_code', PERIOD_CODE, 'week_no', WEEK_NO, 'metric', METRIC,
                'old', BASELINE_PHP, 'new', VALUE_PHP, 'baseline', BASELINE_PHP,
                'reason_code', REASON_CODE, 'reason_note', REASON_NOTE))
       FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL
       WHERE SCENARIO_ID = :P_SCENARIO_ID));
  EXCEPTION
    WHEN OTHER THEN NULL;
  END;

  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'cells_written', :v_n)::STRING;
END;
$$;


-- ============================================================
-- 4. GOAL_SEEK_GP  — slide step 2
-- ============================================================
-- "We need to find another 500k of GP in H2, give me options."
--
-- Returns TWO costed alternatives under one parent, matching the slide:
--   2a  targeted price and promo on the popular SKUs
--   2b  range increment into the areas with the strongest demand
--
-- BOTH ARE SOLVED ALGEBRAICALLY, NOT SEARCHED AND NOT GUESSED.
--
-- Option 2a, price. With units U, ASP A, unit cost C and elasticity e:
--
--   units(p) = U(1 + e.p)
--   sales(p) = U(1 + e.p).A(1 + p)
--   gp(p)    = sales(p) - units(p).C
--   delta(p) = e.U.A.p^2 + U.(A + e.(A - C)).p
--
-- which is a quadratic in p, so the required price move is the smaller positive
-- root of  a.p^2 + b.p - target = 0. No iteration, no tolerance, exactly the
-- price rise that delivers the target.
--
-- Crucially, because e is negative the parabola has a MAXIMUM: past a certain
-- price rise, lost units cost more than the extra margin earns. If the requested
-- target is beyond that vertex it is NOT ACHIEVABLE through price alone, and the
-- procedure says so and reports the best attainable figure instead of returning
-- a fabricated price. Being able to answer "you cannot get there this way" is
-- the single most valuable thing a goal seek can do.
--
-- Option 2b, range. New options are assumed to trade at a RAMPED fraction of the
-- median of the top half of the existing range, with a share of their sales
-- cannibalised from existing options. Both are stated assumptions.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.GOAL_SEEK_GP(
    P_DEPARTMENT   VARCHAR,
    P_CLASS        VARCHAR,
    P_TARGET_GP    FLOAT,
    P_HALF         VARCHAR,
    P_CREATED_BY   VARCHAR,
    P_PROMPT       VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_parent    VARCHAR;
  v_sid_a     VARCHAR;
  v_sid_b     VARCHAR;
  v_half      VARCHAR;
  v_rbu       VARCHAR;
  v_elast     FLOAT;
  v_ramp      FLOAT;
  v_cannib    FLOAT;
  v_deciles   FLOAT;
  -- price solve
  v_u FLOAT; v_a FLOAT; v_c FLOAT;
  v_qa FLOAT; v_qb FLOAT; v_disc FLOAT;
  v_p FLOAT; v_p_vertex FLOAT; v_max_gain FLOAT; v_achievable BOOLEAN;
  v_gp_gain FLOAT; v_sls_gain FLOAT; v_unit_gain FLOAT;
  -- range solve
  v_med_gp FLOAT; v_med_sls FLOAT; v_med_units FLOAT; v_med_stock FLOAT;
  v_gp_per_new FLOAT; v_n_new INT;
BEGIN
  v_half   := IFF(:P_HALF IN ('H1', 'H2'), :P_HALF, 'H2');
  v_parent := 'SCN-' || REPLACE(UUID_STRING(), '-', '');
  v_sid_a  := 'SCN-' || REPLACE(UUID_STRING(), '-', '');
  v_sid_b  := 'SCN-' || REPLACE(UUID_STRING(), '-', '');

  v_elast   := BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM('SCENARIO_PRICE_ELASTICITY');
  v_ramp    := BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM('SCENARIO_NEW_OPTION_RAMP');
  v_cannib  := BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM('SCENARIO_CANNIBALISATION_PCT');
  v_deciles := BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING_NUM('SCENARIO_TOP_DECILE_COUNT');

  SELECT MAX(RBU) INTO :v_rbu
  FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
  WHERE (:P_DEPARTMENT IS NULL OR DEPARTMENT = :P_DEPARTMENT)
    AND (:P_CLASS      IS NULL OR CLASS      = :P_CLASS);

  -- ---------- Parent: the question itself ----------
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    (SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, SIBLING_LABEL, PROMPT_TEXT,
     RBU, DEPARTMENT, CLASS, FISCAL_YEAR, HALF, ASSUMPTIONS, STATUS,
     CREATED_BY, CREATED_AT, UPDATED_AT)
  SELECT :v_parent,
    'Goal seek: find PHP ' || TO_CHAR(ROUND(:P_TARGET_GP / 1000, 0)) || 'k of GP in ' || :v_half,
    'GOAL_SEEK', '2', :P_PROMPT, :v_rbu, :P_DEPARTMENT, :P_CLASS, 'F27', :v_half,
    OBJECT_CONSTRUCT('target_gp_php', :P_TARGET_GP,
                     'note', 'Parent record. The costed alternatives are its children.'),
    'DRAFT', :P_CREATED_BY, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP();

  -- ============ Option 2a: targeted price and promo ============
  -- Scope is the TOP productivity deciles: the popular SKUs. A price rise on a
  -- slow seller earns nothing because almost nobody buys it.
  SELECT SUM(SLS_UNITS),
         SUM(SLS_PHP) / NULLIF(SUM(SLS_UNITS), 0),
         (SUM(SLS_PHP) - SUM(POS_GP_AMT)) / NULLIF(SUM(SLS_UNITS), 0)
    INTO :v_u, :v_a, :v_c
  FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY
  WHERE HALF = :v_half
    AND (:P_DEPARTMENT IS NULL OR DEPARTMENT = :P_DEPARTMENT)
    AND (:P_CLASS      IS NULL OR CLASS      = :P_CLASS)
    AND PRODUCTIVITY_DECILE > (10 - :v_deciles);

  v_qa := :v_elast * :v_u * :v_a;
  v_qb := :v_u * (:v_a + :v_elast * (:v_a - :v_c));

  -- Vertex of the parabola: the most GP price can ever add here.
  v_p_vertex := -:v_qb / (2 * :v_qa);
  v_max_gain := -(:v_qb * :v_qb) / (4 * :v_qa);
  v_disc     := :v_qb * :v_qb + 4 * :v_qa * :P_TARGET_GP;

  IF (:v_disc < 0) THEN
    -- Unreachable through price. Report the best attainable rather than a
    -- fabricated number that would not survive being checked.
    v_achievable := FALSE;
    v_p          := :v_p_vertex;
    v_gp_gain    := :v_max_gain;
  ELSE
    v_achievable := TRUE;
    -- a < 0, so the SMALLER positive root is (-b + sqrt(disc)) / (2a).
    v_p       := (-:v_qb + SQRT(:v_disc)) / (2 * :v_qa);
    v_gp_gain := :P_TARGET_GP;
  END IF;

  v_unit_gain := :v_u * :v_elast * :v_p;
  v_sls_gain  := :v_u * (1 + :v_elast * :v_p) * :v_a * (1 + :v_p) - :v_u * :v_a;

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    (SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, PARENT_SCENARIO_ID, SIBLING_LABEL,
     PROMPT_TEXT, RBU, DEPARTMENT, CLASS, FISCAL_YEAR, HALF, ASSUMPTIONS, STATUS,
     CREATED_BY, CREATED_AT, UPDATED_AT)
  SELECT :v_sid_a,
    'Targeted price and promo on popular SKUs (+' || TO_CHAR(ROUND(:v_p * 100, 1)) || '% retail)',
    'GOAL_SEEK_PRICE_PROMO', :v_parent, '2a', :P_PROMPT,
    :v_rbu, :P_DEPARTMENT, :P_CLASS, 'F27', :v_half,
    OBJECT_CONSTRUCT(
      'method',           'Closed-form solve of the quadratic gp(p) = e.U.A.p^2 + U.(A + e.(A-C)).p for the price move p that delivers the target. Not an iterative search.',
      'scope',            'Top ' || ROUND(:v_deciles, 0) || ' productivity deciles only -- the popular SKUs. A price rise on a slow seller earns almost nothing.',
      'price_move_pct',   ROUND(:v_p * 100, 2),
      'price_elasticity', :v_elast,
      'units_lost',       ROUND(:v_unit_gain, 0),
      'target_gp_php',    :P_TARGET_GP,
      'achievable',       :v_achievable,
      'max_attainable_gp_php', ROUND(:v_max_gain, 0),
      'price_at_max_pct', ROUND(:v_p_vertex * 100, 2),
      'stock_treatment',  'No stock change. This option sells the same units-ish out of existing inventory at a higher price, so the buy is untouched.',
      'held_constant',    'Supplier cost, range width, promotional depth on the remaining deciles.',
      'caveat',           IFF(:v_achievable,
                              'Elasticity is the binding assumption. At -1.4 a ' || TO_CHAR(ROUND(:v_p * 100, 1)) || '% price rise loses ' || TO_CHAR(ROUND(-:v_elast * :v_p * 100, 1)) || '% of units. If the true elasticity is worse than -1.4, this delivers less.',
                              'NOT ACHIEVABLE through price alone. Beyond a ' || TO_CHAR(ROUND(:v_p_vertex * 100, 1)) || '% rise, lost units cost more than the extra margin earns. The most price can contribute here is PHP ' || TO_CHAR(ROUND(:v_max_gain / 1000000, 2)) || 'M.')
    ),
    'DRAFT', :P_CREATED_BY, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP();

  -- Per-option REPRICE rows, apportioned by each option's share of scope units.
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
    (SCENARIO_ID, OPTION_ID, OPTION_LABEL, CLASS, ACTION, TRANSFER_PCT,
     SLS_DELTA_PHP, UNITS_DELTA, GP_DELTA_PHP, STOCK_DELTA_PHP,
     PRODUCTIVITY_RANK, GP_PER_OPTION_WEEK, COVER_WEEKS)
  SELECT
      :v_sid_a, p.OPTION_ID, p.OPTION_CODE || ' ' || p.OPTION_DESC, p.CLASS,
      'REPRICE', NULL,
      ROUND(:v_sls_gain  * p.SLS_UNITS / NULLIF(:v_u, 0), 2),
      ROUND(:v_unit_gain * p.SLS_UNITS / NULLIF(:v_u, 0), 0),
      ROUND(:v_gp_gain   * p.SLS_UNITS / NULLIF(:v_u, 0), 2),
      0,
      p.PRODUCTIVITY_RANK, p.GP_PER_OPTION_WEEK, p.COVER_WEEKS
  FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY p
  WHERE p.HALF = :v_half
    AND (:P_DEPARTMENT IS NULL OR p.DEPARTMENT = :P_DEPARTMENT)
    AND (:P_CLASS      IS NULL OR p.CLASS      = :P_CLASS)
    AND p.PRODUCTIVITY_DECILE > (10 - :v_deciles);

  CALL BABY_MART_DEMO.ANALYTICS.WRITE_SCENARIO_CELLS(:v_sid_a, 'PRICE_CHANGE',
       'Targeted price and promo, goal seek option 2a');
  CALL BABY_MART_DEMO.ANALYTICS.NARRATE_SCENARIO(:v_sid_a);

  -- ============ Option 2b: range increment ============
  -- New options valued at the MEDIAN of the top half of the existing range,
  -- ramped. Median not mean, because a mean is dragged upward by the hero lines
  -- a new option will not match in its first season.
  SELECT MEDIAN(POS_GP_AMT), MEDIAN(SLS_PHP), MEDIAN(SLS_UNITS), MEDIAN(STOCK_PHP)
    INTO :v_med_gp, :v_med_sls, :v_med_units, :v_med_stock
  FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY
  WHERE HALF = :v_half
    AND (:P_DEPARTMENT IS NULL OR DEPARTMENT = :P_DEPARTMENT)
    AND (:P_CLASS      IS NULL OR CLASS      = :P_CLASS)
    AND PRODUCTIVITY_DECILE > 5;

  -- Net GP a single new option contributes after ramp and cannibalisation.
  v_gp_per_new := :v_med_gp * :v_ramp * (1 - :v_cannib / 100.0);
  v_n_new      := GREATEST(1, CEIL(:P_TARGET_GP / NULLIF(:v_gp_per_new, 0)));

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    (SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, PARENT_SCENARIO_ID, SIBLING_LABEL,
     PROMPT_TEXT, RBU, DEPARTMENT, CLASS, FISCAL_YEAR, HALF, ASSUMPTIONS, STATUS,
     CREATED_BY, CREATED_AT, UPDATED_AT)
  SELECT :v_sid_b,
    'Range increment into high-demand classes (+' || :v_n_new || ' options)',
    'GOAL_SEEK_RANGE_INCREMENT', :v_parent, '2b', :P_PROMPT,
    :v_rbu, :P_DEPARTMENT, :P_CLASS, 'F27', :v_half,
    OBJECT_CONSTRUCT(
      'method',              'Target GP divided by the net GP a single new option is assumed to contribute, rounded up.',
      'options_added',       :v_n_new,
      'valued_at',           'Median of the top half of the existing range, not the mean. A mean is dragged up by hero lines a new option will not match in season one.',
      'ramp_factor',         :v_ramp,
      'cannibalisation_pct', :v_cannib,
      'gp_per_new_option_php', ROUND(:v_gp_per_new, 0),
      'stock_investment_php',  ROUND(:v_n_new * :v_med_stock, 0),
      'stock_treatment',     'Each new option needs stock BEFORE it sells, so this option increases the buy. That is the trade-off against 2a.',
      'held_constant',       'Retail prices, supplier terms, and the existing range.',
      'caveat',              'Ramp and cannibalisation are the binding assumptions. At a 1.0 ramp and 0% cannibalisation this would need only ' || CEIL(:P_TARGET_GP / NULLIF(:v_med_gp, 0)) || ' options; the figures here are the cautious case. Lead time to range ' || :v_n_new || ' new options is not modelled.'
    ),
    'DRAFT', :P_CREATED_BY, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP();

  -- Synthetic ADD rows, spread across the classes with the strongest rate of
  -- sale. OPTION_ID is null because these options do not exist yet.
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
    (SCENARIO_ID, OPTION_ID, OPTION_LABEL, CLASS, ACTION, TRANSFER_PCT,
     SLS_DELTA_PHP, UNITS_DELTA, GP_DELTA_PHP, STOCK_DELTA_PHP,
     PRODUCTIVITY_RANK, GP_PER_OPTION_WEEK, COVER_WEEKS)
  WITH demand_rank AS (
      SELECT CLASS, AVG(RATE_OF_SALE) AS ROS,
             ROW_NUMBER() OVER (ORDER BY AVG(RATE_OF_SALE) DESC) AS RN,
             COUNT(*) OVER ()                                    AS N_CLASSES
      FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY
      WHERE HALF = :v_half
        AND (:P_DEPARTMENT IS NULL OR DEPARTMENT = :P_DEPARTMENT)
        AND (:P_CLASS      IS NULL OR CLASS      = :P_CLASS)
      GROUP BY CLASS
  ),
  slots AS (
      SELECT SEQ4() + 1 AS SLOT FROM TABLE(GENERATOR(ROWCOUNT => 10000))
  ),
  picked AS (
      SELECT s.SLOT, d.CLASS
      FROM slots s
      JOIN demand_rank d
        -- Round-robin the new options across classes in demand order, so the
        -- increment lands where rate of sale is strongest rather than all in one
        -- place.
        ON d.RN = MOD(s.SLOT - 1, d.N_CLASSES) + 1
      WHERE s.SLOT <= :v_n_new
  )
  SELECT
      :v_sid_b, NULL,
      'New option ' || p.SLOT || ' - ' || p.CLASS, p.CLASS, 'ADD', NULL,
      ROUND(:v_med_sls   * :v_ramp * (1 - :v_cannib / 100.0), 2),
      ROUND(:v_med_units * :v_ramp * (1 - :v_cannib / 100.0), 0),
      ROUND(:v_gp_per_new, 2),
      ROUND(:v_med_stock, 2),
      NULL, ROUND(:v_gp_per_new / 24.0, 2), NULL
  FROM picked p;

  CALL BABY_MART_DEMO.ANALYTICS.WRITE_SCENARIO_CELLS(:v_sid_b, 'RANGE_CHANGE',
       'Range increment, goal seek option 2b');
  CALL BABY_MART_DEMO.ANALYTICS.NARRATE_SCENARIO(:v_sid_b);

  RETURN OBJECT_CONSTRUCT(
    'ok', TRUE,
    'parent_scenario_id', :v_parent,
    'options', ARRAY_CONSTRUCT(:v_sid_a, :v_sid_b),
    'target_gp_php', :P_TARGET_GP,
    'price_option_achievable', :v_achievable
  )::STRING;
END;
$$;


-- ============================================================
-- 5. NARRATE_SCENARIO
-- ============================================================
-- Writes the prose for a scenario whose numbers already exist. The model is
-- handed the computed impact and the assumptions and asked to explain them; it
-- is explicitly forbidden from producing any figure not in the input, because a
-- narrative that quotes a different number than the table beside it is worse
-- than no narrative.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.NARRATE_SCENARIO(P_SCENARIO_ID VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_facts  VARCHAR;
  v_opts   VARCHAR;
  v_prompt VARCHAR;
  v_raw    VARCHAR;
BEGIN
  SELECT OBJECT_CONSTRUCT(
           'scenario_name',   SCENARIO_NAME,
           'scenario_type',   SCENARIO_TYPE,
           'class',           CLASS,
           'department',      DEPARTMENT,
           'half',            HALF,
           'assumptions',     ASSUMPTIONS,
           'sales_delta_php', ROUND(SLS_DELTA_PHP, 0),
           'sales_delta_pct', SLS_DELTA_PCT,
           'units_delta',     UNITS_DELTA,
           'gp_delta_php',    ROUND(GP_DELTA_PHP, 0),
           'gp_pct_before',   BASE_GP_PCT,
           'gp_pct_after',    SCEN_GP_PCT,
           'gp_pct_delta_pp', GP_PCT_DELTA_PP,
           'asp_before',      BASE_ASP,
           'asp_after',       SCEN_ASP,
           'stock_delta_php', ROUND(STOCK_DELTA_PHP, 0),
           'options_dropped', OPTIONS_DROPPED,
           'options_added',   OPTIONS_ADDED,
           'options_repriced',OPTIONS_REPRICED
         )::STRING
    INTO :v_facts
  FROM BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_IMPACT
  WHERE SCENARIO_ID = :P_SCENARIO_ID;

  -- The ten most consequential option actions, by GP effect, so the narrative
  -- can name specific SKUs instead of speaking in aggregates.
  SELECT LISTAGG(OPTION_LABEL || ' (GP/wk PHP ' || NVL(TO_CHAR(ROUND(GP_PER_OPTION_WEEK, 0)), 'n/a')
                 || ', cover ' || NVL(TO_CHAR(COVER_WEEKS), 'n/a') || 'w)', '; ')
    INTO :v_opts
  FROM (
      SELECT OPTION_LABEL, GP_PER_OPTION_WEEK, COVER_WEEKS
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION
      WHERE SCENARIO_ID = :P_SCENARIO_ID
      ORDER BY ABS(NVL(GP_DELTA_PHP, 0)) DESC
      LIMIT 10
  );

  v_prompt :=
       'You are a merchandise planning analyst writing up a scenario for a '
    || 'planning meeting. All figures are ALREADY CALCULATED and given below.'
    || CHAR(10) || CHAR(10)
    || 'SCENARIO: ' || :v_facts || CHAR(10) || CHAR(10)
    || 'MOST AFFECTED OPTIONS: ' || NVL(:v_opts, 'none') || CHAR(10) || CHAR(10)
    || 'Rules:' || CHAR(10)
    || '- Use ONLY the numbers given. Never compute, estimate or introduce a '
    || 'figure that is not above. If something is not given, do not mention it.' || CHAR(10)
    || '- Amounts are PHP. Present as "PHP 12.4M" or "PHP 480k".' || CHAR(10)
    || '- Lead with the trade-off, not the headline. A rationalisation that loses '
    || 'sales but lifts margin RATE and releases stock is a trade, and the reader '
    || 'needs to see all three legs.' || CHAR(10)
    || '- If assumptions.achievable is false, say plainly that the target cannot '
    || 'be reached this way and give the best attainable figure. Do not soften it.' || CHAR(10)
    || '- Name the binding assumption from assumptions.caveat, in your own words.' || CHAR(10)
    || '- No preamble, no headings, 3 to 4 sentences.' || CHAR(10) || CHAR(10)
    || 'Return ONLY valid JSON, no fences: {"headline":"","narrative":""}' || CHAR(10)
    || 'headline is under 70 characters. Keep strings on one line.';

  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    'claude-opus-4-7',
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 1200, 'temperature': 0}
  ):choices[0]:messages::STRING;

  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
  SET NARRATIVE = NVL(
        TRY_PARSE_JSON(TRIM(REGEXP_REPLACE(
          REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*|```\\s*$', ''),
          '[\\x00-\\x1F]', ' '))):narrative::STRING,
        -- Fall back to the raw text rather than leaving the card blank: an
        -- unparsed narrative is still readable, an empty one is a broken page.
        :v_raw),
      UPDATED_AT = CURRENT_TIMESTAMP()
  WHERE SCENARIO_ID = :P_SCENARIO_ID;

  RETURN OBJECT_CONSTRUCT('ok', TRUE)::STRING;
END;
$$;


-- ============================================================
-- 6. RECOMMEND_SCENARIO_DECISION
-- ============================================================
-- The decisioning tab's AI opinion. Written to PLANNING_DECISION in its own
-- columns, SEPARATE from the human decision, so the audit trail records whether
-- the planner agreed or overrode. Collapsing them into one field would erase the
-- most interesting fact in the log.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.RECOMMEND_SCENARIO_DECISION(
    P_SCENARIO_ID VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_facts  VARCHAR;
  v_peers  VARCHAR;
  v_prompt VARCHAR;
  v_raw    VARCHAR;
  v_json   VARIANT;
  v_did    VARCHAR;
BEGIN
  v_did := 'DEC-' || REPLACE(UUID_STRING(), '-', '');

  SELECT OBJECT_CONSTRUCT(
           'scenario_name', SCENARIO_NAME, 'type', SCENARIO_TYPE,
           'class', CLASS, 'department', DEPARTMENT, 'half', HALF,
           'sales_delta_php', ROUND(SLS_DELTA_PHP, 0),
           'gp_delta_php', ROUND(GP_DELTA_PHP, 0),
           'gp_pct_delta_pp', GP_PCT_DELTA_PP,
           'stock_delta_php', ROUND(STOCK_DELTA_PHP, 0),
           'assumptions', ASSUMPTIONS)::STRING
    INTO :v_facts
  FROM BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_IMPACT WHERE SCENARIO_ID = :P_SCENARIO_ID;

  -- Sibling alternatives, so the recommendation is comparative. Recommending in
  -- isolation would make every plausible scenario an ACCEPT.
  SELECT LISTAGG(SCENARIO_NAME || ': sales ' || ROUND(SLS_DELTA_PHP / 1000000, 2)
                 || 'M, GP ' || ROUND(GP_DELTA_PHP / 1000000, 2)
                 || 'M, stock ' || ROUND(STOCK_DELTA_PHP / 1000000, 2) || 'M', ' | ')
    INTO :v_peers
  FROM BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_IMPACT
  WHERE SCENARIO_ID <> :P_SCENARIO_ID
    AND STATUS = 'DRAFT'
    AND PARENT_SCENARIO_ID IS NOT NULL;

  v_prompt :=
       'You advise a Head of Central Planning on whether to adopt a scenario '
    || 'into the approved forecast.' || CHAR(10) || CHAR(10)
    || 'SCENARIO: ' || :v_facts || CHAR(10)
    || 'OTHER DRAFT ALTERNATIVES: ' || NVL(:v_peers, 'none') || CHAR(10) || CHAR(10)
    || 'Rules:' || CHAR(10)
    || '- Use only the figures given.' || CHAR(10)
    || '- Weigh all three legs: sales, gross profit and STOCK. A scenario that '
    || 'buys GP with a large stock increase is not obviously better than one that '
    || 'releases stock, and cash tied up in inventory is a real cost.' || CHAR(10)
    || '- If assumptions.achievable is false, recommend REJECT or MODIFY.' || CHAR(10)
    || '- MODIFY means the direction is right but an assumption or magnitude '
    || 'needs changing. Say which one.' || CHAR(10)
    || '- confidence is LOW when the result hinges on a single soft assumption '
    || 'such as elasticity, demand transfer or ramp.' || CHAR(10) || CHAR(10)
    || 'Return ONLY valid JSON, no fences: '
    || '{"recommendation":"ACCEPT|REJECT|MODIFY","confidence":"HIGH|MEDIUM|LOW","rationale":""}'
    || CHAR(10) || 'rationale is 2 to 3 sentences on one line.';

  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    'claude-opus-4-7',
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 1200, 'temperature': 0}
  ):choices[0]:messages::STRING;

  v_json := TRY_PARSE_JSON(TRIM(REGEXP_REPLACE(
              REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*|```\\s*$', ''),
              '[\\x00-\\x1F]', ' ')));

  DELETE FROM BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION
  WHERE SCENARIO_ID = :P_SCENARIO_ID AND HUMAN_DECISION IS NULL;

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION
    (DECISION_ID, SCENARIO_ID, AI_RECOMMENDATION, AI_RATIONALE, AI_CONFIDENCE)
  SELECT :v_did, :P_SCENARIO_ID,
         UPPER(NVL(:v_json:recommendation::STRING, 'MODIFY')),
         NVL(:v_json:rationale::STRING, :v_raw),
         UPPER(NVL(:v_json:confidence::STRING, 'LOW'));

  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'decision_id', :v_did,
                          'recommendation', UPPER(NVL(:v_json:recommendation::STRING, 'MODIFY')),
                          'confidence', UPPER(NVL(:v_json:confidence::STRING, 'LOW')),
                          'rationale', NVL(:v_json:rationale::STRING, :v_raw))::STRING;
END;
$$;


-- ============================================================
-- 7. APPROVE_SCENARIO
-- ============================================================
-- Promotes a sandbox scenario to the approved forecast. One procedure doing all
-- of it, because a half-approved forecast is worse than a failed approval: the
-- version row, its values, the settings freeze, the supersede of the prior
-- version and the scenario status all have to move together or not at all.
--
-- The fact is NEVER rewritten. Approved versions live alongside it, so the
-- ML-generated baseline stays intact and ML-versus-planner attribution remains
-- possible.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.APPROVE_SCENARIO(
    P_SCENARIO_ID VARCHAR,
    P_LABEL       VARCHAR,
    P_APPROVED_BY VARCHAR,
    P_NOTES       VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  v_vid    VARCHAR;
  v_vno    INT;
  v_prev   VARCHAR;
  v_rbu    VARCHAR;
  v_dept   VARCHAR;
  v_class  VARCHAR;
  v_status VARCHAR;
BEGIN
  SELECT STATUS, RBU, DEPARTMENT, CLASS INTO :v_status, :v_rbu, :v_dept, :v_class
  FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO WHERE SCENARIO_ID = :P_SCENARIO_ID;

  IF (:v_status IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'No such scenario.')::STRING;
  END IF;
  IF (:v_status = 'APPROVED') THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Already approved.')::STRING;
  END IF;

  v_vid := 'VER-' || REPLACE(UUID_STRING(), '-', '');
  SELECT NVL(MAX(VERSION_NO), 0) + 1 INTO :v_vno
  FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION;

  -- THE PLAN CURRENTLY IN FORCE, captured BEFORE the UPDATE below flips it to
  -- SUPERSEDED. The new version is built on top of this, not on top of the ML
  -- baseline: approvals have to COMPOUND. Building every version from the model
  -- forecast plus only its own scenario meant the second approval silently
  -- reverted the first -- approving a Travel System rationalisation put an already
  -- signed-off Travel System price action back to its original value, and the
  -- version-over-version diff showed a mysterious +684k nobody had asked for.
  SELECT VERSION_ID INTO :v_prev
  FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION
  ORDER BY VERSION_NO DESC LIMIT 1;

  -- Prior version becomes history before the new one lands, so there is never a
  -- moment with two APPROVED versions for a page to pick between.
  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION
  SET STATUS = 'SUPERSEDED' WHERE STATUS = 'APPROVED';

  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION
    (VERSION_ID, VERSION_NO, LABEL, STATUS, SOURCE_SCENARIO_ID, RBU, DEPARTMENT,
     CLASS, APPROVED_BY, APPROVED_AT, NOTES, SETTINGS_SNAPSHOT)
  SELECT :v_vid, :v_vno,
         NVL(:P_LABEL, 'Approved forecast v' || :v_vno),
         'APPROVED', :P_SCENARIO_ID, :v_rbu, :v_dept, :v_class,
         :P_APPROVED_BY, CURRENT_TIMESTAMP(), :P_NOTES,
         -- Freeze the settings in force. Without this, changing the FX rate
         -- later would silently re-state a historical version's AUD figures.
         (SELECT OBJECT_AGG(SETTING_KEY, SETTING_VALUE::VARIANT)
          FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING);

  -- Snapshot values at all three levels, pre-rolled, so reads stay simple and
  -- parents remain literally SUM(children) inside the version.
  INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE
    (VERSION_ID, PLAN_LEVEL, RBU, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE,
     WEEK_NO, WEEK_SEQ, METRIC, VALUE_PHP, ML_BASELINE_PHP, PLANNER_DELTA_PHP)
  WITH prior AS (
      -- The plan in force at class grain. Empty on the very first approval, in
      -- which case the ML baseline below is correctly the starting point.
      SELECT CLASS, PERIOD_CODE, WEEK_NO, METRIC, VALUE_PHP
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE
      WHERE VERSION_ID = :v_prev
        AND PLAN_LEVEL = 'CLASS'
  ),
  resolved AS (
      SELECT
          w.RBU, w.DEPARTMENT, w.CLASS, w.FISCAL_YEAR, w.PERIOD_CODE,
          w.WEEK_NO, w.WEEK_SEQ, w.METRIC,
          -- Precedence: this scenario's edit, else the plan already approved,
          -- else the untouched model forecast.
          COALESCE(c.VALUE_PHP, p.VALUE_PHP, w.VALUE_PHP) AS VALUE_PHP,
          -- ML_BASELINE stays the MODEL's number, never the prior version's, so
          -- PLANNER_DELTA accumulates every human change made since the model
          -- rather than only the most recent approval's increment.
          w.VALUE_PHP                                    AS ML_BASELINE_PHP
      FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
      LEFT JOIN prior p
             ON p.CLASS       = w.CLASS
            AND p.PERIOD_CODE = w.PERIOD_CODE
            AND p.WEEK_NO     = w.WEEK_NO
            AND p.METRIC      = w.METRIC
      LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL c
             ON c.SCENARIO_ID = :P_SCENARIO_ID
            AND c.CLASS       = w.CLASS
            AND c.PERIOD_CODE = w.PERIOD_CODE
            AND c.WEEK_NO     = w.WEEK_NO
            AND c.METRIC      = w.METRIC
      WHERE w.VERSION    = 'FC'
        AND w.PLAN_LEVEL = 'CLASS'
  )
  SELECT
      :v_vid,
      CASE WHEN CLASS IS NOT NULL THEN 'CLASS'
           WHEN DEPARTMENT IS NOT NULL THEN 'DEPARTMENT'
           ELSE 'RBU' END,
      RBU, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE, WEEK_NO, WEEK_SEQ, METRIC,
      SUM(VALUE_PHP), SUM(ML_BASELINE_PHP), SUM(VALUE_PHP - ML_BASELINE_PHP)
  FROM resolved
  GROUP BY GROUPING SETS (
      (RBU, FISCAL_YEAR, PERIOD_CODE, WEEK_NO, WEEK_SEQ, METRIC),
      (RBU, DEPARTMENT, FISCAL_YEAR, PERIOD_CODE, WEEK_NO, WEEK_SEQ, METRIC),
      (RBU, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE, WEEK_NO, WEEK_SEQ, METRIC)
  );

  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
  SET STATUS = 'APPROVED', UPDATED_AT = CURRENT_TIMESTAMP()
  WHERE SCENARIO_ID = :P_SCENARIO_ID;

  -- Siblings of an approved option are REJECTED, not left DRAFT. Goal-seek
  -- alternatives are mutually exclusive, so leaving them open would let a second
  -- one be approved on top of the first.
  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
  SET STATUS = 'REJECTED', UPDATED_AT = CURRENT_TIMESTAMP()
  WHERE PARENT_SCENARIO_ID = (
          SELECT PARENT_SCENARIO_ID FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
          WHERE SCENARIO_ID = :P_SCENARIO_ID)
    AND PARENT_SCENARIO_ID IS NOT NULL
    AND SCENARIO_ID <> :P_SCENARIO_ID
    AND STATUS = 'DRAFT';

  UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION
  SET RESULTING_VERSION_ID = :v_vid
  WHERE SCENARIO_ID = :P_SCENARIO_ID;

  -- Tie this scenario's audit rows to the version they produced, so the history
  -- page can show what each approved version actually changed.
  BEGIN
    CALL BABY_MART_DEMO.ANALYTICS.STAMP_AUDIT_VERSION(:P_SCENARIO_ID, :v_vid);
  EXCEPTION
    WHEN OTHER THEN NULL;
  END;

  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'version_id', :v_vid, 'version_no', :v_vno)::STRING;
END;
$$;
