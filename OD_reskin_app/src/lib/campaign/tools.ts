// ─── OneDigital Campaign Manager: the agents' tools (pure, synchronous) ──────
//
// The procedure tools CAMPAIGN_BUILDER_AGENT and CAMPAIGN_INVESTIGATOR_AGENT
// call. Each takes a `run` that executes one bound statement and returns rows,
// so the same code runs inside a JavaScript stored procedure (tools-entry.ts,
// bundled into od_45 by scripts/build_cmp_tools.mjs) and in vitest. Every
// number an agent quotes is computed here, from the queries the pages use
// (./sql.ts) and the measurement the pages use (./measure.ts, ./stats.ts), so the
// agent and the app cannot disagree about a campaign or an audience.
//
// Outputs are compact and pre-rounded, with rates as percentages and differences
// in points (keys ending _pct / _pts), so the citation check on the agent's
// answer reads them the way the app does.

import { S } from "./schema";
import * as SQL from "./sql";
import { validateSpec, emptySpec, describeSpec, SpecError, type AudienceSpec } from "./spec";
import { sizingStatements, sizingResult } from "./audience-core";
import { cellsFrom, metricsOf, settingsMap, alertsFor, healthOf, quadrantForCell } from "./measure";
import { lift, pValue } from "./stats";
import { FIELDS, CATEGORIES, CHANNELS, TRACK_OF, NEED_LABEL, AS_OF_ISO } from "./config";
import { toNum, isoDate } from "./format";

export type Row = Record<string, unknown>;
export type Run = (sql: string, binds?: unknown[]) => Row[];

const n = (v: unknown) => toNum(v) ?? 0;
const r = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? null : r(v * 100, d));
const ID = /^[A-Za-z0-9_-]{1,40}$/;

class ToolError extends Error {}
const fail = (message: string, extra: Row = {}) => ({ ok: false, error: message, ...extra });

function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new ToolError("The argument is not valid JSON.");
  }
}

/** Fill what an agent usually leaves out with the builder's defaults, then
 *  validate exactly as the app does. */
function agentSpec(input: unknown): AudienceSpec {
  const raw = (parseJson(input) ?? {}) as Row;
  const base = emptySpec();
  const promoted = { ...base.promoted, ...((raw.promoted as Row) ?? {}) };
  return validateSpec({
    ...base, ...raw,
    suppress: { ...base.suppress, ...((raw.suppress as Row) ?? {}) },
    channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels : base.channels,
    promoted,
  });
}

function fieldHelp() {
  return Object.entries(FIELDS).map(([k, f]) => (f.options ? `${k}: ${f.options.join(" | ")}` : `${k} (${f.kind})`));
}

const asOfOf = (run: Run) => isoDate(run(SQL.SQL_AS_OF)[0]?.AS_OF) ?? AS_OF_ISO;

// ─── FIND_OPPORTUNITIES ──────────────────────────────────────────────────────

/** Every candidate play sized and valued the way the audience builder does it,
 *  ranked by expected incremental margin, with the two cross-banner signals and
 *  the school calendar behind them. */
