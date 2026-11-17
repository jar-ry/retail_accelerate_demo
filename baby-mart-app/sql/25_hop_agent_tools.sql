-- ============================================================
-- Head of Planning — the investigator's procedure tools
--
-- HOP_INVESTIGATOR_AGENT (agent/deploy_hop_agents.sql) works two questions with
-- the campaign / planning agent pattern (evidence pack, then a hypothesis test
-- per candidate cause):
--
--   STORE PLAN LFL   "why does QLD plan weaker like-for-like?"
--     HOP_STORE_EVIDENCE(SCOPE)               state / region / format / store / ALL
--     HOP_TEST_STORE_HYPOTHESIS(SCOPE, DIM)   mix, region, format, state, store,
--                                             month, reason, benchmark, edits
--   PLANNING CHAIN   "why is the bottom-up MFP short of the mix target, who moves?"
--     HOP_CHAIN_EVIDENCE()                    store plan -> RBU mix -> MFP -> depts
--     HOP_TEST_CHAIN_GAP(NODE, DIM)           department, topdown, units_asp,
--                                             options, owner, month
--
-- Read only: nothing here writes the plan. Every figure is computed in SQL or
-- JavaScript from the same views the pages read (VW_STORE_PLAN_WEEKLY,
-- VW_PLANNING_CHAIN, VW_MFP_IDENTITY), so the agent quotes what the page shows.
--
-- THE PLAN HAS NO HOLDOUT. A store plan LFL test asks the planning question: is
-- the gap to the company rate concentrated in one group, or explained by WHICH
-- stores a scope has (mix) rather than HOW they are planned (rate)? Thresholds are
-- stated in every result. Rates are percentages and points, already scaled; money
-- keys end _aud, so the app's number check (src/lib/ai/grounded.ts) can trace
-- every figure the agent writes.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ---------- HOP_STORE_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_STORE_EVIDENCE(SCOPE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Store plan like-for-like evidence for a scope (ALL, a state, region, format or store): LFL vs company, splits, lowest and highest stores, explained moves, new stores, post-lock edits.'
EXECUTE AS OWNER
AS
$$
const H = "BABY_MART_DEMO.HEAD_OF_PLANNING";
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) { let v = rs.getColumnValue(i + 1); if (v instanceof Date) v = v.toISOString().slice(0, 10); o[cols[i]] = v; } out.push(o); }
  return out;
}
const r2 = (v) => Math.round(v * 100) / 100;
const M = rows(`SELECT w.STORE_CODE, MAX(w.STORE_NAME) AS STORE_NAME, MAX(s.STATE) AS STATE, MAX(s.REGION) AS REGION, MAX(s.STORE_FORMAT) AS STORE_FORMAT,
    MAX(IFF(s.IS_NEW_STORE, 1, 0)) AS IS_NEW, w.MONTH_NAME, MIN(w.FY_PERIOD_NO) AS P,
    SUM(IFF(w.IS_LFL_UNIVERSE, w.LY_SALES_AUD, 0)) AS LY, SUM(IFF(w.IS_LFL_UNIVERSE, w.PLAN_SALES_AUD, 0)) AS PL, SUM(w.PLAN_SALES_AUD) AS TOT,
    MAX(d.REASON_CODE) AS REASON_CODE, MAX(d.RATIONALE) AS RATIONALE, MAX(d.LFL_PCT) AS DRIVER_LFL,
    MAX(IFF(bm.BENCHMARK_STORE_CODE IS NOT NULL, 1, 0)) AS IS_BENCHMARK
  FROM ${H}.VW_STORE_PLAN_WEEKLY w JOIN ${H}.DIM_STORE s ON s.STORE_CODE = w.STORE_CODE
  LEFT JOIN ${H}.STORE_PLAN_DRIVER d ON d.STORE_CODE = w.STORE_CODE AND d.MONTH_NAME = w.MONTH_NAME AND d.FY_YEAR = w.FY_YEAR
  LEFT JOIN (SELECT DISTINCT BENCHMARK_STORE_CODE FROM ${H}.DIM_STORE WHERE IS_NEW_STORE) bm ON bm.BENCHMARK_STORE_CODE = w.STORE_CODE
  GROUP BY w.STORE_CODE, w.MONTH_NAME`);
function resolve(scope) {
  const k = String(scope || "").trim();
  if (!k || /^(all|company|total|baby mart|business)$/i.test(k)) return { label: "Baby Mart (all stores)", test: () => true, kind: "ALL" };
  const U = k.toUpperCase();
  const by = (f, kind) => { const hit = M.find((m) => String(m[f]).toUpperCase() === U); return hit ? { label: `${kind} ${hit[f]}`, test: (m) => String(m[f]).toUpperCase() === U, kind } : null; };
  return by("state", "STATE") || by("region", "REGION") || by("store_format", "FORMAT") || by("store_code", "STORE")
    || (() => { const hit = M.find((m) => String(m.store_name).toUpperCase().includes(U)); return hit ? { label: `STORE ${hit.store_code} ${hit.store_name}`, test: (m) => m.store_code === hit.store_code, kind: "STORE" } : null; })();
}
const sc = resolve(SCOPE);
if (!sc) return JSON.stringify({ ok: false, error: `No state, region, format or store matches '${SCOPE}'.`,
  valid: { states: [...new Set(M.map((m) => m.state))].sort(), regions: [...new Set(M.map((m) => m.region))].sort(), formats: [...new Set(M.map((m) => m.store_format))].sort() } });
