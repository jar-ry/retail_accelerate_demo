import { describe, it, expect } from "vitest";
import { verifyCitations } from "./ai/grounded";
import {
  audShort, briefRequest, cardIsCurrent, cardText, currentBrief, factTiles, overrideWarning, pctToRule, readCard, ruleToPct, saveCard,
  stanceTitle, RULE_META, type BriefRow, type Evidence, type NegotiationRule,
} from "./meeting";

// Huggies as NEGOTIATION_EVIDENCE returned it on Snowhouse (trimmed).
const E = {
  ok: true, brand: "Huggies", category: "Nappies & Wipes", supplier: "Kimberly-Clark (Huggies)", distributor: "Kimberly-Clark ANZ",
  period: "FY2026 to date: 45 weeks to 7 May 2026 (POS)", weeks_traded: 45, annualise_factor: 1.16,
  sales: { revenue_aud: 927936, margin_aud: 349303, units: 35961, margin_pct: 37.6, margin_pct_category: 38.8, margin_gap_pp: -1.1, margin_gap_aud: -10616,
    revenue_growth_pct: -2.9, category_growth_pct: -2.6, share_pct: 36.9, share_change_pts: -0.1, rank_in_category: 1, brands_in_category: 5 },
  promo: { promo_discount_ytd_aud: 28480, promo_discount_annual_aud: 32910, margin_per_aud_discount: 0.98, best_mechanic: "% Off" },
  switching: { gained: 1062, lost: 1011, net: 51, top_loss_to: "Rascal + Friends", top_loss_to_count: 369 },
  price_vs_competitors_pct: 5.8,
  difot: { distributor: "Kimberly-Clark ANZ", target_pct: 96, recent_difot_pct: 85.3, before_difot_pct: 90.4, gap_to_target_pts: -10.7,
    attribution: "BABY_MART", ours_share_pct: 75.2, missed_lines: 15, missed_lines_supplier: 9, missed_lines_ours: 6, window: "2026-04-06 to 2026-06-11 (deliveries)" },
  customers: { clv_aud: 1090, customers: 27843 },
  range: [{ class: "Crawler Nappies", share_pct: 26.8 }, { class: "Pull-Ups", share_pct: 23.2 }],
  overrides: [{ override_id: "DOV-26-0415", class: "Crawler Nappies", status: "ACTIVE" }, { override_id: "DOV-26-0416", class: "Crawler Nappies", status: "ACTIVE" }],
  provenance: "REAL POS rows",
} as Evidence;

const brief = (briefId: string, status: string, createdAt: string): BriefRow => ({
  briefId, status, createdAt, brand: "Huggies", supplier: "K-C", category: "Nappies & Wipes", stance: "BALANCED",
  openingAud: 1, targetAud: 1, walkawayAud: 1, asks: [],
});

