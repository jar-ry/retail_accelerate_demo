// ─── Head of Planning: store plan ─────────────────────────────────────────────
//
// Snowflake stays the calculation engine. Writes update a DRIVER (LFL %, margin
// %, a new store's monthly sales or its benchmark) and record the change; the
// client then re-reads VW_STORE_PLAN_WEEKLY. Nothing is recalculated in the
// browser except roll-ups of what the view returns.
//
// Precedence between a month driver and a week edit is decided by timestamp in
// the view: a week override wins only if it is newer than the driver. So a month
// edit needs no clean-up of earlier week edits -- stamping the driver supersedes
// them. The reference implementation wrote a week override per week instead,
// which on its deploy path changed nothing at all.

import { S } from "../schema";
import { batch, q, tx, HopError, NOW, type Row } from "../db";
import { assertEditable, overrideInsert, type EditRequest } from "../ownership";
import { MARKET, PLAN_FY, PLAN_MONTHS, STORE_STATES, STORE_REGIONS, STORE_FORMATS } from "../config";
import { toNum, isoDate } from "../format";
import * as SQL from "../sql";

const WEEKLY = `${S}.VW_STORE_PLAN_WEEKLY`;

/** The new-store margin curve, a planning default: a store trades below the chain
 *  while its range beds in. The same curve sql/30 seeded the four openings with. */
export const NEW_STORE_MARGIN_CURVE: Record<string, number> = {
  JUL: 0.34, AUG: 0.35, SEP: 0.36, OCT: 0.37, NOV: 0.375, DEC: 0.36,
};

const LFL_RANGE: [number, number] = [-1, 5];
const MARGIN_RANGE: [number, number] = [-0.5, 0.95];

type Edit = EditRequest & {
  storeCode?: string;
  monthName?: string;
  weekEndDate?: string;
  measure?: string;
  newValue?: number;
  currentValue?: number | null;
  scenarioId?: number | null;
};

// ─── Read ─────────────────────────────────────────────────────────────────────

async function baselineId(): Promise<number> {
  const r = await q(`SELECT MIN(SCENARIO_ID) AS ID FROM ${S}.PLAN_SCENARIO WHERE SCENARIO_KIND = 'BASELINE'`);
  return Number(r[0]?.ID ?? 1);
}

/** A scenario id that is a sandbox, or null for the live plan. */
async function sandboxOf(id: number | null | undefined): Promise<Row | null> {
  if (!id) return null;
  const r = await q(`SELECT * FROM ${S}.PLAN_SCENARIO WHERE SCENARIO_ID = ?`, [id]);
  if (!r.length) throw new HopError(404, `Scenario ${id} does not exist.`);
  return r[0].SCENARIO_KIND === "SANDBOX" ? r[0] : null;
}

