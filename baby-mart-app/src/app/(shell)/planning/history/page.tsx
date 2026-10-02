"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  History as HistoryIcon, Loader2, FileClock, PencilLine, Sparkles, CheckCircle2,
} from "lucide-react";
import {
  Breadcrumb, PageHeader, Card, CurrencyToggle, KpiCard,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtNum, varianceClass, type Currency,
} from "../_components/ui";
import { SettingTip } from "../_components/settingTip";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Plan history and audit ───────────────────────────────────────────────────
//
// Answers two questions a planning meeting always asks:
//
//   1. How has our view moved between meetings? -- the chart, one line per
//      approved forecast version plus the current plan and the budget.
//   2. What exactly changed, and why? -- the audit table underneath.
//
// The CURRENT PLAN AND BUDGET ARE ALWAYS DRAWN, whatever else is selected. A
// version-over-version chart without the plan in force gives no answer to "is
// this better than what we have", which is the only reason anyone opens it.
//
// Monthly points rather than weekly: 48 points per line makes a multi-line chart
// unreadable, and "how has our view moved" is a monthly question. The weekly
// detail is one click away in the grid.

type Version = {
  versionId: string;
  versionNo: number;
  label: string;
  status: string;
  sourceScenarioId: string | null;
  scenarioName: string | null;
  scenarioType: string | null;
  prompt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  settings: Record<string, unknown> | null;
  series: Record<string, Record<string, number>>;
  adjustments: {
    class: string | null;
    reasonCode: string | null;
    reasonLabel: string | null;
    reasonNote: string | null;
    editedBy: string | null;
    delta: number;
  }[];
};

type HistoryResponse = {
  currency: Currency;
  department: string | null;
  periods: { periodCode: string; periodNo: number; monthName: string; half: string }[];
  /** live[metric][version][periodCode] */
  live: Record<string, Record<string, Record<string, number>>>;
  versions: Version[];
};

type AuditEvent = {
  eventType: string;
  eventAt: string | null;
  actor: string | null;
  scenarioId: string | null;
  versionId: string | null;
  scenarioName: string | null;
  department: string | null;
  class: string | null;
  periodCode: string | null;
  weekNo: number | null;
  metric: string | null;
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
  changeSource: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  reasonNote: string | null;
  detail: string | null;
};

type AuditResponse = {
  currency: Currency;
  currentPlan: {
    source: string;
    versionId: string | null;
    versionNo: number;
    label: string | null;
    approvedAt: string | null;
  } | null;
  events: AuditEvent[];
};

type VersionGridResponse = {
  currency: Currency;
  metric: string;
  half: string;
  version: {
    versionId: string;
    versionNo: number;
    label: string;
    status: string;
    approvedBy: string | null;
    approvedAt: string | null;
    notes: string | null;
  } | null;
  comparedWith: { versionNo: number; label: string };
  versions: { versionId: string; versionNo: number; label: string; status: string }[];
  weeks: {
    key: string; periodCode: string; periodNo: number; monthName: string;
    weekNo: number; weekSeq: number; weekEnding: string | null;
  }[];
  months: { periodCode: string; monthName: string; periodNo: number; weekKeys: string[] }[];
  rows: {
    department: string;
    class: string;
    cur: Record<string, number>;
    prv: Record<string, number>;
    mov: Record<string, number>;
    movementTotal: number;
    changedWeeks: number;
  }[];
};

/** A column in the diff grid: a week, a bold month subtotal, or the half total.
 *  Mirrors the weekly editing grid so the two read the same way. */
type DiffCol =
  | { kind: "week"; key: string; label: string; sub: string }
  | { kind: "month"; key: string; label: string; weekKeys: string[] }
  | { kind: "total"; key: string; label: string; weekKeys: string[] };

