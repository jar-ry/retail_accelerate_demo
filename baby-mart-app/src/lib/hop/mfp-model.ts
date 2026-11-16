// ─── MFP: the product-plan model (pure, shared by client and server) ─────────
//
// A department's plan is a handful of INPUTS -- LFL %, the growth stated at range
// review, Buying's units and ASP, the POS margin rate, the planned first margin,
// and four option counts. Everything else is DERIVED, and derived the same way
// whether the inputs came from a cell edit or a pasted upload:
//
//   identity 1   top-down budget  = LY actual x (1 + LFL %)
//   identity 2   bottom-up budget = units x ASP
//   identity 3   POS margin $     = bottom-up x POS margin %
//   options      dropped   = new dropped + ongoing dropped
//                presented = new + ongoing + dropped
//
// RBU rows are roll-ups of their departments: amounts sum, rates are rebuilt
// from the summed components (never averaged), stated growth is weighted by last
// year and margin rates by the bottom-up budget. So the identities hold at both
// levels by construction, and departments always add to their RBU.

export type DeptInputs = {
  LFL_PCT: number;
  GROWTH_STATED: number;
  TPR_UNITS: number;
  TPR_ASP: number;
  POS_PCT: number;
  F27_FIRST_MARGIN_PCT: number;
  OPT_NEW: number;
  OPT_ONGOING: number;
  OPT_NEW_DESELECTED: number;
  OPT_ONGOING_DESELECTED: number;
};

/** Last year's record: ingested, never typed. */
export type DeptHistory = {
  F26_ACTUAL: number;
  F26_UNITS: number;
  F26_ASP: number;
  F26_FIRST_MARGIN_PCT: number;
  F26_POS_ACTUAL: number;
  EXIT_MARGIN_PCT: number;
};

export type Dept = { code: string; name: string; rbu: string } & DeptInputs & DeptHistory;

/** Measure code in FACT_MFP_PRODUCT_PLAN for each modelled value. */
export const MEASURE_OF: Record<string, string> = {
  F26_ACTUAL: "F26_ACTUAL_SALES_AUD",
  LFL_FORECAST: "F27_LFL_FORECAST_AUD",
  LFL_PCT: "LFL_GROWTH_PCT",
  GROWTH_STATED: "TOTAL_GROWTH_PCT_STATED",
  TPR_BUDGET: "TPR_BUDGET_AUD",
  TPR_UNITS: "F27_TPR_UNIT_SALES",
  TPR_ASP: "F27_TPR_ASP_AUD",
  POS_SALES: "F27_POS_SALES_AUD",
  POS_PCT: "F27_POS_PCT",
  EXIT_MARGIN_PCT: "EXIT_POS_MARGIN_PCT",
  F26_MIX_PCT: "F26_MIX_PCT",
  F27_TPR_MIX_PCT: "F27_TPR_MIX_PCT",
  F26_FIRST_MARGIN_PCT: "F26_FIRST_MARGIN_PCT",
  F27_FIRST_MARGIN_PCT: "F27_TPR_FIRST_MARGIN_PCT",
  F26_ASP: "F26_ASP_AUD",
  F26_UNITS: "F26_UNIT_SALES",
  F26_POS_ACTUAL: "F26_POS_ACTUAL_AUD",
  OPT_PRESENTED: "OPTIONS_PRESENTED",
  OPT_NEW: "OPTIONS_NEW",
  OPT_ONGOING: "OPTIONS_ONGOING",
  OPT_DESELECTED: "OPTIONS_DESELECTED",
  OPT_NEW_DESELECTED: "OPTIONS_NEW_DESELECTED",
  OPT_ONGOING_DESELECTED: "OPTIONS_ONGOING_DESELECTED",
};

export type Modelled = Record<keyof typeof MEASURE_OF, number>;

const div = (a: number, b: number) => (b ? a / b : 0);

