"use client";

import { useCallback, useEffect, useState } from "react";
import { Handshake } from "lucide-react";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { Pill } from "@/components/ui/kit";
import { BriefCard, type BriefBlock } from "./BriefCard";

// ─── Negotiation brief ────────────────────────────────────────────────────────
//
// NEGOTIATION_BRIEF_AGENT (agent/deploy_brand_agents.sql) prepares a supplier
// meeting: it sizes a margin ask, promo co-funding and a DIFOT credit on the
// supplier's own misses (with opening, target and walk-away), offers gives
// (waiving DIFOT misses that were Baby Mart's ordering), and lists levers and
// guardrails, as a DRAFT brief. A category manager approves it here.
//
// ?q=<question> asks on arrival (the battlecards link here). Read from
// window.location so the page needs no Suspense boundary.

const SAMPLES = [
  "Build a negotiation brief for our Huggies meeting with Kimberly-Clark.",
  "We meet Rascal + Friends next week. Build a firm brief.",
  "Prepare a balanced brief for the Bugaboo terms review.",
];

type BriefRow = {
  briefId: string; brand: string; supplier: string; stance: string; status: string; createdAt: string;
  openingAud: number | null; targetAud: number | null; walkawayAud: number | null; approvedBy?: string | null;
};
const aud = (v: number | null) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");

export default function NegotiationBriefPage() {
  const [ask, setAsk] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const load = useCallback(() => {
    fetch("/api/negotiation").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setBriefs(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.slice(0, 500);
    if (q) setAsk(q);
    load();
  }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Handshake className="w-5 h-5 text-blue-700 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Negotiation Brief</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Prepare a supplier meeting: every ask is sized from FY2026 sales, margin against the category, promotional discount
            and the supplier&apos;s DIFOT, with where to open, what to settle for and when to walk away. You approve the draft.
          </p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Build a brief</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Name a brand, and a stance (collaborative, balanced or firm) if you want one. DIFOT misses that were our own ordering
          are offered back as a give, never claimed. Every figure is checked against the tools. The agent writes a draft and
          never approves.
        </p>
        <AgentPanel key={ask ?? "brief"} agent="negotiationBrief" tag="brief" stage="CATEGORY_BRIEF" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. Build a brief for the Pampers meeting"
          card={(b, t) => <BriefCard b={b as BriefBlock} run={t.run} onApproved={load} />} onFinished={load} />
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Recent briefs</h3>
        {briefs.length === 0 ? <p className="text-xs text-slate-400">No briefs yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-100 text-slate-500">
              <th className="text-left py-1.5">Brief</th><th className="text-left py-1.5">Brand · supplier</th><th className="text-left py-1.5">Stance</th>
              <th className="text-left py-1.5">Status</th><th className="text-right py-1.5">Opening</th><th className="text-right py-1.5">Target</th><th className="text-right py-1.5">Walk-away</th>
            </tr></thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.briefId} className="border-b border-slate-50">
                  <td className="py-2 font-mono">{b.briefId}</td>
                  <td className="py-2">{b.brand} · {b.supplier}</td>
                  <td className="py-2">{b.stance?.toLowerCase()}</td>
                  <td className="py-2"><Pill tone={b.status === "APPROVED" ? "green" : b.status === "DRAFT" ? "amber" : "slate"}>{b.status.toLowerCase()}</Pill>{b.approvedBy ? <span className="ml-1 text-slate-500">by {b.approvedBy}</span> : null}</td>
                  <td className="py-2 text-right font-mono">{aud(b.openingAud)}</td>
                  <td className="py-2 text-right font-mono">{aud(b.targetAud)}</td>
                  <td className="py-2 text-right font-mono">{aud(b.walkawayAud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
