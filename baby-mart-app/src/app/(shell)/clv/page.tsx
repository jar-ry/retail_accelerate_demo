export default function CLVPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-6">Customer Lifetime Value</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Avg CLV — Huggies</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">$1,247</div>
          <div className="mt-1 text-xs text-slate-500">vs Category: $892 <span className="text-emerald-600 font-semibold">(+40%)</span></div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">12-Month Retention</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900">72%</div>
          <div className="mt-1 text-xs text-slate-500">vs Category: 58% <span className="text-emerald-600 font-semibold">(+14pp)</span></div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="text-[10px] font-medium text-slate-500 uppercase">Category Entry Point</div>
          <div className="mt-1 font-mono text-2xl font-bold text-blue-700">70%</div>
          <div className="mt-1 text-xs text-slate-500">of nappy customers start with Huggies</div>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Key Negotiation Insight</h3>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-900">
            <strong>Huggies customers have 40% higher CLV than category average.</strong> Like iPhones
            at Officeworks — even if margins are thin, these customers drive enormous downstream value.
            We can justify accepting tighter terms because they bring 70% of new category entrants.
          </p>
        </div>
      </div>
    </div>
  );
}
