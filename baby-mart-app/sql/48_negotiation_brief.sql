-- ============================================================
-- Category Manager — negotiation brief builder: data and tools
--
-- The battlecard (sql/09) gives a category manager the arguments for a supplier
-- meeting, but its asks and "total addressable" were the model's wording. Here
-- the builder sizes every ask from the data and writes it as a DRAFT brief a
-- category manager approves for the meeting:
--
--   MARGIN       close the brand's margin gap to its category (FY2026 year to
--                date, the battlecard's base), annualised to a year of terms
--   PROMO        the supplier co-funds a share of the promotional discount we
--                give on the brand (FY2026 year to date, annualised)
--   DIFOT        a compliance credit on the deliveries the supplier missed since
--                6 April -- only on misses the DIFOT investigator (sql/47) puts on
--                the supplier. Misses on orders Baby Mart inflated (sized on a
--                planner override) are ours: the builder offers to waive them as
--                a GIVE instead of claiming them.
--   LEVERS       non-money asks: a joint growth plan when the brand trails its
--                category, an allocation commitment when stores are short
--
-- Each money ask has an opening, a target and a walk-away value; the tool adds
-- them up (asks less gives) so the agent never does. STANCE (COLLABORATIVE,
-- BALANCED, FIRM) sets how much of each opening the target keeps. Guardrails
-- flag what would weaken the case: a dependency on the category's largest brand,
-- a sales spike that is a planner override rather than demand, a DIFOT miss that
-- is ours.
--
--   AI.NEGOTIATION_EVIDENCE(BRAND)                       read only
--   AI.BUILD_NEGOTIATION_BRIEF(BRAND, STANCE, REQUEST)   writes a DRAFT
--   ANALYTICS.APPROVE_NEGOTIATION_BRIEF(BRIEF_ID, APPROVER, NOTE)  the app's approve
--
-- Run AFTER sql/09 and sql/47. Idempotent.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.NEGOTIATION_SETTING (
  SETTING_KEY VARCHAR, SETTING_VALUE FLOAT, LABEL VARCHAR, DESCRIPTION VARCHAR
) COMMENT = 'How the negotiation brief builder sizes its asks.';

MERGE INTO BABY_MART_DEMO.ANALYTICS.NEGOTIATION_SETTING t
USING (
  SELECT * FROM VALUES
    ('TARGET_SHARE_COLLABORATIVE', 0.45, 'Target share of the opening (collaborative)', 'The share of each opening ask the target keeps when the stance is COLLABORATIVE.'),
    ('TARGET_SHARE_BALANCED',      0.60, 'Target share of the opening (balanced)',      'The share of each opening ask the target keeps when the stance is BALANCED.'),
    ('TARGET_SHARE_FIRM',          0.75, 'Target share of the opening (firm)',          'The share of each opening ask the target keeps when the stance is FIRM.'),
    ('WALKAWAY_SHARE',             0.25, 'Walk-away share of the opening',               'Below this share of the opening ask, walk away from the margin and promo asks.'),
    ('PROMO_FUND_OPENING_PCT',     50,   'Promo co-funding opening (%)',                 'Opening ask: the share of the promotional discount on the brand the supplier funds.'),
    ('DIFOT_CREDIT_PCT',           3,    'DIFOT compliance credit (%)',                  'Credit claimed on the purchase value of the deliveries the supplier missed.'),
    ('DEPENDENCY_SHARE_PCT',       30,   'Dependency share (%)',                         'A brand with this share of its category or more is one the category depends on.')
  AS v(SETTING_KEY, SETTING_VALUE, LABEL, DESCRIPTION)
) s ON t.SETTING_KEY = s.SETTING_KEY
WHEN NOT MATCHED THEN INSERT VALUES (s.SETTING_KEY, s.SETTING_VALUE, s.LABEL, s.DESCRIPTION);

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.NEGOTIATION_BRIEF (
  BRIEF_ID VARCHAR, BRAND_NAME VARCHAR, SUPPLIER_NAME VARCHAR, DISTRIBUTOR VARCHAR, CATEGORY VARCHAR,
  STANCE VARCHAR, REQUEST VARCHAR, STATUS VARCHAR,
  OPENING_AUD NUMBER(14,0), TARGET_AUD NUMBER(14,0), WALKAWAY_AUD NUMBER(14,0),
  EVIDENCE VARIANT, CREATED_BY VARCHAR, CREATED_AT TIMESTAMP_NTZ,
  APPROVED_BY VARCHAR, APPROVED_AT TIMESTAMP_NTZ, NOTE VARCHAR
) COMMENT = 'Negotiation briefs written by NEGOTIATION_BRIEF_AGENT (DRAFT) and approved by a category manager.';

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.NEGOTIATION_ASK (
  BRIEF_ID VARCHAR, ASK_ID VARCHAR, SEQ NUMBER, KIND VARCHAR, DIRECTION VARCHAR, LABEL VARCHAR, BASIS VARCHAR,
  OPENING_AUD NUMBER(14,0), TARGET_AUD NUMBER(14,0), WALKAWAY_AUD NUMBER(14,0), GUARDRAILS VARIANT
) COMMENT = 'The sized asks (and gives) of each negotiation brief.';

