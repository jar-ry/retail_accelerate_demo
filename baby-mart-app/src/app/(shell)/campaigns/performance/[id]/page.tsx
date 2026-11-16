"use client";

import { use, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FastForward, Pause, Play, Search, Loader2, BookOpen, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Th, Td, Pill, Banner, Button, Modal, Field, inputCls } from "../../_components/ui";
import { useCmp, useCmpAction, parse, type Row } from "../../_components/useCmp";
import { StageStrip, StatusPill, Prov, Verified, PLOT_LAYOUT, PLOT_CONFIG, pp, rate } from "../../_components/shared";
import { audM, aud, num, toNum, isoDate, isoDateTime } from "@/lib/campaign/format";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type LiftRow = { dim: string; value: string; treated: number; holdout: number; treatedRate: number | null; holdoutRate: number | null; liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean };
type Alert = { code: string; severity: string; message: string; action: string; actionKey: string | null; status: string; actionTaken?: string | null; actionedBy?: string | null };
type Detail = {
  campaign: Row; log: Row[]; alerts: Alert[];
  metrics: {
    name: string; status: string; provenance: string; eventProvenance: string | null; start: string | null; end: string | null; through: string | null; elapsedDays: number; windowDays: number | null;
    treated: number; holdout: number; treatedConv: number; holdoutConv: number; treatedRate: number | null; holdoutRate: number | null;
    liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean; incrementalConv: number | null;
    reportedRevenue: number; incRevenue: number | null; incMargin: number | null; cost: number; sendCost: number; offerCost: number; net: number | null; roi: number | null; costPerIncConv: number | null;
    budget: number; spendShare: number | null; sends: number; delivered: number; openers: number; clickers: number; unsubs: number; complaints: number; replies: number; bounces: number;
    unsubRate: number | null; complaintRate: number | null; bounceRate: number | null; stockConflict: number;
  };
  health: { score: number; parts: Record<string, number> } | null;
  liftBy: LiftRow[]; abTest: { a: { n: number; conv: number }; b: { n: number; conv: number }; bMinusAPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean; p: number | null } | null;
  daily: Row[]; replies: Row[]; replySamples: Row[]; negReplyShare: number | null; content: Row[]; plan: Row[]; members: Row[];
};
type Rca = { symptom: string; hypotheses: { hypothesis: string; verdict: string; evidence: string }[]; root_cause: string; confidence: string; actions: { action: string; owner: string; expected_effect: string }[]; learning: string };

