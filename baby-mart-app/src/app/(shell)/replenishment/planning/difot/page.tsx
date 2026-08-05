"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, TrendingDown, ArrowRight } from "lucide-react";

interface GeoData { geography: string; difotPct: number; otPct: number; diPct: number; orders: number; }
interface ChannelData { channel: string; difotPct: number; otPct: number; diPct: number; orders: number; }
interface SupplierData { supplier: string; difotPct: number; otPct: number; diPct: number; orders: number; avgActualLead: number; stdLeadTime: number; }
interface BrandData { brand: string; supplier: string; difotPct: number; otPct: number; diPct: number; orders: number; }
interface LeadTimeData { supplier: string; brands: string; stdLeadTime: number; avgActualLead: number; gap: number; sourcingType: string; is3plViable: boolean; est3plDays: number; }
interface DifotData {
  overall: { difotPct: number; totalOrders: number; target: number };
  byGeography: GeoData[];
  byChannel: ChannelData[];
  bySupplier: SupplierData[];
  byBrand: BrandData[];
  leadTimeAnalysis: LeadTimeData[];
  fairView: boolean;
}

function getDifotColor(pct: number): string {
  if (pct >= 95) return "text-emerald-600";
  if (pct >= 85) return "text-amber-600";
  return "text-red-600";
}

