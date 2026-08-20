import { querySnowflake } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

// Battlecards are produced by BABY_MART_DEMO.AI.GENERATE_BATTLECARD, which
// queries the analytics tables for the real figures and uses CORTEX.COMPLETE
// only for the negotiation wording. The same procedure is registered as a tool
// on the Cortex Agents, so the chat and this page cannot disagree.
//
// Previously this route returned hardcoded literals for Huggies and, for every
// other brand, called COMPLETE with a prompt containing no data at all -- so
// margins, DIFOT and dollar values were invented.

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const brand: string = body.brand || "Huggies";
    const category: string = body.category || "";

    const sql = `CALL BABY_MART_DEMO.AI.GENERATE_BATTLECARD(${sqlLiteral(brand)}, ${
      category ? sqlLiteral(category) : "NULL"
    })`;

    const rows = await querySnowflake(sql);
    const raw = rows.length > 0 ? rows[0].GENERATE_BATTLECARD : null;

    if (!raw) {
      return NextResponse.json(
        { error: `No battlecard returned for ${brand}.` },
        { status: 502 },
      );
    }

    const result = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    const card = result.card;
    if (!card) {
      // The model returned something that wasn't valid JSON; card_raw has it.
      console.warn(
        `Battlecard narrative failed to parse for ${brand}: ${String(
          result.card_raw,
        ).slice(0, 300)}`,
      );
      return NextResponse.json(
        { error: "The battlecard narrative could not be generated. Please retry." },
        { status: 502 },
      );
    }

    // Flatten into the shape the battlecard page expects, keeping the source
    // metrics so the UI (or a reviewer) can trace any figure back to the data.
    return NextResponse.json({
      brand: result.brand,
      category: result.category,
      key_arguments: card.key_arguments ?? null,
      incentives: card.incentives ?? null,
      pressures: card.pressures ?? null,
      negotiation_approach: card.negotiation_approach ?? null,
      total_addressable: card.total_addressable ?? null,
      sellthrough: card.sellthrough ?? "",
      switching: card.switching ?? "",
      summary: card.summary ?? "",
      metrics: result.metrics ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
