"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, X, AlertTriangle } from "lucide-react";

// ─── Shared UI for the Campaign & CRM pages ─────────────────────────────────
//
// The Head of Planning kit (hop/_components/ui.tsx) in the persona's colour,
// amber, so a page is recognisably Campaign & CRM at a glance.

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({
  title, subtitle, right, children, className = "", bodyClass,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {title && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          {right}
        </div>
      )}
      <div className={bodyClass ?? (title ? "px-5 pb-5" : "p-5")}>{children}</div>
    </div>
  );
}

export function Tile({
  label, value, sub, hint, emphasis, subClass,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  hint?: string;
  emphasis?: boolean;
  subClass?: string;
}) {
  return (
    <div className={`bg-white rounded-xl p-4 border shadow-sm ${emphasis ? "border-amber-300" : "border-slate-200"}`}>
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div className={`mt-1 font-mono tabular-nums text-slate-900 ${emphasis ? "text-2xl font-bold" : "text-xl font-semibold"}`}>{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${subClass ?? "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center h-96">
      <Loader2 className="w-8 h-8 animate-spin text-amber-600 mb-3" />
      <p className="text-sm text-slate-500">Loading {what}…</p>
    </div>
  );
}

/** Surfaces the actual error. A blank page after a failed query is far harder to
 *  diagnose than a visible message. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-red-800">Could not load this view</div>
        <div className="text-xs text-red-700 mt-1 font-mono break-words">{message}</div>
      </div>
    </div>
  );
}

export function Banner({ tone = "info", children, onClose }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode; onClose?: () => void }) {
  const cls = {
    info: "bg-amber-50 border-amber-200 text-amber-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    error: "bg-red-50 border-red-200 text-red-800",
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
  }[tone];
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${cls}`}>
      <div className="min-w-0">{children}</div>
      {onClose && (
        <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function Th({ children, align = "left", className = "", title }: { children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string; title?: string }) {
  return (
    <th title={title} className={`text-[11px] font-semibold text-slate-500 py-2 px-2 text-${align} whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", mono = false, className = "", colSpan, title }: {
  children?: React.ReactNode; align?: "left" | "right" | "center"; mono?: boolean; className?: string; colSpan?: number; title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={`py-1.5 px-2 text-${align} ${mono ? "font-mono tabular-nums" : ""} whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

const PILL: Record<string, string> = {
  teal: "text-teal-800 bg-teal-100",
  green: "text-emerald-800 bg-emerald-100",
  amber: "text-amber-800 bg-amber-100",
  red: "text-red-700 bg-red-100",
  slate: "text-slate-600 bg-slate-100",
  violet: "text-violet-800 bg-violet-100",
  blue: "text-blue-800 bg-blue-100",
};

export function Pill({ tone = "slate", children, title }: { tone?: keyof typeof PILL; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-1 text-[11px] ${value === o.value ? "bg-amber-50 text-amber-800 font-medium" : "text-slate-500 hover:bg-slate-50"} disabled:opacity-50`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children, onClick, variant = "outline", disabled, type = "button", title, className = "",
}: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean; type?: "button" | "submit"; title?: string; className?: string;
}) {
  const cls = {
    primary: "bg-amber-600 text-white hover:bg-amber-700 border-amber-600",
    outline: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-200",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${cls} ${className}`}>
      {children}
    </button>
  );
}

/** A hover tip rendered in a portal, so it is not clipped by the scrolling grids
 *  it usually sits inside. */
export function InfoTip({ text, children, tone = "info" }: { text: React.ReactNode; children?: React.ReactNode; tone?: "info" | "warn" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 });
  };
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} className="inline-flex items-center cursor-help">
      {children ?? (tone === "warn"
        ? <AlertTriangle className="w-3 h-3 text-amber-500" />
        : <Info className="w-3 h-3 text-slate-400" />)}
      {pos && typeof document !== "undefined" &&
        createPortal(
          <div style={{ left: pos.x, top: pos.y }}
            className="fixed z-[100] max-w-[290px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed text-slate-700 shadow-lg normal-case tracking-normal font-normal whitespace-normal">
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function Modal({ title, subtitle, onClose, children, wide }: {
  title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/30 p-6 overflow-y-auto" onMouseDown={onClose}>
      <div className={`mt-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl border border-slate-200 bg-white shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

