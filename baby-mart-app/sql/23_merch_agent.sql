-- ============================================================
-- Baby Mart Global Planning — Merch planning agent
--
-- A SECOND agent, separate from the Baby Mart CATEGORY_MANAGER_AGENT, because the
-- two answer questions about different businesses over different data. Sharing
-- one agent would mean a merchandise planner's question could be answered from
-- baby-goods sell-through, which is worse than having no agent.
--
--   MERCH_PLANNING_VIEW    semantic view for text-to-SQL over the plan
--   MERCH_OPTION_SEARCH    Cortex Search over the option range
--   MERCH_PLANNING_AGENT   created in agent/deploy_merch_agent.sql
--
-- WHY A SEMANTIC VIEW AND NOT JUST THE INSIGHTS PROCEDURE
--
-- The question this has to answer is "what are the drivers of PRAMS & STROLLERS
-- being down 10.7%". That is a decomposition: the department's variance has to be
-- broken into its classes and ranked. GENERATE_PLANNING_INSIGHTS returns a
-- prepared narrative for a node, but it cannot answer an arbitrary follow-up like
-- "and which of those is worst on margin rate rather than sales". Text-to-SQL over
-- the hierarchy can.
--
-- THE MEASURE DEFINITIONS ARE THE WHOLE GAME
--
-- Every ratio here is defined so Cortex Analyst CANNOT average it up a hierarchy.
-- Margin rate is exposed only as the additive pair (margin dollars, sales
-- dollars) plus a ratio measure the model is told to compute as
-- SUM(margin)/SUM(sales). If margin % were exposed as a plain avg-aggregated
-- column, a question about a department would return the mean of its classes'
-- percentages -- which is wrong whenever the classes differ in size, i.e. always,
-- and wrong in a way that reads perfectly plausible.
--
-- KNOWN TRAP: yaml-defined measures live in the view's EXTENSION CA payload, so
-- DESCRIBE SEMANTIC VIEW shows only dimensions and GET_DDL silently drops the
-- measures. This file is the source of truth; do not reconstruct it from the
-- deployed object.
--
-- SECOND TRAP, for anyone deploying to a remapped namespace: the YAML addresses
-- its base tables with SEPARATE `database:` and `schema:` keys, not the dotted
-- BABY_MART_DEMO.ANALYTICS form the rest of these scripts use. A namespace rewrite
-- that only substitutes the dotted form leaves these two lines pointing at a
-- database that does not exist there, and the failure surfaces as a bare
-- EXPRESSION_ERROR with a line number into generated SQL rather than as anything
-- resembling "wrong database". Rewrite both forms.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Flattened read model for the semantic view ----------
-- Cortex Analyst works far better over a wide, pre-joined table than over the
-- long metric/version fact, which would require the model to filter METRIC and
-- VERSION correctly on every single question. Pivoting the versions into columns
-- turns "forecast versus budget" from a self-join into a subtraction.
CREATE OR REPLACE VIEW BABY_MART_DEMO.ANALYTICS.VW_MERCH_PLAN_FLAT AS
SELECT
    m.RBU,
    m.DEPARTMENT,
    m.CLASS,
    m.PLAN_LEVEL,
    m.LFL_STRATEGY,
    -- Spelled out because "D" is meaningless to a model reading it cold, and the
    -- distinction changes whether a decline is a problem.
    IFF(m.LFL_STRATEGY = 'G', 'Grow', 'Planned decline')     AS STRATEGY_LABEL,
    m.SLS_LY_PHP, m.SLS_BUD_PHP, m.SLS_FC_PHP,
    m.VAR_TO_BUD_PHP, m.VAR_TO_BUD_PCT,
    m.LFL_GROWTH_PCT,
    m.UNITS_FC,
    m.ASP_FC_PHP        AS ASP_FC,
    m.GP_FC_PHP, m.GP_PCT_FC, m.GP_PCT_BUD, m.GP_GAP_PP,
    m.OPT_TOTAL_FC      AS OPT_TOTAL,
    m.OPT_NEW_FC        AS OPT_NEW,
    o.STOCK_PHP, o.ON_ORDER_PHP,
    o.FORWARD_COVER_WEEKS, o.TOTAL_COVER_WEEKS, o.TARGET_COVER_WEEKS,
    o.OTB_AVAILABLE_PHP, o.BUY_STATUS
FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY m
LEFT JOIN BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY o
       ON  o.PLAN_LEVEL = m.PLAN_LEVEL
      AND  EQUAL_NULL(o.DEPARTMENT, m.DEPARTMENT)
      AND  EQUAL_NULL(o.CLASS, m.CLASS);

-- ---------- 2. Semantic view ----------
CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
  'BABY_MART_DEMO.ANALYTICS',
  $$
