"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Sparkles, Loader2, Plus, Trash2, Lock, Save, Users } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Pill, Banner, Button, Field, inputCls, Th, Td, InfoTip } from "../_components/ui";
import { useCmp, useCmpAction, parse, type Row } from "../_components/useCmp";
import { StageStrip, StatusPill, Prov, PLOT_LAYOUT, PLOT_CONFIG } from "../_components/shared";
import { FIELDS, CHANNELS, CHANNEL_LABEL, QUADRANTS, QUADRANT_LABEL, QUADRANT_HINT, CATEGORIES, type ChannelCode, type Quadrant } from "@/lib/campaign/config";
import { emptySpec, describeSpec, type AudienceSpec, type Condition } from "@/lib/campaign/spec";
import { num, toNum } from "@/lib/campaign/format";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Size = {
  description: string;
  funnel: { matched: number; consented: number; eligible: number; final: number; suppressed: { key: string; label: string; n: number }[]; finalStockConflict: number; channels: Record<string, number> };
  quadrants: { quadrant: Quadrant; consented: number; final: number; expIncConv: number; expBaseConv: number }[];
  sureThingsExcluded: number;
  composition: Row[];
  health: { score: number; reach: number; detractorShare: number | null; contacted30dShare: number | null; negVoiceShare: number | null; relevantShare: number | null; expIncConv: number; expBaseRate: number | null };
};
type Payload = { audiences: Row[]; campaigns: Row[]; seedCampaigns: Row[]; upliftCells: { key: string; liftPp: number; holdoutRate: number; n: number; quadrant: string }[] };

const QTONE: Record<string, "green" | "slate" | "amber" | "red"> = { PERSUADABLE: "green", SURE_THING: "amber", LOST_CAUSE: "slate", SLEEPING_DOG: "red" };
const GROUPS = [...new Set(Object.values(FIELDS).map((f) => f.group))];
const pc = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);

export default function AudiencesPage() {
  return <Suspense fallback={<Loading what="audiences" />}><Audiences /></Suspense>;
}

