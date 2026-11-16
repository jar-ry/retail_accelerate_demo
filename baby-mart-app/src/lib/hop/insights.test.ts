import { describe, expect, it } from "vitest";
import { verifyCitations, extractFigures } from "./insights";

/**
 * The citation guardrail is the load-bearing safety property of the insights
 * feature. An insight quoting a dollar figure we never supplied is
 * indistinguishable, to a reader, from a measured one. These tests pin both
 * halves: invention is caught, and legitimate reasoning is not flagged -- a
 * guardrail that cries wolf gets ignored.
 */
const PAYLOAD = {
  plan_sales_aud: 90317701.6,
  ly_sales_aud: 83627369,
  lfl_growth_pct: 4.32,
  plan_margin_pct: 37.95,
  first_margin_pct: 40.32,
  exit_margin_pct_actual: 37.78,
  growth_break_pts: -7.5,
  hardgoods_gap_aud: -3778000,
  stores: 64,
  new_stores: 4,
  cover_weeks: 14.0,
};

describe("verifyCitations", () => {
  it("accepts a figure exactly as supplied", () => {
    expect(verifyCitations(PAYLOAD, ["lfl_growth_pct: 4.32"]).verified).toBe(true);
  });

  it("accepts a rounded form at the precision written", () => {
    expect(verifyCitations(PAYLOAD, ["4.3%"]).verified).toBe(true);
    expect(verifyCitations(PAYLOAD, [], ["the plan is $90.3M"]).verified).toBe(true);
    expect(verifyCitations(PAYLOAD, [], ["a $3.78M shortfall in hardgoods"]).verified).toBe(true);
  });

  it("accepts arithmetic within a unit", () => {
    // 40.32 - 37.78 = 2.54: the gap between first and exit margin is the point.
    expect(verifyCitations(PAYLOAD, [], ["a 2.5 pt gap between first and exit margin"]).verified).toBe(true);
  });

  it("catches a percentage that is merely close to a supplied one", () => {
    // The reference accepted anything within 0.51 of any figure, so 4.1% passed
    // against a supplied 4.32%. At one decimal it is a different claim.
    const r = verifyCitations(PAYLOAD, [], ["like-for-like is 4.1%"]);
    expect(r.verified).toBe(false);
    expect(r.unmatched.join()).toContain("4.1%");
  });

  it("does not let a dollar figure match a percentage", () => {
    // 7.5 pts is supplied; $7.5M is not.
    expect(verifyCitations(PAYLOAD, [], ["a $7.5M gap"]).verified).toBe(false);
  });

  it("catches an invented magnitude in a declared citation", () => {
    const r = verifyCitations(PAYLOAD, ["cover: 47.5 wks"]);
    expect(r.verified).toBe(false);
    expect(r.unmatched.join()).toContain("47.5");
  });

  it("catches an invented magnitude that appears only in prose", () => {
    const r = verifyCitations(PAYLOAD, ["lfl_growth_pct: 4.32"], ["margin will fall to 31.2% next half"]);
    expect(r.verified).toBe(false);
    expect(r.unmatched.join()).toContain("31.2%");
  });

  it("does not treat codes, years, dates or small counts as claims", () => {
    expect(
      verifyCitations(PAYLOAD, [], [
        "FY27 H1 for S048 and department 050",
        "in 2027, across 4 openings, actuals to 3 May 2026 and since 29 Dec",
      ]).verified,
    ).toBe(true);
  });

  it("sees a figure that arrives in scientific notation", () => {
    expect(verifyCitations({ plan_sales_aud: 9.03177016e7 }, ["$90.32M"]).verified).toBe(true);
  });

  it("takes its tolerance from how a figure is written, not its size", () => {
    // $0.23M is $227,804 to the nearest $10K; judging it at a thousand-dollar
    // scale because the value is under a million wrongly flagged it.
    expect(verifyCitations({ dropped_aud: 227804 }, [], ["Nappies & Wipes at $0.23M"]).verified).toBe(true);
    expect(verifyCitations({ dropped_aud: 227804 }, [], ["Nappies & Wipes at $0.26M"]).verified).toBe(false);
  });

  it("admits a difference of counts, and catches a wrong difference of amounts", () => {
    const supplied = { presented: 2266, committed: 1999, top_down_aud: 55031383, bottom_up_aud: 53179365 };
    expect(verifyCitations(supplied, [], ["267 options were dropped"]).verified).toBe(true);
    // The model once wrote a $3.85M gap for $55.03M against $53.18M. It is $1.85M.
    expect(verifyCitations(supplied, [], ["a gap of $1.85M"]).verified).toBe(true);
    expect(verifyCitations(supplied, [], ["roughly $3.85M in missing revenue"]).verified).toBe(false);
  });

  it("reads basis points and allows truncation to the written digit", () => {
    expect(verifyCitations({ a_pct: 38.0, b_pct: 37.47 }, [], ["53 basis points below budget"]).verified).toBe(true);
    expect(verifyCitations({ gap_aud: 477562 }, [], ["the gap is $477K"]).verified).toBe(true);
    expect(verifyCitations({ gap_aud: 477562 }, [], ["the gap is $490K"]).verified).toBe(false);
  });

  it("allows rounding either way but truncation only downward", () => {
    expect(verifyCitations({ v_pct: 4.36 }, [], ["4.4%"]).verified).toBe(true);
    expect(verifyCitations({ v_pct: 4.39 }, [], ["4.3%"]).verified).toBe(true);
    // A whole unit upward would let 4.1% ride on a count of 4.
    expect(verifyCitations({ openings: 4 }, [], ["4.1%"]).verified).toBe(false);
  });

  it("admits a number quoted from the method the model was given", () => {
    // The doctrine is part of the prompt: quoting "cover above 26 weeks" is not invention.
    const supplied = { figures: PAYLOAD, method: "6. Forward cover above 26 weeks is a data problem." };
    expect(verifyCitations(supplied, [], ["cover above 26 weeks is a data problem"]).verified).toBe(true);
    expect(verifyCitations(PAYLOAD, [], ["cover above 26 weeks is a data problem"]).verified).toBe(false);
  });

  it("reports each unmatched figure once per source", () => {
    const r = verifyCitations(PAYLOAD, ["47.5 wks"], ["47.5 wks of cover", "still 47.5 wks"]);
    expect(r.unmatched.filter((u) => u.includes("47.5")).length).toBeLessThanOrEqual(2);
  });
});

describe("extractFigures", () => {
  it("reads units and scale", () => {
    const [a, b, c] = extractFigures("$3.78M, 4.3% and -7.5 pts");
    expect(a).toMatchObject({ unit: "money", value: 3780000, decimals: 2 });
    expect(b).toMatchObject({ unit: "pct", value: 4.3 });
    expect(c).toMatchObject({ unit: "pct", value: -7.5 });
  });
});
