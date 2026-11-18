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

export type AgentStage = "BUILDER" | "IDEATION" | "INVESTIGATE" | "PLAN_INVESTIGATE" | "PLAN_BUILDER" | "HOP_INVESTIGATE" | "BRAND_INVESTIGATE" | "SUPPLY_RECOVERY" | "SUPPLY_DIFOT" | "CATEGORY_BRIEF" | "HOP_SANDBOX";
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
  if (agentId === "supplierDifot") return "SUPPLY_DIFOT";
  if (agentId === "negotiationBrief") return "CATEGORY_BRIEF";
  if (agentId === "hopSandbox") return "HOP_SANDBOX";
  return null;
}

export const tagFor = (stage: AgentStage): BlockTag =>
  stage === "INVESTIGATE" || stage === "PLAN_INVESTIGATE" || stage === "HOP_INVESTIGATE" || stage === "BRAND_INVESTIGATE" || stage === "SUPPLY_DIFOT" ? "rca" : stage === "IDEATION" ? "ideas" : stage === "PLAN_BUILDER" ? "scenario" : stage === "SUPPLY_RECOVERY" ? "po_plan" : stage === "CATEGORY_BRIEF" ? "brief" : stage === "HOP_SANDBOX" ? "sandbox" : "campaign";

export async function logAgentRun(o: {
  stage: AgentStage; agentFqn: string; campaignId: unknown; question: string; text: string;
  steps: AgentStep[]; results: ToolResult[]; threadId: number | null; user: string; error: string | null; streamed: boolean;
  cortexRunId?: string | null;
}): Promise<{ runId: string; verified: boolean | null; unmatched: string[]; hasBlock: boolean }> {
  // A Cortex run can be streamed by more than one request -- the one that
  // started it and one that resumed it after the connection dropped -- so its
  // row is keyed on the run id and written once. A row that recorded an error
  // gives way to a later, clean read of the same run.
  const runId = o.cortexRunId && /^\d{1,20}-\d{1,20}$/.test(o.cortexRunId)
    ? `AG-${o.cortexRunId}`
    : `AG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    `MERGE INTO ${S}.AI_RUN t
     USING (SELECT ? RUN_ID, ? STAGE, ? CAMPAIGN_ID, ? TEMPLATE_KEY, ? MODEL, ? QUESTION, PARSE_JSON(?) GROUNDING_PAYLOAD,
                   ? PROMPT_CHARS, PARSE_JSON(?) RESPONSE, PARSE_JSON(?) FIGURES_CITED, PARSE_JSON(?) UNVERIFIED_FIGURES,
                   ? IS_VERIFIED, ? ERROR_MESSAGE, ? GENERATED_BY) s
     ON t.RUN_ID = s.RUN_ID
     WHEN MATCHED AND t.ERROR_MESSAGE IS NOT NULL AND s.ERROR_MESSAGE IS NULL THEN UPDATE SET
       GROUNDING_PAYLOAD = s.GROUNDING_PAYLOAD, RESPONSE = s.RESPONSE, UNVERIFIED_FIGURES = s.UNVERIFIED_FIGURES,
       IS_VERIFIED = s.IS_VERIFIED, ERROR_MESSAGE = NULL
     WHEN NOT MATCHED THEN INSERT (RUN_ID, STAGE, CAMPAIGN_ID, TEMPLATE_KEY, MODEL, QUESTION, GROUNDING_PAYLOAD, PROMPT_CHARS, RESPONSE,
       FIGURES_CITED, UNVERIFIED_FIGURES, IS_VERIFIED, ERROR_MESSAGE, GENERATED_BY, GENERATED_AT)
     VALUES (s.RUN_ID, s.STAGE, s.CAMPAIGN_ID, s.TEMPLATE_KEY, s.MODEL, s.QUESTION, s.GROUNDING_PAYLOAD, s.PROMPT_CHARS, s.RESPONSE,
       s.FIGURES_CITED, s.UNVERIFIED_FIGURES, s.IS_VERIFIED, s.ERROR_MESSAGE, s.GENERATED_BY, ${NOW})`,
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
