-- ============================================================
-- Category Manager — "Ontology" compare page: the two context tools
--
-- /ontology asks one question of three agents that query the same plain semantic
-- view (sql/55, SV_CATEGORY_MANAGER_PLAIN: tables and joins, no business rules)
-- and differ only in the context they bring (agent/deploy_ontology_compare_agents.sql):
--
--   CM_COMPARE_SV_AGENT        the semantic view alone
--   CM_COMPARE_ONTOLOGY_AGENT  + ONTOLOGY_LOOKUP
--   CM_COMPARE_SENSE_AGENT     + ONTOLOGY_LOOKUP + CORTEX_SENSE_LOOKUP
--
--   ONTOLOGY_LOOKUP(QUESTION)      the Business Ontology domain "Baby Mart Category
--                                  Manager": every node's definition, and for the nodes
--                                  the question names, their formulas, relationships and
--                                  the semantic view members that represent them.
--                                  Policies always come back whole: they are the rules a
--                                  number has to follow.
--   CORTEX_SENSE_LOOKUP(QUESTION)  the Cortex Sense context BABY_MART_CATEGORY_MANAGER:
--                                  table pages (grain, joins, caveats), ontology nodes,
--                                  the domain overview and past queries that answered
--                                  similar questions.
--
-- ONTOLOGY_LOOKUP reads AI.ONTOLOGY_SNAPSHOT, the ACTIVE nodes copied from the live
-- ontology by scripts/build_category_ontology.py (run it with --snapshot-only after
-- a steward edits the domain). Listing a domain's terms takes ~25 s on Snowhouse,
-- too slow for a tool an agent waits on; the copy answers in under a second.
--
-- CORTEX_SENSE_LOOKUP calls SYSTEM$CORTEX_AGENT_CORTEX_CONTEXT, which an owner's-
-- rights procedure may not ("a function with side effects"), so it runs with
-- caller's rights; it only reads, and the caller is the role the agent runs as.
-- Neither a procedure nor a CREATE TABLE AS may call the context builder, so this
-- script lists the contexts on its own and records the context's id in
-- AI.CORTEX_SENSE_CONTEXT from that result: re-run it after the context is
-- recreated. When the snapshot or context is missing the tools say so rather than
-- fail, and the agent carries on with what it has. Read only. Output stays under
-- the 32 KB a custom tool may return.
--
-- Needs sql/53 and sql/55 (the semantic views), the ontology domain and its
-- snapshot, and the Cortex Sense context. Snowhouse only for now: the canonical
-- account has none of them.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE SCHEMA BABY_MART_DEMO.AI;

SELECT SYSTEM$CORTEX_AGENT_CORTEX_CONTEXT_BUILDER('{"action":"list-contexts"}') AS LISTED;

CREATE OR REPLACE TABLE BABY_MART_DEMO.AI.CORTEX_SENSE_CONTEXT
  COMMENT = 'The Cortex Sense context CORTEX_SENSE_LOOKUP reads, recorded by sql/54'
AS
SELECT c.value:database_name::VARCHAR || '.' || c.value:schema_name::VARCHAR || '.' || c.value:name::VARCHAR AS CONTEXT_NAME,
       c.value:id::NUMBER AS CONTEXT_ID,
       c.value:last_processed_at::VARCHAR AS LAST_PROCESSED_AT
FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) l,
     TABLE(FLATTEN(PARSE_JSON(l.LISTED):response_structured:cortex_contexts)) c
WHERE c.value:database_name::VARCHAR || '.' || c.value:schema_name::VARCHAR || '.' || c.value:name::VARCHAR
      = 'BABY_MART_DEMO.ANALYTICS.BABY_MART_CATEGORY_MANAGER';

