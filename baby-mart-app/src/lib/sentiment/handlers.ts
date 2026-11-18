// ─── NPS Analyst: data for the sentiment health pages ────────────────────────
//
// Pulse (detect), State map (locate), Store 360 (drill) and Risk radar
// (predict). The Investigator page talks to NPS_INVESTIGATOR_AGENT through
// /api/agent/chat.
//
// Every NPS here is rebuilt from counts -- 100 x (promoters - detractors) /
// responses over whatever weeks and segments are summed -- never an average of
// NPS values. Windows are whole weeks (Monday) ending on the focus week; the
// last week of voice is partial and is never a focus week. A store has about
// three surveys a week, so store-level NPS is shown over four weeks.

import { S } from "./schema";
import { batch, q, CmpError, type Row } from "@/lib/campaign/db";

const r1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addWeeks = (w: string, k: number) => { const d = new Date(w + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * k); return iso(d); };

export const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const CATEGORIES = ["Nappies & Wipes", "Car Seats", "Prams & Strollers", "Feeding", "Clothing", "Not product-specific"] as const;
export const TIERS = ["Gold & Platinum", "Silver & Bronze"] as const;
/** Responses below which a state's NPS is shown as a low sample: one survey
 *  moves it by five points or more. */
export const MIN_RESPONSES = 20;
const FIRST_WEEK = "2025-07-07";

