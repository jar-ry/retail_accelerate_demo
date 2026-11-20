import { describe, it, expect } from "vitest";
import { columnKind, fmtCell, humaniseColumn } from "./LookupChat";

// How a text-to-SQL result column is read from its alias.
describe("lookup result columns", () => {
  it("reads an amount whose alias names its weeks as money, not weeks", () => {
    expect(columnKind("REVENUE_FY25_SAME_WEEKS")).toBe("money");
    expect(fmtCell(4437766.4, "money", "AUD")).toBe("AUD 4.4M");
    expect(columnKind("TOTAL_WEEKS")).toBe("weeks");
    expect(columnKind("UNITS_SOLD")).toBe("num");
    expect(columnKind("GROWTH_PCT")).toBe("pct");
    // DISCOUNT contains COUNT; a discount amount is still money.
    expect(columnKind("DISCOUNT_COST")).toBe("money");
    expect(columnKind("CUSTOMER_COUNT")).toBe("num");
  });

  it("prints amounts in the agent's own currency", () => {
    expect(fmtCell(24_300_000, "money", "AUD")).toBe("AUD 24.3M");
    expect(fmtCell(219_938_238, "money", "PHP")).toBe("PHP 219.9M");
  });

  it("humanises aliases", () => {
    expect(humaniseColumn("REVENUE_FY26_YTD")).toBe("Revenue FY26 ytd");
    expect(humaniseColumn("VARIANCE_TO_BUDGET_PCT")).toBe("Variance to budget %");
  });
});