export function findOpportunities(run: Run) {
  const plays = run(SQL.SQL_OPPORTUNITIES);
  const biz = run(SQL.SQL_SIGNAL_BUSINESS);
  const school = run(SQL.SQL_SIGNAL_SCHOOL);
  const terms = run(SQL.SQL_SCHOOL_START);
  const sum = (rows: Row[], k: string) => rows.reduce((a, x) => a + n(x[k]), 0);
  return {
    ok: true,
    as_of: asOfOf(run),
    method: "evidence.campaign_lift_pts is the past campaign's lift over everyone it targeted; evidence.targeted_lift_pts is its lift for the members this play targets, the comparable figure. Eligible = matched, reachable on the play's channels, data-sharing consent where a Bunnings or Kmart signal is used, not contacted in 14 days. Expected incremental conversions use the uplift cells (track x need state) measured against holdouts in past campaigns. Value = first-order margin from the history plus six months of the follow-on margin such a customer makes at Officeworks. Net = value minus send and offer cost.",
    opportunities: plays.map((p) => ({
      rank: n(p.PRIORITY_RANK), play_id: p.PLAY_ID, title: p.TITLE, signal: p.SIGNAL_SOURCE, category: p.PROMOTED_CATEGORY,
      offer_id: p.OFFER_ID, offer: p.OFFER_NAME, other_offers: p.EXTRA_OFFERS ? String(p.EXTRA_OFFERS).split(",") : [],
      channels: String(p.CHANNELS ?? "").split(","),
      matched: n(p.MATCHED), eligible: n(p.ELIGIBLE), removed_no_data_sharing_consent: n(p.NO_DATA_CONSENT),
      persuadable_members: n(p.PERSUADABLE), sleeping_dog_members: n(p.SLEEPING_DOGS),
      expected_incremental_conversions: r(n(p.EXP_INC_CONV), 1), expected_lift_pts: r(toNum(p.EXP_LIFT_PTS)),
      first_order_margin_aud: r(toNum(p.FIRST_ORDER_MARGIN), 0), follow_on_margin_6m_aud: r(toNum(p.FOLLOW_ON_MARGIN), 0),
      cost_aud: r(n(p.SEND_COST) + n(p.OFFER_COST), 0), expected_net_margin_aud: r(toNum(p.EXP_NET_MARGIN), 0),
      timing: p.TIMING,
      evidence: { campaign_id: p.EVIDENCE_CAMPAIGN, campaign: p.EVIDENCE_NAME, campaign_lift_pts: r(toNum(p.EVIDENCE_LIFT_PTS)),
        targeted_need_state: p.EVIDENCE_NEED_STATE ?? null, targeted_lift_pts: r(toNum(p.EVIDENCE_SEGMENT_LIFT_PTS)),
        targeted_holdout_members: toNum(p.EVIDENCE_SEGMENT_HOLDOUT) },
      spec: parseJson(p.SPEC_JSON),
    })),
    business_starter_signal: {
      trade_cluster_members: sum(biz, "STARTERS") + sum(biz, "ESTABLISHED_WITH_CLUSTER"),
      starters: sum(biz, "STARTERS"), starters_with_data_sharing_consent: sum(biz, "STARTERS_CONSENTED"),
      starters_consented_not_yet_officeworks_business: sum(biz, "STARTERS_NOT_YET_OW_BUSINESS"),
      starters_first_trade_in_last_60d: sum(biz, "STARTERS_LAST_60D"),
      established_tradies_with_a_cluster: sum(biz, "ESTABLISHED_WITH_CLUSTER"),
      by_trade: biz.map((x) => ({ trade: x.TRADE_TYPE, starters: n(x.STARTERS) })),
    },
    school_signal: school.map((x) => ({ confidence: x.SCHOOL_SIGNAL_CONFIDENCE, households: n(x.HOUSEHOLDS), with_data_sharing_consent: n(x.CONSENTED),
      starting_school: n(x.STARTING_SCHOOL), used_school_list_last_year: n(x.USED_SCHOOL_LIST), avg_est_school_age_kids: toNum(x.AVG_EST_SCHOOL_AGE_KIDS) })),
    school_start: terms.map((t) => ({ state: t.STATE, term1_start: isoDate(t.START_DATE), days_away: n(t.DAYS_AWAY) })),
    provenance: "Purchases are SYNTHETIC demo data; consent and campaign responses are MODELLED.",
  };
}

// ─── SIZE_AUDIENCE ───────────────────────────────────────────────────────────

export function sizeAudience(run: Run, specInput: unknown) {
  let sp: AudienceSpec;
  try {
    sp = agentSpec(specInput);
  } catch (e) {
    if (e instanceof SpecError || e instanceof ToolError) return fail(e.message, { allowed_fields: fieldHelp() });
    throw e;
  }
  const cells = cellsFrom(run(SQL.SQL_UPLIFT_CELLS));
  const res = sizingResult(sp, cells, sizingStatements(sp, cells).map((s) => run(s.sql, s.binds)));
  const f = res.funnel;
  const top = (dim: string) => res.composition.filter((c) => c.DIM === dim).sort((a, b) => n(b.N) - n(a.N)).slice(0, 5)
    .map((c) => ({ value: String(c.VAL ?? "Unknown"), members: n(c.N) }));
  return {
    ok: true,
    spec: sp,
    description: res.description,
    cross_banner_fields_used: res.crossBanner,
    matched: f.matched, consented: f.consented, eligible: f.eligible, final_audience: f.final,
    removed_by_suppression: f.suppressed.map((s) => ({ rule: s.label, members: s.n })),
    final_home_store_short_of_brand: f.finalStockConflict,
    final_starting_school: f.startingSchool,
    days_to_school_start: f.daysToSchool,
    reachable_by_channel: f.channels,
    uplift_quadrants: res.quadrants.map((q) => ({ quadrant: q.quadrant, consented: q.consented, in_audience: q.final,
      expected_incremental_conversions: r(q.expIncConv, 1) })),
    sure_things_left_out: res.sureThingsExcluded,
    expected_incremental_conversions: r(res.health.expIncConv, 1),
    expected_lift_pts: f.final ? r((res.health.expIncConv / f.final) * 100) : null,
    expected_base_rate_pct: pct(res.health.expBaseRate),
    audience_health_score: res.health.score,
    needs_product_share_pct: pct(res.health.relevantShare, 1),
    cold_contact_share_pct: pct(res.health.coldShare, 1),
    contacted_30d_share_pct: pct(res.health.contacted30dShare, 1),
    composition: { need_state: top("Need state").map((x) => ({ ...x, label: NEED_LABEL[x.value] ?? x.value })), school_signal: top("School signal"),
      trade: top("Trade"), officeworks_relationship: top("Officeworks relationship"), home_state: top("Home state") },
    provenance: "Counts from purchases (SYNTHETIC demo data); consent and uplift are MODELLED.",
  };
}

