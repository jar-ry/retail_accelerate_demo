-- ============================================================
-- NPS Analyst — the NPS investigator's tools
--
-- "Why did NSW NPS fall in late April?" An NPS analyst's answer has to survive
-- three questions: is the move real (enough responses), where is it (state,
-- store, category, member tier -- and how much of the move each explains), and
-- what caused it (what customers say, and whether the operations data backs it).
--
-- NPS_ANALYSIS(SCOPE, START_DATE, END_DATE, DIMENSION) is the engine:
--   SCOPE       ALL, a state (NSW), a store code (S010) or a store suburb (Parramatta)
--   START/END   the window (YYYY-MM-DD; default the three weeks to the voice clock,
--               20 Apr - 7 May 2026). The baseline is the eight weeks before START.
--   DIMENSION   '' for the evidence pack, else one test:
--     where:    state, store, category, tier   (an exact split of the NPS change)
--     what:     theme                          (what customers say more of)
--     why:      stock, campaign, supply, delivery, price, app, quality
-- NPS_EVIDENCE and TEST_NPS_CAUSE are the two procedures the agent calls.
--
-- How the change is split. NPS = 100 x (promoters - detractors) / responses, so
-- the scope's NPS is the sum over segments of 100 x (P_i - D_i) / R. Each segment's
-- contribution is that term in the window minus the same term in the baseline;
-- the contributions add up exactly to the change, mix shifts included.
--
-- Only surveys carry a score: complaints from reviews, care emails, social posts
-- and campaign replies explain NPS but are not in it, and the tools say so.
--
-- Read only, JSON. Run AFTER sql/50.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_ANALYTICS_WH;
USE SCHEMA BABY_MART_DEMO.SENTIMENT;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.SENTIMENT.NPS_ANALYSIS(SCOPE VARCHAR, START_DATE VARCHAR, END_DATE VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'NPS investigator engine: the evidence pack for a scope and window when DIMENSION is empty, else one test of where or why NPS moved. Read only.'
EXECUTE AS OWNER
AS
$$
const T = "BABY_MART_DEMO.SENTIMENT", A = "BABY_MART_DEMO.ANALYTICS", C = "BABY_MART_DEMO.CURATED", K = "BABY_MART_DEMO.CAMPAIGN";
function rows(sql, binds) {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  const rs = st.execute();
  const n = st.getColumnCount(), cols = [];
  for (let i = 1; i <= n; i++) cols.push(st.getColumnName(i).toLowerCase());
  const out = [];
  while (rs.next()) { const o = {}; for (let i = 0; i < n; i++) { let v = rs.getColumnValue(i + 1); if (v instanceof Date) v = v.toISOString().slice(0, 10); o[cols[i]] = v; } out.push(o); }
  return out;
}
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const nps = (p, d, r) => (r ? r1((100 * (p - d)) / r) : null);
const pct = (n, d) => (d ? r1((100 * n) / d) : null);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monday = (s) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); };
const days = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000) + 1;
const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const asOf = rows(`SELECT ${T}.SENTIMENT_AS_OF() AS D`)[0].d;

// ---------- scope ----------
function resolveScope() {
  const s = String(SCOPE || "").trim();
  if (!s || /^(ALL|NATIONAL|AUSTRALIA|GROUP|BABY MART|TOTAL)$/i.test(s)) return { kind: "national", label: "All stores", where: "TRUE", binds: [] };
  if (STATES.includes(s.toUpperCase())) {
    const st = s.toUpperCase();
    return { kind: "state", state: st, label: st, where: "STATE = ?", binds: [st], dc: { ACT: "NSW", TAS: "VIC", NT: "QLD" }[st] || st };
  }
  const q = s.replace(/^baby mart\s+/i, "");
  const m = rows(`SELECT STORE_CODE, STORE_NAME, STATE FROM ${C}.DIM_STORE
                  WHERE STORE_CODE = UPPER(?) OR UPPER(REPLACE(STORE_NAME, 'Baby Mart ', '')) = UPPER(?) OR UPPER(STORE_NAME) = UPPER(?)
                  ORDER BY STORE_CODE`, [q, q, s]);
  const f = m.length ? m : rows(`SELECT STORE_CODE, STORE_NAME, STATE FROM ${C}.DIM_STORE WHERE STORE_NAME ILIKE ? ORDER BY STORE_CODE`, ["%" + q + "%"]);
  if (f.length !== 1) return { error: f.length ? `'${s}' matches ${f.length} stores: ${f.map((x) => x.store_name).join(", ")}.` : `No state or store matches '${s}'.`,
    valid_scopes: ["ALL"].concat(STATES, ["a store code like S010 or a suburb like Parramatta"]) };
  const st = f[0];
  return { kind: "store", store_code: st.store_code, store: st.store_name, state: st.state, label: st.store_name, where: "STORE_CODE = ?", binds: [st.store_code],
           dc: { ACT: "NSW", TAS: "VIC", NT: "QLD" }[st.state] || st.state };
}
const sc = resolveScope();
if (sc.error) return JSON.stringify(Object.assign({ ok: false }, sc));

// ---------- window ----------
const okDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || "").trim());
let wEnd = okDate(END_DATE) ? String(END_DATE).trim() : asOf;
if (wEnd > asOf) wEnd = asOf;
let wStart = okDate(START_DATE) ? String(START_DATE).trim() : monday(addDays(asOf, -14));
if (wStart > wEnd) return JSON.stringify({ ok: false, error: `START_DATE ${wStart} is after END_DATE ${wEnd}. The voice ends on ${asOf}.` });
const bEnd = addDays(wStart, -1), bStart = addDays(wStart, -56);
const wWeeks = days(wStart, wEnd) / 7, bWeeks = 8;
const WIN = { start: wStart, end: wEnd, days: days(wStart, wEnd) }, BASE = { start: bStart, end: bEnd, days: 56 };
const partial = wEnd === asOf && days(monday(asOf), asOf) < 7;

// Every count a test needs, by a grouping expression, for both periods.
function split(groupExpr, extraWhere, extraBinds) {
  return rows(`
    WITH v AS (
      SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B
      FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} ${extraWhere ? "AND " + extraWhere : ""}
    )
    SELECT ${groupExpr} AS K,
      COUNT_IF(IN_W AND SOURCE = 'SURVEY') AS W_R, COUNT_IF(IN_W AND NPS_CLASS = 'PROMOTER') AS W_P, COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR') AS W_D,
      COUNT_IF(IN_B AND SOURCE = 'SURVEY') AS B_R, COUNT_IF(IN_B AND NPS_CLASS = 'PROMOTER') AS B_P, COUNT_IF(IN_B AND NPS_CLASS = 'DETRACTOR') AS B_D,
      COUNT_IF(IN_W) AS W_ITEMS, COUNT_IF(IN_B) AS B_ITEMS,
      COUNT_IF(IN_W AND IS_NEGATIVE) AS W_NEG, COUNT_IF(IN_B AND IS_NEGATIVE) AS B_NEG,
      COUNT_IF(IN_W AND THEME = 'Out of stock') AS W_OOS, COUNT_IF(IN_B AND THEME = 'Out of stock') AS B_OOS,
      COUNT_IF(IN_W AND THEME = 'Out of stock' AND SOURCE <> 'REPLY') AS W_OOS_NR, COUNT_IF(IN_B AND THEME = 'Out of stock' AND SOURCE <> 'REPLY') AS B_OOS_NR,
      COUNT_IF(IN_W AND SOURCE = 'REPLY') AS W_REPLIES
    FROM v WHERE IN_W OR IN_B GROUP BY 1 ORDER BY 1`,
    [wStart, wEnd, bStart, bEnd].concat(sc.binds, extraBinds || []));
}
const tot = (rs) => rs.reduce((a, r) => { for (const k of Object.keys(r)) if (k !== "k") a[k] = (a[k] || 0) + r[k]; return a; }, {});
const perWk = (n, w) => r1(n / w);

