"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles, Map as MapIcon, Bot } from "lucide-react";
import { useSentiment } from "./_components/useSentiment";
import { Card, ErrorState, Loading, Kpi, StepHeader, WeekSelect, StepLink, NpsChip, npsColor, fmt, signed, fmtDate, PLOT_FONT, PLOT_CONFIG, SERIES } from "./_components/ui";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── 1 · Detect: the customer sentiment pulse ────────────────────────────────
//
// National NPS week by week from the NPS surveys, with the focus week against
// the four weeks before it, the categories and member tiers that moved, and the
// state that fell furthest. When the week breaks, the banner sends the analyst
// to the map (where) and the investigator (why).

type Cmp = { nps: number | null; baseline: number | null; change: number | null; responses: number; baselineResponses: number; oos: number; oosBaselinePerWeek: number | null; negative: number; negativeBaselinePerWeek: number | null; lowSample: boolean; detractorRate: number | null };
type Pulse = {
  asOf: string; week: string; weeks: string[];
  kpis: Cmp & { sentiment: number | null; sentimentBaseline: number | null };
  weekly: { week: string; responses: number; nps: number | null; rolling4: number | null; oos: number; negative: number }[];
  categories: (Cmp & { category: string; four: Cmp })[];
  categoryLines: { name: string; points: { week: string; nps: number | null }[] }[];
  tierLines: { name: string; points: { week: string; nps: number | null }[] }[];
  states: (Cmp & { state: string })[];
  hotspot: (Cmp & { state: string }) | null;
  rising: { theme: string; week: number; baselinePerWeek: number | null; multiple: number | null }[];
};

