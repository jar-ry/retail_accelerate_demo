"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Pill, Th, Td, Segmented, inputCls, Banner } from "../_components/ui";
import { useCmp, type Row } from "../_components/useCmp";
import { StageStrip, Prov, PLOT_LAYOUT, PLOT_CONFIG } from "../_components/shared";
import { THEMES, INTENT_LABEL, CHILD_STAGES, CHILD_STAGE_LABEL } from "@/lib/campaign/config";
import { num, toNum, isoDate } from "@/lib/campaign/format";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Voice = { kpi: Row; weekly: Row[]; anomalies: Row[]; heatmap: Row[]; sources: Row[]; intent: Row[]; quality: Row | null; enrichCost: Row | null; praise: Row[]; brands: Row[] };
const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const SENT_TONE: Record<string, "green" | "red" | "slate" | "amber"> = { positive: "green", negative: "red", neutral: "slate", mixed: "amber" };

export default function VoicePage() {
  const { data, isLoading, error } = useCmp<Voice>("voice");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [source, setSource] = useState("");
  const search = useCmp<{ rows: Row[]; total: number }>("voice/search", { ...applied, source });

  const weeks = useMemo(() => {
    const m = new Map<string, { r: number; p: number; d: number; neg: number; n: number }>();
    for (const w of data?.weekly ?? []) {
      const k = isoDate(w.EVENT_WEEK) ?? String(w.EVENT_WEEK);
      const x = m.get(k) ?? { r: 0, p: 0, d: 0, neg: 0, n: 0 };
      x.r += Number(w.RESPONSES ?? 0); x.p += Number(w.PROMOTERS ?? 0); x.d += Number(w.DETRACTORS ?? 0);
      x.neg += Number(w.NEGATIVE_ITEMS ?? 0); x.n += Number(w.VOICE_ITEMS ?? 0);
      m.set(k, x);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (isLoading) return <Loading what="the customer voice" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? "No data"} />;
  const k = data.kpi;
  const heat = data.heatmap;
  const themes = THEMES.filter((t) => heat.some((h) => h.THEME === t));
  const stages = CHILD_STAGES.filter((s) => heat.some((h) => h.CHILD_STAGE === s));
  const z = themes.map((t) => stages.map((s) => {
    const c = heat.find((h) => h.THEME === t && h.CHILD_STAGE === s);
    return c && Number(c.N) >= 5 ? (100 * Number(c.NEG)) / Number(c.N) : null;
  }));

  return (
    <div className="p-6">
      <PageHeader title="Customer voice" subtitle="Surveys, reviews, care contacts, social and campaign replies, read by AI_COMPLETE for sentiment, theme, child stage and purchase intent." />
      <StageStrip current={1} />
      <Banner tone="warn">The verbatims are synthetic: built from a phrase library on real Baby Mart purchases, stores and dates, with planted storylines. Every AI reading of them is real and logged.</Banner>

      <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="NPS, last 28 days" value={toNum(k.NPS_28D) === null ? "–" : num(toNum(k.NPS_28D), 1)} sub={`Prior 8 weeks ${num(toNum(k.NPS_PRIOR_8W), 1)}`} emphasis />
        <Tile label="Survey responses, 28 days" value={num(toNum(k.RESPONSES_28D))} />
        <Tile label="Average sentiment, 28 days" value={toNum(k.SENTIMENT_28D) === null ? "–" : num(toNum(k.SENTIMENT_28D), 2)} sub="-1 to +1, from AI_SENTIMENT" />
        <Tile label="High-urgency items, 28 days" value={num(toNum(k.HIGH_URGENCY_28D))} subClass="text-red-600" />
        <Tile label="Read by AI" value={`${num(toNum(k.ENRICHED_ITEMS))} / ${num(toNum(k.WITH_TEXT))}`} sub="Texts enriched by AI_COMPLETE"
          hint={data.quality ? `Theme agreement with the planted label: ${num((toNum(data.quality.THEME_AGREEMENT) ?? 0) * 100, 0)}%` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card title="NPS and negative share by week" subtitle="National, all sources">
          <Plot data={[
            { type: "scatter", mode: "lines", name: "NPS", x: weeks.map(([w]) => w), y: weeks.map(([, x]) => (x.r ? (100 * (x.p - x.d)) / x.r : null)), line: { color: "#d97706" } },
            { type: "bar", name: "Negative share %", x: weeks.map(([w]) => w), y: weeks.map(([, x]) => (x.n ? (100 * x.neg) / x.n : null)), yaxis: "y2", marker: { color: "#fecaca" } },
          ]} layout={{ ...PLOT_LAYOUT, height: 260, yaxis: { title: { text: "NPS" }, gridcolor: "#f1f5f9" }, yaxis2: { overlaying: "y", side: "right", title: { text: "% negative" }, showgrid: false } }}
            config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
        <Card title="Where the complaints are" subtitle="Share of each theme's mentions that are negative, by the child stage the parent mentions">
          <Plot data={[{ type: "heatmap", x: stages.map((s) => CHILD_STAGE_LABEL[s] ?? s), y: themes, z, colorscale: [[0, "#fff7ed"], [1, "#b91c1c"]], hovertemplate: "%{y} · %{x}: %{z:.0f}% negative<extra></extra>" } as never]}
            layout={{ ...PLOT_LAYOUT, height: 260, margin: { l: 190, r: 10, t: 6, b: 30 } }} config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card title="Unusual this week" subtitle="Negative mentions far above the theme's own baseline (z ≥ 2)">
          <ul className="space-y-1 text-xs">{data.anomalies.map((a, i) => (
            <li key={i}><Pill tone="red">{String(a.STATE)}</Pill> {String(a.THEME)} · week of {isoDate(a.EVENT_WEEK)}: <b>{num(toNum(a.NEGATIVE_MENTIONS))}</b> vs baseline {num(toNum(a.BASE_MEAN), 1)}</li>
          ))}{data.anomalies.length === 0 && <li className="text-slate-500">Nothing unusual.</li>}</ul>
        </Card>
        <Card title="Brands customers talk about" subtitle="Last 180 days">
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200"><Th>Brand</Th><Th align="right">Mentions</Th><Th align="right">% negative</Th><Th>Mostly about</Th></tr></thead>
            <tbody>{data.brands.slice(0, 8).map((b, i) => (
              <tr key={i} className="border-b border-slate-50"><Td>{String(b.BRAND_NAME)}</Td><Td align="right" mono>{num(toNum(b.MENTIONS))}</Td>
                <Td align="right" mono className={(toNum(b.NEGATIVE_PCT) ?? 0) >= 20 ? "text-red-600 font-semibold" : ""}>{num(toNum(b.NEGATIVE_PCT), 0)}%</Td><Td className="text-slate-500">{String(b.TOP_NEGATIVE_THEME ?? "–")}</Td></tr>
            ))}</tbody></table>
        </Card>
        <Card title="What they say they will buy next" subtitle="Purchase intent extracted by AI_COMPLETE">
          <ul className="space-y-1 text-xs">{data.intent.map((x, i) => <li key={i}>{INTENT_LABEL[String(x.PURCHASE_INTENT)] ?? String(x.PURCHASE_INTENT)}: <b>{num(toNum(x.CUSTOMERS))}</b> parents</li>)}</ul>
          <div className="mt-2 text-[11px] text-slate-500">Use "Said they will buy next" as an audience filter.</div>
        </Card>
      </div>

      <Card title="Read the verbatims" subtitle="Search what customers said, with the AI reading of each"
        right={<Segmented value={source} onChange={setSource} options={[{ value: "", label: "All" }, { value: "SURVEY", label: "Surveys" }, { value: "REVIEW", label: "Reviews" }, { value: "CARE", label: "Care" }, { value: "SOCIAL", label: "Social" }, { value: "REPLY", label: "Replies" }]} />}>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
            <input className={`${inputCls} pl-7`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. price match, Rascal, capsule" onKeyDown={(e) => e.key === "Enter" && setApplied({ ...applied, q })} />
          </div>
          <select className={`${inputCls} w-40`} value={applied.sentiment ?? ""} onChange={(e) => setApplied({ ...applied, sentiment: e.target.value })}>
            <option value="">Any sentiment</option>{["negative", "positive", "neutral", "mixed"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className={`${inputCls} w-56`} value={applied.theme ?? ""} onChange={(e) => setApplied({ ...applied, theme: e.target.value })}>
            <option value="">Any theme</option>{THEMES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className={`${inputCls} w-28`} value={applied.state ?? ""} onChange={(e) => setApplied({ ...applied, state: e.target.value })}>
            <option value="">Any state</option>{STATES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        {search.isLoading ? <p className="text-xs text-slate-400">Searching…</p> : search.error ? <Banner tone="error">{(search.error as Error).message}</Banner> : (
          <>
            <p className="mb-2 text-[11px] text-slate-500">{num(search.data?.total ?? 0)} matching · showing the latest {search.data?.rows.length ?? 0}</p>
            <ul className="divide-y divide-slate-100">
              {search.data?.rows.map((r) => (
                <li key={String(r.VOICE_ID)} className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    <Pill tone="slate">{String(r.SOURCE).toLowerCase()}</Pill>
                    {r.SENTIMENT ? <Pill tone={SENT_TONE[String(r.SENTIMENT)] ?? "slate"}>{String(r.SENTIMENT)}</Pill> : <Pill tone="slate">not read yet</Pill>}
                    {r.THEME ? <span>{String(r.THEME)}</span> : null}
                    {r.URGENCY === "HIGH" && <Pill tone="red">urgent</Pill>}
                    <span>· {isoDate(r.EVENT_DATE)} · {String(r.STORE_NAME ?? r.STATE ?? "")}{r.BRAND_NAME ? ` · ${String(r.BRAND_NAME)}` : ""}{toNum(r.NPS_SCORE) !== null ? ` · NPS ${String(r.NPS_SCORE)}` : ""}{toNum(r.STAR_RATING) !== null ? ` · ${String(r.STAR_RATING)}★` : ""}</span>
                    <Prov p={r.PROVENANCE as string} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-800">“{String(r.VOICE_TEXT)}”</p>
                  {r.SUMMARY ? <p className="text-[11px] italic text-slate-500">AI: {String(r.SUMMARY)}</p> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {data.enrichCost && <p className="mt-3 text-[10px] text-slate-400">Enrichment: {num(toNum(data.enrichCost.TEXTS))} texts read by claude-haiku-4-5 in {num(toNum(data.enrichCost.BATCHES))} batches, {num((toNum(data.enrichCost.PROMPT_TOKENS) ?? 0) + (toNum(data.enrichCost.COMPLETION_TOKENS) ?? 0))} tokens.</p>}
    </div>
  );
}
