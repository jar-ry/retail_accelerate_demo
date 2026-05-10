export default function CompetitivePage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-6">Competitive Intelligence</h1>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Our Price (54pk)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">$28.99</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Market Average</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">$26.82</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Price Gap</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">+8.1%</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Demand Response</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-600">-2.3%</div>
          <div className="mt-1 text-xs text-slate-500">When Coles drops $1</div>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Competitor Pricing</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 text-xs font-semibold text-slate-500">Competitor</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Price</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Gap vs Us</th>
              <th className="text-right py-2 text-xs font-semibold text-slate-500">Last Changed</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">Coles</td><td className="text-right font-mono">$25.50</td><td className="text-right font-mono text-red-600">+13.7%</td><td className="text-right text-slate-500">2 days ago</td></tr>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">Woolworths</td><td className="text-right font-mono">$27.00</td><td className="text-right font-mono text-amber-600">+7.4%</td><td className="text-right text-slate-500">5 days ago</td></tr>
            <tr className="border-b border-slate-50"><td className="py-2.5 font-medium">Amazon AU</td><td className="text-right font-mono">$27.95</td><td className="text-right font-mono text-amber-600">+3.7%</td><td className="text-right text-slate-500">1 day ago</td></tr>
            <tr><td className="py-2.5 font-medium">Chemist Warehouse</td><td className="text-right font-mono">$26.49</td><td className="text-right font-mono text-red-600">+9.4%</td><td className="text-right text-slate-500">3 days ago</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
