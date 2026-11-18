"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw, PackageX, ArrowRight } from "lucide-react";
import { useSentiment, useSentimentAction } from "../_components/useSentiment";
import { Card, ErrorState, Loading, Kpi, StepHeader, Pill, Banner, Button, Th, Td, fmt, fmtDate, PLOT_FONT, PLOT_CONFIG } from "../_components/ui";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── 5 · Predict: where will sentiment break next? ──────────────────────────
//
// STORE_SENTIMENT_RISK_MODEL (Snowflake ML classification, sql/52) learned which
// store-weeks broke -- negative voice at three times the store's norm -- from
// what was known going into the week: brands short at the store, a campaign
// promoting one of them, the fill expected on POs into its DC, the supplier's
// DIFOT, and the store's recent voice. It scores the six weeks after the voice
// clock. Bands are by rank (the model ranks well but its probabilities are not
// calibrated). Supply is read live: after a planner approves a recovery plan,
// Re-score shows the risk it took away.

type Risk = {
  model: { name: string; trainedAt: string | null; trainingRows: number; breaks: number; firstWeek: string | null; lastWeek: string | null; auc: number | null; precision: number | null; recall: number | null; f1: number | null; support: number | null };
  importance: { feature: string; importance: number }[];
  training: { month: string; storeWeeks: number; breaks: number; withShort: number }[];
  weeks: string[]; scoredAt: string | null;
  grid: { state: string; cells: { week: string; stores: number; hot: number; critical: number; maxScore: number }[] }[];
  alerts: { code: string; name: string; state: string; firstWeek: string | null; hotWeeks: number; score: number; band: string; drivers: string | null; shortBrands: string | null; campaign: string | null; recovering: boolean; minFill: number | null; oos2w: number }[];
};

const FEATURE_LABEL: Record<string, string> = {
  DETRACTOR_RATE_8W_PCT: "Store detractor rate, last 8 weeks",
  NEG_BASE_PER_WEEK: "Store's normal negative voice",
  NEG_LAST_WEEK: "Negative voice last week",
  PRICE_LAST_2W: "Price complaints, last 2 weeks",
  OOS_LAST_2W: "Out-of-stock complaints, last 2 weeks",
  SHORT_BRAND_FILL_PCT: "Expected PO fill, short brands",
  CAMPAIGNS_LIVE: "Campaigns sending",
  SHORT_BRANDS: "Brands short at the store",
  LOW_BRANDS: "Brands low at the store",
  PROMOTED_SHORT: "Campaign promotes a short brand",
  SUPPLIER_DIFOT_PCT: "Supplier DIFOT, short brands",
};
const BAND_TONE: Record<string, "red" | "amber" | "violet" | "slate"> = { CRITICAL: "red", HIGH: "amber", ELEVATED: "violet", LOW: "slate" };

function cellCls(share: number) {
  if (share >= 0.75) return "bg-rose-600 text-white";
  if (share >= 0.5) return "bg-rose-400 text-white";
  if (share >= 0.25) return "bg-amber-300 text-amber-950";
  if (share > 0) return "bg-amber-100 text-amber-900";
  return "bg-slate-50 text-slate-300";
}