function agg(rs) {
  const ly = rs.reduce((a, m) => a + m.ly, 0), pl = rs.reduce((a, m) => a + m.pl, 0), tot = rs.reduce((a, m) => a + m.tot, 0);
  return { ly, pl, tot, lfl: ly ? (pl / ly - 1) * 100 : null, stores: new Set(rs.filter((m) => m.ly > 0).map((m) => m.store_code)).size };
}
const co = agg(M), inScope = M.filter(sc.test), s = agg(inScope);
const gap = s.lfl - co.lfl;
function split(field, label) {
  const g = {};
  for (const m of inScope) (g[m[field]] = g[m[field]] || []).push(m);
  return Object.keys(g).map((v) => { const a = agg(g[v]); return { [label]: v, stores: a.stores, ly_sales_aud: Math.round(a.ly), lfl_pct: a.lfl === null ? null : r2(a.lfl), vs_company_pts: a.lfl === null ? null : r2(a.lfl - co.lfl) }; })
    .filter((x) => x.ly_sales_aud > 0).sort((a, b) => a.lfl_pct - b.lfl_pct);
}
const stores = split("store_code", "store_code").map((x) => {
  const m = inScope.filter((r) => r.store_code === x.store_code), f = m[0];
  return Object.assign(x, { store_name: f.store_name, state: f.state, region: f.region, format: f.store_format,
    benchmark_for_new_store: f.is_benchmark === 1, reasons: [...new Set(m.map((r) => r.reason_code).filter(Boolean))] });
});
const moves = inScope.filter((m) => m.reason_code).map((m) => ({ store_code: m.store_code, store_name: m.store_name, month: m.month_name,
  reason_code: m.reason_code, driver_lfl_pct: m.driver_lfl === null ? null : r2(m.driver_lfl * 100), rationale: m.rationale })).sort((a, b) => a.store_code.localeCompare(b.store_code));
const scopeCodes = [...new Set(inScope.map((m) => m.store_code))];
const newStores = rows(`SELECT n.STORE_CODE, n.STORE_NAME, n.STATE, n.REGION, n.BENCHMARK_STORE_CODE, b.STORE_NAME AS BENCHMARK_NAME, ROUND(100 * n.BENCHMARK_PCT, 1) AS BENCHMARK_PCT,
    n.OPENING_DATE, ROUND(SUM(w.PLAN_SALES_AUD)) AS PLAN_SALES_AUD
  FROM ${H}.DIM_STORE n LEFT JOIN ${H}.DIM_STORE b ON b.STORE_CODE = n.BENCHMARK_STORE_CODE
  LEFT JOIN ${H}.VW_STORE_PLAN_WEEKLY w ON w.STORE_CODE = n.STORE_CODE
  WHERE n.IS_NEW_STORE GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 ORDER BY 1`).filter((n) => sc.kind === "ALL" || scopeCodes.includes(n.store_code) || scopeCodes.includes(n.benchmark_store_code));
const edits = rows(`SELECT ENTITY_CODE AS STORE_CODE, MONTH_NAME, MEASURE_CODE, ROUND(100 * OLD_VALUE, 2) AS OLD_PCT, ROUND(100 * NEW_VALUE, 2) AS NEW_PCT, REASON_CODE, CHANGED_BY,
    IS_POST_LOCK_AMENDMENT, COMPLIANCE_STATUS FROM ${H}.VW_OVERRIDE_COMPLIANCE WHERE PLAN_KIND = 'STORE_PLAN' AND APPROVAL_ID IS NOT NULL ORDER BY CHANGED_AT`)
  .filter((e) => sc.kind === "ALL" || scopeCodes.includes(e.store_code));
return JSON.stringify({ ok: true, scope: sc.label, scope_kind: sc.kind, currency: "AUD", horizon: "FY27 H1 store plan, Jul-Dec 2026. Plan LFL is plan sales over the same weeks last year, comparable stores only; new stores are excluded from LFL.",
  company: { stores: co.stores, ly_sales_aud: Math.round(co.ly), lfl_plan_sales_aud: Math.round(co.pl), lfl_pct: r2(co.lfl), total_plan_sales_aud: Math.round(co.tot), new_store_plan_sales_aud: Math.round(co.tot - co.pl) },
  scope_summary: { stores: s.stores, ly_sales_aud: Math.round(s.ly), lfl_plan_sales_aud: Math.round(s.pl), lfl_pct: r2(s.lfl), vs_company_pts: r2(gap),
    shortfall_vs_company_rate_aud: Math.round(s.ly * gap / 100), total_plan_sales_aud: Math.round(s.tot) },
  by_state: sc.kind === "STATE" || sc.kind === "STORE" ? undefined : split("state", "state"),
  by_region: sc.kind === "STORE" ? undefined : split("region", "region"),
  by_format: sc.kind === "STORE" ? undefined : split("store_format", "format"),
  by_month: split("month_name", "month"),
  lowest_stores: stores.slice(0, 8), highest_stores: stores.slice(-3).reverse(),
  explained_moves: moves, new_stores: newStores, post_lock_edits: edits,
  dimensions_you_can_test: ["mix", "region", "format", "state", "store", "month", "reason", "benchmark", "edits"] });
$$;

