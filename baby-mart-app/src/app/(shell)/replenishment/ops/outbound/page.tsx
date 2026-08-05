"use client";

import { useState, useEffect } from "react";
import { Loader2, Truck, Package, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

interface KPIs {
  totalOrders: number;
  dispatched: number;
  avgDispatchHours: number;
  onTimeDispatchPct: number;
  avgPickAccuracy: number;
}

interface ChannelBreakdown {
  channel: string;
  orders: number;
  onTimePct: number;
  pallets: number;
}

interface CarrierPerformance {
  carrier: string;
  shipments: number;
  onTimePct: number;
  avgTransit: number;
}

interface Issues {
  backorders: number;
  splitShipments: number;
}

interface OutboundData {
  kpis: KPIs;
  byChannel: ChannelBreakdown[];
  carrierPerformance: CarrierPerformance[];
  issues: Issues;
}

const DCS = ["All", "NSW", "VIC", "QLD", "SA", "WA"];
const CHANNELS = ["All", "Store-Replenish", "Online-Direct"];

export default function OutboundDispatchPage() {
  const [dc, setDc] = useState("All");
  const [channel, setChannel] = useState("All");
  const [data, setData] = useState<OutboundData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supply/ops/outbound?dc=${dc === "All" ? "all" : dc}&channel=${channel === "All" ? "all" : channel}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dc, channel]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!data) return <div className="p-6 text-red-600">Failed to load data.</div>;

  const { kpis, byChannel, carrierPerformance, issues } = data;
  const dispatchedPct = kpis.totalOrders > 0 ? ((kpis.dispatched / kpis.totalOrders) * 100).toFixed(1) : "0";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Outbound Dispatch</h1>
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
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c === "All" ? "All Channels" : c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Package className="w-4 h-4" />
            Orders to Ship
          </div>
          <div className="text-2xl font-bold text-gray-900">{kpis.totalOrders.toLocaleString()}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Truck className="w-4 h-4" />
            Dispatched %
          </div>
          <div className="text-2xl font-bold text-gray-900">{dispatchedPct}%</div>
          <div className="text-xs text-gray-500 mt-1">{kpis.dispatched.toLocaleString()} shipped</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock className="w-4 h-4" />
            Avg Order-to-Dispatch
          </div>
          <div className="text-2xl font-bold text-gray-900">{kpis.avgDispatchHours.toFixed(1)}h</div>
          <div className={`text-xs mt-1 ${kpis.avgDispatchHours <= 8 ? "text-emerald-600" : "text-red-600"}`}>
            Target: 8h {kpis.avgDispatchHours <= 8 ? "✓" : "⚠"}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <CheckCircle2 className="w-4 h-4" />
            On-Time Dispatch
          </div>
          <div className={`text-2xl font-bold ${kpis.onTimeDispatchPct >= 95 ? "text-emerald-600" : "text-amber-600"}`}>
            {kpis.onTimeDispatchPct.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <CheckCircle2 className="w-4 h-4" />
            Pick Accuracy
          </div>
          <div className={`text-2xl font-bold ${kpis.avgPickAccuracy >= 99 ? "text-emerald-600" : "text-amber-600"}`}>
            {kpis.avgPickAccuracy.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Channel Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {byChannel.map((ch) => (
          <div key={ch.channel} className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">{ch.channel}</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-500">Orders</div>
                <div className="font-bold text-lg">{ch.orders.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500">On-Time %</div>
                <div className={`font-bold text-lg ${ch.onTimePct >= 95 ? "text-emerald-600" : "text-amber-600"}`}>
                  {ch.onTimePct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-500">Pallets</div>
                <div className="font-bold text-lg">{ch.pallets}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Carrier Performance */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
          <Truck className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Carrier Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">Carrier</th>
                <th className="px-4 py-2">Shipments</th>
                <th className="px-4 py-2">On-Time %</th>
                <th className="px-4 py-2">Avg Transit (days)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...carrierPerformance]
                .sort((a, b) => b.onTimePct - a.onTimePct)
                .map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{c.carrier}</td>
                    <td className="px-4 py-2 text-right">{c.shipments}</td>
                    <td className={`px-4 py-2 text-right ${c.onTimePct >= 95 ? "text-emerald-600" : "text-amber-600"}`}>
                      {c.onTimePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right">{c.avgTransit.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Issues Callout */}
      {(issues.backorders > 0 || issues.splitShipments > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-amber-800">Open Issues</h3>
            <div className="text-sm text-amber-700 mt-1 space-y-1">
              {issues.backorders > 0 && <div>Backorders: <span className="font-medium">{issues.backorders}</span></div>}
              {issues.splitShipments > 0 && <div>Split Shipments: <span className="font-medium">{issues.splitShipments}</span></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
