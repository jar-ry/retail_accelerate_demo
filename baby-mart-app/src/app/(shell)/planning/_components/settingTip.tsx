"use client";

import { useEffect, useState } from "react";
import { Info, BookOpen, ChevronDown, ChevronRight } from "lucide-react";

// ─── Setting provenance and column legends ────────────────────────────────────
//
// Two different jobs, deliberately two components:
//
//   SettingTip     "which SETTING drives this number" -- names the parameter, its
//                  current value, what it drives, and links to where to change it.
//   ColumnLegend   "what IS this column" -- a definition list under a dense table.
//
// They answer different questions and a single tooltip trying to do both would do
// neither well. A planner reading "Wk cover" needs to know it uses that week's own
// forward sales rather than the horizon average; a planner reading an OVERBUY pill
// needs to know the multiplier that fired it. Only the second is a setting.

export type PlanningParameter = {
  key: string;
  value: string;
  valueType: string | null;
  category: string | null;
  affects: string | null;
  editable: boolean;
  min: number | null;
  max: number | null;
  drives: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

/** Module-level cache. Every planning page renders several SettingTips and they
 *  would otherwise each fire their own request on mount -- a dozen identical
 *  round trips per page load. The parameters change rarely, so one fetch shared
 *  across the whole session is the right trade. */
let paramCache: Record<string, PlanningParameter> | null = null;
let paramPromise: Promise<Record<string, PlanningParameter>> | null = null;
const paramListeners = new Set<(p: Record<string, PlanningParameter>) => void>();

function loadParameters(): Promise<Record<string, PlanningParameter>> {
  if (paramCache) return Promise.resolve(paramCache);
  if (paramPromise) return paramPromise;
  paramPromise = fetch("/api/planning/parameters")
    .then((r) => r.json())
    .then((body) => {
      const map: Record<string, PlanningParameter> = {};
      for (const p of (body?.settings ?? []) as PlanningParameter[]) map[p.key] = p;
      paramCache = map;
      paramListeners.forEach((fn) => fn(map));
      return map;
    })
    .catch(() => {
      // A failed parameter fetch must not break a page. Tips degrade to their
      // static label; the numbers they annotate are unaffected.
      paramCache = {};
      return {};
    });
  return paramPromise;
}

/** Invalidate the cache after a settings save so tips pick up the new value. */
export function invalidateParameters() {
  paramCache = null;
  paramPromise = null;
}

export function useParameters() {
  const [params, setParams] = useState<Record<string, PlanningParameter> | null>(paramCache);

  useEffect(() => {
    let live = true;
    loadParameters().then((p) => {
      if (live) setParams(p);
    });
    const listener = (p: Record<string, PlanningParameter>) => {
      if (live) setParams(p);
    };
    paramListeners.add(listener);
    return () => {
      live = false;
      paramListeners.delete(listener);
    };
  }, []);

  return params;
}

/** Formats a parameter's value for display, using its declared type rather than
 *  guessing from the string. A cut-off date and a multiplier read very
 *  differently and both arrive as text. */
function formatValue(p: PlanningParameter): string {
  if (p.valueType === "NUMBER") {
    const n = Number(p.value);
    return isFinite(n) ? String(n) : p.value;
  }
  return p.value;
}

/** Info icon whose hover panel names the setting behind a figure.
 *
 *  A hover PANEL rather than a title= attribute, deliberately: a native tooltip
 *  cannot hold a value plus a link, and this codebase has already had to fix one
 *  case where meaning hidden in a title= went unnoticed for weeks.
 *
 *  `settingKeys` takes an array because several figures are driven by more than
 *  one parameter -- a buy-status pill depends on both multipliers and on that
 *  class's cover target. */
export function SettingTip({
  settingKeys,
  extra,
  align = "left",
}: {
  settingKeys: string[];
  /** Non-setting context, e.g. this class's own cover target, which lives in
   *  PLANNING_CLASS_TARGET rather than PLANNING_SETTING. */
  extra?: { label: string; value: string }[];
  align?: "left" | "right";
}) {
  const params = useParameters();
  const [open, setOpen] = useState(false);

  const found = settingKeys
    .map((k) => params?.[k])
    .filter((p): p is PlanningParameter => p !== undefined);

  if (!params) {
    return <Info className="inline-block w-3 h-3 text-slate-300 align-text-top" />;
  }

  return (
    <span
      className="relative inline-block align-text-top"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Info className="w-3 h-3 text-slate-400 hover:text-violet-600 cursor-help" />
      {open && (found.length > 0 || (extra && extra.length > 0)) && (
        <span
          className={`absolute z-50 top-4 ${
            align === "right" ? "right-0" : "left-0"
          } w-72 bg-white border border-slate-300 rounded-lg shadow-xl p-3 text-left normal-case font-normal tracking-normal`}
        >
          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Driven by
          </span>
          {found.map((p) => (
            <span key={p.key} className="block mb-2 last:mb-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] text-violet-700">{p.key}</span>
                <span className="font-mono text-[11px] font-bold text-slate-900">
                  {formatValue(p)}
                </span>
              </span>
              {p.drives && (
                <span className="block text-[10px] text-slate-600 leading-snug mt-0.5">
                  {p.drives}
                </span>
              )}
              {!p.editable && (
                <span className="block text-[9px] text-amber-700 mt-0.5">
                  Generation parameter — needs a data rebuild to change.
                </span>
              )}
            </span>
          ))}
          {extra?.map((e) => (
            <span key={e.label} className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] text-slate-500">{e.label}</span>
              <span className="font-mono text-[11px] font-semibold text-slate-900">{e.value}</span>
            </span>
          ))}
          <a
            href="/settings?persona=planning&tab=parameters"
            className="block mt-2 pt-2 border-t border-slate-100 text-[10px] font-medium text-violet-700 hover:underline"
          >
            Change in Settings &rarr;
          </a>
        </span>
      )}
    </span>
  );
}