-- ---------- HOP_TEST_STORE_HYPOTHESIS ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_TEST_STORE_HYPOTHESIS(SCOPE VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Tests one candidate cause of a scope''s store plan LFL gap to the company: store mix vs planned rate, or a split by region, format, state, store, month, reason code, new-store benchmark, or post-lock edits.'
EXECUTE AS OWNER
AS
$$
const H = "BABY_MART_DEMO.HEAD_OF_PLANNING";
// Thresholds, stated in every result.
const MATERIAL = 0.25, SHARE = 50, DIFF = 1.0, SPREAD = 0.75, MIX_SUPPORTED = 50, MIX_RULED_OUT = 25, OUTLIER = 1.5;
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = rs.getColumnValue(i + 1); out.push(o); }
  return out;
}
const r2 = (v) => Math.round(v * 100) / 100;
const M = rows(`SELECT w.STORE_CODE, MAX(w.STORE_NAME) AS STORE_NAME, MAX(s.STATE) AS STATE, MAX(s.REGION) AS REGION, MAX(s.STORE_FORMAT) AS STORE_FORMAT, w.MONTH_NAME,
    SUM(IFF(w.IS_LFL_UNIVERSE, w.LY_SALES_AUD, 0)) AS LY, SUM(IFF(w.IS_LFL_UNIVERSE, w.PLAN_SALES_AUD, 0)) AS PL,
    MAX(d.REASON_CODE) AS REASON_CODE,
    MAX(IFF(bm.BENCHMARK_STORE_CODE IS NOT NULL, 1, 0)) AS IS_BENCHMARK
  FROM ${H}.VW_STORE_PLAN_WEEKLY w JOIN ${H}.DIM_STORE s ON s.STORE_CODE = w.STORE_CODE
  LEFT JOIN ${H}.STORE_PLAN_DRIVER d ON d.STORE_CODE = w.STORE_CODE AND d.MONTH_NAME = w.MONTH_NAME AND d.FY_YEAR = w.FY_YEAR
  LEFT JOIN (SELECT DISTINCT BENCHMARK_STORE_CODE FROM ${H}.DIM_STORE WHERE IS_NEW_STORE) bm ON bm.BENCHMARK_STORE_CODE = w.STORE_CODE
  WHERE w.IS_LFL_UNIVERSE GROUP BY w.STORE_CODE, w.MONTH_NAME`);
function resolve(scope) {
  const k = String(scope || "").trim();
  if (!k || /^(all|company|total|baby mart|business)$/i.test(k)) return { label: "Baby Mart (all stores)", test: () => true, kind: "ALL" };
  const U = k.toUpperCase();
  const by = (f, kind) => { const hit = M.find((m) => String(m[f]).toUpperCase() === U); return hit ? { label: `${kind} ${hit[f]}`, test: (m) => String(m[f]).toUpperCase() === U, kind } : null; };
  return by("state", "STATE") || by("region", "REGION") || by("store_format", "FORMAT") || by("store_code", "STORE")
    || (() => { const hit = M.find((m) => String(m.store_name).toUpperCase().includes(U)); return hit ? { label: `STORE ${hit.store_code} ${hit.store_name}`, test: (m) => m.store_code === hit.store_code, kind: "STORE" } : null; })();
}
const sc = resolve(SCOPE);
if (!sc) return JSON.stringify({ ok: false, error: `No state, region, format or store matches '${SCOPE}'. Use ALL, a state (VIC, QLD...), a region (Metro, Regional, CBD), a format (Standard, Large Format) or a store code.` });
const ALIAS = { mix: "mix", "store mix": "mix", "mix vs rate": "mix", composition: "mix", region: "region", regions: "region", format: "format", formats: "format", store_format: "format",
  state: "state", states: "state", store: "store", stores: "store", month: "month", months: "month", reason: "reason", reasons: "reason", reason_code: "reason", explained: "reason",
  benchmark: "benchmark", cannibalisation: "benchmark", cannibalization: "benchmark", "new store": "benchmark", new_store: "benchmark", edits: "edits", edit: "edits", amendments: "edits", "post-lock": "edits", overrides: "edits" };
const dim = ALIAS[String(DIMENSION || "").trim().toLowerCase()];
if (!dim) return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'. Use one of: mix, region, format, state, store, month, reason, benchmark, edits.` });
const agg = (rs) => { const ly = rs.reduce((a, m) => a + m.ly, 0), pl = rs.reduce((a, m) => a + m.pl, 0); return { ly, pl, lfl: ly ? (pl / ly - 1) * 100 : 0 }; };
const co = agg(M), inScope = M.filter(sc.test), s = agg(inScope), gap = s.lfl - co.lfl;
const base = { ok: true, scope: sc.label, dimension: dim, company_lfl_pct: r2(co.lfl), scope_lfl_pct: r2(s.lfl), vs_company_pts: r2(gap),
  shortfall_vs_company_rate_aud: Math.round(s.ly * gap / 100), scope_ly_sales_aud: Math.round(s.ly) };
const inLine = Math.abs(gap) < MATERIAL;

if (dim === "mix") {
  if (sc.kind === "ALL") return JSON.stringify(Object.assign(base, { verdict: "NOT_SUPPORTED", reading: "The company is its own benchmark, so there is no mix to compare. Test a state, region or format." }));
  // The scope's LFL if each of its region x format cells planned at the COMPANY rate for that cell.
  const cell = (m) => `${m.region} / ${m.store_format}`;
  const coCell = {}, sCell = {};
  for (const m of M) { const c = (coCell[cell(m)] = coCell[cell(m)] || { ly: 0, pl: 0 }); c.ly += m.ly; c.pl += m.pl; }
  for (const m of inScope) { const c = (sCell[cell(m)] = sCell[cell(m)] || { ly: 0, pl: 0 }); c.ly += m.ly; c.pl += m.pl; }
  let expPl = 0;
  const cells = Object.keys(sCell).map((k) => { const c = sCell[k], r = coCell[k].pl / coCell[k].ly; expPl += c.ly * r;
    return { cell: k, share_of_scope_ly_pct: r2(100 * c.ly / s.ly), share_of_company_ly_pct: r2(100 * coCell[k].ly / co.ly), scope_lfl_pct: r2((c.pl / c.ly - 1) * 100), company_lfl_pct: r2((r - 1) * 100) }; })
    .sort((a, b) => b.share_of_scope_ly_pct - a.share_of_scope_ly_pct);
  const expected = (expPl / s.ly - 1) * 100, mixPts = expected - co.lfl, ratePts = s.lfl - expected;
  const mixShare = gap ? 100 * mixPts / gap : 0;
  const verdict = inLine ? "NOT_SUPPORTED" : mixShare >= MIX_SUPPORTED ? "SUPPORTED" : mixShare < MIX_RULED_OUT ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  return JSON.stringify(Object.assign(base, { lfl_at_company_rates_pct: r2(expected), mix_effect_pts: r2(mixPts), rate_effect_pts: r2(ratePts), mix_share_of_gap_pct: r2(mixShare), cells, verdict,
    reading: inLine ? `${sc.label} plans ${r2(s.lfl)}% against ${r2(co.lfl)}% for the company, within ${MATERIAL} points: there is no material gap to explain.`
      : `At the company's own rate for each region and format, ${sc.label} would plan ${r2(expected)}%. Store mix accounts for ${r2(mixPts)} of the ${r2(gap)}-point gap (${r2(mixShare)}%); how its stores are planned accounts for ${r2(ratePts)} points.`
        + (mixShare >= MIX_SUPPORTED ? " The gap is mostly WHICH stores it has, not how they are planned." : mixShare < MIX_RULED_OUT ? " Mix does not explain it: the stores are planned lower than comparable stores elsewhere." : ""),
    rule: `Mix effect = LFL at company rates per region x format, minus the company LFL. SUPPORTED when mix is at least ${MIX_SUPPORTED}% of the gap; NOT_SUPPORTED below ${MIX_RULED_OUT}% or when the gap is under ${MATERIAL} points.` }));
}

