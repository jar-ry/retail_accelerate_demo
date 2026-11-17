-- ============================================================
-- Category Manager — CATEGORY_INTELLIGENCE_VIEW, widened
--
-- The semantic view behind CATEGORY_MANAGER_AGENT. Until now its only definition
-- was retailer/sql/05_create_agent.sql, and it could not slice sell-through below
-- brand x state: no class, store, region or month, so "how did Huggies Crawler
-- Nappies sell in Metro stores?" was unanswerable. This adds those dimensions, a
-- class on DIFOT and switching, product on competitor prices, quarter on segments,
-- and margin % as total margin over total revenue (never an average of rows).
--
-- Created from YAML because GET_DDL omits the facts and metrics (see sql/07).
-- The brand investigator (sql/26) answers "what drove the move?"; this view
-- answers the ad-hoc follow-ups in the category agent's chat.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
  'BABY_MART_DEMO.ANALYTICS',
  $$
name: CATEGORY_INTELLIGENCE_VIEW
tables:
  - name: SELLTHROUGH
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_SELLTHROUGH_WEEKLY
    dimensions:
      - name: supplier_name
        expr: SUPPLIER_NAME
        description: Supplier company name
      - name: brand_name
        expr: BRAND_NAME
        description: Product brand name
      - name: category
        expr: CATEGORY
        description: Product category
      - name: class
        expr: CLASS
        description: Product class within the category, e.g. Crawler Nappies, Capsule Stroller, Bottles
      - name: state
        expr: STATE
        description: Australian state
      - name: region
        expr: REGION
        description: Store region (Metro, Regional, CBD)
      - name: store_name
        expr: STORE_NAME
        description: Store name
      - name: fiscal_week
        expr: FISCAL_WEEK
        description: Week number within the calendar year (1-52, ISO-style), carried with the fiscal year. FY2026 runs 1 Jul 2025 - 30 Jun 2026, so FY2026 weeks 27-52 are Jul-Dec 2025 and weeks 1-26 are Jan-Jun 2026.
      - name: fiscal_month
        expr: FISCAL_MONTH
        description: Fiscal month number
      - name: fiscal_quarter
        expr: FISCAL_QUARTER
        description: Fiscal quarter number
      - name: fiscal_year
        expr: FISCAL_YEAR
        description: Fiscal year (July to June; FY2026 = Jul 2025 - Jun 2026)
    measures:
      - name: units_sold
        expr: UNITS_SOLD
        description: Total units sold
        default_aggregation: sum
      - name: revenue
        expr: REVENUE
        description: Net revenue in AUD
        default_aggregation: sum
      - name: margin
        expr: MARGIN
        description: Margin in AUD
        default_aggregation: sum
      - name: rate_of_sale
        expr: RATE_OF_SALE
        description: Units per store per week
        default_aggregation: avg
    metrics:
      - name: margin_pct
        expr: SUM(MARGIN) / NULLIF(SUM(REVENUE), 0) * 100
        description: Gross margin %, total margin over total revenue. Never average line or row margins.
      - name: average_selling_price
        expr: SUM(REVENUE) / NULLIF(SUM(UNITS_SOLD), 0)
        description: Average selling price in AUD, total revenue over total units
  - name: CLV
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_CLV_BY_BRAND
    dimensions:
      - name: category
        expr: CATEGORY
      - name: brand_name
        expr: BRAND_NAME
    measures:
      - name: avg_clv
        expr: AVG_CLV
        description: Average customer lifetime value
        default_aggregation: avg
      - name: customer_count
        expr: CUSTOMER_COUNT
        default_aggregation: sum
  - name: SWITCHING
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_BRAND_SWITCHING
    dimensions:
      - name: category
        expr: CATEGORY
      - name: class
        expr: CLASS
        description: Product class the switch happened in
      - name: from_brand
        expr: FROM_BRAND
      - name: to_brand
        expr: TO_BRAND
    measures:
      - name: switch_count
        expr: SWITCH_COUNT
        default_aggregation: sum
  - name: PROMOTIONS
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_PROMOTIONAL_EFFECTIVENESS
    dimensions:
      - name: mechanic
        expr: MECHANIC
      - name: brand_name
        expr: BRAND_NAME
      - name: category
        expr: CATEGORY
    measures:
      - name: promo_units
        expr: PROMO_UNITS
        default_aggregation: sum
      - name: promo_revenue
        expr: PROMO_REVENUE
        default_aggregation: sum
      - name: total_discount
        expr: TOTAL_DISCOUNT
        default_aggregation: sum
      - name: promo_margin
        expr: PROMO_MARGIN
        default_aggregation: sum
  - name: COMPETITIVE
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_COMPETITIVE_POSITION
    dimensions:
      - name: brand_name
        expr: BRAND_NAME
      - name: product_name
        expr: PRODUCT_NAME
      - name: category
        expr: CATEGORY
      - name: competitor_name
        expr: COMPETITOR_NAME
      - name: fiscal_week
        expr: FISCAL_WEEK
      - name: fiscal_year
        expr: FISCAL_YEAR
    measures:
      - name: avg_competitor_price
        expr: AVG_COMPETITOR_PRICE
        default_aggregation: avg
      - name: avg_our_price
        expr: AVG_OUR_PRICE
        default_aggregation: avg
      - name: price_gap_pct
        expr: AVG_PRICE_GAP_PCT
        default_aggregation: avg
  - name: SEGMENTS
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_CUSTOMER_SEGMENT_PERFORMANCE
    dimensions:
      - name: supplier_name
        expr: SUPPLIER_NAME
      - name: brand_name
        expr: BRAND_NAME
      - name: segment_name
        expr: SEGMENT_NAME
      - name: fiscal_year
        expr: FISCAL_YEAR
      - name: fiscal_quarter
        expr: FISCAL_QUARTER
    measures:
      - name: segment_customers
        expr: CUSTOMER_COUNT
        default_aggregation: sum
      - name: segment_revenue
        expr: REVENUE
        default_aggregation: sum
  - name: DIFOT
    base_table:
      database: BABY_MART_DEMO
      schema: ANALYTICS
      table: DT_SUPPLIER_DIFOT
    dimensions:
      - name: brand_name
        expr: BRAND_NAME
        description: Brand name
      - name: category
        expr: CATEGORY
        description: Product category
      - name: class
        expr: CLASS
        description: Product class. Class-level rows exist for FY2026 only; rows with no class are the brand total.
      - name: fiscal_year
        expr: FISCAL_YEAR
        description: Fiscal year
      - name: fiscal_week
        expr: FISCAL_WEEK
        description: Fiscal week
    measures:
      - name: difot_pct
        expr: DIFOT_PCT
        description: Delivered In Full On Time percentage
        default_aggregation: avg
      - name: orders_total
        expr: ORDERS_TOTAL
        description: Total orders placed
        default_aggregation: sum
      - name: orders_on_time
        expr: ORDERS_ON_TIME
        description: Orders delivered in full on time
        default_aggregation: sum
