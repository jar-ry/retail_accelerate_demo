import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/hop/db";
import { S } from "@/lib/hop/schema";
import { sessionUser } from "@/lib/hop/session";

// Store plan sandbox proposals (sql/49_hop_sandbox_builder.sql).
//
// GET  /api/hop-sandbox                 recent proposals
// GET  /api/hop-sandbox?proposal=ID     one proposal, with its options
// POST /api/hop-sandbox                 {action: "open", proposalId, optionId}
//
// The agent writes DRAFT proposals; only this route opens an option as a
// sandbox, as the signed-in planner. The sandbox is a copy of the live drivers:
// nothing reaches the live plan until it is submitted and reviewed as any other.

const PROPOSAL_ID = /^SBX-[0-9]{14}$/;
const OPTION_ID = /^[A-C]$/;
type Row = Record<string, unknown>;

const parse = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  try { return JSON.parse(v); } catch { return v; }
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function proposals(id: string | null) {
  const where = id ? "WHERE p.PROPOSAL_ID = ?" : "";
  const rows = await q(
    `SELECT p.PROPOSAL_ID, p.SCOPE_LABEL, p.LEVER, p.LEVER_VALUE, p.STATUS, p.RECOMMENDED_OPTION, p.CREATED_AT, p.OPENED_OPTION, p.OPENED_BY, p.SCENARIO_ID,
        o.OPTION_ID, o.LABEL, o.SALES_DELTA_AUD, o.MARGIN_DELTA_AUD, o.STORES_TOUCHED
      FROM (SELECT * FROM ${S}.SANDBOX_PROPOSAL p ${where} ORDER BY CREATED_AT DESC LIMIT 12) p
      LEFT JOIN ${S}.SANDBOX_PROPOSAL_OPTION o ON o.PROPOSAL_ID = p.PROPOSAL_ID
      ORDER BY p.CREATED_AT DESC, o.OPTION_ID`,
    id ? [id] : [],
  );
  const byId = new Map<string, Row & { options: Row[] }>();
  for (const r of rows) {
    const k = String(r.PROPOSAL_ID);
    if (!byId.has(k)) byId.set(k, {
      proposalId: k, scope: r.SCOPE_LABEL, lever: r.LEVER, value: num(r.LEVER_VALUE), status: r.STATUS, recommended: r.RECOMMENDED_OPTION,
      createdAt: r.CREATED_AT, openedOption: r.OPENED_OPTION, openedBy: r.OPENED_BY, scenarioId: num(r.SCENARIO_ID), options: [],
    });
    if (r.OPTION_ID) byId.get(k)!.options.push({
      optionId: r.OPTION_ID, label: r.LABEL, salesDeltaAud: num(r.SALES_DELTA_AUD), marginDeltaAud: num(r.MARGIN_DELTA_AUD), storesTouched: num(r.STORES_TOUCHED),
    });
  }
  return [...byId.values()];
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("proposal");
    if (id && !PROPOSAL_ID.test(id)) return NextResponse.json({ error: "Bad proposal id" }, { status: 400 });
    const list = await proposals(id);
    if (id) return list[0] ? NextResponse.json(list[0]) : NextResponse.json({ error: `No proposal ${id}` }, { status: 404 });
    return NextResponse.json(list);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Row;
  try {
    if (body.action !== "open") return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    const proposalId = String(body.proposalId ?? ""), optionId = String(body.optionId ?? "");
    if (!PROPOSAL_ID.test(proposalId) || !OPTION_ID.test(optionId)) return NextResponse.json({ ok: false, error: "Bad proposal or option id" }, { status: 400 });
    const r = await q(`CALL ${S}.OPEN_SANDBOX_PROPOSAL(?, ?, ?)`, [proposalId, optionId, sessionUser(request)]);
    const out = parse(Object.values(r[0] ?? {})[0]) as Row;
    return NextResponse.json(out, { status: out?.ok ? 200 : 409 });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
