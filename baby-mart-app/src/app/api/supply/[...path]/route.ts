import { NextRequest, NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function safeFloat(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function safeInt(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : Math.round(n);
}

// State mapping: ACT→NSW, NT→QLD, TAS→VIC (served by nearest DC)
const STATE_MAP_CASE = `CASE WHEN STATE='ACT' THEN 'NSW' WHEN STATE='NT' THEN 'QLD' WHEN STATE='TAS' THEN 'VIC' ELSE STATE END`;

// Planned restocks: sized for pre-surge demand
const PLANNED_RESTOCKS: Record<string, { week: number; qty: number }> = {
  NSW: { week: 3, qty: 200 },
  QLD: { week: 3, qty: 180 },
  VIC: { week: 4, qty: 220 },
  WA: { week: 4, qty: 160 },
  SA: { week: 4, qty: 80 },
};

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segments = path.map(decodeURIComponent);
  const { searchParams } = request.nextUrl;

  try {
    // ─── /supply/brand/{brandName} ──────────────────────────────────
    if (segments[0] === "brand" && segments.length === 2) {
      return NextResponse.json(await handleBrandSupply(segments[1]));
    }

    // ─── /supply/brand/{brandName}/skus ─────────────────────────────
    if (segments[0] === "brand" && segments[2] === "skus" && segments.length === 3) {
      return NextResponse.json(await handleBrandSkus(segments[1]));
    }

    // ─── /supply/brand/{brandName}/sku/{skuClass}/stores ────────────
    if (
      segments[0] === "brand" &&
      segments[2] === "sku" &&
      segments[4] === "stores" &&
      segments.length === 5
    ) {
      return NextResponse.json(await handleSkuStores(segments[1], segments[3]));
    }

    // ─── /supply/brand/{brandName}/sku/{skuClass} ───────────────────
    if (
      segments[0] === "brand" &&
      segments[2] === "sku" &&
      segments.length === 4
    ) {
      return NextResponse.json(await handleSkuDetail(segments[1], segments[3]));
    }

    // ─── /supply/difot/overview ─────────────────────────────────────
    if (segments[0] === "difot" && segments[1] === "overview" && segments.length === 2) {
      return NextResponse.json(await handleDifotOverview());
    }

    // ─── /supply/difot/{brandName}/sku-trends ───────────────────────
    if (segments[0] === "difot" && segments[2] === "sku-trends" && segments.length === 3) {
      return NextResponse.json(await handleDifotSkuTrends(segments[1]));
    }

    // ─── /supply/difot/{brandName}/skus ─────────────────────────────
    if (segments[0] === "difot" && segments[2] === "skus" && segments.length === 3) {
      return NextResponse.json(await handleDifotSkus(segments[1]));
    }

    // ─── /supply/difot/{brandName} ──────────────────────────────────
    if (segments[0] === "difot" && segments.length === 2) {
      return NextResponse.json(await handleBrandDifot(segments[1]));
    }

    // ─── /supply/demand/{brandName}/{skuClass}/detail ───────────────
    if (
      segments[0] === "demand" &&
      segments[3] === "detail" &&
      segments.length === 4
    ) {
      return NextResponse.json(await handleDemandDetail(segments[1], segments[2]));
    }

    // ─── /supply/demand/trends ──────────────────────────────────────
    if (segments[0] === "demand" && segments[1] === "trends" && segments.length === 2) {
      return NextResponse.json(await handleDemandTrends());
    }

    // ─── /supply/demand/acceleration ────────────────────────────────
    if (segments[0] === "demand" && segments[1] === "acceleration" && segments.length === 2) {
      return NextResponse.json(await handleDemandAcceleration());
    }

    // ─── /supply/demand/by-state ────────────────────────────────────
    if (segments[0] === "demand" && segments[1] === "by-state" && segments.length === 2) {
      return NextResponse.json(await handleDemandByState());
    }

    // ─── /supply/demand/store/{storeName}/profile ───────────────────
    if (
      segments[0] === "demand" &&
      segments[1] === "store" &&
      segments[3] === "profile" &&
      segments.length === 4
    ) {
      const brand = searchParams.get("brand") || "";
      const sku = searchParams.get("sku") || "";
      return NextResponse.json(await handleStoreProfile(segments[2], brand, sku));
    }

    // ─── /supply/stores/demand ──────────────────────────────────────
    if (segments[0] === "stores" && segments[1] === "demand" && segments.length === 2) {
      return NextResponse.json(await handleStoreDemand());
    }

    // ─── /supply/dc/{brandName}/{skuClass}/store-forecast ───────────
    if (
      segments[0] === "dc" &&
      segments[3] === "store-forecast" &&
      segments.length === 4
    ) {
      const change = parseFloat(searchParams.get("change") || "0");
      return NextResponse.json(await handleStoreForecast(segments[1], segments[2], change));
    }

    // ─── /supply/dc/overview ────────────────────────────────────────
    if (segments[0] === "dc" && segments[1] === "overview" && segments.length === 2) {
      return NextResponse.json(await handleDcOverview());
    }

    // ─── /supply/alerts ─────────────────────────────────────────────
    if (segments[0] === "alerts" && segments.length === 1) {
      return NextResponse.json(await handleAlerts());
    }

    // ─── /supply/profiles ───────────────────────────────────────────
    if (segments[0] === "profiles" && segments.length === 1) {
      return NextResponse.json(await handleProfiles());
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: any) {
    console.error("[supply] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── /supply/brand/{brandName} ────────────────────────────────────────────────

async function handleBrandSupply(brandName: string) {
  const brandSafe = escapeSql(brandName);

  const profileSql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_SUPPLY_PROFILE
    WHERE BRAND_NAME = '${brandSafe}'
  `;
  const profileRows = await querySnowflake(profileSql);
  if (!profileRows.length) return { error: "Brand not found" };
  const profile = profileRows[0];

  const inventorySql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_INVENTORY_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}'
    ORDER BY WEEK_DATE
  `;
  const inventory = await querySnowflake(inventorySql);

  return {
    brand: profile.BRAND_NAME,
    category: profile.CATEGORY,
    currentStock: profile.CURRENT_STOCK_UNITS,
    dailyDemand: safeFloat(profile.DAILY_DEMAND),
    weeklyDemand: profile.WEEKLY_DEMAND,
    reorderPoint: profile.REORDER_POINT,
    safetyStock: profile.SAFETY_STOCK,
    leadTimeDays: profile.LEAD_TIME_DAYS,
    avgDeliveryQty: profile.AVG_DELIVERY_QTY,
    nextDelivery: String(profile.NEXT_DELIVERY_DATE),
    nextDeliveryQty: profile.NEXT_DELIVERY_QTY,
    stockoutCostPerDay: profile.STOCKOUT_COST_PER_DAY,
    supplierName: profile.SUPPLIER_NAME,
    orderFrequencyDays: profile.ORDER_FREQUENCY_DAYS,
    minOrderQty: profile.MIN_ORDER_QTY,
    targetWoc: safeFloat(profile.TARGET_WOC),
    weeklyForecast: inventory.map((row) => ({
      week: row.WEEK_LABEL,
      weekDate: String(row.WEEK_DATE),
      isForecast: row.IS_FORECAST,
      openingStock: row.OPENING_STOCK,
      demand: row.DEMAND_UNITS,
      delivery: row.DELIVERY_UNITS,
      closingStock: row.CLOSING_STOCK,
      shelfPct: safeFloat(row.SHELF_STOCK_PCT),
      reorderPoint: row.REORDER_POINT,
    })),
  };
}

// ─── /supply/brand/{brandName}/skus ───────────────────────────────────────────

async function handleBrandSkus(brandName: string) {
  const brandSafe = escapeSql(brandName);
  const sql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_SUPPLY_PROFILE
    WHERE BRAND_NAME = '${brandSafe}'
    ORDER BY WEEKLY_DEMAND DESC
  `;
  const rows = await querySnowflake(sql);
  if (!rows.length) return [];

  return rows.map((row) => {
    const weeklyDemand = safeFloat(row.WEEKLY_DEMAND);
    const currentStock = safeFloat(row.CURRENT_STOCK_NATIONAL);
    let dcSplit = {};
    try {
      dcSplit = row.DC_SPLIT ? JSON.parse(row.DC_SPLIT) : {};
    } catch {
      dcSplit = {};
    }

    return {
      brand: row.BRAND_NAME,
      skuClass: row.SKU_CLASS,
      category: row.CATEGORY,
      dailyDemand: safeFloat(row.DAILY_DEMAND),
      weeklyDemand: row.WEEKLY_DEMAND,
      currentStock: row.CURRENT_STOCK_NATIONAL,
      reorderPoint: row.REORDER_POINT,
      safetyStock: row.SAFETY_STOCK,
      leadTimeDays: row.LEAD_TIME_DAYS,
      avgDeliveryQty: row.AVG_DELIVERY_QTY,
      nextDelivery: String(row.NEXT_DELIVERY_DATE),
      stockoutCostPerDay: row.STOCKOUT_COST_PER_DAY,
      supplierName: row.SUPPLIER_NAME,
      dcSplit,
      woc: weeklyDemand > 0 ? Math.round((currentStock / weeklyDemand) * 10) / 10 : 0,
    };
  });
}

// ─── /supply/brand/{brandName}/sku/{skuClass} ─────────────────────────────────

async function handleSkuDetail(brandName: string, skuClass: string) {
  const brandSafe = escapeSql(brandName);
  const skuSafe = escapeSql(skuClass);

  const profileSql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_SUPPLY_PROFILE
    WHERE BRAND_NAME = '${brandSafe}'
    AND SKU_CLASS = '${skuSafe}'
  `;
  const profileRows = await querySnowflake(profileSql);
  if (!profileRows.length) return { error: "SKU not found" };
  const profile = profileRows[0];

  const nationalSql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}'
    AND SKU_CLASS = '${skuSafe}'
    AND DC_STATE = 'NATIONAL'
    ORDER BY WEEK_DATE
  `;
  const national = await querySnowflake(nationalSql);

  const dcSql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}'
    AND SKU_CLASS = '${skuSafe}'
    AND DC_STATE != 'NATIONAL'
    ORDER BY DC_STATE, WEEK_DATE
  `;
  const dcRows = await querySnowflake(dcSql);

  const dcData: Record<string, any[]> = {};
  for (const row of dcRows) {
    const state = row.DC_STATE as string;
    if (!dcData[state]) dcData[state] = [];
    dcData[state].push({
      week: row.WEEK_LABEL,
      closingStock: row.CLOSING_STOCK,
      demand: row.DEMAND_UNITS,
      delivery: row.DELIVERY_UNITS,
      shelfPct: safeFloat(row.SHELF_STOCK_PCT),
    });
  }

  const weeklyDemand = safeFloat(profile.WEEKLY_DEMAND);
  const currentStock = safeFloat(profile.CURRENT_STOCK_NATIONAL);
  let dcSplit = {};
  try {
    dcSplit = profile.DC_SPLIT ? JSON.parse(profile.DC_SPLIT) : {};
  } catch {
    dcSplit = {};
  }

  return {
    brand: profile.BRAND_NAME,
    skuClass: profile.SKU_CLASS,
    category: profile.CATEGORY,
    dailyDemand: safeFloat(profile.DAILY_DEMAND),
    weeklyDemand: profile.WEEKLY_DEMAND,
    currentStock: profile.CURRENT_STOCK_NATIONAL,
    reorderPoint: profile.REORDER_POINT,
    safetyStock: profile.SAFETY_STOCK,
    leadTimeDays: profile.LEAD_TIME_DAYS,
    avgDeliveryQty: profile.AVG_DELIVERY_QTY,
    nextDelivery: String(profile.NEXT_DELIVERY_DATE),
    stockoutCostPerDay: profile.STOCKOUT_COST_PER_DAY,
    supplierName: profile.SUPPLIER_NAME,
    dcSplit,
    woc: weeklyDemand > 0 ? Math.round((currentStock / weeklyDemand) * 10) / 10 : 0,
    weeklyForecast: national.map((row) => ({
      week: row.WEEK_LABEL,
      weekDate: String(row.WEEK_DATE),
      isForecast: row.IS_FORECAST,
      openingStock: row.OPENING_STOCK,
      demand: row.DEMAND_UNITS,
      delivery: row.DELIVERY_UNITS,
      closingStock: row.CLOSING_STOCK,
      shelfPct: safeFloat(row.SHELF_STOCK_PCT),
      reorderPoint: row.REORDER_POINT,
    })),
    dcInventory: dcData,
  };
}

// ─── /supply/brand/{brandName}/sku/{skuClass}/stores ──────────────────────────

async function handleSkuStores(brandName: string, skuClass: string) {
  const brandSafe = escapeSql(brandName);
  const skuSafe = escapeSql(skuClass);

  const sql = `
    SELECT STORE_NAME, STATE, 
           SUM(UNITS) AS TOTAL_UNITS, SUM(REVENUE) AS TOTAL_REVENUE,
           AVG(ROS) AS AVG_ROS
    FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}'
    AND SKU_CLASS = '${skuSafe}'
    AND FISCAL_YEAR = 2026
    GROUP BY STORE_NAME, STATE
    ORDER BY TOTAL_UNITS DESC
    LIMIT 20
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    store: row.STORE_NAME,
    state: row.STATE,
    units: safeInt(row.TOTAL_UNITS),
    revenue: Math.round(safeFloat(row.TOTAL_REVENUE)),
    ros: Math.round(safeFloat(row.AVG_ROS) * 10) / 10,
  }));
}

// ─── /supply/difot/overview ───────────────────────────────────────────────────

async function handleDifotOverview() {
  const sql = `
    SELECT BRAND_NAME, CATEGORY,
           AVG(DIFOT_PCT) AS AVG_DIFOT,
           MAX(CASE WHEN FISCAL_WEEK = (SELECT MAX(FISCAL_WEEK) FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NULL) THEN DIFOT_PCT END) AS LATEST_DIFOT,
           SUM(ORDERS_TOTAL) AS TOTAL_ORDERS,
           SUM(ORDERS_ON_TIME) AS TOTAL_ON_TIME,
           COUNT(CASE WHEN DIFOT_PCT < 96 THEN 1 END) AS WEEKS_BELOW_TARGET
    FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
    WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NULL
    GROUP BY BRAND_NAME, CATEGORY
    ORDER BY AVG_DIFOT
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    brand: row.BRAND_NAME,
    category: row.CATEGORY,
    avgDifot: Math.round(safeFloat(row.AVG_DIFOT) * 10) / 10,
    latestDifot: row.LATEST_DIFOT
      ? Math.round(safeFloat(row.LATEST_DIFOT) * 10) / 10
      : 0,
    totalOrders: row.TOTAL_ORDERS,
    totalOnTime: row.TOTAL_ON_TIME,
    weeksBelowTarget: row.WEEKS_BELOW_TARGET,
  }));
}

// ─── /supply/difot/{brandName}/sku-trends ─────────────────────────────────────

async function handleDifotSkuTrends(brandName: string) {
  const brandSafe = escapeSql(brandName);
  const sql = `
    SELECT CLASS, FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME
    FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
    WHERE BRAND_NAME = '${brandSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NOT NULL
    ORDER BY CLASS, FISCAL_WEEK
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    skuClass: row.CLASS,
    week: row.FISCAL_WEEK,
    difotPct: safeFloat(row.DIFOT_PCT),
    ordersTotal: row.ORDERS_TOTAL,
    ordersOnTime: row.ORDERS_ON_TIME,
  }));
}

// ─── /supply/difot/{brandName}/skus ───────────────────────────────────────────

async function handleDifotSkus(brandName: string) {
  const brandSafe = escapeSql(brandName);
  const sql = `
    SELECT CLASS, AVG(DIFOT_PCT) AS AVG_DIFOT,
           SUM(ORDERS_TOTAL) AS TOTAL_ORDERS,
           SUM(ORDERS_ON_TIME) AS TOTAL_ON_TIME,
           COUNT(CASE WHEN DIFOT_PCT < 96 THEN 1 END) AS WEEKS_BELOW
    FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
    WHERE BRAND_NAME = '${brandSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18 AND CLASS IS NOT NULL
    GROUP BY CLASS
    ORDER BY AVG_DIFOT
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    skuClass: row.CLASS,
    avgDifot: Math.round(safeFloat(row.AVG_DIFOT) * 10) / 10,
    totalOrders: row.TOTAL_ORDERS,
    totalOnTime: row.TOTAL_ON_TIME,
    weeksBelowTarget: row.WEEKS_BELOW,
  }));
}

