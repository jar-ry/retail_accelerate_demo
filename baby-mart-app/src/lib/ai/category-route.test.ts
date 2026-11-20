import { describe, it, expect } from "vitest";
import { namedBrand, routeCategoryQuestion, type CategoryMode, type CategoryRoute } from "./category-route";

const BRANDS = ["Huggies", "Bugaboo", "Mountain Buggy", "Rascal + Friends", "Maxi-Cosi", "Bonds", "Bonds Baby", "Pigeon"];
const route = (q: string, extra: { mode?: CategoryMode; previous?: CategoryRoute } = {}) =>
  routeCategoryQuestion(q, { brands: BRANDS, ...extra }).route;

describe("Category Agent routing", () => {
  it("sends a brand's root cause to the Brand Investigator", () => {
    expect(route("Why is Bugaboo down on last year?")).toBe("investigate");
    expect(route("What drove the Huggies Crawler Nappies spike?")).toBe("investigate");
    expect(route("What is behind Mountain Buggy's growth?")).toBe("investigate");
    expect(route("what's driving rascal + friends")).toBe("investigate");
  });

  it("keeps lookups, rankings and cross-brand questions with the text-to-SQL agent", () => {
    expect(route("Top 5 brands by revenue growth this year")).toBe("lookup");
    expect(route("Which brands are losing the most customers in Nappies & Wipes?")).toBe("lookup");
    expect(route("Compare Huggies promotion effectiveness by mechanic")).toBe("lookup");
    expect(route("What is Huggies' margin by class?")).toBe("lookup");
    expect(route("Which brands are down, and why?")).toBe("lookup");
    expect(route("Why are Car Seats down?")).toBe("lookup"); // a category, not a brand
  });

  it("keeps a follow-up with the agent that answered the last turn", () => {
    expect(route("What about the prior 28 days?", { previous: "investigate" })).toBe("investigate");
    expect(route("What about the prior 28 days?", { previous: "lookup" })).toBe("lookup");
    // A ranking after an investigation is a new lookup.
    expect(route("Which stores carry it in QLD?", { previous: "investigate" })).toBe("lookup");
  });

  it("lets the user override the route", () => {
    expect(route("Why is Bugaboo down on last year?", { mode: "lookup" })).toBe("lookup");
    expect(route("Bugaboo sales by state", { mode: "investigate" })).toBe("investigate");
  });

  it("still investigates when the brand list did not load", () => {
    expect(routeCategoryQuestion("Why is Bugaboo down?", { brands: [] }).route).toBe("investigate");
  });

  it("matches brand names on word edges, longest first", () => {
    expect(namedBrand("How is Bonds Baby tracking?", BRANDS)).toBe("Bonds Baby");
    expect(namedBrand("maxi-cosi margin", BRANDS)).toBe("Maxi-Cosi");
    expect(namedBrand("Pigeonhole the data", BRANDS)).toBeNull();
  });
});
