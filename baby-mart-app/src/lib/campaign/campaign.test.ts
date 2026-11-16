import { describe, it, expect } from "vitest";
import { validateSpec, compileMatch, compileReach, compileSuppress, emptySpec, SpecError, describeSpec } from "./spec";
import { canTransition, launchGates } from "./state";
import { lift, shrunkCellLift, quadrantOf, pValue, campaignHealth } from "./stats";
import { planChannels } from "./optimiser";
import { verifyCitations } from "../ai/grounded";

const hero = {
  version: 1,
  all: [
    { field: "CAR_SEAT_LAST_CLASS", op: "in", values: ["Capsule (0-6m)"] },
    { field: "CAR_SEAT_DUE_STATUS", op: "in", values: ["DUE_NOW"] },
  ],
  any: [],
  exclude: [{ field: "LOYALTY_TIER", op: "in", values: ["Bronze"] }],
  suppress: { fatigueDays: 14, priceComplainers: true, openComplaints: false, stockConflict: true },
  channels: ["EMAIL", "SMS"],
  promoted: { category: "Car Seats", className: "Convertible (0-4y)", brand: "Britax" },
};

describe("audience spec", () => {
  it("validates and compiles to bound SQL", () => {
    const s = validateSpec(hero);
    const m = compileMatch(s);
    expect(m.where).toContain("CAR_SEAT_LAST_CLASS IN (?)");
    expect(m.where).toContain("NOT COALESCE(LOYALTY_TIER IN (?), FALSE)");
    expect(m.binds).toEqual(["Capsule (0-6m)", "DUE_NOW", "Bronze"]);
    expect(compileReach(s)).toBe("(COALESCE(EMAIL_OPT_IN, FALSE) OR COALESCE(SMS_OPT_IN, FALSE))");
  });

  it("never splices a value into SQL", () => {
    const s = validateSpec({ ...emptySpec(), all: [{ field: "RECENCY_DAYS", op: "lte", value: 90 }] });
    const m = compileMatch(s);
    expect(m.where).toBe("RECENCY_DAYS <= ?");
    expect(m.binds).toEqual([90]);
  });

  it("rejects a field outside the allow-list, including injection attempts", () => {
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "1=1; DROP TABLE CAMPAIGN; --", op: "in", values: ["x"] }] })).toThrow(SpecError);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "LIFETIME_SPEND", op: "gte", value: 1 }] })).toThrow(/not a field/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "constructor", op: "in", values: ["x"] }] })).toThrow(SpecError);
  });

  it("rejects a value outside an enum and a wrong type", () => {
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "LOYALTY_TIER", op: "in", values: ["Gold' OR '1'='1"] }] })).toThrow(/not a value/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "RECENCY_DAYS", op: "lte", value: "90; --" }] })).toThrow(/numeric/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "RECENCY_DAYS", op: "like", value: 9 }] })).toThrow(/comparison/);
    expect(() => validateSpec({ ...emptySpec(), channels: ["FAX"] })).toThrow(/channel/);
  });

  it("binds the promoted brand in the stock suppression", () => {
    const sup = compileSuppress(validateSpec(hero), "X.SUPPLY_POSITION");
    const stock = sup.find((x) => x.key === "stock")!;
    expect(stock.sql).toContain("BRAND_NAME = ?");
    expect(stock.binds).toEqual(["Britax"]);
    expect(sup.map((x) => x.key)).toEqual(["fatigue", "price", "stock"]);
  });

  it("describes a spec in words", () => {
    expect(describeSpec(validateSpec(hero))).toContain("Last car seat bought: Capsule (0-6m)");
  });
});

