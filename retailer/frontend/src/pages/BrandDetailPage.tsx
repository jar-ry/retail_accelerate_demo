import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown, Sparkles, X, Loader2 } from "lucide-react";
import { brandData } from "../data/brandConfig";

interface BattlecardData {
  sellthrough: string;
  switching: string;
  summary: string;
}

export default function BrandDetailPage() {
  const { brandName } = useParams();
  const brand = decodeURIComponent(brandName || "");
  const data = brandData[brand];
  const [showBattlecard, setShowBattlecard] = useState(false);
  const [battlecard, setBattlecard] = useState<BattlecardData | null>(null);
  const [loading, setLoading] = useState(false);

  const generateBattlecard = async () => {
    setShowBattlecard(true);
    setBattlecard(null);
    setLoading(true);
    try {
      const res = await fetch("/api/battlecard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, category: data?.category || "" }),
      });
      const result = await res.json();
      setBattlecard({ sellthrough: result.sellthrough, switching: result.switching, summary: result.summary });
    } catch {
      setBattlecard({ sellthrough: "Error loading.", switching: "Error loading.", summary: "Error loading." });
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div className="p-6">
        <Link to="/dashboard" className="text-blue-700 hover:underline text-sm">← Back to Dashboard</Link>
        <p className="mt-4 text-slate-500">Brand not found.</p>
      </div>
    );
  }

  const isGrowing = !data.growth.startsWith("-");
  const GrowthIcon = isGrowing ? TrendingUp : TrendingDown;
  const growthColor = isGrowing ? "text-emerald-600" : "text-red-600";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-bold text-slate-900">{brand}</h1>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{data.category}</span>
        </div>
        <button
          onClick={generateBattlecard}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800"
        >
          <Sparkles className="w-4 h-4" />
          Generate Battlecard
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Revenue (L7D)</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.revenue}</div>
          <div className={`mt-1 flex items-center gap-1 text-xs ${growthColor}`}><GrowthIcon className="w-3 h-3" />{data.growth}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Units Sold</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.units}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Margin</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.margin}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Rate of Sale</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.ros}</div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Weeks of Cover</div>
          <div className={`mt-1 font-mono text-xl font-bold ${parseFloat(data.woc) > 10 ? "text-amber-600" : parseFloat(data.woc) < 4 ? "text-red-600" : "text-slate-900"}`}>{data.woc}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Avg Order Value</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.aov}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Units / Order</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.unitsPerOrder}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Customers (L7D)</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{data.customerCount}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">DIFOT</div>
          <div className={`mt-1 font-mono text-xl font-bold ${parseFloat(data.difot) < 90 ? "text-red-600" : parseFloat(data.difot) >= 95 ? "text-emerald-600" : "text-slate-900"}`}>{data.difot}</div>
          <div className="mt-1 text-[10px] text-slate-400">Delivered In Full On Time</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Performance by State</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">State</th><th className="text-right py-1.5 text-xs text-slate-500">Revenue</th><th className="text-right py-1.5 text-xs text-slate-500">Growth</th><th className="text-right py-1.5 text-xs text-slate-500">WOC</th></tr></thead>
            <tbody>
              {data.statePerformance.map((s) => {
                const sGrowing = !s.growth.startsWith("-");
                const wocVal = parseFloat(s.woc);
                const wocColor = wocVal < 4 ? "text-red-600 font-semibold" : wocVal > 10 ? "text-amber-600 font-semibold" : "";
                return (
                  <tr key={s.state} className="border-b border-slate-50">
                    <td className="py-2">{s.state}</td>
                    <td className="text-right font-mono">{s.revenue}</td>
                    <td className={`text-right font-mono ${sGrowing ? "text-emerald-600" : "text-red-600"}`}>{s.growth}</td>
                    <td className={`text-right font-mono ${wocColor}`}>{s.woc}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Customer Segments</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100"><th className="text-left py-1.5 text-xs text-slate-500">Segment</th><th className="text-right py-1.5 text-xs text-slate-500">Penetration</th><th className="text-right py-1.5 text-xs text-slate-500">vs Category</th></tr></thead>
            <tbody>
              {data.segments.map((seg) => (
                <tr key={seg.name} className="border-b border-slate-50">
                  <td className="py-2">{seg.name}</td>
                  <td className="text-right font-mono">{seg.penetration}</td>
                  <td className={`text-right font-mono font-bold ${seg.vsCategory.startsWith("+") ? "text-emerald-600" : "text-red-600"}`}>{seg.vsCategory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.category !== "Prams & Strollers" && data.category !== "Car Seats" && (
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Brand Switching (Last 12 Months)</h3>
          <p className="text-xs text-slate-500 mt-1">
            <span className="font-semibold text-emerald-700">{data.switchingIn.reduce((sum, s) => sum + parseFloat(s.pct), 0).toFixed(1)}%</span> of {brand} customers came from another brand &nbsp;|&nbsp;
            <span className="font-semibold text-red-700">{data.switchingOut.reduce((sum, s) => sum + parseFloat(s.pct), 0).toFixed(1)}%</span> left for another brand
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-semibold text-emerald-700 mb-2">Came From</div>
            <div className="space-y-2">
              {data.switchingIn.map((s) => (
                <div key={s.from} className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">{s.pct} from <span className="font-semibold">{s.from}</span></span></div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-red-700 mb-2">Left For</div>
            <div className="space-y-2">
              {data.switchingOut.map((s) => (
                <div key={s.to} className="flex justify-between py-1 border-b border-slate-50"><span className="text-sm">{s.pct} to <span className="font-semibold">{s.to}</span></span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {showBattlecard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8" onClick={() => setShowBattlecard(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-blue-800 text-white p-6 rounded-t-2xl relative">
              <button onClick={() => setShowBattlecard(false)} className="absolute top-4 right-4 text-blue-200 hover:text-white">
                <X className="w-5 h-5" />
              </button>
              <div className="text-xs font-medium text-blue-200 uppercase tracking-wider">AI-Generated Negotiation Battlecard</div>
              <h2 className="mt-1 text-xl font-bold">{brand} — {data.category}</h2>
              <p className="mt-1 text-sm text-blue-200">Generated by Cortex AI | May 2026 | Confidential</p>
            </div>
            <div className="p-6 space-y-6">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
                  <p className="text-sm">Cortex AI is generating insights...</p>
                </div>
              ) : battlecard ? (
                <>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-2">Sell-Through Insights</h3>
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {battlecard.sellthrough.split("\n").filter(l => l.trim()).map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-blue-600 mt-0.5">•</span>
                          <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-2">Brand Switching</h3>
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {battlecard.switching.split("\n").filter(l => l.trim()).map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-amber-600 mt-0.5">•</span>
                          <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="border-t border-slate-200 pt-6">
                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-2">Executive Summary & Levers</h3>
                    <div className="space-y-2">
                      {battlecard.summary.split("\n").filter(l => l.trim()).map((line, i) => (
                        <div key={i} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                          {line.replace(/^[•\-\*]\s*/, "")}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
