import { querySnowflake } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const segment = request.nextUrl.searchParams.get("segment");
    const category = request.nextUrl.searchParams.get("category");
    const type = request.nextUrl.searchParams.get("type");

    const conditions: string[] = [];
    if (segment && segment !== "All") conditions.push(`SEGMENT_NAME = '${segment.replace(/'/g, "''")}'`);
    if (category && category !== "All") conditions.push(`CATEGORY = '${category.replace(/'/g, "''")}'`);
    if (type && type !== "All") conditions.push(`RECOMMENDATION_TYPE = '${type.replace(/'/g, "''")}'`);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const detailSql = `
      SELECT SEGMENT_NAME, PRODUCT_NAME, BRAND_NAME, CATEGORY, CLASS,
             RECOMMENDATION_SCORE, RECOMMENDATION_REASON, MODEL_VERSION,
             SCORED_AT, IMPRESSIONS, CLICKS, CONVERSIONS, REVENUE_ATTRIBUTED,
             CTR, CONVERSION_RATE, REVENUE_PER_IMPRESSION,
             RECOMMENDATION_TYPE, SOURCE_CATEGORY
      FROM BABY_MART_DEMO.ANALYTICS.ML_PRODUCT_RECOMMENDATIONS
      ${whereClause}
      ORDER BY REVENUE_ATTRIBUTED DESC
    `;

    const segSummarySql = `
      SELECT SEGMENT_NAME,
             COUNT(*) AS rec_count,
             SUM(IMPRESSIONS) AS total_impressions,
             SUM(CLICKS) AS total_clicks,
             SUM(CONVERSIONS) AS total_conversions,
             SUM(REVENUE_ATTRIBUTED) AS total_revenue,
             AVG(CTR) * 100 AS avg_ctr,
             AVG(CONVERSION_RATE) * 100 AS avg_conv_rate
      FROM BABY_MART_DEMO.ANALYTICS.ML_PRODUCT_RECOMMENDATIONS
      GROUP BY SEGMENT_NAME
      ORDER BY total_revenue DESC
    `;

    const typeSummarySql = `
      SELECT RECOMMENDATION_TYPE,
             COUNT(*) AS rec_count,
             SUM(REVENUE_ATTRIBUTED) AS total_revenue,
             SUM(CONVERSIONS) AS total_conversions,
             AVG(CTR) * 100 AS avg_ctr,
             AVG(CONVERSION_RATE) * 100 AS avg_conv_rate
      FROM BABY_MART_DEMO.ANALYTICS.ML_PRODUCT_RECOMMENDATIONS
      GROUP BY RECOMMENDATION_TYPE
      ORDER BY total_revenue DESC
    `;

    const catTypeSql = `
      SELECT CATEGORY, RECOMMENDATION_TYPE,
             SUM(REVENUE_ATTRIBUTED) AS revenue,
             SUM(CONVERSIONS) AS conversions,
             AVG(CONVERSION_RATE) * 100 AS avg_conv_rate
      FROM BABY_MART_DEMO.ANALYTICS.ML_PRODUCT_RECOMMENDATIONS
      GROUP BY CATEGORY, RECOMMENDATION_TYPE
      ORDER BY CATEGORY, RECOMMENDATION_TYPE
    `;

    const [rows, segRows, typeRows, catTypeRows] = await Promise.all([
      querySnowflake(detailSql),
      querySnowflake(segSummarySql),
      querySnowflake(typeSummarySql),
      querySnowflake(catTypeSql),
    ]);

    const recommendations = rows.map((r: any) => ({
      segment: r.SEGMENT_NAME,
      product: r.PRODUCT_NAME,
      brand: r.BRAND_NAME,
      category: r.CATEGORY,
      class: r.CLASS,
      score: Number(r.RECOMMENDATION_SCORE),
      reason: r.RECOMMENDATION_REASON,
      modelVersion: r.MODEL_VERSION,
      scoredAt: r.SCORED_AT,
      impressions: Number(r.IMPRESSIONS),
      clicks: Number(r.CLICKS),
      conversions: Number(r.CONVERSIONS),
      revenue: Number(r.REVENUE_ATTRIBUTED),
      ctr: Number(r.CTR),
      convRate: Number(r.CONVERSION_RATE),
      rpi: Number(r.REVENUE_PER_IMPRESSION),
      type: r.RECOMMENDATION_TYPE,
      sourceCategory: r.SOURCE_CATEGORY,
    }));

    const segments = segRows.map((r: any) => ({
      name: r.SEGMENT_NAME,
      count: Number(r.REC_COUNT),
      impressions: Number(r.TOTAL_IMPRESSIONS),
      clicks: Number(r.TOTAL_CLICKS),
      conversions: Number(r.TOTAL_CONVERSIONS),
      revenue: Number(r.TOTAL_REVENUE),
      avgCtr: Number(r.AVG_CTR),
      avgConvRate: Number(r.AVG_CONV_RATE),
    }));

    const typeBreakdown = typeRows.map((r: any) => ({
      type: r.RECOMMENDATION_TYPE,
      count: Number(r.REC_COUNT),
      revenue: Number(r.TOTAL_REVENUE),
      conversions: Number(r.TOTAL_CONVERSIONS),
      avgCtr: Number(r.AVG_CTR),
      avgConvRate: Number(r.AVG_CONV_RATE),
    }));

    // Group category × type data for the bar chart
    const categories = [...new Set(catTypeRows.map((r: any) => r.CATEGORY))];
    const categoryByType = categories.map((cat) => {
      const catRows = catTypeRows.filter((r: any) => r.CATEGORY === cat);
      const entry: any = { category: cat };
      for (const r of catRows) {
        entry[r.RECOMMENDATION_TYPE] = Number(r.REVENUE);
        entry[`${r.RECOMMENDATION_TYPE}_conv`] = Number(r.AVG_CONV_RATE);
      }
      entry.total = catRows.reduce((s: number, r: any) => s + Number(r.REVENUE), 0);
      return entry;
    }).sort((a, b) => b.total - a.total);

    const totalRevenue = typeBreakdown.reduce((s, t) => s + t.revenue, 0);
    const totalConversions = typeBreakdown.reduce((s, t) => s + t.conversions, 0);
    const totalImpressions = segments.reduce((s, seg) => s + seg.impressions, 0);
    const totalClicks = segments.reduce((s, seg) => s + seg.clicks, 0);

    const totals = {
      active: recommendations.length,
      impressions: totalImpressions,
      clicks: totalClicks,
      conversions: totalConversions,
      revenue: totalRevenue,
      avgCtr: segments.reduce((s, seg) => s + seg.avgCtr, 0) / (segments.length || 1),
      avgConvRate: segments.reduce((s, seg) => s + seg.avgConvRate, 0) / (segments.length || 1),
      modelVersion: recommendations[0]?.modelVersion || "v2.3",
      scoredAt: recommendations[0]?.scoredAt || null,
      crossSellPct: totalRevenue > 0 ? Math.round((typeBreakdown.find(t => t.type === "cross_sell")?.revenue || 0) / totalRevenue * 100) : 0,
    };

    return NextResponse.json({ totals, segments, typeBreakdown, categoryByType, recommendations });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
