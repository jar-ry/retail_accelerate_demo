import { querySnowflake } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get("brand") || "Huggies";

    const sql = `
      SELECT mechanic, SUM(promo_units) as units, SUM(promo_revenue) as revenue,
             SUM(total_discount) as discount, SUM(promo_margin) as margin
      FROM DT_PROMOTIONAL_EFFECTIVENESS
      WHERE brand_name = '${brand}'
      GROUP BY mechanic
      ORDER BY revenue DESC
    `;

    const rows = await querySnowflake(sql);
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