name: MERCH_PLANNING_VIEW
description: >
  Baby Mart merchandise financial plan and open-to-buy position for fiscal year
  F27, across the RBU to DEPARTMENT to CLASS hierarchy. Use this to answer
  questions about sales versus budget, margin rate, like-for-like growth, stock
  cover, buy position and option (SKU) productivity.
  CRITICAL RULES: (1) Never average a percentage across rows. Margin rate for any
  group is SUM(gp_forecast) / SUM(sales_forecast); like-for-like and variance
  percentages must be rebuilt the same way from their dollar components.
  (2) PLAN_LEVEL separates the hierarchy levels and the levels are PRE-ROLLED, so
  always filter to exactly one plan_level or figures will be double counted.
  (3) A class with strategy 'Planned decline' is MEANT to shrink, so a negative
  like-for-like there is on-strategy and should be judged against budget.
  (4) Amounts are Philippine pesos.
tables:
  - name: MERCH_PLAN
    description: >
      Merchandise plan and buy position, one row per hierarchy node. Filter
      plan_level to RBU, DEPARTMENT or CLASS — never mix them in one total.
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: VW_MERCH_PLAN_FLAT
    dimensions:
      - name: rbu
        expr: RBU
        description: Retail business unit, the top of the hierarchy
      - name: department
        expr: DEPARTMENT
        description: Department name, e.g. PRAMS & STROLLERS, CAR SEATS, NAPPIES & WIPES
      - name: class
        expr: CLASS
        description: Class name, the lowest planning level, e.g. TRAVEL SYSTEM, CRAWLER NAPPIES, BOTTLES
      - name: plan_level
        expr: PLAN_LEVEL
        description: >
          Which hierarchy level this row is. One of RBU, DEPARTMENT, CLASS.
          ALWAYS filter to a single value; the levels are pre-rolled totals.
      - name: strategy
        expr: STRATEGY_LABEL
        description: >
          Like-for-like strategy. 'Grow' means growth is planned; 'Planned decline'
          means the class is being deliberately wound back, so a sales fall there
          is intentional rather than a risk.
      - name: buy_status
        expr: BUY_STATUS
        description: >
          OVERBUY, BALANCED or UNDERBUY, derived from cover including on-order
          stock against the class target cover.
    measures:
      - name: sales_forecast
        expr: SLS_FC_PHP
        description: Forecast sales in PHP. The current view of the year.
        default_aggregation: sum
      - name: sales_budget
        expr: SLS_BUD_PHP
        description: Signed-off budget sales in PHP
        default_aggregation: sum
      - name: sales_last_year
        expr: SLS_LY_PHP
        description: Last year actual sales in PHP
        default_aggregation: sum
      - name: variance_to_budget
        expr: VAR_TO_BUD_PHP
        description: >
          Forecast sales minus budget sales in PHP. Negative is a shortfall. This
          is additive, so sum it to get a department or RBU shortfall.
        default_aggregation: sum
      - name: variance_to_budget_pct
        expr: VAR_TO_BUD_PCT
        description: >
          Forecast against budget as a percentage. DO NOT AVERAGE THIS across
          rows. For a group, compute 100 * SUM(variance_to_budget) /
          SUM(sales_budget) instead.
        default_aggregation: avg
      - name: lfl_growth_pct
        expr: LFL_GROWTH_PCT
        description: >
          Like-for-like growth percentage against last year. DO NOT AVERAGE. For a
          group compute 100 * (SUM(sales_forecast) - SUM(sales_last_year)) /
          SUM(sales_last_year).
        default_aggregation: avg
      - name: units_forecast
        expr: UNITS_FC
        description: Forecast unit sales
        default_aggregation: sum
      - name: asp_forecast
        expr: ASP_FC
        description: >
          Average selling price in PHP. DO NOT AVERAGE across rows; compute
          SUM(sales_forecast) / SUM(units_forecast).
        default_aggregation: avg
      - name: gp_forecast
        expr: GP_FC_PHP
        description: Forecast gross profit in PHP. Additive.
        default_aggregation: sum
      - name: gp_pct_forecast
        expr: GP_PCT_FC
        description: >
          Forecast POS gross margin RATE as a percentage. DO NOT AVERAGE across
          rows — that is the single most common error on this data. For any group
          compute 100 * SUM(gp_forecast) / SUM(sales_forecast).
        default_aggregation: avg
      - name: gp_gap_pp
        expr: GP_GAP_PP
        description: >
          Forecast margin rate minus budget margin rate, in PERCENTAGE POINTS.
          Negative means margin erosion. Do not average across rows.
        default_aggregation: avg
      - name: option_count
        expr: OPT_TOTAL
        description: >
          Number of ranged options (SKUs). A POINT-IN-TIME count, so it is summed
          across hierarchy nodes but never across time periods.
        default_aggregation: sum
      - name: new_option_count
        expr: OPT_NEW
        description: Options newly ranged this year
        default_aggregation: sum
      - name: stock_value
        expr: STOCK_PHP
        description: Closing stock at the end of the plan horizon, in PHP
        default_aggregation: sum
      - name: on_order_value
        expr: ON_ORDER_PHP
        description: Stock already on order but not yet received, in PHP
        default_aggregation: sum
      - name: stock_cover_weeks
        expr: FORWARD_COVER_WEEKS
        description: >
          Weeks of stock held, excluding anything on order. Stock divided by
          average weekly forecast sales. Do not average across rows; rebuild as
          SUM(stock_value) / (SUM(sales_forecast) / 26).
        default_aggregation: avg
      - name: total_cover_weeks
        expr: TOTAL_COVER_WEEKS
        description: >
          Weeks of cover INCLUDING on-order stock. This is the figure buy_status
          is judged on, so quote this one when explaining an OVERBUY or UNDERBUY
          flag. Do not average across rows.
        default_aggregation: avg
      - name: target_cover_weeks
        expr: TARGET_COVER_WEEKS
        description: Weeks of stock the plan intends to hold for this node
        default_aggregation: avg
      - name: open_to_buy
        expr: OTB_AVAILABLE_PHP
        description: >
          Budget remaining to spend on stock, in PHP. Negative means already
          overcommitted. Additive.
        default_aggregation: sum
  - name: PLAN_OPTIONS
    description: >
      Option (SKU) level productivity within a class, split by half. Use for
      questions about which specific SKUs are performing, and for range
      rationalisation. HALF is 'H1' (Jan-Jun 2027) or 'H2' (Jul-Dec 2026).
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: VW_OPTION_PRODUCTIVITY
    dimensions:
      - name: option_code
        expr: OPTION_CODE
        description: Option (SKU) code
      - name: option_description
        expr: OPTION_DESC
        description: Option name and colourway
      - name: option_class
        expr: CLASS
        description: Class the option sits in
      - name: option_department
        expr: DEPARTMENT
        description: Department the option sits in
      - name: option_status
        expr: OPTION_STATUS
        description: ONGOING, NEW or DESELECTED
      - name: supplier
        expr: SUPPLIER_NAME
        description: Supplier of this option
      - name: half
        expr: HALF
        description: H1 or H2. ALWAYS filter to one half; the two are separate periods.
      - name: productivity_decile
        expr: PRODUCTIVITY_DECILE
        description: >
          1 is the WORST performing tenth of the class range, 10 the best. Ranked
          on gross profit per option per trading week within the class.
    measures:
      - name: option_sales
        expr: SLS_PHP
        description: Option sales in PHP for the half
        default_aggregation: sum
      - name: option_gp
        expr: POS_GP_AMT
        description: Option gross profit in PHP for the half
        default_aggregation: sum
      - name: option_units
        expr: SLS_UNITS
        description: Option units sold in the half
        default_aggregation: sum
      - name: gp_per_option_week
        expr: GP_PER_OPTION_WEEK
        description: >
          Gross profit earned per option per trading week. THE productivity
          measure for a range review — rank on this, not on sales, because
          ranking on sales nominates high-turn low-margin lines for deletion.
        default_aggregation: avg
      - name: rate_of_sale
        expr: RATE_OF_SALE
        description: Units sold per trading week
        default_aggregation: avg
      - name: option_cover_weeks
        expr: COVER_WEEKS
        description: Weeks of cover this option is carrying
        default_aggregation: avg
      - name: sell_through_pct
        expr: SELL_THROUGH_PCT
        description: Units sold as a percentage of units sold plus stock. Do not average across rows.
        default_aggregation: avg
      - name: option_stock
        expr: STOCK_PHP
        description: Average stock held on this option in PHP
        default_aggregation: sum
