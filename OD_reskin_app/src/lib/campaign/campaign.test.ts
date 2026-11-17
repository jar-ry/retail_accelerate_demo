import { describe, it, expect } from "vitest";
import { validateSpec, compileMatch, compileReach, compileSuppress, emptySpec, SpecError, describeSpec } from "./spec";
import { canTransition, launchGates } from "./state";
import { lift, shrunkCellLift, quadrantOf, pValue, campaignHealth } from "./stats";
import { planChannels } from "./optimiser";
import { verifyCitations } from "../ai/grounded";

// The Kmart -> Officeworks flow: school-age households with a child starting school.
const hero = {
  version: 1,
  all: [
    { field: "SCHOOL_SIGNAL_CONFIDENCE", op: "in", values: ["HIGH"] },
    { field: "STARTING_SCHOOL_LIKELY", op: "is_true" },
  ],
  any: [],
  exclude: [{ field: "LOYALTY_TIER", op: "in", values: ["Standard"] }],
  suppress: { fatigueDays: 14, coldContacts: true, stockConflict: true },
  channels: ["EMAIL", "SMS"],
  promoted: { category: "Technology", className: "Laptops", brand: "Apple" },
};

describe("audience spec", () => {
  it("validates and compiles to bound SQL", () => {
    const s = validateSpec(hero);
    const m = compileMatch(s);
    expect(m.where).toContain("SCHOOL_SIGNAL_CONFIDENCE IN (?)");
    expect(m.where).toContain("COALESCE(STARTING_SCHOOL_LIKELY, FALSE)");
    expect(m.where).toContain("NOT COALESCE(LOYALTY_TIER IN (?), FALSE)");
    expect(m.binds).toEqual(["HIGH", "Standard"]);
    expect(compileReach(s)).toBe("(COALESCE(EMAIL_OPT_IN, FALSE) OR COALESCE(SMS_OPT_IN, FALSE))");
  });

  it("never splices a value into SQL", () => {
    const s = validateSpec({ ...emptySpec(), all: [{ field: "OW_RECENCY_DAYS", op: "lte", value: 90 }] });
    const m = compileMatch(s);
    expect(m.where).toBe("OW_RECENCY_DAYS <= ?");
    expect(m.binds).toEqual([90]);
  });

  it("rejects a field outside the allow-list, including injection attempts", () => {
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "1=1; DROP TABLE CAMPAIGN; --", op: "in", values: ["x"] }] })).toThrow(SpecError);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "LIFETIME_SPEND", op: "gte", value: 1 }] })).toThrow(/not a field/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "constructor", op: "in", values: ["x"] }] })).toThrow(SpecError);
  });

  it("rejects a value outside an enum and a wrong type", () => {
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "LOYALTY_TIER", op: "in", values: ["Gold' OR '1'='1"] }] })).toThrow(/not a value/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "OW_RECENCY_DAYS", op: "lte", value: "90; --" }] })).toThrow(/numeric/);
    expect(() => validateSpec({ ...emptySpec(), all: [{ field: "OW_RECENCY_DAYS", op: "like", value: 9 }] })).toThrow(/comparison/);
    expect(() => validateSpec({ ...emptySpec(), channels: ["FAX"] })).toThrow(/channel/);
  });

  it("binds the promoted brand in the stock suppression", () => {
    const sup = compileSuppress(validateSpec(hero), "X.SUPPLY_POSITION");
    const stock = sup.find((x) => x.key === "stock")!;
    expect(stock.sql).toContain("BRAND_NAME = ?");
    expect(stock.binds).toEqual(["Apple"]);
    expect(sup.map((x) => x.key)).toEqual(["consent", "fatigue", "cold", "stock"]);
  });

  it("needs group data consent only when a Bunnings or Kmart signal is used", () => {
    const own = validateSpec({ ...emptySpec(), all: [{ field: "OW_RELATIONSHIP", op: "in", values: ["Active shopper"] }], suppress: { fatigueDays: null, coldContacts: true, stockConflict: false } });
    const sup = compileSuppress(own, "X");
    expect(sup.map((x) => x.key)).toEqual(["cold"]);
    expect(sup[0].sql).toBe("NEED = 'NO_SIGNAL_COLD'");
    // With a cross-banner signal the consent rule removes the unconsented, so
    // the cold rule counts only consented members and nobody is counted twice.
    const cold = compileSuppress(validateSpec(hero), "X").find((x) => x.key === "cold")!;
    expect(cold.sql).toContain("GROUP_DATA_CONSENT");
  });

  it("describes a spec in words", () => {
    expect(describeSpec(validateSpec(hero))).toContain("School-age children signal: HIGH");
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
    // Last year's school-list users: a big gain, but small next to what they buy anyway.
    expect(quadrantOf(3, 0.36)).toBe("SURE_THING");
  });

  it("health is the sum of its parts", () => {
    const h = campaignHealth({ liftPp: 3, significant: true, pacingGapPts: 0, bounceRate: 0, unsubRate: 0, complaintRate: 0, coldShare: 0 });
    expect(h.score).toBe(100);
    expect(campaignHealth({ liftPp: 3, significant: true, pacingGapPts: 0, bounceRate: 0, unsubRate: 0, complaintRate: 0, coldShare: 0.5 }).parts.targeting).toBe(0);
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
    const supplied = { offer: { saving_aud: 150, terms: "$150 off a laptop and printer bundle over $1,200" }, products: [{ name: "HP Envy 6 Printer", price_aud: 199 }] };
    expect(verifyCitations(supplied, [], ["Save $150 on a laptop and the HP Envy 6 Printer at $199."]).verified).toBe(true);
    expect(verifyCitations(supplied, [], ["Save $300 on every laptop."]).verified).toBe(false);
  });
});