verified_queries:
  - question: "How did Huggies Crawler Nappies sell week by week this year?"
    sql: |
      SELECT fiscal_week, SUM(units_sold) AS units, SUM(revenue) AS revenue
      FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
      WHERE brand_name = 'Huggies' AND class = 'Crawler Nappies' AND fiscal_year = 2026 AND fiscal_week BETWEEN 1 AND 19
      GROUP BY fiscal_week ORDER BY fiscal_week
  - question: "What is Huggies' margin by class?"
    sql: |
      SELECT class, SUM(margin) / NULLIF(SUM(revenue), 0) * 100 AS margin_pct
      FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
      WHERE brand_name = 'Huggies' AND fiscal_year = 2026
      GROUP BY class ORDER BY margin_pct DESC
  - question: "What is the CLV for Huggies customers vs category average?"
    sql: |
      SELECT brand_name, AVG(avg_clv) as avg_customer_clv, SUM(customer_count) as customers
      FROM BABY_MART_DEMO.ANALYTICS.DT_CLV_BY_BRAND
      WHERE category = 'Nappies & Wipes'
      GROUP BY brand_name ORDER BY avg_customer_clv DESC
  - question: "Which promotion mechanics work best for Huggies?"
    sql: |
      SELECT mechanic, SUM(promo_revenue) as revenue, SUM(total_discount) as cost, SUM(promo_margin) as margin
      FROM BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
      WHERE brand_name = 'Huggies'
      GROUP BY mechanic ORDER BY margin DESC
  - question: "Top performing brands by revenue?"
    sql: |
      SELECT brand_name, category, SUM(revenue) as total_revenue
      FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
      WHERE fiscal_year = 2026
      GROUP BY brand_name, category ORDER BY total_revenue DESC LIMIT 10
  - question: "Which brands have the worst DIFOT?"
    sql: |
      SELECT brand_name, category, AVG(difot_pct) as avg_difot, SUM(orders_total) as total_orders
      FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
      WHERE fiscal_year = 2026
      GROUP BY brand_name, category ORDER BY avg_difot ASC LIMIT 10
$$,
  FALSE
);