// ─── CHECK_CAMPAIGN_GUARDRAILS ───────────────────────────────────────────────

export function checkGuardrails(run: Run, category: unknown, brand: unknown, start: unknown, end: unknown) {
  const cat = category ? String(category) : null;
  const br = brand ? String(brand) : null;
  if (cat && !(CATEGORIES as readonly string[]).includes(cat)) return fail(`Unknown category. Use one of: ${CATEGORIES.join(", ")}.`);
  const sd = isoDate(start), ed = isoDate(end);
  const supply = run(SQL.SQL_SIGNAL_SUPPLY);
  const overlap = sd && ed
    ? run(`SELECT CAMPAIGN_ID, NAME, STATUS, START_DATE, END_DATE, PROMOTED_CATEGORY, PROMOTED_BRAND FROM ${S}.CAMPAIGN
           WHERE STATUS IN ('AUDIENCE_LOCKED', 'CONTENT_APPROVED', 'SCHEDULED', 'LIVE', 'PAUSED')
             AND START_DATE <= ?::DATE AND COALESCE(END_DATE, START_DATE) >= ?::DATE ORDER BY START_DATE`, [ed, sd])
    : [];
  const fatigue = run(`SELECT COUNT(DISTINCT CUSTOMER_KEY) AS N FROM ${S}.CAMPAIGN_EVENT
    WHERE EVENT_TYPE = 'SEND' AND EVENT_DATE > DATEADD('day', -14, ${S}.CMP_AS_OF()) AND EVENT_DATE <= ${S}.CMP_AS_OF()`);
  const rejected = run(SQL.SQL_REJECTED_IDEAS);
  const terms = cat === "Back to School" ? run(SQL.SQL_SCHOOL_START) : [];
  const guardrails: { level: "BLOCK" | "CAUTION"; message: string }[] = [];
  const brandSupply = supply.filter((x) => br && x.BRAND_NAME === br);
  for (const x of brandSupply.filter((x) => x.STATUS === "SHORT")) {
    guardrails.push({ level: "BLOCK", message: `${br} is short at ${n(x.STORES)} Officeworks stores (${String(x.STATES)}): ${String(x.REASON)}` });
  }
  for (const x of brandSupply.filter((x) => x.STATUS === "LOW")) {
    guardrails.push({ level: "CAUTION", message: `${br} stock is low at ${n(x.STORES)} stores (${String(x.STATES)}): ${String(x.REASON)}` });
  }
  for (const o of overlap.filter((o) => !cat || o.PROMOTED_CATEGORY === cat)) {
    guardrails.push({ level: "CAUTION", message: `${String(o.NAME)} (${String(o.STATUS).toLowerCase()}) runs ${isoDate(o.START_DATE)} to ${isoDate(o.END_DATE)} in the same category.` });
  }
  if (cat === "Back to School" && sd && terms.length) {
    const days = terms.map((t) => ({ state: String(t.STATE), days: Math.round((Date.parse(String(isoDate(t.START_DATE))) - Date.parse(sd)) / 86400000) }));
    const early = days.filter((d) => d.days > 40);
    if (early.length) {
      guardrails.push({ level: "CAUTION", message: `A ${sd} start is ${Math.min(...early.map((d) => d.days))}-${Math.max(...early.map((d) => d.days))} days before Term 1 in ${early.map((d) => d.state).join(", ")}. Back-to-school lift was strongest about three weeks out; plan the main send closer to each state's start.` });
    }
  }
  if (cat === "Business Essentials" || cat === "Back to School" || cat === "Furniture") {
    guardrails.push({ level: "CAUTION", message: "An audience built on Bunnings or Kmart purchases needs OnePass data-sharing consent (applied automatically), and copy must speak to the need, never to what was bought at another banner." });
  }
  return {
    ok: true,
    category: cat, brand: br, window: sd && ed ? `${sd} to ${ed}` : null,
    guardrails,
    blocked: guardrails.some((g) => g.level === "BLOCK"),
    stock_short_or_low: supply.filter((x) => x.STATUS !== "OVER").map((x) => ({ brand: x.BRAND_NAME, status: x.STATUS, stores: n(x.STORES), states: x.STATES, reason: x.REASON })),
    overlapping_campaigns: overlap.map((o) => ({ campaign_id: o.CAMPAIGN_ID, name: o.NAME, status: o.STATUS, start: isoDate(o.START_DATE), end: isoDate(o.END_DATE), category: o.PROMOTED_CATEGORY })),
    customers_contacted_last_14d: n(fatigue[0]?.N),
    school_start: terms.map((t) => ({ state: t.STATE, term1_start: isoDate(t.START_DATE), days_from_today: n(t.DAYS_AWAY) })),
    active_offers: run(SQL.SQL_OFFERS).filter((o) => o.IS_ACTIVE && (!cat || !o.CATEGORY || o.CATEGORY === cat))
      .map((o) => ({ offer_id: o.OFFER_ID, name: o.NAME, type: o.OFFER_TYPE, category: o.CATEGORY, terms: o.TERMS, cost_per_redemption_aud: toNum(o.COST_PER_REDEMPTION) })),
    rejected_ideas: rejected.map((x) => ({ title: x.TITLE, reason: x.DECISION_REASON })),
  };
}