// ─── /supply/difot/{brandName} ────────────────────────────────────────────────

async function handleBrandDifot(brandName: string) {
  const brandSafe = escapeSql(brandName);
  const sql = `
    SELECT FISCAL_WEEK, DIFOT_PCT, ORDERS_TOTAL, ORDERS_ON_TIME
    FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT
    WHERE BRAND_NAME = '${brandSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
    AND (CLASS IS NULL OR CLASS = '')
    ORDER BY FISCAL_WEEK
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    week: row.FISCAL_WEEK,
    difotPct: safeFloat(row.DIFOT_PCT),
    ordersTotal: row.ORDERS_TOTAL,
    ordersOnTime: row.ORDERS_ON_TIME,
  }));
}

// ─── /supply/demand/{brandName}/{skuClass}/detail ─────────────────────────────

async function handleDemandDetail(brandName: string, skuClass: string) {
  const brandSafe = escapeSql(brandName);
  const skuSafe = escapeSql(skuClass);

  const stateWeeklySql = `
    SELECT STATE, FISCAL_WEEK, SUM(UNITS) AS UNITS
    FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
    WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
    GROUP BY STATE, FISCAL_WEEK
    ORDER BY STATE, FISCAL_WEEK
  `;

  const topStoresSql = `
    SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, AVG(ROS) AS ROS
    FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
    GROUP BY STORE_NAME, STATE
    ORDER BY UNITS DESC
    LIMIT 15
  `;

  const growingStoresSql = `
    WITH prior_period AS (
        SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 11 AND 14
        GROUP BY STORE_NAME, STATE
    ),
    latest_period AS (
        SELECT STORE_NAME, STATE, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
        GROUP BY STORE_NAME, STATE
    )
    SELECT l.STORE_NAME, l.STATE, ROUND(p.UNITS, 0) AS PRIOR_UNITS, ROUND(l.UNITS, 0) AS LATEST_UNITS,
           ROUND(((l.UNITS - p.UNITS) / NULLIF(p.UNITS, 0)) * 100, 1) AS CHANGE_PCT
    FROM latest_period l JOIN prior_period p ON l.STORE_NAME = p.STORE_NAME
    WHERE p.UNITS > 0
    ORDER BY CHANGE_PCT DESC
    LIMIT 10
  `;

  const summarySql = `
    SELECT
        SUM(CASE WHEN FISCAL_WEEK BETWEEN 15 AND 18 THEN UNITS ELSE 0 END) AS LATEST_UNITS,
        SUM(CASE WHEN FISCAL_WEEK BETWEEN 11 AND 14 THEN UNITS ELSE 0 END) AS PRIOR_UNITS,
        (SELECT SUM(STORE_COUNT) FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
         WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}' AND FISCAL_YEAR = 2026 AND FISCAL_WEEK = 18) AS STORE_COUNT
    FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
    WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 11 AND 18
  `;

  const [stateWeekly, topStores, growingStores, summary] = await Promise.all([
    querySnowflake(stateWeeklySql),
    querySnowflake(topStoresSql),
    querySnowflake(growingStoresSql),
    querySnowflake(summarySql),
  ]);

  const s = summary[0] || {};
  const latest = safeFloat(s.LATEST_UNITS);
  const prior = safeFloat(s.PRIOR_UNITS);
  const growth = prior > 0 ? Math.round(((latest - prior) / prior) * 1000) / 10 : 0;

  // Build per-state forecast weeks 19-22
  const stateLatest: Record<string, number[]> = {};
  for (const r of stateWeekly) {
    const state = r.STATE as string;
    const wk = Number(r.FISCAL_WEEK);
    if (wk >= 15) {
      if (!stateLatest[state]) stateLatest[state] = [];
      stateLatest[state].push(safeFloat(r.UNITS));
    }
  }

  const forecastRows: any[] = [];
  const weeklyGrowthRate = growth > 0 ? growth / 100 / 4 : 0.05;
  for (const [state, vals] of Object.entries(stateLatest)) {
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    for (let i = 0; i < 4; i++) {
      const fw = 19 + i;
      forecastRows.push({
        state,
        week: fw,
        units: Math.round(avg * (1 + weeklyGrowthRate * (i + 1))),
        isForecast: true,
      });
    }
  }

  return {
    brand: brandName,
    skuClass: skuClass,
    summary: {
      latestUnits: Math.round(latest),
      priorUnits: Math.round(prior),
      growthPct: growth,
      storeCount: s.STORE_COUNT || 0,
    },
    stateWeekly: [
      ...stateWeekly.map((r) => ({
        state: r.STATE,
        week: r.FISCAL_WEEK,
        units: Math.round(safeFloat(r.UNITS)),
        isForecast: false,
      })),
      ...forecastRows,
    ],
    topStores: topStores.map((r) => ({
      store: r.STORE_NAME,
      state: r.STATE,
      units: Math.round(safeFloat(r.UNITS)),
      revenue: Math.round(safeFloat(r.REVENUE)),
      ros: Math.round(safeFloat(r.ROS) * 10) / 10,
    })),
    growingStores: growingStores.map((r) => ({
      store: r.STORE_NAME,
      state: r.STATE,
      priorUnits: safeInt(r.PRIOR_UNITS),
      latestUnits: safeInt(r.LATEST_UNITS),
      changePct: safeFloat(r.CHANGE_PCT),
    })),
  };
}

// ─── /supply/demand/trends ────────────────────────────────────────────────────

async function handleDemandTrends() {
  const sql = `
    SELECT BRAND_NAME, FISCAL_WEEK, SUM(UNITS) AS UNITS
    FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
    WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
    GROUP BY BRAND_NAME, FISCAL_WEEK
    ORDER BY BRAND_NAME, FISCAL_WEEK
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    brand: row.BRAND_NAME,
    week: row.FISCAL_WEEK,
    units: safeInt(row.UNITS),
  }));
}

