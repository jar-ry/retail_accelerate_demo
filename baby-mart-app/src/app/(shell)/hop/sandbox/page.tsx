"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Pill } from "../_components/ui";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { PERIOD_DUAL } from "@/lib/hop/config";
import { SandboxCard, type SandboxBlock } from "./SandboxCard";

// ─── Sandbox builder ──────────────────────────────────────────────────────────
//
// HOP_SANDBOX_AGENT (agent/deploy_hop_agents.sql) turns a store plan what-if --
// lift stores to their peer rate, reach a like-for-like %, move margin -- into
// three options costed against the live plan, with guardrails, as a DRAFT
// proposal. A planner opens one here as a sandbox (a copy of the live drivers
// with the option's edits), reviews it on Store plan and submits it for review.
// Nothing reaches the live plan.
//
// ?q=<question> asks on arrival (the Planning Investigator's actions link here).
// Read from window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "What if the QLD Metro Standard stores planned at their peer rate?",
  "Build a sandbox that takes the company to +5% like-for-like.",
  "What does another point of margin at Gold Coast do to the plan?",
];

type ProposalRow = {
  proposalId: string; scope: string; lever: string; value: number | null; status: string; recommended: string;
  openedOption?: string | null; openedBy?: string | null; scenarioId?: number | null;
};

export default function SandboxBuilderPage() {
  const [ask, setAsk] = useState<string | null>(null);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const load = useCallback(() => {
    fetch("/api/hop-sandbox").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setRows(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
    load();
  }, [load]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Sandbox builder"
        subtitle={<>{PERIOD_DUAL} · turn a what-if into costed options on the store plan. Every option is costed in the store plan&apos;s own maths against the live plan; you open one as a sandbox, and nothing reaches the live plan until it is submitted and reviewed.</>} />
      <Card title="Build a sandbox"
        subtitle="Name a scope (a state, region, format, store, or a combination such as QLD Metro Standard) and what to try: close the gap to the peer rate, reach a like-for-like %, or move margin. Every figure is checked against the tools. The agent writes a draft and never opens or edits a sandbox.">
        <AgentPanel key={ask ?? "sandbox"} agent="hopSandbox" tag="sandbox" stage="HOP_SANDBOX" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. What if Regional stores planned at the Metro rate?"
          card={(b, t) => <SandboxCard b={b as SandboxBlock} run={t.run} onOpened={load} />} onFinished={load} />
      </Card>
      <Card title="Recent proposals">
        {rows.length === 0 ? <p className="text-xs text-slate-400">No proposals yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-100 text-slate-500">
              <th className="text-left py-1.5">Proposal</th><th className="text-left py-1.5">Scope</th><th className="text-left py-1.5">Lever</th>
              <th className="text-left py-1.5">Status</th><th className="text-left py-1.5">Sandbox</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.proposalId} className="border-b border-slate-50">
                  <td className="py-2 font-mono">{r.proposalId}</td>
                  <td className="py-2">{r.scope}</td>
                  <td className="py-2">{r.lever.toLowerCase().replace(/_/g, " ")}{r.value !== null ? ` ${r.value}` : ""}</td>
                  <td className="py-2"><Pill tone={r.status === "OPENED" ? "green" : r.status === "DRAFT" ? "amber" : "slate"}>{r.status.toLowerCase()}</Pill></td>
                  <td className="py-2">{r.scenarioId ? <Link href={`/hop/store-plan?scenario=${r.scenarioId}`} className="text-teal-700 hover:underline">option {r.openedOption}, by {r.openedBy}</Link> : `recommended ${r.recommended}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
