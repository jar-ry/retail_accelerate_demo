"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Check, X, ShieldAlert } from "lucide-react";
import { PageHeader, Card, Loading, ErrorState, Pill, Banner, Button, Modal, Field, inputCls, Th, Td, InfoTip } from "../_components/ui";
import { useCmp, useCmpAction, parse, type Row } from "../_components/useCmp";
import { StageStrip, Verified, Prov } from "../_components/shared";
import { AgentPanel } from "../_components/agent/AgentPanel";
import type { IdeaBlock } from "../_components/agent/AgentCards";
import type { Turn } from "../_components/agent/useAgentRun";
import { INTENT_LABEL, CHANNEL_LABEL, type ChannelCode } from "@/lib/campaign/config";
import { num, toNum, isoDateTime } from "@/lib/campaign/format";

type Signals = { due: Row[]; rfm: Row[]; supply: Row[]; intent: Row[]; brandVoice: Row[]; praise: Row[]; anomalies: Row[]; competitor: Row[]; learnings: Row[]; rejected: Row[]; nbp: Row[] };
type Guard = { level: "BLOCK" | "CAUTION"; message: string };

// Ideas mode: the agent sizes and checks each idea briefly and answers with an
// ```ideas block (agent/deploy_campaign_agents.template.sql).
const IDEA_PROMPTS = [
  "Give me four campaign ideas for the next six weeks, in ideas mode.",
  "Ideas mode: three ideas to win back lapsed customers without discounting people who would come back anyway.",
  "Ideas mode: three ideas that use what parents say they will buy next.",
];

const SIGNAL_TONE: Record<string, "teal" | "violet" | "blue" | "amber" | "red" | "green" | "slate"> = {
  LIFE_STAGE: "teal", VALUE: "violet", CATEGORY_GAP: "blue", SUPPLY: "amber", VOICE: "red", COMPETITOR: "slate", LEARNING: "green",
};

