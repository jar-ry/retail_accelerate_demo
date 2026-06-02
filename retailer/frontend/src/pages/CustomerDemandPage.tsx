import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Store, Loader2, TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
// @ts-ignore
import Plot from "react-plotly.js";

interface TrendPoint { brand: string; week: number; units: number; }
interface Acceleration { brand: string; skuClass: string; priorAvg: number; latestAvg: number; changePct: number; signal: string; }
interface StateDemand { state: string; units: number; revenue: number; stores: number; }

const BRAND_COLORS: Record<string, string> = {
  "Huggies": "#2563eb", "Pampers": "#8b5cf6", "Rascal + Friends": "#10b981",
  "Bugaboo": "#f59e0b", "Bonds Baby": "#ec4899", "Uppababy": "#14b8a6",
  "Dr Browns": "#f97316", "Maxi-Cosi": "#6366f1", "Cybex": "#84cc16", "Infasecure": "#ef4444",
};

export default function CustomerDemandPage() {
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [acceleration, setAcceleration] = useState<Acceleration[]>([]);
  const [stateData, setStateData] = useState<StateDemand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/supply/demand/trends").then((r) => r.json()),
      fetch("/api/supply/demand/acceleration").then((r) => r.json()),
      fetch("/api/supply/demand/by-state").then((r) => r.json()),
    ]).then(([t, a, s]) => {
      if (Array.isArray(t)) setTrends(t);
      if (Array.isArray(a)) setAcceleration(a);
      if (Array.isArray(s)) setStateData(s);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading demand data...</p>
      </div>
    );
  }

  const brands = [...new Set(trends.map((t) => t.brand))];
  const topBrands = brands.slice(0, 10);
  const totalUnits = stateData.reduce((s, d) => s + d.units, 0);
  const accelerating = acceleration.filter((a) => a.signal === "accelerating").length;
  const declining = acceleration.filter((a) => a.signal === "declining").length;
  const topGrower = acceleration.length > 0 ? acceleration[0] : null;

  const trendTraces = topBrands.map((brand) => {
    const pts = trends.filter((t) => t.brand === brand);
    return {
      x: pts.map((p) => `W${p.week}`),
      y: pts.map((p) => p.units),
      name: brand,
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color: BRAND_COLORS[brand] || "#64748b", width: 2 },
    };
  });

  const stateChart = [{
    y: stateData.map((d) => d.state),
    x: stateData.map((d) => d.units),
    type: "bar" as const,
    orientation: "h" as const,
    marker: { color: stateData.map((_, i) => ["#2563eb", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#6366f1"][i] || "#64748b") },
    text: stateData.map((d) => `${d.units.toLocaleString()} units`),
    textposition: "outside" as const,
    textfont: { size: 10 },
  }];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Store className="w-5 h-5 text-emerald-700" />
          <h1 className="text-xl font-bold text-slate-900">Customer Demand</h1>
        </div>
        <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md font-medium">YTD 2026 (Weeks 1-18)</div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Total Units (YTD)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{totalUnits.toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-400">{Math.round(totalUnits / 18).toLocaleString()} avg/week</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Accelerating SKUs</div>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{accelerating}</div>
          <div className="mt-1 text-xs text-emerald-500">Demand increasing &gt;5% WoW</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Declining SKUs</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{declining}</div>
          <div className="mt-1 text-xs text-red-500">Demand dropping &gt;5%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Fastest Grower</div>
          <div className="mt-1 font-mono text-lg font-bold text-emerald-700">{topGrower ? `+${topGrower.changePct}%` : "—"}</div>
          <div className="mt-1 text-xs text-slate-500 truncate">{topGrower ? `${topGrower.brand} ${topGrower.skuClass}` : ""}</div>
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Weekly Demand Trend by Brand</h3>
          <Plot
            data={trendTraces}
            layout={{
              height: 300, margin: { l: 50, r: 20, t: 10, b: 40 },
              legend: { orientation: "h" as const, y: -0.2, x: 0.5, xanchor: "center" as const, font: { size: 9 } },
              xaxis: { title: { text: "Week", font: { size: 10 } } },
              yaxis: { title: { text: "Units", font: { size: 10 } } },
              font: { family: "Inter, system-ui, sans-serif" },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Demand by State</h3>
          <Plot
            data={stateChart}
            layout={{
              height: 300, margin: { l: 40, r: 80, t: 10, b: 20 },
              xaxis: { title: { text: "Units", font: { size: 10 } } },
              yaxis: { autorange: "reversed" as const },
              font: { family: "Inter, system-ui, sans-serif" },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Demand Acceleration — All Brands & SKUs</h3>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-emerald-600"><TrendingUp className="w-3 h-3" /> Accelerating ({accelerating})</span>
            <span className="flex items-center gap-1 text-blue-600"><Minus className="w-3 h-3" /> Stable ({acceleration.length - accelerating - declining})</span>
            <span className="flex items-center gap-1 text-red-600"><TrendingDown className="w-3 h-3" /> Declining ({declining})</span>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Product / SKU</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Prior 4wk Avg</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Latest 4wk Avg</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Change %</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Signal</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {acceleration.map((a, i) => {
              const signalColor = a.signal === "accelerating" ? "text-emerald-700 bg-emerald-100" : a.signal === "declining" ? "text-red-700 bg-red-100" : "text-blue-700 bg-blue-100";
              const SignalIcon = a.signal === "accelerating" ? TrendingUp : a.signal === "declining" ? TrendingDown : Minus;
              return (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{a.brand}</td>
                  <td className="py-2 text-xs text-slate-600">{a.skuClass}</td>
                  <td className="py-2 text-right font-mono">{a.priorAvg.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono">{a.latestAvg.toLocaleString()}</td>
                  <td className={`py-2 text-right font-mono font-semibold ${a.changePct > 0 ? "text-emerald-600" : a.changePct < 0 ? "text-red-600" : "text-slate-600"}`}>
                    {a.changePct > 0 ? "+" : ""}{a.changePct}%
                  </td>
                  <td className="py-2 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${signalColor}`}>
                      <SignalIcon className="w-3 h-3" />{a.signal}
                    </span>
                  </td>
                  <td className="py-2 text-center">
                    <Link
                      to={`/replenishment/demand/${encodeURIComponent(a.brand)}/${encodeURIComponent(a.skuClass)}`}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      View Detail <ArrowRight className="w-3 h-3" />
                    </Link>
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
