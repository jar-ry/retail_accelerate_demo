import { useState, useEffect, useMemo, useRef } from "react";
import { Gift, Calculator, Sparkles, Zap } from "lucide-react";
import { useAudience } from "../context/AudienceContext";

interface Offer {
  id: string; name: string; type: string; description: string;
  costPerRedemption: number; avgRedemptionRate: number; partner?: string; active: boolean;
}

const TYPE_COLORS: Record<string, string> = { Promo: "bg-emerald-100 text-emerald-700", Discount: "bg-blue-100 text-blue-700", Cashback: "bg-amber-100 text-amber-700", Partner: "bg-purple-100 text-purple-700", Reward: "bg-pink-100 text-pink-700" };
const CHANNEL_COSTS: Record<string, number> = { Email: 0.03, SMS: 0.08, "Email + SMS": 0.11, "App Push": 0 };

export default function CampaignOffersPage() {
  const { state: audienceCtx } = useAudience();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tab, setTab] = useState<"catalogue" | "calculator" | "planner">("catalogue");

  // Calculator state — init from context
  const [audienceSize, setAudienceSize] = useState(audienceCtx.audienceSize || 18000);
  const [channel, setChannel] = useState("Email");
  const [duration, setDuration] = useState(30);
  const [selectedOffers, setSelectedOffers] = useState<Set<string>>(new Set());
  const [calcAi, setCalcAi] = useState("");
  const [calcAiLoading, setCalcAiLoading] = useState(false);

  // Planner state
  const [budget, setBudget] = useState(10000);
  const [goal, setGoal] = useState<"conversions" | "reach" | "engagement">("conversions");
  const [channelPref, setChannelPref] = useState("Email");
  const [plannerAi, setPlannerAi] = useState("");
  const [plannerAiLoading, setPlannerAiLoading] = useState(false);

  // Activate modal
  const [showActivate, setShowActivate] = useState(false);
  const [activateName, setActivateName] = useState("");
  const [activateDest, setActivateDest] = useState<"Braze" | "Hightouch">("Braze");
  const [activateBudget, setActivateBudget] = useState(0);
  const [activateChannel, setActivateChannel] = useState("Email");
  const [toast, setToast] = useState("");

  const calcDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/campaign/offers").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setOffers(d); }).catch(() => {});
  }, []);

  const activeOffers = offers.filter((o) => o.active);

  // ── Cost Calculator (deterministic) ──
  const calcResult = useMemo(() => {
    const selected = activeOffers.filter((o) => selectedOffers.has(o.id));
    if (selected.length === 0 || audienceSize === 0) return { totalCost: 0, sendCost: 0, offerCost: 0, breakdown: [], estRedemptions: 0 };
    const sends = duration <= 30 ? 1 : Math.ceil(duration / 14);
    const channelCost = CHANNEL_COSTS[channel] || 0.03;
    const sendCost = audienceSize * sends * channelCost;
    const breakdown = selected.map((o) => {
      const redemptions = Math.round(audienceSize * o.avgRedemptionRate);
      const cost = redemptions * o.costPerRedemption;
      return { offer: o, redemptions, cost };
    });
    const offerCost = breakdown.reduce((s, b) => s + b.cost, 0);
    return { totalCost: sendCost + offerCost, sendCost, offerCost, breakdown, estRedemptions: breakdown.reduce((s, b) => s + b.redemptions, 0) };
  }, [selectedOffers, channel, duration, audienceSize, activeOffers]);

  // AI recommendations for calculator (debounced)
  useEffect(() => {
    if (calcResult.totalCost === 0) { setCalcAi(""); return; }
    if (calcDebounce.current) clearTimeout(calcDebounce.current);
    calcDebounce.current = setTimeout(async () => {
      setCalcAiLoading(true);
      const selected = activeOffers.filter((o) => selectedOffers.has(o.id));
      const prompt = `You are a campaign cost advisor for Baby Mart (baby retailer). PRE-COMPUTED costs (do NOT recalculate):
Audience: ${audienceSize.toLocaleString()} customers | Channel: ${channel} | Duration: ${duration} days
Send Cost: $${calcResult.sendCost.toFixed(2)} | Offer Cost: $${calcResult.offerCost.toFixed(2)} | Total: $${calcResult.totalCost.toFixed(2)}
Est. Redemptions: ${calcResult.estRedemptions.toLocaleString()}
Offers: ${selected.map((o) => o.name).join(", ")}

Provide 2-3 concise recommendations about cost optimization, channel effectiveness, or offer mix for baby product campaigns. Reference exact numbers. Do NOT recalculate costs.`;
      try {
        const res = await fetch("/api/campaign/ai-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const data = await res.json();
        setCalcAi(data.text || "");
      } catch {} finally { setCalcAiLoading(false); }
    }, 1000);
  }, [calcResult.totalCost]);

  // ── Budget Planner (greedy knapsack) ──
  const plannerResult = useMemo(() => {
    if (budget <= 0 || audienceSize === 0) return { selected: [], totalCost: 0, sendCost: 0, offerCost: 0, remaining: budget };
    const channelCost = CHANNEL_COSTS[channelPref] || 0.03;
    const sends = 2;
    const sendCost = audienceSize * sends * channelCost;
    if (sendCost >= budget) return { selected: [], totalCost: sendCost, sendCost, offerCost: 0, remaining: budget - sendCost };
    let remaining = budget - sendCost;
    const scored = activeOffers.map((o) => {
      const redemptions = Math.round(audienceSize * o.avgRedemptionRate);
      const cost = redemptions * o.costPerRedemption;
      let eff = 0;
      if (goal === "conversions") {
        // Maximize total conversions per dollar — favor high redemption rate, low cost
        eff = cost > 0 ? (o.avgRedemptionRate * o.avgRedemptionRate) / o.costPerRedemption : 0;
      } else if (goal === "reach") {
        // Maximize audience touched — favor low cost offers so we can include more
        eff = cost > 0 ? 1 / o.costPerRedemption : 999;
      } else {
        // Engagement — favor high redemption rate (even if expensive)
        eff = o.avgRedemptionRate * 100;
      }
      return { offer: o, redemptions, cost, eff };
    }).sort((a, b) => b.eff - a.eff);
    const picked: typeof scored = [];
    for (const item of scored) { if (item.cost <= remaining && (item.cost > 0 || item.offer.costPerRedemption === 0)) { picked.push(item); remaining -= item.cost; } }
    const offerCost = picked.reduce((s, p) => s + p.cost, 0);
    return { selected: picked, totalCost: sendCost + offerCost, sendCost, offerCost, remaining };
  }, [budget, channelPref, goal, audienceSize, activeOffers]);

  // AI strategy for planner (debounced)
  useEffect(() => {
    if (plannerResult.selected.length === 0) { setPlannerAi(""); return; }
    if (planDebounce.current) clearTimeout(planDebounce.current);
    planDebounce.current = setTimeout(async () => {
      setPlannerAiLoading(true);
      const prompt = `You are a campaign strategist for Baby Mart. PRE-COMPUTED optimized plan (do NOT recalculate):
Budget: $${budget.toLocaleString()} | Goal: ${goal} | Channel: ${channelPref}
Audience: ${audienceSize.toLocaleString()} customers
Send Cost: $${plannerResult.sendCost.toFixed(2)} | Offer Cost: $${plannerResult.offerCost.toFixed(2)} | Total: $${plannerResult.totalCost.toFixed(2)} | Remaining: $${plannerResult.remaining.toFixed(2)}
Selected Offers: ${plannerResult.selected.map((p) => `${p.offer.name} ($${p.cost.toFixed(0)}, ${p.redemptions} est. redemptions)`).join("; ")}

Respond in JSON: {"summary":"2 sentence overview","offerReasons":["reason per offer"],"roiRationale":"1 sentence ROI","tips":["2-3 optimization tips"]}
Do NOT recalculate costs. Use exact numbers provided.`;
      try {
        const res = await fetch("/api/campaign/ai-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const data = await res.json();
        setPlannerAi(data.text || "");
      } catch {} finally { setPlannerAiLoading(false); }
    }, 1000);
  }, [plannerResult.totalCost, plannerResult.selected.length]);

  const handleActivate = (fromBudget: number, fromChannel: string) => {
    setActivateBudget(fromBudget); setActivateChannel(fromChannel); setActivateName("Baby Mart Campaign"); setShowActivate(true);
  };

  const confirmActivate = async () => {
    await fetch("/api/campaign/campaigns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: activateName, channel: activateChannel, audience: audienceCtx.audienceLabel || "Audience Builder Segment", audienceSize, budget: activateBudget, destination: activateDest, startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + duration * 86400000).toISOString().slice(0, 10) }),
    });
    setShowActivate(false);
    setToast(`Campaign "${activateName}" activated to ${activateDest}!`);
    setTimeout(() => setToast(""), 4000);
  };

  const parsePlannerAI = (text: string) => { try { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch {} return null; };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <Gift className="w-5 h-5 text-amber-600" />
        <h1 className="text-xl font-bold text-slate-900">Offers & Costs</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-lg w-fit">
        {([["catalogue", "Catalogue"], ["calculator", "Cost Calculator"], ["planner", "AI Budget Planner"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-md text-xs font-semibold ${tab === k ? "bg-white text-amber-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
        ))}
      </div>

      {/* ── Catalogue ── */}
      {tab === "catalogue" && (
        <div className="grid grid-cols-2 gap-3">
          {offers.map((o) => (
            <div key={o.id} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${TYPE_COLORS[o.type] || "bg-slate-100"}`}>{o.type}</span>
                {!o.active && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Inactive</span>}
              </div>
              <div className="font-semibold text-sm text-slate-800 mb-1">{o.name}</div>
              <div className="text-xs text-slate-500 mb-3">{o.description}</div>
              <div className="flex items-center gap-4 text-[10px] text-slate-400">
                <span>Cost: <strong className="text-slate-600">${o.costPerRedemption.toFixed(2)}</strong>/redeem</span>
                <span>Rate: <strong className="text-slate-600">{(o.avgRedemptionRate * 100).toFixed(0)}%</strong></span>
                {o.partner && <span>Partner: <strong className="text-slate-600">{o.partner}</strong></span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Cost Calculator ── */}
      {tab === "calculator" && (
        <div className="grid grid-cols-[1fr_1fr] gap-5">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Calculator className="w-4 h-4" />Configuration</h3>
            <div><label className="text-xs font-medium text-slate-600">Audience Size</label><input type="number" value={audienceSize} onChange={(e) => setAudienceSize(parseInt(e.target.value) || 0)} className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="text-xs font-medium text-slate-600">Channel</label>
              <div className="flex gap-1.5 mt-1">{Object.entries(CHANNEL_COSTS).map(([c, cost]) => (<button key={c} onClick={() => setChannel(c)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${channel === c ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{c} (${cost})</button>))}</div>
            </div>
            <div><label className="text-xs font-medium text-slate-600">Duration: {duration} days</label><input type="range" min={7} max={90} value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="w-full accent-amber-500 mt-1" /></div>
            <div><label className="text-xs font-medium text-slate-600 block mb-2">Select Offers</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">{activeOffers.map((o) => (<label key={o.id} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer"><input type="checkbox" checked={selectedOffers.has(o.id)} onChange={() => setSelectedOffers((s) => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} className="rounded border-slate-300 text-amber-500 w-3.5 h-3.5" />{o.name} <span className="text-slate-400 ml-auto">${o.costPerRedemption}</span></label>))}</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Cost Estimate</h3>
              {calcResult.totalCost === 0 ? <p className="text-xs text-slate-400 italic">Select at least one offer</p> : (
                <>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Send Cost</span><span className="font-mono font-semibold">${calcResult.sendCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Offer Cost</span><span className="font-mono font-semibold">${calcResult.offerCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 text-sm"><span className="font-semibold">Total</span><span className="font-mono font-bold text-amber-700">${calcResult.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  </div>
                  {calcResult.breakdown.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100"><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Offer Breakdown</div>{calcResult.breakdown.map((b) => (<div key={b.offer.id} className="flex justify-between text-[11px] text-slate-600 mb-0.5"><span>{b.offer.name} ({b.redemptions.toLocaleString()} redemptions)</span><span className="font-mono">${b.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>))}</div>
                  )}
                  <button onClick={() => handleActivate(Math.round(calcResult.totalCost), channel)} className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"><Zap className="w-3.5 h-3.5" />Activate Campaign</button>
                </>
              )}
            </div>
            {calcResult.totalCost > 0 && (
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-2"><Sparkles className="w-3.5 h-3.5 text-amber-500" />AI Recommendations</h4>
                {calcAiLoading ? <div className="space-y-2"><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[90%]" /><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[70%]" /></div> : <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{calcAi}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI Budget Planner ── */}
      {tab === "planner" && (
        <div className="grid grid-cols-[1fr_1fr] gap-5">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" />Budget Parameters</h3>
            <div><label className="text-xs font-medium text-slate-600">Budget: ${budget.toLocaleString()}</label><input type="range" min={1000} max={100000} step={1000} value={budget} onChange={(e) => setBudget(parseInt(e.target.value))} className="w-full accent-amber-500 mt-1" /><div className="flex justify-between text-[9px] text-slate-400"><span>$1,000</span><span>$100,000</span></div></div>
            <div><label className="text-xs font-medium text-slate-600">Audience Size</label><input type="number" value={audienceSize} onChange={(e) => setAudienceSize(parseInt(e.target.value) || 0)} className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="text-xs font-medium text-slate-600">Campaign Goal</label>
              <div className="flex gap-1.5 mt-1">{(["conversions", "reach", "engagement"] as const).map((g) => (<button key={g} onClick={() => setGoal(g)} className={`px-3 py-1 rounded-lg text-[11px] font-medium border capitalize ${goal === g ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-500"}`}>{g}</button>))}</div>
            </div>
            <div><label className="text-xs font-medium text-slate-600">Channel</label>
              <div className="flex gap-1.5 mt-1">{(["Email", "SMS", "Email + SMS"] as const).map((c) => (<button key={c} onClick={() => setChannelPref(c)} className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${channelPref === c ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-500"}`}>{c}</button>))}</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Optimized Plan</h3>
              {plannerResult.selected.length === 0 ? <p className="text-xs text-slate-400 italic">{plannerResult.sendCost >= budget ? "Budget too low to cover send costs." : "Adjust parameters to generate."}</p> : (
                <>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Send Cost</span><span className="font-mono font-semibold">${plannerResult.sendCost.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Offer Cost</span><span className="font-mono font-semibold">${plannerResult.offerCost.toFixed(2)}</span></div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 text-sm"><span className="font-semibold">Total</span><span className="font-mono font-bold text-amber-700">${plannerResult.totalCost.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-emerald-600">Remaining</span><span className="font-mono font-semibold text-emerald-600">${plannerResult.remaining.toFixed(2)}</span></div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100"><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Selected Offers</div>
                    {plannerResult.selected.map((p) => (<div key={p.offer.id} className="flex justify-between text-[11px] text-slate-600 mb-1 p-1.5 bg-emerald-50 rounded"><div><span className="font-medium">{p.offer.name}</span><span className="text-slate-400 ml-2">({p.redemptions.toLocaleString()} est.)</span></div><span className="font-mono text-emerald-700">${p.cost.toFixed(0)}</span></div>))}
                  </div>
                  <button onClick={() => handleActivate(Math.round(plannerResult.totalCost), channelPref)} className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"><Zap className="w-3.5 h-3.5" />Activate Campaign</button>
                </>
              )}
            </div>
            {plannerResult.selected.length > 0 && (
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-2"><Sparkles className="w-3.5 h-3.5 text-amber-500" />AI Strategy</h4>
                {plannerAiLoading ? <div className="space-y-2"><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[85%]" /><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[65%]" /></div> : (() => {
                  const parsed = parsePlannerAI(plannerAi);
                  if (parsed) return (<div className="text-xs text-slate-700 space-y-2">
                    {parsed.summary && <p>{parsed.summary}</p>}
                    {parsed.offerReasons && <ul className="list-disc pl-4 space-y-0.5">{parsed.offerReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>}
                    {parsed.roiRationale && <p className="italic text-slate-500">{parsed.roiRationale}</p>}
                    {parsed.tips && <div><strong className="text-[10px] text-slate-400 uppercase">Tips:</strong><ul className="list-disc pl-4 space-y-0.5">{parsed.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>}
                  </div>);
                  return <div className="text-xs text-slate-700 whitespace-pre-wrap">{plannerAi}</div>;
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Activate Modal ── */}
      {showActivate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowActivate(false)}>
          <div className="bg-white rounded-xl p-6 w-[420px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Activate Campaign</h3>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-slate-600">Campaign Name</label><input value={activateName} onChange={(e) => setActivateName(e.target.value)} className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="text-xs font-medium text-slate-600">Destination</label>
                <select value={activateDest} onChange={(e) => setActivateDest(e.target.value as "Braze" | "Hightouch")} className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="Braze">Braze</option><option value="Hightouch">Hightouch</option></select>
              </div>
              <div><label className="text-xs font-medium text-slate-600">Channel</label><input value={activateChannel} disabled className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" /></div>
              <div><label className="text-xs font-medium text-slate-600">Budget</label><input value={`$${activateBudget.toLocaleString()}`} disabled className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" /></div>
              <div><label className="text-xs font-medium text-slate-600">Audience</label><input value={`${audienceSize.toLocaleString()} customers`} disabled className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50" /></div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowActivate(false)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={confirmActivate} disabled={!activateName.trim()} className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-40">Activate to {activateDest}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="fixed bottom-6 right-6 bg-emerald-700 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50">{toast}</div>}
    </div>
  );
}
