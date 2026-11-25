"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, Network, Send, XCircle, CircleDashed } from "lucide-react";
import { Markdown } from "@/components/agent/AgentCards";
import { useAgentRun, type Turn } from "@/components/agent/useAgentRun";
import { Button, Pill, inputCls } from "@/components/ui/kit";
import {
  LAYERS, PRESETS, checkAnswer, contextUsed, splitReading, sqlRun,
  type LayerId, type Reference,
} from "@/lib/ontology-compare";

// ─── Ontology: one question, three layers of context ─────────────────────────
//
// The same agent three times over the same plain semantic view (sql/55), with no
// context, with the Business Ontology, and with the ontology plus Cortex Sense
// (agent/deploy_ontology_compare_agents.sql). One question goes to all three at
// once, so a customer sees side by side what each layer changes: the answer, how
// the agent read the question, the context it pulled in and the SQL it ran. For
// the preset questions the right answer is computed from the base tables
// (/api/ontology/reference) and each column is checked against it.

const TONE: Record<string, { dot: string; ring: string; tint: string; text: string }> = {
  slate: { dot: "bg-slate-500", ring: "border-slate-300", tint: "bg-slate-50", text: "text-slate-700" },
  blue: { dot: "bg-blue-600", ring: "border-blue-300", tint: "bg-blue-50", text: "text-blue-800" },
  violet: { dot: "bg-violet-600", ring: "border-violet-300", tint: "bg-violet-50", text: "text-violet-800" },
};

