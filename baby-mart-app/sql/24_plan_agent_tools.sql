-- ============================================================
-- Global Planning — the planning agents' procedure tools
--
-- PLAN_INVESTIGATOR_AGENT and PLAN_BUILDER_AGENT (agent/deploy_plan_agents.sql)
-- reason over these, the way the campaign agents reason over sql/45:
--
--   PLAN_EVIDENCE           everything about one node's gap to budget
--   TEST_PLAN_HYPOTHESIS    is the gap concentrated in one group of a split?
--   PLAN_SCENARIO_REVIEW    a scenario's costed impact and its guardrails
--   PLAN_GOAL_SEEK          resolve a node, run GOAL_SEEK_GP, review both options
--   PLAN_RANGE_CUT          resolve a class, run BUILD_RANGE_RATIONALISATION, review
--
-- THE SOLVER COMPUTES, THE AGENT EXPLAINS (sql/20). The builders are the existing
-- closed-form procedures; these only resolve names, call them, and read back what
-- they wrote. Nothing here writes the approved forecast: a scenario is a DRAFT
-- that a planner submits and approves on the Scenario Planning page.
--
-- A PLAN HAS NO HOLDOUT, so there is no p-value. TEST_PLAN_HYPOTHESIS asks the
-- planning question instead: does one group carry a disproportionate share of the
-- gap (CONCENTRATED), or is every group behind by about the same rate (UNIFORM,
-- which rules that dimension out as the cause)? The thresholds are stated in
-- every result so a planner can argue with them.
--
-- Money is PHP throughout and every money key ends _php, so the app's number
-- check (src/lib/ai/grounded.ts) can trace each figure the agent writes.
-- Owner's rights; every input is resolved against the hierarchy or bound.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- PLAN_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.PLAN_EVIDENCE(NODE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Everything an investigation needs about one RBU, department or class: gap to budget, price/volume bridge, children, traded to date, buy position, suppliers, exceptions.'
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
  while (rs.next()) {
    const o = {};
    for (let i = 0; i < n; i++) {
      let v = rs.getColumnValue(i + 1);
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      o[cols[i]] = v;
    }
    out.push(o);
  }
  return out;
}
function resolve(node) {
  const k = String(node || "").trim();
  if (!k) return null;
  const exact = rows(`SELECT PLAN_LEVEL, RBU, DEPARTMENT, CLASS, LFL_STRATEGY FROM ${A}.VW_MFP_SUMMARY
    WHERE (PLAN_LEVEL = 'CLASS' AND UPPER(CLASS) = UPPER(?)) OR (PLAN_LEVEL = 'DEPARTMENT' AND UPPER(DEPARTMENT) = UPPER(?))
       OR (PLAN_LEVEL = 'RBU' AND UPPER(RBU) = UPPER(?))
    ORDER BY DECODE(PLAN_LEVEL, 'CLASS', 1, 'DEPARTMENT', 2, 3) LIMIT 1`, [k, k, k]);
  if (exact.length) return exact[0];
  const like = rows(`SELECT PLAN_LEVEL, RBU, DEPARTMENT, CLASS, LFL_STRATEGY FROM ${A}.VW_MFP_SUMMARY
    WHERE (PLAN_LEVEL = 'CLASS' AND CLASS ILIKE '%' || ? || '%') OR (PLAN_LEVEL = 'DEPARTMENT' AND DEPARTMENT ILIKE '%' || ? || '%')
    ORDER BY DECODE(PLAN_LEVEL, 'DEPARTMENT', 1, 2) LIMIT 1`, [k, k]);
  return like.length ? like[0] : null;
}
function nodes() {
  return rows(`SELECT DISTINCT PLAN_LEVEL || ': ' || COALESCE(CLASS, DEPARTMENT, RBU) AS N FROM ${A}.VW_MFP_SUMMARY
    WHERE PLAN_LEVEL IN ('RBU', 'DEPARTMENT') ORDER BY 1`).map((r) => r.n);
}
function scope(r) {
  // Every weekly figure is read at CLASS grain and summed, so a department is
  // exactly the sum of its classes and no pre-rolled level is double counted.
  if (r.plan_level === "CLASS") return { where: "CLASS = ?", bind: r["class"], name: r["class"], child: null };
  if (r.plan_level === "DEPARTMENT") return { where: "DEPARTMENT = ?", bind: r.department, name: r.department, child: "CLASS" };
  return { where: "RBU = ?", bind: r.rbu, name: r.rbu, child: "DEPARTMENT" };
}
const r = resolve(NODE);
if (!r) return JSON.stringify({ ok: false, error: `No RBU, department or class matches '${NODE}'.`, valid_nodes: nodes() });
const sc = scope(r);