// ─── ESTIMATE_LIFT ───────────────────────────────────────────────────────────

function campaignLifts(run: Run) {
  const asOf = asOfOf(run);
  return run(SQL.SQL_CAMPAIGN_METRICS).map((row) => metricsOf(row, asOf)).filter((m) => m.holdout > 0 && m.treated > 0);
}

export function estimateLift(run: Run, category: unknown, channels: unknown, needState: unknown) {
  const cat = category ? String(category) : null;
  const track = cat ? TRACK_OF[cat] ?? "GENERAL" : null;
  const chans = String(channels ?? "").split(/[,\s]+/).map((c) => c.toUpperCase()).filter((c) => (CHANNELS as readonly string[]).includes(c));
  const history = campaignLifts(run).filter((m) => ["MEASURED", "COMPLETED"].includes(m.status));
  const comparable = cat ? history.filter((m) => m.promotedCategory === cat) : history;
  const basis = comparable.length ? (cat ? `${comparable.length} measured ${cat} campaign(s)` : `${comparable.length} measured campaigns`) : null;
  const pool = (ms: typeof history) => {
    const t = ms.reduce((a, m) => ({ n: a.n + m.treated, conv: a.conv + m.treatedConv }), { n: 0, conv: 0 });
    const h = ms.reduce((a, m) => ({ n: a.n + m.holdout, conv: a.conv + m.holdoutConv }), { n: 0, conv: 0 });
    return lift(t, h);
  };
  const pooled = comparable.length ? pool(comparable) : null;
  const byChannel = run(SQL.SQL_CHANNEL_LIFT).map((c) => {
    const l = lift({ n: n(c.TN), conv: n(c.TC) }, { n: n(c.HN), conv: n(c.HC) });
    return { channel: c.CHANNEL_CODE, treated: n(c.TN), holdout: n(c.HN), lift_pts: r(l.liftPp), ci_low_pts: r(l.ciLowPp), ci_high_pts: r(l.ciHighPp), significant: l.significant };
  }).filter((c) => !chans.length || chans.includes(String(c.channel)));
  const cells = cellsFrom(run(SQL.SQL_UPLIFT_CELLS));
  const need = needState ? String(needState).toUpperCase() : null;
  const trackCells = [...cells.entries()].filter(([k]) => (!track || k.startsWith(`${track}|`)) && (!need || k.endsWith(`|${need}`))).map(([k, c]) => {
    const [t, ns] = k.split("|");
    return { track: t, need_state: ns, meaning: NEED_LABEL[ns] ?? ns, members: c.n, lift_pts: r(c.liftPp), holdout_rate_pct: pct(c.holdoutRate),
      quadrant: quadrantForCell(cells, k).quadrant };
  }).sort((a, b) => (b.lift_pts ?? 0) - (a.lift_pts ?? 0));
  const learnings = run(SQL.SQL_LEARNINGS).filter((l) => !cat || comparable.some((m) => m.campaignId === l.CAMPAIGN_ID)).slice(0, 10)
    .map((l) => ({ campaign: l.CAMPAIGN_NAME, finding: l.STATEMENT, lift_pts: r(toNum(l.LIFT_PP)), significant: l.IS_SIGNIFICANT }));
  return {
    ok: true,
    basis: basis ?? "no comparable evidence",
    no_comparable_evidence: !pooled,
    note: "A comparable campaign's overall lift mixes everyone it targeted. For a specific audience, SizeAudience's expected_incremental_conversions uses the uplift cells below (lift by need state, measured against holdouts) and is the better estimate.",
    expected_lift_pts: pooled ? r(pooled.liftPp) : null,
    expected_lift_ci_low_pts: pooled ? r(pooled.ciLowPp) : null,
    expected_lift_ci_high_pts: pooled ? r(pooled.ciHighPp) : null,
    significant: pooled?.significant ?? false,
    comparable_campaigns: comparable.map((m) => ({ campaign_id: m.campaignId, name: m.name, start: m.start, treated: m.treated, holdout: m.holdout,
      treated_rate_pct: pct(m.treatedRate), holdout_rate_pct: pct(m.holdoutRate), lift_pts: r(m.liftPp), ci_low_pts: r(m.ciLowPp), ci_high_pts: r(m.ciHighPp),
      significant: m.significant, net_aud: r(m.net, 0), roi: r(m.roi, 1) })),
    lift_by_channel: byChannel,
    uplift_cells: trackCells,
    learnings,
  };
}

