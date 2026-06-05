import { querySnowflake } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get("brand") || "Huggies";

    const sql = `
      SELECT competitor_name, AVG(avg_competitor_price) as their_price,
             AVG(avg_our_price) as our_price, AVG(avg_price_gap_pct) as gap_pct
      FROM DT_COMPETITIVE_POSITION
      WHERE brand_name = '${brand}' AND fiscal_year = 2026
      GROUP BY competitor_name
      ORDER BY gap_pct DESC
    `;

    const rows = await querySnowflake(sql);
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
