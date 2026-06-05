"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Package, Loader2, ArrowRight } from "lucide-react";
import { useBrandSupply } from "@/hooks/useSupplyData";

interface SkuProfile {
  brand: string;
  skuClass: string;
  category: string;
  dailyDemand: number;
  weeklyDemand: number;
  currentStock: number;
  reorderPoint: number;
  leadTimeDays: number;
  stockoutCostPerDay: number;
  supplierName: string;
  woc: number;
}

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

export default function ReplenishmentBrandPage() {
  const params = useParams();
  const brandName = params.brandName as string;
  const brand = decodeURIComponent(brandName || "");
  const { data: supply, isLoading: brandLoading } = useBrandSupply(brand);
  const [skus, setSkus] = useState<SkuProfile[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const hasSKUs = skus.length > 0;

  useEffect(() => {
    fetch(`/api/supply/brand/${encodeURIComponent(brand)}/skus`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setSkus(data); })
      .catch(() => {})
      .finally(() => setSkuLoading(false));
  }, [brand]);

  if (brandLoading || skuLoading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading supply data for {brand}...</p>
      </div>
    );
  }

  if (!supply) {
    return (
      <div className="p-6">
        <Link href="/replenishment" className="text-emerald-700 hover:underline text-sm">← Back to Replenishment</Link>
        <p className="mt-4 text-slate-500">Supply data not found for {brand}.</p>
      </div>
    );
  }

  const woc = supply.weeklyDemand > 0 ? (supply.currentStock / supply.weeklyDemand).toFixed(1) : "0";
  const wocNum = parseFloat(woc);
  const wocColor = wocNum < 4 ? "text-red-600" : wocNum < 6 ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/replenishment" className="hover:text-emerald-700">Replenishment</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-900 font-medium">{brand}</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{brand}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{supply.category} — Supplied by {supply.supplierName}</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
          wocNum < 4 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"
        }`}>
          <Package className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-medium">Brand WOC: <span className={`font-mono font-bold ${wocColor}`}>{woc}</span></span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Total Stock</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900">{supply.currentStock.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Daily Demand</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900">{supply.dailyDemand}</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Lead Time</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900">{supply.leadTimeDays}d</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Next Delivery</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900">{supply.nextDelivery}</div>
        </div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">SKU Lines</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-900">{hasSKUs ? skus.length : "—"}</div>
        </div>
      </div>

      {hasSKUs ? (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-semibold text-slate-800">Product SKU Breakdown</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-semibold text-slate-500">SKU / Product Line</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Stock</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">WOC</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Demand/day</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Lead Time</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Stockout Cost</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => {
                const status = getStockStatus(sku.woc);
                return (
                  <tr key={sku.skuClass} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3">
                      <Link
                        href={`/replenishment/brand/${encodeURIComponent(brand)}/sku/${encodeURIComponent(sku.skuClass)}`}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {sku.skuClass}
                      </Link>
                    </td>
                    <td className="py-3 text-right font-mono">{sku.currentStock.toLocaleString()}</td>
                    <td className={`py-3 text-right font-mono ${getWocColor(sku.woc)}`}>{sku.woc}</td>
                    <td className="py-3 text-right font-mono text-slate-700">{sku.dailyDemand}</td>
                    <td className="py-3 text-center text-xs text-slate-600">{sku.leadTimeDays}d</td>
                    <td className="py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.color} ${status.bg}`}>{status.label}</span>
                    </td>
                    <td className="py-3 text-right font-mono text-xs text-slate-600">${sku.stockoutCostPerDay}/day</td>
                    <td className="py-3 text-center">
                      <Link
                        href={`/replenishment/brand/${encodeURIComponent(brand)}/sku/${encodeURIComponent(sku.skuClass)}`}
                        className="text-emerald-600 hover:text-emerald-800"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm text-center text-slate-500 text-sm">
          No SKU-level data available for {brand}. Brand-level view shown above.
        </div>
      )}
    </div>
  );
}