// ─── CREATE_CAMPAIGN_DRAFT ───────────────────────────────────────────────────

const DRAFTS_PER_DAY = 20;

export function createDraft(run: Run, briefInput: unknown, specInput: unknown, runId: unknown) {
  const b = (parseJson(briefInput) ?? {}) as Row;
  let sp: AudienceSpec;
  try {
    sp = agentSpec(specInput);
  } catch (e) {
    if (e instanceof SpecError || e instanceof ToolError) return fail(e.message, { allowed_fields: fieldHelp() });
    throw e;
  }
  const text = (k: string, max: number) => (b[k] === undefined || b[k] === null || b[k] === "" ? null : String(b[k]).slice(0, max));
  const name = text("name", 200);
  if (!name) return fail("The brief needs a name.");
  const asOf = asOfOf(run);
  const start = isoDate(b.start_date) ?? null, end = isoDate(b.end_date) ?? null;
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return fail("start_date and end_date are required, as YYYY-MM-DD.");
  if (start <= asOf) return fail(`The campaign must start after ${asOf}, the last day of data.`);
  if (end < start) return fail("end_date is before start_date.");
  const budget = Number(b.budget_aud);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 100000) return fail("budget_aud must be between 1 and 100,000.");
  const offerId = text("offer_id", 20);
  if (offerId && !run(`SELECT 1 FROM ${S}.OFFER WHERE OFFER_ID = ? AND IS_ACTIVE`, [offerId]).length) return fail(`${offerId} is not an active offer.`);
  const today = run(`SELECT COUNT(*) AS N FROM ${S}.CAMPAIGN WHERE CREATED_BY = 'Campaign Builder agent'
    AND CREATED_AT >= CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::DATE`);
  if (n(today[0]?.N) >= DRAFTS_PER_DAY) return fail(`The agent has created ${DRAFTS_PER_DAY} drafts today, the daily limit. A person can create more from the app.`);
  const sized = sizeAudience(run, sp) as Row;
  if (!sized.ok) return sized;
  const stamp = Date.now().toString(36);
  const cid = `camp-${stamp}`, aid = `aud-${stamp}`;
  const who = "Campaign Builder agent";
  const now = "CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ";
  const rid = runId ? String(runId).slice(0, 80) : null;
  const specJson = JSON.stringify(sp);
  run("BEGIN TRANSACTION");
  try {
    run(`INSERT INTO ${S}.CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND, OFFER_ID,
           CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, PROVENANCE, AUDIENCE_ID, CREATED_BY, CREATED_AT)
         SELECT ?, ?, ?, ?, 'BRIEF', ?, ?, ?, ?, PARSE_JSON(?), ?, ?::DATE, ?::DATE,
                (SELECT TRY_TO_NUMBER(SETTING_VALUE) FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'HOLDOUT_PCT'), 'APP', ?, ?, ${now}`,
      [cid, name, text("objective", 500), text("hypothesis", 800), sp.promoted.category, sp.promoted.className, sp.promoted.brand, offerId,
        JSON.stringify(sp.channels), budget, start, end, aid, who]);
    run(`INSERT INTO ${S}.AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, SIZE_AT_SAVE, REACHABLE_AT_SAVE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT)
         SELECT ?, ?, ?, PARSE_JSON(?), SHA2(?, 256), 1, 'AGENT', ?, ?, 'DRAFT', ?, ?, ${now}`,
      [aid, `${name.slice(0, 100)} - audience`, describeSpec(sp), specJson, specJson, n(sized.matched), n(sized.final_audience), cid, who]);
    run(`INSERT INTO ${S}.CAMPAIGN_STATUS_LOG SELECT ?, NULL, 'BRIEF', ?, ?, ${now}`,
      [cid, `Drafted by the Campaign Builder agent${rid ? ` (run ${rid})` : ""}. A person locks the audience and approves content.`, who]);
    run("COMMIT");
  } catch (e) {
    run("ROLLBACK");
    throw e;
  }
  return { ok: true, campaign_id: cid, audience_id: aid, status: "BRIEF", name, start_date: start, end_date: end, budget_aud: budget,
    final_audience: sized.final_audience, matched: sized.matched,
    next_step: "Open the brief in the Audience builder to review and lock the audience; content approval and launch are done by a person." };
}

