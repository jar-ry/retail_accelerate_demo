"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Warehouse, Loader2, ChevronRight, ArrowRight, TrendingDown } from "lucide-react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface DcStock {
  state: string;
  brand: string;
  skuClass: string;
  stock: number;
  reorderPoint: number;
  demandUnits: number;
  woc?: number;
  supplier?: string | null;
  leadTime?: number | null;
  nextDeliveryDate?: string | null;
  nextDeliveryStatus?: string | null;
  nextDeliveryUnits?: number | null;
}

interface StoreRow {
  store: string;
  state: string;
  dc: string;
  weeklyDemand: number;
  shelfPct: number;
  weeksToStockout: number;
  salesLossWeek: number;
  predictedLoss4wk: number;
  storeStock: number;
}

interface DcStockForecast {
  state: string;
  stock: number;
  weeklyDemand: number;
  weeksLeft: number;
  restockWeek: number;
  restockQty: number;
  trajectory: number[];
}

interface StoreForecast {
  stores: StoreRow[];
  summary: {
    totalStores: number;
    atRiskStores: number;
    weeklyLoss: number;
    predicted4wkLoss: number;
  };
  dcStocks: DcStockForecast[];
  demandForecast?: { week: string; forecastUnits: number; actualUnits: number | null; isForecast: boolean }[];
}

const DC_COLORS: Record<string, string> = {
  NSW: "#2563eb",
  VIC: "#8b5cf6",
  QLD: "#f59e0b",
  WA: "#10b981",
  SA: "#ec4899",
};

