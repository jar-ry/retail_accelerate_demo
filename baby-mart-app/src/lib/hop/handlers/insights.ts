// ─── Head of Planning: AI insights ────────────────────────────────────────────
//
// The model never touches the database. Each surface's payload is assembled here
// from queries the page itself already trusts, scaled for reading -- percentages
// as percentages, points as points -- and handed to AI_COMPLETE with a required
// response schema at temperature 0. Every number in the answer is then checked
// against the payload (src/lib/hop/insights.ts). Every run is logged, verified
// or not, including failures: hiding a failed insight would be a silent failure.

import { S } from "../schema";
import { batch, q, HopError, NOW, type Row } from "../db";
import { toNum } from "../format";
import { composePrompt, verifyCitations, proseOf, RESPONSE_FORMAT_SQL, type Insight } from "../insights";
import * as SQL from "../sql";

export const SURFACES = ["OVERVIEW", "STORE_PLAN", "MFP", "WSSI", "TPR"] as const;
type Surface = (typeof SURFACES)[number];
const MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5", "llama4-maverick", "mistral-large2"]);

const r2 = (v: unknown) => { const n = toNum(v); return n === null ? null : Math.round(n * 100) / 100; };
const aud = (v: unknown) => { const n = toNum(v); return n === null ? null : Math.round(n); };
const p = (v: unknown) => { const n = toNum(v); return n === null ? null : Math.round(n * 10000) / 100; };

