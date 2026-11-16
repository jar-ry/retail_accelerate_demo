"use client";

import { useState } from "react";
import { Sparkles, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, Button, Banner, Pill, inputCls } from "../../_components/ui";
import { useHopAction, type Row } from "../../_components/useHop";
import { audM, toNum } from "@/lib/hop/format";
import type { StoreDraft } from "./Dialogs";

type Parsed = {
  draft: StoreDraft & { benchmarkStoreName: string | null; benchmarkIsNew: boolean };
  inferredFields: string[];
  missingFields: string[];
  clarification: string;
  needsBenchmarkReason: boolean;
  problems: string[];
  tokens: { total: number | null };
};

type Advice = {
  headline: string;
  findings: { observation: string; severity: string }[];
  questionsToSettle: string[];
  confidence: string;
  impact: Row;
  isVerified: boolean;
  unverifiedFigures: string[];
  tokens: { total: number | null };
};

const SEV: Record<string, "red" | "amber" | "slate"> = { HIGH: "red", MEDIUM: "amber", LOW: "slate" };
/** The impact figures arrive as percentages already (85.0 means 85%). */
const asPct = (v: unknown, signed = false) => {
  const n = toNum(v);
  return n === null ? "—" : `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;
};

/** Describe an opening in a sentence. The assistant fills the add-store form and
 *  can explain what the opening does to the plan; it never creates the store. */
export function StoreAssist({ onUse }: { onUse: (draft: StoreDraft, inferred: string[]) => void }) {
  const assist = useHopAction<Parsed & Advice>("store-assist");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"PARSE" | "ADVISE" | null>(null);

  const draftIt = async () => {
    setErr(null); setAdvice(null); setBusy("PARSE");
    const r = await assist.run({ mode: "PARSE", text });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setParsed(r.data);
  };

  const checkImpact = async () => {
    if (!parsed) return;
    const d = parsed.draft;
    setErr(null); setBusy("ADVISE");
    const r = await assist.run({
      mode: "ADVISE", storeName: d.storeName, openingDate: d.openingDate, firstMonth: d.firstMonth,
      benchmarkStoreCode: d.benchmarkStoreCode, benchmarkPct: d.benchmarkPct, haloWeeks: d.haloWeeks,
    });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setAdvice(r.data);
  };

  const d = parsed?.draft;
  const inferred = new Set(parsed?.inferredFields ?? []);
  const tag = (field: string) => (inferred.has(field) ? <Pill tone="amber" title="Worked out rather than read from what you typed">inferred</Pill> : null);
  const canAdvise = !!d?.benchmarkStoreCode && d.benchmarkPct !== null && (!!d.openingDate || !!d.firstMonth);

  return (
    <Card
      title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-teal-600" />Describe an opening</span>}
      subtitle="AI assisted. Type it as you would say it; the assistant fills the add-store form for you to check. Nothing is created until you save the form."
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy} maxLength={1000}
            placeholder="e.g. open Rouse Hill mid-October at about 85% of Parramatta, same north-west growth corridor"
            onKeyDown={(e) => e.key === "Enter" && text.trim() && !busy && draftIt()} />
          <Button variant="primary" onClick={draftIt} disabled={!text.trim() || !!busy}>
            {busy === "PARSE" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Drafting…</> : "Draft it"}
          </Button>
        </div>
        {err && <Banner tone="error">{err}</Banner>}

        {d && (
          <div className="rounded-md border border-slate-200 p-3 text-xs">
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <div><span className="text-slate-500">Store </span><b>{d.storeName || "not given"}</b> {tag("store_name")}</div>
              <div>
                <span className="text-slate-500">Opens </span>
                <b>{d.openingDate ?? (d.firstMonth ? `from ${d.firstMonth}, date inferred` : "not given")}</b> {tag("opening_date")}{tag("first_month")}
              </div>
              <div>
                <span className="text-slate-500">Benchmark </span>
                <b>{d.benchmarkStoreCode ? `${d.benchmarkStoreCode} ${d.benchmarkStoreName ?? ""}` : "not given"}</b>
                {d.benchmarkPct !== null && <> at <b>{(d.benchmarkPct * 100).toFixed(0)}%</b></>} {tag("benchmark_store_code")}{tag("benchmark_pct")}
                {d.benchmarkIsNew && <Pill tone="violet" title="Its weekly shape follows that store's own comparable">itself new</Pill>}
              </div>
              <div><span className="text-slate-500">Halo </span><b>{d.haloWeeks ?? "default"} weeks</b> {tag("halo_weeks")}</div>
              <div><span className="text-slate-500">Location </span><b>{d.state} · {d.region} · {d.format}</b> {tag("state")}{tag("region")}{tag("store_format")}</div>
              <div><span className="text-slate-500">Why this benchmark </span>{d.benchmarkReason ? <b>{d.benchmarkReason}</b> : <Pill tone="red">no reason given</Pill>}</div>
            </div>
            {d.sizing && <div className="mt-1.5 text-slate-600">Sizing: {d.sizing}</div>}
            {parsed!.problems.length > 0 && <div className="mt-2"><Banner tone="warn">{parsed!.problems.join(" ")}</Banner></div>}
            {parsed!.needsBenchmarkReason && (
              <p className="mt-2 text-[11px] text-amber-800">A benchmark needs a stated reason before the store can be saved. The assistant will not invent one.</p>
            )}
            {parsed!.clarification && <p className="mt-2 text-[11px] text-slate-600">{parsed!.clarification}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => onUse(d, parsed!.inferredFields)}>Open in the add-store form</Button>
              <Button onClick={checkImpact} disabled={!canAdvise || !!busy} title={canAdvise ? "What this opening does to the plan" : "Needs a benchmark, a share and an opening month"}>
                {busy === "ADVISE" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</> : "What does it do to the plan?"}
              </Button>
              <Button variant="ghost" onClick={() => { setParsed(null); setAdvice(null); }}>Discard</Button>
            </div>
          </div>
        )}

        {advice && (
          <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50/30 p-3 text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="New store, H1" value={audM(toNum(advice.impact.new_store_sales_aud), 2)} sub={`${String(advice.impact.months_trading)} months`} />
              <Stat label="Plan after" value={audM(toNum(advice.impact.plan_after_aud), 2)} sub={`from ${audM(toNum(advice.impact.plan_now_aud), 2)}`} />
              <Stat label="Total growth" value={asPct(advice.impact.total_growth_after_pct, true)} sub={`from ${asPct(advice.impact.total_growth_now_pct, true)} · LFL unchanged`} />
              <Stat label="New-store share" value={asPct(advice.impact.new_store_share_after_pct)} sub={`from ${asPct(advice.impact.new_store_share_now_pct)}`} />
            </div>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-snug text-slate-900">{advice.headline}</p>
              {advice.isVerified
                ? <span title="Every number matched a figure the model was given" className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"><ShieldCheck className="h-3 w-3" />verified</span>
                : <span title={advice.unverifiedFigures.join(" · ")} className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"><ShieldAlert className="h-3 w-3" />unverified</span>}
            </div>
            {!advice.isVerified && advice.unverifiedFigures.length > 0 && (
              <Banner tone="warn">These numbers could not be matched to the figures supplied: {advice.unverifiedFigures.slice(0, 6).join(" · ")}</Banner>
            )}
            <ul className="space-y-1.5">
              {advice.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-slate-800"><Pill tone={SEV[f.severity] ?? "slate"}>{String(f.severity).toLowerCase()}</Pill><span>{f.observation}</span></li>
              ))}
            </ul>
            {advice.questionsToSettle.length > 0 && (
              <div className="rounded-md bg-white p-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">To settle before saving</div>
                <ol className="list-decimal space-y-1 pl-4 text-slate-700">{advice.questionsToSettle.map((q, i) => <li key={i}>{q}</li>)}</ol>
              </div>
            )}
            <p className="text-[10px] text-slate-400">
              The arithmetic is done in SQL, the same way adding the store would write it; the model only explains it. confidence {advice.confidence.toLowerCase()}
              {advice.tokens.total !== null ? ` · ${advice.tokens.total.toLocaleString("en-AU")} tokens` : ""} · logged as a store-entry run.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