if (dim === "edits") {
  const codes = new Set(inScope.map((m) => m.store_code));
  const v = rows(`SELECT STORE_CODE, ROUND(SUM(SALES_VARIANCE_AUD)) AS SALES_VARIANCE_AUD, ROUND(SUM(APPROVED_SALES_AUD)) AS APPROVED_SALES_AUD
    FROM ${H}.VW_VARIANCE_TO_APPROVED GROUP BY 1 HAVING ABS(SUM(SALES_VARIANCE_AUD)) >= 1`).filter((x) => sc.kind === "ALL" || codes.has(x.store_code));
  const e = rows(`SELECT ENTITY_CODE AS STORE_CODE, MONTH_NAME, MEASURE_CODE, ROUND(100 * OLD_VALUE, 2) AS OLD_PCT, ROUND(100 * NEW_VALUE, 2) AS NEW_PCT, CHANGED_BY, COMPLIANCE_STATUS
    FROM ${H}.VW_OVERRIDE_COMPLIANCE WHERE PLAN_KIND = 'STORE_PLAN' AND APPROVAL_ID IS NOT NULL`).filter((x) => sc.kind === "ALL" || codes.has(x.store_code));
  const moved = v.reduce((a, x) => a + x.sales_variance_aud, 0), approved = rows(`SELECT SUM(APPROVED_SALES_AUD) AS A FROM ${H}.VW_VARIANCE_TO_APPROVED`)[0].a;
  const nonCompliant = e.filter((x) => x.compliance_status !== "COMPLIANT").length;
  const material = Math.abs(moved) >= 0.0025 * approved * (s.ly / co.ly);
  return JSON.stringify(Object.assign(base, { post_lock_edits: e, stores_moved_since_approval: v, sales_moved_since_approval_aud: Math.round(moved), non_compliant_edits: nonCompliant,
    verdict: material ? "SUPPORTED" : "NOT_SUPPORTED",
    reading: (e.length ? `${e.length} store plan edit(s) since the board approval move sales by AUD ${Math.round(moved)}${nonCompliant ? `, and ${nonCompliant} lacked the escalation a post-lock change needs` : ""}.` : "No store plan edits since the board approval.")
      + (material ? " That is material against the scope's plan." : " Too small to explain the LFL gap; the gap was in the plan the board approved."),
    rule: "SUPPORTED when edits since approval move the scope's sales by at least 0.25% of its share of the approved plan." }));
}

const keyOf = { region: (m) => m.region, format: (m) => m.store_format, state: (m) => m.state, store: (m) => `${m.store_code} ${m.store_name}`, month: (m) => m.month_name,
  reason: (m) => m.reason_code || "No recorded reason", benchmark: (m) => (m.is_benchmark ? "Benchmark for a new store (cannibalisation risk)" : "Not a new-store benchmark") }[dim];
if (dim === "state" && sc.kind === "STATE") return JSON.stringify({ ok: false, error: "The scope is a single state. Split it by region, format, store, month, reason or benchmark instead." });
const g = {};
for (const m of inScope) (g[keyOf(m)] = g[keyOf(m)] || []).push(m);
const groups = Object.keys(g).map((k) => { const a = agg(g[k]);
  return { value: k, ly_sales_aud: Math.round(a.ly), lfl_pct: r2(a.lfl), vs_company_pts: r2(a.lfl - co.lfl),
    contribution_pts: r2((a.ly * (a.lfl - co.lfl) / 100) / s.ly * 100), contribution_aud: Math.round(a.ly * (a.lfl - co.lfl) / 100) }; })
  .sort((a, b) => a.contribution_pts - b.contribution_pts);
