// ─── Head of Planning: WSSI ───────────────────────────────────────────────────
//
// Two kinds of edit, deliberately different:
//
//   INPUT  a PLANNED row (markdown, shrink, stock adjustments) is a real planning
//          input. It is stored per week in the form of the default it replaces --
//          a rate as a rate, an amount as a factor on its basis -- so the period
//          reads back exactly what was typed, and every row built on it moves.
//          Inputs apply only to weeks still to trade, and never to last year or
//          the locked budget. The reference implementation had the table for this
//          and never wrote to it.
//   PIN    a merch forecast row can be PINNED: the displayed figure is overridden
//          and recorded, while the forecast feed underneath is unchanged. That is
//          the reference's display override, kept for the rows it suits.
//
// The budget is never editable here: it is the store plan the board approved.

import { S } from "../schema";
import { batch, q, tx, HopError, NOW, type Row } from "../db";
import { assertEditable, overrideInsert, type EditRequest } from "../ownership";
import { MARKET } from "../config";
import { toNum } from "../format";
import { PLANNED, wssiMeasureCode, resolveCell, overrideKey, type SpecRow } from "../wssi-model";
import * as SQL from "../sql";

const GRAINS = new Set(["WEEK", "MONTH", "QUARTER", "HALF", "YEAR"]);

function scopeOf(v: unknown): string {
  const s = String(v ?? "ALL").trim().toUpperCase();
  if (s !== "ALL" && !/^\d{3}$/.test(s)) throw new HopError(400, "The RBU scope must be ALL or an RBU code.");
  return s;
}
function grainOf(v: unknown): string {
  const g = String(v ?? "MONTH").toUpperCase();
  if (!GRAINS.has(g)) throw new HopError(400, `Unsupported grain '${v}'.`);
  return g;
}

export async function getWssi(grainParam: string | null, rbuParam: string | null) {
  const grain = grainOf(grainParam);
  const scope = scopeOf(rbuParam);
  const [rows, spec, pins, integrity, ownership, reasons, settings, inputs] = await batch([
    { sql: SQL.SQL_WSSI_GRAIN, binds: [grain, scope] },
    SQL.SQL_WSSI_SPEC,
    { sql: SQL.SQL_WSSI_PINS, binds: [grain, scope] },
    SQL.SQL_WSSI_INTEGRITY,
    { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["WSSI"] },
    SQL.SQL_REASON_CODES,
    SQL.SQL_SETTINGS,
    SQL.SQL_WSSI_INPUTS,
  ]);
  return { grain, scope, rows, spec, pins, integrity, ownership, reasons, settings, inputs };
}

async function specRow(displayOrder: unknown): Promise<SpecRow> {
  const r = await q(`SELECT * FROM (${SQL.SQL_WSSI_SPEC}) WHERE DISPLAY_ORDER = ?`, [Number(displayOrder)]);
  if (!r.length) throw new HopError(400, "That WSSI row does not exist.");
  return r[0] as unknown as SpecRow;
}

/** The period's LE row at the scope, and the cell as the grid shows it. */
async function currentCell(spec: SpecRow, grain: string, periodKey: string, scope: string) {
  const rows = await q(`SELECT * FROM (${SQL.SQL_WSSI_GRAIN}) WHERE PERIOD_KEY = ?`, [grain, scope, periodKey]);
  if (!rows.length) throw new HopError(404, `No WSSI data for ${periodKey}.`);
  const byVersion = new Map(rows.map((r) => [String(r.VERSION), r]));
  return { byVersion, cell: resolveCell(spec, byVersion, { byLabel: new Map(), periodKey }) };
}

function staleCheck(shown: number | null, supplied: unknown) {
  if (supplied === undefined || supplied === null) return;
  const s = Number(supplied);
  if (shown === null || Math.abs(shown - s) > Math.max(Math.abs(shown) * 1e-6, 1e-9)) {
    throw new HopError(409, "This cell changed after you selected it. Refresh and try again.");
  }
}

// ─── Planner input ────────────────────────────────────────────────────────────