export function deriveDept(d: Dept, totF26: number, totTpr: number): Modelled {
  const tpr = d.TPR_UNITS * d.TPR_ASP;
  const dropped = d.OPT_NEW_DESELECTED + d.OPT_ONGOING_DESELECTED;
  return {
    F26_ACTUAL: d.F26_ACTUAL,
    LFL_FORECAST: d.F26_ACTUAL * (1 + d.LFL_PCT),
    LFL_PCT: d.LFL_PCT,
    GROWTH_STATED: d.GROWTH_STATED,
    TPR_BUDGET: tpr,
    TPR_UNITS: d.TPR_UNITS,
    TPR_ASP: d.TPR_ASP,
    POS_SALES: tpr * d.POS_PCT,
    POS_PCT: d.POS_PCT,
    EXIT_MARGIN_PCT: d.EXIT_MARGIN_PCT,
    F26_MIX_PCT: div(d.F26_ACTUAL, totF26),
    F27_TPR_MIX_PCT: div(tpr, totTpr),
    F26_FIRST_MARGIN_PCT: d.F26_FIRST_MARGIN_PCT,
    F27_FIRST_MARGIN_PCT: d.F27_FIRST_MARGIN_PCT,
    F26_ASP: d.F26_ASP,
    F26_UNITS: d.F26_UNITS,
    F26_POS_ACTUAL: d.F26_POS_ACTUAL,
    OPT_PRESENTED: d.OPT_NEW + d.OPT_ONGOING + dropped,
    OPT_NEW: d.OPT_NEW,
    OPT_ONGOING: d.OPT_ONGOING,
    OPT_DESELECTED: dropped,
    OPT_NEW_DESELECTED: d.OPT_NEW_DESELECTED,
    OPT_ONGOING_DESELECTED: d.OPT_ONGOING_DESELECTED,
  };
}

export function rollUp(depts: Modelled[], totF26: number, totTpr: number): Modelled {
  const s = (k: keyof Modelled) => depts.reduce((a, d) => a + d[k], 0);
  const f26 = s("F26_ACTUAL");
  const tpr = s("TPR_BUDGET");
  const units = s("TPR_UNITS");
  const lflFc = s("LFL_FORECAST");
  const pos = s("POS_SALES");
  const wF26 = (k: keyof Modelled) => div(depts.reduce((a, d) => a + d[k] * d.F26_ACTUAL, 0), f26);
  const wTpr = (k: keyof Modelled) => div(depts.reduce((a, d) => a + d[k] * d.TPR_BUDGET, 0), tpr);
  return {
    F26_ACTUAL: f26,
    LFL_FORECAST: lflFc,
    LFL_PCT: div(lflFc, f26) - 1,
    GROWTH_STATED: div(depts.reduce((a, d) => a + d.F26_ACTUAL * (1 + d.GROWTH_STATED), 0), f26) - 1,
    TPR_BUDGET: tpr,
    TPR_UNITS: units,
    TPR_ASP: div(tpr, units),
    POS_SALES: pos,
    POS_PCT: div(pos, tpr),
    EXIT_MARGIN_PCT: wF26("EXIT_MARGIN_PCT"),
    F26_MIX_PCT: div(f26, totF26),
    F27_TPR_MIX_PCT: div(tpr, totTpr),
    F26_FIRST_MARGIN_PCT: wF26("F26_FIRST_MARGIN_PCT"),
    F27_FIRST_MARGIN_PCT: wTpr("F27_FIRST_MARGIN_PCT"),
    F26_ASP: div(f26, s("F26_UNITS")),
    F26_UNITS: s("F26_UNITS"),
    F26_POS_ACTUAL: s("F26_POS_ACTUAL"),
    OPT_PRESENTED: s("OPT_PRESENTED"),
    OPT_NEW: s("OPT_NEW"),
    OPT_ONGOING: s("OPT_ONGOING"),
    OPT_DESELECTED: s("OPT_DESELECTED"),
    OPT_NEW_DESELECTED: s("OPT_NEW_DESELECTED"),
    OPT_ONGOING_DESELECTED: s("OPT_ONGOING_DESELECTED"),
  };
}