-- ---------- NEGOTIATION_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.NEGOTIATION_EVIDENCE(BRAND VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Negotiation evidence for a brand: FY2026 sales, margin against its category, growth and share, promotional discount, brand switching, price position, the supplier''s DIFOT and whose misses they are, store stock, planner overrides.'
EXECUTE AS OWNER
AS
$$
const C = "BABY_MART_DEMO.CURATED", A = "BABY_MART_DEMO.ANALYTICS", K = "BABY_MART_DEMO.CAMPAIGN";
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) { let v = rs.getColumnValue(i + 1); if (v instanceof Date) v = v.toISOString().slice(0, 10); o[cols[i]] = v; } out.push(o); }
  return out;
}
const r0 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v));
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);

const brands = rows(`SELECT DISTINCT BRAND_NAME FROM ${A}.DT_SELLTHROUGH_WEEKLY ORDER BY 1`).map((r) => r.brand_name);
const bk = String(BRAND || "").trim().toUpperCase();
const brand = brands.find((b) => b.toUpperCase() === bk) || (bk.length >= 3 ? brands.find((b) => b.toUpperCase().includes(bk) || bk.includes(b.toUpperCase())) : null);
if (!brand) return JSON.stringify({ ok: false, error: `No brand matches '${BRAND}'.`, valid_brands: brands });

const cy = rows(`SELECT MAX(FISCAL_YEAR) AS Y FROM ${A}.DT_SELLTHROUGH_WEEKLY`)[0].y;
const weeks = rows(`SELECT COUNT(DISTINCT FISCAL_WEEK) AS W FROM ${A}.DT_SELLTHROUGH_WEEKLY WHERE FISCAL_YEAR = ?`, [cy])[0].w;
const annual = 52 / weeks;
const cat = rows(`SELECT CATEGORY, ANY_VALUE(SUPPLIER_NAME) AS SUP FROM ${A}.DT_SELLTHROUGH_WEEKLY WHERE BRAND_NAME = ? AND FISCAL_YEAR = ? GROUP BY 1 ORDER BY SUM(REVENUE) DESC LIMIT 1`, [brand, cy])[0];
const category = cat.category, posSupplier = cat.sup;

// Every brand in the category, this year and the same weeks last year. Aggregated by
// week and matched here: an IN (SELECT DISTINCT FISCAL_WEEK ...) filter costs ~12 s.
const wk = rows(`SELECT BRAND_NAME, FISCAL_YEAR AS FY, FISCAL_WEEK AS WK, SUM(REVENUE) AS REV, SUM(MARGIN) AS MRG, SUM(UNITS_SOLD) AS UNITS
  FROM ${A}.DT_SELLTHROUGH_WEEKLY WHERE CATEGORY = ? AND FISCAL_YEAR IN (?, ?) GROUP BY 1, 2, 3`, [category, cy, cy - 1]);
