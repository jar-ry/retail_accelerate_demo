"use client";

import { useState } from "react";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Banner, Button, inputCls } from "../_components/ui";
import { useCmp, useCmpAction, type Row } from "../_components/useCmp";
import { num, toNum, isoDateTime, pct } from "@/lib/campaign/format";

export default function CampaignSettingsPage() {
  const { data, isLoading, error } = useCmp<{ settings: Row[]; usage: Row[]; quality: Row | null; enrichCost: Row | null; models: string[] }>("settings");
  const save = useCmpAction("settings");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (isLoading) return <Loading what="settings" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const q = data.quality;
  return (
    <div className="p-6">
      <PageHeader title="Campaign settings" subtitle="Guardrails, alert thresholds and the model. Every change is recorded with who made it." />
      {msg && <div className="mb-3"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}
      <Card className="mb-4" title="Settings">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200"><Th>Setting</Th><Th>Value</Th><Th>What it does</Th><Th>Last changed</Th><Th /></tr></thead>
          <tbody>{data.settings.map((s) => {
            const k = String(s.SETTING_KEY);
            const v = edit[k] ?? String(s.SETTING_VALUE);
            const fixed = k === "AS_OF_DATE";
            return (
              <tr key={k} className="border-b border-slate-50">
                <Td className="font-medium">{String(s.LABEL ?? k)}</Td>
                <Td>{fixed ? <span className="font-mono">{v}</span> : k === "DEFAULT_MODEL"
                  ? <select className={`${inputCls} w-48`} value={v} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}>{data.models.map((m) => <option key={m}>{m}</option>)}</select>
                  : <input className={`${inputCls} w-24`} value={v} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}</Td>
                <Td className="max-w-md whitespace-normal text-slate-600">{String(s.DESCRIPTION ?? "")}{fixed ? " The demo clock: changes only with a data redeploy." : ""}</Td>
                <Td className="text-slate-500">{s.UPDATED_BY ? `${String(s.UPDATED_BY)} · ${isoDateTime(s.UPDATED_AT)}` : "–"}</Td>
                <Td>{!fixed && edit[k] !== undefined && edit[k] !== String(s.SETTING_VALUE) && (
                  <Button variant="primary" disabled={save.busy} onClick={async () => {
                    const r = await save.run({ key: k, value: edit[k] });
                    setMsg(r.ok ? { tone: "ok", text: `${String(s.LABEL ?? k)} saved.` } : { tone: "error", text: r.error });
                    if (r.ok) setEdit((e) => { const n = { ...e }; delete n[k]; return n; });
                  }}>Save</Button>)}</Td>
              </tr>
            );
          })}</tbody>
        </table>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="AI usage" subtitle="Every AI_COMPLETE call the persona makes, from AI_RUN">
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Stage</Th><Th align="right">Runs</Th><Th align="right">Verified</Th><Th align="right">Failed</Th><Th align="right">Tokens</Th><Th>Last</Th></tr></thead>
            <tbody>{data.usage.map((u) => (
              <tr key={String(u.STAGE)} className="border-b border-slate-50"><Td>{String(u.STAGE)}</Td><Td align="right" mono>{num(toNum(u.RUNS))}</Td><Td align="right" mono>{num(toNum(u.VERIFIED))}</Td>
                <Td align="right" mono className={(toNum(u.FAILED) ?? 0) > 0 ? "text-red-600" : ""}>{num(toNum(u.FAILED))}</Td><Td align="right" mono>{num(toNum(u.TOKENS))}</Td><Td className="text-slate-500">{isoDateTime(u.LAST_RUN)}</Td></tr>
            ))}{data.usage.length === 0 && <tr><Td colSpan={6} className="text-slate-500">No AI calls yet.</Td></tr>}</tbody></table>
        </Card>
        <Card title="How well AI reads the voice" subtitle="AI_COMPLETE's reading of each verbatim, compared with the label it was generated from">
          {q ? (
            <table className="w-full text-xs"><tbody>
              {[["Texts compared", num(toNum(q.TEXTS))], ["Theme agreement", pct(toNum(q.THEME_AGREEMENT), 0)], ["Sentiment agreement", pct(toNum(q.SENTIMENT_AGREEMENT), 0)],
                ["Polarity direction", pct(toNum(q.POLARITY_DIRECTION_AGREEMENT), 0)], ["Child stage recall", pct(toNum(q.STAGE_RECALL), 0)], ["Purchase intent recall", pct(toNum(q.INTENT_RECALL), 0)]].map(([l, v]) => (
                <tr key={l} className="border-b border-slate-50"><Td>{l}</Td><Td align="right" mono>{v}</Td></tr>))}
              {data.enrichCost && <tr><Td>Tokens spent</Td><Td align="right" mono>{num((toNum(data.enrichCost.PROMPT_TOKENS) ?? 0) + (toNum(data.enrichCost.COMPLETION_TOKENS) ?? 0))}</Td></tr>}
            </tbody></table>
          ) : <p className="text-xs text-slate-500">Not enriched yet.</p>}
        </Card>
      </div>
    </div>
  );
}