// ─── CAMPAIGN_EVIDENCE ───────────────────────────────────────────────────────

function liftRows(rows: Row[]) {
  return rows.map((x) => {
    const l = lift({ n: n(x.TN), conv: n(x.TC) }, { n: n(x.HN), conv: n(x.HC) });
    return { dim: String(x.DIM), value: String(x.VAL), treated: n(x.TN), holdout: n(x.HN), l };
  });
}

function resolveCampaign(run: Run, id: unknown): Row {
  const cid = String(id ?? "").trim();
  if (ID.test(cid)) {
    const c = run(SQL.SQL_CAMPAIGN, [cid]);
    if (c.length) return c[0];
  }
  // An agent often has the name rather than the id.
  const byName = run(`SELECT CAMPAIGN_ID FROM ${S}.CAMPAIGN WHERE NAME ILIKE ? ORDER BY START_DATE DESC NULLS LAST LIMIT 1`, [`%${cid.slice(0, 80)}%`]);
  if (byName.length) return run(SQL.SQL_CAMPAIGN, [byName[0].CAMPAIGN_ID])[0];
  throw new ToolError(`No campaign '${cid}'. Ask CampaignResults for the list of campaigns and their ids.`);
}

export function campaignEvidence(run: Run, id: unknown) {
  let c: Row;
  try {
    c = resolveCampaign(run, id);
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    throw e;
  }
  const cid = String(c.CAMPAIGN_ID);
  const mRow = run(SQL.SQL_CAMPAIGN_METRICS).find((x) => x.CAMPAIGN_ID === cid)!;
  const m = metricsOf(mRow, asOfOf(run));
  const cold = run(`SELECT COUNT(*) AS N FROM ${S}.AUDIENCE_MEMBER WHERE CAMPAIGN_ID = ? AND GROUP_CODE = 'TREATED' AND SUPPRESSED_AT IS NULL
    AND COALESCE(COLD_CONTACT, FALSE)`, [cid]);
  const alerts = alertsFor(m, settingsMap(run(SQL.SQL_SETTINGS)), n(cold[0]?.N), run(SQL.SQL_ALERT_LOG, [cid]));
  const ab = run(SQL.SQL_VARIANTS_AB, [cid, cid]);
  const va = ab.find((x) => x.VARIANT_CODE === "A"), vb = ab.find((x) => x.VARIANT_CODE === "B");
  const abl = va && vb ? lift({ n: n(vb.N), conv: n(vb.CONV) }, { n: n(va.N), conv: n(va.CONV) }) : null;
  const audience = run(`SELECT NAME, DESCRIPTION FROM ${S}.AUDIENCE WHERE CAMPAIGN_ID = ? ORDER BY VERSION DESC LIMIT 1`, [cid])[0];
  return {
    ok: true,
    campaign: { id: cid, name: m.name, status: m.status, start: m.start, end: m.end, data_through: m.through, promoted_category: m.promotedCategory,
      promoted_brand: m.promotedBrand, channels: c.CHANNELS, offer: c.OFFER_NAME ?? null, hypothesis: c.HYPOTHESIS ?? null,
      audience: audience ? `${String(audience.NAME)}: ${String(audience.DESCRIPTION ?? "")}` : null, data: m.eventProvenance ?? m.provenance },
    headline: {
      treated_members: m.treated, holdout_members: m.holdout, treated_conversions: m.treatedConv, holdout_conversions: m.holdoutConv,
      treated_rate_pct: pct(m.treatedRate), holdout_rate_pct: pct(m.holdoutRate), lift_pts: r(m.liftPp), lift_ci_low_pts: r(m.ciLowPp),
      lift_ci_high_pts: r(m.ciHighPp), significant: m.significant, incremental_conversions: r(m.incrementalConv, 1),
      incremental_margin_aud: r(m.incMargin, 0), cost_aud: r(m.cost, 0), net_aud: r(m.net, 0), roi: r(m.roi, 2),
      unsubscribe_rate_pct: pct(m.unsubRate), complaint_rate_pct: pct(m.complaintRate), bounce_rate_pct: pct(m.bounceRate),
      health_score: m.sends ? healthOf(m).score : null,
    },
    open_alerts: alerts.filter((a) => a.status === "OPEN").map((a) => ({ code: a.code, severity: a.severity, message: a.message, recommended_action: a.action })),
    lift_by_dimension: liftRows(run(SQL.SQL_LIFT_BY, [cid])).filter((x) => x.treated >= 100 && x.holdout >= 20 && x.dim !== "Uplift quadrant").map((x) => ({
      dimension: x.dim, value: x.value, meaning: x.dim === "Need state" ? NEED_LABEL[x.value] ?? null : undefined, treated: x.treated, holdout: x.holdout,
      treated_rate_pct: pct(x.l.treatedRate), holdout_rate_pct: pct(x.l.holdoutRate),
      lift_pts: r(x.l.liftPp), ci_low_pts: r(x.l.ciLowPp), ci_high_pts: r(x.l.ciHighPp), significant: x.l.significant })),
    creative_ab: abl ? { variant_a_rate_pct: pct(n(va!.CONV) / n(va!.N)), variant_b_rate_pct: pct(n(vb!.CONV) / n(vb!.N)), b_minus_a_pts: r(abl.liftPp),
      ci_low_pts: r(abl.ciLowPp), ci_high_pts: r(abl.ciHighPp), significant: abl.significant } : null,
    stock_by_home_state: run(SQL.SQL_CAMPAIGN_STOCK, [cid]).filter((x) => n(x.SHORT_MEMBERS) > 0)
      .map((x) => ({ state: x.HOME_STATE, treated: n(x.MEMBERS), home_store_short: n(x.SHORT_MEMBERS) })),
    overlapping_campaigns_14d: run(SQL.SQL_OVERLAP, [cid, cid]).map((x) => ({ campaign: x.NAME, started: isoDate(x.START_DATE), shared_members: n(x.SHARED_MEMBERS) })),
  };
}

