-- ============================================================
-- Head of Planning — sandbox builder: data and tools
--
-- The store plan sandbox (Store plan page) is where a planner tries a what-if
-- without touching the live plan: a copy of the drivers, edited, then submitted
-- for review. The Planning Investigator finds the gaps ("QLD Metro Standard
-- stores plan below the company rate"); this builder turns a gap or a target into
-- costed options and, once a person picks one, a real sandbox:
--
--   PEER_RATE     lift stores planning below their format x region company rate
--                 to it (A all, B half the gap, C only stores with no recorded
--                 reason -- a refurbishment or a clearance hub is left alone)
--   LFL_TARGET    reach a like-for-like % for a scope (A scale every store, B lift
--                 only the stores below it, C half way)
--   MARGIN_SHIFT  move margin % by some points (A every month, B the Oct-Dec peak
--                 only, C half the points)
--
-- Every option is costed against the live plan in the store plan's own maths
-- (LFL stores: LY x (1 + LFL); margin = sales x margin %): sales and margin
-- change, company and scope LFL, the plan against the board-approved figure, and
-- the knock-on to the planning chain (each AUD 1 of store plan raises Hardgoods'
-- mix target by its 88.5% share, widening the gap Buying must close). Guardrails
-- flag a store planned above the best store in the live plan, a recorded reason
-- overridden, and a move off the approved plan.
--
--   HEAD_OF_PLANNING.HOP_SANDBOX_EVIDENCE(SCOPE)                       read only
--   HEAD_OF_PLANNING.HOP_BUILD_SANDBOX(SCOPE, LEVER, VALUE, REQUEST)   writes a DRAFT proposal
--   HEAD_OF_PLANNING.OPEN_SANDBOX_PROPOSAL(PROPOSAL_ID, OPTION_ID, OPENED_BY)
--       the app's "Open as sandbox": creates the sandbox from one option. It never
--       touches the live plan; the sandbox is reviewed and submitted as any other.
--
-- Run AFTER the HOP build (sql/20-36). Idempotent.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.HEAD_OF_PLANNING.SANDBOX_PROPOSAL (
  PROPOSAL_ID VARCHAR, SCOPE_LABEL VARCHAR, LEVER VARCHAR, LEVER_VALUE FLOAT, REQUEST VARCHAR, STATUS VARCHAR,
  RECOMMENDED_OPTION VARCHAR, CREATED_BY VARCHAR, CREATED_AT TIMESTAMP_NTZ,
  OPENED_OPTION VARCHAR, OPENED_BY VARCHAR, OPENED_AT TIMESTAMP_NTZ, SCENARIO_ID NUMBER
) COMMENT = 'Costed sandbox proposals written by HOP_SANDBOX_AGENT (DRAFT); a planner opens one option as a sandbox.';

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.HEAD_OF_PLANNING.SANDBOX_PROPOSAL_OPTION (
  PROPOSAL_ID VARCHAR, OPTION_ID VARCHAR, LABEL VARCHAR, SPEC VARIANT,
  PLAN_SALES_AUD NUMBER(14,0), SALES_DELTA_AUD NUMBER(14,0), MARGIN_DELTA_AUD NUMBER(14,0),
  COMPANY_LFL_PCT FLOAT, SCOPE_LFL_PCT FLOAT, MARGIN_PCT FLOAT, STORES_TOUCHED NUMBER,
  VS_APPROVED_AUD NUMBER(14,0), HARDGOODS_GAP_AUD NUMBER(14,0), GUARDRAILS VARIANT
) COMMENT = 'The options of each sandbox proposal, costed against the live plan.';

-- The engine both procedures share: scope, the live store-weeks, and costing.
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_ENGINE(SCOPE VARCHAR, LEVER VARCHAR, VALUE FLOAT, REQUEST VARCHAR, WRITE BOOLEAN)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Sandbox builder engine: evidence for a scope when LEVER is empty, else three costed options for the lever (written as a DRAFT proposal when WRITE).'
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
const r0 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v));
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (v) => (v === null ? null : r2(v * 100));
const audM = (v) => (Math.abs(v) >= 1e6 ? "AUD " + (Math.round(v / 1e4) / 100).toFixed(2) + "M" : "AUD " + Math.round(v / 1e3) + "K");

