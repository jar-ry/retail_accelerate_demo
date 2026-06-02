import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Truck, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
// @ts-ignore
import Plot from "react-plotly.js";

interface BrandDifot {
  brand: string;
  category: string;
  avgDifot: number;
  latestDifot: number;
  totalOrders: number;
  totalOnTime: number;
  weeksBelowTarget: number;
}

function getDifotColor(difot: number): string {
  if (difot >= 96) return "text-emerald-600";
  if (difot >= 92) return "text-amber-600";
  return "text-red-600";
}

function getDifotBarColor(difot: number): string {
  if (difot >= 96) return "#10b981";
  if (difot >= 92) return "#f59e0b";
  return "#ef4444";
}

export default function SupplierDifotPage() {
  const [brands, setBrands] = useState<BrandDifot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supply/difot/overview")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBrands(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading DIFOT data...</p>
      </div>
    );
  }

  const avgAll = brands.length > 0 ? (brands.reduce((s, b) => s + b.avgDifot, 0) / brands.length).toFixed(1) : "0";
  const aboveTarget = brands.filter((b) => b.avgDifot >= 96).length;
  const belowTarget = brands.filter((b) => b.avgDifot < 96).length;
  const totalOrders = brands.reduce((s, b) => s + b.totalOrders, 0);

  const chartData = [{
    type: "bar" as const,
    orientation: "h" as const,
    y: brands.map((b) => b.brand),
    x: brands.map((b) => b.avgDifot),
    marker: { color: brands.map((b) => getDifotBarColor(b.avgDifot)) },
    text: brands.map((b) => `${b.avgDifot}%`),
    textposition: "outside" as const,
    textfont: { size: 10 },
  }];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Truck className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Supplier DIFOT Performance</h1>
        </div>
        <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md font-medium">YTD 2026</div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Avg DIFOT</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${getDifotColor(parseFloat(avgAll))}`}>{avgAll}%</div>
          <div className="mt-1 text-xs text-slate-400">Target: 96%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Above Target</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{aboveTarget}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Below Target</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{belowTarget}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Total Orders (YTD)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{totalOrders.toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">DIFOT by Supplier (worst to best)</h3>
        <Plot
          data={chartData}
          layout={{
            height: Math.max(280, brands.length * 32),
            margin: { l: 120, r: 60, t: 10, b: 30 },
            xaxis: { range: [80, 100], title: { text: "DIFOT %", font: { size: 10 } } },
            yaxis: { autorange: "reversed" as const },
            shapes: [{ type: "line" as const, x0: 96, x1: 96, y0: -0.5, y1: brands.length - 0.5, line: { color: "#dc2626", width: 2, dash: "dash" as const } }],
            annotations: [{ x: 96, y: -0.8, text: "Target 96%", showarrow: false, font: { size: 9, color: "#dc2626" } }],
            font: { family: "Inter, system-ui, sans-serif" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Supplier Detail</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand / Supplier</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Category</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Avg DIFOT</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Latest</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Wks Below Target</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Orders</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const status = b.avgDifot >= 96 ? "On Track" : b.avgDifot >= 92 ? "At Risk" : "Failing";
              const statusColor = b.avgDifot >= 96 ? "text-emerald-700 bg-emerald-100" : b.avgDifot >= 92 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-100";
              return (
                <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2.5">
                    <Link to={`/replenishment/difot/${encodeURIComponent(b.brand)}`} className="font-medium text-blue-700 hover:underline text-sm">{b.brand}</Link>
                  </td>
                  <td className="py-2.5 text-xs text-slate-500">{b.category}</td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${getDifotColor(b.avgDifot)}`}>{b.avgDifot}%</td>
                  <td className={`py-2.5 text-right font-mono ${getDifotColor(b.latestDifot)}`}>{b.latestDifot}%</td>
                  <td className="py-2.5 text-center">
                    {b.weeksBelowTarget > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium"><TrendingDown className="w-3 h-3" />{b.weeksBelowTarget}</span>
                    ) : (
                      <span className="text-xs text-emerald-600"><TrendingUp className="w-3 h-3 inline" /></span>
                    )}
                  </td>
                  <td className="py-2.5 text-right font-mono text-xs text-slate-600">{b.totalOrders.toLocaleString()}</td>
                  <td className="py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>{status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
