-- ============================================================
-- Supply Chain — supplier DIFOT investigator: data and tools
--
-- "Why is Kimberly-Clark missing DIFOT on Huggies Crawler Nappies?" A supply
-- planner's real question is not only *what* fell but *whose* problem it is: a
-- supplier failing to ship normal orders, or Baby Mart ordering what a supplier
-- could never ship. The tools answer both from the PO lines
-- (FORECAST_REPLENISHMENT_SUPPLIER_DC) and the weekly scorecard (DT_SUPPLIER_DIFOT).
--
-- 1. SETTING. DIFOT_TARGET_PCT (96) in SUPPLY_SETTING: the rate a supplier is held to.
--
-- 2. THE KIMBERLY-CLARK STORY. The scorecard has Huggies Crawler Nappies DIFOT
--    falling 84 -> 72 -> 61 -> 54% in FY2026 weeks 15-18, while every PO line for
--    those weeks delivered in full: the two sources disagreed. Those are the weeks
--    of the planner override in DEMAND_OVERRIDE (sql/07), so the PO lines now say
--    what happened: orders placed after the override was entered were sized on the
--    inflated feed, and Kimberly-Clark cut the largest ones in each delivery week to
--    the un-inflated quantity (ordered / factor). The share cut per week follows the
--    scorecard. Rascal & Co's NSW short-ships (sql/28) are the opposite case:
--    normal orders the supplier did not fill.
--
-- 3. TOOLS (AI schema, read only, JSON):
--    DIFOT_ANALYSIS(SUPPLIER, BRAND, CLASS, DIMENSION)  the engine
--    DIFOT_EVIDENCE(SUPPLIER, BRAND, CLASS)             the evidence pack ('' dimension)
--    TEST_DIFOT_HYPOTHESIS(SUPPLIER, BRAND, CLASS, DIM) one test: component, timing,
--      dc, class, brand, supplier_wide, override, rush, lead_time, overtrading,
--      stock, attribution
--    SUPPLIER may be a supplier, a brand, or ALL (every supplier ranked).
--
-- Rates come from the delivery flags (IS_ON_TIME / IS_IN_FULL / IS_DIFOT), as the
-- supply pages show them. Fill rates come only from lines whose units fell short:
-- sql/08 rewrote the in-full flags for realism without touching units, so a flag
-- alone is not evidence of how much was short. Lines: delivered, expected 17 Feb -
-- 5 Apr 2026 ("before", FY2026 wks 8-14) against 6 Apr - the supply clock ("recent").
-- Attribution: a missed line is Baby Mart's when it was sized on a planner override,
-- or was a rush order that arrived late; every other miss is the supplier's.
--
-- Idempotent. Run AFTER sql/07, 08, 28 and 46.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. DIFOT target ----------
MERGE INTO BABY_MART_DEMO.ANALYTICS.SUPPLY_SETTING t
USING (SELECT 'DIFOT_TARGET_PCT' AS SETTING_KEY, '96' AS SETTING_VALUE, 'NUMBER' AS VALUE_TYPE,
              'DIFOT target (%)' AS LABEL,
              'The delivered-in-full-on-time rate a supplier is held to on the scorecard.' AS DESCRIPTION) s
ON t.SETTING_KEY = s.SETTING_KEY
WHEN NOT MATCHED THEN INSERT VALUES (s.SETTING_KEY, s.SETTING_VALUE, s.VALUE_TYPE, s.LABEL, s.DESCRIPTION);

-- ---------- 2. Kimberly-Clark cut the override-sized Huggies Crawler orders ----------
UPDATE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC t
SET DELIVERED_UNITS = c.CAPPED, IS_IN_FULL = FALSE, IS_DIFOT = FALSE, HAS_DISCREPANCY = TRUE,
    DISCREPANCY_TYPE = 'SHORT_SHIPPED', DISCREPANCY_UNITS = t.ORDERED_UNITS - c.CAPPED
FROM (
  SELECT p.PO_NUMBER, ROUND(p.ORDERED_UNITS / o.FACTOR) AS CAPPED, s.DIFOT_PCT,
         ROW_NUMBER() OVER (PARTITION BY d.FISCAL_WEEK ORDER BY p.ORDERED_UNITS DESC, p.PO_NUMBER) AS RN,
         COUNT(*) OVER (PARTITION BY d.FISCAL_WEEK) AS N
  FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC p
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.CALENDAR_DATE = p.EXPECTED_DELIVERY_DATE
  JOIN BABY_MART_DEMO.ANALYTICS.DEMAND_OVERRIDE o
    ON o.BRAND_NAME = p.BRAND_NAME AND o.CLASS = p.SKU_CLASS AND o.FISCAL_YEAR = d.FISCAL_YEAR AND o.FISCAL_WEEK = d.FISCAL_WEEK
  JOIN BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT s
    ON s.BRAND_NAME = p.BRAND_NAME AND s.CLASS = p.SKU_CLASS AND s.FISCAL_YEAR = d.FISCAL_YEAR AND s.FISCAL_WEEK = d.FISCAL_WEEK
  WHERE p.STATUS = 'DELIVERED' AND p.ORDER_DATE >= TO_DATE(o.ENTERED_AT)
) c
WHERE t.PO_NUMBER = c.PO_NUMBER AND c.RN <= ROUND(c.N * (1 - c.DIFOT_PCT / 100));