/** Every department and RBU, fully derived, keyed "LEVEL|CODE". */
export function derivePlan(depts: Dept[]): Map<string, Modelled> {
  const totF26 = depts.reduce((a, d) => a + d.F26_ACTUAL, 0);
  const totTpr = depts.reduce((a, d) => a + d.TPR_UNITS * d.TPR_ASP, 0);
  const out = new Map<string, Modelled>();
  const byRbu = new Map<string, Modelled[]>();
  for (const d of depts) {
    const m = deriveDept(d, totF26, totTpr);
    out.set(`DEPARTMENT|${d.code}`, m);
    if (!byRbu.has(d.rbu)) byRbu.set(d.rbu, []);
    byRbu.get(d.rbu)!.push(m);
  }
  for (const [rbu, ms] of byRbu) out.set(`RBU|${rbu}`, rollUp(ms, totF26, totTpr));
  return out;
}

// ─── The grid ────────────────────────────────────────────────────────────────

export type ColKind = "money" | "rate" | "pts" | "count" | "asp";

export type MfpColumn = {
  key: string;
  label: string;
  band: "SALES" | "MIX" | "ASP_UNITS" | "MARGIN" | "OPTIONS";
  kind: ColKind;
  /** The registry measure an edit to this column is governed by, if editable. */
  owns?: string;
  /** The department input it sets, and how a typed value maps onto it. */
  input?: keyof DeptInputs;
  solve?: "LFL_FROM_BUDGET" | "UNITS_FROM_TPR";
  title?: string;
};

export const BANDS: { key: MfpColumn["band"]; label: string; blurb: string }[] = [
  { key: "SALES", label: "Sales", blurb: "Top-down against bottom-up, and the growth each implies" },
  { key: "MIX", label: "Mix", blurb: "Share of the business" },
  { key: "ASP_UNITS", label: "ASP and units", blurb: "Why the two sides differ: price or volume" },
  { key: "MARGIN", label: "Margin", blurb: "First margin at intake; POS margin after discount" },
  { key: "OPTIONS", label: "Options", blurb: "The range committed, and what was dropped" },
];

