"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, TrendingDown, Truck } from "lucide-react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface OvertradingSummary {
  totalOrders: number;
  overtradedOrders: number;
  overtradedPct: number;
  rushOrders: number;
  overForecastOrders: number;
  difotAll: number;
  difotFair: number;
  difotOvertraded: number;
  gapFromOvertrading: number;
}

interface SupplierOvertrading {
  supplier: string;
  rushPct: number;
  overFcstPct: number;
  fairDifot: number;
  allDifot: number;
  impact: number;
}

interface GeographyOvertrading {
  geography: string;
  overtradedPct: number;
  rushPct: number;
}

interface OvertradingData {
  summary: OvertradingSummary;
  bySupplier: SupplierOvertrading[];
  byGeography: GeographyOvertrading[];
}

export default function OvertradingPage() {
  const [data, setData] = useState<OvertradingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supply/planning/overtrading")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading overtrading analysis...</p>
      </div>
    );
  }

  if (!data) return <div className="p-8 text-red-600">Failed to load overtrading data</div>;

  const { summary } = data;

  const geoChart = [
    {
      y: data.byGeography.map((g) => g.geography),
      x: data.byGeography.map((g) => g.overtradedPct),
      name: "Overtraded %",
      type: "bar" as const,
      orientation: "h" as const,
      marker: { color: "#f59e0b" },
    },
    {
      y: data.byGeography.map((g) => g.geography),
      x: data.byGeography.map((g) => g.rushPct),
      name: "Rush %",
      type: "bar" as const,
      orientation: "h" as const,
      marker: { color: "#ef4444" },
    },
  ];

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overtrading Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">Impact of rush and over-forecast orders on DIFOT</p>
        </div>
      </div>

      {/* Key Insight Callout */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {summary.gapFromOvertrading.toFixed(1)} pp of your DIFOT miss is caused by overtrading
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Removing overtraded orders improves DIFOT from {summary.difotAll}% to {summary.difotFair}% — a {summary.gapFromOvertrading.toFixed(1)} percentage point recovery.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">DIFOT (All Orders)</div>
          <div className="text-3xl font-bold mt-1 text-red-600">{summary.difotAll}%</div>
          <div className="text-xs text-slate-400 mt-1">{summary.totalOrders.toLocaleString()} orders</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">DIFOT (Fair View)</div>
          <div className="text-3xl font-bold mt-1 text-emerald-600">{summary.difotFair}%</div>
          <div className="text-xs text-slate-400 mt-1">Excl. overtraded orders</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">DIFOT (Overtraded Only)</div>
          <div className="text-3xl font-bold mt-1 text-amber-600">{summary.difotOvertraded}%</div>
          <div className="text-xs text-slate-400 mt-1">{summary.overtradedOrders.toLocaleString()} orders</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Gap from Overtrading</div>
          <div className="text-3xl font-bold mt-1 text-red-600">-{summary.gapFromOvertrading.toFixed(1)}pp</div>
          <div className="text-xs text-slate-400 mt-1">DIFOT impact</div>
        </div>
      </div>

      {/* Overtrading Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Truck className="w-4 h-4 text-red-500" />
            <div className="text-xs text-slate-500 font-medium uppercase">Rush Orders</div>
          </div>
          <div className="text-2xl font-bold text-red-600">{summary.rushOrders.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">
            {((summary.rushOrders / summary.totalOrders) * 100).toFixed(1)}% of total
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-amber-500" />
            <div className="text-xs text-slate-500 font-medium uppercase">Over-Forecast Orders</div>
          </div>
          <div className="text-2xl font-bold text-amber-600">{summary.overForecastOrders.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">
            {((summary.overForecastOrders / summary.totalOrders) * 100).toFixed(1)}% of total
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Total Overtraded</div>
          <div className="text-2xl font-bold text-slate-900">{summary.overtradedPct.toFixed(1)}%</div>
          <div className="text-xs text-slate-400 mt-1">{summary.overtradedOrders.toLocaleString()} orders flagged</div>
        </div>
      </div>

      {/* By Supplier Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">By Supplier (sorted by DIFOT impact)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="pb-2 font-medium">Supplier</th>
                <th className="pb-2 font-medium text-right">Rush %</th>
                <th className="pb-2 font-medium text-right">Over-Fcst %</th>
                <th className="pb-2 font-medium text-right">Fair DIFOT</th>
                <th className="pb-2 font-medium text-right">All DIFOT</th>
                <th className="pb-2 font-medium text-right">Impact (pp)</th>
              </tr>
            </thead>
            <tbody>
              {data.bySupplier.map((s) => (
                <tr key={s.supplier} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{s.supplier}</td>
                  <td className="py-2 text-right font-mono">
                    <span className={s.rushPct > 15 ? "text-red-600 font-semibold" : "text-slate-600"}>
                      {s.rushPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono">
                    <span className={s.overFcstPct > 20 ? "text-amber-600 font-semibold" : "text-slate-600"}>
                      {s.overFcstPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      s.fairDifot >= 95 ? "bg-emerald-100 text-emerald-700" : s.fairDifot >= 85 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    }`}>
                      {s.fairDifot.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      s.allDifot >= 95 ? "bg-emerald-100 text-emerald-700" : s.allDifot >= 85 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    }`}>
                      {s.allDifot.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono font-semibold text-red-600">
                    -{s.impact.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* By Geography Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Overtrading by Geography</h3>
        <Plot
          data={geoChart}
          layout={{
            height: 280,
            margin: { l: 100, r: 30, t: 10, b: 40 },
            barmode: "group" as const,
            legend: { orientation: "h" as const, y: -0.2, x: 0.5, xanchor: "center" as const, font: { size: 10 } },
            xaxis: { title: { text: "Percentage (%)", font: { size: 10 } }, tickfont: { size: 9 } },
            yaxis: { autorange: "reversed" as const, tickfont: { size: 9 } },
            font: { family: "Inter, system-ui, sans-serif" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
