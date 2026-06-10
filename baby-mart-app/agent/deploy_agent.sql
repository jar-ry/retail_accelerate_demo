-- ============================================================
-- Baby Mart Category Manager Agent - Deployment Script
-- ============================================================
-- Run this script to recreate the agent and evaluation dataset
-- Requires: ACCOUNTADMIN role, BABY_MART_DEMO database
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BABY_MART_DEMO;
USE SCHEMA AI;

-- Create a warehouse for AI evaluations (if not exists)
CREATE WAREHOUSE IF NOT EXISTS RETAIL_AI_EVAL_WH
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE;

-- ============================================================
-- 1. CREATE THE AGENT
-- ============================================================

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT
  COMMENT = 'Category intelligence agent for Baby Mart retail analytics'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto

  instructions:
    response: |
      You are a direct, data-driven assistant for Baby Mart Category Managers.
      Lead every answer with the most important number or KPI.
      **Bold** critical metrics: growth %, margin %, rate of sale, price gap.
      Keep commentary minimal — let the data speak.
      End every response with 1-2 suggested next steps or follow-up questions the user could explore.
      Use AUD for dollar values. Use percentages for growth, margin, and share.
      No filler, no pleasantries — get straight to the answer.
    orchestration: |
      Route ALL data questions (sales, margin, growth, pricing, promotions, segments, CLV, brand switching, DIFOT) to the category_intelligence tool.
      For multi-part questions, make separate tool calls and synthesize results into one answer.
      If a question is ambiguous on brand, category, time period, or state — ask ONE clarifying question before querying.
      Never guess or fabricate data. If the tool returns no results, say so clearly.

  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "category_intelligence"
        description: "Analyzes Baby Mart retail performance data including sales/revenue by brand/category/store/state, year-over-year growth, margins, rate of sale, competitive pricing gaps, promotional effectiveness by mechanic, customer segment performance, customer lifetime value (CLV), brand switching patterns, and supplier DIFOT (delivery in full on time). Use this tool for any question about sales, revenue, units, margins, promotions, competitors, segments, CLV, brand switching, or supplier performance."
    - tool_spec:
        type: "web_search"
        name: "Web Search"

  tool_resources:
    category_intelligence:
      execution_environment:
        type: warehouse
        warehouse: RETAIL_AI_EVAL_WH
      semantic_view: "BABY_MART_DEMO.ANALYTICS.CATEGORY_INTELLIGENCE_VIEW"
    Web Search:
      max_results: 10
  $$;

-- ============================================================
-- 2. CREATE EVALUATION DATASET TABLE
-- ============================================================

CREATE OR REPLACE TABLE BABY_MART_DEMO.AI.EVAL_DATASET_CATEGORY_MANAGER (
  INPUT_QUERY VARCHAR,
  GROUND_TRUTH VARIANT
);

