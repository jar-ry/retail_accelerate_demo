"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import BrandBubbleChart from "@/components/charts/BrandBubbleChart";
import { categoryBySlug } from "@/lib/categories";

// Live from POS via /api/brand/category/{name}: every brand in the category over the
// 28 days to 7 May 2026 against the same days of 2025, plus its DC cover from the
// supply side. This page used to read hand-typed figures from brandConfig.ts.

type BrandRow = {
  brand: string; revenue: number; units: number; growthPct: number | null; marginPct: number | null; sharePct: number | null;
  shareLyPct: number | null; rosPerStoreWeek: number | null; difotPct: number | null; dcCoverWeeks: number | null; dcCoverTarget: number | null;
};
type CategoryData = {
  category: string; period: string; coverAsOf: string; revenue: number; growthPct: number | null; marginPct: number | null;
  brands: BrandRow[]; error?: string;
};

function aud(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
const signed = (v: number | null, unit = "%") => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${unit}`);
const plain = (v: number | null, unit = "") => (v === null ? "—" : `${v.toFixed(1)}${unit}`);

export default function CategoryPage() {
  const params = useParams();
  const category = categoryBySlug(params.slug as string);
  const [data, setData] = useState<CategoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    fetch(`/api/brand/category/${encodeURIComponent(category.name)}`)
      .then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [category]);

  if (!category) return <div className="p-6">Category not found</div>;
  if (loading) {
    return <div className="p-6 flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }
  if (!data || data.error) {
    return (
      <div className="p-6">
        <Link href="/dashboard" className="text-blue-700 hover:underline text-sm">← Back to Dashboard</Link>
        <p className="mt-4 text-slate-500">{data?.error || "No sales for this category."}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-bold text-slate-900">{data.category}</h1>
      </div>
      <p className="mb-6 ml-8 text-xs text-slate-500">
        {data.period}. Category revenue {aud(data.revenue)}, {signed(data.growthPct)} vs last year, margin {plain(data.marginPct, "%")}.
      </p>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">Brand Performance Matrix</h3>
          <span className="text-xs text-slate-400">Bubble size is revenue · click a bubble to explore the brand</span>
        </div>
        <BrandBubbleChart
          brands={data.brands.map((b) => ({ name: b.brand, revenue: b.revenue, growthPct: b.growthPct, marginPct: b.marginPct }))}
          categoryGrowthPct={data.growthPct} categoryMarginPct={data.marginPct} />
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Brand Performance Ranking</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">#</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue (28d)</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Units</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs LY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Share</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Gross Margin</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Units / store / wk</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">DIFOT</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500" title={data.coverAsOf}>DC cover (wks)</th>
            </tr>
          </thead>
          <tbody>
            {data.brands.map((b, i) => {
              const growing = (b.growthPct ?? 0) >= 0;
              const shareMove = b.sharePct !== null && b.shareLyPct !== null ? b.sharePct - b.shareLyPct : null;
              const over = b.dcCoverWeeks !== null && b.dcCoverTarget !== null && b.dcCoverWeeks > b.dcCoverTarget * 1.25;
              const short = b.dcCoverWeeks !== null && b.dcCoverWeeks < 3;
              return (
                <tr key={b.brand} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 text-slate-400 font-mono">{i + 1}</td>
                  <td className="py-3">
                    <Link href={`/brand/${encodeURIComponent(b.brand)}`} className="font-medium text-blue-700 hover:underline">{b.brand}</Link>
                  </td>
                  <td className="py-3 text-right font-mono">{aud(b.revenue)}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{b.units.toLocaleString("en-AU")}</td>
                  <td className="py-3 text-right">
                    <span className={`font-mono font-semibold flex items-center justify-end gap-1 ${growing ? "text-emerald-600" : "text-red-600"}`}>
                      {growing ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {signed(b.growthPct)}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono text-slate-600">
                    {plain(b.sharePct, "%")}
                    {shareMove !== null && <span className={`ml-1 text-[10px] ${shareMove >= 0 ? "text-emerald-600" : "text-red-600"}`}>{signed(shareMove, "pt")}</span>}
                  </td>
                  <td className="py-3 text-right font-mono text-slate-600">{plain(b.marginPct, "%")}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{plain(b.rosPerStoreWeek)}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{plain(b.difotPct, "%")}</td>
                  <td className={`py-3 text-right font-mono font-semibold ${short ? "text-red-600" : over ? "text-amber-600" : "text-slate-700"}`}
                    title={b.dcCoverTarget !== null ? `Target ${b.dcCoverTarget} weeks` : undefined}>
                    {plain(b.dcCoverWeeks)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-slate-400">
          POS for revenue, units, share and margin. DIFOT is the supplier&apos;s order-weighted rate for FY2026 weeks 15-18. {data.coverAsOf}, for brands with a supply profile.
        </p>
      </div>
    </div>
  );
}
