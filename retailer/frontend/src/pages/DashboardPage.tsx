import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { brandData, categories, topPerformers, bottomPerformers } from "../data/brandConfig";

const kpis = [
  { label: "Total Revenue (L7D)", value: "$2.14M", delta: "+6.2%", positive: true },
  { label: "Units Sold (L7D)", value: "36,208", delta: "+4.8%", positive: true },
  { label: "Avg Margin", value: "38.4%", delta: "-0.3pp", positive: false },
  { label: "Active Brands", value: "25", delta: "", positive: true },
];

export default function DashboardPage() {
  const top = topPerformers.map((name) => brandData[name]);
  const bottom = bottomPerformers.map((name) => brandData[name]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Category Performance Dashboard</h1>
        <select className="text-xs border border-slate-200 rounded-md px-3 py-1.5">
          <option>Last 4 Weeks</option>
          <option>Last 8 Weeks</option>
          <option>MTD</option>
          <option>QTD</option>
          <option>YTD</option>
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{kpi.label}</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{kpi.value}</div>
            {kpi.delta && (
              <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${kpi.positive ? "text-emerald-600" : "text-red-600"}`}>
                {kpi.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {kpi.delta}
              </div>
            )}
          </div>
        ))}
      </div>

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
              {top.map((p) => (
                <tr key={p.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link to={`/brand/${encodeURIComponent(p.name)}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link>
                  </td>
                  <td className="py-2 text-slate-600">{p.category}</td>
                  <td className="py-2 text-right font-mono">{p.revenue}</td>
                  <td className="py-2 text-right font-mono text-emerald-600 font-semibold">{p.growth}</td>
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
              {bottom.map((p) => (
                <tr key={p.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link to={`/brand/${encodeURIComponent(p.name)}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link>
                  </td>
                  <td className="py-2 text-slate-600">{p.category}</td>
                  <td className="py-2 text-right font-mono">{p.revenue}</td>
                  <td className="py-2 text-right font-mono text-red-600 font-semibold">{p.growth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Category Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Category</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue (L7D)</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500 pl-4">Share</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs LY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Brands</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2.5">
                  <Link to={`/category/${c.slug}`} className="font-medium text-blue-700 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="py-2.5 text-right font-mono">{c.revenue}</td>
                <td className="py-2.5 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-slate-500">{c.pct}%</span>
                  </div>
                </td>
                <td className="py-2.5 text-right font-mono text-emerald-600">{c.growth}</td>
                <td className="py-2.5 text-right font-mono text-slate-600">{c.brands.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