type Counts = { r: number; p: number; d: number; oos: number; neg: number };
const ZERO: Counts = { r: 0, p: 0, d: 0, oos: 0, neg: 0 };
const add = (a: Counts, b: Partial<Counts>): Counts => ({ r: a.r + n(b.r), p: a.p + n(b.p), d: a.d + n(b.d), oos: a.oos + n(b.oos), neg: a.neg + n(b.neg) });
export const nps = (c: { r: number; p: number; d: number }) => (c.r ? r1((100 * (c.p - c.d)) / c.r) : null);
const counts = (row: Row): Counts => ({ r: n(row.R), p: n(row.P), d: n(row.D), oos: n(row.OOS), neg: n(row.NEG) });

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T | "ALL" = "ALL"): T | "ALL" {
  if (!v || v.toUpperCase() === "ALL") return fallback;
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
const period = (v: string | null) => (v === "4" ? 4 : 1);
/** The baseline is the four weeks before a one-week window, eight before a four-week one. */
const baseWeeks = (p: number) => (p === 1 ? 4 : 8);

// ---------- the clock and the weeks ----------
async function weeks() {
  const rows = await q(`SELECT WEEK_START::STRING AS W, IS_COMPLETE, ${S}.SENTIMENT_AS_OF()::STRING AS AS_OF FROM ${S}.WEEKS WHERE WEEK_START >= ? ORDER BY 1`, [FIRST_WEEK]);
  const complete = rows.filter((r) => r.IS_COMPLETE === true || r.IS_COMPLETE === "true").map((r) => String(r.W));
  return { complete, last: complete[complete.length - 1], asOf: String(rows[0]?.AS_OF ?? "") };
}
function focusWeek(v: string | null, complete: string[]) {
  return v && complete.includes(v) ? v : complete[complete.length - 1];
}

export async function getMeta() {
  const [w, stores] = await Promise.all([
    weeks(),
    q(`SELECT STORE_CODE, STORE_NAME, SUBURB, STATE FROM ${S}.STORES ORDER BY STATE, STORE_NAME`),
  ]);
  return { asOf: w.asOf, weeks: w.complete, defaultWeek: w.last, stores: stores.map((s) => ({ code: s.STORE_CODE, name: s.STORE_NAME, suburb: s.SUBURB, state: s.STATE })) };
}

// ---------- weekly counts by a segment ----------
type Series = Map<string, Map<string, Counts>>; // segment -> week -> counts
function toSeries(rows: Row[], key: string): Series {
  const out: Series = new Map();
  for (const r of rows) {
    const k = String(r[key]);
    if (!out.has(k)) out.set(k, new Map());
    out.get(k)!.set(String(r.WK), counts(r));
  }
  return out;
}
function sumWeeks(s: Map<string, Counts> | undefined, from: string, to: string): Counts {
  let c = { ...ZERO };
  if (!s) return c;
  for (const [w, v] of s) if (w >= from && w <= to) c = add(c, v);
  return c;
}
/** Window and baseline for a focus week. */
function windows(week: string, p: number) {
  const wFrom = addWeeks(week, -(p - 1)), bTo = addWeeks(wFrom, -1), bFrom = addWeeks(wFrom, -baseWeeks(p));
  return { wFrom, wTo: week, bFrom, bTo };
}
function compare(s: Map<string, Counts> | undefined, week: string, p: number) {
  const { wFrom, wTo, bFrom, bTo } = windows(week, p);
  const w = sumWeeks(s, wFrom, wTo), b = sumWeeks(s, bFrom, bTo);
  const now = nps(w), base = nps(b);
  return {
    nps: now, baseline: base, change: now === null || base === null ? null : r1(now - base),
    responses: w.r, baselineResponses: b.r, detractorRate: w.r ? r1((100 * w.d) / w.r) : null,
    oos: w.oos, oosBaselinePerWeek: r1(b.oos / baseWeeks(p)), negative: w.neg, negativeBaselinePerWeek: r1(b.neg / baseWeeks(p)),
    lowSample: w.r < MIN_RESPONSES,
  };
}

const SEG_SQL = (seg: string, filters = "") => `
  SELECT ${seg} AS SEG, EVENT_WEEK::STRING AS WK, SUM(RESPONSES) AS R, SUM(PROMOTERS) AS P, SUM(DETRACTORS) AS D,
         SUM(OOS_MENTIONS) AS OOS, SUM(NEGATIVE_ITEMS) AS NEG
  FROM ${S}.HEALTH_WEEKLY WHERE EVENT_WEEK >= ? ${filters} GROUP BY 1, 2`;

// ---------- Pulse ----------
export async function getPulse(weekRaw: string | null) {
  const w = await weeks();
  const week = focusWeek(weekRaw, w.complete);
  const since = addWeeks(FIRST_WEEK, -8);
  const [national, cats, tiers, states, sentiment, themes] = await batch([
    { sql: SEG_SQL("'all'"), binds: [since] },
    { sql: SEG_SQL("CATEGORY"), binds: [since] },
    { sql: SEG_SQL("TIER_GROUP", "AND TIER_GROUP <> 'Not a member'"), binds: [since] },
    { sql: SEG_SQL("STATE"), binds: [since] },
    { sql: `SELECT EVENT_WEEK::STRING AS WK, ROUND(100 * SUM(SENTIMENT_SUM) / NULLIF(SUM(SENTIMENT_N), 0), 1) AS SENT, SUM(VOICE_ITEMS) AS ITEMS
            FROM ${S}.HEALTH_WEEKLY WHERE EVENT_WEEK BETWEEN ? AND ? GROUP BY 1`, binds: [addWeeks(week, -4), week] },
    { sql: `SELECT THEME, COUNT_IF(EVENT_WEEK = ?) AS W, COUNT_IF(EVENT_WEEK < ?) AS B
            FROM ${S}.CUSTOMER_VOICE WHERE EVENT_WEEK BETWEEN ? AND ? AND IS_NEGATIVE AND THEME <> 'No comment' GROUP BY 1`,
      binds: [week, week, addWeeks(week, -4), week] },
  ]);
  const nat = toSeries(national, "SEG").get("all");
  const shown = w.complete;
  const rolling = (s: Map<string, Counts> | undefined, wk: string) => nps(sumWeeks(s, addWeeks(wk, -3), wk));
  const weekly = shown.map((wk) => {
    const c = nat?.get(wk) ?? ZERO;
    return { week: wk, responses: c.r, nps: nps(c), rolling4: rolling(nat, wk), oos: c.oos, negative: c.neg };
  });
  const cur = compare(nat, week, 1);
  const sentByWeek = new Map(sentiment.map((r) => [String(r.WK), r]));
  const sNow = n(sentByWeek.get(week)?.SENT);
  const sBaseRows = [...sentByWeek.entries()].filter(([k]) => k < week).map(([, v]) => v);
  const sBase = sBaseRows.length ? r1(sBaseRows.reduce((a, r) => a + n(r.SENT) * n(r.ITEMS), 0) / Math.max(1, sBaseRows.reduce((a, r) => a + n(r.ITEMS), 0))) : null;

  const catSeries = toSeries(cats, "SEG"), tierSeries = toSeries(tiers, "SEG"), stateSeries = toSeries(states, "SEG");
  const categories = CATEGORIES.filter((c) => catSeries.has(c)).map((c) => ({ category: c, ...compare(catSeries.get(c), week, 1), four: compare(catSeries.get(c), week, 4) }));
  const lines = (series: Series, keys: readonly string[]) => keys.filter((k) => series.has(k)).map((k) => ({
    name: k, points: shown.map((wk) => ({ week: wk, nps: rolling(series.get(k), wk) })),
  }));
  const stateRows = STATES.map((s) => ({ state: s, ...compare(stateSeries.get(s), week, 1) }));
  const hotspot = stateRows.filter((s) => !s.lowSample && s.change !== null).sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0] ?? null;
  const rising = themes.map((t) => ({ theme: String(t.THEME), week: n(t.W), baselinePerWeek: r1(n(t.B) / 4) }))
    .map((t) => ({ ...t, multiple: t.baselinePerWeek ? r1(t.week / t.baselinePerWeek) : null }))
    .sort((a, b) => (b.week - (b.baselinePerWeek ?? 0)) - (a.week - (a.baselinePerWeek ?? 0))).slice(0, 5);
  return {
    asOf: w.asOf, week, weeks: w.complete,
    kpis: { ...cur, sentiment: r1(sNow), sentimentBaseline: sBase },
    weekly, categories, categoryLines: lines(catSeries, CATEGORIES.filter((c) => c !== "Not product-specific")),
    tierLines: lines(tierSeries, TIERS), states: stateRows, hotspot, rising,
  };
}

