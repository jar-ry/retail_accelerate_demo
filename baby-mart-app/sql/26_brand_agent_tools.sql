-- ============================================================
-- Category Manager — the brand investigator's procedure tools
--
-- BRAND_INVESTIGATOR_AGENT (agent/deploy_brand_agents.sql) answers "what drove
-- <brand>'s move?" with the campaign / planning agent pattern (an evidence pack,
-- then one test per candidate cause):
--
--   BRAND_EVIDENCE(BRAND, CLASS)                 the brand (or one of its classes)
--                                                against last year, the prior 28
--                                                days and its market
--   TEST_BRAND_HYPOTHESIS(BRAND, CLASS, DIM)     market, price_volume, week, state,
--                                                region, format, store, class, sku,
--                                                segment, promotion, competitor,
--                                                supply
--   CHECK_REPORTED_DEMAND(BRAND, CLASS)          do the reported demand views agree
--                                                with what the tills sold?
--
-- WHY THE THIRD TOOL EXISTS. ANALYTICS.V_STORE_DEMAND_WEEKLY (sql/07) is the
-- demand feed the supply pages read: POS plus any ACTIVE planner override in
-- ANALYTICS.DEMAND_OVERRIDE. A demand planner ramped Huggies Crawler Nappies up
-- x1.35-2.20 for FY2026 weeks 15-18 ahead of a supplier TV campaign; the tills
-- (FACT_TRANSACTION_LINES, and DT_SELLTHROUGH_WEEKLY built from them) never
-- moved. A brand investigator that only read the feed would explain a spike that
-- never sold; one that only read POS would never notice the feed says otherwise.
-- This tool reconciles the two and names the override: who, when, why, review date.
--
-- Read only. Every figure comes from POS (CURATED.FACT_TRANSACTION_LINES) unless
-- a key says otherwise. Margin is total margin / total revenue, never an average
-- of line margins. A brand move has no holdout, so a test asks whether the change
-- is CONCENTRATED in one group, UNIFORM across groups, or explained by the market;
-- thresholds are stated in every result. Money keys end _aud and rates _pct / _pts
-- so the app's number check (src/lib/ai/grounded.ts) can trace every figure.
-- Inputs are resolved against DIM_BRAND / DIM_PRODUCT and bound, never spliced.
--
-- Periods (POS ends 7 May 2026):
--   cy  the 28 days 10 Apr - 7 May 2026
--   ly  the same 28 days of 2025 (10 Apr - 7 May 2025)
--   pp  the 28 days before cy (13 Mar - 9 Apr 2026)
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.AI;

-- ---------- BRAND_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.BRAND_EVIDENCE(BRAND VARCHAR, CLASS VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Brand (or brand x class) evidence: last 28 days vs last year and the prior 28 days, share of its market, weekly POS trend, splits by state, region, format, class, SKU, segment and promotion, competitor price gap, DIFOT, stock, switching, and whether the reported demand views agree with POS.'
EXECUTE AS OWNER
AS
$$
const C = "BABY_MART_DEMO.CURATED", A = "BABY_MART_DEMO.ANALYTICS";
const WINDOWS = "(f.DATE_KEY BETWEEN 20260410 AND 20260507 OR f.DATE_KEY BETWEEN 20250410 AND 20250507 OR f.DATE_KEY BETWEEN 20260313 AND 20260409)";
const WCASE = "CASE WHEN f.DATE_KEY BETWEEN 20260410 AND 20260507 THEN 'cy' WHEN f.DATE_KEY BETWEEN 20250410 AND 20250507 THEN 'ly' ELSE 'pp' END";
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
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const chg = (a, b) => (b ? r1((a / b - 1) * 100) : null);
function resolve(brand, klass) {
  const B = rows(`SELECT b.BRAND_NAME, p.CATEGORY, p.CLASS FROM ${C}.DIM_BRAND b JOIN ${C}.DIM_PRODUCT p ON p.BRAND_KEY = b.BRAND_KEY GROUP BY 1, 2, 3`);
  const bk = String(brand || "").trim().toUpperCase();
  let hit = B.filter((r) => r.brand_name.toUpperCase() === bk);
  if (!hit.length && bk.length >= 3) hit = B.filter((r) => r.brand_name.toUpperCase().includes(bk));
  if (!hit.length) return { error: `No brand matches '${brand}'.`, valid_brands: [...new Set(B.map((r) => r.brand_name))].sort() };
  const name = hit[0].brand_name, mine = B.filter((r) => r.brand_name === name);
  const ck = String(klass || "").trim().toUpperCase().replace(/S$/, "");
  let cls = null;
  if (ck && !/^(ALL|ANY|NONE|\*)$/.test(ck)) {
    const c = mine.find((r) => r.class.toUpperCase().replace(/S$/, "") === ck) || mine.find((r) => r.class.toUpperCase().includes(ck));
    if (!c) return { error: `${name} has no class matching '${klass}'.`, valid_classes: mine.map((r) => r.class).sort() };
    cls = c.class;
  }
  const categories = [...new Set(mine.filter((r) => !cls || r.class === cls).map((r) => r.category))];
  return { brand: name, cls, categories, label: cls ? `${name} ${cls}` : name, market_label: cls ? `${cls}, all other brands` : `${categories.join(" + ")}, all other brands`, classes: mine.map((r) => r.class).sort() };
}
const DIMX = { total: "'total'", state: "s.STATE", region: "s.REGION", format: "s.STORE_FORMAT",
  store: "s.STORE_CODE || ' ' || s.STORE_NAME", class: "p.CLASS", sku: "p.PRODUCT_NAME",
  segment: "COALESCE(cs.SEGMENT_NAME, 'Guest (no loyalty ID)')", promotion: "IFF(f.PROMOTION_KEY > 0, 'On promotion', 'Full price')" };
// One split of the scope (or of its market: the same class or categories, every
// other brand) across the three periods.
function facts(sc, dim, market) {
  const join = dim === "segment" ? `LEFT JOIN ${C}.DIM_CUSTOMER c ON c.CUSTOMER_KEY = f.CUSTOMER_KEY LEFT JOIN ${C}.DIM_CUSTOMER_SEGMENT cs ON cs.SEGMENT_KEY = c.SEGMENT_KEY` : "";
  const scopeF = sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))";
  const out = {};
  const z = () => ({ rev: 0, u: 0, m: 0, d: 0, t: 0 });
  for (const r of rows(`SELECT ${WCASE} AS W, ${DIMX[dim]} AS V, SUM(f.NET_REVENUE) AS REV, SUM(f.QUANTITY) AS U, SUM(f.MARGIN_AMOUNT) AS M,
        SUM(f.DISCOUNT_AMOUNT) AS D, COUNT(DISTINCT f.TRANSACTION_ID) AS T
      FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY
      JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY JOIN ${C}.DIM_STORE s ON s.STORE_KEY = f.STORE_KEY ${join}
      WHERE b.BRAND_NAME ${market ? "<>" : "="} ? AND ${scopeF} AND ${WINDOWS} GROUP BY 1, 2`, [sc.brand, sc.cls || JSON.stringify(sc.categories)])) {
    const k = r.v === null ? "Unknown" : String(r.v);
    const o = (out[k] = out[k] || { value: k, cy: z(), ly: z(), pp: z() });
    o[r.w] = { rev: r.rev || 0, u: r.u || 0, m: r.m || 0, d: r.d || 0, t: r.t || 0 };
  }
  return Object.values(out);
}
function summ(o) {
  return { revenue_aud: Math.round(o.rev), units: Math.round(o.u), margin_pct: o.rev ? r1((o.m / o.rev) * 100) : null,
    asp_aud: o.u ? r2(o.rev / o.u) : null, discount_pct: o.rev + o.d ? r1((o.d / (o.rev + o.d)) * 100) : null, transactions: o.t };
}
function split(sc, dim, total, limit) {
  const g = facts(sc, dim, false), dTot = total.cy.rev - total.ly.rev;
  const out = g.map((x) => ({ [dim]: x.value, revenue_aud: Math.round(x.cy.rev), ly_revenue_aud: Math.round(x.ly.rev),
    change_aud: Math.round(x.cy.rev - x.ly.rev), yoy_pct: chg(x.cy.rev, x.ly.rev),
    share_of_change_pct: dTot ? r1(((x.cy.rev - x.ly.rev) / dTot) * 100) : null }))
    .filter((x) => x.revenue_aud > 0 || x.ly_revenue_aud > 0)
    .sort((a, b) => Math.abs(b.change_aud) - Math.abs(a.change_aud));
  return limit ? out.slice(0, limit) : out;
}

