-- ============================================================
-- AI Assessment — cross-dashboard assessment procedure
--
--   GENERATE_AI_ASSESSMENT(P_TEMPLATE_NAME, P_SCOPE, P_SAVE, P_CREATED_BY)
--
-- Runs a single grounded CORTEX.COMPLETE over aggregated data from the
-- Merchandise Planner and Category Manager dashboards, shaped by a user-authored
-- SOP and insight template from ASSESSMENT_TEMPLATE.
--
-- WHY THE METRIC PACK READS VIEWS, NOT FACTS
-- Serialised, FACT_MFP_PLAN alone is ~51,000 rows and roughly 4.7 MILLION
-- tokens; FACT_OTB_POSITION adds another ~300,000. Neither can be sent to a
-- model. The pack below reads the summary views and pre-aggregates the DT_*
-- tables instead, which measures at roughly 17,000 tokens for scope BOTH --
-- comfortably one call, with no chunking or map-reduce.
--
-- WHY THE OUTPUT IS MARKDOWN AND NOT JSON
-- The user's template defines the section headings, so the output shape is not
-- known at authoring time and a fixed JSON schema cannot express it. Markdown
-- also sidesteps the failure mode that 09_battlecard_procedure.sql and
-- 14_planning_insights_procedure.sql both have to defend against: those prompts
-- must forbid literal newlines inside JSON string values, and still need
-- fence-stripping plus a control-character scrub before TRY_PARSE_JSON. Markdown
-- wants newlines, so none of that applies -- the text is wrapped in
-- OBJECT_CONSTRUCT here and Snowflake does the escaping.
--
-- SOP vs TEMPLATE, the distinction the whole feature rests on:
--   SOP_TEXT      = HOW to assess. Thresholds, materiality, judgement, tone.
--   TEMPLATE_TEXT = the OUTPUT SHAPE. Its markdown headings become the
--                   assessment's sections, in order.
--
-- Requires 10_ through 15_ to have run.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.AI;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.GENERATE_AI_ASSESSMENT(
  P_TEMPLATE_NAME STRING DEFAULT NULL,
  P_SCOPE STRING DEFAULT NULL,
  P_SAVE BOOLEAN DEFAULT TRUE,
  P_CREATED_BY STRING DEFAULT NULL
)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Generates a cross-dashboard AI assessment over merchandise planning and category/vendor data, shaped by a stored SOP and insight template. Returns markdown plus the source metrics.'
AS
$$
DECLARE
  v_name      STRING;
  v_scope     STRING;
  v_sop       STRING;
  v_template  STRING;
  v_version   INT;
  v_started   TIMESTAMP_LTZ;
  v_elapsed   INT;
  v_model     STRING DEFAULT 'claude-opus-4-7';

  -- Planning blocks
  v_plan_rbu     VARIANT;
  v_plan_depts   VARIANT;
  v_plan_classes VARIANT;
  v_otb_depts    VARIANT;
  v_otb_flagged  VARIANT;
  v_exceptions   VARIANT;
  v_suppliers    VARIANT;

  -- Commercial blocks
  v_cy         INT;
  v_max_wk     INT;
  v_cat_perf   VARIANT;
  v_brand_perf VARIANT;
  v_clv        VARIANT;
  v_difot      VARIANT;
  v_promo      VARIANT;
  v_promo_worst VARIANT;
  v_price_gap  VARIANT;
  v_switching  VARIANT;

  v_metrics   STRING;
  v_prompt    STRING;
  v_raw       STRING;
  v_markdown  STRING;
  v_id        STRING;
