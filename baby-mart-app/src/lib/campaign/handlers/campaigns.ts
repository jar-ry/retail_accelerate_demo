// ─── Campaign & CRM: campaigns, performance and the investigator ─────────────

import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { loadPortfolio, metricsOf, settingsMap, alertsFor, healthOf } from "../measure";
import { lift, pValue } from "../stats";
import { canTransition } from "../state";
import { STATUSES, type Status } from "../config";
import { toNum, isoDate } from "../format";

const n = (v: unknown) => toNum(v) ?? 0;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function id(v: unknown): string {
  const s = String(v ?? "");
  if (!ID.test(s)) throw new CmpError(400, "Missing or malformed campaign id.");
  return s;
}

export async function getCampaigns() {
  const { campaigns, asOf } = await loadPortfolio();
  return { campaigns, asOf };
}

function liftRows(rows: Row[]) {
  return rows.map((r) => {
    const l = lift({ n: n(r.TN), conv: n(r.TC) }, { n: n(r.HN), conv: n(r.HC) });
    return { dim: String(r.DIM), value: String(r.VAL), treated: n(r.TN), holdout: n(r.HN), treatedRate: l.treatedRate, holdoutRate: l.holdoutRate,
      liftPp: l.liftPp, ciLowPp: l.ciLowPp, ciHighPp: l.ciHighPp, significant: l.significant, incremental: l.incremental };
  });
}

export async function getCampaign(campaignIdRaw: string | null) {
  const campaignId = id(campaignIdRaw);
  const [camp, log, liftBy, ab, daily, replies, samples, content, plan, audiences, members, stock, alertLog, metricsAll, settings, asOf, griev] = await batch([
    { sql: SQL.SQL_CAMPAIGN, binds: [campaignId] },
    { sql: SQL.SQL_STATUS_LOG, binds: [campaignId] },
    { sql: SQL.SQL_LIFT_BY, binds: [campaignId, campaignId] },
    { sql: SQL.SQL_VARIANTS_AB, binds: [campaignId, campaignId] },
    { sql: SQL.SQL_DAILY, binds: [campaignId, campaignId] },
    { sql: SQL.SQL_REPLIES, binds: [campaignId] },
    { sql: SQL.SQL_REPLY_SAMPLES, binds: [campaignId] },
    { sql: SQL.SQL_CONTENT, binds: [campaignId] },
    { sql: SQL.SQL_CHANNEL_PLAN, binds: [campaignId] },
    { sql: SQL.SQL_AUDIENCE_OF, binds: [campaignId] },
    { sql: SQL.SQL_MEMBER_SUMMARY, binds: [campaignId] },
    { sql: SQL.SQL_CAMPAIGN_STOCK, binds: [campaignId] },
    { sql: SQL.SQL_ALERT_LOG, binds: [campaignId] },
    SQL.SQL_CAMPAIGN_METRICS, SQL.SQL_SETTINGS, SQL.SQL_AS_OF,
    { sql: `SELECT COUNT(*) AS N FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' AND SUPPRESSED_AT IS NULL
            AND COALESCE(NEG_VOICE_120D, 0) > 0 AND NEG_THEME IN ('Price and value', 'Promotions and offers')`, binds: [campaignId] },
  ]);
  if (!camp.length) throw new CmpError(404, `No campaign ${campaignId}.`);
  const mRow = metricsAll.find((r) => r.CAMPAIGN_ID === campaignId)!;
  const m = metricsOf(mRow, isoDate(asOf[0]?.AS_OF) ?? "2026-05-07");
  const totReplies = replies.reduce((a, r) => a + n(r.N), 0);
  const negReplies = replies.filter((r) => r.SENTIMENT === "negative" || r.SENTIMENT === "mixed").reduce((a, r) => a + n(r.N), 0);
  const negShare = totReplies ? negReplies / totReplies : null;
  const s = settingsMap(settings);
  const a = ab.find((x) => x.VARIANT_CODE === "A"), b = ab.find((x) => x.VARIANT_CODE === "B");
  const abTest = a && b ? (() => { const l = lift({ n: n(b.N), conv: n(b.CONV) }, { n: n(a.N), conv: n(a.CONV) }); return { a: { n: n(a.N), conv: n(a.CONV) }, b: { n: n(b.N), conv: n(b.CONV) }, bMinusAPp: l.liftPp, ciLowPp: l.ciLowPp, ciHighPp: l.ciHighPp, significant: l.significant, p: pValue(l.z) }; })() : null;
  return {
    campaign: camp[0], log, metrics: m, health: m.sends ? healthOf(m, negShare) : null,
    alerts: alertsFor(m, s, negShare, n(griev[0]?.N), alertLog), alertLog,
    liftBy: liftRows(liftBy), abTest, daily, replies, replySamples: samples, negReplyShare: negShare,
    content, plan, audiences, members, stock, settings: s,
  };
}