export async function getStorePlan(scenarioId: number | null) {
  const sandbox = await sandboxOf(scenarioId);
  const sid = sandbox ? Number(sandbox.SCENARIO_ID) : 0;
  const [weeks, stores, drivers, recon, reasons, ownership, history, approval, scenarios, months, variance, comments, events, targets, periods, live] =
    await batch([
      sandbox ? { sql: SQL.SQL_SCENARIO_WEEKS, binds: [sid] } : SQL.SQL_STORE_PLAN_WEEKS,
      SQL.SQL_STORE_MASTER,
      SQL.SQL_STORE_DRIVERS,
      SQL.SQL_STORE_PLAN_RECON,
      SQL.SQL_REASON_CODES,
      { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["STORE_PLAN"] },
      SQL.SQL_STORE_PLAN_HISTORY,
      SQL.SQL_LATEST_APPROVAL,
      SQL.SQL_SCENARIOS,
      SQL.SQL_PLAN_MONTHS,
      SQL.SQL_STORE_VARIANCE,
      { sql: SQL.SQL_STORE_COMMENTS, binds: [sid] },
      { sql: SQL.SQL_SCENARIO_EVENTS, binds: [sid] },
      { sql: SQL.SQL_SCENARIO_TARGETS, binds: [sid] },
      { sql: SQL.SQL_SCENARIO_PERIODS, binds: [sid] },
      SQL.SQL_LIVE_TOTALS,
    ]);
  return {
    scenario: sandbox,
    weeks, stores, drivers, recon, reasons, ownership, history,
    approval: approval[0] ?? null,
    scenarios, months, variance, comments, events, targets, periods,
    live: live[0] ?? null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireRate(measure: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HopError(400, "Enter a number.");
  const [lo, hi] = measure.includes("LFL") ? LFL_RANGE : MARGIN_RANGE;
  if (v < lo || v > hi) {
    throw new HopError(
      400,
      measure.includes("LFL")
        ? "LFL must be between -100% and +500%. Enter it as a decimal, e.g. 0.045 for 4.5%."
        : "Margin must be between -50% and 95%. Enter it as a decimal, e.g. 0.38 for 38%.",
    );
  }
  return v;
}

function isStale(supplied: number | null | undefined, actual: number | null): boolean {
  if (supplied === undefined) return false;
  if (supplied === null || actual === null) return supplied !== actual;
  return Math.abs(supplied - actual) > 1e-6;
}

/** Structural changes belong to the live plan; a sandbox replans drivers only. */
async function liveOnly(scenarioId: number | null | undefined, what: string) {
  if (await sandboxOf(scenarioId)) throw new HopError(409, `${what} applies to the live plan, not a sandbox. Switch to the live plan to do it.`);
}

async function storeRow(code: string | undefined): Promise<Row> {
  if (!code) throw new HopError(400, "A store is required.");
  const r = await q(`SELECT * FROM ${S}.DIM_STORE WHERE STORE_CODE = ?`, [code]);
  if (!r.length) throw new HopError(404, `Store ${code} does not exist.`);
  return r[0];
}

function requireMonth(m: string | undefined): string {
  if (!m || !(PLAN_MONTHS as readonly string[]).includes(m)) throw new HopError(400, "A plan month (JUL-DEC) is required.");
  return m;
}

/** The month's effective rate as the grid shows it, rebuilt from the weeks. */
async function monthRates(storeCode: string, month: string) {
  const r = await q(
    `SELECT SUM(LY_SALES_AUD) AS LY, SUM(PLAN_SALES_AUD) AS SALES, SUM(PLAN_MARGIN_AUD) AS MARGIN,
            SUM(IFF(IS_LFL_UNIVERSE, PLAN_SALES_AUD, 0)) AS LFL_PLAN, SUM(IFF(IS_LFL_UNIVERSE, LY_SALES_AUD, 0)) AS LFL_LY,
            COUNT(*) AS WEEKS
       FROM ${WEEKLY} WHERE STORE_CODE = ? AND MONTH_NAME = ?`,
    [storeCode, month],
  );
  const x = r[0] ?? {};
  const lflLy = toNum(x.LFL_LY) ?? 0;
  const sales = toNum(x.SALES) ?? 0;
  return {
    weeks: Number(x.WEEKS ?? 0),
    ly: toNum(x.LY) ?? 0,
    sales,
    margin: toNum(x.MARGIN) ?? 0,
    lfl: lflLy ? (toNum(x.LFL_PLAN) ?? 0) / lflLy - 1 : null,
    marginPct: sales ? (toNum(x.MARGIN) ?? 0) / sales : null,
  };
}

async function planTotals() {
  const r = await q(`SELECT SUM(PLAN_SALES_AUD) AS SALES, SUM(PLAN_MARGIN_AUD) AS MARGIN FROM ${WEEKLY}`);
  return { planSales: toNum(r[0]?.SALES), planMargin: toNum(r[0]?.MARGIN) };
}

// ─── Driver edits ─────────────────────────────────────────────────────────────

/** One driver cell: a month or a week, live or in a sandbox. */
async function editDriver(b: Edit, user: string) {
  const measure = b.measure ?? "";
  if (measure !== "LFL_PCT" && measure !== "MARGIN_PCT") {
    throw new HopError(400, `'${measure}' is not a store plan driver. Only LFL % and margin % are typed; everything else is calculated from them.`);
  }
  const value = requireRate(measure, b.newValue);
  const store = await storeRow(b.storeCode);
  const isNew = store.IS_NEW_STORE === true;
  if (isNew && measure === "LFL_PCT") {
    throw new HopError(409, "A new store has no like-for-like: it has no last year to compare with. Plan its sales or re-base it instead.");
  }
  const storeCode = String(store.STORE_CODE);

  // ── sandbox: prompt-free, and never touches a live driver
  const sandbox = await sandboxOf(b.scenarioId);
  if (sandbox) {
    if (sandbox.STATUS !== "DRAFT") throw new HopError(409, "This sandbox has been submitted and is read-only.");
    const weekFilter = b.weekEndDate ? "s.TY_WEEK_END_DATE = TO_DATE(?)" : "s.MONTH_NAME = ?";
    const open = await q(
      `SELECT COUNT(*) AS N FROM ${S}.STORE_PLAN_WEEK_SLOT s
         JOIN ${S}.PLAN_SCENARIO_PERIOD p ON p.SCENARIO_ID = ? AND p.PERIOD_KEY = s.PERIOD_KEY AND p.IS_SELECTED
        WHERE ${weekFilter}`,
      [sandbox.SCENARIO_ID, b.weekEndDate ?? requireMonth(b.monthName)],
    );
    if (Number(open[0]?.N ?? 0) === 0) throw new HopError(409, "That month is not one this sandbox replans. Add it on the sandbox's months first.");
    await tx([
      {
        sql: `INSERT INTO ${S}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
              SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, ?, ?, 'EDIT', ?, ${NOW}
                FROM ${WEEKLY} w JOIN ${S}.STORE_PLAN_WEEK_SLOT s ON s.TY_WEEK_END_DATE = w.WEEK_END_DATE
               WHERE w.STORE_CODE = ? AND ${weekFilter} AND (? <> 'LFL_PCT' OR w.IS_LFL_UNIVERSE)
                 -- only weeks the sandbox copied: a store added to the live plan
                 -- afterwards is not part of this scenario
                 AND EXISTS (SELECT 1 FROM ${S}.STORE_PLAN_SCENARIO_CELL c
                              WHERE c.SCENARIO_ID = ? AND c.BATCH = 'SCENARIO_SNAPSHOT'
                                AND c.STORE_CODE = w.STORE_CODE AND c.WEEK_END_DATE = w.WEEK_END_DATE)`,
        binds: [sandbox.SCENARIO_ID, measure, value, user, storeCode, b.weekEndDate ?? b.monthName, measure, sandbox.SCENARIO_ID],
      },
      {
        sql: `UPDATE ${S}.PLAN_SCENARIO SET CURRENT_REVISION = CURRENT_REVISION + 1, UPDATED_AT = ${NOW} WHERE SCENARIO_ID = ?`,
        binds: [sandbox.SCENARIO_ID],
      },
    ]);
    return { ok: true, scenarioId: Number(sandbox.SCENARIO_ID), storeCode, measure, newValue: value };
  }

  // ── live: governed
  const grant = await assertEditable("STORE_PLAN", measure, b);

  if (b.weekEndDate) {
    const wk = await q(
      `SELECT MONTH_NAME, ${measure} AS OLD_VALUE, IS_LFL_UNIVERSE FROM ${WEEKLY} WHERE STORE_CODE = ? AND WEEK_END_DATE = TO_DATE(?)`,
      [storeCode, b.weekEndDate],
    );
    if (!wk.length) throw new HopError(404, `${storeCode} does not trade in the week ending ${b.weekEndDate}.`);
    if (measure === "LFL_PCT" && wk[0].IS_LFL_UNIVERSE !== true) throw new HopError(409, "LFL % does not apply to a new-store week.");
    const oldValue = toNum(wk[0].OLD_VALUE);
    if (isStale(b.currentValue, oldValue)) throw new HopError(409, "This week changed after you selected it. Refresh and try again.");
    await tx([
      {
        sql: `INSERT INTO ${S}.STORE_PLAN_WEEK_OVERRIDE
                (MARKET_CODE, SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, OLD_VALUE, NEW_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
              SELECT ?, NULL, ?, TO_DATE(?), ?, ?, ?, ?, ?, ?, ${NOW}`,
        binds: [MARKET, storeCode, b.weekEndDate, measure, oldValue, value, grant.reasonCode, grant.rationale, user],
      },
      overrideInsert({ grant, planKind: "STORE_PLAN_WEEK", entityCode: storeCode, monthName: String(wk[0].MONTH_NAME), oldValue, newValue: value, changedBy: user }),
    ]);
    return { ok: true, storeCode, weekEndDate: b.weekEndDate, measure, oldValue, newValue: value, isPostLockAmendment: grant.isPostLockAmendment, ...(await planTotals()) };
  }

  const month = requireMonth(b.monthName);
  const before = await monthRates(storeCode, month);
  if (!before.weeks) throw new HopError(404, `${storeCode} does not trade in ${month}.`);
  const oldValue = measure === "LFL_PCT" ? before.lfl : before.marginPct;
  if (isStale(b.currentValue, oldValue)) throw new HopError(409, "This month changed after you selected it. Refresh and try again.");

  const write = isNew
    ? {
        sql: `UPDATE ${S}.STORE_PLAN_NEW_STORE_MARGIN SET MARGIN_PCT = ?, CHANGED_AT = ${NOW}
               WHERE STORE_CODE = ? AND MONTH_NAME = ? AND FY_YEAR = ?`,
        binds: [value, storeCode, month, PLAN_FY],
      }
    : {
        sql: `UPDATE ${S}.STORE_PLAN_DRIVER
                 SET ${measure} = ?, ${measure === "LFL_PCT" ? "LFL_CHANGED_AT" : "MARGIN_CHANGED_AT"} = ${NOW},
                     RATIONALE = ?, REASON_CODE = ?
               WHERE STORE_CODE = ? AND MONTH_NAME = ? AND FY_YEAR = ?`,
        binds: [value, grant.rationale, grant.reasonCode, storeCode, month, PLAN_FY],
      };
  await tx([write, overrideInsert({ grant, planKind: "STORE_PLAN", entityCode: storeCode, monthName: month, oldValue, newValue: value, changedBy: user })]);
  return { ok: true, storeCode, monthName: month, measure, oldValue, newValue: value, isPostLockAmendment: grant.isPostLockAmendment, ...(await planTotals()) };
}

// ─── Half cascade ─────────────────────────────────────────────────────────────

/** A top-down edit to the half, redistributed so the monthly SHAPE is kept:
 *  sales and LFL scale every month by the same factor, margin shifts every month
 *  by the same points. Each lands exactly on the target. Every month is checked
 *  before any is written, so one out-of-range month fails the whole edit rather
 *  than leaving a half-applied cascade. */
async function editHalf(b: Edit, user: string) {
  const measure = b.measure ?? "";
  if (!["H1_PLAN_SALES_AUD", "H1_MARGIN_PCT", "H1_LFL_PCT"].includes(measure)) {
    throw new HopError(400, `'${measure}' is not a half-level measure.`);
  }
  if (typeof b.newValue !== "number" || !Number.isFinite(b.newValue)) throw new HopError(400, "Enter a number.");
  await liveOnly(b.scenarioId, "A half cascade");
  const target = b.newValue;
  const store = await storeRow(b.storeCode);
  const storeCode = String(store.STORE_CODE);
  const isNew = store.IS_NEW_STORE === true;
  if (isNew && measure === "H1_LFL_PCT") throw new HopError(409, "A new store has no like-for-like to set.");
  if (measure === "H1_PLAN_SALES_AUD" && target <= 0) throw new HopError(400, "Half sales must be above zero.");
  if (measure !== "H1_PLAN_SALES_AUD") requireRate(measure, target);

  const grant = await assertEditable("STORE_PLAN", measure, b);
  const rows = await q(
    `SELECT MONTH_NAME, SUM(LY_SALES_AUD) AS LY, SUM(PLAN_SALES_AUD) AS SALES, SUM(PLAN_MARGIN_AUD) AS MARGIN
       FROM ${WEEKLY} WHERE STORE_CODE = ? GROUP BY MONTH_NAME`,
    [storeCode],
  );
  const months = rows.map((r) => ({
    month: String(r.MONTH_NAME),
    ly: toNum(r.LY) ?? 0,
    sales: toNum(r.SALES) ?? 0,
    margin: toNum(r.MARGIN) ?? 0,
  }));
  const totSales = months.reduce((a, m) => a + m.sales, 0);
  const totLy = months.reduce((a, m) => a + m.ly, 0);
  const totMargin = months.reduce((a, m) => a + m.margin, 0);
  const current =
    measure === "H1_PLAN_SALES_AUD" ? totSales : measure === "H1_MARGIN_PCT" ? (totSales ? totMargin / totSales : null) : totLy ? totSales / totLy - 1 : null;
  if (current === null || !totSales) throw new HopError(409, "This store has no plan to cascade from.");
  if (isStale(b.currentValue, current)) throw new HopError(409, "The half changed after you selected it. Refresh and try again.");

  const k = measure === "H1_PLAN_SALES_AUD" ? target / totSales : measure === "H1_LFL_PCT" ? (1 + target) / (1 + (current as number)) : 1;
  const delta = measure === "H1_MARGIN_PCT" ? target - (current as number) : 0;
  const plan = months.map((m) => {
    const mPct = m.sales ? m.margin / m.sales : 0;
    if (measure === "H1_MARGIN_PCT") return { ...m, old: mPct, next: mPct + delta };
    if (isNew) return { ...m, old: m.sales, next: m.sales * k };
    const lfl = m.ly ? m.sales / m.ly - 1 : 0;
    return { ...m, old: lfl, next: (1 + lfl) * k - 1 };
  });
  for (const p of plan) {
    const bounds = measure === "H1_MARGIN_PCT" ? MARGIN_RANGE : isNew ? null : LFL_RANGE;
    if (bounds && (p.next < bounds[0] || p.next > bounds[1])) {
      throw new HopError(400, `${p.month} would move to ${(p.next * 100).toFixed(1)}%, outside the allowed range. Nothing was changed.`);
    }
  }

  const values = plan.map(() => "(?, ?)").join(", ");
  const vbinds = plan.flatMap((p) => [p.month, p.next]);
  let write: { sql: string; binds: unknown[] };
  if (measure === "H1_MARGIN_PCT" && isNew) {
    write = {
      sql: `UPDATE ${S}.STORE_PLAN_NEW_STORE_MARGIN t SET MARGIN_PCT = v.NEW_VALUE, CHANGED_AT = ${NOW}
              FROM (SELECT column1 AS MONTH_NAME, column2::FLOAT AS NEW_VALUE FROM VALUES ${values}) v
             WHERE t.STORE_CODE = ? AND t.FY_YEAR = ? AND t.MONTH_NAME = v.MONTH_NAME`,
      binds: [...vbinds, storeCode, PLAN_FY],
    };
  } else if (isNew) {
    write = {
      sql: `UPDATE ${S}.STORE_PLAN_NEW_STORE t
               SET MONTHLY_SALES_AUD = v.NEW_VALUE, IS_DERIVED = FALSE, CHANGED_AT = ${NOW},
                   DERIVATION = 'Half cascade to ' || ? || ' across the trading months'
              FROM (SELECT column1 AS MONTH_NAME, column2::FLOAT AS NEW_VALUE FROM VALUES ${values}) v
             WHERE t.STORE_CODE = ? AND t.FY_YEAR = ? AND t.MONTH_NAME = v.MONTH_NAME`,
      binds: [Math.round(target).toLocaleString("en-AU"), ...vbinds, storeCode, PLAN_FY],
    };
  } else {
    const col = measure === "H1_MARGIN_PCT" ? "MARGIN_PCT" : "LFL_PCT";
    const stamp = measure === "H1_MARGIN_PCT" ? "MARGIN_CHANGED_AT" : "LFL_CHANGED_AT";
    write = {
      sql: `UPDATE ${S}.STORE_PLAN_DRIVER t SET ${col} = v.NEW_VALUE, ${stamp} = ${NOW}, RATIONALE = ?, REASON_CODE = ?
              FROM (SELECT column1 AS MONTH_NAME, column2::FLOAT AS NEW_VALUE FROM VALUES ${values}) v
             WHERE t.STORE_CODE = ? AND t.FY_YEAR = ? AND t.MONTH_NAME = v.MONTH_NAME`,
      binds: [grant.rationale, grant.reasonCode, ...vbinds, storeCode, PLAN_FY],
    };
  }
  const monthMeasure = measure === "H1_MARGIN_PCT" ? "MARGIN_PCT" : isNew ? "MONTHLY_SALES_AUD" : "LFL_PCT";
  await tx([
    write,
    overrideInsert({ grant, planKind: "STORE_PLAN", entityCode: storeCode, monthName: "H1", oldValue: current, newValue: target, changedBy: user }),
    ...plan.map((p) =>
      overrideInsert({ grant, planKind: "STORE_PLAN", entityCode: storeCode, monthName: p.month, oldValue: p.old, newValue: p.next, changedBy: user, measureCode: monthMeasure }),
    ),
  ]);
  return { ok: true, storeCode, measure, oldValue: current, newValue: target, months: plan.map((p) => ({ month: p.month, old: p.old, next: p.next })), ...(await planTotals()) };
}

// ─── Outcome override, re-base, revert ────────────────────────────────────────

/** Name the sales figure; the driver is back-solved to reach it, so the grid stays
 *  explained: a comparable store's LFL, or a new store's monthly plan. */
async function editValue(b: Edit & { targetSales?: number }, user: string) {
  const target = b.targetSales;
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0) throw new HopError(400, "Enter the sales you want for the month.");
  const store = await storeRow(b.storeCode);
  const storeCode = String(store.STORE_CODE);
  const month = requireMonth(b.monthName);

  const sandbox = await sandboxOf(b.scenarioId);
  if (sandbox) {
    if (sandbox.STATUS !== "DRAFT") throw new HopError(409, "This sandbox has been submitted and is read-only.");
    if (store.IS_NEW_STORE !== true) {
      // Last year is the same in a sandbox, so the back-solve is too.
      const ly = (await monthRates(storeCode, month)).ly;
      if (!ly) throw new HopError(409, "This store has no last year in that month to grow from.");
      return editDriver({ ...b, measure: "LFL_PCT", newValue: target / ly - 1, currentValue: undefined }, user);
    }
    const sid = Number(sandbox.SCENARIO_ID);
    const cur = await q(
      `SELECT SUM(PLAN_SALES_AUD) AS SHOWN, SUM(BASE_SALES_AUD) AS BASE FROM (${SQL.SQL_SCENARIO_WEEKS})
        WHERE STORE_CODE = ? AND MONTH_NAME = ? AND PERIOD_KEY IN (SELECT PERIOD_KEY FROM ${S}.PLAN_SCENARIO_PERIOD WHERE SCENARIO_ID = ? AND IS_SELECTED)`,
      [sid, storeCode, month, sid],
    );
    const shown = toNum(cur[0]?.SHOWN);
    if (!shown) throw new HopError(409, "That month is closed or not replanned in this sandbox, so there are no sales to scale.");
    // Scaling every week's base by one factor lands the month on the target
    // whatever events are applied, because each event multiplies its week.
    await q(
      `INSERT INTO ${S}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
       SELECT ?, STORE_CODE, WEEK_END_DATE, 'SALES_AUD', BASE_SALES_AUD * ?, 'EDIT', ?, ${NOW}
         FROM (${SQL.SQL_SCENARIO_WEEKS}) WHERE STORE_CODE = ? AND MONTH_NAME = ?`,
      [sid, target / shown, user, sid, storeCode, month],
    );
    return { ok: true, scenarioId: sid, storeCode, monthName: month, newValue: target };
  }

  const before = await monthRates(storeCode, month);
  if (!before.weeks) throw new HopError(404, `${storeCode} does not trade in ${month}.`);
  if (isStale(b.currentValue, before.sales)) throw new HopError(409, "This month changed after you selected it. Refresh and try again.");

  if (store.IS_NEW_STORE !== true) {
    if (!before.ly) throw new HopError(409, "This store has no last year in that month to grow from.");
    const lfl = target / before.ly - 1;
    const why = `Back-solved from a sales target of $${Math.round(target).toLocaleString("en-AU")}. ${b.rationale?.trim() ?? ""}`.trim();
    return editDriver({ ...b, measure: "LFL_PCT", newValue: lfl, currentValue: before.lfl, rationale: why }, user);
  }
  const grant = await assertEditable("STORE_PLAN", "MONTHLY_SALES_AUD", b);
  await tx([
    {
      sql: `UPDATE ${S}.STORE_PLAN_NEW_STORE SET MONTHLY_SALES_AUD = ?, IS_DERIVED = FALSE,
                   DERIVATION = 'Typed over the benchmark', CHANGED_AT = ${NOW}
             WHERE STORE_CODE = ? AND MONTH_NAME = ? AND FY_YEAR = ?`,
      binds: [target, storeCode, month, PLAN_FY],
    },
    overrideInsert({ grant, planKind: "STORE_PLAN", entityCode: storeCode, monthName: month, oldValue: before.sales, newValue: target, changedBy: user }),
  ]);
  return { ok: true, storeCode, monthName: month, measure: "MONTHLY_SALES_AUD", oldValue: before.sales, newValue: target, ...(await planTotals()) };
}

/** The months a new store's plan derives from a benchmark at a share. A
 *  comparable benchmark contributes its real last year; a NEW benchmark its own
 *  plan, so a chain of openings resolves in order. The opening month counts only
 *  the weeks from the opening week, so a store opening mid-month gets a part
 *  month -- the view phases it over those weeks alone. Binds: benchmark code
 *  three times. Shared with the AI assist, so the impact it explains is exactly
 *  what adding the store would write. */
export function derivedMonthsSql(fromPeriod: number, openingDate?: string | null) {
  // Interpolated only after it is proven to be an ISO date.
  if (openingDate && !/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) throw new HopError(400, "The opening date must be YYYY-MM-DD.");
  const from = openingDate ? `s.TY_WEEK_END_DATE >= '${openingDate}'::DATE` : "TRUE";
  return `
    SELECT s.MONTH_NAME, MIN(s.FY_PERIOD_NO) AS FY_PERIOD_NO,
           IFF(MAX(n.MONTHLY_SALES_AUD) IS NOT NULL,
               SUM(IFF(${from}, v.PLAN_SALES_AUD, 0)),
               SUM(IFF(${from}, a.SALES_AUD, 0))) AS BENCH_SALES
      FROM ${S}.STORE_PLAN_WEEK_SLOT s
      LEFT JOIN ${S}.STORE_PLAN_ACTUAL a ON a.STORE_CODE = ? AND a.WEEK_END_DATE = s.LY_WEEK_END_DATE
      LEFT JOIN ${S}.STORE_PLAN_NEW_STORE n ON n.STORE_CODE = ? AND n.MONTH_NAME = s.MONTH_NAME AND n.FY_YEAR = s.FY_YEAR
      LEFT JOIN ${S}.VW_STORE_PLAN_WEEKLY v ON v.STORE_CODE = ? AND v.WEEK_END_DATE = s.TY_WEEK_END_DATE
     WHERE s.FY_PERIOD_NO >= ${Number(fromPeriod)}
     GROUP BY s.MONTH_NAME
    HAVING BENCH_SALES > 0`;
}

async function rebase(b: Edit & { benchmarkStoreCode?: string; benchmarkPct?: number }, user: string) {
  await liveOnly(b.scenarioId, "Re-basing a store");
  const store = await storeRow(b.storeCode);
  if (store.IS_NEW_STORE !== true) throw new HopError(409, "Only a new store is planned off a benchmark. A comparable store grows off its own last year.");
  const storeCode = String(store.STORE_CODE);
  const bench = await storeRow(b.benchmarkStoreCode);
  const benchCode = String(bench.STORE_CODE);
  if (benchCode === storeCode) throw new HopError(400, "A store cannot be its own benchmark.");
  if (bench.IS_NEW_STORE === true && bench.BENCHMARK_STORE_CODE === storeCode) {
    throw new HopError(400, `${benchCode} is itself benchmarked off ${storeCode}; that would be circular.`);
  }
  const pct = b.benchmarkPct;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0 || pct > 3) throw new HopError(400, "The benchmark share must be above 0% and at most 300%, as a decimal (0.85 for 85%).");
  const grant = await assertEditable("STORE_PLAN", "BENCHMARK_PCT", b);

  const first = await q(`SELECT MIN(s.FY_PERIOD_NO) AS P FROM ${S}.STORE_PLAN_NEW_STORE n JOIN ${S}.STORE_PLAN_WEEK_SLOT s ON s.MONTH_NAME = n.MONTH_NAME WHERE n.STORE_CODE = ?`, [storeCode]);
  const fromPeriod = Number(first[0]?.P ?? 1);
  const mixSource = bench.IS_NEW_STORE === true ? String(bench.MIX_SOURCE_STORE_CODE) : benchCode;
  const derivation = `'Benchmark ' || ? || ' ' || m.MONTH_NAME || ' x ' || ROUND(100 * ?) || '%'`;
  const why = `Re-based from ${store.BENCHMARK_STORE_CODE} at ${Math.round(Number(store.BENCHMARK_PCT) * 100)}% to ${benchCode} at ${Math.round(pct * 100)}%. ${grant.rationale ?? ""}`.trim();

  await tx([
    {
      sql: `UPDATE ${S}.DIM_STORE SET BENCHMARK_STORE_CODE = ?, BENCHMARK_PCT = ?, MIX_SOURCE_STORE_CODE = ? WHERE STORE_CODE = ?`,
      binds: [benchCode, pct, mixSource, storeCode],
    },
    {
      sql: `MERGE INTO ${S}.STORE_PLAN_NEW_STORE t
            USING (${derivedMonthsSql(fromPeriod, isoDate(store.OPENING_DATE))}) m
               ON t.STORE_CODE = ? AND t.FY_YEAR = ? AND t.MONTH_NAME = m.MONTH_NAME
            WHEN MATCHED THEN UPDATE SET MONTHLY_SALES_AUD = ROUND(m.BENCH_SALES * ?, 2), IS_DERIVED = TRUE,
                                         DERIVATION = ${derivation}, CHANGED_AT = ${NOW}`,
      binds: [benchCode, benchCode, benchCode, storeCode, PLAN_FY, pct, benchCode, pct],
    },
    // Stores benchmarked off THIS one derive from its plan, so they move with it,
    // reading the re-based plan above. Only their derived months: a value someone
    // typed over is theirs. Built from its weekly plan so a dependant opening
    // mid-month keeps its part month; for a whole month it is the same as the
    // monthly value times the share.
    {
      sql: `UPDATE ${S}.STORE_PLAN_NEW_STORE t SET MONTHLY_SALES_AUD = ROUND(x.BENCH_SALES * x.BENCHMARK_PCT, 2), CHANGED_AT = ${NOW}
              FROM (SELECT d.STORE_CODE, v.MONTH_NAME, v.FY_YEAR, d.BENCHMARK_PCT,
                           SUM(IFF(d.OPENING_DATE IS NULL OR v.WEEK_END_DATE >= d.OPENING_DATE, v.PLAN_SALES_AUD, 0)) AS BENCH_SALES
                      FROM ${S}.DIM_STORE d
                      JOIN ${S}.VW_STORE_PLAN_WEEKLY v ON v.STORE_CODE = d.BENCHMARK_STORE_CODE
                     WHERE d.BENCHMARK_STORE_CODE = ?
                     GROUP BY d.STORE_CODE, v.MONTH_NAME, v.FY_YEAR, d.BENCHMARK_PCT) x
             WHERE t.STORE_CODE = x.STORE_CODE AND t.MONTH_NAME = x.MONTH_NAME AND t.FY_YEAR = x.FY_YEAR AND t.IS_DERIVED`,
      binds: [storeCode],
    },
    overrideInsert({
      grant: { ...grant, rationale: why },
      planKind: "STORE_PLAN", entityCode: storeCode, monthName: "H1",
      oldValue: toNum(store.BENCHMARK_PCT), newValue: pct, changedBy: user,
    }),
  ]);
  return { ok: true, storeCode, benchmarkStoreCode: benchCode, benchmarkPct: pct, ...(await planTotals()) };
}