// A theme's long-run norm and onset. The baseline is the eight weeks before the
// window, so a complaint that started before the window is already in it and
// looks "steady". The norm is the 13 weeks before the baseline; elevated_since is
// the first week from the baseline on with at least 3 and 3x the norm.
const nFrom = addDays(bStart, -91), nTo = addDays(bStart, -1);
let THEME_WEEKS = null;
function themeWeeks() {
  if (THEME_WEEKS) return THEME_WEEKS;
  THEME_WEEKS = {};
  for (const r of rows(`SELECT THEME, EVENT_WEEK::STRING AS WK, COUNT(*) AS N FROM ${T}.CUSTOMER_VOICE
                        WHERE ${sc.where} AND IS_NEGATIVE AND THEME <> 'No comment' AND EVENT_DATE BETWEEN ? AND ? GROUP BY 1, 2`, sc.binds.concat([nFrom, wEnd]))) {
    (THEME_WEEKS[r.theme] = THEME_WEEKS[r.theme] || {})[r.wk] = r.n;
  }
  return THEME_WEEKS;
}
function longRun(theme) {
  const wk = themeWeeks()[theme] || {};
  let normN = 0, b = 0, w = 0;
  for (const [k, c] of Object.entries(wk)) {
    if (k < monday(bStart)) normN += c; else if (k <= bEnd) b += c; else if (k >= monday(wStart)) w += c;
  }
  const norm = normN / 13;
  let since = null;
  for (let k = monday(bStart); k <= wEnd; k = addDays(k, 7)) { if ((wk[k] || 0) >= Math.max(3, 3 * norm)) { since = k; break; } }
  // Persistent: began before the window, ran high through the baseline, and is
  // still high and material in the window.
  const baselineElevated = since !== null && since < wStart && b / bWeeks >= Math.max(2, 2 * norm) && w / wWeeks >= Math.max(5, 3 * norm);
  return { long_run_per_week: r1(norm), elevated_since: since, baseline_already_elevated: baselineElevated };
}

/** The exact split of the NPS change across a dimension's segments. */
function decompose(groupExpr, label, extraWhere, extraBinds) {
  const rs = split(groupExpr, extraWhere, extraBinds), t = tot(rs);
  const wN = nps(t.w_p, t.w_d, t.w_r), bN = nps(t.b_p, t.b_d, t.b_r), change = wN === null || bN === null ? null : r1(wN - bN);
  const segs = rs.map((r) => {
    const c = t.w_r && t.b_r ? (100 * (r.w_p - r.w_d)) / t.w_r - (100 * (r.b_p - r.b_d)) / t.b_r : null;
    return { [label]: r.k, window_nps: nps(r.w_p, r.w_d, r.w_r), baseline_nps: nps(r.b_p, r.b_d, r.b_r),
             change_pts: nps(r.w_p, r.w_d, r.w_r) === null || nps(r.b_p, r.b_d, r.b_r) === null ? null : r1(nps(r.w_p, r.w_d, r.w_r) - nps(r.b_p, r.b_d, r.b_r)),
             window_responses: r.w_r, baseline_responses: r.b_r,
             response_share_window_pct: pct(r.w_r, t.w_r), response_share_baseline_pct: pct(r.b_r, t.b_r),
             contribution_pts: r1(c), share_of_change_pct: change && c !== null ? r1((100 * c) / change) : null,
             out_of_stock_mentions_window: r.w_oos };
  }).filter((s) => s.window_responses + s.baseline_responses > 0)
    .sort((a, b) => (a.contribution_pts ?? 0) - (b.contribution_pts ?? 0));
  // The scope without its largest contributor, to say whether that segment is
  // different or just large.
  const worst = segs[0] ? rs.find((r) => r.k === segs[0][label]) : null;
  const rest = worst ? { window_nps: nps(t.w_p - worst.w_p, t.w_d - worst.w_d, t.w_r - worst.w_r), baseline_nps: nps(t.b_p - worst.b_p, t.b_d - worst.b_d, t.b_r - worst.b_r),
                         window_responses: t.w_r - worst.w_r } : null;
  if (rest) rest.change_pts = rest.window_nps === null || rest.baseline_nps === null ? null : r1(rest.window_nps - rest.baseline_nps);
  return { window_nps: wN, baseline_nps: bN, change_pts: change, window_responses: t.w_r, baseline_responses: t.b_r, segments: segs, rest };
}

function out(dimension, verdict, reading, data, rule) {
  return JSON.stringify(Object.assign({ ok: true, scope: sc.label, scope_kind: sc.kind, dimension, verdict, reading,
    window: WIN, baseline: BASE, data_ends: asOf }, data, { rule }));
}
function concentration(dimension, label, d, noun) {
  if (d.change_pts === null) return out(dimension, "INCONCLUSIVE", "Not enough survey responses to split the change.", d, "");
  const top = d.segments[0] || {};
  // Under 3 points is inside the noise of a few hundred responses.
  const falling = d.change_pts <= -3;
  const share = top.share_of_change_pct;
  // A big segment always carries a big share of the change, so it is the driver
  // only if its own NPS also fell clearly further than the rest of the scope.
  const rest = d.rest || {};
  const restChange = rest.change_pts ?? null;
  const sharper = top.change_pts !== null && restChange !== null && top.change_pts <= restChange - 10;
  // A segment holding most of the scope's responses IS the scope: its fall is
  // the scope's fall, not a concentration.
  const dominant = (top.response_share_baseline_pct ?? 0) >= 60;
  const verdict = !falling || dominant ? "RULED_OUT" : share >= 50 && sharper ? "CONFIRMED" : share >= 30 && sharper ? "INCONCLUSIVE" : "RULED_OUT";
  const reading = !falling ? `NPS did not fall materially: ${d.baseline_nps} to ${d.window_nps}.`
    : dominant ? `Not ${label}-specific: ${top[label]} holds ${top.response_share_baseline_pct}% of responses, so its fall (${top.change_pts} pts) is the scope's own; the rest moved ${restChange} pts.`
    : verdict === "CONFIRMED" ? `Concentrated: ${top[label]} contributes ${top.contribution_pts} pts of the ${d.change_pts} pt change (${share}%); its own NPS went ${top.baseline_nps} to ${top.window_nps} while the rest went ${rest.baseline_nps} to ${rest.window_nps}.`
    : verdict === "INCONCLUSIVE" ? `Partly concentrated: ${top[label]} contributes ${top.contribution_pts} of ${d.change_pts} pts (${share}%); its NPS ${top.baseline_nps} to ${top.window_nps}, the rest ${rest.baseline_nps} to ${rest.window_nps}.`
    : sharper ? `Broad-based across ${noun}: the largest, ${top[label]}, explains ${share}% of the ${d.change_pts} pt change.`
    : `Not ${label}-specific: ${top[label]} moved ${top.change_pts} pts and the rest of the scope ${restChange} pts, so every ${label} fell.`;
  return out(dimension, verdict, reading, Object.assign({}, d, { rest_of_scope: rest }),
    `Contributions add up to the change. CONFIRMED when one ${label} explains 50% or more of a fall of 3 pts or more AND its own NPS fell at least 10 pts further than the rest of the scope; INCONCLUSIVE at 30-50%; otherwise RULED_OUT: broad-based, every ${label} fell alike, or the ${label} holds 60% or more of responses (it is the scope).`);
}

