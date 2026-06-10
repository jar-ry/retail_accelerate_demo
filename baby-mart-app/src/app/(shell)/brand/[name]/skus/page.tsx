"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Package, Loader2, TrendingUp, TrendingDown } from "lucide-react";

function fmt(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function SkuPerformancePage() {
  const params = useParams<{ name: string }>();
  const brand = decodeURIComponent(params?.name || "");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!brand) return;
    fetch(`/api/brand/${encodeURIComponent(brand)}/skus`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [brand]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-6">
        <Link href={`/brand/${encodeURIComponent(brand)}`} className="text-blue-700 hover:underline text-sm">← Back to {brand}</Link>
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {data?.error || "Failed to load SKU data"}
        </div>
      </div>
    );
  }

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = [...(data.skus || [])].sort((a: any, b: any) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const lifecycleColor: Record<string, string> = {
    Core: "bg-blue-100 text-blue-700",
    New: "bg-emerald-100 text-emerald-700",
    Markdown: "bg-amber-100 text-amber-700",
    Exit: "bg-red-100 text-red-700",
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/brand/${encodeURIComponent(brand)}`} className="text-slate-400 hover:text-slate-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Package className="w-5 h-5 text-blue-700" />
        <h1 className="text-xl font-bold text-slate-900">{brand} — SKU Performance</h1>
        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">{data.skus?.length} SKUs</span>
      </div>

      {/* Class Summary Cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {data.classes?.slice(0, 5).map((cls: any) => (
          <div key={cls.name} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-[10px] font-semibold text-slate-400 uppercase truncate">{cls.name}</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900">{fmt(cls.revenue)}</div>
            <div className="mt-0.5 text-xs text-slate-500">{cls.units.toLocaleString()} units | {cls.marginPct}% margin</div>
          </div>
        ))}
      </div>

      {/* SKU Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">SKU Detail (Last 28 Days vs Prior Year)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                <th className="text-left px-4 py-2.5">Product</th>
                <th className="text-left px-2 py-2.5">Class</th>
                <th className="text-left px-2 py-2.5">Stage</th>
                <th className="text-right px-2 py-2.5 cursor-pointer hover:text-slate-800" onClick={() => toggleSort("revenue")}>
                  Revenue {sortKey === "revenue" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className="text-right px-2 py-2.5 cursor-pointer hover:text-slate-800" onClick={() => toggleSort("units")}>
                  Units {sortKey === "units" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className="text-right px-2 py-2.5">Avg Price</th>
                <th className="text-right px-2 py-2.5 cursor-pointer hover:text-slate-800" onClick={() => toggleSort("actualMarginPct")}>
                  Gross Margin % {sortKey === "actualMarginPct" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className="text-right px-3 py-2.5 cursor-pointer hover:text-slate-800" onClick={() => toggleSort("growth")}>
                  Growth {sortKey === "growth" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sku: any, i: number) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[200px] truncate">{sku.name}</td>
                  <td className="px-2 py-2.5 text-slate-500">{sku.class}</td>
                  <td className="px-2 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${lifecycleColor[sku.lifecycleStage] || "bg-slate-100 text-slate-600"}`}>
                      {sku.lifecycleStage}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono">{fmt(sku.revenue)}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{sku.units}</td>
                  <td className="px-2 py-2.5 text-right font-mono">${sku.avgSellingPrice?.toFixed(2)}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{sku.actualMarginPct}%</td>
                  <td className="px-3 py-2.5 text-right">
                    {sku.growth !== null ? (
                      <span className={`inline-flex items-center gap-0.5 font-mono font-semibold ${sku.growth >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {sku.growth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {sku.growth >= 0 ? "+" : ""}{sku.growth}%
                      </span>
                    ) : (
                      <span className="text-slate-400">New</span>
                    )}
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