const cyWeeks = {};
for (const r of wk) if (r.fy === cy) cyWeeks[r.wk] = true;
const acc = {};
for (const r of wk) {
  const p = acc[r.brand_name] || (acc[r.brand_name] = { brand_name: r.brand_name, rev: 0, mrg: 0, units: 0, rev_py: 0 });
  if (r.fy === cy) { p.rev += r.rev; p.mrg += r.mrg; p.units += r.units; } else if (cyWeeks[r.wk]) p.rev_py += r.rev;
}
const peers = Object.keys(acc).map((k) => acc[k]).sort((x, y) => y.rev - x.rev);
const me = peers.find((p) => p.brand_name === brand);
const tot = peers.reduce((s, p) => ({ rev: s.rev + p.rev, mrg: s.mrg + p.mrg, rev_py: s.rev_py + p.rev_py }), { rev: 0, mrg: 0, rev_py: 0 });
const marginPct = me.rev ? (100 * me.mrg) / me.rev : null, catMarginPct = tot.rev ? (100 * tot.mrg) / tot.rev : null;
const gapPp = marginPct !== null && catMarginPct !== null ? marginPct - catMarginPct : null;
const growth = me.rev_py ? (100 * (me.rev - me.rev_py)) / me.rev_py : null, catGrowth = tot.rev_py ? (100 * (tot.rev - tot.rev_py)) / tot.rev_py : null;
const share = tot.rev ? (100 * me.rev) / tot.rev : null, sharePy = tot.rev_py ? (100 * me.rev_py) / tot.rev_py : null;
const rank = peers.findIndex((p) => p.brand_name === brand) + 1;

// Promotional discount on the brand, FY2026 to date (POS), and what promotions return.
const promo = rows(`SELECT SUM(IFF(t.PROMOTION_KEY > 0, t.DISCOUNT_AMOUNT, 0)) AS DISC, SUM(t.COST_AMOUNT) / NULLIF(SUM(t.QUANTITY), 0) AS UNIT_COST
  FROM ${C}.FACT_TRANSACTION_LINES t JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = t.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE b.BRAND_NAME = ? AND t.DATE_KEY >= 20250701`, [brand])[0];
const mech = rows(`SELECT MECHANIC, SUM(TOTAL_DISCOUNT) AS DISC, SUM(PROMO_MARGIN) AS PM FROM ${A}.DT_PROMOTIONAL_EFFECTIVENESS WHERE BRAND_NAME = ? GROUP BY 1 ORDER BY PM DESC`, [brand]);
const mechDisc = mech.reduce((s, m) => s + m.disc, 0), mechPm = mech.reduce((s, m) => s + m.pm, 0);

