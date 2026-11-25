-- ============================================================
-- Category Manager — composable semantic views (Snowhouse first)
--
-- CATEGORY_INTELLIGENCE_VIEW (sql/27) is one monolith of seven unrelated tables:
-- brand_name is repeated on each and nothing joins, so "Huggies revenue against
-- its DIFOT and CLV" cannot be answered in one query, and every definition (the
-- like-for-like rule, how DIFOT is weighted) lives in one view no other team can
-- reuse. Composable semantic views (IMPORTS, private preview) split it:
--
--   SV_CM_BRAND_BASE      brands + suppliers: the shared, governed entity
--     ├─ SV_CM_SALES      sell-through (revenue, units, margin, ASP, rate of sale)
--     ├─ SV_CM_CUSTOMER   CLV, customer segments, brand switching
--     ├─ SV_CM_COMMERCIAL promotions, competitor price position
--     └─ SV_CM_SUPPLY     supplier DIFOT
--   SV_CATEGORY_MANAGER   imports all four (a diamond on the base): one surface
--                         where every fact table joins through the same brand
--
-- Each domain view owns its own rules (AI_SQL_GENERATION), which the composed
-- view inherits. A metric may not share a name with a physical column its own
-- facts read (revenue vs REVENUE is a cycle), hence total_revenue etc. Every fact BRAND_NAME resolves to DIM_BRAND (25 brands, names
-- unique), checked before this was written.
--
-- Not in deploy_data.sh: the canonical account does not have composable views
-- yet. Run on Snowhouse with /tmp/pl/sh_run.sh (retargets BABY_MART_DEMO.* to
-- TEMP.JARCHEN_*). Supplier contact name and email are left out: personal data.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ── Shared base: brand and supplier ─────────────────────────────────────────
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CM_BRAND_BASE
  TABLES (
    brands AS BABY_MART_DEMO.CURATED.DIM_BRAND
      PRIMARY KEY (BRAND_KEY) UNIQUE (BRAND_NAME)
      WITH SYNONYMS ('brand', 'label', 'manufacturer brand')
      COMMENT = 'One row per brand Baby Mart ranges (25). The shared brand entity every Category Manager view joins to.',
    suppliers AS BABY_MART_DEMO.CURATED.DIM_SUPPLIER
      PRIMARY KEY (SUPPLIER_KEY)
      WITH SYNONYMS ('vendor', 'supplier')
      COMMENT = 'One row per supplier (the company Baby Mart buys a brand from).'
  )
  RELATIONSHIPS (
    brand_to_supplier AS brands (SUPPLIER_KEY) REFERENCES suppliers
  )
  FACTS (
    suppliers.lead_time_days AS LEAD_TIME_DAYS
      COMMENT = 'Contracted lead time from order to delivery, in days'
  )
  DIMENSIONS (
    brands.brand_name AS BRAND_NAME
      WITH SYNONYMS = ('brand')
      COMMENT = 'Brand name, e.g. Huggies, Bugaboo, Rascal + Friends',
    brands.brand_origin AS BRAND_ORIGIN
      COMMENT = 'Country the brand comes from',
    brands.price_tier AS PRICE_TIER
      COMMENT = 'Brand price positioning: Premium, Mid or Value',
    suppliers.supplier_name AS SUPPLIER_NAME
      WITH SYNONYMS = ('vendor')
      COMMENT = 'Supplier company name, e.g. Kimberly-Clark Australia, Bugaboo Australia',
    suppliers.supplier_code AS SUPPLIER_CODE
      COMMENT = 'Supplier code, e.g. SUP001',
    suppliers.payment_terms AS PAYMENT_TERMS
      COMMENT = 'Agreed payment terms, e.g. Net 30'
  )
  METRICS (
    brands.brand_count AS COUNT(BRAND_KEY)
      COMMENT = 'Number of brands',
    suppliers.supplier_count AS COUNT(SUPPLIER_KEY)
      COMMENT = 'Number of suppliers',
    suppliers.avg_lead_time_days AS AVG(suppliers.lead_time_days)
      COMMENT = 'Average contracted lead time in days'
  )
  COMMENT = 'Shared Category Manager base: the brand and its supplier. Imported by the sales, customer, commercial and supply views so every metric joins through one brand definition.'
  AI_SQL_GENERATION 'Brand and supplier names are matched exactly; Rascal + Friends includes the plus sign. Amounts are AUD.';