describe("lifecycle", () => {
  it("allows only listed transitions", () => {
    expect(canTransition("BRIEF", "AUDIENCE_LOCKED")).toBe(true);
    expect(canTransition("LIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "LIVE")).toBe(true);
    expect(canTransition("BRIEF", "LIVE")).toBe(false);
    expect(canTransition("MEASURED", "LIVE")).toBe(false);
  });

  it("fails a launch gate for stock conflicts and budget", () => {
    const g = launchGates({ audienceLocked: true, treated: 900, holdout: 100, variantsApproved: 2, variantsBlocked: 0, channelPlanned: true,
      plannedCostAud: 1200, budgetAud: 1000, stockConflicts: 12, fatigueBreaches: 0 });
    expect(g.filter((x) => !x.pass).map((x) => x.key)).toEqual(["budget", "stock"]);
  });
});

describe("measurement", () => {
  it("lift is treated rate minus holdout rate, with a CI", () => {
    const l = lift({ n: 9000, conv: 900 }, { n: 1000, conv: 70 });
    expect(l.liftPp).toBeCloseTo(3, 6);
    expect(l.incremental).toBeCloseTo(270, 6);
    expect(l.significant).toBe(true);
    expect(l.ciLowPp!).toBeLessThan(3);
    expect(l.ciHighPp!).toBeGreaterThan(3);
  });

  it("is not significant when the interval spans zero", () => {
    const l = lift({ n: 900, conv: 54 }, { n: 100, conv: 5 });
    expect(l.significant).toBe(false);
    expect(pValue(l.z)!).toBeGreaterThan(0.05);
  });

  it("shrinks a small cell towards the pooled lift", () => {
    const m = shrunkCellLift([
      { key: "big", treated: { n: 20000, conv: 1400 }, holdout: { n: 2000, conv: 100 } },
      { key: "tiny", treated: { n: 360, conv: 60 }, holdout: { n: 40, conv: 0 } },
    ]);
    const tiny = m.get("tiny")!;
    expect(tiny.liftPp).toBeLessThan(16.7 / 2);
    expect(tiny.weight).toBeLessThan(0.2);
  });

  it("assigns quadrants", () => {
    expect(quadrantOf(2.5, 0.03)).toBe("PERSUADABLE");
    expect(quadrantOf(0.2, 0.12)).toBe("SURE_THING");
    expect(quadrantOf(0.2, 0.02)).toBe("LOST_CAUSE");
    expect(quadrantOf(-1.4, 0.06)).toBe("SLEEPING_DOG");
  });

  it("health is the sum of its parts", () => {
    const h = campaignHealth({ liftPp: 3, significant: true, pacingGapPts: 0, bounceRate: 0, unsubRate: 0, complaintRate: 0, negativeReplyShare: 0 });
    expect(h.score).toBe(100);
  });
});

describe("channel optimiser", () => {
  const base = {
    allowed: ["EMAIL", "SMS"] as ("EMAIL" | "SMS")[],
    costPerSend: { EMAIL: 0.03, SMS: 0.08 },
    channelFactor: { EMAIL: 0.4, SMS: 1.6 },
    marginPerConversion: 180, offerCostPerConversion: 40, sendsPerMember: 2,
  };
  it("picks the channel with the most net incremental margin", () => {
    const p = planChannels({ ...base, budgetAud: 1e6, groups: [{ key: "g1", n: 1000, liftPp: 3, reachable: ["EMAIL", "SMS"] }] });
    expect(p.assignments[0].channel).toBe("SMS");
    expect(p.withinBudget).toBe(true);
  });
  it("downgrades to stay within budget", () => {
    const groups = [
      { key: "strong", n: 5000, liftPp: 4, reachable: ["EMAIL", "SMS"] as ("EMAIL" | "SMS")[] },
      { key: "weak", n: 5000, liftPp: 0.5, reachable: ["EMAIL", "SMS"] as ("EMAIL" | "SMS")[] },
    ];
    const p = planChannels({ ...base, budgetAud: 1200, groups });
    expect(p.totalCost).toBeLessThanOrEqual(1200.005);
    expect(p.assignments.find((a) => a.key === "strong")!.channel).toBe("SMS");
    expect(p.assignments.find((a) => a.key === "weak")!.channel).not.toBe("SMS");
  });
  it("never uses a channel the member did not consent to", () => {
    const p = planChannels({ ...base, budgetAud: 1e6, groups: [{ key: "emailOnly", n: 100, liftPp: 5, reachable: ["EMAIL"] }] });
    expect(p.assignments[0].channel).toBe("EMAIL");
  });
});

describe("copy guardrail", () => {
  it("flags a price the catalogue did not supply", () => {
    const supplied = { offer: { saving_aud: 40, terms: "$40 off convertible car seats over $299" }, products: [{ name: "Britax Graphene", price_aud: 549 }] };
    expect(verifyCitations(supplied, [], ["Save $40 on the Britax Graphene, now $509."]).verified).toBe(true);
    expect(verifyCitations(supplied, [], ["Save $60 on every convertible."]).verified).toBe(false);
  });
});
