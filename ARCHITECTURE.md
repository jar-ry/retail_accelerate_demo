# Baby Mart Supplier Collaboration Platform — Architecture Document

## Architecture Overview — Two-Account Model

The demo uses **two Snowflake accounts** to demonstrate real cross-account data sharing:

- **Account A (Retailer — Baby Mart):** Owns all raw data, runs analytics, hosts the internal Category Manager app + Cortex Agent
- **Account B (Supplier — e.g., Bugaboo):** Installs the Native App from a private listing — gets Streamlit dashboards, Cortex Agent, Semantic View, and shared data in one package

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ACCOUNT A — RETAILER (Baby Mart)                                                        │
│                                                                                           │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────────────────────┐   │
│  │  RAW LAYER   │   │  CURATED LAYER   │   │   CONSUMPTION LAYER                    │   │
│  │              │──▶│                  │──▶│                                        │   │
│  │ Landing zone │   │ Star schema      │   │ ┌───────────┐ ┌───────────────────┐   │   │
│  │ for synthetic│   │ Dimensions +     │   │ │ Dynamic   │ │ Cortex Agent      │   │   │
│  │ data         │   │ Facts            │   │ │ Tables    │ │ (Category Mgr)    │   │   │
│  └──────────────┘   └──────────────────┘   │ └───────────┘ └───────────────────┘   │   │
│                                             │ ┌───────────┐ ┌───────────────────┐   │   │
│                                             │ │ Semantic  │ │ Category Manager  │   │   │
│                                             │ │ Model     │ │ Battlecard (React)│   │   │
│                                             │ └───────────┘ └───────────────────┘   │   │
│                                             └────────────────────────────────────────┘   │
│                                                                                           │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  APPLICATION PACKAGE: SUPPLIER_PORTAL_APP_PACKAGE                                   │  │
│  │  Contents: Streamlit UI + Cortex Agent + Semantic View + Shared Data (Secure Views) │  │
│  │  Distributed via: Private Listing → Account B                                       │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────┬──────────────────────────────────────────┘
                                               │
                                               │  Native App (Private Listing)
                                               │  (App + Data + Agent + Semantic View)
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ACCOUNT B — SUPPLIER (e.g., Bugaboo)                                                     │
│                                                                                            │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  INSTALLED NATIVE APP: BABY_MART_SUPPLIER_PORTAL                                    │   │
│  │                                                                                      │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                  │   │
│  │  │ Streamlit UI     │  │ Cortex Agent     │  │ Semantic View    │                  │   │
│  │  │ - Sellthrough    │  │ (Supplier Comms) │  │ (NL → SQL)       │                  │   │
│  │  │ - Segments       │  │ Answers supplier │  │ Powers agent +   │                  │   │
│  │  │ - Switching      │  │ questions with   │  │ ad-hoc queries   │                  │   │
│  │  │ - AI Chat        │  │ data-backed      │  │                  │                  │   │
│  │  │                  │  │ insights         │  │                  │                  │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘                  │   │
│  │                                                                                      │   │
│  │  Shared Data (zero-copy from retailer, supplier-filtered):                           │   │
│  │  VW_SUPPLIER_SELLTHROUGH | VW_SUPPLIER_SEGMENTS | VW_SUPPLIER_SWITCHING              │   │
│  └────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Data Sharing Value Propositions (for demo narrative)
- **Zero-copy:** Supplier sees live data without any ETL or data movement
- **Real-time:** As retailer's Dynamic Tables refresh, supplier sees updated metrics immediately
- **Governed:** Retailer controls exactly what the supplier sees (secure views with row-level filters)
- **Scalable:** One share definition serves multiple supplier accounts (parameterized by supplier_key)
- **No infrastructure for supplier:** They just mount the share and query — or build their own app on top

---

## Snowflake Capabilities Demonstrated

| # | Capability | Usage in Demo |
|---|-----------|---------------|
| 1 | **Native App Framework** | Supplier portal packaged as installable app (Streamlit + Agent + Semantic View + Shared Data) via private listing |
| 2 | **Cortex Agent (shared in app)** | Supplier's AI analyst — runs inside the native app on supplier's compute, answers performance questions |
| 3 | **Semantic View (shared in app)** | Defines metrics/dimensions over shared data; powers the agent's natural language → SQL |
| 4 | **Secure Data Sharing** | Retailer shares supplier-filtered performance data inside the app package (zero-copy) |
| 5 | **Cortex Analyst** | Text-to-SQL via semantic view for both agent and ad-hoc queries |
| 6 | **Cortex LLM Functions** | AI_COMPLETE for battlecard generation (retailer side) |
| 7 | **Secure Views** | Row-level security ensuring each supplier only sees their own data |
| 8 | **Dynamic Tables** | Pre-computed aggregations (sell-through, WOC, switching) |
| 9 | **Tasks & Streams** | Scheduled weekly agent trigger (retailer side) |
| 10 | **Streamlit in Snowflake** | Supplier portal UI running inside Native App |
| 11 | **Python UDFs** | Competitor price scraping simulation |
| 12 | **Snowflake Notebooks** | Data generation & analysis |
| 13 | **REST API** | External React app connectivity (retailer side) |

---

## Product Ownership & Access Model

| Product | Owner | Audience | Access Method |
|---------|-------|----------|---------------|
| Product 1: Supplier Sellthrough Intelligence | Retailer builds & shares | **External** — Suppliers | Native App installed in supplier's account (includes Streamlit + Agent + Semantic View + Shared Data) |
| Product 2: Category Manager Battlecard | Retailer builds & runs | **Internal** — Category Managers | Internal React app connecting to retailer's Snowflake (RBAC-controlled) |

