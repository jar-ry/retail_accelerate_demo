"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send } from "lucide-react";
import type { BlockTag } from "@/lib/campaign/agent-answer";
import { inputCls, Button } from "@/components/ui/kit";
import { ProgressTrail } from "./ProgressTrail";
import { AgentAnswer } from "./AgentCards";
import { useAgentRun, type AgentId, type AgentStageId, type Turn } from "./useAgentRun";

// ─── An agent conversation: question, progress, answer ───────────────────────
//
// Each turn renders as customer-sentiment-health's investigator does: the
// progress trail beside the answer card, charts and narrative. Follow-ups
// continue the thread, so "now create the draft" builds on the last answer.

export function AgentPanel({
  agent, tag, stage, campaignId, samples, placeholder, autoAsk, card, onFinished, compact,
}: {
  agent: AgentId;
  tag: BlockTag;
  stage?: AgentStageId;
  campaignId?: string | null;
  samples?: string[];
  placeholder?: string;
  /** Asked once on mount, e.g. the investigation a page link asked for. */
  autoAsk?: string | null;
  card?: (block: unknown, t: Turn) => React.ReactNode;
  onFinished?: (t: Turn) => void;
  compact?: boolean;
}) {
  const { turns, busy, ask, reset } = useAgentRun(agent, { stage, campaignId });
  const [input, setInput] = useState("");
  const asked = useRef(false);

  const submit = async (q: string) => {
    setInput("");
    const t = await ask(q);
    if (t && onFinished) onFinished(t);
  };

  useEffect(() => {
    if (autoAsk && !asked.current) {
      asked.current = true;
      void submit(autoAsk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  return (
    <div className="space-y-4">
      {turns.length === 0 && samples?.length ? (
        <div className="grid gap-2 md:grid-cols-3">
          {samples.map((s) => (
            <button key={s} onClick={() => submit(s)} disabled={busy}
              className="rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-50/50 disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {turns.map((t, i) => (
        <div key={i} className="space-y-3">
          <div className="flex justify-end">
            <div className="max-w-2xl rounded-2xl rounded-br-md bg-amber-600 px-3.5 py-2 text-xs text-white">{t.question}</div>
          </div>
          <div className={`grid gap-4 ${compact ? "xl:grid-cols-[300px_1fr]" : "xl:grid-cols-[340px_1fr]"}`}>
            <div className="h-fit xl:sticky xl:top-4"><ProgressTrail t={t} compact={compact} /></div>
            <AgentAnswer t={t} tag={tag} card={card ? (b) => card(b, t) : undefined} />
          </div>
        </div>
      ))}

      <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) void submit(input); }} className="flex items-center gap-2">
        <input className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
          placeholder={busy ? "Working…" : turns.length ? "Ask a follow-up" : placeholder ?? "Ask the agent"} />
        <Button type="submit" variant="primary" disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{busy ? "Working" : "Ask"}
        </Button>
        {turns.length > 0 && !busy && <Button onClick={reset} title="Start a new conversation"><RotateCcw className="h-3.5 w-3.5" />New</Button>}
      </form>
    </div>
  );
}
