// ─── WSSI: the cell resolver (pure, shared by the grid and the save route) ───
//
// The reference implementation resolved a cell one way on screen and another way
// on save: four rates and no budget branch against thirty-one, so a budget or a
// rate cell failed with 404 or 409 when edited. This module is the single
// definition of what a cell shows; the grid renders it and the server checks an
// edit against it.
//
// Rules:
//   - The row's version comes from its spec. A row that names no version (stock,
//     purchases, cover, markdown, OTB) reads the LATEST ESTIMATE: actuals to date,
//     then the merch forecast.
//   - Every rate is rebuilt from the period's summed components, never averaged.
//   - Cover is in weeks against a weekly rate: stock / (forward 4-week cost / the
//     forward weeks actually in frame), so a series end does not inflate it.
//   - A calculated row built on an invented figure is flagged as such. The
//     reference documented this inheritance and never implemented it.
//   - A variance in a part-traded period compares actuals with the plan for the
//     SAME weeks.

export type Row = Record<string, unknown>;
export type SpecRow = {
  DISPLAY_ORDER: number;
  METRIC_GROUP: string;
  ROW_LABEL: string;
  VERSION_HINT: string | null;
  MEASURE_CODE: string | null;
  ROW_KIND: "FACT" | "CALC" | "VARIANCE" | "PLANNED" | "PLACEHOLDER" | "AWAITING";
  MEASURE_BASIS: string | null;
  FORMULA_TEXT: string | null;
  AWAITING_REASON?: string | null;
  BASIS_NOTE?: string | null;
};

export type CellState =
  | "MEASURED"      // a fact from source
  | "MODELLED"      // a modelled stock or intake position
  | "PLAN"          // budget or forecast
  | "DERIVED"       // calculated from the above
  | "PLACEHOLDER"   // invented, or calculated from something invented
  | "DEFAULT"       // a planning input at its default
  | "TYPED"         // a planning input someone has typed
  | "PINNED"        // a display override
  | "AWAITING"      // a feed that has never been supplied
  | "NOT_TRADED"    // an actual for a period that has not traded yet
  | "EMPTY";

export type Cell = { value: number | null; state: CellState; note?: string; inherited?: boolean; implausible?: boolean };

export const VERSION_OF_HINT: Record<string, string> = { TY: "TY", LY: "LY", BUD: "BUD", FC: "MERCH_FC" };

export function versionOf(spec: SpecRow): string {
  return spec.VERSION_HINT ? VERSION_OF_HINT[spec.VERSION_HINT] ?? "LE" : "LE";
}