-- ── Sales: sell-through ─────────────────────────────────────────────────────
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CM_SALES
  IMPORTS (BABY_MART_DEMO.ANALYTICS.SV_CM_BRAND_BASE)
  TABLES (
    sellthrough AS BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
      WITH SYNONYMS ('sales', 'POS', 'tills', 'sell-through')
      COMMENT = 'POS sell-through by brand, class, store and fiscal week. Built from the till lines.'
  )
  RELATIONSHIPS (
    sales_to_brand AS sellthrough (sales_brand_name) REFERENCES brands (brand_name)
  )
  FACTS (
    sellthrough.sales_brand_name AS BRAND_NAME,
    sellthrough.units_sold_fact AS UNITS_SOLD,
    sellthrough.revenue_fact AS REVENUE,
    sellthrough.margin_fact AS MARGIN,
    sellthrough.rate_of_sale_fact AS RATE_OF_SALE
  )
  DIMENSIONS (
    sellthrough.category AS CATEGORY
      COMMENT = 'Product category: Prams & Strollers, Car Seats, Nappies & Wipes, Clothing, Feeding',
    sellthrough.class AS CLASS
      COMMENT = 'Product class within the category, e.g. Crawler Nappies, Capsule Stroller, Bottles',
    sellthrough.state AS STATE
      COMMENT = 'Australian state of the store',
    sellthrough.region AS REGION
      COMMENT = 'Store region: Metro, Regional or CBD',
    sellthrough.store_name AS STORE_NAME
      COMMENT = 'Store name',
    sellthrough.fiscal_year AS FISCAL_YEAR
      COMMENT = 'Fiscal year, July to June (FY2026 = Jul 2025 - Jun 2026). FY2026 is incomplete: sales end 7 May 2026.',
    sellthrough.fiscal_week AS FISCAL_WEEK
      COMMENT = 'Week of the calendar year carried with the fiscal year: FY weeks 27-52 are Jul-Dec, 1-26 Jan-Jun. Last complete FY2026 week is 18.',
    sellthrough.fiscal_quarter AS FISCAL_QUARTER
      COMMENT = 'Fiscal quarter',
    sellthrough.fiscal_month AS FISCAL_MONTH
      COMMENT = 'Fiscal month'
  )
  METRICS (
    sellthrough.total_revenue AS SUM(sellthrough.revenue_fact)
      WITH SYNONYMS = ('sales', 'net revenue', 'turnover')
      COMMENT = 'Net revenue in AUD',
    sellthrough.total_units AS SUM(sellthrough.units_sold_fact)
      WITH SYNONYMS = ('units', 'volume')
      COMMENT = 'Units sold',
    sellthrough.total_margin AS SUM(sellthrough.margin_fact)
      WITH SYNONYMS = ('gross margin dollars', 'GP')
      COMMENT = 'Gross margin in AUD',
    sellthrough.margin_pct AS SUM(sellthrough.margin_fact) / NULLIF(SUM(sellthrough.revenue_fact), 0) * 100
      WITH SYNONYMS = ('margin rate', 'GM%')
      COMMENT = 'Gross margin % on a 0-100 scale (37.7 means 37.7%): total margin over total revenue. Never an average of row margins.',
    sellthrough.average_selling_price AS SUM(sellthrough.revenue_fact) / NULLIF(SUM(sellthrough.units_sold_fact), 0)
      WITH SYNONYMS = ('ASP')
      COMMENT = 'Average selling price in AUD: total revenue over total units',
    sellthrough.avg_rate_of_sale AS AVG(sellthrough.rate_of_sale_fact)
      WITH SYNONYMS = ('ROS')
      COMMENT = 'Units per store per week'
  )
  COMMENT = 'Category Manager sales: POS sell-through by brand, class, store and week, joined to the shared brand and supplier.'
  AI_SQL_GENERATION 'Sales data ends 7 May 2026, so FY2026 is incomplete and FY2025 is a full year. Never compare FY2026 totals with FY2025 totals. Growth, decline or this year vs last year compares the same weeks of both years: fiscal_week BETWEEN 27 AND 52 OR fiscal_week BETWEEN 1 AND 18, and say so in the answer. Margin % and ASP are always rebuilt from their totals, never averaged across rows. Percentages are on a 0-100 scale.';

