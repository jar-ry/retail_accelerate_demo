"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Package, Truck, Loader2, Zap, Shield, CheckCircle2, Store, Warehouse } from "lucide-react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Tab = "stores" | "dc" | "supplier";
type SimState = "idle" | "disrupted" | "actions" | "mitigated";

interface WeeklyForecast {
  week: string; weekDate: string; isForecast: boolean; openingStock: number;
  demand: number; delivery: number; closingStock: number; shelfPct: number; reorderPoint: number;
}

interface DcWeek { week: string; closingStock: number; demand: number; delivery: number; shelfPct: number; }
interface StoreData { store: string; state: string; units: number; revenue: number; ros: number; }

interface SkuDetail {
  brand: string; skuClass: string; category: string; dailyDemand: number; weeklyDemand: number;
  currentStock: number; reorderPoint: number; safetyStock: number; leadTimeDays: number;
  avgDeliveryQty: number; nextDelivery: string; stockoutCostPerDay: number; supplierName: string;
  dcSplit: Record<string, number>; woc: number; weeklyForecast: WeeklyForecast[];
  dcInventory: Record<string, DcWeek[]>;
}

interface SimForecast { week: string; closingStock: number; shelfPct: number; }

function simulateDisruption(forecast: WeeklyForecast[], delayIdx: number, delayWeeks: number, reorderPoint: number): SimForecast[] {
  const result: SimForecast[] = [];
  let stock = forecast[0].openingStock;
  for (let i = 0; i < forecast.length; i++) {
    const w = forecast[i];
    let delivery = w.delivery;
    if (i === delayIdx) delivery = 0;
    if (i === delayIdx + delayWeeks && delayIdx + delayWeeks < forecast.length) delivery = forecast[delayIdx].delivery;
    stock = Math.max(0, stock + delivery - w.demand);
    const shelfPct = stock > reorderPoint * 0.3 ? 98 : stock > 0 ? Math.round(50 + (stock / (reorderPoint * 0.3)) * 48) : Math.round(42 + Math.random() * 10);
    result.push({ week: w.week, closingStock: stock, shelfPct: Math.min(99, shelfPct) });
  }
  return result;
}

function simulateMitigation(forecast: WeeklyForecast[], delayIdx: number, delayWeeks: number, reorderPoint: number, emergencyQty: number, safetyStock: number): SimForecast[] {
  const result: SimForecast[] = [];
  let stock = forecast[0].openingStock + safetyStock;
  for (let i = 0; i < forecast.length; i++) {
    const w = forecast[i];
    let delivery = w.delivery;
    if (i === delayIdx) delivery = 0;
    if (i === delayIdx + delayWeeks && delayIdx + delayWeeks < forecast.length) delivery = forecast[delayIdx].delivery;
    const forecastIdx = forecast.findIndex((f) => f.week === "F+1");
    if (i === Math.max(forecastIdx, delayIdx - 1)) delivery += emergencyQty;
    const demand = Math.round(w.demand * (i >= delayIdx && i < delayIdx + delayWeeks ? 0.85 : 1));
    stock = Math.max(0, stock + delivery - demand);
    const shelfPct = stock > reorderPoint * 0.3 ? Math.min(99, 88 + Math.round((stock / reorderPoint) * 10)) : stock > 0 ? Math.round(70 + (stock / (reorderPoint * 0.3)) * 18) : 55;
    result.push({ week: w.week, closingStock: stock, shelfPct: Math.min(99, shelfPct) });
  }
  return result;
}

const DC_COLORS: Record<string, string> = { NSW: "#2563eb", VIC: "#8b5cf6", QLD: "#f59e0b", WA: "#10b981", SA: "#ec4899" };

