"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronRight, Loader2, Store, Users, TrendingUp, MapPin } from "lucide-react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface StoreProfile {
  storeInfo: { name: string; state: string; region: string; city: string; format: string };
  kpis: { avgUnits: number; avgRevenue: number; ros: number; growthPct: number };
  weeklyTrend: { week: number; units: number; revenue: number }[];
  demographics: {
    segments: { name: string; pct: number; revenue: number }[];
    ageBands: { band: string; pct: number }[];
    loyaltyTiers: { tier: string; pct: number }[];
  };
  channelContext: { region: string; format: string; indexVsState: number };
}

const SEGMENT_COLORS = ["#2563eb", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#64748b"];
const TIER_COLORS = ["#f59e0b", "#94a3b8", "#a855f7", "#6366f1"];

export default function StoreDemandProfilePage() {
  const params = useParams();
  const storeName = params.storeName as string;
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand") || "";
  const sku = searchParams.get("sku") || "";

  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeName) return;
    const queryParams = new URLSearchParams();
    if (brand) queryParams.set("brand", brand);
    if (sku) queryParams.set("sku", sku);
    fetch(`/api/supply/demand/store/${encodeURIComponent(storeName)}/profile?${queryParams}`)
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [storeName, brand, sku]);

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500">Loading store profile...</p>
      </div>
    );
  }

  if (!profile) {
    return <div className="p-6 text-slate-500">Store not found.</div>;
  }

  const { storeInfo, kpis, weeklyTrend, demographics, channelContext } = profile;

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
        <Link href="/replenishment/demand" className="hover:text-emerald-700">Customer Demand</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        {brand && sku && (
          <>
            <Link href={`/replenishment/demand/${encodeURIComponent(brand)}/${encodeURIComponent(sku)}`} className="hover:text-emerald-700">
              {brand} — {sku}
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href={`/replenishment/dc?brand=${encodeURIComponent(brand)}&sku=${encodeURIComponent(sku)}`} className="hover:text-emerald-700">
              DC Impact
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
          </>
        )}
        <span className="text-slate-700 font-medium">{storeInfo.name || storeName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Store className="w-5 h-5 text-blue-700" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">{storeInfo.name || storeName}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{storeInfo.region}</span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{storeInfo.format}</span>
            <span className="text-xs text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{storeInfo.city}, {storeInfo.state}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-semibold text-slate-400 uppercase">Avg Units / Week</div>
          <div className="font-mono text-2xl font-bold text-slate-900 mt-1">{kpis.avgUnits}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-semibold text-slate-400 uppercase">Revenue / Week</div>
          <div className="font-mono text-2xl font-bold text-slate-900 mt-1">${kpis.avgRevenue.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm text-center">
          <div className="text-[10px] font-semibold text-slate-400 uppercase">Rate of Sale</div>
          <div className="font-mono text-2xl font-bold text-slate-900 mt-1">{kpis.ros}</div>
        </div>
        <div className={`rounded-xl p-4 border shadow-sm text-center ${kpis.growthPct > 10 ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
          <div className="text-[10px] font-semibold text-slate-400 uppercase">Growth vs Prior</div>
          <div className={`font-mono text-2xl font-bold mt-1 ${kpis.growthPct > 0 ? "text-emerald-600" : "text-red-600"}`}>
            {kpis.growthPct > 0 ? "+" : ""}{kpis.growthPct}%
          </div>
        </div>
      </div>

      {/* Weekly Trend Chart */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          Weekly Demand — {brand} {sku && `/ ${sku}`}
        </h3>
        <Plot
          data={[
            {
              x: weeklyTrend.map((w) => `W${w.week}`),
              y: weeklyTrend.map((w) => w.units),
              type: "scatter" as const,
              mode: "lines+markers" as const,
              line: { color: "#2563eb", width: 2 },
              marker: { size: 5 },
              name: "Units",
            },
          ]}
          layout={{
            height: 220,
            margin: { l: 45, r: 20, t: 10, b: 30 },
            showlegend: false,
            yaxis: { title: { text: "Units", font: { size: 10 } }, rangemode: "tozero" as const },
            font: { family: "Inter, system-ui, sans-serif", size: 10 },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      {/* Demographics Section */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* Left: Customer Segments + Age Bands */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-500" />
            Customer Segments
          </h3>
          {demographics.segments.length > 0 ? (
            <>
              <Plot
                data={[{
                  values: demographics.segments.map((s) => s.pct),
                  labels: demographics.segments.map((s) => s.name),
                  type: "pie" as const,
                  hole: 0.45,
                  marker: { colors: SEGMENT_COLORS },
                  textinfo: "percent" as const,
                  textfont: { size: 10 },
                }]}
                layout={{
                  height: 180,
                  margin: { l: 10, r: 10, t: 10, b: 10 },
                  showlegend: true,
                  legend: { font: { size: 9 }, orientation: "v" as const, x: 1, y: 0.5 },
                  font: { family: "Inter, system-ui, sans-serif" },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
              <div className="mt-3 space-y-1">
                {demographics.segments.slice(0, 4).map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[i] }} />
                      <span className="text-slate-600">{s.name}</span>
                    </div>
                    <span className="font-mono font-semibold text-slate-700">{s.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400">No demographic data available</div>
          )}
        </div>

        {/* Right: Age Bands + Loyalty Tiers */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Age Bands</h3>
            {demographics.ageBands.length > 0 ? (
              <div className="space-y-1.5">
                {demographics.ageBands.map((a) => (
                  <div key={a.band} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-14">{a.band}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(a.pct, 100)}%` }} />
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 w-8 text-right">{a.pct}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">No age data available</div>
            )}
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Loyalty Tiers</h3>
            {demographics.loyaltyTiers.length > 0 ? (
              <div className="space-y-1.5">
                {demographics.loyaltyTiers.map((t, i) => (
                  <div key={t.tier} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-14">{t.tier}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(t.pct, 100)}%`, backgroundColor: TIER_COLORS[i % TIER_COLORS.length] }} />
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 w-8 text-right">{t.pct}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">No loyalty data available</div>
            )}
          </div>

          {/* Store Context */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Store vs State Average</h3>
            <div className="flex items-center gap-4">
              <div className={`text-center p-3 rounded-lg ${channelContext.indexVsState > 1.1 ? "bg-emerald-50" : channelContext.indexVsState < 0.9 ? "bg-red-50" : "bg-slate-50"}`}>
                <div className={`font-mono text-xl font-bold ${channelContext.indexVsState > 1.1 ? "text-emerald-700" : channelContext.indexVsState < 0.9 ? "text-red-700" : "text-slate-700"}`}>
                  {channelContext.indexVsState}x
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Index vs State Avg</div>
              </div>
              <div className="text-xs text-slate-500">
                This store trades at <strong>{Math.round((channelContext.indexVsState - 1) * 100)}%</strong> {channelContext.indexVsState > 1 ? "above" : "below"} the {storeInfo.state} state average for this product.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