BEGIN
  v_started := CURRENT_TIMESTAMP();

  -- ---------- 1. Resolve the template ----------
  -- No name given falls back to the default template, so the API can offer a
  -- one-click run without the caller knowing what exists.
  IF (TRIM(COALESCE(:P_TEMPLATE_NAME, '')) = '') THEN
    SELECT TEMPLATE_NAME INTO :v_name
      FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
     WHERE IS_DEFAULT ORDER BY UPDATED_AT DESC LIMIT 1;
  ELSE
    v_name := TRIM(:P_TEMPLATE_NAME);
  END IF;

  SELECT SOP_TEXT, TEMPLATE_TEXT, SCOPE, VERSION
    INTO :v_sop, :v_template, :v_scope, :v_version
    FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
   WHERE TEMPLATE_NAME = :v_name;

  -- Early exit before any LLM spend.
  IF (v_template IS NULL) THEN
    RETURN OBJECT_CONSTRUCT(
      'error', IFF(:v_name IS NULL,
        'No default assessment template is set. Create one in Settings.',
        'Assessment template "' || :v_name || '" was not found.')
    )::STRING;
  END IF;

  -- An explicit scope argument overrides the template's own scope, so one
  -- template can be run narrowly without editing it.
  IF (TRIM(COALESCE(:P_SCOPE, '')) <> '') THEN
    v_scope := UPPER(TRIM(:P_SCOPE));
  END IF;
  IF (v_scope NOT IN ('PLANNING', 'COMMERCIAL', 'BOTH')) THEN
    RETURN OBJECT_CONSTRUCT(
      'error', 'Scope must be PLANNING, COMMERCIAL or BOTH, got "' || :v_scope || '".'
    )::STRING;
  END IF;

  -- ---------- 2. Planning metrics ----------
  IF (v_scope IN ('PLANNING', 'BOTH')) THEN

    -- RBU total. Reads VW_MFP_TOTAL, which is guaranteed to be exactly one row.
    -- Selecting from VW_MFP_SUMMARY WHERE PLAN_LEVEL = 'RBU' returns one row PER
    -- RBU, so once BABY-CONSUMABLES joined BABY-HARDGOODS this SELECT ... INTO failed
    -- outright and no assessment could be produced at all.
    SELECT OBJECT_CONSTRUCT(
             'rbu',                RBU,
             'sales_fc_php',       ROUND(SLS_FC_PHP, 0),
             'sales_bud_php',      ROUND(SLS_BUD_PHP, 0),
             'sales_f26_php',      ROUND(SLS_F26_PHP, 0),
             'var_to_bud_php',     ROUND(VAR_TO_BUD_PHP, 0),
             'var_to_bud_pct',     VAR_TO_BUD_PCT,
             'lfl_growth_pct',     LFL_GROWTH_PCT,
             'pos_gp_pct_fc',      GP_PCT_FC,
             'pos_gp_pct_bud',     GP_PCT_BUD,
             'pos_gp_gap_pp',      GP_GAP_PP,
             'units_fc',           UNITS_FC,
             'asp_fc_php',         ASP_FC_PHP,
             'option_count',       OPT_TOTAL_FC,
             'option_new_pct',     OPT_NEW_PCT)
      INTO :v_plan_rbu
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_TOTAL;

    -- Departments: the level most findings are written at.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'department',      DEPARTMENT,
             'code',            DEPARTMENT_CODE,
             'lfl_strategy',    LFL_STRATEGY,
             'sales_fc_php',    ROUND(SLS_FC_PHP, 0),
             'sales_bud_php',   ROUND(SLS_BUD_PHP, 0),
             'var_to_bud_php',  ROUND(VAR_TO_BUD_PHP, 0),
             'var_to_bud_pct',  VAR_TO_BUD_PCT,
             'lfl_growth_pct',  LFL_GROWTH_PCT,
             'pos_gp_pct_fc',   GP_PCT_FC,
             'pos_gp_pct_bud',  GP_PCT_BUD,
             'pos_gp_gap_pp',   GP_GAP_PP,
             'mix_pct',         MIX_PCT))
      INTO :v_plan_depts
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
     WHERE PLAN_LEVEL = 'DEPARTMENT';

    -- Classes carry fewer fields, but all 30 are included so the model can name
    -- a specific class rather than stopping at department level.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'class',          CLASS,
             'department',     DEPARTMENT,
             'lfl_strategy',   LFL_STRATEGY,
             'sales_fc_php',   ROUND(SLS_FC_PHP, 0),
             'var_to_bud_pct', VAR_TO_BUD_PCT,
             'lfl_growth_pct', LFL_GROWTH_PCT,
             'pos_gp_pct_fc',  GP_PCT_FC,
             'pos_gp_gap_pp',  GP_GAP_PP))
      INTO :v_plan_classes
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
     WHERE PLAN_LEVEL = 'CLASS';

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'department',          DEPARTMENT,
             'stock_php',           ROUND(STOCK_PHP, 0),
             'on_order_php',        ROUND(ON_ORDER_PHP, 0),
             'cover_weeks_stock_only',    FORWARD_COVER_WEEKS,
             'cover_weeks_incl_on_order', TOTAL_COVER_WEEKS,
             'target_cover_weeks',  TARGET_COVER_WEEKS,
             'otb_available_php',   ROUND(OTB_AVAILABLE_PHP, 0),
             'buy_status',          BUY_STATUS))
      INTO :v_otb_depts
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
     WHERE PLAN_LEVEL = 'DEPARTMENT';

    -- Only classes actually out of position. Sending all 30 balanced classes
    -- would spend tokens telling the model nothing is wrong.
    --
    -- BOTH COVER MEASURES GO OUT, EXPLICITLY NAMED. Only the stock-only figure
    -- used to be sent, so the model had to justify an OVERBUY pill with the one
    -- number that does NOT decide it: it printed TRAVEL SYSTEM at 16.5 weeks in its
    -- table while its own headline quoted the 19.1 it picked up from the
    -- exception text. One metric, two bases, contradicting itself in one report.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'class',               CLASS,
             'department',          DEPARTMENT,
             'buy_status',          BUY_STATUS,
             'cover_weeks_stock_only',    FORWARD_COVER_WEEKS,
             'cover_weeks_incl_on_order', TOTAL_COVER_WEEKS,
             'target_cover_weeks',  TARGET_COVER_WEEKS,
             'otb_available_php',   ROUND(OTB_AVAILABLE_PHP, 0),
             'stock_php',           ROUND(STOCK_PHP, 0)))
      INTO :v_otb_flagged
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
     WHERE PLAN_LEVEL = 'CLASS' AND BUY_STATUS <> 'BALANCED';

    -- Deterministic exception list. The model narrates and prioritises these; it
    -- does not decide what counts as an exception.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'type',         EXCEPTION_TYPE,
             'severity',     SEVERITY,
             'level',        PLAN_LEVEL,
             'node',         NODE,
             'metric',       METRIC,
             'variance_pct', VARIANCE_PCT,
             'headline',     HEADLINE))
      INTO :v_exceptions
      FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_EXCEPTIONS;

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'supplier',         SUPPLIER_NAME,
             'country',          SOURCING_COUNTRY,
             'po_count',         PO_COUNT,
             'delayed_pos',      DELAYED_COUNT,
             'avg_slip_days',    AVG_SLIP,
             'committed_php',    ROUND(COMMITTED, 0)))
      INTO :v_suppliers
      FROM (
        SELECT SUPPLIER_NAME, SOURCING_COUNTRY,
               COUNT(*) AS PO_COUNT,
               COUNT_IF(STATUS = 'DELAYED') AS DELAYED_COUNT,
               ROUND(AVG(IFF(STATUS = 'DELAYED', ETA_SLIP_DAYS, NULL)), 1) AS AVG_SLIP,
               SUM(COMMITTED_PHP) AS COMMITTED
          FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
         GROUP BY SUPPLIER_NAME, SOURCING_COUNTRY
      );
  END IF;

  -- ---------- 3. Commercial metrics ----------
  IF (v_scope IN ('COMMERCIAL', 'BOTH')) THEN

    -- Reporting window discovered, not hardcoded, and prior-year comparisons
    -- are capped to the same week so growth is like-for-like.
    SELECT MAX(FISCAL_YEAR) INTO :v_cy
      FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY;
    SELECT MAX(FISCAL_WEEK) INTO :v_max_wk
      FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
     WHERE FISCAL_YEAR = :v_cy;

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'category',       CATEGORY,
             'revenue_aud',    ROUND(REV_CY, 0),
             'margin_aud',     ROUND(MARG_CY, 0),
             'margin_pct',     ROUND(IFF(REV_CY > 0, 100.0 * MARG_CY / REV_CY, NULL), 1),
             'growth_pct',     ROUND(IFF(REV_LY > 0, 100.0 * (REV_CY - REV_LY) / REV_LY, NULL), 1),
             'units',          UNITS_CY))
      INTO :v_cat_perf
      FROM (
        SELECT CATEGORY,
               SUM(IFF(FISCAL_YEAR = :v_cy, REVENUE, 0))                     AS REV_CY,
               SUM(IFF(FISCAL_YEAR = :v_cy, MARGIN, 0))                      AS MARG_CY,
               SUM(IFF(FISCAL_YEAR = :v_cy, UNITS_SOLD, 0))                  AS UNITS_CY,
               SUM(IFF(FISCAL_YEAR = :v_cy - 1 AND FISCAL_WEEK <= :v_max_wk,
                       REVENUE, 0))                                          AS REV_LY
          FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
         GROUP BY CATEGORY
      );

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'brand',            BRAND_NAME,
             'category',         CATEGORY,
             'supplier',         SUPPLIER_NAME,
             'revenue_aud',      ROUND(REV_CY, 0),
             'margin_aud',       ROUND(MARG_CY, 0),
             'margin_pct',       ROUND(IFF(REV_CY > 0, 100.0 * MARG_CY / REV_CY, NULL), 1),
             'growth_pct',       ROUND(IFF(REV_LY > 0, 100.0 * (REV_CY - REV_LY) / REV_LY, NULL), 1),
             'category_share_pct', ROUND(IFF(CAT_REV > 0, 100.0 * REV_CY / CAT_REV, NULL), 1),
             -- Margin gap vs the brand's own category, precomputed in both
             -- percentage points and cash so the model never derives it.
             'margin_gap_pp',    ROUND(IFF(REV_CY > 0 AND CAT_REV > 0,
                                     (MARG_CY / REV_CY - CAT_MARG / CAT_REV) * 100, NULL), 1),
             'margin_gap_aud',   ROUND(IFF(REV_CY > 0 AND CAT_REV > 0,
                                     REV_CY * (MARG_CY / REV_CY - CAT_MARG / CAT_REV), NULL), 0)))
      INTO :v_brand_perf
      FROM (
        SELECT b.*,
               SUM(REV_CY)  OVER (PARTITION BY CATEGORY) AS CAT_REV,
               SUM(MARG_CY) OVER (PARTITION BY CATEGORY) AS CAT_MARG
          FROM (
            SELECT BRAND_NAME, CATEGORY, MAX(SUPPLIER_NAME) AS SUPPLIER_NAME,
                   SUM(IFF(FISCAL_YEAR = :v_cy, REVENUE, 0))    AS REV_CY,
                   SUM(IFF(FISCAL_YEAR = :v_cy, MARGIN, 0))     AS MARG_CY,
                   SUM(IFF(FISCAL_YEAR = :v_cy - 1 AND FISCAL_WEEK <= :v_max_wk,
                           REVENUE, 0))                         AS REV_LY
              FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
             GROUP BY BRAND_NAME, CATEGORY
          ) b
      );

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'brand',          BRAND_NAME,
             'category',       CATEGORY,
             'avg_clv_aud',    ROUND(AVG_CLV, 0),
             'customer_count', CUSTOMER_COUNT))
      INTO :v_clv
      FROM BABY_MART_DEMO.ANALYTICS.DT_CLV_BY_BRAND;

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'brand',        BRAND_NAME,
             'difot_pct',    ROUND(D, 1),
             'orders_total', O))
      INTO :v_difot
      FROM (
        SELECT BRAND_NAME, AVG(DIFOT_PCT) AS D, SUM(ORDERS_TOTAL) AS O
          FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
         WHERE FISCAL_YEAR = :v_cy
         GROUP BY BRAND_NAME
      );

    -- Promotions roll to mechanic level: the 125 brand x mechanic combinations
    -- are mostly noise, so only the mechanic summary plus the worst offenders
    -- are sent.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'mechanic',       MECHANIC,
             'promo_revenue_aud', ROUND(PR, 0),
             'discount_aud',      ROUND(TD, 0),
             'promo_margin_aud',  ROUND(PM, 0),
             'margin_pct',        ROUND(IFF(PR > 0, 100.0 * PM / PR, NULL), 1),
             'roi',               ROUND(IFF(TD > 0, PM / TD, NULL), 2)))
      INTO :v_promo
      FROM (
        SELECT MECHANIC, SUM(PROMO_REVENUE) PR, SUM(TOTAL_DISCOUNT) TD, SUM(PROMO_MARGIN) PM
          FROM BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
         GROUP BY MECHANIC
      );

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'brand',            BRAND_NAME,
             'mechanic',         MECHANIC,
             'promo_revenue_aud', ROUND(PR, 0),
             'promo_margin_aud',  ROUND(PM, 0),
             'margin_pct',        ROUND(IFF(PR > 0, 100.0 * PM / PR, NULL), 1)))
      INTO :v_promo_worst
      FROM (
        SELECT BRAND_NAME, MECHANIC, SUM(PROMO_REVENUE) PR, SUM(PROMO_MARGIN) PM
          FROM BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
         GROUP BY BRAND_NAME, MECHANIC
         QUALIFY ROW_NUMBER() OVER (
           ORDER BY IFF(SUM(PROMO_REVENUE) > 0,
                        SUM(PROMO_MARGIN) / SUM(PROMO_REVENUE), 999) ASC) <= 10
      );

    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'brand',          BRAND_NAME,
             'price_gap_pct',  ROUND(G, 1)))
      INTO :v_price_gap
      FROM (
        SELECT BRAND_NAME, AVG(AVG_PRICE_GAP_PCT) AS G
          FROM BABY_MART_DEMO.ANALYTICS.DT_COMPETITIVE_POSITION
         GROUP BY BRAND_NAME
      );

    -- Top switching flows only.
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
             'category',   CATEGORY,
             'from_brand', FROM_BRAND,
             'to_brand',   TO_BRAND,
             'switches',   S))
      INTO :v_switching
      FROM (
        SELECT CATEGORY, FROM_BRAND, TO_BRAND, SUM(SWITCH_COUNT) AS S
          FROM BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
         GROUP BY CATEGORY, FROM_BRAND, TO_BRAND
         QUALIFY ROW_NUMBER() OVER (ORDER BY SUM(SWITCH_COUNT) DESC) <= 15
      );
  END IF;

  -- ---------- 4. Metric pack ----------
  -- Plain OBJECT_CONSTRUCT, not KEEP_NULL: out-of-scope blocks are omitted
  -- entirely rather than sent as nulls the model has to reason about.
  v_metrics := TO_JSON(OBJECT_CONSTRUCT(
    'scope',                  :v_scope,
    'planning_currency',      IFF(:v_scope IN ('PLANNING','BOTH'), 'PHP', NULL),
    'commercial_currency',    IFF(:v_scope IN ('COMMERCIAL','BOTH'), 'AUD', NULL),
    'planning_horizon',       IFF(:v_scope IN ('PLANNING','BOTH'), 'F27 H1 (Jan-Jun 2027)', NULL),
    'commercial_fiscal_year', IFF(:v_scope IN ('COMMERCIAL','BOTH'), :v_cy, NULL),
    'commercial_through_week',IFF(:v_scope IN ('COMMERCIAL','BOTH'), :v_max_wk, NULL),

    'planning_rbu_total',        :v_plan_rbu,
    'planning_departments',      :v_plan_depts,
    'planning_classes',          :v_plan_classes,
    'otb_departments',           :v_otb_depts,
    'otb_classes_out_of_position', :v_otb_flagged,
    'detected_exceptions',       :v_exceptions,
    'supplier_commitments',      :v_suppliers,

    'category_performance',      :v_cat_perf,
    'brand_performance',         :v_brand_perf,
    'customer_value_by_brand',   :v_clv,
    'difot_by_brand',            :v_difot,
    'promotions_by_mechanic',    :v_promo,
    'worst_promotions',          :v_promo_worst,
    'competitor_price_gap',      :v_price_gap,
    'brand_switching_top_flows', :v_switching
  ));

  -- ---------- 5. Prompt ----------
  -- Order matters: the SOP sets the standard of practice, the template fixes the
  -- output shape, the metrics are the only permitted source of numbers.
  v_prompt :=
       'You are producing a written assessment for Baby Mart, a baby and nursery goods '
    || 'and merchandise business. Two audiences read it: the Global Planning team '
    || '(Head of Central Planning & Inventory, Planning Manager, Merchandise '
    || 'Planner) and Category Managers.' || CHAR(10) || CHAR(10)
    || '=== STANDARD OPERATING PROCEDURE ===' || CHAR(10)
    || 'This defines HOW to assess. Follow it exactly.' || CHAR(10) || CHAR(10)
    || COALESCE(:v_sop, '(none supplied)') || CHAR(10) || CHAR(10)
    || '=== REQUIRED OUTPUT TEMPLATE ===' || CHAR(10)
    || 'This defines the SHAPE of your answer. Reproduce EVERY heading below '
    || 'exactly as written, in the same order, at the same markdown level. Replace '
    || 'the guidance under each heading with your actual assessment. Do not add, '
    || 'remove, rename or reorder headings.' || CHAR(10) || CHAR(10)
    || :v_template || CHAR(10) || CHAR(10)
    || '=== DATA ===' || CHAR(10)
    || 'This is the ONLY source of facts available to you.' || CHAR(10) || CHAR(10)
    || :v_metrics || CHAR(10) || CHAR(10)
    || '=== RULES ===' || CHAR(10)
    || '- Every number you cite must come from the DATA above. Never invent, '
    || 'estimate or infer a figure.' || CHAR(10)
    || '- Copy numeric values VERBATIM. Never recompute, re-derive or re-round: '
    || 'if var_to_bud_pct is -13.3, write -13.3%, not -13%.' || CHAR(10)
    || '- Never restate a metric as something it is not. sales_fc_php is TOTAL '
    || 'forecast sales, NOT a variance. Use var_to_bud_php / var_to_bud_pct for '
    || 'the gap to budget, pos_gp_gap_pp for a margin RATE gap in percentage '
    || 'points, and margin_gap_aud for a margin gap in CASH. These are different '
    || 'quantities; do not substitute one for another.' || CHAR(10)
    || '- If a metric is absent or null, omit that point rather than guessing a '
    || 'replacement or writing "unknown" / "N/A".' || CHAR(10)
    || '- Never write meta-commentary about the data itself. Sentences like "no '
    || 'category-level data is present in this dataset" tell the reader nothing '
    || 'about the business; if a section has no data behind it, write only what '
    || 'the supplied data does support and say nothing about what is missing.' || CHAR(10)
    || '- CURRENCY: planning figures (anything _php) are Philippine Pesos and '
    || 'belong to the F27 H1 merchandise plan. Category and vendor figures '
    || '(anything _aud) are Australian Dollars. Never convert between them and '
    || 'never total them together.' || CHAR(10)
    || '- An lfl_strategy of "D" marks a DELIBERATE planned decline. Do not '
    || 'report its negative growth as a risk; judge it against budget.' || CHAR(10)
    || '- COVER: there are TWO cover measures and they are not interchangeable. '
    || 'cover_weeks_incl_on_order is the one buy_status is judged on, so it is '
    || 'the ONLY figure you may quote when explaining an OVERBUY or UNDERBUY '
    || 'flag, or compare against target_cover_weeks. cover_weeks_stock_only '
    || 'excludes stock already on order and is always the smaller number; quote '
    || 'it only when explicitly discussing stock on hand, and label it as such. '
    || 'Never present one basis in a table and the other in your commentary.' || CHAR(10)
    || '- Ground findings in detected_exceptions where one applies. You may '
    || 'prioritise and explain them, and may add a finding the exception list '
    || 'missed only where the data clearly supports it.' || CHAR(10)
    || '- Name the specific department, class, brand or supplier to act on.' || CHAR(10)
    || '- Do NOT reference store-level inventory, customer demographics, supplier '
    || 'cost structures, shelf productivity per linear metre or promotional '
    || 'calendars. There is no data for any of these.' || CHAR(10) || CHAR(10)
    || 'Write the assessment in GitHub-flavoured markdown. Tables are welcome '
    || 'where they aid comparison. Return ONLY the markdown document, with no '
    || 'preamble, no closing commentary and no surrounding code fence.';

  -- ---------- 6. Generate ----------
  -- Options form for max_tokens: a multi-section assessment truncates mid-
  -- sentence at the default cap. temperature 0 keeps demo runs reproducible.
  -- With options, COMPLETE returns an object rather than a string.
  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    :v_model,
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 16384, 'temperature': 0}
  ):choices[0]:messages::STRING;

  -- Strip a wrapping code fence if the model added one despite the instruction.
  -- Note there is deliberately NO control-character scrub here: unlike the JSON
  -- procedures, newlines are meaningful output, not corruption.
  v_markdown := TRIM(REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*\\s*|\\s*```\\s*$', ''));

  v_elapsed := DATEDIFF('millisecond', :v_started, CURRENT_TIMESTAMP());
  v_id      := UUID_STRING();

  -- ---------- 7. Persist ----------
  -- SOP and template text are snapshotted onto the run, not referenced, so a
  -- later edit cannot silently change what a saved assessment claims to be
  -- based on.
  IF (COALESCE(:P_SAVE, TRUE)) THEN
    INSERT INTO BABY_MART_DEMO.ANALYTICS.ASSESSMENT_RUN
          (ASSESSMENT_ID, CREATED_AT, CREATED_BY, TEMPLATE_NAME, TEMPLATE_VERSION,
           SCOPE, SOP_SNAPSHOT, TEMPLATE_SNAPSHOT, OUTPUT_MARKDOWN,
           SOURCE_METRICS, MODEL, ELAPSED_MS)
    SELECT :v_id, CURRENT_TIMESTAMP(), :P_CREATED_BY, :v_name, :v_version,
           :v_scope, :v_sop, :v_template, :v_markdown,
           TRY_PARSE_JSON(:v_metrics), :v_model, :v_elapsed;
  END IF;

  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'assessment_id',    IFF(COALESCE(:P_SAVE, TRUE), :v_id, NULL),
    'template_name',    :v_name,
    'template_version', :v_version,
    'scope',            :v_scope,
    'model',            :v_model,
    'elapsed_ms',       :v_elapsed,
    'markdown',         :v_markdown,
    'metrics',          TRY_PARSE_JSON(:v_metrics)
  )::STRING;
END;
$$;
