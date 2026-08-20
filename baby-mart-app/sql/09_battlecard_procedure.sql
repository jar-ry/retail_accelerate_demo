-- ============================================================
-- Baby Mart Retail Platform
-- 09_battlecard_procedure.sql
--
-- GENERATE_BATTLECARD(brand, category) -> JSON negotiation battlecard.
--
-- Replaces the app's previous approach, where the Huggies card was hardcoded
-- literals and every other brand was produced by an LLM prompt containing no
-- data at all (so margins, DIFOT and dollar values were invented).
--
-- Here every figure is queried from the analytics tables first, then passed to
-- CORTEX.COMPLETE purely to write the argument/ask wording. Two arguments the
-- old card claimed have no data source in this model -- space productivity
-- ($/linear metre needs planogram data) and input cost management (needs a
-- commodity feed) -- so the prompt forbids inventing numbers for them.
--
-- Callable by the app (/api/battlecard) and registered as a `generic` tool on
-- the Cortex Agents so the chat can produce battlecards too.
--
-- Metrics are gathered as sequential scalar assignments rather than correlated
-- LATERAL joins: Snowflake rejects the latter here with "Unsupported subquery
-- type cannot be evaluated" once aggregates reference outer columns.
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA AI;
USE WAREHOUSE DEMO_AI_WH;

-- The agent binds tool arguments BY NAME from the tool's input_schema, so the
-- schema property names must match these parameter names exactly (p_brand /
-- p_category). P_CATEGORY defaults so the agent can call with brand alone.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.GENERATE_BATTLECARD(
  P_BRAND STRING,
  P_CATEGORY STRING DEFAULT NULL
)
RETURNS STRING
LANGUAGE SQL
COMMENT = 'Generates a data-grounded supplier negotiation battlecard for a brand. Returns JSON with the source metrics attached.'
AS
$$
DECLARE
  v_cy            INTEGER;
  v_max_wk        INTEGER;
  v_category      STRING;
  v_rev           FLOAT;
  v_marg          FLOAT;
  v_units         FLOAT;
  v_ros           FLOAT;
  v_rev_py        FLOAT;
  v_cat_rev       FLOAT;
  v_cat_marg      FLOAT;
  v_cat_ros       FLOAT;
  v_top_state     STRING;
  v_state_share   FLOAT;
  v_difot         FLOAT;
  v_difot_orders  FLOAT;
  v_difot_cat     FLOAT;
  v_gained        FLOAT;
  v_lost          FLOAT;
  v_top_source    STRING;
  v_top_loss      STRING;
  v_gap           FLOAT;
  v_mech          STRING;
  v_pm_margin     FLOAT;
  v_roi           FLOAT;
  v_clv           FLOAT;
  v_txn           FLOAT;
  v_customers     FLOAT;
  v_classes       STRING;
  v_metrics       STRING;
  v_prompt        STRING;
  v_raw           STRING;
  v_card          VARIANT;