// ---------- evidence pack ----------
const dim = String(DIMENSION || "").trim().toLowerCase();
const all = tot(split("'all'"));
const headline = { window_nps: nps(all.w_p, all.w_d, all.w_r), baseline_nps: nps(all.b_p, all.b_d, all.b_r),
  window_responses: all.w_r, baseline_responses: all.b_r,
  window_detractor_rate_pct: pct(all.w_d, all.w_r), baseline_detractor_rate_pct: pct(all.b_d, all.b_r),
  window_voice_items: all.w_items, baseline_voice_items_per_week: perWk(all.b_items, bWeeks),
  window_out_of_stock_mentions: all.w_oos, baseline_out_of_stock_per_week: perWk(all.b_oos, bWeeks), window_campaign_replies: all.w_replies };
headline.change_pts = headline.window_nps === null || headline.baseline_nps === null ? null : r1(headline.window_nps - headline.baseline_nps);
// One survey moves NPS by about 100/responses points; under ~40 the window is noise.
const sampleNote = all.w_r < 40 ? `Only ${all.w_r} survey responses in the window: one response moves NPS by about ${r1(100 / Math.max(all.w_r, 1))} points. Widen the scope or the window before concluding.` : null;

if (!dim) {
  const weekly = rows(`
    SELECT EVENT_WEEK AS WEEK, COUNT_IF(SOURCE = 'SURVEY') AS RESPONSES,
           ROUND(100 * (COUNT_IF(NPS_CLASS = 'PROMOTER') - COUNT_IF(NPS_CLASS = 'DETRACTOR')) / NULLIF(COUNT_IF(SOURCE = 'SURVEY'), 0), 1) AS NPS,
           COUNT_IF(THEME = 'Out of stock') AS OUT_OF_STOCK_MENTIONS, COUNT_IF(IS_NEGATIVE) AS NEGATIVE_ITEMS
    FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND EVENT_DATE BETWEEN ? AND ?
    GROUP BY 1 ORDER BY 1`, sc.binds.concat([bStart, wEnd]));
  const themes = rows(`
    WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND THEME <> 'No comment')
    SELECT THEME, COUNT_IF(IN_W AND IS_NEGATIVE) AS W, COUNT_IF(IN_B AND IS_NEGATIVE) AS B, COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR') AS WD
    FROM v GROUP BY 1`, [wStart, wEnd, bStart, bEnd].concat(sc.binds))
    .map((t) => ({ theme: t.theme, negative_mentions_window: t.w, negative_per_week_window: perWk(t.w, wWeeks), negative_per_week_baseline: perWk(t.b, bWeeks),
                   change_per_week: r1(t.w / wWeeks - t.b / bWeeks), detractor_mentions_window: t.wd }))
    .sort((a, b) => b.change_per_week - a.change_per_week).slice(0, 6);
  // Complaints that were already running high before the window: "steady"
  // against the baseline, not against normal.
  const persistent = Object.keys(themeWeeks()).map((th) => Object.assign({ theme: th }, longRun(th)))
    .filter((t) => t.baseline_already_elevated)
    .map((t) => { const wk = themeWeeks()[t.theme]; let w = 0; for (const [k, c] of Object.entries(wk)) if (k >= monday(wStart)) w += c;
                  return Object.assign(t, { negative_per_week_window: perWk(w, wWeeks) }); });
  let where = null;
  if (sc.kind === "national") where = decompose("STATE", "state").segments.slice(0, 4).map((s) => ({ state: s.state, window_nps: s.window_nps, baseline_nps: s.baseline_nps, change_pts: s.change_pts, contribution_pts: s.contribution_pts, share_of_change_pct: s.share_of_change_pct }));
  else if (sc.kind === "state") where = rows(`
      WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE STATE = ?)
      SELECT STORE_NAME, COUNT_IF(IN_W AND SOURCE = 'SURVEY') AS WR,
             ROUND(100 * (COUNT_IF(IN_W AND NPS_CLASS = 'PROMOTER') - COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR')) / NULLIF(COUNT_IF(IN_W AND SOURCE = 'SURVEY'), 0), 1) AS WN,
             ROUND(100 * (COUNT_IF(IN_B AND NPS_CLASS = 'PROMOTER') - COUNT_IF(IN_B AND NPS_CLASS = 'DETRACTOR')) / NULLIF(COUNT_IF(IN_B AND SOURCE = 'SURVEY'), 0), 1) AS BN,
             COUNT_IF(IN_W AND THEME = 'Out of stock') AS OOS
      FROM v GROUP BY 1 HAVING WR >= 5 ORDER BY WN - BN LIMIT 5`, [wStart, wEnd, bStart, bEnd, sc.state])
      .map((s) => ({ store: s.store_name, window_responses: s.wr, window_nps: s.wn, baseline_nps: s.bn, change_pts: s.wn === null || s.bn === null ? null : r1(s.wn - s.bn), out_of_stock_mentions_window: s.oos }));
  let comparison = null;
  if (sc.kind !== "national") {
    const n = tot(rows(`SELECT COUNT_IF(SOURCE = 'SURVEY' AND EVENT_DATE BETWEEN ? AND ?) AS W_R, COUNT_IF(NPS_CLASS = 'PROMOTER' AND EVENT_DATE BETWEEN ? AND ?) AS W_P,
        COUNT_IF(NPS_CLASS = 'DETRACTOR' AND EVENT_DATE BETWEEN ? AND ?) AS W_D, COUNT_IF(SOURCE = 'SURVEY' AND EVENT_DATE BETWEEN ? AND ?) AS B_R,
        COUNT_IF(NPS_CLASS = 'PROMOTER' AND EVENT_DATE BETWEEN ? AND ?) AS B_P, COUNT_IF(NPS_CLASS = 'DETRACTOR' AND EVENT_DATE BETWEEN ? AND ?) AS B_D
        FROM ${T}.CUSTOMER_VOICE`, [wStart, wEnd, wStart, wEnd, wStart, wEnd, bStart, bEnd, bStart, bEnd, bStart, bEnd]));
    comparison = { national_window_nps: nps(n.w_p, n.w_d, n.w_r), national_baseline_nps: nps(n.b_p, n.b_d, n.b_r) };
    comparison.national_change_pts = r1(comparison.national_window_nps - comparison.national_baseline_nps);
  }
  const verbatims = rows(`
    SELECT EVENT_DATE::STRING AS DATE, SOURCE_LABEL AS SOURCE, STORE_NAME AS STORE, NPS_SCORE, THEME, VOICE_TEXT AS TEXT
    FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND EVENT_DATE BETWEEN ? AND ? AND IS_NEGATIVE AND VOICE_TEXT IS NOT NULL AND THEME = ?
    ORDER BY NPS_SCORE NULLS LAST, EVENT_DATE DESC LIMIT 4`, sc.binds.concat([wStart, wEnd, themes[0] ? themes[0].theme : ""]));
  return JSON.stringify({ ok: true, scope: sc.label, scope_kind: sc.kind, state: sc.state || null, store_code: sc.store_code || null, dc_state: sc.dc || null,
    window: WIN, baseline: BASE, data_ends: asOf,
    partial_week_note: partial ? `The window ends on ${asOf}, part-way through a week; weekly figures for the week of ${monday(asOf)} are partial.` : null,
    sample_note: sampleNote,
    nps: headline, national: comparison,
    weekly, rising_themes: themes, persistent_themes: persistent, where_it_moved: where, verbatims_top_theme: verbatims,
    note: "NPS comes from surveys only. Reviews, care emails, social posts and campaign replies are counted as voice items and complaints, not in NPS.",
    tests: { where: ["state", "store", "category", "tier"], what: ["theme"], why: ["stock", "campaign", "supply", "delivery", "price", "app", "quality"] } });
}

