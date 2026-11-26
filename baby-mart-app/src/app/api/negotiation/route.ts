import { NextRequest, NextResponse } from "next/server";
import { querySnowflake, querySnowflakeWithBinds } from "@/lib/snowflake";
import { sessionUser } from "@/lib/hop/session";

// Negotiation briefs (sql/48_negotiation_brief.sql), for the Supplier Meeting page.
//
// GET  /api/negotiation                 recent briefs, every brand
// GET  /api/negotiation?brand=NAME      one brand's briefs: the meeting history
// GET  /api/negotiation?brief=ID        one brief, with its asks
// GET  /api/negotiation?evidence=NAME   the negotiation evidence for a brand: the
//                                       facts the battlecard and the brief share
// GET  /api/negotiation?rules=1         the negotiation rules (Settings > Negotiation
//                                       rules) and their recent changes
// POST /api/negotiation                 {action: "approve", briefId, note}
//                                       {action: "saveRule", key, value, note}
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
const brandParam = (v: string | null) => (v === null ? null : v.trim().slice(0, 100));

async function briefs(by: { briefId?: string; brand?: string }) {
  const where = by.briefId ? "WHERE b.BRIEF_ID = ?"
    : by.brand ? "WHERE UPPER(b.BRAND_NAME) = UPPER(?) AND b.STATUS <> 'RESET'"
    : "WHERE b.STATUS <> 'RESET'";
  const sql = `SELECT b.BRIEF_ID, b.BRAND_NAME, b.SUPPLIER_NAME, b.CATEGORY, b.STANCE, b.STATUS, b.OPENING_AUD, b.TARGET_AUD, b.WALKAWAY_AUD,
      b.CREATED_AT, b.APPROVED_BY, b.APPROVED_AT, b.NOTE, b.EVIDENCE:levers AS LEVERS, b.EVIDENCE:guardrails AS GUARDRAILS,
      b.EVIDENCE:sop AS SOP, b.EVIDENCE:rules AS RULES,
      a.ASK_ID, a.KIND, a.DIRECTION, a.LABEL, a.BASIS, a.OPENING_AUD AS A_OPEN, a.TARGET_AUD AS A_TARGET, a.WALKAWAY_AUD AS A_WALK
    FROM (SELECT * FROM ${A}.NEGOTIATION_BRIEF b ${where} ORDER BY CREATED_AT DESC LIMIT 12) b
    LEFT JOIN ${A}.NEGOTIATION_ASK a ON a.BRIEF_ID = b.BRIEF_ID
    ORDER BY b.CREATED_AT DESC, a.SEQ`;
  const bind = by.briefId ?? by.brand;
  const rows = (bind ? await querySnowflakeWithBinds(sql, [bind]) : await querySnowflake(sql)) as Row[];
  const byId = new Map<string, Row & { asks: Row[] }>();
  for (const r of rows) {
    const id = String(r.BRIEF_ID);
    if (!byId.has(id)) {
      byId.set(id, {
        briefId: id, brand: r.BRAND_NAME, supplier: r.SUPPLIER_NAME, category: r.CATEGORY, stance: r.STANCE, status: r.STATUS,
        openingAud: num(r.OPENING_AUD), targetAud: num(r.TARGET_AUD), walkawayAud: num(r.WALKAWAY_AUD),
        createdAt: r.CREATED_AT, approvedBy: r.APPROVED_BY, approvedAt: r.APPROVED_AT, note: r.NOTE,
        levers: parse(r.LEVERS) ?? [], guardrails: parse(r.GUARDRAILS) ?? [], sop: parse(r.SOP), rules: parse(r.RULES), asks: [],
      });
    }
    if (r.ASK_ID) byId.get(id)!.asks.push({
      askId: r.ASK_ID, kind: r.KIND, direction: r.DIRECTION, label: r.LABEL, basis: r.BASIS,
      openingAud: num(r.A_OPEN), targetAud: num(r.A_TARGET), walkawayAud: num(r.A_WALK),
    });
  }
  return [...byId.values()];
}

async function rules() {
  const settings = (await querySnowflake(`SELECT SETTING_KEY, SETTING_VALUE, LABEL, DESCRIPTION, UPDATED_BY, UPDATED_AT
    FROM ${A}.NEGOTIATION_SETTING ORDER BY SETTING_KEY`)) as Row[];
  const history = (await querySnowflake(`SELECT SETTING_KEY, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT, NOTE
    FROM ${A}.NEGOTIATION_SETTING_HISTORY ORDER BY CHANGED_AT DESC LIMIT 20`)) as Row[];
  return {
    settings: settings.map((r) => ({ key: String(r.SETTING_KEY), value: num(r.SETTING_VALUE), label: r.LABEL, description: r.DESCRIPTION,
      updatedBy: r.UPDATED_BY ?? null, updatedAt: r.UPDATED_AT ?? null })),
    history: history.map((r) => ({ key: String(r.SETTING_KEY), oldValue: num(r.OLD_VALUE), newValue: num(r.NEW_VALUE),
      changedBy: r.CHANGED_BY, changedAt: r.CHANGED_AT, note: r.NOTE })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    if (q.get("rules") !== null) return NextResponse.json(await rules());
    const evidence = brandParam(q.get("evidence"));
    if (evidence !== null) {
      if (!evidence) return NextResponse.json({ ok: false, error: "No brand given" }, { status: 400 });
      const r = (await querySnowflakeWithBinds("CALL BABY_MART_DEMO.AI.NEGOTIATION_EVIDENCE(?)", [evidence])) as Row[];
      const out = parse(Object.values(r[0] ?? {})[0]) as Row;
      return NextResponse.json(out, { status: out?.ok ? 200 : 404 });
    }
    const brand = brandParam(q.get("brand"));
    if (brand !== null) return NextResponse.json(brand ? await briefs({ brand }) : []);
    const brief = q.get("brief");
    if (brief && !BRIEF_ID.test(brief)) return NextResponse.json({ error: "Bad brief id" }, { status: 400 });
    const list = await briefs(brief ? { briefId: brief } : {});
    if (brief) return list[0] ? NextResponse.json(list[0]) : NextResponse.json({ error: `No brief ${brief}` }, { status: 404 });
    return NextResponse.json(list);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Row;
  try {
    if (body.action === "saveRule") {
      const key = String(body.key ?? "");
      const value = Number(body.value);
      if (!/^[A-Z_]{3,40}$/.test(key) || !Number.isFinite(value)) return NextResponse.json({ ok: false, error: "Bad rule" }, { status: 400 });
      const r = (await querySnowflakeWithBinds(`CALL ${A}.SAVE_NEGOTIATION_SETTING(?, ?, ?, ?)`,
        [key, value, sessionUser(request), String(body.note ?? "").slice(0, 1000)])) as Row[];
      const out = parse(Object.values(r[0] ?? {})[0]) as Row;
      return NextResponse.json(out, { status: out?.ok ? 200 : 409 });
    }
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
