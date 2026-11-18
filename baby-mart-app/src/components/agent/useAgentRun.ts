"use client";

import { useCallback, useRef, useState } from "react";
import { streamAgentChat } from "./agentStream";

// ─── One agent run, streamed ──────────────────────────────────────────────────
//
// Reads /api/agent/chat's newline-delimited events into the state the progress
// trail and the answer cards render: each tool call as a step that runs and then
// succeeds or fails, the status line, a tail of the model's thinking, charts,
// the text, and at the end the server's audit row (run id and whether every
// figure matched a tool result). A follow-up continues the same thread. A
// dropped connection reconnects to the same run (agentStream.ts).

export type AgentId = "campaignBuilder" | "campaignInvestigator" | "planInvestigator" | "planBuilder" | "hopInvestigator" | "brandInvestigator" | "supplyRecovery" | "supplierDifot" | "negotiationBrief" | "hopSandbox" | "npsInvestigator";
export type AgentStageId = "BUILDER" | "IDEATION" | "INVESTIGATE" | "PLAN_INVESTIGATE" | "PLAN_BUILDER" | "HOP_INVESTIGATE" | "BRAND_INVESTIGATE" | "SUPPLY_RECOVERY" | "SUPPLY_DIFOT" | "CATEGORY_BRIEF" | "HOP_SANDBOX" | "NPS_INVESTIGATE";
export type StepState = "running" | "success" | "error";
export type Step = { id: string; name: string; toolType: string; input: unknown; status: StepState; detail?: string; startedAt: number; endedAt?: number };
export type RunInfo = { runId: string; verified: boolean | null; unmatched: string[]; hasBlock: boolean };

export type Turn = {
  question: string;
  text: string;
  steps: Step[];
  charts: string[];
  status?: string;
  thinking?: string;
  error?: string;
  run?: RunInfo;
  done: boolean;
  startedAt: number;
};

type Event =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "thread"; threadId: number }
  | { type: "parent"; messageId: number }
  | { type: "step"; id: string; name: string; toolType: string; input: unknown }
  | { type: "step_status"; id: string; message: string }
  | { type: "step_result"; id: string; name: string; status: string }
  | { type: "chart"; spec: string }
  | { type: "thinking"; text: string }
  | ({ type: "run" } & RunInfo)
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "reset" }
  | { type: "table" };

/** Apply one event to the turn in progress. Pure, so it is tested on recorded runs. */
export function applyEvent(t: Turn, e: Event, now = Date.now()): Turn {
  switch (e.type) {
    case "status":
      return { ...t, status: e.message };
    case "text":
      return { ...t, text: t.text + e.text };
    case "thinking":
      return { ...t, thinking: ((t.thinking ?? "") + e.text).slice(-600) };
    case "step":
      // The agent names its own SQL and skill loading as tools; the trail shows
      // what it asked for (the Analyst step), not the plumbing under it.
      return { ...t, steps: [...t.steps, { id: e.id, name: e.name, toolType: e.toolType, input: e.input, status: "running", startedAt: now }] };
    case "step_status":
      return { ...t, steps: t.steps.map((s) => (s.id === e.id ? { ...s, detail: e.message } : s)) };
    case "step_result":
      return { ...t, steps: t.steps.map((s) => (s.id === e.id ? { ...s, status: e.status === "success" ? "success" : "error", endedAt: now } : s)) };
    case "chart":
      return { ...t, charts: [...t.charts, e.spec] };
    case "run":
      return { ...t, run: { runId: e.runId, verified: e.verified, unmatched: e.unmatched ?? [], hasBlock: e.hasBlock } };
    case "error":
      return { ...t, error: e.message };
    case "reset":
      // The run was read back from its thread after the stream was lost, and
      // arrives whole; what had streamed so far is replaced, not added to.
      return { ...t, text: "", steps: [], charts: [], thinking: undefined };
    case "done":
      return { ...t, done: true, status: undefined, steps: t.steps.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)) };
    default:
      return t;
  }
}

export function useAgentRun(agent: AgentId, context: { stage?: AgentStageId; campaignId?: string | null } = {}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<{ threadId: number | null; parent: number }>({ threadId: null, parent: 0 });
  const ctx = useRef(context);
  ctx.current = context;

  const ask = useCallback(async (question: string): Promise<Turn | null> => {
    const q = question.trim();
    if (!q || busy) return null;
    setBusy(true);
    let current: Turn = { question: q, text: "", steps: [], charts: [], status: "Planning the next steps", done: false, startedAt: Date.now() };
    setTurns((ts) => [...ts, current]);
    const push = (e: Event) => {
      if (e.type === "thread") thread.current.threadId = e.threadId;
      if (e.type === "parent") thread.current.parent = e.messageId;
      current = applyEvent(current, e);
      const snap = current;
      setTurns((ts) => [...ts.slice(0, -1), snap]);
    };
    try {
      await streamAgentChat(
        { agent, message: q, threadId: thread.current.threadId, parentMessageId: thread.current.parent,
          stage: ctx.current.stage, campaignId: ctx.current.campaignId ?? null },
        (e) => push(e as Event),
      );
    } catch (e) {
      push({ type: "error", message: e instanceof Error ? e.message : "The request failed." });
    } finally {
      if (!current.done) push({ type: "done" });
      setBusy(false);
    }
    return current;
  }, [agent, busy]);

  const reset = useCallback(() => {
    thread.current = { threadId: null, parent: 0 };
    setTurns([]);
  }, []);

  return { turns, busy, ask, reset };
}
