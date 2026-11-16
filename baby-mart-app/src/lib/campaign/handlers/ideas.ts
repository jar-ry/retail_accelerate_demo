// ─── Campaign & CRM: ideation ────────────────────────────────────────────────
//
// Signals first -- real counts from purchases, stock, competitor prices, the
// voice and published learnings -- then ideas generated over exactly those
// signals. Each idea carries an audience spec that is validated and SIZED here
// (a real count, not the model's guess), its evidence, and the guardrails it
// trips: a brand short at stores, a brand customers are complaining about.

import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { runGrounded } from "../ai";
import { validateSpec, describeSpec, type AudienceSpec } from "../spec";
import { sizeAudience } from "./audiences";
import { toNum } from "../format";
import { FIELDS } from "../config";
import { INSIGHT_METHOD } from "../doctrine";

const n = (v: unknown) => toNum(v) ?? 0;
const r1 = (v: unknown) => { const x = toNum(v); return x === null ? null : Math.round(x * 10) / 10; };

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

const IDEA_FORMAT = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'ideas': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'title': {'type': 'string'},
        'signal_type': {'type': 'string', 'enum': ['LIFE_STAGE', 'VALUE', 'CATEGORY_GAP', 'SUPPLY', 'VOICE', 'COMPETITOR', 'LEARNING']},
        'hypothesis': {'type': 'string'},
        'target_description': {'type': 'string'},
        'audience': {'type': 'object', 'properties': {
          'all': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'field': {'type': 'string'}, 'op': {'type': 'string', 'enum': ['in', 'not_in', 'gte', 'lte', 'between', 'is_true', 'is_false']},
            'values': {'type': 'array', 'items': {'type': 'string'}}, 'value': {'type': 'number'}, 'min': {'type': 'number'}, 'max': {'type': 'number'}},
            'required': ['field', 'op']}}
        }, 'required': ['all']},
        'promoted_category': {'type': 'string'},
        'promoted_class': {'type': 'string'},
        'promoted_brand': {'type': 'string'},
        'channels': {'type': 'array', 'items': {'type': 'string', 'enum': ['EMAIL', 'SMS', 'PUSH', 'PAID_SOCIAL', 'IN_STORE']}},
        'offer_id': {'type': 'string'},
        'evidence': {'type': 'array', 'items': {'type': 'string'}},
        'figures_cited': {'type': 'array', 'items': {'type': 'string'}},
        'risks': {'type': 'array', 'items': {'type': 'string'}},
        'priority': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}
      }, 'required': ['title', 'signal_type', 'hypothesis', 'target_description', 'audience', 'channels', 'evidence', 'figures_cited', 'risks', 'priority']}}
    },
    'required': ['ideas']
  }
}`;

type AiIdea = {
  title: string; signal_type: string; hypothesis: string; target_description: string; audience: { all: unknown[] };
  promoted_category?: string; promoted_class?: string; promoted_brand?: string; channels: string[]; offer_id?: string;
  evidence: string[]; figures_cited: string[]; risks: string[]; priority: string;
};

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

export async function generateIdeas(body: unknown, user: string) {
  const focus = String((body as { focus?: string })?.focus ?? "").trim().slice(0, 300) || null;
  const s = await signals();
  const offers = await q(SQL.SQL_OFFERS);
  const figures = {
    as_of: "7 May 2026",
    stage_due_cohorts: s.due.map((d) => ({ track: d.TRACK, from_class: d.FROM_CLASS, next_class: d.NEXT_CLASS, due: d.DUE_STATUS, customers: n(d.CUSTOMERS), contactable: n(d.CONTACTABLE) })),
    value_segments: s.rfm.map((r) => ({ rfm_segment: r.RFM_SEGMENT, customers: n(r.CUSTOMERS), spend_12m_aud: n(r.SPEND_12M_AUD), avg_recency_days: n(r.AVG_RECENCY_DAYS) })),
    supply: s.supply.map((x) => ({ brand: x.BRAND_NAME, status: x.STATUS, stores: n(x.STORES), states: x.STATES, reason: x.REASON })),
    what_parents_say_they_will_buy_next: s.intent.map((x) => ({ intent: x.PURCHASE_INTENT, mentions: n(x.MENTIONS), customers: n(x.CUSTOMERS) })),
    brand_sentiment_180d: s.brandVoice.slice(0, 12).map((x) => ({ brand: x.BRAND_NAME, mentions: n(x.MENTIONS), negative_pct: r1(x.NEGATIVE_PCT), top_negative_theme: x.TOP_NEGATIVE_THEME })),
    most_praised_themes: s.praise.map((x) => ({ theme: x.THEME, mentions: n(x.MENTIONS) })),
    voice_anomalies_last_6_weeks: s.anomalies.map((a) => ({ week: String(a.EVENT_WEEK).slice(0, 10), state: a.STATE, theme: a.THEME, negative_mentions: n(a.NEGATIVE_MENTIONS), z: r1(a.Z) })),
    competitor_price_gap_pct: s.competitor.map((c) => ({ category: c.CATEGORY, gap_pct: r1(c.AVG_GAP_PCT) })),
    learnings: s.learnings.slice(0, 10).map((l) => ({ campaign: l.CAMPAIGN_NAME, finding: l.STATEMENT, lift_pts: r1(l.LIFT_PP), significant: l.IS_SIGNIFICANT })),
    offers: offers.filter((o) => o.IS_ACTIVE).map((o) => ({ offer_id: o.OFFER_ID, name: o.NAME, terms: o.TERMS, category: o.CATEGORY })),
    ideas_rejected_before: s.rejected.map((r) => ({ title: r.TITLE, reason: r.DECISION_REASON })),
  };
  const fields = Object.entries(FIELDS).map(([k, f]) => `${k} (${f.kind}${f.options ? `: ${f.options.join(" | ")}` : ""})`).join("; ");
  const prompt = `You are the campaign strategist for Baby Mart, an Australian baby retailer (nappies, feeding, clothing, car seats, prams).
