"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Sparkles, Loader2, CheckCircle2, XCircle, Rocket, Route, Pencil, Mail, MessageSquare, Bell, Share2, Store } from "lucide-react";
import { PageHeader, Card, Loading, ErrorState, Th, Td, Pill, Banner, Button, Modal, Field, inputCls } from "../../_components/ui";
import { useCmp, useCmpAction, parse, type Row } from "../../_components/useCmp";
import { StageStrip, StatusPill, Prov } from "../../_components/shared";
import { CHANNEL_LABEL, SMS_MAX, SUBJECT_MAX, PUSH_TITLE_MAX, PUSH_BODY_MAX, SOCIAL_MAX, INSTORE_MAX, type ChannelCode } from "@/lib/campaign/config";
import type { Gate } from "@/lib/campaign/state";
import { aud, num, toNum } from "@/lib/campaign/format";

type Studio = { camp: Row; members: Row[]; comp: Row[]; products: Row[]; praise: Row[]; variants: Row[]; plan: Row[]; channels: Row[]; offers: Row[]; gates: Gate[] };
type Check = { check: string; result: "PASS" | "WARN" | "BLOCK"; detail: string };
type Qa = { checks: Check[]; judge: { brand_voice: number; claims_risk: string; tone_fit: number; notes: string } | null };

const QA_TONE: Record<string, "green" | "amber" | "red"> = { PASS: "green", WARN: "amber", BLOCK: "red" };

