-- ============================================================
-- Baby Mart Supplier Collaboration Platform
-- 05_create_agent.sql
-- Creates the Category Manager Cortex Agent (retailer-internal)
-- Uses the semantic view for text-to-SQL
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA ANALYTICS;
USE WAREHOUSE DEMO_AI_WH;

-- Create DIFOT (Delivered In Full On Time) table
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT (
  BRAND_NAME VARCHAR(100),
  CATEGORY VARCHAR(50),
  FISCAL_YEAR NUMBER,
  FISCAL_WEEK NUMBER,
  DIFOT_PCT FLOAT COMMENT 'Delivered In Full On Time percentage',
  ORDERS_TOTAL NUMBER COMMENT 'Total orders placed',
  ORDERS_ON_TIME NUMBER COMMENT 'Orders delivered in full on time'
);

-- Populate DIFOT if empty
INSERT INTO BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
SELECT * FROM (
  WITH brands AS (
    SELECT DISTINCT BRAND_NAME, CATEGORY FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  ),
  weeks AS (
    SELECT DISTINCT FISCAL_YEAR, FISCAL_WEEK FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  ),
  base_rates AS (
    SELECT BRAND_NAME,
      CASE BRAND_NAME
        WHEN 'Huggies' THEN 94.2 WHEN 'Bugaboo' THEN 87.1 WHEN 'Uppababy' THEN 91.8
        WHEN 'Rascal + Friends' THEN 96.4 WHEN 'Maxi-Cosi' THEN 92.6 WHEN 'Pampers' THEN 93.8
        WHEN 'Cybex' THEN 90.4 WHEN 'Bonds Baby' THEN 97.1 WHEN 'Dr Browns' THEN 95.2
        WHEN 'Infasecure' THEN 82.3 WHEN 'Silver Cross' THEN 88.6 WHEN 'Babyzen' THEN 89.2
        WHEN 'Mountain Buggy' THEN 86.4 WHEN 'Purebaby' THEN 94.8 WHEN 'Tooshies' THEN 95.6
        WHEN 'ECO by Naty' THEN 91.2 WHEN 'Cotton On Baby' THEN 96.8 WHEN 'Marquise' THEN 93.4
        WHEN 'Bebe' THEN 84.2 WHEN 'Britax' THEN 93.1 WHEN 'Nuna' THEN 90.8
        WHEN 'Avent' THEN 95.4 WHEN 'Tommee Tippee' THEN 94.6 WHEN 'Pigeon' THEN 92.8
        WHEN 'NUK' THEN 88.4 ELSE 90.0
      END AS base_difot
    FROM brands
  )
  SELECT
    b.BRAND_NAME, b.CATEGORY, w.FISCAL_YEAR, w.FISCAL_WEEK,
    ROUND(br.base_difot + (UNIFORM(-3.0, 3.0, RANDOM())), 1) AS DIFOT_PCT,
    ROUND(UNIFORM(20, 200, RANDOM())) AS ORDERS_TOTAL,
    NULL AS ORDERS_ON_TIME
  FROM brands b CROSS JOIN weeks w JOIN base_rates br ON br.BRAND_NAME = b.BRAND_NAME
) WHERE NOT EXISTS (SELECT 1 FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT LIMIT 1);

UPDATE BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
SET ORDERS_ON_TIME = ROUND(ORDERS_TOTAL * DIFOT_PCT / 100)
WHERE ORDERS_ON_TIME IS NULL;

-- Create the semantic view
USE SCHEMA AI;
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
      - name: state
        expr: STATE
        description: Australian state
      - name: fiscal_week
        expr: FISCAL_WEEK
        description: Fiscal week number
      - name: fiscal_year
        expr: FISCAL_YEAR
        description: Fiscal year
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

-- Create the Category Manager Agent using the semantic view
CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT
FROM SPECIFICATION $$
{
  "models": {
    "orchestration": "auto"
  },
  "instructions": {
    "orchestration": "You are a senior category analytics advisor for Baby Mart. Provide data-driven insights for supplier negotiations. Always include specific numbers.",
    "response": "Use bullet points. Lead with the strongest negotiation lever. End with a recommended action."
  },
  "tools": [
    {
      "tool_spec": {
        "type": "cortex_analyst_text_to_sql",
        "name": "query_category_data",
        "description": "Query category performance data including sell-through, CLV, brand switching, promotions, competitive pricing, customer segments, and DIFOT (Delivered In Full On Time) supply chain metrics."
      }
    }
  ],
  "tool_resources": {
    "query_category_data": {
      "execution_environment": {
        "type": "warehouse",
        "warehouse": "DEMO_AI_WH"
      },
      "semantic_view": "BABY_MART_DEMO.ANALYTICS.CATEGORY_INTELLIGENCE_VIEW"
    }
  }
}
$$;
