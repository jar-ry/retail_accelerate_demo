---
name: bootstrap-demo
description: "Bootstrap the Baby Mart Supplier Collaboration Platform demo on a new Snowflake account. Use when: setting up the demo for the first time, onboarding a colleague, deploying to a new account. Triggers: bootstrap, setup demo, deploy demo, onboard, new account setup, get started, install demo."
---

# Bootstrap Baby Mart Demo

Sets up the complete Baby Mart Supplier Collaboration Platform on a fresh Snowflake account. Walks through data creation, agent deployment, and app deployment.

## Prerequisites

Before starting, confirm the user has:
- A **paid** Snowflake account (App Runtime doesn't work on trial accounts)
- **ACCOUNTADMIN** role access
- **Snowflake CLI 3.19+** installed (`snow --version`)
- **Node.js 22+** installed (`node --version`)
- This repo cloned locally

## Workflow

### Step 1: Verify Environment

Run these checks:
```bash
snow --version    # Need 3.19+
node --version    # Need 22+
snow connection test --connection <CONNECTION_NAME>
```

If CLI is < 3.19, user needs: `pip install --upgrade snowflake-cli`

Ask user for their **Snowflake connection name** (from `~/.snowflake/connections.toml`).

**STOP**: Confirm connection works before proceeding.

### Step 2: Create Database & Infrastructure

Run the SQL setup scripts in order:
```bash
snow sql -f retailer/sql/00_setup_infrastructure.sql --connection <CONNECTION>
snow sql -f retailer/sql/01_create_tables.sql --connection <CONNECTION>
```

This creates:
- Database: `BABY_MART_DEMO` with schemas (RAW, CURATED, ANALYTICS, AI, APP)
- Warehouses: DEMO_LOAD_WH, DEMO_ANALYTICS_WH, DEMO_AI_WH
- Tables: DIM_CUSTOMER (150K), DIM_PRODUCT (1600), DIM_BRAND (25), DIM_STORE (60), DIM_SUPPLIER (25), FACT_TRANSACTION_LINES (500K), FACT_INVENTORY (1.1M), FACT_COMPETITOR_PRICING (19K)

### Step 3: Create Analytics Layer

```bash
snow sql -f retailer/sql/02_create_dynamic_tables.sql --connection <CONNECTION>
snow sql -f retailer/sql/03_create_secure_views.sql --connection <CONNECTION>
```

This creates:
- Dynamic tables: DT_SELLTHROUGH_WEEKLY, DT_CLV_BY_BRAND, DT_COMPETITIVE_POSITION, DT_PROMOTIONAL_EFFECTIVENESS, DT_CUSTOMER_SEGMENT_PERFORMANCE, DT_BRAND_SWITCHING
- Secure views for supplier data sharing
- Demand rollup views (V_DEMAND_ROLLUP, V_STORE_DEMAND_WEEKLY)

### Step 4: Create Semantic View

The semantic view is required for the Cortex Agent. It should already exist from the secure views script — verify:
```sql
SHOW SEMANTIC VIEWS IN DATABASE BABY_MART_DEMO;
-- Should show: CATEGORY_INTELLIGENCE_VIEW
```

If missing, run:
```bash
snow sql -f native_app/sql/03_create_semantic_view.sql --connection <CONNECTION>
```

### Step 5: Deploy the Cortex Agent

```bash
snow sql -f baby-mart-app/agent/deploy_agent.sql --connection <CONNECTION>
```

Verify:
```sql
SHOW AGENTS IN SCHEMA BABY_MART_DEMO.AI;
-- Should show: CATEGORY_MANAGER_AGENT
```

### Step 6: Deploy the Web App (App Runtime)

```bash
cd baby-mart-app
npm install
snow app setup --app-name BABY_MART_APP --connection <CONNECTION>
snow app deploy --connection <CONNECTION>
```

The deploy takes ~3-5 minutes (upload → remote build → service start → endpoint provision).

Output will show the live URL: `https://<id>-<org>-<account>.snowflakecomputing.app`

**STOP**: Verify the app loads in browser.

### Step 7: Verify End-to-End

Open the app URL and check:
1. **Dashboard** loads with revenue/margin KPIs from live Snowflake data
2. Click a **brand** → SKU Performance page loads
3. Switch to **Supply Chain Planner** → Replenishment dashboard loads
4. Switch to **Campaign Manager** → Audience Builder loads
5. **Agent page** → Ask "What is the top brand by revenue?" → gets a response

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `snow app setup` says "No such command" | CLI too old. Run `pip install --upgrade snowflake-cli` and use `/opt/miniconda3/bin/snow` if system `snow` is outdated |
| App deploy fails with "Cannot find module tailwindcss" | All build deps must be in `dependencies` (not devDependencies) in package.json |
| App deploy fails with bracket paths | Use `code_stage` in snowflake.yml instead of `code_workspace` |
| Agent returns errors | Verify semantic view exists: `SHOW SEMANTIC VIEWS IN DATABASE BABY_MART_DEMO` |
| Dashboard shows NaN | API route may not connect to Snowflake — check App Runtime logs: `snow app events --connection <CONNECTION>` |

## Redeploy After Changes

```bash
cd baby-mart-app
snow app deploy --connection <CONNECTION>
```

App Runtime upgrades in-place — URL stays the same.

## Output

A fully working demo with:
- Live web app at a Snowflake-managed URL
- Cortex Agent answering natural language questions
- 3 personas: Category Manager, Supply Chain Planner, Campaign Manager
- All data in `BABY_MART_DEMO` database
