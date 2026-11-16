// ─── Campaign & CRM: reading an agent's answer (pure, shared) ────────────────
//
// The campaign agents answer with one fenced JSON block -- ```campaign, ```ideas
// or ```rca -- then markdown. This module finds and parses that block, turns the
// tool results of the run into the figures the answer may cite, and checks every
// number against them with the same guardrail the AI_COMPLETE surfaces used
// (src/lib/ai/grounded.ts). The browser uses it to render the card while the
// answer streams; the chat route uses it to log the run verified or not.

import { verifyCitations } from "../ai/grounded";

export type BlockTag = "campaign" | "ideas" | "rca";

export type Split<T> = {
  /** Text before the block: the agent sometimes narrates ("Now the charts.") first. */
  before: string;
  block: T | null;
  /** The block has opened but not closed yet: still streaming. */
  pending: boolean;
  error: string | null;
  after: string;
};

/** Find the first ```tag block anywhere in the text. */
export function splitBlock<T = unknown>(text: string, tag: BlockTag): Split<T> {
  const open = text.indexOf("```" + tag);
  if (open < 0) return { before: text, block: null, pending: false, error: null, after: "" };
  const start = text.indexOf("\n", open);
  const bodyStart = start < 0 ? text.length : start + 1;
  const close = text.indexOf("```", bodyStart);
  if (close < 0) return { before: text.slice(0, open), block: null, pending: true, error: null, after: "" };
  const raw = text.slice(bodyStart, close).trim();
  const after = text.slice(close + 3).replace(/^\s+/, "");
  try {
    return { before: text.slice(0, open), block: JSON.parse(raw) as T, pending: false, error: null, after };
  } catch (e) {
    return { before: text.slice(0, open), block: null, pending: false, error: `The ${tag} block is not valid JSON: ${(e as Error).message}`, after };
  }
}

export type ToolResult = { name: string; status?: string; content: unknown };

/** What a run's tools returned, as plain data: procedure results are JSON text
 *  inside `json.result`, search hits are `json.search_results`, Analyst returns a
 *  result set. Charts and the agent's own skills carry no figures. */
export function toolPayload(results: ToolResult[]): unknown[] {
  const out: unknown[] = [];
  for (const r of results) {
    if (r.status && r.status !== "success") continue;
    if (r.name === "data_to_chart" || r.name === "server_skill") continue;
    const items = Array.isArray(r.content) ? r.content : [r.content];
    for (const it of items as Record<string, unknown>[]) {
      const j = (it?.json ?? it) as Record<string, unknown> | undefined;
      if (!j || typeof j !== "object") continue;
      if (typeof j.result === "string") {
        try {
          out.push(JSON.parse(j.result));
        } catch {
          out.push(j.result);
        }
      } else if (Array.isArray(j.search_results)) {
        out.push((j.search_results as Record<string, unknown>[]).map((s) => s.text));
      } else if (j.result_set && typeof j.result_set === "object") {
        out.push((j.result_set as { data?: unknown }).data ?? []);
      }
    }
  }
  return out;
}

type Rec = Record<string, unknown>;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : typeof v === "string" ? [v] : []);

/** The figures a block declares (key evidence values) and the prose a reader
 *  sees (everything else that is text), per block type. */
function citedAndProse(tag: BlockTag, block: unknown): { cited: string[]; prose: string[] } {
  if (tag === "ideas") {
    const ideas = Array.isArray(block) ? (block as Rec[]) : [];
    return { cited: [], prose: ideas.flatMap((i) => [String(i.title ?? ""), String(i.hypothesis ?? ""), ...strs(i.evidence), ...strs(i.risks)]) };
  }
  const b = (block ?? {}) as Rec;
  const ev = Array.isArray(b.key_evidence) ? (b.key_evidence as Rec[]) : [];
  const cited = ev.map((e) => String(e.value ?? ""));
  const prose = [...ev.map((e) => String(e.label ?? ""))];
  if (tag === "rca") {
    prose.push(String(b.headline ?? ""), String(b.impact ?? ""), String(b.learning ?? ""), ...strs(b.causal_chain), ...strs(b.ruled_out));
    for (const h of (Array.isArray(b.hypotheses) ? b.hypotheses : []) as Rec[]) prose.push(String(h.evidence ?? ""));
    for (const a of (Array.isArray(b.actions) ? b.actions : []) as Rec[]) prose.push(String(a.action ?? ""));
  } else {
    const exp = (b.expected ?? {}) as Rec;
    prose.push(String(b.objective ?? ""), String(b.hypothesis ?? ""), String(exp.basis ?? ""));
    for (const k of ["incremental_conversions", "lift_pts_low", "lift_pts_high"]) if (typeof exp[k] === "number") cited.push(`${exp[k]}${k.startsWith("lift") ? " pts" : ""}`);
    const aud = (b.audience ?? {}) as Rec;
    for (const k of ["matched", "final_audience"]) if (typeof aud[k] === "number") cited.push(String(aud[k]));
  }
  return { cited, prose };
}

export type Verification = { verified: boolean; unmatched: string[] };

/** Check every number in the block and the markdown after it against what the
 *  run's tools returned. The budget and dates the user asked for are supplied
 *  by the question, so it counts as a source too. */
export function verifyAnswer(tag: BlockTag, block: unknown, after: string, results: ToolResult[], question = ""): Verification {
  const { cited, prose } = citedAndProse(tag, block);
  return verifyCitations({ tools: toolPayload(results), question }, cited, [...prose, after]);
}
