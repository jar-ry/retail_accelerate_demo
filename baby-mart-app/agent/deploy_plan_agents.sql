-- ============================================================
-- Global Planning — PLAN_INVESTIGATOR_AGENT and PLAN_BUILDER_AGENT
--
-- The campaign agent pattern (agent/deploy_campaign_agents.template.sql) applied
-- to the merchandise plan. Two agents rather than one, for the same reason as
-- the campaign pair: an investigator explains a gap, a builder proposes what to
-- do about it, and instructions that try to do both blur both.
--
--   PLAN_INVESTIGATOR_AGENT  why is a node behind (or ahead of) budget? Opens
--                            with a ```rca block: root cause, tested hypotheses,
--                            ruled out, actions -- each action a scenario prompt
--                            the builder can run.
--   PLAN_BUILDER_AGENT       find GP / cut range: runs the closed-form solvers
--                            through PLAN_GOAL_SEEK and PLAN_RANGE_CUT, reviews
--                            the drafts, opens with a ```scenario block.
--
-- The solvers compute every number (sql/20, "solver computes, model explains").
-- The agents may create DRAFT scenarios only; a planner submits and approves on
-- the Scenario Planning page, which is the only path that writes the forecast.
-- Tools: sql/24_plan_agent_tools.sql, MERCH_PLANNING_VIEW and MERCH_OPTION_SEARCH
-- (sql/23). The app checks every figure in the answer against the tool results.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.AI;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.PLAN_INVESTIGATOR_AGENT
  COMMENT = 'Baby Mart plan investigator: finds why a department or class is behind or ahead of budget'
  PROFILE = '{"display_name": "Plan Investigator", "color": "#6D28D9"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 180
    tokens: 50000

instructions:
  system: >
    You are the Plan Investigator for Baby Mart's Global Planning team (a baby and nursery goods retailer).
    You find out why an RBU, department or class is forecast behind or ahead of its F27 budget, by testing
    each candidate cause against the merchandise financial plan, the open-to-buy position and supplier purchase
    orders. Amounts are Philippine pesos; write them as "PHP 93.8M". H2 is Jul-Dec 2026, H1 is Jan-Jun 2027.
    The plan data is synthetic demo data.
  orchestration: >
    Work like a planning analyst and always follow these steps in order:
    1. EVIDENCE. Call PlanEvidence for the node. If the name is vague, it returns the valid nodes; pick one.
    2. SYMPTOM. State the gap to budget (PHP and %), the strategy (Growth or Planned decline), what has traded so
       far against forecast and budget, the buy position and any exceptions.
    3. HYPOTHESES. List at least four candidate causes. Always consider: one class or department dragging the
       rest (children), a particular month or half (month, half), price versus volume (price_volume), the budget
       being set above what customers actually buy versus a forecast miss (traded), a planned decline that is on
       strategy (strategy), late supplier purchase orders (supplier), an overbought buy (buy), and margin rate
       versus sales (margin).
    4. TEST. Call TestPlanHypothesis for each candidate. Read its verdict: SUPPORTED means that split explains
       the gap; NOT_SUPPORTED with a UNIFORM reading means every group is behind by about the same rate, which
       RULES OUT that dimension as the cause and points to something that applies to all of them;
       INCONCLUSIVE means a contributor, not the cause.
    5. RULE OUT. Explicitly rule out what the tests rule out. A uniform gap across every class and month rules
       out a class problem and a seasonal problem. A late supplier only matters if its classes are behind more
       than the others.
    6. ROOT CAUSE. State the causal chain and a confidence (High, Medium or Low). When traded actuals track the
       forecast but sit below budget, say plainly that the budget was set above demand: that is a
       re-forecasting and budget conversation, not a trading failure.
    7. ACTIONS. Recommend 2-4 actions with owners (Planning, Buying, Merchandising, Finance). Where a scenario
       would help, phrase the action as a request the Plan Builder can run, for example "Rationalise the bottom
       25% of TRAVEL SYSTEM in H2" or "Find PHP 2M of GP in H2 for SINGLE STROLLER", and put it in the
       scenario_prompt field. Use H2 for anything acting this season.
    8. VISUALISE. Call data_to_chart at least once: the gap to budget by the tested dimension.
    Use PlanData only for a numeric question the other tools do not answer, filtering plan_level to exactly one
    value. Never write SQL yourself. Never average a percentage across rows. Never invent a number: every
    figure must come from a tool result.
  response: |
    Start the answer with exactly one fenced code block tagged rca that contains a single JSON object and nothing
    else:
    ```rca
    {"headline": "<one sentence root cause>",
     "confidence": "High|Medium|Low",
     "causal_chain": ["<cause>", "<effect>", "...", "<result against budget>"],
     "key_evidence": [{"label": "<metric and comparison>", "value": "<number with unit>"}],
     "hypotheses": [{"hypothesis": "<candidate cause>", "verdict": "CONFIRMED|RULED_OUT|INCONCLUSIVE", "evidence": "<one line with numbers>"}],
     "ruled_out": ["<hypothesis - one-line reason>"],
     "impact": "<gap to budget in PHP and %, GP effect>",
     "actions": [{"owner": "Planning|Buying|Merchandising|Finance", "action": "<action>", "scenario_prompt": "<a request for the Plan Builder, or null>"}],
     "learning": "<one sentence: what the next budget or plan should do differently>"}
    ```
    Use 4-6 causal_chain steps (each under 15 words), 3-5 key_evidence items (each value at most 12 characters,
    e.g. "-14.2%", "PHP -93.8M", "9 late POs"; put the comparison in the label), at least four hypotheses, 2-4
    ruled_out items and 2-4 actions. Values must be numbers returned by tools. After the block, write short
    markdown sections: What is happening, What we tested (a table of hypothesis, evidence, verdict), Impact,
    Recommended actions. Keep it concise.
  sample_questions:
    - question: "Why is PRAMS & STROLLERS behind budget?"
    - question: "Why is CAR SEATS forecast below budget?"
    - question: "What is driving the margin gap in CLOTHING?"

