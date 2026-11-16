// ─── Head of Planning: natural-language help for adding a store ──────────────
//
// Two modes, and neither writes to the plan.
//
//   PARSE  - turn "open Rouse Hill in October at about 85% of Parramatta, same
//            growth corridor" into the add-store form, for a person to check and
//            save themselves.
//   ADVISE - given a benchmark, a share and an opening, say what the proposal
//            does to the plan and what still has to be settled.
//
// Adding a store moves the plan total the moment it saves, so a model must not be
// able to do it unattended: PARSE fills a form and stops. Every store code the
// model returns is checked against DIM_STORE before it reaches the browser,
// because a plausible wrong benchmark is the failure that matters -- S010 and
// S011 are both real stores, and the difference between them is real money.
//
// ADVISE does its arithmetic here, from the same SQL the add-store action writes
// with (derivedMonthsSql), so the figures it explains are exactly the ones adding
// the store would produce. The model explains and interrogates; it never
// calculates, and every number it writes goes through the insight guardrail.
// Every run is logged to INSIGHT_RUN as STORE_PLAN_ENTRY, failures included.

import { S } from "../schema";
import { batch, q, HopError, NOW, type Row } from "../db";
import { PLAN_MONTHS, STORE_STATES, STORE_REGIONS, STORE_FORMATS } from "../config";
import { toNum, isoDate } from "../format";
import { verifyCitations } from "../insights";
import { derivedMonthsSql, openingPeriod, NEW_STORE_MARGIN_CURVE } from "./store-plan";
import * as SQL from "../sql";

const MODEL = "claude-sonnet-4-6";
const SURFACE = "STORE_PLAN_ENTRY";

/** Structured output, as a Snowflake object literal (single-quoted keys). */
const PARSE_SCHEMA_SQL = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'store_name': {'type': 'string'},
      'state': {'type': 'string'},
      'region': {'type': 'string'},
      'store_format': {'type': 'string'},
      'opening_date': {'type': 'string'},
      'first_month': {'type': 'string'},
      'benchmark_store_code': {'type': 'string'},
      'benchmark_pct': {'type': 'number'},
      'benchmark_reason': {'type': 'string'},
      'sizing_note': {'type': 'string'},
      'halo_weeks': {'type': 'number'},
      'inferred_fields': {'type': 'array', 'items': {'type': 'string'}},
      'missing_fields': {'type': 'array', 'items': {'type': 'string'}},
      'clarification': {'type': 'string'}
    },
    'required': ['store_name', 'opening_date', 'first_month', 'benchmark_store_code', 'benchmark_pct',
                 'inferred_fields', 'missing_fields', 'clarification']
  }
}`;

const ADVISE_SCHEMA_SQL = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'headline': {'type': 'string'},
      'findings': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'observation': {'type': 'string'},
        'figures_cited': {'type': 'array', 'items': {'type': 'string'}},
        'severity': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}
      }, 'required': ['observation', 'figures_cited', 'severity']}},
      'questions_to_settle': {'type': 'array', 'items': {'type': 'string'}},
      'confidence': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}
    },
    'required': ['headline', 'findings', 'questions_to_settle', 'confidence']
  }
}`;

type Body = {
  mode?: "PARSE" | "ADVISE";
  /** PARSE: what the planner typed. */
  text?: string;
  /** ADVISE: the proposal to interrogate. */
  storeName?: string;
  openingDate?: string | null;
  firstMonth?: string | null;
  benchmarkStoreCode?: string;
  benchmarkPct?: number;
  haloWeeks?: number | null;
};

