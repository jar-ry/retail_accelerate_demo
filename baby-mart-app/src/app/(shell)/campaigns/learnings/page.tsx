"use client";

import Link from "next/link";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Pill, Banner } from "../_components/ui";
import { useCmp, type Row } from "../_components/useCmp";
import { StageStrip, InsightPanel, pp, rate } from "../_components/shared";
import { num, toNum, isoDateTime } from "@/lib/campaign/format";

export default function LearningsPage() {
  const { data, isLoading, error } = useCmp<{ learnings: Row[] }>("learnings");
  if (isLoading) return <Loading what="learnings" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  return (
    <div className="p-6">
      <PageHeader title="Learnings" subtitle="What measured campaigns taught us. Each is templated from the treated-vs-holdout numbers, not written by a model, and feeds the next ideas and audiences." />
      <StageStrip current={4} />
      <Card className="mb-4" title="Published learnings">
        {data.learnings.length === 0 ? <Banner>Nothing published yet. Open a completed campaign in <Link className="underline" href="/campaigns/performance">Performance</Link> and publish its learnings.</Banner> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Group</Th><Th align="right">Treated</Th><Th align="right">Holdout</Th><Th align="right">Treated rate</Th><Th align="right">Holdout rate</Th><Th align="right">Lift</Th><Th align="right">95% CI</Th><Th>Finding</Th><Th>Published</Th></tr></thead>
            <tbody>{data.learnings.map((l) => (
              <tr key={String(l.LEARNING_ID)} className="border-b border-slate-50 align-top">
                <Td><Link className="font-medium hover:text-amber-700" href={`/campaigns/performance/${l.CAMPAIGN_ID}`}>{String(l.CAMPAIGN_NAME)}</Link></Td>
                <Td>{String(l.DIMENSION)} = {String(l.DIMENSION_VALUE)}</Td>
                <Td align="right" mono>{num(toNum(l.TREATED_N))}</Td><Td align="right" mono>{num(toNum(l.HOLDOUT_N))}</Td>
                <Td align="right" mono>{rate(l.TREATED_RATE, 2)}</Td><Td align="right" mono className="text-slate-500">{rate(l.HOLDOUT_RATE, 2)}</Td>
                <Td align="right" mono className={l.IS_SIGNIFICANT ? ((toNum(l.LIFT_PP) ?? 0) > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600") : "text-slate-500"}>{pp(l.LIFT_PP, 2)}</Td>
                <Td align="right" mono className="text-slate-500">{toNum(l.CI_LOW_PP)?.toFixed(1)} to {toNum(l.CI_HIGH_PP)?.toFixed(1)}</Td>
                <Td className="max-w-md whitespace-normal">{String(l.STATEMENT)} {l.IS_SIGNIFICANT ? null : <Pill>not significant</Pill>}</Td>
                <Td className="text-slate-500">{String(l.PUBLISHED_BY)} · {isoDateTime(l.PUBLISHED_AT)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <InsightPanel surface="LEARNINGS" placeholder="Optional: e.g. when does SMS beat email for us?" />
    </div>
  );
}
