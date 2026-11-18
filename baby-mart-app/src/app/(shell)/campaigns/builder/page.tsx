"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Bot } from "lucide-react";
import { PageHeader, Card, Pill, Loading } from "../_components/ui";
import { StageStrip } from "../_components/shared";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { CampaignCard, type CampaignBlock } from "../_components/CampaignCard";

// ─── Campaign Builder ─────────────────────────────────────────────────────────
//
// CAMPAIGN_BUILDER_AGENT (agent/deploy_campaign_agents.sql) designs a campaign
// with the tools the app itself uses: it counts the opportunity, quotes what
// customers said, sizes the audience exactly as the Audience builder does,
// checks stock and fatigue, and estimates lift from measured campaigns. Asked
// to, it saves a BRIEF with a DRAFT audience; a person locks it and launches.

const SAMPLES = [
  "Build a campaign to move capsule families to convertible car seats, starting 18 May for four weeks with a $6,000 budget.",
  "Win back lapsed nappy buyers without discounting people who would come back anyway.",
  "We are carrying too much Bugaboo stock. Who should we tell, and is it worth an offer?",
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
        subtitle="Every figure comes from a tool: Cortex Analyst over customers, voice and campaign results, Cortex Search over verbatims, and the app's own audience sizer, guardrails and lift model. Each number in the answer is checked against what the tools returned.">
        <ol className="grid gap-2 text-[11px] text-slate-600 md:grid-cols-4">
          <li><b className="text-slate-900">1 · Signal.</b> Counts the families with the need, and reads what they say.</li>
          <li><b className="text-slate-900">2 · Audience.</b> Sizes the spec, leaving out sure things, price complainers and empty shelves.</li>
          <li><b className="text-slate-900">3 · Guardrails.</b> Stock, brand sentiment, overlapping campaigns, offers.</li>
          <li><b className="text-slate-900">4 · Expected lift.</b> From measured campaigns and the uplift model. Saves a draft only when asked.</li>
        </ol>
      </Card>
      <AgentPanel agent="campaignBuilder" tag="campaign" stage="BUILDER" samples={SAMPLES} autoAsk={q}
        card={(b, t) => <CampaignCard c={b as CampaignBlock} run={t.run} />}
        placeholder="Describe the campaign: the goal, the product, dates and budget. Say “create the draft” to save it." />
    </div>
  );
}