// DIFOT, weighted by orders. Class rows exist only in FY2026, so a class compares
// with its own prior 8 weeks and with the brand's other classes; the brand row
// (CLASS IS NULL) also has last year. DIFOT_PCT is used, not ORDERS_ON_TIME,
// which disagrees with it (it can exceed ORDERS_TOTAL).
function difotOf(sc) {
  const w = (cond) => `ROUND(SUM(IFF(${cond}, DIFOT_PCT * ORDERS_TOTAL, 0)) / NULLIF(SUM(IFF(${cond}, ORDERS_TOTAL, 0)), 0), 1)`;
  // The class is bound once, in q, so each condition can be used in a ratio's numerator and denominator.
  const me = "IFF(q.CLS = '', d.CLASS IS NULL, d.CLASS = q.CLS)";
  const r = rows(`WITH q AS (SELECT ? AS CLS) SELECT ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS CY,
      ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 7 AND 14`)} AS PRIOR,
      ${w(`${me} AND FISCAL_YEAR = 2025 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS LY,
      ${w(`d.CLASS IS NOT NULL AND d.CLASS <> q.CLS AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS SIB,
      ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18`)} AS LAST
    FROM ${A}.DT_SUPPLIER_DIFOT d CROSS JOIN q WHERE d.BRAND_NAME = ?`, [sc.cls || "", sc.brand])[0] || {};
  const wk = rows(`WITH q AS (SELECT ? AS CLS) SELECT FISCAL_WEEK, ROUND(SUM(DIFOT_PCT * ORDERS_TOTAL) / NULLIF(SUM(ORDERS_TOTAL), 0), 1) AS DIFOT_PCT
    FROM ${A}.DT_SUPPLIER_DIFOT d CROSS JOIN q WHERE d.BRAND_NAME = ? AND ${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 7 AND 18 GROUP BY 1 ORDER BY 1`,
    [sc.cls || "", sc.brand]);
  return { difot_wk15_18_pct: r.cy ?? null, difot_prior_8wk_pct: r.prior ?? null, difot_ly_wk15_18_pct: r.ly ?? null,
    sibling_classes_difot_wk15_18_pct: sc.cls ? r.sib ?? null : null, difot_wk18_pct: r.last ?? null,
    difot_change_vs_prior_pts: r.cy != null && r.prior != null ? Math.round((r.cy - r.prior) * 10) / 10 : null, weekly_difot: wk };
}
const sc = resolve(BRAND, CLASS);
if (sc.error) return JSON.stringify(Object.assign({ ok: false }, sc));
const tot = facts(sc, "total", false)[0];
if (!tot || !tot.cy.rev) return JSON.stringify({ ok: false, error: `${sc.label} has no POS sales in the 28 days to 7 May 2026.` });
const mk = facts(sc, "total", true)[0] || { cy: { rev: 0 }, ly: { rev: 0 }, pp: { rev: 0 } };
const S = { cy: summ(tot.cy), ly: summ(tot.ly), pp: summ(tot.pp) };
const shareCy = (tot.cy.rev / (tot.cy.rev + mk.cy.rev)) * 100, shareLy = (tot.ly.rev / (tot.ly.rev + mk.ly.rev)) * 100;

// Weekly POS for the 16 complete weeks to 3 May 2026, with the same weeks a year earlier (364 days back).
const scopeW = sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))";
const weekly = rows(`SELECT DATE_TRUNC('WEEK', IFF(d.CALENDAR_DATE >= '2026-01-12', d.CALENDAR_DATE, DATEADD(DAY, 364, d.CALENDAR_DATE))) AS WEEK_START,
    ROUND(SUM(IFF(d.CALENDAR_DATE >= '2026-01-12', f.QUANTITY, 0))) AS UNITS, ROUND(SUM(IFF(d.CALENDAR_DATE >= '2026-01-12', f.NET_REVENUE, 0))) AS REVENUE_AUD,
    ROUND(SUM(IFF(d.CALENDAR_DATE < '2026-01-12', f.QUANTITY, 0))) AS LY_UNITS, ROUND(SUM(IFF(d.CALENDAR_DATE < '2026-01-12', f.NET_REVENUE, 0))) AS LY_REVENUE_AUD
  FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_DATE d ON d.DATE_KEY = f.DATE_KEY
  JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE b.BRAND_NAME = ? AND ${scopeW} AND (d.CALENDAR_DATE BETWEEN '2026-01-12' AND '2026-05-03' OR d.CALENDAR_DATE BETWEEN '2025-01-13' AND '2025-05-04')
  GROUP BY 1 ORDER BY 1`, [sc.brand, sc.cls || JSON.stringify(sc.categories)])
  .map((w) => Object.assign(w, { yoy_pct: chg(w.revenue_aud, w.ly_revenue_aud) }));

// Competitor price gap (our price over theirs) and supply, for April-May each year (fiscal weeks 15-19).
const clsBind = sc.cls || "";
const comp = rows(`SELECT c.COMPETITOR_NAME AS COMPETITOR, ROUND(AVG(IFF(c.FISCAL_YEAR = 2026, c.AVG_PRICE_GAP_PCT, NULL)), 2) AS GAP_CY_PCT,
    ROUND(AVG(IFF(c.FISCAL_YEAR = 2025, c.AVG_PRICE_GAP_PCT, NULL)), 2) AS GAP_LY_PCT
  FROM ${A}.DT_COMPETITIVE_POSITION c JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = c.PRODUCT_KEY
  WHERE c.BRAND_NAME = ? AND (? = '' OR p.CLASS = ?) AND c.FISCAL_WEEK BETWEEN 15 AND 19 AND c.FISCAL_YEAR IN (2025, 2026)
  GROUP BY 1 ORDER BY 1`, [sc.brand, clsBind, clsBind]).map((c) => Object.assign(c, { gap_change_pts: c.gap_cy_pct === null || c.gap_ly_pct === null ? null : r2(c.gap_cy_pct - c.gap_ly_pct) }));
const difot = difotOf(sc);
const stock = rows(`SELECT ROUND(100 * AVG(IFF(b.BRAND_NAME = ?, IFF(i.STOCK_ON_HAND <= 0, 1, 0), NULL)), 1) AS OUT_OF_STOCK_PCT,
    ROUND(100 * AVG(IFF(b.BRAND_NAME <> ?, IFF(i.STOCK_ON_HAND <= 0, 1, 0), NULL)), 1) AS MARKET_OUT_OF_STOCK_PCT
  FROM ${C}.FACT_INVENTORY i JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE i.DATE_KEY BETWEEN 20260410 AND 20260507 AND (${sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))"})`,
  [sc.brand, sc.brand, sc.cls || JSON.stringify(sc.categories)])[0] || {};