// ---------- where ----------
if (dim === "state") {
  if (sc.kind !== "national") return out("state", "INCONCLUSIVE", `The scope is ${sc.label}; split by store instead.`, {}, "");
  return concentration("state", "state", decompose("STATE", "state"), "states");
}
if (dim === "category") return concentration("category", "category", decompose("CATEGORY", "category"), "categories");
if (dim === "tier") {
  const d = decompose("TIER_GROUP", "tier_group", "TIER_GROUP <> 'Not a member'");
  return concentration("tier", "tier_group", d, "member tiers");
}
if (dim === "store") {
  if (sc.kind === "store") {
    // A single store against the rest of its state, same windows.
    const st = rows(`
      WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE STATE = ?)
      SELECT IFF(STORE_CODE = ?, 'this store', 'rest of state') AS K,
        COUNT_IF(IN_W AND SOURCE = 'SURVEY') AS W_R, COUNT_IF(IN_W AND NPS_CLASS = 'PROMOTER') AS W_P, COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR') AS W_D,
        COUNT_IF(IN_B AND SOURCE = 'SURVEY') AS B_R, COUNT_IF(IN_B AND NPS_CLASS = 'PROMOTER') AS B_P, COUNT_IF(IN_B AND NPS_CLASS = 'DETRACTOR') AS B_D,
        COUNT(DISTINCT STORE_CODE) AS STORES, COUNT_IF(IN_W AND THEME = 'Out of stock') AS W_OOS
      FROM v GROUP BY 1`, [wStart, wEnd, bStart, bEnd, sc.state, sc.store_code]);
    const g = (k) => st.find((x) => x.k === k) || {};
    const me = g("this store"), rest = g("rest of state");
    const meC = r1(nps(me.w_p, me.w_d, me.w_r) - nps(me.b_p, me.b_d, me.b_r)), restC = r1(nps(rest.w_p, rest.w_d, rest.w_r) - nps(rest.b_p, rest.b_d, rest.b_r));
    // One store gets about three surveys a week: below 30 in the window a single
    // response moves its NPS by more than 3 points, so it cannot carry a verdict.
    const thin = (me.w_r || 0) < 30;
    const verdict = meC === null || restC === null || thin ? "INCONCLUSIVE" : meC <= restC - 15 ? "CONFIRMED" : "RULED_OUT";
    return out("store", verdict, thin ? `Too few surveys to single out ${sc.store}: ${me.w_r || 0} in the window (one moves its NPS by about ${r1(100 / Math.max(me.w_r || 1, 1))} points). It moved ${meC} pts and the rest of ${sc.state} ${restC} pts; read the state, not the store.`
      : verdict === "CONFIRMED" ? `Store-specific: ${sc.store} moved ${meC} pts against ${restC} pts for the rest of ${sc.state}.`
      : verdict === "RULED_OUT" ? `Not store-specific: ${sc.store} moved ${meC} pts and the rest of ${sc.state} ${restC} pts, so look at what the state's stores share.` : "Too few responses to compare.",
      { this_store_window_nps: nps(me.w_p, me.w_d, me.w_r), this_store_baseline_nps: nps(me.b_p, me.b_d, me.b_r), this_store_change_pts: meC, this_store_window_responses: me.w_r,
        rest_of_state_window_nps: nps(rest.w_p, rest.w_d, rest.w_r), rest_of_state_baseline_nps: nps(rest.b_p, rest.b_d, rest.b_r), rest_of_state_change_pts: restC,
        rest_of_state_stores: rest.stores, this_store_out_of_stock_mentions_window: me.w_oos, rest_out_of_stock_mentions_window: rest.w_oos },
      "CONFIRMED (store-specific) when the store has 30 or more surveys in the window and fell at least 15 pts more than the rest of its state; INCONCLUSIVE under 30 surveys; otherwise the cause is shared.");
  }
  const d = decompose("STORE_NAME", "store");
  d.segments = d.segments.slice(0, 8);
  const top3 = d.segments.slice(0, 3).reduce((a, s) => a + (s.contribution_pts || 0), 0);
  const share3 = d.change_pts ? r1((100 * top3) / d.change_pts) : null;
  const verdict = d.change_pts === null || d.change_pts >= 0 ? "RULED_OUT" : share3 >= 60 ? "CONFIRMED" : "RULED_OUT";
  return out("store", verdict, verdict === "CONFIRMED" ? `A few stores: the three worst explain ${share3}% of the ${d.change_pts} pt change.`
    : `Spread across stores: the three worst explain ${share3}% of the ${d.change_pts} pt change, so the cause is shared, not store-specific.`,
    Object.assign(d, { top_three_stores_share_pct: share3 }),
    "CONFIRMED (store-specific) when the three worst stores explain 60% or more of a fall; otherwise RULED_OUT: the cause is shared across stores.");
}

// ---------- what ----------
if (dim === "theme") {
  const th = rows(`
    WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND THEME <> 'No comment')
    SELECT THEME, COUNT_IF(IN_W AND IS_NEGATIVE) AS W, COUNT_IF(IN_B AND IS_NEGATIVE) AS B,
           COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR') AS WD, COUNT_IF(IN_B AND NPS_CLASS = 'DETRACTOR') AS BD,
           COUNT_IF(IN_W AND IS_NEGATIVE AND SOURCE = 'SURVEY') AS WS
    FROM v GROUP BY 1`, [wStart, wEnd, bStart, bEnd].concat(sc.binds))
    .map((t) => ({ theme: t.theme, negative_mentions_window: t.w, negative_mentions_baseline: t.b,
      negative_per_week_window: perWk(t.w, wWeeks), negative_per_week_baseline: perWk(t.b, bWeeks),
      rise_multiple: t.b ? r1((t.w / wWeeks) / (t.b / bWeeks)) : null,
      detractor_mentions_window: t.wd, detractor_mentions_baseline: t.bd, from_surveys_window: t.ws }))
    .sort((a, b) => (b.negative_per_week_window - b.negative_per_week_baseline) - (a.negative_per_week_window - a.negative_per_week_baseline));
  const top = th[0] || {};
  const rose = top.negative_mentions_window >= 20 && (top.rise_multiple === null || top.rise_multiple >= 3);
  return out("theme", rose ? "CONFIRMED" : "INCONCLUSIVE",
    rose ? `${top.theme} is what changed: ${top.negative_per_week_window} negative mentions a week against ${top.negative_per_week_baseline} (${top.rise_multiple === null ? "new" : top.rise_multiple + "x"}), ${top.detractor_mentions_window} of them from detractors.`
         : `No single theme jumped: the largest rise is ${top.theme}, ${top.negative_per_week_window} a week against ${top.negative_per_week_baseline}.`,
    { themes: th.slice(0, 8) }, "CONFIRMED when the theme with the largest rise has 20 or more negative mentions in the window at 3x or more its baseline rate.");
}

