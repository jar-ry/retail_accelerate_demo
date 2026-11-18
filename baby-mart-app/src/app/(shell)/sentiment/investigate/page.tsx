"use client";

import { useEffect, useState } from "react";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { StepHeader, StepLink } from "../_components/ui";
import { Radar } from "lucide-react";

// ─── 4 · Explain: the NPS investigator ───────────────────────────────────────
//
// NPS_INVESTIGATOR_AGENT (agent/deploy_sentiment_agents.sql) sizes an NPS move,
// finds where it is (state, store, category, member tier -- an exact split of
// the change), reads what customers say more of, and tests each operational
// cause against the data: stores short of a brand, a campaign promoting what
// they cannot sell, the supplier behind it, DC inbound, competitor prices, the
// website, product quality. Every figure in its answer is checked against the
// tool results. A confirmed stockout hands off to Stockout Recovery.
//
// ?q=<question> asks on arrival (Pulse, the map and Store 360 link here).

const SAMPLES = [
  "Why did NSW NPS fall in late April?",
  "What has driven the national NPS decline since February?",
  "WA customers are complaining about delivery. Is it a real operational problem?",
];

export default function NpsInvestigatorPage() {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
  }, []);

  return (
    <div className="p-6 space-y-5">
      <StepHeader step="4 · Explain" title="NPS investigator"
        subtitle="Why NPS moved, proven against the operations data. Voice to 7 May 2026: the window is the three weeks to it unless the question gives one, against the eight weeks before."
        right={<StepLink href="/sentiment/risk"><Radar className="w-3.5 h-3.5" /> Will it happen again? Risk radar</StepLink>} />
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Investigate an NPS move</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Name a state, a store or all of Baby Mart, and a period if you have one. It splits the change by state, store,
          category and member tier, reads the themes, then tests stock, campaigns, the supplier, delivery, price, the website
          and product quality, and says which it ruled out. Every figure is checked against the tools. It recommends; it changes nothing.
        </p>
        <AgentPanel key={ask ?? "nps"} agent="npsInvestigator" tag="rca" stage="NPS_INVESTIGATE" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. Why did Baby Mart Albury's NPS fall in April?" />
      </div>
    </div>
  );
}