// Brand switching, both directions.
const sw = rows(`SELECT SUM(IFF(TO_BRAND = ?, SWITCH_COUNT, 0)) AS GAINED, SUM(IFF(FROM_BRAND = ?, SWITCH_COUNT, 0)) AS LOST FROM ${A}.DT_BRAND_SWITCHING WHERE TO_BRAND = ? OR FROM_BRAND = ?`, [brand, brand, brand, brand])[0];
const lossTo = rows(`SELECT TO_BRAND, SUM(SWITCH_COUNT) AS N FROM ${A}.DT_BRAND_SWITCHING WHERE FROM_BRAND = ? GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [brand])[0] || {};
const price = rows(`SELECT AVG(AVG_PRICE_GAP_PCT) AS GAP FROM ${A}.DT_COMPETITIVE_POSITION WHERE BRAND_NAME = ? AND FISCAL_YEAR = ?`, [brand, cy])[0];

// The supplier's DIFOT on the brand, and whose misses they are (sql/47).
const dist = rows(`SELECT SUPPLIER_NAME FROM ${C}.DIM_DISTRIBUTOR WHERE ARRAY_CONTAINS(?::VARIANT, SPLIT(BRANDS, ','))`, [brand])[0];
let difot = null;
if (dist) {
  const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.AI.DIFOT_ANALYSIS(?, ?, '', '')", binds: [dist.supplier_name, brand] }).execute();
  rs.next();
  const d = JSON.parse(rs.getColumnValue(1));
  if (d.ok) difot = { distributor: dist.supplier_name, target_pct: d.target_pct, recent_difot_pct: d.recent.difot_pct, before_difot_pct: d.before.difot_pct,
    gap_to_target_pts: d.gap_to_target_pts, miss_driver: d.miss_driver, missed_lines: d.recent.missed_lines,
    missed_lines_supplier: d.recent.missed_supplier, missed_lines_ours: d.recent.missed_ours,
    missed_ordered_units_supplier: d.recent.missed_ordered_units_supplier, missed_ordered_units_ours: d.recent.missed_ordered_units_ours,
    units_short: d.recent.units_short, attribution: d.attribution.verdict, ours_share_pct: d.attribution.ours_share_pct,
    stores_short: d.stock ? d.stock.stores_short : 0, short_states: d.stock ? d.stock.short_states : [], window: d.windows.recent };
}
const overrides = rows(`SELECT OVERRIDE_ID, CLASS, FISCAL_WEEK, FACTOR, ENTERED_BY, TO_CHAR(REVIEW_BY, 'YYYY-MM-DD') AS REVIEW_BY, STATUS
  FROM ${A}.DEMAND_OVERRIDE WHERE BRAND_NAME = ? ORDER BY FISCAL_WEEK`, [brand]);

return JSON.stringify({ ok: true, brand, category, supplier: posSupplier, distributor: dist ? dist.supplier_name : null,
  period: `FY${cy} to date: ${weeks} weeks to 7 May 2026 (POS)`, weeks_traded: weeks, annualise_factor: r2(annual),
  sales: { revenue_aud: r0(me.rev), margin_aud: r0(me.mrg), units: r0(me.units), margin_pct: r1(marginPct), margin_pct_category: r1(catMarginPct),
    margin_gap_pp: r1(gapPp), margin_gap_aud: r0(gapPp === null ? null : (gapPp / 100) * me.rev),
    revenue_growth_pct: r1(growth), category_growth_pct: r1(catGrowth), share_pct: r1(share), share_prior_pct: r1(sharePy),
    share_change_pts: share !== null && sharePy !== null ? r1(share - sharePy) : null, rank_in_category: rank, brands_in_category: peers.length },
  promo: { promo_discount_ytd_aud: r0(promo.disc), promo_discount_annual_aud: r0(promo.disc * annual),
    margin_per_aud_discount: mechDisc ? r2(mechPm / mechDisc) : null, best_mechanic: mech.length ? mech[0].mechanic : null },
  switching: { gained: r0(sw.gained), lost: r0(sw.lost), net: r0(sw.gained - sw.lost), top_loss_to: lossTo.to_brand || null, top_loss_to_count: r0(lossTo.n) },
  price_vs_competitors_pct: r1(price.gap), price_note: "Baby Mart's shelf price against competitors' (Woolworths, Coles and others) for the same products, FY2026; positive means Baby Mart is dearer.",
  unit_cost_aud: r2(promo.unit_cost),
  difot, overrides,
  provenance: "Sales, margin, promotions, switching and prices are REAL POS rows (FY2026 to date, the battlecard's base); DIFOT and attribution come from the PO lines (deliveries since 6 April); store stock positions are MODELLED." });
$$;

-- ---------- BUILD_NEGOTIATION_BRIEF ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.BUILD_NEGOTIATION_BRIEF(BRAND VARCHAR, STANCE VARCHAR, REQUEST VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Sizes a negotiation brief for a brand -- margin, promo co-funding and DIFOT asks with opening, target and walk-away values, gives, non-money levers and guardrails -- and writes it as a DRAFT for a category manager to approve.'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS";
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) { let v = rs.getColumnValue(i + 1); if (v instanceof Date) v = v.toISOString().slice(0, 10); o[cols[i]] = v; } out.push(o); }
  return out;
}
const r0 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v));
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const lines = (n) => `${n} line${n === 1 ? "" : "s"}`;
const aud = (v) => "AUD " + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.AI.NEGOTIATION_EVIDENCE(?)", binds: [BRAND || ""] }).execute();
rs.next();
const e = JSON.parse(rs.getColumnValue(1));
if (!e.ok) return JSON.stringify(e);
const S = {};
for (const r of rows(`SELECT SETTING_KEY, SETTING_VALUE FROM ${A}.NEGOTIATION_SETTING`)) S[r.setting_key] = r.setting_value;
const stance = /^(COLLABORATIVE|FIRM)$/i.test(String(STANCE || "").trim()) ? String(STANCE).trim().toUpperCase() : "BALANCED";
const tShare = S["TARGET_SHARE_" + stance], wShare = S.WALKAWAY_SHARE;
const s = e.sales, f = e.annualise_factor;
const asks = [], levers = [], guard = [];

// MARGIN: close the gap to the category, a year of terms.
if (s.margin_gap_pp !== null && s.margin_gap_pp <= -0.3) {
  const open = (-s.margin_gap_pp / 100) * s.revenue_aud * f;
  asks.push({ kind: "MARGIN", direction: "ASK", label: `Close the ${r1(-s.margin_gap_pp)} pt margin gap to ${e.category}`,
    basis: `${e.brand} makes ${s.margin_pct}% against ${s.margin_pct_category}% for the category on ${aud(s.revenue_aud)} of FY2026 sales to date, annualised x${f}.`,
    opening_aud: r0(open), target_aud: r0(open * tShare), walkaway_aud: r0(open * wShare),
    guardrails: -s.margin_gap_pp > 3 ? [{ level: "CAUTION", message: `A ${r1(-s.margin_gap_pp)} pt ask is large: expect the supplier to counter with volume or promo terms.` }] : [] });
} else if (s.margin_gap_pp !== null) {
  levers.push({ kind: "MARGIN_HOLD", label: "Hold current terms", basis: `${e.brand} already makes ${s.margin_pct}% against ${s.margin_pct_category}% for the category: no margin ask.` });
}

// PROMO: the supplier co-funds a share of the discount we give on the brand.
if (e.promo.promo_discount_annual_aud > 0) {
  const base = e.promo.promo_discount_annual_aud, open = (base * S.PROMO_FUND_OPENING_PCT) / 100;
  asks.push({ kind: "PROMO", direction: "ASK", label: `Supplier co-funds ${S.PROMO_FUND_OPENING_PCT}% of promotional discount`,
    basis: `Baby Mart gave ${aud(e.promo.promo_discount_ytd_aud)} of promotional discount on ${e.brand} in FY2026 to date (${aud(base)} a year); promotions return AUD ${e.promo.margin_per_aud_discount} of margin per AUD 1 of discount${e.promo.best_mechanic ? `, best on ${e.promo.best_mechanic}` : ""}.`,
    opening_aud: r0(open), target_aud: r0(open * tShare), walkaway_aud: r0(open * wShare), guardrails: [] });
}

// DIFOT: claim only the supplier's misses; offer to waive the ones that are ours.
const d = e.difot;
if (d && d.recent_difot_pct !== null && d.recent_difot_pct < d.target_pct && e.unit_cost_aud) {
  const credit = (u) => (u * e.unit_cost_aud * S.DIFOT_CREDIT_PCT) / 100;
  if (d.missed_ordered_units_supplier > 0 && d.attribution !== "BABY_MART") {
    const v = credit(d.missed_ordered_units_supplier);
    asks.push({ kind: "DIFOT", direction: "ASK", label: `DIFOT compliance credit (${S.DIFOT_CREDIT_PCT}% of missed deliveries)`,
      basis: `${d.distributor} delivered ${d.recent_difot_pct}% in full and on time since 6 April against the ${d.target_pct}% target; ${lines(d.missed_lines_supplier)} missed (${d.missed_ordered_units_supplier} units ordered) are the supplier's.`,
      opening_aud: r0(v), target_aud: r0(v * tShare), walkaway_aud: 0,
      guardrails: [{ level: "INFO", message: "The credit is tradeable: concede it for an allocation commitment if shelves are short." }] });
  }
  if (d.missed_ordered_units_ours > 0) {
    const v = credit(d.missed_ordered_units_ours);
    asks.push({ kind: "DIFOT_WAIVER", direction: "GIVE", label: `Waive the DIFOT charge on ${lines(d.missed_lines_ours)} that ${d.missed_lines_ours === 1 ? "was" : "were"} our ordering`,
      basis: `${lines(d.missed_lines_ours)} missed (${d.missed_ordered_units_ours} units ordered) ${d.missed_lines_ours === 1 ? "was" : "were"} sized on a planner override or late rush orders: Baby Mart's, not ${d.distributor}'s.`,
      opening_aud: 0, target_aud: r0(v), walkaway_aud: r0(v),
      guardrails: [{ level: "CAUTION", message: "Do not raise these misses as the supplier's failure: our inflated orders caused them. Offer the waiver in exchange for the margin or promo ask." }] });
  }
}

