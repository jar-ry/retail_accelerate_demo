// ─── Store plan: grid model (pure, client-side) ──────────────────────────────
//
// The grid builds every grain from store-weeks. A month, quarter or half is the
// sum of its weeks; its rates are rebuilt from those sums:
//   LFL %    = plan on comparable weeks / LY on the same weeks - 1
//   margin % = margin $ / plan sales
// so a quarter's LFL is never an average of three monthly LFLs, and the grid can
// never disagree with VW_STORE_PLAN_SUMMARY about the same plan.

import { PLAN_MONTHS } from "@/lib/hop/config";
import { toNum, isoDate } from "@/lib/hop/format";

export type Row = Record<string, unknown>;
export type Grain = "WEEK" | "MONTH" | "QUARTER" | "HALF" | "YEAR";

export type Col = {
  key: string;
  label: string;
  sub?: string;
  kind: "week" | "month" | "quarter" | "half" | "year";
  month?: string;
  weekEnd?: string;
  /** Week slots this column adds up. */
  slots: number[];
  expandable?: boolean;
};

export type Agg = {
  ly: number;
  plan: number;
  margin: number;
  lflPlan: number;
  lflLy: number;
  newPlan: number;
  weeks: number;
  halo: number;
  overridden: number;
};

export const EMPTY: Agg = { ly: 0, plan: 0, margin: 0, lflPlan: 0, lflLy: 0, newPlan: 0, weeks: 0, halo: 0, overridden: 0 };

export function add(a: Agg, w: Row): Agg {
  const plan = toNum(w.PLAN_SALES_AUD) ?? 0;
  const ly = toNum(w.LY_SALES_AUD) ?? 0;
  const lfl = w.IS_LFL_UNIVERSE === true;
  return {
    ly: a.ly + ly,
    plan: a.plan + plan,
    margin: a.margin + (toNum(w.PLAN_MARGIN_AUD) ?? 0),
    lflPlan: a.lflPlan + (lfl ? plan : 0),
    lflLy: a.lflLy + (lfl ? ly : 0),
    newPlan: a.newPlan + (lfl ? 0 : plan),
    weeks: a.weeks + 1,
    halo: a.halo + (w.IS_HALO_WEEK === true ? 1 : 0),
    overridden: a.overridden + (w.IS_WEEK_OVERRIDDEN === true ? 1 : 0),
  };
}

export const rates = (a: Agg) => ({
  // A new store's LFL is undefined, not -100%: it has no comparable base.
  lfl: a.lflLy ? a.lflPlan / a.lflLy - 1 : null,
  marginPct: a.plan ? a.margin / a.plan : null,
  growth: a.ly ? a.plan / a.ly - 1 : null,
});

export type Slot = { slot: number; month: string; weekInMonth: number; weekEnd: string };

/** The 26 week slots, taken across all stores: a store missing a week renders an
 *  empty cell in the right place instead of shifting its row left. */
export function slotsOf(weeks: Row[]): Slot[] {
  const m = new Map<number, Slot>();
  for (const w of weeks) {
    const slot = Number(w.WEEK_SLOT);
    if (!m.has(slot)) {
      m.set(slot, { slot, month: String(w.MONTH_NAME), weekInMonth: Number(w.WEEK_IN_MONTH), weekEnd: isoDate(w.WEEK_END_DATE) ?? "" });
    }
  }
  return [...m.values()].sort((a, b) => a.slot - b.slot);
}

export function buildColumns(grain: Grain, slots: Slot[], expanded: Set<string>): Col[] {
  const byMonth = (m: string) => slots.filter((s) => s.month === m);
  const all = slots.map((s) => s.slot);
  const out: Col[] = [];
  if (grain === "WEEK") {
    for (const s of slots) out.push({ key: `W${s.slot}`, label: s.weekEnd.slice(5).replace("-", "/"), sub: `${s.month} w${s.weekInMonth}`, kind: "week", month: s.month, weekEnd: s.weekEnd, slots: [s.slot] });
  } else if (grain === "MONTH") {
    for (const m of PLAN_MONTHS) {
      const ms = byMonth(m);
      out.push({ key: m, label: m, sub: `${ms.length} wks`, kind: "month", month: m, slots: ms.map((s) => s.slot), expandable: true });
      if (expanded.has(m)) {
        for (const s of ms) out.push({ key: `W${s.slot}`, label: s.weekEnd.slice(5).replace("-", "/"), sub: `w${s.weekInMonth}`, kind: "week", month: m, weekEnd: s.weekEnd, slots: [s.slot] });
      }
    }
  } else if (grain === "QUARTER") {
    const q1 = ["JUL", "AUG", "SEP"];
    out.push({ key: "Q1", label: "Q1", sub: "Jul–Sep", kind: "quarter", slots: slots.filter((s) => q1.includes(s.month)).map((s) => s.slot) });
    out.push({ key: "Q2", label: "Q2", sub: "Oct–Dec", kind: "quarter", slots: slots.filter((s) => !q1.includes(s.month)).map((s) => s.slot) });
  } else if (grain === "YEAR") {
    // The fiscal year runs July to June and only its first half is planned, so
    // the year column says so rather than reading as a full year's plan.
    out.push({ key: "FY27", label: "FY27", sub: `Jul 2026–Jun 2027 · ${slots.length} of 52 wks planned`, kind: "year", slots: all });
    return out;
  }
  out.push({ key: "H1", label: "H1", sub: "Jul–Dec 2026", kind: "half", slots: all });
  return out;
}

/** store -> slot -> week row. */
export function indexWeeks(weeks: Row[]): Map<string, Map<number, Row>> {
  const m = new Map<string, Map<number, Row>>();
  for (const w of weeks) {
    const s = String(w.STORE_CODE);
    if (!m.has(s)) m.set(s, new Map());
    m.get(s)!.set(Number(w.WEEK_SLOT), w);
  }
  return m;
}

export function aggregate(rows: Map<number, Row> | undefined, slots: number[]): Agg {
  let a = EMPTY;
  if (!rows) return a;
  for (const s of slots) {
    const w = rows.get(s);
    if (w) a = add(a, w);
  }
  return a;
}

/** Chain-wide totals for a column, across the stores shown. */
export function aggregateAll(index: Map<string, Map<number, Row>>, stores: string[], slots: number[]): Agg {
  let a = EMPTY;
  for (const code of stores) {
    const rows = index.get(code);
    if (!rows) continue;
    for (const s of slots) {
      const w = rows.get(s);
      if (w) a = add(a, w);
    }
  }
  return a;
}

export const METRICS = [
  { key: "LY", label: "LY sales", measure: "LY_SALES_AUD" },
  { key: "PLAN", label: "Plan sales", measure: "PLAN_SALES_AUD" },
  { key: "LFL", label: "LFL %", measure: "LFL_PCT" },
  { key: "MARGIN", label: "Margin $", measure: "PLAN_MARGIN_AUD" },
  { key: "MPCT", label: "Margin %", measure: "MARGIN_PCT" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
