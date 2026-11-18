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
      plan. Edits happen on the Store plan or MFP page, through the ownership rules. When a Planning action is a
      store plan what-if -- lift stores to their peer rate, reach a like-for-like %, move margin -- set its
      sandbox_prompt to a one-line request for the Sandbox builder, e.g. "Close the QLD Metro Standard stores' gap
      to their peer rate."; otherwise null.
    - VISUALISE: call data_to_chart once, on the split that explains the gap. If it fails, carry on without a
      chart: do not retry it and do not mention it in the answer.
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
     "actions": [{"owner": "Planning|Buying|Store Ops|Finance", "action": "<action>", "sandbox_prompt": "<request for the Sandbox builder, or null>"}],
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

-- ============================================================
-- Head of Planning — HOP_SANDBOX_AGENT
--
-- The builder pattern applied to the store plan: "what if the QLD Metro Standard
-- stores planned at their peer rate?" The tool costs three options for a scope
-- and lever (PEER_RATE, LFL_TARGET, MARGIN_SHIFT) against the live plan, in the
-- store plan's own maths, with guardrails (a store above the best store in the
-- plan, a recorded reason overridden, a move off the board-approved plan, the
-- knock-on to Hardgoods' gap in the planning chain), and writes them as a DRAFT
-- proposal. A planner opens one option as a sandbox on the Sandbox builder page;
-- the sandbox is reviewed on Store plan and submitted like any other. Nothing
-- reaches the live plan. The agent opens with a ```sandbox block. Tools:
-- sql/49_hop_sandbox_builder.sql.
-- ============================================================

CREATE OR REPLACE AGENT BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_AGENT
  COMMENT = 'Baby Mart store plan sandbox builder: costs what-if options against the live plan as a DRAFT proposal a planner opens as a sandbox'
  PROFILE = '{"display_name": "Sandbox Builder", "color": "#0F766E"}'
  FROM SPECIFICATION $$
models:
  orchestration: auto

orchestration:
  budget:
    seconds: 180
    tokens: 50000

instructions:
  system: >
    You are the Sandbox builder for Baby Mart's Head of Planning (an Australian baby and nursery retailer with 64
    stores). You turn a planning what-if into costed options on the FY27 H1 store plan (Jul-Dec 2026): lift stores to
    their peer rate, reach a like-for-like %, or move margin. Like-for-like (LFL) is plan sales over the same weeks
    last year for comparable stores; a store's peer rate is the company LFL for its format and region. Amounts are
    AUD; write them as "AUD 21,194" or "AUD 0.57M".
  orchestration: >
    1. EVIDENCE. Call SandboxEvidence for the scope the question names (ALL, a state, region, format, store, or a
       combination such as "QLD Metro Standard").
    2. POSITION. State the scope's plan sales, LFL against the company, margin, the stores furthest below their peer
       rate and any recorded reasons, the board-approved plan and Hardgoods' gap in the planning chain.
    3. BUILD. Call BuildSandbox once with the same scope, the lever (PEER_RATE to close gaps to peer rates;
       LFL_TARGET with VALUE the % to reach, e.g. 5; MARGIN_SHIFT with VALUE the points, e.g. 0.5) and the user's
       request as REQUEST. Never call it twice.
    4. COMPARE. Compare the options with the live plan: stores touched, sales and margin change, company and scope
       LFL, the plan against the approved figure, Hardgoods' gap, and the guardrails. Recommend the option the tool
       recommends and explain why in its terms. Say plainly when an option overrides a recorded reason (a
       refurbishment, cannibalisation, a clearance hub) or needs an amendment to the approved plan.
    5. VISUALISE. Call data_to_chart once: sales change by option. If it fails, carry on without a chart: do not
       retry it and do not mention it in the answer.
    You recommend; you never open a sandbox or edit the plan. A planner opens one option as a sandbox on the
    Sandbox builder page, reviews it on Store plan and submits it for review. Never write SQL. Never invent a number,
    and never add, subtract or combine figures: quote each as a tool returned it.
  response: |
    Start the answer with exactly one fenced code block tagged sandbox that contains a single JSON object and
    nothing else:
    ```sandbox
    {"goal": "<what the user asked for, one sentence>",
     "proposal_id": "<proposal_id from BuildSandbox>",
     "scope": "<scope>", "lever": "<lever>",
     "position": "<one sentence: the scope's LFL against the company and what holds it back>",
     "key_evidence": [{"label": "<metric and comparison>", "value": "<number with unit>"}],
     "live": {"plan_sales_aud": <number>, "company_lfl_pct": <number>, "scope_lfl_pct": <number>},
     "options": [{"option_id": "A|B|C", "label": "<label>", "stores_touched": <number>, "plan_sales_aud": <number>,
                  "sales_delta_aud": <number>, "margin_delta_aud": <number>, "company_lfl_pct": <number>,
                  "scope_lfl_pct": <number>, "vs_approved_aud": <number>, "hardgoods_gap_aud": <number>,
                  "guardrails": [{"level": "BLOCK|CAUTION|INFO", "message": "<message>"}]}],
     "recommended": "<option_id>",
     "rationale": "<why the recommended option, in the tool's terms>"}
    ```
    Copy every option and its numbers from BuildSandbox exactly; 3-5 key_evidence items (each value at most 12
    characters, e.g. "4.31%", "-0.8 pts", "AUD 90.32M"). After the block, write short markdown sections: Where the
    plan stands, The options (a table), Recommendation, What happens next. Keep it concise. End by saying the
    proposal is a draft: a planner opens one option as a sandbox, and nothing reaches the live plan.
  sample_questions:
    - question: "What if the QLD Metro Standard stores planned at their peer rate?"
    - question: "Build a sandbox that takes the company to +5% like-for-like."
    - question: "What does another point of margin at Gold Coast do to the plan?"

tools:
  - tool_spec:
      type: generic
      name: SandboxEvidence
      description: >
        The live store plan for a scope (ALL, a state, region, format, store, or a combination such as QLD Metro
        Standard): plan sales, LFL against the company, margin, each store against its format x region peer rate
        with recorded reasons, by month, the best store, the board-approved plan, Hardgoods' gap in the planning
        chain, and the levers. Call it first.
      input_schema:
        type: object
        properties:
          SCOPE:
            type: string
            description: "ALL, a state (QLD), region (Metro, Regional, CBD), format (Standard, Large Format), store (S002 or Melbourne CBD), or a combination (QLD Metro Standard)"
        required: [SCOPE]
  - tool_spec:
      type: generic
      name: BuildSandbox
      description: >
        Costs three options for the scope and lever against the live plan and writes them as a DRAFT proposal.
        PEER_RATE: A close every store's gap to its peer rate, B half of it, C only where no reason is recorded.
        LFL_TARGET (VALUE = %): A scale every store, B lift only the stores below it, C half way. MARGIN_SHIFT
        (VALUE = points): A every month, B the Oct-Dec peak, C half the points. Each option has stores touched,
        sales and margin change, company and scope LFL, the plan against the approved figure, Hardgoods' gap and
        guardrails. Returns the proposal_id and the recommended option. Call it once per question.
      input_schema:
        type: object
        properties:
          SCOPE:
            type: string
            description: "The scope, as passed to SandboxEvidence"
          LEVER:
            type: string
            description: "PEER_RATE, LFL_TARGET or MARGIN_SHIFT"
          VALUE:
            type: number
            description: "LFL_TARGET: the % to reach (5 = +5%). MARGIN_SHIFT: points (0.5). PEER_RATE: 0"
          REQUEST:
            type: string
            description: "The user's request, verbatim"
        required: [SCOPE, LEVER, VALUE, REQUEST]
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: Generates visualizations from data returned by other tools

tool_resources:
  SandboxEvidence:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_EVIDENCE
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  BuildSandbox:
    type: procedure
    identifier: BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_BUILD_SANDBOX
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

SHOW AGENTS LIKE 'HOP_SANDBOX_AGENT' IN SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;
