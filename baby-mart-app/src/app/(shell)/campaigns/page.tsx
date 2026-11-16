"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Th, Td, Pill, Button } from "./_components/ui";
import { useCmp, type Row } from "./_components/useCmp";
import { StatusPill, Prov, pp } from "./_components/shared";
import { AS_OF_LABEL } from "@/lib/campaign/config";
import { audM, num } from "@/lib/campaign/format";

type Alert = { campaignId: string; campaignName: string; code: string; severity: string; message: string; status: string };
type Camp = {
  campaignId: string; name: string; status: string; provenance: string; treated: number; holdout: number;
  liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean;
  incMargin: number | null; net: number | null; cost: number; reportedRevenue: number; health: { score: number } | null;
};
type Overview = { asOf: string; campaigns: Camp[]; alerts: Alert[]; learnings: Row[] };

export default function CampaignOverviewPage() {
  const { data, isLoading, error } = useCmp<Overview>("overview");
  if (isLoading) return <Loading what="the campaign overview" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const live = data.campaigns.filter((c) => ["LIVE", "PAUSED"].includes(c.status));
  const measured = data.campaigns.filter((c) => ["COMPLETED", "MEASURED"].includes(c.status) && c.holdout > 0);
  const incMargin = measured.reduce((a, c) => a + (c.incMargin ?? 0), 0);
  const cost = measured.reduce((a, c) => a + c.cost, 0);
  const reported = measured.reduce((a, c) => a + c.reportedRevenue, 0);
  const open = data.alerts.filter((a) => a.status === "OPEN");

  return (
    <div className="p-6">
      <PageHeader title="Campaign & CRM" subtitle={`Lift against a randomised holdout · data to ${AS_OF_LABEL}`}
        right={<Link href="/campaigns/builder"><Button variant="primary"><Bot className="h-3.5 w-3.5" />Build a campaign</Button></Link>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Live campaigns" value={num(live.length)} sub={`${num(open.length)} open alert${open.length === 1 ? "" : "s"}`} subClass={open.length ? "text-red-600" : undefined} />
        <Tile label="Incremental margin" value={audM(incMargin)} emphasis sub={`after ${audM(cost)} cost`}
          hint="Margin caused by completed campaigns: treated members' margin minus the holdout's, net of send and offer cost." />
        <Tile label="Revenue last-touch would claim" value={audM(reported)} sub="most would have happened anyway"
          hint="Everything treated members spent. The holdout shows how little of it the campaigns caused." />
        <Tile label="Campaigns measured" value={num(measured.length)} sub={`${num(measured.filter((c) => c.significant && (c.liftPp ?? 0) > 0).length)} with significant lift`} />
      </div>

      {open.length > 0 && (
        <Card className="mb-4" title={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Needs attention</span>}>
          <ul className="divide-y divide-slate-100">
            {open.map((a) => (
              <li key={a.campaignId + a.code} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0"><Pill tone={a.severity === "HIGH" ? "red" : "amber"}>{a.severity.toLowerCase()}</Pill>{" "}
                  <span className="font-semibold text-slate-900">{a.campaignName}</span> <span className="text-slate-700">{a.message}</span></span>
                <Link href={`/campaigns/performance/${a.campaignId}`} className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-700 hover:underline">Open <ArrowRight className="h-3 w-3" /></Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-4" title="Campaigns vs holdout" subtitle="Bold lift is significant; an interval spanning zero is not proof">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Status</Th><Th align="right">Treated</Th><Th align="right">Lift</Th><Th align="right">95% CI</Th>
              <Th align="right">Net of cost</Th><Th align="right">Health</Th><Th>Source</Th></tr></thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.campaignId} className="border-b border-slate-50 hover:bg-amber-50/40">
                  <Td><Link className="font-medium text-slate-900 hover:text-amber-700" href={c.treated ? `/campaigns/performance/${c.campaignId}` : `/campaigns/audiences?campaign=${c.campaignId}`}>{c.name}</Link></Td>
                  <Td><StatusPill s={c.status} /></Td>
                  <Td align="right" mono>{c.treated ? num(c.treated) : "–"}</Td>
                  <Td align="right" mono className={c.significant ? ((c.liftPp ?? 0) > 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold") : "text-slate-500"}>{c.treated ? pp(c.liftPp, 2) : "–"}</Td>
                  <Td align="right" mono className="text-slate-500">{c.ciLowPp === null ? "–" : `${c.ciLowPp.toFixed(1)} to ${c.ciHighPp!.toFixed(1)}`}</Td>
                  <Td align="right" mono className={(c.net ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}>{c.net === null ? "–" : audM(c.net)}</Td>
                  <Td align="right" mono>{c.health ? c.health.score : "–"}</Td>
                  <Td><Prov p={c.provenance === "APP" ? "SIMULATED" : c.provenance} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.learnings.length > 0 && (
        <Card title="Recent learnings" right={<Link href="/campaigns/learnings" className="text-xs font-medium text-amber-700 hover:underline">All learnings →</Link>}>
          <ul className="space-y-1">{data.learnings.slice(0, 3).map((l) => <li key={String(l.LEARNING_ID)} className="text-xs text-slate-800">{String(l.STATEMENT)}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