# verified_queries are deliberately absent. Cortex Analyst validates them as real
# SQL against the base tables, and the useful examples here are written against
# the LOGICAL table names (PLAN, OPTIONS), which do not exist as objects. Rather
# than restate each one twice and let the two drift, the guidance lives in the
# table and measure descriptions above — particularly the repeated instruction
# never to average a percentage, which is the error this data is most prone to.
$$
);

-- ---------- 3. Option range search ----------
-- So the agent can find a SKU by description rather than only by code. Kept to
-- the option range specifically: a search service over the whole plan would
-- compete with the semantic view for numeric questions and answer them worse.
CREATE OR REPLACE CORTEX SEARCH SERVICE BABY_MART_DEMO.ANALYTICS.MERCH_OPTION_SEARCH
    ON SEARCH_TEXT
    ATTRIBUTES OPTION_CODE, CLASS, DEPARTMENT, OPTION_STATUS, SUPPLIER_NAME
    WAREHOUSE = DEMO_ANALYTICS_WH
    TARGET_LAG = '24 hours'
AS
SELECT
    o.OPTION_CODE || ' ' || o.OPTION_DESC || ' — ' || o.CLASS || ', ' || o.DEPARTMENT
        || ', supplied by ' || o.SUPPLIER_NAME || ' from ' || o.COUNTRY_OF_ORIGIN
        || ', status ' || o.OPTION_STATUS                            AS SEARCH_TEXT,
    o.OPTION_CODE, o.CLASS, o.DEPARTMENT, o.OPTION_STATUS, o.SUPPLIER_NAME
FROM BABY_MART_DEMO.ANALYTICS.DIM_PLAN_OPTION o;
