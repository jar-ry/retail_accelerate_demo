import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

const kpis = [
  { label: "Total Revenue (L4W)", value: "$8.42M", delta: "+6.2%", positive: true },
  { label: "Units Sold (L4W)", value: "142,831", delta: "+4.8%", positive: true },
  { label: "Avg Margin", value: "38.4%", delta: "-0.3pp", positive: false },
  { label: "Active Brands", value: "25", delta: "", positive: true },
];

const topPerformers = [
  { brand: "Uppababy", category: "Prams & Strollers", revenue: "$892K", growth: "+24.3%", status: "hot" },
  { brand: "Rascal + Friends", category: "Nappies & Wipes", revenue: "$1.1M", growth: "+18.7%", status: "hot" },
  { brand: "Cybex", category: "Car Seats", revenue: "$412K", growth: "+15.2%", status: "hot" },
  { brand: "Purebaby", category: "Clothing", revenue: "$287K", growth: "+12.1%", status: "warm" },
  { brand: "Dr Browns", category: "Feeding", revenue: "$198K", growth: "+11.8%", status: "warm" },
];

const bottomPerformers = [
  { brand: "Bugaboo", category: "Prams & Strollers", revenue: "$1.2M", growth: "-8.4%", status: "concern" },
  { brand: "Pampers", category: "Nappies & Wipes", revenue: "$680K", growth: "-6.2%", status: "concern" },
  { brand: "Infasecure", category: "Car Seats", revenue: "$142K", growth: "-12.8%", status: "critical" },
  { brand: "Bebe", category: "Clothing", revenue: "$89K", growth: "-9.1%", status: "concern" },
  { brand: "NUK", category: "Feeding", revenue: "$76K", growth: "-7.4%", status: "concern" },
];

const categoryBreakdown = [
  { name: "Nappies & Wipes", revenue: "$3.2M", pct: 38, growth: "+5.1%", brands: 5 },
  { name: "Prams & Strollers", revenue: "$2.1M", pct: 25, growth: "+2.3%", brands: 5 },
  { name: "Car Seats", revenue: "$1.4M", pct: 17, growth: "+3.8%", brands: 5 },
  { name: "Clothing", revenue: "$0.9M", pct: 11, growth: "+7.2%", brands: 5 },
  { name: "Feeding", revenue: "$0.8M", pct: 9, growth: "+4.5%", brands: 5 },
];

export default function DashboardPage() {
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
              {topPerformers.map((p) => (
                <tr key={p.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link to={`/brand/${encodeURIComponent(p.brand)}`} className="font-medium text-blue-700 hover:underline">{p.brand}</Link>
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
              {bottomPerformers.map((p) => (
                <tr key={p.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2">
                    <Link to={`/brand/${encodeURIComponent(p.brand)}`} className="font-medium text-blue-700 hover:underline">{p.brand}</Link>
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
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue (L4W)</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500 pl-4">Share</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs LY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Brands</th>
            </tr>
          </thead>
          <tbody>
            {categoryBreakdown.map((c) => (
              <tr key={c.name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2.5">
                  <Link to={`/category/${c.name.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-")}`} className="font-medium text-blue-700 hover:underline">
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
                <td className="py-2.5 text-right font-mono text-slate-600">{c.brands}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
