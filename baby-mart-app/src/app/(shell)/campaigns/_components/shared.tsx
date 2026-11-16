"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { Card, Button, Banner, Pill, InfoTip, inputCls } from "./ui";
import { useCmp, useCmpAction, parse, type Row } from "./useCmp";
import { PROVENANCE_HINT, STATUS_LABEL, STAGES, type Provenance, type Status } from "@/lib/campaign/config";
import { isoDateTime, num, toNum } from "@/lib/campaign/format";

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

type Finding = { observation: string; figures_cited: string[]; severity: string };
type Rec = { action: string; rationale: string; owning_party: string };
const SEV: Record<string, "red" | "amber" | "slate"> = { HIGH: "red", MEDIUM: "amber", LOW: "slate" };

/** The AI read of a surface: grounded in the figures the page shows, every number checked. */
export function InsightPanel({ surface, placeholder, className = "" }: { surface: string; placeholder?: string; className?: string }) {
  const { data, isLoading } = useCmp<{ latest: Row | null }>("insights", { surface });
  const gen = useCmpAction("insights");
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const latest = data?.latest ?? null;
  const response = parse<{ headline: string; findings: Finding[]; recommendations: Rec[]; confidence: string }>(latest?.RESPONSE);
  const unmatched = parse<string[]>(latest?.UNVERIFIED_FIGURES) ?? [];
  const run = async () => {
    setErr(null);
    const r = await gen.run({ surface, question: question.trim() || null });
    if (!r.ok) setErr(r.error);
  };
  return (
    <Card className={className}
      title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />AI read of this screen</span>}
      subtitle="AI_COMPLETE over this page's figures; every number checked against them"
      right={<Button variant="primary" onClick={run} disabled={gen.busy}>{gen.busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking…</> : latest ? "Refresh" : "Generate"}</Button>}>
      <div className="space-y-3">
        <input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={gen.busy}
          placeholder={placeholder ?? "Optional: ask something specific"} onKeyDown={(e) => e.key === "Enter" && !gen.busy && run()} />
        {gen.busy && <p className="text-[11px] text-slate-500">The model is reading the figures. This usually takes 15 to 30 seconds.</p>}
        {err && <Banner tone="error">{err}</Banner>}
        {isLoading ? <p className="text-xs text-slate-400">Loading…</p> : !latest ? (
          <p className="text-xs text-slate-500">No read yet for this screen. Generate one: it only uses the figures shown here.</p>
        ) : latest.ERROR_MESSAGE ? (
          <Banner tone="error">The last attempt failed and was logged: {String(latest.ERROR_MESSAGE).slice(0, 300)}</Banner>
        ) : response ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-snug text-slate-900">{response.headline}</p>
              <Verified v={latest.IS_VERIFIED} unmatched={unmatched} />
            </div>
            {latest.IS_VERIFIED !== true && unmatched.length > 0 && (
              <Banner tone="warn">These numbers could not be matched to the figures supplied: {unmatched.slice(0, 6).join(" · ")}</Banner>
            )}
            {latest.QUESTION ? <p className="text-[11px] italic text-slate-500">Asked: “{String(latest.QUESTION)}”</p> : null}
            <ul className="space-y-1.5">
              {response.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-800"><Pill tone={SEV[f.severity] ?? "slate"}>{f.severity.toLowerCase()}</Pill><span>{f.observation}</span></li>
              ))}
            </ul>
            {response.recommendations.length > 0 && (
              <div className="rounded-md bg-slate-50 p-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recommended</div>
                <ol className="space-y-1.5">
                  {response.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-slate-800">
                      <Pill tone="amber">{r.owning_party.toLowerCase()}</Pill> <span className="font-medium">{r.action}</span>
                      <div className="pl-1 text-[11px] text-slate-500">{r.rationale}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-[10px] text-slate-400">
              Confidence {String(response.confidence).toLowerCase()} · {String(latest.MODEL)} · {num(toNum(latest.TOTAL_TOKENS))} tokens · {String(latest.GENERATED_BY)} {isoDateTime(latest.GENERATED_AT)}
            </p>
          </div>
        ) : null}
      </div>
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
