-- ============================================================
-- Baby Mart Retail Platform
-- 09_battlecard_procedure.sql
--
-- GENERATE_BATTLECARD(brand, category) -> JSON negotiation battlecard.
--
-- The battlecard is the Facts step of the Supplier Meeting page
-- (/meeting/<brand>): the arguments a category manager takes into the room. Its
-- figures come from AI.NEGOTIATION_EVIDENCE (sql/48), the same evidence the
-- negotiation brief is sized from, so the facts, the arguments and the asks on
-- that page show one set of numbers. It used to compute its own: a plain average
-- of weekly DIFOT that also counted the Huggies class rows, the best promotion
-- mechanic's return over every period, a margin gap not annualised, and a
-- "total addressable" dollar figure the model wrote. Now:
--
--   * every figure is the evidence's (DIFOT since 6 April from the PO lines, with
--     whose misses they are; promo discount FY2026 to date; CLV weighted by
--     customers);
--   * CORTEX.COMPLETE writes the wording only -- the arguments, the approach,
--     incentives and pressures. Asks are written in words: the brief sizes every
--     dollar, so the model is told never to put an AUD amount in an ask, and there
--     is no "total addressable" any more.
--   * the wording follows the Head of Department's "Supplier negotiation prep"
--     SOP and template (Settings > SOP & Templates, sql/15): what to emphasise,
--     how to judge, the tone, and the order of the approach. The data rules here
--     win any conflict. The card returns the SOP name and version it followed.
--
-- P_CATEGORY is kept for the agent tool that calls this
-- (scripts/register_agent_tools.py) but no longer used: the evidence takes the
-- brand's largest category this year, as the brief does.
--
-- Callable by the app (/api/battlecard) and registered as a `generic` tool on
-- the Category agent. Needs sql/48 at call time.
-- ============================================================

USE DATABASE BABY_MART_DEMO;
USE SCHEMA AI;
USE WAREHOUSE DEMO_AI_WH;

-- The agent binds tool arguments BY NAME from the tool's input_schema, so the
-- schema property names must match these parameter names exactly (p_brand /
-- p_category). P_CATEGORY defaults so the agent can call with brand alone.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.GENERATE_BATTLECARD(
  P_BRAND STRING,
  P_CATEGORY STRING DEFAULT NULL
)
RETURNS STRING
LANGUAGE JAVASCRIPT
COMMENT = 'Supplier negotiation battlecard for a brand: the negotiation evidence (sql/48) as facts, and arguments worded by Cortex AI from it. Returns JSON with the evidence attached.'
EXECUTE AS OWNER
AS
$$
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.AI.NEGOTIATION_EVIDENCE(?)", binds: [P_BRAND || ""] }).execute();
rs.next();
const e = JSON.parse(rs.getColumnValue(1));
if (!e.ok) return JSON.stringify({ error: e.error, valid_brands: e.valid_brands });

// The Head of Department's negotiation SOP and template (Settings > SOP &
// Templates, sql/15). The SOP says what to emphasise, how to judge and the tone;
// the template's "## " headings order the approach. The RULES below still win:
// they keep every figure to the evidence.
const st = snowflake.createStatement({ sqlText: "SELECT TEMPLATE_NAME, SOP_TEXT, TEMPLATE_TEXT, VERSION, UPDATED_BY, TO_CHAR(UPDATED_AT, 'YYYY-MM-DD') FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE WHERE TEMPLATE_NAME = 'Supplier negotiation prep'" });
const sr = st.execute();
let sop = null, sopText = "", sections = [];
if (sr.next()) {
  sopText = String(sr.getColumnValue(2) || "");
  sections = String(sr.getColumnValue(3) || "").split("\n").filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
  sop = { name: sr.getColumnValue(1), version: sr.getColumnValue(4), updated_by: sr.getColumnValue(5), updated_at: sr.getColumnValue(6), sections };
}

