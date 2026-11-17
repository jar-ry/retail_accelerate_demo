// ─── Campaign & CRM: logging an agent run (server only) ─────────────────────
//
// Every campaign agent run lands in AI_RUN, like every AI_COMPLETE call before
// it: the question, what each tool returned (the grounding), the answer and its
// parsed block, and whether every figure in it matched a tool result. The ideas
// board and the investigation panel then read the run from here by id, so what
// they show is what the server saw, not what a browser posted back.

import { S } from "./schema";
import { q, NOW, type Row } from "./db";
import { splitBlock, toolPayload, verifyAnswer, type BlockTag, type ToolResult } from "./agent-answer";

export type AgentStage = "BUILDER" | "IDEATION" | "INVESTIGATE" | "PLAN_INVESTIGATE" | "PLAN_BUILDER" | "HOP_INVESTIGATE" | "BRAND_INVESTIGATE" | "SUPPLY_RECOVERY";
export type AgentStep = { id: string; name: string; toolType: string; input: unknown; status?: string };

const ID = /^[A-Za-z0-9_-]{1,40}$/;

// The planning agents (agent/deploy_plan_agents.sql) are logged here too, so
// every agent answer in the app is verified and recorded the same way.
export function agentStage(agentId: string, requested: unknown): AgentStage | null {
  if (agentId === "campaignInvestigator") return "INVESTIGATE";
  if (agentId === "campaignBuilder") return requested === "IDEATION" ? "IDEATION" : "BUILDER";
  if (agentId === "planInvestigator") return "PLAN_INVESTIGATE";
  if (agentId === "planBuilder") return "PLAN_BUILDER";
  if (agentId === "hopInvestigator") return "HOP_INVESTIGATE";
  if (agentId === "brandInvestigator") return "BRAND_INVESTIGATE";
  if (agentId === "supplyRecovery") return "SUPPLY_RECOVERY";
  return null;
}

export const tagFor = (stage: AgentStage): BlockTag =>
  stage === "INVESTIGATE" || stage === "PLAN_INVESTIGATE" || stage === "HOP_INVESTIGATE" || stage === "BRAND_INVESTIGATE" ? "rca" : stage === "IDEATION" ? "ideas" : stage === "PLAN_BUILDER" ? "scenario" : stage === "SUPPLY_RECOVERY" ? "po_plan" : "campaign";

export async function logAgentRun(o: {
  stage: AgentStage; agentFqn: string; campaignId: unknown; question: string; text: string;
  steps: AgentStep[]; results: ToolResult[]; threadId: number | null; user: string; error: string | null; streamed: boolean;
}): Promise<{ runId: string; verified: boolean | null; unmatched: string[]; hasBlock: boolean }> {
  const runId = `AG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tag = tagFor(o.stage);
  const s = splitBlock(o.text, tag);
  // Without the streamed tool results (the local SQL fallback) there is nothing
  // to check against, which is unknown, not unverified.
  const v = s.block && o.streamed ? verifyAnswer(tag, s.block, s.after, o.results, o.question) : null;
  const cid = typeof o.campaignId === "string" && ID.test(o.campaignId) ? o.campaignId : null;
  const response: Row = {
    text: o.text.slice(0, 60_000), block: s.block, block_error: s.error, thread_id: o.threadId,
    steps: o.steps.map((x) => ({ name: x.name, type: x.toolType, input: x.input, status: x.status ?? null })),
  };
  await q(
    `INSERT INTO ${S}.AI_RUN (RUN_ID, STAGE, CAMPAIGN_ID, TEMPLATE_KEY, MODEL, QUESTION, GROUNDING_PAYLOAD, PROMPT_CHARS, RESPONSE,
       FIGURES_CITED, UNVERIFIED_FIGURES, IS_VERIFIED, ERROR_MESSAGE, GENERATED_BY, GENERATED_AT)
     SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ${NOW}`,
    [runId, o.stage, cid, tag.toUpperCase(), `agent:${o.agentFqn.split(".").pop()}`, o.question.slice(0, 2000),
      JSON.stringify(toolPayload(o.results)).slice(0, 4_000_000), o.question.length, JSON.stringify(response), JSON.stringify([]),
      JSON.stringify(v?.unmatched ?? []), v ? v.verified : null, o.error ?? s.error ?? (s.block ? null : `The answer had no ${tag} block.`), o.user],
  ).catch((e) => console.error("[cmp] AI_RUN agent log failed", e));
  return { runId, verified: v ? v.verified : null, unmatched: v?.unmatched ?? [], hasBlock: !!s.block };
}

/** A logged agent run, for the page that started it. */
export async function readAgentRun(runId: string, stage: AgentStage) {
  if (!/^AG-[a-z0-9-]{1,40}$/.test(runId)) return null;
  const r = await q(`SELECT * FROM ${S}.AI_RUN WHERE RUN_ID = ? AND STAGE = ?`, [runId, stage]);
  return r[0] ?? null;
}
