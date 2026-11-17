// ─── OneDigital Campaign Manager: audience compiler and sizing (pure) ────────
//
// The audience SQL and the arithmetic over its counts, with no database access:
// callers run the statements and hand the rows back. The app runs them through
// its async driver (handlers/audiences.ts); the agents' tools run the very same
// functions inside a JavaScript stored procedure (tools.ts, bundled into od_45),
// so an audience the agent sizes is the audience the builder shows, by
// construction rather than by a parity test.

import { S } from "./schema";
import * as SQL from "./sql";
import { compileMatch, compileReach, compileSuppress, describeSpec, crossBannerFields, type AudienceSpec } from "./spec";
import { quadrantForCell, type UpliftCells } from "./measure";
import { QUADRANTS } from "./config";
import { toNum } from "./format";

type Row = Record<string, unknown>;
export type Stmt = { sql: string; binds: unknown[] };
const n = (v: unknown) => toNum(v) ?? 0;

const LOOKALIKE_FEATURES = ["COALESCE(RECENCY_DAYS, 730)", "LINES_12M", "SPEND_12M_AUD", "AOV_AUD", "PROMO_SHARE", "BUNNINGS_SPEND_12M",
  "KMART_SPEND_12M", "OW_SPEND_12M", "TRADE_CLASSES_90D", "SCHOOL_ITEMS_12M", "BIZ_STARTER_SCORE"];

/** The full audience as CTEs ending in `aud`: one row per matching customer, with
 *  TRACK and NEED (what they need from the promoted range), REACHABLE, each
 *  suppression flag, the uplift cell and FINAL (in the audience). */