// ─── /supply/demand/acceleration ──────────────────────────────────────────────

async function handleDemandAcceleration() {
  const sql = `
    WITH weekly AS (
        SELECT BRAND_NAME, SKU_CLASS, FISCAL_WEEK, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
        WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
        GROUP BY BRAND_NAME, SKU_CLASS, FISCAL_WEEK
    ),
    periods AS (
        SELECT BRAND_NAME, SKU_CLASS,
               AVG(CASE WHEN FISCAL_WEEK BETWEEN 11 AND 14 THEN UNITS END) AS PRIOR_AVG,
               AVG(CASE WHEN FISCAL_WEEK BETWEEN 15 AND 18 THEN UNITS END) AS LATEST_AVG
        FROM weekly
        GROUP BY BRAND_NAME, SKU_CLASS
        HAVING PRIOR_AVG IS NOT NULL AND LATEST_AVG IS NOT NULL
    )
    SELECT BRAND_NAME, SKU_CLASS, ROUND(PRIOR_AVG) AS PRIOR_AVG, ROUND(LATEST_AVG) AS LATEST_AVG,
           ROUND(((LATEST_AVG - PRIOR_AVG) / NULLIF(PRIOR_AVG, 0)) * 100, 1) AS CHANGE_PCT
    FROM periods
    ORDER BY CHANGE_PCT DESC
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => {
    const changePct = safeFloat(row.CHANGE_PCT);
    return {
      brand: row.BRAND_NAME,
      skuClass: row.SKU_CLASS,
      priorAvg: safeInt(row.PRIOR_AVG),
      latestAvg: safeInt(row.LATEST_AVG),
      changePct,
      signal:
        changePct > 5 ? "accelerating" : changePct < -5 ? "declining" : "stable",
    };
  });
}

// ─── /supply/demand/by-state ──────────────────────────────────────────────────

async function handleDemandByState() {
  const sql = `
    SELECT STATE, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, SUM(STORE_COUNT) AS STORES
    FROM BABY_MART_DEMO.ANALYTICS.V_DEMAND_ROLLUP
    WHERE FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
    GROUP BY STATE
    ORDER BY UNITS DESC
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    state: row.STATE,
    units: safeInt(row.UNITS),
    revenue: Math.round(safeFloat(row.REVENUE)),
    stores: row.STORES,
  }));
}