const switching = rows(`SELECT IFF(TO_BRAND = ?, 'came from', 'left for') AS DIRECTION, IFF(TO_BRAND = ?, FROM_BRAND, TO_BRAND) AS OTHER_BRAND, SUM(SWITCH_COUNT) AS CUSTOMERS
  FROM ${A}.DT_BRAND_SWITCHING WHERE (TO_BRAND = ? OR FROM_BRAND = ?) AND (? = '' OR CLASS = ?) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`,
  [sc.brand, sc.brand, sc.brand, sc.brand, clsBind, clsBind]);

// Do the reported weekly demand views agree with POS for this scope? (detail: CheckReportedDemand)
const rep = rows(`SELECT ROUND(SUM(v.UNITS)) AS REPORTED_UNITS, ROUND(SUM(t.UNITS_SOLD)) AS POS_UNITS
  FROM (SELECT STORE_NAME, FISCAL_WEEK, SUM(UNITS) AS UNITS FROM ${A}.V_STORE_DEMAND_WEEKLY WHERE BRAND_NAME = ? AND (? = '' OR SKU_CLASS = ?) AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1, 2) v
  JOIN (SELECT STORE_NAME, FISCAL_WEEK, SUM(UNITS_SOLD) AS UNITS_SOLD FROM ${A}.DT_SELLTHROUGH_WEEKLY WHERE BRAND_NAME = ? AND (? = '' OR CLASS = ?) AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1, 2) t
    ON t.STORE_NAME = v.STORE_NAME AND t.FISCAL_WEEK = v.FISCAL_WEEK`, [sc.brand, clsBind, clsBind, sc.brand, clsBind, clsBind])[0] || {};
const repDiff = rep.pos_units ? r1((rep.reported_units / rep.pos_units - 1) * 100) : null;

return JSON.stringify({ ok: true, scope: sc.label, brand: sc.brand, class: sc.cls, categories: sc.categories, market: sc.market_label, currency: "AUD",
  periods: { cy: "28 days 10 Apr - 7 May 2026 (POS ends 7 May 2026)", ly: "same 28 days of 2025, 10 Apr - 7 May 2025", pp: "previous 28 days, 13 Mar - 9 Apr 2026" },
  summary: { cy: S.cy, ly: S.ly, pp: S.pp, yoy_pct: chg(tot.cy.rev, tot.ly.rev), vs_prior_28d_pct: chg(tot.cy.rev, tot.pp.rev),
    units_yoy_pct: chg(tot.cy.u, tot.ly.u), units_vs_prior_28d_pct: chg(tot.cy.u, tot.pp.u),
    change_vs_ly_aud: Math.round(tot.cy.rev - tot.ly.rev), change_vs_prior_aud: Math.round(tot.cy.rev - tot.pp.rev),
    margin_change_pts: S.cy.margin_pct !== null && S.ly.margin_pct !== null ? r1(S.cy.margin_pct - S.ly.margin_pct) : null },
  vs_market: { market_revenue_aud: Math.round(mk.cy.rev), market_yoy_pct: chg(mk.cy.rev, mk.ly.rev), market_vs_prior_28d_pct: chg(mk.cy.rev, mk.pp.rev),
    share_cy_pct: r1(shareCy), share_ly_pct: r1(shareLy), share_change_pts: r1(shareCy - shareLy) },
  weekly_pos: weekly,
  by_state: split(sc, "state", tot), by_region: split(sc, "region", tot), by_format: split(sc, "format", tot),
  by_class: sc.cls ? undefined : split(sc, "class", tot), top_sku_moves: split(sc, "sku", tot, 8),
  by_segment: split(sc, "segment", tot), by_promotion: split(sc, "promotion", tot),
  competitor_price_gap: { note: "Our average price over the competitor's, %, fiscal weeks 15-19 (Apr-May) each year. Positive = we are dearer.", rows: comp },
  supply: Object.assign(difot, { out_of_stock_pct: stock.out_of_stock_pct ?? null, market_out_of_stock_pct: stock.market_out_of_stock_pct ?? null,
    note: "DIFOT (supplier deliveries in full, on time) weighted by orders: FY2026 weeks 15-18 (6 Apr - 3 May 2026) against weeks 7-14 and, for a class, the brand's other classes. Out-of-stock = share of store x SKU days with no stock on hand, 10 Apr - 7 May 2026 (stock history starts 1 Apr 2026)." }),
  switching_all_time: switching,
  reported_demand: { reported_units_fy26_wk1_19: rep.reported_units ?? null, pos_units_fy26_wk1_19: rep.pos_units ?? null, reported_vs_pos_pct: repDiff,
    differs: repDiff !== null && Math.abs(repDiff) >= 1,
    note: "ANALYTICS.V_STORE_DEMAND_WEEKLY (read by the supply demand pages) against POS for the same stores and weeks. If it differs, call CheckReportedDemand before explaining any spike." },
  dimensions_you_can_test: ["market", "price_volume", "week", "state", "region", "format", "store", "class", "sku", "segment", "promotion", "competitor", "supply"] });
$$;