const head = rows(`SELECT PLAN_LEVEL, LFL_STRATEGY, ROUND(SLS_BUD_PHP) AS SALES_BUDGET_PHP, ROUND(SLS_FC_PHP) AS SALES_FORECAST_PHP,
    ROUND(SLS_LY_PHP) AS SALES_LY_PHP, ROUND(VAR_TO_BUD_PHP) AS GAP_TO_BUDGET_PHP, ROUND(VAR_TO_BUD_PCT, 1) AS GAP_TO_BUDGET_PCT,
    ROUND(LFL_GROWTH_PCT, 1) AS LFL_GROWTH_PCT, ROUND(UNIT_GROWTH_PCT, 1) AS UNIT_GROWTH_VS_LY_PCT,
    ROUND(GP_PCT_FC, 1) AS GP_RATE_FORECAST_PCT, ROUND(GP_PCT_BUD, 1) AS GP_RATE_BUDGET_PCT, ROUND(GP_GAP_PP, 2) AS GP_RATE_GAP_PP,
    ROUND(GP_FC_PHP) AS GP_FORECAST_PHP, ROUND(GP_BUD_PHP) AS GP_BUDGET_PHP, OPT_TOTAL_FC AS OPTIONS, ROUND(OPT_NEW_PCT, 1) AS NEW_OPTION_PCT
  FROM ${A}.VW_MFP_SUMMARY WHERE PLAN_LEVEL = ? AND COALESCE(CLASS, DEPARTMENT, RBU) = ?`, [r.plan_level, sc.name])[0] || {};

// Price / volume bridge against BUDGET over the H1 plan horizon (the same scope as
// VW_MFP_SUMMARY and the MFP pages): volume effect is the unit gap at budget ASP,
// price effect is the ASP gap on forecast units.
const pv = rows(`SELECT SUM(IFF(VERSION = 'BUD' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SB, SUM(IFF(VERSION = 'FC' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SF,
    SUM(IFF(VERSION = 'BUD' AND METRIC = 'SLS_UNITS', VALUE_PHP, 0)) AS UB, SUM(IFF(VERSION = 'FC' AND METRIC = 'SLS_UNITS', VALUE_PHP, 0)) AS UF
  FROM ${A}.FACT_MFP_WEEKLY WHERE PLAN_LEVEL = 'CLASS' AND FISCAL_YEAR = 'F27' AND HALF = 'H1' AND ${sc.where}`, [sc.bind])[0];
const aspB = pv.sb / pv.ub, aspF = pv.sf / pv.uf;
const volEff = (pv.uf - pv.ub) * aspB, priceEff = (aspF - aspB) * pv.uf;
const bridge = { units_budget: Math.round(pv.ub), units_forecast: Math.round(pv.uf), unit_gap_pct: +((pv.uf / pv.ub - 1) * 100).toFixed(1),
  asp_budget_php: +aspB.toFixed(2), asp_forecast_php: +aspF.toFixed(2), asp_gap_pct: +((aspF / aspB - 1) * 100).toFixed(1),
  volume_effect_php: Math.round(volEff), price_effect_php: Math.round(priceEff),
  volume_share_of_gap_pct: +(100 * volEff / (volEff + priceEff)).toFixed(1) };

const children = sc.child ? rows(`SELECT ${sc.child} AS NAME, MAX(LFL_STRATEGY) AS STRATEGY,
    ROUND(SUM(SLS_BUD_PHP)) AS SALES_BUDGET_PHP, ROUND(SUM(SLS_FC_PHP)) AS SALES_FORECAST_PHP, ROUND(SUM(VAR_TO_BUD_PHP)) AS GAP_TO_BUDGET_PHP,
    ROUND(100 * SUM(VAR_TO_BUD_PHP) / NULLIF(SUM(SLS_BUD_PHP), 0), 1) AS GAP_TO_BUDGET_PCT,
    ROUND(100 * SUM(VAR_TO_BUD_PHP) / NULLIF(SUM(SUM(VAR_TO_BUD_PHP)) OVER (), 0), 1) AS SHARE_OF_GAP_PCT,
    ROUND(AVG(UNIT_GROWTH_PCT), 1) AS UNIT_GROWTH_VS_LY_PCT, ROUND(AVG(GP_GAP_PP), 2) AS GP_RATE_GAP_PP
  FROM ${A}.VW_MFP_SUMMARY WHERE PLAN_LEVEL = ? AND ${sc.where} GROUP BY 1 ORDER BY GAP_TO_BUDGET_PHP`, [sc.child, sc.bind]) : [];

const byHalf = rows(`SELECT HALF, ROUND(SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0))) AS SALES_BUDGET_PHP, ROUND(SUM(IFF(VERSION = 'FC', VALUE_PHP, 0))) AS SALES_FORECAST_PHP,
    ROUND(100 * (SUM(IFF(VERSION = 'FC', VALUE_PHP, 0)) / NULLIF(SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0)), 0) - 1), 1) AS GAP_TO_BUDGET_PCT
  FROM ${A}.FACT_MFP_WEEKLY WHERE PLAN_LEVEL = 'CLASS' AND FISCAL_YEAR = 'F27' AND METRIC = 'SLS_PHP' AND ${sc.where} GROUP BY 1 ORDER BY 1 DESC`, [sc.bind]);