// ─── TEST_HYPOTHESIS ─────────────────────────────────────────────────────────

const DIMENSIONS: Record<string, string> = {
  channel: "Channel", state: "Home state", "home state": "Home state", recency: "Last purchase", "last purchase": "Last purchase",
  need: "Need state", "need state": "Need state", relevance: "Needs the product", "needs the product": "Needs the product",
  "business starter": "Business starter (Bunnings)", starter: "Business starter (Bunnings)", "business starter (bunnings)": "Business starter (Bunnings)",
  "school signal": "School signal (Kmart)", school: "School signal (Kmart)", "school signal (kmart)": "School signal (Kmart)",
  "school list": "Used school list last year", "used school list last year": "Used school list last year",
  relationship: "Officeworks relationship", "officeworks relationship": "Officeworks relationship",
  cold: "Cold contact (no need, never shopped Officeworks)", "cold contact": "Cold contact (no need, never shopped Officeworks)",
  membership: "Membership", onepass: "Membership",
  stock: "Home store short of promoted brand", supply: "Home store short of promoted brand", "home store short of promoted brand": "Home store short of promoted brand",
  quadrant: "Uplift quadrant", "uplift quadrant": "Uplift quadrant",
};

/** Lift on each side of one split, and whether the lifts differ: a two-sided z
 *  test on the difference of the two largest groups' lifts. */
