"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  MessageSquarePlus, Save, RotateCcw, Loader2, Tag, CalendarClock, Info,
} from "lucide-react";
import {
  Breadcrumb, PageHeader, Card, CurrencyToggle, Loading, ErrorState,
  StrategyPill, type Currency,
} from "../../../_components/ui";
import { SettingTip, ColumnLegend, GRID_COLUMNS } from "../../../_components/settingTip";
import { toPathSegment, fromPathSegment } from "@/lib/class-slug";

// ─── Excel-parity weekly planning grid ────────────────────────────────────────
//
// Replaces the customer's per-class planning worksheet. The structural features
// that make it recognisable as that worksheet, rather than as a generic table:
//
//   * WEEK columns with a BOLD MONTH SUBTOTAL column interleaved after every
//     fourth week, then a half total at the right.
//   * Three METRIC BLOCKS down the side -- Sales, Margin $, Margin % -- each
//     containing one row per version.
//   * Seven version rows (LLY, LY, Bud, App. FC, FC, Act, Act/FC) with the
//     workbook's own fills, plus four derived rows (Var LY, Var Bud,
//     Var App. FC, CAGR).
//   * Act stops at the actuals cut-off and shows a dash after it; Act/FC blends
//     across that boundary.
//   * Only FC is editable. Edited cells take a blue fill.
//   * A class tab strip standing in for the workbook's sheet tabs.
//   * Comments, region tags and event markers on header rows.
//
// EVERYTHING DERIVED IS DERIVED HERE, IN THE BROWSER.
//
// Month subtotals, the half total, every margin percentage, all four variance
// rows and CAGR are computed client-side from the raw per-week values. That is
// not laziness about pushing work to SQL -- it is the requirement. The instant a
// planner types into an FC cell, all of those have to move with the keystroke. A
// server round trip per edit would leave the displayed total disagreeing with the
// cell above it for as long as the request was in flight, which is precisely the
// behaviour that destroys trust in a planning grid.
//
// RATIOS ARE NEVER AVERAGED. Margin % at a month column is
// SUM(gp) / SUM(sales) over that month's four weeks, never the mean of four
// weekly percentages. Those differ whenever the weeks differ in size, i.e.
// always, and the error is nearly impossible to spot on a grid this dense.

type GridWeek = {
  key: string;
  periodCode: string;
  periodNo: number;
  monthName: string;
  weekNo: number;
  weekSeq: number;
  weekEnding: string | null;
  isClosed: boolean;
};

type GridMonth = {
  key: string;
  periodCode: string;
  monthName: string;
  periodNo: number;
  weekKeys: string[];
};

type EditMeta = {
  pinned: boolean;
  reasonCode: string | null;
  reasonNote: string | null;
  editedBy: string | null;
  editedAt: string | null;
  baseline: number;
};

type Annotation = {
  id: string;
  periodCode: string | null;
  weekNo: number | null;
  weekKey: string | null;
  metric: string | null;
  version: string | null;
  type: string;
  value: string;
  author: string | null;
  createdAt: string | null;
};

type GridResponse = {
  currency: Currency;
  department: string;
  class: string;
  classCode: string | null;
  fiscalYear: string;
  half: string | null;
  scenarioId: string | null;
  weeks: GridWeek[];
  months: GridMonth[];
  /** values[metric][version][weekKey] */
  values: Record<string, Record<string, Record<string, number>>>;
  /** edited[metric][weekKey] */
  edited: Record<string, Record<string, EditMeta>>;
  annotations: Annotation[];
  classTabs: { class: string; classCode: string; strategy: string | null }[];
  actualsCutoff: string | null;
  planner: string | null;
  lastEditedAt: string | null;
  lastEditedBy: string | null;
};

// ─── Row and block definitions ────────────────────────────────────────────────

/** The three metric blocks. `SLS_PHP` and `POS_GP_AMT` are stored and additive;
 *  `MARGIN_PCT` is entirely derived and therefore not editable. */
const BLOCKS = [
  { id: "SLS_PHP", label: "Sales (000's)", kind: "amount" as const },
  { id: "POS_GP_AMT", label: "Margin (000's)", kind: "amount" as const },
  { id: "MARGIN_PCT", label: "Margin %", kind: "percent" as const },
];

/** Version rows in the workbook's order, with its fills.
 *  `editable` is FC only: it is the working forecast, and everything else is
 *  either history, a signed-off baseline, or derived from those. */
