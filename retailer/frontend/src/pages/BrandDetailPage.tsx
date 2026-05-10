import { useParams, Link } from "react-router-dom";
import { ArrowLeft, TrendingDown, FileText } from "lucide-react";

export default function BrandDetailPage() {
  const { brandName } = useParams();
  const brand = decodeURIComponent(brandName || "");

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-bold text-slate-900">{brand}</h1>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">Brand Detail</span>
        </div>
        <Link to={`/brand/${encodeURIComponent(brand)}/battlecard`} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800">
          <FileText className="w-4 h-4" />
          Generate Battlecard
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Revenue (L4W)</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">$1.2M</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-red-600"><TrendingDown className="w-3 h-3" />-8.4%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Units Sold</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">1,842</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-red-600"><TrendingDown className="w-3 h-3" />-6.1%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Margin</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">42%</div>
          <div className="mt-1 text-xs text-slate-500">vs 39% category avg</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Rate of Sale</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">3.2/wk</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-red-600"><TrendingDown className="w-3 h-3" />-0.4</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Weeks of Cover</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-600">9.4</div>
          <div className="mt-1 text-xs text-amber-500">Trending high</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Performance by State</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">State</th><th className="text-right py-1.5 text-xs text-slate-500">Revenue</th><th className="text-right py-1.5 text-xs text-slate-500">Growth</th><th className="text-right py-1.5 text-xs text-slate-500">WOC</th></tr></thead>
            <tbody>
              <tr className="border-b border-slate-50"><td className="py-2">VIC</td><td className="text-right font-mono">$412K</td><td className="text-right font-mono text-red-600">-12%</td><td className="text-right font-mono text-red-600 font-semibold">3.1</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2">NSW</td><td className="text-right font-mono">$356K</td><td className="text-right font-mono text-emerald-600">+2%</td><td className="text-right font-mono">6.8</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2">QLD</td><td className="text-right font-mono">$198K</td><td className="text-right font-mono text-red-600">-5%</td><td className="text-right font-mono">7.2</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2">SA</td><td className="text-right font-mono">$124K</td><td className="text-right font-mono text-emerald-600">+8%</td><td className="text-right font-mono text-amber-600 font-semibold">14.2</td></tr>
              <tr><td className="py-2">WA</td><td className="text-right font-mono">$98K</td><td className="text-right font-mono text-emerald-600">+1%</td><td className="text-right font-mono">8.4</td></tr>
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Customer Segments</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">Segment</th><th className="text-right py-1.5 text-xs text-slate-500">Penetration</th><th className="text-right py-1.5 text-xs text-slate-500">vs Category</th></tr></thead>
            <tbody>
              <tr className="border-b border-slate-50"><td className="py-2">First-time Parents</td><td className="text-right font-mono">45%</td><td className="text-right font-mono text-emerald-600">+10pp</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2">Gift Buyers</td><td className="text-right font-mono">20%</td><td className="text-right font-mono text-emerald-600">+8pp</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2">Grandparents</td><td className="text-right font-mono">18%</td><td className="text-right font-mono text-emerald-600">+8pp</td></tr>
              <tr><td className="py-2">Second-time Parents</td><td className="text-right font-mono">12%</td><td className="text-right font-mono text-red-600">-13pp</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Brand Switching (Last 12 Months)</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold text-emerald-700 mb-2">Switching IN (Conquest)</div>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">Silver Cross → {brand}</span><span className="font-mono text-sm text-emerald-600">12.1%</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">Mountain Buggy → {brand}</span><span className="font-mono text-sm text-emerald-600">8.4%</span></div>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-red-700 mb-2">Switching OUT (Churn)</div>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">{brand} → Uppababy</span><span className="font-mono text-sm text-red-600">18.2%</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">{brand} → Babyzen</span><span className="font-mono text-sm text-red-600">7.8%</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