// ---------- why ----------
function scopeStores() {
  return rows(`SELECT STORE_CODE, STORE_NAME, STATE FROM ${C}.DIM_STORE WHERE ${sc.where} ORDER BY STORE_CODE`, sc.binds);
}
function shortBrands() {
  return rows(`
    SELECT BRAND_NAME, COUNT(DISTINCT IFF(STATUS = 'SHORT', STORE_CODE, NULL)) AS STORES_SHORT, COUNT(DISTINCT IFF(STATUS = 'LOW', STORE_CODE, NULL)) AS STORES_LOW,
           COUNT(DISTINCT STORE_CODE) AS STORES, MIN(IFF(STATUS = 'SHORT', WEEK_START, NULL)) AS SHORT_FROM,
           ARRAY_AGG(DISTINCT IFF(STATUS = 'SHORT', STORE_CODE, NULL)) AS SHORT_STORES, ANY_VALUE(REASON) AS REASON
    FROM ${T}.STORE_SUPPLY_WEEKLY
    WHERE ${sc.where} AND WEEK_START <= ? AND DATEADD('day', 6, WEEK_START) >= ?
    GROUP BY 1 HAVING STORES_SHORT > 0 ORDER BY STORES_SHORT DESC`, sc.binds.concat([wEnd, wStart]));
}

if (dim === "stock") {
  const sb = shortBrands();
  const allOos = split("'all'")[0] || { w_oos: 0, b_oos: 0, w_oos_nr: 0, b_oos_nr: 0 };
  const rise = allOos.b_oos_nr ? r1((allOos.w_oos_nr / wWeeks) / (allOos.b_oos_nr / bWeeks)) : null;
  if (!sb.length) return out("stock", allOos.w_oos_nr >= 20 ? "INCONCLUSIVE" : "RULED_OUT",
    `No store in ${sc.label} was SHORT of a brand in the window; out-of-stock mentions: ${allOos.w_oos} (${perWk(allOos.b_oos, bWeeks)} a week before).`,
    { out_of_stock_mentions_window: allOos.w_oos, out_of_stock_per_week_baseline: perWk(allOos.b_oos, bWeeks) },
    "Needs a brand SHORT at stores in the scope during the window.");
  const stores = scopeStores();
  const brands = sb.slice(0, 3).map((b) => {
    const shortSet = (b.short_stores || []).filter(Boolean);
    const per = rows(`
      WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND THEME = 'Out of stock')
      SELECT ARRAY_CONTAINS(STORE_CODE::VARIANT, PARSE_JSON(?)) AS IS_SHORT,
             COUNT_IF(IN_W) AS W, COUNT_IF(IN_W AND SOURCE <> 'REPLY') AS W_NR, COUNT_IF(IN_B AND SOURCE <> 'REPLY') AS B_NR,
             COUNT_IF(IN_W AND BRAND_NAME = ?) AS W_BRAND, COUNT_IF(IN_W AND SOURCE = 'REPLY') AS W_REPLY
      FROM v GROUP BY 1`, [wStart, wEnd, bStart, bEnd].concat(sc.binds, [JSON.stringify(shortSet), b.brand_name]));
    const g = (x) => per.find((p) => p.is_short === x) || { w: 0, w_nr: 0, b_nr: 0, w_brand: 0, w_reply: 0 };
    const sh = g(true), ot = g(false), nShort = shortSet.length, nOther = Math.max(stores.length - nShort, 0);
    const named = sh.w_brand + ot.w_brand, oos = sh.w + ot.w;
    return { brand: b.brand_name, stores_in_scope: stores.length, stores_short: nShort, stores_low: b.stores_low, short_from: b.short_from, alert_reason: b.reason,
      out_of_stock_mentions_window: oos, mentions_naming_brand: named, naming_brand_share_pct: pct(named, oos),
      at_short_stores: sh.w, at_other_stores: ot.w, campaign_replies_at_short_stores: sh.w_reply,
      per_store_short_excl_replies: nShort ? r1(sh.w_nr / nShort) : null, per_store_other_excl_replies: nOther ? r1(ot.w_nr / nOther) : null };
  });
  const top = brands[0];
  const statewide = top.per_store_other_excl_replies !== null && top.per_store_short_excl_replies !== null && top.per_store_short_excl_replies < 2 * Math.max(top.per_store_other_excl_replies, 0.1);
  const verdict = allOos.w_oos_nr >= 20 && (rise === null || rise >= 3) && top.naming_brand_share_pct >= 50 ? "CONFIRMED"
    : allOos.w_oos_nr < 10 || (rise !== null && rise < 2) || top.naming_brand_share_pct < 20 ? "RULED_OUT" : "INCONCLUSIVE";
  const reading = verdict === "CONFIRMED"
    ? `${top.brand} is out: ${top.stores_short} of ${top.stores_in_scope} stores SHORT from ${top.short_from}; out-of-stock mentions (excluding campaign replies) ran ${rise === null ? "new" : rise + "x"} their baseline rate and ${top.naming_brand_share_pct}% of all ${top.out_of_stock_mentions_window} name the brand. `
      + (statewide && sc.kind !== "store" ? `Outside campaign replies, short and other stores draw similar complaints (${top.per_store_short_excl_replies} vs ${top.per_store_other_excl_replies} per store): a DC-wide shortage, not store-specific.` : `They concentrate at the short stores (${top.per_store_short_excl_replies} vs ${top.per_store_other_excl_replies} per store).`)
    : verdict === "RULED_OUT" ? `Stock does not explain it: out-of-stock mentions (excluding campaign replies) ran ${rise === null ? "new" : rise + "x"} their baseline rate (${allOos.w_oos_nr} in the window) and ${top.naming_brand_share_pct}% name ${top.brand}, SHORT at ${top.stores_short} stores.`
    : `Some stock signal: ${top.brand} SHORT at ${top.stores_short} stores, out-of-stock mentions ${rise === null ? "new" : rise + "x"} baseline, ${top.naming_brand_share_pct}% naming it.`;
  return out("stock", verdict, reading,
    { out_of_stock_mentions_window: allOos.w_oos, out_of_stock_excl_replies_window: allOos.w_oos_nr, out_of_stock_excl_replies_per_week_baseline: perWk(allOos.b_oos_nr, bWeeks),
      rise_multiple: rise, brands_short: brands, dc_wide_not_store_specific: statewide },
    "CONFIRMED when out-of-stock mentions excluding campaign replies are 20 or more, at 3x or more their baseline rate, and half or more name a brand SHORT in the scope; RULED_OUT under 10 mentions, under 2x, or under 20% naming it. Campaign replies are excluded from the rise because a campaign sends them only to its own audience.");
}

