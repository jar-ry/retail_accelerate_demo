// ─── OneDigital Campaign Manager: stored-procedure entry for the agents' tools
//
// Bundled by scripts/build_cmp_tools.mjs into one IIFE (global CMPTOOLS) that
// od_45 embeds in each JavaScript procedure. Adapts Snowflake's synchronous
// statement API to the `run` the tools take: JavaScript procedures cannot bind
// booleans or undefined, dates come back as strings, and VARIANT columns as
// objects.

import * as tools from "./tools";
import type { Row } from "./tools";

declare const snowflake: {
  createStatement(o: { sqlText: string; binds?: unknown[] }): {
    execute(): { next(): boolean; getColumnValue(i: number): unknown; getColumnValueAsString(i: number): string };
    getColumnCount(): number;
    getColumnName(i: number): string;
    getColumnType(i: number): string;
  };
};

function bind(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}

export function run(sql: string, binds: unknown[] = []): Row[] {
  const st = snowflake.createStatement({ sqlText: sql, binds: binds.map(bind) });
  const rs = st.execute();
  const cols = st.getColumnCount();
  const names: string[] = [];
  const types: string[] = [];
  for (let i = 1; i <= cols; i++) {
    names.push(st.getColumnName(i));
    types.push(String(st.getColumnType(i)).toLowerCase());
  }
  const out: Row[] = [];
  while (rs.next()) {
    const row: Row = {};
    for (let i = 1; i <= cols; i++) {
      const t = types[i - 1];
      const v = rs.getColumnValue(i);
      row[names[i - 1]] = v === null || v === undefined ? null
        : t === "date" ? rs.getColumnValueAsString(i).slice(0, 10)
          : t.startsWith("timestamp") ? rs.getColumnValueAsString(i)
            : v;
    }
    out.push(row);
  }
  return out;
}

/** Every tool returns JSON text: a VARIANT return would print every float in
 *  exponent form (6.2e+00), which reads badly to the agent and to the citation
 *  check. An unexpected error is returned, not thrown, so the agent can read it
 *  and recover instead of the whole run failing. */
function safe(fn: () => unknown): string {
  try {
    return JSON.stringify(fn());
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export const findOpportunities = () => safe(() => tools.findOpportunities(run));
export const sizeAudience = (spec: unknown) => safe(() => tools.sizeAudience(run, spec));
export const checkGuardrails = (category: unknown, brand: unknown, start: unknown, end: unknown) => safe(() => tools.checkGuardrails(run, category, brand, start, end));
export const estimateLift = (category: unknown, channels: unknown, need: unknown) => safe(() => tools.estimateLift(run, category, channels, need));
export const createDraft = (brief: unknown, spec: unknown, runId: unknown) => safe(() => tools.createDraft(run, brief, spec, runId));
export const campaignEvidence = (id: unknown) => safe(() => tools.campaignEvidence(run, id));
export const testHypothesis = (id: unknown, dim: unknown) => safe(() => tools.testHypothesis(run, id, dim));