/** Step the most recent change to a cell back. Append-only: the reversion is its
 *  own entry, so the trail shows the mistake and the correction. */
async function revert(b: Edit, user: string) {
  await liveOnly(b.scenarioId, "Reverting a change");
  const store = await storeRow(b.storeCode);
  const month = requireMonth(b.monthName);
  const measure = b.measure ?? "";
  const last = await q(
    `SELECT OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT FROM ${S}.PLAN_CELL_OVERRIDE
      WHERE PLAN_KIND = 'STORE_PLAN' AND ENTITY_CODE = ? AND MONTH_NAME = ? AND MEASURE_CODE = ?
      ORDER BY CHANGED_AT DESC, OVERRIDE_ID DESC LIMIT 1`,
    [store.STORE_CODE, month, measure],
  );
  if (!last.length) throw new HopError(404, "There is no recorded change to step back.");
  const prior = toNum(last[0].OLD_VALUE);
  if (prior === null) throw new HopError(409, "The last change has no earlier value to return to: it was the first value this cell ever had.");
  const note = `Reverted the change of ${String(last[0].CHANGED_AT).slice(0, 16)} by ${last[0].CHANGED_BY}.`;
  const common = { ...b, reasonCode: "REVERTED", rationale: `${note} ${b.rationale?.trim() ?? ""}`.trim(), currentValue: undefined };
  if (measure === "MONTHLY_SALES_AUD") return editValue({ ...common, targetSales: prior }, user);
  return editDriver({ ...common, measure, newValue: prior }, user);
}