-- ---------- 3. DIFOT_ANALYSIS ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.DIFOT_ANALYSIS(SUPPLIER VARCHAR, BRAND VARCHAR, CLASS VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Supplier DIFOT engine: the evidence pack for a supplier, brand or class (or every supplier) when DIMENSION is empty, else one hypothesis test. Read only.'
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
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (n, d) => (d ? r1((100 * n) / d) : null);
const BEFORE_FROM = "2026-02-17", SPLIT = "2026-04-06";
const asOf = rows(`SELECT ${A}.SUPPLY_AS_OF() AS D`)[0].d;
const target = Number((rows(`SELECT SETTING_VALUE AS V FROM ${A}.SUPPLY_SETTING WHERE SETTING_KEY = 'DIFOT_TARGET_PCT'`)[0] || {}).v || 96);
const DISTS = rows(`SELECT SUPPLIER_NAME, BRANDS, STD_LEAD_TIME_DAYS, SOURCING_TYPE, IS_3PL_VIABLE, ESTIMATED_3PL_DAYS, TRANSPORT_MODE, PRIMARY_CARRIER
  FROM ${C}.DIM_DISTRIBUTOR ORDER BY SUPPLIER_NAME`).map((d) => Object.assign(d, { brand_list: String(d.brands || "").split(",").map((s) => s.trim()).filter(Boolean) }));
const isAll = (x) => !x || /^(ALL|ANY|\*|EVERY|NONE)$/i.test(x);

// ---------- scope ----------
function resolve() {
  const s = String(SUPPLIER || "").trim(), b = String(BRAND || "").trim(), k = String(CLASS || "").trim();
  const findDist = (x) => DISTS.find((d) => d.supplier_name.toUpperCase() === x.toUpperCase())
    || (x.length >= 3 ? DISTS.find((d) => d.supplier_name.toUpperCase().includes(x.toUpperCase()) || x.toUpperCase().includes(d.supplier_name.toUpperCase().split(" ")[0])) : null);
  const findBrand = (x) => {
    for (const d of DISTS) {
      const m = d.brand_list.find((n) => n.toUpperCase() === x.toUpperCase()) || (x.length >= 3 ? d.brand_list.find((n) => n.toUpperCase().includes(x.toUpperCase())) : null);
      if (m) return { d, m };
    }
    return null;
  };
  let dist = null, brand = null;
  if (!isAll(b)) {
    const f = findBrand(b);
    if (!f) return { error: `No brand matches '${b}'.`, valid_brands: [].concat(...DISTS.map((d) => d.brand_list)).sort() };
    brand = f.m; dist = f.d;
  }
  if (!isAll(s)) {
    const f = findBrand(s), d = f ? null : findDist(s);
    if (f) { if (dist && f.d !== dist) return { error: `${brand} is supplied by ${dist.supplier_name}.` }; dist = f.d; brand = brand || f.m; }
    else if (d) { if (dist && d !== dist) return { error: `${brand} is supplied by ${dist.supplier_name}, not ${d.supplier_name}.` }; dist = d; }
    else return { error: `No supplier or brand matches '${s}'.`, valid_suppliers: DISTS.map((x) => x.supplier_name) };
  }
  let cls = null;
  if (!isAll(k)) {
    if (!dist) return { error: "Name a supplier or brand as well as a class." };
    const classes = rows(`SELECT DISTINCT SKU_CLASS FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC WHERE SUPPLIER_NAME = ? AND (? = '' OR BRAND_NAME = ?) ORDER BY 1`,
      [dist.supplier_name, brand || "", brand || ""]).map((r) => r.sku_class);
    const ck = k.toUpperCase().replace(/S$/, "");
    cls = classes.find((c) => c.toUpperCase().replace(/S$/, "") === ck) || classes.find((c) => c.toUpperCase().includes(ck)) || null;
    if (!cls) return { error: `No class matching '${k}' on ${brand || dist.supplier_name}'s orders.`, valid_classes: classes };
  }
  return { dist, brand, cls };
}
const sc = resolve();
if (sc.error) return JSON.stringify(Object.assign({ ok: false }, sc));
const supName = sc.dist ? sc.dist.supplier_name : "";
const label = sc.dist ? [sc.dist.supplier_name, sc.brand, sc.cls].filter(Boolean).join(" · ") : "All suppliers";

// ---------- PO lines (delivered), tagged ----------
const L = rows(`SELECT p.PO_NUMBER, p.SUPPLIER_NAME, p.BRAND_NAME, p.SKU_CLASS, p.DC_STATE, p.ORDER_DATE, p.EXPECTED_DELIVERY_DATE,
    p.ORDERED_UNITS, p.DELIVERED_UNITS, p.FORECAST_UNITS, p.IS_ON_TIME, p.IS_IN_FULL, p.IS_DIFOT, p.IS_OVERTRADED, p.IS_RUSH_ORDER,
    p.STD_LEAD_TIME_DAYS, p.ACTUAL_LEAD_TIME_DAYS, d.FISCAL_WEEK AS WEEK, o.OVERRIDE_ID, o.FACTOR
  FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC p
  LEFT JOIN ${C}.DIM_DATE d ON d.CALENDAR_DATE = p.EXPECTED_DELIVERY_DATE
  LEFT JOIN ${A}.DEMAND_OVERRIDE o ON o.BRAND_NAME = p.BRAND_NAME AND o.CLASS = p.SKU_CLASS AND o.FISCAL_YEAR = d.FISCAL_YEAR
       AND o.FISCAL_WEEK = d.FISCAL_WEEK AND p.ORDER_DATE >= TO_DATE(o.ENTERED_AT)
  WHERE p.STATUS = 'DELIVERED' AND p.PO_NUMBER NOT LIKE 'PO-RCV-%' AND p.EXPECTED_DELIVERY_DATE BETWEEN ? AND ?
    AND (? = '' OR p.SUPPLIER_NAME = ?)`, [BEFORE_FROM, asOf, supName, supName]);
for (const l of L) {
  l.recent = l.expected_delivery_date >= SPLIT;
  l.short_units = l.delivered_units < l.ordered_units;
  l.override_sized = !!l.override_id;
  l.rush_late = !!l.is_rush_order && !l.is_on_time;
  l.ours = !l.is_difot && (l.override_sized || l.rush_late);
}
const inScope = (l) => (!sc.brand || l.brand_name === sc.brand) && (!sc.cls || l.sku_class === sc.cls);
const S = L.filter(inScope);
const recent = S.filter((l) => l.recent), before = S.filter((l) => !l.recent);

function summ(ls) {
  const n = ls.length, miss = ls.filter((l) => !l.is_difot), sh = ls.filter((l) => l.short_units);
  const ord = sh.reduce((s, l) => s + l.ordered_units, 0), del = sh.reduce((s, l) => s + l.delivered_units, 0);
  const shOurs = sh.filter((l) => l.override_sized);
  return { lines: n, difot_pct: pct(n - miss.length, n), on_time_pct: pct(ls.filter((l) => l.is_on_time).length, n),
    in_full_pct: pct(ls.filter((l) => l.is_in_full).length, n), missed_lines: miss.length,
    missed_late_only: miss.filter((l) => !l.is_on_time && l.is_in_full).length,
    missed_short_only: miss.filter((l) => l.is_on_time && !l.is_in_full).length,
    missed_late_and_short: miss.filter((l) => !l.is_on_time && !l.is_in_full).length,
    lines_short_shipped: sh.length, fill_pct_on_short_lines: ord ? r1((100 * del) / ord) : null, units_short: ord - del,
    units_short_on_override_lines: shOurs.reduce((s, l) => s + l.ordered_units - l.delivered_units, 0),
    missed_ours: miss.filter((l) => l.ours).length, missed_supplier: miss.filter((l) => !l.ours).length,
    missed_ordered_units_ours: miss.filter((l) => l.ours).reduce((s2, l) => s2 + l.ordered_units, 0),
    missed_ordered_units_supplier: miss.filter((l) => !l.ours).reduce((s2, l) => s2 + l.ordered_units, 0) };
}
function by(ls, key) { const g = {}; for (const l of ls) (g[l[key]] = g[l[key]] || []).push(l); return g; }
function groupRows(ls, key, name) {
  const miss = ls.filter((l) => !l.is_difot).length, short = ls.reduce((s, l) => s + (l.short_units ? l.ordered_units - l.delivered_units : 0), 0);
  return Object.entries(by(ls, key)).map(([k, g]) => {
    const s = summ(g);
    return Object.assign({ [name]: k }, { lines: s.lines, difot_pct: s.difot_pct, on_time_pct: s.on_time_pct, in_full_pct: s.in_full_pct,
      missed_lines: s.missed_lines, share_of_misses_pct: pct(s.missed_lines, miss), units_short: s.units_short,
      share_of_units_short_pct: short ? pct(s.units_short, short) : null, fill_pct_on_short_lines: s.fill_pct_on_short_lines });
  }).sort((a, b) => b.units_short - a.units_short || b.missed_lines - a.missed_lines);
}
const recS = summ(recent), befS = summ(before);
const driver = recS.missed_lines ? ((recS.missed_short_only + recS.missed_late_and_short) / recS.missed_lines >= 0.6 ? "in_full"
  : (recS.missed_late_only + recS.missed_late_and_short) / recS.missed_lines >= 0.6 ? "on_time" : "mixed") : "none";

// Weekly PO-line DIFOT by delivery week, and the scorecard (orders-weighted over the scope's brands).
function weekly(ls) {
  return Object.entries(by(ls.filter((l) => l.week !== null && l.week !== undefined), "week")).map(([w, g]) => {
    const s = summ(g); return { fiscal_week: Number(w), lines: s.lines, difot_pct: s.difot_pct, on_time_pct: s.on_time_pct, in_full_pct: s.in_full_pct, units_short: s.units_short };
  }).sort((a, b) => a.fiscal_week - b.fiscal_week);
}
const scopeBrands = sc.brand ? [sc.brand] : sc.dist ? sc.dist.brand_list : [];
const scorecard = scopeBrands.length ? rows(`SELECT FISCAL_WEEK, SUM(DIFOT_PCT * ORDERS_TOTAL) / NULLIF(SUM(ORDERS_TOTAL), 0) AS DIFOT, SUM(ORDERS_TOTAL) AS ORDERS
    FROM ${A}.DT_SUPPLIER_DIFOT WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 8 AND 19
      AND ARRAY_CONTAINS(BRAND_NAME::VARIANT, PARSE_JSON(?)) AND ${sc.cls ? "CLASS = ?" : "CLASS IS NULL"}
    GROUP BY 1 ORDER BY 1`, sc.cls ? [JSON.stringify(scopeBrands), sc.cls] : [JSON.stringify(scopeBrands)])
  .map((r) => ({ fiscal_week: r.fiscal_week, difot_pct: r1(r.difot), orders: r.orders })) : [];

// Overrides on the scope's brands, and the override-sized lines.
const overrides = scopeBrands.length ? rows(`SELECT OVERRIDE_ID, BRAND_NAME, CLASS, FISCAL_WEEK, FACTOR, ENTERED_BY, TO_CHAR(ENTERED_AT, 'YYYY-MM-DD') AS ENTERED_ON,
    TO_CHAR(REVIEW_BY, 'YYYY-MM-DD') AS REVIEW_BY, STATUS, REASON FROM ${A}.DEMAND_OVERRIDE
    WHERE ARRAY_CONTAINS(BRAND_NAME::VARIANT, PARSE_JSON(?)) AND (? = '' OR CLASS = ?) ORDER BY FISCAL_WEEK`,
  [JSON.stringify(scopeBrands), sc.cls || "", sc.cls || ""]) : [];
function overrideSized(ls) {
  const o = ls.filter((l) => l.override_sized), cut = o.filter((l) => l.short_units);
  const sig = cut.length ? cut.reduce((s, l) => s + Math.abs((l.delivered_units / l.ordered_units) * l.factor - 1), 0) / cut.length : null;
  return { lines: o.length, missed_lines: o.filter((l) => !l.is_difot).length, lines_cut: cut.length,
    fill_pct_on_cut_lines: cut.length ? r1((100 * cut.reduce((s, l) => s + l.delivered_units, 0)) / cut.reduce((s, l) => s + l.ordered_units, 0)) : null,
    delivered_vs_unoverridden_order_pct: sig === null ? null : r1(100 - 100 * sig),
    cut_lines: cut.slice(0, 8).map((l) => ({ po: l.po_number, dc: l.dc_state, ordered_on: l.order_date, delivery_week: l.week, factor: l.factor,
      ordered_units: l.ordered_units, delivered_units: l.delivered_units, fill_pct: r1((100 * l.delivered_units) / l.ordered_units) })) };
}

// Stock: the campaign's supply position where it exists, else the store inventory (7 May 2026).
function stock() {
  if (!scopeBrands.length) return null;
  const sp = rows(`SELECT BRAND_NAME, STATUS, COUNT(*) AS STORES, LISTAGG(DISTINCT STATE, ', ') WITHIN GROUP (ORDER BY STATE) AS STATES
    FROM ${K}.SUPPLY_POSITION WHERE ARRAY_CONTAINS(BRAND_NAME::VARIANT, PARSE_JSON(?)) GROUP BY 1, 2 ORDER BY 1, 2`, [JSON.stringify(scopeBrands)]);
  const inv = rows(`SELECT COUNT_IF(i.STOCK_ON_HAND = 0) AS OOS, COUNT(*) AS N FROM ${C}.FACT_INVENTORY i
      JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
    WHERE i.DATE_KEY = 20260507 AND ARRAY_CONTAINS(b.BRAND_NAME::VARIANT, PARSE_JSON(?)) AND (? = '' OR p.CLASS = ?)`,
    [JSON.stringify(scopeBrands), sc.cls || "", sc.cls || ""])[0] || {};
  const all = rows(`SELECT COUNT_IF(STOCK_ON_HAND = 0) AS OOS, COUNT(*) AS N FROM ${C}.FACT_INVENTORY WHERE DATE_KEY = 20260507`)[0] || {};
  const short = sp.filter((r) => r.status === "SHORT");
  return { stores_short: short.reduce((s, r) => s + r.stores, 0), short_states: short.map((r) => `${r.brand_name}: ${r.states}`),
    supply_position: sp.map((r) => ({ brand: r.brand_name, status: r.status, stores: r.stores, states: r.states })),
    store_sku_out_of_stock_pct: pct(inv.oos, inv.n), all_brands_out_of_stock_pct: pct(all.oos, all.n),
    note: "Supply position (SHORT/LOW/OK/OVER per store) is MODELLED and exists for six brands; the store inventory is POS-era, 7 May 2026." };
}

function attribution(ls) {
  const s = summ(ls), basis = driver === "in_full" && s.units_short > 0 ? "units_short" : "missed_lines";
  const oursShare = basis === "units_short" ? pct(s.units_short_on_override_lines, s.units_short) : pct(s.missed_ours, s.missed_lines);
  const verdict = oursShare === null ? "INCONCLUSIVE" : oursShare >= 50 ? "BABY_MART" : oursShare <= 20 ? "SUPPLIER" : "SHARED";
  return { basis, ours_share_pct: oursShare, missed_ours: s.missed_ours, missed_supplier: s.missed_supplier,
    units_short: s.units_short, units_short_on_override_lines: s.units_short_on_override_lines, verdict };
}
const RULE_ATTR = "A missed line is Baby Mart's when it was sized on a planner override (ordered after the override was entered, delivered in an override week) or was a rush order that arrived late; every other miss is the supplier's. BABY_MART when ours is 50% or more (of units short when the misses are in-full failures, else of missed lines); SUPPLIER at 20% or less; SHARED between.";

// ---------- ALL suppliers ----------
if (!sc.dist) {
  const sups = Object.entries(by(L.filter((l) => l.recent), "supplier_name")).map(([name, g]) => {
    const s = summ(g), bef = summ(L.filter((l) => !l.recent && l.supplier_name === name)), d = DISTS.find((x) => x.supplier_name === name) || {};
    const drv = s.missed_lines ? ((s.missed_short_only + s.missed_late_and_short) / s.missed_lines >= 0.6 ? "in_full" : (s.missed_late_only + s.missed_late_and_short) / s.missed_lines >= 0.6 ? "on_time" : "mixed") : "none";
    const oursShare = drv === "in_full" && s.units_short > 0 ? pct(s.units_short_on_override_lines, s.units_short) : pct(s.missed_ours, s.missed_lines);
    return { supplier: name, brands: d.brands, std_lead_time_days: d.std_lead_time_days, sourcing_type: d.sourcing_type,
      recent_lines: s.lines, recent_difot_pct: s.difot_pct, before_difot_pct: bef.difot_pct, change_pts: s.difot_pct !== null && bef.difot_pct !== null ? r1(s.difot_pct - bef.difot_pct) : null,
      gap_to_target_pts: s.difot_pct === null ? null : r1(s.difot_pct - target), on_time_pct: s.on_time_pct, in_full_pct: s.in_full_pct,
      miss_driver: drv, units_short: s.units_short, ours_share_pct: oursShare,
      attribution: oursShare === null ? "INCONCLUSIVE" : oursShare >= 50 ? "BABY_MART" : oursShare <= 20 ? "SUPPLIER" : "SHARED" };
  }).sort((a, b) => a.recent_difot_pct - b.recent_difot_pct);
  const allS = summ(L.filter((l) => l.recent));
  return JSON.stringify({ ok: true, scope: "All suppliers", as_of: asOf, target_pct: target,
    windows: { before: `${BEFORE_FROM} to 2026-04-05 (deliveries)`, recent: `${SPLIT} to ${asOf} (deliveries)` },
    all_recent: { lines: allS.lines, difot_pct: allS.difot_pct, on_time_pct: allS.on_time_pct, in_full_pct: allS.in_full_pct },
    suppliers_below_target: sups.filter((s) => s.recent_difot_pct < target).length, suppliers: sups,
    next: "Investigate one supplier with SUPPLIER set to its name, and test attribution, component and timing.", rule_attribution: RULE_ATTR });
}

// ---------- the evidence pack ----------
const dim = String(DIMENSION || "").trim().toLowerCase();
const d0 = sc.dist;
const supplierInfo = { name: d0.supplier_name, brands: d0.brand_list, std_lead_time_days: d0.std_lead_time_days, sourcing_type: d0.sourcing_type,
  transport_mode: d0.transport_mode, carrier: d0.primary_carrier, is_3pl_viable: d0.is_3pl_viable, estimated_3pl_days: d0.estimated_3pl_days };
if (!dim) {
  return JSON.stringify({ ok: true, scope: label, supplier: supplierInfo, brand: sc.brand, class: sc.cls, as_of: asOf, target_pct: target,
    windows: { before: `${BEFORE_FROM} to 2026-04-05 (deliveries)`, recent: `${SPLIT} to ${asOf} (deliveries)` },
    recent: recS, before: befS, change_pts: recS.difot_pct !== null && befS.difot_pct !== null ? r1(recS.difot_pct - befS.difot_pct) : null,
    gap_to_target_pts: recS.difot_pct === null ? null : r1(recS.difot_pct - target), miss_driver: driver,
    weekly_po_lines: weekly(S), scorecard_weekly: scorecard,
    by_dc: groupRows(recent, "dc_state", "dc").slice(0, 5), by_class: groupRows(recent, "sku_class", "class").slice(0, 6),
    by_brand: sc.brand ? [] : groupRows(recent, "brand_name", "brand").slice(0, 5),
    overrides, override_sized_lines: overrideSized(recent), attribution: attribution(recent), stock: stock(),
    suggested_tests: ["component", "timing", "attribution", "override", "supplier_wide", "dc", sc.cls ? null : sc.brand ? "class" : "brand", "lead_time", "rush", "stock"].filter(Boolean),
    provenance: "PO lines and the weekly scorecard are REAL rows of the supply data; the store supply position is MODELLED.",
    rule_attribution: RULE_ATTR });
}

// ---------- one hypothesis test ----------
function out(verdict, reading, extra, rule) { return JSON.stringify(Object.assign({ ok: true, scope: label, dimension: dim, verdict, reading }, extra || {}, { rule })); }
const PLURAL = { dc: "DCs", class: "classes", brand: "brands" };
function concentration(key, name) {
  const g = groupRows(recent, key, name);
  if (g.length < 2 || (recS.missed_lines < 3 && recS.units_short === 0)) return out("INCONCLUSIVE", `Too few recent misses across ${PLURAL[name]} to test a concentration.`, { groups: g }, "");
  const top = g[0], rest = summ(recent.filter((l) => l[key] !== top[name]));
  const gap = top.difot_pct !== null && rest.difot_pct !== null ? r1(rest.difot_pct - top.difot_pct) : null;
  const unitsConc = recS.units_short > 0 && top.share_of_units_short_pct >= 70 && top.units_short > 0;
  const lineConc = top.share_of_misses_pct >= 50 && gap !== null && gap >= 15;
  const verdict = unitsConc || lineConc ? "SUPPORTED" : (top.share_of_misses_pct < 40 && !(top.share_of_units_short_pct >= 50)) || (gap !== null && gap < 10 && !unitsConc) ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  const reading = verdict === "SUPPORTED"
    ? `Concentrated in ${top[name]}: ${top.share_of_units_short_pct === null ? 0 : top.share_of_units_short_pct}% of the units short and ${top.share_of_misses_pct}% of missed lines; DIFOT ${top.difot_pct}% there vs ${rest.difot_pct}% elsewhere.`
    : verdict === "NOT_SUPPORTED" ? `Spread across ${PLURAL[name]}: the largest, ${top[name]}, has ${top.share_of_misses_pct}% of missed lines and DIFOT ${top.difot_pct}% vs ${rest.difot_pct}% elsewhere.`
    : `Leans to ${top[name]} (${top.share_of_misses_pct}% of missed lines) but not clearly.`;
  return out(verdict, reading, { top: top[name], top_difot_pct: top.difot_pct, rest_difot_pct: rest.difot_pct, gap_pts: gap, groups: g.slice(0, 6) },
    `SUPPORTED when one ${name} holds 70%+ of units short, or 50%+ of missed lines with DIFOT 15+ pts below the rest; NOT_SUPPORTED when under 40% of misses or within 10 pts.`);
}

if (dim === "component") {
  const late = recS.missed_late_only + recS.missed_late_and_short, short = recS.missed_short_only + recS.missed_late_and_short;
  const verdict = driver === "mixed" || driver === "none" ? "INCONCLUSIVE" : "SUPPORTED";
  return out(verdict, driver === "in_full" ? `In-full failures drive the miss: ${short} of ${recS.missed_lines} missed lines were short, ${recS.lines_short_shipped} lines lost units (fill ${recS.fill_pct_on_short_lines}% on those), on-time ${recS.on_time_pct}%.`
    : driver === "on_time" ? `Lateness drives the miss: ${late} of ${recS.missed_lines} missed lines were late; on-time ${recS.on_time_pct}% vs in-full ${recS.in_full_pct}%.`
    : `No single component: ${late} late and ${short} short of ${recS.missed_lines} missed lines.`,
    { driver, missed_lines: recS.missed_lines, missed_late: late, missed_short: short, on_time_pct: recS.on_time_pct, in_full_pct: recS.in_full_pct,
      lines_short_shipped: recS.lines_short_shipped, fill_pct_on_short_lines: recS.fill_pct_on_short_lines, units_short: recS.units_short },
    "SUPPORTED with a driver when 60%+ of missed lines fail on that component; INCONCLUSIVE otherwise.");
}
if (dim === "timing") {
  const w = weekly(S), change = recS.difot_pct !== null && befS.difot_pct !== null ? r1(recS.difot_pct - befS.difot_pct) : null;
  const sc0 = scorecard.filter((r) => r.fiscal_week <= 14), sc1 = scorecard.filter((r) => r.fiscal_week >= 15);
  const avg = (a) => (a.length ? r1(a.reduce((s, r) => s + r.difot_pct, 0) / a.length) : null);
  const scBefore = avg(sc0), scAfter = avg(sc1), scMin = sc1.length ? sc1.reduce((m, r) => (r.difot_pct < m.difot_pct ? r : m), sc1[0]) : null;
  const firstBelow = w.find((x, i) => x.fiscal_week >= 15 && x.difot_pct < target && i > 0 && w[i - 1].difot_pct >= target);
  const drop = (change !== null && change <= -10) || (scBefore !== null && scAfter !== null && scAfter - scBefore <= -10);
  const verdict = drop ? "SUPPORTED" : change !== null && Math.abs(change) < 5 && (scBefore === null || Math.abs(scAfter - scBefore) < 5) ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  return out(verdict, verdict === "SUPPORTED" ? `A recent fall: PO-line DIFOT ${befS.difot_pct}% before 6 Apr vs ${recS.difot_pct}% since (${change} pts); the scorecard averaged ${scBefore}% in weeks 8-14 and ${scAfter}% in weeks 15-19${scMin ? `, lowest ${scMin.difot_pct}% in week ${scMin.fiscal_week}` : ""}.`
    : verdict === "NOT_SUPPORTED" ? `Chronic, not new: PO-line DIFOT ${befS.difot_pct}% before 6 Apr and ${recS.difot_pct}% since; the scorecard ${scBefore}% then ${scAfter}%.`
    : `Some movement (${change} pts on PO lines; scorecard ${scBefore}% to ${scAfter}%) but not a clear step.`,
    { before_difot_pct: befS.difot_pct, recent_difot_pct: recS.difot_pct, change_pts: change, scorecard_before_pct: scBefore, scorecard_recent_pct: scAfter,
      scorecard_low: scMin, first_week_below_target: firstBelow ? firstBelow.fiscal_week : null, weekly_po_lines: w, scorecard_weekly: scorecard },
    "SUPPORTED (a recent fall) when PO-line or scorecard DIFOT fell 10+ pts from weeks 8-14 to weeks 15+; NOT_SUPPORTED (chronic) when both moved under 5 pts.");
}
if (dim === "dc") return concentration("dc_state", "dc");
if (dim === "class") return concentration("sku_class", "class");
if (dim === "brand") {
  if (sc.brand) return out("NOT_SUPPORTED", `The scope is already one brand (${sc.brand}).`, {}, "");
  return concentration("brand_name", "brand");
}
if (dim === "supplier_wide") {
  // Compared on what drives the miss: unit fill for short-shipping, on-time for lateness, else DIFOT.
  const pool = sc.brand || sc.cls ? L.filter((l) => l.recent && l.supplier_name === d0.supplier_name && !inScope(l)) : L.filter((l) => l.recent && l.supplier_name !== d0.supplier_name);
  let poolLines = pool;
  if (!(sc.brand || sc.cls)) poolLines = rows(`SELECT ORDERED_UNITS, DELIVERED_UNITS, IS_ON_TIME, IS_IN_FULL, IS_DIFOT FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' AND PO_NUMBER NOT LIKE 'PO-RCV-%' AND EXPECTED_DELIVERY_DATE BETWEEN ? AND ? AND SUPPLIER_NAME <> ?`, [SPLIT, asOf, d0.supplier_name]);
  const otherLabel = sc.brand || sc.cls ? `${d0.supplier_name}'s other lines` : "every other supplier";
  const unitFill = (ls) => { const o = ls.reduce((s2, l) => s2 + l.ordered_units, 0); return o ? r1((100 * ls.reduce((s2, l) => s2 + Math.min(l.delivered_units, l.ordered_units), 0)) / o) : null; };
  const measure = driver === "in_full" ? "unit fill" : driver === "on_time" ? "on-time" : "DIFOT";
  const val = (ls) => (driver === "in_full" ? unitFill(ls) : driver === "on_time" ? pct(ls.filter((l) => l.is_on_time).length, ls.length) : pct(ls.filter((l) => l.is_difot).length, ls.length));
  const mine = val(recent), theirs = val(poolLines);
  const gap = mine !== null && theirs !== null ? r1(theirs - mine) : null;
  const specificAt = driver === "in_full" ? 5 : 15, wideBelow = driver === "in_full" ? 2 : 8;
  const verdict = gap === null || poolLines.length < 3 ? "INCONCLUSIVE" : gap >= specificAt ? "NOT_SUPPORTED" : gap < wideBelow ? "SUPPORTED" : "INCONCLUSIVE";
  return out(verdict, verdict === "NOT_SUPPORTED" ? `Specific, not supplier-wide: ${measure} ${mine}% for ${label} vs ${theirs}% for ${otherLabel} (${gap} pts).`
    : verdict === "SUPPORTED" ? `Wide: ${otherLabel} run ${theirs}% ${measure} against ${mine}% here (${gap} pts).` : `Partly specific: ${measure} ${mine}% here vs ${theirs}% for ${otherLabel}.`,
    { measure, scope_pct: mine, compared_with: otherLabel, compared_lines: poolLines.length, compared_pct: theirs, gap_pts: gap },
    `Compares the recent scope with the same supplier's other lines (or, for a whole supplier, every other supplier) on what drives the miss: unit fill for short-shipping (NOT_SUPPORTED, i.e. specific, at ${specificAt}+ pts better elsewhere; SUPPORTED, i.e. wide, under ${wideBelow}), on-time for lateness, else DIFOT (15 / 8 pts).`);
}
if (dim === "override") {
  const o = overrideSized(recent);
  const share = recS.units_short ? pct(recS.units_short_on_override_lines, recS.units_short) : null;
  const verdict = !o.lines ? "NOT_SUPPORTED" : share !== null && share >= 50 && o.delivered_vs_unoverridden_order_pct !== null && o.delivered_vs_unoverridden_order_pct >= 90 ? "SUPPORTED" : share !== null && share < 20 ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  const ov = overrides[0];
  return out(verdict, verdict === "SUPPORTED" ? `The misses are our inflated orders: ${o.lines_cut} of ${o.lines} lines sized on the demand override were cut, holding ${share}% of the units short. On those lines the supplier delivered ${o.fill_pct_on_cut_lines}% of what was ordered, ${o.delivered_vs_unoverridden_order_pct}% in line with the order before the override factor: it shipped the normal quantity, not the uplift.${ov ? ` The override was entered by ${ov.entered_by} on ${ov.entered_on}, review due ${ov.review_by}, ${ov.status}.` : ""}`
    : !o.lines ? "No line in the scope was sized on a demand override." : `Some override-sized lines (${o.lines}) but they hold ${share}% of the units short.`,
    Object.assign({ units_short_share_pct: share, overrides }, o),
    "SUPPORTED when lines sized on a planner override hold 50%+ of the units short and the supplier delivered within 10% of the order divided by the override factor; NOT_SUPPORTED with no override-sized lines or under 20%.");
}
if (dim === "rush") {
  const late = recent.filter((l) => !l.is_on_time), rush = late.filter((l) => l.is_rush_order);
  const share = pct(rush.length, late.length);
  const verdict = late.length < 3 ? "INCONCLUSIVE" : share >= 50 ? "SUPPORTED" : share < 25 ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  return out(verdict, late.length ? `${rush.length} of ${late.length} late lines were rush orders placed inside the lead time (${share}%).` : "No recent line arrived late.",
    { late_lines: late.length, late_rush_lines: rush.length, share_pct: share, rush_orders_recent: recent.filter((l) => l.is_rush_order).length },
    "SUPPORTED when 50%+ of late lines were rush orders (ordered inside the supplier's lead time); NOT_SUPPORTED under 25%.");
}
if (dim === "lead_time") {
  const late = recent.filter((l) => !l.is_on_time);
  const daysLate = late.length ? r1(late.reduce((s, l) => s + (l.actual_lead_time_days - l.std_lead_time_days), 0) / late.length) : null;
  const lateShare = pct(late.length, recent.length);
  const verdict = lateShare !== null && lateShare >= 20 && daysLate !== null && daysLate >= 2 ? "SUPPORTED" : lateShare !== null && lateShare < 10 ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  return out(verdict, verdict === "SUPPORTED" ? `Lead time is the problem: ${lateShare}% of recent lines arrived late, ${daysLate} days late on average, on a ${d0.std_lead_time_days}-day ${d0.transport_mode} lane (${d0.sourcing_type}).${d0.is_3pl_viable ? ` A 3PL could land it in about ${d0.estimated_3pl_days} days.` : " No 3PL option is viable for this supplier."}`
    : `${lateShare}% of recent lines late, ${daysLate === null ? 0 : daysLate} days on average: not the main problem.`,
    { late_share_pct: lateShare, avg_days_late: daysLate, std_lead_time_days: d0.std_lead_time_days, sourcing_type: d0.sourcing_type, transport_mode: d0.transport_mode,
      is_3pl_viable: d0.is_3pl_viable, estimated_3pl_days: d0.estimated_3pl_days },
    "SUPPORTED when 20%+ of recent lines are late by 2+ days on average; NOT_SUPPORTED under 10% late.");
}
if (dim === "overtrading") {
  // The flag alone (ordered 20%+ over forecast, or rush) is on about half of all orders. What matters is
  // whether a cut took only the over-forecast part: of the units cut on overtraded lines, how many fell
  // below the forecast quantity (a fair order the supplier did not fill)?
  const ot = summ(recent.filter((l) => l.is_overtraded)), fair = summ(recent.filter((l) => !l.is_overtraded));
  const cut = recent.filter((l) => l.is_overtraded && l.short_units);
  const unitsCut = cut.reduce((s2, l) => s2 + l.ordered_units - l.delivered_units, 0);
  const belowFc = cut.reduce((s2, l) => s2 + Math.max(0, Math.min(l.forecast_units, l.ordered_units) - l.delivered_units), 0);
  const share = pct(belowFc, unitsCut);
  const gap = ot.difot_pct !== null && fair.difot_pct !== null ? r1(fair.difot_pct - ot.difot_pct) : null;
  if (driver !== "in_full") return out("NOT_SUPPORTED", `The misses are ${driver === "on_time" ? "late deliveries" : "not mainly short deliveries"}, so over-ordering cannot explain them (${unitsCut} units cut on overtraded lines).`,
    { overtraded_lines: ot.lines, overtraded_difot_pct: ot.difot_pct, fair_lines: fair.lines, fair_difot_pct: fair.difot_pct, units_cut: unitsCut, miss_driver: driver },
    "Judged only when in-full failures drive the miss.");
  const verdict = !unitsCut ? "NOT_SUPPORTED" : share <= 20 ? "SUPPORTED" : share >= 50 ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  return out(verdict, unitsCut
    ? (verdict === "SUPPORTED" ? `Our over-ordering: of ${unitsCut} units cut on overtraded lines, only ${belowFc} (${share}%) fell below the forecast quantity, so the supplier mostly cut our excess.`
      : verdict === "NOT_SUPPORTED" ? `Not our over-ordering: of ${unitsCut} units cut on overtraded lines, ${belowFc} (${share}%) fell below even the forecast quantity.`
      : `Mixed: of ${unitsCut} units cut on overtraded lines, ${belowFc} (${share}%) fell below the forecast quantity.`)
    : `No overtraded line lost units. Overtraded lines ran ${ot.difot_pct}% DIFOT against ${fair.difot_pct}% on fair lines, on the delivery flags only.`,
    { overtraded_lines: ot.lines, overtraded_difot_pct: ot.difot_pct, fair_lines: fair.lines, fair_difot_pct: fair.difot_pct, gap_pts: gap,
      overtraded_lines_short: cut.length, units_cut: unitsCut, units_cut_below_forecast: belowFc, below_forecast_share_pct: share,
      lines: cut.slice(0, 6).map((l) => ({ po: l.po_number, dc: l.dc_state, ordered_units: l.ordered_units, forecast_units: l.forecast_units, delivered_units: l.delivered_units })) },
    "About half of all orders carry the overtrading flag, so the flag alone proves nothing. Of the units cut on overtraded lines: SUPPORTED (the supplier cut our excess) when 20% or less fell below the forecast quantity; NOT_SUPPORTED when 50% or more did.");
}
if (dim === "stock") {
  const st = stock();
  const verdict = st && st.stores_short > 0 ? "SUPPORTED" : "NOT_SUPPORTED";
  return out(verdict, verdict === "SUPPORTED" ? `The misses are emptying shelves: ${st.stores_short} stores SHORT (${st.short_states.join("; ")}).`
    : `Stores still hold stock: ${st ? st.store_sku_out_of_stock_pct : null}% of store-SKUs out on 7 May vs ${st ? st.all_brands_out_of_stock_pct : null}% for every brand.`,
    st || {}, "SUPPORTED when the campaign's supply position has stores SHORT of the brand; otherwise the store inventory shows whether shelves are holding.");
}
if (dim === "attribution") {
  const a = attribution(recent);
  return out(a.verdict, a.verdict === "BABY_MART" ? `Mostly ours: ${a.ours_share_pct}% of the ${a.basis === "units_short" ? "units short" : "missed lines"} sit on orders sized on a planner override or late rush orders.`
    : a.verdict === "SUPPLIER" ? `The supplier's: only ${a.ours_share_pct === null ? 0 : a.ours_share_pct}% of the ${a.basis === "units_short" ? "units short" : "missed lines"} trace to our orders; the rest were normal orders it did not deliver in full and on time.`
    : `Shared: ${a.ours_share_pct}% of the ${a.basis === "units_short" ? "units short" : "missed lines"} trace to our orders.`, a, RULE_ATTR);
}
return JSON.stringify({ ok: false, error: `Unknown dimension '${DIMENSION}'.`, valid_dimensions: ["component", "timing", "dc", "class", "brand", "supplier_wide", "override", "rush", "lead_time", "overtrading", "stock", "attribution"] });
$$;

-- ---------- 4. The two tools the agent calls ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.DIFOT_EVIDENCE(SUPPLIER VARCHAR, BRAND VARCHAR, CLASS VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'DIFOT evidence pack for a supplier, brand or class, or every supplier ranked (SUPPLIER = ALL).'
EXECUTE AS OWNER
AS
$$
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.AI.DIFOT_ANALYSIS(?, ?, ?, '')", binds: [SUPPLIER || "", BRAND || "", CLASS || ""] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;

CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.TEST_DIFOT_HYPOTHESIS(SUPPLIER VARCHAR, BRAND VARCHAR, CLASS VARCHAR, DIMENSION VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Tests one candidate cause of a supplier DIFOT miss: component, timing, dc, class, brand, supplier_wide, override, rush, lead_time, overtrading, stock or attribution.'
EXECUTE AS OWNER
AS
$$
const d = String(DIMENSION || "").trim();
if (!d) return JSON.stringify({ ok: false, error: "Name a DIMENSION to test." });
const rs = snowflake.createStatement({ sqlText: "CALL BABY_MART_DEMO.AI.DIFOT_ANALYSIS(?, ?, ?, ?)", binds: [SUPPLIER || "", BRAND || "", CLASS || "", d] }).execute();
rs.next();
return rs.getColumnValue(1);
$$;