// What has actually traded: closed weeks only, actual against forecast and budget.
const traded = rows(`SELECT COUNT(DISTINCT WEEK_SEQ) AS CLOSED_WEEKS, ROUND(SUM(IFF(VERSION = 'ACT', VALUE_PHP, 0))) AS SALES_ACTUAL_PHP,
    ROUND(SUM(IFF(VERSION = 'FC', VALUE_PHP, 0))) AS SALES_FORECAST_PHP, ROUND(SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0))) AS SALES_BUDGET_PHP,
    ROUND(100 * (SUM(IFF(VERSION = 'ACT', VALUE_PHP, 0)) / NULLIF(SUM(IFF(VERSION = 'FC', VALUE_PHP, 0)), 0) - 1), 1) AS ACTUAL_VS_FORECAST_PCT,
    ROUND(100 * (SUM(IFF(VERSION = 'ACT', VALUE_PHP, 0)) / NULLIF(SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0)), 0) - 1), 1) AS ACTUAL_VS_BUDGET_PCT
  FROM ${A}.FACT_MFP_WEEKLY w
  WHERE PLAN_LEVEL = 'CLASS' AND FISCAL_YEAR = 'F27' AND METRIC = 'SLS_PHP' AND ${sc.where}
    AND (WEEK_SEQ, CLASS) IN (SELECT WEEK_SEQ, CLASS FROM ${A}.FACT_MFP_WEEKLY a
      WHERE a.VERSION = 'ACT' AND a.PLAN_LEVEL = 'CLASS' AND a.FISCAL_YEAR = 'F27' AND a.METRIC = 'SLS_PHP' AND a.VALUE_PHP > 0)`, [sc.bind])[0];

const buy = rows(`SELECT COALESCE(CLASS, DEPARTMENT, RBU) AS NAME, PLAN_LEVEL, BUY_STATUS, ROUND(STOCK_PHP) AS STOCK_PHP, ROUND(ON_ORDER_PHP) AS ON_ORDER_PHP,
    TOTAL_COVER_WEEKS AS COVER_INCL_ON_ORDER_WEEKS, TARGET_COVER_WEEKS, ROUND(OTB_AVAILABLE_PHP) AS OTB_AVAILABLE_PHP
  FROM ${A}.VW_OTB_SUMMARY WHERE ${sc.where} AND PLAN_LEVEL IN (?, ?) ORDER BY DECODE(PLAN_LEVEL, ?, 0, 1), NAME`,
  [sc.bind, r.plan_level, sc.child || r.plan_level, r.plan_level]);

const suppliers = rows(`SELECT SUPPLIER_NAME, LISTAGG(DISTINCT CLASS, ', ') AS CLASSES, COUNT(*) AS POS, COUNT_IF(ETA_SLIP_DAYS > 0) AS LATE_POS,
    ROUND(AVG(IFF(ETA_SLIP_DAYS > 0, ETA_SLIP_DAYS, NULL)), 1) AS AVG_SLIP_DAYS, ROUND(SUM(COMMITTED_PHP)) AS COMMITTED_PHP
  FROM ${A}.FACT_SUPPLIER_COMMITMENT WHERE ${sc.where} GROUP BY 1 ORDER BY LATE_POS DESC, COMMITTED_PHP DESC`, [sc.bind]);

const names = [sc.name].concat(children.map((c) => c.name)).concat(suppliers.map((s) => s.supplier_name));
const exceptions = rows(`SELECT EXCEPTION_TYPE, SEVERITY, PLAN_LEVEL, NODE, ROUND(VARIANCE_PCT, 1) AS VARIANCE_PCT, ROUND(VARIANCE_PHP) AS VARIANCE_PHP, HEADLINE
  FROM ${A}.VW_PLANNING_EXCEPTIONS WHERE ARRAY_CONTAINS(NODE::VARIANT, PARSE_JSON(?)) ORDER BY SEVERITY, ABS(VARIANCE_PHP) DESC`, [JSON.stringify(names)]);

return JSON.stringify({ ok: true, node: sc.name, level: r.plan_level, rbu: r.rbu, department: r.department,
  strategy: r.lfl_strategy === "D" ? "Planned decline" : "Growth", fiscal_year: "F27", currency: "PHP",
  scope: "Budget, forecast, gap and price/volume are for the F27 H1 plan horizon (Jan-Jun 2027, PD07-PD12), the same scope as the MFP pages. by_half shows both halves; traded_to_date is the closed H2 weeks (Jul 2026 onwards).",
  summary: head, price_volume_vs_budget: bridge, children_level: sc.child, children, by_half: byHalf,
  traded_to_date: traded, buy_position: buy, suppliers, exceptions,
  dimensions_you_can_test: sc.child ? ["children", "month", "half", "price_volume", "traded", "strategy", "supplier", "buy", "margin"] : ["month", "half", "price_volume", "traded", "margin"] });
$$;

-- ---------- TEST_PLAN_HYPOTHESIS ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.TEST_PLAN_HYPOTHESIS(NODE VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Is a node''s gap to budget concentrated in one group of a split (children, month, half, strategy, supplier, buy status), or explained by price vs volume, trading vs budget, or margin rate?'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS";
// Thresholds, stated in every result.
const SHARE = 50, SPREAD = 3, MATERIAL = 1, DOMINANT = 70, TRACK = 2;
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = rs.getColumnValue(i + 1); out.push(o); }
  return out;
}
function resolve(node) {
  const k = String(node || "").trim();
  const r = rows(`SELECT PLAN_LEVEL, RBU, DEPARTMENT, CLASS FROM ${A}.VW_MFP_SUMMARY
    WHERE (PLAN_LEVEL = 'CLASS' AND UPPER(CLASS) = UPPER(?)) OR (PLAN_LEVEL = 'DEPARTMENT' AND UPPER(DEPARTMENT) = UPPER(?))
       OR (PLAN_LEVEL = 'RBU' AND UPPER(RBU) = UPPER(?))
       OR (PLAN_LEVEL IN ('CLASS', 'DEPARTMENT') AND COALESCE(CLASS, DEPARTMENT) ILIKE '%' || ? || '%')
    ORDER BY IFF(UPPER(COALESCE(CLASS, DEPARTMENT, RBU)) = UPPER(?), 0, 1), DECODE(PLAN_LEVEL, 'CLASS', 1, 'DEPARTMENT', 2, 3) LIMIT 1`, [k, k, k, k, k]);
  return r[0] || null;
}
const r = resolve(NODE);
if (!r) return JSON.stringify({ ok: false, error: `No RBU, department or class matches '${NODE}'.` });
const lvl = r.plan_level;
const sc = lvl === "CLASS" ? { where: "CLASS = ?", bind: r["class"], name: r["class"], child: null }
  : lvl === "DEPARTMENT" ? { where: "DEPARTMENT = ?", bind: r.department, name: r.department, child: "CLASS" }
  : { where: "RBU = ?", bind: r.rbu, name: r.rbu, child: "DEPARTMENT" };
