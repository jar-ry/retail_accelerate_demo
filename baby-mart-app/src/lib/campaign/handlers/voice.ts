// ─── Campaign & CRM: customer voice ──────────────────────────────────────────

import { S } from "../schema";
import { batch, q } from "../db";
import * as SQL from "../sql";
import { THEMES } from "../config";

export async function getVoice(state: string | null) {
  const [kpi, weekly, anomalies, heatmap, sources, intent, quality, cost, praise, brands] = await batch([
    SQL.SQL_VOICE_KPI, SQL.SQL_VOICE_WEEKLY, SQL.SQL_VOICE_ANOMALIES, SQL.SQL_VOICE_HEATMAP, SQL.SQL_VOICE_SOURCES,
    SQL.SQL_SIGNAL_INTENT, SQL.SQL_ENRICH_QUALITY, SQL.SQL_ENRICH_COST, SQL.SQL_SIGNAL_PRAISE, SQL.SQL_SIGNAL_BRAND_VOICE,
  ]);
  return {
    kpi: kpi[0] ?? {}, weekly: state ? weekly.filter((w) => w.STATE === state) : weekly, anomalies, heatmap, sources, intent,
    quality: quality[0] ?? null, enrichCost: cost[0] ?? null, praise, brands,
  };
}

const SOURCES = ["SURVEY", "REVIEW", "CARE", "SOCIAL", "REPLY"];
const SENTIMENTS = ["positive", "negative", "neutral", "mixed"];
const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

/** The verbatim explorer: free-text search plus filters, every value bound.
 *  Text search is ILIKE on the verbatim and the AI summary. */
export async function searchVoice(params: URLSearchParams) {
  const where: string[] = ["VOICE_TEXT IS NOT NULL", `EVENT_DATE <= ${S}.CMP_AS_OF()`];
  const binds: unknown[] = [];
  const text = (params.get("q") ?? "").trim().slice(0, 100);
  if (text) { where.push("(VOICE_TEXT ILIKE ? OR SUMMARY ILIKE ?)"); binds.push(`%${text}%`, `%${text}%`); }
  const pick = (k: string, allowed: readonly string[], col: string) => {
    const v = params.get(k);
    if (v && allowed.includes(v)) { where.push(`${col} = ?`); binds.push(v); }
  };
  pick("source", SOURCES, "SOURCE");
  pick("sentiment", SENTIMENTS, "SENTIMENT");
  pick("theme", THEMES, "THEME");
  pick("state", STATES, "STATE");
  const brand = params.get("brand");
  if (brand && /^[\w +&'.-]{1,40}$/.test(brand)) { where.push("BRAND_NAME = ?"); binds.push(brand); }
  const campaign = params.get("campaign");
  if (campaign && /^[\w-]{1,40}$/.test(campaign)) { where.push("CAMPAIGN_ID = ?"); binds.push(campaign); }
  const rows = await q(
    `SELECT VOICE_ID, SOURCE, EVENT_DATE, STATE, STORE_NAME, BRAND_NAME, CATEGORY, CAMPAIGN_ID, NPS_SCORE, STAR_RATING, VOICE_TEXT,
            SENTIMENT, SENTIMENT_SCORE, THEME, CHILD_STAGE_MENTIONED, PURCHASE_INTENT, URGENCY, SUMMARY, SEGMENT_NAME, PROVENANCE
     FROM ${S}.VW_CUSTOMER_VOICE WHERE ${where.join(" AND ")}
     ORDER BY EVENT_DATE DESC, VOICE_ID LIMIT 60`, binds);
  const counts = await q(`SELECT COUNT(*) AS N FROM ${S}.VW_CUSTOMER_VOICE WHERE ${where.join(" AND ")}`, binds);
  return { rows, total: Number(counts[0]?.N ?? 0) };
}
