"use client";

import Link from "next/link";
import { ShieldCheck, ShieldAlert, ListChecks, Bot } from "lucide-react";
import { Card, Button, Banner, Pill, InfoTip } from "./ui";
import { useCmp } from "./useCmp";
import { PROVENANCE_HINT, STATUS_LABEL, STAGES, type Provenance, type Status } from "@/lib/campaign/config";
import { toNum } from "@/lib/campaign/format";

// ─── Pieces every Campaign & CRM page shares ──────────────────────────────────

const PROV_TONE: Record<string, "green" | "slate" | "violet" | "blue" | "amber" | "teal"> = {
  REAL: "green", GENERATED: "slate", MODELLED: "violet", SYNTHETIC: "blue", SIMULATED: "amber", AI: "teal",
};

/** Where a number comes from. Every figure on these pages is one of six kinds,
 *  and the badge says which, with the rule on hover. */
export function Prov({ p }: { p: string | null | undefined }) {
  const k = String(p ?? "REAL").toUpperCase();
  return (
    <InfoTip text={PROVENANCE_HINT[k as Provenance] ?? k}>
      <Pill tone={PROV_TONE[k] ?? "slate"}>{k.toLowerCase()}</Pill>
    </InfoTip>
  );
}

const STATUS_TONE: Record<string, "slate" | "blue" | "violet" | "amber" | "green" | "red" | "teal"> = {
  IDEA: "slate", BRIEF: "slate", AUDIENCE_LOCKED: "blue", CONTENT_APPROVED: "violet", SCHEDULED: "violet",
  LIVE: "green", PAUSED: "amber", COMPLETED: "teal", MEASURED: "teal", CANCELLED: "red",
};

export function StatusPill({ s }: { s: unknown }) {
  const k = String(s ?? "");
  return <Pill tone={STATUS_TONE[k] ?? "slate"}>{STATUS_LABEL[k as Status] ?? k}</Pill>;
}

/** The four stages, with the current one highlighted. */
export function StageStrip({ current }: { current?: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {STAGES.map((s) => (
        <Link key={s.n} href={s.href}
          className={`rounded-lg border px-3 py-2 transition ${current === s.n ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-amber-300"}`}>
          <div className="flex items-center gap-2">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${current === s.n ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-600"}`}>{s.n}</span>
            <span className="text-xs font-semibold text-slate-900">{s.label}</span>
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{s.blurb}</p>
        </Link>
      ))}
    </div>
  );
}

export function Verified({ v, unmatched }: { v: unknown; unmatched?: string[] }) {
  if (v === null || v === undefined) return null;
  return v === true
    ? <span title="Every number matched a figure the model was given" className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"><ShieldCheck className="h-3 w-3" />verified</span>
    : <span title={(unmatched ?? []).join(" · ")} className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"><ShieldAlert className="h-3 w-3" />unverified</span>;
}

type Finding = { severity: "HIGH" | "MEDIUM" | "LOW"; text: string; campaignId?: string; ask?: string };
const SEV: Record<string, "red" | "amber" | "slate"> = { HIGH: "red", MEDIUM: "amber", LOW: "slate" };

/** What matters most on this screen, computed from the holdout measurement and
 *  written from templates (src/lib/campaign/findings.ts), with the agents one
 *  click away for the questions that need judgement. */
export function FindingsPanel({ surface, ask, className = "" }: { surface: "OVERVIEW" | "PERFORMANCE" | "LEARNINGS"; ask: string; className?: string }) {
  const { data, isLoading, error } = useCmp<{ findings: Finding[]; asOf: string }>("findings", { surface });
  return (
    <Card className={className}
      title={<span className="inline-flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-amber-600" />Headline findings</span>}
      subtitle="Computed from every campaign's result against its holdout and the open alerts; no model involved"
      right={<Link href={`/campaigns/builder?q=${encodeURIComponent(ask)}`}><Button><Bot className="h-3.5 w-3.5" />Ask the agent</Button></Link>}>
      {isLoading ? <p className="text-xs text-slate-400">Loading…</p> : error ? <Banner tone="error">{(error as Error).message}</Banner> : (
        <ul className="space-y-1.5">
          {(data?.findings ?? []).map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-800">
              <Pill tone={SEV[f.severity] ?? "slate"}>{f.severity.toLowerCase()}</Pill>
              <span className="min-w-0 flex-1">{f.text}</span>
              {f.campaignId && f.ask && (
                <Link className="shrink-0 text-[11px] font-medium text-amber-700 hover:underline" href={`/campaigns/performance/${encodeURIComponent(f.campaignId)}?investigate=1#investigate`}>Investigate</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export const PLOT_LAYOUT = {
  margin: { l: 50, r: 16, t: 10, b: 36 }, font: { family: "Inter, system-ui, sans-serif", size: 11 },
  plot_bgcolor: "white", paper_bgcolor: "white", legend: { orientation: "h" as const, y: -0.18 },
  xaxis: { gridcolor: "#f1f5f9" }, yaxis: { gridcolor: "#f1f5f9" },
};
export const PLOT_CONFIG = { displayModeBar: false, responsive: true };

/** "+1.2 pts" with sign, or a dash. */
export function pp(v: unknown, d = 1) {
  const x = toNum(v);
  return x === null ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(d)} pts`;
}
export function rate(v: unknown, d = 1) {
  const x = toNum(v);
  return x === null ? "–" : `${(x * 100).toFixed(d)}%`;
}