if (dim === "campaign") {
  const cr = rows(`
    WITH v AS (SELECT * FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND EVENT_DATE BETWEEN ? AND ? AND SOURCE = 'REPLY')
    SELECT v.CAMPAIGN_ID, c.NAME, c.STATUS, c.START_DATE::STRING AS START_DATE, c.PROMOTED_BRAND, c.PROMOTED_CLASS,
           COUNT(*) AS REPLIES, COUNT_IF(v.IS_NEGATIVE) AS NEGATIVE, COUNT_IF(v.THEME = 'Out of stock') AS OOS,
           COUNT_IF(sw.STATUS = 'SHORT') AS FROM_SHORT_STORES
    FROM v JOIN ${K}.CAMPAIGN c ON c.CAMPAIGN_ID = v.CAMPAIGN_ID
    LEFT JOIN ${T}.STORE_SUPPLY_WEEKLY sw ON sw.BRAND_NAME = c.PROMOTED_BRAND AND sw.STORE_CODE = v.STORE_CODE AND sw.WEEK_START = v.EVENT_WEEK
    GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY NEGATIVE DESC`, sc.binds.concat([wStart, wEnd]));
  const negAll = (split("'all'")[0] || {}).w_neg || 0;
  const top = cr[0];
  if (!top) return out("campaign", "RULED_OUT", `No campaign replies in ${sc.label} in the window.`, { campaigns: [] }, "Needs campaign replies in the window.");
  const share = pct(top.negative, negAll), fromShort = pct(top.from_short_stores, top.replies);
  const verdict = share >= 20 && top.promoted_brand && fromShort >= 50 ? "CONFIRMED" : share >= 20 ? "INCONCLUSIVE" : "RULED_OUT";
  return out("campaign", verdict,
    verdict === "CONFIRMED" ? `${top.campaign_id} (${top.name}) amplified it: it promoted ${top.promoted_brand}${top.promoted_class ? " " + top.promoted_class : ""} from ${top.start_date}, and ${top.from_short_stores} of its ${top.replies} replies came from members of stores SHORT of the brand; its ${top.negative} negative replies are ${share}% of the window's negative voice. Replies carry no score, so they swell complaints, not NPS.`
      : verdict === "INCONCLUSIVE" ? `${top.campaign_id} drew ${top.negative} negative replies (${share}% of negative voice), but not from stores short of what it promoted.`
      : `Campaign replies are a small part of the negative voice: ${top.campaign_id} drew ${top.negative} (${share}%).`,
    { campaigns: cr.slice(0, 4).map((c) => ({ campaign_id: c.campaign_id, name: c.name, status: c.status, start_date: c.start_date, promoted_brand: c.promoted_brand, promoted_class: c.promoted_class,
        replies: c.replies, negative_replies: c.negative, out_of_stock_replies: c.oos, replies_from_short_stores: c.from_short_stores })),
      negative_items_window: negAll, top_campaign_share_of_negative_pct: share, replies_from_short_stores_pct: fromShort },
    "CONFIRMED (an amplifier) when a campaign's negative replies are 20% or more of the window's negative voice and half or more of its replies come from stores SHORT of the brand it promoted.");
}

if (dim === "supply") {
  const sb = shortBrands();
  const dcs = sc.kind === "national" ? ["NSW", "VIC", "QLD", "SA", "WA"] : [sc.dc];
  const brands = (sb.length ? sb.slice(0, 2).map((b) => b.brand_name) : []);
  if (!brands.length) return out("supply", "RULED_OUT", `No brand was SHORT at stores in ${sc.label} in the window, so there is no supply failure to trace.`, {}, "Traces brands SHORT in the scope upstream.");
  const res = brands.map((brand) => {
    const sup = rows(`SELECT SUPPLIER_NAME FROM ${C}.DIM_DISTRIBUTOR WHERE ARRAY_CONTAINS(?::VARIANT, SPLIT(REPLACE(BRANDS, ', ', ','), ','))`, [brand])[0];
    const card = rows(`
      SELECT d.CALENDAR_DATE::STRING AS WEEK, s.DIFOT_PCT, s.ORDERS_TOTAL
      FROM ${A}.DT_SUPPLIER_DIFOT s JOIN ${C}.DIM_DATE d ON d.FISCAL_YEAR = s.FISCAL_YEAR AND d.FISCAL_WEEK = s.FISCAL_WEEK AND d.DAY_OF_WEEK = 'Monday'
      WHERE s.BRAND_NAME = ? AND s.CLASS IS NULL AND d.CALENDAR_DATE BETWEEN ? AND ? ORDER BY 1`, [brand, monday(bStart), wEnd]);
    const wavg = (xs) => { const o = xs.reduce((a, x) => a + (x.orders_total || 0), 0); return o ? r1(xs.reduce((a, x) => a + x.difot_pct * (x.orders_total || 0), 0) / o) : null; };
    const cw = card.filter((c) => c.week >= monday(wStart)), cb = card.filter((c) => c.week < monday(wStart));
    const po = rows(`
      SELECT SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_UNITS, 0)) AS W_DLV, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_ORDERED_UNITS, 0)) AS W_ORD,
             SUM(IFF(WEEK_START BETWEEN ? AND ?, ON_TIME_LINES, 0)) AS W_OT, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_LINES, 0)) AS W_L,
             SUM(IFF(WEEK_START > ?, DELIVERED_UNITS + OPEN_FORECAST_UNITS, 0)) AS N_EXP, SUM(IFF(WEEK_START > ?, ORDERED_UNITS, 0)) AS N_ORD,
             SUM(IFF(WEEK_START > ?, LINES, 0)) AS N_L
      FROM ${T}.DC_INBOUND_WEEKLY WHERE BRAND_NAME = ? AND ARRAY_CONTAINS(DC_STATE::VARIANT, PARSE_JSON(?))`,
      [monday(wStart), wEnd, monday(wStart), wEnd, monday(wStart), wEnd, monday(wStart), wEnd, asOf, asOf, asOf, brand, JSON.stringify(dcs)])[0] || {};
    return { brand, supplier: sup ? sup.supplier_name : null,
      scorecard_difot_baseline_pct: wavg(cb), scorecard_difot_window_pct: wavg(cw),
      scorecard_difot_latest_pct: card.length ? r1(card[card.length - 1].difot_pct) : null, scorecard_latest_week: card.length ? card[card.length - 1].week : null,
      scorecard_weekly: card.map((c) => ({ week: c.week, difot_pct: r1(c.difot_pct) })),
      dc: dcs.join(", "), window_po_fill_pct: pct(po.w_dlv, po.w_ord), window_po_on_time_pct: pct(po.w_ot, po.w_l),
      after_voice_clock_lines: po.n_l, after_voice_clock_expected_fill_pct: pct(po.n_exp, po.n_ord) };
  });
  const top = res[0];
  const drop = top.scorecard_difot_baseline_pct !== null && top.scorecard_difot_window_pct !== null ? r1(top.scorecard_difot_window_pct - top.scorecard_difot_baseline_pct) : null;
  const verdict = (drop !== null && drop <= -5) || (top.after_voice_clock_expected_fill_pct !== null && top.after_voice_clock_expected_fill_pct < 85) ? "CONFIRMED" : "RULED_OUT";
  return out("supply", verdict,
    verdict === "CONFIRMED" ? `Upstream: ${top.supplier}'s DIFOT on ${top.brand} fell from ${top.scorecard_difot_baseline_pct}% to ${top.scorecard_difot_window_pct}% (latest ${top.scorecard_difot_latest_pct}%), and POs due into the ${top.dc} DC after ${asOf} are expected to land ${top.after_voice_clock_expected_fill_pct}% of the units ordered.`
      : `The supplier is delivering: ${top.supplier}'s DIFOT on ${top.brand} ${top.scorecard_difot_baseline_pct}% to ${top.scorecard_difot_window_pct}%.`,
    { brands: res, difot_change_pts: drop },
    "Traces each brand SHORT in the scope to its supplier. CONFIRMED when the supplier scorecard DIFOT fell 5 pts or more against the baseline (order-weighted), or the POs due after the voice clock are expected to land under 85% of the units ordered.");
}