-- ---------- TEST_BRAND_HYPOTHESIS ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.TEST_BRAND_HYPOTHESIS(BRAND VARCHAR, CLASS VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Tests one candidate cause of a brand''s (or brand x class) year-on-year move: market, price_volume, week, or a split by state, region, format, store, class, sku, segment or promotion, or competitor price, or supply. Returns groups, a verdict (SUPPORTED, INCONCLUSIVE, NOT_SUPPORTED), a reading and the rule.'
EXECUTE AS OWNER
AS
$$
const C = "BABY_MART_DEMO.CURATED", A = "BABY_MART_DEMO.ANALYTICS";
// Thresholds, stated in every result.
const MATERIAL = 3, SHARE = 50, SPREAD = 10, MARKET_GAP = 3, DOMINANT = 70, STEP = 10, GAP_MOVE = 2, DIFOT_DROP = 5;
const WINDOWS = "(f.DATE_KEY BETWEEN 20260410 AND 20260507 OR f.DATE_KEY BETWEEN 20250410 AND 20250507 OR f.DATE_KEY BETWEEN 20260313 AND 20260409)";
const WCASE = "CASE WHEN f.DATE_KEY BETWEEN 20260410 AND 20260507 THEN 'cy' WHEN f.DATE_KEY BETWEEN 20250410 AND 20250507 THEN 'ly' ELSE 'pp' END";
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
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const chg = (a, b) => (b ? r1((a / b - 1) * 100) : null);
function resolve(brand, klass) {
  const B = rows(`SELECT b.BRAND_NAME, p.CATEGORY, p.CLASS FROM ${C}.DIM_BRAND b JOIN ${C}.DIM_PRODUCT p ON p.BRAND_KEY = b.BRAND_KEY GROUP BY 1, 2, 3`);
  const bk = String(brand || "").trim().toUpperCase();
  let hit = B.filter((r) => r.brand_name.toUpperCase() === bk);
  if (!hit.length && bk.length >= 3) hit = B.filter((r) => r.brand_name.toUpperCase().includes(bk));
  if (!hit.length) return { error: `No brand matches '${brand}'.`, valid_brands: [...new Set(B.map((r) => r.brand_name))].sort() };
  const name = hit[0].brand_name, mine = B.filter((r) => r.brand_name === name);
  const ck = String(klass || "").trim().toUpperCase().replace(/S$/, "");
  let cls = null;
  if (ck && !/^(ALL|ANY|NONE|\*)$/.test(ck)) {
    const c = mine.find((r) => r.class.toUpperCase().replace(/S$/, "") === ck) || mine.find((r) => r.class.toUpperCase().includes(ck));
    if (!c) return { error: `${name} has no class matching '${klass}'.`, valid_classes: mine.map((r) => r.class).sort() };
    cls = c.class;
  }
  const categories = [...new Set(mine.filter((r) => !cls || r.class === cls).map((r) => r.category))];
  return { brand: name, cls, categories, label: cls ? `${name} ${cls}` : name, market_label: cls ? `${cls}, all other brands` : `${categories.join(" + ")}, all other brands` };
}
const DIMX = { total: "'total'", state: "s.STATE", region: "s.REGION", format: "s.STORE_FORMAT",
  store: "s.STORE_CODE || ' ' || s.STORE_NAME", class: "p.CLASS", sku: "p.PRODUCT_NAME",
  segment: "COALESCE(cs.SEGMENT_NAME, 'Guest (no loyalty ID)')", promotion: "IFF(f.PROMOTION_KEY > 0, 'On promotion', 'Full price')" };
function facts(sc, dim, market) {
  const join = dim === "segment" ? `LEFT JOIN ${C}.DIM_CUSTOMER c ON c.CUSTOMER_KEY = f.CUSTOMER_KEY LEFT JOIN ${C}.DIM_CUSTOMER_SEGMENT cs ON cs.SEGMENT_KEY = c.SEGMENT_KEY` : "";
  const scopeF = sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))";
  const out = {};
  const z = () => ({ rev: 0, u: 0, m: 0, d: 0 });
  for (const r of rows(`SELECT ${WCASE} AS W, ${DIMX[dim]} AS V, SUM(f.NET_REVENUE) AS REV, SUM(f.QUANTITY) AS U, SUM(f.MARGIN_AMOUNT) AS M, SUM(f.DISCOUNT_AMOUNT) AS D
      FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY
      JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY JOIN ${C}.DIM_STORE s ON s.STORE_KEY = f.STORE_KEY ${join}
      WHERE b.BRAND_NAME ${market ? "<>" : "="} ? AND ${scopeF} AND ${WINDOWS} GROUP BY 1, 2`, [sc.brand, sc.cls || JSON.stringify(sc.categories)])) {
    const k = r.v === null ? "Unknown" : String(r.v);
    const o = (out[k] = out[k] || { value: k, cy: z(), ly: z(), pp: z() });
    o[r.w] = { rev: r.rev || 0, u: r.u || 0, m: r.m || 0, d: r.d || 0 };
  }
  return Object.values(out);
}

