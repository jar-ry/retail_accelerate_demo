"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { TrendingUp, TrendingDown, AlertTriangle, LayoutDashboard, Loader2 } from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function fmt(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load dashboard: {data?.error || "Unknown error"}
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "Revenue (L28D)", value: fmt(data.totalRevenue), delta: `${data.revenueGrowth > 0 ? "+" : ""}${data.revenueGrowth}%`, positive: data.revenueGrowth >= 0 },
    { label: "Transactions (L28D)", value: `${(data.totalTransactions / 1e3).toFixed(1)}K`, delta: `${data.transactionGrowth > 0 ? "+" : ""}${data.transactionGrowth}%`, positive: data.transactionGrowth >= 0 },
    { label: "Avg Basket", value: `$${data.avgBasket?.toFixed(2)}`, delta: "", positive: true },
    { label: "Gross Margin", value: `${data.avgMargin?.toFixed(1)}%`, delta: "", positive: true },
  ];

  // Bubble chart data
  const catColors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];
  const bubbleTrace = {
    type: "scatter" as const,
    mode: "markers+text" as const,
    x: data.categories.map((c: any) => c.growth),
    y: data.categories.map((c: any) => Number(c.margin)),
    text: data.categories.map((c: any) => c.category),
    textposition: "top center" as const,
    textfont: { size: 11, family: "Inter, sans-serif" },
    marker: {
      size: data.categories.map((c: any) => Math.sqrt(c.revenue / 1000) * 3),
      sizemode: "area" as const,
      color: catColors.slice(0, data.categories.length),
      opacity: 0.6,
      line: { width: 2, color: "white" },
    },
    hovertemplate: data.categories.map((c: any) =>
      `<b>${c.category}</b><br>Growth: ${c.growth}%<br>Gross Margin: ${c.margin}%<br>Revenue: ${fmt(c.revenue)}<extra></extra>`
    ),
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Category Performance Dashboard</h1>
        </div>
        <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md font-medium">Last 28 Days vs PY</div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{kpi.label}</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{kpi.value}</div>
            {kpi.delta && (
              <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${kpi.positive ? "text-emerald-600" : "text-red-600"}`}>
                {kpi.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {kpi.delta} YoY
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Category Performance Matrix */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">Category Performance Matrix</h3>
          <span className="text-xs text-slate-400">Bubble size = Revenue</span>
        </div>
        <Plot
          data={[bubbleTrace]}
          layout={{
            height: 340,
            margin: { t: 20, r: 30, b: 50, l: 60 },
            xaxis: { title: { text: "YoY Growth (%)", font: { size: 11 } }, zeroline: false, gridcolor: "#f1f5f9" },
            yaxis: { title: { text: "Gross Margin (%)", font: { size: 11 } }, zeroline: false, gridcolor: "#f1f5f9" },
            showlegend: false,
            plot_bgcolor: "#f8fafc",
            paper_bgcolor: "white",
            font: { family: "Inter, sans-serif", size: 11, color: "#475569" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      {/* Top & Bottom Performers */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Top Performers (Growth)</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-1.5 text-xs font-semibold text-slate-500">Brand</th>
                <th className="text-left py-1.5 text-xs font-semibold text-slate-500">Category</th>
                <th className="text-right py-1.5 text-xs font-semibold text-slate-500">Revenue</th>
                <th className="text-right py-1.5 text-xs font-semibold text-slate-500">Growth</th>
              </tr>
            </thead>
            <tbody>
              {data.topBrands?.map((b: any) => (
                <tr key={b.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link href={`/brand/${encodeURIComponent(b.name)}`} className="font-medium text-blue-700 hover:underline">{b.name}</Link>
                  </td>
                  <td className="py-2 text-slate-600">{b.category}</td>
                  <td className="py-2 text-right font-mono">{fmt(b.revenue)}</td>
                  <td className="py-2 text-right font-mono text-emerald-600 font-semibold">+{b.growth}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-slate-800">Underperformers (Declining)</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-1.5 text-xs font-semibold text-slate-500">Brand</th>
                <th className="text-left py-1.5 text-xs font-semibold text-slate-500">Category</th>
                <th className="text-right py-1.5 text-xs font-semibold text-slate-500">Revenue</th>
                <th className="text-right py-1.5 text-xs font-semibold text-slate-500">Growth</th>
              </tr>
            </thead>
            <tbody>
              {data.bottomBrands?.map((b: any) => (
                <tr key={b.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link href={`/brand/${encodeURIComponent(b.name)}`} className="font-medium text-blue-700 hover:underline">{b.name}</Link>
                  </td>
                  <td className="py-2 text-slate-600">{b.category}</td>
                  <td className="py-2 text-right font-mono">{fmt(b.revenue)}</td>
                  <td className="py-2 text-right font-mono text-red-600 font-semibold">{b.growth}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category Breakdown Table */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Category Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Category</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500 pl-4">Share</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs PY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Gross Margin</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Brands</th>
            </tr>
          </thead>
          <tbody>
            {data.categories?.map((c: any) => (
              <tr key={c.category} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2.5 font-medium text-slate-700">{c.category}</td>
                <td className="py-2.5 text-right font-mono">{fmt(c.revenue)}</td>
                <td className="py-2.5 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-slate-500">{c.pct}%</span>
                  </div>
                </td>
                <td className={`py-2.5 text-right font-mono ${c.growth >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {c.growth >= 0 ? "+" : ""}{c.growth}%
                </td>
                <td className="py-2.5 text-right font-mono text-slate-600">{c.margin}%</td>
                <td className="py-2.5 text-right font-mono text-slate-600">{c.brandCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