export default function SkuDetailPage() {
  const params = useParams();
  const brand = decodeURIComponent(params.brandName as string);
  const sku = decodeURIComponent(params.skuClass as string);

  const [detail, setDetail] = useState<SkuDetail | null>(null);
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("stores");
  const [simState, setSimState] = useState<SimState>("idle");
  const [delayWeeks, setDelayWeeks] = useState(2);
  const [disrupted, setDisrupted] = useState<SimForecast[] | null>(null);
  const [mitigated, setMitigated] = useState<SimForecast[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/supply/brand/${encodeURIComponent(brand)}/sku/${encodeURIComponent(sku)}`).then((r) => r.json()),
      fetch(`/api/supply/brand/${encodeURIComponent(brand)}/sku/${encodeURIComponent(sku)}/stores`).then((r) => r.json()),
    ]).then(([d, s]) => { setDetail(d.error ? null : d); setStores(Array.isArray(s) ? s : []); }).catch(() => {}).finally(() => setLoading(false));
  }, [brand, sku]);

  if (loading) return <div className="p-6 flex flex-col items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" /><p className="text-sm text-slate-500">Loading {sku}...</p></div>;
  if (!detail) return <div className="p-6"><Link href={`/replenishment/brand/${encodeURIComponent(brand)}`} className="text-emerald-700 hover:underline text-sm">&larr; Back</Link><p className="mt-4 text-slate-500">SKU data not found.</p></div>;

  const forecast = detail.weeklyForecast;
  const deliveryWeekIdx = forecast.findIndex((w) => w.isForecast && w.delivery > 0);

  const runDisruption = () => {
    const idx = deliveryWeekIdx >= 0 ? deliveryWeekIdx : forecast.findIndex((w) => w.week === "F+2");
    setDisrupted(simulateDisruption(forecast, idx, delayWeeks, detail.reorderPoint));
    setMitigated(null);
    setSimState("disrupted");
  };

  const applyMitigation = () => {
    const idx = deliveryWeekIdx >= 0 ? deliveryWeekIdx : forecast.findIndex((w) => w.week === "F+2");
    setMitigated(simulateMitigation(forecast, idx, delayWeeks, detail.reorderPoint, Math.round(detail.avgDeliveryQty * 0.5), detail.safetyStock));
    setSimState("mitigated");
  };

  const resetSim = () => { setSimState("idle"); setDisrupted(null); setMitigated(null); };

  const impactDays = disrupted ? disrupted.filter((w) => w.closingStock < detail.reorderPoint).length * 7 : 0;
  const impactRevenue = impactDays * detail.stockoutCostPerDay;
  const minShelf = disrupted ? Math.min(...disrupted.map((w) => w.shelfPct)) : 0;
  const mitigatedDays = mitigated ? mitigated.filter((w) => w.closingStock < detail.reorderPoint).length * 7 : 0;
  const mitigatedRevenue = mitigatedDays * detail.stockoutCostPerDay;

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === t ? "border-emerald-600 text-emerald-800 bg-emerald-50" : "border-transparent text-slate-500 hover:text-slate-700"}`;

  return (
    <div className="p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/replenishment" className="hover:text-emerald-700">Replenishment</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href={`/replenishment/brand/${encodeURIComponent(brand)}`} className="hover:text-emerald-700">{brand}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-900 font-medium">{sku}</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{brand} — {sku}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{detail.category} | Supplier: {detail.supplierName} | Lead: {detail.leadTimeDays}d</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-slate-50 border-slate-200">
          <Package className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-medium">WOC: <span className={`font-mono font-bold ${detail.woc < 4 ? "text-red-600" : detail.woc < 6 ? "text-amber-600" : "text-emerald-600"}`}>{detail.woc}</span></span>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3 mb-6">
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">National Stock</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{detail.currentStock.toLocaleString()}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">Daily Demand</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{detail.dailyDemand}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">Reorder Pt</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{detail.reorderPoint}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">Safety Stock</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{detail.safetyStock}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">Next Delivery</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{detail.nextDelivery}</div></div>
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm"><div className="text-[10px] font-medium text-slate-500 uppercase">Stockout Cost</div><div className="mt-1 font-mono text-lg font-bold text-red-600">${detail.stockoutCostPerDay}/d</div></div>
      </div>

      <div className="flex gap-1 mb-0 border-b border-slate-200">
        <button onClick={() => setTab("stores")} className={tabClass("stores")}><Store className="w-3.5 h-3.5 inline mr-1.5" />Store Demand</button>
        <button onClick={() => setTab("dc")} className={tabClass("dc")}><Warehouse className="w-3.5 h-3.5 inline mr-1.5" />DC Replenishment</button>
        <button onClick={() => setTab("supplier")} className={tabClass("supplier")}><Truck className="w-3.5 h-3.5 inline mr-1.5" />Supplier Inflow</button>
      </div>

      <div className="bg-white rounded-b-xl rounded-tr-xl p-5 border border-t-0 border-slate-200 shadow-sm mb-6">
        {tab === "stores" && (
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Store-Level Demand — Top 20 Stores by Volume</h3>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-semibold text-slate-500">Store</th>
                <th className="text-left py-2 text-xs font-semibold text-slate-500">State</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Units (YTD)</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Avg RoS</th>
                <th className="text-right py-2 text-xs font-semibold text-slate-500">Demand Tier</th>
              </tr></thead>
              <tbody>
                {stores.map((s, i) => {
                  const tier = i < 5 ? "High" : i < 12 ? "Medium" : "Low";
                  const tierColor = tier === "High" ? "text-emerald-700 bg-emerald-100" : tier === "Medium" ? "text-blue-700 bg-blue-100" : "text-slate-600 bg-slate-100";
                  return (
                    <tr key={s.store} className="border-b border-slate-50">
                      <td className="py-2 font-medium text-slate-800">{s.store}</td>
                      <td className="py-2 text-xs text-slate-500">{s.state}</td>
                      <td className="py-2 text-right font-mono">{s.units.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono text-slate-600">${s.revenue.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono">{s.ros}</td>
                      <td className="py-2 text-right"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${tierColor}`}>{tier}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "dc" && (
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">DC Stock Levels by State</h3>
            {Object.keys(detail.dcInventory).length > 0 ? (
              <>
                <Plot
                  data={Object.entries(detail.dcInventory).map(([state, weeks]) => ({
                    x: weeks.map((w) => w.week),
                    y: weeks.map((w) => w.closingStock),
                    name: `${state} DC`,
                    type: "scatter" as const,
                    mode: "lines+markers" as const,
                    line: { color: DC_COLORS[state] || "#64748b", width: 2 },
                    marker: { size: 4 },
                  }))}
                  layout={{ height: 280, margin: { l: 50, r: 30, t: 10, b: 30 }, legend: { orientation: "h" as const, y: -0.2, x: 0.5, xanchor: "center" as const, font: { size: 10 } }, xaxis: { title: { text: "Week", font: { size: 10 } } }, yaxis: { title: { text: "Units", font: { size: 10 } } }, font: { family: "Inter, system-ui, sans-serif" } }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                />
                <div className="mt-4 grid grid-cols-5 gap-3">
                  {Object.entries(detail.dcSplit).map(([state, pct]) => {
                    const dcWeeks = detail.dcInventory[state];
                    const lastStock = dcWeeks ? dcWeeks[dcWeeks.length - 1]?.closingStock : 0;
                    return (
                      <div key={state} className="p-3 rounded-lg border border-slate-200 text-center">
                        <div className="text-[10px] font-semibold text-slate-500">{state} DC</div>
                        <div className="font-mono text-lg font-bold text-slate-900">{lastStock}</div>
                        <div className="text-[10px] text-slate-400">{pct}% of national</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-sm">DC-level data not available for this SKU.</p>
            )}
          </div>
        )}

        {tab === "supplier" && (
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">National Supplier Inflow — {detail.supplierName}</h3>
            <Plot
              data={[
                { x: forecast.map((w) => w.week), y: forecast.map((w) => w.demand), name: "Demand", type: "bar" as const, marker: { color: forecast.map((w) => w.isForecast ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.4)") }, yaxis: "y" },
                { x: forecast.map((w) => w.week), y: forecast.map((w) => w.closingStock), name: "Base Plan", type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#2563eb", width: 2.5 }, marker: { size: 5 }, yaxis: "y" },
                ...(disrupted && simState !== "idle" ? [{ x: disrupted.map((w) => w.week), y: disrupted.map((w) => w.closingStock), name: "Disrupted", type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#dc2626", width: 2.5, dash: "dash" as const }, marker: { size: 5, symbol: "x" }, yaxis: "y" }] : []),
                ...(mitigated && simState === "mitigated" ? [{ x: mitigated.map((w) => w.week), y: mitigated.map((w) => w.closingStock), name: "Mitigated", type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#10b981", width: 2.5 }, marker: { size: 5, symbol: "diamond" }, yaxis: "y" }] : []),
              ]}
              layout={{
                height: 320, margin: { l: 50, r: 50, t: 10, b: 30 },
                legend: { orientation: "h" as const, y: -0.18, x: 0.5, xanchor: "center" as const, font: { size: 10 } },
                yaxis: { title: { text: "Units", font: { size: 10 } } },
                xaxis: { title: { text: "Week", font: { size: 10 } } },
                shapes: [{ type: "line" as const, x0: 0, x1: 1, xref: "paper" as const, y0: detail.reorderPoint, y1: detail.reorderPoint, yref: "y" as const, line: { color: "#dc2626", width: 1.5, dash: "dash" as const } }],
                annotations: [{ x: "W-1", y: detail.reorderPoint, text: "Reorder Point", showarrow: false, font: { size: 9, color: "#dc2626" }, yshift: 10 }],
                font: { family: "Inter, system-ui, sans-serif" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />

            <div className="mt-4 p-4 border-2 border-amber-200 rounded-xl bg-amber-50/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" /><span className="text-sm font-bold text-slate-900">Disruption Simulator</span></div>
                {simState !== "idle" && <button onClick={resetSim} className="text-xs text-slate-500 hover:text-slate-700 underline">Reset</button>}
              </div>

              {simState === "idle" && (
                <div className="flex items-end gap-4">
                  <div><label className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Type</label><div className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm">Delivery Delay</div></div>
                  <div><label className="text-[10px] font-semibold text-slate-500 uppercase block mb-1">Delay</label>
                    <select value={delayWeeks} onChange={(e) => setDelayWeeks(Number(e.target.value))} className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm">
                      <option value={1}>1 week</option><option value={2}>2 weeks</option><option value={3}>3 weeks</option><option value={4}>4 weeks</option>
                    </select>
                  </div>
                  <button onClick={runDisruption} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 flex items-center gap-2"><Zap className="w-4 h-4" />Simulate</button>
                </div>
              )}

              {simState === "disrupted" && (
                <div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Days at Risk</div><div className="text-lg font-bold text-red-800 font-mono">{impactDays}</div></div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Lost Revenue</div><div className="text-lg font-bold text-red-800 font-mono">${impactRevenue.toLocaleString()}</div></div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Min Shelf %</div><div className="text-lg font-bold text-red-800 font-mono">{minShelf}%</div></div>
                  </div>
                  <button onClick={() => setSimState("actions")} className="w-full px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 flex items-center justify-center gap-2"><Shield className="w-4 h-4" />Get Recommended Actions</button>
                </div>
              )}

              {simState === "actions" && (
                <div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Days at Risk</div><div className="text-lg font-bold text-red-800 font-mono">{impactDays}</div></div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Lost Revenue</div><div className="text-lg font-bold text-red-800 font-mono">${impactRevenue.toLocaleString()}</div></div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 text-center"><div className="text-[10px] text-red-600 font-semibold uppercase">Min Shelf %</div><div className="text-lg font-bold text-red-800 font-mono">{minShelf}%</div></div>
                  </div>
                  <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 mb-3 space-y-2">
                    <div className="flex items-start gap-2 p-2 bg-white rounded border border-blue-100"><CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" /><div><div className="text-sm font-semibold">Emergency partial order</div><div className="text-xs text-slate-600">Request {Math.round(detail.avgDeliveryQty * 0.5)} units express shipment ({detail.leadTimeDays}d)</div></div></div>
                    <div className="flex items-start gap-2 p-2 bg-white rounded border border-blue-100"><CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" /><div><div className="text-sm font-semibold">Release safety stock</div><div className="text-xs text-slate-600">Activate {detail.safetyStock} units from reserve</div></div></div>
                    <div className="flex items-start gap-2 p-2 bg-white rounded border border-blue-100"><CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" /><div><div className="text-sm font-semibold">Suspend promotions</div><div className="text-xs text-slate-600">Reduce demand ~15% during disruption window</div></div></div>
                  </div>
                  <button onClick={applyMitigation} className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2"><Shield className="w-4 h-4" />Apply & Re-simulate</button>
                </div>
              )}

              {simState === "mitigated" && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-center"><div className="text-[10px] text-emerald-600 font-semibold uppercase">Days at Risk</div><div className="text-lg font-bold text-emerald-800 font-mono">{mitigatedDays}</div><div className="text-[10px] text-slate-400 line-through">{impactDays}</div></div>
                  <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-center"><div className="text-[10px] text-emerald-600 font-semibold uppercase">Lost Revenue</div><div className="text-lg font-bold text-emerald-800 font-mono">${mitigatedRevenue.toLocaleString()}</div><div className="text-[10px] text-slate-400 line-through">${impactRevenue.toLocaleString()}</div></div>
                  <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-center"><div className="text-[10px] text-emerald-600 font-semibold uppercase">Revenue Saved</div><div className="text-lg font-bold text-emerald-800 font-mono">{impactRevenue > 0 ? Math.round(((impactRevenue - mitigatedRevenue) / impactRevenue) * 100) : 0}%</div></div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