// LEVERS (no money).
if (s.revenue_growth_pct !== null && s.category_growth_pct !== null && s.revenue_growth_pct < s.category_growth_pct - 1)
  levers.push({ kind: "GROWTH_PLAN", label: "Joint growth plan", basis: `${e.brand} is ${s.revenue_growth_pct}% against ${s.category_growth_pct}% for the category; share ${s.share_pct}% (${s.share_change_pts} pts).` });
if (d && d.stores_short > 0)
  levers.push({ kind: "ALLOCATION", label: "Allocation commitment until shelves recover", basis: `${d.stores_short} stores are short (${d.short_states.join("; ")}).` });
if (e.switching.top_loss_to)
  levers.push({ kind: "ALTERNATIVE", label: `Credible alternative: ${e.switching.top_loss_to}`, basis: `${e.switching.top_loss_to_count} customers moved from ${e.brand} to ${e.switching.top_loss_to}; net switching ${e.switching.net}.` });

// GUARDRAILS on the whole brief.
if (s.share_pct >= S.DEPENDENCY_SHARE_PCT)
  guard.push({ level: stance === "FIRM" ? "CAUTION" : "INFO", message: `${e.brand} is ${s.share_pct}% of ${e.category} (rank ${s.rank_in_category} of ${s.brands_in_category}): the category depends on it${stance === "FIRM" ? ", so a firm stance risks the range" : ""}.` });
