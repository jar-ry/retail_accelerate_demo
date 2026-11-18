"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageCheck, RotateCcw, Loader2 } from "lucide-react";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { Pill } from "@/components/ui/kit";
import { RecoveryCard, type RecoveryBlock } from "../_components/RecoveryCard";

// ─── Stockout recovery ────────────────────────────────────────────────────────
//
// SUPPLY_RECOVERY_AGENT (agent/deploy_supply_agents.sql) gets a short brand back
// on shelf: which stores are out and why (the supplier's fill rate and DIFOT),
// which DCs can spare stock, which campaigns it blocks; then the solver costs a
// DC transfer, an emergency PO and both against doing nothing, as a DRAFT plan.
// A supply planner approves one option here. Approval places the PO, books the
// transfer and, when stock lands within a week, lifts the stores from SHORT to
// LOW in the campaign's supply position -- unblocking the campaign.
//
// ?q=<question> asks on arrival (the Alerts page links here). Read from
// window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "Rascal + Friends Crawler Nappies are out of stock in NSW. Get them back on shelf.",
  "Build a recovery plan for Rascal + Friends with 6 weeks of cover.",
  "Uppababy is running short. What are our options?",
];

type PlanRow = {
  planId: string; brand: string; class: string; dcState: string; status: string; createdAt: string; recommended: string;
  approvedOption?: string | null; approvedBy?: string | null; effect?: { stores_lifted_to_low?: number; po?: string | null; transfer?: string | null } | null;
};

export default function StockoutRecoveryPage() {
  const [ask, setAsk] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [resetting, setResetting] = useState(false);
  const load = useCallback(() => {
    fetch("/api/supply/recovery").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setPlans(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
    load();
  }, [load]);
  const reset = async () => {
    if (!window.confirm("Undo every approved recovery plan? This restores the stock positions, deletes recovery POs and transfers, and puts the campaign's supply position back to SHORT.")) return;
    setResetting(true);
    await fetch("/api/supply/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) }).catch(() => {});
    setResetting(false);
    load();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <PackageCheck className="w-5 h-5 text-emerald-700 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stockout Recovery</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Supply clock 11 June 2026. Get a short brand back on shelf: the agent finds the cause and costs a DC transfer, an
            emergency PO or both as a draft plan. You approve one; that places the order and unblocks the campaign.
          </p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Build a recovery plan</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Name a brand, and a class and state if you know them. Every figure is checked against the tools. The agent writes a
          draft and never approves.
        </p>
        <AgentPanel key={ask ?? "recovery"} agent="supplyRecovery" tag="po_plan" stage="SUPPLY_RECOVERY" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. Rascal + Friends is short in NSW: get it back"
          card={(b, t) => <RecoveryCard p={b as RecoveryBlock} run={t.run} onApproved={load} />} onFinished={load} />
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Recent recovery plans</h3>
          <button onClick={reset} disabled={resetting} title="Undo every approval (for rehearsals)"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-60">
            {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset demo
          </button>
        </div>
        {plans.length === 0 ? <p className="text-xs text-slate-400">No plans yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-100 text-slate-500">
              <th className="text-left py-1.5">Plan</th><th className="text-left py-1.5">Brand · class · DC</th><th className="text-left py-1.5">Status</th>
              <th className="text-left py-1.5">Option</th><th className="text-left py-1.5">Effect</th>
            </tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.planId} className="border-b border-slate-50">
                  <td className="py-2 font-mono">{p.planId}</td>
                  <td className="py-2">{p.brand} · {p.class} · {p.dcState}</td>
                  <td className="py-2"><Pill tone={p.status === "APPROVED" ? "green" : p.status === "DRAFT" ? "amber" : "slate"}>{p.status.toLowerCase()}</Pill></td>
                  <td className="py-2">{p.approvedOption ? `${p.approvedOption} (by ${p.approvedBy})` : `recommended ${p.recommended}`}</td>
                  <td className="py-2 text-slate-600">{p.status === "APPROVED" && p.effect
                    ? [p.effect.transfer, p.effect.po, p.effect.stores_lifted_to_low ? `${p.effect.stores_lifted_to_low} stores SHORT to LOW` : null].filter(Boolean).join(" · ")
                    : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
