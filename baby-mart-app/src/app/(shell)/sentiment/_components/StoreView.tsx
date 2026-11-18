"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Bot, MessageSquare, Star, Mail, Smartphone, Reply, Truck, Store as StoreIcon, Radar } from "lucide-react";
import { useSentiment, urlParam } from "./useSentiment";
import { Card, ErrorState, Loading, Kpi, StepHeader, WeekSelect, StepLink, NpsChip, Pill, fmt, fmtDate, weekEnd, PLOT_FONT, PLOT_CONFIG } from "./ui";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── 3 · Drill: one store, voice against supply ─────────────────────────────
//
// What a store's customers said over the four weeks to the focus week, set
// against what the store could sell (its supply status by brand, week by week,
// from the stock alerts and any approved recovery plan) and what was due into
// its DC. Store NPS is four-week rolling: a store gets about three surveys a
// week. The investigate button hands the store and window to the agent.

type Store = {
  asOf: string; week: string; weeks: string[]; window: { from: string; to: string }; baselineWindow: { from: string; to: string };
  store: { code: string; name: string; suburb: string; state: string; city: string; storeType: string; format: string; dc: string };
  kpis: { nps: number | null; baseline: number | null; change: number | null; responses: number; baselineResponses: number; oos: number; oosBaselinePerWeek: number | null; negative: number; negativeBaselinePerWeek: number | null; detractorRate: number | null; lowSample: boolean; stateNps: number | null; stateChange: number | null };
  series: { week: string; responses: number; oos: number; negative: number; replies: number; nps4: number | null; stateNps4: number | null }[];
  themes: { theme: string; negative: number; detractors: number; perWeek: number | null; baselinePerWeek: number | null }[];
  supplyWeeks: string[]; supply: { brand: string; reason: string; cells: { week: string; status: string; recovering: boolean }[] }[]; shortNow: string[];
  inbound: { brand: string; week: string; ordered: number; delivered: number; openForecast: number; openOrdered: number; lines: number }[];
  verbatims: { date: string; source: string; score: number | null; theme: string; sentiment: string; brand: string | null; category: string; text: string }[];
  risk: { week: string; score: number; band: string; drivers: string }[];
};
type Meta = { stores: { code: string; name: string; suburb: string; state: string }[] };

const STATUS_CLS: Record<string, string> = {
  SHORT: "bg-rose-500 text-white", LOW: "bg-amber-300 text-amber-900", OVER: "bg-sky-200 text-sky-900", OK: "bg-emerald-100 text-emerald-800",
};
const SOURCE_ICON: Record<string, typeof MessageSquare> = { "NPS survey": MessageSquare, "Product review": Star, "Care email": Mail, "Social post": Smartphone, "Campaign reply": Reply };
const BAND_TONE: Record<string, "red" | "amber" | "slate" | "violet"> = { CRITICAL: "red", HIGH: "amber", ELEVATED: "violet", LOW: "slate" };