const rates = groups.map((x) => x.lfl_pct), spread = r2(Math.max(...rates) - Math.min(...rates));
let verdict, reading;
const outliers = groups.filter((x) => x.vs_company_pts <= -OUTLIER);
if (sc.kind === "ALL") {
  // The whole business has no gap to itself, so ask whether any group plans apart from the rest.
  const vsRest = groups.map((x) => { const rest = agg(inScope.filter((m) => keyOf(m) !== x.value)); return Object.assign(x, { rest_lfl_pct: r2(rest.lfl), vs_rest_pts: r2(x.lfl_pct - rest.lfl) }); });
  // The weakest group that plans apart from the rest leads: that is what "why is X weak" asks about.
  const apart = vsRest.filter((x) => Math.abs(x.vs_rest_pts) >= DIFF).sort((a, b) => a.vs_rest_pts - b.vs_rest_pts);
  const far = apart[0] || vsRest.slice().sort((a, b) => Math.abs(b.vs_rest_pts) - Math.abs(a.vs_rest_pts))[0];
  if (apart.length) {
    verdict = "SUPPORTED"; reading = `DIFFERS: ${apart.map((x) => `${x.value} plans ${x.lfl_pct}% against ${x.rest_lfl_pct}% for the rest of the business (${x.vs_rest_pts} points)`).join("; ")}.`;
  } else {
    verdict = "NOT_SUPPORTED"; reading = `UNIFORM: no ${dim} plans more than ${DIFF} point(s) apart from the rest of the business; the widest is ${far.value} at ${far.vs_rest_pts} points.`;
  }
} else if (inLine) {
  verdict = "NOT_SUPPORTED";
  reading = `IN LINE: ${sc.label} plans ${r2(s.lfl)}% against ${r2(co.lfl)}% for the company, so there is no gap to explain by ${dim}.`
    + (outliers.length ? ` Within it, ${outliers.map((o) => `${o.value} (${o.lfl_pct}%)`).join(", ")} plan(s) at least ${OUTLIER} points below the company, offset by stronger groups.` : "");
} else {
  for (const x of groups) x.share_of_gap_pct = r2(100 * x.contribution_pts / gap);
  const top = gap < 0 ? groups[0] : groups[groups.length - 1];
  const rest = inScope.filter((m) => keyOf(m) !== top.value), ra = agg(rest);
  const restPct = rest.length ? r2(ra.lfl) : null;
  if (top.share_of_gap_pct >= SHARE && restPct !== null && Math.abs(top.lfl_pct - restPct) >= DIFF) {
    verdict = "SUPPORTED"; reading = `CONCENTRATED: ${top.value} carries ${top.share_of_gap_pct}% of the ${r2(gap)}-point gap, planning ${top.lfl_pct}% against ${restPct}% for the rest of ${sc.label}.`;
  } else if (spread <= SPREAD) {
    verdict = "NOT_SUPPORTED"; reading = `UNIFORM: every ${dim} in ${sc.label} plans between ${Math.min(...rates)}% and ${Math.max(...rates)}% (a ${spread}-point spread), so the gap is not specific to one ${dim}.`;
  } else if (top.share_of_gap_pct >= SHARE) {
    verdict = "INCONCLUSIVE"; reading = `CONTRIBUTOR: ${top.value} carries ${top.share_of_gap_pct}% of the gap at ${top.lfl_pct}% LFL, but plans only ${r2(Math.abs(top.lfl_pct - restPct))} points apart from the rest of ${sc.label} (${restPct}%), under the ${DIFF}-point bar. It is where the gap sits because it is a large share of the scope; test mix to see whether that is composition.`;
  } else {
    verdict = "INCONCLUSIVE"; reading = `MIXED: ${top.value} is the largest contributor (${top.share_of_gap_pct}% of the gap, ${top.lfl_pct}% LFL), but no single ${dim} dominates; the rates spread ${spread} points.`;
  }
}
return JSON.stringify(Object.assign(base, { spread_pts: spread, groups: dim === "store" ? groups.slice(0, 10).concat(groups.length > 10 ? groups.slice(-3) : []) : groups, verdict, reading,
  rule: `Contribution = group LY x (group LFL - company LFL), in points of the scope's LFL. SUPPORTED when one group carries at least ${SHARE}% of the gap and plans ${DIFF}+ points apart from the rest; NOT_SUPPORTED when every group is within ${SPREAD} points or the scope is within ${MATERIAL} points of the company.` }));
$$;

-- ---------- HOP_CHAIN_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_CHAIN_EVIDENCE()
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'The planning chain: store plan -> RBU mix target -> bottom-up MFP per RBU -> departments, with each department''s stated vs derived growth, units vs ASP, options, the MFP-vs-WSSI budget reconciliation and who owns each measure.'
EXECUTE AS OWNER
AS
$$
const H = "BABY_MART_DEMO.HEAD_OF_PLANNING";
function rows(sql) {
  const st = snowflake.createStatement({ sqlText: sql });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = rs.getColumnValue(i + 1); out.push(o); }
  return out;
}
const chain = rows(`SELECT HOP, STAGE, RBU_CODE, ENTITY, ROUND(VALUE_AUD) AS VALUE_AUD, ROUND(PARENT_VALUE_AUD) AS PARENT_VALUE_AUD,
  ROUND(100 * SHARE_OF_PARENT, 2) AS SHARE_OF_PARENT_PCT, ROUND(VARIANCE_AUD) AS VARIANCE_AUD FROM ${H}.VW_PLANNING_CHAIN ORDER BY HOP, RBU_CODE, ENTITY`);
const store = chain.find((c) => c.hop === 1);
const mix = rows(`SELECT RBU_CODE, RBU_DESCRIPTION, ROUND(100 * LY_MIX_PCT_MEASURED, 2) AS LY_MIX_MEASURED_PCT, ROUND(100 * PLAN_MIX_PCT_STATED, 2) AS PLAN_MIX_PCT, NOTE
  FROM ${H}.RBU_MIX_TARGET WHERE IS_TRADED ORDER BY 1`);
const ids = rows(`SELECT PLAN_LEVEL, RBU_CODE, ENTITY_CODE, ENTITY_NAME, F26_ACTUAL, LFL_FORECAST, GROWTH_STATED, GROWTH_DERIVED, GROWTH_BREAK_PTS, TPR_BUDGET,
  UNIT_GROWTH_PCT, ASP_GROWTH_PCT, OPT_PRESENTED, OPT_COMMITTED, OPT_DESELECTED, DESELECT_PCT, SALES_AT_RISK_AUD, FIRST_MARGIN_MOVE_PTS FROM ${H}.VW_MFP_IDENTITY ORDER BY PLAN_LEVEL DESC, ENTITY_CODE`);