export function audienceSql(sp: AudienceSpec, cells: UpliftCells): Stmt {
  const binds: unknown[] = [];
  const ctes: string[] = [];
  if (sp.lookalike) {
    const z = LOOKALIKE_FEATURES.map((f, i) => `(COALESCE(${f}, 0) - AVG(COALESCE(${f}, 0)) OVER ()) / NULLIF(STDDEV(COALESCE(${f}, 0)) OVER (), 0) AS Z${i}`);
    ctes.push(`lk_z AS (SELECT CUSTOMER_KEY, ${z.join(", ")} FROM ${S}.CUSTOMER_FEATURES WHERE LAST_PURCHASE_DATE IS NOT NULL)`);
    ctes.push(`lk_seed_keys AS (SELECT DISTINCT CUSTOMER_KEY FROM ${S}.CAMPAIGN_EVENT WHERE CAMPAIGN_ID = ? AND EVENT_TYPE = 'CONVERT' AND GROUP_CODE = 'TREATED')`);
    binds.push(sp.lookalike.seedCampaignId);
    ctes.push(`lk_seed AS (SELECT ${LOOKALIKE_FEATURES.map((_, i) => `AVG(COALESCE(Z${i}, 0)) AS C${i}`).join(", ")} FROM lk_z WHERE CUSTOMER_KEY IN (SELECT CUSTOMER_KEY FROM lk_seed_keys))`);
    const dot = LOOKALIKE_FEATURES.map((_, i) => `COALESCE(Z${i}, 0) * C${i}`).join(" + ");
    const nz = LOOKALIKE_FEATURES.map((_, i) => `COALESCE(Z${i}, 0) * COALESCE(Z${i}, 0)`).join(" + ");
    const nc = LOOKALIKE_FEATURES.map((_, i) => `C${i} * C${i}`).join(" + ");
    ctes.push(`lk AS (SELECT lk_z.CUSTOMER_KEY, (${dot}) / NULLIF(SQRT(${nz}) * SQRT(${nc}), 0) AS SIMILARITY FROM lk_z, lk_seed
      WHERE lk_z.CUSTOMER_KEY NOT IN (SELECT CUSTOMER_KEY FROM lk_seed_keys)
      QUALIFY ROW_NUMBER() OVER (ORDER BY SIMILARITY DESC NULLS LAST, lk_z.CUSTOMER_KEY) <= ?)`);
    binds.push(sp.lookalike.topN);
  }
  ctes.push(`c360 AS (${SQL.SQL_C360})`);
  const match = compileMatch(sp);
  binds.push(sp.promoted.category ?? "GENERAL");
  ctes.push(`m0 AS (SELECT c360.*, ${S}.CAMPAIGN_TRACK(?) AS TRACK
    FROM c360 WHERE ${match.where}${sp.lookalike ? " AND CUSTOMER_KEY IN (SELECT CUSTOMER_KEY FROM lk)" : ""})`);
  binds.push(...match.binds);
  ctes.push(`m AS (SELECT m0.*, ${SQL.NEED_EXPR} AS NEED, ${S}.IS_RELEVANT_STATE(NEED) AS RELEVANT FROM m0)`);
  const sup = compileSuppress(sp, `${S}.SUPPLY_POSITION`);
  const supCols = sup.map((x) => `COALESCE(${x.sql}, FALSE) AS S_${x.key.toUpperCase()}`);
  for (const x of sup) binds.push(...x.binds);
  // The stock conflict is recorded even when its suppression is switched off, so
  // a member sent to an empty shelf is never invisible.
  let stockCol = "FALSE AS STOCK_CONFLICT";
  if (sp.promoted.brand) {
    stockCol = `COALESCE(HOME_STORE_CODE, '-') IN (SELECT STORE_CODE FROM ${S}.SUPPLY_POSITION WHERE BRAND_NAME = ? AND STATUS = 'SHORT') AS STOCK_CONFLICT`;
    binds.push(sp.promoted.brand);
  }
  ctes.push(`s AS (SELECT m.*, ${compileReach(sp)} AS REACHABLE, TRACK || '|' || NEED AS CELL, NEED = 'NO_SIGNAL_COLD' AS COLD,
    ${[...supCols, stockCol].join(",\n    ")} FROM m)`);
  // Quadrants and expected lift by cell, from the history.
  const keys = [...cells.keys()];
  const caseLift = keys.length ? `CASE CELL ${keys.map(() => "WHEN ? THEN ?").join(" ")} ELSE 0 END` : "0";
  const caseBase = keys.length ? `CASE CELL ${keys.map(() => "WHEN ? THEN ?").join(" ")} ELSE 0 END` : "0";
  const caseQuad = keys.length ? `CASE CELL ${keys.map(() => "WHEN ? THEN ?").join(" ")} ELSE 'LOST_CAUSE' END` : "'LOST_CAUSE'";
  const anySup = sup.length ? sup.map((x) => `S_${x.key.toUpperCase()}`).join(" OR ") : "FALSE";
  let quadFilter = "TRUE";
  const quadBinds: unknown[] = [];
  if (sp.quadrants && sp.quadrants.length) {
    quadFilter = `QUADRANT IN (${sp.quadrants.map(() => "?").join(", ")})`;
    quadBinds.push(...sp.quadrants);
  }
  ctes.push(`u AS (SELECT s.*, ${caseLift} AS EXP_LIFT_PP, ${caseBase} AS EXP_BASE_RATE, ${caseQuad} AS QUADRANT FROM s)`);
  for (const k of keys) binds.push(k, quadrantForCell(cells, k).liftPp);
  for (const k of keys) binds.push(k, quadrantForCell(cells, k).holdoutRate);
  for (const k of keys) binds.push(k, quadrantForCell(cells, k).quadrant);
  ctes.push(`v AS (SELECT u.*, REACHABLE AND NOT (${anySup}) AND ${quadFilter} AS ELIGIBLE FROM u)`);
  binds.push(...quadBinds);
  // A cap keeps the eligible members with the highest expected lift.
  ctes.push(`aud AS (SELECT v.*, ELIGIBLE${sp.cap ? " AND RN_CAP <= ?" : ""} AS FINAL FROM (SELECT v.*, ROW_NUMBER() OVER (PARTITION BY ELIGIBLE ORDER BY EXP_LIFT_PP DESC, CUSTOMER_KEY) AS RN_CAP FROM v) v)`);
  if (sp.cap) binds.push(sp.cap);
  return { sql: `WITH ${ctes.join(",\n")}`, binds };
}

