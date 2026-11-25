// ─── The Ontology compare page: what each column is and how it is judged ──────
//
// /ontology asks one question of three agents that query the same plain semantic
// view (sql/55: the tables and joins, no business rules) and differ only in the
// context they bring (agent/deploy_ontology_compare_agents.sql). This file holds
// what the page needs to say about each column, the preset questions, and the
// pure helpers that read a column's tool results: which governed definitions and
// Cortex Sense documents it used, the SQL it ran, and whether its answer carries
// the reference figures computed from the base tables (/api/ontology/reference).

import type { Step } from "@/components/agent/useAgentRun";

export type LayerId = "cmpSv" | "cmpOntology" | "cmpSense";

export const LAYERS: Array<{ id: LayerId; title: string; short: string; adds: string; color: string }> = [
  {
    id: "cmpSv", title: "Semantic view", short: "SV",
    adds: "The tables, joins and plain totals. No business rules: no like-for-like weeks, no DIFOT target, no caveats.",
    color: "slate",
  },
  {
    id: "cmpOntology", title: "Semantic view + ontology", short: "SV + Ontology",
    adds: "Adds Baby Mart's Business Ontology: governed definitions and formulas, synonyms, policies (like-for-like, DIFOT target, rebuilt ratios) and how concepts relate.",
    color: "blue",
  },
  {
    id: "cmpSense", title: "Semantic view + ontology + Cortex Sense", short: "SV + Ontology + Sense",
    adds: "Adds Cortex Sense: each table's grain, joins and caveats (e.g. rows that double count), the ontology in context and past queries that answered similar questions.",
    color: "violet",
  },
];

export type PresetId = "growth" | "huggiesDifot" | "redFlag";

export const PRESETS: Array<{ id: PresetId; question: string; trap: string }> = [
  {
    id: "growth",
    question: "Which brands are growing fastest this year?",
    trap: "FY2026 sales end 7 May, so a full-year comparison makes every brand look down. The Like-for-like Period policy compares the same weeks.",
  },
  {
    id: "huggiesDifot",
    question: "What is the Huggies DIFOT this year, and how many orders was that?",
    trap: "DIFOT is weighted by orders (Rebuilt Ratios), and FY2026 has Huggies class rows beside the brand totals, so adding them counts orders twice. Cortex Sense carries that caveat.",
  },
  {
    id: "redFlag",
    question: "Which suppliers are a red flag on delivery?",
    trap: "\"Red flag\" is a business rule, not a column: the DIFOT Target policy says below 90% (the target is 96%).",
  },
];

/** A reference figure the right answer must contain: a number to the shown
 *  precision, or a name. */
export type Expect = { label: string; number?: number; decimals?: number; text?: string };
export type Reference = { id: PresetId; summary: string; rule: string; expect: Expect[] };

/** The numbers written in an answer, commas and signs stripped. */
export function numbersIn(text: string): number[] {
  return (text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Which reference figures an answer carries. A number matches when the answer
 *  writes it to the reference's precision (93.7 matches 93.7 and 93.70, not 93.1). */
export function checkAnswer(text: string, expect: Expect[]): { ok: boolean; missing: string[] } {
  const body = text.replace(/\*\*/g, "");
  const nums = numbersIn(body);
  const lower = body.toLowerCase();
  const missing = expect.filter((e) => {
    if (e.text) return !lower.includes(e.text.toLowerCase());
    if (typeof e.number !== "number") return false;
    const d = e.decimals ?? 1;
    const want = Number(e.number.toFixed(d));
    return !nums.some((n) => Number(n.toFixed(d)) === want);
  }).map((e) => e.label);
  return { ok: missing.length === 0, missing };
}

/** A tool result's payload. A procedure tool's JSON text arrives under
 *  `json.result` ({execution_type, query_id, result}); other tools put their
 *  object straight in `json`, or send text. Strings are parsed (twice at most). */
export function toolPayload(result: unknown): Record<string, any> | null {
  const items = Array.isArray(result) ? result : [result];
  for (const item of items) {
    const j = (item as any)?.json;
    let v: unknown = j?.execution_type === "procedure" && "result" in j ? j.result : j ?? (item as any)?.text ?? item;
    for (let i = 0; i < 2 && typeof v === "string"; i++) {
      try { v = JSON.parse(v); } catch { break; }
    }
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  }
  return null;
}

export type ContextUsed = {
  ontology?: { available: boolean; named: string[]; rules: string[]; note?: string };
  sense?: { available: boolean; documents: Array<{ kind: string; about: string }>; note?: string };
};

const SENSE_KIND: Record<string, string> = {
  table_entity: "Table page", ontology_node: "Ontology node", datamart: "Domain overview", qbe: "Past query",
};

/** What the ontology and Cortex Sense tools returned to this column. */
export function contextUsed(steps: Step[]): ContextUsed {
  const out: ContextUsed = {};
  for (const s of steps) {
    const p = toolPayload(s.result);
    if (!p) continue;
    if (s.name === "OntologyLookup") {
      const detail: Array<{ name: string; kind: string }> = p.detail ?? [];
      out.ontology = {
        available: !!p.available, note: p.note,
        named: p.named_in_question ?? [],
        rules: detail.filter((d) => d.kind === "POLICY").map((d) => d.name),
      };
    } else if (s.name === "CortexSenseLookup") {
      out.sense = {
        available: !!p.available, note: p.note,
        documents: (p.documents ?? []).map((d: any) => {
          const about = String(d.about ?? "");
          // Table pages are keyed by FQN; past queries by an opaque id.
          const fqn = /^[A-Z0-9_$]+\.[A-Z0-9_$]+\.[A-Z0-9_$]+$/i.test(about);
          return { kind: SENSE_KIND[d.kind] ?? String(d.kind ?? ""),
                   about: fqn ? about.split(".").pop()! : d.kind === "qbe" ? "a similar question" : "" };
        }),
      };
    }
  }
  return out;
}

/** The SQL Cortex Analyst ran for this column, last query first. */
export function sqlRun(steps: Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const fromInput = (s.input as any)?.sql;
    if (s.name === "system_execute_sql" && typeof fromInput === "string") out.push(fromInput);
    else {
      const p = toolPayload(s.result);
      if (p && typeof p.sql === "string") out.push(p.sql);
    }
  }
  return [...new Set(out)].reverse();
}

/** The answer and its "How I read the question" section, apart. */
export function splitReading(text: string): { answer: string; reading: string | null } {
  const m = text.match(/\n#{2,4}\s*How I read the question\s*\n/i);
  if (!m || m.index === undefined) return { answer: text, reading: null };
  return { answer: text.slice(0, m.index).trim(), reading: text.slice(m.index + m[0].length).trim() };
}