**What the supplier receives in the Native App install:**
1. **Streamlit dashboards** — sellthrough, segments, brand switching visualizations
2. **Cortex Agent** — AI analyst they can chat with about their performance (runs on their compute)
3. **Semantic View** — structured definition of metrics/dimensions enabling natural language queries
4. **Shared Data** — secure views with their supplier-filtered performance data (zero-copy from retailer)

**Why this matters for the demo narrative:**
- Product 1 demonstrates that the retailer can **ship an entire AI-powered analytics platform** to suppliers via a single Native App install — data + dashboards + AI agent + natural language interface
- Product 2 demonstrates that the retailer **retains asymmetric advantage** — the CM knows things the supplier doesn't (CLV, promo incrementality, competitive positioning) and uses that for negotiation leverage

---

## Frontend Architecture — Retailer Only (React)

The React app is **internal to the retailer** — it powers the Category Manager Battlecard tool. The supplier portal is a **Streamlit app inside the Native App** (see Native App Package Structure section below).

### Tech Stack

```
React 18 + TypeScript
├── Build: Vite 5
├── Styling: Tailwind CSS 3.4 + shadcn/ui components
├── Routing: React Router v6 (nested routes)
├── Data Fetching: TanStack Query v5 (React Query)
├── Charts: Recharts (bar, line, area) + Plotly.js (Sankey, heatmap)
├── Icons: Lucide React
├── Tables: TanStack Table v8
├── Animations: Framer Motion
└── Date Utils: date-fns
```

### Route Structure (Retailer App Only)

```
/                           → Redirect to /category/clv
/category/clv               → Customer Lifetime Value (Section A)
/category/elasticity        → Promotional Elasticity (Section B)
/category/competitive       → Competitive Intelligence (Section C)
/category/battlecard        → AI Negotiation Battlecard (Section D)
```

### Component Architecture

```
retailer/frontend/src/
├── components/
│   ├── layout/
│   │   └── AppShell.tsx          (sidebar + topbar + main content)
│   ├── charts/
│   │   ├── KPICard.tsx           (metric + trend + sparkline)
│   │   ├── ElasticityChart.tsx   (price vs demand curve)
│   │   ├── WaterfallChart.tsx    (incremental vs pull-forward)
│   │   └── PriceGapChart.tsx     (competitor pricing timeline)
│   ├── ai/
│   │   ├── BattlecardCard.tsx    (AI-generated one-pager)
│   │   └── ChatPanel.tsx         (SSE streaming chat with CM agent)
│   └── shared/
│       ├── DataTable.tsx         (sortable, filterable table)
│       ├── FilterBar.tsx         (category, brand, time filters)
│       └── SkeletonLoader.tsx    (loading states)
├── pages/
│   ├── CLVPage.tsx
│   ├── ElasticityPage.tsx
│   ├── CompetitivePage.tsx
│   └── BattlecardPage.tsx
├── hooks/
│   ├── useCLVData.ts
│   ├── useElasticityData.ts
│   ├── useCompetitiveData.ts
│   └── useBattlecardData.ts
├── api/
│   └── client.ts                (axios instance)
└── types/
    └── index.ts
```

### Design System

| Element | Specification |
|---------|--------------|
| Primary Color | `#1E40AF` (deep blue — professional, trustworthy) |
| Accent Color | `#10B981` (emerald green — positive metrics) |
| Danger Color | `#EF4444` (red — negative metrics, stockouts) |
| Warning Color | `#F59E0B` (amber — attention needed) |
| Background | `#F8FAFC` (light slate) |
| Card Background | `#FFFFFF` with subtle shadow |
| Font | Inter (headings) + JetBrains Mono (numbers/data) |
| Border Radius | `8px` (cards), `6px` (buttons), `4px` (inputs) |
| Spacing | 8px grid system |

---

## API Layer (FastAPI Proxy — Retailer Only)

### Purpose
The Python FastAPI server sits between the **retailer's React app** and Snowflake. It:
1. Manages Snowflake connection (auth via PAT or key pair)
2. Executes SQL and returns JSON to the React frontend
3. Proxies Cortex Agent API calls for the Category Manager agent (SSE passthrough)
4. Handles CORS for local development

Note: The supplier does NOT use this API — their Streamlit app queries Snowflake directly inside the Native App.

### Endpoints

```python
# Category Manager APIs (retailer internal)
GET  /api/clv/by-brand?category={}
GET  /api/elasticity/by-mechanic?brand={}
GET  /api/competitive/pricing?brand={}
POST /api/battlecard/generate   (body: {category, brand})

# AI Agent APIs (Category Manager agent)
POST /api/agent/chat            (SSE stream — proxies Cortex Agent for CM)
```

### SSE Streaming Pattern (Agent Chat)

```python
@app.post("/api/agent/chat")
async def agent_chat(request: ChatRequest):
    async def event_generator():
        async for event in call_cortex_agent(request.messages):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

---

## Database & Schema Design

```
Database: BABY_MART_DEMO
├── Schema: RAW
│   └── (landing tables for data generation scripts)
├── Schema: CURATED
│   ├── Dimensions (DIM_STORE, DIM_PRODUCT, DIM_BRAND, DIM_SUPPLIER, etc.)
│   └── Facts (FACT_TRANSACTION_LINES, FACT_INVENTORY, FACT_PURCHASE_ORDERS, etc.)
├── Schema: ANALYTICS
│   ├── Dynamic Tables (6 pre-aggregated DTs)
│   └── Secure Views (supplier-specific filtered views)
├── Schema: AI
│   ├── Stage: SEMANTIC_MODEL_STAGE (YAML file)
│   ├── Cortex Agent: SUPPLIER_COMMS_AGENT
│   └── UDFs (scraping simulation, utilities)
└── Schema: APP
    └── (reserved for any Snowflake-side app objects)