// DIFOT, weighted by orders. Class rows exist only in FY2026, so a class compares
// with its own prior 8 weeks and with the brand's other classes; the brand row
// (CLASS IS NULL) also has last year. DIFOT_PCT is used, not ORDERS_ON_TIME,
// which disagrees with it (it can exceed ORDERS_TOTAL).
function difotOf(sc) {
  const w = (cond) => `ROUND(SUM(IFF(${cond}, DIFOT_PCT * ORDERS_TOTAL, 0)) / NULLIF(SUM(IFF(${cond}, ORDERS_TOTAL, 0)), 0), 1)`;
  // The class is bound once, in q, so each condition can be used in a ratio's numerator and denominator.
  const me = "IFF(q.CLS = '', d.CLASS IS NULL, d.CLASS = q.CLS)";
  const r = rows(`WITH q AS (SELECT ? AS CLS) SELECT ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS CY,
      ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 7 AND 14`)} AS PRIOR,
      ${w(`${me} AND FISCAL_YEAR = 2025 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS LY,
      ${w(`d.CLASS IS NOT NULL AND d.CLASS <> q.CLS AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18`)} AS SIB,
      ${w(`${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18`)} AS LAST
    FROM ${A}.DT_SUPPLIER_DIFOT d CROSS JOIN q WHERE d.BRAND_NAME = ?`, [sc.cls || "", sc.brand])[0] || {};
  const wk = rows(`WITH q AS (SELECT ? AS CLS) SELECT FISCAL_WEEK, ROUND(SUM(DIFOT_PCT * ORDERS_TOTAL) / NULLIF(SUM(ORDERS_TOTAL), 0), 1) AS DIFOT_PCT
    FROM ${A}.DT_SUPPLIER_DIFOT d CROSS JOIN q WHERE d.BRAND_NAME = ? AND ${me} AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 7 AND 18 GROUP BY 1 ORDER BY 1`,
    [sc.cls || "", sc.brand]);
  return { difot_wk15_18_pct: r.cy ?? null, difot_prior_8wk_pct: r.prior ?? null, difot_ly_wk15_18_pct: r.ly ?? null,
    sibling_classes_difot_wk15_18_pct: sc.cls ? r.sib ?? null : null, difot_wk18_pct: r.last ?? null,
    difot_change_vs_prior_pts: r.cy != null && r.prior != null ? Math.round((r.cy - r.prior) * 10) / 10 : null, weekly_difot: wk };
}
const sc = resolve(BRAND, CLASS);
if (sc.error) return JSON.stringify(Object.assign({ ok: false }, sc));
const dim = String(DIMENSION || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const VALID = ["market", "price_volume", "week", "state", "region", "format", "store", "class", "sku", "segment", "promotion", "competitor", "supply"];
const alias = { price: "price_volume", volume: "price_volume", asp: "price_volume", category: "market", weekly: "week", timing: "week", trend: "week",
  product: "sku", skus: "sku", stores: "store", states: "state", promo: "promotion", promotions: "promotion", competitors: "competitor", pricing: "competitor",
  stock: "supply", difot: "supply", segments: "segment", customer: "segment" };
const D = alias[dim] || dim;
if (!VALID.includes(D)) return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'.`, valid: VALID });
const tot = facts(sc, "total", false)[0];
if (!tot || !tot.cy.rev) return JSON.stringify({ ok: false, error: `${sc.label} has no POS sales in the 28 days to 7 May 2026.` });
const yoy = chg(tot.cy.rev, tot.ly.rev), dTot = tot.cy.rev - tot.ly.rev;
const base = { ok: true, scope: sc.label, dimension: D, basis: "POS, 28 days to 7 May 2026 vs the same 28 days of 2025",
  revenue_aud: Math.round(tot.cy.rev), ly_revenue_aud: Math.round(tot.ly.rev), change_aud: Math.round(dTot), yoy_pct: yoy };
const done = (o) => JSON.stringify(Object.assign(base, o));
const dir = dTot >= 0 ? "growth" : "decline";

if (D === "market") {
  const mk = facts(sc, "total", true)[0] || { cy: { rev: 0 }, ly: { rev: 0 } };
  const myy = chg(mk.cy.rev, mk.ly.rev), gap = yoy !== null && myy !== null ? r1(yoy - myy) : null;
  const fromMarket = Math.round(tot.ly.rev * (myy || 0) / 100);
  const sCy = (tot.cy.rev / (tot.cy.rev + mk.cy.rev)) * 100, sLy = (tot.ly.rev / (tot.ly.rev + mk.ly.rev)) * 100;
  const verdict = gap === null ? "INCONCLUSIVE" : Math.abs(gap) < MARKET_GAP ? "SUPPORTED" : "NOT_SUPPORTED";
  const reading = verdict === "SUPPORTED"
    ? `MARKET: ${sc.label} moved ${yoy}% against ${myy}% for ${sc.market_label}, within ${MARKET_GAP} points, so the ${dir} is the market's, not the brand's. Share moved ${r1(sCy - sLy)} pts.`
    : verdict === "NOT_SUPPORTED"
      ? `BRAND-SPECIFIC: ${sc.label} moved ${yoy}% against ${myy}% for ${sc.market_label}, ${gap} points apart. AUD ${Math.round(dTot - fromMarket)} of the AUD ${Math.round(dTot)} change is the brand's own; share moved ${r1(sCy - sLy)} pts.`
      : "No market comparison is available.";
  return done({ market: sc.market_label, market_revenue_aud: Math.round(mk.cy.rev), market_yoy_pct: myy, gap_to_market_pts: gap,
    change_from_market_aud: fromMarket, brand_specific_change_aud: Math.round(dTot - fromMarket),
    share_cy_pct: r1(sCy), share_ly_pct: r1(sLy), share_change_pts: r1(sCy - sLy), verdict, reading,
    rule: `SUPPORTED (the market explains it) when the brand's YoY is within ${MARKET_GAP} points of its market's; NOT_SUPPORTED (brand-specific) otherwise. Market = ${sc.market_label}. Change from market = last year's revenue x the market's YoY.` });
}

if (D === "price_volume") {
  const aC = tot.cy.u ? tot.cy.rev / tot.cy.u : 0, aL = tot.ly.u ? tot.ly.rev / tot.ly.u : 0;
  const vol = (tot.cy.u - tot.ly.u) * aL, price = (aC - aL) * tot.cy.u;
  const vShare = dTot ? (vol / dTot) * 100 : null;
  const discC = tot.cy.rev + tot.cy.d ? (tot.cy.d / (tot.cy.rev + tot.cy.d)) * 100 : null, discL = tot.ly.rev + tot.ly.d ? (tot.ly.d / (tot.ly.rev + tot.ly.d)) * 100 : null;
  const verdict = Math.abs(yoy) < MATERIAL ? "NOT_SUPPORTED" : vShare !== null && (vShare >= DOMINANT || vShare <= 100 - DOMINANT) ? "SUPPORTED" : "INCONCLUSIVE";
  const reading = Math.abs(yoy) < MATERIAL ? `${sc.label} is within ${MATERIAL}% of last year, so there is no material move to split.`
    : vShare >= DOMINANT ? `VOLUME: ${r1(vShare)}% of the change is units (${chg(tot.cy.u, tot.ly.u)}% YoY) at last year's ASP; ASP moved ${chg(aC, aL)}%, so price is not the driver.`
      : vShare <= 100 - DOMINANT ? `PRICE: ${r1(100 - vShare)}% of the change is ASP (${chg(aC, aL)}% YoY, discount depth ${r1(discC)}% vs ${r1(discL)}%); units moved ${chg(tot.cy.u, tot.ly.u)}%.`
        : `MIXED: units (${chg(tot.cy.u, tot.ly.u)}%) and ASP (${chg(aC, aL)}%) both move it; neither is ${DOMINANT}% of the change.`;
  return done({ units: Math.round(tot.cy.u), ly_units: Math.round(tot.ly.u), units_yoy_pct: chg(tot.cy.u, tot.ly.u),
    asp_aud: r2(aC), ly_asp_aud: r2(aL), asp_yoy_pct: chg(aC, aL), volume_effect_aud: Math.round(vol), price_effect_aud: Math.round(price),
    volume_share_of_change_pct: r1(vShare), discount_pct: r1(discC), ly_discount_pct: r1(discL),
    margin_pct: tot.cy.rev ? r1((tot.cy.m / tot.cy.rev) * 100) : null, ly_margin_pct: tot.ly.rev ? r1((tot.ly.m / tot.ly.rev) * 100) : null, verdict, reading,
    rule: `Volume effect = unit change x last year's ASP; price effect = ASP change x this year's units. SUPPORTED when one effect is at least ${DOMINANT}% of the change; NOT_SUPPORTED when the move is under ${MATERIAL}%.` });
}

if (D === "week") {
  const scopeW = sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))";
  const W = rows(`SELECT DATE_TRUNC('WEEK', IFF(d.CALENDAR_DATE >= '2026-01-12', d.CALENDAR_DATE, DATEADD(DAY, 364, d.CALENDAR_DATE))) AS WEEK_START,
      SUM(IFF(d.CALENDAR_DATE >= '2026-01-12', f.NET_REVENUE, 0)) AS CY, SUM(IFF(d.CALENDAR_DATE < '2026-01-12', f.NET_REVENUE, 0)) AS LY,
      SUM(IFF(d.CALENDAR_DATE >= '2026-01-12', f.QUANTITY, 0)) AS CYU
    FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_DATE d ON d.DATE_KEY = f.DATE_KEY
    JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
    WHERE b.BRAND_NAME = ? AND ${scopeW} AND (d.CALENDAR_DATE BETWEEN '2026-01-12' AND '2026-05-03' OR d.CALENDAR_DATE BETWEEN '2025-01-13' AND '2025-05-04')
    GROUP BY 1 ORDER BY 1`, [sc.brand, sc.cls || JSON.stringify(sc.categories)]);
  const sum = (a, k) => a.reduce((s, w) => s + w[k], 0);
  const last4 = W.slice(-4), first12 = W.slice(0, -4);
  const y4 = chg(sum(last4, "cy"), sum(last4, "ly")), y12 = chg(sum(first12, "cy"), sum(first12, "ly"));
  const u4 = sum(last4, "cyu") / (last4.length || 1), u12 = sum(first12, "cyu") / (first12.length || 1);
  const step = y4 !== null && y12 !== null ? r1(y4 - y12) : null;
  const verdict = step === null ? "INCONCLUSIVE" : Math.abs(step) >= STEP ? "SUPPORTED" : "NOT_SUPPORTED";
  const reading = verdict === "SUPPORTED"
    ? `STEP CHANGE: the last 4 weeks run ${y4}% YoY against ${y12}% for the 12 weeks before, a ${step}-point break. Something changed around ${last4[0] ? last4[0].week_start : "then"}.`
    : `STEADY: the last 4 weeks run ${y4}% YoY against ${y12}% for the 12 weeks before (${step} pts). Weekly units averaged ${Math.round(u4)} against ${Math.round(u12)}: there is no spike or break in POS.`;
  return done({ weeks: W.map((w) => ({ week_start: w.week_start, revenue_aud: Math.round(w.cy), ly_revenue_aud: Math.round(w.ly), units: Math.round(w.cyu), yoy_pct: chg(w.cy, w.ly) })),
    last_4_weeks_yoy_pct: y4, prior_12_weeks_yoy_pct: y12, step_pts: step, last_4_weeks_avg_units: Math.round(u4), prior_12_weeks_avg_units: Math.round(u12), verdict, reading,
    rule: `16 complete weeks to 3 May 2026, each against the same week a year earlier (364 days back). SUPPORTED (a step change) when the last 4 weeks' YoY differs from the prior 12 weeks' by ${STEP}+ points.` });
}