export default function RiskRadarPage() {
  const { data, error, isLoading } = useSentiment<Risk>("risk");
  const rescore = useSentimentAction<{ message: string }>("risk/rescore");
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (error) return <ErrorState message={String((error as Error).message)} />;
  if (isLoading || !data) return <Loading what="the risk forecast" />;

  const m = data.model;
  const critical = data.alerts.filter((a) => a.band === "CRITICAL").length;
  const hotStores = data.alerts.filter((a) => a.band === "CRITICAL" || a.band === "HIGH").length;
  const supplyLed = data.alerts.filter((a) => (a.band === "CRITICAL" || a.band === "HIGH") && a.shortBrands).length;
  const doRescore = async () => {
    const r = await rescore.run();
    setNote(r.ok ? { tone: "ok", text: `${r.data.message}. Supply read live from the stock alerts and any approved recovery plans.` } : { tone: "error", text: r.error });
  };

  return (
    <div className="p-6 space-y-4">
      <StepHeader step="5 · Predict" title="Risk radar: where will sentiment break next?"
        subtitle={<>Snowflake ML classification ({m.name}) scores every store for the six weeks after the voice clock, from what is already known about them: supply, campaigns booked, POs due into the DC, supplier DIFOT and the store&rsquo;s recent voice. Scored {data.scoredAt ? data.scoredAt.slice(0, 16) : "–"}.</>}
        right={<Button variant="outline" onClick={doRescore} disabled={rescore.busy}><RefreshCw className={`w-3.5 h-3.5 ${rescore.busy ? "animate-spin" : ""}`} /> {rescore.busy ? "Scoring…" : "Re-score with live supply"}</Button>} />
      {note && <Banner tone={note.tone} onClose={() => setNote(null)}>{note.text}</Banner>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Stores at HIGH or CRITICAL" value={String(hotStores)} sub={`${critical} critical · next six weeks`} emphasis />
        <Kpi label="Of them, short of a brand" value={String(supplyLed)} sub="The supply-led breaks a recovery plan can stop" />
        <Kpi label="Holdout AUC" value={fmt(m.auc, 2)} sub={`Precision ${fmt((m.precision ?? 0) * 100, 0)}% · recall ${fmt((m.recall ?? 0) * 100, 0)}% on ${fmt(m.support, 0)} held-out breaks`}
          hint="Snowflake ML's evaluation: a random 20% of the training store-weeks held out. AUC 0.5 is a coin toss, 1.0 perfect. Precision and recall are at a 50% threshold, for the 'break' class." />
        <Kpi label="Trained on" value={m.trainingRows.toLocaleString()} sub={`store-weeks, ${fmtDate(m.firstWeek)} to ${fmtDate(m.lastWeek)} · ${m.breaks} breaks`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Predicted sentiment breaks" subtitle="Share of each state's stores at HIGH or CRITICAL risk, by week">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr><Th>State</Th>{data.weeks.map((w) => <Th key={w} align="center">{fmtDate(w, false)}</Th>)}</tr>
              </thead>
              <tbody>
                {[...data.grid].sort((a, b) => Math.max(...b.cells.map((c) => c.hot / Math.max(c.stores, 1))) - Math.max(...a.cells.map((c) => c.hot / Math.max(c.stores, 1)))).map((r) => (
                  <tr key={r.state}>
                    <Td className="font-semibold text-slate-700">{r.state}</Td>
                    {r.cells.map((c) => {
                      const share = c.stores ? c.hot / c.stores : 0;
                      return (
                        <td key={c.week} className="p-0.5">
                          <div className={`rounded py-1.5 text-center font-mono text-[11px] ${cellCls(share)}`} title={`${c.hot} of ${c.stores} stores HIGH or CRITICAL (${c.critical} critical); top score ${fmt(c.maxScore * 100, 0)}%`}>
                            {share ? `${Math.round(share * 100)}%` : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="What drives the prediction" subtitle="Feature importance (share of the trees' splits)">
          <Plot
            data={[{ y: data.importance.map((f) => FEATURE_LABEL[f.feature] ?? f.feature), x: data.importance.map((f) => Math.round(f.importance * 1000) / 10), type: "bar", orientation: "h", marker: { color: "#e11d48" }, hovertemplate: "%{x}%<extra></extra>" }]}
            layout={{ height: 300, margin: { l: 210, r: 10, t: 5, b: 30 }, font: PLOT_FONT, yaxis: { autorange: "reversed" }, xaxis: { ticksuffix: "%" } }}
            config={PLOT_CONFIG} style={{ width: "100%" }} />
        </Card>
      </div>

      <Card title="Act before customers notice" subtitle="Stores the model flags, highest risk first. Click for Store 360.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100"><Th>Store</Th><Th>Risk</Th><Th>From</Th><Th align="right">Weeks hot</Th><Th>Short</Th><Th>Why</Th><Th /></tr>
            </thead>
            <tbody>
              {data.alerts.map((a) => (
                <tr key={a.code} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => { window.location.href = `/sentiment/store/${a.code}`; }}>
                  <Td><div className="font-medium text-slate-800">{a.name.replace("Baby Mart ", "")}</div><div className="text-[10px] text-slate-500">{a.state} · {a.code}</div></Td>
                  <Td><Pill tone={BAND_TONE[a.band] ?? "slate"}>{a.band}</Pill> <span className="font-mono text-slate-600">{fmt(a.score * 100, 0)}%</span></Td>
                  <Td>{a.firstWeek ? fmtDate(a.firstWeek, false) : "–"}</Td>
                  <Td align="right" mono>{a.hotWeeks}</Td>
                  <Td>{a.shortBrands ? <span className="inline-flex items-center gap-1 text-rose-700"><PackageX className="w-3 h-3" />{a.shortBrands}</span> : <span className="text-slate-400">–</span>}{a.recovering && <Pill tone="green">recovery plan</Pill>}</Td>
                  <Td className="!whitespace-normal text-[11px] leading-snug text-slate-600 min-w-[260px] max-w-[480px]">{a.drivers || "Recent voice above the store's norm"}</Td>
                  <Td><ArrowRight className="w-3.5 h-3.5 text-slate-300" /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          Stockouts are the fixable part: a brand short at the store, with a campaign promoting it, is the pattern that broke NSW. Approve a recovery plan in{" "}
          <a href="/replenishment/recovery" className="font-medium text-emerald-700 hover:underline">Stockout Recovery</a>, then re-score.
        </div>
      </Card>

      <Card title="What the model learned from" subtitle="Sentiment breaks in the training weeks by month, and how many came with a brand short at the store">
        <Plot
          data={[
            { x: data.training.map((t) => t.month), y: data.training.map((t) => t.breaks - t.withShort), type: "bar", name: "Breaks, stock in", marker: { color: "#94a3b8" } },
            { x: data.training.map((t) => t.month), y: data.training.map((t) => t.withShort), type: "bar", name: "Breaks with a brand short", marker: { color: "#e11d48" } },
          ]}
          layout={{ height: 220, margin: { l: 35, r: 10, t: 5, b: 30 }, font: PLOT_FONT, barmode: "stack", legend: { orientation: "h", y: -0.2 }, xaxis: { tickformat: "%b %y" } }}
          config={PLOT_CONFIG} style={{ width: "100%" }} />
        <div className="text-[11px] text-slate-500">
          Most past breaks were voice-led (Gold members on price from February, the website outage in March), so the store&rsquo;s own recent voice carries most of the weight. Supply-led breaks are rarer in the history but are the ones a planner can prevent.
        </div>
      </Card>
    </div>
  );
}
