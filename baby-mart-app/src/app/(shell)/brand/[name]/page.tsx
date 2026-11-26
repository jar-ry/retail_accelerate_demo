"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, Sparkles, Package, Bot, Loader2, AlertTriangle } from "lucide-react";
import PeerComparison, { type Peer } from "@/components/charts/PeerComparison";

// Live from POS via /api/brand/{name}/overview: the 28 days to 7 May 2026 against
// the same days of 2025. This page used to show hand-typed figures from
// src/data/brandConfig.ts, which no query produced and no agent answer could
// agree with. "Investigate" hands the brand (or a class whose reported demand
// disagrees with POS) to the Brand Investigator.

type Overview = {
  brand: string; category: string; period: string;
  kpis: { revenue: number; growthPct: number | null; units: number; marginPct: number | null; sharePct: number | null; shareChangePts: number | null;
    rosPerStoreWeek: number | null; weeksOfCover: number | null; aov: number | null; unitsPerOrder: number | null; customers: number; difotPct: number | null };
  states: { state: string; revenue: number; growthPct: number | null; weeksOfCover: number | null }[];
  segments: { name: string; customers: number; penetrationPct: number | null; vsCategoryPts: number | null }[];
  peers: Peer[];
  classes: { class: string; revenue: number; growthPct: number | null; reportedVsPosPct: number | null; reportedDiffers: boolean }[];
  switching: { cameFrom: { brand: string; customers: number; sharePct: number | null }[]; leftFor: { brand: string; customers: number; sharePct: number | null }[]; inTotal: number; outTotal: number };
  error?: string;
};