if (D === "competitor") {
  const clsBind = sc.cls || "";
  const G = rows(`SELECT c.COMPETITOR_NAME AS COMPETITOR, ROUND(AVG(IFF(c.FISCAL_YEAR = 2026, c.AVG_PRICE_GAP_PCT, NULL)), 2) AS GAP_CY_PCT,
      ROUND(AVG(IFF(c.FISCAL_YEAR = 2025, c.AVG_PRICE_GAP_PCT, NULL)), 2) AS GAP_LY_PCT
    FROM ${A}.DT_COMPETITIVE_POSITION c JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = c.PRODUCT_KEY
    WHERE c.BRAND_NAME = ? AND (? = '' OR p.CLASS = ?) AND c.FISCAL_WEEK BETWEEN 15 AND 19 AND c.FISCAL_YEAR IN (2025, 2026) GROUP BY 1 ORDER BY 1`,
    [sc.brand, clsBind, clsBind]).filter((g) => g.gap_cy_pct !== null && g.gap_ly_pct !== null)
    .map((g) => Object.assign(g, { gap_change_pts: r2(g.gap_cy_pct - g.gap_ly_pct) }));
  if (!G.length) return done({ verdict: "INCONCLUSIVE", reading: `There is no competitor price data for ${sc.label} in both years.`, groups: [], rule: "Needs DT_COMPETITIVE_POSITION rows in both years." });
  const avg = r2(G.reduce((s, g) => s + g.gap_change_pts, 0) / G.length);
  const consistent = (dTot < 0 && avg >= GAP_MOVE) || (dTot > 0 && avg <= -GAP_MOVE);
  const verdict = Math.abs(avg) < GAP_MOVE / 2 ? "NOT_SUPPORTED" : consistent ? "SUPPORTED" : "INCONCLUSIVE";
  const reading = verdict === "NOT_SUPPORTED" ? `FLAT: our price gap to competitors moved ${avg} pts on average year on year, too little to explain a ${yoy}% move.`
    : consistent ? `PRICE POSITION: we moved ${avg} pts ${avg > 0 ? "dearer" : "cheaper"} against competitors, consistent with the ${dir}.`
      : `The gap moved ${avg} pts, but in the direction that would not cause a ${dir}.`;
  return done({ groups: G, avg_gap_change_pts: avg, verdict, reading,
    rule: `Gap = our price over the competitor's, %, fiscal weeks 15-19 each year. SUPPORTED when the average gap moved ${GAP_MOVE}+ pts in the direction that explains the move (dearer for a decline, cheaper for growth); NOT_SUPPORTED when it moved under ${GAP_MOVE / 2} pt.` });
}

if (D === "supply") {
  const df = difotOf(sc);
  const st = rows(`SELECT ROUND(100 * AVG(IFF(b.BRAND_NAME = ?, IFF(i.STOCK_ON_HAND <= 0, 1, 0), NULL)), 1) AS OOS,
      ROUND(100 * AVG(IFF(b.BRAND_NAME <> ?, IFF(i.STOCK_ON_HAND <= 0, 1, 0), NULL)), 1) AS MOOS
    FROM ${C}.FACT_INVENTORY i JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
    WHERE i.DATE_KEY BETWEEN 20260410 AND 20260507 AND (${sc.cls ? "p.CLASS = ?" : "p.CATEGORY IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))"})`,
    [sc.brand, sc.brand, sc.cls || JSON.stringify(sc.categories)])[0] || {};
  const drop = df.difot_change_vs_prior_pts;
  const oosGap = st.oos != null && st.moos != null ? r1(st.oos - st.moos) : null;
  const difotFell = drop !== null && drop <= -DIFOT_DROP;
  const shelvesHit = oosGap !== null && oosGap >= 3;
  const unitsYoy = chg(tot.cy.u, tot.ly.u);
  let verdict, reading;
  if (dTot < 0 && (difotFell || shelvesHit)) {
    verdict = "SUPPORTED"; reading = `SUPPLY: DIFOT fell ${Math.abs(drop)} pts to ${df.difot_wk15_18_pct}% in weeks 15-18 and the brand is out of stock on ${st.oos}% of store-SKU days against ${st.moos}% for the market, consistent with lost sales.`;
  } else if (difotFell) {
    verdict = "NOT_SUPPORTED"; reading = `SUPPLY RISK, NOT YET LOST SALES: DIFOT fell ${Math.abs(drop)} pts, from ${df.difot_prior_8wk_pct}% to ${df.difot_wk15_18_pct}% in weeks 15-18 (${df.difot_wk18_pct}% in week 18${df.sibling_classes_difot_wk15_18_pct !== null ? `; the brand's other classes ${df.sibling_classes_difot_wk15_18_pct}%` : ""}), but stores held stock (out of stock ${st.oos}% of store-SKU days vs ${st.moos}% for the market) and units are ${unitsYoy}% YoY. It does not explain the sales move; it is a risk to the next weeks.`;
  } else if (!shelvesHit && (drop === null || Math.abs(drop) < 3)) {
    verdict = "NOT_SUPPORTED"; reading = `RULED OUT: DIFOT ${df.difot_wk15_18_pct}% in weeks 15-18 against ${df.difot_prior_8wk_pct}% before, out of stock ${st.oos}% of store-SKU days vs ${st.moos}% for the market. Supply did not constrain sales.`;
  } else { verdict = "INCONCLUSIVE"; reading = `Supply moved (DIFOT ${drop} pts, stock gap ${oosGap} pts), but not in a way that explains a ${dir}.`; }
  return done(Object.assign(df, { out_of_stock_pct: st.oos ?? null, market_out_of_stock_pct: st.moos ?? null, out_of_stock_gap_pts: oosGap,
    units_yoy_pct: unitsYoy, supply_risk: difotFell, verdict, reading,
    rule: `SUPPORTED for a decline when DIFOT fell ${DIFOT_DROP}+ pts against the prior 8 weeks or the brand is out of stock 3+ pts more often than its market. A DIFOT fall with stores still in stock is a supply RISK (supply_risk true), not a cause of the sales move. Stock history starts 1 Apr 2026.` }));
}

// A split: is the change concentrated in one group?
const G = facts(sc, D, false).map((x) => ({ value: x.value, revenue_aud: Math.round(x.cy.rev), ly_revenue_aud: Math.round(x.ly.rev),
  change_aud: Math.round(x.cy.rev - x.ly.rev), yoy_pct: chg(x.cy.rev, x.ly.rev), share_of_change_pct: dTot ? r1(((x.cy.rev - x.ly.rev) / dTot) * 100) : null,
  revenue_mix_pct: r1((x.cy.rev / tot.cy.rev) * 100), ly_revenue_mix_pct: tot.ly.rev ? r1((x.ly.rev / tot.ly.rev) * 100) : null }))
  .filter((x) => x.revenue_aud > 0 || x.ly_revenue_aud > 0)
  .sort((a, b) => (b.share_of_change_pct || 0) - (a.share_of_change_pct || 0));
const top = G[0];
const restCy = tot.cy.rev - top.revenue_aud, restLy = tot.ly.rev - top.ly_revenue_aud, restYoy = chg(restCy, restLy);
// The spread counts only groups big enough to matter (5%+ of last year's revenue), so one tiny SKU at +300% is not a "spread".
const sized = G.filter((g) => g.ly_revenue_aud >= tot.ly.rev * 0.05 && g.yoy_pct !== null).map((g) => g.yoy_pct);
const spread = sized.length > 1 ? r1(Math.max.apply(null, sized) - Math.min.apply(null, sized)) : 0;
const apart = top.yoy_pct !== null && restYoy !== null ? r1(top.yoy_pct - restYoy) : null;
let verdict, reading;
if (Math.abs(yoy) < MATERIAL) { verdict = "NOT_SUPPORTED"; reading = `${sc.label} is within ${MATERIAL}% of last year (${yoy}%), so there is no material move to explain by ${D}.`; }
else if (top.share_of_change_pct >= SHARE && apart !== null && Math.abs(apart) >= SPREAD) {
  verdict = "SUPPORTED"; reading = `CONCENTRATED: ${top.value} carries ${top.share_of_change_pct}% of the ${dir} and moved ${top.yoy_pct}% against ${restYoy}% for the rest.`; }