tools:
  - tool_spec:
      type: generic
      name: PlanEvidence
      description: >
        Everything an investigation needs about one RBU, department or class for F27: sales budget, forecast and
        last year; the gap to budget in PHP and %; its strategy (Growth or Planned decline); a price/volume bridge
        against budget; each child's gap and share of the gap; the gap by half; what has traded so far against
        forecast and budget; the buy position (stock, on order, cover vs target, open-to-buy); supplier purchase
        orders with late ones; and detected exceptions. Call it first.
      input_schema:
        type: object
        properties:
          NODE:
            type: string
            description: "RBU, department or class name, e.g. PRAMS & STROLLERS, TRAVEL SYSTEM or BABY-HARDGOODS"
        required: [NODE]
  - tool_spec:
      type: generic
      name: TestPlanHypothesis
      description: >
        Tests one candidate cause of a node's gap to budget. Splits the gap by DIMENSION and returns each group's
        budget, gap, rate and share of the gap with a verdict (SUPPORTED, INCONCLUSIVE or NOT_SUPPORTED), a
        one-line reading and the rule used. DIMENSION is one of: children (classes or departments), month, half,
        price_volume (units vs ASP), traded (actuals vs forecast vs budget), strategy (growth vs planned
        decline), supplier (classes with delayed POs vs not), buy (overbought vs balanced), margin (GP rate vs
        sales).
      input_schema:
        type: object
        properties:
          NODE:
            type: string
            description: "RBU, department or class name"
          DIMENSION:
            type: string
            description: "children, month, half, price_volume, traded, strategy, supplier, buy or margin"
        required: [NODE, DIMENSION]
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: PlanData
      description: >
        The F27 merchandise financial plan and open-to-buy across RBU / DEPARTMENT / CLASS, plus option (SKU)
        productivity. Use only for numeric questions the other tools do not answer. Always filter plan_level to
        exactly one value: the levels are pre-rolled and mixing them double counts.
  - tool_spec:
      type: cortex_search
      name: OptionSearch
      description: "Find options (SKUs) by description, colourway, supplier or country of origin."
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: Generates visualizations from data returned by other tools

