import { NextRequest, NextResponse } from "next/server";
import { querySnowflake, querySnowflakeWithBinds } from "@/lib/snowflake";
import { sessionUser } from "@/lib/hop/session";

// Negotiation briefs (sql/48_negotiation_brief.sql).
//
// GET  /api/negotiation              recent briefs
// GET  /api/negotiation?brief=ID     one brief, with its asks
// POST /api/negotiation              {action: "approve", briefId, note}
//
// The agent writes DRAFT briefs; only this route approves one, as the
// signed-in category manager.

const A = "BABY_MART_DEMO.ANALYTICS";
const BRIEF_ID = /^NEG-[0-9]{14}$/;
type Row = Record<string, unknown>;

const parse = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function briefs(briefId: string | null) {
  const where = briefId ? "WHERE b.BRIEF_ID = ?" : "WHERE b.STATUS <> 'RESET'";
  const sql = `SELECT b.BRIEF_ID, b.BRAND_NAME, b.SUPPLIER_NAME, b.CATEGORY, b.STANCE, b.STATUS, b.OPENING_AUD, b.TARGET_AUD, b.WALKAWAY_AUD,
      b.CREATED_AT, b.APPROVED_BY, b.APPROVED_AT, b.NOTE,
      a.ASK_ID, a.KIND, a.DIRECTION, a.LABEL, a.OPENING_AUD AS A_OPEN, a.TARGET_AUD AS A_TARGET, a.WALKAWAY_AUD AS A_WALK
    FROM (SELECT * FROM ${A}.NEGOTIATION_BRIEF b ${where} ORDER BY CREATED_AT DESC LIMIT 12) b
    LEFT JOIN ${A}.NEGOTIATION_ASK a ON a.BRIEF_ID = b.BRIEF_ID
    ORDER BY b.CREATED_AT DESC, a.SEQ`;
  const rows = (briefId ? await querySnowflakeWithBinds(sql, [briefId]) : await querySnowflake(sql)) as Row[];
  const byId = new Map<string, Row & { asks: Row[] }>();
  for (const r of rows) {
    const id = String(r.BRIEF_ID);
    if (!byId.has(id)) {
      byId.set(id, {
        briefId: id, brand: r.BRAND_NAME, supplier: r.SUPPLIER_NAME, category: r.CATEGORY, stance: r.STANCE, status: r.STATUS,
        openingAud: num(r.OPENING_AUD), targetAud: num(r.TARGET_AUD), walkawayAud: num(r.WALKAWAY_AUD),
        createdAt: r.CREATED_AT, approvedBy: r.APPROVED_BY, approvedAt: r.APPROVED_AT, note: r.NOTE, asks: [],
      });
    }
    if (r.ASK_ID) byId.get(id)!.asks.push({
      askId: r.ASK_ID, kind: r.KIND, direction: r.DIRECTION, label: r.LABEL,
      openingAud: num(r.A_OPEN), targetAud: num(r.A_TARGET), walkawayAud: num(r.A_WALK),
    });
  }
  return [...byId.values()];
}

export async function GET(request: NextRequest) {
  try {
    const brief = request.nextUrl.searchParams.get("brief");
    if (brief && !BRIEF_ID.test(brief)) return NextResponse.json({ error: "Bad brief id" }, { status: 400 });
    const list = await briefs(brief);
    if (brief) return list[0] ? NextResponse.json(list[0]) : NextResponse.json({ error: `No brief ${brief}` }, { status: 404 });
    return NextResponse.json(list);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Row;
  try {
    if (body.action !== "approve") return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    const briefId = String(body.briefId ?? "");
    if (!BRIEF_ID.test(briefId)) return NextResponse.json({ ok: false, error: "Bad brief id" }, { status: 400 });
    const note = String(body.note ?? "").slice(0, 1000);
    const r = (await querySnowflakeWithBinds(`CALL ${A}.APPROVE_NEGOTIATION_BRIEF(?, ?, ?)`, [briefId, sessionUser(request), note])) as Row[];
    const out = parse(Object.values(r[0] ?? {})[0]) as Row;
    return NextResponse.json(out, { status: out?.ok ? 200 : 409 });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
