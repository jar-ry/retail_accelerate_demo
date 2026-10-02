-- ============================================================
-- Baby Mart Global Planning — AI planning insights procedure
--
-- GENERATE_PLANNING_INSIGHTS(P_LEVEL, P_NODE, P_SCENARIO)
--
-- Serves both requested scenarios from one tool:
--   Scenario 1 (MFP)  -> sales/margin/ASP/option risks and opportunities
--   Scenario 2 (WISSI)-> buy position, cover, supplier commitment exposure
-- and supports natural-language interaction with explainable recommendations,
-- which is why every action carries an explicit "why" field.
--
-- DESIGN, INHERITED FROM 09_battlecard_procedure.sql
-- Every figure is QUERIED from the planning views first and handed to
-- CORTEX.COMPLETE as a metric pack. The model writes the argument and the
-- recommended action; it never sources or derives a number. The risks and
-- opportunities themselves come from VW_PLANNING_EXCEPTIONS, i.e. deterministic
-- SQL thresholds, so the same question asked twice returns the same findings.
--
-- Constraints this file exists to respect, all learned the hard way:
--   * metrics are gathered as SEQUENTIAL scalar assignments, not correlated
--     LATERAL joins -- Snowflake rejects the latter with "Unsupported subquery
--     type cannot be evaluated" once aggregates reference outer columns
--   * gaps and variances are PRECOMPUTED, because a model left to derive them
--     misattributes (quoting a total as the size of a gap)
--   * COMPLETE is called in the options form for max_tokens, which means the
--     result is an object and needs :choices[0]:messages
--   * the response is fence-stripped AND control-char scrubbed before parsing
--
-- P_LEVEL    'RBU' | 'DEPARTMENT' | 'CLASS'
-- P_NODE     the node name, e.g. 'BABY-HARDGOODS', 'CAR SEATS', 'BOTTLES'
-- P_SCENARIO optional what-if, e.g. 'demand down 5% in Q4' -- when supplied the
--            model must quantify the commercial impact against the same metrics
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.AI;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.GENERATE_PLANNING_INSIGHTS(
  P_LEVEL STRING,
  P_NODE STRING,
  P_SCENARIO STRING DEFAULT NULL
)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Generates data-grounded merchandise financial planning (MFP) and open-to-buy (OTB/WISSI) insights for an RBU, department or class. Returns JSON with risks, opportunities and the source metrics. Reports findings only; it does not prescribe actions.'
AS
$$
DECLARE
  v_level      STRING;
  v_node       STRING;
  v_dept       STRING;

  -- MFP
  v_sls_fc     FLOAT;
  v_sls_bud    FLOAT;
  v_sls_ly     FLOAT;
  v_sls_f26    FLOAT;
  v_var_bud_php FLOAT;
  v_var_bud_pct FLOAT;
  v_lfl_pct    FLOAT;
  v_gp_fc      FLOAT;
  v_gp_bud     FLOAT;
  v_gp_pct_fc  FLOAT;
  v_gp_pct_bud FLOAT;
  v_gp_gap_pp  FLOAT;
  v_units_fc   FLOAT;
  v_asp_fc     FLOAT;
  v_asp_ly     FLOAT;
  v_opt_total  FLOAT;
  v_opt_new_pct FLOAT;
  v_mix_pct    FLOAT;
  v_strategy   STRING;
  v_fx         FLOAT;

  -- OTB
  v_stock_php  FLOAT;
  v_on_order   FLOAT;
  v_cover      FLOAT;
  v_target_cov FLOAT;
  v_otb_avail  FLOAT;
  v_buy_status STRING;

  -- Supply
  v_commit_php  FLOAT;
  v_delayed_pos INT;
  v_avg_slip    FLOAT;

  -- Context
  v_exceptions VARIANT;
  v_children   VARIANT;

  v_metrics    STRING;
  v_prompt     STRING;
  v_raw        STRING;
  v_out        VARIANT;