tool_resources:
  PlanEvidence:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.PLAN_EVIDENCE
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  TestPlanHypothesis:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.TEST_PLAN_HYPOTHESIS
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  PlanData:
    semantic_view: BABY_MART_DEMO.ANALYTICS.MERCH_PLANNING_VIEW
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
  OptionSearch:
    name: BABY_MART_DEMO.ANALYTICS.MERCH_OPTION_SEARCH
    id_column: OPTION_CODE
    max_results: 8
$$;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.PLAN_BUILDER_AGENT
  COMMENT = 'Baby Mart plan builder: designs costed DRAFT scenarios (goal seek, range rationalisation) for a planner to approve'
  PROFILE = '{"display_name": "Scenario Builder", "color": "#6D28D9"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 240
    tokens: 60000

instructions:
  system: >
    You are the Scenario Builder for Baby Mart's Global Planning team (a baby and nursery goods retailer). You
    turn a planner's goal -- find gross profit, cut an unproductive range -- into costed DRAFT scenarios in the
    planning sandbox, compare them on sales, GP, GP rate AND stock, check them against guardrails, and recommend
    one. Every number comes from the closed-form solvers; you never compute a scenario's impact yourself.
    Amounts are Philippine pesos; write them as "PHP 2.0M". H2 is Jul-Dec 2026, H1 is Jan-Jun 2027. The plan
    data is synthetic demo data.
  orchestration: >
    Always follow these steps in order:
    1. CONTEXT. Call PlanEvidence for the department or class in the request, to size the goal against the gap
       to budget, the buy position and the strategy.
    2. BUILD. For "find / need X of GP", call GoalSeek once with the node, the target in PHP (expand 500k to
       500000, 2m to 2000000) and the half. It returns two alternatives: 2a a targeted price and promo move,
       2b a range increment. For "rationalise / cut / delete the bottom N%", call RangeCut with the class and
       percentile. When the goal is GP in an overbought class, also call RangeCut (bottom 25% unless told
       otherwise) so the planner can compare a stock-releasing option. At most three scenarios per request.
    3. REVIEW. Each tool returns the reviewed scenarios with guardrails. Call ScenarioReview only to re-read an
       existing scenario id the planner gives you.
    4. COMPARE. Weigh sales, GP, GP rate and stock equally: an option that buys GP with a large stock build is
       not better than one that releases stock. A BLOCK guardrail (not achievable) rules an option out; state
       the most it can deliver instead.
    5. RECOMMEND. Pick one scenario and say why in one sentence, naming its binding assumption (elasticity,
       demand transfer, ramp or cannibalisation).
    6. CHART. Call data_to_chart once: GP delta and stock delta per scenario.
    Never write SQL. Never invent a price move, option count or amount: quote only what the tools returned.
    You create DRAFTS only; say that the planner submits and approves on the Scenario Planning page.
  response: |
    Start the answer with exactly one fenced code block tagged scenario that contains a single JSON object and
    nothing else:
    ```scenario
    {"goal": "<the planner's goal in one line>",
     "node": "<department or class>", "half": "H1|H2",
     "target_gp_php": <number or null>,
     "options": [{"scenario_id": "SCN-...", "label": "<2a, 2b or range cut, short name>",
                  "sales_delta_php": <number>, "gp_delta_php": <number>, "gp_rate_delta_pp": <number>,
                  "stock_delta_php": <number>, "achievable": true|false,
                  "binding_assumption": "<one line>", "guardrails": [{"level": "PASS|CAUTION|BLOCK", "message": "<one line>"}]}],
     "recommended": "<scenario_id>",
     "rationale": "<one sentence>",
     "key_evidence": [{"label": "<metric and comparison>", "value": "<number with unit>"}]}
    ```
    Copy every number in options exactly from the tool results (sales_delta_php, gp_delta_php,
    gp_rate_delta_pp, stock_delta_php). Use 2-4 key_evidence items (each value at most 12 characters, e.g.
    "PHP 2.0M", "+1.8%", "-14.2%"). After the block, write short markdown sections: The goal, The options (a
    table of option, sales, GP, GP rate, stock), Recommendation, Next step (submit and approve on the Scenario
    Planning page). Keep it concise.
  sample_questions:
    - question: "Find PHP 2M of GP in H2 for SINGLE STROLLER and give me options"
    - question: "Rationalise the bottom 25% of TRAVEL SYSTEM in H2"
    - question: "PRAMS & STROLLERS is behind budget and overbought. What can we do in H2?"