export type ColumnDef = {
  label: string;
  definition: string;
  /** Setting keys behind this column, surfaced in the legend as well as the tip. */
  settingKeys?: string[];
};

/** Collapsible definition list for a dense table.
 *
 *  Collapsed by default: an expanded legend above every table would push the
 *  numbers below the fold, and the people who need it are the ones seeing the
 *  grid for the first time rather than the planner who uses it daily. */
export function ColumnLegend({
  columns,
  title = "Column guide",
  defaultOpen = false,
}: {
  columns: ColumnDef[];
  title?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const params = useParameters();

  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-violet-700 uppercase tracking-wider cursor-pointer"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <BookOpen className="w-3 h-3" />
        {title}
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">
          {columns.map((c) => (
            <div key={c.label} className="text-[10px] leading-snug">
              <dt className="font-semibold text-slate-800 inline">{c.label}</dt>
              <dd className="text-slate-600 inline"> — {c.definition}</dd>
              {c.settingKeys?.map((k) => {
                const p = params?.[k];
                return (
                  <dd key={k} className="block text-[9px] text-violet-700 font-mono mt-0.5">
                    {k}
                    {p ? ` = ${formatValue(p)}` : ""}
                  </dd>
                );
              })}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Shared column definitions ────────────────────────────────────────────────
//
// Defined once and imported, so the same column carries the same definition
// wherever it appears. The three cover metrics in particular have to be defined
// in one place: they are genuinely different measures that were once all labelled
// "forward cover", which put three different numbers under one name across three
// pages.

export const COVER_COLUMNS: ColumnDef[] = [
  {
    label: "Stock cover",
    definition:
      "Stock on hand divided by average weekly sales across the plan horizon. What you hold, ignoring anything on order.",
  },
  {
    label: "Cover incl. on order",
    definition:
      "Stock plus on-order divided by the same average weekly sales. This is the figure BUY_STATUS is judged on, because open-to-buy also subtracts on-order commitments.",
    settingKeys: ["BUY_OVERBUY_MULT", "BUY_UNDERBUY_MULT"],
  },
  {
    label: "Wk cover",
    definition:
      "Stock divided by THAT WEEK'S own forward sales rate. A different denominator from the two above, so it will not match them — it falls through a seasonal build even when stock is flat.",
  },
  {
    label: "Target cover",
    definition:
      "Weeks of stock the plan intends to hold for this class. Editable per class in Settings.",
  },
  {
    label: "Buy status",
    definition:
      "OVERBUY, BALANCED or UNDERBUY, from cover including on order against target cover.",
    settingKeys: ["BUY_OVERBUY_MULT", "BUY_UNDERBUY_MULT"],
  },
  {
    label: "Open-to-Buy",
    definition:
      "The gap between the stock the plan wants to hold and what is already owned or committed. Negative means already overcommitted.",
    settingKeys: ["OTB_PLANNED_FACTOR"],
  },
];

export const MFP_COLUMNS: ColumnDef[] = [
  { label: "LY", definition: "Last year actual, the comparative for growth." },
  { label: "Bud", definition: "Signed-off budget." },
  { label: "FC", definition: "Current working forecast. The only editable version." },
  {
    label: "Var Bud",
    definition: "Forecast against budget. The variance that raises a sales exception.",
    settingKeys: ["EXC_SALES_RISK_PCT", "EXC_SALES_OPP_PCT"],
  },
  {
    label: "LFL growth",
    definition:
      "Like-for-like growth, stripped of store openings and closures. Read against the class strategy: G means planned growth, D means a deliberate managed decline.",
  },
  {
    label: "GP %",
    definition:
      "Realised POS margin rate, always rebuilt as total margin divided by total sales — never the average of child percentages.",
  },
  {
    label: "GP gap",
    definition: "Forecast margin rate against budget, in percentage points.",
    settingKeys: ["EXC_MARGIN_GAP_PP"],
  },
  { label: "ASP", definition: "Average selling price: sales divided by units." },
  {
    label: "Options",
    definition:
      "Count of ranged options (SKUs). A point-in-time count, so it is never summed across periods.",
  },
];

export const GRID_COLUMNS: ColumnDef[] = [
  { label: "LLY", definition: "Two years ago, the comparative behind CAGR." },
  { label: "LY", definition: "Last year actual." },
  { label: "Bud", definition: "Signed-off budget." },
  {
    label: "App. FC",
    definition:
      "The APPROVED forecast. Frozen at approval and never written to by an edit or a scenario, which is why Var App. FC reads 0.00% until you change something.",
  },
  { label: "FC", definition: "Working forecast. The only editable row." },
  {
    label: "Act",
    definition: "Actuals. Present only up to the cut-off; a dash after it.",
    settingKeys: ["ACTUALS_CUTOFF_DATE"],
  },
  {
    label: "Act/FC",
    definition:
      "Actuals where the week is closed, forecast after. Derived, never stored, so it cannot drift from the two rows above it.",
    settingKeys: ["ACTUALS_CUTOFF_DATE"],
  },
  { label: "Var LY / Var Bud", definition: "Forecast against last year and against budget." },
  {
    label: "Var App. FC",
    definition: "Forecast against the approved plan. This is your uncommitted divergence.",
  },
  {
    label: "CAGR",
    definition:
      "Compound annual growth from LLY through to FC — two years, so the square root of the ratio. Not shown on Margin % because compounding a rate is not meaningful.",
  },
  {
    label: "Month column",
    definition:
      "Bold subtotal of that month's four weeks. Margin % here is total margin over total sales, not the mean of four weekly percentages.",
  },
];

export const SCENARIO_COLUMNS: ColumnDef[] = [
  {
    label: "Sales impact",
    definition: "Change in forecast sales for the scenario's scope and half.",
  },
  { label: "GP impact", definition: "Change in gross profit dollars." },
  {
    label: "GP rate",
    definition:
      "Change in margin RATE in percentage points. A rationalisation usually lowers GP dollars while lifting the rate, so both matter.",
  },
  {
    label: "Stock impact",
    definition:
      "Change in inventory. Negative releases cash; positive requires an extra buy. Derived from the option-level range change, because the weekly grid holds no stock line.",
  },
  {
    label: "Range",
    definition:
      "Options dropped, added or repriced. Deletions are chosen by gross profit per option per trading week, not by sales.",
    settingKeys: ["SCENARIO_DEMAND_TRANSFER_PCT"],
  },
];