export default function StudioPage() {
  // Next 14 passes params as a plain object, which React 18 use() rejects.
  const id = String(useParams<{ id: string }>().id);
  const router = useRouter();
  const { data, isLoading, error } = useCmp<Studio>("studio", { id });
  const gen = useCmpAction("studio/generate");
  const approve = useCmpAction("studio/approve");
  const plan = useCmpAction<{ plan: { byChannel: { channel: string; members: number; cost: number; incConv: number; incMargin: number }[] } }>("studio/plan");
  const launch = useCmpAction("studio/launch");
  const [direction, setDirection] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  if (isLoading) return <Loading what="the studio" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const c = data.camp;
  const s = String(c.STATUS);
  const treated = data.members.filter((m) => m.GROUP_CODE === "TREATED").reduce((a, m) => a + Number(m.N), 0);
  const holdout = data.members.filter((m) => m.GROUP_CODE === "HOLDOUT").reduce((a, m) => a + Number(m.N), 0);
  const chans = parse<string[]>(c.CHANNELS) ?? [];
  const r = (x: { ok: boolean; error?: string }, ok: string) => setMsg(x.ok ? { tone: "ok", text: ok } : { tone: "error", text: (x as { error: string }).error });

  if (s === "BRIEF") return (
    <div className="p-6"><PageHeader title={String(c.NAME)} /><StageStrip current={3} />
      <Banner tone="warn">The audience is not locked yet. <Link className="font-medium underline" href={`/campaigns/audiences?campaign=${id}`}>Build and lock it</Link> first: the copy is written for the people in it.</Banner></div>
  );

  return (
    <div className="p-6">
      <PageHeader title={String(c.NAME)}
        subtitle={<span className="inline-flex flex-wrap items-center gap-1.5"><StatusPill s={s} /> {num(treated)} to contact · {num(holdout)} held out · {chans.map((x) => CHANNEL_LABEL[x as ChannelCode] ?? x).join(", ")} · {String(c.PROMOTED_CATEGORY ?? "")}{c.PROMOTED_BRAND ? ` · ${String(c.PROMOTED_BRAND)}` : ""}{c.OFFER_NAME ? ` · ${String(c.OFFER_NAME)}` : " · no offer"}</span>}
        right={["SCHEDULED", "LIVE", "PAUSED", "COMPLETED", "MEASURED"].includes(s) ? <Link href={`/campaigns/performance/${id}`}><Button variant="primary">Performance →</Button></Link> : null} />
      <StageStrip current={3} />
      {msg && <div className="mb-3"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}

      <Card className="mb-4" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />Creative</span>}
        subtitle="AI_COMPLETE writes two variants for every channel from the brief, the audience mix, in-stock products at catalogue prices, the offer's exact terms and customers' own words. Then QA: length, banned claims and every number traced, plus a model judge for brand voice."
        right={s === "AUDIENCE_LOCKED" ? <Button variant="primary" disabled={gen.busy} onClick={async () => { setMsg(null); r(await gen.run({ campaignId: id, direction: direction.trim() || null }), "Two variants written and checked."); }}>
          {gen.busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Writing…</> : data.variants.length ? "Rewrite" : "Write the copy"}</Button> : null}>
        {s === "AUDIENCE_LOCKED" && <input className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value)} disabled={gen.busy} placeholder="Optional direction, e.g. lead with uploading the booklist, keep it warm and practical" />}
        {gen.busy && <p className="mt-2 text-[11px] text-slate-500">Writing two variants, then checking each. About 40 seconds.</p>}
        {data.variants.length === 0 ? <p className="mt-3 text-xs text-slate-500">No copy yet.</p> : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {data.variants.map((v) => {
              const qa = parse<Qa>(v.QA);
              return (
                <div key={String(v.VARIANT_ID)} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900">Variant {String(v.VARIANT_CODE)} · <span className="font-normal text-slate-600">{String(v.ANGLE)}</span></div>
                    <div className="flex items-center gap-1"><Pill tone={QA_TONE[String(v.QA_STATUS)] ?? "slate"}>QA {String(v.QA_STATUS).toLowerCase()}</Pill><Pill tone={v.STATUS === "APPROVED" ? "green" : "slate"}>{String(v.STATUS).toLowerCase()}</Pill>
                      {s === "AUDIENCE_LOCKED" && <button className="text-slate-400 hover:text-amber-700" onClick={() => setEditing(v)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}</div>
                  </div>
                  <Preview icon={<Mail className="h-3 w-3" />} label="Email">
                    <div className="font-semibold">{String(v.SUBJECT)}</div><div className="text-[10px] text-slate-500">{String(v.PREHEADER)}</div>
                    <div className="mt-1 whitespace-pre-line">{String(v.BODY)}</div><div className="mt-1 inline-block rounded bg-amber-600 px-2 py-0.5 text-[10px] font-semibold text-white">{String(v.CTA)}</div>
                  </Preview>
                  <Preview icon={<MessageSquare className="h-3 w-3" />} label={`SMS · ${String(v.SMS_TEXT ?? "").length}/${SMS_MAX}`}>{String(v.SMS_TEXT)}</Preview>
                  <Preview icon={<Bell className="h-3 w-3" />} label="Push"><b>{String(v.PUSH_TITLE)}</b> {String(v.PUSH_BODY)}</Preview>
                  <Preview icon={<Share2 className="h-3 w-3" />} label="Paid social">{String(v.SOCIAL_TEXT)}</Preview>
                  <Preview icon={<Store className="h-3 w-3" />} label="In-store screen">{String(v.INSTORE_TEXT)}</Preview>
                  {qa && (
                    <div className="mt-2 rounded-md bg-slate-50 p-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">QA scorecard</div>
                      <ul className="space-y-0.5 text-[11px]">{qa.checks.map((k, i) => (
                        <li key={i} className="flex items-start gap-1">{k.result === "PASS" ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <XCircle className={`mt-0.5 h-3 w-3 shrink-0 ${k.result === "BLOCK" ? "text-red-600" : "text-amber-500"}`} />}
                          <span>{k.check}: <span className="text-slate-500">{k.detail}</span></span></li>))}</ul>
                      {qa.judge ? <p className="mt-1 text-[11px] text-slate-700"><Prov p="AI" /> Brand voice {qa.judge.brand_voice}/5 · tone fit {qa.judge.tone_fit}/5 · claims risk {qa.judge.claims_risk.toLowerCase()} · {qa.judge.notes}</p>
                        : <p className="mt-1 text-[11px] text-slate-400">The model judge has not scored this variant.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {s === "AUDIENCE_LOCKED" && data.variants.length > 0 && (
          <div className="mt-3 flex justify-end"><Button variant="primary" disabled={approve.busy || data.variants.some((v) => v.QA_STATUS === "BLOCK")}
            title={data.variants.some((v) => v.QA_STATUS === "BLOCK") ? "A variant is blocked by QA" : undefined}
            onClick={async () => r(await approve.run({ campaignId: id }), "Content approved. Plan the channels next.")}><CheckCircle2 className="h-3.5 w-3.5" />Approve content</Button></div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-1.5"><Route className="h-4 w-4 text-amber-600" />Channel plan</span>}
          subtitle="Each group of members gets the channel with the highest expected incremental margin after cost, using lift by channel from past campaigns, within the budget."
          right={["AUDIENCE_LOCKED", "CONTENT_APPROVED"].includes(s) ? <Button disabled={plan.busy} onClick={async () => r(await plan.run({ campaignId: id }), "Channel plan saved; members moved to their planned channel.")}>
            {plan.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{data.plan.length ? "Re-plan" : "Plan channels"}</Button> : null}>
          {data.plan.length === 0 ? <p className="text-xs text-slate-500">No plan yet.</p> : (
            <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Channel</Th><Th align="right">Members</Th><Th align="right">Cost</Th><Th align="right">Exp. inc. conv.</Th><Th align="right">Exp. inc. margin</Th><Th>When</Th></tr></thead>
              <tbody>{data.plan.map((p) => (
                <tr key={String(p.CHANNEL_CODE)} className="border-b border-slate-50"><Td>{CHANNEL_LABEL[p.CHANNEL_CODE as ChannelCode] ?? String(p.CHANNEL_CODE)}</Td><Td align="right" mono>{num(toNum(p.MEMBERS))}</Td>
                  <Td align="right" mono>{aud(toNum(p.COST_AUD))}</Td><Td align="right" mono>{num(toNum(p.EXP_INC_CONV), 1)}</Td><Td align="right" mono>{aud(toNum(p.EXP_INC_MARGIN_AUD))}</Td><Td>{String(p.SEND_DAY)} {String(p.SEND_HOUR)}:00</Td></tr>))}
                <tr className="font-semibold"><Td>Total</Td><Td align="right" mono>{num(data.plan.reduce((a, p) => a + Number(p.MEMBERS), 0))}</Td><Td align="right" mono>{aud(data.plan.reduce((a, p) => a + Number(p.COST_AUD), 0))}</Td>
                  <Td align="right" mono>{num(data.plan.reduce((a, p) => a + Number(p.EXP_INC_CONV), 0), 1)}</Td><Td align="right" mono>{aud(data.plan.reduce((a, p) => a + Number(p.EXP_INC_MARGIN_AUD), 0))}</Td><Td /></tr>
              </tbody></table>
          )}
          <p className="mt-2 text-[10px] text-slate-500"><Prov p="MODELLED" /> Expected figures come from past campaigns' lift; the holdout measures what actually happens.</p>
        </Card>

        <Card title={<span className="inline-flex items-center gap-1.5"><Rocket className="h-4 w-4 text-amber-600" />Launch</span>} subtitle="Every gate must pass. Launching schedules the sends (to Braze, simulated here).">
          <ul className="space-y-1.5">{data.gates.map((g) => (
            <li key={g.key} className="flex items-start gap-2 text-xs">{g.pass ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 text-red-500" />}
              <div><div className="font-medium text-slate-900">{g.label}</div><div className="text-[11px] text-slate-500">{g.detail}</div></div></li>))}</ul>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={launch.busy || s !== "CONTENT_APPROVED" || data.gates.some((g) => !g.pass)}
              onClick={async () => { const x = await launch.run({ campaignId: id }); r(x, "Scheduled."); if (x.ok) router.push(`/campaigns/performance/${id}`); }}>
              <Rocket className="h-3.5 w-3.5" />Launch</Button>
          </div>
        </Card>
      </div>

      {editing && <EditVariant v={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Preview({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 rounded-md border border-slate-100 p-2 text-[11px] text-slate-800">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400">{icon}{label}</div>{children}
    </div>
  );
}

const EDITS: { key: string; col: string; label: string; max?: number; rows?: number }[] = [
  { key: "subject", col: "SUBJECT", label: "Email subject", max: SUBJECT_MAX }, { key: "preheader", col: "PREHEADER", label: "Preheader" },
  { key: "body", col: "BODY", label: "Email body", rows: 6 }, { key: "sms", col: "SMS_TEXT", label: "SMS", max: SMS_MAX, rows: 2 },
  { key: "push_title", col: "PUSH_TITLE", label: "Push title", max: PUSH_TITLE_MAX }, { key: "push_body", col: "PUSH_BODY", label: "Push body", max: PUSH_BODY_MAX },
  { key: "social", col: "SOCIAL_TEXT", label: "Paid social", max: SOCIAL_MAX, rows: 2 }, { key: "instore", col: "INSTORE_TEXT", label: "In-store", max: INSTORE_MAX }, { key: "cta", col: "CTA", label: "Call to action" },
];

function EditVariant({ v, onClose }: { v: Row; onClose: () => void }) {
  const save = useCmpAction("studio/variant");
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(EDITS.map((e) => [e.key, String(v[e.col] ?? "")])));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal wide title={`Edit variant ${String(v.VARIANT_CODE)}`} subtitle="Saving re-runs QA and the judge." onClose={onClose}>
      <div className="grid gap-2 md:grid-cols-2">
        {EDITS.map((e) => (
          <Field key={e.key} label={`${e.label}${e.max ? ` · ${f[e.key].length}/${e.max}` : ""}`}>
            <textarea rows={e.rows ?? 1} className={`${inputCls} ${e.max && f[e.key].length > e.max ? "border-red-400" : ""}`} value={f[e.key]} onChange={(x) => setF({ ...f, [e.key]: x.target.value })} />
          </Field>
        ))}
      </div>
      {err && <div className="mt-2"><Banner tone="error">{err}</Banner></div>}
      <div className="mt-3 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={save.busy} onClick={async () => { const x = await save.run({ variantId: v.VARIANT_ID, fields: f }); if (!x.ok) return setErr(x.error); onClose(); }}>{save.busy ? "Checking…" : "Save"}</Button></div>
    </Modal>
  );
}
