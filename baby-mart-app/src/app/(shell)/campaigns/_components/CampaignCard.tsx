"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Megaphone } from "lucide-react";
import { Pill, Banner } from "./ui";
import { useCmpAction } from "./useCmp";
import { RunBadge, EvidenceGrid, fmtN, type Evidence, type Guardrail } from "@/components/agent/AgentCards";
import type { RunInfo } from "@/components/agent/useAgentRun";

// ─── The Campaign Builder's answer ────────────────────────────────────────────
//
// The ```campaign block as a proposal card. Saving it is a campaign action (a
// brief and a draft audience, sized again on the server), so the card lives
// here rather than with the shared agent UI.

export type CampaignBlock = {
  name: string; objective: string; hypothesis: string;
  audience?: { description?: string; spec?: unknown; matched?: number | null; final_audience?: number | null };
  channels?: string[]; promoted?: { category?: string | null; brand?: string | null }; offer_id?: string | null;
  start_date?: string; end_date?: string; budget_aud?: number;
  expected?: { incremental_conversions?: number | null; lift_pts_low?: number | null; lift_pts_high?: number | null; basis?: string };
  guardrails?: Guardrail[]; key_evidence?: Evidence[];
  draft?: { campaign_id?: string; audience_id?: string } | null;
};

export function CampaignCard({ c, run }: { c: CampaignBlock; run?: RunInfo }) {
  const e = c.expected ?? {};
  return (
    <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-700"><Megaphone className="h-4 w-4" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Campaign proposal</span>
        <span className="ml-auto flex items-center gap-2">
          <RunBadge run={run} />
          {c.draft?.campaign_id ? <Pill tone="green">draft {c.draft.campaign_id}</Pill> : <Pill tone="slate">not saved</Pill>}
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold leading-snug text-slate-900">{c.name}</h2>
      <p className="mt-1 text-xs text-slate-600">{c.objective}</p>
      <p className="mt-2 text-[11px] italic text-slate-500">{c.hypothesis}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <Fact label="Final audience" value={fmtN(c.audience?.final_audience)} sub={`of ${fmtN(c.audience?.matched)} matching`} />
        <Fact label="Expected incremental conversions" value={fmtN(e.incremental_conversions)}
          sub={e.lift_pts_low !== null && e.lift_pts_low !== undefined ? `comparable lift ${e.lift_pts_low} to ${e.lift_pts_high} pts` : "no comparable campaign"} />
        <Fact label="Channels and offer" value={(c.channels ?? []).join(" + ") || "–"} sub={c.offer_id ?? "no offer"} />
        <Fact label="Window and budget" value={c.budget_aud ? `AUD ${fmtN(c.budget_aud)}` : "–"} sub={c.start_date ? `${c.start_date} → ${c.end_date}` : ""} />
      </div>
      {c.audience?.description && <p className="mt-3 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">Who: </span>{c.audience.description}</p>}
      {e.basis && <p className="mt-1 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">Estimate rests on: </span>{e.basis}</p>}
      <div className="mt-4"><EvidenceGrid items={c.key_evidence} /></div>
      {c.guardrails?.length ? (
        <ul className="mt-3 space-y-1">
          {c.guardrails.map((g, i) => (
            <li key={i} className={`flex gap-1.5 text-[11px] ${g.level === "BLOCK" ? "text-red-700" : "text-amber-800"}`}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span><span className="font-semibold">{g.level.toLowerCase()}</span> {g.message}
                {g.level === "BLOCK" && / is short at /.test(g.message) && c.promoted?.brand ? (
                  // A stock BLOCK has a supply fix: an approved recovery plan lifts the stores from SHORT.
                  <> <Link href={`/replenishment/recovery?q=${encodeURIComponent(`${c.promoted.brand} is short and blocking a campaign. Get it back on shelf.`)}`} className="font-medium underline">Ask Supply to recover stock</Link></>
                ) : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.draft?.campaign_id ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/campaigns/audiences?campaign=${encodeURIComponent(c.draft.campaign_id)}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
            Review and lock the audience <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : <SaveProposal c={c} />}
    </div>
  );
}

/** The proposal's next step: save it as a brief with a draft audience (sized
 *  again on the server) and carry on in the Audience builder. */
function SaveProposal({ c }: { c: CampaignBlock }) {
  const router = useRouter();
  const save = useCmpAction<{ campaignId: string; finalAudience: number; startDate: string; endDate: string }>("builder/draft");
  const [err, setErr] = useState<string | null>(null);
  if (!c.audience?.spec) return null;
  const go = async () => {
    setErr(null);
    const r = await save.run({ proposal: c });
    if (!r.ok) return setErr(r.error);
    router.push(`/campaigns/audiences?campaign=${encodeURIComponent(r.data.campaignId)}`);
  };
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={go} disabled={save.busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {save.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Create the draft and build the audience <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-slate-500">Saves a brief and its audience. You lock the audience, approve the copy and launch.</span>
      </div>
      {err && <div className="mt-2"><Banner tone="error">{err}</Banner></div>}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