// ─── Bulk ─────────────────────────────────────────────────────────────────────

async function bulk(b: EditRequest & { changes?: Edit[]; scenarioId?: number | null }, user: string) {
  const changes = b.changes ?? [];
  if (!changes.length) throw new HopError(400, "Select at least one cell.");
  if (changes.length > 200) throw new HopError(400, "A bulk edit may change at most 200 cells.");
  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const c of changes) {
    const key = `${c.storeCode}|${c.monthName ?? c.weekEndDate}|${c.measure}`;
    try {
      await editDriver(
        { ...c, scenarioId: b.scenarioId, reasonCode: b.reasonCode, rationale: b.rationale, escalationNote: b.escalationNote, onBehalfOf: b.onBehalfOf },
        user,
      );
      results.push({ key, ok: true });
    } catch (e) {
      results.push({ key, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: results.every((r) => r.ok), saved: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results };
}

// ─── Add a store ──────────────────────────────────────────────────────────────

type NewStore = EditRequest & {
  storeName?: string;
  state?: string;
  region?: string;
  format?: string;
  openingDate?: string | null;
  firstMonth?: string | null;
  benchmarkStoreCode?: string;
  benchmarkPct?: number;
  haloWeeks?: number | null;
  sellingAreaSqm?: number | null;
  note?: string | null;
};

/** The fiscal period a new store starts trading in: the one holding its opening
 *  date or, with no date recorded, the first trading month chosen instead. */
export async function openingPeriod(openingDate: string | null | undefined, firstMonth: string | null | undefined): Promise<number> {
  if (openingDate) {
    const r = await q(`SELECT FY_PERIOD_NO FROM ${S}.STORE_PLAN_WEEK_SLOT WHERE TO_DATE(?) BETWEEN DATEADD(day, -6, TY_WEEK_END_DATE) AND TY_WEEK_END_DATE`, [openingDate]);
    if (!r.length) throw new HopError(400, "The opening date must fall inside FY27 H1 (29 Jun to 27 Dec 2026).");
    return Number(r[0].FY_PERIOD_NO);
  }
  return (PLAN_MONTHS as readonly string[]).indexOf(requireMonth(firstMonth ?? undefined)) + 1;
}

/** A store added mid-cycle is a recorded action with a stated benchmark and a
 *  reason, not an untracked column in a spreadsheet. It has no history, so it is
 *  planned off a comparable store at a declared share. After approval it reads as
 *  NOT IN BASELINE on Approve & lock, rather than silently changing the total. */
async function addStore(b: NewStore & { scenarioId?: number | null }, user: string) {
  await liveOnly(b.scenarioId, "Adding a store");
  const name = b.storeName?.trim();
  if (!name) throw new HopError(400, "Name the store.");
  for (const [label, v, allowed] of [["state", b.state, STORE_STATES], ["region", b.region, STORE_REGIONS], ["format", b.format, STORE_FORMATS]] as const) {
    if (v != null && !(allowed as readonly string[]).includes(v)) throw new HopError(400, `'${v}' is not a store ${label}. Use one of: ${allowed.join(", ")}.`);
  }
  const bench = await storeRow(b.benchmarkStoreCode);
  const pct = b.benchmarkPct;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0 || pct > 3) throw new HopError(400, "The benchmark share must be above 0% and at most 300%, as a decimal.");
  const fromPeriod = await openingPeriod(b.openingDate, b.firstMonth);
  const grant = await assertEditable("STORE_PLAN", "MONTHLY_SALES_AUD", b);

  const next = await q(`SELECT 'S' || LPAD(MAX(TRY_TO_NUMBER(SUBSTR(STORE_CODE, 2))) + 1, 3, '0') AS CODE FROM ${S}.DIM_STORE`);
  const code = String(next[0].CODE);
  const benchCode = String(bench.STORE_CODE);
  const mixSource = bench.IS_NEW_STORE === true ? String(bench.MIX_SOURCE_STORE_CODE) : benchCode;
  const derivation = `'Benchmark ' || ? || ' ' || m.MONTH_NAME || ' x ' || ROUND(100 * ?) || '%'`;
  const curve = Object.entries(NEW_STORE_MARGIN_CURVE).map(() => "(?, ?)").join(", ");

  const writes = [
    {
      sql: `INSERT INTO ${S}.DIM_STORE (STORE_CODE, STORE_NAME, MARKET_CODE, STATE, REGION, STORE_FORMAT, OPENING_DATE, CLOSING_DATE,
              IS_NEW_STORE, IS_COMPARABLE_BASE, BENCHMARK_STORE_CODE, BENCHMARK_PCT, MIX_SOURCE_STORE_CODE, HALO_WEEKS,
              SELLING_AREA_SQM, STORE_STATUS, NOTE)
            SELECT ?, ?, ?, ?, ?, ?, TRY_TO_DATE(?), NULL, TRUE, FALSE, ?, ?, ?, ?, ?, 'PLANNED', ?`,
      binds: [code, name, MARKET, b.state ?? null, b.region ?? null, b.format ?? null, b.openingDate || null, benchCode, pct, mixSource,
        b.haloWeeks ?? null, b.sellingAreaSqm ?? null, b.note?.trim() || null],
    },
    {
      sql: `INSERT INTO ${S}.STORE_PLAN_NEW_STORE (STORE_CODE, FY_YEAR, MONTH_NAME, MONTHLY_SALES_AUD, IS_DERIVED, DERIVATION, CHANGED_AT)
            SELECT ?, ?, m.MONTH_NAME, ROUND(m.BENCH_SALES * ?, 2), TRUE, ${derivation}, ${NOW}
              FROM (${derivedMonthsSql(fromPeriod, b.openingDate || null)}) m`,
      binds: [code, PLAN_FY, pct, benchCode, pct, benchCode, benchCode, benchCode],
    },
    {
      sql: `INSERT INTO ${S}.STORE_PLAN_NEW_STORE_MARGIN (STORE_CODE, FY_YEAR, MONTH_NAME, MARGIN_PCT, CHANGED_AT)
            SELECT ?, ?, v.column1, v.column2::FLOAT, ${NOW}
              FROM VALUES ${curve} v
             WHERE v.column1 IN (SELECT MONTH_NAME FROM ${S}.STORE_PLAN_WEEK_SLOT WHERE FY_PERIOD_NO >= ${Number(fromPeriod)})`,
      binds: [code, PLAN_FY, ...Object.entries(NEW_STORE_MARGIN_CURVE).flat()],
    },
  ];
  // The store, its plan and the audit row land together: a store with no plan,
  // or a plan with no record of who added it, is a state the trail cannot explain.
  const sales = await tx(async (run) => {
    for (const w of writes) await run(w.sql, w.binds);
    const added = toNum((await run(`SELECT SUM(PLAN_SALES_AUD) AS SALES FROM ${WEEKLY} WHERE STORE_CODE = ?`, [code]))[0]?.SALES);
    const audit = overrideInsert({ grant, planKind: "STORE_PLAN", entityCode: code, monthName: "H1", oldValue: null, newValue: added, changedBy: user });
    await run(audit.sql, audit.binds);
    return added;
  });
  return { ok: true, storeCode: code, storeName: name, storeSales: sales, ...(await planTotals()) };
}

// ─── Sandboxes ────────────────────────────────────────────────────────────────

async function requireDraft(id: number | null | undefined) {
  const sb = await sandboxOf(id);
  if (!sb) throw new HopError(400, "That is not a sandbox.");
  if (sb.STATUS !== "DRAFT") throw new HopError(409, "This sandbox has been submitted and is read-only.");
  return sb;
}

async function createSandbox(b: { name?: string }, user: string) {
  const name = b.name?.trim();
  if (!name) throw new HopError(400, "Name the sandbox.");
  const code = `SANDBOX_${Date.now()}`;
  const base = await baselineId();
  // The scenario row and its copy of the plan together: a sandbox listed with no
  // cells would open as an empty plan.
  const id = await tx(async (run) => {
    await run(
      `INSERT INTO ${S}.PLAN_SCENARIO (SCENARIO_CODE, SCENARIO_NAME, SCENARIO_KIND, BASE_SCENARIO_ID, STATUS, CURRENT_REVISION, CREATED_BY, CREATED_AT, UPDATED_AT)
       SELECT ?, ?, 'SANDBOX', ?, 'DRAFT', 1, ?, ${NOW}, ${NOW}`,
      [code, name, base, user],
    );
    const id = Number((await run(`SELECT SCENARIO_ID FROM ${S}.PLAN_SCENARIO WHERE SCENARIO_CODE = ?`, [code]))[0].SCENARIO_ID);
    // The copy. OBJECT_CONSTRUCT drops NULL values, so a comparable store gets no
    // sales cell and a new store no LFL cell -- each gets only the driver it has.
    await run(
      `INSERT INTO ${S}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
       SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, f.KEY::VARCHAR, f.VALUE::FLOAT, 'SCENARIO_SNAPSHOT', ?, ${NOW}
         FROM ${WEEKLY} w,
              LATERAL FLATTEN(INPUT => OBJECT_CONSTRUCT(
                'LFL_PCT', w.LFL_PCT, 'MARGIN_PCT', w.MARGIN_PCT,
                'SALES_AUD', IFF(w.IS_LFL_UNIVERSE, NULL, w.PLAN_SALES_AUD))) f`,
      [id, user],
    );
    await run(
      `INSERT INTO ${S}.PLAN_SCENARIO_PERIOD (SCENARIO_ID, PERIOD_KEY, IS_SELECTED)
       SELECT DISTINCT ?, PERIOD_KEY, TRUE FROM ${S}.STORE_PLAN_WEEK_SLOT`,
      [id],
    );
    await run(
      `INSERT INTO ${S}.PLAN_SCENARIO_REVISION (SCENARIO_ID, REVISION_NO, NOTE, CREATED_BY, CREATED_AT)
       SELECT ?, 1, 'Sandbox created as a copy of the live plan', ?, ${NOW}`,
      [id, user],
    );
    return id;
  });
  return { ok: true, scenarioId: id };
}

async function scenarioAction(b: { action: string; scenarioId?: number; name?: string; rationale?: string; periodKeys?: string[] }, user: string) {
  const sb = b.action === "DISCARD" ? await sandboxOf(b.scenarioId) : await requireDraft(b.scenarioId);
  if (!sb) throw new HopError(400, "That is not a sandbox.");
  const id = Number(sb.SCENARIO_ID);
  if (b.action === "RENAME") {
    if (!b.name?.trim()) throw new HopError(400, "Name the sandbox.");
    await q(`UPDATE ${S}.PLAN_SCENARIO SET SCENARIO_NAME = ?, UPDATED_AT = ${NOW} WHERE SCENARIO_ID = ?`, [b.name.trim(), id]);
  } else if (b.action === "DISCARD") {
    await q(`UPDATE ${S}.PLAN_SCENARIO SET STATUS = 'ARCHIVED', UPDATED_AT = ${NOW} WHERE SCENARIO_ID = ?`, [id]);
  } else if (b.action === "SUBMIT") {
    // Submitting proposes the sandbox for review. It does not write it into the
    // live plan: that would apply every cell without the ownership check each one
    // is owed. The live plan changes only through governed edits.
    if (!b.rationale?.trim()) throw new HopError(400, "Say what the sandbox proposes and why.");
    await tx([
      { sql: `UPDATE ${S}.PLAN_SCENARIO SET STATUS = 'SUBMITTED', UPDATED_AT = ${NOW} WHERE SCENARIO_ID = ?`, binds: [id] },
      {
        sql: `INSERT INTO ${S}.PLAN_SCENARIO_REVISION (SCENARIO_ID, REVISION_NO, NOTE, CREATED_BY, CREATED_AT)
              SELECT SCENARIO_ID, CURRENT_REVISION, 'Submitted: ' || ?, ?, ${NOW} FROM ${S}.PLAN_SCENARIO WHERE SCENARIO_ID = ?`,
        binds: [b.rationale.trim(), user, id],
      },
    ]);
  } else if (b.action === "SET_PERIODS") {
    const keys = (b.periodKeys ?? []).filter((k) => /^FY\d{2}P\d{2}$/.test(k));
    if (!keys.length) throw new HopError(400, "Select at least one month.");
    await q(
      `UPDATE ${S}.PLAN_SCENARIO_PERIOD SET IS_SELECTED = ARRAY_CONTAINS(PERIOD_KEY::VARIANT, PARSE_JSON(?)) WHERE SCENARIO_ID = ?`,
      [JSON.stringify(keys), id],
    );
  } else {
    throw new HopError(400, `Unknown sandbox action '${b.action}'.`);
  }
  return { ok: true, scenarioId: id };
}

const EVENT_TYPES = ["FULL_CLOSURE", "REFURB_CLOSURE", "REDUCED_CAPACITY", "REOPENING_RAMP", "CENTRE_EVENT"];

async function eventAction(
  b: { action: string; scenarioId?: number; eventId?: number; storeCode?: string; startDate?: string; endDate?: string; eventType?: string; adjustmentValue?: number; description?: string },
  user: string,
) {
  const sb = await requireDraft(b.scenarioId);
  const id = Number(sb.SCENARIO_ID);
  if (b.action === "EVENT_REMOVE") {
    await q(`UPDATE ${S}.STORE_PLAN_EVENT SET STATUS = 'REMOVED' WHERE EVENT_ID = ? AND SCENARIO_ID = ?`, [b.eventId, id]);
    return { ok: true };
  }
  await storeRow(b.storeCode);
  if (!b.eventType || !EVENT_TYPES.includes(b.eventType)) throw new HopError(400, "Choose an event type.");
  if (!b.startDate || !b.endDate || b.endDate < b.startDate) throw new HopError(400, "Give a start date and an end date on or after it.");
  const closure = b.eventType.endsWith("CLOSURE");
  const factor = closure ? 0 : b.adjustmentValue;
  if (!closure && (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0 || factor > 3)) {
    throw new HopError(400, "A capacity event needs a sales factor between 0 and 3 (0.6 trades at 60%; 1.2 at 120%).");
  }
  await q(
    `INSERT INTO ${S}.STORE_PLAN_EVENT (SCENARIO_ID, STORE_CODE, START_DATE, END_DATE, EVENT_TYPE, ADJUSTMENT_METHOD, ADJUSTMENT_VALUE, DESCRIPTION, STATUS, CREATED_BY, CREATED_AT)
     SELECT ?, ?, TO_DATE(?), TO_DATE(?), ?, ?, ?, ?, 'ACTIVE', ?, ${NOW}`,
    [id, b.storeCode, b.startDate, b.endDate, b.eventType, closure ? "ZERO" : "CAPACITY_FACTOR", factor, b.description?.trim() || null, user],
  );
  return { ok: true };
}

/** A top-down target in a sandbox, allocated in proportion to the current shape:
 *  sales and LFL scale every eligible week by one factor, margin shifts every week
 *  by the same points, so the scope lands exactly on the target. */
async function target(
  b: { scenarioId?: number; measureCode?: string; scopeType?: string; scopeCode?: string; startDate?: string; endDate?: string; targetValue?: number; preview?: boolean },
  user: string,
) {
  const sb = await requireDraft(b.scenarioId);
  const id = Number(sb.SCENARIO_ID);
  const measure = b.measureCode ?? "";
  if (!["SALES_AUD", "MARGIN_PCT", "LFL_PCT"].includes(measure)) throw new HopError(400, "Target sales, margin % or LFL %.");
  const scope = b.scopeType ?? "MARKET";
  const scopeCol: Record<string, string | null> = { MARKET: null, STATE: "STATE", REGION: "REGION", STORE: "STORE_CODE" };
  if (!Object.hasOwn(scopeCol, scope)) throw new HopError(400, "Scope must be the market, a state, a region or a store.");
  if (scope !== "MARKET" && !b.scopeCode) throw new HopError(400, "Say which one.");
  if (!b.startDate || !b.endDate) throw new HopError(400, "Give the weeks the target covers.");
  if (typeof b.targetValue !== "number" || !Number.isFinite(b.targetValue)) throw new HopError(400, "Enter the target.");

  const scopeSql = scopeCol[scope] ? `AND d.${scopeCol[scope]} = ?` : "";
  const scopeBinds = scopeCol[scope] ? [b.scopeCode] : [];
  const eligible = `
    FROM (${SQL.SQL_SCENARIO_WEEKS}) w
    JOIN ${S}.DIM_STORE d ON d.STORE_CODE = w.STORE_CODE
    JOIN ${S}.PLAN_SCENARIO_PERIOD p ON p.SCENARIO_ID = ? AND p.PERIOD_KEY = w.PERIOD_KEY AND p.IS_SELECTED
   WHERE w.WEEK_END_DATE BETWEEN TO_DATE(?) AND TO_DATE(?) ${scopeSql}
     AND (? <> 'LFL_PCT' OR w.IS_LFL_UNIVERSE)`;
  const eligibleBinds = [id, id, b.startDate, b.endDate, ...scopeBinds, measure];
  const cur = await q(
    `SELECT COUNT(*) AS N, SUM(w.PLAN_SALES_AUD) AS SALES, SUM(w.PLAN_MARGIN_AUD) AS MARGIN,
            SUM(IFF(w.IS_LFL_UNIVERSE, w.PLAN_SALES_AUD, 0)) AS LFL_PLAN, SUM(IFF(w.IS_LFL_UNIVERSE, w.LY_SALES_AUD, 0)) AS LFL_LY ${eligible}`,
    eligibleBinds,
  );
  const n = Number(cur[0]?.N ?? 0);
  if (!n) throw new HopError(422, "No store-weeks in this sandbox match that scope and those dates.");
  const sales = toNum(cur[0].SALES) ?? 0;
  const margin = toNum(cur[0].MARGIN) ?? 0;
  const lflLy = toNum(cur[0].LFL_LY) ?? 0;
  const current = measure === "SALES_AUD" ? sales : measure === "MARGIN_PCT" ? (sales ? margin / sales : 0) : lflLy ? (toNum(cur[0].LFL_PLAN) ?? 0) / lflLy - 1 : 0;
  if (b.preview) return { ok: true, preview: true, current, target: b.targetValue, eligibleWeeks: n };

  const tv = b.targetValue;
  if (measure === "SALES_AUD" && (tv <= 0 || !sales)) throw new HopError(400, "A sales target must be above zero.");
  const k = measure === "SALES_AUD" ? tv / sales : measure === "LFL_PCT" ? (1 + tv) / (1 + current) : 1;
  const delta = measure === "MARGIN_PCT" ? tv - current : 0;
  const writes =
    measure === "MARGIN_PCT"
      ? [{ m: "MARGIN_PCT", expr: "w.MARGIN_PCT + ?", where: "TRUE", arg: delta }]
      : [
          { m: "LFL_PCT", expr: "(1 + w.LFL_PCT) * ? - 1", where: "w.IS_LFL_UNIVERSE", arg: k },
          ...(measure === "SALES_AUD"
            ? [{ m: "SALES_AUD", expr: "w.BASE_SALES_AUD * ?", where: "NOT w.IS_LFL_UNIVERSE", arg: k }]
            : []),
        ];
  await tx([
    ...writes.map((x) => ({
      sql: `INSERT INTO ${S}.STORE_PLAN_SCENARIO_CELL (SCENARIO_ID, STORE_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE, BATCH, CHANGED_BY, CHANGED_AT)
            SELECT ?, w.STORE_CODE, w.WEEK_END_DATE, ?, ${x.expr}, 'TARGET', ?, ${NOW} ${eligible} AND ${x.where}`,
      binds: [id, x.m, x.arg, user, ...eligibleBinds],
    })),
    {
      sql: `INSERT INTO ${S}.STORE_PLAN_TARGET (SCENARIO_ID, MEASURE_CODE, SCOPE_TYPE, SCOPE_CODE, START_DATE, END_DATE, CURRENT_VALUE, TARGET_VALUE, ALLOCATION_METHOD, CREATED_BY, CREATED_AT)
            SELECT ?, ?, ?, ?, TO_DATE(?), TO_DATE(?), ?, ?, ?, ?, ${NOW}`,
      binds: [id, measure, scope, b.scopeCode ?? null, b.startDate, b.endDate, current, tv,
        measure === "MARGIN_PCT" ? "SHIFT_EVERY_WEEK_BY_THE_SAME_POINTS" : "SCALE_IN_PROPORTION_TO_CURRENT_SHAPE", user],
    },
    { sql: `UPDATE ${S}.PLAN_SCENARIO SET CURRENT_REVISION = CURRENT_REVISION + 1, UPDATED_AT = ${NOW} WHERE SCENARIO_ID = ?`, binds: [id] },
  ]);
  return { ok: true, current, target: tv, eligibleWeeks: n };
}

async function comment(b: { scenarioId?: number | null; storeCode?: string; text?: string; parentId?: number | null }, user: string) {
  await storeRow(b.storeCode);
  const text = b.text?.trim();
  if (!text) throw new HopError(400, "Write the comment.");
  const sb = await sandboxOf(b.scenarioId);
  await q(
    `INSERT INTO ${S}.PLAN_COMMENT (SCENARIO_ID, STORE_CODE, COMMENT_TEXT, PARENT_COMMENT_ID, STATUS, CREATED_BY, CREATED_AT)
     SELECT ?, ?, ?, ?, 'OPEN', ?, ${NOW}`,
    [sb ? Number(sb.SCENARIO_ID) : null, b.storeCode, text, b.parentId ?? null, user],
  );
  return { ok: true };
}

// ─── Store master ─────────────────────────────────────────────────────────────

/** Store facts the plan reads but no feed supplies. Selling area is held nowhere
 *  else, and a new store's halo length is a planning call. Both go through the
 *  ownership registry and the audit trail like any plan number: a store fact
 *  that changes silently is how a halo quietly stops being flagged. State, region
 *  and format come from the curated store dimension and are not edited here. */
const MASTER_FIELDS = {
  SELLING_AREA_SQM: { label: "Selling area", min: 1, max: 20000, newOnly: false },
  HALO_WEEKS: { label: "Halo weeks", min: 0, max: 26, newOnly: true },
} as const;

async function storeMaster(b: Edit & { field?: string }, user: string) {
  await liveOnly(b.scenarioId, "Changing the store master");
  const field = b.field as keyof typeof MASTER_FIELDS;
  // Own keys only: the field name is interpolated as a column below.
  const spec = Object.hasOwn(MASTER_FIELDS, field) ? MASTER_FIELDS[field] : undefined;
  if (!spec) throw new HopError(400, `'${b.field}' is not a store fact that can be changed here.`);
  const store = await storeRow(b.storeCode);
  if (spec.newOnly && store.IS_NEW_STORE !== true) throw new HopError(409, "A halo applies to a new store's opening weeks; a comparable store has none.");
  const v = b.newValue;
  if (typeof v !== "number" || !Number.isInteger(v) || v < spec.min || v > spec.max) {
    throw new HopError(400, `${spec.label} must be a whole number from ${spec.min} to ${spec.max}.`);
  }
  const grant = await assertEditable("STORE_PLAN", field, b);
  const code = String(store.STORE_CODE);
  // The column comes from the fixed list above, never from the request.
  await tx([
    { sql: `UPDATE ${S}.DIM_STORE SET ${field} = ? WHERE STORE_CODE = ?`, binds: [v, code] },
    overrideInsert({ grant, planKind: "STORE_PLAN_MASTER", entityCode: code, monthName: "H1", oldValue: toNum(store[field]), newValue: v, changedBy: user }),
  ]);
  return { ok: true, storeCode: code, field, value: v, ...(await planTotals()) };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postStorePlan(body: any, user: string) {
  switch (body?.action) {
    case "DRIVER": return editDriver(body, user);
    case "HALF": return editHalf(body, user);
    case "BULK": return bulk(body, user);
    case "VALUE": return editValue(body, user);
    case "REBASE": return rebase(body, user);
    case "REVERT": return revert(body, user);
    case "ADD_STORE": return addStore(body, user);
    case "COMMENT": return comment(body, user);
    case "STORE_MASTER": return storeMaster(body, user);
    case "CREATE_SANDBOX": return createSandbox(body, user);
    case "RENAME":
    case "DISCARD":
    case "SUBMIT":
    case "SET_PERIODS": return scenarioAction(body, user);
    case "EVENT_ADD":
    case "EVENT_REMOVE": return eventAction(body, user);
    case "TARGET": return target(body, user);
    default: throw new HopError(400, `Unknown store plan action '${body?.action}'.`);
  }
}
