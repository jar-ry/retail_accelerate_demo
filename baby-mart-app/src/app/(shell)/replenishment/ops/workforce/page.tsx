"use client";

import { useState, useEffect } from "react";
import { Loader2, Users, AlertCircle, TrendingUp } from "lucide-react";

interface Shift {
  dc: string;
  shift: string;
  shiftStart: string;
  shiftEnd: string;
  staffRostered: number;
  staffActual: number;
  inboundPallets: number;
  outboundOrders: number;
  outboundPallets: number;
  productivity: number;
  staffRequired: number;
  staffGap: number;
  isUnderstaffed: boolean;
  riskLevel: string;
}

interface Trend {
  date: string;
  dc: string;
  avgProductivity: number;
  totalGap: number;
  understaffedShifts: number;
}

interface WorkforceData {
  today: Shift[];
  trend: Trend[];
}

const DCS = ["All", "NSW", "VIC", "QLD", "SA", "WA"];

function riskRowClass(level: string) {
  switch (level) {
    case "RED": return "bg-red-50";
    case "AMBER": return "bg-amber-50";
    case "GREEN": return "bg-emerald-50";
    default: return "";
  }
}

function riskBadge(level: string) {
  const map: Record<string, string> = {
    RED: "bg-red-100 text-red-800",
    AMBER: "bg-amber-100 text-amber-800",
    GREEN: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[level] || "bg-gray-100 text-gray-800"}`}>
      {level}
    </span>
  );
}

export default function WorkforceRosteringPage() {
  const [dc, setDc] = useState("All");
  const [data, setData] = useState<WorkforceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supply/ops/workforce?dc=${dc === "All" ? "all" : dc}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dc]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!data) return <div className="p-6 text-red-600">Failed to load data.</div>;

  const redShifts = data.today.filter((s) => s.riskLevel === "RED").length;
  const totalGap = data.today.reduce((sum, s) => sum + Math.min(s.staffGap, 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Workforce Rostering</h1>
        <select
          value={dc}
          onChange={(e) => setDc(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          {DCS.map((d) => (
            <option key={d} value={d}>{d === "All" ? "All DCs" : `${d} DC`}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <AlertCircle className="w-4 h-4 text-red-500" />
            RED Shifts Today
          </div>
          <div className={`text-2xl font-bold ${redShifts > 0 ? "text-red-600" : "text-gray-900"}`}>
            {redShifts}
          </div>
          <div className="text-xs text-gray-500 mt-1">Critically understaffed</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Users className="w-4 h-4" />
            Total Staff Gap
          </div>
          <div className={`text-2xl font-bold ${totalGap < 0 ? "text-red-600" : "text-gray-900"}`}>
            {totalGap}
          </div>
          <div className="text-xs text-gray-500 mt-1">Across all DCs today</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <TrendingUp className="w-4 h-4" />
            Productivity Target
          </div>
          <div className="text-2xl font-bold text-gray-900">3.5</div>
          <div className="text-xs text-gray-500 mt-1">Pallets per labour hour</div>
        </div>
      </div>

      {/* Today's Shifts Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Today&apos;s Shifts ({data.today.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">DC</th>
                <th className="px-4 py-2">Shift</th>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Rostered</th>
                <th className="px-4 py-2">Actual</th>
                <th className="px-4 py-2">Required</th>
                <th className="px-4 py-2">Gap</th>
                <th className="px-4 py-2">Inbound</th>
                <th className="px-4 py-2">Outbound Ord</th>
                <th className="px-4 py-2">Outbound Pal</th>
                <th className="px-4 py-2">Productivity</th>
                <th className="px-4 py-2">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.today.map((s, i) => (
                <tr key={i} className={riskRowClass(s.riskLevel)}>
                  <td className="px-4 py-2 font-medium">{s.dc}</td>
                  <td className="px-4 py-2">{s.shift}</td>
                  <td className="px-4 py-2 text-xs">{s.shiftStart}–{s.shiftEnd}</td>
                  <td className="px-4 py-2 text-right">{s.staffRostered}</td>
                  <td className="px-4 py-2 text-right">{s.staffActual}</td>
                  <td className="px-4 py-2 text-right">{s.staffRequired}</td>
                  <td className={`px-4 py-2 text-right font-medium ${s.staffGap < 0 ? "text-red-600" : "text-gray-900"}`}>
                    {s.staffGap}
                  </td>
                  <td className="px-4 py-2 text-right">{s.inboundPallets}</td>
                  <td className="px-4 py-2 text-right">{s.outboundOrders}</td>
                  <td className="px-4 py-2 text-right">{s.outboundPallets}</td>
                  <td className={`px-4 py-2 text-right ${s.productivity < 3.5 ? "text-amber-600" : "text-emerald-600"}`}>
                    {s.productivity.toFixed(1)}
                  </td>
                  <td className="px-4 py-2">{riskBadge(s.riskLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trend */}
      {data.trend.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">7-Day Trend</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">DC</th>
                  <th className="px-4 py-2">Avg Productivity</th>
                  <th className="px-4 py-2">Total Gap</th>
                  <th className="px-4 py-2">Understaffed Shifts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.trend.map((t, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2">{t.date}</td>
                    <td className="px-4 py-2">{t.dc}</td>
                    <td className={`px-4 py-2 ${t.avgProductivity < 3.5 ? "text-amber-600" : "text-emerald-600"}`}>
                      {t.avgProductivity.toFixed(1)}
                    </td>
                    <td className={`px-4 py-2 ${t.totalGap < 0 ? "text-red-600" : "text-gray-900"}`}>
                      {t.totalGap}
                    </td>
                    <td className="px-4 py-2">{t.understaffedShifts}</td>
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
