"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Bot } from "lucide-react";
import { PageHeader, Card, Pill, Loading } from "../_components/ui";
import { StageStrip } from "../_components/shared";
import { AgentPanel } from "../_components/agent/AgentPanel";

// ─── Campaign Builder ─────────────────────────────────────────────────────────
//
// CAMPAIGN_BUILDER_AGENT (agent/deploy_od_campaign_agents.sql) designs an
// Officeworks campaign with the tools the app itself uses: it ranks the plays,
// reads the playbook and past results, sizes the audience exactly as the
// Audience builder does, checks consent, timing and stock, and estimates lift
// from measured campaigns. Asked to, it saves a BRIEF with a DRAFT audience; a
// person locks it and launches.

const SAMPLES = [
  "Bunnings shoppers buying trade tools look like they are starting a business. Build an Officeworks campaign for them.",
  "Plan back to school 2027 for Kmart families with school-age kids. When should it start, and what should we offer?",
  "What is the best Officeworks campaign to run over the next six weeks, and why?",
];

export default function BuilderPage() {
  return <Suspense fallback={<Loading what="the Campaign Builder" />}><Builder /></Suspense>;
}

/** ?q= asks a question on arrival: the headline findings' "Ask the agent". */
function Builder() {
  const q = useSearchParams().get("q")?.slice(0, 500) || null;
  return (
    <div className="p-6">
      <PageHeader title="Campaign Builder"
        subtitle="Designs one campaign in full: sized audience, guardrails, offer and expected lift, and saves it as a draft when asked. For a shortlist of options, use Ideas."
        right={<Pill tone="amber"><Bot className="mr-0.5 inline h-3 w-3" />Cortex Agent · Campaign Builder</Pill>} />
      <StageStrip current={1} />
      <Card className="mb-4" title="How it works"
        subtitle="Every figure comes from a tool: the ranked plays, Cortex Analyst over customer signals and campaign results, Cortex Search over the playbook, and the app's own audience sizer, guardrails and lift model. Each number in the answer is checked against what the tools returned.">
        <ol className="grid gap-2 text-[11px] text-slate-600 md:grid-cols-4">
          <li><b className="text-slate-900">1 · Signal.</b> Ranks the plays, then reads the Bunnings and Kmart signals behind the chosen one.</li>
          <li><b className="text-slate-900">2 · Audience.</b> Sizes the spec: group data consent, no sure things, no cold contacts, no empty shelves.</li>
          <li><b className="text-slate-900">3 · Guardrails.</b> Timing against the school calendar, stock, overlapping campaigns, offers.</li>
          <li><b className="text-slate-900">4 · Expected lift.</b> From measured campaigns and the uplift model. Saves a draft only when asked.</li>
        </ol>
      </Card>
      <AgentPanel agent="campaignBuilder" tag="campaign" stage="BUILDER" samples={SAMPLES} autoAsk={q}
        placeholder="Describe the campaign: the goal, the product, dates and budget. Say “create the draft” to save it." />
    </div>
  );
}