export default function CampaignPerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useCmp<Detail>("campaign", { id });
  const sim = useCmpAction<{ through: string; completed: boolean }>("simulate");
  const act = useCmpAction<{ actionTaken: string }>("alerts/action");
  const tr = useCmpAction("transition");
  const pub = useCmpAction<{ published: number }>("learnings/publish");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [days, setDays] = useState("7");
  const [dim, setDim] = useState("Channel");
  const [pausing, setPausing] = useState(false);

  if (isLoading) return <Loading what="the campaign" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const m = data.metrics;
  const c = data.campaign;
  const status = String(c.STATUS);
  const dims = [...new Set(data.liftBy.map((l) => l.dim))];
  const liftRows = data.liftBy.filter((l) => l.dim === dim);
  const live = ["LIVE", "SCHEDULED"].includes(status);

  const done = (r: { ok: true; data: unknown } | { ok: false; error: string }, text: string) => setMsg(r.ok ? { tone: "ok", text } : { tone: "error", text: r.error });
  const fastForward = async () => {
    setMsg(null);
    const r = await sim.run({ campaignId: id, days: Number(days) });
    done(r, r.ok ? `Simulated through ${isoDate(r.data.through)}${r.data.completed ? "; the campaign has reached its end date and is complete. Publish its learnings." : "."}` : "");
  };
  const alertAction = async (a: Alert, action: string) => {
    const r = await act.run({ campaignId: id, code: a.code, action });
    done(r, r.ok ? `${r.data.actionTaken}.${action.startsWith("SUPPRESS") ? " They stay in the treated group for measurement; fast-forward to see the effect." : ""}` : "");
  };
  const publish = async () => {
    const r = await pub.run({ campaignId: id });
    done(r, r.ok ? `Published ${r.data.published} learnings. Ideation and audiences will use them.` : "");
  };

  const t = data.daily.filter((d) => d.GROUP_CODE === "TREATED"), h = data.daily.filter((d) => d.GROUP_CODE === "HOLDOUT");

  return (
    <div className="p-6">
      <PageHeader title={m.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-1.5"><StatusPill s={status} /> {m.start} → {m.end} · data through {m.through ?? "–"} · {String(c.PROMOTED_CATEGORY ?? "")}{c.PROMOTED_BRAND ? ` · ${String(c.PROMOTED_BRAND)}` : ""} · <Prov p={m.eventProvenance ?? (m.provenance === "APP" ? "SIMULATED" : m.provenance)} /></span>}
        right={<>
          {live && <><select className={`${inputCls} w-24`} value={days} onChange={(e) => setDays(e.target.value)}>{["3", "7", "14", "28"].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
            <Button variant="primary" onClick={fastForward} disabled={sim.busy}>{sim.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FastForward className="h-3.5 w-3.5" />}Fast-forward</Button></>}
          {status === "LIVE" && <Button onClick={() => setPausing(true)}><Pause className="h-3.5 w-3.5" />Pause</Button>}
          {status === "PAUSED" && <Button onClick={async () => done(await tr.run({ campaignId: id, to: "LIVE", reason: "Resumed" }), "Resumed.")}><Play className="h-3.5 w-3.5" />Resume</Button>}
          {status === "PAUSED" && <Button onClick={async () => done(await tr.run({ campaignId: id, to: "COMPLETED", reason: "Ended early" }), "Completed.")}>End campaign</Button>}
          {["COMPLETED", "MEASURED"].includes(status) && <Button variant="primary" onClick={publish} disabled={pub.busy}><BookOpen className="h-3.5 w-3.5" />{status === "MEASURED" ? "Re-publish learnings" : "Publish learnings"}</Button>}
        </>} />
      <StageStrip current={4} />
      {sim.busy && <Banner>Simulating sends, opens, clicks, purchases and replies day by day, then reading the replies with AI. About 30 to 60 seconds.</Banner>}
      {msg && <div className="mb-3"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Lift over holdout" value={pp(m.liftPp, 2)} emphasis subClass={m.significant ? ((m.liftPp ?? 0) > 0 ? "text-emerald-700" : "text-red-600") : "text-slate-500"}
          sub={m.ciLowPp === null ? "No holdout yet" : `95% CI ${m.ciLowPp.toFixed(2)} to ${m.ciHighPp!.toFixed(2)}${m.significant ? "" : " · not significant"}`} />
        <Tile label="Conversion" value={rate(m.treatedRate, 2)} sub={`Holdout ${rate(m.holdoutRate, 2)} · ${num(m.treated)} / ${num(m.holdout)}`} />
        <Tile label="Incremental conversions" value={m.incrementalConv === null ? "–" : num(m.incrementalConv)} sub={`Of ${num(m.treatedConv)} a dashboard would claim`} />
        <Tile label="Net incremental margin" value={m.net === null ? "–" : audM(m.net)} subClass={(m.net ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}
          sub={`${audM(m.incMargin)} margin − ${aud(m.cost)} cost`} hint="Margin per treated member minus the holdout's, times treated members, less send and offer cost." />
        <Tile label="ROI" value={m.roi === null ? "–" : `${m.roi.toFixed(1)}×`} sub={m.costPerIncConv === null ? "No incremental conversions" : `${aud(m.costPerIncConv)} per incremental conversion`} />
        <Tile label="Campaign Health" value={data.health ? String(data.health.score) : "–"} sub={data.health ? `Lift ${data.health.parts.lift} · pacing ${data.health.parts.pacing} · delivery ${data.health.parts.deliverability} · replies ${data.health.parts.replies}` : undefined} />
      </div>

      {data.alerts.length > 0 && (
        <Card className="mb-4" title={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Alerts</span>} subtitle="Monitoring rules evaluated on every refresh. Act here; the action and who took it go in the audit trail.">
          <ul className="divide-y divide-slate-100">
            {data.alerts.map((a) => (
              <li key={a.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 text-xs">
                  <div className="flex items-center gap-2"><Pill tone={a.status !== "OPEN" ? "green" : a.severity === "HIGH" ? "red" : "amber"}>{a.status === "OPEN" ? a.severity.toLowerCase() : a.status.toLowerCase()}</Pill><span className="text-slate-800">{a.message}</span></div>
                  <div className="pl-1 text-[11px] text-slate-500">{a.status === "OPEN" ? a.action : `${a.actionTaken} · ${a.actionedBy}`}</div>
                </div>
                {a.status === "OPEN" && (
                  <div className="flex gap-1.5">
                    {a.actionKey === "SUPPRESS_STOCK" && <Button variant="primary" disabled={act.busy} onClick={() => alertAction(a, "SUPPRESS_STOCK")}>Suppress short-store members</Button>}
                    {a.actionKey === "SUPPRESS_GRIEVANCE" && <Button variant="primary" disabled={act.busy} onClick={() => alertAction(a, "SUPPRESS_GRIEVANCE")}>Suppress price complainers</Button>}
                    {a.actionKey === "PAUSE" && status === "LIVE" && <Button variant="danger" disabled={act.busy} onClick={() => alertAction(a, "PAUSE")}><Pause className="h-3.5 w-3.5" />Pause</Button>}
                    {a.actionKey === "INVESTIGATE" && <a href="#investigate"><Button><Search className="h-3.5 w-3.5" />Investigate</Button></a>}
                    <Button variant="ghost" disabled={act.busy} onClick={() => alertAction(a, "DISMISS")}>Dismiss</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Cumulative conversion, treated vs holdout" subtitle="The gap between the lines is the lift. Holdout members were never contacted.">
          <Plot data={[
            { type: "scatter", mode: "lines", name: "Treated", x: t.map((d) => isoDate(d.EVENT_DATE)), y: t.map((d) => (toNum(d.CUM_RATE) ?? 0) * 100), line: { color: "#d97706", width: 2 } },
            { type: "scatter", mode: "lines", name: "Holdout", x: h.map((d) => isoDate(d.EVENT_DATE)), y: h.map((d) => (toNum(d.CUM_RATE) ?? 0) * 100), line: { color: "#64748b", width: 2, dash: "dot" } },
          ]} layout={{ ...PLOT_LAYOUT, height: 260, yaxis: { ticksuffix: "%", gridcolor: "#f1f5f9" } }} config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
        <Card className="xl:col-span-2" title="Funnel and deliverability">
          <table className="w-full text-xs"><tbody>
            {[["Sends", m.sends, null], ["Delivered", m.delivered, null], ["Opened", m.openers, m.delivered], ["Clicked", m.clickers, m.delivered], ["Converted (treated)", m.treatedConv, m.treated],
              ["Bounced", m.bounces, m.sends], ["Unsubscribed", m.unsubs, m.delivered], ["Complained", m.complaints, m.delivered], ["Replied", m.replies, m.delivered]].map(([l, v, d]) => (
              <tr key={String(l)} className="border-b border-slate-50"><Td>{String(l)}</Td><Td align="right" mono>{num(v as number)}</Td><Td align="right" mono className="text-slate-500">{d ? rate((v as number) / (d as number), 2) : ""}</Td></tr>
            ))}
            <tr><Td>Spend</Td><Td align="right" mono>{aud(m.cost)}</Td><Td align="right" mono className="text-slate-500">of {aud(m.budget)}</Td></tr>
          </tbody></table>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Where the lift comes from" subtitle="Lift by group, each with its own holdout. Small groups have wide intervals."
          right={<select className={`${inputCls} w-60`} value={dim} onChange={(e) => setDim(e.target.value)}>{dims.map((d) => <option key={d}>{d}</option>)}</select>}>
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>{dim}</Th><Th align="right">Treated</Th><Th align="right">Holdout</Th><Th align="right">Treated rate</Th><Th align="right">Holdout rate</Th><Th align="right">Lift</Th><Th align="right">95% CI</Th></tr></thead>
            <tbody>{liftRows.map((l) => (
              <tr key={l.value} className="border-b border-slate-50">
                <Td>{l.value}</Td><Td align="right" mono>{num(l.treated)}</Td><Td align="right" mono>{num(l.holdout)}</Td>
                <Td align="right" mono>{rate(l.treatedRate, 2)}</Td><Td align="right" mono className="text-slate-500">{rate(l.holdoutRate, 2)}</Td>
                <Td align="right" mono className={l.significant ? ((l.liftPp ?? 0) > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600") : "text-slate-500"}>{pp(l.liftPp, 2)}</Td>
                <Td align="right" mono className="text-slate-500">{l.ciLowPp === null ? "–" : `${l.ciLowPp.toFixed(1)} to ${l.ciHighPp!.toFixed(1)}`}</Td>
              </tr>))}</tbody></table>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          {data.abTest && (
            <Card title="Creative A/B" subtitle="Treated members split at random between the two variants">
              <div className="text-xs text-slate-800">A {rate(data.abTest.a.conv / data.abTest.a.n, 2)} ({num(data.abTest.a.n)}) · B {rate(data.abTest.b.conv / data.abTest.b.n, 2)} ({num(data.abTest.b.n)})</div>
              <div className="mt-1 text-xs">B − A: <b>{pp(data.abTest.bMinusAPp, 2)}</b> (95% CI {data.abTest.ciLowPp?.toFixed(2)} to {data.abTest.ciHighPp?.toFixed(2)}) · {data.abTest.significant ? <Pill tone="green">winner found</Pill> : <Pill>no winner yet</Pill>}</div>
            </Card>
          )}
          <Card title="Replies" subtitle={data.negReplyShare === null ? "No replies yet" : `${Math.round(data.negReplyShare * 100)}% negative · read by AI_COMPLETE`}>
            <ul className="mb-2 space-y-0.5 text-[11px]">{data.replies.slice(0, 5).map((r, i) => <li key={i}><Pill tone={r.SENTIMENT === "negative" ? "red" : r.SENTIMENT === "positive" ? "green" : "slate"}>{String(r.SENTIMENT)}</Pill> {String(r.THEME)}: {num(toNum(r.N))}</li>)}</ul>
            <ul className="space-y-1">{data.replySamples.slice(0, 4).map((r, i) => <li key={i} className="text-[11px] text-slate-700">“{String(r.VOICE_TEXT)}” <span className="text-slate-400">· {String(r.STATE ?? "")}</span></li>)}</ul>
          </Card>
        </div>
      </div>

      <Investigator id={id} />

      <Card className="mt-4" title="Audit trail">
        <ul className="space-y-1 text-[11px] text-slate-700">{data.log.map((l, i) => (
          <li key={i}>{isoDateTime(l.CHANGED_AT)} · <b>{String(l.CHANGED_BY)}</b> · {String(l.FROM_STATUS ?? "–")} → {String(l.TO_STATUS)}{l.REASON ? ` · ${String(l.REASON)}` : ""}</li>
        ))}</ul>
        <div className="mt-2 text-[11px]"><Link className="text-amber-700 hover:underline" href={`/campaigns/studio/${id}`}>Content and channel plan →</Link></div>
      </Card>

      {pausing && <PauseModal id={id} onClose={() => setPausing(false)} onDone={(t) => setMsg({ tone: "ok", text: t })} />}
    </div>
  );
}

function PauseModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (t: string) => void }) {
  const tr = useCmpAction("transition");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Pause the campaign" onClose={onClose}>
      <Field label="Why" hint="Goes in the audit trail."><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <div className="mt-2"><Banner tone="error">{err}</Banner></div>}
      <div className="mt-3 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={tr.busy} onClick={async () => { const r = await tr.run({ campaignId: id, to: "PAUSED", reason }); if (!r.ok) return setErr(r.error); onDone("Paused."); onClose(); }}>Pause</Button></div>
    </Modal>
  );
}

function Investigator({ id }: { id: string }) {
  const { data } = useCmp<{ latest: Row | null }>("investigation", { id });
  const inv = useCmpAction<{ rca: Rca; verified: boolean | null; unmatched: string[] }>("investigate");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const latest = data?.latest ?? null;
  const rca = parse<Rca>(latest?.RESPONSE);
  const unmatched = parse<string[]>(latest?.UNVERIFIED_FIGURES) ?? [];
  const run = async () => { setErr(null); const r = await inv.run({ campaignId: id, question: q.trim() || null }); if (!r.ok) setErr(r.error); };
  return (
    <div id="investigate">
      <Card title={<span className="inline-flex items-center gap-1.5"><Search className="h-4 w-4 text-amber-600" />Investigate</span>}
        subtitle="Computes lift by every dimension, stock at members' stores, overlapping campaigns, voice anomalies, competitor prices and replies, then has AI_COMPLETE weigh the hypotheses against that evidence."
        right={<Button variant="primary" onClick={run} disabled={inv.busy}>{inv.busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Investigating…</> : rca ? "Re-run" : "Find the root cause"}</Button>}>
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} disabled={inv.busy} placeholder="Optional: e.g. why is lift negative when clicks look fine?" />
        {inv.busy && <p className="mt-2 text-[11px] text-slate-500">Gathering the evidence and testing hypotheses. About 30 seconds.</p>}
        {err && <div className="mt-2"><Banner tone="error">{err}</Banner></div>}
        {rca && (
          <div className="mt-3 space-y-3">
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{rca.symptom}</p><Verified v={latest?.IS_VERIFIED} unmatched={unmatched} /></div>
            <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Hypothesis</Th><Th>Verdict</Th><Th>Evidence</Th></tr></thead>
              <tbody>{rca.hypotheses.map((h, i) => (
                <tr key={i} className="border-b border-slate-50 align-top"><Td className="whitespace-normal font-medium">{h.hypothesis}</Td>
                  <Td>{h.verdict === "CONFIRMED" ? <Pill tone="red"><ShieldAlert className="mr-0.5 inline h-3 w-3" />confirmed</Pill> : h.verdict === "RULED_OUT" ? <Pill tone="slate"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />ruled out</Pill> : <Pill tone="amber">inconclusive</Pill>}</Td>
                  <Td className="whitespace-normal text-slate-600">{h.evidence}</Td></tr>))}</tbody></table>
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-900"><b>Root cause</b> ({rca.confidence.toLowerCase()} confidence): {rca.root_cause}</div>
            <ol className="space-y-1">{rca.actions.map((a, i) => <li key={i} className="text-xs"><Pill tone="amber">{a.owner.toLowerCase()}</Pill> <b>{a.action}</b> <span className="text-slate-500">· {a.expected_effect}</span></li>)}</ol>
            <p className="text-xs text-slate-700"><b>For next time:</b> {rca.learning}</p>
            <p className="text-[10px] text-slate-400">{String(latest?.MODEL)} · {num(toNum(latest?.TOTAL_TOKENS))} tokens · {String(latest?.GENERATED_BY)} {isoDateTime(latest?.GENERATED_AT)}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
