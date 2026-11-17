"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "../_components/ui";
import { AgentPanel } from "../../campaigns/_components/agent/AgentPanel";
import { PERIOD_DUAL } from "@/lib/hop/config";

// ─── Planning Investigator ────────────────────────────────────────────────────
//
// HOP_INVESTIGATOR_AGENT (agent/deploy_hop_agents.sql) answers the two questions
// a Head of Planning asks of the plan before it goes to the board:
//   - why does a state, region, format or store plan weaker like-for-like? It
//     splits the gap into store MIX (which stores it has) and RATE (how they are
//     planned), then tests regions, stores, explained moves and post-lock edits;
//   - why is the bottom-up MFP short of the store plan's mix target, and who
//     moves? It splits the gap into the range and the top-down target, finds the
//     department and names the owning party from the ownership registry.
// It recommends and writes nothing; edits go through the Store plan and MFP pages.
//
// ?q=<question> asks on arrival (the overview, store plan and MFP links). Read
// from window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "Why does QLD plan weaker like-for-like than the rest of the business?",
  "Why is the bottom-up MFP short of the store plan, and who has to move?",
  "Which VIC stores plan the weakest like-for-like, and why?",
];

export default function HopInvestigatePage() {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
  }, []);
  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Planning Investigator"
        subtitle={<>{PERIOD_DUAL} · why the plan looks the way it does, and who has to move. Every candidate cause is tested against the store plan, the MFP and the ownership registry; every figure is checked against the tools.</>} />
      <Card title="Investigate the plan"
        subtitle="Store plan like-for-like by state, region, format or store (store mix versus planned rate, explained moves, new-store cannibalisation, post-lock edits), or the planning chain from store plan to RBU mix to MFP departments. It recommends; it never edits the plan.">
        <AgentPanel key={ask ?? "hop"} agent="hopInvestigator" tag="rca" stage="HOP_INVESTIGATE" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. why is Regional like-for-like weaker than Metro?" />
      </Card>
    </div>
  );
}
