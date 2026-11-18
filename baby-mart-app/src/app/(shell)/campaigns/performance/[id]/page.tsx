"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { FastForward, Pause, Play, Search, Loader2, BookOpen, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Th, Td, Pill, Banner, Button, Modal, Field, inputCls } from "../../_components/ui";
import { useCmp, useCmpAction, parse, type Row } from "../../_components/useCmp";
import { StageStrip, StatusPill, Prov, Verified, PLOT_LAYOUT, PLOT_CONFIG, pp, rate } from "../../_components/shared";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { ProgressTrail } from "@/components/agent/ProgressTrail";
import { AgentAnswer } from "@/components/agent/AgentCards";
import type { Turn } from "@/components/agent/useAgentRun";
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

export default function CampaignPerformancePage() {
  // Next 14 passes params as a plain object, which React 18 use() rejects.
  const id = String(useParams<{ id: string }>().id);
  const { data, isLoading, error } = useCmp<Detail>("campaign", { id });
  const sim = useCmpAction<{ through: string; completed: boolean }>("simulate");
  const act = useCmpAction<{ actionTaken: string }>("alerts/action");
  const tr = useCmpAction("transition");
  const pub = useCmpAction<{ published: number }>("learnings/publish");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [investigate, setInvestigate] = useState(0);
  // ?investigate=1 (the headline findings' link) starts an investigation on arrival.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("investigate")) setInvestigate(Date.now()); }, []);
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
                    {/* The other way out: get the stock back. An approved recovery plan lifts the
                        stores from SHORT, which clears this alert (it reads the live supply position). */}
                    {a.actionKey === "SUPPRESS_STOCK" && (
                      <a href={`/replenishment/recovery?q=${encodeURIComponent(`${String(c.PROMOTED_BRAND ?? "")} ${String(c.PROMOTED_CLASS ?? "")} is short and blocking campaign ${id}. Get it back on shelf.`.replace(/\s+/g, " ").trim())}`}>
                        <Button>Ask Supply to recover stock</Button>
                      </a>
                    )}
                    {a.actionKey === "SUPPRESS_GRIEVANCE" && <Button variant="primary" disabled={act.busy} onClick={() => alertAction(a, "SUPPRESS_GRIEVANCE")}>Suppress price complainers</Button>}
                    {a.actionKey === "PAUSE" && status === "LIVE" && <Button variant="danger" disabled={act.busy} onClick={() => alertAction(a, "PAUSE")}><Pause className="h-3.5 w-3.5" />Pause</Button>}
                    {a.actionKey === "INVESTIGATE" && <a href="#investigate"><Button onClick={() => setInvestigate(Date.now())}><Search className="h-3.5 w-3.5" />Investigate</Button></a>}
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
        </div>
      </div>

      <Investigator id={id} name={data.metrics.name} start={investigate} />

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

/** The investigation: CAMPAIGN_INVESTIGATOR_AGENT with its progress trail. The
 *  last logged run shows until a new one is asked for; an alert's Investigate
 *  button starts one. */
function Investigator({ id, name, start }: { id: string; name: string; start: number }) {
  const { data } = useCmp<{ latest: Row | null }>("investigation", { id });
  const latest = data?.latest ?? null;
  const resp = parse<{ text?: string; block?: unknown; steps?: { name: string; type: string; input: unknown; status: string | null }[] }>(latest?.RESPONSE);
  const [asking, setAsking] = useState<{ q: string; n: number } | null>(null);
  const question = `Why is the ${name} campaign (${id}) performing the way it is against its holdout?`;
  useEffect(() => { if (start > 0) setAsking({ q: question, n: start }); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved: Turn | null = latest && resp?.text ? {
    question: String(latest.QUESTION ?? question), text: resp.text, charts: [], done: true, startedAt: 0,
    steps: (resp.steps ?? []).map((x, i) => ({ id: String(i), name: x.name, toolType: x.type, input: x.input, status: x.status === "success" ? "success" : "error", startedAt: 0 })),
    run: { runId: String(latest.RUN_ID), verified: latest.IS_VERIFIED === null || latest.IS_VERIFIED === undefined ? null : latest.IS_VERIFIED === true,
      unmatched: parse<string[]>(latest.UNVERIFIED_FIGURES) ?? [], hasBlock: !!resp.block },
  } : null;
  return (
    <div id="investigate">
      <Card title={<span className="inline-flex items-center gap-1.5"><Search className="h-4 w-4 text-amber-600" />Investigate</span>}
        subtitle="The Campaign Investigator agent pulls this campaign's evidence, tests each hypothesis (stock, price, channel, targeting, fatigue) against the holdout, quotes what customers said, and names the root cause. Every figure is checked against what its tools returned."
        right={!asking && <Button variant="primary" onClick={() => setAsking({ q: question, n: Date.now() })}>{saved ? "Re-run" : "Find the root cause"}</Button>}>
        {asking ? (
          <AgentPanel key={asking.n} agent="campaignInvestigator" tag="rca" stage="INVESTIGATE" campaignId={id} autoAsk={asking.q} compact
            placeholder="Ask a follow-up, e.g. which states should we restart in?" />
        ) : saved ? (
          <div className="space-y-3">
            <p className="text-[10px] text-slate-400">Last run {isoDateTime(latest?.GENERATED_AT)} by {String(latest?.GENERATED_BY)} · {String(latest?.MODEL).replace("agent:", "")}</p>
            <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
              <div className="h-fit"><ProgressTrail t={saved} compact /></div>
              <AgentAnswer t={saved} tag="rca" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No investigation yet. It takes about a minute: the steps appear as the agent works.</p>
        )}
      </Card>
    </div>
  );
}