describe("supplier meeting", () => {
  it("names the stance in the brief tool's own vocabulary", () => {
    expect(briefRequest("Huggies", "FIRM", "Kimberly-Clark ANZ")).toBe("Build a FIRM negotiation brief for our Huggies meeting with Kimberly-Clark ANZ.");
    expect(briefRequest("Bugaboo", "BALANCED")).toBe("Build a BALANCED negotiation brief for our Bugaboo meeting.");
  });

  it("runs the meeting on the newest approved or draft brief", () => {
    const d1 = brief("NEG-26111810000001", "DRAFT", "2026-11-18 10:00");
    const a1 = brief("NEG-26111709000001", "APPROVED", "2026-11-17 09:00");
    const s1 = brief("NEG-26111908000001", "SUPERSEDED", "2026-11-19 08:00");
    // A draft built after the approval is the meeting being re-prepared.
    expect(currentBrief([d1, a1, s1])?.briefId).toBe(d1.briefId);
    expect(currentBrief([a1, s1])?.briefId).toBe(a1.briefId);
    expect(currentBrief([s1])).toBeNull();
  });

  it("shows the evidence as tiles without computing anything new", () => {
    const t = Object.fromEntries(factTiles(E).map((x) => [x.key, x]));
    expect(t.margin.value).toBe("37.6%");
    expect(t.margin.sub).toBe("category 38.8% · gap -1.1 pts");
    expect(t.difot.value).toBe("85.3%");
    expect(t.difot.sub).toContain("75.2% of misses are our ordering");
    expect(t.difot.tone).toBe("warn");
    expect(t.growth.value).toBe("-2.9%");
    expect(t.price.value).toBe("+5.8%");
    expect(t.switching.value).toBe("+51");
    expect(t.clv.value).toBe("AUD 1,090");
    expect(t.sales.value).toBe("AUD 928K");
    // Every figure a tile shows is one the evidence holds.
    const shown = factTiles(E).flatMap((x) => [x.value, x.sub]);
    expect(verifyCitations(E, [], shown).unmatched).toEqual([]);
  });

  it("puts the supplier's misses on the supplier when they are theirs", () => {
    const e = { ...E, difot: { ...E.difot!, attribution: "SUPPLIER" } } as Evidence;
    expect(factTiles(e).find((x) => x.key === "difot")!.sub).toBe("target 96% · 9 of 15 missed lines the supplier's");
  });

  it("warns against citing an override spike as growth", () => {
    expect(overrideWarning(E)).toContain("2 active planner overrides on Crawler Nappies (DOV-26-0415, DOV-26-0416)");
    expect(overrideWarning({ ...E, overrides: [] })).toBeNull();
  });

  it("flags a figure the battlecard invented", () => {
    // The checker catches invented magnitudes. It admits sums and differences of
    // supplied figures by design, so combining figures is held off by the prompt.
    const card = {
      key_arguments: {
        profitability: [{ name: "Range", description: "Two classes carry the brand.", data: "Crawler Nappies 26.8%, Pull-Ups 23.2%", argument: "Worth AUD 412,317 a year.", ask: "Ranging support", impact: 3 }],
        growth: [], others: [],
      },
      negotiation_approach: "Lead with the -1.1pp margin gap.", incentives: [], pressures: [],
    };
    const check = verifyCitations(E, [], cardText(card));
    expect(check.verified).toBe(false);
    expect(check.unmatched).toEqual(["prose: AUD 412,317"]);
  });

  it("formats AUD for a tile", () => {
    expect(audShort(-10616)).toBe("-AUD 10,616");
    expect(audShort(1234567)).toBe("AUD 1.23M");
    expect(audShort(null)).toBe("–");
  });

  it("keeps a battlecard for the page and the pack for 12 hours", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = { localStorage: {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } };
    try {
      saveCard("Huggies", { negotiation_approach: "Lead with A2" }, 1_000);
      expect(readCard<{ negotiation_approach: string }>("huggies", 1_000 + 3600_000)?.negotiation_approach).toBe("Lead with A2");
      expect(readCard("Huggies", 1_000 + 13 * 3600_000)).toBeNull();
      expect(readCard("Pampers", 1_000)).toBeNull();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });

  it("shows the negotiation rules as percentages and saves them back as stored", () => {
    const share = RULE_META.find((m) => m.key === "TARGET_SHARE_BALANCED")!;
    const pct = RULE_META.find((m) => m.key === "PROMO_FUND_OPENING_PCT")!;
    expect(ruleToPct(share, 0.6)).toBe(60);
    expect(pctToRule(share, 60)).toBe(0.6);
    expect(ruleToPct(pct, 50)).toBe(50);
    expect(pctToRule(pct, 50)).toBe(50);
    // Every rule BUILD_NEGOTIATION_BRIEF reads has a row on Settings.
    expect(RULE_META.map((m) => m.key).sort()).toEqual([
      "DEPENDENCY_SHARE_PCT", "DIFOT_CREDIT_PCT", "PROMO_FUND_OPENING_PCT",
      "TARGET_SHARE_BALANCED", "TARGET_SHARE_COLLABORATIVE", "TARGET_SHARE_FIRM", "WALKAWAY_SHARE",
    ]);
  });

  it("describes a stance from the live rules", () => {
    const rules: NegotiationRule[] = [{ key: "TARGET_SHARE_FIRM", value: 0.8 }, { key: "WALKAWAY_SHARE", value: 0.3 }];
    expect(stanceTitle("FIRM", rules)).toBe("Target keeps 80% of each opening ask; walk away below 30%");
    expect(stanceTitle("BALANCED", [])).toBe("Target keeps 60% of each opening ask");
  });

  it("writes the battlecard again when the SOP has changed", () => {
    const card = { sop: { name: "Supplier negotiation prep", version: 2 } };
    expect(cardIsCurrent(card, 2)).toBe(true);
    expect(cardIsCurrent(card, 3)).toBe(false);
    expect(cardIsCurrent({ sop: null }, null)).toBe(true);
    expect(cardIsCurrent(null, 2)).toBe(false);
  });
});