```

---

## Data Model (Star Schema)

### Dimension Tables

```sql
-- DIM_STORE
store_key           INT PRIMARY KEY
store_code          VARCHAR(10)
store_name          VARCHAR(100)
state               VARCHAR(3)        -- VIC, NSW, QLD, SA, WA, TAS, ACT, NT
region              VARCHAR(50)       -- Metro, Regional, CBD
city                VARCHAR(50)
latitude            FLOAT
longitude           FLOAT
store_format        VARCHAR(20)       -- Standard, Large Format, Express
open_date           DATE

-- DIM_PRODUCT
product_key         INT PRIMARY KEY
sku_code            VARCHAR(20)
product_name        VARCHAR(200)
brand_key           INT FK
supplier_key        INT FK
category            VARCHAR(50)       -- Car Seats, Prams, Nappies, Clothing, Feeding
class               VARCHAR(50)       -- Sub-category level
subclass            VARCHAR(50)
unit_cost           DECIMAL(10,2)
unit_retail         DECIMAL(10,2)
margin_pct          DECIMAL(5,2)
season              VARCHAR(20)       -- SS24, AW24, SS25, AW25, Continuity
lifecycle_stage     VARCHAR(20)       -- New, Core, Markdown, Exit

-- DIM_BRAND
brand_key           INT PRIMARY KEY
brand_name          VARCHAR(100)
supplier_key        INT FK
price_tier          VARCHAR(20)       -- Premium, Mid, Value
brand_origin        VARCHAR(50)

-- DIM_SUPPLIER
supplier_key        INT PRIMARY KEY
supplier_name       VARCHAR(100)
supplier_code       VARCHAR(20)
contact_name        VARCHAR(100)
contact_email       VARCHAR(100)
payment_terms       VARCHAR(20)
lead_time_days      INT

-- DIM_CUSTOMER
customer_key        INT PRIMARY KEY
customer_id         VARCHAR(20)
segment_key         INT FK
first_purchase_date DATE
state               VARCHAR(3)
age_band            VARCHAR(20)
gender              VARCHAR(10)
loyalty_tier        VARCHAR(20)       -- Bronze, Silver, Gold, Platinum
lifetime_spend      DECIMAL(12,2)
total_transactions  INT
last_purchase_date  DATE

-- DIM_CUSTOMER_SEGMENT
segment_key         INT PRIMARY KEY
segment_name        VARCHAR(50)
segment_description VARCHAR(200)

-- DIM_DATE
date_key            INT PRIMARY KEY
calendar_date       DATE
day_of_week         VARCHAR(10)
week_number         INT
fiscal_week         INT
fiscal_month        INT
fiscal_quarter      INT
fiscal_year         INT
is_weekend          BOOLEAN
is_public_holiday   BOOLEAN

-- DIM_PROMOTION
promotion_key       INT PRIMARY KEY
promotion_name      VARCHAR(100)
mechanic            VARCHAR(30)       -- % Off, Bundle, GWP, BOGO, Multi-buy
discount_pct        DECIMAL(5,2)
start_date          DATE
end_date            DATE
channel             VARCHAR(20)       -- All, Online, Instore
```

### Fact Tables

```sql
-- FACT_TRANSACTION_LINES (grain: one row per item sold)
transaction_line_key  BIGINT PRIMARY KEY
transaction_id        VARCHAR(30)
date_key              INT FK
store_key             INT FK
product_key           INT FK
customer_key          INT FK          -- NULL for non-loyalty transactions
promotion_key         INT FK          -- NULL if not on promo
quantity              INT
unit_price            DECIMAL(10,2)
discount_amount       DECIMAL(10,2)
net_revenue           DECIMAL(10,2)
cost_amount           DECIMAL(10,2)
margin_amount         DECIMAL(10,2)

-- FACT_INVENTORY (grain: one row per store x SKU x day)
inventory_key         BIGINT PRIMARY KEY
date_key              INT FK
store_key             INT FK
product_key           INT FK
stock_on_hand         INT
stock_on_order        INT
receipts_qty          INT
days_since_last_sale  INT

-- FACT_PURCHASE_ORDERS (grain: one row per PO line)
po_key                BIGINT PRIMARY KEY
po_number             VARCHAR(20)
supplier_key          INT FK
product_key           INT FK
store_key             INT FK          -- NULL if DC-level
order_date            DATE
expected_delivery     DATE
actual_delivery       DATE
order_qty             INT
received_qty          INT
unit_cost             DECIMAL(10,2)
po_status             VARCHAR(20)     -- Open, In Transit, Received, Cancelled

-- FACT_COMPETITOR_PRICING (grain: one row per competitor x SKU x week)
competitor_price_key  BIGINT PRIMARY KEY
date_key              INT FK
product_key           INT FK
competitor_name       VARCHAR(50)     -- Coles, Woolworths, Amazon AU
competitor_price      DECIMAL(10,2)
our_price             DECIMAL(10,2)
price_gap_pct         DECIMAL(5,2)
scrape_timestamp      TIMESTAMP