export default function OntologyComparePage() {
  const runs: Record<LayerId, ReturnType<typeof useAgentRun>> = {
    cmpSv: useAgentRun("cmpSv"),
    cmpOntology: useAgentRun("cmpOntology"),
    cmpSense: useAgentRun("cmpSense"),
  };
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const busy = Object.values(runs).some((r) => r.busy);

  useEffect(() => {
    fetch("/api/ontology/reference")
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setRefs(d) : setRefError(d?.error ?? "The reference answers could not be computed.")))
      .catch(() => setRefError("The reference answers could not be computed."));
  }, []);

  const preset = PRESETS.find((p) => p.question === question) ?? null;
  const reference = preset ? refs?.find((r) => r.id === preset.id) ?? null : null;

  const askAll = (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion(text);
    setInput("");
    for (const r of Object.values(runs)) {
      r.reset();
      void r.ask(text);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Network className="w-5 h-5 text-blue-700 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Ontology</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-4xl">
            One question, three layers of context. The same agent answers it three times over the same semantic view: once
            on its own, once with Baby Mart&apos;s Business Ontology, and once with the ontology and Cortex Sense. The only
            thing that changes between the columns is the context.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {LAYERS.map((l, i) => (
          <div key={l.id} className={`rounded-xl border bg-white p-4 shadow-sm ${TONE[l.color].ring}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${TONE[l.color].dot}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Layer {i + 1}</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">{l.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{l.adds}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Ask all three</h3>
          <p className="text-xs text-slate-500 mt-1">
            Each preset question hides a business rule the tables alone don&apos;t carry. The right answer is worked out
            from the base tables, and each column is checked against it.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => askAll(p.question)} disabled={busy}
              className={`rounded-lg border p-3 text-left shadow-sm transition disabled:opacity-50 ${
                question === p.question ? "border-blue-400 bg-blue-50/60" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"}`}>
              <div className="text-xs font-medium text-slate-800">{p.question}</div>
              <div className="mt-1 text-[11px] text-slate-500">{p.trap}</div>
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); askAll(input); }} className="flex items-center gap-2">
          <input className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            placeholder={busy ? "All three are working…" : "Or ask your own question of all three"} />
          <Button type="submit" variant="primary" disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {busy ? "Working" : "Ask all three"}
          </Button>
        </form>
      </div>

      {question && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Question</div>
            <div className="mt-0.5 text-sm font-medium text-slate-900">{question}</div>
            {preset && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Reference answer, computed from the base tables
                </div>
                {reference ? (
                  <>
                    <div className="mt-1 text-xs text-emerald-950">{reference.summary}</div>
                    <div className="mt-1 text-[11px] text-emerald-800">Rule applied: {reference.rule}</div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-emerald-900">{refError ?? "Working it out…"}</div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {LAYERS.map((l) => (
              <Column key={l.id} layer={l} turn={runs[l.id].turns[runs[l.id].turns.length - 1]} reference={reference} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Column({ layer, turn, reference }: {
  layer: (typeof LAYERS)[number];
  turn?: Turn;
  reference: Reference | null;
}) {
  const tone = TONE[layer.color];
  const [endedAt, setEndedAt] = useState<number | null>(null);
  useEffect(() => {
    setEndedAt(null);
  }, [turn?.startedAt]);
  useEffect(() => {
    if (turn?.done && endedAt === null) setEndedAt(Date.now());
  }, [turn?.done, endedAt]);

  const ctx = useMemo(() => contextUsed(turn?.steps ?? []), [turn?.steps]);
  const sql = useMemo(() => sqlRun(turn?.steps ?? []), [turn?.steps]);
  const { answer, reading } = splitReading(turn?.text ?? "");
  const verdict = turn?.done && reference && turn.text ? checkAnswer(turn.text, reference.expect) : null;
  const secs = turn ? Math.round(((endedAt ?? Date.now()) - turn.startedAt) / 1000) : 0;
  const tools = (turn?.steps ?? []).filter((s) => s.name !== "system_execute_sql" && s.name !== "server_skill");

  return (
    <div className={`flex flex-col rounded-xl border bg-white shadow-sm ${tone.ring}`}>
      <div className={`flex items-start justify-between gap-2 rounded-t-xl border-b px-4 py-3 ${tone.tint} ${tone.ring}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
          <span className={`text-sm font-semibold ${tone.text}`}>{layer.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {turn && !turn.done && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          {turn && <span className="text-[10px] text-slate-500">{secs}s</span>}
          {verdict && (verdict.ok
            ? <Pill tone="green" title="Carries every reference figure">Matches reference</Pill>
            : <Pill tone="red" title={`Missing: ${verdict.missing.join(", ")}`}>Differs from reference</Pill>)}
        </div>
      </div>

      <div className="flex-1 space-y-3 p-4">
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                {s.status === "running" ? <CircleDashed className="h-3 w-3 animate-spin" />
                  : s.status === "success" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <XCircle className="h-3 w-3 text-red-500" />}
                {toolLabel(s.name)}
              </span>
            ))}
          </div>
        )}

        {(ctx.ontology || ctx.sense) && (
          <div className={`rounded-lg border p-3 ${tone.ring} ${tone.tint}`}>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${tone.text}`}>Context it brought</div>
            {ctx.ontology && (
              <div className="mt-1.5 text-[11px] text-slate-700">
                <span className="font-semibold">Ontology:</span>{" "}
                {ctx.ontology.available
                  ? <>
                      {ctx.ontology.named.length ? <>defined {ctx.ontology.named.join(", ")}</> : "no terms named in the question"}
                      {ctx.ontology.rules.length ? <>; rules {ctx.ontology.rules.join(", ")}</> : null}
                    </>
                  : ctx.ontology.note ?? "not available"}
              </div>
            )}
            {ctx.sense && (
              <div className="mt-1 text-[11px] text-slate-700">
                <span className="font-semibold">Cortex Sense:</span>{" "}
                {ctx.sense.available
                  ? ctx.sense.documents.map((d) => `${d.kind}${d.about ? ` (${d.about})` : ""}`).join(", ") || "no documents"
                  : ctx.sense.note ?? "not available"}
              </div>
            )}
          </div>
        )}

        {turn?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{turn.error}</div>}

        {answer ? <Markdown text={answer} /> : turn && !turn.done ? (
          <div className="text-xs text-slate-400">{turn.status ?? "Working…"}</div>
        ) : null}

        {reading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">How it read the question</div>
            <div className="mt-1"><Markdown text={reading} /></div>
          </div>
        )}

        {verdict && !verdict.ok && (
          <div className="text-[11px] text-red-700">Reference figures not in this answer: {verdict.missing.join(", ")}</div>
        )}

        {sql.length > 0 && (
          <details className="group rounded-lg border border-slate-200">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-[11px] font-medium text-slate-600">
              <ChevronRight className="h-3 w-3 transition group-open:rotate-90" />SQL it ran{sql.length > 1 ? ` (${sql.length} queries)` : ""}
            </summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-slate-200 bg-slate-50 p-3 text-[10px] leading-snug text-slate-700">{sql[0]}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function toolLabel(name: string) {
  if (name === "category_manager") return "Cortex Analyst";
  if (name === "OntologyLookup") return "Business Ontology";
  if (name === "CortexSenseLookup") return "Cortex Sense";
  if (name === "data_to_chart") return "Chart";
  return name;
}
