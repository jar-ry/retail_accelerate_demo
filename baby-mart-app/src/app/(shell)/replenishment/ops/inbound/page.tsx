"use client";

import { useState, useEffect } from "react";
import { Loader2, Package, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Arrival {
  po: string;
  supplier: string;
  brand: string;
  sku: string;
  dc: string;
  pallets: number;
  carrier: string;
  expectedDate: string;
  status: string;
  dockToCheck: number;
  checkToPutaway: number;
}

interface Performance {
  dc: string;
  avgDockCheck: number;
  avgCheckPutaway: number;
  sameDayPct: number;
}

interface Discrepancy {
  po: string;
  supplier: string;
  brand: string;
  sku: string;
  dc: string;
  type: string;
  units: number;
  date: string;
}

interface InboundData {
  arrivals: Arrival[];
  performance: Performance[];
  discrepancies: Discrepancy[];
}

const DCS = ["All", "NSW", "VIC", "QLD", "SA", "WA"];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DELIVERED: "bg-emerald-100 text-emerald-800",
    IN_TRANSIT: "bg-blue-100 text-blue-800",
    ON_ORDER: "bg-slate-100 text-slate-800",
    OVERDUE: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || "bg-gray-100 text-gray-800"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function discrepancyBadge(type: string) {
  const map: Record<string, string> = {
    SHORT_SHIPPED: "bg-amber-100 text-amber-800",
    DAMAGED: "bg-red-100 text-red-800",
    WRONG_SKU: "bg-purple-100 text-purple-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[type] || "bg-gray-100 text-gray-800"}`}>
      {type.replace("_", " ")}
    </span>
  );
}

export default function InboundReceivingPage() {
  const [dc, setDc] = useState("All");
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [data, setData] = useState<InboundData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supply/ops/inbound?dc=${dc === "All" ? "all" : dc}&period=${period}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dc, period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!data) return <div className="p-6 text-red-600">Failed to load data.</div>;

  const perf = data.performance;
  const avgDockCheck = perf.length ? perf.reduce((s, p) => s + p.avgDockCheck, 0) / perf.length : 0;
  const avgCheckPutaway = perf.length ? perf.reduce((s, p) => s + p.avgCheckPutaway, 0) / perf.length : 0;
  const avgSameDay = perf.length ? perf.reduce((s, p) => s + p.sameDayPct, 0) / perf.length : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inbound Receiving</h1>
        <div className="flex items-center gap-3">
          <select
            value={dc}
            onChange={(e) => setDc(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            {DCS.map((d) => (
              <option key={d} value={d}>{d === "All" ? "All DCs" : `${d} DC`}</option>
            ))}
          </select>
          <div className="flex border border-gray-300 rounded-md overflow-hidden text-sm">
            <button
              onClick={() => setPeriod("today")}
              className={`px-3 py-1.5 ${period === "today" ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}
            >
              Today
            </button>
            <button
              onClick={() => setPeriod("week")}
              className={`px-3 py-1.5 ${period === "week" ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}
            >
              This Week
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock className="w-4 h-4" />
            Avg Dock-to-Check
          </div>
          <div className="text-2xl font-bold text-gray-900">{avgDockCheck.toFixed(1)}h</div>
          <div className={`text-xs mt-1 ${avgDockCheck <= 4 ? "text-emerald-600" : "text-red-600"}`}>
            Target: 4h {avgDockCheck <= 4 ? "✓" : "⚠"}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock className="w-4 h-4" />
            Avg Check-to-Putaway
          </div>
          <div className="text-2xl font-bold text-gray-900">{avgCheckPutaway.toFixed(1)}h</div>
          <div className={`text-xs mt-1 ${avgCheckPutaway <= 3 ? "text-emerald-600" : "text-red-600"}`}>
            Target: 3h {avgCheckPutaway <= 3 ? "✓" : "⚠"}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <CheckCircle2 className="w-4 h-4" />
            Same-Day Putaway
          </div>
          <div className="text-2xl font-bold text-gray-900">{avgSameDay.toFixed(1)}%</div>
          <div className={`text-xs mt-1 ${avgSameDay >= 90 ? "text-emerald-600" : "text-amber-600"}`}>
            {avgSameDay >= 90 ? "On track" : "Below 90% target"}
          </div>
        </div>
      </div>

      {/* Arrivals Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Arrivals ({data.arrivals.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">PO</th>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Brand</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">DC</th>
                <th className="px-4 py-2">Pallets</th>
                <th className="px-4 py-2">Carrier</th>
                <th className="px-4 py-2">Expected</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Dock→Check (h)</th>
                <th className="px-4 py-2">Check→Put (h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.arrivals.map((a, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{a.po}</td>
                  <td className="px-4 py-2">{a.supplier}</td>
                  <td className="px-4 py-2">{a.brand}</td>
                  <td className="px-4 py-2 font-mono text-xs">{a.sku}</td>
                  <td className="px-4 py-2">{a.dc}</td>
                  <td className="px-4 py-2 text-right">{a.pallets}</td>
                  <td className="px-4 py-2">{a.carrier}</td>
                  <td className="px-4 py-2">{a.expectedDate}</td>
                  <td className="px-4 py-2">{statusBadge(a.status)}</td>
                  <td className="px-4 py-2 text-right">{a.dockToCheck > 0 ? a.dockToCheck.toFixed(1) : "—"}</td>
                  <td className="px-4 py-2 text-right">{a.checkToPutaway > 0 ? a.checkToPutaway.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Discrepancies */}
      {data.discrepancies.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="font-semibold text-gray-900">Discrepancies ({data.discrepancies.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">PO</th>
                  <th className="px-4 py-2">Supplier</th>
                  <th className="px-4 py-2">Brand</th>
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">DC</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Units</th>
                  <th className="px-4 py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.discrepancies.map((d, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{d.po}</td>
                    <td className="px-4 py-2">{d.supplier}</td>
                    <td className="px-4 py-2">{d.brand}</td>
                    <td className="px-4 py-2 font-mono text-xs">{d.sku}</td>
                    <td className="px-4 py-2">{d.dc}</td>
                    <td className="px-4 py-2">{discrepancyBadge(d.type)}</td>
                    <td className="px-4 py-2 text-right">{d.units}</td>
                    <td className="px-4 py-2">{d.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
