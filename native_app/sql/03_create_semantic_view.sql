-- ============================================================
-- Step 3: Create Semantic View in the package
-- This powers the Cortex Agent's natural language queries.
-- Change base_table references for each supplier package.
-- ============================================================

USE ROLE ACCOUNTADMIN;

CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
  'SUPPLIER_PORTAL_BUGABOO_PACKAGE.SHARED_DATA',
  $$
name: SUPPLIER_PERFORMANCE_VIEW
tables:
  - name: SELLTHROUGH
    base_table:
      database: SUPPLIER_PORTAL_BUGABOO_PACKAGE
      schema: SHARED_DATA
      table: VW_SUPPLIER_SELLTHROUGH
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
      - name: region
        expr: REGION
        description: Region type
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
  - name: SEGMENTS
    base_table:
      database: SUPPLIER_PORTAL_BUGABOO_PACKAGE
      schema: SHARED_DATA
      table: VW_SUPPLIER_SEGMENTS
    dimensions:
      - name: supplier_name
        expr: SUPPLIER_NAME
        description: Supplier name
      - name: brand_name
        expr: BRAND_NAME
        description: Brand name
      - name: segment_name
        expr: SEGMENT_NAME
        description: Customer segment
      - name: fiscal_year
        expr: FISCAL_YEAR
        description: Fiscal year
    measures:
      - name: customer_count
        expr: CUSTOMER_COUNT
        description: Customers in segment
        default_aggregation: sum
      - name: segment_revenue
        expr: REVENUE
        description: Revenue from segment
        default_aggregation: sum
  - name: SWITCHING
    base_table:
      database: SUPPLIER_PORTAL_BUGABOO_PACKAGE
      schema: SHARED_DATA
      table: VW_SUPPLIER_SWITCHING
    dimensions:
      - name: category
        expr: CATEGORY
        description: Product category
      - name: from_brand
        expr: FROM_BRAND
        description: Brand switched from
      - name: to_brand
        expr: TO_BRAND
        description: Brand switched to
    measures:
      - name: switch_count
        expr: SWITCH_COUNT
        description: Number of switches
        default_aggregation: sum
      - name: switching_customers
        expr: CUSTOMER_COUNT
        description: Distinct customers who switched
        default_aggregation: sum
verified_queries:
  - question: "How am I performing this week vs last week?"
    sql: |
      SELECT fiscal_week, SUM(units_sold) as units, SUM(revenue) as revenue
      FROM SUPPLIER_PORTAL_BUGABOO_PACKAGE.SHARED_DATA.VW_SUPPLIER_SELLTHROUGH
      WHERE fiscal_year = 2026
      ORDER BY fiscal_week DESC LIMIT 2
  - question: "Which states are performing best?"
    sql: |
      SELECT state, SUM(units_sold) as units, SUM(revenue) as revenue
      FROM SUPPLIER_PORTAL_BUGABOO_PACKAGE.SHARED_DATA.VW_SUPPLIER_SELLTHROUGH
      WHERE fiscal_year = 2026
      GROUP BY state ORDER BY revenue DESC
  - question: "Which brands are customers switching to from us?"
    sql: |
      SELECT to_brand, SUM(switch_count) as switches
      FROM SUPPLIER_PORTAL_BUGABOO_PACKAGE.SHARED_DATA.VW_SUPPLIER_SWITCHING
      GROUP BY to_brand ORDER BY switches DESC
  - question: "What does our customer segment breakdown look like?"
    sql: |
      SELECT segment_name, SUM(customer_count) as customers, SUM(revenue) as revenue
      FROM SUPPLIER_PORTAL_BUGABOO_PACKAGE.SHARED_DATA.VW_SUPPLIER_SEGMENTS
      WHERE fiscal_year = 2026
      GROUP BY segment_name ORDER BY revenue DESC
$$,
  FALSE
);