const VERSION_ROWS = [
  { id: "LLY", label: "LLY", cls: "", editable: false },
  { id: "LY", label: "LY", cls: "", editable: false },
  { id: "BUD", label: "Bud", cls: "", editable: false },
  { id: "APP_FC", label: "App. FC", cls: "bg-orange-100", editable: false },
  { id: "FC", label: "FC", cls: "bg-pink-100", editable: true },
  { id: "ACT", label: "Act", cls: "", editable: false },
  { id: "ACT_FC", label: "Act/FC", cls: "bg-sky-100", editable: false },
];

/** Derived rows. `pp` marks the ones that must be expressed in percentage
 *  points rather than percent when they sit inside the Margin % block: a margin
 *  rate moving from 36% to 38% is +2pp, and calling that +5.6% would be a
 *  different and misleading claim. */
const DERIVED_ROWS = [
  { id: "VAR_LY", label: "Var LY", against: "LY", cls: "" },
  { id: "VAR_BUD", label: "Var Bud", against: "BUD", cls: "" },
  { id: "VAR_APP_FC", label: "Var App. FC", against: "APP_FC", cls: "bg-emerald-100" },
];

const REGION_TAGS = ["ALL", "VIC", "NSW", "QLD", "WA", "SA"];
const EVENT_MARKERS = ["NEW", "RE-LOC", "CLOSE", "PROMO"];

/** A grid column is either a single week, a bold month subtotal, or the half
 *  total. Declared at module scope so the derivation callbacks and the block
 *  renderer share one type rather than casting. */
type Col =
  | { kind: "week"; key: string; week: GridWeek }
  | { kind: "month"; key: string; month: GridMonth }
  | { kind: "total"; key: string; weekKeys: string[] };

/** Uncommitted edits are held as RAW TEXT, not numbers.
 *
 *  Storing a number and re-rendering it through a formatter fights the user: the
 *  moment they type "5" the input would redisplay as "5.0" and the caret would
 *  land in the wrong place, making "50" impossible to type. Keeping the raw
 *  string means the input shows exactly what was typed, and only a fully valid
 *  number feeds the calculations. */
type Draft = Record<string, Record<string, string>>;

/** Parsed value of a draft cell, in PHP (the grid is entered in thousands).
 *  `undefined` means "no usable override" -- either untouched, cleared, or
 *  mid-typing garbage like "5." -- in which case the stored value is used and the
 *  grid keeps totalling correctly while the user types. */
function draftValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return isFinite(n) ? n * 1000 : undefined;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Thousands, matching the workbook's "(000's)" headings. A PHP plan runs to
 *  hundreds of millions, so full pesos would be pure noise on a 30-column grid. */
