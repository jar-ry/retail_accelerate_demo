"use client";

import { useEffect, useState } from "react";
import { Breadcrumb, PageHeader, Card } from "../_components/ui";
import { AgentPanel } from "@/components/agent/AgentPanel";

// ─── Plan Investigator ────────────────────────────────────────────────────────
//
// PLAN_INVESTIGATOR_AGENT (agent/deploy_plan_agents.sql) explains why a node is
// behind or ahead of budget: it pulls the node's evidence pack, tests each
// candidate cause (a class, a month, price vs volume, the budget vs what has
// traded, a planned decline, a late supplier, the buy) and names the root cause
// with what it ruled out. Its actions hand off to the Scenario Builder.
//
// ?node=<name> (a dashboard exception or MFP page) asks about that node on
// arrival; ?q=<question> asks anything. Read from window.location so the page
// needs no Suspense boundary.

const SAMPLES = [
  "Why is PRAMS & STROLLERS behind budget?",
  "Why is CAR SEATS forecast below budget?",
  "What is driving the margin gap in CLOTHING?",
];

export default function PlanInvestigatorPage() {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const node = p.get("node")?.slice(0, 80);
    const q = p.get("q")?.slice(0, 500);
    if (q) setAsk(q);
    else if (node) setAsk(`Why is ${node} ${p.get("ahead") ? "ahead of" : "behind"} budget?`);
  }, []);
  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Plan Investigator" }]} />
      <PageHeader title="Plan Investigator"
        subtitle="Why a department or class is behind or ahead of budget: every candidate cause tested against the plan, open-to-buy and supplier POs, with what was ruled out. Every figure is checked against the tools." />
      <Card title="Investigate a gap"
        subtitle="The agent tests a class or department, month, half, price vs volume, the budget vs what has traded, planned decline, late suppliers, the buy and margin rate. Its actions can be run in the Scenario Builder.">
        <AgentPanel key={ask ?? "investigate"} agent="planInvestigator" tag="rca" stage="PLAN_INVESTIGATE" samples={SAMPLES} autoAsk={ask}
          placeholder="e.g. why is DOUBLE STROLLER behind budget in H1?" />
      </Card>
    </div>
  );
}
