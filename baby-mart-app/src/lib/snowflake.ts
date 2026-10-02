import snowflake from "snowflake-sdk";
import { readFileSync, existsSync } from "fs";

const SPCS_TOKEN_PATH = "/snowflake/session/token";

interface SnowflakeRow {
  [key: string]: any;
}

// ─── Target namespace ─────────────────────────────────────────────────────────
// The demo was originally built against a dedicated BABY_MART_DEMO database with
// CURATED / ANALYTICS / AI schemas. Some accounts (e.g. Snowhouse) don't allow
// creating a database, so the same objects live in schemas inside an existing
// database instead.
//
// Rather than rewriting the ~150 fully-qualified table references scattered
// across the API routes, the configured namespace is substituted into each
// statement just before execution (see remapNamespace).
//
// These defaults must be committed rather than supplied as env vars at deploy
// time: Snowflake App Runtime builds the image remotely, so anything set on the
// deploy machine never reaches the running service. Per-account overrides go in
// app.yml under environment_variables.
//
//   Canonical demo account (SFSEAPAC-JCHEN_AWS1): the defaults below.
//   Snowhouse override:  BABY_MART_DATABASE=TEMP,
//                        BABY_MART_SCHEMA_CURATED=JARCHEN_CURATED,
//                        BABY_MART_SCHEMA_ANALYTICS=JARCHEN_ANALYTICS,
//                        BABY_MART_SCHEMA_AI=JARCHEN_AI,
//                        SNOWFLAKE_WAREHOUSE=MNEGLAY_XS
export const DB = process.env.BABY_MART_DATABASE || "BABY_MART_DEMO";
export const SCHEMA_CURATED = process.env.BABY_MART_SCHEMA_CURATED || "CURATED";
export const SCHEMA_ANALYTICS = process.env.BABY_MART_SCHEMA_ANALYTICS || "ANALYTICS";
export const SCHEMA_AI = process.env.BABY_MART_SCHEMA_AI || "AI";
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || "DEMO_ANALYTICS_WH";

const NAMESPACE_MAP: Array<[RegExp, string]> = [
  // Fully-qualified table references.
  [/\bBABY_MART_DEMO\.CURATED\./gi, `${DB}.${SCHEMA_CURATED}.`],
  [/\bBABY_MART_DEMO\.ANALYTICS\./gi, `${DB}.${SCHEMA_ANALYTICS}.`],
  [/\bBABY_MART_DEMO\.AI\./gi, `${DB}.${SCHEMA_AI}.`],
  // Session context statements (some routes set context explicitly).
  [/\bUSE\s+DATABASE\s+BABY_MART_DEMO\b/gi, `USE DATABASE ${DB}`],
  [/\bUSE\s+SCHEMA\s+CURATED\b/gi, `USE SCHEMA ${DB}.${SCHEMA_CURATED}`],
  [/\bUSE\s+SCHEMA\s+ANALYTICS\b/gi, `USE SCHEMA ${DB}.${SCHEMA_ANALYTICS}`],
  [/\bUSE\s+SCHEMA\s+AI\b/gi, `USE SCHEMA ${DB}.${SCHEMA_AI}`],
  // Warehouses that only exist on the original account.
  [/\bDEMO_(?:LOAD|ANALYTICS|AI)_WH\b/gi, WAREHOUSE],
];

const NEEDS_REMAP =
  DB !== "BABY_MART_DEMO" ||
  SCHEMA_CURATED !== "CURATED" ||
  SCHEMA_ANALYTICS !== "ANALYTICS" ||
  SCHEMA_AI !== "AI" ||
  WAREHOUSE !== "DEMO_ANALYTICS_WH";