const active = e.overrides.filter((o) => o.status === "ACTIVE");
if (active.length)
  guard.push({ level: "CAUTION", message: `Do not cite the ${active[0].class} spike as growth: ${active.length} planner override${active.length > 1 ? "s" : ""} (${active.map((o) => o.override_id).join(", ")}) inflate the demand feed, not sales.` });
if (!asks.some((a) => a.direction === "ASK"))
  guard.push({ level: "INFO", message: "No money ask is supported by the data: go in to hold terms." });

const sum = (k, dir) => asks.filter((a) => a.direction === dir).reduce((x, a) => x + (a[k] || 0), 0);
const totals = { opening_aud: r0(sum("opening_aud", "ASK") - sum("opening_aud", "GIVE")), target_aud: r0(sum("target_aud", "ASK") - sum("target_aud", "GIVE")),
  walkaway_aud: r0(sum("walkaway_aud", "ASK") - sum("walkaway_aud", "GIVE")), gives_aud: r0(sum("target_aud", "GIVE")) };

// Write the DRAFT (and retire older drafts for the brand).
const id = "NEG-" + rows(`SELECT TO_CHAR(CURRENT_TIMESTAMP(), 'YYMMDDHH24MISS') || LPAD(UNIFORM(0, 99, RANDOM())::STRING, 2, '0') AS ID`)[0].id;
rows(`UPDATE ${A}.NEGOTIATION_BRIEF SET STATUS = 'SUPERSEDED' WHERE BRAND_NAME = ? AND STATUS = 'DRAFT'`, [e.brand]);
const evidence = { sales: s, promo: e.promo, switching: e.switching, difot: d, levers, guardrails: guard, totals };
rows(`INSERT INTO ${A}.NEGOTIATION_BRIEF (BRIEF_ID, BRAND_NAME, SUPPLIER_NAME, DISTRIBUTOR, CATEGORY, STANCE, REQUEST, STATUS, OPENING_AUD, TARGET_AUD, WALKAWAY_AUD, EVIDENCE, CREATED_BY, CREATED_AT)
  SELECT ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, PARSE_JSON(?), 'NEGOTIATION_BRIEF_AGENT', CURRENT_TIMESTAMP()`,
  [id, e.brand, e.supplier, e.distributor, e.category, stance, String(REQUEST || "").slice(0, 1000), totals.opening_aud, totals.target_aud, totals.walkaway_aud, JSON.stringify(evidence)]);
