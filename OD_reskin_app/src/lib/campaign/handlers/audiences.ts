// ─── OneDigital Campaign Manager: audience creation ─────────────────────────
//
// Sizing, saving and locking an audience. The spec (../spec.ts) compiles to a
// WHERE clause with bound values; this module wraps it in the customer 360, adds
// lookalike expansion, consent (including OnePass data-sharing consent for
// Bunnings and Kmart signals), the suppression rules and the uplift quadrants,
// and either counts the result or freezes it into AUDIENCE_MEMBER with a
// deterministic holdout.

import { createHash } from "crypto";
import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { validateSpec, canonicalSpec, describeSpec, SpecError, type AudienceSpec } from "../spec";
import { audienceSql, sizingStatements, sizingResult } from "../audience-core";
import { cellsFrom, quadrantForCell, type UpliftCells } from "../measure";
import { FIELDS, CHANNELS, PERSONAL_CHANNELS, type Quadrant } from "../config";
import { runGrounded } from "../ai";
import { toNum, isoDate } from "../format";

const n = (v: unknown) => toNum(v) ?? 0;

function spec(input: unknown): AudienceSpec {
  try {
    return validateSpec(input);
  } catch (e) {
    if (e instanceof SpecError || e instanceof SyntaxError) throw new CmpError(400, e.message);
    throw e;
  }
}

async function loadCells(): Promise<UpliftCells> {
  return cellsFrom(await q(SQL.SQL_UPLIFT_CELLS));
}

export { audienceSql } from "../audience-core";

/** Size an audience: the funnel from matched to final, what each rule removed,
 *  uplift quadrants, composition and Audience Health (../audience-core.ts). */
export async function sizeAudience(body: unknown) {
  const sp = spec((body as { spec?: unknown })?.spec ?? body);
  const cells = await loadCells();
  return sizingResult(sp, cells, await batch(sizingStatements(sp, cells)));
}

export async function getAudiences(campaignId: string | null) {
  const [audiences, campaigns, cells] = await batch([
    SQL.SQL_ALL_AUDIENCES,
    `SELECT CAMPAIGN_ID, NAME, STATUS, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, CHANNELS, START_DATE, END_DATE, BUDGET_AUD, AUDIENCE_ID
     FROM ${S}.CAMPAIGN ORDER BY IFF(STATUS IN ('BRIEF', 'IDEA'), 0, 1), COALESCE(START_DATE, '2099-01-01'::DATE) DESC`,
    SQL.SQL_UPLIFT_CELLS,
  ]);
  const seedCampaigns = (await q(`SELECT c.CAMPAIGN_ID, c.NAME, COUNT(DISTINCT e.CUSTOMER_KEY) AS CONVERTERS
     FROM ${S}.CAMPAIGN c JOIN ${S}.CAMPAIGN_EVENT e ON e.CAMPAIGN_ID = c.CAMPAIGN_ID AND e.EVENT_TYPE = 'CONVERT' AND e.GROUP_CODE = 'TREATED'
     GROUP BY 1, 2 ORDER BY 3 DESC`));
  const m = cellsFrom(cells);
  return {
    audiences, campaigns, seedCampaigns, selected: campaignId,
    upliftCells: [...m.entries()].map(([key, c]) => ({ key, ...c, quadrant: quadrantForCell(m, key).quadrant })),
  };
}

