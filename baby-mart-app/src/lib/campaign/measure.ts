// ─── Campaign & CRM: measurement, alerts and uplift (server only) ────────────
//
// Turns the raw counts in SQL_CAMPAIGN_METRICS into what a campaign manager reads:
// incremental conversions with a confidence interval, incremental revenue and
// margin net of send and offer cost, ROI, pacing, Campaign Health, and the open
// monitoring alerts with the action each one recommends.

import { batch, type Row } from "./db";
import * as SQL from "./sql";
import { lift, campaignHealth, shrunkCellLift, quadrantOf, type Cell } from "./stats";
import { toNum, isoDate } from "./format";

const n = (v: unknown) => toNum(v) ?? 0;

export type Settings = Record<string, string>;

export function settingsMap(rows: Row[]): Settings {
  const m: Settings = {};
  for (const r of rows) m[String(r.SETTING_KEY)] = String(r.SETTING_VALUE);
  return m;
}

export type Metrics = ReturnType<typeof metricsOf>;

export function metricsOf(r: Row, asOf: string) {
  const tn = n(r.TREATED_N), hn = n(r.HOLDOUT_N), tc = n(r.T_CONV), hc = n(r.H_CONV);
  const l = lift({ n: tn, conv: tc }, { n: hn, conv: hc });
  const revPerT = tn ? n(r.T_REVENUE) / tn : 0, revPerH = hn ? n(r.H_REVENUE) / hn : 0;
  const marPerT = tn ? n(r.T_MARGIN) / tn : 0, marPerH = hn ? n(r.H_MARGIN) / hn : 0;
  const incRevenue = hn ? (revPerT - revPerH) * tn : null;
  const incMargin = hn ? (marPerT - marPerH) * tn : null;
  const cost = n(r.SEND_COST) + n(r.OFFER_COST);
  const net = incMargin === null ? null : incMargin - cost;
  const start = isoDate(r.START_DATE), end = isoDate(r.END_DATE), through = isoDate(r.SIMULATED_THROUGH) ?? isoDate(r.LAST_EVENT);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  const windowDays = start && end ? days(start, end) : null;
  const elapsedDays = start && through ? Math.max(0, Math.min(windowDays ?? 0, days(start, through))) : 0;
  const elapsedShare = windowDays ? elapsedDays / windowDays : null;
  const budget = n(r.BUDGET_AUD);
  const spendShare = budget ? cost / budget : null;
  const delivered = n(r.DELIVERED), sends = n(r.SENDS);
  return {
    campaignId: String(r.CAMPAIGN_ID), name: String(r.NAME), status: String(r.STATUS), provenance: String(r.PROVENANCE),
    eventProvenance: r.EVENT_PROVENANCE ? String(r.EVENT_PROVENANCE) : null,
    start, end, through, asOf, windowDays, elapsedDays, elapsedShare,
    promotedCategory: r.PROMOTED_CATEGORY ?? null, promotedBrand: r.PROMOTED_BRAND ?? null, channels: r.CHANNELS,
    treated: tn, holdout: hn, treatedConv: tc, holdoutConv: hc,
    treatedRate: l.treatedRate, holdoutRate: l.holdoutRate, liftPp: l.liftPp, ciLowPp: l.ciLowPp, ciHighPp: l.ciHighPp,
    significant: l.significant, incrementalConv: l.incremental,
    reportedRevenue: n(r.T_REVENUE), incRevenue, incMargin, sendCost: n(r.SEND_COST), offerCost: n(r.OFFER_COST), cost, net,
    roi: net !== null && cost > 0 ? net / cost : null,
    costPerIncConv: l.incremental && l.incremental > 0 ? cost / l.incremental : null,
    budget, spendShare, pacingGapPts: spendShare !== null && elapsedShare !== null && elapsedShare > 0 ? (spendShare - elapsedShare) * 100 : null,
    sends, delivered, bounces: n(r.BOUNCES), openers: n(r.OPENERS), clickers: n(r.CLICKERS), unsubs: n(r.UNSUBS),
    complaints: n(r.COMPLAINTS), replies: n(r.REPLIES), stockConflict: n(r.STOCK_CONFLICT_N),
    bounceRate: sends ? n(r.BOUNCES) / sends : null,
    unsubRate: delivered ? n(r.UNSUBS) / delivered : null,
    complaintRate: delivered ? n(r.COMPLAINTS) / delivered : null,
  };
}

