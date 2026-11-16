// ─── Campaign & CRM: content and channel strategy ────────────────────────────
//
// Variants for every channel, written by AI_COMPLETE from the brief, the locked
// audience's mix, products that are in range and in stock at real prices, the
// offer's exact terms and the customers' own words -- then a QA scorecard:
// deterministic checks (length, banned phrases, every number traced to the
// catalogue) and a model judge for brand voice and claims risk. Then the channel
// plan, and the launch gates.

import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { runGrounded } from "../ai";
import { verifyCitations } from "../../ai/grounded";
import { BRAND_VOICE, CLAIMS_RULES, BANNED_PHRASES, DOCTRINE_VERSION } from "../doctrine";
import { SMS_MAX, PUSH_TITLE_MAX, PUSH_BODY_MAX, SUBJECT_MAX, SOCIAL_MAX, INSTORE_MAX, type ChannelCode } from "../config";
import { planChannels, type Group } from "../optimiser";
import { launchGates } from "../state";
import { cellsFrom, quadrantForCell, cellKey, channelFactors } from "../measure";
import { toNum, isoDate } from "../format";

const n = (v: unknown) => toNum(v) ?? 0;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const id = (v: unknown) => { const s = String(v ?? ""); if (!ID.test(s)) throw new CmpError(400, "Malformed id."); return s; };
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

async function context(cid: string) {
  const [camp, members, comp, products, praise, variants, plan] = await batch([
    { sql: SQL.SQL_CAMPAIGN, binds: [cid] },
    { sql: SQL.SQL_MEMBER_SUMMARY, binds: [cid] },
    { sql: `SELECT 'child_stage' AS DIM, CHILD_STAGE AS VAL, COUNT(*) AS N FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' GROUP BY 2
            UNION ALL SELECT 'segment', SEGMENT_NAME, COUNT(*) FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' GROUP BY 2
            UNION ALL SELECT 'home_state', HOME_STATE, COUNT(*) FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' GROUP BY 2`, binds: [cid, cid, cid] },
    // Products to feature: the next-best products of the treated members, in the
    // promoted category, at catalogue price, from brands no member's store is short of.
    { sql: `SELECT nb.PRODUCT_NAME, nb.BRAND_NAME, nb.NEXT_CLASS, nb.UNIT_RETAIL, COUNT(*) AS MEMBERS
            FROM ${S}.AUDIENCE_MEMBER am JOIN ${S}.NEXT_BEST_PRODUCT nb ON nb.CUSTOMER_KEY = am.CUSTOMER_KEY
            JOIN ${S}.CAMPAIGN c ON c.CAMPAIGN_ID = am.CAMPAIGN_ID
            WHERE am.CAMPAIGN_ID = ? AND am.GROUP_CODE = 'TREATED' AND (c.PROMOTED_CATEGORY IS NULL OR nb.CATEGORY = c.PROMOTED_CATEGORY)
              AND nb.BRAND_NAME NOT IN (SELECT BRAND_NAME FROM ${S}.SUPPLY_POSITION WHERE STATUS = 'SHORT')
            GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 5`, binds: [cid] },
    { sql: `SELECT v.VOICE_TEXT, v.THEME, COUNT(*) AS N FROM ${S}.VW_CUSTOMER_VOICE v JOIN ${S}.CAMPAIGN c ON c.CAMPAIGN_ID = ?
            WHERE v.SENTIMENT = 'positive' AND v.SOURCE IN ('SURVEY', 'REVIEW') AND (c.PROMOTED_CATEGORY IS NULL OR v.CATEGORY = c.PROMOTED_CATEGORY)
              AND v.EVENT_DATE > DATEADD('day', -365, ${S}.CMP_AS_OF())
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6`, binds: [cid] },
    { sql: SQL.SQL_CONTENT, binds: [cid] },
    { sql: SQL.SQL_CHANNEL_PLAN, binds: [cid] },
  ]);
  if (!camp.length) throw new CmpError(404, "No such campaign.");
  return { camp: camp[0], members, comp, products, praise, variants, plan };
}