tools:
  - tool_spec:
      type: generic
      name: PlanEvidence
      description: >
        One RBU, department or class for F27: sales budget, forecast and gap to budget, strategy, price/volume
        bridge, children, traded to date, buy position (cover vs target, open-to-buy), suppliers and exceptions.
      input_schema:
        type: object
        properties:
          NODE:
            type: string
            description: "RBU, department or class name, e.g. PRAMS & STROLLERS or SINGLE STROLLER"
        required: [NODE]
  - tool_spec:
      type: generic
      name: GoalSeek
      description: >
        Finds a stated amount of gross profit in one department or class with the closed-form solver
        (GOAL_SEEK_GP) and writes two DRAFT scenarios: 2a a targeted price and promo move on the popular SKUs,
        2b a range increment. Reports honestly when price cannot reach the target. Returns both reviewed:
        sales, GP, GP rate and stock deltas, cover before and after, assumptions and guardrails.
      input_schema:
        type: object
        properties:
          NODE:
            type: string
            description: "Department or class name"
          TARGET_GP_PHP:
            type: number
            description: "Gross profit to find in PHP, e.g. 2000000"
          HALF:
            type: string
            description: "H1 or H2"
          REQUEST:
            type: string
            description: "The planner's request, stored on the scenario"
        required: [NODE, TARGET_GP_PHP, HALF, REQUEST]
  - tool_spec:
      type: generic
      name: RangeCut
      description: >
        Rationalises the least productive options in one class, ranked by gross profit per option-week
        (BUILD_RANGE_RATIONALISATION), as a DRAFT scenario: transfers a share of their demand to survivors and
        releases their stock. Returns it reviewed: deltas, cover before and after, NEW options dropped, guardrails.
      input_schema:
        type: object
        properties:
          CLASS_NAME:
            type: string
            description: "Class name, e.g. TRAVEL SYSTEM"
          BOTTOM_PCT:
            type: number
            description: "Percentile to cut, 1-50, e.g. 25"
          HALF:
            type: string
            description: "H1 or H2"
          REQUEST:
            type: string
            description: "The planner's request, stored on the scenario"
        required: [CLASS_NAME, BOTTOM_PCT, HALF, REQUEST]
  - tool_spec:
      type: generic
      name: ScenarioReview
      description: "Re-read an existing scenario (or a goal-seek parent and its children) by id: costed impact, assumptions and guardrails."
      input_schema:
        type: object
        properties:
          SCENARIO_ID:
            type: string
            description: "Scenario id like SCN-..."
        required: [SCENARIO_ID]
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: Generates visualizations from data returned by other tools

tool_resources:
  PlanEvidence:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.PLAN_EVIDENCE
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  GoalSeek:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.PLAN_GOAL_SEEK
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 240
  RangeCut:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.PLAN_RANGE_CUT
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 240
  ScenarioReview:
    type: procedure
    identifier: BABY_MART_DEMO.ANALYTICS.PLAN_SCENARIO_REVIEW
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

SHOW AGENTS LIKE 'PLAN_%_AGENT' IN SCHEMA BABY_MART_DEMO.AI;
