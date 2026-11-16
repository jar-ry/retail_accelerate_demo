// ─── Campaign & CRM: ideation ────────────────────────────────────────────────
//
// Signals first -- real counts from purchases, stock, competitor prices, the
// voice and published learnings -- then ideas from the Campaign Builder agent,
// which reads the same signals through its tools. Each idea carries an audience
// spec that is validated and SIZED here (a real count, not the agent's), its
// evidence, and the guardrails it trips: a brand short at stores, a brand
// customers are complaining about.

import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { readAgentRun } from "../agent-log";
import { validateSpec, describeSpec, emptySpec, type AudienceSpec } from "../spec";
import { sizeAudience } from "./audiences";
import { toNum } from "../format";

const n = (v: unknown) => toNum(v) ?? 0;

async function signals() {
  const [due, rfm, supply, intent, brandVoice, praise, anomalies, competitor, learnings, rejected, nbp] = await batch([
    SQL.SQL_SIGNAL_DUE, SQL.SQL_SIGNAL_RFM, SQL.SQL_SIGNAL_SUPPLY, SQL.SQL_SIGNAL_INTENT, SQL.SQL_SIGNAL_BRAND_VOICE,
    SQL.SQL_SIGNAL_PRAISE, SQL.SQL_SIGNAL_ANOMALIES, SQL.SQL_SIGNAL_COMPETITOR, SQL.SQL_LEARNINGS, SQL.SQL_REJECTED_IDEAS, SQL.SQL_NEXT_PRODUCTS,
  ]);
  return { due, rfm, supply, intent, brandVoice, praise, anomalies, competitor, learnings, rejected, nbp };
}

export async function getIdeas() {
  const [s, ideas] = await Promise.all([signals(), q(SQL.SQL_IDEAS)]);
  return { signals: s, ideas };
}

/** Guardrails checked in code, not left to the model. */
function guardrails(i: { promoted_brand?: string | null }, s: Awaited<ReturnType<typeof signals>>) {
  const out: { level: "BLOCK" | "CAUTION"; message: string }[] = [];
  const brand = i.promoted_brand ?? null;
  if (brand) {
    const short = s.supply.filter((x) => x.BRAND_NAME === brand && x.STATUS === "SHORT");
    for (const x of short) out.push({ level: "BLOCK", message: `${brand} is short at ${x.STORES} stores (${x.STATES}): ${x.REASON} (${x.ALERT_ID}).` });
    const low = s.supply.filter((x) => x.BRAND_NAME === brand && x.STATUS === "LOW");
    for (const x of low) out.push({ level: "CAUTION", message: `${brand} stock is low at ${x.STORES} stores: ${x.REASON}` });
    const v = s.brandVoice.find((x) => x.BRAND_NAME === brand);
    if (v && n(v.NEGATIVE_PCT) >= 20) out.push({ level: "CAUTION", message: `${n(v.NEGATIVE_PCT)}% of ${v.MENTIONS} recent comments on ${brand} are negative, mostly about ${String(v.TOP_NEGATIVE_THEME ?? "quality").toLowerCase()}.` });
  }
  return out;
}

type AgentIdea = {
  title?: string; signal_type?: string; hypothesis?: string;
  audience?: { description?: string; spec?: unknown; final_audience?: number | null };
  channels?: string[]; promoted?: { category?: string | null; className?: string | null; brand?: string | null };
  offer_id?: string | null; evidence?: string[]; risks?: string[]; priority?: string;
};

const SIGNAL_TYPES = ["LIFE_STAGE", "VALUE", "CATEGORY_GAP", "SUPPLY", "VOICE", "COMPETITOR", "LEARNING"];

/** The ideas board from a Campaign Builder run in ideas mode. The run is read
 *  from AI_RUN, where the chat route logged it with its verification, never from
 *  the browser. Each idea's audience is sized again here and its guardrails are
 *  checked in code, so the board does not rest on what the agent said it found.
 *  Saving a run twice saves it once. */
