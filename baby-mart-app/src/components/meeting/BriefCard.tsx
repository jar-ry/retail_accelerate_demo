"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Handshake } from "lucide-react";
import { Pill, Banner } from "@/components/ui/kit";
import { RunBadge, EvidenceGrid, type Evidence, type Guardrail } from "@/components/agent/AgentCards";
import type { RunInfo } from "@/components/agent/useAgentRun";

// ─── The Negotiation Brief agent's answer ──────────────────────────────────────
//
// The ```brief block: each sized ask (and give) with its opening, target and
// walk-away, the tool's totals, the levers and guardrails, and how to play the
// meeting. The agent only writes the DRAFT; a category manager approves it here,
// in step 2 of the Supplier Meeting page, or in step 3 (POST /api/negotiation). The card reads the brief's live status, so a brief
// approved elsewhere (or superseded by a newer draft) shows as such.

export type BriefAsk = {
  ask_id: string; kind: string; direction: "ASK" | "GIVE"; label: string; basis?: string;
  opening_aud?: number; target_aud?: number; walkaway_aud?: number; guardrails?: Guardrail[];
};
export type BriefBlock = {
  goal: string; brief_id: string; brand?: string; supplier?: string; category?: string; stance?: string; position?: string; sop?: string;
  key_evidence?: Evidence[]; asks?: BriefAsk[]; levers?: { kind: string; label: string; basis?: string }[];
  totals?: { opening_aud?: number; target_aud?: number; walkaway_aud?: number; gives_aud?: number };
  guardrails?: Guardrail[]; play?: string[];
};
type BriefStatus = { briefId: string; status: string; approvedBy?: string | null };

const aud = (v?: number) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
const G_TONE: Record<string, string> = { BLOCK: "text-red-700", CAUTION: "text-amber-800", INFO: "text-slate-500" };

export function BriefCard({ b, run, onApproved }: { b: BriefBlock; run?: RunInfo; onApproved?: () => void }) {
  const [brief, setBrief] = useState<BriefStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!b.brief_id) return;
    const r = await fetch(`/api/negotiation?brief=${encodeURIComponent(b.brief_id)}`);
    if (r.ok) setBrief(await r.json());
  }, [b.brief_id]);
  useEffect(() => { load(); }, [load]);
  const status = brief?.status ?? "DRAFT";

  const approve = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await fetch("/api/negotiation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", briefId: b.brief_id }) });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "Approval failed");
      await load();
      onApproved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-blue-300 bg-gradient-to-br from-blue-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-blue-700"><Handshake className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">Negotiation brief</span>
        {b.stance && <Pill tone="slate">{b.stance.toLowerCase()}</Pill>}
        <span className="ml-auto flex items-center gap-2">
          <RunBadge run={run} />
          <Pill tone={status === "APPROVED" ? "green" : status === "DRAFT" ? "amber" : "slate"}>{status.toLowerCase()} {b.brief_id}</Pill>
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{b.goal}</h2>
      <p className="mt-1 text-xs text-slate-600">{[b.brand, b.supplier, b.category].filter(Boolean).join(" · ")}</p>
      {b.sop && <p className="mt-0.5 text-[10px] text-violet-700">Written to your SOP: {b.sop}. Sized by your negotiation rules.</p>}
      {b.position && <p className="mt-2 text-xs text-slate-700">{b.position}</p>}
      <div className="mt-4"><EvidenceGrid items={b.key_evidence} /></div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold">Ask</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Opening</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Target</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Walk-away</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">Guardrails</th>
            </tr>
          </thead>
          <tbody>
            {(b.asks ?? []).map((a) => (
              <tr key={a.ask_id} className={`border-t border-slate-100 align-top ${a.direction === "GIVE" ? "bg-amber-50/40" : ""}`}>
                <td className="px-2.5 py-1.5">
                  <div className="font-medium text-slate-900">{a.ask_id}. {a.label} {a.direction === "GIVE" ? <Pill tone="amber">give</Pill> : null}</div>
                  {a.basis && <div className="text-[10px] text-slate-500">{a.basis}</div>}
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(a.opening_aud)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(a.target_aud)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(a.walkaway_aud)}</td>
                <td className="px-2.5 py-1.5">
                  <ul className="space-y-0.5">{(a.guardrails ?? []).map((g, k) => <li key={k} className={G_TONE[g.level] ?? "text-slate-600"}><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}</li>)}</ul>
                </td>
              </tr>
            ))}
            {b.totals && (
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-2.5 py-1.5">Net, a year of terms{typeof b.totals.gives_aud === "number" && b.totals.gives_aud > 0 ? ` (after ${aud(b.totals.gives_aud)} of gives)` : ""}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(b.totals.opening_aud)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(b.totals.target_aud)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{aud(b.totals.walkaway_aud)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {!!b.levers?.length && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Levers</div>
            <ul className="space-y-1">{b.levers.map((l, i) => <li key={i} className="text-[11px] text-slate-700"><span className="font-semibold">{l.label}:</span> {l.basis}</li>)}</ul>
          </div>
        )}
        {!!b.play?.length && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">How to play it</div>
            <ol className="list-decimal space-y-1 pl-4">{b.play.map((p, i) => <li key={i} className="text-[11px] text-slate-700">{p}</li>)}</ol>
          </div>
        )}
      </div>
      {!!b.guardrails?.length && (
        <ul className="mt-3 space-y-0.5 text-[11px]">{b.guardrails.map((g, k) => <li key={k} className={G_TONE[g.level] ?? "text-slate-600"}><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}</li>)}</ul>
      )}
      {err && <div className="mt-3"><Banner tone="error">{err}</Banner></div>}
      <div className="mt-4 flex items-center gap-3">
        {status === "APPROVED" ? (
          <Banner tone="ok"><CheckCircle2 className="inline h-3.5 w-3.5" /> Approved for the meeting by {brief?.approvedBy}.</Banner>
        ) : status === "SUPERSEDED" ? (
          <Banner tone="warn">A newer brief replaced this draft; approve from the newest one.</Banner>
        ) : (
          <>
            <button onClick={approve} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Approve for the meeting
            </button>
            <span className="text-[10px] text-slate-500">A draft. Nothing is agreed or sent until a category manager approves it.</span>
          </>
        )}
      </div>
    </div>
  );
}