async function payloadFor(surface: Surface): Promise<Record<string, unknown>> {
  if (surface === "OVERVIEW") {
    const [kpi, attention, tracking] = await batch([SQL.SQL_KPI, SQL.SQL_ATTENTION, SQL.SQL_TRACKING]);
    const k = kpi[0] ?? {};
    const plan = toNum(k.PLAN_TOTAL_AUD) ?? 0;
    return {
      plan_half: "FY27 H1 = July to December 2026",
      plan_sales_aud: aud(k.PLAN_TOTAL_AUD), approved_sales_aud: aud(k.APPROVED_SALES_AUD),
      ly_sales_aud: aud(k.LY_BASE_AUD), total_growth_pct: p((toNum(k.PLAN_TOTAL_AUD) ?? 0) / (toNum(k.LY_BASE_AUD) || 1) - 1),
      lfl_growth_pct: p((toNum(k.LFL_AUD) ?? 0) / (toNum(k.LFL_LY_AUD) || 1) - 1), new_store_sales_aud: aud(k.NEW_STORE_AUD),
      new_store_share_pct: p((toNum(k.NEW_STORE_AUD) ?? 0) / (plan || 1)), stores: k.STORES, new_stores: k.NEW_STORES,
      plan_pos_margin_pct: p((toNum(k.PLAN_MARGIN_AUD) ?? 0) / (plan || 1)), plan_first_margin_pct: p(k.PLAN_FIRST_MARGIN_PCT),
      exit_margin_this_year_pct: p(k.EXIT_MARGIN_PCT_ACTUAL),
      trading_to_date: {
        from: k.TD_FROM, to: k.ACTUALS_AS_AT, actual_sales_aud: aud(k.TY_TD_AUD),
        vs_ly_pct: p((toNum(k.TY_TD_AUD) ?? 0) / (toNum(k.LY_TD_AUD) || 1) - 1),
        vs_budget_pct: p((toNum(k.TY_TD_AUD) ?? 0) / (toNum(k.BUD_TD_AUD) || 1) - 1),
        vs_forecast_pct: p((toNum(k.TY_TD_AUD) ?? 0) / (toNum(k.FC_TD_AUD) || 1) - 1),
      },
      h1_latest_estimate_aud: aud(k.LE_H1_AUD), h1_budget_aud: aud(k.BUD_H1_AUD),
      h1_latest_vs_budget_pct: p((toNum(k.LE_H1_AUD) ?? 0) / (toNum(k.BUD_H1_AUD) || 1) - 1),
      product_plan_bottom_up_aud: aud(k.MFP_BOTTOM_UP_AUD), product_plan_gap_aud: aud((toNum(k.MFP_BOTTOM_UP_AUD) ?? 0) - plan),
      budget_on_dropped_options_aud: aud(k.SALES_AT_RISK_AUD),
      needs_attention: attention.filter((a) => (toNum(a.N) ?? 0) > 0).map((a) => ({ item: a.DESCRIPTION, count: a.N, severity: a.SEVERITY })),
      months: tracking.filter((t) => t.TIME_GRAIN === "MONTH").map((t) => ({
        month: `${t.PERIOD_LABEL} (${t.CAL_LABEL})`, state: t.PERIOD_STATE,
        actual_aud: aud(t.ACTUAL_AUD), budget_aud: aud(t.BUDGET_AUD), forecast_aud: aud(t.FORECAST_AUD), ly_aud: aud(t.LY_AUD),
      })),
    };
  }
  if (surface === "STORE_PLAN") {
    const [weeks, stores, drivers, variance] = await batch([SQL.SQL_STORE_PLAN_WEEKS, SQL.SQL_STORE_MASTER, SQL.SQL_STORE_DRIVERS, SQL.SQL_VARIANCE_BY_STORE]);
    const byStore = new Map<string, { ly: number; plan: number; margin: number; lflLy: number; lflPlan: number }>();
    for (const w of weeks) {
      const s = byStore.get(String(w.STORE_CODE)) ?? { ly: 0, plan: 0, margin: 0, lflLy: 0, lflPlan: 0 };
      s.ly += toNum(w.LY_SALES_AUD) ?? 0; s.plan += toNum(w.PLAN_SALES_AUD) ?? 0; s.margin += toNum(w.PLAN_MARGIN_AUD) ?? 0;
      if (w.IS_LFL_UNIVERSE === true) { s.lflLy += toNum(w.LY_SALES_AUD) ?? 0; s.lflPlan += toNum(w.PLAN_SALES_AUD) ?? 0; }
      byStore.set(String(w.STORE_CODE), s);
    }
    const name = (c: string) => String(stores.find((s) => s.STORE_CODE === c)?.STORE_NAME ?? c).replace("Baby Mart ", "");
    const ranked = [...byStore.entries()].filter(([, s]) => s.lflLy > 0).map(([c, s]) => ({ store: `${c} ${name(c)}`, lfl_pct: p(s.lflPlan / s.lflLy - 1), plan_sales_aud: aud(s.plan) }))
      .sort((a, b) => (b.lfl_pct ?? 0) - (a.lfl_pct ?? 0));
    const total = (xs: { plan_sales_aud: number | null }[]) => aud(xs.reduce((a, x) => a + (x.plan_sales_aud ?? 0), 0));
    const newStores = stores.filter((s) => s.IS_NEW_STORE === true);
    return {
      plan_half: "FY27 H1 = July to December 2026",
      // Totals are supplied, not left to the model: the guardrail admits only
      // pairwise arithmetic, so a five-term sum would read as unverifiable.
      highest_lfl_stores: ranked.slice(0, 5), highest_lfl_stores_total_plan_aud: total(ranked.slice(0, 5)),
      lowest_lfl_stores: ranked.slice(-5), lowest_lfl_stores_total_plan_aud: total(ranked.slice(-5)),
      new_stores_total_plan_aud: aud(newStores.reduce((a, s) => a + (byStore.get(String(s.STORE_CODE))?.plan ?? 0), 0)),
      new_stores: newStores.map((s) => ({
        store: `${s.STORE_CODE} ${name(String(s.STORE_CODE))}`, opening: s.OPENING_DATE ?? "not recorded", benchmark: `${s.BENCHMARK_STORE_CODE}`,
        benchmark_share_pct: p(s.BENCHMARK_PCT), plan_sales_aud: aud(byStore.get(String(s.STORE_CODE))?.plan),
      })),
      drivers_with_a_stated_reason: drivers.filter((d) => d.RATIONALE).map((d) => ({
        store: `${d.STORE_CODE} ${name(String(d.STORE_CODE))}`, month: d.MONTH_NAME, lfl_pct: p(d.LFL_PCT), margin_pct: p(d.MARGIN_PCT), reason: d.REASON_CODE, rationale: d.RATIONALE,
      })),
      moved_since_approval: variance.map((v) => ({ store: `${v.STORE_CODE} ${name(String(v.STORE_CODE))}`, status: v.BASELINE_STATUS, sales_change_aud: aud(v.SALES_VARIANCE_AUD) })),
    };
  }
  if (surface === "MFP") {
    const [grid, mix] = await batch([SQL.SQL_MFP_GRID, SQL.SQL_MFP_MIX]);
    const depts = grid.filter((g) => g.PLAN_LEVEL === "DEPARTMENT");
    const buTotal = depts.reduce((a, g) => a + (toNum(g.TPR_BUDGET) ?? 0), 0);
    const spTotal = toNum(mix[0]?.STORE_PLAN_TOTAL_AUD) ?? 0;
    return {
      plan_half: "FY27 H1 = July to December 2026",
      store_plan_total_aud: aud(spTotal), bottom_up_total_aud: aud(buTotal), bottom_up_gap_aud: aud(buTotal - spTotal),
      rbus: mix.map((m) => ({ rbu: `${m.RBU_CODE} ${m.RBU_DESCRIPTION}`, plan_mix_pct: p(m.PLAN_MIX_PCT_STATED), ly_mix_measured_pct: p(m.LY_MIX_PCT_MEASURED),
        budget_from_mix_aud: aud(m.PLAN_SALES_IMPLIED_AUD), bottom_up_aud: aud(m.TPR_BUDGET_AUD),
        gap_aud: aud((toNum(m.TPR_BUDGET_AUD) ?? 0) - (toNum(m.PLAN_SALES_IMPLIED_AUD) ?? 0)) })),
      // Shares are supplied rather than left for the model to work out: the
      // guardrail does not admit ratios, because almost any percentage is some
      // ratio of two supplied amounts.
      departments: depts.map((g) => ({
        department: `${g.ENTITY_CODE} ${g.ENTITY_NAME}`, ly_actual_aud: aud(g.F26_ACTUAL), lfl_pct: p(g.LFL_PCT), top_down_aud: aud(g.LFL_FORECAST),
        bottom_up_aud: aud(g.TPR_BUDGET), bottom_up_less_top_down_aud: aud((toNum(g.TPR_BUDGET) ?? 0) - (toNum(g.LFL_FORECAST) ?? 0)),
        share_of_bottom_up_pct: p((toNum(g.TPR_BUDGET) ?? 0) / (buTotal || 1)), share_of_store_plan_pct: p((toNum(g.TPR_BUDGET) ?? 0) / (spTotal || 1)),
        growth_stated_pct: p(g.GROWTH_STATED), growth_delivered_pct: p(g.GROWTH_DERIVED),
        growth_break_pts: p(g.GROWTH_BREAK_PTS), asp_growth_pct: p(g.ASP_GROWTH_PCT), unit_growth_pct: p(g.UNIT_GROWTH_PCT),
        first_margin_ly_pct: p(g.F26_FIRST_MARGIN_PCT), first_margin_plan_pct: p(g.F27_FIRST_MARGIN_PCT), first_margin_move_pts: p(g.FIRST_MARGIN_MOVE_PTS),
        pos_margin_plan_pct: p(g.POS_PCT), options_committed: g.OPT_COMMITTED, options_dropped: g.OPT_DESELECTED, budget_on_dropped_aud: aud(g.SALES_AT_RISK_AUD),
      })),
    };
  }
  if (surface === "WSSI") {
    const [rows, integrity, inputs] = await batch([{ sql: SQL.SQL_WSSI_GRAIN, binds: ["MONTH", "ALL"] }, SQL.SQL_WSSI_INTEGRITY, SQL.SQL_WSSI_INPUTS]);
    const months = [...new Set(rows.map((r) => String(r.PERIOD_KEY)))];
    const traded = rows.filter((r) => r.PERIOD_STATE === "TRADED");
    const sum = (ver: string, col = "SLS_AUD") => traded.filter((r) => r.VERSION === ver).reduce((a, r) => a + (toNum(r[col]) ?? 0), 0);
    const tAct = sum("TY"), tBud = sum("BUD"), tFc = sum("MERCH_FC"), tLy = sum("LY");
    return {
      note: "Stock is MODELLED, not measured: the store stock-on-hand feed implies implausible cover. Treat stock and cover as a model.",
      actuals_to: rows[0]?.LAST_ACTUAL_WEEK,
      // Totals over the fully traded months, supplied so they can be cited.
      fully_traded_months_total: {
        months: [...new Set(traded.map((r) => String(r.PERIOD_LABEL)))].join(", "),
        actual_sales_aud: aud(tAct), budget_sales_aud: aud(tBud), forecast_sales_aud: aud(tFc), ly_sales_aud: aud(tLy),
        actual_less_budget_aud: aud(tAct - tBud), actual_less_forecast_aud: aud(tAct - tFc), actual_less_ly_aud: aud(tAct - tLy),
        vs_budget_pct: p(tAct / (tBud || 1) - 1), vs_forecast_pct: p(tAct / (tFc || 1) - 1), vs_ly_pct: p(tAct / (tLy || 1) - 1),
      },
      months: months.map((pk) => {
        const v = (ver: string) => rows.find((r) => r.PERIOD_KEY === pk && r.VERSION === ver);
        const ty = v("TY"), ly = v("LY"), bud = v("BUD"), fc = v("MERCH_FC"), le = v("LE");
        const cover = le && toNum(le.FWD_N) ? (toNum(le.C_CLS_INV_AUD) ?? 0) / ((toNum(le.FWD_COGS4_AUD) ?? 0) / (toNum(le.FWD_N) as number) || 1) : null;
        return {
          month: `${le?.PERIOD_LABEL} (${le?.CAL_LABEL})`, state: le?.PERIOD_STATE,
          actual_sales_aud: aud(ty?.SLS_AUD), ly_sales_aud: aud(ly?.SLS_AUD), budget_sales_aud: aud(bud?.SLS_AUD), forecast_sales_aud: aud(fc?.SLS_AUD),
          actual_pos_margin_pct: ty ? p((toNum(ty.POS_GP_AUD) ?? 0) / (toNum(ty.SLS_AUD) || 1)) : null,
          budget_pos_margin_pct: bud ? p((toNum(bud.POS_GP_AUD) ?? 0) / (toNum(bud.SLS_AUD) || 1)) : null,
          closing_stock_cost_aud: aud(le?.C_CLS_INV_AUD), forward_cover_weeks: cover === null ? null : r2(cover),
          open_to_buy_cost_aud: aud(le?.OTB_C_AUD),
        };
      }),
      integrity_failures: integrity.map((i) => ({ check: i.CHECK_NAME, version: i.VERSION, breaches: i.BREACHES, rule: i.RULE })),
      planner_inputs: inputs.map((i) => ({ measure: i.MEASURE_CODE, period: i.TYPED_PERIOD_KEY, scope: i.RBU_SCOPE, typed: r2(i.TYPED_VALUE), rationale: i.RATIONALE })),
    };
  }
  const [funnel, cred, dept, sup] = await batch([SQL.SQL_FUNNEL, SQL.SQL_CREDIBILITY, SQL.SQL_ATTRITION_DEPT, SQL.SQL_ATTRITION_SUPPLIER]);
  const lost = dept.reduce((a, d) => a + (toNum(d.UNITS_LOST) ?? 0), 0);
  const byUnits = [...sup].sort((a, b) => (toNum(b.UNITS_LOST) ?? 0) - (toNum(a.UNITS_LOST) ?? 0));
  const top3 = byUnits.slice(0, 3).reduce((a, s) => a + (toNum(s.UNITS_LOST) ?? 0), 0);
  return {
    gates: funnel.map((f) => ({ gate: f.GATE_NAME, measurable: f.IS_MEASURABLE_TODAY, options: f.OPTIONS_AT_GATE, lost_pct: p(f.LOSS_PCT), units_lost: f.UNITS_LOST, budget_at_risk_aud: aud(f.SALES_AT_RISK_AUD) })),
    departments: cred.map((c) => ({ department: `${c.DEPARTMENT_NUM} ${c.DEPARTMENT_NAME}`, presented: c.OPT_PRESENTED, committed: c.OPT_COMMITTED,
      dropped: c.OPT_DESELECTED, adoption_pct: p(c.ADOPTION_PCT), credible_minimum_pct: p(c.MIN_CREDIBLE_ADOPTION_PCT),
      status: c.CREDIBILITY_STATUS, budget_on_dropped_aud: aud(c.SALES_AT_RISK_AUD) })),
    total_units_short_shipped: lost,
    short_ship_by_department: dept.map((d) => ({ department: d.DEPARTMENT_NAME, short_ship_pct: p(d.ATTRITION_PCT), units_lost: d.UNITS_LOST,
      share_of_units_lost_pct: p((toNum(d.UNITS_LOST) ?? 0) / (lost || 1)), orders: d.POS })),
    suppliers_by_units_lost: byUnits.slice(0, 6).map((s) => ({ supplier: s.SUPPLIER_NAME, short_ship_pct: p(s.ATTRITION_PCT), units_lost: s.UNITS_LOST,
      share_of_units_lost_pct: p((toNum(s.UNITS_LOST) ?? 0) / (lost || 1)) })),
    top_3_suppliers_units_lost: top3, top_3_suppliers_share_pct: p(top3 / (lost || 1)),
  };
}

