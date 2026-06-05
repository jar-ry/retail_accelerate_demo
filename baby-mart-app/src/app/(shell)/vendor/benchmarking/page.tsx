"use client";

import { useState, useEffect } from "react";
import { BarChart3, Loader2, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface VendorBenchmark { supplier: string; revenue: number; margin: number; units: number; marginPct: number; growthPct: number; sharePct: number; }

const CATEGORIES = ["", "Prams & Strollers", "Car Seats", "Nappies & Wipes", "Clothing", "Feeding"];
function fmt(n: number) { if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`; if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`; return `$${n.toFixed(0)}`; }

export default function CategoryBenchmarkingPage() {
  const [category, setCategory] = useState("");
  const [data, setData] = useState<VendorBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/vendor/benchmarking${category ? `?category=${encodeURIComponent(category)}` : ""}`).then((r) => r.json()).then((d) => { if (Array.isArray(d)) setData(d); }).catch(() => {}).finally(() => setLoading(false));
  }, [category]);

  const fetchInsights = async () => {
    setInsightLoading(true);
    const top5 = data.slice(0, 5);
    const prompt = `You are a category analyst for Baby Mart. Analyze this vendor benchmarking data${category ? ` for ${category}` : " across all categories"}:
${top5.map((v) => `- ${v.supplier}: Revenue ${fmt(v.revenue)}, Margin ${v.marginPct}%, Growth ${v.growthPct}%, Share ${v.sharePct}%`).join("\n")}
Total vendors: ${data.length}

Provide 3-4 bullet points: identify High Performers (high growth + high margin), Margin Leaders (low growth + high margin), Growth Potential vendors (high growth + low margin), and vendors Under Review. Recommend actions for vendor negotiations. Be specific with numbers.`;
    try {
      const res = await fetch("/api/vendor/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const d = await res.json();
      setAiInsight(d.text || "");
    } catch {} finally { setInsightLoading(false); }
  };

  const avgMargin = data.length > 0 ? data.reduce((s, v) => s + v.marginPct, 0) / data.length : 35;
  const avgGrowth = data.length > 0 ? data.reduce((s, v) => s + v.growthPct, 0) / data.length : 10;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Vendor Performance Matrix</h1>
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div> : (
        <>
          {/* Scatter plot: Growth vs Margin, bubble = share */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Growth vs Margin (bubble = revenue share)</h3>
            <Plot
              data={[{
                x: data.map((v) => v.growthPct),
                y: data.map((v) => v.marginPct),
                text: data.map((v) => v.supplier),
                mode: "markers+text" as const,
                type: "scatter" as const,
                marker: { size: data.map((v) => Math.max(v.sharePct * 3, 8)), color: data.map((v) => v.growthPct > avgGrowth && v.marginPct > avgMargin ? "#10b981" : v.growthPct > avgGrowth ? "#f59e0b" : v.marginPct > avgMargin ? "#2563eb" : "#94a3b8"), opacity: 0.75 },
                textposition: "top center" as const,
                textfont: { size: 9 },
              }]}
              layout={{
                height: 350, margin: { l: 55, r: 30, t: 20, b: 50 },
                xaxis: { title: { text: "Growth %", font: { size: 11 } }, zeroline: true },
                yaxis: { title: { text: "Margin %", font: { size: 11 } } },
                shapes: [
                  { type: "line" as const, x0: avgGrowth, x1: avgGrowth, y0: 0, y1: 1, yref: "paper" as const, line: { color: "#cbd5e1", dash: "dot" as const, width: 1 } },
                  { type: "line" as const, y0: avgMargin, y1: avgMargin, x0: 0, x1: 1, xref: "paper" as const, line: { color: "#cbd5e1", dash: "dot" as const, width: 1 } },
                ],
                annotations: [
                  { x: 0.95, y: 0.95, xref: "paper" as const, yref: "paper" as const, text: "High Perform.", showarrow: false, font: { size: 10, color: "#10b981" } },
                  { x: 0.05, y: 0.95, xref: "paper" as const, yref: "paper" as const, text: "Margin Leaders", showarrow: false, font: { size: 10, color: "#2563eb" } },
                  { x: 0.95, y: 0.05, xref: "paper" as const, yref: "paper" as const, text: "Growth Potential", showarrow: false, font: { size: 10, color: "#f59e0b" } },
                  { x: 0.05, y: 0.05, xref: "paper" as const, yref: "paper" as const, text: "Under Review", showarrow: false, font: { size: 10, color: "#94a3b8" } },
                ],
                font: { family: "Inter, system-ui" },
                showlegend: false,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </div>

          <div className="grid grid-cols-[2fr_1fr] gap-4">
            {/* Vendor Ranking Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-800">Vendor Rankings</h3></div>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                  <th className="text-left px-4 py-2">#</th><th className="text-left px-2 py-2">Vendor</th>
                  <th className="text-right px-2 py-2">Revenue</th><th className="text-right px-2 py-2">Margin %</th>
                  <th className="text-right px-2 py-2">Growth %</th><th className="text-right px-3 py-2">Share %</th>
                </tr></thead>
                <tbody>
                  {data.map((v, i) => (
                    <tr key={v.supplier} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-400">{i + 1}</td>
                      <td className="px-2 py-2 font-medium text-slate-700">{v.supplier}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmt(v.revenue)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${v.marginPct >= avgMargin ? "text-emerald-600" : "text-red-500"}`}>{v.marginPct}%</td>
                      <td className={`px-2 py-2 text-right font-mono ${v.growthPct > 0 ? "text-emerald-600" : "text-red-500"}`}>{v.growthPct > 0 ? "+" : ""}{v.growthPct}%</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-600">{v.sharePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* AI Insights */}
            <div className="bg-blue-50 rounded-xl p-5 border border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-500" />AI Analysis</h4>
                <button onClick={fetchInsights} className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700">Analyze</button>
              </div>
              {insightLoading ? <div className="space-y-2"><div className="h-3 bg-blue-200/50 rounded animate-pulse w-[90%]" /><div className="h-3 bg-blue-200/50 rounded animate-pulse w-[70%]" /></div> : aiInsight ? <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{aiInsight}</div> : <div className="text-xs text-slate-400 italic">Click Analyze for AI-powered vendor positioning insights</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
