import { querySnowflake } from "@/lib/snowflake";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Overall KPIs: last 28 days vs same period last year
    const kpiSql = `
      WITH current_period AS (
        SELECT 
          SUM(f.NET_REVENUE) AS revenue,
          COUNT(DISTINCT f.TRANSACTION_ID) AS transactions,
          SUM(f.QUANTITY) AS units,
          AVG(f.MARGIN_AMOUNT / NULLIF(f.NET_REVENUE, 0)) * 100 AS avg_margin,
          SUM(f.NET_REVENUE) / COUNT(DISTINCT f.TRANSACTION_ID) AS avg_basket
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        WHERE f.DATE_KEY >= 20260410 AND f.DATE_KEY <= 20260507
      ),
      prior_period AS (
        SELECT 
          SUM(f.NET_REVENUE) AS revenue,
          COUNT(DISTINCT f.TRANSACTION_ID) AS transactions,
          SUM(f.QUANTITY) AS units
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        WHERE f.DATE_KEY >= 20250410 AND f.DATE_KEY <= 20250507
      )
      SELECT 
        c.revenue AS current_revenue,
        c.transactions AS current_transactions,
        c.units AS current_units,
        c.avg_margin,
        c.avg_basket,
        p.revenue AS prior_revenue,
        p.transactions AS prior_transactions,
        p.units AS prior_units
      FROM current_period c, prior_period p
    `;

    // Category breakdown with YoY growth
    const categorySql = `
      WITH current_cat AS (
        SELECT 
          dp.CATEGORY,
          SUM(f.NET_REVENUE) AS revenue,
          COUNT(DISTINCT db.BRAND_NAME) AS brand_count,
          AVG(f.MARGIN_AMOUNT / NULLIF(f.NET_REVENUE, 0)) * 100 AS margin_pct
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE f.DATE_KEY >= 20260410 AND f.DATE_KEY <= 20260507
        GROUP BY dp.CATEGORY
      ),
      prior_cat AS (
        SELECT 
          dp.CATEGORY,
          SUM(f.NET_REVENUE) AS revenue
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        WHERE f.DATE_KEY >= 20250410 AND f.DATE_KEY <= 20250507
        GROUP BY dp.CATEGORY
      )
      SELECT 
        c.CATEGORY,
        c.revenue,
        c.brand_count,
        c.margin_pct,
        ROUND((c.revenue - p.revenue) / NULLIF(p.revenue, 0) * 100, 1) AS growth_pct
      FROM current_cat c
      LEFT JOIN prior_cat p ON c.CATEGORY = p.CATEGORY
      ORDER BY c.revenue DESC
    `;

    // Top brands by growth (with margin for matrix chart)
    const brandsSql = `
      WITH current_brands AS (
        SELECT 
          db.BRAND_NAME,
          dp.CATEGORY,
          SUM(f.NET_REVENUE) AS revenue,
          AVG(f.MARGIN_AMOUNT / NULLIF(f.NET_REVENUE, 0)) * 100 AS margin_pct
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE f.DATE_KEY >= 20260410 AND f.DATE_KEY <= 20260507
        GROUP BY db.BRAND_NAME, dp.CATEGORY
      ),
      prior_brands AS (
        SELECT 
          db.BRAND_NAME,
          SUM(f.NET_REVENUE) AS revenue
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE f.DATE_KEY >= 20250410 AND f.DATE_KEY <= 20250507
        GROUP BY db.BRAND_NAME
      )
      SELECT 
        c.BRAND_NAME,
        c.CATEGORY,
        c.revenue,
        c.margin_pct,
        ROUND((c.revenue - p.revenue) / NULLIF(p.revenue, 0) * 100, 1) AS growth_pct
      FROM current_brands c
      LEFT JOIN prior_brands p ON c.BRAND_NAME = p.BRAND_NAME
      ORDER BY c.revenue DESC
    `;

    const [kpiRows, catRows, brandRows] = await Promise.all([
      querySnowflake(kpiSql),
      querySnowflake(categorySql),
      querySnowflake(brandsSql),
    ]);

    const kpi = kpiRows[0];
    const revenueGrowth = kpi.PRIOR_REVENUE ? 
      ((kpi.CURRENT_REVENUE - kpi.PRIOR_REVENUE) / kpi.PRIOR_REVENUE * 100).toFixed(1) : "0";
    const txnGrowth = kpi.PRIOR_TRANSACTIONS ?
      ((kpi.CURRENT_TRANSACTIONS - kpi.PRIOR_TRANSACTIONS) / kpi.PRIOR_TRANSACTIONS * 100).toFixed(1) : "0";

    const totalCatRevenue = catRows.reduce((s: number, r: any) => s + Number(r.REVENUE), 0);

    const categories = catRows.map((r: any) => ({
      category: r.CATEGORY,
      revenue: Number(r.REVENUE),
      pct: Math.round(Number(r.REVENUE) / totalCatRevenue * 100),
      growth: Number(r.GROWTH_PCT) || 0,
      brandCount: Number(r.BRAND_COUNT),
      margin: Number(r.MARGIN_PCT)?.toFixed(1),
    }));

    const allBrands = brandRows.map((r: any) => ({
      name: r.BRAND_NAME,
      category: r.CATEGORY,
      revenue: Number(r.REVENUE),
      margin: Number(r.MARGIN_PCT) || 0,
      growth: Number(r.GROWTH_PCT) || 0,
    }));

    const sortedByGrowth = [...allBrands].sort((a, b) => b.growth - a.growth);
    const topBrands = sortedByGrowth.slice(0, 5);
    const bottomBrands = sortedByGrowth.slice(-5).reverse();

    return NextResponse.json({
      totalRevenue: Number(kpi.CURRENT_REVENUE),
      totalTransactions: Number(kpi.CURRENT_TRANSACTIONS),
      totalUnits: Number(kpi.CURRENT_UNITS),
      avgMargin: Number(kpi.AVG_MARGIN),
      avgBasket: Number(kpi.AVG_BASKET),
      revenueGrowth: Number(revenueGrowth),
      transactionGrowth: Number(txnGrowth),
      categories,
      allBrands,
      topBrands,
      bottomBrands,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