function Audiences() {
  const params = useSearchParams();
  const router = useRouter();
  const campaignId = params.get("campaign");
  const { data, isLoading, error } = useCmp<Payload>("audiences", { campaign: campaignId });
  const sizeAct = useCmpAction<Size>("audiences/size");
  const nl = useCmpAction<{ spec: AudienceSpec; explanation: string }>("audiences/nl");
  const save = useCmpAction<{ audienceId: string }>("audiences/save");
  const lock = useCmpAction<{ treated: number; holdout: number }>("audiences/lock");

  const [spec, setSpec] = useState<AudienceSpec>(emptySpec());
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn" | "info"; text: string } | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const campaign = data?.campaigns.find((c) => c.CAMPAIGN_ID === campaignId) ?? null;
  const drafts = useMemo(() => (data?.audiences ?? []).filter((a) => a.CAMPAIGN_ID === campaignId), [data, campaignId]);

  // Opening a campaign loads its latest audience (from the accepted idea, or saved earlier).
  useEffect(() => {
    if (!data || loadedFor === (campaignId ?? "")) return;
    const a = drafts[0];
    const sp = a ? parse<AudienceSpec>(a.SPEC) : null;
    const base = sp ?? emptySpec();
    if (campaign && !sp) {
      base.promoted = { category: (campaign.PROMOTED_CATEGORY as string) ?? null, className: (campaign.PROMOTED_CLASS as string) ?? null, brand: (campaign.PROMOTED_BRAND as string) ?? null };
      const ch = parse<string[]>(campaign.CHANNELS);
      if (ch?.length) base.channels = ch as ChannelCode[];
    }
    setSpec({ ...emptySpec(), ...base });
    setName(a ? String(a.NAME) : campaign ? `${String(campaign.NAME)} - audience` : "");
    setSize(null);
    setLoadedFor(campaignId ?? "");
  }, [data, campaignId, campaign, drafts, loadedFor]);

  const runSize = async (sp = spec) => {
    setMsg(null);
    const r = await sizeAct.run({ spec: sp }, { invalidate: false });
    if (!r.ok) setMsg({ tone: "error", text: r.error });
    else setSize(r.data);
  };
  // Re-size shortly after each change, so the funnel follows the filters.
  useEffect(() => {
    if (loadedFor === null) return;
    const t = setTimeout(() => runSize(spec), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, loadedFor]);

  if (isLoading) return <Loading what="audiences" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;

  const set = (p: Partial<AudienceSpec>) => setSpec((s) => ({ ...s, ...p }));
  const setCond = (list: "all" | "exclude", i: number, c: Condition | null) =>
    setSpec((s) => ({ ...s, [list]: c === null ? s[list].filter((_, k) => k !== i) : s[list].map((x, k) => (k === i ? c : x)) }));
  const addCond = (list: "all" | "exclude") => setSpec((s) => ({ ...s, [list]: [...s[list], { field: "RECENCY_BAND", op: "in", values: ["0-90d"] }] }));

  const askAi = async () => {
    setMsg(null); setExplanation(null);
    const r = await nl.run({ text, current: spec }, { invalidate: false });
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setSpec(r.data.spec);
    setExplanation(r.data.explanation);
  };
  const doSave = async () => {
    setMsg(null);
    const r = await save.run({ campaignId, name, spec, source: explanation ? "AI" : spec.lookalike ? "LOOKALIKE" : "BUILDER" });
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setMsg({ tone: "ok", text: `Saved ${name}.` });
    return r.data.audienceId;
  };
  const doLock = async () => {
    if (!campaignId) return;
    const id = await doSave();
    if (!id) return;
    const r = await lock.run({ campaignId, audienceId: id });
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setMsg({ tone: "ok", text: `Locked: ${num(r.data.treated)} members will be contacted and ${num(r.data.holdout)} held out to measure the lift.` });
    router.push(`/campaigns/studio/${campaignId}`);
  };

  const quadChart = size?.quadrants ?? [];
  const locked = campaign && campaign.STATUS !== "BRIEF";

  return (
    <div className="p-6">
      <PageHeader title="Audience" subtitle="Who to target, who to leave alone, and the holdout that proves it worked. Every count comes from the data, not an estimate."
        right={<select className={`${inputCls} w-72`} value={campaignId ?? ""} onChange={(e) => { setLoadedFor(null); router.push(e.target.value ? `/campaigns/audiences?campaign=${e.target.value}` : "/campaigns/audiences"); }}>
          <option value="">No campaign: explore audiences</option>
          {data.campaigns.map((c) => <option key={String(c.CAMPAIGN_ID)} value={String(c.CAMPAIGN_ID)}>{String(c.NAME)} · {String(c.STATUS).toLowerCase()}</option>)}
        </select>} />
      <StageStrip current={2} />

      {campaign && (
        <Banner tone={locked ? "warn" : "info"}>
          Building for <b>{String(campaign.NAME)}</b> <StatusPill s={campaign.STATUS} /> · {String(campaign.PROMOTED_CATEGORY ?? "any category")}{campaign.PROMOTED_BRAND ? ` · ${String(campaign.PROMOTED_BRAND)}` : ""}
          {locked && <> · its audience is already locked. <Link className="font-medium underline" href={`/campaigns/${["LIVE", "PAUSED", "COMPLETED", "MEASURED"].includes(String(campaign.STATUS)) ? "performance" : "studio"}/${campaignId}`}>Open the campaign</Link></>}
        </Banner>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />Describe the audience</span>}
            subtitle="AI_COMPLETE turns the request into filters from the field list below; you see and can change every one before it is used.">
            <div className="flex gap-2">
              <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} disabled={nl.busy}
                placeholder="e.g. parents with a capsule bought 5-8 months ago who shop in NSW or VIC and can get SMS" onKeyDown={(e) => e.key === "Enter" && text && askAi()} />
              <Button variant="primary" onClick={askAi} disabled={nl.busy || !text.trim()}>{nl.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Build"}</Button>
            </div>
            {explanation && <p className="mt-2 text-[11px] text-slate-600"><Prov p="AI" /> {explanation}</p>}
          </Card>

          <Card title="Who is in" subtitle={size ? size.description : describeSpec(spec)} right={<Button onClick={() => addCond("all")}><Plus className="h-3.5 w-3.5" />Condition</Button>}>
            <div className="space-y-1.5">
              {spec.all.length === 0 && <p className="text-xs text-slate-500">Everyone. Add a condition, or describe the audience above.</p>}
              {spec.all.map((c, i) => <CondRow key={i} c={c} onChange={(x) => setCond("all", i, x)} />)}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-[11px] font-medium text-slate-600">Leave out anyone who…</span>
              <Button variant="ghost" onClick={() => addCond("exclude")}><Plus className="h-3.5 w-3.5" />Exclusion</Button>
            </div>
            <div className="space-y-1.5">{spec.exclude.map((c, i) => <CondRow key={i} c={c} onChange={(x) => setCond("exclude", i, x)} />)}</div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Promoting" subtitle="Decides who needs the product, and whose store can supply it">
              <div className="space-y-2">
                <Field label="Category"><select className={inputCls} value={spec.promoted.category ?? ""} onChange={(e) => set({ promoted: { ...spec.promoted, category: e.target.value || null } })}>
                  <option value="">Any</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Brand" hint="A brand short at a member's home store triggers the stock suppression."><input className={inputCls} value={spec.promoted.brand ?? ""} onChange={(e) => set({ promoted: { ...spec.promoted, brand: e.target.value || null } })} /></Field>
                <div className="flex flex-wrap gap-1.5">{CHANNELS.map((c) => (
                  <label key={c} className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] ${spec.channels.includes(c) ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                    <input type="checkbox" className="hidden" checked={spec.channels.includes(c)} onChange={(e) => set({ channels: e.target.checked ? [...spec.channels, c] : spec.channels.filter((x) => x !== c) })} />{CHANNEL_LABEL[c]}
                  </label>))}</div>
              </div>
            </Card>
            <Card title="Leave alone" subtitle="Suppression rules, applied after consent">
              <div className="space-y-1.5 text-xs">
                <label className="flex items-center gap-2"><input type="checkbox" checked={spec.suppress.fatigueDays !== null} onChange={(e) => set({ suppress: { ...spec.suppress, fatigueDays: e.target.checked ? 14 : null } })} />
                  Contacted in the last <input className="w-12 rounded border border-slate-300 px-1 text-xs" value={spec.suppress.fatigueDays ?? ""} disabled={spec.suppress.fatigueDays === null}
                    onChange={(e) => set({ suppress: { ...spec.suppress, fatigueDays: Math.min(90, Number(e.target.value.replace(/\D/g, "")) || 0) } })} /> days</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={spec.suppress.priceComplainers} onChange={(e) => set({ suppress: { ...spec.suppress, priceComplainers: e.target.checked } })} />Recently complained about price or promotions</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={spec.suppress.openComplaints} onChange={(e) => set({ suppress: { ...spec.suppress, openComplaints: e.target.checked } })} />Any complaint in the last 60 days</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={spec.suppress.stockConflict} onChange={(e) => set({ suppress: { ...spec.suppress, stockConflict: e.target.checked } })} />Home store is short of the promoted brand</label>
                <div className="border-t border-slate-100 pt-2">
                  <div className="mb-1 text-[11px] font-medium text-slate-600">Target by uplift quadrant <InfoTip text="From past campaigns' treated vs holdout response in the same recency band, need and price-grievance cell. Leaving out sure things saves the discount they would have got anyway." /></div>
                  <div className="flex flex-wrap gap-1.5">{QUADRANTS.map((q) => {
                    const on = spec.quadrants?.includes(q) ?? false;
                    return <label key={q} title={QUADRANT_HINT[q]} className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] ${on ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                      <input type="checkbox" className="hidden" checked={on} onChange={(e) => {
                        const cur = spec.quadrants ?? [];
                        const next = e.target.checked ? [...cur, q] : cur.filter((x) => x !== q);
                        set({ quadrants: next.length ? next : null });
                      }} />{QUADRANT_LABEL[q]}</label>;
                  })}</div>
                  <p className="mt-1 text-[10px] text-slate-500">{spec.quadrants ? `Only ${spec.quadrants.map((q) => QUADRANT_LABEL[q].toLowerCase()).join(", ")}` : "Everyone, whatever their quadrant"}</p>
                </div>
              </div>
            </Card>
          </div>

          <Card title="Lookalike" subtitle="Keep only the customers most like the people who converted in a past campaign (cosine similarity on their purchase profile)">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Seed"><select className={`${inputCls} w-72`} value={spec.lookalike?.seedCampaignId ?? ""} onChange={(e) => set({ lookalike: e.target.value ? { seedCampaignId: e.target.value, topN: spec.lookalike?.topN ?? 5000 } : null })}>
                <option value="">No lookalike</option>{data.seedCampaigns.map((c) => <option key={String(c.CAMPAIGN_ID)} value={String(c.CAMPAIGN_ID)}>{String(c.NAME)} · {num(toNum(c.CONVERTERS))} converters</option>)}</select></Field>
              {spec.lookalike && <Field label="Most similar"><input className={`${inputCls} w-28`} value={spec.lookalike.topN} onChange={(e) => set({ lookalike: { ...spec.lookalike!, topN: Math.max(100, Math.min(50000, Number(e.target.value.replace(/\D/g, "")) || 100)) } })} /></Field>}
              <Field label="Cap the audience at"><input className={`${inputCls} w-28`} value={spec.cap ?? ""} placeholder="No cap" onChange={(e) => set({ cap: Number(e.target.value.replace(/\D/g, "")) || null })} /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <Card title={<span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-amber-600" />Audience</span>}
            right={sizeAct.busy ? <Loader2 className="h-4 w-4 animate-spin text-amber-600" /> : null}>
            {msg && <div className="mb-2"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}
            {!size ? <p className="text-xs text-slate-500">Sizing…</p> : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="In the audience" value={num(size.funnel.final)} emphasis sub={`of ${num(size.funnel.matched)} who match`} />
                  <Tile label="Audience Health" value={`${size.health.score}`} sub="Need, freshness, sentiment, lift" hint="25 points each: share who need the product; share not contacted in 30 days; few detractors; expected lift per member." />
                </div>
                <table className="mt-3 w-full text-xs">
                  <tbody>
                    <tr className="border-b border-slate-100"><Td>Match the filters</Td><Td align="right" mono>{num(size.funnel.matched)}</Td></tr>
                    <tr className="border-b border-slate-100"><Td>…and consented to a chosen channel <Prov p="MODELLED" /></Td><Td align="right" mono>{num(size.funnel.consented)}</Td></tr>
                    {size.funnel.suppressed.map((s) => <tr key={s.key} className="border-b border-slate-100 text-slate-500"><Td className="pl-4">− {s.label}</Td><Td align="right" mono>{num(s.n)}</Td></tr>)}
                    <tr className="border-b border-slate-100"><Td>…eligible after suppression and quadrants</Td><Td align="right" mono>{num(size.funnel.eligible)}</Td></tr>
                    <tr className="font-semibold"><Td>In the audience{spec.cap ? ` (cap ${num(spec.cap)})` : ""}</Td><Td align="right" mono>{num(size.funnel.final)}</Td></tr>
                  </tbody>
                </table>
                {size.funnel.finalStockConflict > 0 && <div className="mt-2"><Banner tone="error">{num(size.funnel.finalStockConflict)} members' home store is short of {spec.promoted.brand}. Turn on the stock suppression, or they will be sent to an empty shelf.</Banner></div>}
                <div className="mt-2 text-[11px] text-slate-600">Reachable by email {num(size.funnel.channels.EMAIL)} · SMS {num(size.funnel.channels.SMS)} · push {num(size.funnel.channels.PUSH)}</div>
                <div className="mt-1 text-[11px] text-slate-600">Expected incremental conversions <b>{num(size.health.expIncConv, 0)}</b> <Prov p="MODELLED" /> · need the product {pc(size.health.relevantShare)} · contacted in 30 days {pc(size.health.contacted30dShare)} · detractors {pc(size.health.detractorShare)}</div>
              </>
            )}
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Audience name" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={doSave} disabled={save.busy || !name.trim()}><Save className="h-3.5 w-3.5" />Save</Button>
                {campaign && campaign.STATUS === "BRIEF" && (
                  <Button variant="primary" onClick={doLock} disabled={lock.busy || save.busy || !name.trim() || !size?.funnel.final}
                    title="Freeze the members, split off the holdout and move the campaign to content">
                    {lock.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}Lock for {String(campaign.NAME).slice(0, 28)}
                  </Button>
                )}
              </div>
              {campaign && campaign.STATUS === "BRIEF" && <p className="text-[10px] text-slate-500">Locking holds out {String(campaign.HOLDOUT_PCT ?? 10)}% at random (a hash of the customer and campaign), so the lift can be measured.</p>}
            </div>
          </Card>

          {size && (
            <Card title="Uplift quadrants" subtitle="From past campaigns: who buys because of the contact, and who buys anyway">
              <Plot data={[
                { type: "bar", name: "In the audience", x: quadChart.map((q) => QUADRANT_LABEL[q.quadrant]), y: quadChart.map((q) => q.final), marker: { color: "#d97706" } },
                { type: "bar", name: "Consented, left out", x: quadChart.map((q) => QUADRANT_LABEL[q.quadrant]), y: quadChart.map((q) => Math.max(0, q.consented - q.final)), marker: { color: "#e2e8f0" } },
              ]} layout={{ ...PLOT_LAYOUT, barmode: "stack", height: 200 }} config={PLOT_CONFIG} style={{ width: "100%" }} />
              <ul className="mt-1 space-y-0.5 text-[11px]">{quadChart.map((q) => <li key={q.quadrant}><Pill tone={QTONE[q.quadrant]}>{QUADRANT_LABEL[q.quadrant]}</Pill> {QUADRANT_HINT[q.quadrant]}</li>)}</ul>
              {size.sureThingsExcluded > 0 && <p className="mt-2 text-[11px] text-emerald-700">{num(size.sureThingsExcluded)} sure things left out: no discount given to people who would buy anyway.</p>}
            </Card>
          )}

          {size && (
            <Card title="Who they are">
              {["Child stage", "Segment", "Last purchase", "Home state"].map((d) => {
                const rows = size.composition.filter((c) => c.DIM === d).sort((a, b) => Number(b.N) - Number(a.N)).slice(0, 5);
                const tot = rows.reduce((a, r) => a + Number(r.N), 0) || 1;
                return <div key={d} className="mb-2"><div className="text-[10px] font-semibold uppercase text-slate-500">{d}</div>
                  {rows.map((r) => <div key={String(r.VAL)} className="flex items-center gap-2 text-[11px]"><span className="w-36 truncate">{String(r.VAL ?? "Unknown")}</span>
                    <div className="h-1.5 flex-1 rounded bg-slate-100"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${(100 * Number(r.N)) / tot}%` }} /></div><span className="w-12 text-right font-mono">{num(Number(r.N))}</span></div>)}
                </div>;
              })}
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4" title="Saved audiences">
        <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Name</Th><Th>Campaign</Th><Th>Source</Th><Th align="right">Matched</Th><Th align="right">Reachable</Th><Th>Status</Th></tr></thead>
          <tbody>{data.audiences.slice(0, 20).map((a) => (
            <tr key={String(a.AUDIENCE_ID)} className="border-b border-slate-50 hover:bg-amber-50/40 cursor-pointer" onClick={() => { const sp = parse<AudienceSpec>(a.SPEC); if (sp) { setSpec({ ...emptySpec(), ...sp }); setName(String(a.NAME)); } }}>
              <Td className="font-medium">{String(a.NAME)}</Td><Td>{String(a.CAMPAIGN_NAME ?? "–")}</Td><Td><Pill>{String(a.SOURCE).toLowerCase()}</Pill></Td>
              <Td align="right" mono>{num(toNum(a.SIZE_AT_SAVE))}</Td><Td align="right" mono>{num(toNum(a.REACHABLE_AT_SAVE))}</Td><Td><Pill tone={a.STATUS === "LOCKED" ? "blue" : "slate"}>{String(a.STATUS).toLowerCase()}</Pill></Td>
            </tr>))}</tbody></table>
      </Card>
    </div>
  );
}

function CondRow({ c, onChange }: { c: Condition; onChange: (c: Condition | null) => void }) {
  const def = FIELDS[c.field];
  const setField = (field: string) => {
    const d = FIELDS[field];
    onChange(d.kind === "enum" ? { field, op: "in", values: [String(d.options?.[0] ?? "")] } : d.kind === "bool" ? { field, op: "is_true" } : { field, op: "gte", value: 0 });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/50 p-1.5">
      <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]" value={c.field} onChange={(e) => setField(e.target.value)}>
        {GROUPS.map((g) => <optgroup key={g} label={g}>{Object.entries(FIELDS).filter(([, f]) => f.group === g).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</optgroup>)}
      </select>
      {def?.kind === "enum" && (
        <>
          <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition["op"] })}>
            <option value="in">is any of</option><option value="not_in">is none of</option>
          </select>
          <div className="flex flex-wrap gap-1">{def.options?.map((o) => {
            const on = (c.values ?? []).includes(o);
            return <button key={o} onClick={() => onChange({ ...c, values: on ? (c.values ?? []).filter((x) => x !== o) : [...(c.values ?? []), o] })}
              className={`rounded px-1.5 py-0.5 text-[10px] ${on ? "bg-amber-600 text-white" : "bg-white text-slate-600 border border-slate-200"}`}>{o}</button>;
          })}</div>
        </>
      )}
      {def?.kind === "number" && (
        <>
          <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition["op"], min: c.min ?? 0, max: c.max ?? 100 })}>
            <option value="gte">at least</option><option value="lte">at most</option><option value="between">between</option>
          </select>
          {c.op === "between"
            ? <><input className="w-20 rounded border border-slate-300 px-1 py-0.5 text-[11px]" value={c.min ?? ""} onChange={(e) => onChange({ ...c, min: Number(e.target.value) || 0 })} /> and <input className="w-20 rounded border border-slate-300 px-1 py-0.5 text-[11px]" value={c.max ?? ""} onChange={(e) => onChange({ ...c, max: Number(e.target.value) || 0 })} /></>
            : <input className="w-24 rounded border border-slate-300 px-1 py-0.5 text-[11px]" value={String(c.value ?? "")} onChange={(e) => onChange({ ...c, value: Number(e.target.value) || 0 })} />}
        </>
      )}
      {def?.kind === "bool" && (
        <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition["op"] })}>
          <option value="is_true">yes</option><option value="is_false">no</option>
        </select>
      )}
      {def && <Prov p={def.provenance} />}
      <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => onChange(null)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}