-- FACT_BUDGET (grain: one row per category x store x week)
budget_key            BIGINT PRIMARY KEY
date_key              INT FK
store_key             INT FK
category              VARCHAR(50)
brand_key             INT FK
planned_units         INT
planned_revenue       DECIMAL(12,2)
planned_margin        DECIMAL(12,2)
```

---

## Dynamic Tables (Pre-Aggregated Analytics)

```sql
-- DT_SELLTHROUGH_WEEKLY
-- Grain: supplier x brand x category x class x store x week
-- Metrics: units_sold, revenue, avg_price, stock_on_hand, sell_through_rate,
--          weeks_of_cover, rate_of_sale, vs_plan_pct, vs_ly_pct

-- DT_BRAND_SWITCHING
-- Grain: category x class x from_brand x to_brand x period
-- Metrics: switch_count, switch_rate, customer_count

-- DT_CUSTOMER_SEGMENT_PERFORMANCE
-- Grain: supplier x brand x segment x period
-- Metrics: penetration_rate, basket_affinity, repeat_rate, avg_items_per_txn,
--          revenue_contribution_pct

-- DT_PROMOTIONAL_EFFECTIVENESS
-- Grain: promotion x product x store
-- Metrics: uplift_pct, incremental_pct, pull_forward_pct, promo_roi,
--          baseline_rate, promo_rate

-- DT_CLV_BY_BRAND
-- Grain: category x brand
-- Metrics: avg_clv, median_clv, retention_12m, retention_24m,
--          new_customer_acquisition_rate, category_entry_pct

-- DT_COMPETITIVE_POSITION
-- Grain: product x competitor x week
-- Metrics: price_gap_index, demand_response_coefficient,
--          market_avg_price, lowest_competitor_price
```

---

## Cortex Agent: Weekly Supplier Comms

### Agent Definition

```yaml
Name: SUPPLIER_COMMS_AGENT
Model: claude-3-5-sonnet (or llama-3.1-70b)
Tools:
  - cortex_analyst_text_to_sql:
      semantic_model_file: @AI.SEMANTIC_MODEL_STAGE/baby_mart_semantic_model.yaml
  - generate_email:
      description: Formats a supplier communication email
  - get_po_recommendations:
      description: Calculates PO adjustment suggestions based on WOC
```

### Agent Workflow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ React UI    │────▶│ FastAPI Proxy     │────▶│ Cortex Agent    │
│ Chat Panel  │     │ /api/agent/chat   │     │ (SSE Response)  │
│             │◀────│ SSE Passthrough   │◀────│                 │
│ Streaming   │     │                   │     │ Tools:          │
│ Response    │     │                   │     │ - SQL queries   │
│             │     │                   │     │ - Summaries     │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

### System Prompt

```
You are a retail supply chain analyst for Baby Mart. Your role is to
communicate weekly performance updates to suppliers. You should:
- Summarize sell-through vs plan, vs last week, vs last year
- Flag overstock (>10 WOC) and understock (<4 WOC) risks
- Recommend PO adjustments with specific quantities
- Suggest stock rebalancing between stores
- Be concise, data-driven, and actionable
- Include specific numbers (units, $, %) in every statement
```

---

## Semantic Model (YAML)

```yaml
name: baby_mart_supplier_collaboration
description: Semantic model for Baby Mart supplier and category analytics

tables:
  - name: DT_SELLTHROUGH_WEEKLY
    description: Weekly sell-through metrics by supplier, brand, category, store
    columns:
      - name: SUPPLIER_NAME
      - name: BRAND_NAME
      - name: CATEGORY
      - name: STORE_NAME
      - name: STATE
      - name: FISCAL_WEEK
      - name: UNITS_SOLD
        aggregation: sum
      - name: REVENUE
        aggregation: sum
      - name: SELL_THROUGH_RATE
        aggregation: avg
      - name: WEEKS_OF_COVER
        aggregation: avg

  - name: DT_BRAND_SWITCHING
    description: Brand switching dynamics by category and class
    columns:
      - name: CATEGORY
      - name: CLASS
      - name: FROM_BRAND
      - name: TO_BRAND
      - name: SWITCH_COUNT
        aggregation: sum
      - name: SWITCH_RATE
        aggregation: avg

  - name: DT_CUSTOMER_SEGMENT_PERFORMANCE
    description: How products resonate across customer segments
    columns:
      - name: SUPPLIER_NAME
      - name: BRAND_NAME
      - name: SEGMENT_NAME
      - name: PENETRATION_RATE
      - name: REPEAT_RATE
      - name: REVENUE_CONTRIBUTION_PCT

  - name: DT_COMPETITIVE_POSITION
    description: Competitor pricing and market position
    columns:
      - name: PRODUCT_NAME
      - name: COMPETITOR_NAME
      - name: PRICE_GAP_INDEX
      - name: OUR_PRICE
      - name: COMPETITOR_PRICE

verified_queries:
  - question: "How is Bugaboo performing this week vs last week?"
    sql: |
      SELECT fiscal_week, SUM(units_sold) as units, SUM(revenue) as revenue
      FROM DT_SELLTHROUGH_WEEKLY
      WHERE supplier_name = 'Bugaboo' AND fiscal_year = 2026
      ORDER BY fiscal_week DESC LIMIT 2

  - question: "Which brands are customers switching to from Bugaboo in prams?"
    sql: |
      SELECT to_brand, SUM(switch_count) as switches, AVG(switch_rate) as rate
      FROM DT_BRAND_SWITCHING
      WHERE from_brand = 'Bugaboo' AND category = 'Prams & Strollers'
      GROUP BY to_brand ORDER BY switches DESC

  - question: "What is the weeks of cover for Bugaboo by state?"
    sql: |
      SELECT state, AVG(weeks_of_cover) as avg_woc
      FROM DT_SELLTHROUGH_WEEKLY
      WHERE supplier_name = 'Bugaboo' AND fiscal_week = (SELECT MAX(fiscal_week) FROM DT_SELLTHROUGH_WEEKLY)
      GROUP BY state ORDER BY avg_woc DESC