/** Rewrite hardcoded BABY_MART_DEMO.<schema> references to the configured namespace. */
export function remapNamespace(sql: string): string {
  if (!NEEDS_REMAP) return sql;
  let out = sql;
  for (const [pattern, replacement] of NAMESPACE_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Host + OAuth token for calling Snowflake REST APIs from inside the container.
 * Returns null during local development, where no SPCS token is mounted and
 * callers should fall back to the SQL driver.
 */
export function getSpcsRestAuth(): { host: string; token: string } | null {
  if (!existsSync(SPCS_TOKEN_PATH)) return null;
  const host = process.env.SNOWFLAKE_HOST;
  if (!host) return null;
  return { host, token: readFileSync(SPCS_TOKEN_PATH, "utf-8").trim() };
}

/** Fully-qualified name of the Cortex Agent backing the chat page.
 *  Kept as the default export for the category persona. */
export const AGENT_FQN = `${DB}.${SCHEMA_AI}.${
  process.env.BABY_MART_AGENT || "CATEGORY_MANAGER_AGENT"
}`;

/** The agents this app can talk to, keyed by the id the chat page sends.
 *
 *  Two agents rather than one because they answer questions about different
 *  businesses over different data: the category agent reads Baby Mart baby-goods
 *  sell-through, the merch agent reads the merchandise plan. A single
 *  agent holding both semantic views would happily answer a merchandise
 *  planner's question from nappy sell-through, which is worse than having no
 *  agent at all. */
export const AGENTS = {
  category: {
    id: "category",
    label: "Category Intelligence Agent",
    fqn: AGENT_FQN,
  },
  merch: {
    id: "merch",
    label: "Merch Planning Agent",
    fqn: `${DB}.${SCHEMA_AI}.${
      process.env.BABY_MART_AGENT_MERCH || "MERCH_PLANNING_AGENT"
    }`,
  },
} as const;

export type AgentId = keyof typeof AGENTS;

/** Resolve an agent id to its FQN, defaulting to the category agent so an older
 *  client that sends no id keeps working. */
export function resolveAgentFqn(id: string | null | undefined): string {
  if (id && id in AGENTS) return AGENTS[id as AgentId].fqn;
  return AGENT_FQN;
}

function getConnectionOptions(): snowflake.ConnectionOptions {
  // In SPCS / App Runtime: read OAuth token from filesystem
  if (existsSync(SPCS_TOKEN_PATH)) {
    const token = readFileSync(SPCS_TOKEN_PATH, "utf-8").trim();
    return {
      account: process.env.SNOWFLAKE_ACCOUNT || "",
      host: process.env.SNOWFLAKE_HOST || "",
      authenticator: "OAUTH",
      token,
      database: DB,
      schema: SCHEMA_ANALYTICS,
      warehouse: WAREHOUSE,
    };
  }

  // Local development (no SPCS token mounted). The Node driver does not read
  // connections.toml, so the account must come from the environment -- there is
  // deliberately no default, so the repo isn't pinned to one account.
  const account = process.env.SNOWFLAKE_ACCOUNT;
  if (!account) {
    throw new Error(
      "SNOWFLAKE_ACCOUNT is not set. For local development, export SNOWFLAKE_ACCOUNT " +
        "(e.g. SFSEAPAC-JCHEN_AWS1) plus any namespace overrides. Inside Snowflake " +
        "App Runtime this is provided automatically.",
    );
  }

  return {
    account,
    authenticator: "EXTERNALBROWSER",
    database: DB,
    schema: SCHEMA_ANALYTICS,
    warehouse: WAREHOUSE,
    // Optional, and only used for local development. Accounts reached through a
    // non-default hostname (e.g. Snowhouse) need an explicit host, and accounts
    // whose default role cannot see the demo namespace need an explicit role.
    // Omitted rather than defaulted so the canonical account is unaffected.
    ...(process.env.SNOWFLAKE_HOST ? { host: process.env.SNOWFLAKE_HOST } : {}),
    ...(process.env.SNOWFLAKE_ROLE ? { role: process.env.SNOWFLAKE_ROLE } : {}),
  };
}

/** Open a connection, using the right connect call for the authenticator.
 *
 *  The Node driver rejects conn.connect() for EXTERNALBROWSER with "connect()
 *  does not work with external browser or okta authenticators, call
 *  connectAsync()". SPCS uses OAUTH and works with either, so this only matters
 *  for local development -- but without it local dev cannot reach Snowflake at
 *  all, which makes every page unverifiable outside a deploy.
 */
async function openConnection(): Promise<snowflake.Connection> {
  const options = getConnectionOptions();
  const conn = snowflake.createConnection(options);
  const needsAsync = String(options.authenticator).toUpperCase() === "EXTERNALBROWSER";

  return new Promise((resolve, reject) => {
    const cb = (err: unknown) => (err ? reject(err) : resolve(conn));
    if (needsAsync) {
      conn.connectAsync(cb);
    } else {
      conn.connect(cb);
    }
  });
}

export async function querySnowflake(sql: string): Promise<SnowflakeRow[]> {
  const conn = await openConnection();

  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: remapNamespace(sql),
      complete: (err, _stmt, rows) => {
        conn.destroy(() => {});
        if (err) return reject(err);
        resolve((rows as SnowflakeRow[]) || []);
      },
    });
  });
}