export default function PulsePage() {
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, isLoading } = useSentiment<Pulse>("pulse", { week });
  if (error) return <ErrorState message={String((error as Error).message)} />;
  if (isLoading || !data) return <Loading what="the sentiment pulse" />;

  const k = data.kpis, hot = data.hotspot;
  const oosX = k.oosBaselinePerWeek ? k.oos / k.oosBaselinePerWeek : null;
  const broke = (k.change ?? 0) <= -5 || (hot && (hot.change ?? 0) <= -15);
  const top = data.rising[0];
  const ask = hot ? `Why did ${hot.state} NPS fall in the week of ${fmtDate(data.week)}?` : `Why did NPS fall in the week of ${fmtDate(data.week)}?`;

  return (
    <div className="p-6 space-y-5">
      <StepHeader step="1 · Detect" title="Customer sentiment pulse"
        subtitle={<>NPS from {data.weekly.reduce((a, w) => a + w.responses, 0).toLocaleString()} post-purchase surveys since July 2025, with the AI reading (AI_SENTIMENT, AI_CLASSIFY) of every survey comment, product review, care email, social post and campaign reply. Voice to {fmtDate(data.asOf)}.</>}
        right={<WeekSelect weeks={data.weeks} value={data.week} onChange={setWeek} />} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="National NPS" value={fmt(k.nps)} change={k.change} emphasis
          sub={`vs ${fmt(k.baseline)} over the 4 weeks before`} hint="100 x (promoters - detractors) / survey responses, from counts. Promoters score 9-10, detractors 0-6." />
        <Kpi label="Survey responses" value={String(k.responses)} sub={`${Math.round(k.baselineResponses / 4)} a week before`} />
        <Kpi label="Out-of-stock complaints" value={String(k.oos)} change={k.oosBaselinePerWeek === null ? null : Math.round(k.oos - k.oosBaselinePerWeek)} changeUnit="" invert decimals={0}
          sub={oosX ? `${fmt(oosX)}x the weekly baseline (${fmt(k.oosBaselinePerWeek)})` : "AI_CLASSIFY theme, all sources"} hint="Every voice item AI_CLASSIFY reads as 'Out of stock': surveys, reviews, care emails, social posts and campaign replies." />
        <Kpi label="AI sentiment index" value={fmt(k.sentiment, 0)} change={k.sentimentBaseline === null || k.sentiment === null ? null : k.sentiment - k.sentimentBaseline} changeUnit="" decimals={0}
          sub="AI_SENTIMENT across all voice, -100 to +100" hint="100 x the mean sentiment score (positive +1, neutral or mixed 0, negative -1) over every voice item that week." />
      </div>

      {broke && (
        <div className="rounded-xl border border-rose-200 bg-gradient-to-r from-rose-50 to-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-rose-600 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-rose-900">
                {hot && (hot.change ?? 0) <= -15
                  ? <>Sentiment break: {hot.state} NPS {fmt(hot.nps)} in the week of {fmtDate(data.week)}, {signed(hot.change)} pts on the four weeks before</>
                  : <>National NPS down {fmt(Math.abs(k.change ?? 0))} pts in the week of {fmtDate(data.week)}</>}
              </div>
              <div className="text-xs text-rose-800 mt-0.5">
                {top ? <>Fastest-rising complaint: <span className="font-medium">{top.theme}</span>, {top.week} mentions against {fmt(top.baselinePerWeek)} a week before{top.multiple ? ` (${fmt(top.multiple)}x)` : ""}. </> : null}
                Find where it is happening, then ask why.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <StepLink href={`/sentiment/map${hot ? `?state=${hot.state}&week=${data.week}` : ""}`}><MapIcon className="w-3.5 h-3.5" /> Open the state map</StepLink>
            <StepLink primary href={`/sentiment/investigate?q=${encodeURIComponent(ask)}`}><Bot className="w-3.5 h-3.5" /> Investigate</StepLink>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="National NPS, weekly" subtitle="Each week's surveys, and the four-week rolling NPS. Click a week to focus the page on it.">
          <Plot
            data={[
              { x: data.weekly.map((w) => w.week), y: data.weekly.map((w) => w.oos), type: "bar", name: "Out-of-stock complaints", yaxis: "y2", marker: { color: "rgba(225,29,72,0.25)" }, hovertemplate: "%{y} out-of-stock complaints<extra></extra>" },
              { x: data.weekly.map((w) => w.week), y: data.weekly.map((w) => w.nps), type: "scatter", mode: "lines+markers", name: "NPS (week)", line: { color: "#94a3b8", width: 1 }, marker: { size: 4, color: "#94a3b8" }, hovertemplate: "NPS %{y} on %{customdata} surveys<extra></extra>", customdata: data.weekly.map((w) => w.responses) },
              { x: data.weekly.map((w) => w.week), y: data.weekly.map((w) => w.rolling4), type: "scatter", mode: "lines", name: "NPS (4-week rolling)", line: { color: "#0f766e", width: 3 }, hovertemplate: "4-week NPS %{y}<extra></extra>" },
            ]}
            layout={{
              height: 300, margin: { l: 40, r: 50, t: 10, b: 40 }, font: PLOT_FONT, showlegend: true,
              legend: { orientation: "h", y: -0.18, x: 0 }, hovermode: "x unified",
              yaxis: { title: { text: "NPS" }, zeroline: true, zerolinecolor: "#cbd5e1" },
              yaxis2: { overlaying: "y", side: "right", showgrid: false, title: { text: "Out of stock" } },
              shapes: [{ type: "line", x0: data.week, x1: data.week, yref: "paper", y0: 0, y1: 1, line: { color: "#e11d48", width: 1.5, dash: "dot" } }],
            }}
            config={PLOT_CONFIG} style={{ width: "100%" }}
            onClick={(e) => { const x = e?.points?.[0]?.x; if (typeof x === "string" && data.weeks.includes(x.slice(0, 10))) setWeek(x.slice(0, 10)); }}
          />
        </Card>

        <Card title="States this week" subtitle="NPS against the four weeks before. * fewer than 20 surveys.">
          <div className="space-y-1.5">
            {[...data.states].sort((a, b) => (a.change ?? 99) - (b.change ?? 99)).map((s) => (
              <a key={s.state} href={`/sentiment/map?state=${s.state}&week=${data.week}`} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                <span className="w-9 text-xs font-semibold text-slate-700">{s.state}</span>
                <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                  {!s.lowSample && <div className="h-full rounded" style={{ width: `${Math.max(3, Math.min(100, ((s.nps ?? 0) + 40) / 0.9))}%`, background: npsColor(s.nps) }} />}
                </div>
                <NpsChip v={s.lowSample ? null : s.nps} small />
                <span className={`w-14 text-right font-mono text-[11px] ${(s.change ?? 0) <= -10 ? "text-rose-700 font-semibold" : "text-slate-500"}`}>
                  {s.lowSample ? "*" : `${signed(s.change, 0)}`}
                </span>
              </a>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Categories this week" subtitle="Survey NPS by the product bought, against the four weeks before">
          <table className="w-full text-xs">
            <tbody>
              {data.categories.map((c) => (
                <tr key={c.category} className="border-t border-slate-100">
                  <td className="py-1.5 text-slate-700">{c.category}</td>
                  <td className="py-1.5 text-right"><NpsChip v={c.lowSample ? null : c.nps} small /></td>
                  <td className={`py-1.5 text-right font-mono ${(c.change ?? 0) <= -10 ? "text-rose-700 font-semibold" : "text-slate-500"}`}>{c.lowSample ? "*" : signed(c.change, 0)}</td>
                  <td className="py-1.5 text-right font-mono text-slate-400">{c.responses}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-slate-400">Columns: NPS, change in points, surveys. * fewer than 20 surveys.</div>
        </Card>
        <Card title="NPS by category" subtitle="Four-week rolling">
          <Plot
            data={data.categoryLines.map((l, i) => ({ x: l.points.map((p) => p.week), y: l.points.map((p) => p.nps), type: "scatter" as const, mode: "lines" as const, name: l.name, line: { color: SERIES[i % SERIES.length], width: l.name === "Nappies & Wipes" ? 2.5 : 1.5 } }))}
            layout={{ height: 240, margin: { l: 35, r: 10, t: 5, b: 30 }, font: PLOT_FONT, legend: { orientation: "h", y: -0.25, font: { size: 9 } }, hovermode: "x unified",
              shapes: [{ type: "line", x0: data.week, x1: data.week, yref: "paper", y0: 0, y1: 1, line: { color: "#e11d48", width: 1, dash: "dot" } }] }}
            config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
        <Card title="NPS by loyalty tier" subtitle="Four-week rolling: Gold & Platinum members against everyone else">
          <Plot
            data={data.tierLines.map((l, i) => ({ x: l.points.map((p) => p.week), y: l.points.map((p) => p.nps), type: "scatter" as const, mode: "lines" as const, name: l.name, line: { color: i === 0 ? "#b45309" : "#64748b", width: 2 } }))}
            layout={{ height: 240, margin: { l: 35, r: 10, t: 5, b: 30 }, font: PLOT_FONT, legend: { orientation: "h", y: -0.25, font: { size: 9 } }, hovermode: "x unified",
              shapes: [{ type: "line", x0: data.week, x1: data.week, yref: "paper", y0: 0, y1: 1, line: { color: "#e11d48", width: 1, dash: "dot" } }] }}
            config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
      </div>

      <Card title="What customers are saying more of" subtitle={`Negative mentions by AI_CLASSIFY theme in the week of ${fmtDate(data.week)}, against the weekly average of the four weeks before`}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {data.rising.map((t) => (
            <div key={t.theme} className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] font-medium text-slate-600">{t.theme}</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-900">{t.week}</div>
              <div className="text-[11px] text-slate-500">vs {fmt(t.baselinePerWeek)} a week{t.multiple ? ` · ${fmt(t.multiple)}x` : ""}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
