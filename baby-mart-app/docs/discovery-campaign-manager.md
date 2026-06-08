# Campaign Manager — Data Discovery Guide

## Use Case Summary

**User**: CRM Manager, Marketing Lead, Loyalty Manager  
**Value**: AI-powered audience segmentation (natural language), offer cost optimization, campaign activation to Braze/Hightouch/Emarsys

**What it does**: Chat-based audience builder where you describe a segment in plain English and the AI builds the query. Includes deterministic cost calculator for offers, AI budget optimizer, and campaign lifecycle management with activation to downstream platforms.

---

## Data Required

| # | Data Type | What We Need | Example Fields | Common Sources | Critical? |
|---|-----------|-------------|----------------|----------------|-----------|
| 1 | **Customer Master** | Demographics and behavioral attributes per customer | Customer ID, State, Age Band, Gender, Loyalty Tier, Lifetime Spend, Last Purchase Date | Loyalty platform, CRM, CDP | **Yes** |
| 2 | **Customer Segmentation** | Pre-defined segments (lifecycle, value, behavioral) | Segment Name (e.g. "First-time Parents", "Lapsed High-Value") | Analytics team, CDP, RFM model | **Yes** |
| 3 | **Transaction History (customer-linked)** | Purchases tied to customer identity | Customer ID, Date, Amount, Products | POS + Loyalty linkage | **Yes** |
| 4 | **Customer Lifetime Value (CLV)** | Predicted or calculated CLV per customer or segment | Customer/Brand, Avg CLV, Median CLV | ML model output, CDP, marketing analytics | Nice-to-have |
| 5 | **Offer/Promotion Catalogue** | Available offers with costs and redemption rates | Offer Name, Type, Cost per Redemption, Expected Conversion Rate | Trade promo system, vendor funding records | Nice-to-have |
| 6 | **Campaign History** | Past campaigns with results (for AI learning) | Campaign Name, Audience Size, Channel, Response Rate, Revenue Uplift | Campaign management platform, Braze, Emarsys | Nice-to-have |

---

## Additional Requirements

| Requirement | Description |
|-------------|-------------|
| **Customer Identification Rate** | What % of transactions have a customer key? Need 50%+ for meaningful segmentation |
| **Snowflake Cortex AI** | Needed for the AI chat agent and audience insights — runs in-account, no external API keys needed |
| **Activation Platform** | Where audiences get pushed (Braze, Hightouch, Emarsys, custom) — not required for the demo itself |

---

## Gap Analysis Questions

| # | Question | Customer Answer |
|---|----------|----------------|
| 1 | Do you have a **customer master** with demographics (age, gender, location)? | |
| 2 | What % of transactions are **identified** (linked to a customer)? | |
| 3 | Do you have **customer segments** defined today? How many? | |
| 4 | Do you have a **loyalty program** with tier levels? | |
| 5 | Do you have or can you calculate **CLV** scores? | |
| 6 | What **activation platforms** do you use for campaigns? (Braze, Emarsys, Hightouch, etc.) | |
| 7 | Is **Snowflake Cortex AI** enabled on your account? | |
| 8 | How do you currently **build audiences** for campaigns? | |

---

## Readiness Assessment

| Criteria | Status |
|----------|--------|
| Customer master with demographics | ☐ Yes ☐ Partial ☐ No |
| Customer segments defined | ☐ Yes ☐ Partial ☐ No |
| Customer-linked transaction history | ☐ Yes ☐ Partial ☐ No |
| 50%+ transaction identification rate | ☐ Yes ☐ Partial ☐ No |
| Snowflake Cortex AI available | ☐ Yes ☐ No ☐ Don't know |
| Data in Snowflake or can be loaded | ☐ Yes ☐ Partial ☐ No |

**Verdict**: All "Critical" items = Yes → Ready to replicate in 2-4 weeks

---

## Exact Column Reference (for DDL comparison)

Use these tables to map customer columns to the expected schema. Column names don't need to match exactly — the agent should match on semantic meaning.

### DIM_CUSTOMER

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| CUSTOMER_KEY | NUMBER | Surrogate primary key | Yes |
| CUSTOMER_ID | TEXT | Business customer identifier (loyalty ID, email hash) | Yes |
| SEGMENT_KEY | NUMBER | FK to DIM_CUSTOMER_SEGMENT | Yes |
| FIRST_PURCHASE_DATE | DATE | Date of first ever transaction | Nice-to-have |
| STATE | TEXT | Customer state/region | Yes |
| AGE_BAND | TEXT | Age bracket (e.g. "25-34", "35-44") | Yes |
| GENDER | TEXT | Gender (Male / Female / Other / Unknown) | Yes |
| LOYALTY_TIER | TEXT | Loyalty tier (Gold / Silver / Bronze / None) | Yes |
| LIFETIME_SPEND | NUMBER | Total historical spend amount | Yes |
| TOTAL_TRANSACTIONS | NUMBER | Lifetime transaction count | Nice-to-have |
| LAST_PURCHASE_DATE | DATE | Most recent purchase date | Yes |

