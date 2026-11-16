// ─── Head of Planning: query helpers ──────────────────────────────────────────

import { querySnowflake, querySnowflakeWithBinds, queryBatch, queryTransaction } from "@/lib/snowflake";

export type Row = Record<string, unknown>;
export type Stmt = { sql: string; binds?: unknown[] };
export type Run = (sql: string, binds?: unknown[]) => Promise<Row[]>;

/** One statement, bound when binds are given. Binds are positional `?`. */
export async function q(sql: string, binds?: unknown[]): Promise<Row[]> {
  return binds && binds.length ? querySnowflakeWithBinds(sql, binds) : querySnowflake(sql);
}

/** Several reads on one connection, in parallel. A page load is one batch. */
export async function batch(statements: (string | Stmt)[]): Promise<Row[][]> {
  return queryBatch(statements.map((s) => (typeof s === "string" ? { sql: s } : s)));
}

/** Writes that stand or fall together -- every change with its audit row -- as
 *  one transaction, in order. Pass the statements, or a function that runs them
 *  when a later one needs what an earlier one wrote (a generated id, a row
 *  count to check). Anything thrown inside rolls back all of it. */
export async function tx(statements: Stmt[]): Promise<Row[][]>;
export async function tx<T>(work: (run: Run) => Promise<T>): Promise<T>;
export async function tx<T>(arg: Stmt[] | ((run: Run) => Promise<T>)): Promise<T | Row[][]> {
  if (typeof arg === "function") return queryTransaction(arg);
  return queryTransaction(async (run) => {
    const out: Row[][] = [];
    for (const s of arg) out.push(await run(s.sql, s.binds));
    return out;
  });
}

/** An error carrying the HTTP status the route should answer with. Handlers throw
 *  these for refusals (403 ownership, 409 stale, 423 frozen) so the route can map
 *  them without every handler building its own response. */
export class HopError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Every write stamps Sydney wall-clock time. The account's session timezone is
 *  not Australian, and the seeded history is, so CURRENT_TIMESTAMP() alone would
 *  put a fresh edit hours "before" an older one in the trail -- and the store
 *  plan engine decides precedence by comparing these timestamps. */
export const NOW = "CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ";