// ─── Briefs and lifecycle ────────────────────────────────────────────────────

export async function saveBrief(body: unknown, user: string) {
  const b = (body ?? {}) as Record<string, unknown>;
  const txt = (k: string, max: number) => (b[k] === undefined || b[k] === null || b[k] === "" ? null : String(b[k]).slice(0, max));
  const name = txt("name", 200);
  if (!name) throw new CmpError(400, "A campaign needs a name.");
  const iso = (k: string) => { const v = txt(k, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new CmpError(400, `${k} must be YYYY-MM-DD.`); return v; };
  const start = iso("startDate"), end = iso("endDate");
  if (start && end && end < start) throw new CmpError(400, "The end date is before the start date.");
  const budget = Math.max(0, Number(b.budget ?? 0) || 0);
  const channels = Array.isArray(b.channels) ? (b.channels as string[]).filter((c) => ["EMAIL", "SMS", "PUSH", "PAID_SOCIAL", "IN_STORE"].includes(c)) : ["EMAIL"];
  const fields = [name, txt("objective", 500), txt("hypothesis", 800), txt("category", 60), txt("className", 60), txt("brand", 60), txt("offerId", 20),
    JSON.stringify(channels), budget, start, end];
  if (b.campaignId) {
    const cid = id(b.campaignId);
    const cur = await q(`SELECT STATUS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [cid]);
    if (!cur.length) throw new CmpError(404, "No such campaign.");
    if (!["IDEA", "BRIEF"].includes(String(cur[0].STATUS))) throw new CmpError(409, "The brief is fixed once the audience is locked. Unlock it first.");
    await q(`UPDATE ${S}.CAMPAIGN SET NAME = ?, OBJECTIVE = ?, HYPOTHESIS = ?, PROMOTED_CATEGORY = ?, PROMOTED_CLASS = ?, PROMOTED_BRAND = ?, OFFER_ID = ?,
               CHANNELS = PARSE_JSON(?), BUDGET_AUD = ?, START_DATE = ?::DATE, END_DATE = ?::DATE, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`,
      [...fields, user, cid]);
    return { ok: true, campaignId: cid };
  }
  const cid = `camp-${Date.now().toString(36)}`;
  await tx(async (run) => {
    await run(`INSERT INTO ${S}.CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, OFFER_ID,
                 CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, PROVENANCE, CREATED_BY, CREATED_AT)
               SELECT ?, ?, ?, ?, 'BRIEF', ?, ?, ?, ?, PARSE_JSON(?), ?, ?::DATE, ?::DATE,
                      (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'HOLDOUT_PCT'), 'APP', ?, ${NOW}`,
      [cid, ...fields, user]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, NULL, 'BRIEF', 'Brief created.', ?, ${NOW}`, [cid, user]);
  });
  return { ok: true, campaignId: cid };
}

/** Any lifecycle move a person makes, checked against the state machine and
 *  written with its audit row. Unlocking discards the frozen members. */