export async function saveAudience(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; name?: string; description?: string; spec?: unknown; source?: string };
  const sp = spec(b.spec);
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) throw new CmpError(400, "Give the audience a name.");
  const campaignId = b.campaignId ? String(b.campaignId) : null;
  const size = await sizeAudience({ spec: sp });
  const canonical = canonicalSpec(sp);
  const hash = createHash("sha256").update(canonical).digest("hex");
  const id = `aud-${Date.now().toString(36)}`;
  await tx(async (run) => {
    if (campaignId) {
      const c = await run(`SELECT STATUS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [campaignId]);
      if (!c.length) throw new CmpError(404, `No campaign ${campaignId}.`);
    }
    const v = await run(`SELECT COALESCE(MAX(VERSION), 0) + 1 AS V FROM ${S}.AUDIENCE WHERE NAME = ?`, [name]);
    await run(
      `INSERT INTO ${S}.AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, SIZE_AT_SAVE, REACHABLE_AT_SAVE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT)
       SELECT ?, ?, ?, PARSE_JSON(?), ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ${NOW}`,
      [id, name, (b.description ?? describeSpec(sp)).slice(0, 500), canonical, hash, Number(v[0]?.V ?? 1),
        ["BUILDER", "AI", "IDEA", "LOOKALIKE"].includes(String(b.source)) ? String(b.source) : "BUILDER",
        size.funnel.matched, size.funnel.final, campaignId, user],
    );
  });
  return { ok: true, audienceId: id, size: size.funnel };
}

/** Lock: freeze the audience into AUDIENCE_MEMBER for the campaign, split off a
 *  deterministic holdout, assign channel and variant, and move the campaign to
 *  AUDIENCE_LOCKED -- all in one transaction with its audit row. */
export async function lockAudience(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; audienceId?: string };
  const campaignId = String(b.campaignId ?? "");
  const audienceId = String(b.audienceId ?? "");
  const [camp, aud, settings] = await batch([
    { sql: `SELECT CAMPAIGN_ID, STATUS, HOLDOUT_PCT, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, CHANNELS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, binds: [campaignId] },
    { sql: `SELECT AUDIENCE_ID, SPEC, STATUS, CAMPAIGN_ID FROM ${S}.AUDIENCE WHERE AUDIENCE_ID = ?`, binds: [audienceId] },
    SQL.SQL_SETTINGS,
  ]);
  if (!camp.length) throw new CmpError(404, `No campaign ${campaignId}.`);
  if (!aud.length) throw new CmpError(404, `No audience ${audienceId}.`);
  if (camp[0].STATUS !== "BRIEF") throw new CmpError(409, `Only a campaign at BRIEF can lock an audience; this one is ${String(camp[0].STATUS)}.`);
  if (aud[0].STATUS === "LOCKED") throw new CmpError(409, "That audience is already locked to a campaign. Save a copy to reuse it.");
  const sp = spec(aud[0].SPEC);
  if (!sp.channels.length) throw new CmpError(400, "Choose at least one channel before locking.");
  const holdoutPct = toNum(camp[0].HOLDOUT_PCT) ?? (Number(settings.find((s) => s.SETTING_KEY === "HOLDOUT_PCT")?.SETTING_VALUE) || 10);
  const cells = await loadCells();
  const a = audienceSql(sp, cells);
  const personal = sp.channels.filter((c) => PERSONAL_CHANNELS.includes(c));
  const fallback = sp.channels.find((c) => !PERSONAL_CHANNELS.includes(c)) ?? null;
  const col: Record<string, string> = { EMAIL: "EMAIL_OPT_IN", SMS: "SMS_OPT_IN", PUSH: "PUSH_ENABLED" };
  // Their preferred channel when the campaign uses it and they consented; else the
  // first consented channel in the campaign's order; else a non-personal channel.
  const chanExpr = `CASE ${personal.map((c) => `WHEN PREFERRED_CHANNEL = '${c}' AND COALESCE(${col[c]}, FALSE) THEN '${c}'`).join(" ")}
    ${personal.map((c) => `WHEN COALESCE(${col[c]}, FALSE) THEN '${c}'`).join(" ")} ${fallback ? `ELSE '${fallback}'` : ""} END`;
  for (const c of sp.channels) if (!(CHANNELS as readonly string[]).includes(c)) throw new CmpError(400, "Unknown channel.");
  const result = await tx(async (run) => {
    await run(`DELETE FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ?`, [campaignId]);
    await run(
      `INSERT INTO ${S}.AUDIENCE_MEMBER (CAMPAIGN_ID, AUDIENCE_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, SNAPSHOT_DATE,
         SEGMENT_NAME, LOYALTY_TIER, PROFILE_STATE, HOME_STORE_CODE, HOME_STATE, RECENCY_DAYS, RECENCY_BAND, LINES_12M, SPEND_12M_AUD, AOV_AUD,
         PROMO_SHARE, RFM_SEGMENT, TRACK, NEED_STATE, RESPONSE_STATE, SIGNAL_AGE_DAYS, BIZ_STARTER, SCHOOL_SIGNAL, SCHOOL_LIST_USER,
         OW_RELATIONSHIP, GROUP_DATA_CONSENT, DAYS_TO_SCHOOL_START, IS_RELEVANT, COLD_CONTACT, STOCK_CONFLICT, UPLIFT_QUADRANT, P_TREAT, P_CONTROL)
       ${a.sql}
       SELECT ?, ?, CUSTOMER_KEY,
              IFF((ABS(HASH(CUSTOMER_KEY, ?, 'holdout')) % 1000) < ? * 10, 'HOLDOUT', 'TREATED'),
              ${chanExpr},
              IFF((ABS(HASH(CUSTOMER_KEY, ?, 'holdout')) % 1000) < ? * 10, NULL, IFF((ABS(HASH(CUSTOMER_KEY, ?, 'variant')) % 2) = 0, 'A', 'B')),
              ${S}.CMP_AS_OF(), SEGMENT_NAME, LOYALTY_TIER, PROFILE_STATE, HOME_STORE_CODE, HOME_STATE, RECENCY_DAYS, RECENCY_BAND, LINES_12M,
              SPEND_12M_AUD, AOV_AUD, PROMO_SHARE, RFM_SEGMENT, TRACK, NEED,
              -- The simulator's input: the member's need whatever consent lets the business see.
              ${S}.NEED_STATE(TRACK, BIZ_STARTER_FLAG, PRIOR_TRADE_HISTORY, TRADE_CLASSES_12M, OW_BUSINESS_BUYER, SCHOOL_SIGNAL_CONFIDENCE,
                STARTING_SCHOOL_LIKELY, SCHOOL_LIST_USED_LAST_YEAR, TECH_LAST_DAYS, HOME_OFFICE_12M, OW_RECENCY_DAYS),
              DAYS_SINCE_FIRST_TRADE, IFF(GROUP_DATA_CONSENT, COALESCE(BIZ_STARTER_FLAG, FALSE), NULL),
              IFF(GROUP_DATA_CONSENT, SCHOOL_SIGNAL_CONFIDENCE, 'NOT_CONSENTED'), COALESCE(SCHOOL_LIST_USED_LAST_YEAR, FALSE), OW_RELATIONSHIP,
              GROUP_DATA_CONSENT, DAYS_TO_SCHOOL_START, RELEVANT, COLD, STOCK_CONFLICT,
              QUADRANT, LEAST(0.99, GREATEST(0, EXP_BASE_RATE + EXP_LIFT_PP / 100)), EXP_BASE_RATE
       FROM aud WHERE FINAL`,
      [...a.binds, campaignId, audienceId, campaignId, holdoutPct, campaignId, holdoutPct, campaignId],
    );
    const counts = await run(`SELECT COUNT_IF(GROUP_CODE = 'TREATED') AS T, COUNT_IF(GROUP_CODE = 'HOLDOUT') AS H FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ?`, [campaignId]);
    const t = n(counts[0]?.T), h = n(counts[0]?.H);
    if (t + h === 0) throw new CmpError(409, "Nobody is left in the audience after consent and suppression, so there is nothing to lock.");
    await run(`UPDATE ${S}.AUDIENCE SET STATUS = 'LOCKED', CAMPAIGN_ID = ?, LOCKED_BY = ?, LOCKED_AT = ${NOW}, REACHABLE_AT_SAVE = ? WHERE AUDIENCE_ID = ?`,
      [campaignId, user, t + h, audienceId]);
    await run(
      `UPDATE ${S}.CAMPAIGN SET STATUS = 'AUDIENCE_LOCKED', AUDIENCE_ID = ?,
         PROMOTED_CATEGORY = COALESCE(PROMOTED_CATEGORY, ?), PROMOTED_CLASS = COALESCE(PROMOTED_CLASS, ?), PROMOTED_BRAND = COALESCE(PROMOTED_BRAND, ?),
         CHANNELS = PARSE_JSON(?), UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`,
      [audienceId, sp.promoted.category, sp.promoted.className, sp.promoted.brand, JSON.stringify(sp.channels), user, campaignId]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, 'BRIEF', 'AUDIENCE_LOCKED', ?, ?, ${NOW}`,
      [campaignId, `Locked ${t.toLocaleString("en-AU")} treated and ${h.toLocaleString("en-AU")} held out (${holdoutPct}%).`, user]);
    return { treated: t, holdout: h };
  });
  return { ok: true, ...result };
}

// ─── Natural language to spec ─────────────────────────────────────────────────

const NL_FORMAT = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'all': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'field': {'type': 'string'}, 'op': {'type': 'string', 'enum': ['in', 'not_in', 'gte', 'lte', 'between', 'is_true', 'is_false']},
        'values': {'type': 'array', 'items': {'type': 'string'}}, 'value': {'type': 'number'}, 'min': {'type': 'number'}, 'max': {'type': 'number'}},
        'required': ['field', 'op']}},
      'any': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'field': {'type': 'string'}, 'op': {'type': 'string', 'enum': ['in', 'not_in', 'gte', 'lte', 'between', 'is_true', 'is_false']},
        'values': {'type': 'array', 'items': {'type': 'string'}}, 'value': {'type': 'number'}, 'min': {'type': 'number'}, 'max': {'type': 'number'}},
        'required': ['field', 'op']}},
      'channels': {'type': 'array', 'items': {'type': 'string', 'enum': ['EMAIL', 'SMS', 'PUSH', 'PAID_SOCIAL', 'IN_STORE']}},
      'promoted_category': {'type': 'string'},
      'promoted_brand': {'type': 'string'},
      'target_persuadables_only': {'type': 'boolean'},
      'explanation': {'type': 'string'}
    },
    'required': ['all', 'any', 'channels', 'explanation']
  }
}`;

function fieldCatalogue(): string {
  return Object.entries(FIELDS).map(([k, f]) =>
    `- ${k} (${f.kind}${f.options ? `: ${f.options.join(" | ")}` : ""}) ${f.label}${f.hint ? `. ${f.hint}` : ""}`).join("\n");
}

/** A plain-English request turned into a spec. The model only fills the spec's
 *  fields; the spec is validated like any other before it is sized or saved. */
export async function audienceFromText(body: unknown, user: string) {
  const b = (body ?? {}) as { text?: string; current?: unknown };
  const text = String(b.text ?? "").trim().slice(0, 600);
  if (!text) throw new CmpError(400, "Describe the audience you want.");
  const prompt = `You turn an Officeworks campaign manager's request into an audience filter. Officeworks is an Australian office,
technology, print and education retailer; on OneDigital it can also see what OnePass members buy at Bunnings and Kmart.
Today is 13 Nov 2026 (the last day of purchase data); recency, signal windows and school timing are measured from it.

Use ONLY these fields, with exactly these names and values:
${fieldCatalogue()}

Rules:
- "all" conditions must all hold; "any" conditions: at least one must hold (leave empty if not needed).
- Enum fields take op "in" or "not_in" with "values" from the list. Number fields take "gte", "lte" or "between" with "value" or "min"/"max".
  Shares are fractions (0.25 = 25%). Yes/no fields take "is_true" or "is_false".
- "Starting a business" or "new business" is BIZ_STARTER_FLAG is_true; an established tradie is PRIOR_TRADE_HISTORY is_true.
- "School-age kids" is SCHOOL_SIGNAL_CONFIDENCE in HIGH and MEDIUM unless the request says otherwise.
- "Lapsed" means RECENCY_DAYS gte 181; "recent" means RECENCY_DAYS lte 90. For Officeworks specifically use OW_RECENCY_DAYS.
- OnePass data-sharing consent is added automatically for Bunnings and Kmart fields; do not add it yourself.
- Channels: only those the request implies; default to EMAIL and SMS.
- If the request asks for something no field holds, leave it out and say so in the explanation. Never invent a field.

Request: "${text.replace(/"/g, "'")}"
Respond in JSON.`;
  const r = await runGrounded<{ all: unknown[]; any: unknown[]; channels: string[]; promoted_category?: string; promoted_brand?: string;
    target_persuadables_only?: boolean; explanation: string }>({
    stage: "AUDIENCE", templateKey: "NL_TO_SPEC", prompt, responseFormatSql: NL_FORMAT, user, question: text, maxTokens: 1500,
  });
  const cur = (b.current && typeof b.current === "object" ? b.current : {}) as Partial<AudienceSpec>;
  let sp: AudienceSpec;
  try {
    sp = validateSpec({
      version: 1, all: r.result.all, any: r.result.any, exclude: [],
      suppress: cur.suppress ?? { fatigueDays: 14, coldContacts: true, stockConflict: true },
      channels: r.result.channels?.length ? r.result.channels : ["EMAIL", "SMS"],
      promoted: { category: r.result.promoted_category || cur.promoted?.category || null, className: cur.promoted?.className ?? null,
        brand: r.result.promoted_brand || cur.promoted?.brand || null },
      quadrants: r.result.target_persuadables_only ? ["PERSUADABLE"] as Quadrant[] : null,
    });
  } catch (e) {
    throw new CmpError(422, `The model proposed a filter that is not allowed: ${(e as Error).message} Try rephrasing.`);
  }
  return { spec: sp, explanation: r.result.explanation, runId: r.runId };
}

/** A Campaign Builder proposal saved as a BRIEF with its DRAFT audience, so the
 *  person can carry it into the Audience builder, Studio and launch. The spec is
 *  re-validated and re-sized here: the card is the agent's, the counts are ours. */
export async function draftFromProposal(body: unknown, user: string) {
  const b = ((body as { proposal?: unknown })?.proposal ?? {}) as Record<string, unknown>;
  const txt = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, max));
  const name = txt(b.name, 200);
  if (!name) throw new CmpError(400, "The proposal has no name.");
  const aud = (b.audience ?? {}) as { spec?: unknown; description?: unknown };
  const sp = spec(aud.spec);
  const [asOfRow] = await q(SQL.SQL_AS_OF);
  const asOf = isoDate(asOfRow?.AS_OF) ?? "2026-11-13";
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  // An agent date in the past (or missing) moves to the week after the data ends.
  const start = iso(b.start_date) && iso(b.start_date)! > asOf ? iso(b.start_date)! : "2026-11-23";
  const end = iso(b.end_date) && iso(b.end_date)! >= start ? iso(b.end_date)! : start === "2026-11-23" ? "2026-12-20" : start;
  const budget = Math.min(100000, Math.max(1, Number(b.budget_aud) || 5000));
  const offerId = txt(b.offer_id, 20);
  if (offerId && !(await q(`SELECT 1 FROM ${S}.OFFER WHERE OFFER_ID = ? AND IS_ACTIVE`, [offerId])).length) throw new CmpError(400, `${offerId} is not an active offer.`);
  const sized = await sizeAudience({ spec: sp });
  const stamp = Date.now().toString(36);
  const cid = `camp-${stamp}`, aid = `aud-${stamp}`;
  const specJson = JSON.stringify(sp);
  await tx(async (run) => {
    await run(`INSERT INTO ${S}.CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, OFFER_ID,
                 CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, PROVENANCE, AUDIENCE_ID, CREATED_BY, CREATED_AT)
               SELECT ?, ?, ?, ?, 'BRIEF', ?, ?, ?, ?, PARSE_JSON(?), ?, ?::DATE, ?::DATE,
                      (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'HOLDOUT_PCT'), 'APP', ?, ?, ${NOW}`,
      [cid, name, txt(b.objective, 500), txt(b.hypothesis, 800), sp.promoted.category, sp.promoted.className, sp.promoted.brand, offerId,
        JSON.stringify(sp.channels), budget, start, end, aid, user]);
    await run(`INSERT INTO ${S}.AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, SIZE_AT_SAVE, REACHABLE_AT_SAVE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT)
               SELECT ?, ?, ?, PARSE_JSON(?), SHA2(?, 256), 1, 'AGENT', ?, ?, 'DRAFT', ?, ?, ${NOW}`,
      [aid, `${name.slice(0, 100)} - audience`, txt(aud.description, 500) ?? describeSpec(sp), specJson, specJson,
        sized.funnel.matched, sized.funnel.final, cid, user]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, NULL, 'BRIEF', 'Saved from a Campaign Builder proposal.', ?, ${NOW}`, [cid, user]);
  });
  return { ok: true, campaignId: cid, audienceId: aid, finalAudience: sized.funnel.final, startDate: start, endDate: end };
}