/** The three statements that size an audience: funnel, quadrants, composition. */
export function sizingStatements(sp: AudienceSpec, cells: UpliftCells): Stmt[] {
  const a = audienceSql(sp, cells);
  const supSums = compileSuppress(sp, "X").map((x) => `COUNT_IF(REACHABLE AND S_${x.key.toUpperCase()}) AS SUP_${x.key.toUpperCase()}`).join(", ");
  return [
    { sql: `${a.sql}
      SELECT COUNT(*) AS MATCHED, COUNT_IF(REACHABLE) AS CONSENTED, COUNT_IF(ELIGIBLE) AS ELIGIBLE, COUNT_IF(FINAL) AS FINAL,
             ${supSums ? supSums + "," : ""}
             COUNT_IF(FINAL AND STOCK_CONFLICT) AS FINAL_STOCK_CONFLICT,
             COUNT_IF(FINAL AND EMAIL_OPT_IN) AS FINAL_EMAIL, COUNT_IF(FINAL AND SMS_OPT_IN) AS FINAL_SMS, COUNT_IF(FINAL AND PUSH_ENABLED) AS FINAL_PUSH,
             SUM(IFF(FINAL, EXP_LIFT_PP, 0)) / 100 AS EXP_INC_CONV, AVG(IFF(FINAL, EXP_BASE_RATE, NULL)) AS EXP_BASE_RATE,
             AVG(IFF(FINAL, AOV_AUD, NULL)) AS AVG_AOV, COUNT_IF(FINAL AND COLD) AS FINAL_COLD,
             COUNT_IF(FINAL AND CONTACTS_30D > 0) AS FINAL_CONTACTED_30D, COUNT_IF(FINAL AND RELEVANT) AS FINAL_RELEVANT,
             COUNT_IF(FINAL AND STARTING_SCHOOL_LIKELY AND GROUP_DATA_CONSENT) AS FINAL_STARTING_SCHOOL,
             MIN(IFF(FINAL, DAYS_TO_SCHOOL_START, NULL)) AS FINAL_MIN_DAYS_TO_SCHOOL, MAX(IFF(FINAL, DAYS_TO_SCHOOL_START, NULL)) AS FINAL_MAX_DAYS_TO_SCHOOL
      FROM aud`, binds: a.binds },
    { sql: `${a.sql}
      SELECT QUADRANT, COUNT_IF(REACHABLE) AS CONSENTED, COUNT_IF(FINAL) AS FINAL, SUM(IFF(FINAL, EXP_LIFT_PP, 0)) / 100 AS EXP_INC_CONV,
             SUM(IFF(FINAL, EXP_BASE_RATE, 0)) AS EXP_BASE_CONV
      FROM aud GROUP BY 1`, binds: a.binds },
    { sql: `${a.sql}
      SELECT 'Need state' AS DIM, NEED AS VAL, COUNT(*) AS N FROM aud WHERE FINAL GROUP BY 2
      UNION ALL SELECT 'School signal', IFF(GROUP_DATA_CONSENT, SCHOOL_SIGNAL_CONFIDENCE, 'NOT_CONSENTED'), COUNT(*) FROM aud WHERE FINAL GROUP BY 2
      UNION ALL SELECT 'Trade', IFF(GROUP_DATA_CONSENT, TRADE_TYPE, NULL), COUNT(*) FROM aud WHERE FINAL AND BIZ_STARTER_FLAG GROUP BY 2
      UNION ALL SELECT 'Officeworks relationship', OW_RELATIONSHIP, COUNT(*) FROM aud WHERE FINAL GROUP BY 2
      UNION ALL SELECT 'Membership', LOYALTY_TIER, COUNT(*) FROM aud WHERE FINAL GROUP BY 2
      UNION ALL SELECT 'Home state', HOME_STATE, COUNT(*) FROM aud WHERE FINAL GROUP BY 2
      UNION ALL SELECT 'Last purchase', RECENCY_BAND, COUNT(*) FROM aud WHERE FINAL GROUP BY 2`, binds: a.binds },
  ];
}