SELECT * FROM BABY_MART_DEMO.AI.CORTEX_SENSE_CONTEXT;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.ONTOLOGY_LOOKUP(QUESTION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Business Ontology definitions, rules and relationships for the Baby Mart Category Manager'
EXECUTE AS OWNER
AS
$$
const MAX_DETAIL = 8;

try {
  let rs;
  try {
    rs = snowflake.execute({ sqlText: `SELECT TERM_ID, NAME, ITEM_KIND, DEFINITION, FORMULA, SYNONYMS,
        RELATIONSHIPS, REPRESENTED_BY, DOMAIN FROM BABY_MART_DEMO.AI.ONTOLOGY_SNAPSHOT ORDER BY NAME` });
  } catch (e) {
    return JSON.stringify({ available: false, note: "The Business Ontology snapshot is missing (run scripts/build_category_ontology.py --snapshot-only)." });
  }
  const terms = [];
  let domain = null;
  while (rs.next()) {
    domain = rs.getColumnValue(9);
    terms.push({ termId: rs.getColumnValue(1), name: rs.getColumnValue(2), kind: rs.getColumnValue(3),
      definition: rs.getColumnValue(4), formula: rs.getColumnValue(5), synonyms: rs.getColumnValue(6) || [],
      relationships: rs.getColumnValue(7) || [], represented_by: rs.getColumnValue(8) || [] });
  }
  if (!terms.length) return JSON.stringify({ available: false, note: "The Business Ontology snapshot is empty." });

  // A node is named by the question when its name or a synonym appears in it.
  const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9%+ ]+/g, " ").replace(/ +/g, " ").trim() + " ";
  const q = norm(QUESTION);
  const mentions = (t) => [t.name, ...t.synonyms].some((n) => {
    const w = norm(n).trim();
    return w.length > 2 && q.includes(" " + w + " ");
  });
  const named = terms.filter(mentions);
  const policies = terms.filter((t) => t.kind === "POLICY");
  const detail = [...new Map([...named, ...policies].map((t) => [t.termId, t])).values()].slice(0, MAX_DETAIL);

  return JSON.stringify({
    available: true,
    domain,
    named_in_question: named.map((t) => t.name),
    detail: detail.map((t) => ({ name: t.name, kind: t.kind, definition: t.definition,
      formula: t.formula || undefined, relationships: t.relationships, represented_by: t.represented_by })),
    glossary: terms.map((t) => ({ name: t.name, kind: t.kind, synonyms: t.synonyms, definition: t.definition,
      formula: t.formula || undefined })),
  });
} catch (err) {
  return JSON.stringify({ available: false, note: "Business Ontology could not be read: " + String(err.message || err).slice(0, 300) });
}
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.CORTEX_SENSE_LOOKUP(QUESTION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Cortex Sense context for the Baby Mart Category Manager: table pages, ontology nodes and past queries'
EXECUTE AS CALLER
AS
$$
const PER_DOC = 3800;
const MAX_DOCS = 6;

const lit = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
const call = (fn, payload) => {
  const rs = snowflake.execute({ sqlText: "SELECT SYSTEM$" + fn + "(" + lit(JSON.stringify(payload)) + ")" });
  rs.next();
  return JSON.parse(rs.getColumnValue(1));
};

try {
  const rs = snowflake.execute({ sqlText: "SELECT CONTEXT_NAME, CONTEXT_ID FROM BABY_MART_DEMO.AI.CORTEX_SENSE_CONTEXT LIMIT 1" });
  if (!rs.next()) return JSON.stringify({ available: false, note: "No Cortex Sense context is recorded for the Category Manager (re-run sql/54)." });
  const name = rs.getColumnValue(1);
  const id = Number(rs.getColumnValue(2));

  const res = call("CORTEX_AGENT_CORTEX_CONTEXT", { request_structured: {
    query: String(QUESTION || "").slice(0, 2000), cortex_context_ids: [id], max_results: MAX_DOCS } });
  const body = res.response_structured || {};
  // Some past-query documents come back with no content; they tell the agent nothing.
  const docs = (body.documents || []).filter((d) => String(d.cam_content || "").trim()).map((d) => ({
    kind: d.doc_type, about: d.entity_key,
    content: String(d.cam_content || "").slice(0, PER_DOC),
  }));
  return JSON.stringify({ available: true, context: name, documents: docs,
                          corrections: body.corrections || [] });
} catch (err) {
  return JSON.stringify({ available: false, note: "Cortex Sense could not be read: " + String(err.message || err).slice(0, 300) });
}
$$;