const ALIAS = { children: "children", child: "children", "class": "children", classes: "children", department: "children", departments: "children",
  month: "month", period: "month", months: "month", half: "half", season: "half",
  price: "price_volume", volume: "price_volume", price_volume: "price_volume", "price/volume": "price_volume", asp: "price_volume", units: "price_volume",
  traded: "traded", actuals: "traded", budget: "traded", forecast: "traded", trading: "traded",
  strategy: "strategy", lfl: "strategy", "planned decline": "strategy",
  supplier: "supplier", suppliers: "supplier", po: "supplier", eta: "supplier",
  buy: "buy", otb: "buy", cover: "buy", overbuy: "buy", stock: "buy", margin: "margin", gp: "margin" };
const dim = ALIAS[String(DIMENSION || "").trim().toLowerCase()];
if (!dim) return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'. Use one of: children, month, half, price_volume, traded, strategy, supplier, buy, margin.` });
if (!sc.child && ["children", "strategy", "supplier", "buy"].includes(dim))
  return JSON.stringify({ ok: false, error: `${sc.name} is a class: it has no children to split. Use month, half, price_volume, traded or margin.` });

// Groups of the plan with budget and forecast, then the concentration reading.
function split(groups, label) {
  const bud = groups.reduce((a, g) => a + g.sales_budget_php, 0), gap = groups.reduce((a, g) => a + g.gap_to_budget_php, 0);
  for (const g of groups) {
    g.gap_to_budget_pct = +(100 * g.gap_to_budget_php / g.sales_budget_php).toFixed(1);
    g.share_of_gap_pct = +(100 * g.gap_to_budget_php / gap).toFixed(1);
  }
  groups.sort((a, b) => a.gap_to_budget_php - b.gap_to_budget_php);
  const gapPct = +(100 * gap / bud).toFixed(1);
  const rates = groups.map((g) => g.gap_to_budget_pct);
  const spread = +(Math.max.apply(null, rates) - Math.min.apply(null, rates)).toFixed(1);
  const top = groups[0];
  const rest = groups.slice(1), restBud = rest.reduce((a, g) => a + g.sales_budget_php, 0), restGap = rest.reduce((a, g) => a + g.gap_to_budget_php, 0);
  const restPct = rest.length ? +(100 * restGap / restBud).toFixed(1) : null;
  let verdict, reading;
  if (Math.abs(gapPct) < MATERIAL) { verdict = "NOT_SUPPORTED"; reading = `${sc.name} is within ${MATERIAL}% of budget overall, so there is no material gap to explain by ${label}.`; }
  else if (top.share_of_gap_pct >= SHARE && restPct !== null && Math.abs(top.gap_to_budget_pct - restPct) >= SPREAD) {
    verdict = "SUPPORTED"; reading = `CONCENTRATED: ${top.value} carries ${top.share_of_gap_pct}% of the gap and is ${top.gap_to_budget_pct}% to budget against ${restPct}% for the rest.`; }
  else if (spread <= SPREAD) { verdict = "NOT_SUPPORTED"; reading = `UNIFORM: every ${label} is between ${Math.min.apply(null, rates)}% and ${Math.max.apply(null, rates)}% to budget (a ${spread}-point spread), so the gap is not specific to any one ${label}. Look for a cause that applies to all of them.`; }
  else { verdict = "INCONCLUSIVE"; reading = `MIXED: ${top.value} is the largest contributor (${top.share_of_gap_pct}% of the gap, ${top.gap_to_budget_pct}% to budget) but the rates spread ${spread} points without one group dominating.`; }
  return { node: sc.name, dimension: dim, gap_to_budget_php: Math.round(gap), gap_to_budget_pct: gapPct, spread_pts: spread, groups, verdict, reading,
    rule: `SUPPORTED when one group carries at least ${SHARE}% of the gap and its rate differs from the rest by ${SPREAD}+ points; NOT_SUPPORTED when every group is within ${SPREAD} points (uniform) or the gap is under ${MATERIAL}% of budget.` };
}
const W = `FROM ${A}.FACT_MFP_WEEKLY WHERE PLAN_LEVEL = 'CLASS' AND FISCAL_YEAR = 'F27' AND ${sc.where}`;
// The plan horizon the MFP pages and VW_MFP_SUMMARY report on.
const H1 = " AND HALF = 'H1'";
const num = (g) => { g.sales_budget_php = Math.round(g.sales_budget_php); g.gap_to_budget_php = Math.round(g.gap_to_budget_php); return g; };
let out;
if (dim === "children" || dim === "strategy" || dim === "buy" || dim === "supplier") {
  const kids = rows(`SELECT ${sc.child} AS VALUE, MAX(LFL_STRATEGY) AS STRATEGY, SUM(SLS_BUD_PHP) AS SALES_BUDGET_PHP, SUM(VAR_TO_BUD_PHP) AS GAP_TO_BUDGET_PHP
    FROM ${A}.VW_MFP_SUMMARY WHERE PLAN_LEVEL = ? AND ${sc.where} GROUP BY 1`, [sc.child, sc.bind]).map(num);
  if (dim === "children") out = split(kids, sc.child.toLowerCase());
  else {
    let key;
    if (dim === "strategy") key = (k) => (k.strategy === "D" ? "Planned decline" : "Growth");
    else if (dim === "buy") {
      const st = {}; rows(`SELECT ${sc.child} AS N, BUY_STATUS FROM ${A}.VW_OTB_SUMMARY WHERE PLAN_LEVEL = ? AND ${sc.where}`, [sc.child, sc.bind]).forEach((x) => (st[x.n] = x.buy_status));
      key = (k) => st[k.value] || "UNKNOWN";
    } else {
      const late = {}; rows(`SELECT ${sc.child} AS N, COUNT_IF(ETA_SLIP_DAYS > 0) AS L FROM ${A}.FACT_SUPPLIER_COMMITMENT WHERE ${sc.where} GROUP BY 1`, [sc.bind]).forEach((x) => (late[x.n] = x.l));
      key = (k) => (late[k.value] > 0 ? "Has delayed supplier POs" : "No delayed POs");
    }
    const g = {}; const members = {};
    for (const k of kids) { const v = key(k); g[v] = g[v] || { value: v, sales_budget_php: 0, gap_to_budget_php: 0 }; g[v].sales_budget_php += k.sales_budget_php; g[v].gap_to_budget_php += k.gap_to_budget_php; (members[v] = members[v] || []).push(k.value); }
    out = split(Object.keys(g).map((v) => Object.assign(g[v], { members: members[v].join(", ") })), dim === "strategy" ? "strategy" : dim === "buy" ? "buy status" : "supplier group");
    if (dim === "strategy") {
      const d = out.groups.find((x) => x.value === "Planned decline");
      out.reading += d ? ` Planned-decline classes (${d.members}) carry ${d.share_of_gap_pct}% of the gap; a decline there is on strategy and should be judged against budget, not last year.` : " No class in scope is on a planned-decline strategy.";
    }
  }
} else if (dim === "month" || dim === "half") {
  const col = dim === "month" ? "PERIOD_CODE" : "HALF";
  const g = rows(`SELECT ${col} AS VALUE, SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0)) AS SALES_BUDGET_PHP,
      SUM(IFF(VERSION = 'FC', VALUE_PHP, 0)) - SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0)) AS GAP_TO_BUDGET_PHP ${W} AND METRIC = 'SLS_PHP'${dim === "month" ? H1 : ""} GROUP BY 1`, [sc.bind]).map(num);
  out = split(g, dim);
  out.scope = dim === "month" ? "H1 plan horizon months (PD07-PD12)" : "Both halves of F27: H2 Jul-Dec 2026 and H1 Jan-Jun 2027";
} else if (dim === "price_volume") {
  const p = rows(`SELECT SUM(IFF(VERSION = 'BUD' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SB, SUM(IFF(VERSION = 'FC' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SF,
      SUM(IFF(VERSION = 'BUD' AND METRIC = 'SLS_UNITS', VALUE_PHP, 0)) AS UB, SUM(IFF(VERSION = 'FC' AND METRIC = 'SLS_UNITS', VALUE_PHP, 0)) AS UF ${W}${H1}`, [sc.bind])[0];
  const aB = p.sb / p.ub, aF = p.sf / p.uf, vol = (p.uf - p.ub) * aB, pr = (aF - aB) * p.uf, share = 100 * vol / (vol + pr);
  const verdict = Math.abs(share) >= DOMINANT && Math.abs(100 - share) < DOMINANT ? "SUPPORTED" : "INCONCLUSIVE";
  out = { node: sc.name, dimension: dim, scope: "H1 plan horizon", gap_to_budget_php: Math.round(p.sf - p.sb), volume_effect_php: Math.round(vol), price_effect_php: Math.round(pr),
    volume_share_of_gap_pct: +share.toFixed(1), unit_gap_pct: +((p.uf / p.ub - 1) * 100).toFixed(1), asp_gap_pct: +((aF / aB - 1) * 100).toFixed(1),
    verdict, reading: share >= DOMINANT ? `VOLUME: ${share.toFixed(1)}% of the gap is units (${((p.uf / p.ub - 1) * 100).toFixed(1)}% to budget) at budget ASP; ASP is ${((aF / aB - 1) * 100).toFixed(1)}% to budget, so price is not the cause.`
      : share <= 100 - DOMINANT ? `PRICE: the ASP gap (${((aF / aB - 1) * 100).toFixed(1)}%) explains most of the shortfall, not units.` : `Both units and ASP contribute materially.`,
    rule: `Volume effect = unit gap x budget ASP; price effect = ASP gap x forecast units. SUPPORTED when one effect is at least ${DOMINANT}% of the gap.` };
} else if (dim === "traded") {
  const t = rows(`SELECT COUNT(DISTINCT WEEK_SEQ) AS WEEKS, SUM(IFF(VERSION = 'ACT', VALUE_PHP, 0)) AS ACT, SUM(IFF(VERSION = 'FC', VALUE_PHP, 0)) AS FC, SUM(IFF(VERSION = 'BUD', VALUE_PHP, 0)) AS BUD
    ${W} AND METRIC = 'SLS_PHP' AND (WEEK_SEQ, CLASS) IN (SELECT WEEK_SEQ, CLASS FROM ${A}.FACT_MFP_WEEKLY WHERE VERSION = 'ACT' AND PLAN_LEVEL = 'CLASS' AND FISCAL_YEAR = 'F27' AND METRIC = 'SLS_PHP' AND VALUE_PHP > 0)`, [sc.bind])[0];
  const vf = 100 * (t.act / t.fc - 1), vb = 100 * (t.act / t.bud - 1);
  const tracks = Math.abs(vf) <= TRACK;
  out = { node: sc.name, dimension: dim, scope: "Closed H2 weeks traded so far (Jul 2026 onwards)", closed_weeks: t.weeks, sales_actual_php: Math.round(t.act), sales_forecast_php: Math.round(t.fc), sales_budget_php: Math.round(t.bud),
    actual_vs_forecast_pct: +vf.toFixed(1), actual_vs_budget_pct: +vb.toFixed(1),
    verdict: tracks && vb <= -MATERIAL ? "SUPPORTED" : !tracks ? "INCONCLUSIVE" : "NOT_SUPPORTED",
    reading: tracks && vb <= -MATERIAL ? `BUDGET ABOVE TRADING: across ${t.weeks} traded weeks actual sales are ${vf.toFixed(1)}% to forecast but ${vb.toFixed(1)}% to budget. The forecast is tracking what customers actually buy; the shortfall is the budget being set above demand, not a forecast miss or a trading failure.`
      : !tracks ? `FORECAST MISS: actuals are ${vf.toFixed(1)}% to forecast across ${t.weeks} traded weeks, so the forecast itself needs re-basing before the gap to budget can be trusted.`
      : `Actuals are on budget across ${t.weeks} traded weeks.`,
    rule: `The forecast "tracks" when traded actuals are within ${TRACK}% of it.` };
} else {
  const m = rows(`SELECT SUM(IFF(VERSION = 'BUD' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SB, SUM(IFF(VERSION = 'FC' AND METRIC = 'SLS_PHP', VALUE_PHP, 0)) AS SF,
      SUM(IFF(VERSION = 'BUD' AND METRIC = 'POS_GP_AMT', VALUE_PHP, 0)) AS GB, SUM(IFF(VERSION = 'FC' AND METRIC = 'POS_GP_AMT', VALUE_PHP, 0)) AS GF ${W}${H1}`, [sc.bind])[0];
  const rB = m.gb / m.sb, rF = m.gf / m.sf, fromSales = (m.sf - m.sb) * rB, fromRate = (rF - rB) * m.sf, gap = m.gf - m.gb;
  out = { node: sc.name, dimension: dim, scope: "H1 plan horizon", gp_gap_to_budget_php: Math.round(gap), gp_from_sales_gap_php: Math.round(fromSales), gp_from_rate_gap_php: Math.round(fromRate),
    gp_rate_budget_pct: +(100 * rB).toFixed(1), gp_rate_forecast_pct: +(100 * rF).toFixed(1), gp_rate_gap_pp: +(100 * (rF - rB)).toFixed(2),
    rate_share_of_gp_gap_pct: +(100 * fromRate / gap).toFixed(1),
    verdict: Math.abs(fromRate / gap) >= DOMINANT / 100 ? "SUPPORTED" : "NOT_SUPPORTED",
    reading: Math.abs(fromRate / gap) >= DOMINANT / 100 ? `MARGIN RATE: ${(100 * fromRate / gap).toFixed(1)}% of the GP gap is the margin rate (${(100 * (rF - rB)).toFixed(2)} pp).` : `SALES, NOT MARGIN: ${(100 * fromSales / gap).toFixed(1)}% of the GP gap comes from lower sales at the budget margin rate; the rate itself moves only ${(100 * (rF - rB)).toFixed(2)} pp.`,
    rule: `GP gap = sales gap x budget rate + rate gap x forecast sales. SUPPORTED when the rate part is at least ${DOMINANT}% of the GP gap.` };
}
out.ok = true;
return JSON.stringify(out);
$$;