export async function ideasFromRun(body: unknown, user: string) {
  const runId = String((body as { runId?: string })?.runId ?? "");
  const run = await readAgentRun(runId, "IDEATION");
  if (!run) throw new CmpError(404, "No ideas run with that id.");
  const existing = await q(`SELECT COUNT(*) AS N FROM ${S}.IDEA WHERE RUN_ID = ?`, [runId]);
  if (n(existing[0]?.N) > 0) return { ok: true, runId, ideas: n(existing[0]?.N), alreadySaved: true };
  const response = (typeof run.RESPONSE === "string" ? JSON.parse(run.RESPONSE) : run.RESPONSE) as { block?: unknown } | null;
  const list = Array.isArray(response?.block) ? (response!.block as AgentIdea[]) : [];
  if (!list.length) throw new CmpError(422, "The agent's answer had no ideas block to save.");
  const s = await signals();
  const offerIds = new Set((await q(SQL.SQL_OFFERS)).filter((o) => o.IS_ACTIVE).map((o) => String(o.OFFER_ID)));
  let i = 0;
  for (const idea of list.slice(0, 6)) {
    i++;
    const promoted = idea.promoted ?? {};
    let sp: AudienceSpec | null = null;
    let size: { matched: number; final: number } | null = null;
    let specError: string | null = null;
    try {
      const raw = (typeof idea.audience?.spec === "string" ? JSON.parse(idea.audience.spec) : idea.audience?.spec ?? {}) as Record<string, unknown>;
      const base = emptySpec();
      sp = validateSpec({
        ...base, ...raw,
        suppress: { ...base.suppress, ...((raw.suppress as object) ?? {}) },
        channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels : idea.channels?.length ? idea.channels : base.channels,
        promoted: { category: promoted.category ?? null, className: promoted.className ?? null, brand: promoted.brand ?? null, ...((raw.promoted as object) ?? {}) },
      });
      const sz = await sizeAudience({ spec: sp });
      size = { matched: sz.funnel.matched, final: sz.funnel.final };
    } catch (e) {
      specError = (e as Error).message;
    }
    const g = guardrails({ promoted_brand: sp?.promoted.brand ?? promoted.brand ?? null }, s);
    if (specError) g.push({ level: "CAUTION", message: `The proposed audience could not be used: ${specError}` });
    const blocked = g.some((x) => x.level === "BLOCK");
    const id = `idea-${Date.now().toString(36)}-${i}`;
    const title = String(idea.title ?? `Idea ${i}`).slice(0, 200);
    await q(
      `INSERT INTO ${S}.IDEA (IDEA_ID, RUN_ID, TITLE, SIGNAL_TYPE, HYPOTHESIS, TARGET_DESCRIPTION, AUDIENCE_SPEC, AUDIENCE_SIZE, REACHABLE_SIZE,
         SUGGESTED_CHANNELS, SUGGESTED_OFFER_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, EVIDENCE, GUARDRAILS, PRIORITY, STATUS,
         IS_VERIFIED, CREATED_BY, CREATED_AT)
       SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, ?, PARSE_JSON(?), ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ?, ${NOW}`,
      [id, runId, title, SIGNAL_TYPES.includes(String(idea.signal_type)) ? idea.signal_type : "LIFE_STAGE", String(idea.hypothesis ?? "").slice(0, 2000),
        sp ? describeSpec(sp) : String(idea.audience?.description ?? "").slice(0, 1000),
        JSON.stringify(sp), size?.matched ?? null, size?.final ?? null, JSON.stringify(sp?.channels ?? idea.channels ?? []),
        idea.offer_id && offerIds.has(idea.offer_id) ? idea.offer_id : null,
        sp?.promoted.category ?? null, sp?.promoted.className ?? null, sp?.promoted.brand ?? null,
        JSON.stringify({ points: idea.evidence ?? [], risks: idea.risks ?? [], target: idea.audience?.description ?? null }), JSON.stringify(g),
        ["HIGH", "MEDIUM", "LOW"].includes(String(idea.priority)) ? idea.priority : "MEDIUM",
        blocked ? "BLOCKED" : "NEW", run.IS_VERIFIED ?? null, user],
    );
  }
  return { ok: true, runId, ideas: i, verified: run.IS_VERIFIED ?? null };
}

/** Accept turns an idea into a campaign BRIEF carrying its audience; reject
 *  needs a reason, which later idea runs are told. */