export type Alert = {
  campaignId: string; campaignName: string; code: string; severity: "HIGH" | "MEDIUM" | "LOW";
  message: string; action: string; actionKey: "PAUSE" | "SUPPRESS_STOCK" | "SUPPRESS_GRIEVANCE" | "INVESTIGATE" | null;
  status: "OPEN" | "ACTIONED" | "DISMISSED"; actionTaken?: string | null; actionedBy?: string | null;
};

const pc = (x: number) => `${(x * 100).toFixed(2)}%`;

/** The monitoring rules, evaluated live against a live or paused campaign. */
export function alertsFor(m: Metrics, s: Settings, negReplyShare: number | null, grievanceTreated: number, log: Row[]): Alert[] {
  if (!["LIVE", "PAUSED", "SCHEDULED"].includes(m.status) || m.sends === 0) return [];
  const out: Alert[] = [];
  const t = (k: string, d: number) => (Number(s[k]) || d) / 100;
  const base = { campaignId: m.campaignId, campaignName: m.name };
  if (m.stockConflict > 0 && m.promotedBrand) {
    out.push({ ...base, code: "STOCK_CONFLICT", severity: "HIGH",
      message: `${m.stockConflict.toLocaleString("en-AU")} treated members shop at a store that is short of ${String(m.promotedBrand)}.`,
      action: `Stop contacting them: suppress members whose home store is short, and ask Supply about an emergency order.`,
      actionKey: "SUPPRESS_STOCK", status: "OPEN" });
  }
  if (m.unsubRate !== null && m.unsubRate > t("UNSUB_ALERT_PCT", 0.8)) {
    out.push({ ...base, code: "UNSUBSCRIBES", severity: "HIGH",
      message: `Unsubscribes at ${pc(m.unsubRate)} of delivered sends, above the ${s.UNSUB_ALERT_PCT ?? "0.8"}% limit.`,
      action: grievanceTreated > 0 ? `${grievanceTreated.toLocaleString("en-AU")} treated members had complained about price: suppress them.` : "Pause and review the audience.",
      actionKey: grievanceTreated > 0 ? "SUPPRESS_GRIEVANCE" : "PAUSE", status: "OPEN" });
  }
  if (m.complaintRate !== null && m.complaintRate > t("COMPLAINT_ALERT_PCT", 0.2)) {
    out.push({ ...base, code: "COMPLAINTS", severity: "HIGH",
      message: `Complaints at ${pc(m.complaintRate)} of delivered sends, above the ${s.COMPLAINT_ALERT_PCT ?? "0.2"}% limit. Mailbox providers penalise senders from about here.`,
      action: "Pause the campaign and find the members complaining.", actionKey: "PAUSE", status: "OPEN" });
  }
  if (m.bounceRate !== null && m.bounceRate > t("BOUNCE_ALERT_PCT", 3)) {
    out.push({ ...base, code: "BOUNCES", severity: "MEDIUM", message: `Bounces at ${pc(m.bounceRate)} of sends.`,
      action: "Clean the list before the next send.", actionKey: null, status: "OPEN" });
  }
  if (negReplyShare !== null && negReplyShare * 100 > (Number(s.NEG_REPLY_ALERT_PCT) || 35) && m.replies >= 10) {
    out.push({ ...base, code: "REPLY_BACKLASH", severity: "MEDIUM",
      message: `${Math.round(negReplyShare * 100)}% of ${m.replies} replies are negative.`,
      action: "Investigate what the replies are about.", actionKey: "INVESTIGATE", status: "OPEN" });
  }
  if (m.pacingGapPts !== null && m.pacingGapPts > (Number(s.PACING_ALERT_PTS) || 15)) {
    out.push({ ...base, code: "PACING", severity: "MEDIUM",
      message: `Spend is ${Math.round(m.pacingGapPts)} points ahead of the time elapsed.`, action: "Pause or cap remaining sends.", actionKey: "PAUSE", status: "OPEN" });
  }
  if (m.elapsedDays >= 7 && m.liftPp !== null && m.liftPp <= 0 && m.holdout >= 100) {
    out.push({ ...base, code: "NO_LIFT", severity: m.ciHighPp !== null && m.ciHighPp < 0 ? "HIGH" : "MEDIUM",
      message: `No lift over the holdout after ${m.elapsedDays} days (${m.liftPp.toFixed(2)} pts).`,
      action: "Investigate before spending the rest of the budget.", actionKey: "INVESTIGATE", status: "OPEN" });
  }
  // Overlay what a person already did about each one.
  return out.map((a) => {
    const l = log.find((x) => x.CAMPAIGN_ID === a.campaignId && x.ALERT_CODE === a.code);
    return l ? { ...a, status: String(l.STATUS) as Alert["status"], actionTaken: (l.ACTION_TAKEN as string) ?? null, actionedBy: (l.ACTIONED_BY as string) ?? null } : a;
  });
}

