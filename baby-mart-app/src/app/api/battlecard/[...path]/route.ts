import { querySnowflakeWithBinds } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";
import { verifyCitations } from "@/lib/ai/grounded";
import { cardText } from "@/lib/meeting";

// POST /api/battlecard/generate {brand}
//
// The battlecard is the Facts step of the Supplier Meeting page
// (/meeting/<brand>). BABY_MART_DEMO.AI.GENERATE_BATTLECARD (sql/09) reads the
// negotiation evidence (sql/48) -- the same figures the brief is sized from --
// and uses CORTEX.COMPLETE only to word the arguments. Every number in that
// wording is checked here against the evidence (src/lib/ai/grounded.ts), and the
// page shows any that do not match rather than passing them silently.

type Row = Record<string, unknown>;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const brand = String(body.brand ?? "").trim().slice(0, 100);
    if (!brand) return NextResponse.json({ error: "No brand given." }, { status: 400 });

    const rows = (await querySnowflakeWithBinds("CALL BABY_MART_DEMO.AI.GENERATE_BATTLECARD(?)", [brand])) as Row[];
    const raw = rows.length ? Object.values(rows[0])[0] : null;
    if (!raw) return NextResponse.json({ error: `No battlecard returned for ${brand}.` }, { status: 502 });
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });

    const card = result.card;
    if (!card) {
      console.warn(`Battlecard wording failed to parse for ${brand}: ${String(result.card_raw).slice(0, 300)}`);
      return NextResponse.json({ brand: result.brand, category: result.category, evidence: result.metrics,
        error: "The battlecard's arguments could not be written. Please retry." }, { status: 502 });
    }
    const out = {
      key_arguments: card.key_arguments ?? null,
      negotiation_approach: card.negotiation_approach ?? null,
      incentives: card.incentives ?? null,
      pressures: card.pressures ?? null,
    };
    return NextResponse.json({
      brand: result.brand, category: result.category, period: result.period, evidence: result.metrics, sop: result.sop ?? null,
      ...out, check: verifyCitations(result.metrics, [], cardText(out)),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