async function input(b: Record<string, unknown>, user: string, readBack = true) {
  const spec = await specRow(b.displayOrder);
  if (spec.ROW_KIND !== "PLANNED") throw new HopError(403, `${spec.ROW_LABEL} is not a planning input. ${spec.ROW_KIND === "FACT" ? "Forecast rows can be pinned instead." : "It is calculated or fed from source."}`);
  const p = PLANNED[spec.MEASURE_CODE ?? ""];
  if (!p) throw new HopError(400, `No input rule for ${spec.ROW_LABEL}.`);
  const grain = grainOf(b.grain);
  const scope = scopeOf(b.rbuScope);
  const periodKey = String(b.periodKey ?? "");
  const typed = Number(b.newValue);
  if (!Number.isFinite(typed)) throw new HopError(400, "Enter a number.");
  if (p.form === "RATE" && (typed < 0 || typed >= 1)) throw new HopError(400, "Enter a rate between 0% and 100%.");
  if (spec.MEASURE_CODE?.startsWith("MD_") && typed < 0) throw new HopError(400, "Markdown cannot be negative.");

  const grant = await assertEditable("WSSI", wssiMeasureCode(spec), b as EditRequest);
  const { cell } = await currentCell(spec, grain, periodKey, scope);
  staleCheck(cell.value, b.currentValue);

  const period = await q(`SELECT PERIOD_START_DATE, PERIOD_END_DATE FROM ${S}.VW_TIME_PERIOD WHERE TIME_GRAIN = ? AND PERIOD_KEY = ?`, [grain, periodKey]);
  if (!period.length) throw new HopError(400, "That period is not valid for this grain.");
  // The period's weeks in scope, split into those still to trade and those traded.
  const valueExpr = p.form === "RATE"
    ? `${p.weight} * ${spec.MEASURE_CODE}` // weighted rate
    : String(spec.MEASURE_CODE);
  const w = await q(
    `SELECT SUM(IFF(ACCEPTS_PLANNER_INPUT, ${p.form === "RATE" ? p.weight : p.basis}, 0)) AS OPEN_BASE,
            SUM(IFF(ACCEPTS_PLANNER_INPUT, 0, ${valueExpr})) AS CLOSED_VALUE,
            SUM(${p.form === "RATE" ? p.weight : "0"}) AS ALL_WEIGHT,
            COUNT(DISTINCT IFF(ACCEPTS_PLANNER_INPUT, WEEK_END_DATE, NULL)) AS OPEN_WEEKS
       FROM ${S}.VW_WSSI_EXTENDED
      WHERE VERSION = 'LE' AND ALIGNED_WEEK_END_DATE BETWEEN ? AND ? AND (? = 'ALL' OR RBU_CODE = ?)`,
    [period[0].PERIOD_START_DATE, period[0].PERIOD_END_DATE, scope, scope],
  );
  const openBase = toNum(w[0]?.OPEN_BASE) ?? 0;
  const closed = toNum(w[0]?.CLOSED_VALUE) ?? 0;
  const allWeight = toNum(w[0]?.ALL_WEIGHT) ?? 0;
  if (!Number(w[0]?.OPEN_WEEKS)) throw new HopError(409, "Every week of this period has traded. Planning inputs apply to weeks still to trade.");
  if (!openBase) throw new HopError(409, `The weeks still to trade carry no ${p.form === "RATE" ? "weight" : "basis"} to set this against.`);

  // The stored per-week value that makes the PERIOD read back what was typed.
  const stored = p.form === "RATE" ? (typed * allWeight - closed) / openBase : (typed - closed) / openBase;
  if (p.form === "RATE" && (stored < 0 || stored >= 1)) {
    throw new HopError(400, `The traded weeks already carry this period to ${((closed / allWeight) * 100).toFixed(1)}%: the remaining weeks cannot reach ${(typed * 100).toFixed(1)}%.`);
  }
  if (p.form === "FACTOR" && spec.MEASURE_CODE?.startsWith("MD_") && stored < 0) {
    throw new HopError(400, `The traded weeks already account for ${closed.toLocaleString("en-AU", { maximumFractionDigits: 0 })}, more than ${typed.toLocaleString("en-AU")}.`);
  }

  const batchId = crypto.randomUUID();
  await tx([
    {
      sql: `INSERT INTO ${S}.WSSI_PLANNED_INPUT (BATCH_ID, MARKET_CODE, RBU_CODE, WEEK_END_DATE, MEASURE_CODE, VALUE_FORM, OLD_VALUE, NEW_VALUE,
              TYPED_GRAIN, TYPED_PERIOD_KEY, TYPED_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
            SELECT DISTINCT ?, ?, ?, WEEK_END_DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}
              FROM ${S}.VW_WSSI_EXTENDED
             WHERE VERSION = 'LE' AND ACCEPTS_PLANNER_INPUT AND ALIGNED_WEEK_END_DATE BETWEEN ? AND ? AND (? = 'ALL' OR RBU_CODE = ?)`,
      binds: [batchId, MARKET, scope === "ALL" ? null : scope, spec.MEASURE_CODE, p.form, cell.value, stored, grain, periodKey, typed,
        grant.reasonCode, grant.rationale, user, period[0].PERIOD_START_DATE, period[0].PERIOD_END_DATE, scope, scope],
    },
    overrideInsert({ grant, planKind: "WSSI_INPUT", entityCode: scope, monthName: periodKey, oldValue: cell.value, newValue: typed, changedBy: user }),
  ]);
  if (!readBack) return { ok: true, displayOrder: spec.DISPLAY_ORDER, periodKey, scope, typed, weeks: Number(w[0]?.OPEN_WEEKS) };
  const after = await currentCell(spec, grain, periodKey, scope);
  return { ok: true, displayOrder: spec.DISPLAY_ORDER, periodKey, scope, typed, shown: after.cell.value, weeks: Number(w[0]?.OPEN_WEEKS) };
}

