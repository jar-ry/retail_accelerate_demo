# Supply Chain Planner — Data Discovery Guide

## Use Case Summary

**User**: Demand Planner, Replenishment Analyst, Supply Chain Manager  
**Value**: Demand visibility, DC stock-out prediction, shelf availability forecasting, supplier delivery performance (DIFOT) tracking

**What it does**: End-to-end supply chain visibility from customer demand at store level, through DC stock projections with restock timing, to supplier inflow performance. Predicts when stock-outs will hit shelves and quantifies lost sales impact.

---

## Data Required

| # | Data Type | What We Need | Example Fields | Common Sources | Critical? |
|---|-----------|-------------|----------------|----------------|-----------|
| 1 | **Store-Level Demand** | Weekly/daily units sold by store and product | Store, Product/Brand, Week, Units Sold, Revenue | Aggregated from POS / SAP BW | **Yes** |
| 2 | **DC/Warehouse Stock** | Current and historical stock levels at distribution centers | DC Location, Product, Stock on Hand, Week | SAP EWM/WM, Manhattan WMS, Blue Yonder, Oracle WMS | **Yes** |
| 3 | **Replenishment Parameters** | Reorder points, safety stock, lead times, MOQs | Brand/SKU, Reorder Point, Safety Stock, Lead Time Days, Min Order Qty | SAP MRP (MD04), planning system, spreadsheets | **Yes** |
| 4 | **Purchase Orders** | Open and historical POs with expected vs actual delivery | PO#, Supplier, Product, Order Date, Expected Date, Actual Date, Qty Ordered, Qty Received | SAP MM (EKKO/EKPO), Oracle Purchasing, Coupa | Important |
| 5 | **Supplier Performance (DIFOT)** | Delivered-in-full-on-time metrics by supplier | Supplier, Week, Orders Due, Orders On-Time, DIFOT % | Derived from POs, or standalone supplier scorecard | Important |
| 6 | **Store Inventory** | Store-level stock (for shelf availability calculation) | Store, Product, Stock on Hand, Days Since Last Sale | POS closing stock, cycle counts, RFID | Nice-to-have |
| 7 | **Demand Forecast** | Forward-looking demand projection (vs just trailing actuals) | Product, Store/Region, Week, Forecast Units | Blue Yonder, Relex, SAP IBP, Snowflake ML, custom models | Nice-to-have |

---

## Gap Analysis Questions

| # | Question | Customer Answer |
|---|----------|----------------|
| 1 | Do you have **DC/warehouse stock** data (not just store shelf stock)? | |
| 2 | Can you identify which **DC serves which stores** (coverage mapping)? | |
| 3 | Do you track **purchase orders** with expected vs actual delivery dates? | |
| 4 | Do you have **MRP parameters** defined (reorder points, safety stock, MOQ)? | |
| 5 | Do you know your **supplier lead times** per product/brand? | |
| 6 | How do you currently measure **supplier delivery performance**? | |
| 7 | Do you have a **demand forecast** or only historical sales? | |
| 8 | What **WMS / planning system** do you use? | |

---

## Readiness Assessment

| Criteria | Status |
|----------|--------|
| Store-level POS data (for demand signal) | ☐ Yes ☐ Partial ☐ No |
| DC/warehouse stock levels | ☐ Yes ☐ Partial ☐ No |
| Replenishment parameters (reorder point, lead time) | ☐ Yes ☐ Partial ☐ No |
| Purchase order history | ☐ Yes ☐ Partial ☐ No |
| DC-to-store coverage mapping | ☐ Yes ☐ Partial ☐ No |
| Data in Snowflake or can be loaded | ☐ Yes ☐ Partial ☐ No |

**Verdict**: All "Critical" items = Yes → Ready to replicate in 2-4 weeks

---

## Exact Column Reference (for DDL comparison)

Use these tables to map customer columns to the expected schema. Column names don't need to match exactly — the agent should match on semantic meaning.

### V_STORE_DEMAND_WEEKLY (or equivalent aggregated view)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| BRAND_NAME | TEXT | Brand identifier | Yes |
| SKU_CLASS | TEXT | Product class / sub-range | Yes |
| STATE | TEXT | Store state/region | Yes |
| STORE_NAME | TEXT | Individual store name | Yes |
| FISCAL_WEEK | NUMBER | Fiscal week number | Yes |
| FISCAL_YEAR | NUMBER | Fiscal year | Yes |
| UNITS | NUMBER | Units sold that week at that store | Yes |
| REVENUE | NUMBER | Net revenue | Yes |
| ROS | NUMBER | Rate of sale (units per store per week) | Derivable |

### SKU_INVENTORY_WEEKLY (DC stock levels)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| BRAND_NAME | TEXT | Brand | Yes |
| SKU_CLASS | TEXT | Product class | Yes |
| CATEGORY | TEXT | Category | Yes |
| DC_STATE | TEXT | Distribution center location (e.g. NSW, VIC) | Yes |
| WEEK_DATE | DATE | Week start date | Yes |
| WEEK_LABEL | TEXT | Display label (e.g. "Wk 18") | Nice-to-have |
| IS_FORECAST | BOOLEAN | TRUE if projected, FALSE if historical | Yes |
| OPENING_STOCK | NUMBER | Stock at start of week | Yes |
| DEMAND_UNITS | NUMBER | Expected outbound units (to stores) | Yes |
| DELIVERY_UNITS | NUMBER | Expected inbound units (from supplier) | Yes |
| CLOSING_STOCK | NUMBER | Stock at end of week | Derivable |
| SHELF_STOCK_PCT | NUMBER | Estimated store shelf availability % | Nice-to-have |
| REORDER_POINT | NUMBER | Stock level that triggers a new PO | Yes |

