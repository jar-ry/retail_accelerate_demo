import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronRight, Store, Loader2, TrendingUp, ArrowRight } from "lucide-react";
// @ts-ignore
import Plot from "react-plotly.js";

interface StateWeekly { state: string; week: number; units: number; isForecast?: boolean; }
interface TopStore { store: string; state: string; units: number; revenue: number; ros: number; }
interface GrowingStore { store: string; state: string; priorUnits: number; latestUnits: number; changePct: number; }

interface DemandDetail {
  brand: string;
  skuClass: string;
  summary: { latestUnits: number; priorUnits: number; growthPct: number; storeCount: number; };
  stateWeekly: StateWeekly[];
  topStores: TopStore[];
  growingStores: GrowingStore[];
}

const STATE_COLORS: Record<string, string> = { NSW: "#2563eb", VIC: "#8b5cf6", QLD: "#f59e0b", WA: "#10b981", SA: "#ec4899", ACT: "#14b8a6", NT: "#f97316", TAS: "#6366f1" };

export default function DemandDetailPage() {
  const { brand: brandParam, sku: skuParam } = useParams();
  const brand = decodeURIComponent(brandParam || "");
  const sku = decodeURIComponent(skuParam || "");
  const [data, setData] = useState<DemandDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/supply/demand/${encodeURIComponent(brand)}/${encodeURIComponent(sku)}/detail`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brand, sku]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading demand detail...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <Link to="/replenishment/demand" className="text-emerald-700 hover:underline text-sm">← Back</Link>
        <p className="mt-4 text-slate-500">No data found.</p>
      </div>
    );
  }

  const historical = data.stateWeekly.filter((s) => !s.isForecast);
  const forecast = data.stateWeekly.filter((s) => s.isForecast);
  const states = [...new Set(data.stateWeekly.map((s) => s.state))];

  // Build historical stacked traces
  const histTraces = states.map((state) => {
    const pts = historical.filter((s) => s.state === state);
    return {
      x: pts.map((p) => `W${p.week}`),
      y: pts.map((p) => p.units),
      name: state,
      type: "scatter" as const,
      mode: "lines" as const,
      stackgroup: "hist",
      line: { color: STATE_COLORS[state] || "#64748b" },
      showlegend: true,
    };
  });

  // Build forecast stacked traces (dashed, lighter)
  const forecastTraces = states.map((state) => {
    const pts = forecast.filter((s) => s.state === state);
    return {
      x: pts.map((p) => `W${p.week}`),
      y: pts.map((p) => p.units),
      name: `${state} (forecast)`,
      type: "scatter" as const,
      mode: "lines" as const,
      stackgroup: "fcast",
      line: { color: STATE_COLORS[state] || "#64748b", dash: "dot" as const },
      opacity: 0.6,
      showlegend: false,
    };
  });

  const stateTotals: Record<string, number> = {};
  historical.filter((s) => s.week >= 15).forEach((s) => {
    stateTotals[s.state] = (stateTotals[s.state] || 0) + s.units;
  });
  const topState = Object.entries(stateTotals).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link to="/replenishment/demand" className="hover:text-emerald-700">Customer Demand</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-900 font-medium">{brand} — {sku}</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{brand} — {sku}</h1>
          <p className="text-xs text-slate-500 mt-0.5">Store-level demand insights</p>
        </div>
        <Link
          to={`/replenishment/dc?brand=${encodeURIComponent(brand)}&sku=${encodeURIComponent(sku)}&change=${data.summary.growthPct}`}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800"
        >
          View DC Impact <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Units (Latest 4wk)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{data.summary.latestUnits.toLocaleString()}</div>
          <div className="mt-1 text-xs text-slate-400">vs {data.summary.priorUnits.toLocaleString()} prior</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Growth Rate</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${data.summary.growthPct > 0 ? "text-emerald-600" : "text-red-600"}`}>
            {data.summary.growthPct > 0 ? "+" : ""}{data.summary.growthPct}%
          </div>
          <div className="mt-1 text-xs text-emerald-500">vs prior 4 weeks</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Top State</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{topState ? topState[0] : "—"}</div>
          <div className="mt-1 text-xs text-slate-400">{topState ? `${Math.round(topState[1])} units (4wk)` : ""}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Stores Selling</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{data.summary.storeCount}</div>
          <div className="mt-1 text-xs text-slate-400">across {states.length} states</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Weekly Demand by State (Stacked Area)</h3>
        <Plot
          data={[...histTraces, ...forecastTraces]}
          layout={{
            height: 300, margin: { l: 50, r: 20, t: 10, b: 40 },
            legend: { orientation: "h" as const, y: -0.2, x: 0.5, xanchor: "center" as const, font: { size: 9 } },
            xaxis: { title: { text: "Week", font: { size: 10 } } },
            yaxis: { title: { text: "Units", font: { size: 10 } } },
            shapes: [{
              type: "rect" as const,
              x0: "W19", x1: "W22",
              y0: 0, y1: 1, yref: "paper" as const,
              fillcolor: "rgba(99,102,241,0.06)",
              line: { width: 0 },
            }],
            annotations: [{ x: "W20", y: 1.02, yref: "paper" as const, text: "Forecast", showarrow: false, font: { size: 9, color: "#6366f1" } }],
            font: { family: "Inter, system-ui, sans-serif" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-800">Top Stores by Volume (Latest 4wk)</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 font-semibold text-slate-500">Store</th>
                <th className="text-left py-2 font-semibold text-slate-500">State</th>
                <th className="text-right py-2 font-semibold text-slate-500">Units</th>
                <th className="text-right py-2 font-semibold text-slate-500">Revenue</th>
                <th className="text-right py-2 font-semibold text-slate-500">RoS</th>
              </tr>
            </thead>
            <tbody>
              {data.topStores.map((s, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-800">{s.store.replace("Baby Mart ", "")}</td>
                  <td className="py-1.5 text-slate-500">{s.state}</td>
                  <td className="py-1.5 text-right font-mono">{s.units.toLocaleString()}</td>
                  <td className="py-1.5 text-right font-mono text-slate-600">${s.revenue.toLocaleString()}</td>
                  <td className="py-1.5 text-right font-mono">{s.ros}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Fastest Growing Stores</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 font-semibold text-slate-500">Store</th>
                <th className="text-left py-2 font-semibold text-slate-500">State</th>
                <th className="text-right py-2 font-semibold text-slate-500">Prior</th>
                <th className="text-right py-2 font-semibold text-slate-500">Latest</th>
                <th className="text-right py-2 font-semibold text-slate-500">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.growingStores.map((s, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-800">{s.store.replace("Baby Mart ", "")}</td>
                  <td className="py-1.5 text-slate-500">{s.state}</td>
                  <td className="py-1.5 text-right font-mono">{s.priorUnits}</td>
                  <td className="py-1.5 text-right font-mono">{s.latestUnits}</td>
                  <td className={`py-1.5 text-right font-mono font-semibold ${s.changePct > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {s.changePct > 0 ? "+" : ""}{s.changePct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <Link
          to={`/replenishment/dc?brand=${encodeURIComponent(brand)}&sku=${encodeURIComponent(sku)}&change=${data.summary.growthPct}`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800"
        >
          Continue to DC Impact <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
