"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, CheckCircle2, Loader2, Megaphone, Target, XCircle, AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { splitBlock, type BlockTag } from "@/lib/campaign/agent-answer";
import { Card, Pill, Banner } from "../ui";
import VegaChart, { chartTitle } from "./VegaChart";
import type { Turn, RunInfo } from "./useAgentRun";

// ─── The agents' answers as cards ─────────────────────────────────────────────
//
// The campaign-sentiment-health result order: the card from the fenced JSON
// block first, then the agent's charts, then its narrative. The badge says
// whether every figure in the answer matched a tool result (server-checked,
// logged in AI_RUN).

export type Evidence = { label: string; value: string };
export type Guardrail = { level: "BLOCK" | "CAUTION" | string; message: string };

export type CampaignBlock = {
  name: string; objective: string; hypothesis: string;
  audience?: { description?: string; spec?: unknown; matched?: number | null; final_audience?: number | null };
  channels?: string[]; promoted?: { category?: string | null; brand?: string | null }; offer_id?: string | null;
  start_date?: string; end_date?: string; budget_aud?: number;
  expected?: { incremental_conversions?: number | null; lift_pts_low?: number | null; lift_pts_high?: number | null; basis?: string };
  guardrails?: Guardrail[]; key_evidence?: Evidence[];
  draft?: { campaign_id?: string; audience_id?: string } | null;
};

export type RcaBlock = {
  headline: string; confidence: string; causal_chain?: string[]; key_evidence?: Evidence[];
  hypotheses?: { hypothesis: string; verdict: string; evidence: string }[];
  ruled_out?: string[]; impact?: string; actions?: { owner: string; action: string }[]; learning?: string;
};

export type IdeaBlock = {
  title: string; signal_type?: string; hypothesis?: string;
  audience?: { description?: string; spec?: unknown; final_audience?: number | null };
  channels?: string[]; promoted?: { category?: string | null; brand?: string | null }; offer_id?: string | null;
  evidence?: string[]; risks?: string[]; priority?: string;
};

export function RunBadge({ run }: { run?: RunInfo }) {
  if (!run || run.verified === null) return null;
  return run.verified
    ? <span title="Every number in the answer matched a figure a tool returned" className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"><ShieldCheck className="h-3 w-3" />figures verified</span>
    : <span title={run.unmatched.join(" · ")} className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"><ShieldAlert className="h-3 w-3" />{run.unmatched.length} figure{run.unmatched.length === 1 ? "" : "s"} unverified</span>;
}

function EvidenceGrid({ items }: { items?: Evidence[] }) {
  if (!items?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {items.map((e, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="font-mono text-base font-semibold tabular-nums text-slate-900">{e.value}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{e.label}</div>
        </div>
      ))}
    </div>
  );
}

const CONF: Record<string, "green" | "amber" | "red"> = { High: "green", Medium: "amber", Low: "red" };
const VERDICT: Record<string, "red" | "slate" | "amber"> = { CONFIRMED: "red", RULED_OUT: "slate", INCONCLUSIVE: "amber" };