-- ---------- PLAN_SCENARIO_REVIEW ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.PLAN_SCENARIO_REVIEW(SCENARIO_ID VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'A scenario''s costed impact (sales, GP, GP rate, stock), its assumptions, its siblings, and guardrails: achievable, cover after the change vs target, NEW options dropped, price move size.'
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
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) { let v = rs.getColumnValue(i + 1); if (v instanceof Date) v = v.toISOString(); o[cols[i]] = v; } out.push(o); }
  return out;
}
const id = String(SCENARIO_ID || "").trim();
if (!/^SCN-[A-Za-z0-9]{8,40}$/.test(id)) return JSON.stringify({ ok: false, error: "SCENARIO_ID must look like SCN-..." });
const fam = rows(`SELECT SCENARIO_ID FROM ${A}.PLANNING_SCENARIO WHERE SCENARIO_ID = ? OR PARENT_SCENARIO_ID = ?`, [id, id]).map((x) => x.scenario_id);
if (!fam.length) return JSON.stringify({ ok: false, error: `No scenario ${id}.` });
const list = rows(`SELECT SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, PARENT_SCENARIO_ID, SIBLING_LABEL, DEPARTMENT, CLASS, HALF, STATUS,
    ROUND(SLS_DELTA_PHP) AS SALES_DELTA_PHP, ROUND(SLS_DELTA_PCT, 2) AS SALES_DELTA_PCT, ROUND(GP_DELTA_PHP) AS GP_DELTA_PHP, ROUND(GP_DELTA_PCT, 2) AS GP_DELTA_PCT,
    ROUND(BASE_GP_PCT, 2) AS GP_RATE_BEFORE_PCT, ROUND(SCEN_GP_PCT, 2) AS GP_RATE_AFTER_PCT, ROUND(GP_PCT_DELTA_PP, 2) AS GP_RATE_DELTA_PP,
    ROUND(STOCK_DELTA_PHP) AS STOCK_DELTA_PHP, ROUND(UNITS_DELTA) AS UNITS_DELTA, OPTIONS_DROPPED, OPTIONS_ADDED, OPTIONS_REPRICED, ASSUMPTIONS
  FROM ${A}.VW_SCENARIO_IMPACT WHERE ARRAY_CONTAINS(SCENARIO_ID::VARIANT, PARSE_JSON(?)) AND SCENARIO_TYPE <> 'GOAL_SEEK' ORDER BY SIBLING_LABEL`, [JSON.stringify(fam)]);