if (dim === "delivery") {
  const dcs = sc.kind === "national" ? ["NSW", "VIC", "QLD", "SA", "WA"] : [sc.dc];
  const v = rows(`
    SELECT COUNT_IF(EVENT_DATE BETWEEN ? AND ? AND THEME = 'Delivery and click and collect' AND IS_NEGATIVE) AS W,
           COUNT_IF(EVENT_DATE BETWEEN ? AND ? AND THEME = 'Delivery and click and collect' AND IS_NEGATIVE) AS B
    FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where}`, [wStart, wEnd, bStart, bEnd].concat(sc.binds))[0];
  const lr = longRun("Delivery and click and collect");
  // Operations are compared from when the complaints began: a dip that starts
  // after them cannot be their cause. Both periods need enough PO lines to read.
  const persistent = lr.baseline_already_elevated;
  const opsFrom = persistent ? lr.elevated_since : monday(wStart);
  const opsBaseFrom = addDays(opsFrom, -56), opsBaseTo = addDays(opsFrom, -1);
  const po = rows(`
    SELECT SUM(IFF(WEEK_START BETWEEN ? AND ?, ON_TIME_LINES, 0)) AS W_OT, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_LINES, 0)) AS W_L,
           SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_UNITS, 0)) AS W_DLV, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_ORDERED_UNITS, 0)) AS W_ORD,
           SUM(IFF(WEEK_START BETWEEN ? AND ?, ON_TIME_LINES, 0)) AS B_OT, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_LINES, 0)) AS B_L,
           SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_UNITS, 0)) AS B_DLV, SUM(IFF(WEEK_START BETWEEN ? AND ?, DELIVERED_ORDERED_UNITS, 0)) AS B_ORD
    FROM ${T}.DC_INBOUND_WEEKLY WHERE ARRAY_CONTAINS(DC_STATE::VARIANT, PARSE_JSON(?))`,
    [opsFrom, wEnd, opsFrom, wEnd, opsFrom, wEnd, opsFrom, wEnd, opsBaseFrom, opsBaseTo, opsBaseFrom, opsBaseTo, opsBaseFrom, opsBaseTo, opsBaseFrom, opsBaseTo, JSON.stringify(dcs)])[0] || {};
  const wOt = pct(po.w_ot, po.w_l), bOt = pct(po.b_ot, po.b_l), wF = pct(po.w_dlv, po.w_ord), bF = pct(po.b_dlv, po.b_ord);
  const enough = (po.w_l || 0) >= 20 && (po.b_l || 0) >= 20;
  const poNote = enough ? null : `Too few PO lines to compare: ${po.b_l || 0} delivered in the eight weeks before ${opsFrom} (the PO book starts on 17 Feb 2026) and ${po.w_l || 0} from it.`;
  // When the complaints started before the window, judge them against the
  // long-run norm, not a baseline that already contains them.
  const ref = persistent ? lr.long_run_per_week : (v.b / bWeeks);
  const rise = ref ? r1((v.w / wWeeks) / ref) : null;
  const rose = v.w >= 10 && (rise === null || rise >= 2);
  const opsFell = enough && ((wOt !== null && bOt !== null && wOt <= bOt - 5) || (wF !== null && bF !== null && wF <= bF - 5));
  const verdict = !rose ? "RULED_OUT" : opsFell ? "CONFIRMED" : "INCONCLUSIVE";
  const onset = lr.baseline_already_elevated ? `Delivery complaints have run high since the week of ${lr.elevated_since}: ${perWk(v.w, wWeeks)} a week in the window against a long-run ${lr.long_run_per_week} a week, so the baseline (${perWk(v.b, bWeeks)} a week) already contains them. ` : "";
  return out("delivery", verdict,
    onset + (!rose ? `Delivery complaints did not rise: ${v.w} in the window, ${perWk(v.b, bWeeks)} a week before.`
      : opsFell ? `Delivery complaints rose ${rise === null ? "from nothing" : rise + "x"} and inbound to the ${dcs.join(", ")} DC slipped from ${opsFrom}: on time ${bOt}% to ${wOt}%, fill ${bF}% to ${wF}%.`
      : `Voice only: delivery complaints rose ${rise === null ? "from nothing" : rise + "x"} (${v.w} in the window), but ${!enough ? `inbound to the ${dcs.join(", ")} DC ran ${wOt}% on time and ${wF}% fill from ${opsFrom} (too few earlier PO lines to compare)` : `inbound to the ${dcs.join(", ")} DC held from ${opsFrom} (on time ${bOt}% to ${wOt}%, fill ${bF}% to ${wF}%)`}. Baby Mart holds no home-delivery or click-and-collect data, so the cause cannot be confirmed from operations.`),
    { delivery_complaints_window: v.w, delivery_complaints_per_week_window: perWk(v.w, wWeeks), delivery_complaints_per_week_baseline: perWk(v.b, bWeeks), rise_multiple: rise,
      long_run_per_week: lr.long_run_per_week, elevated_since: lr.elevated_since, baseline_already_elevated: lr.baseline_already_elevated,
      dc: dcs.join(", "), inbound_compared_from: opsFrom, inbound_on_time_window_pct: wOt, inbound_on_time_baseline_pct: bOt, inbound_fill_window_pct: wF, inbound_fill_baseline_pct: bF,
      inbound_lines_window: po.w_l || 0, inbound_lines_baseline: po.b_l || 0, po_note: poNote },
    "Needs delivery complaints at 10 or more and 2x their reference rate: the baseline, or the long-run norm when the complaints were already elevated before the window. CONFIRMED when DC inbound on-time or fill fell 5 pts or more from when the complaints began, on 20 or more PO lines each side; INCONCLUSIVE when only the voice moved (there is no store delivery or click-and-collect data).");
}