// ─── Display pin ──────────────────────────────────────────────────────────────

async function pin(b: Record<string, unknown>, user: string, clear: boolean) {
  const spec = await specRow(b.displayOrder);
  const grant = await assertEditable("WSSI", wssiMeasureCode(spec), b as EditRequest);
  if (spec.ROW_KIND !== "FACT") throw new HopError(403, `${spec.ROW_LABEL} cannot be pinned: only a forecast figure can be.`);
  const grain = grainOf(b.grain);
  const scope = scopeOf(b.rbuScope);
  const periodKey = String(b.periodKey ?? "");
  const pins = await q(SQL.SQL_WSSI_PINS, [grain, scope]);
  const pinned = new Map(pins.filter((x) => x.NEW_VALUE != null).map((x) => [overrideKey(x.DISPLAY_ORDER, x.PERIOD_KEY), Number(x.NEW_VALUE)]));
  const { byVersion } = await currentCell(spec, grain, periodKey, scope);
  const shown = resolveCell(spec, byVersion, { byLabel: new Map(), periodKey, pinned }).value;
  staleCheck(shown, b.currentValue);
  const value = clear ? null : Number(b.newValue);
  if (!clear && !Number.isFinite(value)) throw new HopError(400, "Enter a number.");
  await tx([
    {
      sql: `INSERT INTO ${S}.WSSI_CELL_OVERRIDE (MARKET_CODE, TIME_GRAIN, PERIOD_KEY, RBU_SCOPE, DISPLAY_ORDER, ROW_LABEL, OLD_VALUE, NEW_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}`,
      binds: [MARKET, grain, periodKey, scope, spec.DISPLAY_ORDER, spec.ROW_LABEL, shown, value, grant.reasonCode, grant.rationale, user],
    },
    overrideInsert({ grant, planKind: "WSSI_DISPLAY", entityCode: scope, monthName: periodKey, oldValue: shown, newValue: value, changedBy: user }),
  ]);
  return { ok: true, displayOrder: spec.DISPLAY_ORDER, periodKey, scope, newValue: value };
}

// ─── Bulk ──────────────────────────────────────────────────────────────────────────

/** Many cells, one reason. Each cell goes through the same path as a single edit
 *  -- its own ownership check, stale check and audit row -- so a bulk edit cannot
 *  do anything one edit could not. A cell that fails does not stop the rest, and
 *  each result says what happened to it. */
async function bulk(b: Record<string, unknown>, user: string) {
  const changes = Array.isArray(b.changes) ? (b.changes as Record<string, unknown>[]) : [];
  if (!changes.length) throw new HopError(400, "Select at least one cell.");
  if (changes.length > 200) throw new HopError(400, "A bulk edit may change at most 200 cells.");
  // The batch's reason and scope win over anything a change carries itself.
  const shared = { grain: b.grain, rbuScope: b.rbuScope, reasonCode: b.reasonCode, rationale: b.rationale, escalationNote: b.escalationNote, onBehalfOf: b.onBehalfOf };
  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const c of changes) {
    const key = overrideKey(c.displayOrder, c.periodKey);
    try {
      if (c.mode === "INPUT") await input({ ...c, ...shared }, user, false);
      else if (c.mode === "PIN") await pin({ ...c, ...shared }, user, false);
      else throw new HopError(400, "Each change must be a planning input or a forecast pin.");
      results.push({ key, ok: true });
    } catch (e) {
      results.push({ key, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: results.every((r) => r.ok), saved: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results };
}

export async function postWssi(body: Record<string, unknown>, user: string): Promise<Row> {
  switch (body?.action) {
    case "INPUT": return input(body, user);
    case "BULK": return bulk(body, user);
    case "PIN": return pin(body, user, false);
    case "UNPIN": return pin(body, user, true);
    default: throw new HopError(400, `Unknown WSSI action '${body?.action}'.`);
  }
}