const pct = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 100);
const shape = (i) => ({ code: i.entity_code, name: i.entity_name, rbu_code: i.rbu_code, ly_sales_aud: Math.round(i.f26_actual), lfl_forecast_aud: Math.round(i.lfl_forecast),
  stated_growth_pct: pct(i.growth_stated), stated_budget_aud: Math.round(i.f26_actual * (1 + i.growth_stated)), bottom_up_aud: Math.round(i.tpr_budget),
  derived_growth_pct: pct(i.growth_derived), growth_break_pts: pct(i.growth_break_pts), gap_to_stated_aud: Math.round(i.tpr_budget - i.f26_actual * (1 + i.growth_stated)),
  unit_growth_pct: pct(i.unit_growth_pct), asp_growth_pct: pct(i.asp_growth_pct), options_presented: i.opt_presented, options_committed: i.opt_committed,
  options_deselected: i.opt_deselected, deselected_pct: pct(i.deselect_pct), sales_at_risk_aud: Math.round(i.sales_at_risk_aud), first_margin_move_pts: pct(i.first_margin_move_pts) });
const rbus = ids.filter((i) => i.plan_level === "RBU").map((i) => {
  const o = shape(i), m = mix.find((x) => x.rbu_code === i.rbu_code), t = chain.find((c) => c.hop === 2 && c.rbu_code === i.rbu_code);
  return Object.assign(o, { plan_mix_pct: m ? m.plan_mix_pct : null, ly_mix_measured_pct: m ? m.ly_mix_measured_pct : null, mix_target_aud: t ? t.value_aud : null,
    gap_to_mix_target_aud: t ? Math.round(i.tpr_budget - t.value_aud) : null, gap_to_mix_target_pct: t ? Math.round(10000 * (i.tpr_budget / t.value_aud - 1)) / 100 : null });
});
const recon = rows(`SELECT RBU_CODE, ROUND(SUM(MFP_AUD)) AS MFP_PHASED_AUD, ROUND(SUM(BUD_AUD)) AS WSSI_BUDGET_AUD, ROUND(SUM(VARIANCE_AUD)) AS VARIANCE_AUD,
  COUNT_IF(STATUS <> 'TIES') AS MONTHS_DIFFERENT FROM ${H}.VW_MFP_WSSI_RECON GROUP BY 1 ORDER BY 1`);
const owners = rows(`SELECT MEASURE_CODE, MAX(OWNING_PARTY) AS OWNING_PARTY, MAX(MEASURE_LABEL) AS LABEL FROM ${H}.VW_MEASURE_OWNERSHIP
  WHERE MEASURE_CODE IN ('TPR_BUDGET_AUD', 'F27_TPR_UNIT_SALES', 'F27_TPR_ASP_AUD', 'TOTAL_GROWTH_PCT_STATED', 'PLAN_MIX_PCT_STATED', 'LFL_GROWTH_PCT', 'OPTIONS_NEW', 'OPTIONS_ONGOING', 'LFL_PCT')
  GROUP BY 1 ORDER BY 1`);
return JSON.stringify({ ok: true, currency: "AUD", horizon: "FY27 H1, Jul-Dec 2026",
  store_plan_total_aud: store ? store.value_aud : null, chain, rbus, departments: ids.filter((i) => i.plan_level === "DEPARTMENT").map(shape),
  mfp_vs_wssi_budget: recon, ownership: owners,
  how_to_read: "Hop 2 applies each RBU's agreed mix to the live store plan total; hop 3 is the bottom-up range plan (units x ASP); its variance is the gap to the mix target. An RBU's gap = (bottom-up - stated budget, the range) + (stated budget - mix target, the top-down mismatch). gap_to_stated_aud per department sums to the first part.",
  dimensions_you_can_test: ["department", "topdown", "units_asp", "options", "owner", "month"] });
$$;

-- ---------- HOP_TEST_CHAIN_GAP ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_TEST_CHAIN_GAP(NODE VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Tests one candidate cause of an RBU''s (or department''s) gap between the bottom-up MFP and its target: by department, top-down vs bottom-up, units vs ASP, dropped options, owning party, or month.'
EXECUTE AS OWNER
AS
$$
const H = "BABY_MART_DEMO.HEAD_OF_PLANNING";
const SHARE = 50, DIFF = 2, MATERIAL = 0.5, UNIFORM_DESELECT = 1.5;
function rows(sql) {
  const st = snowflake.createStatement({ sqlText: sql });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = rs.getColumnValue(i + 1); out.push(o); }
  return out;
}
const r2 = (v) => Math.round(v * 100) / 100, pct = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 100);
const ids = rows(`SELECT * FROM ${H}.VW_MFP_IDENTITY`);
const chain = rows(`SELECT HOP, RBU_CODE, VALUE_AUD FROM ${H}.VW_PLANNING_CHAIN WHERE HOP = 2`);
const k = String(NODE || "").trim().toUpperCase().replace(/^BABY-/, "");
const node = ids.find((i) => i.entity_code === k || String(i.entity_name).toUpperCase() === k || String(i.entity_name).toUpperCase().replace(/^BABY-/, "") === k)
  || ids.find((i) => String(i.entity_name).toUpperCase().includes(k) && k.length >= 3);
if (!node) return JSON.stringify({ ok: false, error: `No RBU or department matches '${NODE}'. RBUs: 100 BABY-CONSUMABLES, 200 BABY-HARDGOODS; departments: ${ids.filter((i) => i.plan_level === "DEPARTMENT").map((i) => i.entity_name).join(", ")}.` });
const ALIAS = { department: "department", departments: "department", dept: "department", children: "department", topdown: "topdown", "top-down": "topdown", "top down": "topdown", mix: "topdown", target: "topdown",
  units_asp: "units_asp", units: "units_asp", asp: "units_asp", price: "units_asp", volume: "units_asp", "units vs asp": "units_asp", options: "options", range: "options", deselected: "options",
  owner: "owner", owners: "owner", ownership: "owner", "who moves": "owner", month: "month", months: "month", wssi: "month" };