// ─── /supply/stores/demand ────────────────────────────────────────────────────

async function handleStoreDemand() {
  const sql = `
    SELECT STORE_NAME, STATE, BRAND_NAME, SKU_CLASS,
           SUM(UNITS) AS TOTAL_UNITS, SUM(REVENUE) AS TOTAL_REVENUE,
           AVG(ROS) AS AVG_ROS
    FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
    WHERE FISCAL_YEAR = 2026
    GROUP BY STORE_NAME, STATE, BRAND_NAME, SKU_CLASS
    ORDER BY TOTAL_UNITS DESC
    LIMIT 50
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    store: row.STORE_NAME,
    state: row.STATE,
    brand: row.BRAND_NAME,
    skuClass: row.SKU_CLASS,
    units: safeInt(row.TOTAL_UNITS),
    revenue: Math.round(safeFloat(row.TOTAL_REVENUE)),
    ros: Math.round(safeFloat(row.AVG_ROS) * 10) / 10,
  }));
}

// ─── /supply/demand/store/{storeName}/profile ─────────────────────────────────

async function handleStoreProfile(storeName: string, brand: string, sku: string) {
  const storeSafe = escapeSql(storeName);
  const brandSafe = escapeSql(brand);
  const skuSafe = escapeSql(sku);

  const storeInfoSql = `
    SELECT STORE_NAME, STATE, REGION, CITY, STORE_FORMAT
    FROM BABY_MART_DEMO.CURATED.DIM_STORE
    WHERE STORE_NAME LIKE '%${storeSafe}%'
    LIMIT 1
  `;

  const brandFilter = brand ? `AND BRAND_NAME = '${brandSafe}'` : "";
  const skuFilter = sku ? `AND SKU_CLASS = '${skuSafe}'` : "";

  const weeklySql = `
    SELECT FISCAL_WEEK, SUM(UNITS) AS UNITS, SUM(REVENUE) AS REVENUE, AVG(ROS) AS ROS
    FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
    WHERE STORE_NAME LIKE '%${storeSafe}%'
    ${brandFilter} ${skuFilter}
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK <= 18
    GROUP BY FISCAL_WEEK
    ORDER BY FISCAL_WEEK
  `;

  const brandJoin = brand
    ? `JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b ON p.BRAND_KEY = b.BRAND_KEY`
    : "";
  const brandWhere = brand ? `AND b.BRAND_NAME = '${brandSafe}'` : "";

  const demoSql = `
    SELECT
        cs.SEGMENT_NAME,
        c.AGE_BAND,
        c.LOYALTY_TIER,
        COUNT(DISTINCT c.CUSTOMER_KEY) AS CUSTOMERS,
        SUM(t.NET_REVENUE) AS REVENUE
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ON t.CUSTOMER_KEY = c.CUSTOMER_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON t.STORE_KEY = s.STORE_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    ${brandJoin}
    WHERE s.STORE_NAME LIKE '%${storeSafe}%'
    ${brandWhere}
    GROUP BY cs.SEGMENT_NAME, c.AGE_BAND, c.LOYALTY_TIER
  `;

  const stateAvgSql = `
    SELECT AVG(UNITS) AS STATE_AVG
    FROM (
        SELECT STORE_NAME, SUM(UNITS) AS UNITS
        FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
        WHERE STATE = (SELECT STATE FROM BABY_MART_DEMO.CURATED.DIM_STORE WHERE STORE_NAME LIKE '%${storeSafe}%' LIMIT 1)
        ${brandFilter} ${skuFilter}
        AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
        GROUP BY STORE_NAME
    )
  `;

  const [storeInfo, weekly, stateAvgRows] = await Promise.all([
    querySnowflake(storeInfoSql),
    querySnowflake(weeklySql),
    querySnowflake(stateAvgSql),
  ]);

  let demoRows: any[] = [];
  try {
    demoRows = await querySnowflake(demoSql);
  } catch {
    demoRows = [];
  }

  const info = storeInfo[0] || {};

  // Process KPIs from weekly data
  const recent = weekly.filter((r) => Number(r.FISCAL_WEEK) >= 15);
  const priorWeeks = weekly.filter(
    (r) => Number(r.FISCAL_WEEK) >= 11 && Number(r.FISCAL_WEEK) <= 14
  );
  const avgUnits =
    recent.length > 0
      ? recent.reduce((acc, r) => acc + safeFloat(r.UNITS), 0) / recent.length
      : 0;
  const avgRevenue =
    recent.length > 0
      ? recent.reduce((acc, r) => acc + safeFloat(r.REVENUE), 0) / recent.length
      : 0;
  const avgRos =
    recent.length > 0
      ? recent.reduce((acc, r) => acc + safeFloat(r.ROS), 0) / recent.length
      : 0;
  const priorAvg =
    priorWeeks.length > 0
      ? priorWeeks.reduce((acc, r) => acc + safeFloat(r.UNITS), 0) / priorWeeks.length
      : 0;
  const growthPct =
    priorAvg > 0
      ? Math.round(((avgUnits - priorAvg) / priorAvg) * 1000) / 10
      : 0;

  // Process demographics
  const segments: Record<string, { customers: number; revenue: number }> = {};
  const ageBands: Record<string, number> = {};
  const loyaltyTiers: Record<string, number> = {};
  let totalCustomers = 0;

  for (const r of demoRows) {
    const seg = r.SEGMENT_NAME as string;
    const age = (r.AGE_BAND as string) || "Unknown";
    const tier = (r.LOYALTY_TIER as string) || "Unknown";
    const custs = safeInt(r.CUSTOMERS);
    const rev = safeFloat(r.REVENUE);
    totalCustomers += custs;

    if (!segments[seg]) segments[seg] = { customers: 0, revenue: 0 };
    segments[seg].customers += custs;
    segments[seg].revenue += rev;

    if (!ageBands[age]) ageBands[age] = 0;
    ageBands[age] += custs;

    if (!loyaltyTiers[tier]) loyaltyTiers[tier] = 0;
    loyaltyTiers[tier] += custs;
  }

  // State comparison
  const stateAvg = safeFloat(stateAvgRows[0]?.STATE_AVG);
  const storeTotal = recent.reduce((acc, r) => acc + safeFloat(r.UNITS), 0);
  const indexVsState =
    stateAvg > 0 ? Math.round((storeTotal / stateAvg) * 100) / 100 : 1.0;

  return {
    storeInfo: {
      name: info.STORE_NAME || storeName,
      state: info.STATE || "",
      region: info.REGION || "",
      city: info.CITY || "",
      format: info.STORE_FORMAT || "",
    },
    kpis: {
      avgUnits: Math.round(avgUnits * 10) / 10,
      avgRevenue: Math.round(avgRevenue),
      ros: Math.round(avgRos * 10) / 10,
      growthPct,
    },
    weeklyTrend: weekly.map((r) => ({
      week: Number(r.FISCAL_WEEK),
      units: Math.round(safeFloat(r.UNITS) * 10) / 10,
      revenue: Math.round(safeFloat(r.REVENUE)),
    })),
    demographics: {
      segments: Object.entries(segments)
        .map(([name, v]) => ({
          name,
          pct: totalCustomers > 0 ? Math.round((v.customers / totalCustomers) * 100) : 0,
          revenue: Math.round(v.revenue),
        }))
        .sort((a, b) => b.pct - a.pct),
      ageBands: Object.entries(ageBands)
        .map(([band, v]) => ({
          band,
          pct: totalCustomers > 0 ? Math.round((v / totalCustomers) * 100) : 0,
        }))
        .sort((a, b) => b.pct - a.pct),
      loyaltyTiers: Object.entries(loyaltyTiers)
        .map(([tier, v]) => ({
          tier,
          pct: totalCustomers > 0 ? Math.round((v / totalCustomers) * 100) : 0,
        }))
        .sort((a, b) => b.pct - a.pct),
    },
    channelContext: {
      region: info.REGION || "",
      format: info.STORE_FORMAT || "",
      indexVsState,
    },
  };
}

// ─── /supply/dc/{brandName}/{skuClass}/store-forecast ─────────────────────────

async function handleStoreForecast(
  brandName: string,
  skuClass: string,
  change: number
) {
  const brandSafe = escapeSql(brandName);
  const skuSafe = escapeSql(skuClass);

  const storeDemandSql = `
    SELECT ${STATE_MAP_CASE} AS STATE,
           STORE_NAME,
           SUM(UNITS) / COUNT(DISTINCT FISCAL_WEEK) AS AVG_WEEKLY_DEMAND,
           SUM(REVENUE) / COUNT(DISTINCT FISCAL_WEEK) AS AVG_WEEKLY_REVENUE
    FROM BABY_MART_DEMO.ANALYTICS.V_STORE_DEMAND_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
    AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18
    GROUP BY ${STATE_MAP_CASE}, STORE_NAME
    ORDER BY STATE, AVG_WEEKLY_DEMAND DESC
  `;

  const dcStockSql = `
    SELECT DC_STATE AS STATE, SUM(CLOSING_STOCK) AS TOTAL_STOCK, SUM(DEMAND_UNITS) AS DC_WEEKLY_DEMAND
    FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
    WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
    AND DC_STATE != 'NATIONAL' AND WEEK_LABEL = 'W-1'
    GROUP BY DC_STATE
  `;

  const [storeRows, dcRows] = await Promise.all([
    querySnowflake(storeDemandSql),
    querySnowflake(dcStockSql),
  ]);

  const dcStocks: Record<string, { stock: number; dcDemand: number }> = {};
  for (const r of dcRows) {
    dcStocks[r.STATE as string] = {
      stock: safeFloat(r.TOTAL_STOCK),
      dcDemand: safeFloat(r.DC_WEEKLY_DEMAND),
    };
  }

  const growthMultiplier = 1 + change / 100;
  const avgUnitPrice = 28.4; // Huggies avg unit price

  const stores: any[] = [];
  for (const r of storeRows) {
    const state = r.STATE as string;
    const store = r.STORE_NAME as string;
    const avgDemand = safeFloat(r.AVG_WEEKLY_DEMAND);

    const dc = dcStocks[state] || { stock: 0, dcDemand: 1 };
    const dcStock = dc.stock;
    const dcDemand = dc.dcDemand > 0 ? dc.dcDemand : 1;

    // Store's share of DC stock proportional to its demand share
    const storeShare = dcDemand > 0 ? avgDemand / dcDemand : 0;
    const storeStock = dcStock * storeShare;

    // Adjusted demand with growth
    const adjustedDemand = avgDemand * growthMultiplier;
    const weeksToStockout =
      adjustedDemand > 0
        ? Math.round((storeStock / adjustedDemand) * 10) / 10
        : 99;

    // --- Shelf % model ---
    const dcWksToEmpty =
      adjustedDemand > 0 ? storeStock / adjustedDemand : 99;

    // Deterministic per-store variation (based on store name hash, +-10%)
    let storeHash = 0;
    for (let i = 0; i < store.length; i++) {
      storeHash += store.charCodeAt(i);
    }
    storeHash = storeHash % 20; // 0-19
    const storeVariation = 0.85 + (storeHash / 20) * 0.15; // 0.85 to 1.0

    // Shelf % depends on how well the DC can supply this store
    let shelfPct: number;
    if (dcWksToEmpty >= 4) {
      shelfPct = Math.round(Math.min(97, 85 + dcWksToEmpty * 2) * storeVariation);
    } else if (dcWksToEmpty >= 2) {
      shelfPct = Math.round((65 + (dcWksToEmpty - 2) * 10) * storeVariation);
    } else if (dcWksToEmpty >= 1) {
      shelfPct = Math.round((45 + (dcWksToEmpty - 1) * 20) * storeVariation);
    } else if (dcWksToEmpty > 0) {
      shelfPct = Math.round((20 + dcWksToEmpty * 25) * storeVariation);
    } else {
      shelfPct = Math.round(5 + storeHash);
    }
    shelfPct = Math.max(0, Math.min(97, shelfPct));

    // Sales loss: based on unfilled shelf causing missed sales
    const lostFraction = Math.max(0, 1 - shelfPct / 100);
    const salesLossWk = Math.round(adjustedDemand * lostFraction * avgUnitPrice);

    // Predicted 4-week loss simulation
    let totalPredictedLoss = 0;
    let simDcStock = storeStock;
    for (let wk = 1; wk <= 4; wk++) {
      simDcStock -= adjustedDemand;
      const simDcWks =
        adjustedDemand > 0 ? Math.max(0, simDcStock / adjustedDemand) : 0;
      let wkShelf: number;
      if (simDcWks >= 2) {
        wkShelf = Math.min(97, 85 + simDcWks * 2) * storeVariation;
      } else if (simDcWks >= 1) {
        wkShelf = (45 + (simDcWks - 1) * 20) * storeVariation;
      } else if (simDcWks > 0) {
        wkShelf = (20 + simDcWks * 25) * storeVariation;
      } else {
        // DC exhausted — shelf rapidly empties
        wkShelf = Math.max(0, shelfPct - wk * 20);
      }
      wkShelf = Math.max(0, Math.min(97, wkShelf));
      const wkLost = adjustedDemand * (1 - wkShelf / 100);
      totalPredictedLoss += wkLost * avgUnitPrice;
    }

    stores.push({
      store: store.replace("Baby Mart ", ""),
      state,
      dc: `${state} DC`,
      weeklyDemand: Math.round(adjustedDemand * 10) / 10,
      shelfPct: Math.round(shelfPct),
      weeksToStockout,
      salesLossWeek: Math.round(salesLossWk),
      predictedLoss4wk: Math.round(totalPredictedLoss),
      storeStock: Math.round(storeStock),
    });
  }

  const totalLoss = stores.reduce((acc, s) => acc + s.salesLossWeek, 0);
  const atRisk = stores.filter((s) => s.weeksToStockout < 4).length;

  return {
    stores,
    summary: {
      totalStores: stores.length,
      atRiskStores: atRisk,
      weeklyLoss: Math.round(totalLoss),
      predicted4wkLoss: Math.round(
        stores.reduce((acc, s) => acc + s.predictedLoss4wk, 0)
      ),
    },
    dcStocks: buildDcForecast(dcStocks, growthMultiplier),
  };
}

// ─── DC forecast helper ───────────────────────────────────────────────────────

function buildDcForecast(
  dcStocks: Record<string, { stock: number; dcDemand: number }>,
  growthMultiplier: number
) {
  const results: any[] = [];
  for (const [state, data] of Object.entries(dcStocks)) {
    const weeklyDemand = Math.round(data.dcDemand * growthMultiplier);
    const stock = data.stock;
    const restock = PLANNED_RESTOCKS[state] || { week: 4, qty: 100 };

    // Compute week-by-week stock trajectory (0-5 weeks)
    const trajectory: number[] = [];
    let current = stock;
    for (let wk = 0; wk < 6; wk++) {
      if (wk === restock.week) {
        current += restock.qty;
      }
      trajectory.push(Math.round(Math.max(0, current)));
      current -= weeklyDemand;
      if (current < 0) current = 0;
    }

    const weeksLeft =
      weeklyDemand > 0 ? Math.round((stock / weeklyDemand) * 10) / 10 : 99;

    results.push({
      state,
      stock,
      weeklyDemand,
      weeksLeft,
      restockWeek: restock.week,
      restockQty: restock.qty,
      trajectory,
    });
  }
  return results;
}

// ─── /supply/dc/overview ──────────────────────────────────────────────────────

async function handleDcOverview() {
  const sql = `
    SELECT DC_STATE AS STATE, BRAND_NAME, SKU_CLASS, CLOSING_STOCK, REORDER_POINT, DEMAND_UNITS
    FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY
    WHERE DC_STATE != 'NATIONAL'
    AND WEEK_LABEL = 'W-1'
    ORDER BY CLOSING_STOCK DESC
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    state: row.STATE,
    brand: row.BRAND_NAME,
    skuClass: row.SKU_CLASS,
    stock: row.CLOSING_STOCK,
    reorderPoint: row.REORDER_POINT,
    demandUnits: row.DEMAND_UNITS || 0,
  }));
}

