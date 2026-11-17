"use client";

import { useState } from "react";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Banner, Button, inputCls } from "../_components/ui";
import { useCmp, useCmpAction, type Row } from "../_components/useCmp";
import { num, toNum, isoDateTime } from "@/lib/campaign/format";

export default function CampaignSettingsPage() {
  const { data, isLoading, error } = useCmp<{ settings: Row[]; usage: Row[]; models: string[] }>("settings");
  const save = useCmpAction("settings");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (isLoading) return <Loading what="settings" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
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
      <div>
        <Card title="AI usage" subtitle="Every AI run the persona makes, from AI_RUN: the campaign agents (ideas, builder, investigations) and AI_COMPLETE (copy, audience requests)">
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Stage</Th><Th>Engine</Th><Th align="right">Runs</Th><Th align="right">Verified</Th><Th align="right">Failed</Th><Th align="right">Tokens</Th><Th>Last</Th></tr></thead>
            <tbody>{data.usage.map((u) => (
              <tr key={`${String(u.STAGE)}-${String(u.ENGINE)}`} className="border-b border-slate-50"><Td>{String(u.STAGE)}</Td><Td className="text-slate-600">{String(u.ENGINE)}</Td><Td align="right" mono>{num(toNum(u.RUNS))}</Td><Td align="right" mono>{num(toNum(u.VERIFIED))}</Td>
                <Td align="right" mono className={(toNum(u.FAILED) ?? 0) > 0 ? "text-red-600" : ""}>{num(toNum(u.FAILED))}</Td><Td align="right" mono>{toNum(u.TOKENS) === null ? "–" : num(toNum(u.TOKENS))}</Td><Td className="text-slate-500">{isoDateTime(u.LAST_RUN)}</Td></tr>
            ))}{data.usage.length === 0 && <tr><Td colSpan={7} className="text-slate-500">No AI runs yet.</Td></tr>}</tbody></table>
        </Card>
      </div>
    </div>
  );
}