else if (top.share_of_change_pct >= SHARE) {
  verdict = "INCONCLUSIVE"; reading = `CONTRIBUTOR: ${top.value} carries ${top.share_of_change_pct}% of the ${dir} because it is ${top.revenue_mix_pct}% of sales, but it moved ${top.yoy_pct}% against ${restYoy}% for the rest (${apart} pts apart), so it is not moving differently.`; }
else if (sized.length < 2) {
  verdict = "NOT_SUPPORTED"; reading = `FRAGMENTED: no ${D} has 5% of sales and the largest contributor, ${top.value}, carries only ${top.share_of_change_pct}% of the ${dir}, so the ${dir} is spread thinly across ${G.length} ${D}s rather than driven by any one.`; }
else if (spread <= SPREAD) {
  verdict = "NOT_SUPPORTED"; reading = `UNIFORM: every ${D} with 5%+ of sales moved within ${spread} points of each other, so the ${dir} is not specific to any one ${D}.`; }
else { verdict = "INCONCLUSIVE"; reading = `MIXED: ${top.value} is the largest contributor (${top.share_of_change_pct}% of the ${dir}, ${top.yoy_pct}% YoY), but rates spread ${spread} points without one ${D} dominating.`; }
const extra = {};
if (D === "promotion") {
  const p = G.find((g) => g.value === "On promotion") || { revenue_mix_pct: 0, ly_revenue_mix_pct: 0 };
  extra.promo_revenue_mix_pct = p.revenue_mix_pct; extra.ly_promo_revenue_mix_pct = p.ly_revenue_mix_pct;
  extra.promo_mix_change_pts = p.ly_revenue_mix_pct === null ? null : r1(p.revenue_mix_pct - p.ly_revenue_mix_pct);
}
return done(Object.assign({ groups: G.slice(0, D === "store" || D === "sku" ? 12 : 20), groups_total: G.length, top: top.value,
  rest_yoy_pct: restYoy, top_vs_rest_pts: apart, spread_pts: spread, verdict, reading,
  rule: `SUPPORTED when one ${D} carries ${SHARE}%+ of the change and its YoY differs from the rest by ${SPREAD}+ points; NOT_SUPPORTED when every ${D} with 5%+ of sales is within ${SPREAD} points (uniform) or the move is under ${MATERIAL}%.` }, extra));
$$;

