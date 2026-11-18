"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { InfoTip } from "@/components/ui/kit";

export { Card, ErrorState, Banner, Th, Td, Pill, Segmented, Button, InfoTip, inputCls } from "@/components/ui/kit";

// ─── Shared UI for the NPS Analyst pages ─────────────────────────────────────
//
// The shared kit, plus what is particular to sentiment: the NPS colour scale,
// a KPI tile that reads its change the right way round (more complaints is
// worse), and the step header the five pages share (detect, locate, drill,
// explain, predict).

export const STEPS = [
  { href: "/sentiment", label: "Pulse", step: "1 · Detect" },
  { href: "/sentiment/map", label: "State map", step: "2 · Locate" },
  { href: "/sentiment/store", label: "Store 360", step: "3 · Drill" },
  { href: "/sentiment/investigate", label: "Investigator", step: "4 · Explain" },
  { href: "/sentiment/risk", label: "Risk radar", step: "5 · Predict" },
] as const;

export function StepHeader({ step, title, subtitle, right }: { step: string; title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">{step}</div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5 max-w-3xl">{subtitle}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center h-96">
      <Loader2 className="w-8 h-8 animate-spin text-rose-600 mb-3" />
      <p className="text-sm text-slate-500">Loading {what}…</p>
    </div>
  );
}

// NPS colour: rose when negative, through amber, to green and teal at +50.
const STOPS: [number, [number, number, number]][] = [
  [-30, [159, 18, 57]], [-10, [244, 63, 94]], [5, [245, 158, 11]], [20, [132, 204, 22]], [35, [16, 185, 129]], [50, [15, 118, 110]],
];
export function npsColor(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "#e2e8f0";
  if (v <= STOPS[0][0]) return `rgb(${STOPS[0][1].join(",")})`;
  for (let i = 1; i < STOPS.length; i++) {
    const [x1, c1] = STOPS[i];
    if (v <= x1) {
      const [x0, c0] = STOPS[i - 1];
      const t = (v - x0) / (x1 - x0);
      return `rgb(${c0.map((c, k) => Math.round(c + t * (c1[k] - c))).join(",")})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(",")})`;
}
export const NPS_LEGEND = [-30, -10, 5, 20, 35, 50];

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));
export const signed = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Apr 2026" (or "27 Apr") from an ISO date. */
export function fmtDate(isoDate: string | null | undefined, year = true): string {
  if (!isoDate) return "–";
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ""}`;
}
export function weekEnd(isoWeek: string): string {
  const d = new Date(isoWeek + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function Kpi({ label, value, change, changeUnit = "pts", invert, sub, hint, emphasis, decimals = 1 }: {
  label: string; value: string; change?: number | null; changeUnit?: string; invert?: boolean; sub?: React.ReactNode; hint?: string; emphasis?: boolean; decimals?: number;
}) {
  const bad = change === null || change === undefined ? null : invert ? change > 0 : change < 0;
  return (
    <div className={`bg-white rounded-xl p-4 border shadow-sm ${emphasis ? "border-rose-300" : "border-slate-200"}`}>
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="font-mono tabular-nums text-2xl font-bold text-slate-900">{value}</div>
        {change !== null && change !== undefined && (
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${bad ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {change < 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
            {signed(change, decimals)}{changeUnit ? ` ${changeUnit}` : ""}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] mt-0.5 text-slate-500">{sub}</div>}
    </div>
  );
}

export function NpsChip({ v, small }: { v: number | null | undefined; small?: boolean }) {
  return (
    <span className={`inline-block rounded font-mono tabular-nums font-semibold text-white ${small ? "px-1 text-[10px]" : "px-1.5 py-0.5 text-[11px]"}`}
      style={{ background: npsColor(v) }}>
      {fmt(v, 0)}
    </span>
  );
}

export function WeekSelect({ weeks, value, onChange }: { weeks: string[]; value: string; onChange: (w: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
      Focus week
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-rose-500 focus:outline-none">
        {[...weeks].reverse().map((w) => <option key={w} value={w}>Week of {fmtDate(w)}</option>)}
      </select>
    </label>
  );
}

export function StepLink({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${primary ? "bg-rose-600 text-white border-rose-600 hover:bg-rose-700" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}>
      {children}
    </Link>
  );
}

/** Plotly defaults shared by every chart on these pages. */
export const PLOT_FONT = { family: "Inter, system-ui, sans-serif", size: 11, color: "#334155" };
export const PLOT_CONFIG = { displayModeBar: false, responsive: true };
export const SERIES = ["#e11d48", "#0f766e", "#6366f1", "#f59e0b", "#0ea5e9", "#a855f7"];