BEGIN
  -- ---------- 1. Reporting window ----------
  SELECT MAX(FISCAL_YEAR) INTO :v_cy
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY;

  SELECT MAX(FISCAL_WEEK) INTO :v_max_wk
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE FISCAL_YEAR = :v_cy;

  -- Resolve the category: use the caller's if given, else the brand's biggest.
  IF (P_CATEGORY IS NULL OR P_CATEGORY = '') THEN
    SELECT CATEGORY INTO :v_category
    FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
    WHERE BRAND_NAME = :P_BRAND
    GROUP BY CATEGORY
    ORDER BY SUM(REVENUE) DESC NULLS LAST
    LIMIT 1;
  ELSE
    v_category := P_CATEGORY;
  END IF;

  IF (v_category IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('error', 'No sell-through data for brand ' || :P_BRAND)::STRING;
  END IF;

  -- ---------- 2. Brand performance, current year to date ----------
  -- SELL_THROUGH_RATE / WEEKS_OF_COVER are deliberately not read: the dynamic
  -- table defines them as literal NULL, and older accounts omit the columns.
  SELECT SUM(REVENUE), SUM(MARGIN), SUM(UNITS_SOLD), AVG(RATE_OF_SALE)
  INTO :v_rev, :v_marg, :v_units, :v_ros
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE BRAND_NAME = :P_BRAND AND CATEGORY = :v_category
    AND FISCAL_YEAR = :v_cy AND FISCAL_WEEK <= :v_max_wk;

  -- Same weeks last year, so growth is like-for-like.
  SELECT SUM(REVENUE) INTO :v_rev_py
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE BRAND_NAME = :P_BRAND AND CATEGORY = :v_category
    AND FISCAL_YEAR = :v_cy - 1 AND FISCAL_WEEK <= :v_max_wk;

  -- ---------- 3. Category benchmark ----------
  SELECT SUM(REVENUE), SUM(MARGIN), AVG(RATE_OF_SALE)
  INTO :v_cat_rev, :v_cat_marg, :v_cat_ros
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE CATEGORY = :v_category
    AND FISCAL_YEAR = :v_cy AND FISCAL_WEEK <= :v_max_wk;

  -- ---------- 4. Geography ----------
  SELECT STATE, SUM(REVENUE)
  INTO :v_top_state, :v_state_share
  FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE BRAND_NAME = :P_BRAND AND CATEGORY = :v_category
    AND FISCAL_YEAR = :v_cy AND FISCAL_WEEK <= :v_max_wk
  GROUP BY STATE
  ORDER BY SUM(REVENUE) DESC NULLS LAST
  LIMIT 1;

  -- ---------- 5. Supplier reliability ----------
  SELECT AVG(DIFOT_PCT), SUM(ORDERS_TOTAL) INTO :v_difot, :v_difot_orders
  FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
  WHERE BRAND_NAME = :P_BRAND AND FISCAL_YEAR = :v_cy;

  SELECT AVG(DIFOT_PCT) INTO :v_difot_cat
  FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
  WHERE CATEGORY = :v_category AND FISCAL_YEAR = :v_cy;

  -- ---------- 6. Brand switching, both directions ----------
  SELECT
    SUM(IFF(TO_BRAND = :P_BRAND, SWITCH_COUNT, 0)),
    SUM(IFF(FROM_BRAND = :P_BRAND, SWITCH_COUNT, 0))
  INTO :v_gained, :v_lost
  FROM BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
  WHERE TO_BRAND = :P_BRAND OR FROM_BRAND = :P_BRAND;

  SELECT FROM_BRAND INTO :v_top_source
  FROM BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
  WHERE TO_BRAND = :P_BRAND
  GROUP BY FROM_BRAND ORDER BY SUM(SWITCH_COUNT) DESC NULLS LAST LIMIT 1;

  SELECT TO_BRAND INTO :v_top_loss
  FROM BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
  WHERE FROM_BRAND = :P_BRAND
  GROUP BY TO_BRAND ORDER BY SUM(SWITCH_COUNT) DESC NULLS LAST LIMIT 1;

  -- ---------- 7. Price positioning ----------
  SELECT AVG(AVG_PRICE_GAP_PCT) INTO :v_gap
  FROM BABY_MART_DEMO.ANALYTICS.DT_COMPETITIVE_POSITION
  WHERE BRAND_NAME = :P_BRAND AND FISCAL_YEAR = :v_cy;

  -- ---------- 8. Best promotional mechanic ----------
  SELECT MECHANIC, SUM(PROMO_MARGIN),
         SUM(PROMO_MARGIN) / NULLIF(SUM(TOTAL_DISCOUNT), 0)
  INTO :v_mech, :v_pm_margin, :v_roi
  FROM BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
  WHERE BRAND_NAME = :P_BRAND
  GROUP BY MECHANIC
  ORDER BY SUM(PROMO_MARGIN) DESC NULLS LAST
  LIMIT 1;

  -- ---------- 9. Customer value ----------
  SELECT AVG(AVG_CLV), AVG(AVG_TRANSACTIONS), SUM(CUSTOMER_COUNT)
  INTO :v_clv, :v_txn, :v_customers
  FROM BABY_MART_DEMO.ANALYTICS.DT_CLV_BY_BRAND
  WHERE BRAND_NAME = :P_BRAND;

  -- ---------- 10. Range concentration ----------
  SELECT LISTAGG(CLASS || ' ' || ROUND(PCT, 0) || '%', ', ')
           WITHIN GROUP (ORDER BY PCT DESC)
  INTO :v_classes
  FROM (
    SELECT CLASS, SUM(REVENUE) / NULLIF(:v_rev, 0) * 100 AS PCT
    FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
    WHERE BRAND_NAME = :P_BRAND AND CATEGORY = :v_category
      AND FISCAL_YEAR = :v_cy AND FISCAL_WEEK <= :v_max_wk
    GROUP BY CLASS
    ORDER BY SUM(REVENUE) DESC NULLS LAST
    LIMIT 4
  );

  -- ---------- 11. Assemble the metric pack ----------
  v_metrics := TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL(
    'brand',                 :P_BRAND,
    'category',              :v_category,
    'fiscal_year',           :v_cy,
    'weeks_elapsed',         :v_max_wk,
    'revenue_aud',           ROUND(:v_rev, 0),
    'margin_aud',            ROUND(:v_marg, 0),
    'margin_pct',            ROUND(IFF(:v_rev > 0, :v_marg / :v_rev * 100, NULL), 1),
    'units_sold',            ROUND(:v_units, 0),
    'rate_of_sale',          ROUND(:v_ros, 1),
    'revenue_prior_year',    ROUND(:v_rev_py, 0),
    'revenue_growth_pct',    ROUND(IFF(:v_rev_py > 0, (:v_rev - :v_rev_py) / :v_rev_py * 100, NULL), 1),
    'category_revenue_aud',  ROUND(:v_cat_rev, 0),
    'revenue_share_pct',     ROUND(IFF(:v_cat_rev > 0, :v_rev / :v_cat_rev * 100, NULL), 1),
    'margin_pct_category',   ROUND(IFF(:v_cat_rev > 0, :v_cat_marg / :v_cat_rev * 100, NULL), 1),
    -- Gaps are precomputed so the model never has to derive them. Left to itself
    -- it misattributes, e.g. quoting total margin as the value of a 1.2pp gap.
    'margin_gap_pp',         ROUND(IFF(:v_rev > 0 AND :v_cat_rev > 0,
                               (:v_marg / :v_rev - :v_cat_marg / :v_cat_rev) * 100, NULL), 1),
    'margin_gap_aud',        ROUND(IFF(:v_rev > 0 AND :v_cat_rev > 0,
                               (:v_marg / :v_rev - :v_cat_marg / :v_cat_rev) * :v_rev, NULL), 0),
    'difot_gap_pp',          ROUND(:v_difot - :v_difot_cat, 1),
    'rate_of_sale_category', ROUND(:v_cat_ros, 1),
    'top_state',             :v_top_state,
    'top_state_share_pct',   ROUND(IFF(:v_rev > 0, :v_state_share / :v_rev * 100, NULL), 1),
    'difot_pct',             ROUND(:v_difot, 1),
    'difot_orders',          ROUND(:v_difot_orders, 0),
    'difot_pct_category',    ROUND(:v_difot_cat, 1),
    'switch_gained',         ROUND(:v_gained, 0),
    'switch_lost',           ROUND(:v_lost, 0),
    'switch_net',            ROUND(:v_gained - :v_lost, 0),
    'switch_top_source',     :v_top_source,
    'switch_top_loss_to',    :v_top_loss,
    'price_gap_pct',         ROUND(:v_gap, 1),
    'promo_best_mechanic',   :v_mech,
    'promo_margin_aud',      ROUND(:v_pm_margin, 0),
    'promo_roi',             ROUND(:v_roi, 2),
    'avg_clv_aud',           ROUND(:v_clv, 0),
    'avg_transactions',      ROUND(:v_txn, 1),
    'customer_count',        ROUND(:v_customers, 0),
    'top_classes',           :v_classes
  ));

  -- ---------- 12. Turn metrics into negotiation language ----------
  v_prompt :=
    'You are a retail category manager at Baby Mart, Australia''s largest baby retailer, '
    || 'preparing to negotiate supplier terms. Write a negotiation battlecard using ONLY '
    || 'the metrics in the JSON below.' || CHAR(10) || CHAR(10)
    || 'METRICS:' || CHAR(10) || :v_metrics || CHAR(10) || CHAR(10)
    || 'RULES:' || CHAR(10)
    || '- Every number you cite must come from the METRICS JSON. Never invent a figure.' || CHAR(10)
    || '- Copy numeric values VERBATIM from METRICS. Never recompute, re-derive or '
    || 're-round a number: if margin_pct is 37.6, write 37.6%, not 37.8%.' || CHAR(10)
    || '- Never restate a metric as something it is not. margin_aud is TOTAL margin, '
    || 'not the value of a gap; use margin_gap_aud and margin_gap_pp for gaps to the '
    || 'category benchmark, and difot_gap_pp for the DIFOT gap.' || CHAR(10)
    || '- If a metric is null, omit it entirely rather than guessing a replacement.' || CHAR(10)
    || '- Do NOT include arguments about shelf space productivity per linear metre, or raw '
    || 'material / commodity input costs. Baby Mart holds no data for either.' || CHAR(10)
    || '- Format currency as AUD with thousands separators. Percentages to 1 decimal place.' || CHAR(10)
    || '- impact is an integer 1-5 reflecting how much negotiating leverage the point gives.' || CHAR(10)
    || '- Group arguments as: profitability (margin, range concentration, customer value), '
    || 'growth (revenue trend, category share), others (pricing, supplier reliability, '
    || 'promotional ROI).' || CHAR(10)
    || '- 3 items in profitability, 2 in growth, 3 in others. Keep every string under '
    || '200 characters.' || CHAR(10) || CHAR(10)
    || 'Return ONLY valid JSON with no markdown fences, matching exactly:' || CHAR(10)
    || '{"key_arguments":{"profitability":[{"name":"","description":"","data":"","argument":"","ask":"","impact":3}],'
    || '"growth":[],"others":[]},'
    || '"incentives":[],"pressures":[],'
    || '"negotiation_approach":"","total_addressable":"",'
    || '"sellthrough":[],"switching":[],"summary":[]}' || CHAR(10)
    || 'sellthrough, switching and summary are each an ARRAY of exactly 3 short strings.' || CHAR(10)
    || 'CRITICAL: never place a literal newline or control character inside any JSON '
    || 'string value. Keep every string on one line.';

  -- The options form is required to raise max_tokens: the default cap truncates
  -- a card this size mid-JSON. temperature 0 keeps demo runs reproducible.
  -- With options, COMPLETE returns an object rather than a string.
  v_raw := SNOWFLAKE.CORTEX.COMPLETE(
    'claude-opus-4-7',
    [{'role': 'user', 'content': :v_prompt}],
    {'max_tokens': 16384, 'temperature': 0}
  ):choices[0]:messages::STRING;

  -- Strip markdown fences if the model added them anyway, then scrub control
  -- characters. Occasionally the model emits a literal newline inside a JSON
  -- string value, which is invalid JSON and made parsing fail intermittently.
  -- JSON needs no control characters, so replacing them with spaces is safe
  -- whether they were structural or inside a string.
  v_card := TRY_PARSE_JSON(
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(:v_raw, '^\\s*```[a-zA-Z]*|```\\s*$', ''),
      '[\\x00-\\x1F]', ' '))
  );

  -- The app renders sellthrough/switching/summary as newline-separated text, but
  -- asking the model for embedded newlines produces invalid JSON (unescaped
  -- control characters). It returns arrays instead; join them here.
  IF (v_card IS NOT NULL) THEN
    v_card := OBJECT_INSERT(:v_card, 'sellthrough',
      IFF(TYPEOF(:v_card:sellthrough) = 'ARRAY',
          ARRAY_TO_STRING(:v_card:sellthrough, CHAR(10)),
          :v_card:sellthrough::STRING), TRUE);
    v_card := OBJECT_INSERT(:v_card, 'switching',
      IFF(TYPEOF(:v_card:switching) = 'ARRAY',
          ARRAY_TO_STRING(:v_card:switching, CHAR(10)),
          :v_card:switching::STRING), TRUE);
    v_card := OBJECT_INSERT(:v_card, 'summary',
      IFF(TYPEOF(:v_card:summary) = 'ARRAY',
          ARRAY_TO_STRING(:v_card:summary, CHAR(10)),
          :v_card:summary::STRING), TRUE);
  END IF;

  -- ---------- 13. Return card plus the metrics used, for traceability ----------
  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'brand',    :P_BRAND,
    'category', :v_category,
    'metrics',  TRY_PARSE_JSON(:v_metrics),
    'card',     :v_card,
    'card_raw', IFF(:v_card IS NULL, :v_raw, NULL)
  )::STRING;
END
$$;