// ---------- State map ----------
export async function getMap(periodRaw: string | null, categoryRaw: string | null, tierRaw: string | null) {
  const p = period(periodRaw), category = pick(categoryRaw, CATEGORIES), tier = pick(tierRaw, TIERS);
  const w = await weeks();
  const since = addWeeks(FIRST_WEEK, -(p - 1 + baseWeeks(p)));
  const f = "AND (CATEGORY = ? OR ? = 'ALL') AND (TIER_GROUP = ? OR ? = 'ALL')";
  const [rows, themeRows] = await batch([
    { sql: SEG_SQL("STATE", f), binds: [since, category, category, tier, tier] },
    { sql: `SELECT STATE, EVENT_WEEK::STRING AS WK, THEME, COUNT(*) AS N FROM ${S}.CUSTOMER_VOICE
            WHERE EVENT_WEEK >= ? AND IS_NEGATIVE AND THEME <> 'No comment' ${f} GROUP BY 1, 2, 3`,
      binds: [addWeeks(FIRST_WEEK, -(p - 1)), category, category, tier, tier] },
  ]);
  const series = toSeries(rows, "SEG");
  const themes = new Map<string, Map<string, Map<string, number>>>(); // state -> week -> theme -> n
  for (const t of themeRows) {
    const s = String(t.STATE), wk = String(t.WK);
    if (!themes.has(s)) themes.set(s, new Map());
    if (!themes.get(s)!.has(wk)) themes.get(s)!.set(wk, new Map());
    themes.get(s)!.get(wk)!.set(String(t.THEME), n(t.N));
  }
  const topTheme = (s: string, wk: string) => {
    const tally = new Map<string, number>();
    for (let i = 0; i < p; i++) for (const [th, c] of themes.get(s)?.get(addWeeks(wk, -i)) ?? []) tally.set(th, (tally.get(th) ?? 0) + c);
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? { theme: best[0], mentions: best[1] } : null;
  };
  const byWeek: Record<string, unknown[]> = {};
  for (const wk of w.complete) {
    byWeek[wk] = STATES.map((s) => ({ state: s, ...compare(series.get(s), wk, p), topTheme: topTheme(s, wk) }));
  }
  return { asOf: w.asOf, weeks: w.complete, defaultWeek: w.last, period: p, category, tier, minResponses: MIN_RESPONSES, byWeek };
}

