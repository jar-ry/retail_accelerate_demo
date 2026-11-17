import { NextRequest, NextResponse } from "next/server";
import { querySnowflake, querySnowflakeWithBinds } from "@/lib/snowflake";
import { sessionUser } from "@/lib/hop/session";

// Stockout recovery plans (sql/46_supply_recovery.sql).
//
// GET  /api/supply/recovery            recent plans, each with its options
// GET  /api/supply/recovery?plan=ID    one plan
// POST /api/supply/recovery            {action: "approve", planId, optionId, note}
//                                      {action: "reset"}  (undo every approval; rehearsals)
//
// The agent writes DRAFT plans; only this route approves one, as the signed-in
// user. APPROVE_RECOVERY does the work (PO, transfer, campaign supply position)
// in one transaction, so the page cannot half-apply a plan.

const A = "BABY_MART_DEMO.ANALYTICS";
const PLAN_ID = /^RCV-[0-9]{11}$/;
const OPTION_ID = /^[A-C]$/;
type Row = Record<string, unknown>;

const parse = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};

async function plans(planId: string | null) {
  const where = planId ? "WHERE p.PLAN_ID = ?" : "WHERE p.STATUS <> 'RESET'";
  const binds = planId ? [planId] : [];
  const sql = `SELECT p.*, o.OPTION_ID, o.KIND, o.LABEL, o.TRANSFER_FROM_DC, o.TRANSFER_UNITS, o.PO_UNITS, o.PO_EXPECTED_FILL_UNITS,
      o.FIRST_STOCK_DATE, o.PO_DUE_DATE, o.STOCKOUT_DAYS, o.TRANSFER_COST_AUD, o.STOCK_VALUE_AUD, o.LOST_SALES_AUD,
      o.COVER_AFTER_WEEKS, o.SOURCE_COVER_AFTER_WEEKS, o.LIFTS_SHORTAGE, o.FEASIBLE, o.GUARDRAILS
    FROM (SELECT * FROM ${A}.SUPPLY_RECOVERY_PLAN p ${where} ORDER BY CREATED_AT DESC LIMIT 12) p
    LEFT JOIN ${A}.SUPPLY_RECOVERY_OPTION o ON o.PLAN_ID = p.PLAN_ID
    ORDER BY p.CREATED_AT DESC, o.OPTION_ID`;
  const rows = (binds.length ? await querySnowflakeWithBinds(sql, binds) : await querySnowflake(sql)) as Row[];
  const byId = new Map<string, Row & { options: Row[] }>();
  for (const r of rows) {
    const id = String(r.PLAN_ID);
    if (!byId.has(id)) {
      byId.set(id, {
        planId: id, brand: r.BRAND_NAME, class: r.CLASS, dcState: r.DC_STATE, targetWeeks: Number(r.TARGET_WEEKS), status: r.STATUS,
        request: r.REQUEST, createdBy: r.CREATED_BY, createdAt: r.CREATED_AT, recommended: r.RECOMMENDED_OPTION,
        approvedOption: r.APPROVED_OPTION, approvedBy: r.APPROVED_BY, approvedAt: r.APPROVED_AT, effect: parse(r.EFFECT), options: [],
      });
    }
    if (r.OPTION_ID) byId.get(id)!.options.push({
      optionId: r.OPTION_ID, kind: r.KIND, label: r.LABEL, transferFromDc: r.TRANSFER_FROM_DC, transferUnits: Number(r.TRANSFER_UNITS ?? 0),
      poUnits: Number(r.PO_UNITS ?? 0), poExpectedFillUnits: Number(r.PO_EXPECTED_FILL_UNITS ?? 0), firstStockDate: r.FIRST_STOCK_DATE,
      poDueDate: r.PO_DUE_DATE, stockoutDays: Number(r.STOCKOUT_DAYS ?? 0), transferCostAud: Number(r.TRANSFER_COST_AUD ?? 0),
      stockValueAud: Number(r.STOCK_VALUE_AUD ?? 0), lostSalesAud: Number(r.LOST_SALES_AUD ?? 0), coverAfterWeeks: Number(r.COVER_AFTER_WEEKS ?? 0),
      sourceCoverAfterWeeks: r.SOURCE_COVER_AFTER_WEEKS === null ? null : Number(r.SOURCE_COVER_AFTER_WEEKS),
      liftsShortage: r.LIFTS_SHORTAGE === true, feasible: r.FEASIBLE === true, guardrails: parse(r.GUARDRAILS) ?? [],
    });
  }
  return [...byId.values()];
}

export async function GET(request: NextRequest) {
  try {
    const plan = request.nextUrl.searchParams.get("plan");
    if (plan && !PLAN_ID.test(plan)) return NextResponse.json({ error: "Bad plan id" }, { status: 400 });
    const list = await plans(plan);
    if (plan) return list[0] ? NextResponse.json(list[0]) : NextResponse.json({ error: `No plan ${plan}` }, { status: 404 });
    return NextResponse.json(list);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Row;
  try {
    if (body.action === "approve") {
      const planId = String(body.planId ?? ""), optionId = String(body.optionId ?? "");
      if (!PLAN_ID.test(planId) || !OPTION_ID.test(optionId)) return NextResponse.json({ ok: false, error: "Bad plan or option id" }, { status: 400 });
      const note = String(body.note ?? "").slice(0, 1000);
      const r = (await querySnowflakeWithBinds(`CALL ${A}.APPROVE_RECOVERY(?, ?, ?, ?)`, [planId, optionId, sessionUser(request), note])) as Row[];
      const out = parse(Object.values(r[0] ?? {})[0]) as Row;
      return NextResponse.json(out, { status: out?.ok ? 200 : 409 });
    }
    if (body.action === "reset") {
      const r = (await querySnowflake(`CALL ${A}.RESET_RECOVERY_DEMO()`)) as Row[];
      return NextResponse.json(parse(Object.values(r[0] ?? {})[0]));
    }
    return NextResponse.json({ ok: false, error: "action must be approve or reset" }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