export async function getStudio(cidRaw: string | null) {
  const cid = id(cidRaw);
  const c = await context(cid);
  const [channels, offers, metrics] = await batch([SQL.SQL_CHANNELS, SQL.SQL_OFFERS, SQL.SQL_CAMPAIGN_METRICS]);
  const gates = await gatesFor(cid, c);
  return { ...c, channels, offers, gates, metrics: metrics.find((m) => m.CAMPAIGN_ID === cid) ?? null };
}

export async function getStudioList() {
  const r = await q(`SELECT CAMPAIGN_ID, NAME, STATUS, START_DATE, END_DATE, PROMOTED_CATEGORY, PROMOTED_BRAND, BUDGET_AUD, PROVENANCE
    FROM ${S}.CAMPAIGN WHERE STATUS IN ('BRIEF', 'AUDIENCE_LOCKED', 'CONTENT_APPROVED', 'SCHEDULED') ORDER BY UPDATED_AT DESC NULLS LAST, CREATED_AT DESC`);
  return { campaigns: r };
}

const COPY_FORMAT = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'variants': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'code': {'type': 'string', 'enum': ['A', 'B']},
        'angle': {'type': 'string'},
        'subject': {'type': 'string'}, 'preheader': {'type': 'string'}, 'body': {'type': 'string'},
        'sms': {'type': 'string'}, 'push_title': {'type': 'string'}, 'push_body': {'type': 'string'},
        'social': {'type': 'string'}, 'instore': {'type': 'string'}, 'cta': {'type': 'string'},
        'products': {'type': 'array', 'items': {'type': 'string'}},
        'figures_cited': {'type': 'array', 'items': {'type': 'string'}}
      }, 'required': ['code', 'angle', 'subject', 'preheader', 'body', 'sms', 'push_title', 'push_body', 'social', 'instore', 'cta', 'products', 'figures_cited']}}
    },
    'required': ['variants']
  }
}`;

type Copy = { code: string; angle: string; subject: string; preheader: string; body: string; sms: string; push_title: string; push_body: string;
  social: string; instore: string; cta: string; products: string[]; figures_cited: string[] };

function facts(c: Awaited<ReturnType<typeof context>>) {
  const camp = c.camp;
  return {
    campaign: { name: camp.NAME, objective: camp.OBJECTIVE, hypothesis: camp.HYPOTHESIS, promoted_category: camp.PROMOTED_CATEGORY,
      promoted_class: camp.PROMOTED_CLASS, promoted_brand: camp.PROMOTED_BRAND },
    offer: camp.OFFER_ID ? { name: camp.OFFER_NAME, description: camp.OFFER_DESCRIPTION, terms: camp.OFFER_TERMS } : null,
    audience: Object.fromEntries(["child_stage", "segment", "home_state"].map((d) => [d,
      c.comp.filter((x) => x.DIM === d).sort((a, b) => n(b.N) - n(a.N)).slice(0, 5).map((x) => ({ value: x.VAL, members: n(x.N) }))])),
    products: c.products.map((p) => ({ name: p.PRODUCT_NAME, brand: p.BRAND_NAME, class: p.NEXT_CLASS, price_aud: n(p.UNIT_RETAIL) })),
    customers_own_words: c.praise.map((p) => String(p.VOICE_TEXT)),
  };
}

/** Deterministic QA: what can be checked without a model. */
function qaChecks(v: Copy | Row, supplied: unknown) {
  const g = (k: string, k2: string) => String((v as Row)[k] ?? (v as Row)[k2] ?? "");
  const fields = { subject: g("subject", "SUBJECT"), preheader: g("preheader", "PREHEADER"), body: g("body", "BODY"), sms: g("sms", "SMS_TEXT"),
    push_title: g("push_title", "PUSH_TITLE"), push_body: g("push_body", "PUSH_BODY"), social: g("social", "SOCIAL_TEXT"), instore: g("instore", "INSTORE_TEXT") };
  const checks: { check: string; result: "PASS" | "WARN" | "BLOCK"; detail: string }[] = [];
  const len = (name: string, s: string, max: number) => checks.push({ check: `${name} length`, result: s.length <= max ? "PASS" : "BLOCK", detail: `${s.length}/${max} characters` });
  len("Email subject", fields.subject, SUBJECT_MAX);
  len("SMS", fields.sms, SMS_MAX);
  len("Push title", fields.push_title, PUSH_TITLE_MAX);
  len("Push body", fields.push_body, PUSH_BODY_MAX);
  len("Social post", fields.social, SOCIAL_MAX);
  len("In-store message", fields.instore, INSTORE_MAX);
  const all = Object.values(fields).join("\n").toLowerCase();
  const banned = BANNED_PHRASES.filter((p) => all.includes(p));
  checks.push({ check: "No banned or unsafe claims", result: banned.length ? "BLOCK" : "PASS", detail: banned.length ? `Found: ${banned.join(", ")}` : "None found" });
  checks.push({ check: "SMS opt-out", result: !fields.sms || /stop/i.test(fields.sms) ? "PASS" : "WARN", detail: /stop/i.test(fields.sms) ? "Says how to opt out" : "No STOP instruction" });
  const v2 = verifyCitations(supplied, [], Object.values(fields));
  checks.push({ check: "Every price and number matches the catalogue", result: v2.verified ? "PASS" : "BLOCK",
    detail: v2.verified ? "All numbers traced to the offer or product prices" : `Not supplied: ${v2.unmatched.slice(0, 4).join(" · ")}` });
  return checks;
}

const JUDGE_FORMAT = `{
  'type': 'json',
  'schema': {'type': 'object', 'properties': {
    'brand_voice': {'type': 'integer'}, 'claims_risk': {'type': 'string', 'enum': ['LOW', 'MEDIUM', 'HIGH']},
    'tone_fit': {'type': 'integer'}, 'notes': {'type': 'string'}},
    'required': ['brand_voice', 'claims_risk', 'tone_fit', 'notes']}
}`;

async function judge(v: Row, cid: string, user: string, audience: unknown) {
  const prompt = `You review marketing copy for Baby Mart before it is sent. Score it strictly.