// What the model may quote. The planner overrides are summarised: the rule is
// not to cite their spike as growth, and the detail is the brief's.
const active = (e.overrides || []).filter((o) => o.status === "ACTIVE");
const facts = {
  brand: e.brand, category: e.category, supplier: e.supplier, distributor: e.distributor, period: e.period,
  sales: e.sales, promo: e.promo, switching: e.switching, price_vs_competitors_pct: e.price_vs_competitors_pct,
  difot: e.difot, customers: e.customers, rate_of_sale: e.rate_of_sale, geography: e.geography, range: e.range,
  active_demand_overrides: active.length ? { count: active.length, class: active[0].class, ids: active.map((o) => o.override_id) } : null,
};

const prompt = [
  "You are a category manager at Baby Mart, Australia's largest baby and nursery retailer, preparing a supplier",
  "meeting. Write the battlecard for it using ONLY the FACTS below.",
  "",
  "FACTS:", JSON.stringify(facts), "",
  "RULES:",
  "- Every number you cite must appear in FACTS, copied verbatim. Never recompute, re-round or derive a number, and",
  "  never add, subtract or combine figures (two class shares are two figures, not a total). This applies to every",
  "  field, descriptions included. The app checks each number against FACTS.",
  "- sales.margin_aud is TOTAL margin, not a gap; the gap is sales.margin_gap_pp. difot.recent_difot_pct is the",
  "  supplier's DIFOT since 6 April against difot.target_pct.",
  "- Write each ask in words (what to ask for). NEVER put an AUD amount in an ask, not even one from FACTS, and never",
  "  in the ask part of negotiation_approach: the brief sizes every ask (annualised, by stance), so a dollar figure here",
  "  would contradict it. Percentages and points are fine.",
  "- If difot.attribution is BABY_MART, most missed deliveries were Baby Mart's own ordering: never argue them as the",
  "  supplier's failure; say the DIFOT conversation must start from our side.",
  "- If active_demand_overrides is set, never cite that class's demand spike as growth: it is a planner override.",
  "- If a fact is null, leave it out. No arguments about shelf space per linear metre or commodity input costs.",
  "- impact is an integer 1-5: how much leverage the point gives Baby Mart.",
  "- Groups: profitability (margin gap, range concentration, customer value), growth (revenue against the category,",
  "  share), others (price position, supplier DIFOT, promotions, switching). 3 profitability, 2 growth, 3 others.",
  "- Keep every string under 200 characters and on one line.",
  "",
  ...(sop ? [
    `YOUR HEAD OF DEPARTMENT'S NEGOTIATION SOP ("${sop.name}", version ${sop.version}). Follow it for what to emphasise, how to judge`,
    "and the tone. If it conflicts with the RULES above, the RULES win: never a figure outside FACTS, never an AUD amount in an ask.",
    sopText, "",
    ...(sections.length ? [`Write negotiation_approach in the order of the SOP's sections: ${sections.join(" -> ")}.`, ""] : []),
  ] : []),
  "Return ONLY valid JSON, no markdown fences:",
  '{"key_arguments":{"profitability":[{"name":"","description":"","data":"","argument":"","ask":"","impact":3}],"growth":[],"others":[]},',
  '"negotiation_approach":"","incentives":[],"pressures":[]}',
  "incentives: 2-4 things Baby Mart can offer. pressures: 2-4 points the supplier will push back with.",
].join("\n");

let card = null, raw = null;
try {
  // The options form raises max_tokens (the default cap truncates the card
  // mid-JSON); temperature 0 keeps demo runs reproducible.
  const c = snowflake.createStatement({
    sqlText: "SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-sonnet-4-6', [{'role': 'user', 'content': ?}], {'max_tokens': 8192, 'temperature': 0}):choices[0]:messages::STRING",
    binds: [prompt] }).execute();
  c.next();
  raw = c.getColumnValue(1);
  // Strip fences the model may add anyway; a control character inside a JSON
  // string is invalid, and JSON needs none, so they become spaces.
  card = JSON.parse(String(raw).replace(/^\s*```[a-zA-Z]*|```\s*$/g, "").replace(/[\x00-\x1F]/g, " ").trim());
} catch (err) {
  card = null;
}

return JSON.stringify({ brand: e.brand, category: e.category, period: e.period, metrics: e, card, sop,
  card_raw: card ? null : raw });
$$;