export async function getInsight(surface: string | null) {
  const s = (surface ?? "").toUpperCase();
  if (!(SURFACES as readonly string[]).includes(s)) throw new HopError(400, `No insights for '${surface}'.`);
  const [latest, template] = await batch([
    { sql: `SELECT * FROM ${S}.VW_INSIGHT_LATEST WHERE SURFACE = ?`, binds: [s] },
    { sql: `SELECT TEMPLATE_ID, NAME, MODEL FROM ${S}.INSIGHT_TEMPLATE WHERE SURFACE = ? AND IS_ACTIVE`, binds: [s] },
  ]);
  return { latest: latest[0] ?? null, template: template[0] ?? null };
}

function parseVariant(v: unknown): Row {
  if (v === null || v === undefined) return {};
  return typeof v === "string" ? JSON.parse(v) : (v as Row);
}

export async function generateInsight(body: { surface?: string; question?: string | null }, user: string) {
  const surface = String(body.surface ?? "").toUpperCase() as Surface;
  if (!(SURFACES as readonly string[]).includes(surface)) throw new HopError(400, `No insights for '${body.surface}'.`);
  const question = body.question?.trim().slice(0, 600) || null;
  const [doctrine, template] = await batch([
    `SELECT DOCTRINE_VERSION, DOCTRINE_TEXT, TONE FROM ${S}.INSIGHT_DOCTRINE WHERE IS_ACTIVE ORDER BY DOCTRINE_VERSION DESC LIMIT 1`,
    { sql: `SELECT * FROM ${S}.INSIGHT_TEMPLATE WHERE SURFACE = ? AND IS_ACTIVE`, binds: [surface] },
  ]);
  if (!doctrine.length || !template.length) throw new HopError(409, "No method or template is set for this surface. Set one on the Settings page.");
  const d = doctrine[0], t = template[0];
  const model = String(t.MODEL);
  if (!MODELS.has(model)) throw new HopError(409, `The template's model '${model}' is not supported.`);
  const payload = await payloadFor(surface);
  const prompt = composePrompt({
    doctrine: String(d.DOCTRINE_TEXT), tone: d.TONE ? String(d.TONE) : null, doctrineVersion: Number(d.DOCTRINE_VERSION),
    taskInstruction: String(t.TASK_INSTRUCTION), focusMeasures: t.FOCUS_MEASURES ? String(t.FOCUS_MEASURES) : null,
    maxFindings: Number(t.MAX_FINDINGS ?? 4), payload, question,
  });

  const log = async (o: { response?: unknown; cited?: string[]; unmatched?: string[]; verified?: boolean; usage?: Row; error?: string }) => {
    await q(
      `INSERT INTO ${S}.INSIGHT_RUN (SURFACE, TEMPLATE_ID, DOCTRINE_VERSION, MODEL, QUESTION, GROUNDING_PAYLOAD, PROMPT_CHARS, RESPONSE,
         FIGURES_CITED, UNVERIFIED_FIGURES, IS_VERIFIED, PROMPT_TOKENS, COMPLETION_TOKENS, TOTAL_TOKENS, ERROR_MESSAGE, GENERATED_BY, GENERATED_AT)
       SELECT ?, ?, ?, ?, ?, PARSE_JSON(?), ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ?, ?, ?, ${NOW}`,
      [surface, t.TEMPLATE_ID, d.DOCTRINE_VERSION, model, question, JSON.stringify(payload), prompt.length,
        o.response === undefined ? null : JSON.stringify(o.response), JSON.stringify(o.cited ?? []), JSON.stringify(o.unmatched ?? []),
        o.verified ?? false, toNum(o.usage?.prompt_tokens), toNum(o.usage?.completion_tokens), toNum(o.usage?.total_tokens), o.error ?? null, user],
    );
  };

  let result: Row;
  try {
    // The model is validated against a fixed list above, so it is safe to inline;
    // response_format must be a SQL object literal, not a bind.
    const r = await q(
      `SELECT AI_COMPLETE(model => '${model}', prompt => ?, model_parameters => {'temperature': 0, 'max_tokens': 3500},
                          response_format => ${RESPONSE_FORMAT_SQL}, show_details => TRUE) AS R`,
      [prompt],
    );
    // NULL is what an answer cut off by the token limit comes back as: the
    // structured output fails validation and AI_COMPLETE returns nothing.
    if (r[0]?.R == null) throw new Error("The answer was cut off before it finished. Try again, or ask a narrower question.");
    result = parseVariant(r[0]?.R);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ error: message.slice(0, 2000) });
    throw new HopError(502, `The model did not answer: ${message.slice(0, 300)}`);
  }
  const structured = (result.structured_output as Row[] | undefined)?.[0]?.raw_message as Insight | undefined;
  if (!structured || !Array.isArray(structured.findings)) {
    await log({ response: result, error: "The response did not follow the schema." });
    throw new HopError(502, "The model's answer did not follow the required shape. It has been logged.");
  }
  const cited = structured.findings.flatMap((f) => f.figures_cited ?? []);
  // The method and the task are supplied in the prompt too, so a number quoted
  // from them ("cover above 26 weeks") is supplied, not invented.
  const check = verifyCitations({ figures: payload, method: String(d.DOCTRINE_TEXT), task: String(t.TASK_INSTRUCTION) }, cited, proseOf(structured));
  await log({ response: structured, cited, unmatched: check.unmatched, verified: check.verified, usage: result.usage as Row });
  return { ok: true, surface, verified: check.verified, unmatched: check.unmatched };
}