export type Sizing = ReturnType<typeof sizingResult>;

/** The funnel from matched to final, what each rule removed, uplift quadrants,
 *  composition and Audience Health, from the rows of sizingStatements. */
export function sizingResult(sp: AudienceSpec, cells: UpliftCells, [funnel, quads, comp]: Row[][]) {
  const supKeys = compileSuppress(sp, "X").map((x) => ({ key: x.key, label: x.label }));
  const f = funnel[0] ?? {};
  const final = n(f.FINAL);
  const health = {
    reach: final,
    coldShare: final ? n(f.FINAL_COLD) / final : null,
    contacted30dShare: final ? n(f.FINAL_CONTACTED_30D) / final : null,
    relevantShare: final ? n(f.FINAL_RELEVANT) / final : null,
    expIncConv: n(f.EXP_INC_CONV),
    expBaseRate: toNum(f.EXP_BASE_RATE),
    avgAov: toNum(f.AVG_AOV),
  };
  // Health: 0-100 from how many need the range, how many are fresh to contact,
  // how few are cold contacts, and the expected lift per member.
  const healthScore = Math.round(
    25 * (health.relevantShare ?? 0) + 25 * (1 - (health.contacted30dShare ?? 0)) + 25 * (1 - Math.min(1, (health.coldShare ?? 0) * 2))
    + 25 * Math.min(1, final ? (health.expIncConv / final) * 100 / 3 : 0));
  // "Discount waste avoided": sure things the quadrant filter keeps out of an offer.
  const sure = quads.find((r) => r.QUADRANT === "SURE_THING");
  return {
    spec: sp, description: describeSpec(sp), crossBanner: crossBannerFields(sp),
    funnel: { matched: n(f.MATCHED), consented: n(f.CONSENTED), eligible: n(f.ELIGIBLE), final,
      suppressed: supKeys.map((x) => ({ ...x, n: n(f[`SUP_${x.key.toUpperCase()}`]) })),
      finalStockConflict: n(f.FINAL_STOCK_CONFLICT),
      channels: { EMAIL: n(f.FINAL_EMAIL), SMS: n(f.FINAL_SMS), PUSH: n(f.FINAL_PUSH) },
      startingSchool: n(f.FINAL_STARTING_SCHOOL),
      daysToSchool: f.FINAL_MIN_DAYS_TO_SCHOOL === null || f.FINAL_MIN_DAYS_TO_SCHOOL === undefined ? null
        : { min: n(f.FINAL_MIN_DAYS_TO_SCHOOL), max: n(f.FINAL_MAX_DAYS_TO_SCHOOL) } },
    quadrants: QUADRANTS.map((qd) => {
      const r = quads.find((x) => x.QUADRANT === qd);
      return { quadrant: qd, consented: n(r?.CONSENTED), final: n(r?.FINAL), expIncConv: n(r?.EXP_INC_CONV), expBaseConv: n(r?.EXP_BASE_CONV) };
    }),
    sureThingsExcluded: sp.quadrants && !sp.quadrants.includes("SURE_THING") ? n(sure?.CONSENTED) : 0,
    composition: comp,
    health: { ...health, score: healthScore },
    upliftCells: [...cells.entries()].map(([key, c]) => ({ key, ...c, quadrant: quadrantForCell(cells, key).quadrant })),
    provenance: { counts: "REAL", consent: "MODELLED", uplift: "MODELLED" },
  };
}