export async function transition(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; to?: string; reason?: string };
  const cid = id(b.campaignId);
  const to = String(b.to ?? "") as Status;
  if (!(STATUSES as readonly string[]).includes(to)) throw new CmpError(400, `'${to}' is not a campaign status.`);
  const reason = String(b.reason ?? "").trim().slice(0, 500);
  return tx(async (run) => {
    const cur = await run(`SELECT STATUS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [cid]);
    if (!cur.length) throw new CmpError(404, "No such campaign.");
    const from = String(cur[0].STATUS) as Status;
    if (!canTransition(from, to)) throw new CmpError(409, `A campaign cannot go from ${from} to ${to}.`);
    if (["PAUSED", "CANCELLED"].includes(to) && reason.length < 5) throw new CmpError(400, "Say why: the reason goes in the audit trail.");
    if (from === "AUDIENCE_LOCKED" && to === "BRIEF") {
      await run(`DELETE FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ?`, [cid]);
      await run(`UPDATE ${S}.AUDIENCE SET STATUS = 'DRAFT', LOCKED_BY = NULL, LOCKED_AT = NULL WHERE CAMPAIGN_ID = ? AND STATUS = 'LOCKED'`, [cid]);
    }
    await run(`UPDATE ${S}.CAMPAIGN SET STATUS = ?, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [to, user, cid]);
    await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, ?, ?, ?, ?, ${NOW}`, [cid, from, to, reason || null, user]);
    return { ok: true, from, to };
  });
}

/** Fast-forward a live or scheduled campaign through the simulator. */
export async function simulate(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; days?: number };
  const cid = id(b.campaignId);
  const days = Math.max(1, Math.min(60, Math.round(Number(b.days ?? 7)) || 7));
  const r = await q(`CALL ${S}.SIMULATE_CAMPAIGN(?, ?, ?)`, [cid, days, user]);
  const out = r[0] ? Object.values(r[0])[0] : null;
  const res = typeof out === "string" ? JSON.parse(out) : out;
  if (!res?.ok) throw new CmpError(409, String(res?.error ?? "The simulator did not run."));
  return res;
}

/** Act on an alert: pause, or suppress the members the alert is about from the
 *  day after the campaign's latest simulated day. Suppressed members stay TREATED
 *  for measurement -- intent to treat -- so lift is never flattered. */
export async function alertAction(body: unknown, user: string) {
  const b = (body ?? {}) as { campaignId?: string; code?: string; action?: string; note?: string };
  const cid = id(b.campaignId);
  const code = String(b.code ?? "").replace(/[^A-Z_]/g, "").slice(0, 40);
  const action = String(b.action ?? "");
  if (!["PAUSE", "SUPPRESS_STOCK", "SUPPRESS_GRIEVANCE", "DISMISS"].includes(action)) throw new CmpError(400, "Unknown action.");
  return tx(async (run) => {
    const c = await run(`SELECT STATUS, START_DATE, SIMULATED_THROUGH FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [cid]);
    if (!c.length) throw new CmpError(404, "No such campaign.");
    let taken = "Dismissed";
    if (action === "PAUSE") {
      if (!canTransition(c[0].STATUS as Status, "PAUSED")) throw new CmpError(409, `A ${String(c[0].STATUS)} campaign cannot be paused.`);
      await run(`UPDATE ${S}.CAMPAIGN SET STATUS = 'PAUSED', UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [user, cid]);
      await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, ?, 'PAUSED', ?, ?, ${NOW}`, [cid, c[0].STATUS, `Paused from alert ${code}.`, user]);
      taken = "Paused the campaign";
    } else if (action !== "DISMISS") {
      const cond = action === "SUPPRESS_STOCK" ? "COALESCE(STOCK_CONFLICT, FALSE)"
        : "COALESCE(NEG_VOICE_120D, 0) > 0 AND NEG_THEME IN ('Price and value', 'Promotions and offers')";
      const r = await run(
        `UPDATE ${S}.AUDIENCE_MEMBER SET SUPPRESSED_AT = DATEADD('day', 1, COALESCE(?::DATE, ?::DATE)),
                SUPPRESS_REASON = ?
         WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' AND SUPPRESSED_AT IS NULL AND ${cond}`,
        [isoDate(c[0].SIMULATED_THROUGH), isoDate(c[0].START_DATE), action === "SUPPRESS_STOCK" ? "Home store short of the promoted brand" : "Recent price complaint", cid]);
      const changed = n((r[0] as Row | undefined)?.["number of rows updated"]);
      taken = `Suppressed ${changed.toLocaleString("en-AU")} members (${action === "SUPPRESS_STOCK" ? "home store short" : "recent price complaint"})`;
    }
    const alertId = `${cid}-${code}`;
    await run(`DELETE FROM ${S}.ALERT_LOG WHERE ALERT_ID = ?`, [alertId]);
    await run(`INSERT INTO ${S}.ALERT_LOG SELECT ?, ?, ?, 'HIGH', ?, NULL, ?, ?, ?, ${NOW}, ${NOW}`,
      [alertId, cid, code, String(b.note ?? taken).slice(0, 500), action === "DISMISS" ? "DISMISSED" : "ACTIONED", taken, user]);
    return { ok: true, actionTaken: taken };
  });
}