function getDifotBg(pct: number): string {
  if (pct >= 95) return "bg-emerald-100 text-emerald-700";
  if (pct >= 85) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export default function DifotLandingPage() {
  const [data, setData] = useState<DifotData | null>(null);
  const [fairView, setFairView] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supply/planning/difot/landing?fairView=${fairView}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fairView]);

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;
  if (!data) return <div className="p-8 text-red-600">Failed to load DIFOT data</div>;

  const gap = data.overall.target - data.overall.difotPct;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier DIFOT Performance</h1>
          <p className="text-sm text-slate-500 mt-1">Delivered In-Full, On-Time — multi-dimensional breakdown</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setFairView(false)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!fairView ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>
              All Orders
            </button>
            <button onClick={() => setFairView(true)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${fairView ? "bg-white shadow text-emerald-700" : "text-slate-500"}`}>
              Excl. Overtraded (Fair View)
            </button>
          </div>
        </div>
      </div>

      {/* Overall KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500 font-medium">Combined DIFOT</div>
          <div className={`text-3xl font-bold mt-1 ${getDifotColor(data.overall.difotPct)}`}>{data.overall.difotPct}%</div>
          <div className="text-xs text-slate-400 mt-1">{data.overall.totalOrders.toLocaleString()} orders</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500 font-medium">Target</div>
          <div className="text-3xl font-bold mt-1 text-slate-900">{data.overall.target}%</div>
          <div className="text-xs text-slate-400 mt-1">Category benchmark</div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="text-xs text-slate-500 font-medium">Gap</div>
          <div className="text-3xl font-bold mt-1 text-red-600">-{gap.toFixed(1)}pp</div>
          <div className="text-xs text-slate-400 mt-1">vs target</div>
        </div>
      </div>

      {/* Geography + Channel side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">By Geography (DC)</h3>
          <div className="space-y-2">
            {data.byGeography.map(g => (
              <div key={g.geography} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{g.geography}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full ${g.difotPct >= 95 ? "bg-emerald-500" : g.difotPct >= 85 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${g.difotPct}%` }} />
                  </div>
                  <span className={`text-sm font-medium w-12 text-right ${getDifotColor(g.difotPct)}`}>{g.difotPct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">By Channel</h3>
          <div className="space-y-2">
            {data.byChannel.map(c => (
              <div key={c.channel} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{c.channel}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full ${c.difotPct >= 95 ? "bg-emerald-500" : c.difotPct >= 85 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${c.difotPct}%` }} />
                  </div>
                  <span className={`text-sm font-medium w-12 text-right ${getDifotColor(c.difotPct)}`}>{c.difotPct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Supplier table */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">By Distributor (worst first)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500">
              <th className="pb-2 font-medium">Distributor</th><th className="pb-2 font-medium">DIFOT</th><th className="pb-2 font-medium">DI%</th><th className="pb-2 font-medium">OT%</th><th className="pb-2 font-medium">Lead Time</th><th className="pb-2 font-medium">Actual</th><th className="pb-2 font-medium">Orders</th>
            </tr></thead>
            <tbody>
              {data.bySupplier.map(s => (
                <tr key={s.supplier} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{s.supplier}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${getDifotBg(s.difotPct)}`}>{s.difotPct}%</span></td>
                  <td className={`py-2 ${getDifotColor(s.diPct)}`}>{s.diPct}%</td>
                  <td className={`py-2 ${getDifotColor(s.otPct)}`}>{s.otPct}%</td>
                  <td className="py-2 text-slate-600">{s.stdLeadTime}d</td>
                  <td className="py-2 text-slate-600">{s.avgActualLead}d</td>
                  <td className="py-2 text-slate-400">{s.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Brand table */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">By Brand (worst first)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500">
              <th className="pb-2 font-medium">Brand</th><th className="pb-2 font-medium">Distributor</th><th className="pb-2 font-medium">DIFOT</th><th className="pb-2 font-medium">DI%</th><th className="pb-2 font-medium">OT%</th><th className="pb-2 font-medium">Orders</th><th className="pb-2"></th>
            </tr></thead>
            <tbody>
              {data.byBrand.slice(0, 10).map(b => (
                <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800">{b.brand}</td>
                  <td className="py-2 text-slate-600">{b.supplier}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${getDifotBg(b.difotPct)}`}>{b.difotPct}%</span></td>
                  <td className={`py-2 ${getDifotColor(b.diPct)}`}>{b.diPct}%</td>
                  <td className={`py-2 ${getDifotColor(b.otPct)}`}>{b.otPct}%</td>
                  <td className="py-2 text-slate-400">{b.orders}</td>
                  <td className="py-2"><Link href={`/replenishment/planning/difot/${encodeURIComponent(b.brand)}`}><ArrowRight className="w-4 h-4 text-slate-400 hover:text-emerald-600" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead Time Analysis */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Lead Time Analysis</h3>
        <p className="text-xs text-slate-500 mb-3">Standard vs actual lead times — could 3PL deliver better bang for buck?</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500">
              <th className="pb-2 font-medium">Distributor</th><th className="pb-2 font-medium">Brands</th><th className="pb-2 font-medium">Std</th><th className="pb-2 font-medium">Actual</th><th className="pb-2 font-medium">Gap</th><th className="pb-2 font-medium">Sourcing</th><th className="pb-2 font-medium">3PL Viable</th><th className="pb-2 font-medium">Est. 3PL</th>
            </tr></thead>
            <tbody>
              {data.leadTimeAnalysis.map(l => (
                <tr key={l.supplier} className="border-b border-slate-50">
                  <td className="py-2 font-medium text-slate-800">{l.supplier}</td>
                  <td className="py-2 text-slate-600 text-xs max-w-[200px] truncate">{l.brands}</td>
                  <td className="py-2 text-slate-600">{l.stdLeadTime}d</td>
                  <td className="py-2 text-slate-800 font-medium">{l.avgActualLead}d</td>
                  <td className={`py-2 font-medium ${l.gap > 2 ? "text-red-600" : l.gap > 0 ? "text-amber-600" : "text-emerald-600"}`}>+{l.gap}d</td>
                  <td className="py-2 text-slate-500">{l.sourcingType}</td>
                  <td className="py-2">{l.is3plViable ? <span className="text-emerald-600 font-medium">Yes</span> : <span className="text-slate-400">Limited</span>}</td>
                  <td className="py-2 text-slate-600">{l.est3plDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