export function StoreView({ code }: { code: string | null }) {
  const [week, setWeek] = useState<string | null>(() => urlParam("week"));
  const { data, error, isLoading } = useSentiment<Store>("store", { code, week });
  const meta = useSentiment<Meta>("meta");
  if (error) return <ErrorState message={String((error as Error).message)} />;
  if (isLoading || !data) return <Loading what="the store" />;

  const s = data.store, k = data.kpis;
  const ask = `Investigate why ${s.name} NPS fell in the four weeks to ${fmtDate(weekEnd(data.week))}. Is it this store, or something its state's stores share?`;
  const nowIdx = data.supplyWeeks.indexOf(data.week);
  const inboundBrands = [...new Set(data.inbound.map((i) => i.brand))];
  const risky = data.risk.filter((r) => r.band !== "LOW");

  return (
    <div className="p-6 space-y-4">
      <StepHeader step="3 · Drill" title={s.name}
        subtitle={<div className="flex flex-wrap items-center gap-1.5 mt-1">
          <Pill tone="slate">{s.code}</Pill><Pill tone="slate">{s.city}, {s.state}</Pill><Pill tone="slate">{s.storeType} · {s.format}</Pill>
          <Pill tone="blue"><Truck className="inline w-3 h-3 mr-0.5" />{s.dc} DC</Pill>
          {data.shortNow.length > 0 && <Pill tone="red">Short this week: {data.shortNow.join(", ")}</Pill>}
        </div>}
        right={<>
          {meta.data && (
            <select value={s.code} onChange={(e) => { window.location.href = `/sentiment/store/${e.target.value}?week=${data.week}`; }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-rose-500 focus:outline-none" aria-label="Store">
              {meta.data.stores.map((x) => <option key={x.code} value={x.code}>{x.state} · {x.suburb}</option>)}
            </select>
          )}
          <WeekSelect weeks={data.weeks} value={data.week} onChange={setWeek} />
          <StepLink primary href={`/sentiment/investigate?q=${encodeURIComponent(ask)}`}><Bot className="w-3.5 h-3.5" /> Investigate with AI</StepLink>
        </>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Store NPS, 4 weeks" value={fmt(k.nps)} change={k.change} emphasis
          sub={<>{k.responses} surveys{k.lowSample ? " (low sample)" : ""}; {fmt(k.baseline)} over the 8 weeks before</>} />
        <Kpi label={`${s.state} NPS, same weeks`} value={fmt(k.stateNps)} change={k.stateChange} sub="Is it the store, or the state?" />
        <Kpi label="Out-of-stock complaints" value={String(k.oos)} sub={`${fmt(k.oosBaselinePerWeek)} a week before`} />
        <Kpi label="Negative voice items" value={String(k.negative)} sub={`${fmt(k.negativeBaselinePerWeek)} a week before · all sources`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Store NPS and complaints" subtitle={`Four-week rolling NPS for the store and ${s.state}; weekly negative voice and out-of-stock complaints`}>
          <Plot
            data={[
              { x: data.series.map((p) => p.week), y: data.series.map((p) => p.negative - p.oos), type: "bar", name: "Other negative voice", yaxis: "y2", marker: { color: "rgba(148,163,184,0.45)" } },
              { x: data.series.map((p) => p.week), y: data.series.map((p) => p.oos), type: "bar", name: "Out-of-stock complaints", yaxis: "y2", marker: { color: "rgba(225,29,72,0.55)" } },
              { x: data.series.map((p) => p.week), y: data.series.map((p) => p.nps4), type: "scatter", mode: "lines+markers", name: "Store NPS (4 wk)", line: { color: "#0f766e", width: 3 }, marker: { size: 5 } },
              { x: data.series.map((p) => p.week), y: data.series.map((p) => p.stateNps4), type: "scatter", mode: "lines", name: `${s.state} NPS (4 wk)`, line: { color: "#64748b", width: 1.5, dash: "dash" } },
            ]}
            layout={{
              height: 300, margin: { l: 40, r: 45, t: 10, b: 40 }, font: PLOT_FONT, barmode: "stack", hovermode: "x unified",
              legend: { orientation: "h", y: -0.2 }, yaxis: { title: { text: "NPS" } }, yaxis2: { overlaying: "y", side: "right", showgrid: false, title: { text: "Items" } },
              shapes: [{ type: "rect", x0: data.window.from, x1: data.window.to, yref: "paper", y0: 0, y1: 1, fillcolor: "rgba(225,29,72,0.06)", line: { width: 0 } }],
            }}
            config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
        <Card title="What customers complain about" subtitle={`Negative mentions by AI_CLASSIFY theme, four weeks to ${fmtDate(weekEnd(data.week))}`}>
          {data.themes.length === 0 ? <div className="text-xs text-slate-500">No negative voice in these weeks.</div> : (
            <Plot
              data={[
                { y: data.themes.map((t) => t.theme), x: data.themes.map((t) => t.negative), type: "bar", orientation: "h", name: "Negative mentions", marker: { color: "#e11d48" } },
                { y: data.themes.map((t) => t.theme), x: data.themes.map((t) => t.detractors), type: "bar", orientation: "h", name: "From detractors", marker: { color: "#fda4af" } },
              ]}
              layout={{ height: 300, margin: { l: 150, r: 10, t: 5, b: 30 }, font: PLOT_FONT, barmode: "group", yaxis: { autorange: "reversed" }, legend: { orientation: "h", y: -0.15 } }}
              config={PLOT_CONFIG} style={{ width: "100%" }} />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="What the store could sell" subtitle={`Supply status by brand, week by week (stock alerts; an approved recovery plan applies after the voice clock, ${fmtDate(data.asOf)}). The outlined week is the focus week.`}>
          {data.supply.length === 0 ? <div className="text-xs text-slate-500">Every brand in stock across these weeks.</div> : (
            <div className="overflow-x-auto">
              <table className="text-[10px]">
                <thead>
                  <tr>
                    <th className="pr-2 text-left font-medium text-slate-500">Brand</th>
                    {data.supplyWeeks.map((w, i) => <th key={w} className={`px-0.5 font-normal text-slate-400 ${i === nowIdx ? "text-rose-700 font-semibold" : ""}`}>{fmtDate(w, false).replace(" ", "\u00a0")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.supply.map((b) => (
                    <tr key={b.brand}>
                      <td className="pr-2 py-0.5 whitespace-nowrap text-xs text-slate-700" title={b.reason}>{b.brand}</td>
                      {b.cells.map((c, i) => (
                        <td key={c.week} className="px-0.5 py-0.5">
                          <div title={`${b.brand}, week of ${fmtDate(c.week)}: ${c.status}${c.recovering ? " (recovery plan)" : ""}`}
                            className={`h-5 w-9 rounded-sm text-center leading-5 ${STATUS_CLS[c.status] ?? STATUS_CLS.OK} ${i === nowIdx ? "ring-2 ring-rose-700" : ""} ${c.week > data.asOf ? "opacity-60" : ""}`}>
                            {c.status === "OK" ? "" : c.recovering ? "↑" : c.status[0]}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex gap-3 text-[10px] text-slate-500">
                <span><span className="inline-block h-2.5 w-3 rounded-sm bg-rose-500 align-middle" /> Short</span>
                <span><span className="inline-block h-2.5 w-3 rounded-sm bg-amber-300 align-middle" /> Low</span>
                <span><span className="inline-block h-2.5 w-3 rounded-sm bg-sky-200 align-middle" /> Overstocked</span>
                <span>Faded: after the voice clock (outlook)</span>
              </div>
            </div>
          )}
        </Card>
        <Card title={`Due into the ${s.dc} DC`} subtitle="Purchase orders for the brands this store is short or low of: units delivered (or forecast on open orders) against units ordered">
          {inboundBrands.length === 0 ? <div className="text-xs text-slate-500">No brand short or low at this store, so nothing to follow upstream.</div> : (
            <Plot
              data={inboundBrands.flatMap((b, i) => {
                const rows = data.inbound.filter((r) => r.brand === b);
                const color = ["#e11d48", "#6366f1", "#f59e0b"][i % 3];
                return [{
                  x: rows.map((r) => r.week), y: rows.map((r) => (r.ordered ? Math.round((1000 * (r.delivered + r.openForecast)) / r.ordered) / 10 : null)),
                  type: "scatter" as const, mode: "lines+markers" as const, name: `${b} fill %`, line: { color, width: 2 },
                  customdata: rows.map((r) => [r.ordered, r.delivered, r.openForecast]),
                  hovertemplate: `${b}: %{y}% of %{customdata[0]} units<extra></extra>`,
                }];
              })}
              layout={{ height: 260, margin: { l: 40, r: 10, t: 5, b: 40 }, font: PLOT_FONT, yaxis: { title: { text: "Fill %" }, range: [0, 110] }, hovermode: "x unified", legend: { orientation: "h", y: -0.25 },
                shapes: [{ type: "line", x0: data.asOf, x1: data.asOf, yref: "paper", y0: 0, y1: 1, line: { color: "#94a3b8", width: 1, dash: "dot" } }],
                annotations: [{ x: data.asOf, y: 1, yref: "paper", text: "voice clock", showarrow: false, font: { size: 9, color: "#94a3b8" }, yanchor: "bottom" }] }}
              config={PLOT_CONFIG} style={{ width: "100%" }} />
          )}
        </Card>
      </div>

      {risky.length > 0 && (
        <Card title="Risk radar for this store" subtitle="Forward weeks scored by STORE_SENTIMENT_RISK_MODEL"
          right={<StepLink href="/sentiment/risk"><Radar className="w-3.5 h-3.5" /> Risk radar</StepLink>}>
          <div className="flex flex-wrap gap-2">
            {data.risk.map((r) => (
              <div key={r.week} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px]">
                <div className="text-slate-500">Week of {fmtDate(r.week, false)}</div>
                <div className="mt-0.5 flex items-center gap-1.5"><Pill tone={BAND_TONE[r.band] ?? "slate"}>{r.band}</Pill><span className="font-mono">{fmt(r.score * 100, 0)}%</span></div>
              </div>
            ))}
          </div>
          {risky[0]?.drivers && <div className="mt-2 text-[11px] text-slate-600">Why: {risky[0].drivers}</div>}
        </Card>
      )}

      <Card title="Voice of the customer" subtitle={`Surveys, product reviews, care emails, social posts and campaign replies, four weeks to ${fmtDate(weekEnd(data.week))}. Negative first.`}>
        {data.verbatims.length === 0 ? <div className="text-xs text-slate-500">No comments in these weeks.</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.verbatims.map((v, i) => {
              const Icon = SOURCE_ICON[v.source] ?? StoreIcon;
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><Icon className="w-3 h-3" /> {v.source} · {fmtDate(v.date)}</span>
                    {v.score !== null && <NpsChip v={v.score * 10 - 40} small />}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-800">&ldquo;{v.text}&rdquo;</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Pill tone={v.theme === "Out of stock" ? "red" : v.sentiment === "positive" ? "green" : "slate"}>{v.theme}</Pill>
                    {v.brand && <Pill tone="violet">{v.brand}</Pill>}
                    {v.score !== null && <Pill tone="slate">scored {v.score}/10</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <div className="text-[10px] text-slate-400">Customer text is synthetic, built on real Baby Mart purchases, stores and dates; the AI reading of it is real. Supply status is modelled from the stock alerts.</div>
    </div>
  );
}
