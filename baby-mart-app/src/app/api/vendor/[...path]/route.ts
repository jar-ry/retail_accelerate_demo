/**
 * Vendor Economics API — profitability, benchmarking, scorecards.
 * Catch-all route handling: /api/vendor/suppliers, /api/vendor/profitability,
 * /api/vendor/benchmarking, /api/vendor/scorecard/:supplier, /api/vendor/insights
 */
import { NextRequest, NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segment = path[0];

  switch (segment) {
    case "suppliers":
      return handleGetSuppliers();
    case "profitability":
      return handleGetProfitability(request);
    case "benchmarking":
      return handleGetBenchmarking(request);
    case "scorecard":
      const supplierName = path.slice(1).join("/");
      if (!supplierName) {
        return NextResponse.json(
          { error: "Supplier name is required" },
          { status: 400 }
        );
      }
      return handleGetScorecard(decodeURIComponent(supplierName));
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segment = path[0];

  switch (segment) {
    case "insights":
      return handlePostInsights(request);
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// ---------- /suppliers ----------
async function handleGetSuppliers() {
  const sql = `
    SELECT s.SUPPLIER_KEY, s.SUPPLIER_NAME, s.PAYMENT_TERMS, s.LEAD_TIME_DAYS,
           COUNT(DISTINCT p.PRODUCT_KEY) AS PRODUCT_COUNT,
           COUNT(DISTINCT p.CATEGORY) AS CATEGORY_COUNT
    FROM BABY_MART_DEMO.CURATED.DIM_SUPPLIER s
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON s.SUPPLIER_KEY = p.SUPPLIER_KEY
    GROUP BY s.SUPPLIER_KEY, s.SUPPLIER_NAME, s.PAYMENT_TERMS, s.LEAD_TIME_DAYS
    ORDER BY s.SUPPLIER_NAME
  `;
  const rows = await querySnowflake(sql);
  const result = rows.map((r: Record<string, unknown>) => ({
    key: r["SUPPLIER_KEY"],
    name: r["SUPPLIER_NAME"],
    paymentTerms: r["PAYMENT_TERMS"],
    leadTimeDays: r["LEAD_TIME_DAYS"],
    products: r["PRODUCT_COUNT"],
    categories: r["CATEGORY_COUNT"],
  }));
  return NextResponse.json(result);
}

// ---------- /profitability ----------
async function handleGetProfitability(request: NextRequest) {
  const supplier = request.nextUrl.searchParams.get("supplier") || "";
  const supplierSafe = supplier.replace(/'/g, "''");
  const supplierFilter = supplier
    ? `AND s.SUPPLIER_NAME = '${supplierSafe}'`
    : "";

  const waterfallSql = `
    SELECT
        SUM(t.NET_REVENUE + t.DISCOUNT_AMOUNT) AS GROSS_SALES,
        SUM(t.DISCOUNT_AMOUNT) AS TOTAL_DISCOUNTS,
        SUM(CASE WHEN pr.PROMOTION_KEY IS NOT NULL THEN t.DISCOUNT_AMOUNT ELSE 0 END) AS PROMO_ALLOWANCES,
        SUM(t.NET_REVENUE) AS NET_SALES,
        SUM(t.COST_AMOUNT) AS COGS,
        SUM(t.MARGIN_AMOUNT) AS GROSS_MARGIN
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    LEFT JOIN BABY_MART_DEMO.CURATED.DIM_PROMOTION pr ON t.PROMOTION_KEY = pr.PROMOTION_KEY AND pr.PROMOTION_KEY > 0
    WHERE 1=1 ${supplierFilter}
  `;

  const skuSql = `
    SELECT p.PRODUCT_NAME, p.CATEGORY, p.CLASS,
           SUM(t.NET_REVENUE + t.DISCOUNT_AMOUNT) AS GROSS_SALES,
           SUM(t.DISCOUNT_AMOUNT) AS DISCOUNTS,
           SUM(t.NET_REVENUE) AS NET_SALES,
           SUM(t.COST_AMOUNT) AS COGS,
           SUM(t.MARGIN_AMOUNT) AS MARGIN,
           ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT,
           SUM(t.QUANTITY) AS UNITS
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE 1=1 ${supplierFilter}
    GROUP BY p.PRODUCT_NAME, p.CATEGORY, p.CLASS
    ORDER BY NET_SALES DESC
    LIMIT 20
  `;

  const trendSql = `
    SELECT TO_CHAR(TO_DATE(CAST(t.DATE_KEY AS VARCHAR), 'YYYYMMDD'), 'YYYY-MM') AS MONTH_LABEL,
           SUM(t.NET_REVENUE) AS REVENUE,
           SUM(t.MARGIN_AMOUNT) AS MARGIN,
           ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE 1=1 ${supplierFilter}
    GROUP BY MONTH_LABEL
    ORDER BY MONTH_LABEL
  `;

  const [waterfall, skus, trend] = await Promise.all([
    querySnowflake(waterfallSql),
    querySnowflake(skuSql),
    querySnowflake(trendSql),
  ]);

  const w: Record<string, unknown> = waterfall[0] || {};
  const gross = Number(w["GROSS_SALES"] || 0);
  const discounts = Number(w["TOTAL_DISCOUNTS"] || 0);
  const promo = Number(w["PROMO_ALLOWANCES"] || 0);
  const netSales = Number(w["NET_SALES"] || 0);
  const cogs = Number(w["COGS"] || 0);
  const margin = Number(w["GROSS_MARGIN"] || 0);
  // Estimate rebates as ~2% of net sales for demo
  const rebates = Math.round(netSales * 0.02);
  const netMargin = margin - rebates;

  return NextResponse.json({
    waterfall: {
      grossSales: Math.round(gross),
      discounts: Math.round(discounts),
      promoAllowances: Math.round(promo),
      netSales: Math.round(netSales),
      cogs: Math.round(cogs),
      grossMargin: Math.round(margin),
      rebates: Math.round(rebates),
      netMargin: Math.round(netMargin),
    },
    kpis: {
      netRevenue: Math.round(netSales),
      grossMarginPct:
        netSales > 0
          ? Math.round((margin / netSales) * 100 * 10) / 10
          : 0,
      netMarginPct:
        netSales > 0
          ? Math.round((netMargin / netSales) * 100 * 10) / 10
          : 0,
      promoSpendPct:
        gross > 0 ? Math.round((promo / gross) * 100 * 10) / 10 : 0,
      discountPct:
        gross > 0
          ? Math.round((discounts / gross) * 100 * 10) / 10
          : 0,
    },
    skus: skus.map((r: Record<string, unknown>) => ({
      product: r["PRODUCT_NAME"],
      category: r["CATEGORY"],
      class: r["CLASS"],
      grossSales: Math.round(Number(r["GROSS_SALES"])),
      discounts: Math.round(Number(r["DISCOUNTS"])),
      netSales: Math.round(Number(r["NET_SALES"])),
      cogs: Math.round(Number(r["COGS"])),
      margin: Math.round(Number(r["MARGIN"])),
      marginPct: Number(r["MARGIN_PCT"] || 0),
      units: Number(r["UNITS"]),
    })),
    trend: trend.map((r: Record<string, unknown>) => ({
      month: String(r["MONTH_LABEL"]),
      revenue: Math.round(Number(r["REVENUE"])),
      margin: Math.round(Number(r["MARGIN"])),
      marginPct: Number(r["MARGIN_PCT"] || 0),
    })),
  });
}

// ---------- /benchmarking ----------
async function handleGetBenchmarking(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") || "";
  const categorySafe = category.replace(/'/g, "''");
  const catFilter = category ? `AND p.CATEGORY = '${categorySafe}'` : "";

  const sql = `
    WITH current_period AS (
        SELECT s.SUPPLIER_NAME,
               SUM(t.NET_REVENUE) AS REVENUE,
               SUM(t.MARGIN_AMOUNT) AS MARGIN,
               SUM(t.QUANTITY) AS UNITS
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE t.DATE_KEY >= 20260101 AND t.DATE_KEY <= 20260507 ${catFilter}
        GROUP BY s.SUPPLIER_NAME
    ),
    prior_period AS (
        SELECT s.SUPPLIER_NAME,
               SUM(t.NET_REVENUE) AS REVENUE
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
        WHERE t.DATE_KEY >= 20250101 AND t.DATE_KEY <= 20250507 ${catFilter}
        GROUP BY s.SUPPLIER_NAME
    ),
    total AS (
        SELECT SUM(REVENUE) AS TOTAL_REV FROM current_period
    )
    SELECT c.SUPPLIER_NAME,
           c.REVENUE,
           c.MARGIN,
           c.UNITS,
           ROUND(c.MARGIN / NULLIF(c.REVENUE, 0) * 100, 1) AS MARGIN_PCT,
           ROUND((c.REVENUE - COALESCE(pp.REVENUE, c.REVENUE)) / NULLIF(COALESCE(pp.REVENUE, c.REVENUE), 0) * 100, 1) AS GROWTH_PCT,
           ROUND(c.REVENUE / NULLIF(t.TOTAL_REV, 0) * 100, 1) AS SHARE_PCT
    FROM current_period c
    LEFT JOIN prior_period pp ON c.SUPPLIER_NAME = pp.SUPPLIER_NAME
    CROSS JOIN total t
    ORDER BY c.REVENUE DESC
  `;

  const rows = await querySnowflake(sql);
  const result = rows.map((r: Record<string, unknown>) => ({
    supplier: r["SUPPLIER_NAME"],
    revenue: Math.round(Number(r["REVENUE"])),
    margin: Math.round(Number(r["MARGIN"])),
    units: Number(r["UNITS"]),
    marginPct: Number(r["MARGIN_PCT"] || 0),
    growthPct: Number(r["GROWTH_PCT"] || 0),
    sharePct: Number(r["SHARE_PCT"] || 0),
  }));
  return NextResponse.json(result);
}

// ---------- /scorecard/:supplier ----------
async function handleGetScorecard(supplierName: string) {
  const supplierSafe = supplierName.replace(/'/g, "''");

  const summarySql = `
    SELECT
        SUM(t.NET_REVENUE) AS REVENUE,
        SUM(t.MARGIN_AMOUNT) AS MARGIN,
        ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100, 1) AS MARGIN_PCT,
        SUM(t.QUANTITY) AS UNITS,
        COUNT(DISTINCT t.TRANSACTION_ID) AS TRANSACTIONS,
        COUNT(DISTINCT p.PRODUCT_KEY) AS PRODUCTS
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE s.SUPPLIER_NAME = '${supplierSafe}'
  `;

  const trendSql = `
    SELECT TO_CHAR(TO_DATE(CAST(t.DATE_KEY AS VARCHAR), 'YYYYMMDD'), 'YYYY-MM') AS MONTH_LABEL,
           SUM(t.NET_REVENUE) AS REVENUE,
           SUM(t.QUANTITY) AS UNITS
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE s.SUPPLIER_NAME = '${supplierSafe}'
    GROUP BY MONTH_LABEL ORDER BY MONTH_LABEL
  `;

  const shareSql = `
    SELECT p.CATEGORY,
           SUM(CASE WHEN s.SUPPLIER_NAME = '${supplierSafe}' THEN t.NET_REVENUE ELSE 0 END) AS VENDOR_REV,
           SUM(t.NET_REVENUE) AS CATEGORY_REV,
           ROUND(SUM(CASE WHEN s.SUPPLIER_NAME = '${supplierSafe}' THEN t.NET_REVENUE ELSE 0 END) / NULLIF(SUM(t.NET_REVENUE), 0) * 100, 1) AS SHARE_PCT
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE p.CATEGORY IN (SELECT DISTINCT CATEGORY FROM BABY_MART_DEMO.CURATED.DIM_PRODUCT WHERE SUPPLIER_KEY = (SELECT SUPPLIER_KEY FROM BABY_MART_DEMO.CURATED.DIM_SUPPLIER WHERE SUPPLIER_NAME = '${supplierSafe}'))
    GROUP BY p.CATEGORY
  `;

  const topProductsSql = `
    SELECT p.PRODUCT_NAME, p.CLASS, SUM(t.NET_REVENUE) AS REVENUE,
           ROUND(SUM(t.MARGIN_AMOUNT)/NULLIF(SUM(t.NET_REVENUE),0)*100,1) AS MARGIN_PCT,
           SUM(t.QUANTITY) AS UNITS
    FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES t
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON t.PRODUCT_KEY = p.PRODUCT_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_SUPPLIER s ON p.SUPPLIER_KEY = s.SUPPLIER_KEY
    WHERE s.SUPPLIER_NAME = '${supplierSafe}'
    GROUP BY p.PRODUCT_NAME, p.CLASS
    ORDER BY REVENUE DESC LIMIT 10
  `;

  const [summary, trend, share, topProducts] = await Promise.all([
    querySnowflake(summarySql),
    querySnowflake(trendSql),
    querySnowflake(shareSql),
    querySnowflake(topProductsSql),
  ]);

  const s: Record<string, unknown> = summary[0] || {};

  return NextResponse.json({
    supplier: supplierName,
    summary: {
      revenue: Math.round(Number(s["REVENUE"] || 0)),
      margin: Math.round(Number(s["MARGIN"] || 0)),
      marginPct: Number(s["MARGIN_PCT"] || 0),
      units: Number(s["UNITS"] || 0),
      transactions: Number(s["TRANSACTIONS"] || 0),
      products: Number(s["PRODUCTS"] || 0),
    },
    trend: trend.map((r: Record<string, unknown>) => ({
      month: String(r["MONTH_LABEL"]),
      revenue: Math.round(Number(r["REVENUE"])),
      units: Number(r["UNITS"]),
    })),
    categoryShare: share.map((r: Record<string, unknown>) => ({
      category: r["CATEGORY"],
      vendorRev: Math.round(Number(r["VENDOR_REV"])),
      categoryRev: Math.round(Number(r["CATEGORY_REV"])),
      sharePct: Number(r["SHARE_PCT"] || 0),
    })),
    topProducts: topProducts.map((r: Record<string, unknown>) => ({
      product: r["PRODUCT_NAME"],
      class: r["CLASS"],
      revenue: Math.round(Number(r["REVENUE"])),
      marginPct: Number(r["MARGIN_PCT"] || 0),
      units: Number(r["UNITS"]),
    })),
  });
}

// ---------- /insights (POST) ----------
async function handlePostInsights(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const prompt = body.prompt || "";

  if (!prompt) {
    return NextResponse.json({ text: "" });
  }

  try {
    const escaped = prompt.replace(/'/g, "''");
    const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '${escaped}') AS RESP`;
    const rows = await querySnowflake(sql);
    return NextResponse.json({
      text: rows[0] ? (rows[0] as Record<string, unknown>)["RESP"] : "",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ text: `Error: ${message}` });
  }
}