-- ---------- CHECK_REPORTED_DEMAND ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.CHECK_REPORTED_DEMAND(BRAND VARCHAR, CLASS VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Reconciles the reported demand feed (V_STORE_DEMAND_WEEKLY / V_DEMAND_ROLLUP, read by the supply pages, and FORECAST_DEMAND_DAILY) against POS for a brand or brand x class, week by week and store by store, and names any planner override (DEMAND_OVERRIDE) behind a difference.'
EXECUTE AS OWNER
AS
$$
const C = "BABY_MART_DEMO.CURATED", A = "BABY_MART_DEMO.ANALYTICS";
const OVER = 10, FLAT = 15, UNIFORM = 0.02;
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
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const B = rows(`SELECT b.BRAND_NAME, p.CLASS FROM ${C}.DIM_BRAND b JOIN ${C}.DIM_PRODUCT p ON p.BRAND_KEY = b.BRAND_KEY GROUP BY 1, 2`);
const bk = String(BRAND || "").trim().toUpperCase();
let hit = B.filter((r) => r.brand_name.toUpperCase() === bk);
if (!hit.length && bk.length >= 3) hit = B.filter((r) => r.brand_name.toUpperCase().includes(bk));
if (!hit.length) return JSON.stringify({ ok: false, error: `No brand matches '${BRAND}'.`, valid_brands: [...new Set(B.map((r) => r.brand_name))].sort() });
const brand = hit[0].brand_name, mine = B.filter((r) => r.brand_name === brand);
const ck = String(CLASS || "").trim().toUpperCase().replace(/S$/, "");
let cls = "";
if (ck && !/^(ALL|ANY|NONE|\*)$/.test(ck)) {
  const c = mine.find((r) => r.class.toUpperCase().replace(/S$/, "") === ck) || mine.find((r) => r.class.toUpperCase().includes(ck));
  if (!c) return JSON.stringify({ ok: false, error: `${brand} has no class matching '${CLASS}'.`, valid_classes: mine.map((r) => r.class).sort() });
  cls = c.class;
}
const label = cls ? `${brand} ${cls}` : brand;

// Store x week, FY2026 weeks 1-19 (29 Dec 2025 - 10 May 2026; POS ends 7 May).
const SW = rows(`SELECT t.FISCAL_WEEK AS WEEK, t.STORE_NAME, t.U AS POS_UNITS, t.R AS POS_REVENUE, v.U AS REP_UNITS, v.R AS REP_REVENUE
  FROM (SELECT FISCAL_WEEK, STORE_NAME, SUM(UNITS_SOLD) AS U, SUM(REVENUE) AS R FROM ${A}.DT_SELLTHROUGH_WEEKLY
        WHERE BRAND_NAME = ? AND (? = '' OR CLASS = ?) AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1, 2) t
  LEFT JOIN (SELECT FISCAL_WEEK, STORE_NAME, SUM(UNITS) AS U, SUM(REVENUE) AS R FROM ${A}.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = ? AND (? = '' OR SKU_CLASS = ?) AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1, 2) v
    ON v.FISCAL_WEEK = t.FISCAL_WEEK AND v.STORE_NAME = t.STORE_NAME`, [brand, cls, cls, brand, cls, cls]);
const starts = {};
for (const d of rows(`SELECT FISCAL_WEEK, MIN(CALENDAR_DATE) AS S FROM ${C}.DIM_DATE WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 AND CALENDAR_DATE >= '2025-12-29' GROUP BY 1`)) starts[d.fiscal_week] = d.s;
const wk = {};
for (const r of SW) {
  const w = (wk[r.week] = wk[r.week] || { pos_units: 0, pos_revenue_aud: 0, reported_units: 0, reported_revenue_aud: 0, ratios: [] });
  w.pos_units += r.pos_units || 0; w.pos_revenue_aud += r.pos_revenue || 0; w.reported_units += r.rep_units || 0; w.reported_revenue_aud += r.rep_revenue || 0;
  if (r.pos_units > 0 && r.rep_units !== null) w.ratios.push(r.rep_units / r.pos_units);
}
const weeks = Object.keys(wk).map(Number).sort((a, b) => a - b).map((n) => {
  const w = wk[n], rs = w.ratios;
  return { fiscal_week: n, week_start: starts[n] || null, pos_units: Math.round(w.pos_units), reported_units: Math.round(w.reported_units),
    reported_vs_pos_pct: w.pos_units ? r1((w.reported_units / w.pos_units - 1) * 100) : null,
    store_multiplier_min: rs.length ? r2(Math.min.apply(null, rs)) : null, store_multiplier_max: rs.length ? r2(Math.max.apply(null, rs)) : null,
    stores: rs.length, pos_revenue_aud: Math.round(w.pos_revenue_aud), reported_revenue_aud: Math.round(w.reported_revenue_aud),
    reported_revenue_equals_units: Math.abs(w.reported_revenue_aud - w.reported_units) < 1 && w.pos_revenue_aud > w.pos_units * 1.5 };
});
const inflated = weeks.filter((w) => w.reported_vs_pos_pct !== null && w.reported_vs_pos_pct >= OVER);
const clean = weeks.filter((w) => w.reported_vs_pos_pct !== null && Math.abs(w.reported_vs_pos_pct) < 1);
const firstInfl = inflated.length ? inflated[0].fiscal_week : null;
const base = weeks.filter((w) => firstInfl !== null && w.fiscal_week < firstInfl).slice(-8);
const baseU = base.length ? base.reduce((s, w) => s + w.pos_units, 0) / base.length : null;
const inflU = inflated.length ? inflated.reduce((s, w) => s + w.pos_units, 0) / inflated.length : null;
const inflR = inflated.length ? inflated.reduce((s, w) => s + w.reported_units, 0) / inflated.length : null;
const posMove = baseU && inflU !== null ? r1((inflU / baseU - 1) * 100) : null;
const repMove = baseU && inflR !== null ? r1((inflR / baseU - 1) * 100) : null;
const uniform = inflated.length > 0 && inflated.every((w) => w.store_multiplier_max - w.store_multiplier_min <= UNIFORM);
const revAsUnits = weeks.filter((w) => w.reported_revenue_equals_units).length;

// The planner overrides the feed applies for this brand and class (sql/07 DEMAND_OVERRIDE).
let overrides = [], overrideError = null;
try {
  overrides = rows(`SELECT OVERRIDE_ID, CLASS, FISCAL_YEAR, FISCAL_WEEK, FACTOR, REASON, ENTERED_BY,
      TO_CHAR(ENTERED_AT, 'YYYY-MM-DD') AS ENTERED_ON, TO_CHAR(REVIEW_BY, 'YYYY-MM-DD') AS REVIEW_BY, STATUS
    FROM ${A}.DEMAND_OVERRIDE WHERE BRAND_NAME = ? AND (? = '' OR CLASS = ?) ORDER BY FISCAL_YEAR, FISCAL_WEEK`, [brand, cls, cls])
    .map((o) => ({ override_id: o.override_id, class: o.class, fiscal_year: o.fiscal_year, fiscal_week: o.fiscal_week, factor: o.factor,
      reason: o.reason, entered_by: o.entered_by, entered_on: o.entered_on, review_by: o.review_by, status: o.status }));
} catch (e) { overrideError = String(e.message || e).slice(0, 200); }
const active = overrides.filter((o) => o.status === "ACTIVE");
const overdue = active.filter((o) => o.review_by && o.review_by < "2026-05-07");

// The daily forecast table's "actuals" against POS, and any forecast uplift after POS ends.
let forecast = null;
try {
  const f = rows(`SELECT SUM(IFF(FORECAST_DATE BETWEEN '2026-03-02' AND '2026-05-03', ACTUAL_UNITS, 0)) AS ACT,
      SUM(IFF(FORECAST_DATE BETWEEN '2026-04-06' AND '2026-05-10' AND CHANNEL = 'Online', FORECAST_UNITS, 0)) / 5 AS ONL_BEFORE,
      SUM(IFF(FORECAST_DATE BETWEEN '2026-05-18' AND '2026-06-14' AND CHANNEL = 'Online', FORECAST_UNITS, 0)) / 4 AS ONL_AFTER, COUNT(*) AS N
    FROM ${A}.FORECAST_DEMAND_DAILY WHERE BRAND_NAME = ? AND (? = '' OR SKU_CLASS = ?)`, [brand, cls, cls])[0];
  if (f && f.n > 0) {
    const pos = rows(`SELECT SUM(f.QUANTITY) AS U FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY
      JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY WHERE b.BRAND_NAME = ? AND (? = '' OR p.CLASS = ?) AND f.DATE_KEY BETWEEN 20260302 AND 20260503`, [brand, cls, cls])[0].u || 0;
    forecast = { table: "ANALYTICS.FORECAST_DEMAND_DAILY", actual_units_2_mar_3_may: Math.round(f.act), pos_units_2_mar_3_may: Math.round(pos),
      actual_vs_pos_pct: pos ? r1((f.act / pos - 1) * 100) : null,
      online_forecast_units_per_week_before: Math.round(f.onl_before), online_forecast_units_per_week_18_may_14_jun: Math.round(f.onl_after),
      online_forecast_uplift_pct: f.onl_before ? r1((f.onl_after / f.onl_before - 1) * 100) : null,
      note: "This table's ACTUAL_UNITS are the forecasting system's own demand history, not POS, and are not reconciled to the tills. Any uplift after 7 May 2026 is a forecast that no POS can confirm yet." };
  }
} catch (e) { forecast = { error: String(e.message || e).slice(0, 200) }; }

let verdict, reading;
if (!weeks.length) { verdict = "INCONCLUSIVE"; reading = `${label} has no weekly sell-through to reconcile.`; }
else if (inflated.length && posMove !== null && Math.abs(posMove) < FLAT) {
  verdict = "REPORTING_ARTEFACT";
  reading = `The reported spike is not in sales. The demand feed the supply pages read (V_STORE_DEMAND_WEEKLY) shows ${label} ${repMove}% above its prior 8-week average in FY2026 weeks ${inflated.map((w) => w.fiscal_week).join(", ")}, but POS for those weeks is ${posMove}% (${Math.round(inflU)} vs ${Math.round(baseU)} units a week).` +
    (uniform ? ` Every store carries the same factor each week, which demand does not do.` : "") +
    (active.length ? ` It is a manual override: ${active.length} weekly factors (${active.map((o) => `week ${o.fiscal_week} x${o.factor}`).join(", ")}) entered by ${active[0].entered_by} on ${active[0].entered_on} ("${active[0].reason}"), due for review on ${active[0].review_by}${overdue.length ? " and still active" : ""}.` : "");
} else if (inflated.length) {
  verdict = "DIFFERS"; reading = `The reported view runs ${OVER}%+ above POS in weeks ${inflated.map((w) => w.fiscal_week).join(", ")}, and POS also moved ${posMove}%, so part of the reported move is real.`;
} else { verdict = "MATCHES_POS"; reading = `The reported weekly units for ${label} match POS in ${clean.length} of ${weeks.length} weeks (within 1%).` +
  (revAsUnits ? ` Its reported REVENUE does not: in ${revAsUnits} weeks the view's revenue column holds units, so use POS revenue.` : " The reported figures can be trusted for this scope."); }

return JSON.stringify({ ok: true, scope: label, brand, class: cls || null,
  views: "ANALYTICS.V_STORE_DEMAND_WEEKLY and ANALYTICS.V_DEMAND_ROLLUP (built on it) feed the supply pages' demand, store demand, store forecast and overtrading views. POS = ANALYTICS.DT_SELLTHROUGH_WEEKLY, built from CURATED.FACT_TRANSACTION_LINES.",
  weeks, inflated_weeks: inflated.map((w) => w.fiscal_week), weeks_matching_pos: clean.length, weeks_compared: weeks.length,
  pos_units_per_week_before: baseU === null ? null : Math.round(baseU), pos_units_per_week_in_inflated_weeks: inflU === null ? null : Math.round(inflU),
  reported_units_per_week_in_inflated_weeks: inflR === null ? null : Math.round(inflR),
  pos_move_pct: posMove, reported_move_pct: repMove, multiplier_uniform_across_stores: uniform,
  overrides, active_overrides: active.length, overrides_past_review: overdue.length, override_error: overrideError,
  reported_revenue_is_units_weeks: revAsUnits,
  revenue_note: revAsUnits ? `In ${revAsUnits} weeks the feed's REVENUE equals its UNITS, so use POS revenue.` : null,
  daily_forecast: forecast, verdict, reading,
  rule: `REPORTING_ARTEFACT when the view runs ${OVER}%+ above POS in some weeks while POS in those weeks is within ${FLAT}% of its prior 8-week average; MATCHES_POS when every week is within 1%. A store factor spread of ${UNIFORM} or less in every inflated week means the same factor was applied to every store; overrides lists the planner adjustments the feed applies.` });
$$;