const out = [];
for (const s of list) {
  const a = typeof s.assumptions === "string" ? JSON.parse(s.assumptions) : (s.assumptions || {});
  delete s.assumptions;
  const g = [];
  // Cover after the change, on the class (or department) the scenario acts on.
  const node = s["class"] || s.department;
  const lvl = s["class"] ? "CLASS" : "DEPARTMENT";
  const b = node ? rows(`SELECT BUY_STATUS, STOCK_PHP + ON_ORDER_PHP AS COMMITTED, TOTAL_COVER_WEEKS AS COVER, TARGET_COVER_WEEKS AS TARGET
    FROM ${A}.VW_OTB_SUMMARY WHERE PLAN_LEVEL = ? AND COALESCE(CLASS, DEPARTMENT) = ?`, [lvl, node])[0] : null;
  if (b) {
    const after = b.cover * (b.committed + s.stock_delta_php) / b.committed;
    s.cover_before_weeks = +(+b.cover).toFixed(1); s.cover_after_weeks = +after.toFixed(1); s.target_cover_weeks = +(+b.target).toFixed(1); s.buy_status_before = b.buy_status;
    if (b.buy_status === "OVERBUY" && s.stock_delta_php > 0) g.push({ level: "CAUTION", message: `${node} is already overbought at ${s.cover_before_weeks} weeks cover vs a ${s.target_cover_weeks}-week target, and this adds stock.` });
    if (b.buy_status === "OVERBUY" && s.stock_delta_php < 0) g.push({ level: "PASS", message: `Releases stock in an overbought class: cover moves from ${s.cover_before_weeks} to ${s.cover_after_weeks} weeks against a ${s.target_cover_weeks}-week target.` });
    if (b.buy_status === "UNDERBUY" && s.stock_delta_php < 0) g.push({ level: "CAUTION", message: `${node} is underbought and this releases further stock.` });
  }
  if (a.achievable === false) g.push({ level: "BLOCK", message: `Not achievable through price: the most price can add here is PHP ${(a.max_attainable_gp_php / 1e6).toFixed(2)}M, at a ${a.price_at_max_pct}% rise.` });
  if (typeof a.price_move_pct === "number" && a.price_move_pct > 5) g.push({ level: "CAUTION", message: `A ${a.price_move_pct}% retail price rise on the popular SKUs is large; elasticity (${a.price_elasticity}) is the binding assumption.` });
  if (s.scenario_type === "RANGE_RATIONALISATION") {
    const nw = rows(`SELECT COUNT(*) AS N FROM ${A}.PLANNING_SCENARIO_OPTION so JOIN ${A}.DIM_PLAN_OPTION o ON o.OPTION_ID = so.OPTION_ID
      WHERE so.SCENARIO_ID = ? AND so.ACTION = 'DROP' AND o.OPTION_STATUS = 'NEW'`, [s.scenario_id])[0].n;
    s.new_options_dropped = nw;
    if (nw > 0) g.push({ level: "CAUTION", message: `${nw} of the ${s.options_dropped} options it drops are NEW this season and have had little time to trade.` });
  }
  if (s.scenario_type === "GOAL_SEEK_RANGE_INCREMENT") g.push({ level: "CAUTION", message: `Needs PHP ${(s.stock_delta_php / 1e6).toFixed(1)}M of new stock before it sells; lead time to range ${s.options_added} new options is not modelled.` });
  const top = rows(`SELECT OPTION_LABEL, ACTION, ROUND(GP_DELTA_PHP) AS GP_DELTA_PHP, ROUND(STOCK_DELTA_PHP) AS STOCK_DELTA_PHP FROM ${A}.PLANNING_SCENARIO_OPTION
    WHERE SCENARIO_ID = ? ORDER BY ABS(GP_DELTA_PHP) DESC LIMIT 5`, [s.scenario_id]);
  out.push(Object.assign(s, { assumptions: { method: a.method, price_move_pct: a.price_move_pct, price_elasticity: a.price_elasticity, achievable: a.achievable,
      max_attainable_gp_php: a.max_attainable_gp_php, options_deleted: a.options_deleted, options_reviewed: a.options_reviewed, demand_transfer_pct: a.demand_transfer_pct,
      options_added: a.options_added, ramp_factor: a.ramp_factor, ramp_pct: typeof a.ramp_factor === "number" ? +(a.ramp_factor * 100).toFixed(1) : undefined,
      cannibalisation_pct: a.cannibalisation_pct, stock_investment_php: a.stock_investment_php, caveat: a.caveat },
    guardrails: g, largest_options: top, open_in_app: `/planning/scenarios?scenario=${s.scenario_id}` }));
}
return JSON.stringify({ ok: true, scenario_id: id, scenarios: out,
  next_step: "These are DRAFT scenarios in the sandbox. A planner compares them on the Scenario Planning page, submits one, and approves it there; only approval writes the forecast." });
