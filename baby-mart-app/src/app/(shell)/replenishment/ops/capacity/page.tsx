"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2, AlertTriangle } from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface CapacityRow {
  date: string;
  dc: string;
  inboundPallets: number;
  outboundOrders: number;
  outboundPallets: number;
  peakRisk: boolean;
}

function riskBadge(isPeak: boolean) {
  if (!isPeak) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
      <AlertTriangle className="w-3 h-3" />
      PEAK
    </span>
  );
}

export default function DCCapacityPage() {
  const [data, setData] = useState<CapacityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/supply/ops/capacity")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!data.length) return <div className="p-6 text-gray-500">No capacity data available.</div>;

  const dcs = [...new Set(data.map((r) => r.dc))];

  const chartTraces = dcs.flatMap((dc) => {
    const dcRows = data.filter((r) => r.dc === dc).sort((a, b) => a.date.localeCompare(b.date));
    const dates = dcRows.map((r) => r.date);
    return [
      {
        x: dates,
        y: dcRows.map((r) => r.inboundPallets),
        name: `${dc} Inbound`,
        type: "bar" as const,
        marker: { color: dc === "NSW" ? "#3b82f6" : dc === "VIC" ? "#8b5cf6" : dc === "QLD" ? "#f59e0b" : dc === "SA" ? "#10b981" : "#ef4444" },
      },
      {
        x: dates,
        y: dcRows.map((r) => r.outboundPallets),
        name: `${dc} Outbound`,
        type: "bar" as const,
        marker: { color: dc === "NSW" ? "#93c5fd" : dc === "VIC" ? "#c4b5fd" : dc === "QLD" ? "#fcd34d" : dc === "SA" ? "#6ee7b7" : "#fca5a5" },
      },
    ];
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">DC Capacity Planning</h1>

      {/* Grouped Bar Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <Plot
          data={chartTraces}
          layout={{
            barmode: "group",
            title: { text: "Daily Pallet Volume by DC", font: { size: 14 } },
            xaxis: { title: "Date", type: "category" },
            yaxis: { title: "Pallets" },
            legend: { orientation: "h", y: -0.2 },
            margin: { t: 40, b: 80, l: 60, r: 20 },
            height: 400,
          }}
          config={{ responsive: true, displayModeBar: false }}
          className="w-full"
        />
      </div>

      {/* Data Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Capacity Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">DC</th>
                <th className="px-4 py-2">Inbound Pallets</th>
                <th className="px-4 py-2">Outbound Orders</th>
                <th className="px-4 py-2">Outbound Pallets</th>
                <th className="px-4 py-2">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r, i) => (
                <tr key={i} className={r.peakRisk ? "bg-red-50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-2">{r.date}</td>
                  <td className="px-4 py-2 font-medium">{r.dc}</td>
                  <td className="px-4 py-2 text-right">{r.inboundPallets}</td>
                  <td className="px-4 py-2 text-right">{r.outboundOrders}</td>
                  <td className="px-4 py-2 text-right">{r.outboundPallets}</td>
                  <td className="px-4 py-2">{riskBadge(r.peakRisk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