const dim = ALIAS[String(DIMENSION || "").trim().toLowerCase()];
if (!dim) return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'. Use one of: department, topdown, units_asp, options, owner, month.` });
const isRbu = node.plan_level === "RBU", rbuCode = node.rbu_code;
const rbu = ids.find((i) => i.plan_level === "RBU" && i.entity_code === rbuCode);
const target = (chain.find((c) => c.rbu_code === rbuCode) || {}).value_aud;
const stated = (i) => i.f26_actual * (1 + i.growth_stated);
const depts = ids.filter((i) => i.plan_level === "DEPARTMENT" && i.rbu_code === rbuCode);
const bottomUpGap = rbu.tpr_budget - stated(rbu), topDownGap = stated(rbu) - target, gap = rbu.tpr_budget - target;
const base = { ok: true, node: `${node.entity_code} ${node.entity_name}`, level: node.plan_level, dimension: dim, rbu: `${rbu.entity_code} ${rbu.entity_name}`,
  rbu_bottom_up_aud: Math.round(rbu.tpr_budget), rbu_stated_budget_aud: Math.round(stated(rbu)), rbu_mix_target_aud: Math.round(target), rbu_gap_to_mix_target_aud: Math.round(gap),
  rbu_gap_to_mix_target_pct: r2(100 * gap / target) };
const material = Math.abs(gap) >= MATERIAL / 100 * target;

