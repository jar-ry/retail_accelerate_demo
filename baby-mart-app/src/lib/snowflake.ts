import snowflake from "snowflake-sdk";
import { readFileSync, existsSync } from "fs";

const SPCS_TOKEN_PATH = "/snowflake/session/token";

interface SnowflakeRow {
  [key: string]: any;
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
      database: "BABY_MART_DEMO",
      schema: "ANALYTICS",
      warehouse: "DEMO_ANALYTICS_WH",
    };
  }

  // Local development: use connection name from env or default
  return {
    account: process.env.SNOWFLAKE_ACCOUNT || "SFSEAPAC-JCHEN_AWS1",
    authenticator: "EXTERNALBROWSER",
    database: "BABY_MART_DEMO",
    schema: "ANALYTICS",
    warehouse: "DEMO_ANALYTICS_WH",
  };
}

export async function querySnowflake(sql: string): Promise<SnowflakeRow[]> {
  const conn = snowflake.createConnection(getConnectionOptions());

  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) return reject(err);

      conn.execute({
        sqlText: sql,
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
          sqlText: sqls[idx],
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