export const MFP_COLUMNS: MfpColumn[] = [
  { key: "F26_ACTUAL", label: "LY actual", band: "SALES", kind: "money", title: "FY26 H1 POS, Jul–Dec 2025" },
  { key: "LFL_PCT", label: "LFL %", band: "SALES", kind: "rate", owns: "LFL_GROWTH_PCT", input: "LFL_PCT" },
  { key: "LFL_FORECAST", label: "Top-down", band: "SALES", kind: "money", owns: "F27_LFL_FORECAST_AUD", solve: "LFL_FROM_BUDGET", title: "LY × (1 + LFL %). Editing it back-solves LFL %." },
  { key: "GROWTH_STATED", label: "Growth stated", band: "SALES", kind: "rate", owns: "TOTAL_GROWTH_PCT_STATED", input: "GROWTH_STATED", title: "The growth presented at range review: a manual input" },
  { key: "TPR_BUDGET", label: "Bottom-up", band: "SALES", kind: "money", owns: "TPR_BUDGET_AUD", solve: "UNITS_FROM_TPR", title: "Units × ASP from the range review. Editing it re-solves units at the planned ASP." },
  { key: "GROWTH_DERIVED", label: "Growth delivered", band: "SALES", kind: "rate", title: "What the committed range actually delivers over last year" },
  { key: "GROWTH_BREAK_PTS", label: "Break", band: "SALES", kind: "pts", title: "Growth delivered less growth stated. The question for range review." },
  { key: "VAR_BUD_TO_TPR_AUD", label: "vs top-down $", band: "SALES", kind: "money", title: "Bottom-up less top-down" },
  { key: "F26_MIX_PCT", label: "LY mix", band: "MIX", kind: "rate" },
  { key: "F27_TPR_MIX_PCT", label: "Plan mix", band: "MIX", kind: "rate" },
  { key: "F26_ASP", label: "LY ASP", band: "ASP_UNITS", kind: "asp" },
  { key: "TPR_ASP", label: "Plan ASP", band: "ASP_UNITS", kind: "asp", owns: "F27_TPR_ASP_AUD", input: "TPR_ASP" },
  { key: "ASP_GROWTH_PCT", label: "ASP growth", band: "ASP_UNITS", kind: "rate" },
  { key: "F26_UNITS", label: "LY units", band: "ASP_UNITS", kind: "count" },
  { key: "TPR_UNITS", label: "Plan units", band: "ASP_UNITS", kind: "count", owns: "F27_TPR_UNIT_SALES", input: "TPR_UNITS" },
  { key: "UNIT_GROWTH_PCT", label: "Unit growth", band: "ASP_UNITS", kind: "rate" },
  { key: "F26_FIRST_MARGIN_PCT", label: "LY first margin", band: "MARGIN", kind: "rate" },
  { key: "F27_FIRST_MARGIN_PCT", label: "Plan first margin", band: "MARGIN", kind: "rate", owns: "F27_TPR_FIRST_MARGIN_PCT", input: "F27_FIRST_MARGIN_PCT" },
  { key: "FIRST_MARGIN_MOVE_PTS", label: "Move", band: "MARGIN", kind: "pts" },
  { key: "POS_PCT", label: "Plan POS margin", band: "MARGIN", kind: "rate", owns: "F27_POS_PCT", input: "POS_PCT", title: "After discount. Not the same number as first margin." },
  { key: "EXIT_MARGIN_PCT", label: "LY exit margin", band: "MARGIN", kind: "rate" },
  { key: "OPT_PRESENTED", label: "Presented", band: "OPTIONS", kind: "count" },
  { key: "OPT_NEW", label: "New", band: "OPTIONS", kind: "count", owns: "OPTIONS_NEW", input: "OPT_NEW" },
  { key: "OPT_ONGOING", label: "Ongoing", band: "OPTIONS", kind: "count", owns: "OPTIONS_ONGOING", input: "OPT_ONGOING" },
  { key: "OPT_COMMITTED", label: "Committed", band: "OPTIONS", kind: "count" },
  { key: "OPT_NEW_DESELECTED", label: "New dropped", band: "OPTIONS", kind: "count", owns: "OPTIONS_NEW_DESELECTED", input: "OPT_NEW_DESELECTED" },
  { key: "OPT_ONGOING_DESELECTED", label: "Ongoing dropped", band: "OPTIONS", kind: "count", owns: "OPTIONS_ONGOING_DESELECTED", input: "OPT_ONGOING_DESELECTED" },
  { key: "DESELECT_PCT", label: "Dropped %", band: "OPTIONS", kind: "rate" },
  { key: "SALES_AT_RISK_AUD", label: "Budget on dropped", band: "OPTIONS", kind: "money" },
];

export const COLUMN = new Map(MFP_COLUMNS.map((c) => [c.key, c]));

/** Validate a typed value for a column. Returns an error, or null. */
export function validate(col: MfpColumn, v: number): string | null {
  if (!Number.isFinite(v)) return "Enter a number.";
  // Options are whole counts. Planned units need not be: a department plan is an
  // allocation, and re-solving units from a bottom-up budget rarely lands on one.
  if (col.kind === "count" && v < 0) return "Enter zero or more.";
  if (col.kind === "count" && col.key.startsWith("OPT_") && !Number.isInteger(v)) return "Enter a whole number of options.";
  if ((col.kind === "money" || col.kind === "asp") && v <= 0) return "Enter an amount above zero.";
  if (col.key === "LFL_PCT" || col.key === "GROWTH_STATED") {
    if (v < -0.9 || v > 3) return "Enter a growth rate between -90% and +300%.";
  }
  if (col.key === "POS_PCT" || col.key === "F27_FIRST_MARGIN_PCT") {
    if (v < 0 || v >= 0.95) return "Enter a margin between 0% and 95%.";
  }
  return null;
}