$$;

-- ---------- PLAN_GOAL_SEEK ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.PLAN_GOAL_SEEK(NODE VARCHAR, TARGET_GP_PHP FLOAT, HALF VARCHAR, REQUEST VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Find a stated amount of gross profit in a department or class: runs GOAL_SEEK_GP (2a price and promo, 2b range increment) as DRAFT scenarios and returns both reviewed.'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS";
function one(sql, binds) { const rs = snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute(); return rs.next() ? rs.getColumnValue(1) : null; }
const k = String(NODE || "").trim();
const target = Number(TARGET_GP_PHP);
if (!(target > 0) || target > 500000000) return JSON.stringify({ ok: false, error: "TARGET_GP_PHP must be a positive amount in PHP (expand 500k to 500000), at most 500,000,000." });
const half = ["H1", "H2"].includes(String(HALF || "").toUpperCase()) ? String(HALF).toUpperCase() : "H2";
const cls = one(`SELECT MAX(CLASS) FROM ${A}.DIM_MERCH_HIERARCHY WHERE UPPER(CLASS) = UPPER(?)`, [k]);
const dept = cls ? one(`SELECT MAX(DEPARTMENT) FROM ${A}.DIM_MERCH_HIERARCHY WHERE CLASS = ?`, [cls]) : one(`SELECT MAX(DEPARTMENT) FROM ${A}.DIM_MERCH_HIERARCHY WHERE UPPER(DEPARTMENT) = UPPER(?)`, [k]);
if (!cls && !dept) return JSON.stringify({ ok: false, error: `No department or class matches '${NODE}'. Goal seek works on one department or class.` });
const call = `CALL ${A}.GOAL_SEEK_GP(?, ${cls ? "?" : "NULL"}, ?, ?, 'Plan Builder agent', ?)`;
const binds = cls ? [dept, cls, target, half, String(REQUEST || "").slice(0, 2000)] : [dept, target, half, String(REQUEST || "").slice(0, 2000)];
const res = JSON.parse(one(call, binds));
if (!res.ok) return JSON.stringify(res);
const review = JSON.parse(one(`CALL ${A}.PLAN_SCENARIO_REVIEW(?)`, [res.parent_scenario_id]));
return JSON.stringify({ ok: true, department: dept, "class": cls, half, target_gp_php: target, parent_scenario_id: res.parent_scenario_id,
  price_option_achievable: res.price_option_achievable, scenarios: review.scenarios, next_step: review.next_step });
$$;

-- ---------- PLAN_RANGE_CUT ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.PLAN_RANGE_CUT(CLASS_NAME VARCHAR, BOTTOM_PCT FLOAT, HALF VARCHAR, REQUEST VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Rationalise the least productive options in a class (GP per option-week): runs BUILD_RANGE_RATIONALISATION as a DRAFT scenario and returns it reviewed.'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS";
function one(sql, binds) { const rs = snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute(); return rs.next() ? rs.getColumnValue(1) : null; }
const cls = one(`SELECT MAX(CLASS) FROM ${A}.DIM_MERCH_HIERARCHY WHERE UPPER(CLASS) = UPPER(?)`, [String(CLASS_NAME || "").trim()]);
if (!cls) return JSON.stringify({ ok: false, error: `No class matches '${CLASS_NAME}'. A range cut works on one class.` });
const pct = Number(BOTTOM_PCT);
if (!(pct >= 1 && pct <= 50)) return JSON.stringify({ ok: false, error: "BOTTOM_PCT must be between 1 and 50: cutting more than half a range is a range exit, a different decision." });
const half = ["H1", "H2"].includes(String(HALF || "").toUpperCase()) ? String(HALF).toUpperCase() : "H2";
const res = JSON.parse(one(`CALL ${A}.BUILD_RANGE_RATIONALISATION(?, ?, ?, 'Plan Builder agent', ?)`, [cls, pct, half, String(REQUEST || "").slice(0, 2000)]));
if (!res.ok) return JSON.stringify(res);
const review = JSON.parse(one(`CALL ${A}.PLAN_SCENARIO_REVIEW(?)`, [res.scenario_id]));
return JSON.stringify({ ok: true, "class": cls, bottom_pct: pct, half, scenario_id: res.scenario_id, scenarios: review.scenarios, next_step: review.next_step });
$$;