export function healthOf(m: Metrics, negReplyShare: number | null) {
  return campaignHealth({ liftPp: m.liftPp, significant: m.significant, pacingGapPts: m.pacingGapPts, bounceRate: m.bounceRate,
    unsubRate: m.unsubRate, complaintRate: m.complaintRate, negativeReplyShare: negReplyShare });
}

/** Everything the overview, performance and alerts need, in one batch. */
export async function loadPortfolio() {
  const [metrics, settings, asOf, replyShare, alertLog, grievance] = await batch([
    SQL.SQL_CAMPAIGN_METRICS, SQL.SQL_SETTINGS, SQL.SQL_AS_OF,
    SQL.SQL_REPLY_SHARE_ALL, SQL.SQL_ALL_ALERT_LOG, SQL.SQL_GRIEVANCE_TREATED,
  ]);
  const s = settingsMap(settings);
  const asOfDate = isoDate(asOf[0]?.AS_OF) ?? "2026-05-07";
  const share = new Map(replyShare.map((r) => [String(r.CAMPAIGN_ID), n(r.REPLIES) ? n(r.NEGATIVE) / n(r.REPLIES) : null]));
  const griev = new Map(grievance.map((r) => [String(r.CAMPAIGN_ID), n(r.N)]));
  const campaigns = metrics.map((r) => {
    const m = metricsOf(r, asOfDate);
    const neg = share.get(m.campaignId) ?? null;
    return { ...m, negReplyShare: neg, health: m.sends ? healthOf(m, neg) : null,
      alerts: alertsFor(m, s, neg, griev.get(m.campaignId) ?? 0, alertLog) };
  });
  return { campaigns, settings: s, asOf: asOfDate };
}

// ─── Uplift cells ────────────────────────────────────────────────────────────
export type UpliftCells = Map<string, { liftPp: number; holdoutRate: number; weight: number; n: number }>;
export const cellKey = (band: unknown, rel: unknown, griev: unknown) => `${String(band)}|${rel === true ? "1" : "0"}|${griev === true ? "1" : "0"}`;

export function cellsFrom(rows: Row[]): UpliftCells {
  const cells: Cell[] = rows.map((r) => ({
    key: cellKey(r.RECENCY_BAND, r.REL, r.GRIEV),
    treated: { n: n(r.TN), conv: n(r.TC) }, holdout: { n: n(r.HN), conv: n(r.HC) },
  }));
  return shrunkCellLift(cells);
}

export function quadrantForCell(cells: UpliftCells, key: string) {
  const c = cells.get(key);
  if (!c) return { quadrant: "LOST_CAUSE" as const, liftPp: 0, holdoutRate: 0 };
  return { quadrant: quadrantOf(c.liftPp, c.holdoutRate), liftPp: c.liftPp, holdoutRate: c.holdoutRate };
}

/** Channel factors relative to the pooled lift, clamped so one noisy channel
 *  cannot dominate the plan. */
export function channelFactors(rows: Row[]): Record<string, number> {
  const tot = rows.reduce<{ tn: number; tc: number; hn: number; hc: number }>((a, r) => ({ tn: a.tn + n(r.TN), tc: a.tc + n(r.TC), hn: a.hn + n(r.HN), hc: a.hc + n(r.HC) }), { tn: 0, tc: 0, hn: 0, hc: 0 });
  const pooled = tot.tn && tot.hn ? tot.tc / tot.tn - tot.hc / tot.hn : 0;
  const out: Record<string, number> = { EMAIL: 1, SMS: 1.3, PUSH: 0.7, PAID_SOCIAL: 0.4, IN_STORE: 0.2 };
  if (pooled <= 0) return out;
  for (const r of rows) {
    const l = n(r.TN) && n(r.HN) ? n(r.TC) / n(r.TN) - n(r.HC) / n(r.HN) : null;
    if (l !== null && n(r.HN) >= 300) out[String(r.CHANNEL_CODE)] = Math.max(0.1, Math.min(2.5, l / pooled));
  }
  return out;
}
