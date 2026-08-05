"use client";

import { useState, useEffect } from "react";
import { Loader2, Clock, Truck, CheckCircle2, XCircle } from "lucide-react";

interface LeadTimeRow {
  supplier: string;
  brands: string;
  stdLeadTime: number;
  avgActualLead: number;
  gap: number;
  sourcingType: string;
  is3plViable: boolean;
  carrier: string;
  transportMode: string;
  est3plDays: number;
  totalPOs: number;
  otPct: number;
}

export default function LeadTimePage() {
  const [data, setData] = useState<LeadTimeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supply/planning/leadtime")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading lead time data...</p>
      </div>
    );
  }

  if (data.length === 0) return <div className="p-8 text-red-600">No lead time data available</div>;

  const viable3pl = data.filter((d) => d.is3plViable);
  const avgGap = data.reduce((s, d) => s + d.gap, 0) / data.length;
  const worstGap = data.reduce((max, d) => (d.gap > max.gap ? d : max), data[0]);

  const carriers = data.reduce<Record<string, { count: number; avgOt: number; totalOt: number }>>((acc, d) => {
    if (!acc[d.carrier]) acc[d.carrier] = { count: 0, avgOt: 0, totalOt: 0 };
    acc[d.carrier].count++;
    acc[d.carrier].totalOt += d.otPct;
    acc[d.carrier].avgOt = acc[d.carrier].totalOt / acc[d.carrier].count;
    return acc;
  }, {});

  function getGapColor(gap: number): string {
    if (gap > 2) return "text-red-600 bg-red-50";
    if (gap > 0) return "text-amber-600 bg-amber-50";
    return "text-emerald-600 bg-emerald-50";
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lead Time & 3PL Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">Standard vs actual lead times and 3PL viability assessment</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-slate-400" />
            <div className="text-xs text-slate-500 font-medium uppercase">Avg Lead Gap</div>
          </div>
          <div className={`text-3xl font-bold mt-1 ${avgGap > 2 ? "text-red-600" : avgGap > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            +{avgGap.toFixed(1)}d
          </div>
          <div className="text-xs text-slate-400 mt-1">Actual vs standard</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Worst Gap</div>
          <div className="text-3xl font-bold mt-1 text-red-600">+{worstGap.gap}d</div>
          <div className="text-xs text-slate-400 mt-1 truncate">{worstGap.supplier}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Truck className="w-4 h-4 text-emerald-500" />
            <div className="text-xs text-slate-500 font-medium uppercase">3PL Viable</div>
          </div>
          <div className="text-3xl font-bold mt-1 text-emerald-600">{viable3pl.length}</div>
          <div className="text-xs text-slate-400 mt-1">of {data.length} suppliers</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs text-slate-500 font-medium uppercase">Suppliers Tracked</div>
          <div className="text-3xl font-bold mt-1 text-slate-900">{data.length}</div>
          <div className="text-xs text-slate-400 mt-1">{data.reduce((s, d) => s + d.totalPOs, 0).toLocaleString()} total POs</div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Supplier Lead Time Detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="pb-2 font-medium">Supplier</th>
                <th className="pb-2 font-medium">Brands</th>
                <th className="pb-2 font-medium text-right">Std (d)</th>
                <th className="pb-2 font-medium text-right">Actual (d)</th>
                <th className="pb-2 font-medium text-right">Gap</th>
                <th className="pb-2 font-medium">Sourcing</th>
                <th className="pb-2 font-medium">Carrier</th>
                <th className="pb-2 font-medium">Transport</th>
                <th className="pb-2 font-medium text-center">3PL</th>
                <th className="pb-2 font-medium text-right">Est. 3PL (d)</th>
                <th className="pb-2 font-medium text-right">POs</th>
                <th className="pb-2 font-medium text-right">OT%</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.supplier} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{row.supplier}</td>
                  <td className="py-2 text-xs text-slate-600 max-w-[180px] truncate" title={row.brands}>{row.brands}</td>
                  <td className="py-2 text-right font-mono text-slate-600">{row.stdLeadTime}</td>
                  <td className="py-2 text-right font-mono font-medium text-slate-800">{row.avgActualLead}</td>
                  <td className="py-2 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getGapColor(row.gap)}`}>
                      +{row.gap}d
                    </span>
                  </td>
                  <td className="py-2 text-xs text-slate-500">{row.sourcingType}</td>
                  <td className="py-2 text-xs text-slate-600">{row.carrier}</td>
                  <td className="py-2 text-xs text-slate-500">{row.transportMode}</td>
                  <td className="py-2 text-center">
                    {row.is3plViable ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 inline-block" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-300 inline-block" />
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-slate-600">{row.est3plDays}</td>
                  <td className="py-2 text-right font-mono text-slate-400">{row.totalPOs.toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <span className={`font-mono font-medium ${row.otPct >= 95 ? "text-emerald-600" : row.otPct >= 85 ? "text-amber-600" : "text-red-600"}`}>
                      {row.otPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3PL Recommendation */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Truck className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800">3PL Recommendation</h3>
        </div>
        {viable3pl.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {viable3pl.length} supplier{viable3pl.length > 1 ? "s" : ""} could benefit from 3PL transition, with an estimated reduction of{" "}
              <span className="font-semibold text-emerald-700">
                {(viable3pl.reduce((s, d) => s + (d.avgActualLead - d.est3plDays), 0) / viable3pl.length).toFixed(1)} days
              </span>{" "}
              average lead time.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {viable3pl.map((s) => (
                <div key={s.supplier} className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="text-sm font-medium text-emerald-900">{s.supplier}</div>
                  <div className="text-xs text-emerald-700 mt-1">
                    Current: {s.avgActualLead}d → 3PL est: {s.est3plDays}d
                    <span className="ml-2 font-semibold">(-{s.avgActualLead - s.est3plDays}d)</span>
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-1">{s.brands}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No suppliers currently flagged as 3PL-viable.</p>
        )}
      </div>

      {/* Carrier Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Carrier Performance Summary</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(carriers).map(([carrier, stats]) => (
            <div key={carrier} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-sm font-medium text-slate-800">{carrier}</div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-slate-500">{stats.count} supplier{stats.count > 1 ? "s" : ""}</div>
                <div className={`text-sm font-semibold ${stats.avgOt >= 95 ? "text-emerald-600" : stats.avgOt >= 85 ? "text-amber-600" : "text-red-600"}`}>
                  {stats.avgOt.toFixed(1)}% OT
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
