"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import { Pill, Banner } from "../_components/ui";
import { RunBadge, EvidenceGrid, type Evidence, type Guardrail } from "@/components/agent/AgentCards";
import type { RunInfo } from "@/components/agent/useAgentRun";

// ─── The Sandbox builder's answer ─────────────────────────────────────────────
//
// The ```sandbox block: three options costed against the live store plan, with
// guardrails and the tool's recommendation. The agent only writes the DRAFT
// proposal; a planner opens one option here (POST /api/hop-sandbox), which
// creates a store plan sandbox -- a copy of the live drivers with the option's
// edits -- to review on Store plan and submit as any other. Nothing reaches
// the live plan.

export type SandboxOption = {
  option_id: string; label: string; stores_touched?: number; plan_sales_aud?: number; sales_delta_aud?: number; margin_delta_aud?: number;
  company_lfl_pct?: number; scope_lfl_pct?: number; vs_approved_aud?: number; hardgoods_gap_aud?: number; guardrails?: Guardrail[];
};
export type SandboxBlock = {
  goal: string; proposal_id: string; scope?: string; lever?: string; position?: string; key_evidence?: Evidence[];
  live?: { plan_sales_aud?: number; company_lfl_pct?: number; scope_lfl_pct?: number };
  options?: SandboxOption[]; recommended?: string; rationale?: string;
};
type ProposalStatus = { proposalId: string; status: string; openedOption?: string | null; openedBy?: string | null; scenarioId?: number | null };

const aud = (v?: number) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
const signed = (v?: number) => (typeof v === "number" ? `${v >= 0 ? "+" : "-"}AUD ${Math.abs(Math.round(v)).toLocaleString("en-AU")}` : "–");
const pctF = (v?: number) => (typeof v === "number" ? `${v.toFixed(2)}%` : "–");
const G_TONE: Record<string, string> = { BLOCK: "text-red-700", CAUTION: "text-amber-800", INFO: "text-slate-500" };
const LEVER: Record<string, string> = { PEER_RATE: "close gaps to peer rate", LFL_TARGET: "like-for-like target", MARGIN_SHIFT: "margin shift" };

export function SandboxCard({ b, run, onOpened }: { b: SandboxBlock; run?: RunInfo; onOpened?: () => void }) {
  const [p, setP] = useState<ProposalStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!b.proposal_id) return;
    const r = await fetch(`/api/hop-sandbox?proposal=${encodeURIComponent(b.proposal_id)}`);
    if (r.ok) setP(await r.json());
  }, [b.proposal_id]);
  useEffect(() => { load(); }, [load]);
  const status = p?.status ?? "DRAFT";

  const open = async (optionId: string) => {
    setErr(null); setBusy(optionId);
    try {
      const r = await fetch("/api/hop-sandbox", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", proposalId: b.proposal_id, optionId }) });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "Could not open the sandbox");
      await load();
      onOpened?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-teal-300 bg-gradient-to-br from-teal-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-100 text-teal-700"><FlaskConical className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">Sandbox proposal</span>
        {b.lever && <Pill tone="slate">{LEVER[b.lever] ?? b.lever.toLowerCase()}</Pill>}
        <span className="ml-auto flex items-center gap-2">
          <RunBadge run={run} />
          <Pill tone={status === "OPENED" ? "green" : status === "DRAFT" ? "amber" : "slate"}>{status.toLowerCase()} {b.proposal_id}</Pill>
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{b.goal}</h2>
      <p className="mt-1 text-xs text-slate-600">{b.scope} · FY27 H1 store plan (Jul-Dec 2026)</p>
      {b.position && <p className="mt-2 text-xs text-slate-700">{b.position}</p>}
      <div className="mt-4"><EvidenceGrid items={b.key_evidence} /></div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold">Option</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Stores</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Sales</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Margin</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Company LFL</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Scope LFL</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Hardgoods gap</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Guardrails</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.live && (
              <tr className="border-t border-slate-100 align-top text-slate-500">
                <td className="px-2.5 py-1.5 italic">Live plan ({aud(b.live.plan_sales_aud)})</td>
                <td /><td className="px-2.5 py-1.5 text-right font-mono">–</td><td className="px-2.5 py-1.5 text-right font-mono">–</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{pctF(b.live.company_lfl_pct)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{pctF(b.live.scope_lfl_pct)}</td>
                <td colSpan={3} />
              </tr>
            )}
            {(b.options ?? []).map((o) => {
              const rec = o.option_id === b.recommended;
              const opened = status === "OPENED" && p?.openedOption === o.option_id;
              return (
                <tr key={o.option_id} className={`border-t border-slate-100 align-top ${opened ? "bg-teal-50" : rec ? "bg-teal-50/50" : ""}`}>
                  <td className="px-2.5 py-1.5"><div className="font-medium text-slate-900">{o.option_id}. {o.label}{rec ? <> <Pill tone="teal">recommended</Pill></> : null}</div></td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{o.stores_touched ?? "–"}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{signed(o.sales_delta_aud)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{signed(o.margin_delta_aud)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{pctF(o.company_lfl_pct)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{pctF(o.scope_lfl_pct)}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono">{aud(o.hardgoods_gap_aud)}</td>
                  <td className="px-2.5 py-1.5">
                    <ul className="space-y-0.5">{(o.guardrails ?? []).map((g, k) => <li key={k} className={G_TONE[g.level] ?? "text-slate-600"}><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}</li>)}</ul>
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    {opened ? (
                      <Link href={`/hop/store-plan?scenario=${p?.scenarioId}`} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-teal-700 hover:underline">
                        Open in Store plan <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : status === "DRAFT" && o.stores_touched ? (
                      <button onClick={() => open(o.option_id)} disabled={!!busy}
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 font-medium disabled:opacity-60 ${rec ? "bg-teal-700 text-white hover:bg-teal-800" : "border border-teal-300 text-teal-700 hover:bg-teal-50"}`}>
                        {busy === o.option_id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Open as sandbox
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {b.rationale && <p className="mt-3 text-xs text-slate-700"><span className="font-semibold text-slate-900">Why: </span>{b.rationale}</p>}
      {err && <div className="mt-3"><Banner tone="error">{err}</Banner></div>}
      {status === "OPENED" ? (
        <div className="mt-3"><Banner tone="ok">
          Opened option {p?.openedOption} as a sandbox for {p?.openedBy}. Review it on Store plan, then submit it for review: nothing reaches the live plan until then.
        </Banner></div>
      ) : status === "SUPERSEDED" ? (
        <div className="mt-3"><Banner tone="warn">A newer proposal replaced this draft; open from the newest one.</Banner></div>
      ) : (
        <p className="mt-3 text-[10px] text-slate-500">A draft. Opening an option creates a sandbox, a copy of the live plan; the live plan never changes here.</p>
      )}
    </div>
  );
}
