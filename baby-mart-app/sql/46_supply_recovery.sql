-- ============================================================
-- Supply Chain — stockout recovery builder
--
-- SUPPLY_RECOVERY_AGENT (agent/deploy_supply_agents.sql) answers "Rascal +
-- Friends is short in NSW: get it back" with the planning agents' builder
-- pattern: the SOLVER COMPUTES, THE AGENT EXPLAINS, A HUMAN APPROVES.
--
--   AI.STOCKOUT_EVIDENCE(BRAND, CLASS, STATE)    which stores are out, why (the
--                                                supplier's fill rate and DIFOT),
--                                                which DCs have cover to spare,
--                                                and which campaigns it blocks
--   AI.BUILD_RECOVERY_PLAN(BRAND, CLASS, STATE,  costs three options (inter-DC
--                          TARGET_WEEKS, REQUEST) transfer, emergency PO, both)
--                                                and writes them as a DRAFT plan
--   ANALYTICS.APPROVE_RECOVERY(PLAN, OPTION, BY) a PERSON approves on the Stockout
--                                                recovery page: it places the PO,
--                                                books the transfer and, when stock
--                                                lands within a week, moves the
--                                                stores from SHORT to LOW in
--                                                CAMPAIGN.SUPPLY_POSITION -- which
--                                                lifts the campaign's stock
--                                                suppression and BLOCK guardrail
--   ANALYTICS.RESET_RECOVERY_DEMO()              undoes every approval (rehearsals)
--
-- WHAT IS MODELLED. There is no store or DC stock ledger for these brands, so
-- STORE_STOCK_POSITION and DC_STOCK_POSITION are MODELLED as of SUPPLY_AS_OF()
-- (11 June 2026), consistent with CAMPAIGN.SUPPLY_POSITION: a store that is SHORT
-- there has no stock of the short class here. Demand is REAL: each store's POS
-- rate over the 8 weeks to 7 May 2026. Prices and costs are REAL (POS, DIM_PRODUCT).
-- The supplier's fill rate, lead time and DIFOT are REAL rows (sql/28). PO
-- quantities in FORECAST_REPLENISHMENT_SUPPLIER_DC are DC replenishment units on a
-- different scale from POS, so they are read for fill rate and timing, never added
-- to POS-scale stock.
--
-- Money keys end _aud so the app's number check can trace every figure.
-- Inputs are resolved against the data and bound, never spliced.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- Stock positions (MODELLED, as of the supply clock) ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.STORE_STOCK_POSITION
  COMMENT = 'MODELLED store stock by brand x class as of SUPPLY_AS_OF(), consistent with CAMPAIGN.SUPPLY_POSITION. WEEKLY_UNITS is REAL (POS, 8 weeks to 7 May 2026).'
AS
WITH focus AS (
  -- The class a brand's shortage is in. Rascal & Co short-shipped NSW Crawler
  -- Nappies (sql/28); a brand with no focus is short across its range.
  SELECT * FROM VALUES ('Rascal + Friends', 'Crawler Nappies') AS t(BRAND_NAME, FOCUS_CLASS)
),
brands AS (SELECT DISTINCT BRAND_NAME FROM BABY_MART_DEMO.CAMPAIGN.SUPPLY_POSITION),
grid AS (
  SELECT DISTINCT b.BRAND_NAME, p.CLASS, s.STORE_KEY, s.STORE_CODE, s.STORE_NAME, s.STATE
  FROM BABY_MART_DEMO.CURATED.DIM_PRODUCT p JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  CROSS JOIN BABY_MART_DEMO.CURATED.DIM_STORE s
  WHERE b.BRAND_NAME IN (SELECT BRAND_NAME FROM brands)
),
rate AS (
  SELECT b.BRAND_NAME, p.CLASS, f.STORE_KEY, SUM(f.QUANTITY) / 8.0 AS WEEKLY_UNITS
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE f.DATE_KEY BETWEEN 20260313 AND 20260507 AND b.BRAND_NAME IN (SELECT BRAND_NAME FROM brands)
  GROUP BY 1, 2, 3
),
c AS (
  SELECT g.*, COALESCE(r.WEEKLY_UNITS, 0) AS WEEKLY_UNITS, COALESCE(sp.STATUS, 'OK') AS SUPPLY_STATUS,
         IFF(fo.FOCUS_CLASS IS NULL OR fo.FOCUS_CLASS = g.CLASS, TRUE, FALSE) AS IS_FOCUS,
         (ABS(HASH(g.BRAND_NAME, g.CLASS, g.STORE_CODE, 'cover')) % 1000) / 1000.0 AS H
  FROM grid g
  LEFT JOIN rate r ON r.BRAND_NAME = g.BRAND_NAME AND r.CLASS = g.CLASS AND r.STORE_KEY = g.STORE_KEY
  LEFT JOIN BABY_MART_DEMO.CAMPAIGN.SUPPLY_POSITION sp ON sp.BRAND_NAME = g.BRAND_NAME AND sp.STORE_CODE = g.STORE_CODE
  LEFT JOIN focus fo ON fo.BRAND_NAME = g.BRAND_NAME
),
s AS (
  SELECT c.*,
         CASE WHEN SUPPLY_STATUS = 'SHORT' AND IS_FOCUS THEN 0
              WHEN SUPPLY_STATUS = 'SHORT' THEN 1.5 + H
              WHEN SUPPLY_STATUS = 'LOW'   THEN 1.2 + 1.3 * H
              WHEN SUPPLY_STATUS = 'OVER'  THEN 14 + 6 * H
              ELSE 3 + 3 * H END AS MODEL_COVER
  FROM c
)
SELECT BRAND_NAME, CLASS, STORE_CODE, STORE_NAME, STATE,
       CASE STATE WHEN 'ACT' THEN 'NSW' WHEN 'TAS' THEN 'VIC' WHEN 'NT' THEN 'QLD' ELSE STATE END AS DC_STATE,
       ROUND(WEEKLY_UNITS, 2) AS WEEKLY_UNITS,
       IFF(MODEL_COVER = 0, 0, CEIL(WEEKLY_UNITS * MODEL_COVER)) AS STOCK_ON_HAND,
       ROUND(IFF(MODEL_COVER = 0, 0, CEIL(WEEKLY_UNITS * MODEL_COVER)) / NULLIF(WEEKLY_UNITS, 0), 1) AS COVER_WEEKS,
       CASE WHEN MODEL_COVER = 0 AND WEEKLY_UNITS > 0 THEN 'OUT' WHEN MODEL_COVER < 2 THEN 'LOW' WHEN MODEL_COVER > 12 THEN 'OVER' ELSE 'OK' END AS STOCK_STATUS,
       SUPPLY_STATUS, 'MODELLED' AS PROVENANCE
FROM s;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.DC_STOCK_POSITION
  COMMENT = 'MODELLED DC stock by brand x class as of SUPPLY_AS_OF(). WEEKLY_UNITS is the REAL POS demand of the stores the DC serves. BASE_DC_SOH is the position before any approved recovery.'
AS
WITH d AS (
  SELECT BRAND_NAME, CLASS, DC_STATE, SUM(WEEKLY_UNITS) AS WEEKLY_UNITS, SUM(STOCK_ON_HAND) AS STORE_SOH,
         COUNT_IF(STOCK_STATUS = 'OUT') AS STORES_OUT, COUNT(*) AS STORES
  FROM BABY_MART_DEMO.ANALYTICS.STORE_STOCK_POSITION GROUP BY 1, 2, 3
),
rules AS (
  -- NSW's short-shipped Crawler stock all went straight to stores; VIC was
  -- delivered in full and holds cover to spare.
  SELECT * FROM VALUES
    ('Rascal + Friends', 'Crawler Nappies', 'NSW', 0.0),
    ('Rascal + Friends', 'Crawler Nappies', 'VIC', 8.5),
    ('Rascal + Friends', 'Crawler Nappies', 'QLD', 4.5)
  AS t(BRAND_NAME, CLASS, DC_STATE, COVER)
),
brand_default AS (
  SELECT * FROM VALUES ('Uppababy', 0.8, 0.8), ('Bugaboo', 12.0, 4.0) AS t(BRAND_NAME, BASE, SPREAD)
)
SELECT d.BRAND_NAME, d.CLASS, d.DC_STATE, ROUND(d.WEEKLY_UNITS, 2) AS WEEKLY_UNITS, d.STORE_SOH, d.STORES, d.STORES_OUT,
       ROUND(d.WEEKLY_UNITS * COALESCE(r.COVER, bd.BASE + bd.SPREAD * ((ABS(HASH(d.BRAND_NAME, d.CLASS, d.DC_STATE, 'dc')) % 1000) / 1000.0),
                                       3.5 + 2 * ((ABS(HASH(d.BRAND_NAME, d.CLASS, d.DC_STATE, 'dc')) % 1000) / 1000.0))) AS DC_SOH,
       0::NUMBER(12,0) AS INBOUND_UNITS, NULL::DATE AS INBOUND_ETA, 'MODELLED' AS PROVENANCE
FROM d LEFT JOIN rules r ON r.BRAND_NAME = d.BRAND_NAME AND r.CLASS = d.CLASS AND r.DC_STATE = d.DC_STATE
LEFT JOIN brand_default bd ON bd.BRAND_NAME = d.BRAND_NAME;

ALTER TABLE BABY_MART_DEMO.ANALYTICS.DC_STOCK_POSITION ADD COLUMN BASE_DC_SOH NUMBER;
UPDATE BABY_MART_DEMO.ANALYTICS.DC_STOCK_POSITION SET BASE_DC_SOH = DC_SOH;

-- CAMPAIGN.SUPPLY_POSITION (sql/40) is a CTAS, so its text columns were sized to
-- the seeded values (REASON 77, PROVENANCE 8). An approval writes longer ones.
ALTER TABLE BABY_MART_DEMO.CAMPAIGN.SUPPLY_POSITION ALTER COLUMN REASON SET DATA TYPE VARCHAR(1000);
ALTER TABLE BABY_MART_DEMO.CAMPAIGN.SUPPLY_POSITION ALTER COLUMN PROVENANCE SET DATA TYPE VARCHAR(30);

-- ---------- Recovery plans ----------
CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.SUPPLY_RECOVERY_PLAN (
  PLAN_ID VARCHAR PRIMARY KEY, BRAND_NAME VARCHAR, CLASS VARCHAR, DC_STATE VARCHAR, TARGET_WEEKS NUMBER(5,1),
  STATUS VARCHAR,                       -- DRAFT, APPROVED, SUPERSEDED, RESET
  REQUEST VARCHAR, CREATED_BY VARCHAR, CREATED_AT TIMESTAMP_NTZ, RECOMMENDED_OPTION VARCHAR,
  APPROVED_OPTION VARCHAR, APPROVED_BY VARCHAR, APPROVED_AT TIMESTAMP_NTZ, APPROVAL_NOTE VARCHAR, EFFECT VARIANT
) COMMENT = 'Stockout recovery plans. The agent writes DRAFTs; a person approves one option on the Stockout recovery page.';

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.SUPPLY_RECOVERY_OPTION (
  PLAN_ID VARCHAR, OPTION_ID VARCHAR, KIND VARCHAR, LABEL VARCHAR,
  TRANSFER_FROM_DC VARCHAR, TRANSFER_UNITS NUMBER, TRANSIT_DAYS NUMBER, PO_UNITS NUMBER, PO_EXPECTED_FILL_UNITS NUMBER,
  LEAD_DAYS NUMBER, FIRST_STOCK_DATE DATE, PO_DUE_DATE DATE, STOCKOUT_DAYS NUMBER,
  TRANSFER_COST_AUD NUMBER(12,2), STOCK_VALUE_AUD NUMBER(12,2), LOST_SALES_AUD NUMBER(12,2),
  COVER_AFTER_WEEKS NUMBER(6,1), SOURCE_COVER_AFTER_WEEKS NUMBER(6,1), RESTORES_TARGET BOOLEAN, LIFTS_SHORTAGE BOOLEAN,
  FEASIBLE BOOLEAN, GUARDRAILS VARIANT
) COMMENT = 'Costed options of a recovery plan.';

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.SUPPLY_RECOVERY_STORE (
  PLAN_ID VARCHAR, BRAND_NAME VARCHAR, STORE_CODE VARCHAR, STATE VARCHAR, PRIOR_STATUS VARCHAR, PRIOR_REASON VARCHAR, PRIOR_PROVENANCE VARCHAR
) COMMENT = 'The stores a recovery plan covers, with their CAMPAIGN.SUPPLY_POSITION row before approval, so RESET_RECOVERY_DEMO can restore it.';

CREATE TABLE IF NOT EXISTS BABY_MART_DEMO.ANALYTICS.SUPPLY_TRANSFER (
  TRANSFER_ID VARCHAR, PLAN_ID VARCHAR, BRAND_NAME VARCHAR, CLASS VARCHAR, FROM_DC VARCHAR, TO_DC VARCHAR, UNITS NUMBER,
  SHIP_DATE DATE, ETA DATE, STATUS VARCHAR
) COMMENT = 'Inter-DC transfers booked by approved recovery plans.';

-- ---------- STOCKOUT_EVIDENCE ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.STOCKOUT_EVIDENCE(BRAND VARCHAR, CLASS VARCHAR, STATE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Stockout evidence for a brand (and class, and DC state): stores out, stock and cover by DC, the supplier''s fill rate, DIFOT and lead time, open POs, and the campaigns the shortage blocks.'
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
const DC = { ACT: "NSW", TAS: "VIC", NT: "QLD" };
function resolve(brand, klass, state) {
  const B = rows(`SELECT BRAND_NAME, CLASS, DC_STATE, STORES_OUT, WEEKLY_UNITS, DC_SOH + STORE_SOH AS SOH FROM ${A}.DC_STOCK_POSITION`);
  const bk = String(brand || "").trim().toUpperCase();
  let hit = B.filter((r) => r.brand_name.toUpperCase() === bk);
  if (!hit.length && bk.length >= 3) hit = B.filter((r) => r.brand_name.toUpperCase().includes(bk));
  if (!hit.length) return { error: `No stock position for brand '${brand}'.`, valid_brands: [...new Set(B.map((r) => r.brand_name))].sort() };
  const name = hit[0].brand_name, mine = B.filter((r) => r.brand_name === name);
  const classes = [...new Set(mine.map((r) => r.class))].sort();
  const ck = String(klass || "").trim().toUpperCase().replace(/S$/, "");
  let cls = null;
  if (ck && !/^(ALL|ANY|NONE|\*)$/.test(ck)) {
    cls = classes.find((c) => c.toUpperCase().replace(/S$/, "") === ck) || classes.find((c) => c.toUpperCase().includes(ck));
    if (!cls) return { error: `${name} has no class matching '${klass}'.`, valid_classes: classes };
  }
  const sk = String(state || "").trim().toUpperCase();
  let dc = sk && !/^(ALL|ANY|NATIONAL)$/.test(sk) ? (DC[sk] || sk) : null;
  if (dc && !mine.some((r) => r.dc_state === dc)) return { error: `No DC '${state}'.`, valid_dcs: [...new Set(mine.map((r) => r.dc_state))].sort() };
  // Unspecified: the class and DC with the most stores out, then the lowest cover.
  const pick = mine.filter((r) => (!cls || r.class === cls) && (!dc || r.dc_state === dc))
    .sort((a, b) => b.stores_out - a.stores_out || (a.soh / (a.weekly_units || 1)) - (b.soh / (b.weekly_units || 1)))[0];
  return { brand: name, cls: cls || pick.class, dc: dc || pick.dc_state, classes };
}
const sc = resolve(BRAND, CLASS, STATE);
if (sc.error) return JSON.stringify(Object.assign({ ok: false }, sc));
const asOf = rows(`SELECT ${A}.SUPPLY_AS_OF() AS D`)[0].d;
const price = rows(`SELECT SUM(f.NET_REVENUE) / NULLIF(SUM(f.QUANTITY), 0) AS ASP, SUM(f.MARGIN_AMOUNT) / NULLIF(SUM(f.NET_REVENUE), 0) AS MRG
  FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE b.BRAND_NAME = ? AND p.CLASS = ? AND f.DATE_KEY BETWEEN 20260313 AND 20260507`, [sc.brand, sc.cls])[0];
const stores = rows(`SELECT STORE_CODE, STORE_NAME, STATE, WEEKLY_UNITS, STOCK_ON_HAND, COVER_WEEKS, STOCK_STATUS, SUPPLY_STATUS
  FROM ${A}.STORE_STOCK_POSITION WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ? ORDER BY STOCK_ON_HAND, WEEKLY_UNITS DESC`, [sc.brand, sc.cls, sc.dc]);
const out = stores.filter((s) => s.stock_status === "OUT");
const floor = Number(rows(`SELECT SETTING_VALUE AS V FROM ${A}.SUPPLY_SETTING WHERE SETTING_KEY = 'SOURCE_FLOOR_WEEKS'`)[0].v);
const dcs = rows(`SELECT DC_STATE, WEEKLY_UNITS, DC_SOH, STORE_SOH, STORES, STORES_OUT, INBOUND_UNITS, INBOUND_ETA FROM ${A}.DC_STOCK_POSITION
  WHERE BRAND_NAME = ? AND CLASS = ? ORDER BY DC_STATE`, [sc.brand, sc.cls]).map((d) => ({
    dc_state: d.dc_state, weekly_units: r1(d.weekly_units), dc_stock_units: d.dc_soh, store_stock_units: d.store_soh,
    cover_weeks: d.weekly_units ? r1((d.dc_soh + d.store_soh) / d.weekly_units) : null, stores: d.stores, stores_out: d.stores_out,
    transferable_units: d.dc_state === sc.dc ? 0 : Math.max(0, Math.floor(d.dc_soh - floor * d.weekly_units)),
    inbound_units: d.inbound_units, inbound_eta: d.inbound_eta }));
const me = dcs.find((d) => d.dc_state === sc.dc);
const pos = rows(`SELECT PO_NUMBER, ORDER_DATE, EXPECTED_DELIVERY_DATE, ACTUAL_DELIVERY_DATE, STATUS, ORDERED_UNITS, DELIVERED_UNITS, FORECAST_UNITS,
    ROUND(100 * DELIVERED_UNITS / NULLIF(ORDERED_UNITS, 0), 1) AS FILL_PCT, DISCREPANCY_TYPE, IS_DIFOT
  FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC WHERE BRAND_NAME = ? AND SKU_CLASS = ? AND DC_STATE = ? AND ORDER_DATE >= '2026-03-01' ORDER BY ORDER_DATE`, [sc.brand, sc.cls, sc.dc]);
const since = pos.filter((p) => p.status === "DELIVERED" && p.expected_delivery_date >= "2026-05-01");
const fillSince = since.length ? r1(100 * since.reduce((s, p) => s + p.delivered_units, 0) / since.reduce((s, p) => s + p.ordered_units, 0)) : null;
const before = pos.filter((p) => p.status === "DELIVERED" && p.expected_delivery_date < "2026-05-01");
const fillBefore = before.length ? r1(100 * before.reduce((s, p) => s + p.delivered_units, 0) / before.reduce((s, p) => s + p.ordered_units, 0)) : null;
const open = pos.filter((p) => p.status !== "DELIVERED");
const otherDcFill = rows(`SELECT DC_STATE, ROUND(100 * SUM(DELIVERED_UNITS) / NULLIF(SUM(ORDERED_UNITS), 0), 1) AS FILL_PCT FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC
  WHERE BRAND_NAME = ? AND SKU_CLASS = ? AND STATUS = 'DELIVERED' AND EXPECTED_DELIVERY_DATE >= '2026-05-01' GROUP BY 1 ORDER BY 1`, [sc.brand, sc.cls]);
const difot = rows(`SELECT FISCAL_WEEK, DIFOT_PCT FROM ${A}.DT_SUPPLIER_DIFOT WHERE BRAND_NAME = ? AND CLASS IS NULL AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 10 AND 19 ORDER BY 1`, [sc.brand]);
const sup = rows(`SELECT d.SUPPLIER_NAME, d.STD_LEAD_TIME_DAYS, d.SOURCING_TYPE, d.IS_3PL_VIABLE, d.ESTIMATED_3PL_DAYS, d.PRIMARY_CARRIER, d.TRANSPORT_MODE,
    p.MIN_ORDER_QTY, p.ORDER_FREQUENCY_DAYS
  FROM ${C}.DIM_DISTRIBUTOR d LEFT JOIN ${A}.BRAND_SUPPLY_PROFILE p ON p.BRAND_NAME = ?
  WHERE ARRAY_CONTAINS(?::VARIANT, SPLIT(d.BRANDS, ','))`, [sc.brand, sc.brand])[0] || {};
const outCodes = JSON.stringify(out.map((s) => s.store_code));
const camps = rows(`SELECT c.CAMPAIGN_ID, c.NAME, c.STATUS, c.START_DATE, c.END_DATE, c.PROMOTED_CLASS,
    (SELECT COUNT(*) FROM ${K}.AUDIENCE_MEMBER m WHERE m.CAMPAIGN_ID = c.CAMPAIGN_ID AND m.GROUP_CODE = 'TREATED'
       AND m.HOME_STORE_CODE IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))) AS TREATED_AT_OUT_STORES,
    (SELECT COUNT(*) FROM ${K}.AUDIENCE_MEMBER m WHERE m.CAMPAIGN_ID = c.CAMPAIGN_ID AND m.GROUP_CODE = 'TREATED') AS TREATED
  FROM ${K}.CAMPAIGN c WHERE c.PROMOTED_BRAND = ? AND c.STATUS NOT IN ('MEASURED', 'CANCELLED', 'REJECTED') ORDER BY c.START_DATE`, [outCodes, sc.brand]);
const guard = rows(`SELECT STATUS, COUNT(*) AS STORES, LISTAGG(DISTINCT STATE, ', ') WITHIN GROUP (ORDER BY STATE) AS STATES, ANY_VALUE(REASON) AS REASON
  FROM ${K}.SUPPLY_POSITION WHERE BRAND_NAME = ? GROUP BY 1 ORDER BY 1`, [sc.brand]);
const outWeekly = out.reduce((s, x) => s + x.weekly_units, 0);
return JSON.stringify({ ok: true, brand: sc.brand, class: sc.cls, dc_state: sc.dc, classes: sc.classes, as_of: asOf,
  provenance: "Stock positions are MODELLED as of the supply clock, consistent with the campaign's SUPPLY_POSITION. Demand (POS, 8 weeks to 7 May 2026), prices, the supplier's fill rate, lead time and DIFOT are real rows.",
  region: { dc_state: sc.dc, stores: stores.length, stores_out: out.length, stores_low: stores.filter((s) => s.stock_status === "LOW").length,
    weekly_units: me ? me.weekly_units : null, dc_stock_units: me ? me.dc_stock_units : null, store_stock_units: me ? me.store_stock_units : null,
    cover_weeks: me ? me.cover_weeks : null, out_store_weekly_units: r1(outWeekly),
    asp_aud: r2(price.asp), margin_pct: price.mrg === null ? null : r1(price.mrg * 100), lost_sales_per_week_aud: Math.round(outWeekly * (price.asp || 0)) },
  stores_out: out.map((s) => ({ store_code: s.store_code, store_name: s.store_name, state: s.state, weekly_units: r1(s.weekly_units) })),
  dc_position: dcs, source_floor_weeks: floor,
  cause: { supplier: sup.supplier_name || null, fill_since_1_may_pct: fillSince, fill_before_1_may_pct: fillBefore,
    short_shipped_pos: since.filter((p) => p.discrepancy_type === "SHORT_SHIPPED").map((p) => ({ po: p.po_number, delivered_on: p.actual_delivery_date, ordered_units: p.ordered_units, delivered_units: p.delivered_units, fill_pct: p.fill_pct })),
    open_pos: open.map((p) => ({ po: p.po_number, due: p.expected_delivery_date, status: p.status, ordered_units: p.ordered_units, expected_fill_units: p.forecast_units })),
    other_dcs_fill_since_1_may: otherDcFill,
    note: "PO units are DC replenishment units, not on the POS scale: read them for fill rate and timing only." },
  supplier_difot_weekly: difot.map((d) => ({ fiscal_week: d.fiscal_week, difot_pct: d.difot_pct })),
  supplier: { name: sup.supplier_name || null, lead_days: sup.std_lead_time_days ?? null, sourcing: sup.sourcing_type || null,
    expedite_3pl_viable: sup.is_3pl_viable === true, expedite_3pl_days: sup.estimated_3pl_days ?? null, carrier: sup.primary_carrier || null,
    min_order_units: sup.min_order_qty ?? null, order_frequency_days: sup.order_frequency_days ?? null },
  campaigns: camps.map((c) => ({ campaign_id: c.campaign_id, name: c.name, status: c.status, start: c.start_date, end: c.end_date, promoted_class: c.promoted_class,
    treated_members: c.treated, treated_members_at_out_stores: c.treated_at_out_stores })),
  campaign_guardrail: guard.map((g) => ({ status: g.status, stores: g.stores, states: g.states, reason: g.reason })),
  next_step: "Call BuildRecoveryPlan with the same brand, class and DC state to cost the options." });
$$;

-- ---------- BUILD_RECOVERY_PLAN ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.AI.BUILD_RECOVERY_PLAN(BRAND VARCHAR, CLASS VARCHAR, STATE VARCHAR, TARGET_WEEKS FLOAT, REQUEST VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Costs up to three ways to recover a stockout (inter-DC transfer, emergency PO, both or an expedited 3PL PO) against doing nothing, and writes them as a DRAFT plan for a person to approve.'
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
const exec = (sql, binds) => snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute();
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const DC = { ACT: "NSW", TAS: "VIC", NT: "QLD" };
// Road transit between DCs, days.
const ROAD = { "NSW-VIC": 2, "NSW-QLD": 2, "NSW-SA": 3, "NSW-WA": 5, "VIC-QLD": 3, "VIC-SA": 2, "VIC-WA": 5, "QLD-SA": 3, "QLD-WA": 6, "SA-WA": 4 };
const transit = (a, b) => ROAD[`${a}-${b}`] ?? ROAD[`${b}-${a}`] ?? 5;
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Same resolution as STOCKOUT_EVIDENCE.
const B = rows(`SELECT BRAND_NAME, CLASS, DC_STATE, STORES_OUT, WEEKLY_UNITS, DC_SOH + STORE_SOH AS SOH FROM ${A}.DC_STOCK_POSITION`);
const bk = String(BRAND || "").trim().toUpperCase();
let hit = B.filter((r) => r.brand_name.toUpperCase() === bk);
if (!hit.length && bk.length >= 3) hit = B.filter((r) => r.brand_name.toUpperCase().includes(bk));
if (!hit.length) return JSON.stringify({ ok: false, error: `No stock position for brand '${BRAND}'.`, valid_brands: [...new Set(B.map((r) => r.brand_name))].sort() });
const brand = hit[0].brand_name, mine = B.filter((r) => r.brand_name === brand);
const classes = [...new Set(mine.map((r) => r.class))].sort();
const ck = String(CLASS || "").trim().toUpperCase().replace(/S$/, "");
let cls = null;
if (ck && !/^(ALL|ANY|NONE|\*)$/.test(ck)) {
  cls = classes.find((c) => c.toUpperCase().replace(/S$/, "") === ck) || classes.find((c) => c.toUpperCase().includes(ck));
  if (!cls) return JSON.stringify({ ok: false, error: `${brand} has no class matching '${CLASS}'.`, valid_classes: classes });
}
const sk = String(STATE || "").trim().toUpperCase();
let dc = sk && !/^(ALL|ANY|NATIONAL)$/.test(sk) ? (DC[sk] || sk) : null;
if (dc && !mine.some((r) => r.dc_state === dc)) return JSON.stringify({ ok: false, error: `No DC '${STATE}'.`, valid_dcs: [...new Set(mine.map((r) => r.dc_state))].sort() });
const pick = mine.filter((r) => (!cls || r.class === cls) && (!dc || r.dc_state === dc))
  .sort((a, b) => b.stores_out - a.stores_out || (a.soh / (a.weekly_units || 1)) - (b.soh / (b.weekly_units || 1)))[0];
cls = cls || pick.class; dc = dc || pick.dc_state;

const set = {};
for (const s of rows(`SELECT SETTING_KEY, SETTING_VALUE FROM ${A}.SUPPLY_SETTING`)) set[s.setting_key] = s.setting_value;
const asOf = rows(`SELECT ${A}.SUPPLY_AS_OF() AS D`)[0].d;
const T = Math.min(8, Math.max(2, Number(TARGET_WEEKS) || Number(set.TARGET_COVER_WEEKS) || 4));
const FLOOR = Number(set.SOURCE_FLOOR_WEEKS) || 3, XFER = Number(set.TRANSFER_COST_PER_UNIT_AUD) || 1.15;
const EXPEDITE = (Number(set.EXPEDITE_PREMIUM_PCT) || 12) / 100;

const D = rows(`SELECT DC_STATE, WEEKLY_UNITS, DC_SOH, STORE_SOH, STORES_OUT FROM ${A}.DC_STOCK_POSITION WHERE BRAND_NAME = ? AND CLASS = ?`, [brand, cls]);
const me = D.find((d) => d.dc_state === dc);
if (!me || !me.weekly_units) return JSON.stringify({ ok: false, error: `${brand} ${cls} has no demand in the ${dc} DC region.` });
const out = rows(`SELECT STORE_CODE, STATE, WEEKLY_UNITS FROM ${A}.STORE_STOCK_POSITION WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ? AND STOCK_STATUS = 'OUT'`, [brand, cls, dc]);
const outWeekly = out.reduce((s, x) => s + x.weekly_units, 0);
const price = rows(`SELECT SUM(f.NET_REVENUE) / NULLIF(SUM(f.QUANTITY), 0) AS ASP, SUM(f.MARGIN_AMOUNT) / NULLIF(SUM(f.NET_REVENUE), 0) AS MRG
  FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY
  WHERE b.BRAND_NAME = ? AND p.CLASS = ? AND f.DATE_KEY BETWEEN 20260313 AND 20260507`, [brand, cls])[0];
const unitCost = rows(`SELECT AVG(p.UNIT_COST) AS C FROM ${C}.DIM_PRODUCT p JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY WHERE b.BRAND_NAME = ? AND p.CLASS = ?`, [brand, cls])[0].c || 0;
const sup = rows(`SELECT d.SUPPLIER_NAME, d.STD_LEAD_TIME_DAYS, d.IS_3PL_VIABLE, d.ESTIMATED_3PL_DAYS, p.MIN_ORDER_QTY, p.ORDER_FREQUENCY_DAYS
  FROM ${C}.DIM_DISTRIBUTOR d LEFT JOIN ${A}.BRAND_SUPPLY_PROFILE p ON p.BRAND_NAME = ? WHERE ARRAY_CONTAINS(?::VARIANT, SPLIT(d.BRANDS, ','))`, [brand, brand])[0] || {};
const lead = Number(sup.std_lead_time_days) || 14, moq = Number(sup.min_order_qty) || 0, freq = Number(sup.order_frequency_days) || 21;
const fillRow = rows(`SELECT SUM(DELIVERED_UNITS) AS D, SUM(ORDERED_UNITS) AS O FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC
  WHERE BRAND_NAME = ? AND SKU_CLASS = ? AND DC_STATE = ? AND STATUS = 'DELIVERED' AND EXPECTED_DELIVERY_DATE >= '2026-05-01'`, [brand, cls, dc])[0];
const fill = fillRow.o ? fillRow.d / fillRow.o : 1;
const asp = price.asp || 0, mrg = price.mrg || 0;

const W = me.weekly_units, have = me.dc_soh + me.store_soh;
const need = Math.max(0, Math.ceil(T * W - have));
const src = D.filter((d) => d.dc_state !== dc).map((d) => Object.assign(d, { spare: Math.max(0, Math.floor(d.dc_soh - FLOOR * d.weekly_units)) }))
  .sort((a, b) => b.spare - a.spare || transit(a.dc_state, dc) - transit(b.dc_state, dc))[0];
const lostOver = (days) => Math.round(outWeekly / 7 * days * asp);
const members = rows(`SELECT COUNT(*) AS N FROM ${K}.AUDIENCE_MEMBER m JOIN ${K}.CAMPAIGN c ON c.CAMPAIGN_ID = m.CAMPAIGN_ID
  WHERE c.PROMOTED_BRAND = ? AND c.STATUS NOT IN ('MEASURED', 'CANCELLED', 'REJECTED') AND m.GROUP_CODE = 'TREATED'
    AND m.HOME_STORE_CODE IN (SELECT VALUE::STRING FROM TABLE(FLATTEN(PARSE_JSON(?))))`, [brand, JSON.stringify(out.map((s) => s.store_code))])[0].n;

// Doing nothing: the next regular order cycle, then the lead time; and at the
// supplier's recent fill rate that order lands short too.
const baseDays = freq + lead + 1;
const baseline = { label: "Do nothing", first_stock_date: addDays(asOf, baseDays), stockout_days: baseDays, lost_sales_aud: lostOver(baseDays),
  lost_margin_aud: Math.round(lostOver(baseDays) * mrg),
  note: `The next regular order (every ${freq} days) plus the ${lead}-day lead time, and the supplier has filled ${Math.round(fill * 100)}% of ${dc} ${cls} POs since 1 May, so it would land short again.` };

const opts = [];
function option(o) {
  const g = [];
  const stockoutDays = o.first_stock_date ? Math.round((new Date(o.first_stock_date) - new Date(asOf)) / 864e5) : baseDays;
  const landed = (o.transfer_units || 0) + Math.round((o.po_units || 0) * (o.kind === "TRANSFER" ? 0 : fill));
  const cover = r1((have + landed) / W);
  const srcAfter = o.transfer_units && src ? r1((src.dc_soh - o.transfer_units + src.store_soh) / src.weekly_units) : null;
  let feasible = true;
  if ((o.kind === "TRANSFER" || o.kind === "BOTH") && (!src || src.spare <= 0)) { feasible = false; g.push({ level: "BLOCK", message: `No DC can spare ${cls} without dropping below ${FLOOR} weeks of its own cover.` }); }
  if (srcAfter !== null && srcAfter < FLOOR) g.push({ level: "BLOCK", message: `${src.dc_state} would be left with ${srcAfter} weeks of cover, under the ${FLOOR}-week floor.` });
  if (o.po_units && fill < 0.9) g.push({ level: "CAUTION", message: `${sup.supplier_name} has filled ${Math.round(fill * 100)}% of ${dc} ${cls} POs since 1 May; at that rate this PO lands about ${Math.round(o.po_units * fill)} of ${o.po_units} units. Confirm the quantity with the supplier before relying on it.` });
  if (o.po_units && moq && o.po_units === moq) g.push({ level: "INFO", message: `Rounded up to the ${moq}-unit minimum order.` });
  if (cover !== null && cover > 12) g.push({ level: "CAUTION", message: `${cover} weeks of cover once everything lands: overstock risk.` });
  if (cover !== null && cover < T) g.push({ level: "CAUTION", message: `Cover reaches ${cover} weeks, short of the ${T}-week target: the region stays exposed to the next short shipment.` });
  // Does the stock last until supply the region can count on? A transfer alone
  // runs out before the next regular order (which lands short) arrives.
  // A transfer alone only counts if it lasts until the next regular order AND that
  // order can be relied on: while the supplier short-ships, it cannot.
  const sustained = (o.po_units || 0) > 0 || (cover !== null && o.first_stock_date && stockoutDays + cover * 7 >= baseDays && fill >= 0.9);
  const runsOut = cover !== null && o.first_stock_date ? addDays(o.first_stock_date, Math.floor(cover * 7)) : null;
  if (!sustained && runsOut) g.push({ level: "CAUTION", message: `Stock runs out around ${runsOut}. No ${dc} ${cls} PO is open; the next regular order lands ${baseline.first_stock_date}, and at the supplier's ${Math.round(fill * 100)}% fill rate it cannot be relied on.` });
  const lifts = !!o.first_stock_date && stockoutDays <= 7;
  const r = Object.assign(o, {
    stockout_days: stockoutDays, lost_sales_aud: lostOver(stockoutDays), lost_margin_aud: Math.round(lostOver(stockoutDays) * mrg),
    lost_sales_avoided_aud: Math.max(0, baseline.lost_sales_aud - lostOver(stockoutDays)),
    transfer_cost_aud: r2((o.transfer_units || 0) * XFER), stock_value_aud: Math.round((o.po_units || 0) * unitCost),
    cover_after_weeks: cover, source_cover_after_weeks: srcAfter, restores_target: cover !== null && cover >= T, sustained: !!sustained, runs_out_date: sustained ? null : runsOut,
    lifts_shortage: lifts, feasible: feasible && !g.some((x) => x.level === "BLOCK"), guardrails: g });
  opts.push(r);
}
const xUnits = src ? Math.min(src.spare, need) : 0;
const tDays = src ? transit(src.dc_state, dc) : null;
option({ option_id: "A", kind: "TRANSFER", label: xUnits > 0 ? `Move ${xUnits} units from ${src.dc_state} DC` : "Move stock between DCs (no DC can spare any)",
  transfer_from_dc: src ? src.dc_state : null, transfer_units: xUnits, transit_days: tDays, po_units: 0, lead_days: null,
  first_stock_date: src && xUnits > 0 ? addDays(asOf, tDays + 1) : null, po_due_date: null });
const poUnits = Math.max(moq, Math.ceil(need + W * lead / 7));
option({ option_id: "B", kind: "PO", label: `Emergency PO of ${poUnits} units to ${sup.supplier_name}`, transfer_from_dc: null, transfer_units: 0,
  transit_days: null, po_units: poUnits, lead_days: lead, first_stock_date: addDays(asOf, lead + 1), po_due_date: addDays(asOf, lead) });
if (xUnits > 0) {
  // Both: the transfer bridges the lead time; the PO rebuilds the target after it
  // and replaces what the source gave up.
  const poBoth = Math.max(moq, Math.ceil(T * W + W * lead / 7 - (have + xUnits) + xUnits));
  option({ option_id: "C", kind: "BOTH", label: `Move ${xUnits} units from ${src.dc_state} now, and PO ${poBoth} units`,
    transfer_from_dc: src.dc_state, transfer_units: xUnits, transit_days: tDays, po_units: poBoth, lead_days: lead,
    first_stock_date: addDays(asOf, tDays + 1), po_due_date: addDays(asOf, lead) });
} else if (sup.is_3pl_viable === true && Number(sup.estimated_3pl_days) < lead) {
  // Nothing to transfer: the faster route is the same PO through a 3PL.
  const fast = Number(sup.estimated_3pl_days);
  const poFast = Math.max(moq, Math.ceil(need + W * fast / 7));
  option({ option_id: "C", kind: "PO_EXPEDITED", label: `Expedited PO of ${poFast} units via 3PL (${fast} days)`, transfer_from_dc: null,
    transfer_units: 0, transit_days: null, po_units: poFast, lead_days: fast, first_stock_date: addDays(asOf, fast + 1), po_due_date: addDays(asOf, fast) });
  const c = opts[opts.length - 1];
  c.expedite_premium_aud = Math.round(c.stock_value_aud * EXPEDITE);
  c.transfer_cost_aud = c.expedite_premium_aud;
  c.guardrails.push({ level: "INFO", message: `Expedite premium AUD ${c.expedite_premium_aud} (${Math.round(EXPEDITE * 100)}% of stock value, an assumption), shown as the transfer cost.` });
}

// Recommend: a feasible option that restores the target and lasts until supply
// the region can count on, earliest stock first, then cheapest.
const ranked = opts.filter((o) => o.feasible && o.restores_target && o.sustained).sort((a, b) => a.stockout_days - b.stockout_days || a.transfer_cost_aud - b.transfer_cost_aud);
const rec = (ranked[0] || opts.filter((o) => o.feasible).sort((a, b) => a.stockout_days - b.stockout_days)[0] || opts[0]).option_id;

// Write the DRAFT. Older drafts for the same brand, class and DC are superseded.
// RCV-<11 chars>: the PO it may place, PO-RCV-<11>, fits the 20-character PO_NUMBER.
const planId = "RCV-" + rows(`SELECT TO_CHAR(CURRENT_TIMESTAMP(), 'MMDDHH24MISS') || LPAD(UNIFORM(0, 9, RANDOM())::STRING, 1, '0') AS ID`)[0].id;
exec(`UPDATE ${A}.SUPPLY_RECOVERY_PLAN SET STATUS = 'SUPERSEDED' WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ? AND STATUS = 'DRAFT'`, [brand, cls, dc]);
exec(`INSERT INTO ${A}.SUPPLY_RECOVERY_PLAN (PLAN_ID, BRAND_NAME, CLASS, DC_STATE, TARGET_WEEKS, STATUS, REQUEST, CREATED_BY, CREATED_AT, RECOMMENDED_OPTION)
  VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, 'Stockout Recovery agent', CURRENT_TIMESTAMP(), ?)`, [planId, brand, cls, dc, T, String(REQUEST || "").slice(0, 2000), rec]);
for (const o of opts) {
  exec(`INSERT INTO ${A}.SUPPLY_RECOVERY_OPTION SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::DATE, ?::DATE, ?, ?, ?, ?, ?, ?, ?::BOOLEAN, ?::BOOLEAN, ?::BOOLEAN, PARSE_JSON(?)`,
    [planId, o.option_id, o.kind, o.label, o.transfer_from_dc, o.transfer_units, o.transit_days, o.po_units, Math.round((o.po_units || 0) * fill),
     o.lead_days, o.first_stock_date, o.po_due_date, o.stockout_days, o.transfer_cost_aud, o.stock_value_aud, o.lost_sales_aud,
     o.cover_after_weeks, o.source_cover_after_weeks, String(o.restores_target), String(o.lifts_shortage), String(o.feasible), JSON.stringify(o.guardrails)]);
}
exec(`INSERT INTO ${A}.SUPPLY_RECOVERY_STORE SELECT ?, sp.BRAND_NAME, sp.STORE_CODE, sp.STATE, sp.STATUS, sp.REASON, sp.PROVENANCE
  FROM ${K}.SUPPLY_POSITION sp WHERE sp.BRAND_NAME = ? AND sp.STATUS = 'SHORT'
    AND CASE sp.STATE WHEN 'ACT' THEN 'NSW' WHEN 'TAS' THEN 'VIC' WHEN 'NT' THEN 'QLD' ELSE sp.STATE END = ?`, [planId, brand, dc]);
const shortStores = rows(`SELECT COUNT(*) AS N FROM ${A}.SUPPLY_RECOVERY_STORE WHERE PLAN_ID = ?`, [planId])[0].n;

return JSON.stringify({ ok: true, plan_id: planId, status: "DRAFT", brand, class: cls, dc_state: dc, as_of: asOf, target_cover_weeks: T,
  region: { weekly_units: r1(W), stock_units: have, cover_weeks: r1(have / W), units_needed_for_target: need, stores_out: out.length,
    out_store_weekly_units: r1(outWeekly), asp_aud: r2(asp), margin_pct: r1(mrg * 100), unit_cost_aud: r2(unitCost) },
  supplier: { name: sup.supplier_name, lead_days: lead, min_order_units: moq, order_frequency_days: freq, fill_since_1_may_pct: r1(fill * 100) },
  source_dc: src ? { dc_state: src.dc_state, spare_units: src.spare, transit_days: tDays, cover_weeks: r1((src.dc_soh + src.store_soh) / src.weekly_units) } : null,
  do_nothing: baseline, options: opts, recommended: rec,
  campaign_effect: { short_stores_in_guardrail: shortStores, treated_members_at_out_stores: members,
    rule: "An approved option whose first stock lands within 7 days moves these stores from SHORT to LOW in CAMPAIGN.SUPPLY_POSITION, which lifts the campaign's stock suppression and its BLOCK guardrail (a LOW store is a CAUTION). A PO-only option keeps them SHORT until stock lands." },
  assumptions: [`Transfer cost AUD ${XFER} per unit (no rate card is loaded).`, `A source DC keeps at least ${FLOOR} weeks of its own cover.`,
    "Store delivery adds 1 day after a DC receives stock.", `An expedited 3PL PO costs ${Math.round(EXPEDITE * 100)}% of its stock value extra.`, `A PO lands at the supplier's recent fill rate (${Math.round(fill * 100)}%) for cover purposes.`,
    "Stock positions are modelled; demand, prices, costs, lead time and fill rate are real."],
  rule: "Recommended: a feasible option that restores the target cover and lasts until the next supply the region can count on, earliest first stock, then lowest transfer cost.",
  next_step: "A person approves one option on the Stockout recovery page; you do not approve." });
$$;

-- ---------- APPROVE_RECOVERY (called by the app, never the agent) ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.APPROVE_RECOVERY(PLAN_ID VARCHAR, OPTION_ID VARCHAR, APPROVER VARCHAR, NOTE VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Approves one option of a DRAFT recovery plan: places the PO, books the transfer, and lifts the stores from SHORT to LOW in CAMPAIGN.SUPPLY_POSITION when stock lands within 7 days.'
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
const exec = (sql, binds) => snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute();
const plan = rows(`SELECT * FROM ${A}.SUPPLY_RECOVERY_PLAN WHERE PLAN_ID = ?`, [PLAN_ID])[0];
if (!plan) return JSON.stringify({ ok: false, error: `No plan ${PLAN_ID}.` });
if (plan.status !== "DRAFT") return JSON.stringify({ ok: false, error: `Plan ${PLAN_ID} is ${plan.status}; only a DRAFT can be approved.` });
const o = rows(`SELECT * FROM ${A}.SUPPLY_RECOVERY_OPTION WHERE PLAN_ID = ? AND OPTION_ID = ?`, [PLAN_ID, OPTION_ID])[0];
if (!o) return JSON.stringify({ ok: false, error: `Plan ${PLAN_ID} has no option ${OPTION_ID}.` });
if (!o.feasible) return JSON.stringify({ ok: false, error: `Option ${OPTION_ID} is blocked by a guardrail and cannot be approved.` });
const by = String(APPROVER || "").slice(0, 100) || "unknown";
const asOf = rows(`SELECT ${A}.SUPPLY_AS_OF() AS D`)[0].d;
exec("BEGIN");
try {
  let po = null, transfer = null;
  if (o.po_units > 0) {
    po = "PO-RCV-" + PLAN_ID.slice(4);
    const sup = rows(`SELECT d.SUPPLIER_NAME, d.PRIMARY_CARRIER, d.TRANSPORT_MODE FROM ${C}.DIM_DISTRIBUTOR d WHERE ARRAY_CONTAINS(?::VARIANT, SPLIT(d.BRANDS, ','))`, [plan.brand_name])[0] || {};
    const cat = rows(`SELECT MAX(p.CATEGORY) AS C FROM ${C}.DIM_PRODUCT p JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY WHERE b.BRAND_NAME = ?`, [plan.brand_name])[0].c;
    exec(`INSERT INTO ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC (PO_NUMBER, ORDER_DATE, EXPECTED_DELIVERY_DATE, BRAND_NAME, SKU_CLASS, CATEGORY, SUPPLIER_NAME, DC_STATE,
        ORDERED_UNITS, FORECAST_UNITS, STD_LEAD_TIME_DAYS, IS_OVERTRADED, IS_RUSH_ORDER, STATUS, CARRIER, TRANSPORT_MODE, HAS_DISCREPANCY)
      VALUES (?, ?::DATE, ?::DATE, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, TRUE, 'ON_ORDER', ?, ?, FALSE)`,
      [po, asOf, o.po_due_date, plan.brand_name, plan.class, cat, sup.supplier_name, plan.dc_state, o.po_units, o.po_expected_fill_units, o.lead_days,
       sup.primary_carrier || null, sup.transport_mode || null]);
  }
  if (o.transfer_units > 0) {
    transfer = "TRF-" + PLAN_ID.slice(4);
    const eta = rows(`SELECT DATEADD(DAY, ?, ?::DATE) AS D`, [o.transit_days, asOf])[0].d;
    exec(`INSERT INTO ${A}.SUPPLY_TRANSFER VALUES (?, ?, ?, ?, ?, ?, ?, ?::DATE, ?::DATE, 'IN_TRANSIT')`,
      [transfer, PLAN_ID, plan.brand_name, plan.class, o.transfer_from_dc, plan.dc_state, o.transfer_units, asOf, eta]);
    exec(`UPDATE ${A}.DC_STOCK_POSITION SET DC_SOH = DC_SOH - ? WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ?`, [o.transfer_units, plan.brand_name, plan.class, o.transfer_from_dc]);
    exec(`UPDATE ${A}.DC_STOCK_POSITION SET INBOUND_UNITS = INBOUND_UNITS + ?, INBOUND_ETA = ?::DATE WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ?`,
      [o.transfer_units, eta, plan.brand_name, plan.class, plan.dc_state]);
  }
  // The campaign side: stock landing within a week lifts SHORT to LOW.
  const what = [transfer ? `${o.transfer_units} units from ${o.transfer_from_dc} DC arrive ${o.first_stock_date}` : null,
                po ? `PO ${po} for ${o.po_units} units due ${o.po_due_date}` : null].filter(Boolean).join("; ");
  let lifted = 0;
  if (o.lifts_shortage) {
    exec(`UPDATE ${K}.SUPPLY_POSITION sp SET STATUS = 'LOW', PROVENANCE = 'RECOVERY_PLAN',
        REASON = ? FROM ${A}.SUPPLY_RECOVERY_STORE rs
      WHERE rs.PLAN_ID = ? AND sp.BRAND_NAME = rs.BRAND_NAME AND sp.STORE_CODE = rs.STORE_CODE AND sp.STATUS = 'SHORT'`,
      [`Recovery ${PLAN_ID} approved by ${by}: ${what}. Cover stays thin until it lands.`, PLAN_ID]);
    lifted = rows(`SELECT COUNT(*) AS N FROM ${K}.SUPPLY_POSITION sp JOIN ${A}.SUPPLY_RECOVERY_STORE rs ON rs.STORE_CODE = sp.STORE_CODE AND rs.BRAND_NAME = sp.BRAND_NAME
      WHERE rs.PLAN_ID = ? AND sp.PROVENANCE = 'RECOVERY_PLAN'`, [PLAN_ID])[0].n;
    exec(`UPDATE ${A}.STOCK_ALERTS SET IS_RESOLVED = TRUE WHERE BRAND_NAME = ? AND IS_RESOLVED = FALSE AND ALERT_TYPE = 'critical'`, [plan.brand_name]);
  } else {
    exec(`UPDATE ${K}.SUPPLY_POSITION sp SET REASON = ? FROM ${A}.SUPPLY_RECOVERY_STORE rs
      WHERE rs.PLAN_ID = ? AND sp.BRAND_NAME = rs.BRAND_NAME AND sp.STORE_CODE = rs.STORE_CODE AND sp.STATUS = 'SHORT'`,
      [`Short until ${o.first_stock_date}: recovery ${PLAN_ID} approved by ${by}: ${what}.`, PLAN_ID]);
  }
  const effect = { po, transfer, stores_lifted_to_low: lifted, lifts_shortage: !!o.lifts_shortage, first_stock_date: o.first_stock_date };
  exec(`UPDATE ${A}.SUPPLY_RECOVERY_PLAN SET STATUS = 'APPROVED', APPROVED_OPTION = ?, APPROVED_BY = ?, APPROVED_AT = CURRENT_TIMESTAMP(), APPROVAL_NOTE = ?, EFFECT = PARSE_JSON(?)
    WHERE PLAN_ID = ?`, [OPTION_ID, by, String(NOTE || "").slice(0, 1000), JSON.stringify(effect), PLAN_ID]);
  exec(`UPDATE ${A}.SUPPLY_RECOVERY_PLAN SET STATUS = 'SUPERSEDED' WHERE BRAND_NAME = ? AND CLASS = ? AND DC_STATE = ? AND STATUS = 'DRAFT'`, [plan.brand_name, plan.class, plan.dc_state]);
  exec("COMMIT");
  return JSON.stringify(Object.assign({ ok: true, plan_id: PLAN_ID, option_id: OPTION_ID, approved_by: by }, effect));
} catch (e) {
  exec("ROLLBACK");
  return JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 400) });
}
$$;

-- ---------- RESET_RECOVERY_DEMO (rehearsals) ----------
CREATE OR REPLACE PROCEDURE BABY_MART_DEMO.ANALYTICS.RESET_RECOVERY_DEMO()
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Undoes every approved recovery: restores CAMPAIGN.SUPPLY_POSITION, deletes recovery POs and transfers, restores DC stock and the alerts.'
EXECUTE AS OWNER
AS
$$
const A = "BABY_MART_DEMO.ANALYTICS", K = "BABY_MART_DEMO.CAMPAIGN";
const exec = (sql, binds) => snowflake.createStatement({ sqlText: sql, binds: binds || [] }).execute();
const one = (sql) => { const rs = exec(sql); rs.next(); return rs.getColumnValue(1); };
const n = one(`SELECT COUNT(*) FROM ${A}.SUPPLY_RECOVERY_PLAN WHERE STATUS IN ('APPROVED', 'DRAFT')`);
exec(`UPDATE ${K}.SUPPLY_POSITION sp SET STATUS = rs.PRIOR_STATUS, REASON = rs.PRIOR_REASON, PROVENANCE = rs.PRIOR_PROVENANCE
  FROM (SELECT * FROM ${A}.SUPPLY_RECOVERY_STORE QUALIFY ROW_NUMBER() OVER (PARTITION BY BRAND_NAME, STORE_CODE ORDER BY PLAN_ID) = 1) rs
  WHERE sp.BRAND_NAME = rs.BRAND_NAME AND sp.STORE_CODE = rs.STORE_CODE`);
exec(`DELETE FROM ${A}.FORECAST_REPLENISHMENT_SUPPLIER_DC WHERE PO_NUMBER LIKE 'PO-RCV-%'`);
exec(`DELETE FROM ${A}.SUPPLY_TRANSFER`);
exec(`UPDATE ${A}.DC_STOCK_POSITION SET DC_SOH = BASE_DC_SOH, INBOUND_UNITS = 0, INBOUND_ETA = NULL`);
exec(`UPDATE ${A}.STOCK_ALERTS SET IS_RESOLVED = FALSE WHERE ALERT_ID IN ('ALT-001', 'ALT-002')`);
exec(`UPDATE ${A}.SUPPLY_RECOVERY_PLAN SET STATUS = 'RESET' WHERE STATUS IN ('APPROVED', 'DRAFT')`);
exec(`DELETE FROM ${A}.SUPPLY_RECOVERY_STORE`);
return JSON.stringify({ ok: true, plans_reset: n });
$$;