export async function getMapStores(stateRaw: string | null, weekRaw: string | null, periodRaw: string | null, categoryRaw: string | null, tierRaw: string | null) {
  const state = pick(stateRaw, STATES, "ALL");
  if (state === "ALL") throw new CmpError(400, "Name a state.");
  const p = period(periodRaw), category = pick(categoryRaw, CATEGORIES), tier = pick(tierRaw, TIERS);
  const w = await weeks();
  const week = focusWeek(weekRaw, w.complete);
  // Stores are always read over four weeks: one week is about three surveys.
  const sp = Math.max(p, 4);
  const { wFrom, wTo, bFrom, bTo } = windows(week, sp);
  const rows = await q(`
    WITH h AS (
      SELECT STORE_CODE,
             SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, RESPONSES, 0)) AS R, SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, PROMOTERS, 0)) AS P,
             SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, DETRACTORS, 0)) AS D, SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, RESPONSES, 0)) AS BR,
             SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, PROMOTERS, 0)) AS BP, SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, DETRACTORS, 0)) AS BD,
             SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, OOS_MENTIONS, 0)) AS OOS, SUM(IFF(EVENT_WEEK BETWEEN ? AND ?, NEGATIVE_ITEMS, 0)) AS NEG
      FROM ${S}.HEALTH_WEEKLY
      WHERE STATE = ? AND EVENT_WEEK BETWEEN ? AND ? AND (CATEGORY = ? OR ? = 'ALL') AND (TIER_GROUP = ? OR ? = 'ALL')
      GROUP BY 1
    ), sup AS (
      SELECT STORE_CODE, LISTAGG(IFF(STATUS = 'SHORT', BRAND_NAME, NULL), ', ') WITHIN GROUP (ORDER BY BRAND_NAME) AS SHORT_BRANDS
      FROM ${S}.STORE_SUPPLY_WEEKLY WHERE WEEK_START = ? GROUP BY 1
    )
    SELECT s.STORE_CODE, s.STORE_NAME, s.SUBURB, s.STORE_TYPE, s.LATITUDE, s.LONGITUDE, h.*, sup.SHORT_BRANDS
    FROM ${S}.STORES s LEFT JOIN h ON h.STORE_CODE = s.STORE_CODE LEFT JOIN sup ON sup.STORE_CODE = s.STORE_CODE
    WHERE s.STATE = ?`,
    [wFrom, wTo, wFrom, wTo, wFrom, wTo, bFrom, bTo, bFrom, bTo, bFrom, bTo, wFrom, wTo, wFrom, wTo,
     state, bFrom, wTo, category, category, tier, tier, week, state]);
  const stores = rows.map((r) => {
    const now = nps({ r: n(r.R), p: n(r.P), d: n(r.D) }), base = nps({ r: n(r.BR), p: n(r.BP), d: n(r.BD) });
    return { code: r.STORE_CODE, name: r.STORE_NAME, suburb: r.SUBURB, storeType: r.STORE_TYPE, lat: n(r.LATITUDE), lon: n(r.LONGITUDE),
      nps: now, baseline: base, change: now === null || base === null ? null : r1(now - base), responses: n(r.R), oos: n(r.OOS), negative: n(r.NEG),
      shortBrands: r.SHORT_BRANDS ? String(r.SHORT_BRANDS) : null };
  }).sort((a, b) => (a.nps ?? 999) - (b.nps ?? 999));
  return { state, week, windowWeeks: sp, window: { from: wFrom, to: wTo }, stores };
}