### BRAND_SUPPLY_PROFILE (replenishment parameters)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| BRAND_NAME | TEXT | Brand | Yes |
| CATEGORY | TEXT | Category | Yes |
| CURRENT_STOCK_UNITS | NUMBER | Current national stock on hand | Yes |
| DAILY_DEMAND | NUMBER | Average daily demand (units) | Yes |
| WEEKLY_DEMAND | NUMBER | Average weekly demand (units) | Yes |
| REORDER_POINT | NUMBER | Stock level to trigger reorder | Yes |
| SAFETY_STOCK | NUMBER | Minimum buffer stock | Yes |
| LEAD_TIME_DAYS | NUMBER | Supplier delivery lead time | Yes |
| AVG_DELIVERY_QTY | NUMBER | Typical PO quantity | Nice-to-have |
| NEXT_DELIVERY_DATE | DATE | Expected next inbound delivery | Nice-to-have |
| NEXT_DELIVERY_QTY | NUMBER | Quantity on next open PO | Nice-to-have |
| STOCKOUT_COST_PER_DAY | NUMBER | Estimated lost sales per day of stockout | Nice-to-have |
| SUPPLIER_NAME | TEXT | Primary supplier name | Yes |
| ORDER_FREQUENCY_DAYS | NUMBER | How often POs are raised | Nice-to-have |
| MIN_ORDER_QTY | NUMBER | Minimum order quantity | Nice-to-have |
| TARGET_WOC | NUMBER | Target weeks of cover | Yes |

### DT_SUPPLIER_DIFOT (supplier delivery performance)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| BRAND_NAME | TEXT | Brand | Yes |
| CATEGORY | TEXT | Category | Yes |
| CLASS | TEXT | Class (nullable for brand-level aggregation) | Nice-to-have |
| FISCAL_YEAR | NUMBER | Year | Yes |
| FISCAL_WEEK | NUMBER | Week number | Yes |
| DIFOT_PCT | FLOAT | % of orders delivered in full on time | Yes |
| ORDERS_TOTAL | NUMBER | Total purchase orders due that week | Yes |
| ORDERS_ON_TIME | NUMBER | Orders delivered on time and in full | Yes |

### FACT_PURCHASE_ORDERS (source for DIFOT derivation)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| PO_NUMBER | TEXT | Purchase order number | Yes |
| SUPPLIER_KEY | NUMBER | FK to supplier | Yes |
| PRODUCT_KEY | NUMBER | FK to product | Yes |
| STORE_KEY | NUMBER | FK to destination store/DC | Nice-to-have |
| ORDER_DATE | DATE | Date PO was raised | Yes |
| EXPECTED_DELIVERY | DATE | Agreed delivery date | Yes |
| ACTUAL_DELIVERY | DATE | Actual goods received date (null if open) | Yes |
| ORDER_QTY | NUMBER | Quantity ordered | Yes |
| RECEIVED_QTY | NUMBER | Quantity actually received | Yes |
| UNIT_COST | NUMBER | Agreed unit cost | Nice-to-have |
| PO_STATUS | TEXT | Open / Received / Partial / Cancelled | Nice-to-have |

### FACT_INVENTORY (store-level stock)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| DATE_KEY | NUMBER | Snapshot date (YYYYMMDD) | Yes |
| STORE_KEY | NUMBER | FK to store | Yes |
| PRODUCT_KEY | NUMBER | FK to product | Yes |
| STOCK_ON_HAND | NUMBER | Current units in store | Yes |
| STOCK_ON_ORDER | NUMBER | Units on open POs for this location | Nice-to-have |
| RECEIPTS_QTY | NUMBER | Units received that day/week | Nice-to-have |
| DAYS_SINCE_LAST_SALE | NUMBER | Freshness/slow-mover indicator | Nice-to-have |

### STOCK_ALERTS (generated or from planning system)

| Column Name | Data Type | Description | Required? |
|-------------|-----------|-------------|-----------|
| ALERT_ID | TEXT | Unique alert identifier | Yes |
| BRAND_NAME | TEXT | Affected brand | Yes |
| CATEGORY | TEXT | Category | Yes |
| ALERT_TYPE | TEXT | critical / warning / info | Yes |
| TITLE | TEXT | Alert headline | Yes |
| DESCRIPTION | TEXT | Detailed alert message | Yes |
| CREATED_AT | TIMESTAMP | When alert was triggered | Yes |
| WOC_AT_TIME | NUMBER | Weeks of cover when triggered | Nice-to-have |
| RECOMMENDED_ACTION | TEXT | Suggested next step | Nice-to-have |
| IS_RESOLVED | BOOLEAN | Whether alert has been actioned | Nice-to-have |

| Their System | How to Get Data to Snowflake |
|--------------|------------------------------|
| SAP ECC / S4HANA (MM, EWM) | Snowflake Connector for SAP, Fivetran, Matillion |
| Manhattan WMS / Blue Yonder | API extract → Snowpipe, Fivetran |
| Oracle Retail / WMS | Fivetran, HVR/Qlik Replicate |
| Planning tools (Relex, SAP IBP) | API/file export → stage → COPY INTO |
| Files (CSV/Excel) | Snowpipe, COPY INTO, Snowsight upload |
| Kafka / Event streams (real-time stock) | Snowpipe Streaming |