export function RcaBox({ rca, run }: { rca: RcaBlock; run?: RunInfo }) {
  const chain = rca.causal_chain ?? [];
  return (
    <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-700"><Target className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Root cause</span>
        <span className="ml-auto flex items-center gap-2"><RunBadge run={run} /><Pill tone={CONF[rca.confidence] ?? "amber"}>{rca.confidence} confidence</Pill></span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{rca.headline}</h2>
      {chain.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Causal chain</div>
          <div className="flex flex-wrap items-stretch gap-1.5">
            {chain.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className={`max-w-[230px] rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${i === chain.length - 1 ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-white text-slate-700"}`}>
                  <span className="mr-1 font-semibold text-amber-700">{i + 1}</span>{c}
                </div>
                {i < chain.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4"><EvidenceGrid items={rca.key_evidence} /></div>
      {rca.hypotheses?.length ? (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">What was tested</div>
          <table className="w-full text-[11px]">
            <tbody>
              {rca.hypotheses.map((h, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-slate-800">{h.hypothesis}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{h.evidence}</td>
                  <td className="py-1.5 text-right"><Pill tone={VERDICT[h.verdict] ?? "slate"}>{h.verdict.replace("_", " ").toLowerCase()}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Impact</div>
          <p className="text-xs leading-relaxed text-slate-700">{rca.impact}</p>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ruled out</div>
          <ul className="space-y-1">
            {rca.ruled_out?.map((r, i) => <li key={i} className="flex gap-1.5 text-[11px] text-slate-600"><XCircle className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />{r}</li>)}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Actions</div>
          <ul className="space-y-1">
            {rca.actions?.map((a, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] text-slate-700">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">{a.owner}:</span> {a.action}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {rca.learning && <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700"><span className="font-semibold">Learning: </span>{rca.learning}</p>}
    </div>
  );
}

const fmtN = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-AU", { maximumFractionDigits: 1 }) : "–");

export function CampaignCard({ c, run }: { c: CampaignBlock; run?: RunInfo }) {
  const e = c.expected ?? {};
  return (
    <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-700"><Megaphone className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Campaign proposal</span>
        <span className="ml-auto flex items-center gap-2">
          <RunBadge run={run} />
          {c.draft?.campaign_id ? <Pill tone="green">draft {c.draft.campaign_id}</Pill> : <Pill tone="slate">not saved</Pill>}
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{c.name}</h2>
      <p className="mt-1 text-xs text-slate-600">{c.objective}</p>
      <p className="mt-2 text-[11px] italic text-slate-500">{c.hypothesis}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <Fact label="Final audience" value={fmtN(c.audience?.final_audience)} sub={`of ${fmtN(c.audience?.matched)} matching`} />
        <Fact label="Expected incremental conversions" value={fmtN(e.incremental_conversions)}
          sub={e.lift_pts_low !== null && e.lift_pts_low !== undefined ? `comparable lift ${e.lift_pts_low} to ${e.lift_pts_high} pts` : "no comparable campaign"} />
        <Fact label="Channels and offer" value={(c.channels ?? []).join(" + ") || "–"} sub={c.offer_id ?? "no offer"} />
        <Fact label="Window and budget" value={c.budget_aud ? `AUD ${fmtN(c.budget_aud)}` : "–"} sub={c.start_date ? `${c.start_date} → ${c.end_date}` : ""} />
      </div>
      {c.audience?.description && <p className="mt-3 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">Who: </span>{c.audience.description}</p>}
      {e.basis && <p className="mt-1 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">Estimate rests on: </span>{e.basis}</p>}
      <div className="mt-4"><EvidenceGrid items={c.key_evidence} /></div>
      {c.guardrails?.length ? (
        <ul className="mt-3 space-y-1">
          {c.guardrails.map((g, i) => (
            <li key={i} className={`flex gap-1.5 text-[11px] ${g.level === "BLOCK" ? "text-red-700" : "text-amber-800"}`}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}
            </li>
          ))}
        </ul>
      ) : null}
      {c.draft?.campaign_id && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/campaigns/audiences?campaign=${encodeURIComponent(c.draft.campaign_id)}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
            Review and lock the audience <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** The narrative, styled element by element: the app has no typography plugin. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-slate-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        h1: ({ children }) => <h3 className="pt-2 text-[13px] font-semibold text-slate-900">{children}</h3>,
        h2: ({ children }) => <h3 className="pt-2 text-[13px] font-semibold text-slate-900">{children}</h3>,
        h3: ({ children }) => <h4 className="pt-1.5 text-xs font-semibold text-slate-900">{children}</h4>,
        p: ({ children }) => <p>{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-amber-300 pl-3 italic text-slate-600">{children}</blockquote>,
        table: ({ children }) => <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full border-collapse text-[11px]">{children}</table></div>,
        thead: ({ children }) => <thead className="border-b border-slate-200 bg-slate-50">{children}</thead>,
        th: ({ children }) => <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600">{children}</th>,
        td: ({ children }) => <td className="border-t border-slate-100 px-2.5 py-1.5 align-top">{children}</td>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}

/** Block card, charts, narrative: one answer, in that order. */
export function AgentAnswer({ t, tag, card }: { t: Turn; tag: BlockTag; card?: (block: unknown) => React.ReactNode }) {
  const s = splitBlock(t.text, tag);
  const narrative = s.block || s.pending || s.error ? s.after : s.before;
  const working = !t.done && !s.block;
  return (
    <div className="space-y-4">
      {s.block ? (
        card ? card(s.block) : tag === "rca" ? <RcaBox rca={s.block as RcaBlock} run={t.run} /> : tag === "campaign" ? <CampaignCard c={s.block as CampaignBlock} run={t.run} /> : null
      ) : working ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          {s.pending ? "Writing the answer…" : t.steps.length ? "Gathering evidence. The answer will appear here." : t.status ?? "Planning the next steps"}
        </div>
      ) : null}
      {s.error && <Banner tone="error">{s.error}</Banner>}
      {t.error && <Banner tone="error">{t.error}</Banner>}
      {t.done && !s.block && !t.error && t.text && <Banner tone="warn">The agent answered without its summary card; its full answer is below.</Banner>}
      {t.charts.length > 0 && (
        <div className={`grid gap-4 ${t.charts.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {t.charts.map((c, k) => (
            <Card key={k} title={chartTitle(c) ?? `Chart ${k + 1}`} subtitle="Drawn by the agent from its tool results">
              <VegaChart spec={c} />
            </Card>
          ))}
        </div>
      )}
      {narrative.trim() && (
        <Card title="The agent's reasoning" subtitle={t.run?.verified === false ? `Unmatched: ${t.run.unmatched.slice(0, 6).join(" · ")}` : undefined}>
          <Markdown text={narrative} />
        </Card>
      )}
    </div>
  );
}
