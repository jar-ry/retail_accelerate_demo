"use client";

import { useState } from "react";
import { Sparkles, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { Card, Button, Banner, Pill, inputCls } from "./ui";
import { useHop, useHopAction, type Row } from "./useHop";
import { isoDateTime, num, toNum } from "@/lib/hop/format";

type Payload = { latest: Row | null; template: Row | null };
type Finding = { observation: string; figures_cited: string[]; severity: string };
type Rec = { action: string; rationale: string; owning_party: string };

const SEV: Record<string, "red" | "amber" | "slate"> = { HIGH: "red", MEDIUM: "amber", LOW: "slate" };
const PARTY: Record<string, "teal" | "violet" | "blue"> = { PLANNING: "teal", BUYING: "violet", JOINT: "blue" };

function parse<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

/** The AI read of a surface. Grounded in figures the page already shows, and
 *  checked: every number the model writes is matched against what it was given,
 *  and an insight with an unmatched number says so in plain sight. */
export function InsightPanel({ surface, className = "" }: { surface: string; className?: string }) {
  const { data, isLoading } = useHop<Payload>("insights", { surface });
  const gen = useHopAction("insights");
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const latest = data?.latest ?? null;
  const response = parse<{ headline: string; findings: Finding[]; recommendations: Rec[]; confidence: string; doctrine_applied: string }>(latest?.RESPONSE);
  const unmatched = parse<string[]>(latest?.UNVERIFIED_FIGURES) ?? [];
  const verified = latest?.IS_VERIFIED === true;

  const run = async () => {
    setErr(null);
    const r = await gen.run({ surface, question: question.trim() || null });
    if (!r.ok) setErr(r.error);
  };

  return (
    <Card className={className}
      title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-teal-600" />AI read of this screen</span>}
      subtitle={data?.template ? `${String(data.template.NAME)} · ${String(data.template.MODEL)} · grounded in this page's figures, every number checked` : "Grounded in this page's figures; every number checked"}
      right={<Button variant="primary" onClick={run} disabled={gen.busy}>{gen.busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking…</> : latest ? "Refresh" : "Generate"}</Button>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={gen.busy}
            placeholder="Optional: ask something specific, e.g. which department puts the half most at risk?" onKeyDown={(e) => e.key === "Enter" && !gen.busy && run()} />
        </div>
        {gen.busy && <p className="text-[11px] text-slate-500">The model is reading the figures. This usually takes 15 to 30 seconds.</p>}
        {err && <Banner tone="error">{err}</Banner>}
        {isLoading ? <p className="text-xs text-slate-400">Loading…</p> : !latest ? (
          <p className="text-xs text-slate-500">No insight yet for this screen. Generate one: it will only use the figures shown here.</p>
        ) : latest.ERROR_MESSAGE ? (
          <Banner tone="error">The last attempt failed and was logged: {String(latest.ERROR_MESSAGE).slice(0, 300)}</Banner>
        ) : response ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-snug text-slate-900">{response.headline}</p>
              {verified
                ? <span title="Every number matched a figure the model was given" className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"><ShieldCheck className="h-3 w-3" />verified</span>
                : <span title={unmatched.join(" · ")} className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"><ShieldAlert className="h-3 w-3" />unverified</span>}
            </div>
            {!verified && unmatched.length > 0 && (
              <Banner tone="warn">These numbers could not be matched to the figures supplied, so treat this read with care: {unmatched.slice(0, 6).join(" · ")}</Banner>
            )}
            {latest.QUESTION ? <p className="text-[11px] italic text-slate-500">Asked: “{String(latest.QUESTION)}”</p> : null}
            <ul className="space-y-1.5">
              {response.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-800">
                  <Pill tone={SEV[f.severity] ?? "slate"}>{f.severity.toLowerCase()}</Pill>
                  <span>{f.observation}</span>
                </li>
              ))}
            </ul>
            {response.recommendations.length > 0 && (
              <div className="rounded-md bg-slate-50 p-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recommended</div>
                <ol className="space-y-1.5">
                  {response.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-slate-800">
                      <Pill tone={PARTY[r.owning_party] ?? "slate"}>{r.owning_party.toLowerCase()}</Pill> <span className="font-medium">{r.action}</span>
                      <div className="pl-1 text-[11px] text-slate-500">{r.rationale}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-[10px] text-slate-400">
              Method: {response.doctrine_applied} · confidence {String(response.confidence).toLowerCase()} · {String(latest.MODEL)} ·
              {" "}{num(toNum(latest.TOTAL_TOKENS))} tokens · doctrine v{String(latest.DOCTRINE_VERSION)} · {String(latest.GENERATED_BY)} {isoDateTime(latest.GENERATED_AT)}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
