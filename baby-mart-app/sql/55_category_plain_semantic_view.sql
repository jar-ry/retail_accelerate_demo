-- ============================================================
-- Category Manager — the plain semantic view behind the "Ontology" compare page
--
-- SV_CATEGORY_MANAGER (sql/53) carries Baby Mart's business rules in its
-- comments and AI_SQL_GENERATION: like-for-like weeks, the 96% DIFOT target and
-- the 90% red flag, the 0-100 scale, the brand-total filter on DIFOT, weighted
-- ratios. That is the right place for them in production, but on /ontology it
-- hides what the ontology and Cortex Sense add, because the semantic view alone
-- already knows everything.
--
-- This view is what a semantic view built from the tables, with no business
-- knowledge, looks like: the same seven fact tables and the same joins through
-- brand and supplier, plain descriptions, and each column's own aggregate (a
-- stored percentage is averaged, as a generated model would). No rule, threshold,
-- period or caveat is written here. The three compare agents
-- (agent/deploy_ontology_compare_agents.sql) all query it, so the only thing
-- that differs between them is the context they bring: none, the Business
-- Ontology, or the Business Ontology plus Cortex Sense.
--
-- Not for anything but the compare page. Snowhouse only for now (see sql/54).
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER_PLAIN
  TABLES (
    brands AS BABY_MART_DEMO.CURATED.DIM_BRAND
      PRIMARY KEY (BRAND_KEY) UNIQUE (BRAND_NAME)
      COMMENT = 'Brands',
    suppliers AS BABY_MART_DEMO.CURATED.DIM_SUPPLIER
      PRIMARY KEY (SUPPLIER_KEY)
      COMMENT = 'Suppliers',
    sellthrough AS BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
      COMMENT = 'Weekly sell-through by brand, class and store',
    clv AS BABY_MART_DEMO.ANALYTICS.DT_CLV_BY_BRAND
      COMMENT = 'Customer lifetime value by brand and category',
    segments AS BABY_MART_DEMO.ANALYTICS.DT_CUSTOMER_SEGMENT_PERFORMANCE
      COMMENT = 'Customer segment performance by brand and quarter',
    switching AS BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
      COMMENT = 'Brand switching between brands within a class',
    promotions AS BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
      COMMENT = 'Promotion results by promotion and product',
    competitive AS BABY_MART_DEMO.ANALYTICS.DT_COMPETITIVE_POSITION
      COMMENT = 'Competitor prices by product and week',
    difot AS BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
      COMMENT = 'Supplier DIFOT by brand and week'
  )
  RELATIONSHIPS (
    brand_to_supplier AS brands (SUPPLIER_KEY) REFERENCES suppliers,
    sales_to_brand AS sellthrough (BRAND_NAME) REFERENCES brands (BRAND_NAME),
    clv_to_brand AS clv (BRAND_NAME) REFERENCES brands (BRAND_NAME),
    segments_to_brand AS segments (BRAND_NAME) REFERENCES brands (BRAND_NAME),
    switching_to_brand AS switching (FROM_BRAND) REFERENCES brands (BRAND_NAME),
    promotions_to_brand AS promotions (BRAND_NAME) REFERENCES brands (BRAND_NAME),
    competitive_to_brand AS competitive (BRAND_NAME) REFERENCES brands (BRAND_NAME),
    difot_to_brand AS difot (BRAND_NAME) REFERENCES brands (BRAND_NAME)
  )
  FACTS (
    sellthrough.units_fact AS UNITS_SOLD,
    sellthrough.revenue_fact AS REVENUE,
    sellthrough.margin_fact AS MARGIN,
    sellthrough.ros_fact AS RATE_OF_SALE,
    clv.avg_clv_fact AS AVG_CLV,
    clv.clv_customers_fact AS CUSTOMER_COUNT,
    segments.seg_customers_fact AS CUSTOMER_COUNT,
    segments.seg_revenue_fact AS REVENUE,
    switching.switch_fact AS SWITCH_COUNT,
    promotions.promo_units_fact AS PROMO_UNITS,
    promotions.promo_revenue_fact AS PROMO_REVENUE,
    promotions.discount_fact AS TOTAL_DISCOUNT,
    promotions.promo_margin_fact AS PROMO_MARGIN,
    competitive.comp_price_fact AS AVG_COMPETITOR_PRICE,
    competitive.our_price_fact AS AVG_OUR_PRICE,
    competitive.gap_fact AS AVG_PRICE_GAP_PCT,
    difot.difot_fact AS DIFOT_PCT,
    difot.orders_fact AS ORDERS_TOTAL,
    difot.on_time_fact AS ORDERS_ON_TIME,
    suppliers.lead_time_fact AS LEAD_TIME_DAYS
  )
  DIMENSIONS (
    brands.brand_name AS BRAND_NAME COMMENT = 'Brand name',
    brands.brand_origin AS BRAND_ORIGIN COMMENT = 'Brand origin',
    brands.price_tier AS PRICE_TIER COMMENT = 'Price tier',
    suppliers.supplier_name AS SUPPLIER_NAME COMMENT = 'Supplier name',
    suppliers.payment_terms AS PAYMENT_TERMS COMMENT = 'Payment terms',
    sellthrough.category AS CATEGORY COMMENT = 'Category',
    sellthrough.class AS CLASS COMMENT = 'Class',
    sellthrough.state AS STATE COMMENT = 'State',
    sellthrough.region AS REGION COMMENT = 'Region',
    sellthrough.store_name AS STORE_NAME COMMENT = 'Store name',
    sellthrough.fiscal_year AS FISCAL_YEAR COMMENT = 'Fiscal year',
    sellthrough.fiscal_week AS FISCAL_WEEK COMMENT = 'Fiscal week',
    sellthrough.fiscal_quarter AS FISCAL_QUARTER COMMENT = 'Fiscal quarter',
    clv.clv_category AS CATEGORY COMMENT = 'Category',
    segments.segment_name AS SEGMENT_NAME COMMENT = 'Customer segment',
    segments.seg_fiscal_year AS FISCAL_YEAR COMMENT = 'Fiscal year',
    segments.seg_fiscal_quarter AS FISCAL_QUARTER COMMENT = 'Fiscal quarter',
    switching.switch_category AS CATEGORY COMMENT = 'Category',
    switching.switch_class AS CLASS COMMENT = 'Class',
    switching.from_brand AS FROM_BRAND COMMENT = 'From brand',
    switching.to_brand AS TO_BRAND COMMENT = 'To brand',
    promotions.mechanic AS MECHANIC COMMENT = 'Promotion mechanic',
    promotions.promotion_name AS PROMOTION_NAME COMMENT = 'Promotion name',
    promotions.promo_category AS CATEGORY COMMENT = 'Category',
    competitive.competitor_name AS COMPETITOR_NAME COMMENT = 'Competitor',
    competitive.comp_category AS CATEGORY COMMENT = 'Category',
    competitive.comp_fiscal_year AS FISCAL_YEAR COMMENT = 'Fiscal year',
    difot.difot_category AS CATEGORY COMMENT = 'Category',
    difot.difot_class AS CLASS COMMENT = 'Class',
    difot.difot_fiscal_year AS FISCAL_YEAR COMMENT = 'Fiscal year',
    difot.difot_fiscal_week AS FISCAL_WEEK COMMENT = 'Fiscal week'
  )
  METRICS (
    sellthrough.total_revenue AS SUM(sellthrough.revenue_fact) COMMENT = 'Revenue',
    sellthrough.total_units AS SUM(sellthrough.units_fact) COMMENT = 'Units sold',
    sellthrough.total_margin AS SUM(sellthrough.margin_fact) COMMENT = 'Margin',
    sellthrough.avg_rate_of_sale AS AVG(sellthrough.ros_fact) COMMENT = 'Rate of sale',
    clv.clv_average AS AVG(clv.avg_clv_fact) COMMENT = 'Average CLV',
    clv.clv_customers AS SUM(clv.clv_customers_fact) COMMENT = 'Customers',
    segments.segment_revenue AS SUM(segments.seg_revenue_fact) COMMENT = 'Segment revenue',
    segments.segment_customers AS SUM(segments.seg_customers_fact) COMMENT = 'Segment customers',
    switching.total_switches AS SUM(switching.switch_fact) COMMENT = 'Switch count',
    promotions.total_promo_revenue AS SUM(promotions.promo_revenue_fact) COMMENT = 'Promotion revenue',
    promotions.total_promo_units AS SUM(promotions.promo_units_fact) COMMENT = 'Promotion units',
    promotions.promo_discount AS SUM(promotions.discount_fact) COMMENT = 'Total discount',
    promotions.total_promo_margin AS SUM(promotions.promo_margin_fact) COMMENT = 'Promotion margin',
    competitive.competitor_price AS AVG(competitive.comp_price_fact) COMMENT = 'Average competitor price',
    competitive.our_price AS AVG(competitive.our_price_fact) COMMENT = 'Average our price',
    competitive.price_gap_pct AS AVG(competitive.gap_fact) COMMENT = 'Average price gap %',
    difot.difot_rate AS AVG(difot.difot_fact) COMMENT = 'DIFOT %',
    difot.total_orders AS SUM(difot.orders_fact) COMMENT = 'Orders total',
    difot.on_time_orders AS SUM(difot.on_time_fact) COMMENT = 'Orders on time',
    suppliers.avg_lead_time_days AS AVG(suppliers.lead_time_fact) COMMENT = 'Average lead time days'
  )
  COMMENT = 'Baby Mart category data: sales, customers, promotions, competitor prices and supplier DIFOT by brand and supplier. Plain model with no business rules (the Ontology compare page baseline).';
