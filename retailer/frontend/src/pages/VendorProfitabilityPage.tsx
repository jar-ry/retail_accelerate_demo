import { useState, useEffect } from "react";
import { DollarSign, Loader2 } from "lucide-react";
// @ts-ignore
import Plot from "react-plotly.js";

interface Supplier { key: number; name: string; }
interface Waterfall { grossSales: number; discounts: number; promoAllowances: number; netSales: number; cogs: number; grossMargin: number; rebates: number; netMargin: number; }
interface SkuRow { product: string; category: string; class: string; grossSales: number; discounts: number; netSales: number; cogs: number; margin: number; marginPct: number; units: number; }
interface TrendRow { month: string; revenue: number; margin: number; marginPct: number; }
interface ProfitData { waterfall: Waterfall; kpis: { netRevenue: number; grossMarginPct: number; netMarginPct: number; promoSpendPct: number; discountPct: number; }; skus: SkuRow[]; trend: TrendRow[]; }

function fmt(n: number) { if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`; if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`; return `$${n.toFixed(0)}`; }

export default function VendorProfitabilityPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/vendor/suppliers").then((r) => r.json()).then((d) => { if (Array.isArray(d)) { setSuppliers(d); if (d.length > 0) setSelected(d[0].name); } }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/api/vendor/profitability?supplier=${encodeURIComponent(selected)}`).then((r) => r.json()).then((d) => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [selected]);

  if (!data && !loading) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;

  const w = data?.waterfall;
  const grossPct = (n: number) => w ? `${Math.round(n / w.grossSales * 100)}%` : "";
  const waterfallTrace = w ? {
    type: "waterfall" as const,
    orientation: "v" as const,
    x: ["Gross Sales", "Less: Discounts", "Less: Promo", "= Net Sales", "Less: COGS", "= Gross Margin", "Less: Rebates", "= Net Margin"],
    y: [w.grossSales, -w.discounts, -w.promoAllowances, 0, -w.cogs, 0, -w.rebates, 0],
    measure: ["absolute", "relative", "relative", "total", "relative", "total", "relative", "total"] as string[],
    connector: { line: { color: "#cbd5e1", width: 1 } },
    decreasing: { marker: { color: "#ef4444" } },
    increasing: { marker: { color: "#10b981" } },
    totals: { marker: { color: "#2563eb" } },
    textposition: "inside" as const,
    text: ["100%", grossPct(w.discounts), grossPct(w.promoAllowances), `${Math.round(w.netSales / w.grossSales * 100)}%`, `${Math.round(w.cogs / w.grossSales * 100)}%`, `${Math.round(w.grossMargin / w.grossSales * 100)}%`, grossPct(w.rebates), `${Math.round(w.netMargin / w.grossSales * 100)}%`],
    textfont: { size: 11, color: "#ffffff" },
    insidetextanchor: "middle" as const,
  } : null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Vendor Profitability</h1>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          {suppliers.map((s) => <option key={s.key} value={s.name}>{s.name}</option>)}
        </select>
      </div>

      {loading ? <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div> : data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Net Revenue</div><div className="font-mono text-xl font-bold text-slate-900 mt-1">{fmt(data.kpis.netRevenue)}</div></div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Gross Margin</div><div className="font-mono text-xl font-bold text-emerald-600 mt-1">{data.kpis.grossMarginPct}%</div></div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Net Margin</div><div className="font-mono text-xl font-bold text-blue-600 mt-1">{data.kpis.netMarginPct}%</div></div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Promo Spend</div><div className="font-mono text-xl font-bold text-amber-600 mt-1">{data.kpis.promoSpendPct}%</div></div>
            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Discount Rate</div><div className="font-mono text-xl font-bold text-red-600 mt-1">{data.kpis.discountPct}%</div></div>
          </div>

          {/* Waterfall + Trend */}
          <div className="grid grid-cols-[3fr_2fr] gap-4 mb-5">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Gross-to-Net Margin Waterfall</h3>
              {waterfallTrace && <Plot data={[waterfallTrace]} layout={{ height: 320, margin: { l: 60, r: 20, t: 30, b: 80 }, font: { family: "Inter, system-ui", size: 10 }, showlegend: false, yaxis: { title: { text: "AUD", font: { size: 10 } } } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />}
            </div>
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Margin % Trend</h3>
              <Plot data={[{ x: data.trend.map((t) => t.month), y: data.trend.map((t) => t.marginPct), type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#2563eb", width: 2 }, marker: { size: 5 } }]} layout={{ height: 250, margin: { l: 40, r: 10, t: 10, b: 30 }, font: { family: "Inter", size: 10 }, yaxis: { title: { text: "Margin %", font: { size: 10 } } } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
            </div>
          </div>

          {/* SKU P&L Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-800">SKU-Level P&L</h3></div>
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                <th className="text-left px-4 py-2">Product</th><th className="text-left px-2 py-2">Class</th>
                <th className="text-right px-2 py-2">Gross</th><th className="text-right px-2 py-2">Disc.</th>
                <th className="text-right px-2 py-2">Net Sales</th><th className="text-right px-2 py-2">COGS</th>
                <th className="text-right px-2 py-2">Margin</th><th className="text-right px-3 py-2">Margin %</th>
              </tr></thead>
              <tbody>
                {data.skus.map((s, i) => (
                  <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{s.product}</td>
                    <td className="px-2 py-2 text-slate-500">{s.class}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(s.grossSales)}</td>
                    <td className="px-2 py-2 text-right font-mono text-red-500">-{fmt(s.discounts)}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(s.netSales)}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-500">{fmt(s.cogs)}</td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-600">{fmt(s.margin)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${s.marginPct >= 40 ? "text-emerald-600" : s.marginPct >= 30 ? "text-blue-600" : "text-red-600"}`}>{s.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
