"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { FileText, Loader2, Share2, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface ScorecardData {
  supplier: string;
  summary: { revenue: number; margin: number; marginPct: number; units: number; transactions: number; products: number; };
  trend: { month: string; revenue: number; units: number; }[];
  categoryShare: { category: string; vendorRev: number; categoryRev: number; sharePct: number; }[];
  topProducts: { product: string; class: string; revenue: number; marginPct: number; units: number; }[];
}

function fmt(n: number) { if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`; if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`; return `$${n.toFixed(0)}`; }

export default function VendorScorecardPage() {
  const params = useParams<{ supplier: string }>();
  const supplierName = decodeURIComponent(params?.supplier || "");

  const [data, setData] = useState<ScorecardData | null>(null);
  const [suppliers, setSuppliers] = useState<{ key: number; name: string }[]>([]);
  const [selected, setSelected] = useState(supplierName);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  useEffect(() => {
    fetch("/api/vendor/suppliers").then((r) => r.json()).then((d) => { if (Array.isArray(d)) { setSuppliers(d); if (!selected && d.length > 0) setSelected(d[0].name); } }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/api/vendor/scorecard/${encodeURIComponent(selected)}`).then((r) => r.json()).then((d) => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [selected]);

  const generateSummary = async () => {
    if (!data) return;
    setAiLoading(true);
    const prompt = `Generate a concise executive summary (3-4 sentences) for this vendor scorecard to share with ${selected}:
Revenue: ${fmt(data.summary.revenue)} | Margin: ${data.summary.marginPct}% | Products: ${data.summary.products} | Transactions: ${data.summary.transactions.toLocaleString()}
Category share: ${data.categoryShare.map((c) => `${c.category}: ${c.sharePct}%`).join(", ")}
Top products by revenue: ${data.topProducts.slice(0, 3).map((p) => p.product).join(", ")}

Focus on performance highlights, growth areas, and joint business planning opportunities. Write from the retailer (Baby Mart) perspective addressing the vendor.`;
    try {
      const res = await fetch("/api/vendor/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const d = await res.json();
      setAiSummary(d.text || "");
    } catch {} finally { setAiLoading(false); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Vendor Scorecard</h1>
        </div>
        <div className="flex items-center gap-3">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
            {suppliers.map((s) => <option key={s.key} value={s.name}>{s.name}</option>)}
          </select>
          <button onClick={() => setShowShareModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800">
            <Share2 className="w-3.5 h-3.5" />Share with Vendor
          </button>
        </div>
      </div>

      {loading ? <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div> : data && (
        <>
          {/* AI Summary */}
          <div className="bg-blue-50 rounded-xl p-5 border border-blue-200 mb-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-500" />Executive Summary</h3>
              <button onClick={generateSummary} className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700">{aiSummary ? "Regenerate" : "Generate"}</button>
            </div>
            {aiLoading ? <div className="space-y-2"><div className="h-3 bg-blue-200/50 rounded animate-pulse w-[90%]" /><div className="h-3 bg-blue-200/50 rounded animate-pulse w-[75%]" /></div> : aiSummary ? <div className="text-sm text-slate-700 leading-relaxed">{aiSummary}</div> : <div className="text-xs text-slate-400 italic">Click Generate for an AI-powered executive summary for vendor meetings</div>}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-6 gap-3 mb-5">
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Revenue</div><div className="font-mono text-lg font-bold text-slate-900 mt-1">{fmt(data.summary.revenue)}</div></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Margin</div><div className="font-mono text-lg font-bold text-emerald-600 mt-1">{data.summary.marginPct}%</div></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Units Sold</div><div className="font-mono text-lg font-bold text-slate-900 mt-1">{data.summary.units.toLocaleString()}</div></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Transactions</div><div className="font-mono text-lg font-bold text-slate-900 mt-1">{data.summary.transactions.toLocaleString()}</div></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">SKUs</div><div className="font-mono text-lg font-bold text-slate-900 mt-1">{data.summary.products}</div></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="text-[10px] font-semibold text-slate-400 uppercase">Gross Margin $</div><div className="font-mono text-lg font-bold text-emerald-600 mt-1">{fmt(data.summary.margin)}</div></div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            {/* Revenue Trend */}
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Revenue Trend</h3>
              <Plot data={[{ x: data.trend.map((t) => t.month), y: data.trend.map((t) => t.revenue), type: "bar" as const, marker: { color: "#2563eb" } }]} layout={{ height: 200, margin: { l: 50, r: 10, t: 10, b: 30 }, font: { family: "Inter", size: 10 }, yaxis: { title: { text: "Revenue", font: { size: 9 } } } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
            </div>
            {/* Category Share */}
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Category Share</h3>
              {data.categoryShare.length > 0 ? (
                <div className="space-y-3 mt-3">
                  {data.categoryShare.map((c) => (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{c.category}</span><span className="font-mono font-semibold text-blue-600">{c.sharePct}%</span></div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${c.sharePct}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-slate-400">No category data</div>}
            </div>
          </div>

          {/* Top Products */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-800">Top Products</h3></div>
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                <th className="text-left px-4 py-2">Product</th><th className="text-left px-2 py-2">Class</th>
                <th className="text-right px-2 py-2">Revenue</th><th className="text-right px-2 py-2">Margin %</th><th className="text-right px-3 py-2">Units</th>
              </tr></thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{p.product}</td>
                    <td className="px-2 py-2 text-slate-500">{p.class}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(p.revenue)}</td>
                    <td className={`px-2 py-2 text-right font-mono ${p.marginPct >= 38 ? "text-emerald-600" : "text-amber-600"}`}>{p.marginPct}%</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{p.units.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowShareModal(false)}>
          <div className="bg-white rounded-xl p-6 w-[480px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2"><Share2 className="w-5 h-5 text-blue-600" />Share Scorecard with {selected}</h3>
            <div className="bg-slate-50 rounded-lg p-4 mb-4 border border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Snowflake Secure Data Share</div>
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">1</div>Create a Secure View filtered to {selected}&apos;s data only</div>
                <div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">2</div>Share via Snowflake Data Sharing — zero data copy</div>
                <div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">3</div>Vendor accesses their scorecard in their own Snowflake account</div>
                <div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700">4</div>Auto-refreshes — always current, governed by RBAC</div>
              </div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 mb-4">
              <div className="text-xs font-medium text-emerald-800">Data included in share:</div>
              <div className="text-xs text-emerald-700 mt-1">Sales performance, margin %, category share, product rankings — filtered exclusively to {selected} data. No competitor data exposed.</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowShareModal(false)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={() => { setShowShareModal(false); }} className="flex-1 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800">Create Secure Share</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