/** Apply a typed value to a department's inputs. */
export function applyEdit(d: Dept, col: MfpColumn, v: number): Dept {
  const next = { ...d };
  if (col.solve === "LFL_FROM_BUDGET") next.LFL_PCT = d.F26_ACTUAL ? v / d.F26_ACTUAL - 1 : 0;
  else if (col.solve === "UNITS_FROM_TPR") next.TPR_UNITS = d.TPR_ASP ? v / d.TPR_ASP : 0;
  else if (col.input) next[col.input] = v;
  return next;
}

// ─── Paste upload ────────────────────────────────────────────────────────────

/** The upload's columns, in template order. Percentages accept "8%" or 0.08. */
export const UPLOAD_COLUMNS: { header: string; input: keyof DeptInputs; kind: "rate" | "money" | "count" }[] = [
  { header: "LFL %", input: "LFL_PCT", kind: "rate" },
  { header: "Growth stated", input: "GROWTH_STATED", kind: "rate" },
  { header: "Plan units", input: "TPR_UNITS", kind: "count" },
  { header: "Plan ASP", input: "TPR_ASP", kind: "money" },
  { header: "POS margin %", input: "POS_PCT", kind: "rate" },
  { header: "First margin %", input: "F27_FIRST_MARGIN_PCT", kind: "rate" },
  { header: "New options", input: "OPT_NEW", kind: "count" },
  { header: "Ongoing options", input: "OPT_ONGOING", kind: "count" },
  { header: "New dropped", input: "OPT_NEW_DESELECTED", kind: "count" },
  { header: "Ongoing dropped", input: "OPT_ONGOING_DESELECTED", kind: "count" },
];

export function parseCell(raw: string, kind: "rate" | "money" | "count"): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  const isPct = s.endsWith("%");
  const n = Number(isPct ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return null;
  if (kind === "rate") return isPct || Math.abs(n) > 1.5 ? n / 100 : n;
  return n;
}

/** The current plan as a tab-separated template, ready to edit in a spreadsheet
 *  and paste back. Full precision, so pasting it back unchanged changes nothing:
 *  a template rounded for display would move the plan on every round trip. */
export function toTemplate(depts: Dept[]): string {
  const head = ["Department", ...UPLOAD_COLUMNS.map((c) => c.header)].join("\t");
  const rows = depts.map((d) =>
    [
      `${d.code} ${d.name}`,
      ...UPLOAD_COLUMNS.map((c) => {
        const v = d[c.input];
        return c.kind === "rate" ? `${(v * 100).toFixed(8)}%` : c.kind === "money" ? v.toFixed(8) : String(v);
      }),
    ].join("\t"),
  );
  return [head, ...rows].join("\n");
}

