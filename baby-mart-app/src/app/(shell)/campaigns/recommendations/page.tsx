"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader2, Sparkles, Eye, MousePointer, ShoppingCart, DollarSign, ArrowRightLeft, TrendingUp, RefreshCw } from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function fmt(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const TYPE_COLORS: Record<string, string> = { cross_sell: "#10b981", upsell: "#3b82f6", replenishment: "#94a3b8" };
const TYPE_LABELS: Record<string, string> = { cross_sell: "Cross-Sell", upsell: "Upsell", replenishment: "Replenishment" };

export default function ProductRecommendationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [segFilter, setSegFilter] = useState("All");
  const [catFilter, setCatFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");

  useEffect(() => {
    fetch("/api/recommendations")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data?.recommendations) return [];
    return data.recommendations.filter((r: any) => {
      if (segFilter !== "All" && r.segment !== segFilter) return false;
      if (catFilter !== "All" && r.category !== catFilter) return false;
      if (typeFilter !== "All" && r.type !== typeFilter) return false;
      return true;
    });
  }, [data, segFilter, catFilter, typeFilter]);

  if (loading) {
    return <div className="p-6 flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;
  }

  if (!data || data.error) {
    return <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Failed to load: {data?.error || "Unknown error"}</div></div>;
  }

  const { totals, typeBreakdown, categoryByType } = data;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Product Recommendations</h1>
            <p className="text-xs text-slate-500">Evergreen campaign — hybrid content + collaborative filtering model</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">Model {totals.modelVersion}</span>
          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-semibold">LIVE</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Sparkles className="w-3.5 h-3.5 text-amber-500" /><span className="text-[10px] font-semibold text-slate-400 uppercase">Active</span></div>
          <div className="font-mono text-xl font-bold text-slate-900">{totals.active}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Eye className="w-3.5 h-3.5 text-blue-500" /><span className="text-[10px] font-semibold text-slate-400 uppercase">Impressions</span></div>
          <div className="font-mono text-xl font-bold text-slate-900">{(totals.impressions / 1e3).toFixed(0)}K</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><MousePointer className="w-3.5 h-3.5 text-purple-500" /><span className="text-[10px] font-semibold text-slate-400 uppercase">CTR</span></div>
          <div className="font-mono text-xl font-bold text-purple-600">{totals.avgCtr.toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><ShoppingCart className="w-3.5 h-3.5 text-emerald-500" /><span className="text-[10px] font-semibold text-slate-400 uppercase">Conv Rate</span></div>
          <div className="font-mono text-xl font-bold text-emerald-600">{totals.avgConvRate.toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><DollarSign className="w-3.5 h-3.5 text-blue-600" /><span className="text-[10px] font-semibold text-slate-400 uppercase">Revenue</span></div>
          <div className="font-mono text-xl font-bold text-blue-700">{fmt(totals.revenue)}</div>
        </div>
      </div>

      {/* Revenue Split: Donut + Category Bar */}
      <div className="grid grid-cols-[1fr_2fr] gap-4 mb-6">
        {/* Donut: Cross-sell / Upsell / Replenishment */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Revenue by Type</h3>
          <p className="text-xs text-slate-500 mb-3">
            <ArrowRightLeft className="w-3 h-3 inline" /> Cross-selling drives <span className="font-bold text-emerald-600">{totals.crossSellPct}%</span> of revenue
          </p>
          <Plot
            data={[{
              type: "pie" as const,
              values: typeBreakdown.map((t: any) => t.revenue),
              labels: typeBreakdown.map((t: any) => TYPE_LABELS[t.type] || t.type),
              marker: { colors: typeBreakdown.map((t: any) => TYPE_COLORS[t.type] || "#94a3b8") },
              hole: 0.55,
              textinfo: "percent+label" as const,
              textposition: "outside" as const,
              textfont: { size: 10 },
              hovertemplate: typeBreakdown.map((t: any) =>
                `<b>${TYPE_LABELS[t.type]}</b><br>Revenue: ${fmt(t.revenue)}<br>Recs: ${t.count}<br>Conv: ${t.avgConvRate.toFixed(1)}%<extra></extra>`
              ),
            }]}
            layout={{
              height: 220,
              margin: { t: 10, r: 10, b: 10, l: 10 },
              showlegend: false,
              font: { family: "Inter, system-ui", size: 10 },
              paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
          <div className="flex items-center justify-center gap-4 mt-2">
            {typeBreakdown.map((t: any) => (
              <div key={t.type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[t.type] }} />
                <span className="text-[10px] text-slate-500">{TYPE_LABELS[t.type]}: {fmt(t.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category × Type Bar Chart */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Category Performance by Recommendation Type</h3>
          <p className="text-xs text-slate-500 mb-3">Which categories drive the most cross-sell and upsell revenue?</p>
          <Plot
            data={[
              {
                type: "bar" as const,
                name: "Cross-Sell",
                x: categoryByType.map((c: any) => c.category),
                y: categoryByType.map((c: any) => c.cross_sell || 0),
                marker: { color: TYPE_COLORS.cross_sell },
              },
              {
                type: "bar" as const,
                name: "Upsell",
                x: categoryByType.map((c: any) => c.category),
                y: categoryByType.map((c: any) => c.upsell || 0),
                marker: { color: TYPE_COLORS.upsell },
              },
              {
                type: "bar" as const,
                name: "Replenishment",
                x: categoryByType.map((c: any) => c.category),
                y: categoryByType.map((c: any) => c.replenishment || 0),
                marker: { color: TYPE_COLORS.replenishment },
              },
            ]}
            layout={{
              height: 260,
              margin: { t: 10, r: 20, b: 60, l: 50 },
              barmode: "stack" as const,
              yaxis: { title: { text: "Revenue (AUD)", font: { size: 10 } }, gridcolor: "#f1f5f9" },
              xaxis: { tickangle: -15 },
              showlegend: true,
              legend: { orientation: "h" as const, y: -0.25, x: 0.5, xanchor: "center" as const, font: { size: 10 } },
              font: { family: "Inter, system-ui", size: 10 },
              plot_bgcolor: "#f8fafc",
              paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>
      </div>

      {/* Type Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {typeBreakdown.map((t: any) => (
          <div key={t.type} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[t.type] }} />
              <span className="text-xs font-semibold text-slate-700">{TYPE_LABELS[t.type]}</span>
              {t.type === "cross_sell" && <ArrowRightLeft className="w-3 h-3 text-emerald-500" />}
              {t.type === "upsell" && <TrendingUp className="w-3 h-3 text-blue-500" />}
              {t.type === "replenishment" && <RefreshCw className="w-3 h-3 text-slate-400" />}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[10px] text-slate-400">Recs</div><div className="font-mono text-sm font-bold">{t.count}</div></div>
              <div><div className="text-[10px] text-slate-400">Conv %</div><div className="font-mono text-sm font-bold">{t.avgConvRate.toFixed(1)}%</div></div>
              <div><div className="text-[10px] text-slate-400">Revenue</div><div className="font-mono text-sm font-bold">{fmt(t.revenue)}</div></div>
            </div>
          </div>
        ))}
      </div>

      {/* Drill-Down Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Recommendation Details</h3>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
              <option value="All">All Types</option>
              <option value="cross_sell">Cross-Sell</option>
              <option value="upsell">Upsell</option>
              <option value="replenishment">Replenishment</option>
            </select>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
              <option value="All">All Categories</option>
              {[...new Set(data.recommendations.map((r: any) => r.category))].sort().map((c: any) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={segFilter} onChange={(e) => setSegFilter(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700">
              <option value="All">All Segments</option>
              {data.segments.map((s: any) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                <th className="text-left px-4 py-2.5">Product</th>
                <th className="text-left px-2 py-2.5">Brand</th>
                <th className="text-left px-2 py-2.5">Type</th>
                <th className="text-left px-2 py-2.5">Segment</th>
                <th className="text-left px-2 py-2.5">Source → Target</th>
                <th className="text-right px-2 py-2.5">Score</th>
                <th className="text-left px-2 py-2.5 max-w-[180px]">Reason</th>
                <th className="text-right px-2 py-2.5">CTR</th>
                <th className="text-right px-2 py-2.5">Conv</th>
                <th className="text-right px-3 py-2.5">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec: any, i: number) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[160px] truncate">{rec.product}</td>
                  <td className="px-2 py-2.5 text-slate-500">{rec.brand}</td>
                  <td className="px-2 py-2.5">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ backgroundColor: `${TYPE_COLORS[rec.type]}20`, color: TYPE_COLORS[rec.type] }}>
                      {TYPE_LABELS[rec.type]}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-medium">{rec.segment}</span>
                  </td>
                  <td className="px-2 py-2.5 text-[10px] text-slate-500">
                    {rec.sourceCategory} → {rec.category}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={`font-mono font-semibold ${rec.score >= 0.9 ? "text-emerald-600" : rec.score >= 0.85 ? "text-blue-600" : "text-amber-600"}`}>
                      {rec.score.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-slate-500 max-w-[180px] truncate" title={rec.reason}>{rec.reason}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{(rec.ctr * 100).toFixed(1)}%</td>
                  <td className="px-2 py-2.5 text-right font-mono">{(rec.convRate * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800">{fmt(rec.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2 border-t border-slate-100 text-xs text-slate-400">
          Showing {filtered.length} of {data.recommendations.length} recommendations
        </div>
      </div>
    </div>
  );
}