const shortName = (n: unknown) => String(n ?? "").replace(/^Baby Mart /, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (n: number) => Math.round(n * 10000) / 100;

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** One AI_COMPLETE call with a required schema. NULL is what an answer cut off by
 *  the token limit comes back as, so it is reported as that, not as a blank. */
async function complete(prompt: string, schemaSql: string, maxTokens: number): Promise<{ answer: Row; usage: Usage }> {
  const r = await q(
    `SELECT AI_COMPLETE(model => ?, prompt => ?, model_parameters => {'temperature': 0, 'max_tokens': ${Number(maxTokens)}},
                        response_format => ${schemaSql}, show_details => TRUE) AS R`,
    [MODEL, prompt],
  );
  const raw = r[0]?.R;
  if (raw == null) throw new Error("The answer was cut off before it finished. Try a shorter description.");
  const detail = (typeof raw === "string" ? JSON.parse(raw) : raw) as Row;
  const answer = (detail.structured_output as Row[] | undefined)?.[0]?.raw_message as Row | undefined;
  if (!answer) throw new Error("The model's answer did not follow the required shape.");
  return { answer, usage: (detail.usage ?? {}) as Usage };
}

async function log(o: {
  question: string; payload: unknown; promptChars: number; response?: unknown; cited?: string[];
  unmatched?: string[]; verified?: boolean; usage?: Usage; error?: string; doctrineVersion?: number | null; user: string;
}) {
  await q(
    `INSERT INTO ${S}.INSIGHT_RUN (SURFACE, TEMPLATE_ID, DOCTRINE_VERSION, MODEL, QUESTION, GROUNDING_PAYLOAD, PROMPT_CHARS, RESPONSE,
       FIGURES_CITED, UNVERIFIED_FIGURES, IS_VERIFIED, PROMPT_TOKENS, COMPLETION_TOKENS, TOTAL_TOKENS, ERROR_MESSAGE, GENERATED_BY, GENERATED_AT)
     SELECT ?, NULL, ?, ?, ?, PARSE_JSON(?), ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ?, ?, ?, ${NOW}`,
    [SURFACE, o.doctrineVersion ?? null, MODEL, o.question.slice(0, 1000), JSON.stringify(o.payload), o.promptChars,
      o.response === undefined ? null : JSON.stringify(o.response), JSON.stringify(o.cited ?? []), JSON.stringify(o.unmatched ?? []),
      o.verified ?? false, toNum(o.usage?.prompt_tokens), toNum(o.usage?.completion_tokens), toNum(o.usage?.total_tokens),
      o.error ?? null, o.user],
  );
}

const tokens = (u: Usage) => ({ prompt: u.prompt_tokens ?? null, completion: u.completion_tokens ?? null, total: u.total_tokens ?? null });

// ─── PARSE ───────────────────────────────────────────────────────────────────

async function parse(body: Body, user: string) {
  const text = body.text?.trim();
  if (!text) throw new HopError(400, "Describe the store you want to open.");
  if (text.length > 1000) throw new HopError(400, "Keep the description under 1,000 characters.");

  const [stores, windowRows] = await batch([SQL.SQL_ASSIST_STORES, SQL.SQL_PLAN_WINDOW]);
  const known = new Map(stores.map((s) => [String(s.STORE_CODE), s]));
  const w = windowRows[0] ?? {};
  // DATE values arrive as Date objects: isoDate, never String(), or the window
  // reads "Mon Jun 29" and every opening compares as outside it.
  const first = isoDate(w.FIRST_DAY) ?? "";
  const last = isoDate(w.LAST_DAY) ?? "";
  const defaultHalo = toNum(w.DEFAULT_HALO_WEEKS) ?? 9;

  const catalogue = stores.map((s) => ({
    code: s.STORE_CODE, name: shortName(s.STORE_NAME), state: s.STATE, region: s.REGION, format: s.STORE_FORMAT,
    is_new_store: s.IS_NEW_STORE === true, ly_sales_aud: toNum(s.LY_SALES_AUD) ?? 0, plan_sales_aud: toNum(s.PLAN_SALES_AUD) ?? 0,
  }));
  const prompt = [
    "You are helping the Head of Planning at Baby Mart, an Australian retailer of baby products, add a planned",
    "store opening to the store plan. Read what they typed and fill in the add-store form. Nothing is created",
    "from your answer: a person checks the form and saves it.",
    "",
    `The plan half is FY27 H1, ${first} to ${last}. Baby Mart's fiscal year runs July to June and weeks run`,
    "Monday to Sunday. A store must open inside the half to carry any plan.",
    "",
    "These are the stores that exist. Resolve any store the planner names to its code from this list.",
    "Never invent a store code.",
    "",
    JSON.stringify(catalogue),
    "",
    "Rules that matter:",
    "- benchmark_pct is a decimal factor, not a percentage: two thirds is 0.67, 85% is 0.85.",
    "- A new store has no like-for-like history, so it is planned off a store that traded last year. Prefer a",
    "  benchmark whose ly_sales_aud is above zero. A new store may be named as the benchmark: its weekly",
    "  shape then follows that store's own comparable.",
    "- opening_date is YYYY-MM-DD. Give one only if the planner named a day, or a phrase that fixes one",
    "  ('end of October' is the last week of October); if you chose the day, list opening_date in",
    "  inferred_fields. If they named only a month, leave opening_date empty and put the month in first_month",
    "  as JUL, AUG, SEP, OCT, NOV or DEC: the plan then starts that month and records the date as inferred.",
    "  If they gave a date, set first_month to an empty string.",
    `- state is one of ${STORE_STATES.join(", ")}; region is one of ${STORE_REGIONS.join(", ")}; store_format is`,
    `  one of ${STORE_FORMATS.join(" or ")}. Take them from what the planner said; otherwise from the benchmark`,
    "  store, and list each one you took that way in inferred_fields.",
    `- halo_weeks is the opening uplift period. Use ${defaultHalo} unless the planner says otherwise.`,
    "- benchmark_reason states why this benchmark, in the planner's own words. If they gave no reason, leave it",
    "  empty and say so in clarification. Do not invent a commercial justification they did not offer.",
    "- sizing_note is only for what they said about the store's size or format; empty if they said nothing.",
    "- store_name is the place name only, without 'Baby Mart'.",
    "",
    "List in inferred_fields every field you worked out rather than read, and in missing_fields every required",
    "field the planner did not supply. Required: store_name, opening_date or first_month, benchmark_store_code,",
    "benchmark_pct and benchmark_reason. Use clarification to ask for exactly what is missing, in one or two",
    "sentences.",
    "",
    "Respond in JSON matching the required schema.",
    "",
    "What the planner typed:",
    `"""${text}"""`,
  ].join("\n");

  let answer: Row, usage: Usage;
  try {
    ({ answer, usage } = await complete(prompt, PARSE_SCHEMA_SQL, 1200));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ question: text, payload: { stores: catalogue.length, window: [first, last] }, promptChars: prompt.length, error: message.slice(0, 2000), user });
    throw new HopError(502, `The assistant did not answer: ${message.slice(0, 300)}`);
  }

  // Validate rather than trust. Each problem is shown beside the draft.
  const problems: string[] = [];
  const inferred = new Set(Array.isArray(answer.inferred_fields) ? (answer.inferred_fields as unknown[]).map(String) : []);
  let bench = String(answer.benchmark_store_code ?? "").trim().toUpperCase();
  if (bench && !known.has(bench)) {
    problems.push(`The assistant proposed benchmark store ${bench}, which does not exist. Choose one from the list.`);
    bench = "";
  }
  const benchRow = bench ? known.get(bench) : undefined;
  const pct = Number(answer.benchmark_pct);
  const pctOk = Number.isFinite(pct) && pct > 0 && pct <= 3;
  if (!pctOk) problems.push(`A benchmark share of ${String(answer.benchmark_pct)} is not usable: it must be above 0 and at most 3 (300%).`);

  let opening = String(answer.opening_date ?? "").trim().slice(0, 10);
  let firstMonth = String(answer.first_month ?? "").trim().toUpperCase();
  if (opening) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opening)) {
      problems.push(`"${answer.opening_date}" is not a date.`);
      opening = "";
    } else if (opening < first || opening > last) {
      problems.push(`An opening on ${opening} falls outside FY27 H1 (${first} to ${last}), so the store would carry no plan.`);
      opening = "";
    } else {
      firstMonth = "";
    }
  }
  if (!opening && !(PLAN_MONTHS as readonly string[]).includes(firstMonth)) {
    if (firstMonth) problems.push(`'${firstMonth}' is not a month of the plan half.`);
    firstMonth = "";
  }

  // A value outside the store dimension's own list falls back to the benchmark's,
  // and says so, rather than reaching the form as a fourth region.
  const pick = (field: string, v: unknown, allowed: readonly string[], fallback: unknown): string => {
    const s = String(v ?? "").trim();
    const hit = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
    const fb = allowed.find((a) => a === String(fallback ?? "")) ?? allowed[0];
    if (s) problems.push(`'${s}' is not a store ${field.replace("store_", "")}; the benchmark's (${fb}) is used instead.`);
    inferred.add(field);
    return fb;
  };
  const halo = Number(answer.halo_weeks);
  const reason = String(answer.benchmark_reason ?? "").trim();

  const draft = {
    storeName: shortName(answer.store_name).trim(),
    state: pick("state", answer.state, STORE_STATES, benchRow?.STATE),
    region: pick("region", answer.region, STORE_REGIONS, benchRow?.REGION),
    format: pick("store_format", answer.store_format, STORE_FORMATS, benchRow?.STORE_FORMAT),
    openingDate: opening || null,
    firstMonth: firstMonth || null,
    benchmarkStoreCode: bench || null,
    benchmarkStoreName: benchRow ? shortName(benchRow.STORE_NAME) : null,
    benchmarkIsNew: benchRow?.IS_NEW_STORE === true,
    benchmarkPct: pctOk ? pct : null,
    benchmarkReason: reason,
    sizing: String(answer.sizing_note ?? "").trim() || null,
    haloWeeks: Number.isInteger(halo) && halo >= 0 && halo <= 26 ? halo : defaultHalo,
  };
  const out = {
    draft,
    inferredFields: [...inferred],
    missingFields: Array.isArray(answer.missing_fields) ? (answer.missing_fields as unknown[]).map(String) : [],
    clarification: String(answer.clarification ?? "").trim(),
    // The reason requirement is enforced here, not left to the model.
    needsBenchmarkReason: !reason,
    problems,
  };
  // "Verified" for a parse means every code and value checked out against the
  // store dimension; the problems are what did not.
  await log({ question: text, payload: { stores: catalogue.length, window: [first, last] }, promptChars: prompt.length,
    response: { answer, ...out }, unmatched: problems, verified: problems.length === 0, usage, user });
  return { ok: true, mode: "PARSE", ...out, model: MODEL, tokens: tokens(usage), note: "Nothing has been created. Check the form and save it yourself." };
}