function fmtK(v: number | null): string {
  if (v === null || !isFinite(v)) return "–";
  return (v / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function fmtPct2(v: number | null): string {
  if (v === null || !isFinite(v)) return "–";
  return `${v.toFixed(2)}%`;
}

function fmtPctSigned2(v: number | null): string {
  if (v === null || !isFinite(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function varColour(v: number | null): string {
  if (v === null || !isFinite(v) || Math.abs(v) < 0.005) return "text-slate-500";
  return v > 0 ? "text-emerald-700" : "text-red-600";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyGridPage() {
  const params = useParams<{ dept: string; class: string }>();
  const search = useSearchParams();
  const dept = fromPathSegment(params.dept);
  const klass = fromPathSegment(params.class);

  const [currency, setCurrency] = useState<Currency>("PHP");
  const [half, setHalf] = useState<string>(search.get("half") ?? "H2");
  const [scenarioId, setScenarioId] = useState<string | null>(search.get("scenario"));

  const [data, setData] = useState<GridResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Uncommitted edits, keyed metric -> weekKey. Held separately from `data` so
   *  Reset is a single state clear and so a save can send exactly the cells that
   *  changed rather than the whole grid. */
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonCodes, setReasonCodes] = useState<{ code: string; label: string }[]>([]);

  const [annOpen, setAnnOpen] = useState<string | null>(null);
  const [annType, setAnnType] = useState("COMMENT");
  const [annValue, setAnnValue] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ currency, half });
    if (scenarioId) qs.set("scenario", scenarioId);
    fetch(`/api/planning/grid/${toPathSegment(dept)}/${toPathSegment(klass)}?${qs}`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.error) {
          setError(String(body.error));
          setData(null);
        } else {
          setData(body as GridResponse);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  }, [dept, klass, currency, half, scenarioId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/planning/settings")
      .then((r) => r.json())
      .then((b) => setReasonCodes(b?.reasonCodes ?? []))
      .catch(() => setReasonCodes([]));
  }, []);

  // ─── Column plan: weeks with the month subtotal interleaved ─────────────
  const columns: Col[] = useMemo(() => {
    if (!data) return [];
    const out: Col[] = [];
    for (const m of data.months) {
      for (const wk of m.weekKeys) {
        const week = data.weeks.find((w) => w.key === wk);
        if (week) out.push({ kind: "week", key: wk, week });
      }
      out.push({ kind: "month", key: `M:${m.key}`, month: m });
    }
    out.push({
      kind: "total",
      key: "TOTAL",
      weekKeys: data.weeks.map((w) => w.key),
    });
    return out;
  }, [data]);

  // ─── Value resolution ───────────────────────────────────────────────────

  /** Resolved value for a stored metric/version/week, with the pending draft
   *  taking precedence on the FC row. */
  const cell = useCallback(
    (metric: string, version: string, key: string): number | null => {
      if (!data) return null;
      if (version === "FC") {
        const d = draftValue(draft[metric]?.[key]);
        if (d !== undefined) return d;
      }
      // Act/FC is derived from the RESOLVED FC, not from the stored one, so an
      // uncommitted edit flows into it immediately -- otherwise the blend row
      // would contradict the FC row directly above it while typing.
      if (version === "ACT_FC") {
        const wk = data.weeks.find((w) => w.key === key);
        if (!wk) return null;
        return wk.isClosed ? cell(metric, "ACT", key) : cell(metric, "FC", key);
      }
      const v = data.values[metric]?.[version]?.[key];
      return v === undefined ? null : v;
    },
    [data, draft]
  );

  /** Aggregate a stored metric across week keys. Returns null when NO week has a
   *  value, so a fully-forecast month on the Act row shows a dash rather than a
   *  misleading zero. A partially-closed month legitimately totals the weeks it
   *  has, which is what the workbook does too. */
  const agg = useCallback(
    (metric: string, version: string, keys: string[]): number | null => {
      let total = 0;
      let found = false;
      for (const k of keys) {
        const v = cell(metric, version, k);
        if (v !== null) {
          total += v;
          found = true;
        }
      }
      return found ? total : null;
    },
    [cell]
  );

  const keysFor = useCallback(
    (col: Col): string[] => {
      if (col.kind === "week") return [col.key];
      if (col.kind === "month") return col.month.weekKeys;
      return col.weekKeys;
    },
    []
  );

  /** The displayed number for any (block, version, column) intersection.
   *  Margin % is rebuilt from the aggregated pair at whatever level the column
   *  represents, which is what keeps a month subtotal correct. */
  const display = useCallback(
    (blockId: string, version: string, col: Col): number | null => {
      const keys = keysFor(col);
      if (blockId === "MARGIN_PCT") {
        const gp = agg("POS_GP_AMT", version, keys);
        const sls = agg("SLS_PHP", version, keys);
        if (gp === null || sls === null || sls === 0) return null;
        return (gp / sls) * 100;
      }
      return agg(blockId, version, keys);
    },
    [agg, keysFor]
  );

  /** Variance of FC against a comparison version.
   *  Percent for the amount blocks, PERCENTAGE POINTS for the Margin % block --
   *  a rate move is a pp move, and reporting it as a percent change would be a
   *  different claim. */
  const variance = useCallback(
    (blockId: string, against: string, col: Col): number | null => {
      const fc = display(blockId, "FC", col);
      const base = display(blockId, against, col);
      if (fc === null || base === null) return null;
      if (blockId === "MARGIN_PCT") return fc - base;
      if (base === 0) return null;
      return ((fc - base) / Math.abs(base)) * 100;
    },
    [display]
  );

  /** Compound annual growth from LLY through to FC. Two years of growth, so the
   *  square root rather than a simple ratio. Only meaningful where LLY is
   *  positive, and undefined on the Margin % block because compounding a rate is
   *  not a thing anyone means. */
  const cagr = useCallback(
    (blockId: string, col: Col): number | null => {
      if (blockId === "MARGIN_PCT") return null;
      const lly = display(blockId, "LLY", col);
      const fc = display(blockId, "FC", col);
      if (lly === null || fc === null || lly <= 0 || fc <= 0) return null;
      return (Math.sqrt(fc / lly) - 1) * 100;
    },
    [display]
  );

  // ─── Editing ────────────────────────────────────────────────────────────

  const setDraftCell = (metric: string, key: string, raw: string) => {
    // The raw text is stored verbatim so the input never fights the typist.
    // An empty string is kept as a draft entry (so the cell renders empty while
    // being cleared) but contributes nothing to the totals and is skipped on
    // save, which reverts the cell to the forecast rather than planning zero.
    setDraft((d) => ({ ...d, [metric]: { ...(d[metric] ?? {}), [key]: raw } }));
  };

  /** Paste a row of values straight out of Excel. Tab- or newline-separated,
   *  filling forward from the pasted cell across the remaining week columns. */
  const onPasteRow = (
    metric: string,
    startKey: string,
    e: React.ClipboardEvent<HTMLInputElement>
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text || !/[\t\n]/.test(text)) return; // single value: let the browser do it
    e.preventDefault();
    const parts = text.split(/[\t\n\r]+/).filter((p) => p.trim() !== "");
    const weekKeys = data ? data.weeks.map((w) => w.key) : [];
    const start = weekKeys.indexOf(startKey);
    if (start < 0) return;
    setDraft((d) => {
      const next = { ...d, [metric]: { ...(d[metric] ?? {}) } };
      parts.forEach((p, i) => {
        const k = weekKeys[start + i];
        if (!k) return;
        if (isFinite(Number(p.replace(/,/g, "")))) next[metric][k] = p.trim();
      });
      return next;
    });
  };

  /** Cells that carry a usable, genuinely different value. Counting raw draft
   *  keys instead would report a pending edit for a cell the user typed into and
   *  then restored, and the Calculate button would never go quiet. */
  const dirtyCells = useMemo(() => {
    if (!data) return [];
    const out: { metric: string; key: string; value: number }[] = [];
    for (const [metric, byKey] of Object.entries(draft)) {
      for (const [key, raw] of Object.entries(byKey)) {
        const v = draftValue(raw);
        if (v === undefined) continue;
        const stored = data.values[metric]?.FC?.[key];
        if (stored !== undefined && Math.abs(stored - v) < 0.005) continue;
        out.push({ metric, key, value: v });
      }
    }
    return out;
  }, [draft, data]);

  const dirtyCount = dirtyCells.length;

  const save = async () => {
    if (!data || dirtyCount === 0) return;
    setSaving(true);
    setSaveMsg(null);
    const cells: { periodCode: string; weekNo: number; metric: string; value: number }[] = [];
    for (const { metric, key, value } of dirtyCells) {
      const wk = data.weeks.find((w) => w.key === key);
      if (!wk) continue;
      cells.push({ periodCode: wk.periodCode, weekNo: wk.weekNo, metric, value });
    }
    try {
      const res = await fetch("/api/planning/grid/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: dept,
          class: klass,
          half,
          currency,
          scenarioId,
          cells,
          editedBy: data.planner ?? "Planner",
          reasonCode: reasonCode || null,
        }),
      });
      const body = await res.json();
      if (body?.error) {
        setSaveMsg(String(body.error));
      } else {
        // Adopt the scenario the save landed in, so subsequent edits accumulate
        // in one sandbox rather than spawning a new one per save.
        if (body.scenarioId) setScenarioId(String(body.scenarioId));
        setDraft({});
        setSaveMsg(`${body.saved} cell${body.saved === 1 ? "" : "s"} saved to sandbox`);
        load();
      }
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addAnnotation = async (col: Col) => {
    if (!annValue.trim() || col.kind !== "week") return;
    await fetch("/api/planning/annotation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        department: dept,
        class: klass,
        periodCode: col.week.periodCode,
        weekNo: col.week.weekNo,
        type: annType,
        value: annValue.trim(),
        author: data?.planner ?? "Planner",
        scenarioId,
      }),
    });
    setAnnValue("");
    setAnnOpen(null);
    load();
  };

  // ─── Annotation lookup ──────────────────────────────────────────────────
  const annByWeek = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of data?.annotations ?? []) {
      if (!a.weekKey) continue;
      if (!m.has(a.weekKey)) m.set(a.weekKey, []);
      m.get(a.weekKey)!.push(a);
    }
    return m;
  }, [data]);

  if (loading && !data) return <Loading what={`${klass} weekly plan`} />;
  if (error) {
    return (
      <ErrorState
        message={error}
        backHref={`/planning/mfp/${toPathSegment(dept)}`}
        backLabel={dept}
      />
    );
  }
  if (!data) return null;

  const cutoff = data.actualsCutoff;

  return (
    <div className="p-6">
      <Breadcrumb
        trail={[
          { label: "Global Planning", href: "/planning" },
          { label: dept, href: `/planning/mfp/${toPathSegment(dept)}` },
          { label: klass, href: `/planning/mfp/${toPathSegment(dept)}/${toPathSegment(klass)}` },
          { label: "Weekly Grid" },
        ]}
      />
      <PageHeader
        title={`${data.classCode ?? ""} ${klass} — Weekly Plan`}
        subtitle={`${data.fiscalYear} ${half} · week columns with month subtotals · only the FC row is editable`}
        right={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden bg-white">
              {["H2", "H1"].map((h) => (
                <button
                  key={h}
                  onClick={() => {
                    setDraft({});
                    setHalf(h);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    half === h ? "bg-violet-50 text-violet-800" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {h === "H2" ? "H2 Jul–Dec 26" : "H1 Jan–Jun 27"}
                </button>
              ))}
            </div>
            <CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />
          </div>
        }
      />

      {/* Sheet-tab strip, standing in for the workbook's per-class tabs. */}
      <div className="flex items-center gap-0.5 mb-3 overflow-x-auto pb-1">
        {data.classTabs.map((t) => {
          const active = t.class.toUpperCase() === klass.toUpperCase();
          return (
            <Link
              key={t.classCode}
              href={`/planning/grid/${toPathSegment(dept)}/${toPathSegment(t.class)}?half=${half}`}
              className={`px-3 py-1.5 text-[11px] font-medium whitespace-nowrap rounded-t-md border-t border-l border-r ${
                active
                  ? "bg-white border-slate-300 text-violet-800 -mb-px"
                  : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              .{t.classCode} {t.class}
            </Link>
          );
        })}
      </div>

      {/* Provenance and controls, mirroring the workbook's corner block. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 mb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-5 text-[11px] text-slate-600">
            <span className="font-semibold text-slate-900">
              {data.classCode} — {klass}
            </span>
            <StrategyPill strategy={data.classTabs.find((t) => t.class === klass)?.strategy ?? null} />
            <span className="flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
              Planner <span className="font-medium text-slate-800">{data.planner ?? "–"}</span>
            </span>
            {data.lastEditedAt && (
              <span>
                Last edit{" "}
                <span className="font-mono">
                  {new Date(data.lastEditedAt).toLocaleString(undefined, {
                    day: "2-digit", month: "short", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
                {data.lastEditedBy ? ` · ${data.lastEditedBy}` : ""}
              </span>
            )}
            {cutoff && (
              <span className="flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                Actuals to <span className="font-mono">{cutoff}</span>{" "}
                <SettingTip settingKeys={["ACTUALS_CUTOFF_DATE"]} />
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 cursor-pointer"
              title="Reason attached to the edits you save. Optional -- forcing one per cell would make the grid unusable."
            >
              <option value="">Reason (optional)</option>
              {reasonCodes.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
            <button
              onClick={() => setDraft({})}
              disabled={dirtyCount === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <button
              onClick={save}
              disabled={dirtyCount === 0 || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Calculate &amp; save
            </button>
          </div>
        </div>

        {/* Status bar, echoing the workbook's "Ready / Calculate" indicator. */}
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100 text-[10px]">
          <span className={dirtyCount > 0 ? "font-semibold text-amber-700" : "text-slate-500"}>
            {dirtyCount > 0 ? `Calculate — ${dirtyCount} cell${dirtyCount === 1 ? "" : "s"} pending` : "Ready"}
          </span>
          {scenarioId && (
            <span className="text-slate-500">
              Sandbox scenario{" "}
              <Link href="/planning/scenarios" className="font-mono text-violet-700 hover:underline">
                {scenarioId.slice(0, 18)}…
              </Link>{" "}
              — the approved forecast is untouched
            </span>
          )}
          {saveMsg && <span className="text-emerald-700 font-medium">{saveMsg}</span>}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead>
              {/* Month name band */}
              <tr>
                <th className="sticky left-0 z-20 bg-white border-b border-r border-slate-200 px-2 py-1 text-left w-[150px] min-w-[150px]" />
                {columns.map((c) =>
                  c.kind === "week" ? (
                    <th
                      key={c.key}
                      className="border-b border-slate-200 px-1.5 py-1 text-center text-[9px] font-medium text-slate-400 whitespace-nowrap"
                    >
                      {c.week.weekNo === 1 ? c.week.monthName : ""}
                    </th>
                  ) : c.kind === "month" ? (
                    <th
                      key={c.key}
                      className="border-b border-x border-slate-300 bg-slate-100 px-2 py-1 text-center text-[9px] font-bold text-slate-600 whitespace-nowrap"
                    >
                      MONTH
                    </th>
                  ) : (
                    <th
                      key={c.key}
                      className="border-b border-x border-slate-400 bg-slate-200 px-2 py-1 text-center text-[9px] font-bold text-slate-700 whitespace-nowrap"
                    >
                      {half}
                    </th>
                  )
                )}
              </tr>

              {/* Week ending dates / month labels */}
              <tr>
                <th className="sticky left-0 z-20 bg-white border-b border-r border-slate-200 px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500">
                  Week ending
                </th>
                {columns.map((c) =>
                  c.kind === "week" ? (
                    <th
                      key={c.key}
                      className={`border-b border-slate-200 px-1.5 py-1.5 text-right font-semibold whitespace-nowrap ${
                        c.week.isClosed ? "text-slate-800" : "text-slate-500"
                      }`}
                    >
                      {c.week.weekEnding
                        ? new Date(c.week.weekEnding).toLocaleDateString("en-AU", {
                            day: "2-digit", month: "short", year: "2-digit",
                          })
                        : c.week.key}
                    </th>
                  ) : c.kind === "month" ? (
                    <th
                      key={c.key}
                      className="border-b border-x border-slate-300 bg-slate-100 px-2 py-1.5 text-right font-bold text-slate-900 whitespace-nowrap"
                    >
                      {c.month.monthName}
                    </th>
                  ) : (
                    <th
                      key={c.key}
                      className="border-b border-x border-slate-400 bg-slate-200 px-2 py-1.5 text-right font-bold text-slate-900 whitespace-nowrap"
                    >
                      Total
                    </th>
                  )
                )}
              </tr>

              {/* Region tags */}
              <tr>
                <th className="sticky left-0 z-20 bg-white border-r border-slate-200 px-2 py-0.5 text-left text-[9px] font-medium text-slate-400">
                  <Tag className="w-3 h-3" /> Region
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-0.5 text-center">
                    {c.kind === "week" &&
                      (annByWeek.get(c.key) ?? [])
                        .filter((a) => a.type === "REGION_TAG")
                        .map((a) => (
                          <span
                            key={a.id}
                            className="inline-block px-1 rounded bg-slate-200 text-slate-700 text-[9px] font-semibold"
                            title={`${a.value} · ${a.author ?? ""}`}
                          >
                            {a.value}
                          </span>
                        ))}
                  </td>
                ))}
              </tr>

              {/* Event markers */}
              <tr>
                <th className="sticky left-0 z-20 bg-white border-r border-slate-200 px-2 py-0.5 text-left text-[9px] font-medium text-slate-400">
                  Event
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-0.5 text-center">
                    {c.kind === "week" &&
                      (annByWeek.get(c.key) ?? [])
                        .filter((a) => a.type === "EVENT_MARKER")
                        .map((a) => (
                          <span
                            key={a.id}
                            className="inline-block px-1 rounded bg-yellow-200 text-yellow-900 text-[9px] font-bold"
                            title={`${a.value} · ${a.author ?? ""}`}
                          >
                            {a.value}
                          </span>
                        ))}
                  </td>
                ))}
              </tr>

              {/* Comment row, with the add-annotation popover */}
              <tr>
                <th className="sticky left-0 z-20 bg-white border-b border-r border-slate-200 px-2 py-0.5 text-left text-[9px] font-medium text-slate-400">
                  Comment
                </th>
                {columns.map((c) => {
                  const comments =
                    c.kind === "week"
                      ? (annByWeek.get(c.key) ?? []).filter((a) => a.type === "COMMENT")
                      : [];
                  return (
                    <td key={c.key} className="border-b border-slate-200 px-1 py-0.5 text-center relative">
                      {c.kind === "week" && (
                        <button
                          onClick={() => setAnnOpen(annOpen === c.key ? null : c.key)}
                          className="cursor-pointer align-middle"
                          title={
                            comments.length > 0
                              ? comments.map((a) => `${a.author}: ${a.value}`).join("\n")
                              : "Add a comment, region tag or event marker"
                          }
                        >
                          {comments.length > 0 ? (
                            <span className="inline-block w-0 h-0 border-t-[7px] border-t-red-500 border-l-[7px] border-l-transparent" />
                          ) : (
                            <MessageSquarePlus className="w-3 h-3 text-slate-300 hover:text-violet-600" />
                          )}
                        </button>
                      )}
                      {annOpen === c.key && c.kind === "week" && (
                        <div className="absolute z-40 top-5 left-1/2 -translate-x-1/2 w-64 bg-white border border-slate-300 rounded-lg shadow-lg p-2 text-left">
                          <div className="text-[10px] font-semibold text-slate-700 mb-1">
                            {c.week.weekEnding} annotation
                          </div>
                          {comments.map((a) => (
                            <div key={a.id} className="text-[10px] text-slate-600 mb-1 pb-1 border-b border-slate-100">
                              <span className="font-medium">{a.author}</span>: {a.value}
                            </div>
                          ))}
                          <select
                            value={annType}
                            onChange={(e) => setAnnType(e.target.value)}
                            className="w-full text-[10px] border border-slate-200 rounded px-1 py-1 mb-1 cursor-pointer"
                          >
                            <option value="COMMENT">Comment</option>
                            <option value="REGION_TAG">Region tag</option>
                            <option value="EVENT_MARKER">Event marker</option>
                          </select>
                          {annType === "COMMENT" ? (
                            <textarea
                              value={annValue}
                              onChange={(e) => setAnnValue(e.target.value)}
                              rows={2}
                              placeholder="Why is this week's number what it is?"
                              className="w-full text-[10px] border border-slate-200 rounded px-1 py-1 mb-1"
                            />
                          ) : (
                            <select
                              value={annValue}
                              onChange={(e) => setAnnValue(e.target.value)}
                              className="w-full text-[10px] border border-slate-200 rounded px-1 py-1 mb-1 cursor-pointer"
                            >
                              <option value="">Choose…</option>
                              {(annType === "REGION_TAG" ? REGION_TAGS : EVENT_MARKERS).map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          )}
                          <div className="flex gap-1">
                            <button
                              onClick={() => addAnnotation(c)}
                              disabled={!annValue.trim()}
                              className="flex-1 text-[10px] px-2 py-1 rounded bg-violet-600 text-white disabled:opacity-40 cursor-pointer"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => { setAnnOpen(null); setAnnValue(""); }}
                              className="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-600 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                          {annType === "REGION_TAG" && (
                            <p className="text-[9px] text-slate-400 mt-1 leading-snug">
                              A note that this week is driven by something regional. There is no
                              regional forecast behind it.
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {BLOCKS.map((block) => (
                <BlockRows
                  key={block.id}
                  block={block}
                  columns={columns}
                  data={data}
                  draft={draft}
                  display={display}
                  variance={variance}
                  cagr={cagr}
                  setDraftCell={setDraftCell}
                  onPasteRow={onPasteRow}
                />
              ))}
            </tbody>
          </table>
        </div>
        <ColumnLegend columns={GRID_COLUMNS} title="Row and column guide" />
      </Card>

      <p className="text-[10px] text-slate-400 mt-3 leading-relaxed max-w-4xl">
        Month subtotals, the half total, every margin percentage and all four derived rows are
        recomputed in the browser as you type, so nothing on screen can lag behind an edit.
        Margin % at a month or total column is <span className="font-mono">SUM(margin) / SUM(sales)</span>{" "}
        across that column&apos;s weeks, never the average of the weekly percentages — those differ
        whenever the weeks differ in size. Edits are stored as a sandbox overlay; the approved
        forecast (App. FC) is never written to, which is why <span className="font-semibold">Var App. FC</span>{" "}
        reads 0.00% until you change something.
      </p>
    </div>
  );
}

// ─── One metric block: version rows plus derived rows ─────────────────────────

function BlockRows({
  block,
  columns,
  data,
  draft,
  display,
  variance,
  cagr,
  setDraftCell,
  onPasteRow,
}: {
  block: { id: string; label: string; kind: "amount" | "percent" };
  columns: Col[];
  data: GridResponse;
  draft: Draft;
  display: (blockId: string, version: string, col: Col) => number | null;
  variance: (blockId: string, against: string, col: Col) => number | null;
  cagr: (blockId: string, col: Col) => number | null;
  setDraftCell: (metric: string, key: string, raw: string) => void;
  onPasteRow: (metric: string, key: string, e: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const isPct = block.kind === "percent";
  const fmt = (v: number | null) => (isPct ? fmtPct2(v) : fmtK(v));

  return (
    <>
      <tr>
        <td
          colSpan={columns.length + 1}
          className="sticky left-0 bg-slate-800 text-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide"
        >
          {block.label}
          {isPct && (
            <span className="ml-2 font-normal normal-case text-slate-300">
              derived from margin ÷ sales at every column — not editable
            </span>
          )}
        </td>
      </tr>

      {VERSION_ROWS.map((vr) => {
        // The Margin % block has no editable row: typing a percentage is
        // ambiguous between holding sales and moving margin, or the reverse.
        const editable = vr.editable && !isPct;
        return (
          <tr key={`${block.id}-${vr.id}`} className={`${vr.cls} border-b border-slate-100`}>
            <td
              className={`sticky left-0 z-10 border-r border-slate-200 px-2 py-1 font-semibold text-slate-700 ${
                vr.cls || "bg-white"
              }`}
            >
              {vr.label}
              {editable && <span className="ml-1 text-[9px] font-normal text-pink-700">editable</span>}
            </td>
            {columns.map((col) => {
              const v = display(block.id, vr.id, col);
              const weekKey = col.kind === "week" ? col.key : null;
              const pending =
                weekKey !== null && draftValue(draft[block.id]?.[weekKey]) !== undefined;
              const isEdited =
                weekKey !== null &&
                (pending || data.edited[block.id]?.[weekKey] !== undefined);
              const meta = weekKey ? data.edited[block.id]?.[weekKey] : undefined;

              const colCls =
                col.kind === "month"
                  ? "border-x border-slate-300 bg-slate-100/80 font-bold"
                  : col.kind === "total"
                  ? "border-x border-slate-400 bg-slate-200/80 font-bold"
                  : "";

              if (editable && col.kind === "week") {
                return (
                  <td
                    key={col.key}
                    className={`px-0.5 py-0.5 ${
                      pending
                        ? "bg-blue-300"
                        : isEdited
                        ? "bg-blue-200"
                        : ""
                    }`}
                    title={
                      meta
                        ? `Edited by ${meta.editedBy ?? "?"}${
                            meta.reasonNote ? ` — ${meta.reasonNote}` : ""
                          }`
                        : undefined
                    }
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      // The raw draft string wins while the user is typing; the
                      // formatted stored value shows otherwise.
                      value={
                        draft[block.id]?.[col.key] ??
                        (v === null ? "" : (v / 1000).toFixed(1))
                      }
                      onChange={(e) => setDraftCell(block.id, col.key, e.target.value)}
                      onPaste={(e) => onPasteRow(block.id, col.key, e)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full min-w-[62px] bg-transparent text-right font-mono px-1 py-0.5 border border-transparent hover:border-slate-300 focus:border-violet-500 focus:bg-white focus:outline-none rounded"
                    />
                  </td>
                );
              }

              return (
                <td
                  key={col.key}
                  className={`px-1.5 py-1 text-right font-mono whitespace-nowrap ${colCls} ${
                    isEdited && vr.id === "FC" ? "bg-blue-200" : ""
                  } ${v === null ? "text-slate-300" : "text-slate-800"}`}
                >
                  {fmt(v)}
                </td>
              );
            })}
          </tr>
        );
      })}

      {/* Derived variance rows. Percent on the amount blocks, percentage points
          on the Margin % block. */}
      {DERIVED_ROWS.map((dr) => (
        <tr key={`${block.id}-${dr.id}`} className={`${dr.cls} border-b border-slate-100`}>
          <td
            className={`sticky left-0 z-10 border-r border-slate-200 px-2 py-1 font-medium text-slate-600 ${
              dr.cls || "bg-white"
            }`}
          >
            {dr.label}
            {isPct && <span className="ml-1 text-[9px] text-slate-400">pp</span>}
          </td>
          {columns.map((col) => {
            const v = variance(block.id, dr.against, col);
            const colCls =
              col.kind === "month"
                ? "border-x border-slate-300 bg-slate-100/60 font-semibold"
                : col.kind === "total"
                ? "border-x border-slate-400 bg-slate-200/60 font-semibold"
                : "";
            return (
              <td
                key={col.key}
                className={`px-1.5 py-1 text-right font-mono whitespace-nowrap ${colCls} ${varColour(v)}`}
              >
                {v === null
                  ? "–"
                  : isPct
                  ? `${v > 0 ? "+" : ""}${v.toFixed(2)}pp`
                  : fmtPctSigned2(v)}
              </td>
            );
          })}
        </tr>
      ))}

      {/* CAGR: two years of compound growth, LLY through FC. Omitted on the
          Margin % block, because compounding a rate is not a meaningful number. */}
      <tr className="border-b-2 border-slate-300">
        <td className="sticky left-0 z-10 bg-white border-r border-slate-200 px-2 py-1 font-medium text-slate-600">
          CAGR
          {isPct && <span className="ml-1 text-[9px] text-slate-400">n/a</span>}
        </td>
        {columns.map((col) => {
          const v = cagr(block.id, col);
          const colCls =
            col.kind === "month"
              ? "border-x border-slate-300 bg-slate-100/60 font-semibold"
              : col.kind === "total"
              ? "border-x border-slate-400 bg-slate-200/60 font-semibold"
              : "";
          return (
            <td
              key={col.key}
              className={`px-1.5 py-1 text-right font-mono whitespace-nowrap ${colCls} ${varColour(v)}`}
            >
              {fmtPctSigned2(v)}
            </td>
          );
        })}
      </tr>
    </>
  );
}