// ---------- Store 360 ----------
export async function getStore(codeRaw: string | null, weekRaw: string | null) {
  const w = await weeks();
  const week = focusWeek(weekRaw, w.complete);
  const { wFrom, wTo, bFrom, bTo } = windows(week, 4);
  let code = codeRaw && /^S\d{3}$/.test(codeRaw) ? codeRaw : null;
  if (!code) {
    // No store named: open the one whose NPS fell furthest over the four weeks
    // to the focus week, among stores with enough surveys to read.
    const worst = await q(`
      SELECT STORE_CODE,
             100 * (SUM(IFF(EVENT_WEEK >= ?, PROMOTERS, 0)) - SUM(IFF(EVENT_WEEK >= ?, DETRACTORS, 0))) / NULLIF(SUM(IFF(EVENT_WEEK >= ?, RESPONSES, 0)), 0)
           - 100 * (SUM(IFF(EVENT_WEEK < ?, PROMOTERS, 0)) - SUM(IFF(EVENT_WEEK < ?, DETRACTORS, 0))) / NULLIF(SUM(IFF(EVENT_WEEK < ?, RESPONSES, 0)), 0) AS CHG
      FROM ${S}.HEALTH_WEEKLY WHERE EVENT_WEEK BETWEEN ? AND ?
      GROUP BY 1 HAVING SUM(IFF(EVENT_WEEK >= ?, RESPONSES, 0)) >= 10 ORDER BY CHG LIMIT 1`,
      [wFrom, wFrom, wFrom, wFrom, wFrom, wFrom, bFrom, wTo, wFrom]);
    code = String(worst[0]?.STORE_CODE ?? "S009");
  }
  const trendFrom = addWeeks(week, -20);
  const [info, trend, stateTrend, themes, supply, verbatims, risk] = await batch([
    { sql: `SELECT * FROM ${S}.STORES WHERE STORE_CODE = ?`, binds: [code] },
    { sql: `SELECT EVENT_WEEK::STRING AS WK, SUM(RESPONSES) AS R, SUM(PROMOTERS) AS P, SUM(DETRACTORS) AS D, SUM(OOS_MENTIONS) AS OOS,
                   SUM(NEGATIVE_ITEMS) AS NEG, SUM(CAMPAIGN_REPLIES) AS REPLIES
            FROM ${S}.HEALTH_WEEKLY WHERE STORE_CODE = ? AND EVENT_WEEK >= ? GROUP BY 1`, binds: [code, addWeeks(trendFrom, -3)] },
    { sql: `SELECT EVENT_WEEK::STRING AS WK, SUM(RESPONSES) AS R, SUM(PROMOTERS) AS P, SUM(DETRACTORS) AS D
            FROM ${S}.HEALTH_WEEKLY WHERE STATE = (SELECT STATE FROM ${S}.STORES WHERE STORE_CODE = ?) AND EVENT_WEEK >= ? GROUP BY 1`,
      binds: [code, addWeeks(trendFrom, -3)] },
    { sql: `SELECT THEME, COUNT_IF(EVENT_WEEK >= ? AND IS_NEGATIVE) AS NEG, COUNT_IF(EVENT_WEEK >= ? AND NPS_CLASS = 'DETRACTOR') AS DET,
                   COUNT_IF(EVENT_WEEK < ? AND IS_NEGATIVE) AS BASE_NEG
            FROM ${S}.CUSTOMER_VOICE WHERE STORE_CODE = ? AND EVENT_WEEK BETWEEN ? AND ? AND THEME <> 'No comment' GROUP BY 1`,
      binds: [wFrom, wFrom, wFrom, code, bFrom, wTo] },
    { sql: `SELECT BRAND_NAME, WEEK_START::STRING AS WK, STATUS, REASON, IS_RECOVERING FROM ${S}.STORE_SUPPLY_WEEKLY
            WHERE STORE_CODE = ? AND WEEK_START BETWEEN ? AND ? ORDER BY 1, 2`, binds: [code, addWeeks(week, -8), addWeeks(week, 7)] },
    // Distinct texts, the latest of each: campaign replies are templated, so the
    // same sentence recurs across members.
    { sql: `SELECT EVENT_DATE::STRING AS EVENT_DATE, SOURCE_LABEL, NPS_SCORE, THEME, SENTIMENT, BRAND_NAME, CATEGORY, VOICE_TEXT
            FROM ${S}.CUSTOMER_VOICE WHERE STORE_CODE = ? AND EVENT_WEEK BETWEEN ? AND ? AND VOICE_TEXT IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY VOICE_TEXT ORDER BY EVENT_DATE DESC) = 1
            ORDER BY IS_NEGATIVE DESC, IFF(THEME = 'Out of stock', 0, 1), NPS_SCORE NULLS FIRST, EVENT_DATE DESC LIMIT 12`,
      binds: [code, wFrom, wTo] },
    { sql: `SELECT WEEK_START::STRING AS WK, RISK_SCORE, RISK_BAND, DRIVERS FROM ${S}.STORE_RISK_FORECAST WHERE STORE_CODE = ? ORDER BY 1`, binds: [code] },
  ]);
  const st = info[0];
  if (!st) throw new CmpError(404, `No store ${code}.`);
  const own = toSeries(trend.map((r) => ({ ...r, SEG: "s" })), "SEG").get("s");
  const stateS = toSeries(stateTrend.map((r) => ({ ...r, SEG: "s" })), "SEG").get("s");
  const shownWeeks = w.complete.filter((wk) => wk >= trendFrom);
  const series = shownWeeks.map((wk) => {
    const c = own?.get(wk) ?? ZERO;
    return { week: wk, responses: c.r, oos: c.oos, negative: c.neg, replies: n(trend.find((t) => t.WK === wk)?.REPLIES),
      nps4: nps(sumWeeks(own, addWeeks(wk, -3), wk)), stateNps4: nps(sumWeeks(stateS, addWeeks(wk, -3), wk)) };
  });
  const cur = compare(own, week, 4), stateCur = compare(stateS, week, 4);

  // Supply: brands with any status other than OK in the range, week by week.
  const brands = [...new Set(supply.filter((s) => s.STATUS !== "OK").map((s) => String(s.BRAND_NAME)))];
  const supplyWeeks = [...new Set(supply.map((s) => String(s.WK)))].sort();
  const grid = brands.map((b) => ({ brand: b, reason: String(supply.find((s) => s.BRAND_NAME === b && s.REASON)?.REASON ?? ""),
    cells: supplyWeeks.map((wk) => { const c = supply.find((s) => s.BRAND_NAME === b && s.WK === wk); return { week: wk, status: String(c?.STATUS ?? "OK"), recovering: c?.IS_RECOVERING === true }; }) }));
  const shortNow = grid.filter((g) => g.cells.find((c) => c.week === week)?.status === "SHORT").map((g) => g.brand);
  const watch = grid.filter((g) => g.cells.some((c) => c.status === "SHORT" || c.status === "LOW")).map((g) => g.brand);
  const inbound = watch.length ? await q(`
    SELECT BRAND_NAME, WEEK_START::STRING AS WK, SUM(ORDERED_UNITS) AS ORDERED, SUM(DELIVERED_UNITS) AS DELIVERED,
           SUM(OPEN_FORECAST_UNITS) AS OPEN_FORECAST, SUM(OPEN_ORDERED_UNITS) AS OPEN_ORDERED, SUM(LINES) AS LINES
    FROM ${S}.DC_INBOUND_WEEKLY WHERE DC_STATE = ? AND ARRAY_CONTAINS(BRAND_NAME::VARIANT, PARSE_JSON(?)) AND WEEK_START BETWEEN ? AND ?
    GROUP BY 1, 2 ORDER BY 1, 2`, [st.DC_STATE, JSON.stringify(watch), addWeeks(week, -8), addWeeks(week, 7)]) : [];

  const themeRows = themes.map((t) => ({ theme: String(t.THEME), negative: n(t.NEG), detractors: n(t.DET), baselinePerWeek: r1(n(t.BASE_NEG) / 4), perWeek: r1(n(t.NEG) / 4) }))
    .filter((t) => t.negative + t.detractors > 0).sort((a, b) => b.negative - a.negative).slice(0, 8);
  return {
    asOf: w.asOf, week, weeks: w.complete, window: { from: wFrom, to: wTo }, baselineWindow: { from: bFrom, to: bTo },
    store: { code: st.STORE_CODE, name: st.STORE_NAME, suburb: st.SUBURB, state: st.STATE, city: st.CITY, storeType: st.STORE_TYPE, format: st.STORE_FORMAT, dc: st.DC_STATE },
    kpis: { ...cur, stateNps: stateCur.nps, stateChange: stateCur.change },
    series, themes: themeRows, supplyWeeks, supply: grid, shortNow,
    inbound: inbound.map((r) => ({ brand: r.BRAND_NAME, week: r.WK, ordered: n(r.ORDERED), delivered: n(r.DELIVERED), openForecast: n(r.OPEN_FORECAST), openOrdered: n(r.OPEN_ORDERED), lines: n(r.LINES) })),
    verbatims: verbatims.map((v) => ({ date: v.EVENT_DATE, source: v.SOURCE_LABEL, score: v.NPS_SCORE === null || v.NPS_SCORE === undefined ? null : n(v.NPS_SCORE), theme: v.THEME, sentiment: v.SENTIMENT, brand: v.BRAND_NAME, category: v.CATEGORY, text: v.VOICE_TEXT })),
    risk: risk.map((r) => ({ week: r.WK, score: n(r.RISK_SCORE), band: r.RISK_BAND, drivers: r.DRIVERS })),
  };
}

