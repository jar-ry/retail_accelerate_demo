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

/** Fully-qualified name of the Cortex Agent backing the chat page. */
export const AGENT_FQN = `${DB}.${SCHEMA_AI}.${
  process.env.BABY_MART_AGENT || "CATEGORY_MANAGER_AGENT"
}`;

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
  };
}

export async function querySnowflake(sql: string): Promise<SnowflakeRow[]> {
  const conn = snowflake.createConnection(getConnectionOptions());

  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) return reject(err);

      conn.execute({
        sqlText: remapNamespace(sql),
        complete: (err, _stmt, rows) => {
          conn.destroy(() => {});
          if (err) return reject(err);
          resolve((rows as SnowflakeRow[]) || []);
        },
      });
    });
  });
}

export async function executeMultiple(sqls: string[]): Promise<SnowflakeRow[][]> {
  const conn = snowflake.createConnection(getConnectionOptions());

  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) return reject(err);

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
  });
}