BRAND VOICE:
${BRAND_VOICE}

CLAIMS RULES:
${CLAIMS_RULES}

The audience: ${JSON.stringify(audience)}

The copy:
${JSON.stringify({ subject: v.SUBJECT, preheader: v.PREHEADER, body: v.BODY, sms: v.SMS_TEXT, push: [v.PUSH_TITLE, v.PUSH_BODY], social: v.SOCIAL_TEXT, instore: v.INSTORE_TEXT })}

brand_voice: 1-5, how well it follows the voice. claims_risk: HIGH if it makes any safety, health or scarcity claim the rules
forbid, MEDIUM if it comes close, LOW otherwise. tone_fit: 1-5 for this audience. notes: one or two sentences. Respond in JSON.`;
  try {
    const r = await runGrounded<{ brand_voice: number; claims_risk: string; tone_fit: number; notes: string }>({
      stage: "CONTENT_QA", campaignId: cid, templateKey: `JUDGE_v${DOCTRINE_VERSION}`, prompt, responseFormatSql: JUDGE_FORMAT, user, maxTokens: 600, model: "claude-haiku-4-5",
    });
    return r.result;
  } catch {
    return null;
  }
}

function qaStatus(checks: { result: string }[], j: { claims_risk: string; brand_voice: number } | null) {
  if (checks.some((c) => c.result === "BLOCK") || j?.claims_risk === "HIGH") return "BLOCK";
  if (checks.some((c) => c.result === "WARN") || j?.claims_risk === "MEDIUM" || (j && j.brand_voice < 3)) return "WARN";
  return "PASS";
}

export async function generateContent(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; direction?: string };
  const cid = id(b.campaignId);
  const c = await context(cid);
  if (!["AUDIENCE_LOCKED", "CONTENT_APPROVED"].includes(String(c.camp.STATUS))) throw new CmpError(409, "Lock the audience before writing content.");
  const supplied = facts(c);
  const direction = String(b.direction ?? "").trim().slice(0, 300) || null;
  const prompt = `Write two creative variants, A and B, for a Baby Mart campaign. Each variant takes a DIFFERENT angle (for example
practical help vs saving, or the child's next stage vs the service) so the A/B test teaches something.

BRAND VOICE:
${BRAND_VOICE}

CLAIMS RULES:
${CLAIMS_RULES}

Every channel in each variant:
- email subject (at most ${SUBJECT_MAX} characters), preheader, body (60-110 words);
- sms (at most ${SMS_MAX} characters INCLUDING "Opt out: reply STOP"), starting "Baby Mart:";
- push title (at most ${PUSH_TITLE_MAX}) and push body (at most ${PUSH_BODY_MAX});
- social post (at most ${SOCIAL_MAX}); in-store screen message (at most ${INSTORE_MAX}); a call to action of 2-4 words.
Personalise with {first_name}, {child_stage} and {home_store} tokens where natural; never invent a name.
Feature only products from the list, at the price shown, and quote the offer exactly as its terms say. If there is no
offer, do not invent one. Borrow phrasing from the customers' own words where it fits.
${direction ? `\nDirection from the campaign manager: "${direction.replace(/"/g, "'")}"\n` : ""}
=== THE FACTS (the only facts you may use; prices AUD) ===
${JSON.stringify(supplied, null, 1)}

List every number you use in figures_cited. Respond in JSON.`;
  const r = await runGrounded<{ variants: Copy[] }>({
    stage: "CONTENT", campaignId: cid, templateKey: `COPY_v${DOCTRINE_VERSION}`, prompt, responseFormatSql: COPY_FORMAT, user, question: direction,
    figures: supplied, cited: (x) => x.variants.flatMap((v) => v.figures_cited ?? []),
    prose: (x) => x.variants.flatMap((v) => [v.subject, v.preheader, v.body, v.sms, v.push_title, v.push_body, v.social, v.instore]), maxTokens: 5000,
  });
  const variants = r.result.variants.filter((v) => v.code === "A" || v.code === "B").slice(0, 2);
  if (!variants.length) throw new CmpError(502, "The model returned no usable variants.");
  await tx(async (run) => {
    await run(`DELETE FROM ${S}.CONTENT_VARIANT WHERE CAMPAIGN_ID = ? AND STATUS <> 'APPROVED'`, [cid]);
    for (const v of variants) {
      const checks = qaChecks(v, supplied);
      const vid = `${cid}-${v.code}`;
      await run(`DELETE FROM ${S}.CONTENT_VARIANT WHERE VARIANT_ID = ?`, [vid]);
      await run(`INSERT INTO ${S}.CONTENT_VARIANT (VARIANT_ID, CAMPAIGN_ID, VARIANT_CODE, ANGLE, SUBJECT, PREHEADER, BODY, SMS_TEXT, PUSH_TITLE, PUSH_BODY,
                   SOCIAL_TEXT, INSTORE_TEXT, CTA, PRODUCTS, PERSONALISATION, QA, QA_STATUS, STATUS, AI_RUN_ID, CREATED_BY, CREATED_AT)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?, 'DRAFT', ?, ?, ${NOW}`,
        [vid, cid, v.code, v.angle, v.subject, v.preheader, v.body, v.sms, v.push_title, v.push_body, v.social, v.instore, v.cta,
          JSON.stringify(v.products ?? []), JSON.stringify(["{first_name}", "{child_stage}", "{home_store}"].filter((t) => JSON.stringify(v).includes(t))),
          JSON.stringify({ checks, judge: null, supplied }), qaStatus(checks, null), r.runId, user]);
    }
  });
  // The judge runs after the copy is saved, so a slow judge never loses the copy.
  for (const v of variants) await runJudge(`${cid}-${v.code}`, user, supplied);
  return { ok: true, runId: r.runId, verified: r.verified };
}

async function runJudge(vid: string, user: string, supplied?: unknown) {
  const rows = await q(`SELECT * FROM ${S}.CONTENT_VARIANT WHERE VARIANT_ID = ?`, [vid]);
  if (!rows.length) return;
  const v = rows[0];
  const qa = typeof v.QA === "string" ? JSON.parse(v.QA) : (v.QA ?? {});
  const sup = supplied ?? qa.supplied ?? {};
  const checks = qaChecks(v, sup);
  const j = await judge(v, String(v.CAMPAIGN_ID), user, (sup as Row).audience ?? null);
  await q(`UPDATE ${S}.CONTENT_VARIANT SET QA = PARSE_JSON(?), QA_STATUS = ?, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE VARIANT_ID = ?`,
    [JSON.stringify({ checks, judge: j, supplied: sup }), qaStatus(checks, j), user, vid]);
}

const EDIT_FIELDS: Record<string, string> = { subject: "SUBJECT", preheader: "PREHEADER", body: "BODY", sms: "SMS_TEXT", push_title: "PUSH_TITLE",
  push_body: "PUSH_BODY", social: "SOCIAL_TEXT", instore: "INSTORE_TEXT", cta: "CTA", angle: "ANGLE" };

export async function saveVariant(body: unknown, user: string) {
  const b = (body ?? {}) as { variantId?: string; fields?: Record<string, string> };
  const vid = id(b.variantId);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(b.fields ?? {})) {
    if (!Object.hasOwn(EDIT_FIELDS, k)) continue;
    sets.push(`${EDIT_FIELDS[k]} = ?`);
    binds.push(String(v).slice(0, 4000));
  }
  if (!sets.length) throw new CmpError(400, "Nothing to change.");
  const r = await q(`SELECT STATUS FROM ${S}.CONTENT_VARIANT WHERE VARIANT_ID = ?`, [vid]);
  if (!r.length) throw new CmpError(404, "No such variant.");
  await q(`UPDATE ${S}.CONTENT_VARIANT SET ${sets.join(", ")}, STATUS = 'DRAFT', APPROVED_BY = NULL, APPROVED_AT = NULL, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE VARIANT_ID = ?`,
    [...binds, user, vid]);
  await runJudge(vid, user);
  return { ok: true };
}

export async function approveContent(body: unknown, user: string) {
  const cid = id((body as { campaignId?: string })?.campaignId);
  return tx(async (run) => {
    const c = await run(`SELECT STATUS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [cid]);
    if (c[0]?.STATUS !== "AUDIENCE_LOCKED") throw new CmpError(409, `Content is approved from AUDIENCE_LOCKED; this campaign is ${String(c[0]?.STATUS)}.`);
    const v = await run(`SELECT VARIANT_ID, QA_STATUS FROM ${S}.CONTENT_VARIANT WHERE CAMPAIGN_ID = ?`, [cid]);
    if (!v.length) throw new CmpError(409, "Write the content first.");
    const blocked = v.filter((x) => x.QA_STATUS === "BLOCK");
    if (blocked.length) throw new CmpError(409, `${blocked.length} variant(s) are blocked by QA. Fix them before approving.`);
    await run(`UPDATE ${S}.CONTENT_VARIANT SET STATUS = 'APPROVED', APPROVED_BY = ?, APPROVED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [user, cid]);
    await run(`UPDATE ${S}.CAMPAIGN SET STATUS = 'CONTENT_APPROVED', UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [user, cid]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, 'AUDIENCE_LOCKED', 'CONTENT_APPROVED', ?, ?, ${NOW}`,
      [cid, `Approved ${v.length} variant(s); QA ${v.map((x) => x.QA_STATUS).join(", ")}.`, user]);
    return { ok: true };
  });
}

/** The channel plan: optimise each group of members, write CHANNEL_PLAN and
 *  move every member (treated and holdout alike, so lift by channel stays
 *  comparable) to their group's channel. */
export async function planCampaign(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; budget?: number };
  const cid = id(b.campaignId);
  const [camp, groups, cellsRows, chLift, channels] = await batch([
    { sql: SQL.SQL_CAMPAIGN, binds: [cid] }, { sql: SQL.SQL_MEMBER_GROUPS, binds: [cid] }, SQL.SQL_UPLIFT_CELLS, SQL.SQL_CHANNEL_LIFT, SQL.SQL_CHANNELS,
  ]);
  if (!camp.length) throw new CmpError(404, "No such campaign.");
  const c = camp[0];
  if (!["AUDIENCE_LOCKED", "CONTENT_APPROVED"].includes(String(c.STATUS))) throw new CmpError(409, "Lock the audience before planning channels.");
  const allowed = arr(c.CHANNELS) as ChannelCode[];
  const cells = cellsFrom(cellsRows);
  const cost: Partial<Record<ChannelCode, number>> = Object.fromEntries(channels.map((x) => [x.CHANNEL_CODE, n(x.COST_PER_SEND_AUD)]));
  const gs: Group[] = groups.map((g) => {
    const k = cellKey(g.RECENCY_BAND, g.REL, g.GRIEV);
    const reach: ChannelCode[] = [];
    if (g.EMAIL_OPT_IN) reach.push("EMAIL");
    if (g.SMS_OPT_IN) reach.push("SMS");
    if (g.PUSH_ENABLED) reach.push("PUSH");
    reach.push("PAID_SOCIAL", "IN_STORE");
    return { key: `${k}|${g.EMAIL_OPT_IN ? 1 : 0}${g.SMS_OPT_IN ? 1 : 0}${g.PUSH_ENABLED ? 1 : 0}`, n: n(g.N), liftPp: quadrantForCell(cells, k).liftPp, reachable: reach };
  });
  const offerCost = n(c.OFFER_COST_PER_REDEMPTION) * 0.7;
  const aov = { "Nappies & Wipes": 48, "Car Seats": 455, Feeding: 95, "Prams & Strollers": 1180, Clothing: 62 }[String(c.PROMOTED_CATEGORY)] ?? 85;
  const budget = Math.max(0, Number(b.budget ?? c.BUDGET_AUD) || 0);
  const plan = planChannels({ groups: gs, allowed, costPerSend: cost, channelFactor: channelFactors(chLift), marginPerConversion: aov * 0.4,
    offerCostPerConversion: offerCost, budgetAud: budget, sendsPerMember: 1 });
  await tx(async (run) => {
    await run(`DELETE FROM ${S}.CHANNEL_PLAN WHERE CAMPAIGN_ID = ?`, [cid]);
    for (const ch of plan.byChannel) {
      await run(`INSERT INTO ${S}.CHANNEL_PLAN SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}`,
        [cid, ch.channel, Math.round(ch.members), Math.round(ch.cost * 100) / 100, Math.round(ch.incConv * 100) / 100, Math.round(ch.incMargin * 100) / 100,
          ch.channel === "SMS" ? "Thursday" : "Tuesday", ch.channel === "SMS" ? 18 : 10,
          `Expected incremental margin net of cost was highest on ${ch.channel} for these members.`, user]);
    }
    for (const a of plan.assignments) {
      const [band, rel, griev, cons] = a.key.split("|");
      await run(`UPDATE ${S}.AUDIENCE_MEMBER am SET CHANNEL_CODE = ?
                 FROM ${S}.CUSTOMER_CONTACT ct
                 WHERE ct.CUSTOMER_KEY = am.CUSTOMER_KEY AND am.CAMPAIGN_ID = ? AND am.RECENCY_BAND = ?
                   AND COALESCE(am.IS_RELEVANT, FALSE) = ? AND (COALESCE(am.NEG_VOICE_120D, 0) > 0 AND am.NEG_THEME IN ('Price and value', 'Promotions and offers')) = ?
                   AND ct.EMAIL_OPT_IN = ? AND ct.SMS_OPT_IN = ? AND ct.PUSH_ENABLED = ?`,
        [a.channel, cid, band, rel === "1", griev === "1", cons[0] === "1", cons[1] === "1", cons[2] === "1"]);
    }
  });
  return { ok: true, plan };
}

async function gatesFor(cid: string, c: Awaited<ReturnType<typeof context>>) {
  const t = c.members.filter((m) => m.GROUP_CODE === "TREATED");
  const h = c.members.filter((m) => m.GROUP_CODE === "HOLDOUT");
  const [cost, fat, stock] = await batch([
    { sql: `SELECT SUM(COST_AUD) AS C FROM ${S}.CHANNEL_PLAN WHERE CAMPAIGN_ID = ?`, binds: [cid] },
    { sql: `SELECT COUNT(*) AS N FROM ${S}.AUDIENCE_MEMBER am
            JOIN (SELECT CUSTOMER_KEY, COUNT(*) AS K FROM ${S}.CAMPAIGN_EVENT WHERE EVENT_TYPE = 'SEND' AND EVENT_DATE > DATEADD('day', -30, ${S}.CMP_AS_OF()) GROUP BY 1) e
              ON e.CUSTOMER_KEY = am.CUSTOMER_KEY
            WHERE am.CAMPAIGN_ID = ? AND am.GROUP_CODE = 'TREATED'
              AND e.K >= (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'MAX_CONTACTS_30D')`, binds: [cid] },
    { sql: `SELECT COUNT(*) AS N FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED'
            AND COALESCE(STOCK_CONFLICT, FALSE) AND SUPPRESSED_AT IS NULL`, binds: [cid] },
  ]);
  return launchGates({
    audienceLocked: c.members.length > 0, treated: t.reduce((a, x) => a + n(x.N), 0), holdout: h.reduce((a, x) => a + n(x.N), 0),
    variantsApproved: c.variants.filter((v) => v.STATUS === "APPROVED").length, variantsBlocked: c.variants.filter((v) => v.QA_STATUS === "BLOCK").length,
    channelPlanned: c.plan.length > 0, plannedCostAud: n(cost[0]?.C), budgetAud: n(c.camp.BUDGET_AUD),
    stockConflicts: t.reduce((a, x) => a + n(x.STOCK_CONFLICT_N), 0) > 0 ? n(stock[0]?.N) : 0,
    fatigueBreaches: n(fat[0]?.N),
  });
}

/** Launch: every gate must pass. Schedules the campaign from its start date; the
 *  simulator moves it to LIVE when fast-forwarded past the start. */
export async function launch(body: unknown, user: string) {
  const cid = id((body as { campaignId?: string })?.campaignId);
  const c = await context(cid);
  if (c.camp.STATUS !== "CONTENT_APPROVED") throw new CmpError(409, `A campaign launches from CONTENT_APPROVED; this one is ${String(c.camp.STATUS)}.`);
  const gates = await gatesFor(cid, c);
  const failed = gates.filter((g) => !g.pass);
  if (failed.length) throw new CmpError(409, `Not ready to launch: ${failed.map((g) => `${g.label} (${g.detail})`).join("; ")}.`);
  const asOf = isoDate((await q(SQL.SQL_AS_OF))[0]?.AS_OF) ?? "2026-05-07";
  await tx(async (run) => {
    // A start date in the past of the demo clock moves to the day after it, so
    // the simulated sends never land before "today".
    await run(`UPDATE ${S}.CAMPAIGN SET STATUS = 'SCHEDULED',
                 START_DATE = GREATEST(COALESCE(START_DATE, DATEADD('day', 1, ?::DATE)), DATEADD('day', 1, ?::DATE)),
                 END_DATE = GREATEST(COALESCE(END_DATE, DATEADD('day', 28, ?::DATE)), DATEADD('day', 14, GREATEST(COALESCE(START_DATE, ?::DATE), ?::DATE))),
                 SIMULATED_THROUGH = NULL, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [asOf, asOf, asOf, asOf, asOf, user, cid]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, 'CONTENT_APPROVED', 'SCHEDULED', 'All launch gates passed; sends scheduled to Braze (simulated).', ?, ${NOW}`, [cid, user]);
  });
  return { ok: true };
}