-- ── Customer: CLV, segments, switching ──────────────────────────────────────
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CM_CUSTOMER
  IMPORTS (BABY_MART_DEMO.ANALYTICS.SV_CM_BRAND_BASE)
  TABLES (
    clv AS BABY_MART_DEMO.ANALYTICS.DT_CLV_BY_BRAND
      COMMENT = 'Customer lifetime value of each brand''s customers, by category',
    segments AS BABY_MART_DEMO.ANALYTICS.DT_CUSTOMER_SEGMENT_PERFORMANCE
      COMMENT = 'Revenue and customers by customer segment, brand and fiscal quarter',
    switching AS BABY_MART_DEMO.ANALYTICS.DT_BRAND_SWITCHING
      WITH SYNONYMS ('brand switching', 'churn to competitor brand')
      COMMENT = 'Customers who switched from one brand to another within a class. Joined to the brand they switched FROM.'
  )
  RELATIONSHIPS (
    clv_to_brand AS clv (clv_brand_name) REFERENCES brands (brand_name),
    segments_to_brand AS segments (segment_brand_name) REFERENCES brands (brand_name),
    switching_to_brand AS switching (from_brand) REFERENCES brands (brand_name)
  )
  FACTS (
    clv.clv_brand_name AS BRAND_NAME,
    clv.avg_clv_fact AS AVG_CLV,
    clv.clv_customers_fact AS CUSTOMER_COUNT,
    segments.segment_brand_name AS BRAND_NAME,
    segments.segment_customers_fact AS CUSTOMER_COUNT,
    segments.segment_revenue_fact AS REVENUE,
    switching.switch_count_fact AS SWITCH_COUNT
  )
  DIMENSIONS (
    clv.clv_category AS CATEGORY
      COMMENT = 'Category the customer lifetime value is measured in',
    segments.segment_name AS SEGMENT_NAME
      WITH SYNONYMS = ('customer segment', 'shopper type')
      COMMENT = 'Customer segment: First-time Parents, Second-time Parents, Gift Buyers, Grandparents, Expecting, Registry Shoppers',
    segments.segment_fiscal_year AS FISCAL_YEAR
      COMMENT = 'Fiscal year of the segment figures',
    segments.segment_fiscal_quarter AS FISCAL_QUARTER
      COMMENT = 'Fiscal quarter of the segment figures',
    switching.switch_category AS CATEGORY
      COMMENT = 'Category the switch happened in',
    switching.switch_class AS CLASS
      COMMENT = 'Product class the switch happened in',
    switching.from_brand AS FROM_BRAND
      COMMENT = 'Brand the customers left',
    switching.to_brand AS TO_BRAND
      COMMENT = 'Brand the customers moved to'
  )
  METRICS (
    clv.customer_lifetime_value AS SUM(clv.avg_clv_fact * clv.clv_customers_fact) / NULLIF(SUM(clv.clv_customers_fact), 0)
      WITH SYNONYMS = ('customer lifetime value', 'CLV')
      COMMENT = 'Average customer lifetime value in AUD, weighted by customers. Never a plain average of the per-row averages.',
    clv.clv_customers AS SUM(clv.clv_customers_fact)
      COMMENT = 'Customers the CLV is measured over',
    segments.segment_revenue AS SUM(segments.segment_revenue_fact)
      COMMENT = 'Revenue from a customer segment, in AUD',
    segments.segment_customers AS SUM(segments.segment_customers_fact)
      COMMENT = 'Customers in a segment',
    switching.total_switches AS SUM(switching.switch_count_fact)
      WITH SYNONYMS = ('switches', 'customers lost to another brand')
      COMMENT = 'Number of brand switches'
  )
  COMMENT = 'Category Manager customer: lifetime value, customer segments and brand switching, joined to the shared brand.'
  AI_SQL_GENERATION 'For customers a brand is losing, group total_switches by from_brand; for customers it is winning, by to_brand. customer_lifetime_value is weighted by customers; never average the per-row CLV.';