if (dim === "topdown") {
  const share = 100 * bottomUpGap / gap;
  return JSON.stringify(Object.assign(base, { range_gap_bottom_up_vs_stated_aud: Math.round(bottomUpGap), topdown_gap_stated_vs_mix_target_aud: Math.round(topDownGap), range_share_of_gap_pct: r2(share),
    verdict: !material ? "NOT_SUPPORTED" : share >= 70 ? "SUPPORTED" : share <= 30 ? "NOT_SUPPORTED" : "INCONCLUSIVE",
    reading: !material ? `${rbu.entity_name} is within ${MATERIAL}% of its mix target.` : share >= 70
      ? `BOTTOM-UP: the committed range plans AUD ${Math.round(bottomUpGap)} against the stated budget, which is ${r2(share)}% of the gap; the stated budget and the mix target differ by only AUD ${Math.round(topDownGap)}. The range, not the top-down target, is short.`
      : share <= 30 ? `TOP-DOWN: the stated budget itself sits AUD ${Math.round(topDownGap)} away from the mix target; the range delivers close to what was stated.`
      : "Both the range and the top-down target contribute materially.",
    rule: "RBU gap = (bottom-up - stated budget) + (stated budget - mix target). SUPPORTED (range) when the bottom-up part is at least 70% of the gap." }));
}
if (dim === "department") {
  if (!isRbu) return JSON.stringify({ ok: false, error: `${node.entity_name} is a department. Test units_asp, options or owner for it, or split its RBU (${rbu.entity_code}) by department.` });
  const g = depts.map((d) => ({ value: `${d.entity_code} ${d.entity_name}`, stated_growth_pct: pct(d.growth_stated), derived_growth_pct: pct(d.growth_derived), growth_break_pts: pct(d.growth_break_pts),
    stated_budget_aud: Math.round(stated(d)), bottom_up_aud: Math.round(d.tpr_budget), gap_to_stated_aud: Math.round(d.tpr_budget - stated(d)),
    share_of_range_gap_pct: r2(100 * (d.tpr_budget - stated(d)) / bottomUpGap) })).sort((a, b) => a.gap_to_stated_aud - b.gap_to_stated_aud);
  const top = bottomUpGap < 0 ? g[0] : g[g.length - 1], rest = g.filter((x) => x !== top);
  const restBreak = rest.length ? r2(rest.reduce((a, x) => a + x.gap_to_stated_aud, 0) / rest.reduce((a, x) => a + x.stated_budget_aud, 0) * 100) : null;
  const ok = material && top.share_of_range_gap_pct >= SHARE && Math.abs(top.growth_break_pts - restBreak) >= DIFF;
  return JSON.stringify(Object.assign(base, { range_gap_bottom_up_vs_stated_aud: Math.round(bottomUpGap), groups: g,
    verdict: !material ? "NOT_SUPPORTED" : ok ? "SUPPORTED" : "INCONCLUSIVE",
    reading: !material ? `${rbu.entity_name} is within ${MATERIAL}% of its mix target.` : ok
      ? `CONCENTRATED: ${top.value} plans AUD ${top.gap_to_stated_aud} against its stated budget, ${top.share_of_range_gap_pct}% of the RBU's range gap; its growth break is ${top.growth_break_pts} points against ${restBreak}% for the rest of the RBU.`
      : `No single department dominates the RBU's range gap; the largest is ${top.value} at ${top.share_of_range_gap_pct}%.`,
    rule: `SUPPORTED when one department carries at least ${SHARE}% of the bottom-up-vs-stated gap and its growth break differs from the rest by ${DIFF}+ points.` }));
}
if (dim === "units_asp") {
  const n = node, u = pct(n.unit_growth_pct), a = pct(n.asp_growth_pct), s = pct(n.growth_stated);
  const reqUnits = r2(((1 + n.growth_stated) / (1 + n.asp_growth_pct) - 1) * 100);
  const short = r2(reqUnits - u);
  const volEffect = Math.round(n.f26_actual * n.unit_growth_pct), priceEffect = Math.round(n.tpr_budget - n.f26_actual * (1 + n.unit_growth_pct));
  return JSON.stringify(Object.assign(base, { stated_growth_pct: s, derived_growth_pct: pct(n.growth_derived), unit_growth_pct: u, asp_growth_pct: a,
    unit_growth_needed_at_planned_asp_pct: reqUnits, unit_shortfall_pts: short, volume_effect_vs_ly_aud: volEffect, price_effect_vs_ly_aud: priceEffect,
    verdict: short >= DIFF ? "SUPPORTED" : short <= -DIFF ? "NOT_SUPPORTED" : "INCONCLUSIVE",
    reading: short >= DIFF ? `VOLUME: to deliver the stated ${s}% at the planned ASP (+${a}%), units would need to grow ${reqUnits}%; the range plans ${u}%, ${short} points short. ASP growth is carrying the plan and units are not.`
      : short <= -DIFF ? `Units are planned ${-short} points ABOVE what the stated growth needs.` : `Units are close to what the stated growth needs at the planned ASP.`,
    rule: `Units needed = (1 + stated growth) / (1 + planned ASP growth) - 1. SUPPORTED when planned unit growth is ${DIFF}+ points below that.` }));
}
if (dim === "options") {
  const list = (isRbu ? depts : [node]).concat(isRbu ? [] : depts.filter((d) => d !== node));
  const g = list.map((d) => ({ value: `${d.entity_code} ${d.entity_name}`, options_presented: d.opt_presented, options_deselected: d.opt_deselected, deselected_pct: pct(d.deselect_pct),
    sales_at_risk_aud: Math.round(d.sales_at_risk_aud), growth_break_pts: pct(d.growth_break_pts) }));
  const rates = g.map((x) => x.deselected_pct), spread = r2(Math.max(...rates) - Math.min(...rates));
  return JSON.stringify(Object.assign(base, { groups: g, spread_pts: spread,
    verdict: spread <= UNIFORM_DESELECT ? "NOT_SUPPORTED" : "INCONCLUSIVE",
    reading: spread <= UNIFORM_DESELECT ? `UNIFORM: every department drops between ${Math.min(...rates)}% and ${Math.max(...rates)}% of the options presented, so range attrition does not explain why one department's growth break is larger than another's.`
      : `Option attrition varies by ${spread} points across departments; compare it with each department's growth break.`,
    rule: `NOT_SUPPORTED when deselection rates are within ${UNIFORM_DESELECT} points across departments. Sales at risk values dropped options at the average committed option.` }));
}
if (dim === "owner") {
  const own = {}; rows(`SELECT MEASURE_CODE, MAX(OWNING_PARTY) AS P FROM ${H}.VW_MEASURE_OWNERSHIP GROUP BY 1`).forEach((x) => (own[x.measure_code] = x.p));
  const share = 100 * bottomUpGap / gap;
  const parts = [{ part: "Range: bottom-up (units x ASP) against the stated budget", gap_aud: Math.round(bottomUpGap), share_of_gap_pct: r2(share),
      measures: { F27_TPR_UNIT_SALES: own.F27_TPR_UNIT_SALES, F27_TPR_ASP_AUD: own.F27_TPR_ASP_AUD, TPR_BUDGET_AUD: own.TPR_BUDGET_AUD } },
    { part: "Top-down: stated budget against the agreed mix target", gap_aud: Math.round(topDownGap), share_of_gap_pct: r2(100 - share),
      measures: { TOTAL_GROWTH_PCT_STATED: own.TOTAL_GROWTH_PCT_STATED, PLAN_MIX_PCT_STATED: own.PLAN_MIX_PCT_STATED } }];
  const lead = Math.abs(bottomUpGap) >= Math.abs(topDownGap) ? parts[0] : parts[1];
  const party = lead === parts[0] ? own.F27_TPR_UNIT_SALES : own.PLAN_MIX_PCT_STATED;
  return JSON.stringify(Object.assign(base, { parts, owning_party: party, verdict: material ? "SUPPORTED" : "NOT_SUPPORTED",
    reading: material ? `${lead.part} is ${lead.share_of_gap_pct}% of the gap. Its measures are owned by ${party}, so ${party === "BUYING" ? "Buying has to move the range (units or ASP)" : party === "PLANNING" ? "Planning has to move the target" : "Planning and Buying have to agree the move"}; the ownership registry enforces who can change them.`
      : `${rbu.entity_name} is within ${MATERIAL}% of its mix target: nobody needs to move.`,
    rule: "The gap is split into its range and top-down parts; each part is assigned the owning party of its measures from the ownership registry (VW_MEASURE_OWNERSHIP)." }));
}
// month: the MFP phased to month against the WSSI budget, which is struck from the store plan.
const m = rows(`SELECT PERIOD_KEY, MONTH_NAME, ROUND(MFP_AUD) AS MFP_PHASED_AUD, ROUND(BUD_AUD) AS WSSI_BUDGET_AUD, ROUND(VARIANCE_AUD) AS VARIANCE_AUD,
  ROUND(100 * VARIANCE_AUD / NULLIF(BUD_AUD, 0), 2) AS VARIANCE_PCT FROM ${H}.VW_MFP_WSSI_RECON WHERE RBU_CODE = '${rbuCode.replace(/[^0-9A-Za-z]/g, "")}' ORDER BY PERIOD_KEY`);
const rates = m.map((x) => x.variance_pct), spread = r2(Math.max(...rates) - Math.min(...rates));
return JSON.stringify(Object.assign(base, { months: m, spread_pts: spread, verdict: spread <= 1.5 ? "NOT_SUPPORTED" : "INCONCLUSIVE",
  reading: spread <= 1.5 ? `UNIFORM: the MFP sits between ${Math.min(...rates)}% and ${Math.max(...rates)}% of the WSSI budget in every month. The MFP is a half-level plan phased on the store plan's shape, so the gap is a level gap, not a phasing one.`
    : `The monthly variance moves by ${spread} points; check the months at the extremes.`,
  rule: "NOT_SUPPORTED (a level gap, not timing) when every month's variance is within 1.5 points." }));
$$;