// ─── ADVISE ──────────────────────────────────────────────────────────────────

async function advise(body: Body, user: string) {
  const benchCode = body.benchmarkStoreCode?.trim().toUpperCase() ?? "";
  const pct = body.benchmarkPct;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0 || pct > 3) throw new HopError(400, "The benchmark share must be above 0% and at most 300%, as a decimal.");
  if (body.openingDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.openingDate)) throw new HopError(400, "The opening date must be YYYY-MM-DD.");
  const [stores, windowRows] = await batch([SQL.SQL_ASSIST_STORES, SQL.SQL_PLAN_WINDOW]);
  const bench = stores.find((s) => s.STORE_CODE === benchCode);
  if (!bench) throw new HopError(400, "Choose a benchmark store that exists.");
  const fromPeriod = await openingPeriod(body.openingDate || null, body.firstMonth || null);
  const defaultHalo = toNum(windowRows[0]?.DEFAULT_HALO_WEEKS) ?? 9;
  const halo = typeof body.haloWeeks === "number" && Number.isInteger(body.haloWeeks) ? body.haloWeeks : defaultHalo;

  const [months, totals, doctrine] = await batch([
    { sql: `${derivedMonthsSql(fromPeriod, body.openingDate || null)} ORDER BY FY_PERIOD_NO`, binds: [benchCode, benchCode, benchCode] },
    { sql: SQL.SQL_ASSIST_TOTALS, binds: [benchCode] },
    `SELECT DOCTRINE_VERSION, DOCTRINE_TEXT FROM ${S}.INSIGHT_DOCTRINE WHERE IS_ACTIVE ORDER BY DOCTRINE_VERSION DESC LIMIT 1`,
  ]);
  if (!months.length) throw new HopError(409, `${benchCode} has no sales in the months from the opening, so there is nothing to phase the new store on.`);

  // The same arithmetic, and rounding, as the add-store action.
  const byMonth = months.map((m) => {
    const sales = r2((toNum(m.BENCH_SALES) ?? 0) * pct);
    const margin = sales * (NEW_STORE_MARGIN_CURVE[String(m.MONTH_NAME)] ?? 0);
    return { month: String(m.MONTH_NAME), benchmark_sales_aud: Math.round(toNum(m.BENCH_SALES) ?? 0), new_store_sales_aud: Math.round(sales), margin };
  });
  const newSales = byMonth.reduce((a, m) => a + m.new_store_sales_aud, 0);
  const newMargin = byMonth.reduce((a, m) => a + m.margin, 0);
  const benchSales = byMonth.reduce((a, m) => a + m.benchmark_sales_aud, 0);
  const t = totals[0] ?? {};
  const plan = toNum(t.PLAN_AUD) ?? 0, ly = toNum(t.LY_AUD) ?? 0, nowNew = toNum(t.NEW_STORE_AUD) ?? 0;
  const lflPlan = toNum(t.LFL_PLAN_AUD) ?? 0, lflLy = toNum(t.LFL_LY_AUD) ?? 0;
  const benchHalf = toNum(t.BENCH_PLAN_AUD) ?? 0;

  const payload = {
    proposal: {
      store_name: body.storeName?.trim() || "the new store",
      opening: body.openingDate ? body.openingDate : `no date recorded: planned from ${byMonth[0].month}, date inferred`,
      benchmark: `${benchCode} ${shortName(bench.STORE_NAME)}${bench.IS_NEW_STORE === true ? " (itself a new store)" : ""}`,
      benchmark_share_pct: pctOf(pct),
      halo_weeks: halo,
    },
    impact: {
      months_trading: byMonth.length,
      by_month: byMonth.map(({ month, benchmark_sales_aud, new_store_sales_aud }) => ({ month, benchmark_sales_aud, new_store_sales_aud })),
      benchmark_sales_same_months_aud: benchSales,
      benchmark_half_plan_aud: Math.round(benchHalf),
      // Shares are supplied: the guardrail does not admit a ratio the model works out.
      new_store_vs_benchmark_half_pct: pctOf(benchHalf ? newSales / benchHalf : 0),
      new_store_sales_aud: newSales,
      new_store_margin_aud: Math.round(newMargin),
      new_store_margin_pct: pctOf(newSales ? newMargin / newSales : 0),
      plan_now_aud: Math.round(plan),
      plan_after_aud: Math.round(plan + newSales),
      total_growth_now_pct: pctOf(ly ? plan / ly - 1 : 0),
      total_growth_after_pct: pctOf(ly ? (plan + newSales) / ly - 1 : 0),
      new_store_share_now_pct: pctOf(plan ? nowNew / plan : 0),
      new_store_share_after_pct: pctOf(plan + newSales ? (nowNew + newSales) / (plan + newSales) : 0),
      lfl_pct_unchanged: pctOf(lflLy ? lflPlan / lflLy - 1 : 0),
    },
    how_it_is_planned: [
      "The new store's month = the benchmark's last-year weeks (its plan weeks, if the benchmark is new) x the share, from the opening week on.",
      "A store opening mid-month carries only the weeks from its opening week, phased on the benchmark's weekly shape; earlier weeks are zero.",
      "Margin follows the new-store curve: a store trades below the chain while its range beds in. It is POS margin, after discount.",
    ],
  };

  const d = doctrine[0];
  const prompt = [
    "You are advising the Head of Planning at Baby Mart, an Australian retailer of baby products, on whether a",
    "proposed store opening stacks up. Work only from the figures supplied.",
    "",
    "This is the head of planning's own method. Follow it where it and your instincts differ:",
    "",
    String(d?.DOCTRINE_TEXT ?? "(no method recorded)"),
    "",
    "For a store opening specifically:",
    "- A new store has no like-for-like. It is planned off a comparable store at a stated share, and that share",
    "  is the whole assumption: someone must own it.",
    "- The halo is the opening uplift. It must come out of next year's like-for-like base, or next year's growth",
    "  is overstated.",
    "- A store opening part-way through the half carries only the months it trades, so its first half is not",
    "  comparable to a full half.",
    "- Margin in the store plan is POS margin, after discount. First margin, at intake, lives in the MFP. Never",
    "  quote one as the other.",
    "",
    "Figures. Every number you write must appear here:",
    "",
    JSON.stringify(payload, null, 1),
    "",
    "Say what this proposal does to the plan and what must be settled before it is saved. Put every figure you",
    "rely on in figures_cited, as it appears above, and quote totals and shares rather than working them out.",
    "Write money as $ with M or K and rates with % or pts. Be direct about what the figures do not tell you.",
    "Do not offer illustrative or hypothetical numbers (\"say, 75% or 90%\"): every number you write is checked",
    "against the figures, and one that is not there marks the advice unverified.",
    "At most three findings and at most three questions, each two or three sentences: a planner reads this",
    "between meetings.",
    "",
    "Respond in JSON matching the required schema.",
  ].join("\n");
  const question = `${payload.proposal.store_name}: ${payload.proposal.benchmark} at ${payload.proposal.benchmark_share_pct}%, ${payload.proposal.opening}`;

  let answer: Row, usage: Usage;
  try {
    ({ answer, usage } = await complete(prompt, ADVISE_SCHEMA_SQL, 2200));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ question, payload, promptChars: prompt.length, error: message.slice(0, 2000), doctrineVersion: toNum(d?.DOCTRINE_VERSION), user });
    throw new HopError(502, `The assistant did not answer: ${message.slice(0, 300)}`);
  }
  const findings = Array.isArray(answer.findings) ? (answer.findings as Row[]) : [];
  const cited = findings.flatMap((f) => (Array.isArray(f.figures_cited) ? (f.figures_cited as unknown[]).map(String) : []));
  const questions = Array.isArray(answer.questions_to_settle) ? (answer.questions_to_settle as unknown[]).map(String) : [];
  const prose = [String(answer.headline ?? ""), ...findings.map((f) => String(f.observation ?? "")), ...questions];
  // The method is in the prompt too, so a number quoted from it is supplied.
  const check = verifyCitations({ figures: payload, method: String(d?.DOCTRINE_TEXT ?? "") }, cited, prose);
  await log({ question, payload, promptChars: prompt.length, response: answer, cited, unmatched: check.unmatched,
    verified: check.verified, usage, doctrineVersion: toNum(d?.DOCTRINE_VERSION), user });

  return {
    ok: true, mode: "ADVISE",
    headline: String(answer.headline ?? ""), findings, questionsToSettle: questions,
    confidence: String(answer.confidence ?? "LOW"), impact: payload.impact,
    isVerified: check.verified, unverifiedFigures: check.unmatched,
    doctrineVersion: toNum(d?.DOCTRINE_VERSION), model: MODEL, tokens: tokens(usage),
  };
}

export async function postStoreAssist(body: Body, user: string) {
  const mode = body?.mode ?? "PARSE";
  if (mode === "PARSE") return parse(body, user);
  if (mode === "ADVISE") return advise(body, user);
  throw new HopError(400, "mode must be PARSE or ADVISE.");
}