```

---

## Infrastructure & Performance

### Warehouse Strategy

| Warehouse | Size | Purpose |
|-----------|------|---------|
| DEMO_LOAD_WH | MEDIUM | Data generation & loading |
| DEMO_ANALYTICS_WH | SMALL | API queries (mostly hitting Dynamic Tables) |
| DEMO_AI_WH | SMALL | Cortex Agent & LLM function calls |

### Performance Optimizations
- **Clustering Keys:** FACT_TRANSACTION_LINES clustered on (date_key, store_key, product_key)
- **Dynamic Tables:** Target lag = 1 hour (downstream of facts)
- **Search Optimization:** On product_name, brand_name for text searches
- **React Query Caching:** `staleTime: 5 * 60 * 1000` (5 min) for dashboard data
- **Skeleton Loaders:** Every page shows skeleton UI while data loads
- **Prefetching:** Adjacent routes prefetched on hover for instant navigation

---

## Security Model & Data Sharing Architecture

### Two-Account Setup

```
┌──────────────────────────────────────────────────────────────────────┐
│  ACCOUNT A — RETAILER (Baby Mart)                                     │
│                                                                        │
│  ACCOUNTADMIN                                                          │
│       │                                                                │
│  BABY_MART_ADMIN                                                       │
│       ├── CATEGORY_MANAGER_ROLE                                        │
│       │      └── Access: All data, battlecards, competitive intel      │
│       │         (Product 2 — internal use only)                        │
│       └── DATA_SHARE_ADMIN_ROLE                                        │
│              └── Manages outbound shares to supplier accounts          │
│                                                                        │
│  SHARE: SUPPLIER_PERFORMANCE_SHARE                                     │
│  ├── VW_SUPPLIER_SELLTHROUGH (filtered by supplier_key)                │
│  ├── VW_SUPPLIER_SEGMENTS (filtered by supplier_key)                   │
│  ├── VW_SUPPLIER_SWITCHING (filtered by supplier_key)                  │
│  └── VW_SUPPLIER_INVENTORY (filtered by supplier_key)                  │
│                                                                        │
│  Shared to: ACCOUNT B (Bugaboo), ACCOUNT C (Huggies), etc.            │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  ACCOUNT B — SUPPLIER (Bugaboo)                                       │
│                                                                        │
│  MOUNTED DATABASE: BABY_MART_PERFORMANCE                               │
│  └── Can query their own performance data directly                     │
│  └── Can build their own dashboards/apps on top                        │
│  └── No data copying — always fresh from retailer                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Sharing SQL (Demo Setup)

```sql
-- On Retailer Account (A)
CREATE SHARE SUPPLIER_PERFORMANCE_SHARE;
GRANT USAGE ON DATABASE BABY_MART_DEMO TO SHARE SUPPLIER_PERFORMANCE_SHARE;
GRANT USAGE ON SCHEMA BABY_MART_DEMO.ANALYTICS TO SHARE SUPPLIER_PERFORMANCE_SHARE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SELLTHROUGH TO SHARE SUPPLIER_PERFORMANCE_SHARE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SEGMENTS TO SHARE SUPPLIER_PERFORMANCE_SHARE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SWITCHING TO SHARE SUPPLIER_PERFORMANCE_SHARE;

-- Add supplier's account to the share
ALTER SHARE SUPPLIER_PERFORMANCE_SHARE ADD ACCOUNTS = <SUPPLIER_ACCOUNT_LOCATOR>;

-- On Supplier Account (B)
CREATE DATABASE BABY_MART_PERFORMANCE FROM SHARE <RETAILER_ACCOUNT>.SUPPLIER_PERFORMANCE_SHARE;
```

### Demo Simplification Option
If two accounts are too complex to manage on demo day, the demo can run on a **single account** with role-based simulation:
- Switch between `CATEGORY_MANAGER_ROLE` and `SUPPLIER_BUGABOO_ROLE` using the UI dropdown
- Show the data sharing SQL as a "this is how it works in production" explanation
- The secure views still enforce row-level filtering regardless

---

## Deployment Architecture (Demo Day)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  RETAILER SIDE (Baby Mart — Account A)                                             │
│                                                                                     │
│  ┌────────────────────────────┐       ┌──────────────────────────────────────────┐ │
│  │ React App (localhost:5173) │──────▶│ Snowflake Account A                       │ │
│  │ Category Manager Battlecard│       │ - BABY_MART_DEMO database                 │ │
│  └────────────────────────────┘       │ - Dynamic Tables, Cortex Agent            │ │
│                                        │ - Semantic Model, AI functions             │ │
│  ┌────────────────────────────┐       │                                            │ │
│  │ FastAPI Proxy (port 3001)  │──────▶│ APPLICATION PACKAGE:                       │ │
│  │ Handles auth + SSE proxy   │       │   SUPPLIER_PORTAL_APP_PACKAGE              │ │
│  └────────────────────────────┘       │   (Streamlit + Shared Data + Agent Access) │ │
│                                        └────────────────────────┬─────────────────┘ │
└────────────────────────────────────────────────────────────────┼───────────────────┘
                                                                  │
                                                                  │ Native App
                                                                  │ (Private Listing)
                                                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  SUPPLIER SIDE (Bugaboo — Account B)                                               │
