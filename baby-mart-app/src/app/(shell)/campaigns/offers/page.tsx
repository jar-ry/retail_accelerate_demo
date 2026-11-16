"use client";

import { PageHeader, Card, Loading, ErrorState, Th, Td, Pill } from "../_components/ui";
import { useCmp, type Row } from "../_components/useCmp";
import { StageStrip, Prov } from "../_components/shared";
import { aud, num, toNum } from "@/lib/campaign/format";

export default function OffersPage() {
  const { data, isLoading, error } = useCmp<{ offers: Row[]; channels: Row[]; usage: Row[] }>("offers");
  if (isLoading) return <Loading what="offers" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const use = new Map(data.usage.map((u) => [String(u.OFFER_ID), u]));
  return (
    <div className="p-6">
      <PageHeader title="Offers and channels" subtitle="The offer catalogue the copy may quote (exactly as its terms say), and what each channel costs to send." />
      <StageStrip current={3} />
      <Card className="mb-4" title="Offers" subtitle={<span className="inline-flex items-center gap-1">Terms and costs <Prov p="MODELLED" /></span>}>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200"><Th>Offer</Th><Th>Type</Th><Th>Category</Th><Th>Terms</Th><Th align="right">Cost per redemption</Th><Th>Funded by</Th><Th align="right">Campaigns</Th><Th align="right">Redemptions</Th><Th align="right">Offer cost to date</Th><Th /></tr></thead>
          <tbody>{data.offers.map((o) => {
            const u = use.get(String(o.OFFER_ID));
            return (
              <tr key={String(o.OFFER_ID)} className="border-b border-slate-50 align-top">
                <Td className="font-medium">{String(o.NAME)}<div className="text-[10px] font-normal text-slate-500">{String(o.DESCRIPTION ?? "")}</div></Td>
                <Td><Pill tone="amber">{String(o.OFFER_TYPE)}</Pill></Td><Td>{String(o.CATEGORY ?? "Any")}</Td>
                <Td className="max-w-sm whitespace-normal text-slate-600">{String(o.TERMS ?? "")}</Td>
                <Td align="right" mono>{aud(toNum(o.COST_PER_REDEMPTION), 2)}</Td><Td>{String(o.FUNDED_BY ?? "Baby Mart")}</Td>
                <Td align="right" mono>{num(toNum(u?.CAMPAIGNS) ?? 0)}</Td><Td align="right" mono>{num(toNum(u?.REDEMPTIONS) ?? 0)}</Td><Td align="right" mono>{aud(toNum(u?.OFFER_COST) ?? 0)}</Td>
                <Td>{o.IS_ACTIVE ? <Pill tone="green">active</Pill> : <Pill>inactive</Pill>}</Td>
              </tr>
            );
          })}</tbody>
        </table>
      </Card>
      <Card title="Channels">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200"><Th>Channel</Th><Th align="right">Cost per send</Th><Th align="right">Max characters</Th><Th>Needs consent</Th><Th>Notes</Th></tr></thead>
          <tbody>{data.channels.map((c) => (
            <tr key={String(c.CHANNEL_CODE)} className="border-b border-slate-50"><Td className="font-medium">{String(c.LABEL)}</Td><Td align="right" mono>{aud(toNum(c.COST_PER_SEND_AUD), 3)}</Td>
              <Td align="right" mono>{toNum(c.MAX_CHARS) === null ? "–" : num(toNum(c.MAX_CHARS))}</Td><Td>{c.CONSENT_COLUMN ? String(c.CONSENT_COLUMN) : "No"}</Td><Td className="whitespace-normal text-slate-600">{String(c.DESCRIPTION ?? "")}</Td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
