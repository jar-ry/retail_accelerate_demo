"use client";

import Link from "next/link";
import { AlertTriangle, Package, Truck, CheckCircle2, XCircle, Clock, Loader2, RefreshCw } from "lucide-react";
import { useSupplyProfiles, useRefreshSupplyData } from "@/hooks/useSupplyData";

function getStockStatus(woc: number): { label: string; color: string; bg: string } {
  if (woc < 4) return { label: "Critical", color: "text-red-700", bg: "bg-red-100" };
  if (woc < 6) return { label: "Low", color: "text-amber-700", bg: "bg-amber-100" };
  if (woc <= 10) return { label: "OK", color: "text-emerald-700", bg: "bg-emerald-100" };
  return { label: "Overstock", color: "text-orange-700", bg: "bg-orange-100" };
}

function getWocColor(woc: number): string {
  if (woc < 4) return "text-red-600 font-bold";
  if (woc < 6) return "text-amber-600 font-semibold";
  if (woc <= 10) return "text-emerald-600";
  return "text-orange-600 font-semibold";
}

export default function ReplenishmentPage() {
  const { data: profiles = [], isLoading: loading, isFetching } = useSupplyProfiles();
  const refresh = useRefreshSupplyData();

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading supply chain data...</p>
      </div>
    );
  }

  const criticalStock = profiles.filter((b) => b.woc < 4);
  const lowStock = profiles.filter((b) => b.woc >= 4 && b.woc < 6);
  const overstock = profiles.filter((b) => b.woc > 10);
  const avgWoc = profiles.length > 0 ? (profiles.reduce((s, b) => s + b.woc, 0) / profiles.length).toFixed(1) : "0";

  const sortedByWoc = [...profiles].sort((a, b) => a.woc - b.woc);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Replenishment Dashboard</h1>
        <button
          onClick={refresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md font-medium hover:bg-slate-200 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Brands Monitored</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{profiles.length}</div>
          <div className="mt-1 text-xs text-slate-400">Avg WOC: {avgWoc}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Below Min Stock</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{criticalStock.length + lowStock.length}</div>
          <div className="mt-1 text-xs text-red-500">{criticalStock.length} critical, {lowStock.length} low</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Overstock Risk</div>
          <div className="mt-1 font-mono text-2xl font-bold text-orange-600">{overstock.length}</div>
          <div className="mt-1 text-xs text-orange-500">Brands with WOC &gt; 10</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Total Stock Value</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
            ${Math.round(profiles.reduce((s, b) => s + b.stockoutCostPerDay * b.woc * 7, 0) / 1000)}K
          </div>
          <div className="mt-1 text-xs text-slate-400">Est. at cost</div>
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-800">Stock Health Overview</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
                <th className="text-left py-2 text-xs font-semibold text-slate-500">Category</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">WOC</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Demand/day</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Lead Time</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedByWoc.map((b) => {
                const status = getStockStatus(b.woc);
                return (
                  <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2.5">
                      <Link href={`/replenishment/brand/${encodeURIComponent(b.brand)}`} className="font-medium text-emerald-700 hover:underline text-sm">{b.brand}</Link>
                    </td>
                    <td className="py-2.5 text-xs text-slate-500">{b.category}</td>
                    <td className={`py-2.5 text-right font-mono text-sm ${getWocColor(b.woc)}`}>{b.woc}</td>
                    <td className="py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.color} ${status.bg}`}>{status.label}</span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs text-slate-600">{b.dailyDemand}</td>
                    <td className="py-2.5 text-center text-xs text-slate-600">{b.leadTimeDays}d</td>
                    <td className="py-2.5 text-center">
                      {b.woc < 4 && <button className="px-2 py-1 bg-red-600 text-white rounded text-[10px] font-semibold hover:bg-red-700">Reorder</button>}
                      {b.woc >= 4 && b.woc < 6 && <span className="text-[10px] text-amber-600 font-medium">Monitor</span>}
                      {b.woc > 10 && <span className="text-[10px] text-orange-600 font-medium">Review</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Truck className="w-4 h-4 text-blue-700" />
              <h3 className="text-sm font-semibold text-slate-800">Supplier Summary</h3>
            </div>
            <div className="space-y-2.5">
              {sortedByWoc.map((b) => {
                const barColor = b.woc < 4 ? "bg-red-500" : b.woc < 6 ? "bg-amber-500" : b.woc <= 10 ? "bg-emerald-500" : "bg-orange-500";
                const pct = Math.min(100, (b.woc / 12) * 100);
                return (
                  <div key={b.brand}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-700 font-medium">{b.brand}</span>
                      <span className={`font-mono font-semibold ${getWocColor(b.woc)}`}>{b.woc} wk</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-slate-800">Quick Alerts</h3>
            </div>
            <div className="space-y-2">
              {criticalStock.map((b) => (
                <div key={b.brand} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
                  <XCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-red-800">{b.brand} — Reorder Required</div>
                    <div className="text-[10px] text-red-600">WOC {b.woc} (below minimum 4.0)</div>
                  </div>
                </div>
              ))}
              {overstock.map((b) => (
                <div key={b.brand} className="flex items-start gap-2 p-2 bg-orange-50 rounded-lg border border-orange-100">
                  <Clock className="w-3.5 h-3.5 text-orange-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-orange-800">{b.brand} — Overstock Risk</div>
                    <div className="text-[10px] text-orange-600">WOC {b.woc} (above threshold 10.0)</div>
                  </div>
                </div>
              ))}
              {criticalStock.length === 0 && overstock.length === 0 && (
                <div className="flex items-center gap-2 p-2 text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs">All stock levels healthy</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
