export default function ElasticityPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-6">Promotional Elasticity</h1>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Promo ROI by Mechanic — Huggies</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Mechanic</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Uplift</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Incremental %</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">ROI</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">30% Off</td><td className="text-right font-mono">+80%</td><td className="text-right font-mono text-red-600">40%</td><td className="text-right font-mono text-red-600">0.8x</td></tr>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">Multi-buy (3 for 2)</td><td className="text-right font-mono">+45%</td><td className="text-right font-mono text-amber-600">55%</td><td className="text-right font-mono text-amber-600">1.2x</td></tr>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">Bundle + Wipes</td><td className="text-right font-mono">+35%</td><td className="text-right font-mono text-emerald-600">72%</td><td className="text-right font-mono text-emerald-600">2.1x</td></tr>
            <tr><td className="py-2.5 font-medium">GWP (Free travel pack)</td><td className="text-right font-mono">+28%</td><td className="text-right font-mono text-emerald-600">78%</td><td className="text-right font-mono text-emerald-600">2.4x</td></tr>
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-900"><strong>Deep discounts are mostly pull-forward, not incremental.</strong> Shift co-op investment from % off to bundles/GWP which deliver 2-3x ROI.</p>
        </div>
      </div>
    </div>
  );
}