-- ── Commercial: promotions, competitor price position ──────────────────────
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CM_COMMERCIAL
  IMPORTS (BABY_MART_DEMO.ANALYTICS.SV_CM_BRAND_BASE)
  TABLES (
    promotions AS BABY_MART_DEMO.ANALYTICS.DT_PROMOTIONAL_EFFECTIVENESS
      COMMENT = 'Promotion results by promotion, mechanic and product. No date: covers every promotion period.',
    competitive AS BABY_MART_DEMO.ANALYTICS.DT_COMPETITIVE_POSITION
      WITH SYNONYMS ('competitor pricing', 'price position')
      COMMENT = 'Baby Mart price against each competitor by product and fiscal week. Only some brands are tracked.'
  )
  RELATIONSHIPS (
    promotions_to_brand AS promotions (promo_brand_name) REFERENCES brands (brand_name),
    competitive_to_brand AS competitive (comp_brand_name) REFERENCES brands (brand_name)
  )
  FACTS (
    promotions.promo_brand_name AS BRAND_NAME,
    promotions.promo_units_fact AS PROMO_UNITS,
    promotions.promo_revenue_fact AS PROMO_REVENUE,
    promotions.promo_discount_fact AS TOTAL_DISCOUNT,
    promotions.promo_margin_fact AS PROMO_MARGIN,
    competitive.comp_brand_name AS BRAND_NAME,
    competitive.competitor_price_fact AS AVG_COMPETITOR_PRICE,
    competitive.our_price_fact AS AVG_OUR_PRICE,
    competitive.price_gap_fact AS AVG_PRICE_GAP_PCT
  )
  DIMENSIONS (
    promotions.mechanic AS MECHANIC
      WITH SYNONYMS = ('promotion type', 'promo mechanic')
      COMMENT = 'Promotion mechanic: % Off, BOGO, Bundle, GWP, Multi-buy',
    promotions.promotion_name AS PROMOTION_NAME
      COMMENT = 'Promotion name',
    promotions.promo_category AS CATEGORY
      COMMENT = 'Category of the promoted product',
    competitive.competitor_name AS COMPETITOR_NAME
      WITH SYNONYMS = ('competitor', 'retailer')
      COMMENT = 'Competitor retailer, e.g. Coles, Woolworths, Amazon',
    competitive.comp_product_name AS PRODUCT_NAME
      COMMENT = 'Product the price is compared on',
    competitive.comp_category AS CATEGORY
      COMMENT = 'Category of the compared product',
    competitive.comp_fiscal_year AS FISCAL_YEAR
      COMMENT = 'Fiscal year of the price observation'
  )
  METRICS (
    promotions.total_promo_revenue AS SUM(promotions.promo_revenue_fact)
      COMMENT = 'Revenue sold on promotion, in AUD',
    promotions.total_promo_units AS SUM(promotions.promo_units_fact)
      COMMENT = 'Units sold on promotion',
    promotions.promo_discount AS SUM(promotions.promo_discount_fact)
      WITH SYNONYMS = ('discount cost', 'markdown')
      COMMENT = 'Discount given on promotion, in AUD',
    promotions.total_promo_margin AS SUM(promotions.promo_margin_fact)
      COMMENT = 'Margin earned on promotion, in AUD',
    promotions.promo_margin_pct AS SUM(promotions.promo_margin_fact) / NULLIF(SUM(promotions.promo_revenue_fact), 0) * 100
      COMMENT = 'Promotional margin % on a 0-100 scale: promo margin over promo revenue',
    promotions.margin_per_discount_dollar AS SUM(promotions.promo_margin_fact) / NULLIF(SUM(promotions.promo_discount_fact), 0)
      COMMENT = 'Promo margin returned per AUD 1 of discount',
    competitive.competitor_price AS AVG(competitive.competitor_price_fact)
      COMMENT = 'Average competitor shelf price in AUD',
    competitive.our_price AS AVG(competitive.our_price_fact)
      COMMENT = 'Average Baby Mart shelf price in AUD on the same products',
    competitive.price_gap_pct AS AVG(competitive.price_gap_fact)
      WITH SYNONYMS = ('price gap', 'price index')
      COMMENT = 'Average price gap to the competitor in % on a 0-100 scale (5.5 means 5.5%): positive means Baby Mart is dearer'
  )
  COMMENT = 'Category Manager commercial: promotion effectiveness by mechanic, and Baby Mart price position against competitors.'
  AI_SQL_GENERATION 'Promotions have no time dimension; say the figures cover every promotion period. A positive price_gap_pct means Baby Mart is dearer than the competitor. If a brand has no competitor price rows, say it is not tracked rather than zero.';