Propose 4 to 6 campaign ideas a CRM manager could run in the next six weeks, from the signals below and nothing else.

${INSIGHT_METHOD}

Good ideas target a NEED the data shows (a child moving to the next stage, a gap in what a family has bought, a lapse),
sell something Baby Mart can supply, and use what past campaigns taught. Do not propose promoting a brand that is short
in stores. Do not repeat a rejected idea. Prefer a specific, sizeable audience over "everyone".
${focus ? `\nThe manager asked to focus on: "${focus.replace(/"/g, "'")}"\n` : ""}
For each idea give the audience as filter conditions using ONLY these fields and values: ${fields}.
A capsule-to-convertible upgrade, for example, is CAR_SEAT_LAST_CLASS in ["Capsule (0-6m)"] and CAR_SEAT_DUE_STATUS in ["DUE_NOW"].
Do not state an audience size: it is counted from the data after you answer.

=== THE SIGNALS (the only data you have; amounts AUD; keys ending _pct are percentages) ===
${JSON.stringify(figures, null, 1)}

Rules: every number you write must come from the signals; list each in figures_cited. Evidence is 2-3 short points naming
the signal. Risks name what could go wrong. Respond in JSON.`;
  const r = await runGrounded<{ ideas: AiIdea[] }>({
    stage: "IDEATION", templateKey: "IDEAS", prompt, responseFormatSql: IDEA_FORMAT, user, question: focus, figures,
    cited: (x) => x.ideas.flatMap((i) => i.figures_cited ?? []),
    prose: (x) => x.ideas.flatMap((i) => [i.hypothesis, i.target_description, ...(i.evidence ?? []), ...(i.risks ?? [])]),
    maxTokens: 6000,
  });
  const offerIds = new Set(offers.map((o) => String(o.OFFER_ID)));
  const saved: Row[] = [];
  let i = 0;
  for (const idea of r.result.ideas.slice(0, 6)) {
    i++;
    let sp: AudienceSpec | null = null;
    let size: { matched: number; final: number } | null = null;
    let specError: string | null = null;
    try {
      sp = validateSpec({
        version: 1, all: idea.audience?.all ?? [], any: [], exclude: [],
        suppress: { fatigueDays: 14, priceComplainers: true, openComplaints: false, stockConflict: true },
        channels: idea.channels?.length ? idea.channels : ["EMAIL", "SMS"],
        promoted: { category: idea.promoted_category || null, className: idea.promoted_class || null, brand: idea.promoted_brand || null },
      });
      const sz = await sizeAudience({ spec: sp });
      size = { matched: sz.funnel.matched, final: sz.funnel.final };
    } catch (e) {
      specError = (e as Error).message;
    }
    const g = guardrails(idea, s);
    if (specError) g.push({ level: "CAUTION", message: `The proposed audience could not be used: ${specError}` });
    const blocked = g.some((x) => x.level === "BLOCK");
    const id = `idea-${Date.now().toString(36)}-${i}`;
    await q(
      `INSERT INTO ${S}.IDEA (IDEA_ID, RUN_ID, TITLE, SIGNAL_TYPE, HYPOTHESIS, TARGET_DESCRIPTION, AUDIENCE_SPEC, AUDIENCE_SIZE, REACHABLE_SIZE,
         SUGGESTED_CHANNELS, SUGGESTED_OFFER_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, EVIDENCE, GUARDRAILS, PRIORITY, STATUS,
         IS_VERIFIED, CREATED_BY, CREATED_AT)
       SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, ?, PARSE_JSON(?), ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ?, ${NOW}`,
      [id, r.runId, idea.title.slice(0, 200), idea.signal_type, idea.hypothesis, sp ? describeSpec(sp) : idea.target_description,
        JSON.stringify(sp), size?.matched ?? null, size?.final ?? null, JSON.stringify(sp?.channels ?? idea.channels ?? []),
        idea.offer_id && offerIds.has(idea.offer_id) ? idea.offer_id : null,
        idea.promoted_category || null, idea.promoted_class || null, idea.promoted_brand || null,
        JSON.stringify({ points: idea.evidence, risks: idea.risks, target: idea.target_description }), JSON.stringify(g), idea.priority,
        blocked ? "BLOCKED" : "NEW", r.verified, user],
    );
    saved.push({ IDEA_ID: id });
  }
  return { ok: true, runId: r.runId, verified: r.verified, unmatched: r.unmatched, ideas: saved.length };
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
