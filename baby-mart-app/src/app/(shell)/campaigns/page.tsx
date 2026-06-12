"use client";

import { useState, useEffect } from "react";
import { Megaphone, Loader2, Plus, ArrowLeft, Pause, Play, CheckCircle, XCircle, Rocket, Sparkles, Trash2 } from "lucide-react";

interface Campaign {
  id: string; name: string; status: string; channel: string; audience: string;
  audienceSize: number; sent: number; opened: number; clicked: number; converted: number;
  startDate: string; endDate: string; budget: number; spent: number; destination?: string;
}

const STATUS_COLORS: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700", Draft: "bg-slate-100 text-slate-600",
  Completed: "bg-blue-100 text-blue-700", Paused: "bg-amber-100 text-amber-700",
  Cancelled: "bg-red-100 text-red-600", Activated: "bg-purple-100 text-purple-700",
};

const FUNNEL_COLORS = ["#f59e0b", "#10b981", "#2563eb", "#8b5cf6"];

export default function CampaignListPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [aiInsight, setAiInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newCampaign, setNewCampaign] = useState({ name: "", channel: "Email", audience: "", budget: 0, destination: "Braze" });

  useEffect(() => {
    fetch("/api/campaign/campaigns").then((r) => r.json()).then((data) => { if (Array.isArray(data)) setCampaigns(data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const loadInsights = async (c: Campaign) => {
    setInsightLoading(true);
    const openRate = c.sent > 0 ? ((c.opened / c.sent) * 100).toFixed(1) : "0";
    const clickRate = c.opened > 0 ? ((c.clicked / c.opened) * 100).toFixed(1) : "0";
    const convRate = c.clicked > 0 ? ((c.converted / c.clicked) * 100).toFixed(1) : "0";
    const prompt = `Analyze this Baby Mart marketing campaign and provide 3-4 concise insights:
Campaign: ${c.name} | Status: ${c.status} | Channel: ${c.channel}
Audience: ${c.audience} (${c.audienceSize.toLocaleString()} people)
Sent: ${c.sent.toLocaleString()} | Opened: ${c.opened.toLocaleString()} (${openRate}%) | Clicked: ${c.clicked.toLocaleString()} (${clickRate}%) | Converted: ${c.converted.toLocaleString()} (${convRate}%)
Budget: $${c.budget.toLocaleString()} | Spent: $${c.spent.toLocaleString()}
${c.destination ? `Destination: ${c.destination}` : ""}
Focus on: performance assessment for baby product campaigns, optimization opportunities, and next steps. Be specific with numbers.`;
    try {
      const res = await fetch("/api/campaign/ai-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      setAiInsight(data.text || "");
    } catch { setAiInsight("Unable to generate insights."); }
    setInsightLoading(false);
  };

  const handleSelect = (c: Campaign) => { setSelected(c); setAiInsight(""); loadInsights(c); };

  const executeAction = async (id: string, action: string) => {
    const statusMap: Record<string, string> = { pause: "Paused", resume: "Active", cancel: "Cancelled", complete: "Completed", launch: "Active" };
    const newStatus = statusMap[action];
    if (!newStatus) return;
    await fetch(`/api/campaign/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    setCampaigns((prev) => prev.map((c) => c.id === id ? { ...c, status: newStatus } : c));
    if (selected && selected.id === id) setSelected({ ...selected, status: newStatus });
    setConfirmAction(null);
  };

  const createCampaign = async () => {
    const res = await fetch("/api/campaign/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCampaign),
    });
    const data = await res.json();
    if (data.id) {
      setCampaigns((prev) => [data, ...prev]);
      setShowCreateModal(false);
      setNewCampaign({ name: "", channel: "Email", audience: "", budget: 0, destination: "Braze" });
    }
  };

  const deleteCampaign = async (id: string) => {
    await fetch(`/api/campaign/campaigns/${id}`, { method: "DELETE" });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    setDeleteConfirm(null);
  };

  if (loading) return <div className="p-6 flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>;

  // Detail view
  if (selected) {
    const funnelSteps = [
      { label: "Sent", value: selected.sent },
      { label: "Opened", value: selected.opened },
      { label: "Clicked", value: selected.clicked },
      { label: "Converted", value: selected.converted },
    ];
    const maxFunnel = Math.max(...funnelSteps.map((s) => s.value), 1);
    const openRate = selected.sent > 0 ? ((selected.opened / selected.sent) * 100).toFixed(1) : "0";
    const clickRate = selected.opened > 0 ? ((selected.clicked / selected.opened) * 100).toFixed(1) : "0";
    const convRate = selected.clicked > 0 ? ((selected.converted / selected.clicked) * 100).toFixed(1) : "0";
    const spendPct = selected.budget > 0 ? Math.round((selected.spent / selected.budget) * 100) : 0;

    return (
      <div className="p-6">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-amber-700 hover:underline mb-4"><ArrowLeft className="w-3.5 h-3.5" />Back to Campaigns</button>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{selected.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[selected.status] || "bg-slate-100"}`}>{selected.status}</span>
              <span className="text-xs text-slate-500">{selected.channel}</span>
              {selected.destination && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{selected.destination}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.status === "Active" && <button onClick={() => setConfirmAction({ id: selected.id, action: "pause" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50"><Pause className="w-3 h-3" />Pause</button>}
            {selected.status === "Paused" && <button onClick={() => setConfirmAction({ id: selected.id, action: "resume" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50"><Play className="w-3 h-3" />Resume</button>}
            {(selected.status === "Draft" || selected.status === "Activated") && <button onClick={() => setConfirmAction({ id: selected.id, action: "launch" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700"><Rocket className="w-3 h-3" />Launch</button>}
            {(selected.status === "Active" || selected.status === "Paused") && <button onClick={() => setConfirmAction({ id: selected.id, action: "complete" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50"><CheckCircle className="w-3 h-3" />Complete</button>}
            {selected.status !== "Completed" && selected.status !== "Cancelled" && <button onClick={() => setConfirmAction({ id: selected.id, action: "cancel" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"><XCircle className="w-3 h-3" />Cancel</button>}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-6 gap-3 mb-5">
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-slate-900">{selected.audienceSize.toLocaleString()}</div><div className="text-[10px] text-slate-400">Audience</div></div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-emerald-600">{openRate}%</div><div className="text-[10px] text-slate-400">Open Rate</div></div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-blue-600">{clickRate}%</div><div className="text-[10px] text-slate-400">Click Rate</div></div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-purple-600">{convRate}%</div><div className="text-[10px] text-slate-400">Conversion</div></div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-amber-700">${selected.spent.toLocaleString()}</div><div className="text-[10px] text-slate-400">Spent</div></div>
          <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm text-center"><div className="font-mono text-lg font-bold text-slate-700">{spendPct}%</div><div className="text-[10px] text-slate-400">Budget Used</div></div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] gap-4">
          {/* Funnel */}
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Engagement Funnel</h3>
            <div className="space-y-3">
              {funnelSteps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16">{step.label}</span>
                  <div className="flex-1 h-7 bg-slate-100 rounded-lg overflow-hidden relative">
                    <div className="h-full rounded-lg flex items-center px-2" style={{ width: `${Math.max((step.value / maxFunnel) * 100, 2)}%`, backgroundColor: FUNNEL_COLORS[i] }}>
                      {step.value > 0 && <span className="text-[10px] font-bold text-white">{step.value.toLocaleString()}</span>}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-600 w-14 text-right">{step.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Insights */}
          <div className="bg-amber-50 rounded-xl p-5 border border-amber-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-500" />AI Campaign Insights</h3>
            {insightLoading ? <div className="space-y-2"><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[90%]" /><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[75%]" /><div className="h-3 bg-amber-200/50 rounded animate-pulse w-[80%]" /></div> : <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{aiInsight}</div>}
          </div>
        </div>

        {/* Confirm Dialog */}
        {confirmAction && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
            <div className="bg-white rounded-xl p-6 w-[360px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 mb-2">{confirmAction.action === "cancel" ? "Cancel Campaign?" : `${confirmAction.action.charAt(0).toUpperCase() + confirmAction.action.slice(1)} Campaign?`}</h3>
              <p className="text-sm text-slate-500 mb-5">{confirmAction.action === "cancel" ? "This will permanently cancel the campaign." : `Are you sure you want to ${confirmAction.action} this campaign?`}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Go Back</button>
                <button onClick={() => executeAction(confirmAction.id, confirmAction.action)} className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white ${confirmAction.action === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}>Confirm</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3"><Megaphone className="w-5 h-5 text-amber-600" /><h1 className="text-xl font-bold text-slate-900">Campaigns</h1><span className="text-xs text-slate-400">{campaigns.length} campaigns</span></div>
        <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"><Plus className="w-3.5 h-3.5" />New Campaign</button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Campaign</th>
            <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500">Status</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500">Destination</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500">Channel</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500">Audience</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500">Conversions</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500">Budget</th>
            <th className="text-center px-2 py-3 text-xs font-semibold text-slate-500">Actions</th>
          </tr></thead>
          <tbody>
            {campaigns.map((c) => {
              const spendPct = c.budget > 0 ? Math.round((c.spent / c.budget) * 100) : 0;
              return (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-amber-50/30">
                  <td className="px-4 py-3 cursor-pointer" onClick={() => handleSelect(c)}><div className="font-medium text-slate-800">{c.name}</div><div className="text-[10px] text-slate-400">{c.audience}</div></td>
                  <td className="px-3 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[c.status] || "bg-slate-100"}`}>{c.status}</span></td>
                  <td className="px-3 py-3 text-xs text-slate-600">{c.destination || "—"}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">{c.channel}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-slate-700">{c.audienceSize.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-emerald-600">{c.converted.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono text-xs text-slate-700">${c.budget.toLocaleString()}</div>
                    <div className="mt-1 h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden ml-auto"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(spendPct, 100)}%` }} /></div>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c.id); }}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Delete campaign"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-[440px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Create New Campaign</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Campaign Name</label>
                <input type="text" value={newCampaign.name} onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Summer Nappies Push" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Channel</label>
                  <select value={newCampaign.channel} onChange={(e) => setNewCampaign({ ...newCampaign, channel: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option>Email</option><option>Email + SMS</option><option>App Push</option><option>SMS</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Destination</label>
                  <select value={newCampaign.destination} onChange={(e) => setNewCampaign({ ...newCampaign, destination: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option>Braze</option><option>Hightouch</option><option>Emarsys</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Target Audience</label>
                <input type="text" value={newCampaign.audience} onChange={(e) => setNewCampaign({ ...newCampaign, audience: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. First-time Parents, NSW" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Budget (AUD)</label>
                <input type="number" value={newCampaign.budget} onChange={(e) => setNewCampaign({ ...newCampaign, budget: Number(e.target.value) })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={createCampaign} disabled={!newCampaign.name} className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">Create Campaign</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl p-6 w-[360px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Delete Campaign?</h3>
            <p className="text-sm text-slate-500 mb-5">This will permanently delete the campaign from Snowflake. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={() => deleteCampaign(deleteConfirm)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
