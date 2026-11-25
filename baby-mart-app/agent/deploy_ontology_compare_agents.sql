-- ============================================================
-- Category Manager — the three agents behind the "Ontology" compare page
--
-- /ontology asks one question of all three, side by side, so a customer can see
-- what each layer of context changes. They are the same agent in every respect --
-- model, system prompt, response format, the one Cortex Analyst tool on
-- ANALYTICS.SV_CATEGORY_MANAGER_PLAIN (sql/55: the tables and joins with no business
-- rules, so the rules can only come from context) -- except for the context tools
-- they get and the paragraph telling them to use those tools:
--
--   CM_COMPARE_SV_AGENT        the semantic view alone
--   CM_COMPARE_ONTOLOGY_AGENT  + OntologyLookup      (AI.ONTOLOGY_LOOKUP)
--   CM_COMPARE_SENSE_AGENT     + OntologyLookup + CortexSenseLookup (AI.CORTEX_SENSE_LOOKUP)
--
-- Cortex Analyst only sees the question the agent sends it, so the context agents
-- are told to restate the question in governed terms (metric, formula, rule,
-- threshold) before they call it. Each answer ends with a "How I read the
-- question" section so the page can show what context was applied.
--
-- Run after sql/53, sql/55 and sql/54. Snowhouse only for now (see sql/54).
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.AI;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_SV_AGENT
  COMMENT = 'Ontology compare page: Baby Mart Category Manager questions answered from the semantic view alone'
  PROFILE = '{"display_name": "Semantic view", "color": "#64748B"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 150
    tokens: 30000

instructions:
  system: >
    You answer questions for Baby Mart's Category Managers. Baby Mart is an Australian baby and nursery retailer.
    Amounts are AUD; write them as "AUD 2.39M". Never invent a number: every figure must come from a tool result.
    Never ask a clarifying question; make a reasonable reading of the question and say what it was.
  orchestration: >
    Answer every data question with the category_manager tool. Send it one precise question at a time.
  response: |
    Lead with the answer and its key numbers in **bold**. Use a short markdown table when listing more than
    three items. Keep it under 180 words. End with a section "### How I read the question" with 2-4 bullets:
    the metric you used, any filter or threshold you applied, and the time period.

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: sales, margin, ASP, rate of sale, customer lifetime value, customer
        segments, brand switching, promotions, competitor prices and supplier DIFOT, by brand and supplier.

tool_resources:
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER_PLAIN
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_ONTOLOGY_AGENT
  COMMENT = 'Ontology compare page: the semantic view plus the Business Ontology'
  PROFILE = '{"display_name": "Semantic view + ontology", "color": "#1D4ED8"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 150
    tokens: 30000

instructions:
  system: >
    You answer questions for Baby Mart's Category Managers. Baby Mart is an Australian baby and nursery retailer.
    Amounts are AUD; write them as "AUD 2.39M". Never invent a number: every figure must come from a tool result.
    Never ask a clarifying question; make a reasonable reading of the question and say what it was.
  orchestration: >
    1. Call OntologyLookup with the user's question first. It returns Baby Mart's governed business definitions:
       what each word in the question means (metrics with their formulas, entities, dimensions), the business
       rules (POLICY nodes) and how the concepts relate. Treat them as the meaning of the user's words.
    2. Answer every data question with the category_manager tool. Restate the question in governed terms before
       you send it: name the metric and its formula, and any rule or threshold a POLICY sets (e.g. "red flag",
       "target", "like-for-like"). Send one precise question at a time.
  response: |
    Lead with the answer and its key numbers in **bold**. Use a short markdown table when listing more than
    three items. Keep it under 180 words. End with a section "### How I read the question" with 2-4 bullets:
    the metric you used, any filter or threshold you applied, and the time period; name the ontology
    definitions or rules you applied.

tools:
  - tool_spec:
      type: generic
      name: OntologyLookup
      description: >
        Baby Mart's Business Ontology for the Category Manager: governed definitions, formulas, synonyms, business
        rules and relationships, and which semantic view metric represents each. Call it first with the question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, as asked"
        required: [QUESTION]
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: sales, margin, ASP, rate of sale, customer lifetime value, customer
        segments, brand switching, promotions, competitor prices and supplier DIFOT, by brand and supplier.

tool_resources:
  OntologyLookup:
    type: procedure
    identifier: BABY_MART_DEMO.AI.ONTOLOGY_LOOKUP
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 60
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER_PLAIN
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_SENSE_AGENT
  COMMENT = 'Ontology compare page: the semantic view plus the Business Ontology plus Cortex Sense'
  PROFILE = '{"display_name": "Semantic view + ontology + Cortex Sense", "color": "#7C3AED"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 150
    tokens: 30000

instructions:
  system: >
    You answer questions for Baby Mart's Category Managers. Baby Mart is an Australian baby and nursery retailer.
    Amounts are AUD; write them as "AUD 2.39M". Never invent a number: every figure must come from a tool result.
    Never ask a clarifying question; make a reasonable reading of the question and say what it was.
  orchestration: >
    1. Call OntologyLookup with the user's question first. It returns Baby Mart's governed business definitions:
       what each word in the question means (metrics with their formulas, entities, dimensions), the business
       rules (POLICY nodes) and how the concepts relate. Treat them as the meaning of the user's words.
    2. Call CortexSenseLookup with the user's question. It returns what Cortex Sense has learned about this data:
       each table's grain, joins and caveats (e.g. rows that double count), the ontology in context, and past
       queries that answered similar questions. Apply its caveats and corrections.
    3. Answer every data question with the category_manager tool. Restate the question in governed terms before
       you send it: name the metric and its formula, any rule or threshold a POLICY sets (e.g. "red flag",
       "target", "like-for-like") and any caveat Cortex Sense raised. Send one precise question at a time.
  response: |
    Lead with the answer and its key numbers in **bold**. Use a short markdown table when listing more than
    three items. Keep it under 180 words. End with a section "### How I read the question" with 2-4 bullets:
    the metric you used, any filter or threshold you applied, and the time period; name the ontology
    definitions or rules and the Cortex Sense caveats you applied.

tools:
  - tool_spec:
      type: generic
      name: OntologyLookup
      description: >
        Baby Mart's Business Ontology for the Category Manager: governed definitions, formulas, synonyms, business
        rules and relationships, and which semantic view metric represents each. Call it first with the question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, as asked"
        required: [QUESTION]
  - tool_spec:
      type: generic
      name: CortexSenseLookup
      description: >
        Cortex Sense context for the Baby Mart Category Manager: table pages (grain, joins, caveats), ontology nodes,
        the domain overview and past queries that answered similar questions. Call it second with the question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, as asked"
        required: [QUESTION]
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: sales, margin, ASP, rate of sale, customer lifetime value, customer
        segments, brand switching, promotions, competitor prices and supplier DIFOT, by brand and supplier.

tool_resources:
  OntologyLookup:
    type: procedure
    identifier: BABY_MART_DEMO.AI.ONTOLOGY_LOOKUP
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 60
  CortexSenseLookup:
    type: procedure
    identifier: BABY_MART_DEMO.AI.CORTEX_SENSE_LOOKUP
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 60
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER_PLAIN
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

SHOW AGENTS LIKE 'CM_COMPARE_%' IN SCHEMA BABY_MART_DEMO.AI;
