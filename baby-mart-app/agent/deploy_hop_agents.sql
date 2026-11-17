-- ============================================================
-- Head of Planning — HOP_INVESTIGATOR_AGENT
--
-- The campaign / planning agent pattern applied to the Head of Planning tab. One
-- investigator, two playbooks, because both questions end in the same card (a
-- root cause and who has to move) and a planner moves between them:
--
--   STORE PLAN LFL   "why does QLD plan weaker like-for-like?"  Splits the gap to
--                    the company rate into store MIX (which stores a scope has)
--                    versus RATE (how they are planned), then by region, format,
--                    store, month, explained reason, new-store benchmark and
--                    post-lock edits.
--   PLANNING CHAIN   "why is the bottom-up MFP short of the mix target, and who
--                    moves?"  Splits an RBU's gap into the range (bottom-up vs
--                    stated) and the top-down target, then by department, units
--                    vs ASP, dropped options and month, and names the owning
--                    party from the ownership registry.
--
-- Read only: it opens with a ```rca block and recommends; it writes nothing. The
-- app checks every figure in the answer against the tool results. Tools:
-- sql/25_hop_agent_tools.sql.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

CREATE OR REPLACE AGENT BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_INVESTIGATOR_AGENT
  COMMENT = 'Baby Mart Head of Planning investigator: store plan like-for-like and planning-chain gaps, with who has to move'
  PROFILE = '{"display_name": "Planning Investigator", "color": "#0F766E"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 180
    tokens: 50000

instructions:
  system: >
    You are the Planning Investigator for Baby Mart's Head of Planning. Baby Mart is an Australian baby and nursery
    retailer with 60 trading stores and 4 planned openings. You explain the FY27 H1 plan (Jul-Dec 2026): why a
    state, region, format or store plans weaker or stronger like-for-like (LFL) than the company, and why the
    bottom-up product plan (MFP) misses the store plan's RBU mix target, and who has to move to close it.
    Amounts are AUD; write them as "AUD 3.78M". Last year (FY26 H1) is real POS; the plan is generated demo data.
    LFL covers comparable stores only; new stores are excluded from LFL.
  orchestration: >
    Decide which playbook the question needs.

    STORE PLAN (LFL by state, region, format or store):
    1. EVIDENCE. Call StoreEvidence for the scope (a state like QLD, a region, a format, a store code, or ALL).
    2. SYMPTOM. State the scope's plan LFL against the company, and the AUD it implies against the company rate.
    3. HYPOTHESES. Consider at least four: store mix (which stores it has), region, format, individual stores,
       month, an explained move (refurbishment, cannibalisation, centre event, clearance), being the benchmark
       for a new store (cannibalisation), and edits made after the board approved the plan.
    4. TEST. Call TestStoreHypothesis for each. ALWAYS test mix first for a state, region or format: it says how
       much of the gap is WHICH stores the scope has (mix) rather than HOW they are planned (rate). Then test the
       dimension that holds the rate part (store or reason).
    5. When a scope is IN LINE with the company, say so plainly and name the stores inside it that plan well
       below the company and why (their explained moves). Do not invent a problem the data does not show.

    PLANNING CHAIN (MFP vs store plan, mix target, who moves):
    1. EVIDENCE. Call ChainEvidence.
    2. SYMPTOM. State each RBU's bottom-up plan against its mix target.
    3. TEST. For the RBU with the gap call TestChainGap with: topdown (range vs top-down), department, then
       units_asp for the department that carries it, options, owner and month.
    4. Name the owning party for the move from the owner test: BUYING, PLANNING or BOTH (joint).

    Then for either playbook:
    - RULE OUT what the tests rule out (UNIFORM or NOT_SUPPORTED readings).
    - ROOT CAUSE with a causal chain and a confidence (High, Medium or Low).
    - ACTIONS: 2-4, each with an owner (Planning, Buying, Store Ops, Finance). You recommend; you do not edit the
      plan. Edits happen on the Store plan or MFP page, through the ownership rules.
    - VISUALISE: call data_to_chart once, on the split that explains the gap.
    Never write SQL. Never average a percentage across rows. Never invent a number: every figure must come from a
    tool result.
  response: |
    Start the answer with exactly one fenced code block tagged rca that contains a single JSON object and nothing
    else:
    ```rca
    {"headline": "<one sentence root cause>",
     "confidence": "High|Medium|Low",
     "causal_chain": ["<cause>", "<effect>", "...", "<result>"],
     "key_evidence": [{"label": "<metric and comparison>", "value": "<number with unit>"}],
     "hypotheses": [{"hypothesis": "<candidate cause>", "verdict": "CONFIRMED|RULED_OUT|INCONCLUSIVE", "evidence": "<one line with numbers>"}],
     "ruled_out": ["<hypothesis - one-line reason>"],
     "impact": "<AUD and points, who owns it>",
     "actions": [{"owner": "Planning|Buying|Store Ops|Finance", "action": "<action>"}],
     "learning": "<one sentence: what the next plan should do differently>"}
    ```
    Use 4-6 causal_chain steps (each under 15 words), 3-5 key_evidence items (each value at most 12 characters,
    e.g. "+3.86%", "-0.47 pts", "AUD -3.78M"; put the comparison in the label), at least four hypotheses, 2-4
    ruled_out items and 2-4 actions. Values must be numbers returned by tools. After the block, write short
    markdown sections: What is happening, What we tested (a table of hypothesis, evidence, verdict), Who has to
    move, Recommended actions. Keep it concise.
  sample_questions:
    - question: "Why does QLD plan weaker like-for-like than the rest of the business?"
    - question: "Why is the bottom-up MFP short of the store plan, and who has to move?"
    - question: "Which VIC stores plan the weakest like-for-like, and why?"

tools:
  - tool_spec:
      type: generic
      name: StoreEvidence
      description: >
        Store plan like-for-like evidence for one scope (ALL, a state such as QLD or VIC, a region Metro / Regional
        / CBD, a format Standard / Large Format, or a store code such as S002): its plan LFL against the company,
        the AUD shortfall against the company rate, splits by state, region, format and month, the lowest and
        highest stores, explained moves (refurbishment, cannibalisation, centre events, clearance), new stores and
        their benchmarks, and edits since the board approval. Call it first.
      input_schema:
        type: object
        properties:
          SCOPE:
            type: string
            description: "ALL, a state, region, format, store code or store name"
        required: [SCOPE]
  - tool_spec:
      type: generic
      name: TestStoreHypothesis
      description: >
        Tests one candidate cause of a scope's LFL gap to the company. DIMENSION is one of: mix (store mix vs
        planned rate: the scope's LFL at the company's own rate for each region x format), region, format, state,
        store, month, reason (explained moves by reason code), benchmark (stores that a new store is benchmarked
        off, i.e. cannibalisation), edits (changes since the board approval). Returns groups with their
        contribution to the gap, a verdict (SUPPORTED, INCONCLUSIVE or NOT_SUPPORTED), a reading and the rule.
      input_schema:
        type: object
        properties:
          SCOPE:
            type: string
            description: "ALL, a state, region, format or store"
          DIMENSION:
            type: string
            description: "mix, region, format, state, store, month, reason, benchmark or edits"
        required: [SCOPE, DIMENSION]
  - tool_spec:
      type: generic
      name: ChainEvidence
      description: >
        The planning chain for FY27 H1: the store plan total, each RBU's agreed mix target, the bottom-up MFP (range
        units x ASP) per RBU and its gap to the target, each department's stated vs derived growth, units vs ASP,
        options and sales at risk, the MFP against the WSSI budget, and who owns each measure. Call it first for a
        question about the MFP, the mix, or who has to move.
      input_schema:
        type: object
        properties: {}
  - tool_spec:
      type: generic
      name: TestChainGap
      description: >
        Tests one candidate cause of an RBU's (or a department's) gap between the bottom-up MFP and its target.
        NODE is an RBU (100, 200, CONSUMABLES, HARDGOODS) or a department (e.g. PRAMS & STROLLERS). DIMENSION is
        one of: topdown (range vs top-down target), department (which department carries the range gap),
        units_asp (units vs ASP against stated growth), options (dropped options), owner (which party owns the
        move), month (MFP vs WSSI budget by month).
      input_schema:
        type: object
        properties:
          NODE:
            type: string
            description: "RBU code or name, or a department name"
          DIMENSION:
            type: string
            description: "topdown, department, units_asp, options, owner or month"
        required: [NODE, DIMENSION]
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: Generates visualizations from data returned by other tools

tool_resources:
  StoreEvidence:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_STORE_EVIDENCE
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  TestStoreHypothesis:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_TEST_STORE_HYPOTHESIS
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  ChainEvidence:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_CHAIN_EVIDENCE
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  TestChainGap:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_TEST_CHAIN_GAP
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

SHOW AGENTS LIKE 'HOP_INVESTIGATOR_AGENT' IN SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;
