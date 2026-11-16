// ─── Campaign & CRM: audience creation ───────────────────────────────────────
//
// Sizing, saving and locking an audience. The spec (../spec.ts) compiles to a
// WHERE clause with bound values; this module wraps it in the customer 360, adds
// lookalike expansion, consent, the suppression rules and the uplift quadrants,
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
import { toNum } from "../format";

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
         PROMO_SHARE, CHILD_STAGE, RFM_SEGMENT, NEG_VOICE_120D, NEG_THEME, IS_RELEVANT, STOCK_CONFLICT, UPLIFT_QUADRANT, P_TREAT, P_CONTROL)
       ${a.sql}
       SELECT ?, ?, CUSTOMER_KEY,
              IFF((ABS(HASH(CUSTOMER_KEY, ?, 'holdout')) % 1000) < ? * 10, 'HOLDOUT', 'TREATED'),
              ${chanExpr},
              IFF((ABS(HASH(CUSTOMER_KEY, ?, 'holdout')) % 1000) < ? * 10, NULL, IFF((ABS(HASH(CUSTOMER_KEY, ?, 'variant')) % 2) = 0, 'A', 'B')),
              ${S}.CMP_AS_OF(), SEGMENT_NAME, LOYALTY_TIER, PROFILE_STATE, HOME_STORE_CODE, HOME_STATE, RECENCY_DAYS, RECENCY_BAND, LINES_12M,
              SPEND_12M_AUD, AOV_AUD, PROMO_SHARE, CHILD_STAGE, RFM_SEGMENT, NEG_VOICE_120D, NEG_THEME_120D, RELEVANT, STOCK_CONFLICT,
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
  const prompt = `You turn a Baby Mart campaign manager's request into an audience filter. Baby Mart is an Australian baby retailer.
Today is 7 May 2026 (the last day of purchase data); recency is measured from it.

Use ONLY these fields, with exactly these names and values:
${fieldCatalogue()}

Rules:
- "all" conditions must all hold; "any" conditions: at least one must hold (leave empty if not needed).
- Enum fields take op "in" or "not_in" with "values" from the list. Number fields take "gte", "lte" or "between" with "value" or "min"/"max".
  Shares are fractions (0.25 = 25%). Yes/no fields take "is_true" or "is_false".
- Child stage comes from purchases: a capsule car seat bought 5-8 months ago is CAR_SEAT_LAST_CLASS "Capsule (0-6m)" with CAR_SEAT_DUE_STATUS "DUE_NOW".
- "Lapsed" means RECENCY_DAYS gte 181; "recent" means RECENCY_DAYS lte 90.
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
      suppress: cur.suppress ?? { fatigueDays: 14, priceComplainers: true, openComplaints: false, stockConflict: true },
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
