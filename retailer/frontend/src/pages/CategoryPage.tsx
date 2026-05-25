import { useParams, Link } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { brandData, categories } from "../data/brandConfig";

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const category = categories.find((c) => c.slug === categorySlug);

  if (!category) return <div className="p-6">Category not found</div>;

  const brands = category.brands.map((name) => brandData[name]).filter(Boolean);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-bold text-slate-900">{category.name}</h1>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Brand Performance Ranking</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">#</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue (L7D)</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Units</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs LY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">L1D</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Margin</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Rate of Sale</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">WOC</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b, i) => {
              const isGrowing = !b.growth.startsWith("-");
              const wocVal = parseFloat(b.woc);
              const wocColor = wocVal < 4 ? "text-red-600" : wocVal > 10 ? "text-amber-600" : "text-slate-700";
              return (
                <tr key={b.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 text-slate-400 font-mono">{i + 1}</td>
                  <td className="py-3">
                    <Link to={`/brand/${encodeURIComponent(b.name)}`} className="font-medium text-blue-700 hover:underline">{b.name}</Link>
                  </td>
                  <td className="py-3 text-right font-mono">{b.revenue}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{b.units}</td>
                  <td className="py-3 text-right">
                    <span className={`font-mono font-semibold flex items-center justify-end gap-1 ${isGrowing ? "text-emerald-600" : "text-red-600"}`}>
                      {isGrowing ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {b.growth}
                    </span>
                  </td>
                  <td className={`py-3 text-right font-mono font-semibold ${b.l1dGrowth.startsWith("-") ? "text-red-600" : "text-emerald-600"}`}>{b.l1dGrowth}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{b.margin}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{b.ros}</td>
                  <td className={`py-3 text-right font-mono font-semibold ${wocColor}`}>{b.woc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