if (dim === "price") {
  const t = rows(`
    WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where})
    SELECT TIER_GROUP, COUNT_IF(IN_W AND THEME = 'Price and value' AND IS_NEGATIVE) AS W, COUNT_IF(IN_B AND THEME = 'Price and value' AND IS_NEGATIVE) AS B,
      COUNT_IF(IN_W AND SOURCE = 'SURVEY') AS W_R, COUNT_IF(IN_W AND NPS_CLASS = 'PROMOTER') AS W_P, COUNT_IF(IN_W AND NPS_CLASS = 'DETRACTOR') AS W_D,
      COUNT_IF(IN_B AND SOURCE = 'SURVEY') AS B_R, COUNT_IF(IN_B AND NPS_CLASS = 'PROMOTER') AS B_P, COUNT_IF(IN_B AND NPS_CLASS = 'DETRACTOR') AS B_D
    FROM v GROUP BY 1 ORDER BY 1`, [wStart, wEnd, bStart, bEnd].concat(sc.binds));
  const tiers = t.filter((x) => x.tier_group !== "Not a member").map((x) => ({ tier_group: x.tier_group, price_complaints_window: x.w, price_complaints_per_week_window: perWk(x.w, wWeeks),
    price_complaints_per_week_baseline: perWk(x.b, bWeeks), window_nps: nps(x.w_p, x.w_d, x.w_r), baseline_nps: nps(x.b_p, x.b_d, x.b_r) }));
  const gap = rows(`SELECT ROUND(AVG(IFF(d.CALENDAR_DATE BETWEEN ? AND ?, p.PRICE_GAP_PCT, NULL)), 1) AS W, ROUND(AVG(IFF(d.CALENDAR_DATE BETWEEN ? AND ?, p.PRICE_GAP_PCT, NULL)), 1) AS B
                    FROM ${C}.FACT_COMPETITOR_PRICING p JOIN ${C}.DIM_DATE d ON d.DATE_KEY = p.DATE_KEY`, [addDays(wStart, -7), wEnd, bStart, bEnd])[0] || {};
  const w = t.reduce((a, x) => a + x.w, 0), b = t.reduce((a, x) => a + x.b, 0);
  const rise = b ? r1((w / wWeeks) / (b / bWeeks)) : null;
  const topT = tiers.slice().sort((a, b2) => b2.price_complaints_window - a.price_complaints_window)[0] || {};
  const verdict = w >= 15 && (rise === null || rise >= 2) ? "CONFIRMED" : "RULED_OUT";
  const gapMoved = gap.w !== null && gap.b !== null && Math.abs(gap.w - gap.b) >= 1;
  return out("price", verdict,
    verdict === "CONFIRMED" ? `Price complaints rose ${rise === null ? "from nothing" : rise + "x"} (${w} in the window), ${pct(topT.price_complaints_window, w)}% from ${topT.tier_group} members. ${gap.w === null || gap.b === null ? "No competitor prices cover both periods." : gapMoved ? `Competitor prices moved too: gap ${gap.b}% to ${gap.w}%.` : `Competitor prices did not move (gap ${gap.b}% to ${gap.w}%): it is how members see value, not a price change.`}`
      : `Price complaints did not rise: ${w} in the window, ${perWk(b, bWeeks)} a week before.`,
    { price_complaints_window: w, price_complaints_per_week_baseline: perWk(b, bWeeks), rise_multiple: rise, tiers,
      competitor_price_gap_window_pct: gap.w, competitor_price_gap_baseline_pct: gap.b,
      note: "Competitor price gap = how much a competitor is above (+) or below (-) Baby Mart on matched products (Nappies & Wipes and Feeding)." },
    "CONFIRMED when negative price mentions are 15 or more in the window at 2x or more their baseline rate.");
}

if (dim === "app") {
  const wk = rows(`
    SELECT EVENT_WEEK::STRING AS WEEK, COUNT_IF(THEME = 'App and website' AND IS_NEGATIVE) AS N
    FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND EVENT_DATE BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`, sc.binds.concat([bStart, wEnd]));
  const w = wk.filter((x) => x.week >= monday(wStart)).reduce((a, x) => a + x.n, 0), b = wk.filter((x) => x.week < monday(wStart)).reduce((a, x) => a + x.n, 0);
  const peak = wk.slice().sort((a, b2) => b2.n - a.n)[0] || { week: null, n: 0 };
  const rise = b ? r1((w / wWeeks) / (b / bWeeks)) : null;
  const inWindow = w >= 10 && (rise === null || rise >= 2);
  const verdict = inWindow ? "CONFIRMED" : "RULED_OUT";
  return out("app", verdict,
    inWindow ? `App and website complaints rose to ${w} in the window, ${peak.n} of them in the week of ${peak.week}${pct(peak.n, w) >= 60 ? ": a one-week outage, already over" : ""}.`
      : `Not in this window: ${w} app and website complaints${peak.n >= 20 ? `; the spike was earlier, ${peak.n} in the week of ${peak.week}` : ""}.`,
    { app_complaints_window: w, app_complaints_per_week_baseline: perWk(b, bWeeks), rise_multiple: rise, peak_week: peak.week, peak_week_complaints: peak.n,
      weekly: wk.filter((x) => x.n > 0) },
    "CONFIRMED when app and website complaints are 10 or more in the window at 2x or more their baseline rate.");
}

if (dim === "quality") {
  const q = rows(`
    WITH v AS (SELECT *, EVENT_DATE BETWEEN ? AND ? AS IN_W, EVENT_DATE BETWEEN ? AND ? AS IN_B FROM ${T}.CUSTOMER_VOICE WHERE ${sc.where} AND THEME = 'Product quality and safety' AND IS_NEGATIVE)
    SELECT COALESCE(BRAND_NAME, 'No brand named') AS BRAND, COUNT_IF(IN_W) AS W, COUNT_IF(IN_B) AS B FROM v GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
    [wStart, wEnd, bStart, bEnd].concat(sc.binds))
    .map((x) => ({ brand: x.brand, quality_complaints_window: x.w, per_week_window: perWk(x.w, wWeeks), per_week_baseline: perWk(x.b, bWeeks) }));
  const w = q.reduce((a, x) => a + x.quality_complaints_window, 0);
  const top = q[0] || {};
  const rise = top.per_week_baseline ? r1(top.per_week_window / top.per_week_baseline) : null;
  const verdict = top.quality_complaints_window >= 10 && (rise === null || rise >= 2) ? "CONFIRMED" : "RULED_OUT";
  return out("quality", verdict,
    verdict === "CONFIRMED" ? `${top.brand} quality complaints rose ${rise === null ? "from nothing" : rise + "x"}.`
      : `Quality is steady, not a change: the most-named brand, ${top.brand}, drew ${top.per_week_window} a week against ${top.per_week_baseline} before.`,
    { brands: q, quality_complaints_window_top5: w },
    "CONFIRMED when one brand's negative quality mentions are 10 or more in the window at 2x or more its baseline rate. A long-running complaint is a standing issue, not the cause of a recent move.");
}

return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'.`, valid_dimensions: ["state", "store", "category", "tier", "theme", "stock", "campaign", "supply", "delivery", "price", "app", "quality"] });
$$;

-- ---------- The two tools the agent calls ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.SENTIMENT.NPS_EVIDENCE(SCOPE VARCHAR, START_DATE VARCHAR, END_DATE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'NPS evidence pack for a scope (ALL, a state or a store) and window: NPS against the 8 weeks before, the weekly series, rising themes, where it moved, verbatims.'
EXECUTE AS OWNER
AS
$$
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.SENTIMENT.NPS_ANALYSIS(?, ?, ?, '')", binds: [SCOPE || "", START_DATE || "", END_DATE || ""] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.SENTIMENT.TEST_NPS_CAUSE(SCOPE VARCHAR, START_DATE VARCHAR, END_DATE VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Tests one candidate explanation of an NPS move: where (state, store, category, tier), what (theme) or why (stock, campaign, supply, delivery, price, app, quality).'
EXECUTE AS OWNER
AS
$$
const d = String(DIMENSION || "").trim();
if (!d) return JSON.stringify({ ok: false, error: "Name a DIMENSION to test." });
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.SENTIMENT.NPS_ANALYSIS(?, ?, ?, ?)", binds: [SCOPE || "", START_DATE || "", END_DATE || "", d] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;

CALL NPS_EVIDENCE('NSW', '', '');
