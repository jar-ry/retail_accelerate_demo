"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Th, Td, Pill, Banner } from "./_components/ui";
import { useCmp, type Row } from "./_components/useCmp";
import { StageStrip, StatusPill, Prov, FindingsPanel, PLOT_LAYOUT, PLOT_CONFIG, pp, rate } from "./_components/shared";
import { AS_OF_LABEL, STAGES, STAGE_OF, type Status } from "@/lib/campaign/config";
import { audM, num, toNum } from "@/lib/campaign/format";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Alert = { campaignId: string; campaignName: string; code: string; severity: string; message: string; action: string; status: string; actionTaken?: string | null };
type Camp = {
  campaignId: string; name: string; status: string; provenance: string; start: string | null; treated: number; holdout: number;
  liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean; incrementalConv: number | null;
  incMargin: number | null; net: number | null; cost: number; roi: number | null; reportedRevenue: number; treatedConv: number;
  health: { score: number } | null; alerts: Alert[]; unsubRate: number | null;
};
type Overview = {
  asOf: string; pipeline: Row[]; campaigns: Camp[]; alerts: Alert[]; voice: Row; anomalies: Row[];
  npsWeekly: { week: string; responses: number; nps: number | null }[]; learnings: Row[];
};

export default function CampaignOverviewPage() {
  const { data, isLoading, error } = useCmp<Overview>("overview");
  if (isLoading) return <Loading what="the campaign command centre" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const live = data.campaigns.filter((c) => ["LIVE", "PAUSED"].includes(c.status));
  const measured = data.campaigns.filter((c) => ["COMPLETED", "MEASURED"].includes(c.status) && c.holdout > 0);
  const incMargin = measured.reduce((a, c) => a + (c.incMargin ?? 0), 0);
  const cost = measured.reduce((a, c) => a + c.cost, 0);
  const reported = measured.reduce((a, c) => a + c.reportedRevenue, 0);
  const open = data.alerts.filter((a) => a.status === "OPEN");
  const byStage = [1, 2, 3, 4].map((s) => data.pipeline.filter((p) => STAGE_OF[String(p.STATUS) as Status] === s).reduce((a, p) => a + Number(p.N), 0));
  const v = data.voice;

  return (
    <div className="p-6">
      <PageHeader title="Campaign & CRM"
        subtitle={<>From signal to measured lift, on Baby Mart's own customers. Data as of {AS_OF_LABEL}. Lift is always against a randomised holdout.</>} />
      <StageStrip />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Live campaigns" value={num(live.length)} sub={`${num(open.length)} open alert${open.length === 1 ? "" : "s"}`} subClass={open.length ? "text-red-600" : undefined} />
        <Tile label="Incremental margin, measured" value={audM(incMargin)} emphasis
          sub={`After ${audM(cost)} send and offer cost`} hint="Treated margin per member minus the holdout's, times treated members, across completed campaigns." />
        <Tile label="Revenue a dashboard would claim" value={audM(reported)} sub="Every treated conversion, caused or not"
          hint="Last-touch attribution: what treated members spent. Most of it would have happened anyway; the holdout says how much." />
        <Tile label="NPS, last 28 days" value={toNum(v.NPS_28D) === null ? "–" : num(toNum(v.NPS_28D), 1)}
          sub={toNum(v.NPS_PRIOR_8W) === null ? undefined : `Prior 8 weeks ${num(toNum(v.NPS_PRIOR_8W), 1)}`} hint="Synthetic surveys built on real purchases." />
        <Tile label="Pipeline" value={byStage.map((x) => x).join(" · ")} sub={STAGES.map((s) => s.label.split(" ")[0]).join(" · ")} />
      </div>

      {open.length > 0 && (
        <Card className="mb-4" title={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Needs attention</span>}
          subtitle="Monitoring rules evaluated against every live campaign. Each says what to do; act on it from the campaign.">
          <ul className="divide-y divide-slate-100">
            {open.map((a) => (
              <li key={a.campaignId + a.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs"><Pill tone={a.severity === "HIGH" ? "red" : "amber"}>{a.severity.toLowerCase()}</Pill>
                    <span className="font-semibold text-slate-900">{a.campaignName}</span><span className="text-slate-700">{a.message}</span></div>
                  <div className="pl-1 text-[11px] text-slate-500">{a.action}</div>
                </div>
                <Link href={`/campaigns/performance/${a.campaignId}`} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">Open <ArrowRight className="h-3 w-3" /></Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Every campaign, measured against its holdout"
          subtitle="Lift is treated minus holdout conversion, with its 95% interval. A lift whose interval spans zero is not proof.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Status</Th><Th align="right">Treated</Th><Th align="right">Lift</Th><Th align="right">95% CI</Th>
                <Th align="right">Inc. margin</Th><Th align="right">Net of cost</Th><Th align="right">Health</Th><Th>Source</Th></tr></thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.campaignId} className="border-b border-slate-50 hover:bg-amber-50/40">
                    <Td><Link className="font-medium text-slate-900 hover:text-amber-700" href={c.treated ? `/campaigns/performance/${c.campaignId}` : `/campaigns/audiences?campaign=${c.campaignId}`}>{c.name}</Link></Td>
                    <Td><StatusPill s={c.status} /></Td>
                    <Td align="right" mono>{c.treated ? num(c.treated) : "–"}</Td>
                    <Td align="right" mono className={c.significant ? ((c.liftPp ?? 0) > 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold") : "text-slate-500"}>{c.treated ? pp(c.liftPp, 2) : "–"}</Td>
                    <Td align="right" mono className="text-slate-500">{c.ciLowPp === null ? "–" : `${c.ciLowPp.toFixed(1)} to ${c.ciHighPp!.toFixed(1)}`}</Td>
                    <Td align="right" mono>{c.incMargin === null ? "–" : audM(c.incMargin)}</Td>
                    <Td align="right" mono className={(c.net ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}>{c.net === null ? "–" : audM(c.net)}</Td>
                    <Td align="right" mono>{c.health ? c.health.score : "–"}</Td>
                    <Td><Prov p={c.provenance === "APP" ? "SIMULATED" : c.provenance} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Customer voice pulse" subtitle={<>National NPS by week, and what is unusual right now. <Link href="/campaigns/voice" className="text-amber-700 hover:underline">Explore</Link></>}>
          <Plot
            data={[{ type: "scatter", mode: "lines", x: data.npsWeekly.map((w) => w.week), y: data.npsWeekly.map((w) => w.nps), line: { color: "#d97706", width: 2 }, name: "NPS" }]}
            layout={{ ...PLOT_LAYOUT, height: 170, showlegend: false, margin: { l: 32, r: 8, t: 6, b: 26 } }} config={PLOT_CONFIG} style={{ width: "100%" }} />
          <ul className="mt-2 space-y-1">
            {data.anomalies.slice(0, 4).map((a, i) => (
              <li key={i} className="text-[11px] text-slate-700"><Pill tone="red">{String(a.STATE)}</Pill> {String(a.THEME)}: {num(toNum(a.NEGATIVE_MENTIONS))} negative mentions, z {num(toNum(a.Z), 1)}</li>
            ))}
            {data.anomalies.length === 0 && <li className="text-[11px] text-slate-500">No unusual themes in the last six weeks.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FindingsPanel surface="OVERVIEW" ask="Which live campaign should I worry about first, and what campaign should I run next?" />
        <Card title="What past campaigns taught us" subtitle={<>Published learnings, reused by ideation and audiences. <Link href="/campaigns/learnings" className="text-amber-700 hover:underline">All learnings</Link></>}>
          {data.learnings.length === 0
            ? <Banner>No learnings published yet. Open a measured campaign and publish what it taught.</Banner>
            : <ul className="space-y-1.5">{data.learnings.map((l) => <li key={String(l.LEARNING_ID)} className="text-xs text-slate-800">{String(l.STATEMENT)}</li>)}</ul>}
        </Card>
      </div>
      <p className="mt-4 text-[10px] text-slate-400">Live-campaign unsubscribe rates: {live.map((c) => `${c.name} ${rate(c.unsubRate, 2)}`).join(" · ") || "none live"}.</p>
    </div>
  );
}
