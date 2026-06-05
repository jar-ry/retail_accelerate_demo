"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight, Loader2, ArrowRight } from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface DifotWeek { week: number; difotPct: number; ordersTotal: number; ordersOnTime: number; }
interface SkuDifot { skuClass: string; avgDifot: number; totalOrders: number; totalOnTime: number; weeksBelowTarget: number; }
interface SkuTrend { skuClass: string; week: number; difotPct: number; ordersTotal: number; ordersOnTime: number; }

const SKU_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function getDifotColor(difot: number): string {
  if (difot >= 96) return "text-emerald-600";
  if (difot >= 92) return "text-amber-600";
  return "text-red-600";
}

export default function SupplierDifotBrandPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const brandParam = params.brand as string;
  const brand = decodeURIComponent(brandParam || "");
  const defaultSku = searchParams.get("sku") || null;

  const [data, setData] = useState<DifotWeek[]>([]);
  const [skus, setSkus] = useState<SkuDifot[]>([]);
  const [skuTrends, setSkuTrends] = useState<SkuTrend[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(defaultSku);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/supply/difot/${encodeURIComponent(brand)}`).then((r) => r.json()),
      fetch(`/api/supply/difot/${encodeURIComponent(brand)}/skus`).then((r) => r.json()),
      fetch(`/api/supply/difot/${encodeURIComponent(brand)}/sku-trends`).then((r) => r.json()),
    ]).then(([d, s, t]) => {
      if (Array.isArray(d)) setData(d);
      if (Array.isArray(s)) {
        setSkus(s);
        if (!defaultSku && s.length > 0) setSelectedSku(s[0].skuClass);
      }
      if (Array.isArray(t)) setSkuTrends(t);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [brand]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading DIFOT data for {brand}...</p>
      </div>
    );
  }

  const avgDifot = data.length > 0 ? (data.reduce((s, d) => s + d.difotPct, 0) / data.length).toFixed(1) : "0";
  const totalOrders = data.reduce((s, d) => s + d.ordersTotal, 0);
  const totalOnTime = data.reduce((s, d) => s + d.ordersOnTime, 0);
  const belowTarget = data.filter((d) => d.difotPct < 96).length;
  const latestDifot = data.length > 0 ? data[data.length - 1].difotPct : 0;
  const trend4wk = data.length >= 8
    ? ((data.slice(-4).reduce((s, d) => s + d.difotPct, 0) / 4) - (data.slice(-8, -4).reduce((s, d) => s + d.difotPct, 0) / 4)).toFixed(1)
    : "0";

  const skuClasses = [...new Set(skuTrends.map((t) => t.skuClass))];

  const skuTraces = skuClasses.map((sku, i) => {
    const pts = skuTrends.filter((t) => t.skuClass === sku);
    const isSelected = selectedSku === sku;
    return {
      x: pts.map((p) => `W${p.week}`),
      y: pts.map((p) => p.difotPct),
      name: sku,
      type: "scatter" as const,
      mode: "lines+markers" as const,
      line: { color: SKU_COLORS[i % SKU_COLORS.length], width: isSelected ? 3 : 1.5, dash: isSelected ? undefined : "dot" as const },
      marker: { size: isSelected ? 6 : 4 },
      opacity: selectedSku ? (isSelected ? 1 : 0.35) : 1,
    };
  });

  const brandTrace = {
    x: data.map((d) => `W${d.week}`),
    y: data.map((d) => d.difotPct),
    name: "Brand Avg",
    type: "scatter" as const,
    mode: "lines" as const,
    line: { color: "#94a3b8", width: 1.5, dash: "dash" as const },
    opacity: 0.6,
  };

  return (
    <div className="p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/replenishment/demand" className="hover:text-emerald-700">Customer Demand</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/replenishment/dc" className="hover:text-emerald-700">DC Impact</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-900 font-medium">{brand} — DIFOT</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{brand} — Supplier DIFOT</h1>
          <p className="text-xs text-slate-500 mt-0.5">Delivery In Full On Time — by product SKU</p>
        </div>
        <Link
          href={`/replenishment/brand/${encodeURIComponent(brand)}`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-semibold hover:bg-emerald-800"
        >
          Full Brand Detail <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Brand Avg DIFOT</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${getDifotColor(parseFloat(avgDifot))}`}>{avgDifot}%</div>
          <div className="mt-1 text-[10px] text-slate-400">Target: 96%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Latest Week</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${getDifotColor(latestDifot)}`}>{latestDifot}%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-medium text-slate-500 uppercase">4wk Trend</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${parseFloat(trend4wk) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{parseFloat(trend4wk) > 0 ? "+" : ""}{trend4wk}pp</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Wks Below Target</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{belowTarget}</div>
          <div className="mt-1 text-[10px] text-slate-400">of {data.length} weeks</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Orders (YTD)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{totalOrders.toLocaleString()}</div>
          <div className="mt-1 text-[10px] text-slate-400">{totalOnTime} on time</div>
        </div>
      </div>

      {skus.length > 0 && (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">DIFOT by Product SKU — click to focus</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-semibold text-slate-500">SKU / Product Line</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Avg DIFOT</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Orders</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">On Time</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Wks Below Target</th>
                <th className="text-center py-2 text-xs font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s, i) => {
                const isSelected = selectedSku === s.skuClass;
                const status = s.avgDifot >= 96 ? "On Track" : s.avgDifot >= 92 ? "At Risk" : "Failing";
                const statusColor = s.avgDifot >= 96 ? "text-emerald-700 bg-emerald-100" : s.avgDifot >= 92 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-100";
                return (
                  <tr
                    key={s.skuClass}
                    onClick={() => setSelectedSku(isSelected ? null : s.skuClass)}
                    className={`border-b border-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "hover:bg-slate-50"}`}
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SKU_COLORS[i % SKU_COLORS.length] }} />
                        <span className={`font-medium ${isSelected ? "text-blue-800" : "text-slate-800"}`}>{s.skuClass}</span>
                        {isSelected && <span className="text-[10px] text-blue-500 font-medium">(selected)</span>}
                      </div>
                    </td>
                    <td className={`py-2.5 text-right font-mono font-semibold ${getDifotColor(s.avgDifot)}`}>{s.avgDifot}%</td>
                    <td className="py-2.5 text-right font-mono text-slate-600">{s.totalOrders}</td>
                    <td className="py-2.5 text-right font-mono text-emerald-600">{s.totalOnTime}</td>
                    <td className="py-2.5 text-center">
                      {s.weeksBelowTarget > 0 ? <span className="text-xs text-red-600 font-semibold">{s.weeksBelowTarget}</span> : <span className="text-xs text-emerald-600">0</span>}
                    </td>
                    <td className="py-2.5 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>{status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">DIFOT % by SKU — Weekly Trend</h3>
          {selectedSku && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Focused:</span>
              <span className="font-semibold text-blue-700">{selectedSku}</span>
              <button onClick={() => setSelectedSku(null)} className="text-slate-400 hover:text-slate-600 ml-1">✕</button>
            </div>
          )}
        </div>
        <Plot
          data={[brandTrace, ...skuTraces]}
          layout={{
            height: 320, margin: { l: 50, r: 50, t: 10, b: 40 },
            legend: { orientation: "h" as const, y: -0.2, x: 0.5, xanchor: "center" as const, font: { size: 9 } },
            yaxis: { title: { text: "DIFOT %", font: { size: 10 } }, range: [82, 100] },
            xaxis: { title: { text: "Week", font: { size: 10 } } },
            shapes: [{ type: "line" as const, x0: 0, x1: 1, xref: "paper" as const, y0: 96, y1: 96, yref: "y" as const, line: { color: "#dc2626", width: 1.5, dash: "dash" as const } }],
            annotations: [{ x: 0.02, y: 96, xref: "paper" as const, text: "Target 96%", showarrow: false, font: { size: 9, color: "#dc2626" }, yshift: 8 }],
            font: { family: "Inter, system-ui, sans-serif" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