export default function IdeasPage() {
  const { data, isLoading, error } = useCmp<{ signals: Signals; ideas: Row[] }>("ideas");
  const save = useCmpAction<{ ideas: number; verified: boolean | null; alreadySaved?: boolean }>("ideas/from-run");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [deciding, setDeciding] = useState<{ idea: Row; decision: "ACCEPT" | "REJECT" } | null>(null);
  const [showDone, setShowDone] = useState(false);

  if (isLoading) return <Loading what="signals and ideas" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const s = data.signals;
  const ideas = data.ideas.filter((i) => showDone || ["NEW", "BLOCKED"].includes(String(i.STATUS)));

  // When the agent finishes, the server saves the ideas from the run it logged:
  // each audience re-sized and each guardrail re-checked before it reaches the board.
  const saveRun = async (t: Turn) => {
    setMsg(null);
    if (!t.run?.runId) return setMsg({ tone: "error", text: t.error ?? "The run was not logged, so its ideas cannot be saved." });
    if (!t.run.hasBlock) return setMsg({ tone: "warn", text: "The agent answered without an ideas block, so nothing was added to the board. Ask it again, or ask for ideas explicitly." });
    const r = await save.run({ runId: t.run.runId });
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setMsg({ tone: t.run.verified === false ? "warn" : "ok",
      text: `${r.data.ideas} ideas added to the board, each audience sized against the data.${t.run.verified === false ? ` Some numbers could not be traced to a tool result: ${t.run.unmatched.slice(0, 4).join(" · ")}` : ""}` });
  };

  return (
    <div className="p-6">
      <PageHeader title="Ideation" subtitle="Signals from purchases, stock, competitor prices and the customer voice, then campaign ideas grounded in exactly those signals." />
      <StageStrip current={1} />

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card title="Life-stage moments" subtitle="Families whose child is due for the next stage, from what they bought and when">
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Moving from</Th><Th>To</Th><Th align="right">Due now</Th><Th align="right">Contactable</Th></tr></thead>
            <tbody>{s.due.filter((d) => d.DUE_STATUS === "DUE_NOW").slice(0, 7).map((d, i) => (
              <tr key={i} className="border-b border-slate-50"><Td>{String(d.FROM_CLASS)}</Td><Td>{String(d.NEXT_CLASS)}</Td><Td align="right" mono>{num(toNum(d.CUSTOMERS))}</Td><Td align="right" mono>{num(toNum(d.CONTACTABLE))}</Td></tr>
            ))}</tbody></table>
          <div className="mt-1 flex gap-1"><Prov p="REAL" /><Prov p="MODELLED" /></div>
        </Card>
        <Card title="Supply and price" subtitle="What cannot be promoted, and where competitors are cheaper">
          <ul className="space-y-1 text-xs">
            {s.supply.map((x, i) => (
              <li key={i}><Pill tone={x.STATUS === "SHORT" ? "red" : "amber"}>{String(x.STATUS).toLowerCase()}</Pill> <b>{String(x.BRAND_NAME)}</b> at {num(toNum(x.STORES))} stores ({String(x.STATES)})
                <div className="pl-1 text-[11px] text-slate-500">{String(x.REASON)}</div></li>
            ))}
            {s.competitor.map((c, i) => <li key={`c${i}`} className="text-[11px] text-slate-600">{String(c.CATEGORY)}: competitors {num(toNum(c.AVG_GAP_PCT), 1)}% vs our price</li>)}
          </ul>
          <div className="mt-1"><Prov p="MODELLED" /></div>
        </Card>
        <Card title="What parents tell us" subtitle={<>Stated intent and recent spikes. <Link className="text-amber-700 hover:underline" href="/campaigns/voice">Explore the voice</Link></>}>
          <ul className="space-y-1 text-xs">
            {s.intent.map((x, i) => <li key={i}>{INTENT_LABEL[String(x.PURCHASE_INTENT)] ?? String(x.PURCHASE_INTENT)}: <b>{num(toNum(x.CUSTOMERS))}</b> parents said they will buy next</li>)}
            {s.anomalies.map((a, i) => <li key={`a${i}`} className="text-[11px] text-red-700">{String(a.STATE)} · {String(a.THEME)}: {num(toNum(a.NEGATIVE_MENTIONS))} negative mentions (z {num(toNum(a.Z), 1)})</li>)}
          </ul>
          <div className="mt-1 flex gap-1"><Prov p="SYNTHETIC" /><Prov p="AI" /></div>
        </Card>
      </div>

      <Card className="mb-4" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />Generate campaign ideas</span>}
        subtitle="The Campaign Builder agent reads these signals, the voice and past learnings through its tools, then proposes ideas. Each idea's audience is counted again from the data, and guardrails are checked in code, before it reaches the board.">
        <AgentPanel agent="campaignBuilder" tag="ideas" stage="IDEATION" compact
          samples={IDEA_PROMPTS}
          placeholder="Ask for ideas, e.g. four ideas for the June long weekend, or ways to win back lapsed nappy buyers"
          card={(block) => <IdeaPreview ideas={block as IdeaBlock[]} />}
          onFinished={saveRun} />
        {save.busy && <p className="mt-2 text-[11px] text-slate-500"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Sizing each idea's audience and checking guardrails…</p>}
        {msg && <div className="mt-2"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Ideas board</h2>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show accepted and rejected</label>
      </div>
      {ideas.length === 0 ? <Banner>No open ideas. Generate some from the signals above.</Banner> : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {ideas.map((i) => {
            const ev = parse<{ points: string[]; risks: string[] }>(i.EVIDENCE);
            const guards = parse<Guard[]>(i.GUARDRAILS) ?? [];
            const chans = parse<string[]>(i.SUGGESTED_CHANNELS) ?? [];
            const st = String(i.STATUS);
            return (
              <div key={String(i.IDEA_ID)} className={`rounded-xl border bg-white p-4 shadow-sm ${st === "BLOCKED" ? "border-red-200" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{String(i.TITLE)}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Pill tone={SIGNAL_TONE[String(i.SIGNAL_TYPE)] ?? "slate"}>{String(i.SIGNAL_TYPE).toLowerCase().replace("_", " ")}</Pill>
                    <Pill tone={i.PRIORITY === "HIGH" ? "amber" : "slate"}>{String(i.PRIORITY).toLowerCase()}</Pill>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-700">{String(i.HYPOTHESIS)}</p>
                <div className="mt-2 rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                  <div className="font-medium text-slate-900">Audience</div>
                  <div>{String(i.TARGET_DESCRIPTION)}</div>
                  <div className="mt-1 font-mono">{toNum(i.AUDIENCE_SIZE) === null ? "Could not size" : <>{num(toNum(i.AUDIENCE_SIZE))} match · <b>{num(toNum(i.REACHABLE_SIZE))}</b> reachable after consent and suppression</>}</div>
                  <div className="mt-0.5">{chans.map((c) => CHANNEL_LABEL[c as ChannelCode] ?? c).join(", ")}{i.PROMOTED_BRAND ? ` · promotes ${String(i.PROMOTED_BRAND)}` : ""}</div>
                </div>
                {ev?.points?.length ? <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">{ev.points.map((p, k) => <li key={k}>{p}</li>)}</ul> : null}
                {guards.map((g, k) => (
                  <div key={k} className={`mt-2 flex items-start gap-1 rounded px-2 py-1 text-[11px] ${g.level === "BLOCK" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                    <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />{g.message}
                  </div>
                ))}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400"><Verified v={i.IS_VERIFIED} /> {isoDateTime(i.CREATED_AT)}</div>
                  {["NEW", "BLOCKED"].includes(st) ? (
                    <div className="flex gap-1.5">
                      <Button onClick={() => setDeciding({ idea: i, decision: "REJECT" })}><X className="h-3.5 w-3.5" />Reject</Button>
                      <Button variant="primary" onClick={() => setDeciding({ idea: i, decision: "ACCEPT" })}><Check className="h-3.5 w-3.5" />Accept</Button>
                    </div>
                  ) : st === "ACCEPTED" ? (
                    <Link className="text-xs font-medium text-amber-700 hover:underline" href={`/campaigns/audiences?campaign=${String(i.CAMPAIGN_ID)}`}>Accepted · build the audience →</Link>
                  ) : <InfoTip text={String(i.DECISION_REASON ?? "")}><Pill tone="slate">rejected</Pill></InfoTip>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {deciding && <Decide idea={deciding.idea} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}

/** What the agent proposed, while the board saves it. */
function IdeaPreview({ ideas }: { ideas: IdeaBlock[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {ideas.map((i, k) => (
        <div key={k} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold text-slate-900">{i.title}</div>
            {i.signal_type && <Pill tone={SIGNAL_TONE[i.signal_type] ?? "slate"}>{i.signal_type.toLowerCase().replace("_", " ")}</Pill>}
          </div>
          <p className="mt-1 text-[11px] text-slate-600">{i.hypothesis}</p>
          {i.audience?.description && <p className="mt-1 text-[11px] text-slate-500"><b>Who:</b> {i.audience.description}</p>}
        </div>
      ))}
    </div>
  );
}

function Decide({ idea, decision, onClose }: { idea: Row; decision: "ACCEPT" | "REJECT"; onClose: () => void }) {
  const router = useRouter();
  const act = useCmpAction<{ campaignId?: string }>("ideas/decide");
  const [reason, setReason] = useState("");
  const [name, setName] = useState(String(idea.TITLE));
  const [start, setStart] = useState("2026-05-18");
  const [end, setEnd] = useState("2026-06-14");
  const [budget, setBudget] = useState("5000");
  const [err, setErr] = useState<string | null>(null);
  const blocked = idea.STATUS === "BLOCKED";
  const submit = async () => {
    setErr(null);
    const r = await act.run({ ideaId: idea.IDEA_ID, decision, reason, name, startDate: start, endDate: end, budget: Number(budget) });
    if (!r.ok) return setErr(r.error);
    onClose();
    if (decision === "ACCEPT" && r.data.campaignId) router.push(`/campaigns/audiences?campaign=${r.data.campaignId}`);
  };
  return (
    <Modal title={decision === "ACCEPT" ? "Accept as a campaign brief" : "Reject this idea"} subtitle={String(idea.TITLE)} onClose={onClose}>
      <div className="space-y-3">
        {decision === "ACCEPT" && (
          <>
            {blocked && <Banner tone="error">This idea trips a guardrail. Accepting it needs a reason, which goes in the audit trail.</Banner>}
            <Field label="Campaign name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="End"><input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              <Field label="Budget ($)"><input className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
            </div>
          </>
        )}
        {(decision === "REJECT" || blocked) && (
          <Field label="Reason" hint={decision === "REJECT" ? "The next idea run reads this, so it does not suggest the same thing." : undefined}>
            <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={decision === "ACCEPT" ? "primary" : "danger"} onClick={submit} disabled={act.busy}>{act.busy ? "Saving…" : decision === "ACCEPT" ? "Create brief" : "Reject"}</Button>
        </div>
      </div>
    </Modal>
  );
}
