import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryTransaction } from "./snowflake";

/**
 * queryTransaction carries the audit trail's integrity: a plan change and the
 * row that records it must land together or not at all. These tests pin that
 * statements run one at a time, in order, inside one transaction; that anything
 * thrown -- a failed statement or a check made by the caller -- rolls back; and
 * that the connection is released either way.
 */
const driver = vi.hoisted(() => ({ log: [] as string[], failOn: [] as string[], inFlight: 0, maxInFlight: 0 }));

vi.mock("snowflake-sdk", () => ({
  default: {
    createConnection: () => ({
      connectAsync: (cb: (err: unknown) => void) => cb(null),
      connect: (cb: (err: unknown) => void) => cb(null),
      execute: ({ sqlText, complete }: { sqlText: string; complete: (err: unknown, stmt: unknown, rows?: unknown[]) => void }) => {
        driver.log.push(sqlText);
        driver.maxInFlight = Math.max(driver.maxInFlight, ++driver.inFlight);
        setTimeout(() => {
          driver.inFlight--;
          if (driver.failOn.some((f) => sqlText.includes(f))) complete(new Error(`failed: ${sqlText}`), null);
          else complete(null, null, [{ SQL: sqlText }]);
        }, 1);
      },
      destroy: () => driver.log.push("DESTROY"),
    }),
  },
}));

beforeEach(() => {
  // Local runs need an account; the driver itself is mocked.
  process.env.SNOWFLAKE_ACCOUNT = "TEST";
  driver.log = [];
  driver.failOn = [];
  driver.inFlight = 0;
  driver.maxInFlight = 0;
});

describe("queryTransaction", () => {
  it("runs statements one at a time, in order, and commits", async () => {
    const out = await queryTransaction(async (run) => {
      await run("INSERT A");
      const rows = await run("SELECT ID", [1]);
      await run("INSERT B");
      return rows[0].SQL;
    });
    expect(out).toBe("SELECT ID");
    expect(driver.log).toEqual(["BEGIN TRANSACTION", "INSERT A", "SELECT ID", "INSERT B", "COMMIT", "DESTROY"]);
    expect(driver.maxInFlight).toBe(1);
  });

  it("rolls back when a statement fails, and runs nothing after it", async () => {
    driver.failOn = ["INSERT B"];
    await expect(
      queryTransaction(async (run) => {
        await run("INSERT A");
        await run("INSERT B");
        await run("INSERT C");
      }),
    ).rejects.toThrow("failed: INSERT B");
    expect(driver.log).toEqual(["BEGIN TRANSACTION", "INSERT A", "INSERT B", "ROLLBACK", "DESTROY"]);
  });

  it("rolls back when the caller's own check throws", async () => {
    await expect(
      queryTransaction(async (run) => {
        await run("INSERT A");
        throw new Error("wrote 3 of 4 measures");
      }),
    ).rejects.toThrow("wrote 3 of 4 measures");
    expect(driver.log).toEqual(["BEGIN TRANSACTION", "INSERT A", "ROLLBACK", "DESTROY"]);
  });

  it("reports the original error even when the rollback also fails", async () => {
    driver.failOn = ["INSERT A", "ROLLBACK"];
    await expect(queryTransaction((run) => run("INSERT A"))).rejects.toThrow("failed: INSERT A");
    expect(driver.log.at(-1)).toBe("DESTROY");
  });

  it("does not commit if COMMIT itself fails", async () => {
    driver.failOn = ["COMMIT"];
    await expect(queryTransaction((run) => run("INSERT A"))).rejects.toThrow("failed: COMMIT");
    expect(driver.log).toEqual(["BEGIN TRANSACTION", "INSERT A", "COMMIT", "ROLLBACK", "DESTROY"]);
  });
});