// ---------- Risk radar ----------
export async function getRisk() {
  const [info, metrics, importance, breaks, grid, alerts] = await batch([
    `SELECT TRAINED_AT::STRING AS TRAINED_AT, TRAINING_ROWS, BREAKS, FIRST_WEEK::STRING AS FIRST_WEEK, LAST_WEEK::STRING AS LAST_WEEK FROM ${S}.RISK_MODEL_INFO`,
    `SELECT METRIC, AVERAGE_TYPE, VALUE FROM ${S}.RISK_MODEL_METRICS`,
    `SELECT FEATURE, IMPORTANCE FROM ${S}.RISK_MODEL_FEATURE_IMPORTANCE ORDER BY RANK`,
    `SELECT MONTH::STRING AS MONTH, SUM(STORE_WEEKS) AS STORE_WEEKS, SUM(BREAKS) AS BREAKS, SUM(BREAKS_WITH_BRAND_SHORT) AS WITH_SHORT
     FROM ${S}.RISK_TRAINING_BREAKS GROUP BY 1 ORDER BY 1`,
    `SELECT STATE, WEEK_START::STRING AS WK, COUNT(*) AS STORES, COUNT_IF(RISK_BAND IN ('CRITICAL', 'HIGH')) AS HOT,
            COUNT_IF(RISK_BAND = 'CRITICAL') AS CRITICAL, MAX(RISK_SCORE) AS MAX_SCORE, MAX(SCORED_AT)::STRING AS SCORED_AT
     FROM ${S}.STORE_RISK_FORECAST GROUP BY 1, 2 ORDER BY 1, 2`,
    `SELECT STORE_CODE, ANY_VALUE(STORE_NAME) AS STORE_NAME, ANY_VALUE(STATE) AS STATE,
            MIN(IFF(RISK_BAND IN ('CRITICAL', 'HIGH'), WEEK_START, NULL))::STRING AS FIRST_WEEK,
            COUNT_IF(RISK_BAND IN ('CRITICAL', 'HIGH')) AS HOT_WEEKS,
            MAX(RISK_SCORE) AS MAX_SCORE, MAX_BY(RISK_BAND, RISK_SCORE) AS BAND, MAX_BY(DRIVERS, RISK_SCORE) AS DRIVERS,
            MAX_BY(ARRAY_TO_STRING(SHORT_BRAND_LIST, ', '), RISK_SCORE) AS SHORT_BRANDS, MAX(PROMOTING_CAMPAIGN) AS CAMPAIGN,
            BOOLOR_AGG(RECOVERING) AS RECOVERING, MIN(SHORT_BRAND_FILL_PCT) AS MIN_FILL, MAX(OOS_LAST_2W) AS OOS_2W
     FROM ${S}.STORE_RISK_FORECAST GROUP BY 1
     HAVING MAX(IFF(RISK_BAND IN ('CRITICAL', 'HIGH', 'ELEVATED'), 1, 0)) = 1
     ORDER BY MAX_SCORE DESC LIMIT 40`,
  ]);
  const metric = (name: string, avg: string) => { const m = metrics.find((x) => x.METRIC === name && x.AVERAGE_TYPE === avg); return m ? Math.round(n(m.VALUE) * 1000) / 1000 : null; };
  const weeksAhead = [...new Set(grid.map((g) => String(g.WK)))].sort();
  return {
    model: {
      name: "STORE_SENTIMENT_RISK_MODEL", trainedAt: info[0]?.TRAINED_AT ?? null, trainingRows: n(info[0]?.TRAINING_ROWS), breaks: n(info[0]?.BREAKS),
      firstWeek: info[0]?.FIRST_WEEK ?? null, lastWeek: info[0]?.LAST_WEEK ?? null,
      auc: metric("auc", "macro"), precision: metric("precision_true", "class"), recall: metric("recall_true", "class"),
      f1: metric("f1_true", "class"), support: metric("support_true", "class"),
    },
    importance: importance.map((r) => ({ feature: String(r.FEATURE), importance: Math.round(n(r.IMPORTANCE) * 1000) / 1000 })),
    training: breaks.map((b) => ({ month: b.MONTH, storeWeeks: n(b.STORE_WEEKS), breaks: n(b.BREAKS), withShort: n(b.WITH_SHORT) })),
    weeks: weeksAhead, scoredAt: grid[0]?.SCORED_AT ?? null,
    grid: STATES.map((s) => ({ state: s, cells: weeksAhead.map((wk) => {
      const g = grid.find((x) => x.STATE === s && x.WK === wk);
      return { week: wk, stores: n(g?.STORES), hot: n(g?.HOT), critical: n(g?.CRITICAL), maxScore: n(g?.MAX_SCORE) };
    }) })),
    alerts: alerts.map((a) => ({ code: a.STORE_CODE, name: a.STORE_NAME, state: a.STATE, firstWeek: a.FIRST_WEEK, hotWeeks: n(a.HOT_WEEKS),
      score: n(a.MAX_SCORE), band: a.BAND, drivers: a.DRIVERS, shortBrands: a.SHORT_BRANDS || null, campaign: a.CAMPAIGN ?? null,
      recovering: a.RECOVERING === true, minFill: a.MIN_FILL === null || a.MIN_FILL === undefined ? null : n(a.MIN_FILL), oos2w: n(a.OOS_2W) })),
  };
}

/** Re-score the weeks ahead with the trained model against the live supply
 *  position -- after a recovery plan is approved, this shows the risk it took
 *  away. Scoring only: the model is not retrained. */
export async function rescoreRisk() {
  const r = await q(`CALL ${S}.SCORE_STORE_RISK()`);
  return { ok: true, message: String(Object.values(r[0] ?? {})[0] ?? "") };
}
