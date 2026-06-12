"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { TrendingUp, TrendingDown, AlertTriangle, LayoutDashboard, Loader2 } from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

function fmt(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Prams & Strollers": "#3b82f6",
  "Car Seats": "#8b5cf6",
  "Nappies & Wipes": "#10b981",
  "Clothing": "#f59e0b",
  "Feeding": "#ef4444",
};

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("All");

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredBrands = useMemo(() => {
    if (!data?.allBrands) return [];
    if (categoryFilter === "All") return data.allBrands;
    return data.allBrands.filter((b: any) => b.category === categoryFilter);
  }, [data, categoryFilter]);

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

  // Brand performance matrix with quadrants
  const avgGrowth = filteredBrands.reduce((s: number, b: any) => s + b.growth, 0) / (filteredBrands.length || 1);
  const avgMargin = filteredBrands.reduce((s: number, b: any) => s + b.margin, 0) / (filteredBrands.length || 1);

  const matrixTrace = {
    type: "scatter" as const,
    mode: "markers+text" as const,
    x: filteredBrands.map((b: any) => b.growth),
    y: filteredBrands.map((b: any) => b.margin),
    text: filteredBrands.map((b: any) => b.name),
    textposition: "top center" as const,
    textfont: { size: 10, family: "Inter, sans-serif" },
    marker: {
      size: filteredBrands.map((b: any) => Math.sqrt(b.revenue / 500) * 2.5),
      sizemode: "area" as const,
      color: filteredBrands.map((b: any) => CATEGORY_COLORS[b.category] || "#94a3b8"),
      opacity: 0.7,
      line: { width: 1.5, color: "white" },
    },
    hovertemplate: filteredBrands.map((b: any) =>
      `<b>${b.name}</b><br>Category: ${b.category}<br>Growth: ${b.growth?.toFixed(1)}%<br>Gross Margin: ${b.margin?.toFixed(1)}%<br>Revenue: ${fmt(b.revenue)}<extra></extra>`
    ),
    customdata: filteredBrands.map((b: any) => b.name),
  };

  const xRange = filteredBrands.length > 0 ? [
    Math.min(...filteredBrands.map((b: any) => b.growth)) - 3,
    Math.max(...filteredBrands.map((b: any) => b.growth)) + 3,
  ] : [-10, 10];
  const yRange = filteredBrands.length > 0 ? [
    Math.min(...filteredBrands.map((b: any) => b.margin)) - 3,
    Math.max(...filteredBrands.map((b: any) => b.margin)) + 3,
  ] : [20, 50];

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

      {/* Brand Performance Matrix */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Brand Performance Matrix</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Bubble size = Revenue</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="All">All Categories</option>
              {data.categories?.map((c: any) => (
                <option key={c.category} value={c.category}>{c.category}</option>
              ))}
            </select>
          </div>
        </div>
        <Plot
          data={[matrixTrace]}
          layout={{
            height: 380,
            margin: { t: 30, r: 40, b: 50, l: 60 },
            xaxis: { title: { text: "YoY Growth (%)", font: { size: 11 } }, zeroline: false, gridcolor: "#f1f5f9", range: xRange },
            yaxis: { title: { text: "Gross Margin (%)", font: { size: 11 } }, zeroline: false, gridcolor: "#f1f5f9", range: yRange },
            showlegend: false,
            plot_bgcolor: "#f8fafc",
            paper_bgcolor: "white",
            font: { family: "Inter, sans-serif", size: 11, color: "#475569" },
            shapes: [
              { type: "line" as const, x0: avgGrowth, x1: avgGrowth, y0: yRange[0], y1: yRange[1], line: { dash: "dot" as const, color: "#cbd5e1", width: 1.5 } },
              { type: "line" as const, x0: xRange[0], x1: xRange[1], y0: avgMargin, y1: avgMargin, line: { dash: "dot" as const, color: "#cbd5e1", width: 1.5 } },
            ],
            annotations: [
              { x: xRange[1] - 1, y: yRange[1] - 1, text: "High Perform.", showarrow: false, font: { size: 9, color: "#10b981" } },
              { x: xRange[0] + 1, y: yRange[1] - 1, text: "Margin Leaders", showarrow: false, font: { size: 9, color: "#3b82f6" } },
              { x: xRange[1] - 1, y: yRange[0] + 1, text: "Growth Potential", showarrow: false, font: { size: 9, color: "#f59e0b" } },
              { x: xRange[0] + 1, y: yRange[0] + 1, text: "Under Review", showarrow: false, font: { size: 9, color: "#ef4444" } },
            ],
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
        {categoryFilter === "All" && (
          <div className="flex items-center gap-4 mt-2 justify-center">
            {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
              <div key={cat} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-slate-500">{cat}</span>
              </div>
            ))}
          </div>
        )}
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
