# Category Manager — Data Discovery Guide

## Use Case Summary

**User**: Buyer, Category Lead, Commercial Manager  
**Value**: Brand & SKU performance visibility, competitive positioning, promotional ROI, AI-powered vendor negotiation battlecards

**What it does**: Dashboard with real-time category/brand KPIs, drill-down to SKU-level performance, competitor price gap analysis, promotional effectiveness measurement, and AI-generated negotiation battlecards powered by Snowflake Cortex.

---

## Data Required

| # | Data Type | What We Need | Example Fields | Common Sources | Critical? |
|---|-----------|-------------|----------------|----------------|-----------|
| 1 | **Transaction / POS Data** | Item-level sales with revenue, cost, and margin per line | Date, Store, Product, Qty, Price, Cost, Margin | SAP SD, Oracle Retail, POS system, Shopify | **Yes** |
| 2 | **Product Hierarchy** | Category → Class → Subclass structure with brand linkage | Category, Class, Brand, SKU Name, Retail Price, Lifecycle Stage | SAP MM (Material Master), PIM, MDM | **Yes** |
| 3 | **Brand/Supplier Master** | Who supplies what, payment terms, lead times | Supplier Name, Brand Name, Price Tier, Origin Country | SAP Vendor Master, ERP | **Yes** |
| 4 | **Competitor Pricing** | What competitors charge for equivalent products | Competitor, Their Price, Our Price, Price Gap % | Competera, Prisync, Intelligence Node, web scraping, Snowflake Marketplace | Nice-to-have |
| 5 | **Promotional Activity** | Which promotions ran, mechanic type, discount level | Promo Name, Mechanic (% off / BOGO), Discount %, Dates, Channel | Trade Promo Management, SAP TPM, Anaplan, custom promo system | Nice-to-have |
| 6 | **Customer-Product Affinity** | Which customers buy which brands (for switching analysis) | Customer ID linked to transaction lines | Loyalty system, CDP | Nice-to-have |

---

## Gap Analysis Questions

| # | Question | Customer Answer |
|---|----------|----------------|
| 1 | Do you have **item-level** POS data (not just daily aggregates)? | |
| 2 | Does your sales data include **cost/margin** at the line level? | |
| 3 | Do you have a **product hierarchy** with at least Category + Brand? | |
| 4 | How many months of **transaction history** do you have? (12+ ideal) | |
| 5 | Do you track **competitor prices** today? If so, how? | |
| 6 | Do you track which **promotions** were applied to each transaction? | |
| 7 | What is your **ERP / POS system**? | |

---

## Readiness Assessment

| Criteria | Status |
|----------|--------|
| Item-level POS with cost data | ☐ Yes ☐ Partial ☐ No |
| Product hierarchy (Category + Brand minimum) | ☐ Yes ☐ Partial ☐ No |
| Brand/Supplier master | ☐ Yes ☐ Partial ☐ No |
| 12+ months of history | ☐ Yes ☐ Partial ☐ No |
| Data in Snowflake or can be loaded | ☐ Yes ☐ Partial ☐ No |

**Verdict**: All "Critical" items = Yes → Ready to replicate in 2-4 weeks

---

## Exact Column Reference (for DDL comparison)

Use these tables to map customer columns to the expected schema. Column names don't need to match exactly — the agent should match on semantic meaning.

### FACT_TRANSACTION_LINES

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| TRANSACTION_LINE_KEY | NUMBER | Surrogate primary key | Yes |
| TRANSACTION_ID | TEXT | Groups lines into a single basket/receipt | Yes |
| DATE_KEY | NUMBER | Date in YYYYMMDD format (FK to DIM_DATE) | Yes |
| STORE_KEY | NUMBER | FK to DIM_STORE | Yes |
| PRODUCT_KEY | NUMBER | FK to DIM_PRODUCT | Yes |
| CUSTOMER_KEY | NUMBER | FK to DIM_CUSTOMER (nullable if unidentified) | Nice-to-have |
| PROMOTION_KEY | NUMBER | FK to DIM_PROMOTION (nullable if no promo) | Nice-to-have |
| QUANTITY | NUMBER | Units sold in this line | Yes |
| UNIT_PRICE | NUMBER | Selling price per unit | Yes |
| DISCOUNT_AMOUNT | NUMBER | Discount applied to this line | Nice-to-have |
| NET_REVENUE | NUMBER | Final revenue after discounts (Qty × Price - Discount) | Yes |
| COST_AMOUNT | NUMBER | Cost of goods for this line | Yes (for margin) |
| MARGIN_AMOUNT | NUMBER | NET_REVENUE - COST_AMOUNT | Yes (or derivable) |

