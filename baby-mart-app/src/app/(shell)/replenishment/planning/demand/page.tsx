"use client";

import { useState, useEffect } from "react";
import { Loader2, BarChart3, CheckCircle2 } from "lucide-react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface WeeklyPoint {
  week: string;
  forecastUnits: number;
  actualUnits: number | null;
  forecastRevenue: number;
  actualRevenue: number | null;
  isForecast: boolean;
}

interface BrandAccuracy {
  brand: string;
  totalForecast: number;
  totalActual: number;
  accuracy: number;
}

interface DemandData {
  weekly: WeeklyPoint[];
  mape: number;
  brands: BrandAccuracy[];
  pyData: WeeklyPoint[] | null;
}

type Channel = "all" | "instore" | "online";

export default function DemandForecastPage() {
  const [data, setData] = useState<DemandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel>("all");
  const [includePY, setIncludePY] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supply/planning/demand?channel=${channel}&includePY=${includePY}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channel, includePY]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading demand forecast...</p>
      </div>
    );
  }

  if (!data) return <div className="p-8 text-red-600">Failed to load demand forecast data</div>;

  const actualWeeks = data.weekly.filter((w) => !w.isForecast);
  const forecastWeeks = data.weekly.filter((w) => w.isForecast);
  const lastActualWeek = actualWeeks.length > 0 ? actualWeeks[actualWeeks.length - 1] : null;

  const forecastTrace = {
    x: data.weekly.map((w) => w.week),
    y: data.weekly.map((w) => w.forecastUnits),
    name: "Forecast",
    type: "scatter" as const,
    mode: "lines" as const,
    line: { color: "#2563eb", width: 2, dash: undefined as string | undefined },
  };

  const actualTrace = {
    x: actualWeeks.map((w) => w.week),
    y: actualWeeks.map((w) => w.actualUnits),
    name: "Actual",
    type: "scatter" as const,
    mode: "lines+markers" as const,
    line: { color: "#10b981", width: 2 },
    marker: { size: 4 },
  };

  const forecastOnlyTrace = {
    x: [lastActualWeek?.week, ...forecastWeeks.map((w) => w.week)].filter(Boolean),
    y: [lastActualWeek?.forecastUnits, ...forecastWeeks.map((w) => w.forecastUnits)].filter((v) => v != null),
    name: "Forecast (future)",
    type: "scatter" as const,
    mode: "lines" as const,
    line: { color: "#93c5fd", width: 2, dash: "dot" as const },
    showlegend: false,
  };

  const traces: object[] = [forecastTrace, actualTrace, forecastOnlyTrace];

  if (includePY && data.pyData) {
    traces.push({
      x: data.pyData.map((w) => w.week),
      y: data.pyData.map((w) => w.actualUnits ?? w.forecastUnits),
      name: "PY",
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color: "#9ca3af", width: 1.5, dash: "dash" as const },
    });
  }

  const channels: { key: Channel; label: string }[] = [
    { key: "all", label: "All" },
    { key: "instore", label: "In-Store" },
    { key: "online", label: "Online" },
  ];

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Demand Forecast</h1>
          <p className="text-sm text-slate-500 mt-1">Forecast vs actuals with brand-level accuracy</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
            {channels.map((c) => (
              <button
                key={c.key}
                onClick={() => setChannel(c.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  channel === c.key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includePY}
              onChange={(e) => setIncludePY(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            PY Overlay
          </label>
        </div>
      </div>

      {/* MAPE KPI */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Forecast MAPE</div>
          <div className={`text-3xl font-bold mt-1 ${data.mape <= 10 ? "text-emerald-600" : data.mape <= 20 ? "text-amber-600" : "text-red-600"}`}>
            {data.mape.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400 mt-1">Mean Absolute % Error</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Weeks Actual</div>
          <div className="text-3xl font-bold mt-1 text-slate-900">{actualWeeks.length}</div>
          <div className="text-xs text-slate-400 mt-1">of {data.weekly.length} total</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Brands Tracked</div>
          <div className="text-3xl font-bold mt-1 text-slate-900">{data.brands.length}</div>
          <div className="text-xs text-slate-400 mt-1">With forecast accuracy</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Channel</div>
          <div className="text-3xl font-bold mt-1 text-slate-900 capitalize">{channel === "all" ? "All" : channel === "instore" ? "In-Store" : "Online"}</div>
          <div className="text-xs text-slate-400 mt-1">Active filter</div>
        </div>
      </div>

      {/* Weekly Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Weekly Units — Forecast vs Actual</h3>
        </div>
        <Plot
          data={traces}
          layout={{
            height: 340,
            margin: { l: 60, r: 30, t: 20, b: 50 },
            legend: { orientation: "h" as const, y: -0.18, x: 0.5, xanchor: "center" as const, font: { size: 10 } },
            xaxis: { title: { text: "Week", font: { size: 10 } }, tickfont: { size: 9 } },
            yaxis: { title: { text: "Units", font: { size: 10 } }, tickfont: { size: 9 } },
            font: { family: "Inter, system-ui, sans-serif" },
            shapes: lastActualWeek
              ? [{ type: "line" as const, x0: lastActualWeek.week, x1: lastActualWeek.week, y0: 0, y1: 1, yref: "paper" as const, line: { color: "#e2e8f0", width: 1, dash: "dot" as const } }]
              : [],
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      {/* Brand Accuracy Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800">Forecast Accuracy by Brand</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="pb-2 font-medium">Brand</th>
                <th className="pb-2 font-medium text-right">Total Forecast</th>
                <th className="pb-2 font-medium text-right">Total Actual</th>
                <th className="pb-2 font-medium text-right">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {data.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{b.brand}</td>
                  <td className="py-2 text-right font-mono text-slate-600">{b.totalForecast.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono text-slate-600">{b.totalActual.toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      b.accuracy >= 90 ? "bg-emerald-100 text-emerald-700" : b.accuracy >= 80 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    }`}>
                      {b.accuracy.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