asks.forEach((a, i) => {
  a.ask_id = "A" + (i + 1);
  rows(`INSERT INTO ${A}.NEGOTIATION_ASK (BRIEF_ID, ASK_ID, SEQ, KIND, DIRECTION, LABEL, BASIS, OPENING_AUD, TARGET_AUD, WALKAWAY_AUD, GUARDRAILS)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?)`, [id, a.ask_id, i + 1, a.kind, a.direction, a.label, a.basis, a.opening_aud, a.target_aud, a.walkaway_aud, JSON.stringify(a.guardrails)]);
});

return JSON.stringify({ ok: true, brief_id: id, status: "DRAFT", brand: e.brand, supplier: e.supplier, distributor: e.distributor, category: e.category, stance,
  target_share: tShare, walkaway_share: wShare, asks, levers, guardrails: guard, totals,
  rule: "Opening = the full sized ask; target = opening x the stance's share; walk-away = opening x the walk-away share (0 for the DIFOT credit, which is tradeable). Totals are asks less gives. Annual values are FY2026 to date x 52 / weeks traded.",
  next: "A category manager approves the brief on the Negotiation brief page before the meeting." });
$$;

-- ---------- APPROVE_NEGOTIATION_BRIEF ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.APPROVE_NEGOTIATION_BRIEF(BRIEF_ID VARCHAR, APPROVER VARCHAR, NOTE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Approves a DRAFT negotiation brief for the meeting, as the signed-in category manager.'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS";
const st = snowflake.createStatement({ sqlText: `SELECT STATUS, BRAND_NAME FROM ${A}.NEGOTIATION_BRIEF WHERE BRIEF_ID = ?`, binds: [BRIEF_ID] });
const rs = st.execute();
if (!rs.next()) return JSON.stringify({ ok: false, error: `No brief ${BRIEF_ID}.` });
const status = rs.getColumnValue(1), brand = rs.getColumnValue(2);
if (status !== "DRAFT") return JSON.stringify({ ok: false, error: `Brief ${BRIEF_ID} is ${status}, not DRAFT.` });
snowflake.createStatement({ sqlText: `UPDATE ${A}.NEGOTIATION_BRIEF SET STATUS = 'APPROVED', APPROVED_BY = ?, APPROVED_AT = CURRENT_TIMESTAMP(), NOTE = ? WHERE BRIEF_ID = ?`,
  binds: [String(APPROVER || "unknown").slice(0, 200), String(NOTE || "").slice(0, 1000), BRIEF_ID] }).execute();
return JSON.stringify({ ok: true, brief_id: BRIEF_ID, brand, status: "APPROVED", approved_by: APPROVER });
$$;
