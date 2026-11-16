// ─── Campaign & CRM: overview, settings and offers ───────────────────────────

import { S } from "../schema";
import { batch, q, tx, CmpError, NOW, type Row } from "../db";
import * as SQL from "../sql";
import { loadPortfolio } from "../measure";
import { MODELS } from "../config";
import { computeFindings, SURFACES, type Surface } from "../findings";

export async function getOverview() {
  const [{ campaigns, settings, asOf }, learnings] = await Promise.all([loadPortfolio(), q(SQL.SQL_LEARNINGS)]);
  return { asOf, settings, campaigns, alerts: campaigns.flatMap((c) => c.alerts), learnings: learnings.slice(0, 6) };
}

export async function getSettings() {
  const [settings, usage, quality, cost] = await batch([SQL.SQL_SETTINGS, SQL.SQL_AI_USAGE, SQL.SQL_ENRICH_QUALITY, SQL.SQL_ENRICH_COST]);
  return { settings, usage, quality: quality[0] ?? null, enrichCost: cost[0] ?? null, models: MODELS };
}

const EDITABLE: Record<string, (v: string) => boolean> = {
  HOLDOUT_PCT: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= 2 && Number(v) <= 50,
  FATIGUE_DAYS: (v) => /^\d+$/.test(v) && Number(v) <= 90,
  MAX_CONTACTS_30D: (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 20,
  BOUNCE_ALERT_PCT: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 50,
  UNSUB_ALERT_PCT: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 50,
  COMPLAINT_ALERT_PCT: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 50,
  PACING_ALERT_PTS: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 100,
  NEG_REPLY_ALERT_PCT: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 100,
  MIN_ARM_FOR_LEARNING: (v) => /^\d+$/.test(v) && Number(v) <= 100000,
  DEFAULT_MODEL: (v) => (MODELS as readonly string[]).includes(v),
};

export async function postSettings(body: unknown, user: string) {
  const b = (body ?? {}) as { key?: string; value?: string };
  const key = String(b.key ?? "");
  const value = String(b.value ?? "").trim();
  // AS_OF_DATE is the demo clock: every feature and history row was built
  // against it, so it changes only with a data redeploy.
  if (!Object.hasOwn(EDITABLE, key)) throw new CmpError(403, `'${key}' cannot be changed here.`);
  if (!EDITABLE[key](value)) throw new CmpError(400, `'${value}' is not a valid value for ${key}.`);
  await tx([{ sql: `UPDATE ${S}.CMP_SETTING SET SETTING_VALUE = ?, UPDATED_BY = ?, UPDATED_AT = ${NOW} WHERE SETTING_KEY = ?`, binds: [value, user, key] }]);
  return { ok: true };
}

export async function getOffers() {
  const [offers, channels, usage] = await batch([
    SQL.SQL_OFFERS, SQL.SQL_CHANNELS,
    `SELECT c.OFFER_ID, COUNT(DISTINCT c.CAMPAIGN_ID) AS CAMPAIGNS,
            COUNT_IF(e.EVENT_TYPE = 'CONVERT' AND e.GROUP_CODE = 'TREATED' AND e.OFFER_COST_AUD > 0) AS REDEMPTIONS,
            SUM(COALESCE(e.OFFER_COST_AUD, 0)) AS OFFER_COST
     FROM ${S}.CAMPAIGN c LEFT JOIN ${S}.CAMPAIGN_EVENT e ON e.CAMPAIGN_ID = c.CAMPAIGN_ID
     WHERE c.OFFER_ID IS NOT NULL GROUP BY 1`,
  ]);
  return { offers, channels, usage };
}

/** Headline findings for a screen, computed (../findings.ts). */
export async function getFindings(surfaceRaw: string | null) {
  const surface = String(surfaceRaw ?? "").toUpperCase();
  if (!(SURFACES as readonly string[]).includes(surface)) throw new CmpError(400, `No findings for '${surfaceRaw}'.`);
  const [{ campaigns, asOf }, learnings] = await Promise.all([
    loadPortfolio(),
    surface === "LEARNINGS" ? q(SQL.SQL_LEARNINGS) : Promise.resolve([] as Row[]),
  ]);
  return { surface, asOf, findings: computeFindings(surface as Surface, campaigns, learnings) };
}
