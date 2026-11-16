"use client";

import Link from "next/link";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Pill } from "../_components/ui";
import { useCmp } from "../_components/useCmp";
import { StageStrip, StatusPill, Prov, InsightPanel, pp, rate } from "../_components/shared";
import { audM, num } from "@/lib/campaign/format";

type Camp = {
  campaignId: string; name: string; status: string; provenance: string; start: string | null; end: string | null; treated: number; holdout: number;
  treatedRate: number | null; holdoutRate: number | null; liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean;
  incrementalConv: number | null; treatedConv: number; incMargin: number | null; cost: number; net: number | null; roi: number | null;
  health: { score: number } | null; alerts: { status: string }[];
};

export default function PerformancePage() {
  const { data, isLoading, error } = useCmp<{ campaigns: Camp[]; asOf: string }>("campaigns");
  if (isLoading) return <Loading what="campaign performance" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const rows = data.campaigns.filter((c) => c.treated > 0);
  return (
    <div className="p-6">
      <PageHeader title="Performance" subtitle="Every campaign judged on what it caused: treated against a randomised holdout, net of send and offer cost." />
      <StageStrip current={4} />
      <Card className="mb-4" title="Campaigns" subtitle="Reported conversions are what a last-touch dashboard shows; incremental are the ones the campaign caused.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Status</Th><Th>Window</Th><Th align="right">Treated / holdout</Th><Th align="right">Conv. rate</Th>
              <Th align="right">Holdout rate</Th><Th align="right">Lift</Th><Th align="right">Reported conv.</Th><Th align="right">Incremental</Th><Th align="right">Net</Th><Th align="right">ROI</Th><Th align="right">Health</Th><Th>Alerts</Th><Th>Data</Th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const open = c.alerts.filter((a) => a.status === "OPEN").length;
                return (
                  <tr key={c.campaignId} className="border-b border-slate-50 hover:bg-amber-50/40">
                    <Td><Link className="font-medium text-slate-900 hover:text-amber-700" href={`/campaigns/performance/${c.campaignId}`}>{c.name}</Link></Td>
                    <Td><StatusPill s={c.status} /></Td>
                    <Td className="text-slate-500">{c.start} → {c.end}</Td>
                    <Td align="right" mono>{num(c.treated)} / {num(c.holdout)}</Td>
                    <Td align="right" mono>{rate(c.treatedRate, 2)}</Td>
                    <Td align="right" mono className="text-slate-500">{rate(c.holdoutRate, 2)}</Td>
                    <Td align="right" mono className={c.significant ? ((c.liftPp ?? 0) > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600") : "text-slate-500"}
                      title={c.ciLowPp === null ? "" : `95% CI ${c.ciLowPp.toFixed(2)} to ${c.ciHighPp!.toFixed(2)} pts`}>{pp(c.liftPp, 2)}{c.significant ? "" : " ·ns"}</Td>
                    <Td align="right" mono className="text-slate-500">{num(c.treatedConv)}</Td>
                    <Td align="right" mono>{c.incrementalConv === null ? "–" : num(c.incrementalConv)}</Td>
                    <Td align="right" mono className={(c.net ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}>{c.net === null ? "–" : audM(c.net)}</Td>
                    <Td align="right" mono>{c.roi === null ? "–" : `${c.roi.toFixed(1)}×`}</Td>
                    <Td align="right" mono>{c.health?.score ?? "–"}</Td>
                    <Td>{open ? <Pill tone="red">{open} open</Pill> : <span className="text-slate-300">–</span>}</Td>
                    <Td><Prov p={c.provenance === "APP" ? "SIMULATED" : c.provenance} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">·ns: the 95% interval spans zero, so the campaign has not shown it caused anything. ROI is net incremental margin over cost.</p>
      </Card>
      <InsightPanel surface="PERFORMANCE" placeholder="Optional: e.g. which campaigns would I cut if the budget halved?" />
    </div>
  );
}