function aud(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
const signed = (v: number | null, unit = "%") => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${unit}`);
// The Category Agent's investigation route (the Brand Investigator).
const investigate = (q: string) => `/agent?mode=investigate&q=${encodeURIComponent(q)}`;

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
      <div className="text-[10px] font-medium text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${tone || "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  );
}

export default function BrandDetailPage() {
  const params = useParams<{ name: string }>();
  const brand = decodeURIComponent(params?.name || "");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brand) return;
    setLoading(true);
    fetch(`/api/brand/${encodeURIComponent(brand)}/overview`)
      .then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [brand]);

  if (loading) {
    return <div className="p-6 flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }
  if (!data || data.error) {
    return (
      <div className="p-6">
        <Link href="/dashboard" className="text-blue-700 hover:underline text-sm">← Back to Dashboard</Link>
        <p className="mt-4 text-slate-500">{data?.error || "Brand not found."}</p>
      </div>
    );
  }

  const k = data.kpis;
  const growing = (k.growthPct ?? 0) >= 0;
  const GrowthIcon = growing ? TrendingUp : TrendingDown;
  const flagged = data.classes.filter((c) => c.reportedDiffers);
  const brandQuestion = growing ? `What is behind ${brand}'s growth?` : `Why is ${brand} down on last year?`;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-bold text-slate-900">{brand}</h1>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{data.category}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={investigate(brandQuestion)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-blue-200 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-50">
            <Bot className="w-4 h-4" />
            Investigate {growing ? "growth" : "decline"}
          </Link>
          <Link href={`/brand/${encodeURIComponent(brand)}/skus`}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">
            <Package className="w-4 h-4" />
            SKU Performance
          </Link>
          <Link href={`/meeting/${encodeURIComponent(brand)}`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800">
            <Sparkles className="w-4 h-4" />
            Prepare supplier meeting
          </Link>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-5">POS, {data.period}. Margin is total margin over total revenue.</p>

      {flagged.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 flex-1">
            <div className="font-semibold">Reported demand disagrees with POS</div>
            <div className="mt-1">
              The weekly demand view the supply pages read differs from what the tills sold for{" "}
              {flagged.map((c, i) => (
                <span key={c.class}>{i > 0 && ", "}<b>{c.class}</b> ({signed(c.reportedVsPosPct)} vs POS, FY2026 weeks 1-19)</span>
              ))}.
            </div>
          </div>
          {flagged.slice(0, 1).map((c) => (
            <Link key={c.class} href={investigate(`What drove the ${brand} ${c.class} spike?`)}
              className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">
              <Bot className="w-3.5 h-3.5" /> Investigate the spike
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Kpi label="Revenue (28 days)" value={aud(k.revenue)}
          sub={<span className={`flex items-center gap-1 ${growing ? "text-emerald-600" : "text-red-600"}`}><GrowthIcon className="w-3 h-3" />{signed(k.growthPct)} vs last year</span>} />
        <Kpi label="Units Sold" value={k.units.toLocaleString()} />
        <Kpi label="Gross Margin" value={k.marginPct === null ? "—" : `${k.marginPct.toFixed(1)}%`} />
        <Kpi label="Category Share" value={k.sharePct === null ? "—" : `${k.sharePct.toFixed(1)}%`}
          sub={<span className={(k.shareChangePts ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}>{signed(k.shareChangePts, " pts")} vs last year</span>} />
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        <Kpi label="Rate of Sale" value={k.rosPerStoreWeek === null ? "—" : `${k.rosPerStoreWeek.toFixed(1)}/store/wk`} />
        <Kpi label="Weeks of Cover" value={k.weeksOfCover === null ? "—" : k.weeksOfCover.toFixed(1)}
          tone={k.weeksOfCover !== null && k.weeksOfCover > 10 ? "text-amber-600" : k.weeksOfCover !== null && k.weeksOfCover < 4 ? "text-red-600" : undefined} />
        <Kpi label="Avg Order Value" value={k.aov === null ? "—" : `$${k.aov.toFixed(2)}`} />
        <Kpi label="Loyalty Customers" value={k.customers.toLocaleString()} />
        <Kpi label="DIFOT (wks 15-18)" value={k.difotPct === null ? "—" : `${k.difotPct.toFixed(1)}%`}
          tone={k.difotPct !== null && k.difotPct < 90 ? "text-red-600" : k.difotPct !== null && k.difotPct >= 95 ? "text-emerald-600" : undefined}
          sub={<span className="text-[10px] text-slate-400">Delivered In Full On Time</span>} />
      </div>

      <PeerComparison currentBrand={brand} category={data.category} peers={data.peers} />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Performance by Class</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">Class</th><th className="text-right py-1.5 text-xs text-slate-500">Revenue</th><th className="text-right py-1.5 text-xs text-slate-500">Growth</th><th className="text-right py-1.5 text-xs text-slate-500" /></tr></thead>
            <tbody>
              {data.classes.map((c) => (
                <tr key={c.class} className="border-b border-slate-50">
                  <td className="py-2">{c.class}{c.reportedDiffers && <span title="Reported demand disagrees with POS" className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">reported ≠ POS</span>}</td>
                  <td className="text-right font-mono">{aud(c.revenue)}</td>
                  <td className={`text-right font-mono ${(c.growthPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{signed(c.growthPct)}</td>
                  <td className="text-right">
                    <Link href={investigate(c.reportedDiffers ? `What drove the ${brand} ${c.class} spike?` : `What drove ${brand} ${c.class} ${(c.growthPct ?? 0) >= 0 ? "growth" : "decline"}?`)}
                      className="text-xs text-blue-700 hover:underline">Investigate</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Performance by State</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">State</th><th className="text-right py-1.5 text-xs text-slate-500">Revenue</th><th className="text-right py-1.5 text-xs text-slate-500">Growth</th><th className="text-right py-1.5 text-xs text-slate-500">WOC</th></tr></thead>
            <tbody>
              {data.states.map((s) => {
                const woc = s.weeksOfCover;
                return (
                  <tr key={s.state} className="border-b border-slate-50">
                    <td className="py-2">{s.state}</td>
                    <td className="text-right font-mono">{aud(s.revenue)}</td>
                    <td className={`text-right font-mono ${(s.growthPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{signed(s.growthPct)}</td>
                    <td className={`text-right font-mono ${woc !== null && woc < 4 ? "text-red-600 font-semibold" : woc !== null && woc > 10 ? "text-amber-600 font-semibold" : ""}`}>{woc === null ? "—" : woc.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Customer Segments</h3>
          <p className="text-xs text-slate-500 mb-3">Share of the brand&apos;s loyalty customers, against the same share for the category.</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">Segment</th><th className="text-right py-1.5 text-xs text-slate-500">Penetration</th><th className="text-right py-1.5 text-xs text-slate-500">vs Category</th></tr></thead>
            <tbody>
              {data.segments.map((seg) => (
                <tr key={seg.name} className="border-b border-slate-50">
                  <td className="py-2">{seg.name}</td>
                  <td className="text-right font-mono">{seg.penetrationPct === null ? "—" : `${seg.penetrationPct.toFixed(1)}%`}</td>
                  <td className={`text-right font-mono font-bold ${(seg.vsCategoryPts ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{signed(seg.vsCategoryPts, "pp")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Brand Switching</h3>
          <p className="text-xs text-slate-500 mb-3">
            {data.switching.inTotal.toLocaleString()} customers switched to {brand}; {data.switching.outTotal.toLocaleString()} switched away.
          </p>
          {data.switching.inTotal + data.switching.outTotal === 0 ? (
            <p className="text-sm text-slate-400">No switching recorded for this brand.</p>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-semibold text-emerald-700 mb-2">Came From</div>
                {data.switching.cameFrom.map((s) => (
                  <div key={s.brand} className="flex justify-between py-1 border-b border-slate-50 text-sm"><span className="font-semibold">{s.brand}</span><span className="font-mono">{s.customers}</span></div>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold text-red-700 mb-2">Left For</div>
                {data.switching.leftFor.map((s) => (
                  <div key={s.brand} className="flex justify-between py-1 border-b border-slate-50 text-sm"><span className="font-semibold">{s.brand}</span><span className="font-mono">{s.customers}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