function fmt(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function DcReplenishmentContent() {
  const searchParams = useSearchParams();
  const filterBrand = searchParams.get("brand");
  const filterSku = searchParams.get("sku");
  const changePct = searchParams.get("change");
  const demandGrowth = changePct ? parseFloat(changePct) : 0;

  const [dcData, setDcData] = useState<DcStock[]>([]);
  const [storeForecast, setStoreForecast] = useState<StoreForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);

  useEffect(() => {
    fetch("/api/supply/dc/overview")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setDcData(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!filterBrand || !filterSku) return;
    setForecastLoading(true);
    const params = demandGrowth !== 0 ? `?change=${demandGrowth}` : "";
    fetch(`/api/supply/dc/${encodeURIComponent(filterBrand)}/${encodeURIComponent(filterSku)}/store-forecast${params}`)
      .then((r) => r.json())
      .then((data) => setStoreForecast(data))
      .catch(() => {})
      .finally(() => setForecastLoading(false));
  }, [filterBrand, filterSku, demandGrowth]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading DC data...</p>
      </div>
    );
  }

  // — Overview mode (no brand filter) —
  if (!filterBrand) {
    const filtered = dcData;
    const stateAgg: Record<string, { stock: number; reorderPoint: number; demandUnits: number }> = {};
    filtered.forEach((d) => {
      if (!stateAgg[d.state]) stateAgg[d.state] = { stock: 0, reorderPoint: 0, demandUnits: 0 };
      stateAgg[d.state].stock += d.stock;
      stateAgg[d.state].reorderPoint += d.reorderPoint;
      stateAgg[d.state].demandUnits += d.demandUnits;
    });
    const states = Object.entries(stateAgg).sort((a, b) => b[1].stock - a[1].stock);
    const totalStock = states.reduce((s, [, v]) => s + v.stock, 0);

    const chartData = states.map(([state, agg]) => ({
      x: [state],
      y: [agg.stock],
      name: state,
      type: "bar" as const,
      marker: { color: DC_COLORS[state] || "#64748b" },
    }));

    const weeksToStockout = (state: string) => {
      const agg = stateAgg[state];
      if (!agg || agg.stock <= 0) return 0;
      const weeklyDemand = agg.demandUnits > 0 ? agg.demandUnits : agg.reorderPoint / 4;
      if (weeklyDemand <= 0) return 99;
      return Math.round((agg.stock / weeklyDemand) * 10) / 10;
    };

    // Attention items: WoC < 3
    const attentionItems = filtered.filter(d => {
      const demand = d.demandUnits > 0 ? d.demandUnits : d.reorderPoint / 4;
      return demand > 0 && (d.stock / demand) < 3;
    }).slice(0, 5);

    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Warehouse className="w-5 h-5 text-purple-700" />
            <h1 className="text-xl font-bold text-slate-900">DC Replenishment</h1>
          </div>
          <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md font-medium">All Brands</div>
        </div>

        {/* Attention Banner */}
        {attentionItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-red-700">Attention Required ({attentionItems.length} items below 3 WoC)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-red-600/70">
                  <th className="pb-1 font-medium">Brand / SKU</th><th className="pb-1 font-medium">DC</th>
                  <th className="pb-1 font-medium">Stock</th><th className="pb-1 font-medium">WoC</th>
                  <th className="pb-1 font-medium">Supplier</th><th className="pb-1 font-medium">Lead Time</th>
                  <th className="pb-1 font-medium">Next Delivery</th>
                </tr></thead>
                <tbody>
                  {attentionItems.map((d, i) => {
                    const demand = d.demandUnits > 0 ? d.demandUnits : d.reorderPoint / 4;
                    const woc = demand > 0 ? Math.round((d.stock / demand) * 10) / 10 : 99;
                    return (
                      <tr key={i} className="border-t border-red-100">
                        <td className="py-1.5 font-medium text-slate-800">{d.brand} — {d.skuClass}</td>
                        <td className="py-1.5 text-slate-600">{d.state}</td>
                        <td className="py-1.5 text-slate-800">{d.stock}</td>
                        <td className={`py-1.5 font-bold ${woc < 2 ? "text-red-700" : "text-amber-600"}`}>{woc}</td>
                        <td className="py-1.5 text-slate-600">{d.supplier || "—"}</td>
                        <td className="py-1.5 text-slate-600">{d.leadTime ? `${d.leadTime}d` : "—"}</td>
                        <td className="py-1.5">{d.nextDeliveryDate
                          ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${d.nextDeliveryStatus === "IN_TRANSIT" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{d.nextDeliveryStatus} — {new Date(d.nextDeliveryDate).toLocaleDateString()}</span>
                          : <span className="text-red-500 font-medium">None scheduled</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-3 mb-6">
          {states.map(([state, agg]) => {
            const pct = totalStock > 0 ? Math.round((agg.stock / totalStock) * 100) : 0;
            const wks = weeksToStockout(state);
            const critical = wks < 2;
            const warning = wks >= 2 && wks < 4;
            return (
              <div key={state} className={`rounded-xl p-4 border shadow-sm text-center ${critical ? "bg-red-50 border-red-200" : warning ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}>
                <div className="text-[10px] font-semibold text-slate-500 uppercase">{state} DC</div>
                <div className="mt-1 font-mono text-xl font-bold text-slate-900">{agg.stock.toLocaleString()}</div>
                <div className="text-[10px] text-slate-400">{pct}% of total</div>
                <div className={`mt-1 text-xs font-semibold ${critical ? "text-red-700" : warning ? "text-amber-700" : "text-emerald-600"}`}>
                  {wks}wk cover
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">DC Stock Levels</h3>
            <Plot
              data={chartData}
              layout={{
                height: 280, margin: { l: 50, r: 20, t: 10, b: 30 },
                barmode: "group" as const,
                showlegend: false,
                yaxis: { title: { text: "Units", font: { size: 10 } } },
                font: { family: "Inter, system-ui, sans-serif" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">SKU Detail</h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {filtered.slice(0, 20).map((d, i) => {
                const healthy = d.stock > d.reorderPoint;
                return (
                  <Link key={i} href={`/replenishment/dc?brand=${encodeURIComponent(d.brand)}&sku=${encodeURIComponent(d.skuClass)}`} className="flex items-center justify-between p-2 rounded-lg border border-slate-100 text-xs hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-blue-700">{d.brand} — {d.skuClass}</div>
                      <div className="text-[10px] text-slate-400">{d.state} DC{d.supplier ? ` · ${d.supplier}` : ""}{d.leadTime ? ` · ${d.leadTime}d lead` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-semibold ${healthy ? "text-emerald-600" : "text-red-600"}`}>{d.stock}</div>
                      <div className="text-[10px] text-slate-400">RP: {d.reorderPoint}</div>
                      {d.nextDeliveryStatus && <div className="text-[9px] text-blue-500">{d.nextDeliveryStatus}</div>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // — Filtered / drill-down mode (brand + SKU) —
  return (
    <div className="p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/replenishment/demand" className="hover:text-emerald-700">Customer Demand</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link
          href={`/replenishment/demand/${encodeURIComponent(filterBrand)}/${encodeURIComponent(filterSku || "")}`}
          className="hover:text-emerald-700"
        >
          {filterBrand} — {filterSku}
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-700 font-medium">DC Impact</span>
      </nav>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Warehouse className="w-5 h-5 text-purple-700" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">DC Impact — {filterBrand} / {filterSku}</h1>
            {demandGrowth !== 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                Demand growth applied: <span className={`font-semibold ${demandGrowth > 0 ? "text-red-600" : "text-blue-600"}`}>{demandGrowth > 0 ? "+" : ""}{demandGrowth}%</span>
              </p>
            )}
          </div>
        </div>
        <Link
          href={`/replenishment/difot/${encodeURIComponent(filterBrand)}${filterSku ? `?sku=${encodeURIComponent(filterSku)}` : ""}`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800"
        >
          View Supplier DIFOT <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {forecastLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-purple-500 mr-2" />
          <span className="text-sm text-slate-500">Calculating store stockout forecast...</span>
        </div>
      )}

      {!forecastLoading && storeForecast && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">Stores Monitored</div>
              <div className="font-mono text-2xl font-bold text-slate-900 mt-1">{storeForecast.summary.totalStores}</div>
            </div>
            <div className={`rounded-xl p-4 border shadow-sm text-center ${storeForecast.summary.atRiskStores > 0 ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
              <div className="text-[10px] font-semibold text-slate-400 uppercase">Stores at Risk</div>
              <div className={`font-mono text-2xl font-bold mt-1 ${storeForecast.summary.atRiskStores > 0 ? "text-red-700" : "text-emerald-600"}`}>
                {storeForecast.summary.atRiskStores}
              </div>
              <div className="text-[10px] text-slate-400">&lt;4wk cover</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 shadow-sm text-center">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">Weekly Sales Loss</div>
              <div className="font-mono text-2xl font-bold text-amber-700 mt-1">{fmt(storeForecast.summary.weeklyLoss)}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 border border-red-200 shadow-sm text-center">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">4-Week Forecast Loss</div>
              <div className="font-mono text-2xl font-bold text-red-700 mt-1">{fmt(storeForecast.summary.predicted4wkLoss)}</div>
            </div>
          </div>

          {/* Demand Forecast Chart */}
          {storeForecast.demandForecast && storeForecast.demandForecast.length > 0 && (() => {
            const df = storeForecast.demandForecast!;
            const weekLabels = df.map((_, i) => `W${i + 1}`);
            return (
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Demand Forecast vs Actual — {filterBrand} / {filterSku}</h3>
              <Plot
                data={[
                  {
                    x: weekLabels.filter((_, i) => !df[i].isForecast),
                    y: df.filter(d => !d.isForecast).map(d => d.actualUnits),
                    name: "Actual Demand",
                    type: "scatter" as const,
                    mode: "lines+markers" as const,
                    line: { color: "#10b981", width: 2.5 },
                    marker: { size: 5 },
                  },
                  {
                    x: weekLabels,
                    y: df.map(d => d.forecastUnits),
                    name: "Forecast",
                    type: "scatter" as const,
                    mode: "lines" as const,
                    line: { color: "#2563eb", width: 2, dash: "dash" as const },
                  },
                ]}
                layout={{
                  height: 220,
                  margin: { l: 55, r: 20, t: 10, b: 30 },
                  showlegend: true,
                  legend: { orientation: "h" as const, y: -0.2, font: { size: 10 } },
                  yaxis: { title: { text: "Units / week", font: { size: 10 } }, rangemode: "tozero" as const },
                  xaxis: { title: { text: "Week", font: { size: 10 } } },
                  font: { family: "Inter, system-ui, sans-serif", size: 10 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
              <p className="text-[10px] text-slate-400 mt-2">Blue dashed = ML forecast. Green = actual sell-through. Future weeks are forecast only.</p>
            </div>
            );
          })()}

          {/* DC stock drain chart + DC summary */}
          <div className="grid grid-cols-[2fr_1fr] gap-4 mb-5">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" />
                Projected DC Stock (5-Week Forecast incl. Planned Restock)
              </h3>
              <Plot
                data={storeForecast.dcStocks.map((dc) => {
                  const weeks = ["Now", "+1wk", "+2wk", "+3wk", "+4wk", "+5wk"];
                  return {
                    x: weeks,
                    y: dc.trajectory,
                    name: `${dc.state} DC`,
                    type: "scatter" as const,
                    mode: "lines+markers" as const,
                    line: { color: DC_COLORS[dc.state] || "#64748b", width: 2 },
                    marker: { size: 6 },
                  };
                })}
                layout={{
                  height: 270,
                  margin: { l: 55, r: 20, t: 10, b: 30 },
                  showlegend: true,
                  legend: { orientation: "h" as const, y: -0.15, font: { size: 10 } },
                  yaxis: { title: { text: "Units", font: { size: 10 } }, rangemode: "tozero" as const },
                  font: { family: "Inter, system-ui, sans-serif", size: 10 },
                  shapes: [{
                    type: "line" as const,
                    x0: "+3wk", x1: "+3wk",
                    y0: 0, y1: 1, yref: "paper" as const,
                    line: { color: "#6366f1", width: 1.5, dash: "dot" as const },
                  }],
                  annotations: [{
                    x: "+3wk", y: 1, yref: "paper" as const,
                    text: "Planned Delivery",
                    showarrow: false,
                    font: { size: 9, color: "#6366f1" },
                    yanchor: "bottom" as const,
                  }],
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            </div>

            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">DC Status</h3>
              <div className="space-y-2">
                {storeForecast.dcStocks
                  .sort((a, b) => a.weeksLeft - b.weeksLeft)
                  .map((dc) => {
                    const critical = dc.weeksLeft < 2;
                    const warning = dc.weeksLeft >= 2 && dc.weeksLeft < 4;
                    return (
                      <div key={dc.state} className={`p-3 rounded-lg border ${critical ? "bg-red-50 border-red-200" : warning ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold text-slate-700">{dc.state} DC</div>
                            <div className="text-[10px] text-slate-400">{dc.stock.toLocaleString()} units</div>
                          </div>
                          <div className="text-right">
                            <div className={`font-mono font-bold text-sm ${critical ? "text-red-700" : warning ? "text-amber-700" : "text-emerald-600"}`}>
                              {dc.weeksLeft}wk
                            </div>
                            <div className={`text-[10px] font-semibold ${critical ? "text-red-500" : warning ? "text-amber-500" : "text-emerald-500"}`}>
                              {critical ? "CRITICAL" : warning ? "AT RISK" : "OK"}
                            </div>
                          </div>
                        </div>
                        <div className={`mt-1.5 pt-1.5 border-t ${critical ? "border-red-100" : warning ? "border-amber-100" : "border-slate-100"}`}>
                          <div className="text-[10px] text-indigo-600 font-medium">
                            Restock Wk {dc.restockWeek} (+{dc.restockQty} units)
                          </div>
                          {(critical || warning) && (
                            <div className="text-[9px] text-red-500 font-medium mt-0.5">
                              Insufficient — won&apos;t cover demand
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Store-level table grouped by DC */}
          {(() => {
            const byDc: Record<string, StoreRow[]> = {};
            storeForecast.stores.forEach((s) => {
              if (!byDc[s.dc]) byDc[s.dc] = [];
              byDc[s.dc].push(s);
            });
            return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">Store Stockout Forecast</h3>
                  <span className="text-[10px] text-slate-400 font-medium">Demand adjusted +{demandGrowth}% growth</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                      <th className="text-left px-4 py-2 font-semibold">Store</th>
                      <th className="text-right px-3 py-2 font-semibold">Wkly Demand</th>
                      <th className="text-right px-3 py-2 font-semibold">Shelf %</th>
                      <th className="text-right px-3 py-2 font-semibold">Wks to Stockout</th>
                      <th className="text-right px-3 py-2 font-semibold">Sales Loss / Wk</th>
                      <th className="text-right px-4 py-2 font-semibold">4-Wk Forecast Loss</th>
                    </tr>
                  </thead>
                  {Object.entries(byDc)
                    .sort(([a], [b]) => {
                      const aMin = Math.min(...byDc[a].map((s) => s.weeksToStockout));
                      const bMin = Math.min(...byDc[b].map((s) => s.weeksToStockout));
                      return aMin - bMin;
                    })
                    .map(([dc, stores]) => {
                      const dcColor = DC_COLORS[dc.replace(" DC", "")] || "#64748b";
                      const sortedStores = [...stores].sort((a, b) => a.weeksToStockout - b.weeksToStockout);
                      return (
                        <tbody key={dc}>
                          <tr className="border-t border-slate-200">
                            <td colSpan={6} className="px-4 py-1.5 font-semibold text-[11px]" style={{ color: dcColor, backgroundColor: `${dcColor}10` }}>
                              {dc}
                            </td>
                          </tr>
                          {sortedStores.map((s) => {
                            const critical = s.weeksToStockout < 2;
                            const warning = s.weeksToStockout >= 2 && s.weeksToStockout < 4;
                            return (
                              <tr key={s.store} className={`border-t border-slate-50 hover:bg-slate-50 ${critical ? "bg-red-50" : warning ? "bg-amber-50/40" : ""}`}>
                                <td className="px-4 py-2 font-medium">
                                  <Link
                                    href={`/replenishment/demand/store/${encodeURIComponent(s.store)}?brand=${encodeURIComponent(filterBrand)}&sku=${encodeURIComponent(filterSku || "")}`}
                                    className="text-blue-700 hover:underline"
                                  >
                                    {s.store}
                                  </Link>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-slate-600">{s.weeklyDemand}</td>
                                <td className="px-3 py-2 text-right">
                                  <span className={`font-mono font-semibold ${s.shelfPct < 70 ? "text-red-600" : s.shelfPct < 90 ? "text-amber-600" : "text-emerald-600"}`}>
                                    {s.shelfPct}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <span className={`font-mono font-bold ${critical ? "text-red-700" : warning ? "text-amber-600" : "text-emerald-600"}`}>
                                    {s.weeksToStockout}wk
                                    {critical && <span className="ml-1 text-[9px] bg-red-600 text-white rounded px-1 py-0.5">CRITICAL</span>}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-amber-700">{fmt(s.salesLossWeek)}</td>
                                <td className="px-4 py-2 text-right font-mono font-semibold text-red-700">{fmt(s.predictedLoss4wk)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                </table>
              </div>
            );
          })()}
        </>
      )}

      <div className="mt-5 flex justify-end">
        <Link
          href={`/replenishment/difot/${encodeURIComponent(filterBrand)}${filterSku ? `?sku=${encodeURIComponent(filterSku)}` : ""}`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800"
        >
          Continue to Supplier DIFOT <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default function DcReplenishmentPage() {
  return (
    <Suspense fallback={<div className="p-6 flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" /></div>}>
      <DcReplenishmentContent />
    </Suspense>
  );
}