export type Check = { check: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

/** Parse a pasted plan against the current departments. Hard failures stop the
 *  upload; warnings let it through with a reason. */
export function parsePaste(text: string, current: Dept[]): { depts: Dept[] | null; checks: Check[] } {
  const checks: Check[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { depts: null, checks: [{ check: "Format", status: "FAIL", detail: "Paste a header row and one row per department." }] };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const idx = UPLOAD_COLUMNS.map((c) => header.indexOf(c.header.toLowerCase()));
  const missing = UPLOAD_COLUMNS.filter((_, i) => idx[i] < 0).map((c) => c.header);
  if (missing.length) return { depts: null, checks: [{ check: "Columns", status: "FAIL", detail: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` }] };

  const byCode = new Map(current.map((d) => [d.code, d]));
  const seen = new Set<string>();
  const out: Dept[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep);
    const code = (cells[0] ?? "").trim().match(/^\d{3}/)?.[0] ?? "";
    const base = byCode.get(code);
    if (!base) {
      checks.push({ check: "Department", status: "FAIL", detail: `'${cells[0]}' is not a department code (010-050).` });
      continue;
    }
    if (seen.has(code)) {
      checks.push({ check: "Department", status: "FAIL", detail: `${code} appears twice.` });
      continue;
    }
    seen.add(code);
    const next: Dept = { ...base };
    for (let i = 0; i < UPLOAD_COLUMNS.length; i++) {
      const c = UPLOAD_COLUMNS[i];
      const v = parseCell(cells[idx[i]] ?? "", c.kind);
      if (v === null) {
        checks.push({ check: "Values", status: "FAIL", detail: `${code} ${c.header}: '${cells[idx[i]] ?? ""}' is not a number.` });
        continue;
      }
      const col = MFP_COLUMNS.find((m) => m.input === c.input)!;
      const err = validate(col, v);
      if (err) checks.push({ check: "Values", status: "FAIL", detail: `${code} ${c.header}: ${err}` });
      next[c.input] = v;
    }
    out.push(next);
  }
  for (const d of current) if (!seen.has(d.code)) checks.push({ check: "Department", status: "FAIL", detail: `${d.code} ${d.name} is missing. Upload every department, so the RBUs add up.` });
  return { depts: checks.some((c) => c.status === "FAIL") ? null : out, checks };
}

/** Checks on a parsed plan: the identities, and the judgement calls that need a
 *  reason. Materiality is a planning setting, in points. */
export function planChecks(depts: Dept[], materialityPts: number): Check[] {
  const plan = derivePlan(depts);
  const checks: Check[] = [];
  let worst = 0;
  for (const [, m] of plan) {
    worst = Math.max(worst, Math.abs(m.LFL_FORECAST - m.F26_ACTUAL * (1 + m.LFL_PCT)), Math.abs(m.TPR_BUDGET - m.TPR_UNITS * m.TPR_ASP), Math.abs(m.POS_SALES - m.TPR_BUDGET * m.POS_PCT));
  }
  checks.push({ check: "Identities", status: worst < 0.01 ? "PASS" : "FAIL", detail: `Top-down = LY × (1 + LFL); bottom-up = units × ASP; POS $ = bottom-up × POS %. Largest gap $${worst.toFixed(2)}.` });
  checks.push({ check: "Options", status: "PASS", detail: "Presented and dropped are calculated from their parts, so the counts reconcile." });
  for (const d of depts) {
    const m = plan.get(`DEPARTMENT|${d.code}`)!;
    const delivered = d.F26_ACTUAL ? m.TPR_BUDGET / d.F26_ACTUAL - 1 : 0;
    const breakPts = (delivered - d.GROWTH_STATED) * 100;
    if (Math.abs(breakPts) >= materialityPts) {
      checks.push({ check: "Growth break", status: "WARN", detail: `${d.code} ${d.name}: the range delivers ${(delivered * 100).toFixed(1)}% against ${(d.GROWTH_STATED * 100).toFixed(1)}% stated (${breakPts > 0 ? "+" : ""}${breakPts.toFixed(1)} pts).` });
    }
    const move = (d.F27_FIRST_MARGIN_PCT - d.F26_FIRST_MARGIN_PCT) * 100;
    if (Math.abs(move) > 10) {
      checks.push({ check: "First margin", status: "WARN", detail: `${d.code} ${d.name}: first margin moves ${move > 0 ? "+" : ""}${move.toFixed(1)} pts in a year, the largest kind of assumption in a plan.` });
    }
    const aspG = d.F26_ASP ? d.TPR_ASP / d.F26_ASP - 1 : 0;
    if (Math.abs(aspG) > 0.25) checks.push({ check: "ASP", status: "WARN", detail: `${d.code} ${d.name}: ASP moves ${(aspG * 100).toFixed(1)}% on last year.` });
  }
  return checks;
}
