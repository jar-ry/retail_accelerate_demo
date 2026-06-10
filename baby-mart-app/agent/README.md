# Category Manager Agent

## Overview

The Category Manager Agent (`BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT`) is a Cortex Agent that provides natural-language access to Baby Mart's retail analytics. It uses a semantic view as its data tool and can answer questions about sales, margins, growth, competitive pricing, promotions, customer segments, CLV, brand switching, and supplier DIFOT.

## Files

| File | Description |
|------|-------------|
| `agent_spec.json` | Full agent configuration (exported from Snowflake) |
| `eval_dataset.json` | 15 evaluation questions with ground truth expectations |
| `deploy_agent.sql` | SQL script to recreate agent + eval tables from scratch |

## Deploying

```sql
-- Run the deployment script
!source deploy_agent.sql
```

Or execute in Snowsight / CLI:
```bash
snow sql -f agent/deploy_agent.sql --connection JCHEN_AWS1
```

## Agent Configuration Summary

- **Model**: `auto` (Snowflake selects best available)
- **Tool**: `cortex_analyst_text_to_sql` → `BABY_MART_DEMO.ANALYTICS.CATEGORY_INTELLIGENCE_VIEW`
- **Warehouse**: `RETAIL_AI_EVAL_WH`
- **Web Search**: Enabled (for out-of-scope questions about market context)

### Instructions Style
- Response: Direct, data-first, bold key metrics, suggest follow-ups
- Orchestration: Route all data questions to semantic view tool, ask clarifying questions when ambiguous, never fabricate data

## Evaluation Dataset

15 questions covering:
- Sales/revenue queries (3)
- Growth analysis (1)
- Competitive pricing (1)
- Promotional effectiveness (2)
- Brand switching (2)
- Customer segments (1)
- DIFOT (1)
- Store/geography queries (3)
- Out-of-scope rejection (1) — weather question
- Ambiguity handling (1) — vague "top brands" question

## Running Evaluations

Use the Cortex Agent evaluation framework:
```sql
-- Via Snowsight: AI & ML → Cortex Agents → Select agent → Evaluate
-- Or via the Cortex Agent skill in Cortex Code
```