### DIM_CUSTOMER_SEGMENT

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| SEGMENT_KEY | NUMBER | Surrogate primary key | Yes |
| SEGMENT_NAME | TEXT | Display name (e.g. "First-time Parents", "Lapsed High-Value") | Yes |
| SEGMENT_DESCRIPTION | TEXT | Definition of how segment is determined | Nice-to-have |

### FACT_TRANSACTION_LINES (customer-linked subset)

Same schema as Category Manager — the critical difference is that CUSTOMER_KEY must be populated for the campaign persona to work.

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| TRANSACTION_LINE_KEY | NUMBER | Primary key | Yes |
| TRANSACTION_ID | TEXT | Basket identifier | Yes |
| DATE_KEY | NUMBER | Transaction date (YYYYMMDD) | Yes |
| CUSTOMER_KEY | NUMBER | FK to DIM_CUSTOMER — **must not be null** | **Yes** |
| PRODUCT_KEY | NUMBER | FK to DIM_PRODUCT | Yes |
| QUANTITY | NUMBER | Units purchased | Yes |
| NET_REVENUE | NUMBER | Revenue after discounts | Yes |

### DT_CLV_BY_BRAND (customer lifetime value)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| CATEGORY | TEXT | Product category | Yes |
| BRAND_NAME | TEXT | Brand | Yes |
| BRAND_KEY | NUMBER | FK to brand dimension | Nice-to-have |
| CUSTOMER_COUNT | NUMBER | Customers who purchased this brand | Yes |
| AVG_CLV | NUMBER | Average customer lifetime value ($) | Yes |
| MEDIAN_CLV | NUMBER | Median CLV | Nice-to-have |
| AVG_TRANSACTIONS | NUMBER | Average transaction count per customer | Nice-to-have |

### DT_CUSTOMER_SEGMENT_PERFORMANCE

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| SUPPLIER_KEY | NUMBER | FK to supplier | Nice-to-have |
| SUPPLIER_NAME | TEXT | Supplier name | Nice-to-have |
| BRAND_NAME | TEXT | Brand name | Yes |
| SEGMENT_NAME | TEXT | Customer segment name | Yes |
| FISCAL_YEAR | NUMBER | Year | Yes |
| FISCAL_QUARTER | NUMBER | Quarter | Yes |
| CUSTOMER_COUNT | NUMBER | Customers in this segment×brand combination | Yes |
| REVENUE | NUMBER | Revenue from this segment | Yes |
| UNITS | NUMBER | Units from this segment | Nice-to-have |
| AVG_ITEMS_PER_TXN | NUMBER | Average basket depth | Nice-to-have |
| TRANSACTION_COUNT | NUMBER | Total transactions | Nice-to-have |

### DT_BRAND_SWITCHING

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| CATEGORY | TEXT | Category | Yes |
| CLASS | TEXT | Class within category | Nice-to-have |
| FROM_BRAND | TEXT | Brand the customer left | Yes |
| TO_BRAND | TEXT | Brand the customer moved to | Yes |
| SWITCH_COUNT | NUMBER | Number of switch events observed | Yes |
| CUSTOMER_COUNT | NUMBER | Distinct customers who switched | Yes |

| Their System | How to Get Data to Snowflake |
|--------------|------------------------------|
| Salesforce / CRM | Fivetran, Snowflake connector |
| Loyalty platforms (Eagle Eye, Loyalty Corp) | API extract → Snowpipe |
| CDP (Segment, mParticle, Treasure Data) | Native Snowflake warehouse destination |
| Emarsys / Braze / Klaviyo | Fivetran, reverse ETL (Hightouch/Census) |
| Custom loyalty DB | JDBC connector, Fivetran |
| Files (CSV/Excel) | Snowpipe, COPY INTO, Snowsight upload |

---

## Data Privacy Notes

| Consideration | Guidance |
|---------------|----------|
| PII in customer data | Use Snowflake Dynamic Data Masking for email/phone in shared views |
| Audience export | Only export Customer ID + Segment label — no raw PII to activation |
| Cross-tenant sharing | If supplier sees audience data, use Secure Data Share with row-level security |
| GDPR / Privacy Act | Ensure consent flags exist; filter unconsented customers from audiences |
