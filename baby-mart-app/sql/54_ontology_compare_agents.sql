-- ============================================================
-- Category Manager — Ontology compare: three agents, one question
--
-- The /ontology page asks the same question of three agents that are identical
-- except for the context they can reach:
--
--   CM_COMPARE_SV_AGENT        Cortex Analyst on SV_CATEGORY_MANAGER only
--   CM_COMPARE_ONTOLOGY_AGENT  + OntologyLookup: the governed business
--                              definitions, formulas, rules and relationships of
--                              the "Baby Mart Category Manager" ontology domain
--   CM_COMPARE_SENSE_AGENT     + CortexSenseLookup: the BABY_MART_CATEGORY_MANAGER
--                              Cortex Sense context (table pages, ontology nodes,
--                              example queries from query history, corrections)
--
-- Same model, same semantic view, same system and response instructions; only
-- the tools and the one orchestration line that says to use them differ, so a
-- difference in the answers is the context's doing.
--
-- Snowhouse only, like sql/53: the canonical account has no composable views,
-- Business Ontology domain or Cortex Sense context yet. Needs sql/53, the
-- ontology (scripts/build_category_ontology.py) and the Cortex Sense context.
-- Run with /tmp/pl/sh_run.sh (retargets BABY_MART_DEMO.* to TEMP.JARCHEN_*).
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.AI;

-- ── Business Ontology lookup ────────────────────────────────────────────────
-- Matches the question's words against node names and synonyms, then returns
-- each matched node's definition, formula and representation, the nodes it is
-- related to, and every rule (POLICY) that applies to it. The domain is found by
-- name, so the procedure is not tied to one account's ids.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.ONTOLOGY_LOOKUP(QUESTION VARCHAR)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
COMMENT = 'Agent tool: governed Business Ontology definitions, formulas, rules and relationships for a Category Manager question'
AS
$$
import json
import re

DOMAIN = "Baby Mart Category Manager"


def call(session, sql, *args):
    return json.loads(session.sql(sql, params=list(args)).collect()[0][0])


def words(s):
    return re.sub(r"[^a-z0-9%+ ]", " ", s.lower())


def mentions(text, phrase):
    p = words(phrase).replace("%", " ").strip()
    p = re.sub(r"\s+", " ", p)
    return bool(p) and re.search(r"(^| )" + re.escape(p) + r"s?( |$)", text) is not None


def run(session, question):
    summary = call(session, "SELECT SYSTEM$GET_ONTOLOGY_SUMMARY()")
    domain = next((d for d in summary.get("domains", []) if d.get("name") == DOMAIN), None)
    if not domain:
        return {"error": f"Ontology domain '{DOMAIN}' not found"}
    terms = call(session, "SELECT SYSTEM$GET_ONTOLOGY_TERM_LIST(?, 'TERM', '', '500', '0')", domain["domainId"]).get("terms", [])
    by_id = {t["termId"]: t for t in terms}

    text = " " + re.sub(r"\s+", " ", words(question).replace("%", " ")) + " "
    matched = [t for t in terms
               if any(mentions(text, n) for n in [t["name"]] + list(t.get("synonyms") or []))]

    def brief(t):
        out = {"name": t["name"], "kind": t["itemKind"], "definition": t.get("description")}
        if t.get("formula"):
            out["formula"] = t["formula"]
        if t.get("synonyms"):
            out["synonyms"] = t["synonyms"]
        return out

    nodes, rules, seen_rules = [], [], set()
    for t in matched[:8]:
        full = call(session, "SELECT SYSTEM$GET_ONTOLOGY_TERM(?)", t["termId"])
        node = brief(t)
        node["represented_by"] = [
            ".".join(x for x in [r.get("fqn"), r.get("entityQualifier"), r.get("subObjectName")] if x)
            if r.get("refType") == "SEMANTIC_VIEW" else r.get("fqn")
            for r in (full.get("representedAs") or [])]
        related = []
        for e in (full.get("relationships") or {}).get("edges", []):
            if e.get("status") != "ACTIVE":
                continue
            out = e["sourceTermId"] == t["termId"]
            other = by_id.get(e["targetTermId"] if out else e["sourceTermId"])
            if not other:
                continue
            kind = e["relationshipType"].replace("_", " ").lower()
            related.append(f"{t['name']} {kind} {other['name']}" if out else f"{other['name']} {kind} {t['name']}")
            if other["itemKind"] == "POLICY" and other["termId"] not in seen_rules:
                seen_rules.add(other["termId"])
                rules.append({"rule": other["name"], "says": other.get("description"), "applies_to": t["name"]})
        node["related"] = related
        nodes.append(node)

    for t in matched:  # a rule the question names directly
        if t["itemKind"] == "POLICY" and t["termId"] not in seen_rules:
            seen_rules.add(t["termId"])
            rules.append({"rule": t["name"], "says": t.get("description")})

    return {
        "domain": domain.get("path") or DOMAIN,
        "matched_nodes": nodes,
        "rules": rules,
        "other_nodes": [] if nodes else sorted(t["name"] for t in terms),
        "note": "Governed definitions approved by the category team. Apply the rules and formulas when you query.",
    }