### DIM_PRODUCT

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| PRODUCT_KEY | NUMBER | Surrogate primary key | Yes |
| SKU_CODE | TEXT | Business SKU identifier (e.g. SAP Material Number) | Yes |
| PRODUCT_NAME | TEXT | Human-readable product name | Yes |
| BRAND_KEY | NUMBER | FK to DIM_BRAND | Yes |
| SUPPLIER_KEY | NUMBER | FK to DIM_SUPPLIER | Yes |
| CATEGORY | TEXT | Level 1 merchandise hierarchy (e.g. "Nappies & Wipes") | Yes |
| CLASS | TEXT | Level 2 hierarchy (e.g. "Crawler Nappies") | Yes |
| SUBCLASS | TEXT | Level 3 hierarchy (e.g. "Crawler Nappies Type A") | Nice-to-have |
| UNIT_COST | NUMBER | Standard cost per unit | Nice-to-have |
| UNIT_RETAIL | NUMBER | Standard retail price | Nice-to-have |
| MARGIN_PCT | NUMBER | Planned margin percentage (0-1 scale) | Nice-to-have |
| SEASON | TEXT | Season code (e.g. "SS26", "Continuity") | Nice-to-have |
| LIFECYCLE_STAGE | TEXT | Core / New / Markdown / Exit | Nice-to-have |

### DIM_BRAND

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| BRAND_KEY | NUMBER | Surrogate primary key | Yes |
| BRAND_NAME | TEXT | Brand display name (e.g. "Huggies") | Yes |
| SUPPLIER_KEY | NUMBER | FK to DIM_SUPPLIER (brand owner) | Yes |
| PRICE_TIER | TEXT | Premium / Mid / Value classification | Nice-to-have |
| BRAND_ORIGIN | TEXT | Country of origin | Nice-to-have |

### DIM_SUPPLIER

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| SUPPLIER_KEY | NUMBER | Surrogate primary key | Yes |
| SUPPLIER_NAME | TEXT | Supplier company name | Yes |
| SUPPLIER_CODE | TEXT | Business vendor code | Nice-to-have |
| CONTACT_NAME | TEXT | Primary contact person | Nice-to-have |
| CONTACT_EMAIL | TEXT | Contact email | Nice-to-have |
| PAYMENT_TERMS | TEXT | Payment terms (e.g. "Net 30") | Nice-to-have |
| LEAD_TIME_DAYS | NUMBER | Standard delivery lead time in days | Nice-to-have |

### DIM_STORE

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| STORE_KEY | NUMBER | Surrogate primary key | Yes |
| STORE_CODE | TEXT | Business store identifier | Nice-to-have |
| STORE_NAME | TEXT | Store display name | Yes |
| STATE | TEXT | State or region | Yes |
| REGION | TEXT | Sub-region (Metro / Regional / CBD) | Nice-to-have |
| CITY | TEXT | City name | Nice-to-have |
| STORE_FORMAT | TEXT | Store type (Express / Standard / Flagship) | Nice-to-have |

### DIM_DATE

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| DATE_KEY | NUMBER | YYYYMMDD integer key | Yes |
| CALENDAR_DATE | DATE | Actual date value | Yes |
| FISCAL_WEEK | NUMBER | Company fiscal week number | Yes |
| FISCAL_MONTH | NUMBER | Company fiscal month | Nice-to-have |
| FISCAL_QUARTER | NUMBER | Company fiscal quarter | Nice-to-have |
| FISCAL_YEAR | NUMBER | Company fiscal year | Yes |
| IS_WEEKEND | BOOLEAN | Weekend indicator | Nice-to-have |
| IS_PUBLIC_HOLIDAY | BOOLEAN | Public holiday indicator | Nice-to-have |

### DIM_PROMOTION (Nice-to-have table)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| PROMOTION_KEY | NUMBER | Surrogate primary key | Yes |
| PROMOTION_NAME | TEXT | Campaign/promotion name | Yes |
| MECHANIC | TEXT | Type: % Off / BOGO / Bundle / Gift with Purchase | Yes |
| DISCOUNT_PCT | NUMBER | Discount percentage | Yes |
| START_DATE | DATE | Promotion start date | Yes |
| END_DATE | DATE | Promotion end date | Yes |
| CHANNEL | TEXT | In-store / Online / Both | Nice-to-have |

### FACT_COMPETITOR_PRICING (Nice-to-have table)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| DATE_KEY | NUMBER | Observation date | Yes |
| PRODUCT_KEY | NUMBER | FK to our matched product | Yes |
| COMPETITOR_NAME | TEXT | Competitor retailer name | Yes |
| COMPETITOR_PRICE | NUMBER | Their selling price | Yes |
| OUR_PRICE | NUMBER | Our selling price on same date | Yes |
| PRICE_GAP_PCT | NUMBER | Percentage price difference | Derivable |

| Their System | How to Get Data to Snowflake |
|--------------|------------------------------|
| SAP ECC / S4HANA | Snowflake Connector for SAP, Fivetran, Matillion |
| Oracle Retail / EBS | Fivetran, HVR/Qlik Replicate, custom JDBC |
| Shopify / eCommerce | Fivetran, Airbyte |
| Files (CSV/Excel) | Snowpipe, COPY INTO, Snowsight upload |
| Competitor pricing | Snowflake Marketplace datasets |