-- Insert evaluation questions with ground truth
INSERT INTO BABY_MART_DEMO.AI.EVAL_DATASET_CATEGORY_MANAGER (INPUT_QUERY, GROUND_TRUTH)
SELECT column1, PARSE_JSON(column2) FROM VALUES
('What are the top selling brands?', '{"ground_truth_output":"The agent should ask a clarifying question because the query is ambiguous - it does not specify category, time period, or metric (units vs revenue). Per its instructions, it should ask ONE clarifying question before querying. The response should NOT return data without first asking for specifics."}'),
('What is the total revenue for the Prams & Strollers category in fiscal year 2025?', '{"ground_truth_output":"The agent should query revenue data filtered to Prams & Strollers category and fiscal year 2025. Response should lead with the total revenue figure in AUD, bold the key metric, and suggest next steps."}'),
('Show me the year-over-year growth for Nappies & Wipes by brand.', '{"ground_truth_output":"The agent should query sellthrough or revenue data for the Nappies & Wipes category by brand across fiscal years, calculate YoY growth percentages, bold the key growth metrics, and suggest follow-up questions. Response should be in AUD for any dollar values and percentages for growth."}'),
('Which brand has the highest margin percentage in the Car Seats category?', '{"ground_truth_output":"The agent should query margin data for Car Seats and identify the top brand by margin percentage. Response should bold the brand name and margin percentage, and suggest follow-up analysis."}'),
('What is the DIFOT performance for Huggies in fiscal year 2026?', '{"ground_truth_invocations":[{"tool_input":"What is the DIFOT performance for Huggies in fiscal year 2026?","tool_name":"category_intelligence"}],"ground_truth_output":"The agent should query supplier DIFOT data filtered to Huggies brand and fiscal year 2026, returning delivery performance metrics. Response should bold the DIFOT percentage."}'),
('What promotion mechanics does Huggies use in the Nappies & Wipes category?', '{"ground_truth_invocations":[{"tool_input":"What promotion mechanics does Huggies use in Nappies & Wipes?","tool_name":"category_intelligence"}],"ground_truth_output":"The agent should query promotional effectiveness data filtered to Huggies brand and Nappies & Wipes category to list promotion mechanics. Mechanics include % Off, Bundle, GWP, BOGO, and Multi-buy. Response should list the mechanics clearly."}'),
('What promotion mechanics are used for Bugaboo in the Prams & Strollers category?', '{"ground_truth_invocations":[{"tool_input":"What promotion mechanics are used for Bugaboo in Prams & Strollers?","tool_name":"category_intelligence"}],"ground_truth_output":"The agent should query promotional effectiveness data filtered to Bugaboo brand and Prams & Strollers category to list the specific promotion mechanics used."}'),
('Which brands are losing the most customers in the Nappies & Wipes category based on brand switching data?', '{"ground_truth_invocations":[{"tool_input":"Which brands are losing the most customers in Nappies & Wipes based on brand switching?","tool_name":"category_intelligence"}],"ground_truth_output":"The agent should query brand switching data for Nappies & Wipes, identifying brands with highest outgoing switch counts (FROM_BRAND). Response should bold key brand names and metrics."}'),
('Which brand are customers switching to most in the Car Seats category?', '{"ground_truth_output":"The agent should query brand switching data for Car Seats, aggregate by TO_BRAND to find the brand receiving the most customer switches. Response should bold the brand name and switch count, and suggest follow-up questions about switching patterns."}'),
('Which customer segment spends the most on Prams & Strollers?', '{"ground_truth_output":"The agent should query customer segment performance data for Prams & Strollers and identify the highest-spending segment. Segments include First-time Parents, Second-time Parents, Gift Buyers, Grandparents, Expecting, and Registry Shoppers. Response should bold the segment name and key spending metric in AUD."}'),
('Compare competitive pricing for Car Seats brands at Coles versus Woolworths in fiscal year 2025.', '{"ground_truth_output":"The agent should query competitive positioning data filtered to Car Seats, Coles and Woolworths competitors, and fiscal year 2025. Response should present pricing comparisons between the two retailers with bold key price gaps in AUD or percentages."}'),
('How many stores sell Clothing products in Victoria?', '{"ground_truth_output":"The agent should query the sellthrough data filtered to Clothing category and VIC state to count distinct stores. Response should lead with the store count number."}'),
('Which stores in QLD carry Prams & Strollers brands?', '{"ground_truth_output":"The agent should query the sellthrough data filtered to QLD state and Prams & Strollers category to list distinct store names. Response should provide the store names clearly."}'),
('List the brands in the Feeding category that are sold in NSW stores in Metro regions.', '{"ground_truth_invocations":[{"tool_input":"List brands in Feeding category sold in NSW Metro stores","tool_name":"category_intelligence"}],"ground_truth_output":"The agent should query sellthrough data filtered to Feeding category, NSW state, and Metro region to list distinct brand names."}'),
('Tell me about the weather forecast for Sydney this week.', '{"ground_truth_output":"The agent should decline this request and state that weather information is outside its capabilities. It should explain it only handles Baby Mart category performance analytics (sales, margins, growth, pricing, promotions, CLV, brand switching, DIFOT). It should NOT fabricate weather data and should suggest what questions it can help with."}')
;

-- ============================================================
-- 3. CREATE EVAL SOURCE TABLE (simplified format)
-- ============================================================

CREATE OR REPLACE TABLE BABY_MART_DEMO.AI.EVAL_SOURCE_CATEGORY_MANAGER (
  INPUT_QUERY VARCHAR,
  GROUND_TRUTH_DATA VARIANT
);

INSERT INTO BABY_MART_DEMO.AI.EVAL_SOURCE_CATEGORY_MANAGER
SELECT INPUT_QUERY, GROUND_TRUTH FROM BABY_MART_DEMO.AI.EVAL_DATASET_CATEGORY_MANAGER;

-- ============================================================
-- 4. VERIFICATION
-- ============================================================

-- Verify agent exists
SHOW AGENTS IN SCHEMA BABY_MART_DEMO.AI;

-- Verify eval dataset
SELECT COUNT(*) AS eval_questions FROM BABY_MART_DEMO.AI.EVAL_DATASET_CATEGORY_MANAGER;

-- Quick test (uncomment to run)
-- SELECT SNOWFLAKE.CORTEX.AGENT_RUN(
--   'BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT',
--   '{"messages": [{"role": "user", "content": [{"type": "text", "text": "What is the total revenue for Huggies?"}]}]}'
-- );
