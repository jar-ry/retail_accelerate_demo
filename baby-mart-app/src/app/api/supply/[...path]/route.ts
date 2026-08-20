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
      const channel = searchParams.get("channel") || "all";
      const includePY = searchParams.get("includePY") === "true";
      return NextResponse.json(await handleDemandTrends(channel, includePY));
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

    // ─── /supply/purchase-orders ─────────────────────────────────────
    if (segments[0] === "purchase-orders" && segments.length === 1) {
      return NextResponse.json(await handlePurchaseOrders());
    }

    // ─── Planning: /supply/planning/demand ──────────────────────────
    if (segments[0] === "planning" && segments[1] === "demand" && segments.length === 2) {
      const channel = searchParams.get("channel") || "all";
      const includePY = searchParams.get("includePY") === "true";
      return NextResponse.json(await handlePlanningDemand(channel, includePY));
    }

    // ─── Planning: /supply/planning/difot/landing ─────────────────────
    if (segments[0] === "planning" && segments[1] === "difot" && segments[2] === "landing" && segments.length === 3) {
      const fairView = searchParams.get("fairView") === "true";
      return NextResponse.json(await handleDifotLanding(fairView));
    }

    // ─── Planning: /supply/planning/difot/{brand} ─────────────────────
    if (segments[0] === "planning" && segments[1] === "difot" && segments.length === 3) {
      return NextResponse.json(await handlePlanningDifotBrand(segments[2]));
    }

    // ─── Planning: /supply/planning/overtrading ───────────────────────
    if (segments[0] === "planning" && segments[1] === "overtrading" && segments.length === 2) {
      return NextResponse.json(await handleOvertrading());
    }

    // ─── Planning: /supply/planning/leadtime ──────────────────────────
    if (segments[0] === "planning" && segments[1] === "leadtime" && segments.length === 2) {
      return NextResponse.json(await handleLeadTime());
    }

    // ─── Ops: /supply/ops/inbound ─────────────────────────────────────
    if (segments[0] === "ops" && segments[1] === "inbound" && segments.length === 2) {
      const dc = searchParams.get("dc") || "all";
      const period = searchParams.get("period") || "today";
      return NextResponse.json(await handleOpsInbound(dc, period));
    }

    // ─── Ops: /supply/ops/workforce ───────────────────────────────────
    if (segments[0] === "ops" && segments[1] === "workforce" && segments.length === 2) {
      const dc = searchParams.get("dc") || "all";
      return NextResponse.json(await handleOpsWorkforce(dc));
    }

    // ─── Ops: /supply/ops/outbound ────────────────────────────────────
    if (segments[0] === "ops" && segments[1] === "outbound" && segments.length === 2) {
      const dc = searchParams.get("dc") || "all";
      const channel = searchParams.get("channel") || "all";
      return NextResponse.json(await handleOpsOutbound(dc, channel));
    }

    // ─── Ops: /supply/ops/capacity ────────────────────────────────────
    if (segments[0] === "ops" && segments[1] === "capacity" && segments.length === 2) {
      return NextResponse.json(await handleOpsCapacity());
    }

    // ─── DC: /supply/dc/command-center ────────────────────────────────
    if (segments[0] === "dc" && segments[1] === "command-center" && segments.length === 2) {
      return NextResponse.json(await handleDcCommandCenter());
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
  // Get DIFOT from the new PO-level table with component breakdown
  const sql = `
    SELECT r.BRAND_NAME, r.CATEGORY, r.SUPPLIER_NAME,
           COUNT(*) AS TOTAL_ORDERS,
           ROUND(SUM(CASE WHEN r.IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS AVG_DIFOT,
           ROUND(SUM(CASE WHEN r.IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT,
           ROUND(SUM(CASE WHEN r.IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
           SUM(CASE WHEN r.IS_DIFOT THEN 1 ELSE 0 END) AS TOTAL_ON_TIME,
           SUM(CASE WHEN NOT r.IS_DIFOT AND r.STATUS = 'DELIVERED' THEN 1 ELSE 0 END) AS WEEKS_BELOW_TARGET
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC r
    WHERE r.STATUS = 'DELIVERED'
    GROUP BY r.BRAND_NAME, r.CATEGORY, r.SUPPLIER_NAME
    ORDER BY AVG_DIFOT
  `;
  const rows = await querySnowflake(sql);
  return rows.map((row) => ({
    brand: row.BRAND_NAME,
    category: row.CATEGORY,
    supplier: row.SUPPLIER_NAME,
    avgDifot: safeFloat(row.AVG_DIFOT),
    latestDifot: safeFloat(row.AVG_DIFOT),
    diPct: safeFloat(row.DI_PCT),
    otPct: safeFloat(row.OT_PCT),
    totalOrders: safeInt(row.TOTAL_ORDERS),
    totalOnTime: safeInt(row.TOTAL_ON_TIME),
    weeksBelowTarget: safeInt(row.WEEKS_BELOW_TARGET),
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
  // Use the new PO-level table, aggregated to weekly
  const sql = `
    SELECT DATE_TRUNC('WEEK', ACTUAL_DELIVERY_DATE)::DATE AS DELIVERY_WEEK,
           COUNT(*) AS ORDERS_TOTAL,
           SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END) AS ORDERS_ON_TIME,
           ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
           ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT,
           ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
    WHERE BRAND_NAME = '${brandSafe}' AND STATUS = 'DELIVERED'
    GROUP BY DELIVERY_WEEK
    ORDER BY DELIVERY_WEEK
  `;
  const rows = await querySnowflake(sql);
  const baseDate = new Date("2026-02-17");
  return rows.map((row, i) => ({
    week: i + 1,
    difotPct: safeFloat(row.DIFOT_PCT),
    diPct: safeFloat(row.DI_PCT),
    otPct: safeFloat(row.OT_PCT),
    ordersTotal: safeInt(row.ORDERS_TOTAL),
    ordersOnTime: safeInt(row.ORDERS_ON_TIME),
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

async function handleDemandTrends(channel: string = "all", includePY: boolean = false) {
  // Channel filter on the daily forecast table
  const channelFilter = channel === "instore" ? "AND CHANNEL = 'In-Store'"
    : channel === "online" ? "AND CHANNEL = 'Online'" : "";

  // Primary query: weekly demand from daily forecast, grouped by brand
  const sql = `
    SELECT BRAND_NAME, DATE_TRUNC('WEEK', FORECAST_DATE)::DATE AS WEEK_START,
           SUM(COALESCE(ACTUAL_UNITS, FORECAST_UNITS)) AS UNITS
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY
    WHERE FORECAST_DATE >= '2026-03-01' AND FORECAST_DATE <= CURRENT_DATE()
    ${channelFilter}
    GROUP BY BRAND_NAME, WEEK_START
    ORDER BY BRAND_NAME, WEEK_START
  `;
  const rows = await querySnowflake(sql);

  // Convert to week numbers for compatibility with existing page
  const baseDate = new Date("2026-03-01");
  const result = rows.map((row) => {
    const weekStart = new Date(row.WEEK_START as string);
    const weekNum = Math.floor((weekStart.getTime() - baseDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return {
      brand: row.BRAND_NAME,
      week: weekNum,
      units: safeInt(row.UNITS),
    };
  });

  // Online share KPI
  let onlineShare = 0;
  if (channel === "all") {
    const shareRows = await querySnowflake(`
      SELECT ROUND(SUM(CASE WHEN CHANNEL='Online' THEN COALESCE(ACTUAL_UNITS, FORECAST_UNITS) ELSE 0 END)::FLOAT
        / NULLIF(SUM(COALESCE(ACTUAL_UNITS, FORECAST_UNITS)), 0) * 100, 1) AS ONLINE_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY
      WHERE FORECAST_DATE >= CURRENT_DATE() - 28 AND FORECAST_DATE <= CURRENT_DATE()
    `);
    onlineShare = safeFloat(shareRows[0]?.ONLINE_PCT);
  }

  // PY data (simulate as 80% of current)
  let pyData: typeof result | null = null;
  if (includePY) {
    pyData = result.map(r => ({
      ...r,
      units: Math.round(r.units * (0.78 + (Math.abs(r.week * 7 + r.brand.length) % 15) / 100)),
    }));
  }

  return { trends: result, onlineShare, pyData };
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

  // Demand forecast for this brand/SKU (weekly aggregated)
  let demandForecast: any[] = [];
  try {
    const demandRows = await querySnowflake(`
      SELECT DATE_TRUNC('WEEK', FORECAST_DATE)::DATE AS WEEK_START,
             SUM(FORECAST_UNITS) AS FORECAST_UNITS,
             SUM(ACTUAL_UNITS) AS ACTUAL_UNITS,
             MAX(IS_FORECAST) AS IS_FORECAST
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY
      WHERE BRAND_NAME = '${brandSafe}' AND SKU_CLASS = '${skuSafe}'
      AND FORECAST_DATE >= CURRENT_DATE() - 56
      GROUP BY WEEK_START
      ORDER BY WEEK_START
    `);
    demandForecast = demandRows.map(r => ({
      week: r.WEEK_START,
      forecastUnits: safeInt(r.FORECAST_UNITS),
      actualUnits: r.IS_FORECAST ? null : safeInt(r.ACTUAL_UNITS),
      isForecast: r.IS_FORECAST,
    }));
  } catch { /* table may not have this brand */ }

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
    demandForecast,
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
  const [inventory, pendingPOs] = await Promise.all([
    querySnowflake(`
      SELECT i.DC_STATE AS STATE, i.BRAND_NAME, i.SKU_CLASS, i.CLOSING_STOCK, i.REORDER_POINT, i.DEMAND_UNITS,
             s.SUPPLIER_NAME, s.STD_LEAD_TIME_DAYS
      FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY i
      LEFT JOIN BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR s ON CONTAINS(s.BRANDS, i.BRAND_NAME)
      WHERE i.DC_STATE != 'NATIONAL' AND i.WEEK_LABEL = 'W-1'
      ORDER BY i.CLOSING_STOCK / NULLIF(i.DEMAND_UNITS, 1)
    `),
    querySnowflake(`
      SELECT BRAND_NAME, SKU_CLASS, DC_STATE, EXPECTED_DELIVERY_DATE, ORDERED_UNITS, STATUS
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS IN ('ON_ORDER', 'IN_TRANSIT')
      ORDER BY EXPECTED_DELIVERY_DATE
    `),
  ]);

  return inventory.map((row) => {
    const stock = safeFloat(row.CLOSING_STOCK);
    const demand = safeFloat(row.DEMAND_UNITS);
    const woc = demand > 0 ? Math.round((stock / demand) * 10) / 10 : 99;
    const nextPO = pendingPOs.find(p => p.BRAND_NAME === row.BRAND_NAME && p.SKU_CLASS === row.SKU_CLASS && p.DC_STATE === row.STATE);

    return {
      state: row.STATE,
      brand: row.BRAND_NAME,
      skuClass: row.SKU_CLASS,
      stock: Math.round(stock),
      reorderPoint: safeInt(row.REORDER_POINT),
      demandUnits: safeInt(row.DEMAND_UNITS),
      woc,
      supplier: row.SUPPLIER_NAME || null,
      leadTime: row.STD_LEAD_TIME_DAYS ? safeInt(row.STD_LEAD_TIME_DAYS) : null,
      nextDeliveryDate: nextPO?.EXPECTED_DELIVERY_DATE || null,
      nextDeliveryStatus: nextPO?.STATUS || null,
      nextDeliveryUnits: nextPO ? safeInt(nextPO.ORDERED_UNITS) : null,
    };
  });
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

// ═══════════════════════════════════════════════════════════════════════════════
// PLANNING & DEMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePlanningDemand(channel: string, includePY: boolean) {
  const channelFilter = channel === "instore" ? "AND CHANNEL = 'In-Store'"
    : channel === "online" ? "AND CHANNEL = 'Online'" : "";

  const sql = `
    SELECT FORECAST_DATE, BRAND_NAME, SUM(FORECAST_UNITS) AS FORECAST_UNITS,
           SUM(ACTUAL_UNITS) AS ACTUAL_UNITS, SUM(FORECAST_REVENUE) AS FORECAST_REVENUE,
           SUM(ACTUAL_REVENUE) AS ACTUAL_REVENUE, MAX(IS_FORECAST) AS IS_FORECAST
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY
    WHERE FORECAST_DATE >= DATEADD(DAY, -90, CURRENT_DATE())
    ${channelFilter}
    GROUP BY FORECAST_DATE, BRAND_NAME
    ORDER BY FORECAST_DATE, BRAND_NAME
  `;
  const rows = await querySnowflake(sql);

  // Weekly aggregation for display
  const weeklyData: Record<string, { forecast: number; actual: number; forecastRev: number; actualRev: number; isForecast: boolean; dates: number }> = {};
  for (const r of rows) {
    const d = new Date(r.FORECAST_DATE as string);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeklyData[key]) weeklyData[key] = { forecast: 0, actual: 0, forecastRev: 0, actualRev: 0, isForecast: false, dates: 0 };
    weeklyData[key].forecast += safeFloat(r.FORECAST_UNITS);
    weeklyData[key].actual += safeFloat(r.ACTUAL_UNITS);
    weeklyData[key].forecastRev += safeFloat(r.FORECAST_REVENUE);
    weeklyData[key].actualRev += safeFloat(r.ACTUAL_REVENUE);
    if (r.IS_FORECAST) weeklyData[key].isForecast = true;
    weeklyData[key].dates++;
  }

  const weekly = Object.entries(weeklyData).sort().map(([week, d]) => ({
    week,
    forecastUnits: Math.round(d.forecast),
    actualUnits: d.isForecast ? null : Math.round(d.actual),
    forecastRevenue: Math.round(d.forecastRev),
    actualRevenue: d.isForecast ? null : Math.round(d.actualRev),
    isForecast: d.isForecast,
  }));

  // MAPE calculation (only past weeks)
  const pastWeeks = weekly.filter(w => !w.isForecast && w.actualUnits && w.actualUnits > 0);
  const mape = pastWeeks.length > 0
    ? Math.round(pastWeeks.reduce((acc, w) => acc + Math.abs((w.forecastUnits - (w.actualUnits || 0)) / (w.actualUnits || 1)), 0) / pastWeeks.length * 1000) / 10
    : 0;

  // Brand breakdown
  const brandMap: Record<string, { forecast: number; actual: number }> = {};
  for (const r of rows) {
    const b = r.BRAND_NAME as string;
    if (!brandMap[b]) brandMap[b] = { forecast: 0, actual: 0 };
    brandMap[b].forecast += safeFloat(r.FORECAST_UNITS);
    brandMap[b].actual += safeFloat(r.ACTUAL_UNITS);
  }
  const brands = Object.entries(brandMap).map(([name, d]) => ({
    brand: name,
    totalForecast: Math.round(d.forecast),
    totalActual: Math.round(d.actual),
    accuracy: d.actual > 0 ? Math.round((1 - Math.abs(d.forecast - d.actual) / d.actual) * 100) : 0,
  })).sort((a, b) => a.accuracy - b.accuracy);

  let pyData: typeof weekly | null = null;
  if (includePY) {
    // Simulate PY as 80-90% of current year actuals
    pyData = weekly.map(w => ({
      ...w,
      forecastUnits: Math.round(w.forecastUnits * (0.8 + Math.random() * 0.1)),
      actualUnits: w.actualUnits ? Math.round(w.actualUnits * (0.8 + Math.random() * 0.1)) : null,
    }));
  }

  return { weekly, mape, brands, pyData };
}

async function handleDifotLanding(fairView: boolean) {
  const overtradingFilter = fairView ? "AND IS_OVERTRADED = FALSE" : "";

  const [byGeo, byChannel, bySupplier, byBrand, leadTime] = await Promise.all([
    querySnowflake(`
      SELECT DC_STATE AS GEOGRAPHY,
             COUNT(*) AS TOTAL_ORDERS,
             SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END) AS DIFOT_ORDERS,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
             ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
             ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' ${overtradingFilter}
      GROUP BY DC_STATE ORDER BY DIFOT_PCT
    `),
    querySnowflake(`
      SELECT 
        CASE WHEN DC_STATE IN ('NSW','VIC') THEN 'In-Store' ELSE 'Online' END AS CHANNEL,
        COUNT(*) AS TOTAL_ORDERS,
        ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
        ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
        ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' ${overtradingFilter}
      GROUP BY CHANNEL ORDER BY DIFOT_PCT
    `),
    querySnowflake(`
      SELECT SUPPLIER_NAME, 
             COUNT(*) AS TOTAL_ORDERS,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
             ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
             ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT,
             ROUND(AVG(ACTUAL_LEAD_TIME_DAYS), 1) AS AVG_ACTUAL_LEAD,
             MAX(STD_LEAD_TIME_DAYS) AS STD_LEAD_TIME
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' ${overtradingFilter}
      GROUP BY SUPPLIER_NAME ORDER BY DIFOT_PCT
    `),
    querySnowflake(`
      SELECT BRAND_NAME, SUPPLIER_NAME,
             COUNT(*) AS TOTAL_ORDERS,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
             ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
             ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' ${overtradingFilter}
      GROUP BY BRAND_NAME, SUPPLIER_NAME ORDER BY DIFOT_PCT
    `),
    querySnowflake(`
      SELECT s.SUPPLIER_NAME, s.BRANDS, s.STD_LEAD_TIME_DAYS, s.SOURCING_TYPE, s.IS_3PL_VIABLE, s.ESTIMATED_3PL_DAYS,
             ROUND(AVG(r.ACTUAL_LEAD_TIME_DAYS), 1) AS AVG_ACTUAL_LEAD,
             ROUND(AVG(r.ACTUAL_LEAD_TIME_DAYS) - s.STD_LEAD_TIME_DAYS, 1) AS LEAD_GAP
      FROM BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR s
      LEFT JOIN BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC r
        ON r.SUPPLIER_NAME = s.SUPPLIER_NAME AND r.STATUS = 'DELIVERED'
      GROUP BY s.SUPPLIER_NAME, s.BRANDS, s.STD_LEAD_TIME_DAYS, s.SOURCING_TYPE, s.IS_3PL_VIABLE, s.ESTIMATED_3PL_DAYS
      ORDER BY LEAD_GAP DESC
    `),
  ]);

  // Overall DIFOT
  const overallRows = await querySnowflake(`
    SELECT COUNT(*) AS TOTAL,
           ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
    WHERE STATUS = 'DELIVERED' ${overtradingFilter}
  `);

  return {
    overall: { difotPct: safeFloat(overallRows[0]?.DIFOT_PCT), totalOrders: safeInt(overallRows[0]?.TOTAL), target: 95 },
    byGeography: byGeo.map(r => ({ geography: r.GEOGRAPHY, difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT), orders: safeInt(r.TOTAL_ORDERS) })),
    byChannel: byChannel.map(r => ({ channel: r.CHANNEL, difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT), orders: safeInt(r.TOTAL_ORDERS) })),
    bySupplier: bySupplier.map(r => ({ supplier: r.SUPPLIER_NAME, difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT), orders: safeInt(r.TOTAL_ORDERS), avgActualLead: safeFloat(r.AVG_ACTUAL_LEAD), stdLeadTime: safeInt(r.STD_LEAD_TIME) })),
    byBrand: byBrand.map(r => ({ brand: r.BRAND_NAME, supplier: r.SUPPLIER_NAME, difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT), orders: safeInt(r.TOTAL_ORDERS) })),
    leadTimeAnalysis: leadTime.map(r => ({ supplier: r.SUPPLIER_NAME, brands: r.BRANDS, stdLeadTime: safeInt(r.STD_LEAD_TIME_DAYS), avgActualLead: safeFloat(r.AVG_ACTUAL_LEAD), gap: safeFloat(r.LEAD_GAP), sourcingType: r.SOURCING_TYPE, is3plViable: r.IS_3PL_VIABLE, est3plDays: safeInt(r.ESTIMATED_3PL_DAYS) })),
    fairView,
  };
}

async function handlePlanningDifotBrand(brandName: string) {
  const brandSafe = escapeSql(brandName);
  const [weekly, skuBreakdown, supplierInfo] = await Promise.all([
    querySnowflake(`
      SELECT DATE_TRUNC('WEEK', ACTUAL_DELIVERY_DATE)::DATE AS WEEK,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
             ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
             ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT,
             ROUND(AVG(CASE WHEN NOT IS_ON_TIME THEN ACTUAL_LEAD_TIME_DAYS - STD_LEAD_TIME_DAYS END), 1) AS AVG_DAYS_LATE,
             ROUND(AVG(CASE WHEN NOT IS_IN_FULL THEN (1 - DELIVERED_UNITS::FLOAT / NULLIF(ORDERED_UNITS, 0)) * 100 END), 1) AS AVG_SHORTFALL_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE BRAND_NAME = '${brandSafe}' AND STATUS = 'DELIVERED'
      GROUP BY WEEK ORDER BY WEEK
    `),
    querySnowflake(`
      SELECT SKU_CLASS,
             COUNT(*) AS ORDERS,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_PCT,
             ROUND(SUM(CASE WHEN IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT,
             ROUND(SUM(CASE WHEN IS_IN_FULL THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DI_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE BRAND_NAME = '${brandSafe}' AND STATUS = 'DELIVERED'
      GROUP BY SKU_CLASS ORDER BY DIFOT_PCT
    `),
    querySnowflake(`
      SELECT SUPPLIER_NAME, STD_LEAD_TIME_DAYS, ROUND(AVG(ACTUAL_LEAD_TIME_DAYS), 1) AS AVG_ACTUAL
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE BRAND_NAME = '${brandSafe}' AND STATUS = 'DELIVERED'
      GROUP BY SUPPLIER_NAME, STD_LEAD_TIME_DAYS
    `),
  ]);

  return {
    brand: brandName,
    weekly: weekly.map(r => ({ week: r.WEEK, difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT), avgDaysLate: safeFloat(r.AVG_DAYS_LATE), avgShortfallPct: safeFloat(r.AVG_SHORTFALL_PCT) })),
    skuBreakdown: skuBreakdown.map(r => ({ skuClass: r.SKU_CLASS, orders: safeInt(r.ORDERS), difotPct: safeFloat(r.DIFOT_PCT), otPct: safeFloat(r.OT_PCT), diPct: safeFloat(r.DI_PCT) })),
    supplier: supplierInfo[0] ? { name: supplierInfo[0].SUPPLIER_NAME, stdLeadTime: safeInt(supplierInfo[0].STD_LEAD_TIME_DAYS), avgActualLead: safeFloat(supplierInfo[0].AVG_ACTUAL) } : null,
  };
}

async function handleOvertrading() {
  const [summary, bySupplier, byGeo] = await Promise.all([
    querySnowflake(`
      SELECT
        COUNT(*) AS TOTAL_ORDERS,
        SUM(CASE WHEN IS_OVERTRADED THEN 1 ELSE 0 END) AS OVERTRADED_ORDERS,
        SUM(CASE WHEN IS_RUSH_ORDER THEN 1 ELSE 0 END) AS RUSH_ORDERS,
        SUM(CASE WHEN OVERORDER_PCT > 20 THEN 1 ELSE 0 END) AS OVER_FORECAST_ORDERS,
        ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS DIFOT_ALL,
        ROUND(SUM(CASE WHEN IS_DIFOT AND NOT IS_OVERTRADED THEN 1 ELSE 0 END)::FLOAT / NULLIF(SUM(CASE WHEN NOT IS_OVERTRADED THEN 1 ELSE 0 END), 0) * 100, 1) AS DIFOT_FAIR,
        ROUND(SUM(CASE WHEN IS_DIFOT AND IS_OVERTRADED THEN 1 ELSE 0 END)::FLOAT / NULLIF(SUM(CASE WHEN IS_OVERTRADED THEN 1 ELSE 0 END), 0) * 100, 1) AS DIFOT_OVERTRADED
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED'
    `),
    querySnowflake(`
      SELECT SUPPLIER_NAME,
             ROUND(SUM(CASE WHEN IS_RUSH_ORDER THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS RUSH_PCT,
             ROUND(SUM(CASE WHEN OVERORDER_PCT > 20 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OVER_FCST_PCT,
             ROUND(SUM(CASE WHEN IS_DIFOT AND NOT IS_OVERTRADED THEN 1 ELSE 0 END)::FLOAT / NULLIF(SUM(CASE WHEN NOT IS_OVERTRADED THEN 1 ELSE 0 END), 0) * 100, 1) AS FAIR_DIFOT,
             ROUND(SUM(CASE WHEN IS_DIFOT THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS ALL_DIFOT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED'
      GROUP BY SUPPLIER_NAME ORDER BY RUSH_PCT DESC
    `),
    querySnowflake(`
      SELECT DC_STATE AS GEOGRAPHY,
             ROUND(SUM(CASE WHEN IS_OVERTRADED THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OVERTRADED_PCT,
             ROUND(SUM(CASE WHEN IS_RUSH_ORDER THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS RUSH_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED'
      GROUP BY DC_STATE ORDER BY OVERTRADED_PCT DESC
    `),
  ]);

  const s = summary[0] || {};
  return {
    summary: {
      totalOrders: safeInt(s.TOTAL_ORDERS),
      overtradedOrders: safeInt(s.OVERTRADED_ORDERS),
      overtradedPct: safeInt(s.TOTAL_ORDERS) > 0 ? Math.round(safeFloat(s.OVERTRADED_ORDERS) / safeFloat(s.TOTAL_ORDERS) * 1000) / 10 : 0,
      rushOrders: safeInt(s.RUSH_ORDERS),
      overForecastOrders: safeInt(s.OVER_FORECAST_ORDERS),
      difotAll: safeFloat(s.DIFOT_ALL),
      difotFair: safeFloat(s.DIFOT_FAIR),
      difotOvertraded: safeFloat(s.DIFOT_OVERTRADED),
      gapFromOvertrading: Math.round((safeFloat(s.DIFOT_FAIR) - safeFloat(s.DIFOT_ALL)) * 10) / 10,
    },
    bySupplier: bySupplier.map(r => ({ supplier: r.SUPPLIER_NAME, rushPct: safeFloat(r.RUSH_PCT), overFcstPct: safeFloat(r.OVER_FCST_PCT), fairDifot: safeFloat(r.FAIR_DIFOT), allDifot: safeFloat(r.ALL_DIFOT), impact: Math.round((safeFloat(r.FAIR_DIFOT) - safeFloat(r.ALL_DIFOT)) * 10) / 10 })),
    byGeography: byGeo.map(r => ({ geography: r.GEOGRAPHY, overtradedPct: safeFloat(r.OVERTRADED_PCT), rushPct: safeFloat(r.RUSH_PCT) })),
  };
}

async function handleLeadTime() {
  const rows = await querySnowflake(`
    SELECT s.SUPPLIER_NAME, s.BRANDS, s.STD_LEAD_TIME_DAYS, s.SOURCING_TYPE,
           s.IS_3PL_VIABLE, s.PRIMARY_CARRIER, s.TRANSPORT_MODE, s.ESTIMATED_3PL_DAYS,
           ROUND(AVG(r.ACTUAL_LEAD_TIME_DAYS), 1) AS AVG_ACTUAL_LEAD,
           ROUND(AVG(r.ACTUAL_LEAD_TIME_DAYS) - s.STD_LEAD_TIME_DAYS, 1) AS LEAD_GAP,
           COUNT(r.PO_NUMBER) AS TOTAL_POS,
           ROUND(SUM(CASE WHEN r.IS_ON_TIME THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS OT_PCT
    FROM BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR s
    LEFT JOIN BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC r
      ON r.SUPPLIER_NAME = s.SUPPLIER_NAME AND r.STATUS = 'DELIVERED'
    GROUP BY s.SUPPLIER_NAME, s.BRANDS, s.STD_LEAD_TIME_DAYS, s.SOURCING_TYPE, s.IS_3PL_VIABLE, s.PRIMARY_CARRIER, s.TRANSPORT_MODE, s.ESTIMATED_3PL_DAYS
    ORDER BY LEAD_GAP DESC
  `);

  return rows.map(r => ({
    supplier: r.SUPPLIER_NAME,
    brands: r.BRANDS,
    stdLeadTime: safeInt(r.STD_LEAD_TIME_DAYS),
    avgActualLead: safeFloat(r.AVG_ACTUAL_LEAD),
    gap: safeFloat(r.LEAD_GAP),
    sourcingType: r.SOURCING_TYPE,
    is3plViable: r.IS_3PL_VIABLE,
    carrier: r.PRIMARY_CARRIER,
    transportMode: r.TRANSPORT_MODE,
    est3plDays: safeInt(r.ESTIMATED_3PL_DAYS),
    totalPOs: safeInt(r.TOTAL_POS),
    otPct: safeFloat(r.OT_PCT),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONS HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handleOpsInbound(dc: string, period: string) {
  const dcFilter = dc !== "all" ? `AND DC_STATE = '${escapeSql(dc)}'` : "";
  const dateFilter = period === "today" ? "AND EXPECTED_DELIVERY_DATE = CURRENT_DATE()"
    : "AND EXPECTED_DELIVERY_DATE BETWEEN CURRENT_DATE() AND DATEADD(DAY, 7, CURRENT_DATE())";

  const [arrivals, performance, discrepancies] = await Promise.all([
    querySnowflake(`
      SELECT PO_NUMBER, SUPPLIER_NAME, BRAND_NAME, SKU_CLASS, DC_STATE, PALLETS, CARRIER,
             EXPECTED_DELIVERY_DATE, ACTUAL_DELIVERY_DATE, STATUS,
             DOCK_TO_CHECK_HOURS, CHECK_TO_PUTAWAY_HOURS
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE (STATUS IN ('IN_TRANSIT', 'ON_ORDER', 'OVERDUE') OR (STATUS = 'DELIVERED' AND ACTUAL_DELIVERY_DATE >= CURRENT_DATE() - 1))
      ${dcFilter} ${dateFilter}
      ORDER BY EXPECTED_DELIVERY_DATE, SUPPLIER_NAME
    `),
    querySnowflake(`
      SELECT DC_STATE,
             ROUND(AVG(DOCK_TO_CHECK_HOURS), 1) AS AVG_DOCK_CHECK,
             ROUND(AVG(CHECK_TO_PUTAWAY_HOURS), 1) AS AVG_CHECK_PUTAWAY,
             ROUND(SUM(CASE WHEN DOCK_TO_CHECK_HOURS + CHECK_TO_PUTAWAY_HOURS <= 8 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 1) AS SAME_DAY_PCT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS = 'DELIVERED' AND ACTUAL_DELIVERY_DATE >= CURRENT_DATE() - 7 ${dcFilter}
      GROUP BY DC_STATE
    `),
    querySnowflake(`
      SELECT PO_NUMBER, SUPPLIER_NAME, BRAND_NAME, SKU_CLASS, DC_STATE,
             DISCREPANCY_TYPE, DISCREPANCY_UNITS, ACTUAL_DELIVERY_DATE
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE HAS_DISCREPANCY = TRUE AND ACTUAL_DELIVERY_DATE >= CURRENT_DATE() - 7 ${dcFilter}
      ORDER BY ACTUAL_DELIVERY_DATE DESC
    `),
  ]);

  return {
    arrivals: arrivals.map(r => ({ po: r.PO_NUMBER, supplier: r.SUPPLIER_NAME, brand: r.BRAND_NAME, sku: r.SKU_CLASS, dc: r.DC_STATE, pallets: safeInt(r.PALLETS), carrier: r.CARRIER, expectedDate: r.EXPECTED_DELIVERY_DATE, status: r.STATUS, dockToCheck: safeFloat(r.DOCK_TO_CHECK_HOURS), checkToPutaway: safeFloat(r.CHECK_TO_PUTAWAY_HOURS) })),
    performance: performance.map(r => ({ dc: r.DC_STATE, avgDockCheck: safeFloat(r.AVG_DOCK_CHECK), avgCheckPutaway: safeFloat(r.AVG_CHECK_PUTAWAY), sameDayPct: safeFloat(r.SAME_DAY_PCT) })),
    discrepancies: discrepancies.map(r => ({ po: r.PO_NUMBER, supplier: r.SUPPLIER_NAME, brand: r.BRAND_NAME, sku: r.SKU_CLASS, dc: r.DC_STATE, type: r.DISCREPANCY_TYPE, units: safeInt(r.DISCREPANCY_UNITS), date: r.ACTUAL_DELIVERY_DATE })),
  };
}

async function handleOpsWorkforce(dc: string) {
  const dcFilter = dc !== "all" ? `AND DC_STATE = '${escapeSql(dc)}'` : "";

  const [today, trend] = await Promise.all([
    querySnowflake(`
      SELECT DC_STATE, SHIFT, SHIFT_START, SHIFT_END, STAFF_ROSTERED, STAFF_ACTUAL,
             INBOUND_PALLETS_EXPECTED, OUTBOUND_ORDERS_EXPECTED, OUTBOUND_PALLETS_EXPECTED,
             PALLETS_PER_PERSON_HOUR, STAFF_REQUIRED, STAFF_GAP, IS_UNDERSTAFFED, RISK_LEVEL
      FROM BABY_MART_DEMO.ANALYTICS.DC_WORKFORCE
      WHERE SHIFT_DATE = CURRENT_DATE() ${dcFilter}
      ORDER BY DC_STATE, SHIFT
    `),
    querySnowflake(`
      SELECT SHIFT_DATE, DC_STATE, 
             ROUND(AVG(PALLETS_PER_PERSON_HOUR), 2) AS AVG_PRODUCTIVITY,
             SUM(STAFF_GAP) AS TOTAL_GAP,
             SUM(CASE WHEN IS_UNDERSTAFFED THEN 1 ELSE 0 END) AS UNDERSTAFFED_SHIFTS
      FROM BABY_MART_DEMO.ANALYTICS.DC_WORKFORCE
      WHERE SHIFT_DATE BETWEEN CURRENT_DATE() - 14 AND CURRENT_DATE() ${dcFilter}
      GROUP BY SHIFT_DATE, DC_STATE
      ORDER BY SHIFT_DATE
    `),
  ]);

  return {
    today: today.map(r => ({ dc: r.DC_STATE, shift: r.SHIFT, shiftStart: r.SHIFT_START, shiftEnd: r.SHIFT_END, staffRostered: safeInt(r.STAFF_ROSTERED), staffActual: safeInt(r.STAFF_ACTUAL), inboundPallets: safeInt(r.INBOUND_PALLETS_EXPECTED), outboundOrders: safeInt(r.OUTBOUND_ORDERS_EXPECTED), outboundPallets: safeFloat(r.OUTBOUND_PALLETS_EXPECTED), productivity: safeFloat(r.PALLETS_PER_PERSON_HOUR), staffRequired: safeInt(r.STAFF_REQUIRED), staffGap: safeInt(r.STAFF_GAP), isUnderstaffed: r.IS_UNDERSTAFFED, riskLevel: r.RISK_LEVEL })),
    trend: trend.map(r => ({ date: r.SHIFT_DATE, dc: r.DC_STATE, avgProductivity: safeFloat(r.AVG_PRODUCTIVITY), totalGap: safeInt(r.TOTAL_GAP), understaffedShifts: safeInt(r.UNDERSTAFFED_SHIFTS) })),
  };
}

async function handleOpsOutbound(dc: string, channel: string) {
  const dcFilter = dc !== "all" ? `AND DC_STATE = '${escapeSql(dc)}'` : "";
  const channelFilter = channel !== "all" ? `AND CHANNEL = '${escapeSql(channel)}'` : "";

  const [kpis, byChannel, carrierPerf, issues] = await Promise.all([
    querySnowflake(`
      SELECT COUNT(*) AS TOTAL_ORDERS,
             SUM(CASE WHEN STATUS = 'DELIVERED' OR STATUS = 'IN_TRANSIT' THEN 1 ELSE 0 END) AS DISPATCHED,
             ROUND(AVG(ORDER_TO_DISPATCH_HOURS), 1) AS AVG_DISPATCH_HOURS,
             ROUND(SUM(CASE WHEN ON_TIME_DISPATCH THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(ON_TIME_DISPATCH), 0) * 100, 1) AS ON_TIME_DISPATCH_PCT,
             ROUND(AVG(PICK_ACCURACY_PCT), 1) AS AVG_PICK_ACCURACY
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE
      WHERE ORDER_RECEIVED_TIMESTAMP::DATE >= CURRENT_DATE() - 1 ${dcFilter} ${channelFilter}
    `),
    querySnowflake(`
      SELECT CHANNEL, COUNT(*) AS ORDERS,
             ROUND(SUM(CASE WHEN ON_TIME_DISPATCH THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(ON_TIME_DISPATCH), 0) * 100, 1) AS ON_TIME_PCT,
             ROUND(SUM(PALLETS), 1) AS TOTAL_PALLETS
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE
      WHERE ORDER_RECEIVED_TIMESTAMP::DATE >= CURRENT_DATE() - 1 ${dcFilter}
      GROUP BY CHANNEL
    `),
    querySnowflake(`
      SELECT CARRIER, COUNT(*) AS SHIPMENTS,
             ROUND(SUM(CASE WHEN ON_TIME_DELIVERY THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(ON_TIME_DELIVERY), 0) * 100, 1) AS ON_TIME_PCT,
             ROUND(AVG(TRANSIT_DAYS_ACTUAL), 1) AS AVG_TRANSIT
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE
      WHERE STATUS = 'DELIVERED' AND DELIVERY_TIMESTAMP >= CURRENT_DATE() - 7 ${dcFilter}
      GROUP BY CARRIER ORDER BY ON_TIME_PCT DESC
    `),
    querySnowflake(`
      SELECT COUNT(CASE WHEN IS_BACKORDER THEN 1 END) AS BACKORDERS,
             COUNT(CASE WHEN IS_SPLIT_SHIPMENT THEN 1 END) AS SPLITS
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE
      WHERE ORDER_RECEIVED_TIMESTAMP::DATE >= CURRENT_DATE() - 7 ${dcFilter}
    `),
  ]);

  const k = kpis[0] || {};
  const iss = issues[0] || {};
  return {
    kpis: { totalOrders: safeInt(k.TOTAL_ORDERS), dispatched: safeInt(k.DISPATCHED), avgDispatchHours: safeFloat(k.AVG_DISPATCH_HOURS), onTimeDispatchPct: safeFloat(k.ON_TIME_DISPATCH_PCT), avgPickAccuracy: safeFloat(k.AVG_PICK_ACCURACY) },
    byChannel: byChannel.map(r => ({ channel: r.CHANNEL, orders: safeInt(r.ORDERS), onTimePct: safeFloat(r.ON_TIME_PCT), pallets: safeFloat(r.TOTAL_PALLETS) })),
    carrierPerformance: carrierPerf.map(r => ({ carrier: r.CARRIER, shipments: safeInt(r.SHIPMENTS), onTimePct: safeFloat(r.ON_TIME_PCT), avgTransit: safeFloat(r.AVG_TRANSIT) })),
    issues: { backorders: safeInt(iss.BACKORDERS), splitShipments: safeInt(iss.SPLITS) },
  };
}

async function handleOpsCapacity() {
  const rows = await querySnowflake(`
    SELECT SHIFT_DATE, DC_STATE,
           SUM(INBOUND_PALLETS_EXPECTED) AS INBOUND_PALLETS,
           SUM(OUTBOUND_ORDERS_EXPECTED) AS OUTBOUND_ORDERS,
           SUM(OUTBOUND_PALLETS_EXPECTED) AS OUTBOUND_PALLETS,
           MAX(RISK_LEVEL) AS PEAK_RISK
    FROM BABY_MART_DEMO.ANALYTICS.DC_WORKFORCE
    WHERE SHIFT_DATE BETWEEN CURRENT_DATE() - 7 AND CURRENT_DATE() + 3
    GROUP BY SHIFT_DATE, DC_STATE
    ORDER BY SHIFT_DATE, DC_STATE
  `);

  return rows.map(r => ({
    date: r.SHIFT_DATE,
    dc: r.DC_STATE,
    inboundPallets: safeInt(r.INBOUND_PALLETS),
    outboundOrders: safeInt(r.OUTBOUND_ORDERS),
    outboundPallets: safeFloat(r.OUTBOUND_PALLETS),
    peakRisk: r.PEAK_RISK,
  }));
}

async function handlePurchaseOrders() {
  const rows = await querySnowflake(`
    SELECT PO_NUMBER, ORDER_DATE, EXPECTED_DELIVERY_DATE, SUPPLIER_NAME, BRAND_NAME,
           SKU_CLASS, DC_STATE, ORDERED_UNITS, CARRIER, PALLETS, STATUS,
           DATEDIFF(DAY, CURRENT_DATE(), EXPECTED_DELIVERY_DATE) AS DAYS_UNTIL_DUE
    FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
    WHERE STATUS IN ('ON_ORDER', 'IN_TRANSIT', 'OVERDUE')
    ORDER BY CASE STATUS WHEN 'OVERDUE' THEN 1 WHEN 'IN_TRANSIT' THEN 2 ELSE 3 END,
             EXPECTED_DELIVERY_DATE
  `);
  return rows.map(r => ({
    po: r.PO_NUMBER,
    orderDate: r.ORDER_DATE,
    expectedDate: r.EXPECTED_DELIVERY_DATE,
    supplier: r.SUPPLIER_NAME,
    brand: r.BRAND_NAME,
    sku: r.SKU_CLASS,
    dc: r.DC_STATE,
    orderedUnits: safeInt(r.ORDERED_UNITS),
    carrier: r.CARRIER,
    pallets: safeInt(r.PALLETS),
    status: r.STATUS,
    daysUntilDue: safeInt(r.DAYS_UNTIL_DUE),
  }));
}

async function handleDcCommandCenter() {
  // Get current stock levels + demand + supplier delivery ETAs
  const [inventory, pendingDeliveries] = await Promise.all([
    querySnowflake(`
      SELECT i.BRAND_NAME, i.SKU_CLASS, i.CATEGORY, i.DC_STATE, i.CLOSING_STOCK, i.DEMAND_UNITS, i.REORDER_POINT,
             s.SUPPLIER_NAME, s.STD_LEAD_TIME_DAYS
      FROM BABY_MART_DEMO.ANALYTICS.SKU_INVENTORY_WEEKLY i
      LEFT JOIN BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR s ON CONTAINS(s.BRANDS, i.BRAND_NAME)
      WHERE i.DC_STATE != 'NATIONAL' AND i.WEEK_LABEL = 'W-1'
      ORDER BY i.CLOSING_STOCK / NULLIF(i.DEMAND_UNITS, 1)
    `),
    querySnowflake(`
      SELECT BRAND_NAME, SKU_CLASS, DC_STATE, SUPPLIER_NAME, EXPECTED_DELIVERY_DATE, ORDERED_UNITS, STATUS
      FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
      WHERE STATUS IN ('ON_ORDER', 'IN_TRANSIT', 'OVERDUE')
      ORDER BY EXPECTED_DELIVERY_DATE
    `),
  ]);

  const items = inventory.map(r => {
    const stock = safeFloat(r.CLOSING_STOCK);
    const demand = safeFloat(r.DEMAND_UNITS);
    const woc = demand > 0 ? Math.round((stock / demand) * 10) / 10 : 99;
    const nextDelivery = pendingDeliveries.find(d => d.BRAND_NAME === r.BRAND_NAME && d.SKU_CLASS === r.SKU_CLASS && d.DC_STATE === r.DC_STATE);

    return {
      brand: r.BRAND_NAME,
      sku: r.SKU_CLASS,
      category: r.CATEGORY,
      dc: r.DC_STATE,
      stock: Math.round(stock),
      demandPerWeek: Math.round(demand),
      woc,
      reorderPoint: safeInt(r.REORDER_POINT),
      supplier: r.SUPPLIER_NAME,
      leadTime: safeInt(r.STD_LEAD_TIME_DAYS),
      nextDeliveryDate: nextDelivery?.EXPECTED_DELIVERY_DATE || null,
      nextDeliveryUnits: nextDelivery ? safeInt(nextDelivery.ORDERED_UNITS) : null,
      nextDeliveryStatus: nextDelivery?.STATUS || null,
      status: woc < 2 ? "CRITICAL" : woc < 3 ? "WARNING" : "OK",
    };
  });

  const attention = items.filter(i => i.status !== "OK");

  return {
    attention,
    allItems: items,
    summary: {
      totalSkus: items.length,
      critical: items.filter(i => i.status === "CRITICAL").length,
      warning: items.filter(i => i.status === "WARNING").length,
      ok: items.filter(i => i.status === "OK").length,
    },
  };
}
