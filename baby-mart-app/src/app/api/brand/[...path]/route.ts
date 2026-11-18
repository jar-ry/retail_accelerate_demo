import { querySnowflakeWithBinds } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // Route: /api/brand/{brandName}/skus
  if (path.length >= 2 && path[path.length - 1] === "skus") {
    const brandName = decodeURIComponent(path.slice(0, -1).join("/"));
    return getSkuData(brandName);
  }

  // Route: /api/brand/{brandName}/overview
  if (path.length >= 2 && path[path.length - 1] === "overview") {
    const brandName = decodeURIComponent(path.slice(0, -1).join("/"));
    try {
      const data = await getOverview(brandName);
      return data ? NextResponse.json(data) : NextResponse.json({ error: `No brand '${brandName}'` }, { status: 404 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Route: /api/brand/category/{category} -- every brand in one POS category
  if (path.length === 2 && path[0] === "category") {
    const category = decodeURIComponent(path[1]);
    try {
      const data = await getCategory(category);
      return data ? NextResponse.json(data) : NextResponse.json({ error: `No category '${category}'` }, { status: 404 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Route: /api/brand/list -- every brand with its category, for the battlecard picker
  if (path.length === 1 && path[0] === "list") {
    try {
      return NextResponse.json(await listBrands());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// ---------- /overview ----------
// The brand page used to read src/data/brandConfig.ts: hand-typed figures that no
// query produced, so nothing on it could be checked and an agent answer could
// never agree with it. Everything here comes from POS (FACT_TRANSACTION_LINES)
// over the same windows the brand investigator uses (sql/26):
//   cy = the 28 days 10 Apr - 7 May 2026 (POS ends 7 May), ly = the same days of 2025.
// Margin is total margin / total revenue. Values are bound, never spliced.
const CY = "f.DATE_KEY BETWEEN 20260410 AND 20260507";
const LY = "f.DATE_KEY BETWEEN 20250410 AND 20250507";
const C = "BABY_MART_DEMO.CURATED";
const A = "BABY_MART_DEMO.ANALYTICS";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const pct = (a: number | null, b: number | null) => (a !== null && b ? Math.round((a / b - 1) * 1000) / 10 : null);
const r1 = (v: number | null) => (v === null || !isFinite(v) ? null : Math.round(v * 10) / 10);
type Row = Record<string, unknown>;

// Every brand in a category over the window, and its DIFOT (orders-weighted,
// the brand-level rows -- class rows exist for FY2026 only -- FY2026 weeks 15-18).
const PEER_BASE = `FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY`;
const PEER_SQL = `SELECT b.BRAND_NAME, SUM(IFF(${CY}, f.NET_REVENUE, 0)) AS REV, SUM(IFF(${LY}, f.NET_REVENUE, 0)) AS REV_LY,
     SUM(IFF(${CY}, f.QUANTITY, 0)) AS UNITS, SUM(IFF(${CY}, f.MARGIN_AMOUNT, 0)) AS MARGIN,
     COUNT(DISTINCT IFF(${CY}, f.TRANSACTION_ID, NULL)) AS TXNS, COUNT(DISTINCT IFF(${CY} AND f.CUSTOMER_KEY > 0, f.CUSTOMER_KEY, NULL)) AS CUSTOMERS,
     COUNT(DISTINCT IFF(${CY}, f.STORE_KEY, NULL)) AS STORES
   ${PEER_BASE} WHERE p.CATEGORY = ? AND (${CY} OR ${LY}) GROUP BY 1`;
const DIFOT_SQL = `SELECT BRAND_NAME, SUM(DIFOT_PCT * ORDERS_TOTAL) / NULLIF(SUM(ORDERS_TOTAL), 0) AS DIFOT
   FROM ${A}.DT_SUPPLIER_DIFOT WHERE CATEGORY = ? AND CLASS IS NULL AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 15 AND 18 GROUP BY 1`;

function toPeers(peerRows: Row[], difotRows: Row[]) {
  const difot = new Map(difotRows.map((r) => [String(r.BRAND_NAME), r1(num(r.DIFOT))]));
  const catRev = peerRows.reduce((s, r) => s + Number(r.REV || 0), 0);
  const catRevLy = peerRows.reduce((s, r) => s + Number(r.REV_LY || 0), 0);
  const peers = peerRows.map((r) => {
    const rev = Number(r.REV || 0), ly = Number(r.REV_LY || 0), units = Number(r.UNITS || 0), stores = Number(r.STORES || 0);
    return { brand: String(r.BRAND_NAME), revenue: Math.round(rev), growthPct: pct(rev, ly), marginPct: rev ? r1((Number(r.MARGIN) / rev) * 100) : null,
      sharePct: catRev ? r1((rev / catRev) * 100) : null, shareLyPct: catRevLy ? r1((ly / catRevLy) * 100) : null,
      rosPerStoreWeek: stores ? r1(units / stores / 4) : null, difotPct: difot.get(String(r.BRAND_NAME)) ?? null,
      units, transactions: Number(r.TXNS || 0), customers: Number(r.CUSTOMERS || 0) };
  }).sort((a, b) => b.revenue - a.revenue);
  return { peers, catRev, catRevLy };
}

// ---------- /category/{category} ----------
// The category page used to read brandConfig.ts too. Same POS window as the brand
// page, plus each brand's DC weeks of cover from the supply side (as at the supply
// clock, 11 June 2026) so an overstocked brand shows up where it is sold.
async function getCategory(category: string) {
  const q = querySnowflakeWithBinds;
  const [peerRows, difotRows, coverRows] = await Promise.all([
    q(PEER_SQL, [category]),
    q(DIFOT_SQL, [category]),
    q(`SELECT BRAND_NAME, CURRENT_STOCK_UNITS / NULLIF(WEEKLY_DEMAND, 0) AS WOC, TARGET_WOC
       FROM ${A}.BRAND_SUPPLY_PROFILE WHERE CATEGORY = ?`, [category]),
  ]);
  if (!(peerRows as Row[]).length) return null;
  const { peers, catRev, catRevLy } = toPeers(peerRows as Row[], difotRows as Row[]);
  const cover = new Map((coverRows as Row[]).map((r) => [String(r.BRAND_NAME), { woc: r1(num(r.WOC)), target: num(r.TARGET_WOC) }]));
  const catMargin = (peerRows as Row[]).reduce((s, r) => s + Number(r.MARGIN || 0), 0);
  return {
    category, period: "28 days to 7 May 2026 vs the same days of 2025 (POS)", coverAsOf: "DC cover at the supply clock, 11 June 2026",
    revenue: Math.round(catRev), growthPct: pct(catRev, catRevLy), marginPct: catRev ? r1((catMargin / catRev) * 100) : null,
    brands: peers.map((p) => ({ ...p, dcCoverWeeks: cover.get(p.brand)?.woc ?? null, dcCoverTarget: cover.get(p.brand)?.target ?? null })),
  };
}

// ---------- /list ----------
async function listBrands() {
  const rows = await querySnowflakeWithBinds(
    `SELECT p.CATEGORY, b.BRAND_NAME, SUM(f.NET_REVENUE) AS REV ${PEER_BASE} WHERE ${CY} GROUP BY 1, 2 ORDER BY 1, 3 DESC`, []);
  return { period: "28 days to 7 May 2026 (POS)",
    brands: (rows as Row[]).map((r) => ({ brand: String(r.BRAND_NAME), category: String(r.CATEGORY), revenue: Math.round(Number(r.REV || 0)) })) };
}

async function getOverview(brand: string) {
  const q = querySnowflakeWithBinds;
  const cat = (await q(`SELECT MAX(p.CATEGORY) AS CATEGORY FROM ${C}.DIM_PRODUCT p JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY WHERE b.BRAND_NAME = ?`, [brand]))[0] as Row | undefined;
  const category = cat?.CATEGORY ? String(cat.CATEGORY) : null;
  if (!category) return null;

  const base = `FROM ${C}.FACT_TRANSACTION_LINES f JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = f.PRODUCT_KEY JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY`;
  const [peerRows, stateRows, stockRows, segRows, switchRows, difotRows, classRows] = await Promise.all([
    q(PEER_SQL, [category]),
    q(`SELECT s.STATE, SUM(IFF(${CY}, f.NET_REVENUE, 0)) AS REV, SUM(IFF(${LY}, f.NET_REVENUE, 0)) AS REV_LY, SUM(IFF(${CY}, f.QUANTITY, 0)) AS UNITS
       ${base} JOIN ${C}.DIM_STORE s ON s.STORE_KEY = f.STORE_KEY WHERE b.BRAND_NAME = ? AND (${CY} OR ${LY}) GROUP BY 1 ORDER BY 2 DESC`, [brand]),
    q(`SELECT s.STATE, SUM(i.STOCK_ON_HAND) AS SOH FROM ${C}.FACT_INVENTORY i JOIN ${C}.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY
       JOIN ${C}.DIM_BRAND b ON b.BRAND_KEY = p.BRAND_KEY JOIN ${C}.DIM_STORE s ON s.STORE_KEY = i.STORE_KEY
       WHERE b.BRAND_NAME = ? AND i.DATE_KEY = 20260507 GROUP BY 1`, [brand]),
    q(`SELECT COALESCE(cs.SEGMENT_NAME, 'Unknown') AS SEGMENT,
         COUNT(DISTINCT IFF(b.BRAND_NAME = ?, f.CUSTOMER_KEY, NULL)) AS BRAND_CUSTOMERS, COUNT(DISTINCT f.CUSTOMER_KEY) AS CATEGORY_CUSTOMERS
       ${base} JOIN ${C}.DIM_CUSTOMER c ON c.CUSTOMER_KEY = f.CUSTOMER_KEY LEFT JOIN ${C}.DIM_CUSTOMER_SEGMENT cs ON cs.SEGMENT_KEY = c.SEGMENT_KEY
       WHERE p.CATEGORY = ? AND ${CY} AND f.CUSTOMER_KEY > 0 GROUP BY 1`, [brand, category]),
    q(`SELECT IFF(TO_BRAND = ?, 'in', 'out') AS DIRECTION, IFF(TO_BRAND = ?, FROM_BRAND, TO_BRAND) AS OTHER, SUM(SWITCH_COUNT) AS N
       FROM ${A}.DT_BRAND_SWITCHING WHERE TO_BRAND = ? OR FROM_BRAND = ? GROUP BY 1, 2 ORDER BY 3 DESC`, [brand, brand, brand, brand]),
    q(DIFOT_SQL, [category]),
    // Per class: POS this year vs last, and whether the reported weekly demand view agrees with POS (FY2026 weeks 1-19).
    q(`WITH pos AS (SELECT p.CLASS, SUM(IFF(${CY}, f.NET_REVENUE, 0)) AS REV, SUM(IFF(${LY}, f.NET_REVENUE, 0)) AS REV_LY
         ${base} WHERE b.BRAND_NAME = ? AND (${CY} OR ${LY}) GROUP BY 1),
       rep AS (SELECT SKU_CLASS AS CLASS, SUM(UNITS) AS REP FROM ${A}.V_STORE_DEMAND_WEEKLY WHERE BRAND_NAME = ? AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1),
       st AS (SELECT CLASS, SUM(UNITS_SOLD) AS POSU FROM ${A}.DT_SELLTHROUGH_WEEKLY WHERE BRAND_NAME = ? AND FISCAL_YEAR = 2026 AND FISCAL_WEEK BETWEEN 1 AND 19 GROUP BY 1)
       SELECT pos.CLASS, pos.REV, pos.REV_LY, rep.REP, st.POSU FROM pos LEFT JOIN rep ON rep.CLASS = pos.CLASS LEFT JOIN st ON st.CLASS = pos.CLASS ORDER BY pos.REV DESC`, [brand, brand, brand]),
  ]);

  const { peers } = toPeers(peerRows as Row[], difotRows as Row[]);
  const me = peers.find((p) => p.brand === brand);
  if (!me) return null;

  const soh = new Map((stockRows as Row[]).map((r) => [String(r.STATE), Number(r.SOH || 0)]));
  const states = (stateRows as Row[]).map((r) => {
    const units = Number(r.UNITS || 0), stock = soh.get(String(r.STATE)) ?? null;
    return { state: String(r.STATE), revenue: Math.round(Number(r.REV || 0)), growthPct: pct(Number(r.REV || 0), Number(r.REV_LY || 0)),
      weeksOfCover: stock !== null && units ? r1(stock / (units / 4)) : null };
  });
  const totalSoh = [...soh.values()].reduce((s, v) => s + v, 0);

  const segBrand = (segRows as Row[]).reduce((s, r) => s + Number(r.BRAND_CUSTOMERS || 0), 0);
  const segCat = (segRows as Row[]).reduce((s, r) => s + Number(r.CATEGORY_CUSTOMERS || 0), 0);
  const segments = (segRows as Row[]).map((r) => {
    const pen = segBrand ? (Number(r.BRAND_CUSTOMERS) / segBrand) * 100 : 0, catPen = segCat ? (Number(r.CATEGORY_CUSTOMERS) / segCat) * 100 : 0;
    return { name: String(r.SEGMENT), customers: Number(r.BRAND_CUSTOMERS || 0), penetrationPct: r1(pen), vsCategoryPts: r1(pen - catPen) };
  }).filter((s) => s.customers > 0).sort((a, b) => b.customers - a.customers);

  const sw = switchRows as Row[];
  const swTotal = (d: string) => sw.filter((r) => r.DIRECTION === d).reduce((s, r) => s + Number(r.N || 0), 0);
  const swList = (d: string) => sw.filter((r) => r.DIRECTION === d).slice(0, 3)
    .map((r) => ({ brand: String(r.OTHER), customers: Number(r.N || 0), sharePct: swTotal(d) ? r1((Number(r.N) / swTotal(d)) * 100) : null }));

  const classes = (classRows as Row[]).map((r) => {
    const rep = num(r.REP), pos = num(r.POSU);
    const repVsPos = rep !== null && pos ? r1((rep / pos - 1) * 100) : null;
    return { class: String(r.CLASS), revenue: Math.round(Number(r.REV || 0)), growthPct: pct(Number(r.REV || 0), Number(r.REV_LY || 0)),
      reportedVsPosPct: repVsPos, reportedDiffers: repVsPos !== null && Math.abs(repVsPos) >= 1 };
  });

  return {
    brand, category, period: "28 days to 7 May 2026 vs the same days of 2025 (POS)",
    kpis: {
      revenue: me.revenue, growthPct: me.growthPct, units: me.units, marginPct: me.marginPct, sharePct: me.sharePct,
      shareChangePts: me.sharePct !== null && me.shareLyPct !== null ? r1(me.sharePct - me.shareLyPct) : null,
      rosPerStoreWeek: me.rosPerStoreWeek, weeksOfCover: me.units ? r1(totalSoh / (me.units / 4)) : null,
      aov: me.transactions ? Math.round((me.revenue / me.transactions) * 100) / 100 : null,
      unitsPerOrder: me.transactions ? Math.round((me.units / me.transactions) * 100) / 100 : null,
      customers: me.customers, difotPct: me.difotPct,
    },
    states, segments, peers, classes,
    switching: { cameFrom: swList("in"), leftFor: swList("out"), inTotal: swTotal("in"), outTotal: swTotal("out") },
  };
}

async function getSkuData(brandName: string) {
  try {
    // Class-level summary. The brand is BOUND (it comes off the URL), and margin
    // is total margin / total revenue -- AVG of line-level ratios lets a $2
    // sachet weigh as much as a $900 pram.
    const classSql = `
      SELECT dp.CLASS,
             SUM(f.NET_REVENUE) AS revenue,
             SUM(f.QUANTITY) AS units,
             COUNT(DISTINCT f.TRANSACTION_ID) AS transactions,
             SUM(f.MARGIN_AMOUNT) / NULLIF(SUM(f.NET_REVENUE), 0) * 100 AS margin_pct
      FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
      JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
      JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
      WHERE db.BRAND_NAME = ?
        AND f.DATE_KEY >= 20260410 AND f.DATE_KEY <= 20260507
      GROUP BY dp.CLASS
      ORDER BY revenue DESC
    `;

    // SKU-level detail with YoY growth
    const skuSql = `
      WITH current_period AS (
        SELECT dp.PRODUCT_KEY, dp.PRODUCT_NAME, dp.CLASS, dp.SUBCLASS,
               dp.UNIT_RETAIL, dp.MARGIN_PCT AS list_margin, dp.LIFECYCLE_STAGE,
               SUM(f.NET_REVENUE) AS revenue,
               SUM(f.QUANTITY) AS units,
               COUNT(DISTINCT f.TRANSACTION_ID) AS transactions,
               SUM(f.MARGIN_AMOUNT) / NULLIF(SUM(f.NET_REVENUE), 0) * 100 AS actual_margin_pct,
               SUM(f.NET_REVENUE) / NULLIF(SUM(f.QUANTITY), 0) AS avg_selling_price
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE db.BRAND_NAME = ?
          AND f.DATE_KEY >= 20260410 AND f.DATE_KEY <= 20260507
        GROUP BY dp.PRODUCT_KEY, dp.PRODUCT_NAME, dp.CLASS, dp.SUBCLASS,
                 dp.UNIT_RETAIL, dp.MARGIN_PCT, dp.LIFECYCLE_STAGE
      ),
      prior_period AS (
        SELECT dp.PRODUCT_KEY,
               SUM(f.NET_REVENUE) AS revenue
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE db.BRAND_NAME = ?
          AND f.DATE_KEY >= 20250410 AND f.DATE_KEY <= 20250507
        GROUP BY dp.PRODUCT_KEY
      )
      SELECT c.PRODUCT_NAME, c.CLASS, c.SUBCLASS, c.UNIT_RETAIL, c.LIST_MARGIN,
             c.LIFECYCLE_STAGE, c.revenue, c.units, c.transactions,
             c.actual_margin_pct, c.avg_selling_price,
             ROUND((c.revenue - COALESCE(p.revenue, 0)) / NULLIF(p.revenue, 0) * 100, 1) AS growth_pct
      FROM current_period c
      LEFT JOIN prior_period p ON c.PRODUCT_KEY = p.PRODUCT_KEY
      ORDER BY c.revenue DESC
    `;

    const [classRows, skuRows] = await Promise.all([
      querySnowflakeWithBinds(classSql, [brandName]),
      querySnowflakeWithBinds(skuSql, [brandName, brandName]),
    ]);

    const classes = classRows.map((r: any) => ({
      name: r.CLASS,
      revenue: Number(r.REVENUE),
      units: Number(r.UNITS),
      transactions: Number(r.TRANSACTIONS),
      marginPct: Number(r.MARGIN_PCT)?.toFixed(1),
    }));

    const skus = skuRows.map((r: any) => ({
      name: r.PRODUCT_NAME,
      class: r.CLASS,
      subclass: r.SUBCLASS,
      retailPrice: Number(r.UNIT_RETAIL),
      avgSellingPrice: Number(r.AVG_SELLING_PRICE),
      listMargin: (Number(r.LIST_MARGIN) * 100).toFixed(0),
      lifecycleStage: r.LIFECYCLE_STAGE,
      revenue: Number(r.REVENUE),
      units: Number(r.UNITS),
      transactions: Number(r.TRANSACTIONS),
      actualMarginPct: Number(r.ACTUAL_MARGIN_PCT)?.toFixed(1),
      growth: r.GROWTH_PCT !== null ? Number(r.GROWTH_PCT) : null,
    }));

    return NextResponse.json({ brand: brandName, classes, skus });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
