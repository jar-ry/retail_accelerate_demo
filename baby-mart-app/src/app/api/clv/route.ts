import { querySnowflake } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "Nappies & Wipes";

    const sql = `
      SELECT brand_name, AVG(avg_clv) as avg_clv, SUM(customer_count) as customers,
             AVG(avg_transactions) as avg_txns
      FROM DT_CLV_BY_BRAND
      WHERE category = '${category}'
      GROUP BY brand_name
      ORDER BY avg_clv DESC
    `;

    const rows = await querySnowflake(sql);
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