-- ── Supply: supplier DIFOT ──────────────────────────────────────────────────
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CM_SUPPLY
  IMPORTS (BABY_MART_DEMO.ANALYTICS.SV_CM_BRAND_BASE)
  TABLES (
    difot AS BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
      WITH SYNONYMS ('supplier performance', 'delivery performance')
      COMMENT = 'Delivered In Full On Time by brand and fiscal week. FY2026 also has class-level rows for Huggies; rows with no class are the brand total.'
  )
  RELATIONSHIPS (
    difot_to_brand AS difot (difot_brand_name) REFERENCES brands (brand_name)
  )
  FACTS (
    difot.difot_brand_name AS BRAND_NAME,
    difot.difot_pct_fact AS DIFOT_PCT,
    difot.orders_total_fact AS ORDERS_TOTAL,
    difot.orders_on_time_fact AS ORDERS_ON_TIME
  )
  DIMENSIONS (
    difot.difot_category AS CATEGORY
      COMMENT = 'Category of the delivered brand',
    difot.difot_class AS CLASS
      COMMENT = 'Product class. Class rows exist for FY2026 only; a NULL class is the brand total row.',
    difot.difot_fiscal_year AS FISCAL_YEAR
      COMMENT = 'Fiscal year of the delivery',
    difot.difot_fiscal_week AS FISCAL_WEEK
      COMMENT = 'Fiscal week of the delivery',
    difot.is_brand_total AS CLASS IS NULL
      COMMENT = 'TRUE for the brand total row, FALSE for a class row. Filter to TRUE unless the question names a class, or totals are double counted.'
  )
  METRICS (
    difot.difot_rate_pct AS SUM(difot.difot_pct_fact * difot.orders_total_fact) / NULLIF(SUM(difot.orders_total_fact), 0)
      WITH SYNONYMS = ('DIFOT', 'on-time in-full', 'OTIF')
      COMMENT = 'Delivered In Full On Time % on a 0-100 scale (87.3 means 87.3%; the 96% target is 96), weighted by orders. Never a plain average of weekly percentages.',
    difot.total_orders AS SUM(difot.orders_total_fact)
      COMMENT = 'Supplier orders placed',
    difot.on_time_orders AS SUM(difot.orders_on_time_fact)
      COMMENT = 'Supplier orders delivered in full on time'
  )
  COMMENT = 'Category Manager supply: supplier DIFOT by brand, class and week, joined to the shared brand and supplier.'
  AI_SQL_GENERATION 'DIFOT has brand total rows and, for FY2026, extra class rows. Unless the question names a class, filter is_brand_total = TRUE so the class rows are not counted twice. DIFOT % is weighted by orders and is on a 0-100 scale, so DIFOT below 90% is difot_rate_pct < 90, never < 0.9. The Baby Mart DIFOT target is 96.';

-- ── Composed: the Category Manager surface ──────────────────────────────────
-- Diamond: all four import SV_CM_BRAND_BASE, which appears once. The sales
-- view's verified queries are opted in; the others have none.
CREATE OR REPLACE SEMANTIC VIEW BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER
  IMPORTS (
    BABY_MART_DEMO.ANALYTICS.SV_CM_SALES AI_VERIFIED_QUERIES include,
    BABY_MART_DEMO.ANALYTICS.SV_CM_CUSTOMER,
    BABY_MART_DEMO.ANALYTICS.SV_CM_COMMERCIAL,
    BABY_MART_DEMO.ANALYTICS.SV_CM_SUPPLY
  )
  METRICS (
    revenue_per_switch AS sellthrough.total_revenue / NULLIF(switching.total_switches, 0)
      COMMENT = 'Brand revenue for each customer it lost to another brand: a cross-domain ratio only the composed view can answer'
  )
  COMMENT = 'Baby Mart Category Manager: sales, customers, promotions, competitor prices and supplier DIFOT, all joined through one shared brand and supplier. Composed from SV_CM_SALES, SV_CM_CUSTOMER, SV_CM_COMMERCIAL and SV_CM_SUPPLY.'
  AI_QUESTION_CATEGORIZATION 'Questions about why a brand moved (root cause) belong to the Brand Investigator; answer them with the like-for-like figures and suggest an investigation.';