$$;

-- ── Cortex Sense lookup ─────────────────────────────────────────────────────
-- Retrieves from the BABY_MART_CATEGORY_MANAGER context only: table pages (grain,
-- joins, caveats), ontology nodes, example queries mined from query history and
-- standing corrections. Each document is trimmed so the whole result stays under
-- the agents' 32 KB tool-result limit.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.CORTEX_SENSE_LOOKUP(QUESTION VARCHAR)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
COMMENT = 'Agent tool: Cortex Sense context for a Category Manager question (table pages, ontology nodes, example queries, corrections)'
AS
$$
import json

CONTEXT = "BABY_MART_CATEGORY_MANAGER"
DOC_CAP = 3500
MAX_DOCS = 6


def run(session, question):
    listed = json.loads(session.sql(
        "SELECT SYSTEM$CORTEX_AGENT_CORTEX_CONTEXT_BUILDER('{\"action\":\"list-contexts\"}')").collect()[0][0])
    ctx = next((c for c in listed.get("response_structured", {}).get("cortex_contexts", [])
                if c.get("name") == CONTEXT), None)
    if not ctx:
        return {"error": f"Cortex Sense context {CONTEXT} not found"}
    req = json.dumps({"request_structured": {
        "query": question, "cortex_context_ids": [int(ctx["id"])], "max_results": MAX_DOCS}})
    res = json.loads(session.sql("SELECT SYSTEM$CORTEX_AGENT_CORTEX_CONTEXT(?)", params=[req]).collect()[0][0])
    body = res.get("response_structured", res)
    docs = []
    for d in body.get("documents") or []:
        content = d.get("cam_content") or ""
        docs.append({
            "type": d.get("doc_type"),
            "key": d.get("entity_key"),
            "content": content if len(content) <= DOC_CAP else content[:DOC_CAP] + " ...",
        })
    return {
        "context": f"{ctx.get('database_name')}.{ctx.get('schema_name')}.{CONTEXT}",
        "documents": docs,
        "corrections": body.get("corrections") or [],
        "note": "Apply every correction. Table pages give grain, joins and caveats; qbe documents are example queries that answered earlier questions.",
    }
$$;

-- ── The three agents ────────────────────────────────────────────────────────
-- Shared text is repeated verbatim in each spec; keep the three in step.

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_SV_AGENT
  COMMENT = 'Ontology compare (1 of 3): Category Manager agent with the semantic view only'
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
    You answer Baby Mart category managers' questions. Baby Mart is an Australian baby and nursery retailer.
    Figures come only from the category_manager tool (Cortex Analyst over the Category Manager semantic view):
    sales, margin, customers, brand switching, promotions, competitor prices and supplier delivery (DIFOT).
    Amounts are AUD. Never invent a number.
  orchestration: >
    Use the category_manager tool for every figure. Split a multi-part question into separate tool calls.
  response: |
    Lead with the answer in one or two sentences, then a small markdown table of the figures. Then a section
    "**How I read the question**" with 2-4 bullets: each definition, threshold, time window or rule you applied,
    and where it came from (the semantic view, the Business Ontology or Cortex Sense). If you had to assume
    something, say so in that section. Keep it under 200 words.

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: POS sales, units, margin %, ASP and rate of sale by brand, class, store
        and week; customer lifetime value, segments and brand switching; promotions by mechanic; competitor
        prices; supplier DIFOT. Joined through one brand and supplier.

