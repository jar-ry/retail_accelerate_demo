import { querySnowflake } from "@/lib/snowflake";
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

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function getSkuData(brandName: string) {
  try {
    const escaped = brandName.replace(/'/g, "''");

    // Class-level summary
    const classSql = `
      SELECT dp.CLASS,
             SUM(f.NET_REVENUE) AS revenue,
             SUM(f.QUANTITY) AS units,
             COUNT(DISTINCT f.TRANSACTION_ID) AS transactions,
             AVG(f.MARGIN_AMOUNT / NULLIF(f.NET_REVENUE, 0)) * 100 AS margin_pct
      FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
      JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
      JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
      WHERE db.BRAND_NAME = '${escaped}'
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
               AVG(f.MARGIN_AMOUNT / NULLIF(f.NET_REVENUE, 0)) * 100 AS actual_margin_pct,
               SUM(f.NET_REVENUE) / NULLIF(SUM(f.QUANTITY), 0) AS avg_selling_price
        FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES f
        JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT dp ON f.PRODUCT_KEY = dp.PRODUCT_KEY
        JOIN BABY_MART_DEMO.CURATED.DIM_BRAND db ON dp.BRAND_KEY = db.BRAND_KEY
        WHERE db.BRAND_NAME = '${escaped}'
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
        WHERE db.BRAND_NAME = '${escaped}'
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
      querySnowflake(classSql),
      querySnowflake(skuSql),
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
