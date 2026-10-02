"use client";

import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";

// ─── Shared UI for the Global Planning pages ──────────────────────────────────
//
// Scoped to /planning deliberately. The rest of the app copy-pastes its KPI
// cards, breadcrumbs and tables inline, and extracting a global component set
// would mean touching all 36 existing pages. These nine planning pages share
// enough structure that nine copies would be worse than one local module, so the
// compromise is a planning-local file rather than an app-wide refactor.

export type Currency = "PHP" | "AUD";

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Money in millions, which is the only scale these plans are read at.
 *  PHP figures run to hundreds of millions, so full precision is noise. */
export function fmtMoney(v: number | null | undefined, currency: Currency): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  const prefix = currency === "AUD" ? "A$" : "PHP ";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${prefix}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${prefix}${abs.toFixed(0)}`;
}

/** Exact money, for unit prices where millions rounding would hide the value. */
export function fmtMoneyExact(v: number | null | undefined, currency: Currency): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  const prefix = currency === "AUD" ? "A$" : "PHP ";
  return `${prefix}${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return `${v.toFixed(dp)}%`;
}

/** Signed percentage, so a variance reads as +6.0% rather than 6.0%. */
export function fmtPctSigned(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

export function fmtPp(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}pp`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return Math.round(v).toLocaleString();
}

/** Green for favourable, red for unfavourable, slate for flat.
 *  `goodIsUp` flips it for metrics where lower is better (e.g. markdown). */
export function varianceClass(v: number | null | undefined, goodIsUp = true): string {
  if (v === null || v === undefined || isNaN(v) || Math.abs(v) < 0.05) return "text-slate-600";
  const favourable = goodIsUp ? v > 0 : v < 0;
  return favourable ? "text-emerald-700" : "text-red-600";
}

// ─── Layout primitives ────────────────────────────────────────────────────────

export function Breadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
      {trail.map((t, i) => (
        <span key={`${t.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="w-3.5 h-3.5" />}
          {t.href ? (
            <Link href={t.href} className="hover:text-violet-700">
              {t.label}
            </Link>
          ) : (
            <span className="text-slate-900 font-medium">{t.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  subClass,
}: {
  /** ReactNode rather than string so a card can carry a SettingTip beside its
   *  label without a second wrapper component. */
  label: React.ReactNode;
  value: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${subClass ?? "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-start justify-between px-5 pt-4 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={title ? "px-5 pb-5" : "p-5"}>{children}</div>
    </div>
  );
}

export function CurrencyToggle({
  currency,
  onChange,
  fxTip,
}: {
  currency: Currency;
  onChange: (c: Currency) => void;
  /** Rendered beside the toggle, naming the FX setting that drives the AUD
     figures. Passed in rather than imported so this module stays free of a
     dependency on the parameter fetch. */
  fxTip?: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="inline-flex rounded-md border border-slate-200 overflow-hidden bg-white">
        {(["PHP", "AUD"] as Currency[]).map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
              currency === c
                ? "bg-violet-50 text-violet-800"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {currency === "AUD" && fxTip}
    </div>
  );
}

const BUY_STATUS_STYLE: Record<string, string> = {
  OVERBUY: "text-amber-800 bg-amber-100",
  UNDERBUY: "text-red-700 bg-red-100",
  BALANCED: "text-emerald-800 bg-emerald-100",
};

export function BuyStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        BUY_STATUS_STYLE[status] ?? "text-slate-600 bg-slate-100"
      }`}
    >
      {status}
    </span>
  );
}

/** G = grow, D = deliberate planned decline. Worth showing everywhere a decline
 *  appears, because a -12% forecast on a D class is on-strategy, not a problem. */
export function StrategyPill({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const grow = strategy === "G";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
        grow ? "text-emerald-800 bg-emerald-100" : "text-slate-600 bg-slate-200"
      }`}
      title={grow ? "Grow" : "Planned decline"}
    >
      {strategy}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: "text-red-700 bg-red-100",
  MEDIUM: "text-amber-800 bg-amber-100",
};

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        SEVERITY_STYLE[severity] ?? "text-slate-600 bg-slate-100"
      }`}
    >
      {severity}
    </span>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center h-96">
      <Loader2 className="w-8 h-8 animate-spin text-violet-500 mb-3" />
      <p className="text-sm text-slate-500">Loading {what}...</p>
    </div>
  );
}

/** Surfaces the actual error rather than an empty state. A silent blank page
 *  after a failed query is far harder to diagnose than a visible message. */
export function ErrorState({
  message,
  backHref,
  backLabel,
}: {
  message: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="p-6">
      {backHref && (
        <Link href={backHref} className="text-violet-700 hover:underline text-sm">
          &larr; {backLabel ?? "Back"}
        </Link>
      )}
      <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-red-800">Could not load this view</div>
        <div className="text-xs text-red-700 mt-1 font-mono break-words">{message}</div>
      </div>
    </div>
  );
}

// ─── Table primitives ─────────────────────────────────────────────────────────

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      className={`text-xs font-semibold text-slate-500 pb-2 px-2 text-${align} whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}
export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
  colSpan,
  rowSpan,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={`py-2 px-2 text-${align} ${mono ? "font-mono" : ""} whitespace-nowrap ${className}`}
    >
      {children}
    </td>
  );
}
