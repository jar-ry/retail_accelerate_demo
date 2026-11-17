"use client";

import Link from "next/link";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Banner } from "../_components/ui";
import { useCmp, type Row } from "../_components/useCmp";
import { StageStrip, StatusPill } from "../_components/shared";
import { aud, isoDate } from "@/lib/campaign/format";

export default function StudioListPage() {
  const { data, isLoading, error } = useCmp<{ campaigns: Row[] }>("studio");
  if (isLoading) return <Loading what="campaigns in progress" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  return (
    <div className="p-6">
      <PageHeader title="Content & channels" subtitle="Copy for every channel written from the brief and the locked audience, checked before anyone sees it, then the channel each member gets." />
      <StageStrip current={3} />
      <Card title="Campaigns in progress">
        {data.campaigns.length === 0 ? <Banner>Nothing in progress. Accept an idea or create a brief, then lock its audience.</Banner> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Status</Th><Th>Window</Th><Th>Promoting</Th><Th align="right">Budget</Th><Th>Next step</Th></tr></thead>
            <tbody>{data.campaigns.map((c) => {
              const s = String(c.STATUS);
              const next = s === "BRIEF" ? { href: `/campaigns/audiences?campaign=${c.CAMPAIGN_ID}`, label: "Build and lock the audience" }
                : s === "AUDIENCE_LOCKED" ? { href: `/campaigns/studio/${c.CAMPAIGN_ID}`, label: "Write and approve content" }
                  : s === "CONTENT_APPROVED" ? { href: `/campaigns/studio/${c.CAMPAIGN_ID}`, label: "Plan channels and launch" }
                    : { href: `/campaigns/performance/${c.CAMPAIGN_ID}`, label: "Fast-forward the campaign" };
              return (
                <tr key={String(c.CAMPAIGN_ID)} className="border-b border-slate-50 hover:bg-amber-50/40">
                  <Td className="font-medium">{String(c.NAME)}</Td><Td><StatusPill s={s} /></Td>
                  <Td className="text-slate-500">{isoDate(c.START_DATE) ?? "–"} → {isoDate(c.END_DATE) ?? "–"}</Td>
                  <Td>{String(c.PROMOTED_CATEGORY ?? "–")}{c.PROMOTED_BRAND ? ` · ${String(c.PROMOTED_BRAND)}` : ""}</Td>
                  <Td align="right" mono>{aud(Number(c.BUDGET_AUD ?? 0))}</Td>
                  <Td><Link className="font-medium text-amber-700 hover:underline" href={next.href}>{next.label} →</Link></Td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