export function testHypothesis(run: Run, id: unknown, dimension: unknown) {
  const key = String(dimension ?? "").trim().toLowerCase();
  const dim = DIMENSIONS[key] ?? Object.values(DIMENSIONS).find((d) => d.toLowerCase() === key);
  if (!dim) return fail(`Unknown dimension '${String(dimension)}'. Use one of: ${[...new Set(Object.keys(DIMENSIONS).filter((k) => !k.includes("(")))].join(", ")}.`);
  let c: Row;
  try {
    c = resolveCampaign(run, id);
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    throw e;
  }
  const cid = String(c.CAMPAIGN_ID);
  const groups = liftRows(run(SQL.SQL_LIFT_BY, [cid])).filter((x) => x.dim === dim && x.holdout > 0).sort((a, b) => b.treated - a.treated);
  if (groups.length < 2) return fail(`${dim} does not split ${String(c.NAME)}'s members into two or more groups with a holdout.`);
  const [a, b] = groups;
  const se = (g: (typeof groups)[number]) => {
    const pt = g.l.treatedRate ?? 0, ph = g.l.holdoutRate ?? 0;
    return Math.sqrt((pt * (1 - pt)) / g.treated + (ph * (1 - ph)) / g.holdout) * 100;
  };
  const diff = (a.l.liftPp ?? 0) - (b.l.liftPp ?? 0);
  const seDiff = Math.sqrt(se(a) ** 2 + se(b) ** 2);
  const z = seDiff > 0 ? diff / seDiff : null;
  const p = pValue(z);
  // A small group can carry a significant lift of its own while the test of the
  // difference is underpowered; that is evidence, not a reason to rule it out.
  const sigGroups = groups.filter((g) => g.l.significant);
  const fmt = (g: (typeof groups)[number]) => `${g.value} ${r(g.l.liftPp)} pts (95% CI ${r(g.l.ciLowPp)} to ${r(g.l.ciHighPp)})`;
  const verdict = p !== null && p < 0.05 ? "SUPPORTED" : sigGroups.length ? "INCONCLUSIVE" : p !== null && p >= 0.2 ? "NOT_SUPPORTED" : "INCONCLUSIVE";
  const reading = verdict === "SUPPORTED"
    ? `The lift differs by ${dim.toLowerCase()} (p = ${r(p, 4)}): ${groups.map(fmt).join("; ")}.`
    : sigGroups.length
      ? `The difference between the two largest groups is not significant on its own (p = ${r(p, 4)}), but ${sigGroups.map(fmt).join("; ")} is significant by itself. Treat ${dim.toLowerCase()} as a likely contributor and look for corroborating evidence.`
      : verdict === "NOT_SUPPORTED"
        ? `No evidence the lift differs by ${dim.toLowerCase()} (p = ${r(p, 4)}), and no group's lift is significant: rule it out.`
        : `Weak evidence the lift differs by ${dim.toLowerCase()} (p = ${r(p, 4)}); not enough to confirm or rule out.`;
  return {
    ok: true,
    campaign: { id: cid, name: c.NAME },
    dimension: dim,
    groups: groups.map((g) => ({ value: g.value, meaning: dim === "Need state" ? NEED_LABEL[g.value] ?? null : undefined, treated: g.treated, holdout: g.holdout,
      treated_rate_pct: pct(g.l.treatedRate), holdout_rate_pct: pct(g.l.holdoutRate),
      lift_pts: r(g.l.liftPp), ci_low_pts: r(g.l.ciLowPp), ci_high_pts: r(g.l.ciHighPp), significant: g.l.significant })),
    comparison: { between: `${a.value} vs ${b.value}`, lift_difference_pts: r(diff), ci_low_pts: r(diff - 1.959964 * seDiff), ci_high_pts: r(diff + 1.959964 * seDiff),
      z: r(z, 2), p_value: r(p, 4), differs: p !== null && p < 0.05 },
    verdict,
    reading,
  };
}
