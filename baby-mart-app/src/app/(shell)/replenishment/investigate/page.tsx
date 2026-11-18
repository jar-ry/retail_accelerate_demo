"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { AgentPanel } from "@/components/agent/AgentPanel";

// ─── Supplier DIFOT investigator ──────────────────────────────────────────────
//
// SUPPLIER_DIFOT_AGENT (agent/deploy_supply_agents.sql) explains a supplier's
// DIFOT miss from the PO lines and the weekly scorecard, and says whose problem
// it is: the supplier's, or Baby Mart's own ordering (orders sized on a planner
// override, late rush orders). When the misses are emptying shelves it hands off
// to the Stockout Recovery builder. Read only: it recommends.
//
// ?q=<question> asks on arrival (the DIFOT pages link here). Read from
// window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "Why is Kimberly-Clark missing DIFOT on Huggies Crawler Nappies?",
  "Why has Rascal & Co's DIFOT dropped since April?",
  "Which suppliers are below the DIFOT target, and is it them or us?",
];

export default function DifotInvestigatorPage() {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
  }, []);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Bot className="w-5 h-5 text-teal-700 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">DIFOT Investigator</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Supply clock 11 June 2026. Why a supplier is missing delivered-in-full-on-time, and whether it is the supplier or our
            own ordering: deliveries since 6 April against the weeks before, the PO lines and the weekly scorecard.
          </p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Investigate a supplier</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Name a supplier or brand, and a class if you know it, or ask across every supplier. Tests the failing component,
          timing, DCs, classes, lead time, rush orders, overtrading, planner overrides behind the orders and empty shelves.
          Every figure is checked against the tools. It recommends; it changes nothing.
        </p>
        <AgentPanel key={ask ?? "difot"} agent="supplierDifot" tag="rca" stage="SUPPLY_DIFOT" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. Why is Bugaboo Pacific late so often?" />
      </div>
    </div>
  );
}
