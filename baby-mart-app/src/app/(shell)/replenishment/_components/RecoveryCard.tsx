"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, PackageCheck, ArrowRight } from "lucide-react";
import { Pill, Banner } from "../../campaigns/_components/ui";
import { RunBadge, EvidenceGrid, type Evidence, type Guardrail } from "../../campaigns/_components/agent/AgentCards";
import type { RunInfo } from "../../campaigns/_components/agent/useAgentRun";

// ─── The Stockout Recovery agent's answer ─────────────────────────────────────
//
// The ```po_plan block: each costed option against doing nothing, its
// guardrails, and an Approve button. The agent only writes the DRAFT; approving
// here (POST /api/supply/recovery) places the PO, books the transfer and, when
// stock lands within a week, lifts the stores from SHORT to LOW in the
// campaign's supply position. The card reads the plan's live status, so a plan
// approved elsewhere (or superseded by a newer draft) shows as such.

export type RecoveryOption = {
  option_id: string; label: string; transfer_units?: number; po_units?: number; first_stock_date?: string; stockout_days?: number;
  lost_sales_aud?: number; transfer_cost_aud?: number; stock_value_aud?: number; cover_after_weeks?: number; lifts_shortage?: boolean;
  guardrails?: Guardrail[];
};
export type RecoveryBlock = {
  goal: string; plan_id: string; brand?: string; class?: string; dc_state?: string; situation?: string; key_evidence?: Evidence[];
  do_nothing?: { first_stock_date?: string; stockout_days?: number; lost_sales_aud?: number };
  options?: RecoveryOption[]; recommended?: string; rationale?: string; campaign_effect?: string;
};
export type PlanStatus = {
  planId: string; status: string; approvedOption?: string | null; approvedBy?: string | null;
  effect?: { po?: string | null; transfer?: string | null; stores_lifted_to_low?: number; lifts_shortage?: boolean; first_stock_date?: string } | null;
  options?: { optionId: string; feasible: boolean }[];
};

const aud = (v?: number) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
const G_TONE: Record<string, string> = { BLOCK: "text-red-700", CAUTION: "text-amber-800", INFO: "text-slate-500" };

export function usePlanStatus(planId?: string) {
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const load = useCallback(async () => {
    if (!planId) return;
    const r = await fetch(`/api/supply/recovery?plan=${encodeURIComponent(planId)}`);
    if (r.ok) setPlan(await r.json());
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  return { plan, reload: load };
}

export function RecoveryCard({ p, run, onApproved }: { p: RecoveryBlock; run?: RunInfo; onApproved?: () => void }) {
  const { plan, reload } = usePlanStatus(p.plan_id);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opts = p.options ?? [];
  const status = plan?.status ?? "DRAFT";
  const feasible = (id: string) => plan?.options?.find((o) => o.optionId === id)?.feasible ?? true;

  const approve = async (optionId: string) => {
    setErr(null); setBusy(optionId);
    try {
      const r = await fetch("/api/supply/recovery", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", planId: p.plan_id, optionId }) });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "Approval failed");
      await reload();
      onApproved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><PackageCheck className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Recovery plan</span>
        <span className="ml-auto flex items-center gap-2">
          <RunBadge run={run} />
          <Pill tone={status === "APPROVED" ? "green" : status === "DRAFT" ? "amber" : "slate"}>{status.toLowerCase()} {p.plan_id}</Pill>
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{p.goal}</h2>
      <p className="mt-1 text-xs text-slate-600">{[p.brand, p.class, p.dc_state ? `${p.dc_state} DC region` : null].filter(Boolean).join(" · ")}</p>
      {p.situation && <p className="mt-2 text-xs text-slate-700">{p.situation}</p>}
      <div className="mt-4"><EvidenceGrid items={p.key_evidence} /></div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold">Option</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">First stock</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Days out</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Lost sales</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Transfer cost</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">PO stock value</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Cover after</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Guardrails</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.do_nothing && (
              <tr className="border-t border-slate-100 align-top text-slate-500">
                <td className="px-2.5 py-1.5 italic">Do nothing</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{p.do_nothing.first_stock_date ?? "–"}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{p.do_nothing.stockout_days ?? "–"}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(p.do_nothing.lost_sales_aud)}</td>
                <td colSpan={5} />
              </tr>
            )}
            {opts.map((o) => {
              const rec = o.option_id === p.recommended;
              const approved = status === "APPROVED" && plan?.approvedOption === o.option_id;
              const canApprove = status === "DRAFT" && feasible(o.option_id);
              return (
                <tr key={o.option_id} className={`border-t border-slate-100 align-top ${approved ? "bg-emerald-50" : rec ? "bg-emerald-50/50" : ""}`}>
                  <td className="px-2.5 py-1.5">
                    <div className="font-medium text-slate-900">{o.option_id}. {o.label}{rec ? <> <Pill tone="green">recommended</Pill></> : null}</div>
                    <div className="text-[10px] text-slate-500">{o.lifts_shortage ? "Lifts the campaign's stock block" : "Stores stay short until stock lands"}</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{o.first_stock_date ?? "–"}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{o.stockout_days ?? "–"}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{aud(o.lost_sales_aud)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{aud(o.transfer_cost_aud)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{aud(o.stock_value_aud)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{typeof o.cover_after_weeks === "number" ? `${o.cover_after_weeks} wks` : "–"}</td>
                  <td className="px-2.5 py-1.5">
                    <ul className="space-y-0.5">{(o.guardrails ?? []).map((g, k) => <li key={k} className={G_TONE[g.level] ?? "text-slate-600"}><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}</li>)}</ul>
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    {approved ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Approved</span>
                    ) : canApprove ? (
                      <button onClick={() => approve(o.option_id)} disabled={!!busy}
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 font-medium disabled:opacity-60 ${rec ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}>
                        {busy === o.option_id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Approve
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p.rationale && <p className="mt-3 text-xs text-slate-700"><span className="font-semibold text-slate-900">Why: </span>{p.rationale}</p>}
      {p.campaign_effect && <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-900">Campaign: </span>{p.campaign_effect}</p>}
      {err && <div className="mt-3"><Banner tone="error">{err}</Banner></div>}
      {status === "APPROVED" && plan?.effect ? (
        <div className="mt-3"><Banner tone="ok">
          Approved by {plan.approvedBy}.{plan.effect.transfer ? ` Transfer ${plan.effect.transfer} booked.` : ""}{plan.effect.po ? ` ${plan.effect.po} placed.` : ""}
          {plan.effect.lifts_shortage ? ` ${plan.effect.stores_lifted_to_low ?? 0} stores moved from SHORT to LOW: the campaign's stock suppression is lifted.` : " The stores stay SHORT until stock lands."}
          {" "}<Link href="/campaigns/performance" className="font-medium underline">See the campaign <ArrowRight className="inline h-3 w-3" /></Link>
        </Banner></div>
      ) : status === "SUPERSEDED" ? (
        <div className="mt-3"><Banner tone="warn">A newer plan replaced this draft; approve from the newest one.</Banner></div>
      ) : (
        <p className="mt-3 text-[10px] text-slate-500">A draft. Nothing is ordered or moved until a supply planner approves one option.</p>
      )}
    </div>
  );
}