// ─── /supply/alerts ───────────────────────────────────────────────────────────

async function handleAlerts() {
  const sql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.STOCK_ALERTS
    WHERE IS_RESOLVED = FALSE
    ORDER BY
        CASE ALERT_TYPE WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        CREATED_AT DESC
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    id: row.ALERT_ID,
    brand: row.BRAND_NAME,
    category: row.CATEGORY,
    type: row.ALERT_TYPE,
    title: row.TITLE,
    description: row.DESCRIPTION,
    timestamp: String(row.CREATED_AT),
    woc: safeFloat(row.WOC_AT_TIME),
    action: row.RECOMMENDED_ACTION,
  }));
}

// ─── /supply/profiles ─────────────────────────────────────────────────────────

async function handleProfiles() {
  const sql = `
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.BRAND_SUPPLY_PROFILE
    ORDER BY BRAND_NAME
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => {
    const weeklyDemand = safeFloat(row.WEEKLY_DEMAND);
    const currentStock = safeFloat(row.CURRENT_STOCK_UNITS);
    return {
      brand: row.BRAND_NAME,
      category: row.CATEGORY,
      currentStock: row.CURRENT_STOCK_UNITS,
      dailyDemand: safeFloat(row.DAILY_DEMAND),
      weeklyDemand: row.WEEKLY_DEMAND,
      reorderPoint: row.REORDER_POINT,
      leadTimeDays: row.LEAD_TIME_DAYS,
      avgDeliveryQty: row.AVG_DELIVERY_QTY,
      nextDelivery: String(row.NEXT_DELIVERY_DATE),
      nextDeliveryQty: row.NEXT_DELIVERY_QTY,
      stockoutCostPerDay: row.STOCKOUT_COST_PER_DAY,
      supplierName: row.SUPPLIER_NAME,
      targetWoc: safeFloat(row.TARGET_WOC),
      woc: weeklyDemand > 0 ? Math.round((currentStock / weeklyDemand) * 10) / 10 : 0,
    };
  });
}
