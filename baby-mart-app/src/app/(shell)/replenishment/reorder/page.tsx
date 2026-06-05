"use client";

import Link from "next/link";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { getReorderQueue } from "@/data/supplyChainData";

export default function ReorderQueuePage() {
  const queue = getReorderQueue();
  const totalUnits = queue.reduce((s, q) => s + q.qtyToOrder, 0);
  const totalCost = queue.reduce((s, q) => s + q.estCost, 0);
  const urgentCount = queue.filter((q) => q.priority === "urgent").length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Reorder Queue</h1>
        </div>
        <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md font-medium">
          {queue.length} orders pending
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Orders Pending</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{queue.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Urgent</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{urgentCount}</div>
          <div className="mt-1 text-xs text-red-500">WOC &lt; 3 weeks</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Total Units</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Est. Cost</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">${(totalCost / 1000).toFixed(0)}K</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Category</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Current WOC</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Daily Run Rate</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Qty to Order</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Lead Time</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Priority</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Est. Cost</th>
              <th className="text-center py-2 text-xs font-semibold text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((item) => {
              const priorityColor = item.priority === "urgent"
                ? "text-red-700 bg-red-100"
                : item.priority === "high"
                ? "text-amber-700 bg-amber-100"
                : "text-blue-700 bg-blue-100";

              return (
                <tr key={item.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3">
                    <Link href={`/replenishment/brand/${encodeURIComponent(item.brand)}`} className="font-medium text-blue-700 hover:underline">{item.brand}</Link>
                  </td>
                  <td className="py-3 text-xs text-slate-500">{item.category}</td>
                  <td className={`py-3 text-right font-mono ${item.currentWoc < 4 ? "text-red-600 font-bold" : "text-amber-600 font-semibold"}`}>
                    {item.currentWoc}
                  </td>
                  <td className="py-3 text-right font-mono text-slate-700">{item.dailyRunRate}/day</td>
                  <td className="py-3 text-right font-mono font-semibold text-slate-900">{item.qtyToOrder.toLocaleString()}</td>
                  <td className="py-3 text-center text-xs text-slate-600">{item.leadTimeDays} days</td>
                  <td className="py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${priorityColor}`}>
                      {item.priority === "urgent" && <AlertTriangle className="w-3 h-3" />}
                      {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono text-sm text-slate-700">${(item.estCost / 1000).toFixed(1)}K</td>
                  <td className="py-3 text-center">
                    <button className={`px-3 py-1 rounded text-[10px] font-semibold ${
                      item.priority === "urgent"
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}>
                      {item.priority === "urgent" ? "Rush Order" : "Place Order"}
                    </button>
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