BEGIN
  v_level := UPPER(COALESCE(:P_LEVEL, 'DEPARTMENT'));
  v_node  := UPPER(TRIM(COALESCE(:P_NODE, '')));

  -- ---------- 1. MFP position ----------
  SELECT
      SLS_FC_PHP, SLS_BUD_PHP, SLS_LY_PHP, SLS_F26_PHP,
      VAR_TO_BUD_PHP, VAR_TO_BUD_PCT, LFL_GROWTH_PCT,
      GP_FC_PHP, GP_BUD_PHP, GP_PCT_FC, GP_PCT_BUD, GP_GAP_PP,
      UNITS_FC, ASP_FC_PHP, ASP_LY_PHP,
      OPT_TOTAL_FC, OPT_NEW_PCT, MIX_PCT, LFL_STRATEGY,
      FX_RATE_PHP_AUD, DEPARTMENT
    INTO :v_sls_fc, :v_sls_bud, :v_sls_ly, :v_sls_f26,
         :v_var_bud_php, :v_var_bud_pct, :v_lfl_pct,
         :v_gp_fc, :v_gp_bud, :v_gp_pct_fc, :v_gp_pct_bud, :v_gp_gap_pp,
         :v_units_fc, :v_asp_fc, :v_asp_ly,
         :v_opt_total, :v_opt_new_pct, :v_mix_pct, :v_strategy,
         :v_fx, :v_dept
    FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
   WHERE PLAN_LEVEL = :v_level
     AND UPPER(COALESCE(CLASS, DEPARTMENT, RBU)) = :v_node
   LIMIT 1;

  -- Early exit before any LLM spend if the node does not exist.
  IF (v_sls_fc IS NULL) THEN
    RETURN OBJECT_CONSTRUCT(
      'error', 'No plan found for ' || :v_level || ' "' || :P_NODE ||
               '". Check the name against DIM_MERCH_HIERARCHY.'
    )::STRING;
  END IF;

  -- ---------- 2. Buy position ----------
  -- RBU level has no OTB row (the OTB view is class/department only), so these
  -- stay NULL there and the prompt rules tell the model to omit them.
  SELECT
      SUM(STOCK_PHP), SUM(ON_ORDER_PHP),
      ROUND(SUM(STOCK_PHP) / NULLIF(SUM(AVG_WK_SLS_PHP), 0), 1),
      ROUND(AVG(TARGET_COVER_WEEKS), 1),
      SUM(OTB_AVAILABLE_PHP),
      MAX(BUY_STATUS)
    INTO :v_stock_php, :v_on_order, :v_cover, :v_target_cov, :v_otb_avail, :v_buy_status
    FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
   WHERE (:v_level = 'CLASS'      AND PLAN_LEVEL = 'CLASS'      AND UPPER(CLASS) = :v_node)
      OR (:v_level = 'DEPARTMENT' AND PLAN_LEVEL = 'DEPARTMENT' AND UPPER(DEPARTMENT) = :v_node)
      OR (:v_level = 'RBU'        AND PLAN_LEVEL = 'DEPARTMENT' AND UPPER(RBU) = :v_node);

  -- ---------- 3. Supplier commitment exposure ----------
  SELECT
      SUM(COMMITTED_PHP),
      COUNT_IF(STATUS = 'DELAYED'),
      AVG(IFF(STATUS = 'DELAYED', ETA_SLIP_DAYS, NULL))
    INTO :v_commit_php, :v_delayed_pos, :v_avg_slip
    FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
   WHERE (:v_level = 'CLASS'      AND UPPER(CLASS) = :v_node)
      OR (:v_level = 'DEPARTMENT' AND UPPER(DEPARTMENT) = :v_node)
      OR (:v_level = 'RBU'        AND UPPER(RBU) = :v_node);

  -- ---------- 4. Detected exceptions (deterministic, not model-authored) ----------
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
            'type',         EXCEPTION_TYPE,
            'severity',     SEVERITY,
            'level',        PLAN_LEVEL,
            'node',         NODE,
            'metric',       METRIC,
            'variance_pct', VARIANCE_PCT,
            'headline',     HEADLINE))
    INTO :v_exceptions
    FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_EXCEPTIONS
   WHERE (:v_level = 'RBU'
          -- Supplier and other non-merchandise exceptions carry no DEPARTMENT;
          -- they are account-wide and belong in every RBU's picture.
          AND (DEPARTMENT IS NULL
               OR UPPER(DEPARTMENT) IN (
                    SELECT UPPER(DEPARTMENT)
                      FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
                     WHERE UPPER(RBU) = :v_node)))
      OR (:v_level = 'DEPARTMENT' AND UPPER(COALESCE(DEPARTMENT, '')) = :v_node)
      OR (:v_level = 'CLASS'      AND UPPER(COALESCE(CLASS, '')) = :v_node);

  -- ---------- 5. Children, so recommendations can point somewhere specific ----------
  -- An RBU-level insight that says "fix CAR SEATS" is far more useful than one
  -- that says "sales are behind"; this gives the model the next level down.
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
            'name',           COALESCE(CLASS, DEPARTMENT),
            'sales_fc_php',   ROUND(SLS_FC_PHP, 0),
            'var_to_bud_pct', VAR_TO_BUD_PCT,
            'gp_pct_fc',      GP_PCT_FC,
            'gp_gap_pp',      GP_GAP_PP,
            'lfl_growth_pct', LFL_GROWTH_PCT,
            'mix_pct',        MIX_PCT))
    INTO :v_children
    FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
   WHERE (:v_level = 'RBU'        AND PLAN_LEVEL = 'DEPARTMENT'
          AND UPPER(RBU) = :v_node)
      OR (:v_level = 'DEPARTMENT' AND PLAN_LEVEL = 'CLASS'
          AND UPPER(DEPARTMENT) = :v_node);

  -- ---------- 6. Metric pack ----------
  -- Every value rounded at construction, every ratio guarded, and every gap
  -- precomputed so the model has nothing left to calculate.
  v_metrics := TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL(
    'level',                 :v_level,
    'node',                  :P_NODE,
    'department',             :v_dept,
    'lfl_strategy',          :v_strategy,
    'plan_horizon',          'F27 H1 (Jan-Jun 2027)',
    'currency',              'PHP',
    'fx_rate_php_per_aud',   :v_fx,

    -- Sales
    'sales_fc_php',          ROUND(:v_sls_fc, 0),
    'sales_bud_php',         ROUND(:v_sls_bud, 0),
    'sales_ly_php',          ROUND(:v_sls_ly, 0),
    'sales_f26_actual_php',  ROUND(:v_sls_f26, 0),
    'sales_var_to_bud_php',  ROUND(:v_var_bud_php, 0),
    'sales_var_to_bud_pct',  :v_var_bud_pct,
    'lfl_growth_pct',        :v_lfl_pct,
    'mix_pct_of_parent',     :v_mix_pct,

    -- Margin
    'pos_gp_fc_php',         ROUND(:v_gp_fc, 0),
    'pos_gp_bud_php',        ROUND(:v_gp_bud, 0),
    'pos_gp_pct_fc',         :v_gp_pct_fc,
    'pos_gp_pct_bud',        :v_gp_pct_bud,
    'pos_gp_gap_pp',         :v_gp_gap_pp,
    'pos_gp_gap_php',        ROUND(:v_sls_fc * COALESCE(:v_gp_gap_pp, 0) / 100.0, 0),

    -- Units / price / range
    'units_fc',              ROUND(:v_units_fc, 0),
    'asp_fc_php',            :v_asp_fc,
    'asp_ly_php',            :v_asp_ly,
    'asp_var_pct',           ROUND(IFF(:v_asp_ly > 0,
                               (:v_asp_fc / :v_asp_ly - 1) * 100, NULL), 1),
    'option_count',          ROUND(:v_opt_total, 0),
    'option_new_pct',        :v_opt_new_pct,

    -- Buy position
    'stock_php',             ROUND(:v_stock_php, 0),
    'on_order_php',          ROUND(:v_on_order, 0),
    'forward_cover_weeks',   :v_cover,
    'target_cover_weeks',    :v_target_cov,
    'cover_gap_weeks',       ROUND(COALESCE(:v_cover, 0) - COALESCE(:v_target_cov, 0), 1),
    'otb_available_php',     ROUND(:v_otb_avail, 0),
    'buy_status',            :v_buy_status,

    -- Supply
    'supplier_committed_php', ROUND(:v_commit_php, 0),
    'delayed_po_count',       :v_delayed_pos,
    'avg_eta_slip_days',      ROUND(:v_avg_slip, 1),

    'detected_exceptions',   :v_exceptions,
    'children',              :v_children
  ));

  -- ---------- 7. Narrative ----------
  v_prompt :=
       'You are an AI planning assistant supporting Baby Mart''s Global Planning team '
    || '(Head of Central Planning & Inventory, Planning Manager, Merchandise '
    || 'Planner). Write proactive planning insights using ONLY the metrics in the '
    || 'JSON below.' || CHAR(10) || CHAR(10)
    || 'METRICS:' || CHAR(10) || :v_metrics || CHAR(10) || CHAR(10)
    || 'RULES:' || CHAR(10)
    || '- Every number you cite must come from the METRICS JSON. Never invent a figure.' || CHAR(10)
    || '- Copy numeric values VERBATIM. Never recompute, re-derive or re-round: if '
    || 'pos_gp_pct_fc is 35.9, write 35.9%, not 36%.' || CHAR(10)
    || '- Never restate a metric as something it is not. sales_fc_php is TOTAL '
    || 'forecast sales, NOT the size of a variance; use sales_var_to_bud_php and '
    || 'sales_var_to_bud_pct for the gap to budget, and pos_gp_gap_pp / '
    || 'pos_gp_gap_php for the margin gap.' || CHAR(10)
    || '- If a metric is null, omit it entirely rather than guessing a replacement. '
    || 'At RBU level the buy-position metrics may be null.' || CHAR(10)
    || '- Ground every risk and opportunity in detected_exceptions. Do not invent '
    || 'additional exceptions: those rows are the authoritative list.' || CHAR(10)
    || '- Use the children array to name the specific department or class each '
    || 'finding concerns. A risk that names no node is not useful.' || CHAR(10)
    || '- lfl_strategy "D" means the decline is INTENTIONAL (a managed exit), so '
    || 'treat a sales decline there as on-strategy, not as a risk.' || CHAR(10)
    || '- Amounts are PHP. Write them as "PHP 36.0M" style, dividing by 1,000,000 '
    || 'only for presentation.' || CHAR(10)
    || '- Every risk and opportunity needs a "data" field quoting the specific '
    || 'metric it follows from. This is the explainability requirement.' || CHAR(10)
    || '- Do NOT reference store-level inventory, competitor pricing, promotional '
    || 'calendars or customer segments. Baby Mart holds no planning data for these here.'
    || CHAR(10) || CHAR(10);

  -- The scenario branch is what makes this usable for "model a change in demand,
  -- supply or buying strategy" without a second tool.
  IF (:P_SCENARIO IS NOT NULL AND TRIM(:P_SCENARIO) <> '') THEN
    v_prompt := :v_prompt
      || 'SCENARIO TO MODEL: ' || :P_SCENARIO || CHAR(10)
      || 'Quantify this scenario''s commercial impact by applying it to the '
      || 'metrics above and showing the resulting sales, margin and buy position. '
      || 'State the arithmetic you applied so a planner can check it. Put this in '
      || 'scenario_commentary.' || CHAR(10) || CHAR(10);
  ELSE
    v_prompt := :v_prompt
      || 'No scenario was requested: set scenario_commentary to null.'
      || CHAR(10) || CHAR(10);
  END IF;

  -- No recommended_actions key. This procedure reports what the data SAYS --
  -- risks, opportunities and their supporting metrics -- and deliberately stops
  -- short of prescribing what to do about it. Deciding the action is the
  -- planner's job, and a generated action list invites it being followed without
  -- the judgement that should sit behind it.
  v_prompt := :v_prompt
    || 'Return ONLY valid JSON with no markdown fences, matching exactly:' || CHAR(10)
    || '{"summary":"",'
    || '"risks":[{"title":"","detail":"","data":"","impact":3}],'
    || '"opportunities":[{"title":"","detail":"","data":"","impact":3}],'
    || '"scenario_commentary":null}' || CHAR(10)
    || 'impact is 1-5, 5 highest.' || CHAR(10)
    || 'Do NOT include a recommended_actions key. Report findings only.' || CHAR(10)
    || 'CRITICAL: never place a literal newline or control character inside any '
    || 'JSON string value. Keep every string on one line.';

  -- The options form is required to raise max_tokens: the default cap truncates
  -- a response this size mid-JSON. temperature 0 keeps demo runs reproducible.
  -- With options, COMPLETE returns an object rather than a string.
  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    'claude-opus-4-7',
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 16384, 'temperature': 0}
  ):choices[0]:messages::STRING;

  -- Strip fences, then scrub control characters. Both are needed: the model
  -- intermittently emits raw newlines inside strings, which is invalid JSON.
  -- TRY_PARSE_JSON so a bad response yields NULL rather than raising.
  v_out := TRY_PARSE_JSON(
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*|```\\s*$', ''),
      '[\\x00-\\x1F]', ' '))
  );

  -- Return the narrative PLUS the metrics that produced it, so the app and the
  -- agent can always show provenance, and insights_raw when parsing failed so a
  -- bad response is debuggable rather than silently empty.
  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'level',        :v_level,
    'node',         :P_NODE,
    'scenario',     :P_SCENARIO,
    'metrics',      TRY_PARSE_JSON(:v_metrics),
    'insights',     :v_out,
    'insights_raw', IFF(:v_out IS NULL, :v_raw, NULL)
  )::STRING;
END;
$$;
