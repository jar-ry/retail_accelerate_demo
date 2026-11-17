"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { AgentPanel } from "../campaigns/_components/agent/AgentPanel";

// ─── Brand Investigator ───────────────────────────────────────────────────────
//
// BRAND_INVESTIGATOR_AGENT (agent/deploy_brand_agents.sql) answers "what drove
// <brand>'s move?" from POS: the 28 days to 7 May 2026 against last year, the
// prior 28 days and the brand's market. It tests each candidate cause (the
// market, price vs volume, timing, state / region / store, class, SKU, segment,
// promotion, competitor price, supply) and, for a spike, first checks whether the
// spike is in sales at all: the weekly demand view the supply pages read
// multiplies Huggies Crawler Nappies in weeks 15-18, and the tills do not.
// It recommends and changes nothing.
//
// ?q=<question> asks on arrival (the brand page's Investigate links). Read from
// window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "What drove the Huggies Crawler Nappies spike?",
  "Why is Bugaboo down on last year?",
  "What is behind Mountain Buggy's growth?",
];

export default function BrandInvestigatePage() {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
  }, []);
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Bot className="w-5 h-5 text-blue-700 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Brand Investigator</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            What drove a brand&apos;s move, from the tills: the 28 days to 7 May 2026 against last year and its market. Every
            candidate cause is tested, and every figure is checked against the tools.
          </p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Investigate a brand</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Name a brand, or a brand and class. Tests the market, price vs volume, timing, states, regions, stores, classes, SKUs,
          customer segments, promotions, competitor prices and supply, and checks a reported spike against POS before explaining
          it. It recommends; it changes nothing.
        </p>
        <AgentPanel key={ask ?? "brand"} agent="brandInvestigator" tag="rca" stage="BRAND_INVESTIGATE" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. why is Pigeon Bottles down on last year?" />
      </div>
    </div>
  );
}
