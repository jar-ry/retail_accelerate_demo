import { useParams, Link } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";

const categoryData: Record<string, { name: string; brands: { name: string; revenue: string; units: string; growth: string; margin: string; ros: string; woc: string }[] }> = {
  "prams-strollers": {
    name: "Prams & Strollers",
    brands: [
      { name: "Bugaboo", revenue: "$1.2M", units: "1,842", growth: "-8.4%", margin: "42%", ros: "3.2/wk", woc: "9.4" },
      { name: "Uppababy", revenue: "$892K", units: "1,456", growth: "+24.3%", margin: "44%", ros: "4.1/wk", woc: "5.2" },
      { name: "Silver Cross", revenue: "$542K", units: "812", growth: "+3.1%", margin: "40%", ros: "2.1/wk", woc: "7.8" },
      { name: "Babyzen", revenue: "$398K", units: "624", growth: "+5.7%", margin: "46%", ros: "1.8/wk", woc: "6.1" },
      { name: "Mountain Buggy", revenue: "$287K", units: "892", growth: "-2.1%", margin: "35%", ros: "2.4/wk", woc: "8.9" },
    ],
  },
  "car-seats": {
    name: "Car Seats",
    brands: [
      { name: "Maxi-Cosi", revenue: "$524K", units: "2,134", growth: "+7.2%", margin: "38%", ros: "5.8/wk", woc: "6.2" },
      { name: "Britax", revenue: "$487K", units: "2,892", growth: "+2.8%", margin: "34%", ros: "7.1/wk", woc: "5.4" },
      { name: "Cybex", revenue: "$412K", units: "1,245", growth: "+15.2%", margin: "43%", ros: "3.4/wk", woc: "4.8" },
      { name: "Nuna", revenue: "$312K", units: "892", growth: "+4.5%", margin: "41%", ros: "2.2/wk", woc: "7.1" },
      { name: "Infasecure", revenue: "$142K", units: "1,678", growth: "-12.8%", margin: "28%", ros: "4.2/wk", woc: "12.4" },
    ],
  },
  "nappies-wipes": {
    name: "Nappies & Wipes",
    brands: [
      { name: "Huggies", revenue: "$1.4M", units: "48,234", growth: "+1.2%", margin: "32%", ros: "18.2/wk", woc: "4.8" },
      { name: "Rascal + Friends", revenue: "$1.1M", units: "38,921", growth: "+18.7%", margin: "36%", ros: "14.8/wk", woc: "3.9" },
      { name: "Pampers", revenue: "$680K", units: "22,456", growth: "-6.2%", margin: "30%", ros: "8.4/wk", woc: "8.2" },
      { name: "Tooshies", revenue: "$289K", units: "8,234", growth: "+9.4%", margin: "42%", ros: "3.1/wk", woc: "5.5" },
      { name: "ECO by Naty", revenue: "$198K", units: "5,123", growth: "+6.8%", margin: "44%", ros: "1.9/wk", woc: "6.8" },
    ],
  },
  "clothing": {
    name: "Clothing",
    brands: [
      { name: "Bonds Baby", revenue: "$342K", units: "12,456", growth: "+4.2%", margin: "45%", ros: "8.2/wk", woc: "5.1" },
      { name: "Purebaby", revenue: "$287K", units: "4,892", growth: "+12.1%", margin: "52%", ros: "3.4/wk", woc: "4.2" },
      { name: "Cotton On Baby", revenue: "$198K", units: "14,234", growth: "+3.8%", margin: "38%", ros: "9.8/wk", woc: "4.8" },
      { name: "Marquise", revenue: "$142K", units: "3,456", growth: "+1.4%", margin: "48%", ros: "2.1/wk", woc: "7.2" },
      { name: "Bebe", revenue: "$89K", units: "1,892", growth: "-9.1%", margin: "50%", ros: "1.2/wk", woc: "11.4" },
    ],
  },
  "feeding": {
    name: "Feeding",
    brands: [
      { name: "Avent", revenue: "$298K", units: "8,234", growth: "+5.2%", margin: "40%", ros: "4.2/wk", woc: "5.8" },
      { name: "Tommee Tippee", revenue: "$256K", units: "9,123", growth: "+3.1%", margin: "36%", ros: "5.1/wk", woc: "6.2" },
      { name: "Dr Browns", revenue: "$198K", units: "6,789", growth: "+11.8%", margin: "42%", ros: "3.8/wk", woc: "4.4" },
      { name: "Pigeon", revenue: "$124K", units: "4,567", growth: "+2.4%", margin: "38%", ros: "2.8/wk", woc: "7.1" },
      { name: "NUK", revenue: "$76K", units: "2,345", growth: "-7.4%", margin: "35%", ros: "1.4/wk", woc: "10.2" },
    ],
  },
};

export default function CategoryPage() {
  const { categorySlug } = useParams();
  const data = categoryData[categorySlug || ""];

  if (!data) return <div className="p-6">Category not found</div>;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-xl font-bold text-slate-900">{data.name}</h1>
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Brand Performance Ranking</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">#</th>
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Brand</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Revenue (L4W)</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Units</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Growth vs LY</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Margin</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Rate of Sale</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">WOC</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.brands.map((b, i) => {
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
                  <td className="py-3 text-right font-mono text-slate-600">{b.margin}</td>
                  <td className="py-3 text-right font-mono text-slate-600">{b.ros}</td>
                  <td className={`py-3 text-right font-mono font-semibold ${wocColor}`}>{b.woc}</td>
                  <td className="py-3 text-right">
                    <Link to={`/brand/${encodeURIComponent(b.name)}/battlecard`} className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded font-medium hover:bg-blue-200">
                      Battlecard
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