/** Execute a statement with BOUND parameters.
 *
 *  Use this for anything that writes user-supplied text. The alternative
 *  pattern in this codebase (see src/app/api/campaign) interpolates values into
 *  the SQL string with hand-rolled `.replace(/'/g, "''")` quote-doubling, and
 *  passes numerics through with no escaping at all. That is both an injection
 *  hole and a correctness bug: free-text prose containing an apostrophe --
 *  "don't exceed 8 weeks' cover" -- either breaks the statement or silently
 *  corrupts the stored value.
 *
 *  Binds hand the values to the driver separately from the SQL, so quoting stops
 *  being the caller's problem. `?` placeholders are positional.
 */
export async function querySnowflakeWithBinds(
  sql: string,
  binds: unknown[],
): Promise<SnowflakeRow[]> {
  const conn = await openConnection();

  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: remapNamespace(sql),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      binds: binds as any,
      complete: (err, _stmt, rows) => {
        conn.destroy(() => {});
        if (err) return reject(err);
        resolve((rows as SnowflakeRow[]) || []);
      },
    });
  });
}

/** Format a Snowflake DATE as an ISO date string (YYYY-MM-DD).
 *
 *  The Node driver returns DATE and TIMESTAMP columns as JavaScript Date
 *  objects, so `String(row.SOME_DATE)` yields
 *  "Thu Jan 07 2027 00:00:00 GMT+0000 (Coordinated Universal Time)". That string
 *  then leaks straight into chart axes and table cells, and any `.slice(0, 19)`
 *  intended to trim an ISO timestamp silently produces garbage. Always route
 *  date columns through here.
 */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  // Already ISO-ish: keep the date part as-is rather than re-parsing, which
  // would shift the value across a timezone boundary.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/** Format a Snowflake TIMESTAMP as "YYYY-MM-DD HH:MM:SS". Same reasoning. */
export function toIsoDateTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) return s.slice(0, 19).replace("T", " ");
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 19).replace("T", " ");
}

export async function executeMultiple(sqls: string[]): Promise<SnowflakeRow[][]> {
  const conn = await openConnection();

  return new Promise((resolve, reject) => {
    const results: SnowflakeRow[][] = [];
    let idx = 0;

    function next() {
      if (idx >= sqls.length) {
        conn.destroy(() => {});
        return resolve(results);
      }
      conn.execute({
        sqlText: remapNamespace(sqls[idx]),
        complete: (err, _stmt, rows) => {
          if (err) {
            conn.destroy(() => {});
            return reject(err);
          }
          results.push((rows as SnowflakeRow[]) || []);
          idx++;
          next();
        },
      });
    }

    next();
  });
}
