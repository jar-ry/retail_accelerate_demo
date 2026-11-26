"use client";

import { AlertTriangle, CheckCircle2, Gift, Target } from "lucide-react";
import { factTiles, overrideWarning, type Battlecard, type Evidence, type KeyArgument } from "@/lib/meeting";

// ─── The battlecard: the Facts step of the Supplier Meeting ───────────────────
//
// FactTiles render the negotiation evidence directly (no model involved).
// Arguments renders what Cortex AI wrote from that evidence, with the figure
// check the API ran on every number in it.

const TONE: Record<string, string> = {
  warn: "border-amber-200 bg-amber-50/60",
  good: "border-emerald-200 bg-emerald-50/60",
};

export function FactTiles({ e }: { e: Evidence }) {
  const warning = overrideWarning(e);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {factTiles(e).map((t) => (
          <div key={t.key} className={`rounded-lg border p-3 ${t.tone ? TONE[t.tone] : "border-slate-200 bg-white"}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{t.value}</div>
            <div className="text-[11px] text-slate-600">{t.sub}</div>
          </div>
        ))}
      </div>
      {warning && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-400">{e.period}. {e.provenance}</p>
    </div>
  );
}

function ImpactDots({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5" title={`Leverage ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-2.5 w-2.5 rounded-full ${i <= level ? "bg-blue-600" : "bg-slate-200"}`} />)}
    </div>
  );
}

const GROUPS: { key: keyof NonNullable<Battlecard["key_arguments"]>; title: string; border: string }[] = [
  { key: "profitability", title: "Profitability", border: "border-l-red-500" },
  { key: "growth", title: "Growth", border: "border-l-amber-500" },
  { key: "others", title: "Supply, price and promotions", border: "border-l-slate-400" },
];

export function CheckBadge({ check }: { check?: Battlecard["check"] }) {
  if (!check) return null;
  if (check.verified)
    return <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Every figure matches the evidence</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-800" title={check.unmatched.join("\n")}>
      <AlertTriangle className="h-3.5 w-3.5" />
      {check.unmatched.length} figure{check.unmatched.length > 1 ? "s" : ""} not in the evidence: {check.unmatched.map((u) => u.replace(/^prose: /, "")).join(", ")}
    </span>
  );
}

export function Arguments({ card }: { card: Battlecard }) {
  const ka = card.key_arguments;
  return (
    <div className="grid gap-0 overflow-hidden rounded-lg border border-slate-200 lg:grid-cols-[2fr_1fr] lg:divide-x lg:divide-slate-200">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase text-slate-600">
            <th className="px-3 py-2 font-semibold">Argument</th><th className="px-3 py-2 font-semibold">Brand data</th>
            <th className="px-3 py-2 font-semibold">Why it matters</th><th className="px-3 py-2 font-semibold">Ask</th>
            <th className="px-3 py-2 font-semibold">Leverage</th>
          </tr>
        </thead>
        <tbody>
          {ka && GROUPS.map((g) => (
            <ArgumentGroup key={g.key} title={g.title} border={g.border} items={ka[g.key] ?? []} />
          ))}
        </tbody>
      </table>
      <div className="space-y-5 bg-white p-4">
        {card.negotiation_approach && (
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-900"><Target className="h-3.5 w-3.5 text-blue-700" />Approach</h4>
            <p className="text-xs leading-relaxed text-slate-700">{card.negotiation_approach}</p>
          </div>
        )}
        {!!card.incentives?.length && (
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800"><Gift className="h-3.5 w-3.5" />What we can offer</h4>
            <ul className="space-y-1.5">{card.incentives.map((x, i) => <li key={i} className="text-xs text-slate-700">{x}</li>)}</ul>
          </div>
        )}
        {!!card.pressures?.length && (
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-800"><AlertTriangle className="h-3.5 w-3.5" />Expect pushback</h4>
            <ul className="space-y-1.5">{card.pressures.map((x, i) => <li key={i} className="text-xs text-slate-700">{x}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ArgumentGroup({ title, border, items }: { title: string; border: string; items: KeyArgument[] }) {
  if (!items.length) return null;
  return (
    <>
      <tr><td colSpan={5} className={`border-l-4 ${border} bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700`}>{title}</td></tr>
      {items.map((a, i) => (
        <tr key={i} className={`border-b border-l-4 border-slate-100 ${border} align-top`}>
          <td className="w-[18%] px-3 py-2.5">
            <div className="text-xs font-semibold text-slate-900">{a.name}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{a.description}</div>
          </td>
          <td className="w-[22%] px-3 py-2.5 text-[11px] text-slate-700">{a.data}</td>
          <td className="w-[24%] px-3 py-2.5 text-[11px] text-slate-700">{a.argument}</td>
          <td className="w-[24%] px-3 py-2.5 text-[11px] text-slate-700">{a.ask}</td>
          <td className="w-[12%] px-3 py-2.5"><ImpactDots level={a.impact} /></td>
        </tr>
      ))}
    </>
  );
}