export async function decideIdea(body: unknown, user: string) {
  const b = (body ?? {}) as { ideaId?: string; decision?: string; reason?: string; name?: string; startDate?: string; endDate?: string; budget?: number };
  const ideaId = String(b.ideaId ?? "");
  const decision = String(b.decision ?? "").toUpperCase();
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  const rows = await q(`SELECT * FROM ${S}.IDEA WHERE IDEA_ID = ?`, [ideaId]);
  if (!rows.length) throw new CmpError(404, "No such idea.");
  const idea = rows[0];
  if (!["NEW", "BLOCKED"].includes(String(idea.STATUS))) throw new CmpError(409, `This idea was already ${String(idea.STATUS).toLowerCase()}.`);
  if (decision === "REJECT") {
    if (reason.length < 5) throw new CmpError(400, "Say why the idea is rejected; the next idea run reads it.");
    await q(`UPDATE ${S}.IDEA SET STATUS = 'REJECTED', DECISION_REASON = ?, DECIDED_BY = ?, DECIDED_AT = ${NOW} WHERE IDEA_ID = ?`, [reason, user, ideaId]);
    return { ok: true };
  }
  if (decision !== "ACCEPT") throw new CmpError(400, "Decision must be ACCEPT or REJECT.");
  if (idea.STATUS === "BLOCKED" && reason.length < 5) throw new CmpError(409, "This idea trips a guardrail. Give a reason to accept it anyway.");
  const iso = (v: unknown, d: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const start = iso(b.startDate, "2026-05-18"), end = iso(b.endDate, "2026-06-14");
  if (end < start) throw new CmpError(400, "The end date is before the start date.");
  const campaignId = `camp-${Date.now().toString(36)}`;
  const spec = idea.AUDIENCE_SPEC ? (typeof idea.AUDIENCE_SPEC === "string" ? JSON.parse(idea.AUDIENCE_SPEC) : idea.AUDIENCE_SPEC) : null;
  const audienceId = spec ? `aud-${Date.now().toString(36)}` : null;
  await tx(async (run) => {
    await run(
      `INSERT INTO ${S}.CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, IDEA_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, OFFER_ID,
         CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, PROVENANCE, CREATED_BY, CREATED_AT)
       SELECT ?, ?, ?, ?, 'BRIEF', ?, ?, ?, ?, ?, PARSE_JSON(?), ?, ?::DATE, ?::DATE,
              (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'HOLDOUT_PCT'), 'APP', ?, ${NOW}`,
      [campaignId, String(b.name ?? idea.TITLE).slice(0, 200), idea.TARGET_DESCRIPTION, idea.HYPOTHESIS, ideaId, idea.PROMOTED_CATEGORY, idea.PROMOTED_CLASS,
        idea.PROMOTED_BRAND, idea.SUGGESTED_OFFER_ID, JSON.stringify(idea.SUGGESTED_CHANNELS ?? ["EMAIL"]), Math.max(0, Number(b.budget ?? 5000) || 5000), start, end, user]);
    if (spec && audienceId) {
      await run(
        `INSERT INTO ${S}.AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, SIZE_AT_SAVE, REACHABLE_AT_SAVE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT)
         SELECT ?, ?, ?, PARSE_JSON(?), SHA2(?, 256), 1, 'IDEA', ?, ?, 'DRAFT', ?, ?, ${NOW}`,
        [audienceId, `${String(idea.TITLE).slice(0, 100)} - audience`, idea.TARGET_DESCRIPTION, JSON.stringify(spec), JSON.stringify(spec),
          idea.AUDIENCE_SIZE, idea.REACHABLE_SIZE, campaignId, user]);
    }
    await run(`UPDATE ${S}.IDEA SET STATUS = 'ACCEPTED', DECISION_REASON = ?, DECIDED_BY = ?, DECIDED_AT = ${NOW}, CAMPAIGN_ID = ? WHERE IDEA_ID = ?`,
      [reason || null, user, campaignId, ideaId]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, 'IDEA', 'BRIEF', ?, ?, ${NOW}`, [campaignId, `Accepted from the ideas board${reason ? `: ${reason}` : "."}`, user]);
  });
  return { ok: true, campaignId, audienceId };
}