const n = (r: Row | undefined, k: string): number | null => {
  if (!r) return null;
  const v = r[k];
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

/** Components that are invented placeholders, and components that are modelled. */
const PLACEHOLDER_COLS = new Set(["TTL_CSOH_R_AUD", "FP_CSOH_C_AUD", "FP_CSOH_U", "CL_CSOH_C_AUD", "CL_CSOH_U",
  "ON_ORDER_C_AUD", "ON_ORDER_R_AUD", "ON_ORDER_UNITS", "UNCOMMITTED_C_AUD", "UNCOMMITTED_R_AUD", "UNCOMMITTED_UNITS", "BUD_SLS_FP_AUD"]);
const MODELLED_COLS = new Set(["C_CLS_INV_AUD", "U_CLS_INV", "U_CLS_INV_STORE", "U_CLS_INV_DC", "C_REC_AUD", "R_REC_AUD",
  "U_REC", "STORE_REC_UNIT", "COMMIT_R_AUD", "COMMIT_C_AUD", "U_COMMIT"]);

type Calc = { deps: string[]; f: (r: Row) => number | null };

const fwd = (r: Row, col: string) => div(n(r, col), n(r, "FWD_N"));
const perWeek = (r: Row, col: string) => div(n(r, col), n(r, "AVAILABLE_WEEKS"));

/** Every calculated measure, with the components it is built from. */
export const CALC: Record<string, Calc> = {
  ASP: { deps: ["SLS_AUD", "SLS_U"], f: (r) => div(n(r, "SLS_AUD"), n(r, "SLS_U")) },
  POS_GP_PCT: { deps: ["POS_GP_AUD", "SLS_AUD"], f: (r) => div(n(r, "POS_GP_AUD"), n(r, "SLS_AUD")) },
  FP_MIX_PCT: { deps: ["SLS_FP_AUD", "SLS_AUD"], f: (r) => div(n(r, "SLS_FP_AUD"), n(r, "SLS_AUD")) },
  CL_MIX_PCT: { deps: ["SLS_CL_AUD", "SLS_AUD"], f: (r) => div(n(r, "SLS_CL_AUD"), n(r, "SLS_AUD")) },
  FP_ASP: { deps: ["SLS_FP_AUD", "SLS_FP_U"], f: (r) => div(n(r, "SLS_FP_AUD"), n(r, "SLS_FP_U")) },
  CL_ASP: { deps: ["SLS_CL_AUD", "SLS_CL_U"], f: (r) => div(n(r, "SLS_CL_AUD"), n(r, "SLS_CL_U")) },
  FP_GP_PCT: { deps: ["FP_GP_AUD", "SLS_FP_AUD"], f: (r) => div(n(r, "FP_GP_AUD"), n(r, "SLS_FP_AUD")) },
  CL_GP_PCT: { deps: ["CL_GP_AUD", "SLS_CL_AUD"], f: (r) => div(n(r, "CL_GP_AUD"), n(r, "SLS_CL_AUD")) },
  FP_COGS_AUD: { deps: ["SLS_FP_AUD", "FP_GP_AUD"], f: (r) => n(r, "FP_COGS_AUD") },
  CL_COGS_AUD: { deps: ["SLS_CL_AUD", "CL_GP_AUD"], f: (r) => n(r, "CL_COGS_AUD") },
  TTL_COGS_AUD: { deps: ["SLS_AUD", "POS_GP_AUD"], f: (r) => n(r, "TTL_COGS_AUD") },
  FP_FWD_WKS_CVR: { deps: ["FP_CSOH_C_AUD"], f: (r) => div(n(r, "FP_CSOH_C_AUD"), fwd(r, "FWD_FP_COGS4_AUD")) },
  FP_SPOT_WKS_CVR: { deps: ["FP_CSOH_C_AUD"], f: (r) => div(n(r, "FP_CSOH_C_AUD"), perWeek(r, "FP_COGS_AUD")) },
  CL_FWD_WKS_CVR: { deps: ["CL_CSOH_C_AUD"], f: (r) => div(n(r, "CL_CSOH_C_AUD"), fwd(r, "FWD_CL_COGS4_AUD")) },
  CL_SPOT_WKS_CVR: { deps: ["CL_CSOH_C_AUD"], f: (r) => div(n(r, "CL_CSOH_C_AUD"), perWeek(r, "CL_COGS_AUD")) },
  ON_ORDER_FM_PCT: { deps: ["ON_ORDER_R_AUD", "ON_ORDER_C_AUD"], f: (r) => div(sub(n(r, "ON_ORDER_R_AUD"), n(r, "ON_ORDER_C_AUD")), n(r, "ON_ORDER_R_AUD")) },
  COMMITTED_FM_PCT: { deps: ["COMMIT_R_AUD", "COMMIT_C_AUD"], f: (r) => div(sub(n(r, "COMMIT_R_AUD"), n(r, "COMMIT_C_AUD")), n(r, "COMMIT_R_AUD")) },
  COMMITTED_ASP: { deps: ["COMMIT_R_AUD", "U_COMMIT"], f: (r) => div(n(r, "COMMIT_R_AUD"), n(r, "U_COMMIT")) },
  UNCOMMITTED_FM_PCT: { deps: ["UNCOMMITTED_R_AUD", "UNCOMMITTED_C_AUD"], f: (r) => div(sub(n(r, "UNCOMMITTED_R_AUD"), n(r, "UNCOMMITTED_C_AUD")), n(r, "UNCOMMITTED_R_AUD")) },
  UNCOMMITTED_ASP: { deps: ["UNCOMMITTED_R_AUD", "UNCOMMITTED_UNITS"], f: (r) => div(n(r, "UNCOMMITTED_R_AUD"), n(r, "UNCOMMITTED_UNITS")) },
  OTB_C_AUD: { deps: ["C_REC_AUD", "ON_ORDER_C_AUD"], f: (r) => n(r, "OTB_C_AUD") },
  OTB_R_AUD: { deps: ["R_REC_AUD", "ON_ORDER_R_AUD"], f: (r) => n(r, "OTB_R_AUD") },
  OTB_UNITS: { deps: ["U_REC", "ON_ORDER_UNITS"], f: (r) => n(r, "OTB_UNITS") },
  OTB_FM_PCT: { deps: ["R_REC_AUD", "ON_ORDER_R_AUD"], f: (r) => div(sub(n(r, "OTB_R_AUD"), n(r, "OTB_C_AUD")), n(r, "OTB_R_AUD")) },
  OTB_ASP: { deps: ["R_REC_AUD", "ON_ORDER_R_AUD"], f: (r) => div(n(r, "OTB_R_AUD"), n(r, "OTB_UNITS")) },
  PURCHASES_FM_PCT: { deps: ["R_REC_AUD", "C_REC_AUD"], f: (r) => div(sub(n(r, "R_REC_AUD"), n(r, "C_REC_AUD")), n(r, "R_REC_AUD")) },
  TTL_STOCK_ADJ_R_AUD: { deps: ["C_CLS_INV_AUD"], f: (r) => n(r, "TTL_STOCK_ADJ_R_AUD") },
  TTL_STOCK_ADJ_C_AUD: { deps: ["C_CLS_INV_AUD"], f: (r) => n(r, "TTL_STOCK_ADJ_C_AUD") },
  TTL_STOCK_ADJ_UNITS: { deps: ["U_CLS_INV"], f: (r) => n(r, "TTL_STOCK_ADJ_UNITS") },
  SHRINK_C_AUD: { deps: ["C_CLS_INV_AUD"], f: (r) => n(r, "SHRINK_C_AUD") },
  TTL_CSOH_MARGIN_PCT: { deps: ["TTL_CSOH_R_AUD", "C_CLS_INV_AUD"], f: (r) => div(sub(n(r, "TTL_CSOH_R_AUD"), n(r, "C_CLS_INV_AUD")), n(r, "TTL_CSOH_R_AUD")) },
  TTL_CSOH_ASP: { deps: ["TTL_CSOH_R_AUD", "U_CLS_INV"], f: (r) => div(n(r, "TTL_CSOH_R_AUD"), n(r, "U_CLS_INV")) },
  TTL_SPOT_CVR_R: { deps: ["TTL_CSOH_R_AUD"], f: (r) => div(n(r, "TTL_CSOH_R_AUD"), perWeek(r, "SLS_AUD")) },
  TTL_FWD_CVR_C: { deps: ["C_CLS_INV_AUD"], f: (r) => div(n(r, "C_CLS_INV_AUD"), fwd(r, "FWD_COGS4_AUD")) },
  TTL_FWD_CVR_R: { deps: ["TTL_CSOH_R_AUD"], f: (r) => div(n(r, "TTL_CSOH_R_AUD"), fwd(r, "FWD_SLS4_AUD")) },
  STORE_FWD_WKS_CVR: { deps: ["U_CLS_INV_STORE"], f: (r) => div(n(r, "U_CLS_INV_STORE"), fwd(r, "FWD_U4")) },
  DC_FWD_WKS_CVR: { deps: ["U_CLS_INV_DC"], f: (r) => div(n(r, "U_CLS_INV_DC"), fwd(r, "FWD_U4")) },
};

/** How a planning row reads its value from the period's components, and the
 *  count column that says whether anyone has typed it. */
export const PLANNED: Record<string, { f: (r: Row) => number | null; typed: string; form: "RATE" | "FACTOR"; basis: string | null; weight: string | null }> = {
  MD_EXIT_AUD: { f: (r) => n(r, "MD_EXIT_AUD"), typed: "IN_MD_EXIT", form: "FACTOR", basis: "SLS_CL_AUD", weight: null },
  MD_EXIT_FP_GP_PCT: { f: (r) => div(n(r, "MD_EXIT_GP_W_AUD"), n(r, "MD_EXIT_AUD")), typed: "IN_MD_EXIT_GP", form: "RATE", basis: null, weight: "MD_EXIT_AUD" },
  MD_DEPTH_PCT: { f: (r) => div(n(r, "MD_DEPTH_W_AUD"), n(r, "SLS_CL_AUD")), typed: "IN_MD_DEPTH", form: "RATE", basis: null, weight: "SLS_CL_AUD" },
  MD_SPEND_AUD: { f: (r) => n(r, "MD_SPEND_AUD"), typed: "IN_MD_SPEND", form: "FACTOR", basis: "SLS_AUD", weight: null },
  MD_UNITS: { f: (r) => n(r, "MD_UNITS"), typed: "IN_MD_UNITS", form: "FACTOR", basis: "SLS_U", weight: null },
  FP_STOCK_ADJ_R_AUD: { f: (r) => n(r, "FP_STOCK_ADJ_R_AUD"), typed: "IN_FP_ADJ_R", form: "FACTOR", basis: "C_CLS_INV_AUD", weight: null },
  CL_STOCK_ADJ_R_AUD: { f: (r) => n(r, "CL_STOCK_ADJ_R_AUD"), typed: "IN_CL_ADJ_R", form: "FACTOR", basis: "C_CLS_INV_AUD", weight: null },
  FP_STOCK_ADJ_C_AUD: { f: (r) => n(r, "FP_STOCK_ADJ_C_AUD"), typed: "IN_FP_ADJ_C", form: "FACTOR", basis: "C_CLS_INV_AUD", weight: null },
  CL_STOCK_ADJ_C_AUD: { f: (r) => n(r, "CL_STOCK_ADJ_C_AUD"), typed: "IN_CL_ADJ_C", form: "FACTOR", basis: "C_CLS_INV_AUD", weight: null },
  FP_STOCK_ADJ_UNITS: { f: (r) => n(r, "FP_STOCK_ADJ_UNITS"), typed: "IN_FP_ADJ_U", form: "FACTOR", basis: "U_CLS_INV", weight: null },
  CL_STOCK_ADJ_UNITS: { f: (r) => n(r, "CL_STOCK_ADJ_UNITS"), typed: "IN_CL_ADJ_U", form: "FACTOR", basis: "U_CLS_INV", weight: null },
  SHRINK_PCT: { f: (r) => div(n(r, "SHRINK_C_AUD"), n(r, "SHRINK_BASE_AUD")), typed: "IN_SHRINK", form: "RATE", basis: null, weight: "SHRINK_BASE_AUD" },
};

const TD_OF: Record<string, string> = {
  SLS_AUD: "SLS_AUD_TD", SLS_U: "SLS_U_TD", POS_GP_AUD: "POS_GP_AUD_TD", SLS_FP_AUD: "SLS_FP_AUD_TD",
  FP_GP_AUD: "FP_GP_AUD_TD", SLS_CL_AUD: "SLS_CL_AUD_TD", CL_GP_AUD: "CL_GP_AUD_TD",
};

/** The two rows a variance compares, read from its formula: "A / B - 1". */
export function varianceParts(spec: SpecRow, byLabel: Map<string, SpecRow>): [SpecRow, SpecRow] | null {
  const m = (spec.FORMULA_TEXT ?? "").match(/^(.+?)\s*\/\s*(.+?)\s*-\s*1$/);
  if (!m) return null;
  const a = byLabel.get(m[1].trim());
  const b = byLabel.get(m[2].trim());
  return a && b ? [a, b] : null;
}

/** The registry code of a WSSI row: "WSSI:078:MARKDOWN DEPTH %". */
export function wssiMeasureCode(spec: SpecRow): string {
  return `WSSI:${String(spec.DISPLAY_ORDER).padStart(3, "0")}:${spec.ROW_LABEL}`;
}

export function overrideKey(displayOrder: unknown, periodKey: unknown): string {
  return `${String(displayOrder)}|${String(periodKey)}`;
}

/** Resolve one cell. `byVersion` holds the period's rows keyed by VERSION. */
export function resolveCell(
  spec: SpecRow,
  byVersion: Map<string, Row>,
  ctx: { byLabel: Map<string, SpecRow>; pinned?: Map<string, number>; periodKey: string; implausibleWeeks?: number },
): Cell {
  if (spec.ROW_KIND === "AWAITING") return { value: null, state: "AWAITING", note: spec.AWAITING_REASON ?? spec.FORMULA_TEXT ?? "No feed yet" };

  const pin = ctx.pinned?.get(overrideKey(spec.DISPLAY_ORDER, ctx.periodKey));
  const version = versionOf(spec);
  const row = byVersion.get(version);
  const anyRow = byVersion.values().next().value as Row | undefined;
  const state = String(anyRow?.PERIOD_STATE ?? "");

  if (spec.ROW_KIND === "VARIANCE") {
    const parts = varianceParts(spec, ctx.byLabel);
    if (!parts) return { value: null, state: "EMPTY" };
    const [a, b] = parts;
    const ty = byVersion.get(versionOf(a));
    const other = byVersion.get(versionOf(b));
    if (!ty || state === "FUTURE") return { value: null, state: "NOT_TRADED", note: "Not yet traded: no actuals to compare." };
    const col = b.MEASURE_CODE ?? "";
    const part = state === "PART_TRADED";
    const den = part ? n(other, TD_OF[col] ?? col) : n(other, col);
    const v = div(n(ty, a.MEASURE_CODE ?? ""), den);
    return {
      value: v === null ? null : v - 1,
      state: "DERIVED",
      note: part ? "Part traded: compared with the plan for the same weeks, not the whole period." : undefined,
    };
  }

  if (!row) {
    if (version === "TY") return { value: null, state: "NOT_TRADED", note: "Not yet traded." };
    return { value: null, state: "EMPTY" };
  }

  if (spec.ROW_KIND === "PLANNED") {
    const p = PLANNED[spec.MEASURE_CODE ?? ""];
    if (!p) return { value: null, state: "EMPTY" };
    const typed = (n(row, p.typed) ?? 0) > 0;
    return { value: p.f(row), state: typed ? "TYPED" : "DEFAULT", note: typed ? "A planner input" : "The planning default: no one has typed this yet" };
  }

  const measure = spec.MEASURE_CODE ?? "";
  if (spec.ROW_KIND === "CALC") {
    const c = CALC[measure];
    if (!c) return { value: null, state: "EMPTY" };
    const v = c.f(row);
    const inheritsPlaceholder = c.deps.some((d) => PLACEHOLDER_COLS.has(d));
    const inheritsModel = c.deps.some((d) => MODELLED_COLS.has(d));
    const isCover = measure.includes("CVR");
    return {
      value: v,
      state: inheritsPlaceholder ? "PLACEHOLDER" : inheritsModel ? "MODELLED" : "DERIVED",
      inherited: inheritsPlaceholder || inheritsModel,
      implausible: isCover && v !== null && ctx.implausibleWeeks !== undefined && v > ctx.implausibleWeeks,
      note: inheritsPlaceholder ? "Calculated from an invented figure, so it is invented too"
        : inheritsModel ? "Calculated from the modelled stock position" : undefined,
    };
  }

  const v = n(row, measure);
  if (pin !== undefined) return { value: pin, state: "PINNED", note: `Display override; the forecast underneath is ${v === null ? "empty" : v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` };
  if (spec.ROW_KIND === "PLACEHOLDER") return { value: v, state: "PLACEHOLDER", note: spec.BASIS_NOTE ?? "Invented so the layout can be used before the feed exists" };
  if (spec.MEASURE_BASIS === "MODELLED") return { value: v, state: "MODELLED", note: "A modelled position, not a measurement" };
  if (spec.MEASURE_BASIS === "PLAN") return { value: v, state: "PLAN" };
  return { value: v, state: "MEASURED" };
}

export type ValueFormat = "money" | "units" | "rate" | "asp" | "weeks" | "variance";

export function formatOf(spec: SpecRow): ValueFormat {
  if (spec.ROW_KIND === "VARIANCE") return "variance";
  const m = spec.MEASURE_CODE ?? "";
  if (m.includes("CVR")) return "weeks";
  if (m.endsWith("ASP")) return "asp";
  if (m.endsWith("_PCT")) return "rate";
  if (m.endsWith("_AUD")) return "money";
  return "units";
}

/** Head of planning: the ten rows that answer "are we on plan and can we buy?" */
export const PRESET_HOP = [1, 2, 3, 6, 7, 14, 16, 127, 133, 95];
/** Planning manager: twenty, adding the full-price and clearance split and the purchases line. */
export const PRESET_PM = [1, 2, 3, 4, 5, 6, 7, 8, 12, 14, 15, 16, 31, 56, 78, 95, 100, 127, 133, 135];