tool_resources:
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
$$;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_ONTOLOGY_AGENT
  COMMENT = 'Ontology compare (2 of 3): Category Manager agent with the semantic view and the Business Ontology'
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
    You answer Baby Mart category managers' questions. Baby Mart is an Australian baby and nursery retailer.
    Figures come only from the category_manager tool (Cortex Analyst over the Category Manager semantic view):
    sales, margin, customers, brand switching, promotions, competitor prices and supplier delivery (DIFOT).
    Amounts are AUD. Never invent a number.
  orchestration: >
    Use the category_manager tool for every figure. Split a multi-part question into separate tool calls.
    Before querying, call OntologyLookup once with the question. It returns the category team's governed
    definitions, formulas, rules and relationships; apply them when you phrase each category_manager request
    (name the metric, threshold and rule explicitly) and when you interpret the result.

  response: |
    Lead with the answer in one or two sentences, then a small markdown table of the figures. Then a section
    "**How I read the question**" with 2-4 bullets: each definition, threshold, time window or rule you applied,
    and where it came from (the semantic view, the Business Ontology or Cortex Sense). If you had to assume
    something, say so in that section. Keep it under 200 words.

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: POS sales, units, margin %, ASP and rate of sale by brand, class, store
        and week; customer lifetime value, segments and brand switching; promotions by mechanic; competitor
        prices; supplier DIFOT. Joined through one brand and supplier.
  - tool_spec:
      type: generic
      name: OntologyLookup
      description: >
        The Business Ontology for Baby Mart category management: governed definitions, formulas, synonyms, rules
        (such as the DIFOT target and the like-for-like period) and relationships between business concepts
        (brands, suppliers, metrics). Pass the user's question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, verbatim"
        required: [QUESTION]

tool_resources:
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
  OntologyLookup:
    type: procedure
    identifier: BABY_MART_DEMO.AI.ONTOLOGY_LOOKUP
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 60
$$;

CREATE OR REPLACE AGENT BABY_MART_DEMO.AI.CM_COMPARE_SENSE_AGENT
  COMMENT = 'Ontology compare (3 of 3): Category Manager agent with the semantic view, the Business Ontology and Cortex Sense'
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
    You answer Baby Mart category managers' questions. Baby Mart is an Australian baby and nursery retailer.
    Figures come only from the category_manager tool (Cortex Analyst over the Category Manager semantic view):
    sales, margin, customers, brand switching, promotions, competitor prices and supplier delivery (DIFOT).
    Amounts are AUD. Never invent a number.
  orchestration: >
    Use the category_manager tool for every figure. Split a multi-part question into separate tool calls.
    Before querying, call OntologyLookup and CortexSenseLookup once each with the question. OntologyLookup
    returns the category team's governed definitions, formulas, rules and relationships. CortexSenseLookup
    returns how the data is actually used: table pages (grain, joins, caveats), example queries that answered
    earlier questions, and corrections, which always apply. Apply both when you phrase each category_manager
    request (name the metric, threshold, rule and filter explicitly) and when you interpret the result.
  response: |
    Lead with the answer in one or two sentences, then a small markdown table of the figures. Then a section
    "**How I read the question**" with 2-4 bullets: each definition, threshold, time window or rule you applied,
    and where it came from (the semantic view, the Business Ontology or Cortex Sense). If you had to assume
    something, say so in that section. Keep it under 200 words.

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: category_manager
      description: >
        Baby Mart Category Manager data: POS sales, units, margin %, ASP and rate of sale by brand, class, store
        and week; customer lifetime value, segments and brand switching; promotions by mechanic; competitor
        prices; supplier DIFOT. Joined through one brand and supplier.
  - tool_spec:
      type: generic
      name: OntologyLookup
      description: >
        The Business Ontology for Baby Mart category management: governed definitions, formulas, synonyms, rules
        (such as the DIFOT target and the like-for-like period) and relationships between business concepts
        (brands, suppliers, metrics). Pass the user's question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, verbatim"
        required: [QUESTION]
  - tool_spec:
      type: generic
      name: CortexSenseLookup
      description: >
        Cortex Sense context for Baby Mart category management: table pages with grain, joins and caveats,
        ontology nodes, example queries from query history and standing corrections. Pass the user's question.
      input_schema:
        type: object
        properties:
          QUESTION:
            type: string
            description: "The user's question, verbatim"
        required: [QUESTION]

tool_resources:
  category_manager:
    semantic_view: BABY_MART_DEMO.ANALYTICS.SV_CATEGORY_MANAGER
    execution_environment:
      type: warehouse
      warehouse: DEMO_ANALYTICS_WH
      query_timeout: 120
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
$$;

SHOW AGENTS LIKE 'CM_COMPARE_%' IN SCHEMA BABY_MART_DEMO.AI;