/** Thousands, matching the weekly grid's "(000's)" convention. */
function fmtK1(v: number): string {
  if (!isFinite(v)) return "–";
  return (v / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function fmtKSigned(v: number): string {
  if (!isFinite(v) || Math.abs(v) < 1) return "–";
  return `${v > 0 ? "+" : "−"}${Math.abs(v / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
}

const METRICS = [
  { id: "SLS_PHP", label: "Sales" },
  { id: "POS_GP_AMT", label: "Gross profit" },
  { id: "SLS_UNITS", label: "Units" },
];

const SOURCE_STYLE: Record<string, string> = {
  MANUAL_GRID: "text-violet-800 bg-violet-100",
  GENERATED_SCENARIO: "text-sky-800 bg-sky-100",
  APPROVAL: "text-emerald-800 bg-emerald-100",
};

const SOURCE_ICON: Record<string, typeof PencilLine> = {
  MANUAL_GRID: PencilLine,
  GENERATED_SCENARIO: Sparkles,
  APPROVAL: CheckCircle2,
};

/** Distinct colours for the version lines. The current plan and budget are drawn
 *  in fixed, deliberately un-flashy colours so they read as reference lines
 *  rather than as competing options. */
const VERSION_COLOURS = ["#6d28d9", "#0891b2", "#c026d3", "#65a30d", "#ea580c"];

export default function PlanHistoryPage() {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [metric, setMetric] = useState("SLS_PHP");
  const [department, setDepartment] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [classFilter, setClassFilter] = useState<string>("");

  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [depts, setDepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Version diff grid ─────────────────────────────────────────────────────
  // Its own metric and half, independent of the chart above: the chart answers a
  // monthly "has our view moved" question and the grid a weekly "which cells
  // moved" one, and forcing them to share controls makes both worse.
  const [view, setView] = useState<"chart" | "grid">("chart");
  const [gridVersionId, setGridVersionId] = useState<string>("");
  const [gridMetric, setGridMetric] = useState<string>("SLS_PHP");
  const [gridHalf, setGridHalf] = useState<string>("H2");
  const [changedOnly, setChangedOnly] = useState(false);
  const [vg, setVg] = useState<VersionGridResponse | null>(null);
  const [vgLoading, setVgLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const hq = new URLSearchParams({ currency });
    if (department) hq.set("department", department);
    const aq = new URLSearchParams({ currency });
    if (sourceFilter) aq.set("source", sourceFilter);
    if (classFilter) aq.set("class", classFilter);

    Promise.all([
      fetch(`/api/planning/history?${hq}`).then((r) => r.json()),
      fetch(`/api/planning/audit?${aq}`).then((r) => r.json()),
    ])
      .then(([h, a]) => {
        if (h?.error) setError(String(h.error));
        else {
          setHist(h as HistoryResponse);
          setError(null);
        }
        if (!a?.error) setAudit(a as AuditResponse);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  }, [currency, department, sourceFilter, classFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // The grid is only fetched once it is actually shown -- it is a much wider read
  // than the chart, and most visits never open it.
  useEffect(() => {
    if (view !== "grid") return;
    setVgLoading(true);
    const q = new URLSearchParams({ currency, metric: gridMetric, half: gridHalf });
    if (gridVersionId) q.set("versionId", gridVersionId);
    fetch(`/api/planning/history/grid?${q}`)
      .then((r) => r.json())
      .then((b) => {
        if (!b?.error) {
          setVg(b as VersionGridResponse);
          if (!gridVersionId && b?.version?.versionId) setGridVersionId(b.version.versionId);
        }
      })
      .catch(() => setVg(null))
      .finally(() => setVgLoading(false));
  }, [view, currency, gridMetric, gridHalf, gridVersionId]);

  /** Week columns with a bold subtotal after each month, then the half total. */
  const diffCols = useMemo<DiffCol[]>(() => {
    if (!vg) return [];
    const out: DiffCol[] = [];
    for (const mth of vg.months) {
      for (const wk of vg.weeks.filter((w) => w.periodCode === mth.periodCode)) {
        out.push({
          kind: "week",
          key: wk.key,
          label: `W${wk.weekNo}`,
          sub: wk.weekEnding ? wk.weekEnding.slice(5, 10) : "",
        });
      }
      out.push({
        kind: "month",
        key: `M-${mth.periodCode}`,
        label: mth.monthName,
        weekKeys: mth.weekKeys,
      });
    }
    out.push({
      kind: "total",
      key: "HALF",
      label: `${vg.half} Total`,
      weekKeys: vg.weeks.map((w) => w.key),
    });
    return out;
  }, [vg]);

  /** Departments in order, each with its classes, so the grid reads as the
   *  hierarchy rather than as a flat list of 33 classes. */
  const diffGroups = useMemo(() => {
    if (!vg) return [];
    const rows = changedOnly ? vg.rows.filter((r) => r.changedWeeks > 0) : vg.rows;
    const byDept = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byDept.has(r.department)) byDept.set(r.department, []);
      byDept.get(r.department)!.push(r);
    }
    return [...byDept.entries()].map(([department, classes]) => ({
      department,
      classes,
      movementTotal: classes.reduce((s, c) => s + c.movementTotal, 0),
      changed: classes.some((c) => c.changedWeeks > 0),
    }));
  }, [vg, changedOnly]);

  const sumOver = (m: Record<string, number>, keys: string[]) =>
    keys.reduce((s, k) => s + (m[k] ?? 0), 0);

  useEffect(() => {
    fetch("/api/planning/hierarchy")
      .then((r) => r.json())
      .then((b) => {
        const set = new Set<string>();
        for (const row of b?.rows ?? b?.hierarchy ?? []) {
          if (row?.department) set.add(String(row.department));
        }
        setDepts([...set].sort());
      })
      .catch(() => setDepts([]));
  }, []);

  const traces = useMemo(() => {
    if (!hist) return [];
    const x = hist.periods.map((p) => `${p.monthName} ${p.half}`);
    const keys = hist.periods.map((p) => p.periodCode);
    const out: Record<string, unknown>[] = [];

    // Budget first so it sits behind everything else.
    const bud = hist.live[metric]?.BUD;
    if (bud) {
      out.push({
        x, y: keys.map((k) => bud[k] ?? null), type: "scatter", mode: "lines",
        name: "Budget", line: { color: "#94a3b8", width: 2, dash: "dash" },
      });
    }

    // Each approved version.
    hist.versions.forEach((v, i) => {
      const s = v.series[metric];
      if (!s) return;
      out.push({
        x, y: keys.map((k) => s[k] ?? null), type: "scatter", mode: "lines+markers",
        name: `v${v.versionNo} ${v.label}`.slice(0, 40),
        line: { color: VERSION_COLOURS[i % VERSION_COLOURS.length], width: 2 },
        marker: { size: 5 },
      });
    });

    // The plan in force, drawn last so it is on top and unmissable. Labelled
    // "Current plan" rather than "FC" because after an approval the working
    // forecast and the approved plan are different things.
    const fc = hist.live[metric]?.FC;
    if (fc) {
      out.push({
        x, y: keys.map((k) => fc[k] ?? null), type: "scatter", mode: "lines",
        name: hist.versions.length > 0 ? "Working forecast" : "Current plan",
        line: { color: "#0f172a", width: 3 },
      });
    }
    const act = hist.live[metric]?.ACT;
    if (act && Object.keys(act).length > 0) {
      out.push({
        x, y: keys.map((k) => act[k] ?? null), type: "scatter", mode: "lines",
        name: "Actuals", line: { color: "#059669", width: 3 },
        connectgaps: false,
      });
    }
    return out;
  }, [hist, metric]);

  const events = audit?.events ?? [];
  const cellChanges = events.filter((e) => e.eventType === "CELL_CHANGE");
  const approvals = events.filter((e) => e.eventType === "APPROVAL");

  if (loading && !hist) return <Loading what="plan history" />;
  if (error) {
    return <ErrorState message={error} backHref="/planning" backLabel="Planning dashboard" />;
  }

  return (
    <div className="p-6">
      <Breadcrumb
        trail={[{ label: "Global Planning", href: "/planning" }, { label: "Plan History & Audit" }]}
      />
      <PageHeader
        title="Plan History & Audit"
        subtitle="How the forecast has moved between planning meetings, and every change that moved it"
        right={
          <CurrencyToggle currency={currency} onChange={setCurrency}
            fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Plan in force"
          value={
            audit?.currentPlan?.source === "APPROVED_VERSION"
              ? `v${audit.currentPlan.versionNo}`
              : "Working FC"
          }
          sub={
            audit?.currentPlan?.source === "APPROVED_VERSION"
              ? audit.currentPlan.label ?? undefined
              : "Nothing approved yet"
          } />
        <KpiCard label="Approved versions" value={String(hist?.versions.length ?? 0)}
          sub="Each one is an audit record" />
        <KpiCard label="Cell changes logged" value={fmtNum(cellChanges.length)}
          sub={cellChanges.length >= 500 ? "showing the most recent 500" : "all recorded changes"} />
        <KpiCard label="Hand edits" value={fmtNum(cellChanges.filter((e) => e.changeSource === "MANUAL_GRID").length)}
          sub="the rest are generated scenarios" />
      </div>

      <Card
        title={view === "chart" ? "Forecast movement between versions" : "What this version changed"}
        subtitle={
          view === "chart"
            ? "Budget and the plan in force are always drawn, so a version can be read against what it replaced"
            : "Every week of the plan, against the version before it. Only highlighted cells moved."
        }
        className="mb-5"
        right={
          <div className="flex items-center gap-2">
            {/* Chart for "has our view moved", grid for "which cells moved". */}
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
              {(["chart", "grid"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1.5 text-[11px] font-medium cursor-pointer ${
                    view === v ? "bg-violet-50 text-violet-800" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {v === "chart" ? "Chart" : "Grid"}
                </button>
              ))}
            </div>
            {view === "grid" ? (
              <>
                <select
                  value={gridVersionId}
                  onChange={(e) => setGridVersionId(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 cursor-pointer max-w-[220px]"
                >
                  {(vg?.versions ?? []).map((v) => (
                    <option key={v.versionId} value={v.versionId}>
                      v{v.versionNo} · {v.label}
                    </option>
                  ))}
                </select>
                <select
                  value={gridMetric}
                  onChange={(e) => setGridMetric(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 cursor-pointer"
                >
                  {METRICS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                  {["H2", "H1"].map((h) => (
                    <button
                      key={h}
                      onClick={() => setGridHalf(h)}
                      className={`px-2 py-1.5 text-[11px] cursor-pointer ${
                        gridHalf === h ? "bg-violet-50 text-violet-800" : "text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={(e) => setChangedOnly(e.target.checked)}
                    className="cursor-pointer"
                  />
                  Changed only
                </label>
              </>
            ) : (
              <>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 cursor-pointer"
                >
                  {METRICS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 cursor-pointer"
                >
                  <option value="">All departments (RBU)</option>
                  {depts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        }
      >
        {view === "grid" ? (
          <VersionDiffGrid
            vg={vg}
            loading={vgLoading}
            cols={diffCols}
            groups={diffGroups}
            sumOver={sumOver}
            changedOnly={changedOnly}
          />
        ) : traces.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            No plan data for this scope.
          </p>
        ) : (
          <Plot
            data={traces as never[]}
            layout={{
              height: 340,
              margin: { l: 70, r: 20, t: 10, b: 60 },
              font: { family: "Inter, system-ui, sans-serif", size: 10 },
              showlegend: true,
              legend: { orientation: "h", y: -0.22, font: { size: 10 } },
              yaxis: {
                title: { text: metric === "SLS_UNITS" ? "Units" : currency },
                gridcolor: "#f1f5f9",
                rangemode: "tozero",
              },
              xaxis: { automargin: true, tickangle: -30, tickfont: { size: 9 } },
              plot_bgcolor: "white",
              paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        )}
      </Card>

      {/* Approved versions, with the reasons behind their largest movements. */}
      {(hist?.versions.length ?? 0) > 0 && (
        <Card
          title="Approved versions"
          subtitle="Who signed each one off, what it moved, and the FX rate frozen onto it"
          className="mb-5"
        >
          <div className="space-y-3">
            {hist!.versions.map((v) => (
              <div key={v.versionId} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                        v{v.versionNo}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{v.label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          v.status === "APPROVED"
                            ? "text-emerald-800 bg-emerald-100"
                            : "text-slate-600 bg-slate-100"
                        }`}
                      >
                        {v.status === "APPROVED" ? "IN FORCE" : "SUPERSEDED"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {v.approvedBy}
                      {v.approvedAt
                        ? ` · ${new Date(v.approvedAt).toLocaleString(undefined, {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}`
                        : ""}
                      {v.scenarioName ? ` · from "${v.scenarioName}"` : ""}
                    </div>
                    {v.prompt && (
                      <div className="text-[10px] text-slate-400 italic mt-0.5">
                        &ldquo;{v.prompt}&rdquo;
                      </div>
                    )}
                  </div>
                  {v.settings && (
                    <div className="text-[10px] text-slate-500 text-right shrink-0">
                      <div className="font-semibold text-slate-600 mb-0.5">Settings frozen</div>
                      <div className="font-mono">
                        FX {String(v.settings.FX_RATE_PHP_AUD ?? "–")}
                      </div>
                      <div className="font-mono">
                        Bands {String(v.settings.BUY_OVERBUY_MULT ?? "–")} /{" "}
                        {String(v.settings.BUY_UNDERBUY_MULT ?? "–")}
                      </div>
                    </div>
                  )}
                </div>

                {v.adjustments.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Largest movements, with their reasons
                    </div>
                    <div className="space-y-0.5">
                      {v.adjustments.map((a, i) => (
                        <div key={i} className="flex items-baseline gap-2 text-[11px]">
                          <span className={`font-mono font-semibold w-24 text-right ${varianceClass(a.delta)}`}>
                            {fmtMoney(a.delta, currency)}
                          </span>
                          <span className="font-medium text-slate-800">{a.class}</span>
                          {a.reasonLabel && (
                            <span className="px-1.5 rounded bg-slate-100 text-slate-600 text-[9px] font-semibold">
                              {a.reasonLabel}
                            </span>
                          )}
                          <span className="text-slate-500 truncate">{a.reasonNote}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Change audit"
        subtitle="Every cell edit and approval, newest first. Append-only — nothing here can be edited or removed."
        right={
          <div className="flex items-center gap-2">
            <input
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              placeholder="Filter by class"
              className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 w-36 focus:border-violet-500 focus:outline-none"
            />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="text-[11px] border border-slate-200 rounded-md px-2 py-1.5 cursor-pointer"
            >
              <option value="">All sources</option>
              <option value="MANUAL_GRID">Hand edits</option>
              <option value="GENERATED_SCENARIO">Generated scenarios</option>
              <option value="APPROVAL">Approvals</option>
            </select>
          </div>
        }
      >
        {events.length === 0 ? (
          <div className="text-center py-10">
            <FileClock className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 font-medium">No changes recorded yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              The trail starts when the first forecast cell is edited or a scenario is built.
              Cells changed before the audit existed have no history, and none has been invented.
            </p>
            <Link
              href="/planning/scenarios"
              className="inline-block mt-4 px-4 py-2 text-xs font-semibold rounded-md bg-violet-600 text-white hover:bg-violet-700"
            >
              Build a scenario
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th align="center">Source</Th>
                  <Th>Class</Th>
                  <Th>Cell</Th>
                  <Th align="right">From</Th>
                  <Th align="right">To</Th>
                  <Th align="right">Change</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((e, i) => (
                  <tr key={`ap-${i}`} className="border-b border-slate-100 bg-emerald-50/40">
                    <Td className="text-slate-500 whitespace-nowrap">
                      {e.eventAt
                        ? new Date(e.eventAt).toLocaleString(undefined, {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })
                        : "–"}
                    </Td>
                    <Td className="font-medium">{e.actor ?? "–"}</Td>
                    <Td align="center">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-emerald-800 bg-emerald-100">
                        <CheckCircle2 className="w-2.5 h-2.5" /> APPROVAL
                      </span>
                    </Td>
                    <Td colSpan={4} className="text-slate-700 font-medium">
                      {e.detail}
                    </Td>
                    <Td align="right" mono className={varianceClass(e.delta)}>
                      {e.delta !== null ? fmtMoney(e.delta, currency) : "–"}
                    </Td>
                    <Td className="text-slate-500">{e.reasonNote ?? "–"}</Td>
                  </tr>
                ))}
                {cellChanges.map((e, i) => {
                  const Icon = SOURCE_ICON[e.changeSource ?? ""] ?? PencilLine;
                  return (
                    <tr key={`cc-${i}`} className="border-b border-slate-50 hover:bg-slate-50">
                      <Td className="text-slate-500 whitespace-nowrap">
                        {e.eventAt
                          ? new Date(e.eventAt).toLocaleString(undefined, {
                              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                            })
                          : "–"}
                      </Td>
                      <Td className="font-medium">{e.actor ?? "–"}</Td>
                      <Td align="center">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                            SOURCE_STYLE[e.changeSource ?? ""] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          {e.changeSource === "MANUAL_GRID"
                            ? "HAND"
                            : e.changeSource === "GENERATED_SCENARIO"
                            ? "AI"
                            : e.changeSource}
                        </span>
                      </Td>
                      <Td className="font-medium">{e.class ?? "–"}</Td>
                      <Td className="text-slate-500 font-mono text-[10px]">
                        {e.periodCode} W{e.weekNo} ·{" "}
                        {e.metric === "SLS_PHP"
                          ? "Sales"
                          : e.metric === "POS_GP_AMT"
                          ? "Margin"
                          : "Units"}
                      </Td>
                      <Td align="right" mono className="text-slate-500">
                        {e.oldValue !== null
                          ? e.metric === "SLS_UNITS"
                            ? fmtNum(e.oldValue)
                            : fmtMoney(e.oldValue, currency)
                          : "forecast"}
                      </Td>
                      <Td align="right" mono className="font-semibold">
                        {e.newValue !== null
                          ? e.metric === "SLS_UNITS"
                            ? fmtNum(e.newValue)
                            : fmtMoney(e.newValue, currency)
                          : "–"}
                      </Td>
                      <Td align="right" mono className={varianceClass(e.delta)}>
                        {e.delta !== null
                          ? e.metric === "SLS_UNITS"
                            ? fmtNum(e.delta)
                            : fmtMoney(e.delta, currency)
                          : "–"}
                      </Td>
                      <Td className="text-slate-500">
                        {e.reasonLabel ? (
                          <span className="px-1.5 rounded bg-slate-100 text-slate-600 text-[9px] font-semibold mr-1">
                            {e.reasonLabel}
                          </span>
                        ) : null}
                        {e.reasonNote ?? (e.reasonLabel ? "" : "–")}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[10px] text-slate-400 mt-3 leading-relaxed max-w-4xl">
        The audit is append-only: there is no edit or delete path, because an audit trail that can be
        changed is not one. A change entered in error is corrected by making another change, which
        leaves both rows visible &mdash; the honest record of what happened. &ldquo;From&rdquo; reads
        <span className="font-mono"> forecast</span> when a cell had never been edited before, since
        the value it moved away from was the model&apos;s.
      </p>
    </div>
  );
}

// ─── Version diff grid ────────────────────────────────────────────────────────
//
// Three rows per class: the version, the version before it, and the movement
// between them. Only the movement row is highlighted, and only where it is
// non-zero, so a 25-column grid still points straight at what changed.
//
// Sub-peso movements are treated as unchanged. Allocating a monthly figure across
// weeks by cumulative rounding leaves residue of a few centavos, and highlighting
// that would mark cells nobody touched.
function VersionDiffGrid({
  vg, loading, cols, groups, sumOver, changedOnly,
}: {
  vg: VersionGridResponse | null;
  loading: boolean;
  cols: DiffCol[];
  groups: {
    department: string;
    classes: VersionGridResponse["rows"];
    movementTotal: number;
    changed: boolean;
  }[];
  sumOver: (m: Record<string, number>, keys: string[]) => number;
  changedOnly: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading version detail…
      </div>
    );
  }
  if (!vg || !vg.version) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        No approved versions yet. Approve a scenario to create one.
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        {changedOnly
          ? "This version changed nothing in this half. Try the other half, or untick “Changed only”."
          : "No plan rows for this scope."}
      </p>
    );
  }

  const cellVal = (m: Record<string, number>, c: DiffCol) =>
    c.kind === "week" ? (m[c.key] ?? 0) : sumOver(m, c.weekKeys);

  const changedClasses = vg.rows.filter((r) => r.changedWeeks > 0).length;

  return (
    <>
      <div className="flex items-center justify-between mb-2 text-[11px]">
        <div className="text-slate-600">
          <span className="font-semibold text-slate-900">
            v{vg.version.versionNo} {vg.version.label}
          </span>
          <span className="text-slate-400"> compared with </span>
          <span className="font-medium">
            {vg.comparedWith.versionNo > 0
              ? `v${vg.comparedWith.versionNo} ${vg.comparedWith.label}`
              : vg.comparedWith.label}
          </span>
        </div>
        <div className="text-slate-500">
          {changedClasses} of {vg.rows.length} classes moved
          {vg.version.approvedBy ? ` · signed off by ${vg.version.approvedBy}` : ""}
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-[11px] border-collapse w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th className="sticky left-0 bg-slate-50 z-10 min-w-[190px]">Class</Th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 text-right whitespace-nowrap font-semibold ${
                    c.kind === "week"
                      ? "text-slate-500"
                      : "text-slate-800 bg-slate-100 border-l border-slate-200"
                  }`}
                >
                  {c.label}
                  {c.kind === "week" && (
                    <div className="text-[9px] font-normal text-slate-400">{c.sub}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.department}>
                {/* Department band, so the hierarchy is readable without indent guessing. */}
                <tr className="bg-slate-100/70">
                  <Td className="sticky left-0 bg-slate-100 z-10 font-semibold text-slate-800">
                    {g.department}
                  </Td>
                  <Td colSpan={cols.length} align="right" mono
                    className={g.changed ? "font-semibold" : "text-slate-400"}>
                    {g.changed ? `${fmtKSigned(g.movementTotal)} total movement` : "no change"}
                  </Td>
                </tr>

                {g.classes.map((r) => {
                  const moved = r.changedWeeks > 0;
                  return (
                    <Fragment key={`${g.department}-${r.class}`}>
                      <tr className="border-t border-slate-200">
                        <Td rowSpan={3}
                          className="sticky left-0 bg-white z-10 align-top border-r border-slate-200">
                          <div className="font-medium text-slate-900">{r.class}</div>
                          <div className={`text-[10px] ${moved ? "text-violet-700 font-semibold" : "text-slate-400"}`}>
                            {moved ? `${fmtKSigned(r.movementTotal)} · ${r.changedWeeks} wks` : "unchanged"}
                          </div>
                        </Td>
                        {cols.map((c) => (
                          <td key={c.key}
                            className={`px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap ${
                              c.kind === "week" ? "" : "bg-slate-50 font-semibold border-l border-slate-200"
                            }`}>
                            {fmtK1(cellVal(r.cur, c))}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-slate-500">
                        {cols.map((c) => (
                          <td key={c.key}
                            className={`px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap ${
                              c.kind === "week" ? "" : "bg-slate-50 border-l border-slate-200"
                            }`}>
                            {fmtK1(cellVal(r.prv, c))}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        {cols.map((c) => {
                          const v = cellVal(r.mov, c);
                          const hit = Math.abs(v) >= 1;
                          return (
                            <td key={c.key}
                              className={`px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap ${
                                hit
                                  ? `font-bold ring-1 ring-inset ring-violet-300 ${
                                      v > 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                                    }`
                                  : "text-slate-300"
                              } ${c.kind === "week" ? "" : "border-l border-slate-200"}`}>
                              {fmtKSigned(v)}
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span>Rows per class, top to bottom: this version · previous version · movement</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-emerald-50 ring-1 ring-inset ring-violet-300" /> increase
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-red-50 ring-1 ring-inset ring-violet-300" /> decrease
        </span>
        <span>Figures in {vg.metric === "SLS_UNITS" ? "units" : `${vg.currency} 000's`}</span>
      </div>
    </>
  );
}