│                                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ INSTALLED NATIVE APP: BABY_MART_SUPPLIER_PORTAL                               │  │
│  │                                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Streamlit UI (runs inside the app)                                       │  │  │
│  │  │ - Sellthrough Dashboard                                                  │  │  │
│  │  │ - Customer Segments                                                      │  │  │
│  │  │ - Brand Switching (Sankey)                                               │  │  │
│  │  │ - AI Agent Chat (agent runs inside the app)                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                                │  │
│  │  Cortex Agent (included in app — runs on supplier's compute):                  │  │
│  │  - SUPPLIER_COMMS_AGENT (answers supplier questions about their performance)   │  │
│  │  - Uses Semantic View for natural language → SQL                               │  │
│  │                                                                                │  │
│  │  Semantic View (included in app — powers the agent + ad-hoc queries):          │  │
│  │  - Defines metrics, dimensions, verified queries over shared data              │  │
│  │  - Supplier can ask questions in plain English                                 │  │
│  │                                                                                │  │
│  │  Shared Data (included in app package — secure views, supplier-filtered):      │  │
│  │  - VW_SUPPLIER_SELLTHROUGH                                                     │  │
│  │  - VW_SUPPLIER_SEGMENTS                                                        │  │
│  │  - VW_SUPPLIER_SWITCHING                                                       │  │
│  │  - VW_SUPPLIER_INVENTORY                                                       │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Why Native App (not just Data Sharing)?
- **App + Data + AI together:** Supplier gets the dashboard, the data, AND a Cortex Agent + Semantic View in one install
- **Bring the app to the data:** Everything runs inside the supplier's account, on their compute
- **Governed:** Retailer controls what's visible; can version and update the app (and agent) centrally
- **Semantic View as interface:** Supplier can ask questions in plain English — the semantic view translates to SQL over their shared data
- **Agent as communication channel:** The Cortex Agent is the retailer's automated analyst, running inside the supplier's environment
- **Monetizable:** In production, this could be listed on Snowflake Marketplace
- **Demo wow factor:** Shows Native App + Cortex Agent + Semantic View all working together cross-account

### Fallback Strategy
- If Native App setup is too complex for demo day, fall back to a simple data share + local Streamlit
- Pre-cached JSON responses in retailer React app `/public/mock/` for offline fallback
- Environment variable `VITE_USE_MOCK=true` to switch to local data

---

## Native App Package Structure (Supplier Portal)

Following the [Snowflake Native App quickstart pattern](https://www.snowflake.com/en/developers/guides/data-collaboration-native-app/):

```sql
-- Application Package (created on retailer account)
CREATE APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;

-- Stage for app assets
CREATE SCHEMA SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS;
CREATE STAGE SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE;

-- Upload files to stage:
-- manifest.yml
-- scripts/setup.sql
-- streamlit/                (Streamlit app files)
-- semantic/                 (Semantic view YAML definition)
-- agent/                    (Agent definition + system prompt)
-- shared_data/              (views/procedures for supplier data access)
```

### manifest.yml
```yaml
manifest_version: 1
version:
  name: v1
  label: "Supplier Portal v1.0"
  comment: "Baby Mart Supplier Sellthrough Intelligence — includes data, dashboards, semantic view, and AI agent"

artifacts:
  setup_script: scripts/setup.sql
  default_streamlit: streamlit/supplier_portal.py

configuration:
  log_level: INFO
```

### scripts/setup.sql
```sql
CREATE APPLICATION ROLE IF NOT EXISTS app_user;
CREATE SCHEMA IF NOT EXISTS APP_CODE;

-- ═══════════════════════════════════════════════════════
-- SHARED DATA VIEWS (supplier-filtered performance data)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE VIEW APP_CODE.SELLTHROUGH AS
  SELECT * FROM SHARED_DATA.VW_SUPPLIER_SELLTHROUGH;

CREATE OR REPLACE VIEW APP_CODE.SEGMENTS AS
  SELECT * FROM SHARED_DATA.VW_SUPPLIER_SEGMENTS;

CREATE OR REPLACE VIEW APP_CODE.SWITCHING AS
  SELECT * FROM SHARED_DATA.VW_SUPPLIER_SWITCHING;

CREATE OR REPLACE VIEW APP_CODE.INVENTORY AS
  SELECT * FROM SHARED_DATA.VW_SUPPLIER_INVENTORY;

-- ═══════════════════════════════════════════════════════
-- SEMANTIC VIEW (powers natural language queries)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE SEMANTIC VIEW APP_CODE.SUPPLIER_SEMANTIC_VIEW
  AS $$
  name: supplier_sellthrough_intelligence
  description: |
    Semantic view for supplier performance analytics at Baby Mart.
    Enables natural language questions about sell-through, inventory,
    customer segments, and brand switching.

  tables:
    - name: APP_CODE.SELLTHROUGH
      description: Weekly sell-through metrics by brand, category, store
      columns:
        - name: BRAND_NAME
          description: Product brand name
        - name: CATEGORY
          description: Product category
        - name: STORE_NAME
          description: Retail store name
        - name: STATE
          description: Australian state
        - name: FISCAL_WEEK
          description: Fiscal week number
        - name: UNITS_SOLD
          description: Total units sold
          aggregation: sum
        - name: REVENUE
          description: Net revenue in AUD
          aggregation: sum
        - name: SELL_THROUGH_RATE
          description: Units sold / (Opening SOH + Receipts)
          aggregation: avg
        - name: WEEKS_OF_COVER
          description: Current SOH / Average weekly rate of sale
          aggregation: avg
        - name: RATE_OF_SALE
          description: Average units sold per store per week
          aggregation: avg

    - name: APP_CODE.SEGMENTS
      description: Customer segment performance
      columns:
        - name: SEGMENT_NAME
          description: Customer segment (First-time Parents, Gift Buyers, etc.)
        - name: PENETRATION_RATE
          description: Percentage of segment purchasing this brand
        - name: REPEAT_RATE
          description: Percentage of customers who repurchase
        - name: REVENUE_CONTRIBUTION_PCT
          description: Share of total revenue from this segment

    - name: APP_CODE.SWITCHING
      description: Brand switching dynamics
      columns:
        - name: FROM_BRAND
          description: Brand customers switched from
        - name: TO_BRAND
          description: Brand customers switched to
        - name: SWITCH_COUNT
          description: Number of customers who switched
          aggregation: sum
        - name: SWITCH_RATE
          description: Switch rate as percentage
          aggregation: avg

  verified_queries:
    - question: "How are we performing this week vs last week?"
      sql: |
        SELECT fiscal_week, SUM(units_sold) as units, SUM(revenue) as revenue
        FROM APP_CODE.SELLTHROUGH
        WHERE fiscal_year = 2026
        ORDER BY fiscal_week DESC LIMIT 2

    - question: "Which states have low weeks of cover?"
      sql: |
        SELECT state, AVG(weeks_of_cover) as avg_woc
        FROM APP_CODE.SELLTHROUGH
        WHERE fiscal_week = (SELECT MAX(fiscal_week) FROM APP_CODE.SELLTHROUGH)
        GROUP BY state HAVING avg_woc < 5
        ORDER BY avg_woc

    - question: "Which brands are customers switching to from us?"
      sql: |
        SELECT to_brand, SUM(switch_count) as switches, AVG(switch_rate) as rate
        FROM APP_CODE.SWITCHING
        GROUP BY to_brand ORDER BY switches DESC
  $$;

-- ═══════════════════════════════════════════════════════
-- CORTEX AGENT (AI-powered supplier communication)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE CORTEX AGENT APP_CODE.SUPPLIER_COMMS_AGENT
  MODEL = 'claude-3-5-sonnet'
  SYSTEM_PROMPT = $$
    You are a retail supply chain analyst for Baby Mart, communicating with
    a supplier about their product performance. You should:
    - Summarize sell-through vs plan, vs last week, vs last year
    - Flag overstock (>10 WOC) and understock (<4 WOC) risks
    - Recommend PO adjustments with specific quantities
    - Suggest stock rebalancing between stores
    - Be concise, data-driven, and actionable
    - Include specific numbers (units, $, %) in every statement
    - When asked "why" questions, query the data and provide evidence-based answers
  $$
  TOOLS = (
    SEMANTIC_VIEW => APP_CODE.SUPPLIER_SEMANTIC_VIEW
  );

-- ═══════════════════════════════════════════════════════
-- STREAMLIT APP (supplier-facing UI)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE STREAMLIT APP_CODE.SUPPLIER_PORTAL
  FROM 'streamlit'
  MAIN_FILE = 'supplier_portal.py';

-- ═══════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════
GRANT USAGE ON SCHEMA APP_CODE TO APPLICATION ROLE app_user;
GRANT SELECT ON ALL VIEWS IN SCHEMA APP_CODE TO APPLICATION ROLE app_user;
GRANT USAGE ON STREAMLIT APP_CODE.SUPPLIER_PORTAL TO APPLICATION ROLE app_user;
GRANT USAGE ON SEMANTIC VIEW APP_CODE.SUPPLIER_SEMANTIC_VIEW TO APPLICATION ROLE app_user;
GRANT USAGE ON CORTEX AGENT APP_CODE.SUPPLIER_COMMS_AGENT TO APPLICATION ROLE app_user;
```

### Shared Content Data (included in package)
```sql
-- Add shared data to the application package
CREATE SCHEMA SUPPLIER_PORTAL_APP_PACKAGE.SHARED_DATA;

CREATE OR REPLACE VIEW SUPPLIER_PORTAL_APP_PACKAGE.SHARED_DATA.VW_SUPPLIER_SELLTHROUGH AS
  SELECT * FROM BABY_MART_DEMO.ANALYTICS.DT_SELLTHROUGH_WEEKLY
  WHERE supplier_key = <SUPPLIER_KEY>;  -- Parameterized per listing

GRANT USAGE ON SCHEMA SUPPLIER_PORTAL_APP_PACKAGE.SHARED_DATA
  TO SHARE IN APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
```

### Version & Distribution
```sql
-- Create version
ALTER APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE
  ADD VERSION v1
  USING '@SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE';

-- Set release directive
ALTER APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE
  SET DEFAULT RELEASE DIRECTIVE VERSION = v1 PATCH = 0;

-- Create private listing (via UI or SQL) → share to supplier account
```

---

## Deployment Checklist

```
RETAILER ACCOUNT (A):
[ ] 1. Create database BABY_MART_DEMO with schemas (RAW, CURATED, ANALYTICS, AI, APP)
[ ] 2. Create warehouses (LOAD, ANALYTICS, AI)
[ ] 3. Run data generation scripts → load all tables
[ ] 4. Create Dynamic Tables (6 DTs with appropriate target lag)
[ ] 5. Create Secure Views with supplier filtering
[ ] 6. Upload semantic model YAML to stage
[ ] 7. Create Cortex Agent with tool bindings
[ ] 8. Create APPLICATION PACKAGE (SUPPLIER_PORTAL_APP_PACKAGE)
[ ] 9. Upload manifest.yml, setup.sql, Streamlit files to app stage
[ ] 10. Add shared data (secure views) to the package
[ ] 11. Create version + release directive
[ ] 12. Create private listing → share to supplier account
[ ] 13. Build retailer React app (Category Manager Battlecard)
[ ] 14. Set up FastAPI proxy for retailer app
[ ] 15. Create weekly Task for agent execution

SUPPLIER ACCOUNT (B):
[ ] 16. Install Native App from private listing
[ ] 17. Grant necessary privileges (warehouse usage)
[ ] 18. Verify Streamlit portal loads with supplier-filtered data

TESTING:
[ ] 19. End-to-end smoke test (both accounts)
[ ] 20. Demo rehearsal with timing
[ ] 21. Test on projector resolution (1920x1080)
```

---

## File Structure (Local Development)

```
/Users/jarrychen/Code/retail_accelerate_demo/
├── PLANNING.md
├── ARCHITECTURE.md
│
├── retailer/                              ← RETAILER (Account A) code
│   ├── frontend/                          ← React app (Category Manager Battlecard)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── public/
│   │   │   └── mock/                     (fallback JSON for offline demo)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── routes.tsx
│   │       ├── components/
│   │       │   ├── layout/
│   │       │   ├── charts/
│   │       │   ├── ai/
│   │       │   └── shared/
│   │       ├── pages/
│   │       │   ├── CLVPage.tsx
│   │       │   ├── ElasticityPage.tsx
│   │       │   ├── CompetitivePage.tsx
│   │       │   └── BattlecardPage.tsx
│   │       ├── hooks/
│   │       ├── api/
│   │       ├── types/
│   │       └── lib/
│   ├── backend/                           ← FastAPI proxy for retailer React app
│   │   ├── requirements.txt
│   │   ├── main.py
│   │   ├── routes/
│   │   │   ├── battlecard.py
│   │   │   ├── clv.py
│   │   │   ├── elasticity.py
│   │   │   ├── competitive.py
│   │   │   └── agent.py
│   │   └── services/
│   │       ├── snowflake_client.py
│   │       └── agent_client.py
│   ├── sql/                               ← DDL scripts for retailer account
│   │   ├── 00_setup_infrastructure.sql
│   │   ├── 01_create_tables.sql
│   │   ├── 02_create_dynamic_tables.sql
│   │   ├── 03_create_secure_views.sql
│   │   ├── 04_create_tasks.sql
│   │   └── 05_create_agent.sql
│   ├── data_generation/
│   │   ├── 01_generate_dimensions.py
│   │   ├── 02_generate_transactions.py
│   │   ├── 03_generate_inventory.py
│   │   ├── 04_generate_promotions.py
│   │   ├── 05_generate_competitor_pricing.py
│   │   └── 06_generate_brand_switching.py
│   ├── semantic_model/
│   │   └── baby_mart_semantic_model.yaml
│   └── agent/
│       ├── agent_definition.sql
│       ├── system_prompt.txt
│       └── tools/
│
├── supplier/                              ← SUPPLIER (Account B) Native App
│   ├── manifest.yml                       ← Native App manifest
│   ├── scripts/
│   │   └── setup.sql                     ← App setup (views, semantic view, agent, streamlit, grants)
│   ├── streamlit/                         ← Streamlit UI (runs inside native app)
│   │   ├── supplier_portal.py            ← Main Streamlit app
│   │   ├── pages/
│   │   │   ├── 1_sellthrough.py
│   │   │   ├── 2_customer_segments.py
│   │   │   ├── 3_brand_switching.py
│   │   │   └── 4_ai_comms.py            ← Chat UI calling the in-app Cortex Agent
│   │   ├── utils/
│   │   │   ├── charts.py
│   │   │   └── data.py
│   │   └── environment.yml               ← Conda env for Streamlit (plotly, etc.)
│   ├── semantic/
│   │   └── supplier_semantic_view.sql    ← Semantic View DDL (metrics, dimensions, verified queries)
│   ├── agent/
│   │   ├── agent_definition.sql          ← CREATE CORTEX AGENT DDL
│   │   └── system_prompt.txt             ← Agent system prompt (supplier-facing tone)
│   ├── shared_data/
│   │   └── create_shared_views.sql       ← Secure views included in package
│   └── sql/
│       ├── 01_create_app_package.sql     ← Creates APPLICATION PACKAGE
│       ├── 02_upload_assets.sql          ← Puts files to stage
│       ├── 03_create_version.sql         ← Version + release directive
│       └── 04_create_listing.sql         ← Private listing to supplier account
│
└── design/                                ← Design assets
    ├── retailer_mockup.html              ← Category Manager UI mockup
    └── supplier_mockup.html              ← Supplier Portal UI mockup
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Retailer frontend | React + Vite + TypeScript | Production-grade UI for internal tool; conference-worthy polish |
| Supplier frontend | Streamlit in Native App | Runs inside supplier's Snowflake; no external hosting needed; demonstrates Native App Framework |
| Retailer API layer | FastAPI (Python) | Snowflake connector support, SSE proxying for Cortex Agent |
| Supplier data access | Shared content data in app package | Zero-copy, governed, versionable |
| Distribution | Private Listing (Native App) | Demonstrates Snowflake Marketplace pattern |
| Brand switching viz | Plotly (both React + Streamlit) | Sankey diagrams work in both frameworks |
| Agent model | claude-3-5-sonnet | Best quality for natural language generation |
| Aggregation layer | Dynamic Tables | Shows Snowflake-native incremental processing |
| Promo decomposition | Statistical model (pre-computed) | Baseline estimation via pre/post comparison |
| Competitor data | Pre-loaded mock table | Simulates scraping without external dependencies |
| Offline fallback | Mock JSON (retailer), pre-loaded data (supplier) | Insurance against venue wifi issues |