// ─── The investigator ────────────────────────────────────────────────────────
//
// Evidence first, computed here: lift by every dimension, the stock position,
// overlapping campaigns, voice anomalies in the window, competitor price movement
// and the replies. The model is handed the results and must weigh at least three
// hypotheses, rule some out with the evidence, and name a root cause and actions.
// Every number it writes is checked against the evidence.

/** The latest investigation of a campaign by CAMPAIGN_INVESTIGATOR_AGENT, as the
 *  chat route logged it (src/lib/campaign/agent-log.ts). Runs from the earlier
 *  AI_COMPLETE investigator have a different shape and are not shown. */
export async function getInvestigation(campaignIdRaw: string | null) {
  const cid = id(campaignIdRaw);
  const r = await q(`SELECT RUN_ID, QUESTION, RESPONSE, IS_VERIFIED, UNVERIFIED_FIGURES, ERROR_MESSAGE, MODEL, GENERATED_BY, GENERATED_AT
    FROM ${S}.AI_RUN WHERE STAGE = 'INVESTIGATE' AND CAMPAIGN_ID = ? AND MODEL LIKE 'agent:%' ORDER BY GENERATED_AT DESC LIMIT 1`, [cid]);
  return { latest: r[0] ?? null };
}

// ─── Learnings ───────────────────────────────────────────────────────────────

/** Publish what a campaign taught: the overall lift and every dimension whose
 *  lift is significant with enough holdout. Statements are templated from the
 *  numbers, not written by a model, so they can be trusted in later prompts. */
export async function publishLearnings(body: unknown, user: string) {
  const cid = id((body as { campaignId?: string })?.campaignId);
  const d = await getCampaign(cid);
  const minArm = Number(d.settings.MIN_ARM_FOR_LEARNING) || 300;
  const m = d.metrics;
  if (m.holdout === 0) throw new CmpError(409, "This campaign has no holdout, so there is nothing to learn from it.");
  const rows: { dim: string; value: string; tn: number; hn: number; tr: number | null; hr: number | null; l: number | null; lo: number | null; hi: number | null; sig: boolean; inc: number | null; text: string }[] = [];
  const f = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} pts`);
  rows.push({ dim: "Overall", value: "All members", tn: m.treated, hn: m.holdout, tr: m.treatedRate, hr: m.holdoutRate, l: m.liftPp, lo: m.ciLowPp, hi: m.ciHighPp,
    sig: m.significant, inc: m.incRevenue,
    text: `${m.name}: ${f(m.liftPp)} lift over holdout (95% CI ${f(m.ciLowPp)} to ${f(m.ciHighPp)})${m.significant ? "" : ", not significant"}.` });
  for (const x of d.liftBy) {
    if (x.holdout < Math.min(minArm, 150) || !x.significant || x.dim === "Uplift quadrant") continue;
    rows.push({ dim: x.dim, value: x.value, tn: x.treated, hn: x.holdout, tr: x.treatedRate, hr: x.holdoutRate, l: x.liftPp, lo: x.ciLowPp, hi: x.ciHighPp,
      sig: true, inc: null,
      text: `${x.dim} = ${x.value}: ${f(x.liftPp)} lift (95% CI ${f(x.ciLowPp)} to ${f(x.ciHighPp)}) in ${m.name}${(x.liftPp ?? 0) < 0 ? " -- contact LOWERED conversion" : ""}.` });
  }
  await tx(async (run) => {
    await run(`DELETE FROM ${S}.LEARNING WHERE CAMPAIGN_ID = ?`, [cid]);
    let i = 0;
    for (const r of rows) {
      i++;
      await run(`INSERT INTO ${S}.LEARNING SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ${NOW}`,
        [`${cid}-L${i}`, cid, r.dim, r.value, r.tn, r.hn, r.tr, r.hr, r.l, r.lo, r.hi, r.sig, r.inc, r.text, user]);
    }
    const st = await run(`SELECT STATUS FROM ${S}.CAMPAIGN WHERE CAMPAIGN_ID = ?`, [cid]);
    if (st[0]?.STATUS === "COMPLETED") {
      await run(`UPDATE ${S}.CAMPAIGN SET STATUS = 'MEASURED', UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE CAMPAIGN_ID = ?`, [user, cid]);
      await run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, 'COMPLETED', 'MEASURED', 'Learnings published.', ?, ${NOW}`, [cid, user]);
    }
  });
  return { ok: true, published: rows.length };
}

export async function getLearnings() {
  const [learnings] = await batch([SQL.SQL_LEARNINGS]);
  return { learnings };
}