// The live store-weeks, with the store's facts and its month's reason code.
const W = rows(`SELECT w.STORE_CODE, w.STORE_NAME, s.STATE, s.REGION, s.STORE_FORMAT, w.WEEK_END_DATE, w.PERIOD_KEY, w.MONTH_NAME, w.FY_PERIOD_NO,
    w.LY_SALES_AUD AS LY, w.PLAN_SALES_AUD AS PLAN, w.PLAN_MARGIN_AUD AS MRG, w.LFL_PCT AS LFL, w.MARGIN_PCT AS MPCT, w.IS_LFL_UNIVERSE AS IS_LFL, d.REASON_CODE
  FROM ${H}.VW_STORE_PLAN_WEEKLY w JOIN ${H}.DIM_STORE s ON s.STORE_CODE = w.STORE_CODE
  LEFT JOIN ${H}.STORE_PLAN_DRIVER d ON d.STORE_CODE = w.STORE_CODE AND d.MONTH_NAME = w.MONTH_NAME AND d.FY_YEAR = w.FY_YEAR`);

// ---------- scope: a state, region, format, store, or a combination ----------
const STATES = [...new Set(W.map((w) => w.state))], REGIONS = [...new Set(W.map((w) => w.region))], FORMATS = [...new Set(W.map((w) => w.store_format))];
function resolve(scope) {
  let k = String(scope || "").trim();
  if (!k || /^(all|company|total|baby mart|business|all stores)$/i.test(k)) return { label: "Baby Mart (all stores)", test: () => true, kind: "ALL" };
  const parts = {}, tests = [];
  const take = (re) => { const m = k.match(re); if (!m) return null; k = (k.slice(0, m.index) + " " + k.slice(m.index + m[0].length)).trim(); return m[0]; };
  for (const f of FORMATS.slice().sort((a, b) => b.length - a.length)) {
    const hit = take(new RegExp("\\b" + f.replace(/ /g, "\\s+") + "\\b", "i"));
    if (hit) { parts.f = f; tests.push((w) => w.store_format === f); break; }
  }
  for (const r of REGIONS) { const hit = take(new RegExp("\\b" + r + "\\b", "i")); if (hit) { parts.r = r; tests.push((w) => w.region === r); break; } }
  for (const s of STATES) { const hit = take(new RegExp("\\b" + s + "\\b", "i")); if (hit) { parts.s = s; tests.push((w) => w.state === s); break; } }
  const code = take(/\bS\d{3}\b/i);
  if (code) { const c = code.toUpperCase(); const st = W.find((w) => w.store_code === c); if (!st) return null; parts.st = `${c} ${st.store_name}`; tests.push((w) => w.store_code === c); }
  k = k.replace(/\b(stores?|the|in|of|and)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (k) {
    // A name: prefer the store that also matches the other filters (Melbourne CBD is S002, not a Melbourne suburb).
    const U = k.toUpperCase(), named = W.filter((w) => String(w.store_name).toUpperCase().includes(U));
    const st = named.find((w) => tests.every((t) => t(w))) || named[0];
    if (!st) return null;
    parts.st = `${st.store_code} ${st.store_name}`; tests.push((w) => w.store_code === st.store_code);
  }
  if (!tests.length) return null;
  return { label: [parts.s, parts.r, parts.f, parts.st].filter(Boolean).join(" "), test: (w) => tests.every((t) => t(w)), kind: tests.length > 1 ? "SEGMENT" : code || k ? "STORE" : "SEGMENT" };
}
const sc = resolve(SCOPE);
if (!sc) return JSON.stringify({ ok: false, error: `No state, region, format or store matches '${SCOPE}'.`, valid: { states: STATES.sort(), regions: REGIONS.sort(), formats: FORMATS.sort() } });

// ---------- the live position ----------
function totals(ws, val) {
  let ly = 0, lp = 0, tot = 0, mrg = 0;
  for (const w of ws) { const v = val(w); tot += v.sales; mrg += v.margin; if (w.is_lfl) { ly += w.ly; lp += v.sales; } }
  return { sales: tot, margin: mrg, lfl: ly ? lp / ly - 1 : null, mpct: tot ? mrg / tot : null, ly };
}
const live = (w) => ({ sales: w.plan, margin: w.mrg });
const co = totals(W, live), S = W.filter(sc.test), sco = totals(S, live);
const peer = {};
for (const w of W) if (w.is_lfl) { const k = w.store_format + "|" + w.region; const p = peer[k] || (peer[k] = { ly: 0, pl: 0 }); p.ly += w.ly; p.pl += w.plan; }
const peerRate = (w) => { const p = peer[w.store_format + "|" + w.region]; return p && p.ly ? p.pl / p.ly - 1 : null; };
const byStore = {};
for (const w of S) (byStore[w.store_code] = byStore[w.store_code] || []).push(w);
const stores = Object.keys(byStore).map((c) => {
  const ws = byStore[c], f = ws[0], t = totals(ws, live), pr = peerRate(f);
  return { store_code: c, store_name: f.store_name, state: f.state, region: f.region, format: f.store_format, comparable: ws.some((w) => w.is_lfl),
    lfl_pct: pct(t.lfl), peer_lfl_pct: pct(pr), gap_to_peer_pts: t.lfl === null || pr === null ? null : r2((pr - t.lfl) * 100),
    plan_sales_aud: r0(t.sales), margin_pct: pct(t.mpct), reasons: [...new Set(ws.map((w) => w.reason_code).filter(Boolean))] };
}).sort((a, b) => (b.gap_to_peer_pts || -99) - (a.gap_to_peer_pts || -99));
const liveStoreLfl = {};
for (const c of Object.keys(byStore)) liveStoreLfl[c] = totals(byStore[c], live).lfl;
const allStoreLfl = {};
for (const w of W) if (w.is_lfl) { const a = allStoreLfl[w.store_code] || (allStoreLfl[w.store_code] = { ly: 0, pl: 0, name: w.store_name }); a.ly += w.ly; a.pl += w.plan; }
const best = Object.keys(allStoreLfl).map((c) => ({ c, name: allStoreLfl[c].name, lfl: allStoreLfl[c].pl / allStoreLfl[c].ly - 1 })).sort((a, b) => b.lfl - a.lfl)[0];
const approved = (rows(`SELECT TOTAL_SALES_AUD AS T FROM ${H}.PLAN_APPROVAL WHERE PLAN_KIND = 'STORE_PLAN' AND STATE = 'APPROVED' ORDER BY APPROVED_AT DESC LIMIT 1`)[0] || {}).t || null;
const chain = rows(`SELECT RBU_CODE, VALUE_AUD FROM ${H}.VW_PLANNING_CHAIN WHERE STAGE = 'MFP PRODUCT PLAN'`);
const mix = rows(`SELECT RBU_CODE, PLAN_MIX_PCT_STATED AS MIX FROM ${H}.RBU_MIX_TARGET WHERE MARKET_CODE = 'AU'`);
const hgBottomUp = Number((chain.find((r) => String(r.rbu_code) === "200") || {}).value_aud || 0), hgMix = Number((mix.find((r) => String(r.rbu_code) === "200") || {}).mix || 0);
const hgGap = (total) => hgBottomUp - hgMix * total;
const months = [...new Set(W.map((w) => w.period_key))].sort();
const monthName = {};
for (const w of W) monthName[w.period_key] = w.month_name;

const position = {
  company: { stores: new Set(W.map((w) => w.store_code)).size, plan_sales_aud: r0(co.sales), lfl_pct: pct(co.lfl), margin_pct: pct(co.mpct), margin_aud: r0(co.margin),
    approved_sales_aud: r0(approved), best_store: best ? { store_code: best.c, store_name: best.name, lfl_pct: pct(best.lfl) } : null },
  scope_summary: { stores: Object.keys(byStore).length, plan_sales_aud: r0(sco.sales), ly_sales_aud: r0(sco.ly), lfl_pct: pct(sco.lfl), margin_pct: pct(sco.mpct),
    vs_company_pts: sco.lfl === null ? null : r2((sco.lfl - co.lfl) * 100) },
  chain: { hardgoods_mix_pct: pct(hgMix), hardgoods_bottom_up_aud: r0(hgBottomUp), hardgoods_gap_aud: r0(hgGap(co.sales)),
    note: "Hardgoods' mix target is its stated share of the store plan; the gap is its bottom-up MFP less that target. Raising the store plan widens it." },
};

const lever = String(LEVER || "").trim().toUpperCase();
if (!lever) {
  const byMonth = months.map((p) => { const t = totals(S.filter((w) => w.period_key === p), live); return { period_key: p, month: monthName[p], plan_sales_aud: r0(t.sales), lfl_pct: pct(t.lfl), margin_pct: pct(t.mpct) }; });
  const open = rows(`SELECT COUNT(*) AS N FROM ${H}.PLAN_SCENARIO WHERE SCENARIO_KIND = 'SANDBOX' AND STATUS = 'DRAFT'`)[0].n;
  return JSON.stringify(Object.assign({ ok: true, scope: sc.label, horizon: "FY27 H1 store plan, Jul-Dec 2026 (the live plan). LFL is plan sales over the same weeks last year, comparable stores only." },
    position, { stores: stores.slice(0, 20), by_month: byMonth, open_sandboxes: open,
      levers: [
        { lever: "PEER_RATE", value: "none", does: "lift stores planning below their format x region company rate up to it" },
        { lever: "LFL_TARGET", value: "the like-for-like % to reach, e.g. 5", does: "reach a like-for-like % for the scope" },
        { lever: "MARGIN_SHIFT", value: "points, e.g. 0.5 or -0.5", does: "move margin % by some points" }] }));
}

// ---------- options ----------
const v = Number(VALUE);
const lflStores = stores.filter((s) => s.comparable && s.lfl_pct !== null);
const spec = (items) => items.filter((x) => x.lfl_factor !== 1 || x.margin_add);
let options;
if (lever === "PEER_RATE") {
  const below = lflStores.filter((s) => s.gap_to_peer_pts !== null && s.gap_to_peer_pts > 0.05);
  if (!below.length) return JSON.stringify({ ok: false, error: `Every store in ${sc.label} already plans at or above its peer rate.`, stores: stores.slice(0, 10) });
  const close = (s, share) => { const l = liveStoreLfl[s.store_code], p = peerRate(byStore[s.store_code][0]); return { store_code: s.store_code, lfl_factor: (1 + l + (p - l) * share) / (1 + l), margin_add: 0 }; };
  options = [
    { option_id: "A", label: "Close every store's gap to its peer rate", spec: spec(below.map((s) => close(s, 1))) },
    { option_id: "B", label: "Close half of each store's gap", spec: spec(below.map((s) => close(s, 0.5))) },
    { option_id: "C", label: "Close the gap only where no reason is recorded", spec: spec(below.filter((s) => !s.reasons.length).map((s) => close(s, 1))) },
  ];
} else if (lever === "LFL_TARGET") {
  if (!isFinite(v) || v < -20 || v > 30) return JSON.stringify({ ok: false, error: "Give the like-for-like % to reach, between -20 and 30 (e.g. 5 for +5%)." });
  const t = v / 100, L = sco.lfl;
  if (L === null) return JSON.stringify({ ok: false, error: `${sc.label} has no comparable stores.` });
  const up = t > L;
  options = [
    { option_id: "A", label: `Scale every store to ${v}% (keeps each store's shape)`, spec: spec(lflStores.map((s) => ({ store_code: s.store_code, lfl_factor: (1 + t) / (1 + L), margin_add: 0 }))) },
    { option_id: "B", label: up ? `Lift only the stores below ${v}%` : `Trim only the stores above ${v}%`,
      spec: spec(lflStores.filter((s) => (up ? liveStoreLfl[s.store_code] < t : liveStoreLfl[s.store_code] > t)).map((s) => ({ store_code: s.store_code, lfl_factor: (1 + t) / (1 + liveStoreLfl[s.store_code]), margin_add: 0 }))) },
    { option_id: "C", label: `Half way to ${v}%`, spec: spec(lflStores.map((s) => ({ store_code: s.store_code, lfl_factor: (1 + (L + t) / 2) / (1 + L), margin_add: 0 }))) },
  ];
} else if (lever === "MARGIN_SHIFT") {
  if (!isFinite(v) || v === 0 || Math.abs(v) > 5) return JSON.stringify({ ok: false, error: "Give the margin points to move, between -5 and 5 (e.g. 0.5)." });
  const peak = months.slice(-3);
  const all = stores.map((s) => s.store_code);
  options = [
    { option_id: "A", label: `Move margin ${v > 0 ? "+" : ""}${v} pts every month`, spec: all.map((c) => ({ store_code: c, lfl_factor: 1, margin_add: v / 100 })) },
    { option_id: "B", label: `Move margin ${v > 0 ? "+" : ""}${v} pts in the Oct-Dec peak only`, spec: all.map((c) => ({ store_code: c, lfl_factor: 1, margin_add: v / 100, periods: peak })) },
    { option_id: "C", label: `Move margin ${v > 0 ? "+" : ""}${r2(v / 2)} pts every month (half)`, spec: all.map((c) => ({ store_code: c, lfl_factor: 1, margin_add: v / 200 })) },
  ];
} else {
  return JSON.stringify({ ok: false, error: `Unknown lever '${LEVER}'.`, valid_levers: ["PEER_RATE", "LFL_TARGET", "MARGIN_SHIFT"] });
}

// ---------- cost each option in the store plan's own maths ----------
function cost(o) {
  const m = {};
  for (const x of o.spec) m[x.store_code] = x;
  const val = (w) => {
    const x = m[w.store_code];
    if (!x || (x.periods && x.periods.indexOf(w.period_key) < 0)) return { sales: w.plan, margin: w.mrg };
    const sales = w.is_lfl ? w.ly * ((1 + w.lfl) * x.lfl_factor) : w.plan;
    return { sales, margin: sales * (w.mpct + (x.margin_add || 0)) };
  };
  const c = totals(W, val), s = totals(S, val);
  const touched = Object.keys(m);
  const after = touched.map((code) => ({ code, name: byStore[code][0].store_name, lfl: totals(byStore[code], val).lfl })).filter((x) => x.lfl !== null);
  const top = after.sort((a, b) => b.lfl - a.lfl)[0];
  const reasoned = stores.filter((st) => touched.indexOf(st.store_code) >= 0 && st.reasons.length && (m[st.store_code].lfl_factor !== 1 || m[st.store_code].margin_add));
  const g = [];
  if (top && best && top.lfl > best.lfl + 0.0001) g.push({ level: "CAUTION", message: `${top.name} would plan ${pct(top.lfl)}% like-for-like, above the best store in the live plan (${best.name}, ${pct(best.lfl)}%).` });
  if (reasoned.length) g.push({ level: "CAUTION", message: `Overrides a recorded reason at ${reasoned.map((x) => `${x.store_name} (${x.reasons.join(", ")})`).join("; ")}.` });
  const vsApproved = approved ? c.sales - approved : null;
  const moves = Math.abs(c.sales - co.sales) >= 1;
  if (moves && vsApproved !== null && Math.abs(vsApproved) >= 0.005 * approved) g.push({ level: "CAUTION", message: `Puts the plan at ${audM(c.sales)}, ${vsApproved > 0 ? "+" : ""}${audM(vsApproved)} off the board-approved ${audM(approved)}: changing the approved plan needs an amendment on Approve & lock.` });
  else if (moves && vsApproved !== null) g.push({ level: "INFO", message: `Puts the plan at ${audM(c.sales)}, ${vsApproved > 0 ? "+" : ""}${audM(vsApproved)} off the board-approved ${audM(approved)}.` });
  const gapAfter = hgGap(c.sales);
  if (c.sales > co.sales + 1) g.push({ level: "INFO", message: `Hardgoods' bottom-up shortfall to its mix target grows from ${audM(-hgGap(co.sales))} to ${audM(-gapAfter)}: Buying owns the difference.` });
  if (c.margin < co.margin - 1) g.push({ level: "INFO", message: `Gives up ${audM(co.margin - c.margin)} of margin.` });
  return Object.assign(o, { plan_sales_aud: r0(c.sales), sales_delta_aud: r0(c.sales - co.sales), margin_delta_aud: r0(c.margin - co.margin),
    company_lfl_pct: pct(c.lfl), scope_lfl_pct: pct(s.lfl), margin_pct: pct(c.mpct), stores_touched: touched.length,
    vs_approved_aud: r0(vsApproved), hardgoods_gap_aud: r0(gapAfter), guardrails: g });
}
options.forEach(cost);
if (lever === "PEER_RATE" && JSON.stringify(options[2].spec) === JSON.stringify(options[0].spec))
  options[2].guardrails.unshift({ level: "INFO", message: "Same as A: no store in scope has a recorded reason." });
// Recommend the biggest change with no CAUTION; else the fewest cautions, then the smallest change
// (sales and margin moved, in AUD).
const cautions = (o) => o.guardrails.filter((g) => g.level !== "INFO").length;
const size = (o) => Math.abs(o.sales_delta_aud) + Math.abs(o.margin_delta_aud);
const clean = options.filter((o) => o.stores_touched && !cautions(o));
const recommended = (clean.length ? clean.sort((a, b) => size(b) - size(a))[0]
  : options.filter((o) => o.stores_touched).sort((a, b) => cautions(a) - cautions(b) || size(a) - size(b))[0] || options[0]).option_id;

let proposalId = null;
if (WRITE) {
  proposalId = "SBX-" + rows(`SELECT TO_CHAR(CURRENT_TIMESTAMP(), 'YYMMDDHH24MISS') || LPAD(UNIFORM(0, 99, RANDOM())::STRING, 2, '0') AS ID`)[0].id;
  rows(`UPDATE ${H}.SANDBOX_PROPOSAL SET STATUS = 'SUPERSEDED' WHERE STATUS = 'DRAFT' AND SCOPE_LABEL = ? AND LEVER = ?`, [sc.label, lever]);
  rows(`INSERT INTO ${H}.SANDBOX_PROPOSAL (PROPOSAL_ID, SCOPE_LABEL, LEVER, LEVER_VALUE, REQUEST, STATUS, RECOMMENDED_OPTION, CREATED_BY, CREATED_AT)
    SELECT ?, ?, ?, ?, ?, 'DRAFT', ?, 'HOP_SANDBOX_AGENT', CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ`, [proposalId, sc.label, lever, isFinite(v) ? v : null, String(REQUEST || "").slice(0, 1000), recommended]);
  for (const o of options) rows(`INSERT INTO ${H}.SANDBOX_PROPOSAL_OPTION (PROPOSAL_ID, OPTION_ID, LABEL, SPEC, PLAN_SALES_AUD, SALES_DELTA_AUD, MARGIN_DELTA_AUD, COMPANY_LFL_PCT, SCOPE_LFL_PCT, MARGIN_PCT, STORES_TOUCHED, VS_APPROVED_AUD, HARDGOODS_GAP_AUD, GUARDRAILS)
    SELECT ?, ?, ?, PARSE_JSON(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?)`,
    [proposalId, o.option_id, o.label, JSON.stringify(o.spec), o.plan_sales_aud, o.sales_delta_aud, o.margin_delta_aud, o.company_lfl_pct, o.scope_lfl_pct, o.margin_pct, o.stores_touched, o.vs_approved_aud, o.hardgoods_gap_aud, JSON.stringify(o.guardrails)]);
}
return JSON.stringify(Object.assign({ ok: true, proposal_id: proposalId, status: proposalId ? "DRAFT" : "PREVIEW", scope: sc.label, lever, value: isFinite(v) ? v : null }, position, {
  live: { plan_sales_aud: r0(co.sales), margin_aud: r0(co.margin), company_lfl_pct: pct(co.lfl), scope_lfl_pct: pct(sco.lfl), margin_pct: pct(co.mpct) },
  options: options.map((o) => ({ option_id: o.option_id, label: o.label, stores_touched: o.stores_touched, plan_sales_aud: o.plan_sales_aud, sales_delta_aud: o.sales_delta_aud,
    margin_delta_aud: o.margin_delta_aud, company_lfl_pct: o.company_lfl_pct, scope_lfl_pct: o.scope_lfl_pct, margin_pct: o.margin_pct,
    vs_approved_aud: o.vs_approved_aud, hardgoods_gap_aud: o.hardgoods_gap_aud, guardrails: o.guardrails })),
  recommended,
  rule: "Options are costed in the store plan's own maths against the live plan: LFL stores plan LY x (1 + LFL) and margin is sales x margin %. Recommended: the biggest change (sales plus margin moved) with no caution; else the fewest cautions, then the smallest change.",
  next: "A planner opens one option as a sandbox on the Sandbox builder page, reviews it on Store plan, and submits it for review. Nothing reaches the live plan." }));
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_EVIDENCE(SCOPE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'The live store plan for a scope (all, a state, region, format, store, or a combination such as QLD Metro Standard): plan, LFL and margin, each store against its peer rate with recorded reasons, by month, the approved figure and the planning chain.'
EXECUTE AS OWNER
AS
$$
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_ENGINE(?, '', NULL, '', FALSE)", binds: [SCOPE || ""] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_BUILD_SANDBOX(SCOPE VARCHAR, LEVER VARCHAR, VALUE FLOAT, REQUEST VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Costs three sandbox options for a scope and lever (PEER_RATE, LFL_TARGET with VALUE %, MARGIN_SHIFT with VALUE pts) against the live plan and writes them as a DRAFT proposal.'
EXECUTE AS OWNER
AS
$$
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.HEAD_OF_PLANNING.HOP_SANDBOX_ENGINE(?, ?, ?, ?, TRUE)",
  binds: [SCOPE || "", LEVER || "", VALUE === null || VALUE === undefined ? null : VALUE, REQUEST || ""] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;

-- ---------- OPEN_SANDBOX_PROPOSAL ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.HEAD_OF_PLANNING.OPEN_SANDBOX_PROPOSAL(PROPOSAL_ID VARCHAR, OPTION_ID VARCHAR, OPENED_BY VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Opens one option of a DRAFT sandbox proposal as a store plan sandbox: a copy of the live drivers with the option''s edits. Never touches the live plan.'
EXECUTE AS OWNER
AS
$$
const H = "BABY_MART_DEMO.HEAD_OF_PLANNING";
const ex = (sql, binds) => snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute();
function one(sql, binds) { const rs = ex(sql, binds); return rs.next() ? rs : null; }
const p = one(`SELECT STATUS, SCOPE_LABEL FROM ${H}.SANDBOX_PROPOSAL WHERE PROPOSAL_ID = ?`, [PROPOSAL_ID]);
if (!p) return JSON.stringify({ ok: false, error: `No proposal ${PROPOSAL_ID}.` });
const status = p.getColumnValue(1), scope = p.getColumnValue(2);
if (status !== "DRAFT") return JSON.stringify({ ok: false, error: `Proposal ${PROPOSAL_ID} is ${status}, not DRAFT.` });
const o = one(`SELECT LABEL, SPEC::STRING, PLAN_SALES_AUD FROM ${H}.SANDBOX_PROPOSAL_OPTION WHERE PROPOSAL_ID = ? AND OPTION_ID = ?`, [PROPOSAL_ID, OPTION_ID]);
if (!o) return JSON.stringify({ ok: false, error: `Proposal ${PROPOSAL_ID} has no option ${OPTION_ID}.` });
const label = o.getColumnValue(1), spec = o.getColumnValue(2), expected = o.getColumnValue(3);
const user = String(OPENED_BY || "unknown").slice(0, 200);
const code = "SANDBOX_" + Date.now();
const name = `${scope}: ${label}`.slice(0, 200);
ex("BEGIN");
try {
  ex(`INSERT INTO ${H}.PLAN_SCENARIO (SCENARIO_CODE, SCENARIO_NAME, SCENARIO_KIND, BASE_SCENARIO_ID, STATUS, CURRENT_REVISION, CREATED_BY, CREATED_AT, UPDATED_AT)
      SELECT ?, ?, 'SANDBOX', (SELECT MIN(SCENARIO_ID) FROM ${H}.PLAN_SCENARIO WHERE SCENARIO_KIND = 'BASELINE'), 'DRAFT', 2, ?, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ`, [code, name, user]);
  const sid = one(`SELECT SCENARIO_ID FROM ${H}.PLAN_SCENARIO WHERE SCENARIO_CODE = ?`, [code]).getColumnValue(1);
  // The copy, exactly as the Store plan page makes one.
  ex(`INSERT INTO ${H}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
      SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, f.KEY::VARCHAR, f.VALUE::FLOAT, 'SCENARIO_SNAPSHOT', ?, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ
      FROM ${H}.VW_STORE_PLAN_WEEKLY w, LATERAL FLATTEN(INPUT => OBJECT_CONSTRUCT('LFL_PCT', w.LFL_PCT, 'MARGIN_PCT', w.MARGIN_PCT,
        'SALES_AUD', IFF(w.IS_LFL_UNIVERSE, NULL, w.PLAN_SALES_AUD))) f`, [sid, user]);
  ex(`INSERT INTO ${H}.PLAN_SCENARIO_PERIOD (SCENARIO_ID, PERIOD_KEY, IS_SELECTED) SELECT DISTINCT ?, PERIOD_KEY, TRUE FROM ${H}.STORE_PLAN_WEEK_SLOT`, [sid]);
  // The option's edits, after the copy so they are the latest cells.
  const S = `FROM ${H}.VW_STORE_PLAN_WEEKLY w JOIN (SELECT f.VALUE AS X FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))) f) s ON s.X:store_code::STRING = w.STORE_CODE
      WHERE (s.X:periods IS NULL OR ARRAY_CONTAINS(w.PERIOD_KEY::VARIANT, s.X:periods))`;
  ex(`INSERT INTO ${H}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
      SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, 'LFL_PCT', (1 + w.LFL_PCT) * s.X:lfl_factor::FLOAT - 1, 'AGENT', ?, DATEADD(second, 1, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ)
      ${S} AND w.IS_LFL_UNIVERSE AND s.X:lfl_factor::FLOAT <> 1`, [sid, user, spec]);
  ex(`INSERT INTO ${H}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
      SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, 'MARGIN_PCT', w.MARGIN_PCT + s.X:margin_add::FLOAT, 'AGENT', ?, DATEADD(second, 1, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ)
      ${S} AND NVL(s.X:margin_add::FLOAT, 0) <> 0`, [sid, user, spec]);
  ex(`INSERT INTO ${H}.PLAN_SCENARIO_REVISION (SCENARIO_ID, REVISION_NO, NOTE, CREATED_BY, CREATED_AT)
      SELECT ?, 1, 'Sandbox created as a copy of the live plan', ?, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ
      UNION ALL SELECT ?, 2, ?, ?, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ`, [sid, user, sid, `Sandbox builder proposal ${PROPOSAL_ID}, option ${OPTION_ID}: ${label}`, user]);
  ex(`UPDATE ${H}.SANDBOX_PROPOSAL SET STATUS = 'OPENED', OPENED_OPTION = ?, OPENED_BY = ?, OPENED_AT = CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ, SCENARIO_ID = ? WHERE PROPOSAL_ID = ?`, [OPTION_ID, user, sid, PROPOSAL_ID]);
  ex("COMMIT");
  // Read the sandbox back in the store plan's maths: it must land on the option's cost.
  const t = one(`WITH latest AS (
      SELECT STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE FROM ${H}.STORE_PLAN_SCENARIO_CELL WHERE SCENARIO_ID = ?
      QUALIFY ROW_NUMBER() OVER (PARTITION BY STORE_CODE, WEEK_END_DATE, MEASURE_CODE ORDER BY CHANGED_AT DESC, CELL_ID DESC) = 1),
    c AS (SELECT STORE_CODE, WEEK_END_DATE, MAX(IFF(MEASURE_CODE = 'LFL_PCT', VALUE, NULL)) AS LFL, MAX(IFF(MEASURE_CODE = 'SALES_AUD', VALUE, NULL)) AS SALES
      FROM latest GROUP BY 1, 2)
    SELECT SUM(IFF(w.IS_LFL_UNIVERSE, w.LY_SALES_AUD * (1 + c.LFL), c.SALES)) FROM ${H}.VW_STORE_PLAN_WEEKLY w
    JOIN c ON c.STORE_CODE = w.STORE_CODE AND c.WEEK_END_DATE = w.WEEK_END_DATE`, [sid]);
  const total = t.getColumnValue(1);
  return JSON.stringify({ ok: true, proposal_id: PROPOSAL_ID, option_id: OPTION_ID, scenario_id: sid, scenario_name: name,
    sandbox_plan_sales_aud: Math.round(total), expected_plan_sales_aud: expected, ties: Math.abs(total - expected) <= 2 });
} catch (e) {
  ex("ROLLBACK");
  return JSON.stringify({ ok: false, error: String(e.message || e) });
}
$$;
