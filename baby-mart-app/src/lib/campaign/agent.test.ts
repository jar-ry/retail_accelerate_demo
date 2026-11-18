import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { splitBlock, verifyAnswer, toolPayload, type ToolResult } from "./agent-answer";
import { testHypothesis, sizeAudience, createDraft, type Row } from "./tools";
import * as SQL from "./sql";
import { applyEvent, type Turn } from "@/components/agent/useAgentRun";
import { describeInput } from "@/components/agent/ProgressTrail";

// Recorded runs of the two agents on canonical (trimmed to tool events and the
// final text): the investigator on camp-001, the builder on the capsule brief.
type Fixture = { question: string; text: string; events: { event: string; data: Record<string, unknown> }[] };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", `agent_${name}.json`), "utf8"));
const results = (f: Fixture): ToolResult[] => f.events.filter((e) => e.event === "response.tool_result")
  .map((e) => ({ name: String(e.data.name), status: String(e.data.status), content: e.data.content }));

describe("agent answer blocks", () => {
  it("finds the block after the agent's narration and keeps the markdown after it", () => {
    const f = fixture("inv_001");
    const s = splitBlock<{ headline: string; hypotheses: unknown[] }>(f.text, "rca");
    expect(s.block?.headline).toMatch(/Rascal \+ Friends/);
    expect(s.block?.hypotheses.length).toBeGreaterThanOrEqual(3);
    expect(s.before.trim()).toBe("Now the charts.");
    expect(s.after).toMatch(/^## What happened/);
  });

  it("reports a block still streaming, and one that is not JSON", () => {
    expect(splitBlock("```campaign\n{\"name\": \"half", "campaign")).toMatchObject({ pending: true, block: null });
    expect(splitBlock("```rca\n{not json}\n```\nrest", "rca")).toMatchObject({ block: null, after: "rest" });
    expect(splitBlock("```rca\n{not json}\n```", "rca").error).toMatch(/not valid JSON/);
    expect(splitBlock("no block here", "ideas")).toMatchObject({ block: null, pending: false, before: "no block here" });
  });

  it("reads procedure, search and Analyst results as data, and skips charts", () => {
    const p = toolPayload([
      { name: "SizeAudience", status: "success", content: [{ json: { result: "{\"final_audience\":244}" } }] },
      { name: "VoiceSearch", status: "success", content: [{ json: { search_results: [{ text: "Penrith has none" }] } }] },
      { name: "CustomerSignals", status: "success", content: [{ json: { result_set: { data: [["DUE_NOW", "1689"]] } } }] },
      { name: "data_to_chart", status: "success", content: [{ json: { charts: ["{}"] } }] },
      { name: "SizeAudience", status: "error", content: [{ json: { result: "{\"final_audience\":999}" } }] },
    ]);
    expect(p).toEqual([{ final_audience: 244 }, ["Penrith has none"], [["DUE_NOW", "1689"]]]);
  });

  it("verifies the recorded answers against their own tool results", () => {
    for (const [name, tag] of [["inv_001", "rca"], ["build_capsule", "campaign"]] as const) {
      const f = fixture(name);
      const s = splitBlock(f.text, tag);
      const v = verifyAnswer(tag, s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("flags an invented amount or count", () => {
    const f = fixture("inv_001");
    const s = splitBlock(f.text, "rca");
    const v = verifyAnswer("rca", s.block, `${s.after}\nIt cost AUD 48,215 across 7,913 members.`, results(f), f.question);
    expect(v.verified).toBe(false);
    expect(v.unmatched).toEqual(["prose: AUD 48,215", "prose: 7,913"]);
  });
});

// Recorded runs of the Global Planning agents on canonical (agent/deploy_plan_agents.sql):
// the investigator on PRAMS & STROLLERS, the builder on a PHP 2M goal seek and on
// an open-ended "behind budget and overbought" request.
describe("planning agent answers", () => {
  it("verifies every PHP figure the planning agents wrote against their tools", () => {
    for (const [name, tag] of [["plan_inv_prams", "rca"], ["plan_build_single", "scenario"], ["plan_build_prams", "scenario"]] as const) {
      const f = fixture(name);
      const s = splitBlock(f.text, tag);
      expect(s.block).not.toBeNull();
      const v = verifyAnswer(tag, s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("finds the budget set above demand and rules out a class, month or supplier", () => {
    const b = splitBlock<{ headline: string; hypotheses: { hypothesis: string; verdict: string }[]; actions: { scenario_prompt?: string | null }[] }>(
      fixture("plan_inv_prams").text, "rca").block!;
    expect(b.headline).toMatch(/budget/i);
    const verdict = (re: RegExp) => b.hypotheses.find((h) => re.test(h.hypothesis))?.verdict;
    expect(verdict(/budget/i)).toBe("CONFIRMED");
    expect(verdict(/class/i)).toBe("RULED_OUT");
    expect(verdict(/supplier/i)).toBe("RULED_OUT");
    expect(b.actions.some((a) => a.scenario_prompt)).toBe(true);
  });

  it("blocks the price option the solver cannot reach and recommends one that can", () => {
    const b = splitBlock<{ options: { scenario_id: string; achievable: boolean; guardrails: { level: string }[] }[]; recommended: string }>(
      fixture("plan_build_single").text, "scenario").block!;
    const price = b.options.find((o) => o.achievable === false)!;
    expect(price.guardrails.some((g) => g.level === "BLOCK")).toBe(true);
    expect(b.recommended).not.toBe(price.scenario_id);
    expect(b.options.map((o) => o.scenario_id)).toContain(b.recommended);
  });

  it("flags an invented peso amount", () => {
    const f = fixture("plan_build_single");
    const s = splitBlock(f.text, "scenario");
    const v = verifyAnswer("scenario", s.block, `${s.after}\nThis also frees PHP 777.7M of open-to-buy.`, results(f), f.question);
    expect(v.verified).toBe(false);
    expect(v.unmatched).toEqual(["prose: PHP 777.7M"]);
  });

  it("reads an abbreviated scenario id as a code, not a figure", () => {
    const f = fixture("plan_build_single");
    const s = splitBlock(f.text, "scenario");
    const v = verifyAnswer("scenario", s.block, `${s.after}\nGo with 2b (SCN-59fb…9441).`, results(f), f.question);
    expect(v.unmatched).toEqual([]);
  });

  it("describes the planning tools' steps in words", () => {
    expect(describeInput("TestPlanHypothesis", { NODE: "PRAMS & STROLLERS", DIMENSION: "traded" })).toBe("PRAMS & STROLLERS · split by traded");
    expect(describeInput("GoalSeek", { NODE: "SINGLE STROLLER", TARGET_GP_PHP: 2000000, HALF: "H2" })).toBe("SINGLE STROLLER · PHP 2.0M GP · H2");
    expect(describeInput("RangeCut", { CLASS_NAME: "TRAVEL SYSTEM", BOTTOM_PCT: 25, HALF: "H2" })).toBe("TRAVEL SYSTEM · bottom 25% · H2");
  });
});

// Recorded runs of the Head of Planning investigator on canonical (agent/deploy_hop_agents.sql):
// QLD like-for-like, the planning chain, and the weakest VIC stores.
describe("head of planning investigator answers", () => {
  type Rca = { headline: string; hypotheses: { hypothesis: string; verdict: string }[]; actions: { owner: string }[] };
  const rca = (name: string) => splitBlock<Rca>(fixture(name).text, "rca").block!;
  const verdict = (b: Rca, re: RegExp) => b.hypotheses.find((h) => re.test(h.hypothesis))?.verdict;

  it("verifies every AUD figure and point it wrote against its tools", () => {
    for (const name of ["hop_qld", "hop_chain", "hop_vic"]) {
      const f = fixture(name);
      const s = splitBlock(f.text, "rca");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("rca", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("explains QLD by store mix and rules out edits since approval", () => {
    const b = rca("hop_qld");
    expect(b.headline).toMatch(/mix|which stores/i);
    expect(verdict(b, /mix/i)).toBe("CONFIRMED");
    expect(verdict(b, /edit/i)).toBe("RULED_OUT");
  });

  it("puts the planning-chain gap on the Prams range and gives the move to Buying", () => {
    const b = rca("hop_chain");
    expect(b.headline).toMatch(/Prams/i);
    expect(verdict(b, /top-down|target/i)).toBe("RULED_OUT");
    expect(verdict(b, /department/i)).toBe("CONFIRMED");
    expect(b.actions[0].owner).toBe("Buying");
  });

  it("finds VIC in line and names the refurbishment and cannibalisation", () => {
    const b = rca("hop_vic");
    expect(b.headline).toMatch(/in line/i);
    expect(verdict(b, /refurb/i)).toBe("CONFIRMED");
    expect(verdict(b, /cannibal/i)).toBe("CONFIRMED");
    expect(verdict(b, /mix/i)).toBe("RULED_OUT");
  });

  it("describes the investigator's steps in words", () => {
    expect(describeInput("TestStoreHypothesis", { SCOPE: "QLD", DIMENSION: "mix" })).toBe("QLD · split by mix");
    expect(describeInput("TestChainGap", { NODE: "200", DIMENSION: "owner" })).toBe("200 · split by owner");
  });
});

// Recorded runs of the Category Manager's brand investigator on canonical
// (agent/deploy_brand_agents.sql): the Huggies Crawler "spike", Bugaboo's decline
// and Mountain Buggy's growth.
describe("brand investigator answers", () => {
  type Rca = { headline: string; hypotheses: { hypothesis: string; verdict: string; evidence: string }[]; actions: { owner: string; action: string }[] };
  const rca = (name: string) => splitBlock<Rca>(fixture(name).text, "rca").block!;
  const verdict = (b: Rca, re: RegExp) => b.hypotheses.find((h) => re.test(h.hypothesis))?.verdict;
  const tools = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use").map((e) => String(e.data.name));

  it("verifies every AUD figure and percentage it wrote against its tools", () => {
    for (const name of ["brand_crawler", "brand_bugaboo", "brand_mountain"]) {
      const f = fixture(name);
      const s = splitBlock(f.text, "rca");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("rca", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("checks the Crawler spike against POS and traces it to the planner override, not demand", () => {
    expect(tools("brand_crawler")).toContain("CheckReportedDemand");
    const b = rca("brand_crawler");
    expect(b.headline).toMatch(/override/i);
    expect(b.headline).toMatch(/feed|not in sales|not real|flat/i);
    expect(verdict(b, /artefact|artifact|override/i)).toBe("CONFIRMED");
    expect(verdict(b, /step|week|spike/i)).toBe("RULED_OUT");
    // The DIFOT collapse is a risk to raise with the supplier, not the cause of a sales move.
    expect(verdict(b, /supply/i)).not.toBe("CONFIRMED");
    // An override past its review date is Demand Planning's to remove.
    expect(b.actions.some((a) => a.owner === "Demand Planning")).toBe(true);
    // Business terms only: the answer never describes how the data was built.
    expect(fixture("brand_crawler").text).not.toMatch(/hardcod|view definition|generated data/i);
  });

  it("finds Bugaboo's decline brand-specific and volume-led, and rules out supply", () => {
    const b = rca("brand_bugaboo");
    expect(verdict(b, /market/i)).toBe("RULED_OUT");
    expect(verdict(b, /price/i)).toBe("RULED_OUT");
    expect(verdict(b, /supply|stock/i)).toBe("RULED_OUT");
  });

  it("puts Mountain Buggy's growth on Single Strollers and the brand, not the market", () => {
    const b = rca("brand_mountain");
    expect(b.headline).toMatch(/Single Stroller/i);
    expect(verdict(b, /market/i)).toBe("RULED_OUT");
    expect(verdict(b, /Single Stroller/i)).toBe("CONFIRMED");
  });

  it("describes the brand investigator's steps in words", () => {
    expect(describeInput("BrandEvidence", { BRAND: "Huggies", CLASS: "Crawler Nappies" })).toBe("Huggies · Crawler Nappies");
    expect(describeInput("BrandEvidence", { BRAND: "Bugaboo", CLASS: "" })).toBe("Bugaboo");
    expect(describeInput("TestBrandHypothesis", { BRAND: "Huggies", CLASS: "Crawler Nappies", DIMENSION: "supply" })).toBe("Huggies Crawler Nappies · split by supply");
    expect(describeInput("CheckReportedDemand", { BRAND: "Huggies", CLASS: "Crawler Nappies" })).toBe("Huggies · Crawler Nappies");
  });
});

// Recorded runs of the Supply Chain stockout recovery builder on canonical
// (agent/deploy_supply_agents.sql): Rascal + Friends NSW at 4 and 6 weeks of
// cover, and Uppababy, where no DC can spare stock.
describe("stockout recovery builder answers", () => {
  type Opt = { option_id: string; label: string; transfer_units?: number; po_units?: number; stockout_days?: number; lifts_shortage?: boolean;
    guardrails?: { level: string; message: string }[] };
  type Plan = { plan_id: string; dc_state: string; recommended: string; options: Opt[]; do_nothing?: { stockout_days?: number }; campaign_effect?: string };
  const plan = (name: string) => splitBlock<Plan>(fixture(name).text, "po_plan").block!;
  const opt = (p: Plan, id: string) => p.options.find((o) => o.option_id === id)!;
  const tools = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use").map((e) => String(e.data.name));

  it("verifies every unit, day and AUD figure it wrote against its tools", () => {
    for (const name of ["supply_rascal", "supply_rascal6", "supply_uppababy"]) {
      const f = fixture(name);
      const s = splitBlock(f.text, "po_plan");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("po_plan", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("builds once, writes a draft and never approves", () => {
    for (const name of ["supply_rascal", "supply_rascal6", "supply_uppababy"]) {
      const t = tools(name);
      expect(t.filter((x) => x === "BuildRecoveryPlan")).toHaveLength(1);
      expect(t.indexOf("StockoutEvidence")).toBeLessThan(t.indexOf("BuildRecoveryPlan"));
      expect(plan(name).plan_id).toMatch(/^RCV-\d{11}$/);
    }
  });

  it("recovers Rascal + Friends NSW with a VIC transfer now and a PO behind it, which lifts the campaign block", () => {
    const p = plan("supply_rascal");
    expect(p.dc_state).toBe("NSW");
    expect(p.recommended).toBe("C");
    expect(opt(p, "C").transfer_units).toBeGreaterThan(0);
    expect(opt(p, "C").po_units).toBeGreaterThan(0);
    expect(opt(p, "C").lifts_shortage).toBe(true);
    // The PO alone is too slow to lift the block, and the supplier's fill rate is flagged.
    expect(opt(p, "B").lifts_shortage).toBe(false);
    expect(opt(p, "B").guardrails?.some((g) => /38%/.test(g.message))).toBe(true);
    expect(opt(p, "C").stockout_days!).toBeLessThan(p.do_nothing!.stockout_days!);
  });

  it("moves more stock for a 6-week target, and still does not rely on a transfer alone", () => {
    const four = plan("supply_rascal"), six = plan("supply_rascal6");
    expect(opt(six, "A").transfer_units!).toBeGreaterThan(opt(four, "A").transfer_units!);
    expect(six.recommended).toBe("C");
    expect(opt(six, "A").guardrails?.some((g) => /cannot be relied on/.test(g.message))).toBe(true);
  });

  it("offers an expedited PO when no DC can spare Uppababy, and says the stores stay short", () => {
    const p = plan("supply_uppababy");
    expect(opt(p, "A").guardrails?.some((g) => g.level === "BLOCK")).toBe(true);
    expect(opt(p, "C").label).toMatch(/Expedited/);
    expect(p.recommended).toBe("C");
    expect(p.options.every((o) => o.lifts_shortage === false)).toBe(true);
  });

  it("describes the builder's steps in words", () => {
    expect(describeInput("StockoutEvidence", { BRAND: "Rascal + Friends", CLASS: "Crawler Nappies", STATE: "NSW" })).toBe("Rascal + Friends · Crawler Nappies · NSW");
    expect(describeInput("BuildRecoveryPlan", { BRAND: "Rascal + Friends", CLASS: "Crawler Nappies", STATE: "NSW", TARGET_WEEKS: 6 })).toBe("Rascal + Friends · Crawler Nappies · NSW · 6 weeks cover");
  });
});

// Recorded runs of the Supply Chain supplier DIFOT investigator on canonical
// (agent/deploy_supply_agents.sql, tools sql/47): Kimberly-Clark x Huggies
// Crawler Nappies (our override), Rascal & Co (the supplier's, shelves empty in
// NSW) and every supplier ranked.
describe("supplier DIFOT investigator answers", () => {
  type Rca = { headline: string; hypotheses: { hypothesis: string; verdict: string; evidence: string }[];
    actions: { owner: string; action: string; recovery_prompt?: string | null }[] };
  const rca = (name: string) => splitBlock<Rca>(fixture(name).text, "rca").block!;
  const verdict = (b: Rca, re: RegExp) => b.hypotheses.find((h) => re.test(h.hypothesis))?.verdict;
  const tools = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use").map((e) => String(e.data.name));
  const tested = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use" && e.data.name === "TestDifotHypothesis")
    .map((e) => String((e.data.input as { DIMENSION?: string }).DIMENSION));

  it("verifies every figure it wrote against its tools", () => {
    for (const name of ["supply_difot_kc", "supply_difot_rascal", "supply_difot_all"]) {
      const f = fixture(name);
      const s = splitBlock(f.text, "rca");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("rca", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("always tests the component, the timing and whose problem it is", () => {
    for (const name of ["supply_difot_kc", "supply_difot_rascal"]) {
      expect(tools(name)[0]).toBe("DifotEvidence");
      for (const d of ["component", "timing", "attribution"]) expect(tested(name)).toContain(d);
      expect(new Set(tested(name)).size).toBeGreaterThanOrEqual(6);
    }
  });

  it("puts Kimberly-Clark's Huggies Crawler misses on our override, not the supplier", () => {
    const b = rca("supply_difot_kc");
    expect(b.headline).toMatch(/Baby Mart|our|override/i);
    expect(verdict(b, /override/i)).toBe("CONFIRMED");
    expect(verdict(b, /lead time/i)).toBe("RULED_OUT");
    expect(b.actions.some((a) => a.owner === "Demand Planning")).toBe(true);
    // The scorecard should not count our inflated orders against the supplier.
    expect(b.actions.some((a) => /scorecard|penalis/i.test(a.action))).toBe(true);
    expect(b.actions.every((a) => !a.recovery_prompt)).toBe(true);
  });

  it("puts Rascal & Co's drop on the supplier in NSW and hands off to Stockout Recovery", () => {
    const b = rca("supply_difot_rascal");
    expect(b.headline).toMatch(/supplier/i);
    expect(b.headline).toMatch(/NSW/);
    expect(verdict(b, /override/i)).toBe("RULED_OUT");
    expect(verdict(b, /NSW/)).toBe("CONFIRMED");
    expect(b.actions.some((a) => a.owner === "Supply" && /Rascal/.test(a.recovery_prompt ?? ""))).toBe(true);
  });

  it("ranks every supplier and singles out Kimberly-Clark as the one that is ours", () => {
    const f = fixture("supply_difot_all");
    expect((f.events.find((e) => e.event === "response.tool_use")!.data.input as { SUPPLIER: string }).SUPPLIER).toBe("ALL");
    const b = rca("supply_difot_all");
    expect(b.headline).toMatch(/Kimberly-Clark/);
    expect(b.headline).toMatch(/Baby Mart|our/i);
  });

  it("describes the investigator's steps in words", () => {
    expect(describeInput("DifotEvidence", { SUPPLIER: "Kimberly-Clark ANZ", BRAND: "Huggies", CLASS: "Crawler Nappies" })).toBe("Kimberly-Clark ANZ · Huggies · Crawler Nappies");
    expect(describeInput("DifotEvidence", { SUPPLIER: "ALL", BRAND: "", CLASS: "" })).toBe("every supplier");
    expect(describeInput("TestDifotHypothesis", { SUPPLIER: "Rascal & Co", BRAND: "", CLASS: "", DIMENSION: "supplier_wide" })).toBe("Rascal & Co · test supplier wide");
  });
});

// Recorded runs of the Category Manager negotiation brief builder on canonical
// (agent/deploy_brand_agents.sql, tools sql/48): Huggies (the DIFOT misses are
// ours, so they are offered back), Rascal + Friends firm (the supplier's misses
// are claimed) and Bugaboo (the category's largest brand).
describe("negotiation brief builder answers", () => {
  type Ask = { ask_id: string; kind: string; direction: string; opening_aud?: number; target_aud?: number; walkaway_aud?: number; guardrails?: { level: string; message: string }[] };
  type Brief = { brief_id: string; stance: string; asks: Ask[]; levers: { kind: string }[]; guardrails: { level: string; message: string }[];
    totals: { opening_aud: number; target_aud: number; walkaway_aud: number; gives_aud: number } };
  const brief = (name: string) => splitBlock<Brief>(fixture(name).text, "brief").block!;
  const tools = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use").map((e) => String(e.data.name));
  const NAMES = ["brief_huggies", "brief_rascal", "brief_bugaboo"];

  it("verifies every AUD figure it wrote against its tools", () => {
    for (const name of NAMES) {
      const f = fixture(name);
      const s = splitBlock(f.text, "brief");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("brief", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("builds once, writes a draft and never approves", () => {
    for (const name of NAMES) {
      expect(tools(name).filter((x) => x === "BuildNegotiationBrief")).toHaveLength(1);
      expect(brief(name).brief_id).toMatch(/^NEG-\d{14}$/);
      expect(fixture(name).text).toMatch(/draft/i);
    }
  });

  it("copies the tool's totals: asks less gives, opening above target above walk-away", () => {
    for (const name of NAMES) {
      const b = brief(name);
      const net = (k: "opening_aud" | "target_aud" | "walkaway_aud") =>
        b.asks.reduce((x, a) => x + (a.direction === "GIVE" ? -1 : 1) * (a[k] ?? 0), 0);
      for (const k of ["opening_aud", "target_aud", "walkaway_aud"] as const) expect(Math.abs(net(k) - b.totals[k])).toBeLessThanOrEqual(2);
      for (const a of b.asks.filter((x) => x.direction === "ASK")) {
        expect(a.opening_aud!).toBeGreaterThanOrEqual(a.target_aud!);
        expect(a.target_aud!).toBeGreaterThanOrEqual(a.walkaway_aud!);
      }
    }
  });

  it("offers Kimberly-Clark's DIFOT misses back as a give and warns off the Crawler spike", () => {
    const b = brief("brief_huggies");
    expect(b.asks.some((a) => a.kind === "DIFOT")).toBe(false);
    expect(b.asks.find((a) => a.kind === "DIFOT_WAIVER")?.direction).toBe("GIVE");
    expect(b.asks.some((a) => a.kind === "MARGIN")).toBe(true);
    expect(b.guardrails.some((g) => /override/i.test(g.message))).toBe(true);
  });

  it("claims Rascal & Co's own DIFOT misses on a firm brief, holds margin and asks for allocation", () => {
    const b = brief("brief_rascal");
    expect(b.stance).toBe("FIRM");
    expect(b.asks.find((a) => a.kind === "DIFOT")?.direction).toBe("ASK");
    expect(b.asks.some((a) => a.kind === "MARGIN")).toBe(false);
    expect(b.levers.map((l) => l.kind)).toEqual(expect.arrayContaining(["MARGIN_HOLD", "ALLOCATION"]));
  });

  it("flags the category's dependency on Bugaboo", () => {
    const b = brief("brief_bugaboo");
    expect(b.guardrails.some((g) => /depends on it/.test(g.message))).toBe(true);
    expect(b.levers.map((l) => l.kind)).toContain("GROWTH_PLAN");
  });

  it("describes the builder's steps in words", () => {
    expect(describeInput("NegotiationEvidence", { BRAND: "Huggies" })).toBe("Huggies");
    expect(describeInput("BuildNegotiationBrief", { BRAND: "Rascal + Friends", STANCE: "FIRM", REQUEST: "x" })).toBe("Rascal + Friends · firm stance");
  });
});

// Recorded runs of the Head of Planning sandbox builder on canonical
// (agent/deploy_hop_agents.sql, tools sql/49): QLD Metro Standard to its peer
// rate, the company to +5% LFL, and a margin point at Gold Coast (a store with a
// recorded clearance reason). Plus the Planning Investigator handing a what-if
// to the builder.
describe("store plan sandbox builder answers", () => {
  type Opt = { option_id: string; stores_touched: number; sales_delta_aud: number; margin_delta_aud: number; company_lfl_pct: number; guardrails: { level: string; message: string }[] };
  type Sbx = { proposal_id: string; scope: string; lever: string; options: Opt[]; recommended: string };
  const sbx = (name: string) => splitBlock<Sbx>(fixture(name).text, "sandbox").block!;
  const tools = (name: string) => fixture(name).events.filter((e) => e.event === "response.tool_use").map((e) => String(e.data.name));
  const input = (name: string, tool: string) => fixture(name).events.find((e) => e.event === "response.tool_use" && e.data.name === tool)!.data.input as Record<string, unknown>;
  const rec = (b: Sbx) => b.options.find((o) => o.option_id === b.recommended)!;
  const NAMES = ["hop_sandbox_qld", "hop_sandbox_lfl5", "hop_sandbox_goldcoast"];

  it("verifies every figure it wrote against its tools", () => {
    for (const name of NAMES) {
      const f = fixture(name);
      const s = splitBlock(f.text, "sandbox");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("sandbox", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("builds once, writes a draft proposal and never opens a sandbox", () => {
    for (const name of NAMES) {
      expect(tools(name).filter((x) => x === "BuildSandbox")).toHaveLength(1);
      expect(tools(name).indexOf("SandboxEvidence")).toBeLessThan(tools(name).indexOf("BuildSandbox"));
      expect(sbx(name).proposal_id).toMatch(/^SBX-\d{14}$/);
      expect(sbx(name).options).toHaveLength(3);
    }
  });

  it("closes QLD Metro Standard's gap to its peer rate with no caution", () => {
    expect(input("hop_sandbox_qld", "BuildSandbox").LEVER).toBe("PEER_RATE");
    const b = sbx("hop_sandbox_qld");
    expect(b.scope).toMatch(/QLD Metro Standard/);
    expect(rec(b).sales_delta_aud).toBeGreaterThan(0);
    expect(rec(b).guardrails.every((g) => g.level === "INFO")).toBe(true);
  });

  it("warns that +5% LFL needs an amendment to the approved plan and overrides recorded reasons", () => {
    expect(input("hop_sandbox_lfl5", "BuildSandbox")).toMatchObject({ LEVER: "LFL_TARGET", VALUE: 5 });
    const b = sbx("hop_sandbox_lfl5");
    const a = b.options.find((o) => o.option_id === "A")!;
    expect(a.company_lfl_pct).toBe(5);
    expect(a.guardrails.some((g) => g.level === "CAUTION" && /Approve & lock/.test(g.message))).toBe(true);
    expect(a.guardrails.some((g) => /STORE_REFURB/.test(g.message))).toBe(true);
    expect(b.recommended).toBe("C");
  });

  it("flags Gold Coast's clearance reason on every margin option and takes the smallest change", () => {
    const b = sbx("hop_sandbox_goldcoast");
    expect(b.lever).toBe("MARGIN_SHIFT");
    for (const o of b.options) {
      expect(o.sales_delta_aud).toBe(0);
      expect(o.guardrails.some((g) => /CLEARANCE_PUSH/.test(g.message))).toBe(true);
    }
    const sizes = b.options.map((o) => Math.abs(o.margin_delta_aud));
    expect(Math.abs(rec(b).margin_delta_aud)).toBe(Math.min(...sizes));
  });

  it("is where the Planning Investigator sends a store plan what-if", () => {
    const b = splitBlock<{ actions: { owner: string; sandbox_prompt?: string | null }[] }>(fixture("hop_qld_handoff").text, "rca").block!;
    expect(b.actions.some((a) => a.owner === "Planning" && /peer rate/i.test(a.sandbox_prompt ?? ""))).toBe(true);
  });

  it("describes the builder's steps in words", () => {
    expect(describeInput("SandboxEvidence", { SCOPE: "QLD Metro Standard" })).toBe("QLD Metro Standard");
    expect(describeInput("BuildSandbox", { SCOPE: "ALL", LEVER: "LFL_TARGET", VALUE: 5, REQUEST: "x" })).toBe("ALL · lfl target 5");
    expect(describeInput("BuildSandbox", { SCOPE: "QLD", LEVER: "PEER_RATE", VALUE: 0, REQUEST: "x" })).toBe("QLD · peer rate");
  });
});

describe("progress trail", () => {
  it("turns the recorded stream into steps that each finish", () => {
    const f = fixture("inv_001");
    let t: Turn = { question: f.question, text: "", steps: [], charts: [], done: false, startedAt: 0 };
    for (const e of f.events) {
      const d = e.data as Record<string, unknown>;
      if (e.event === "response.tool_use") t = applyEvent(t, { type: "step", id: String(d.tool_use_id), name: String(d.name), toolType: String(d.type), input: d.input });
      if (e.event === "response.tool_result") t = applyEvent(t, { type: "step_result", id: String(d.tool_use_id), name: String(d.name), status: String(d.status) });
      if (e.event === "response.status") t = applyEvent(t, { type: "status", message: String(d.message) });
    }
    t = applyEvent(t, { type: "done" });
    expect(t.steps.map((s) => s.name).slice(0, 3)).toEqual(["CampaignEvidence", "VoiceSearch", "TestHypothesis"]);
    expect(t.steps.filter((s) => s.name === "TestHypothesis")).toHaveLength(4);
    expect(t.steps.every((s) => s.status !== "running")).toBe(true);
    // Two charts were asked for at once and the second failed; the agent
    // redrew it. Results are matched to steps by tool id, not by order.
    expect(t.steps.filter((s) => s.name === "data_to_chart").map((s) => s.status)).toEqual(["success", "error", "success"]);
    expect(t.done).toBe(true);
  });

  it("marks a step still running when the stream ends as failed", () => {
    let t: Turn = { question: "q", text: "", steps: [], charts: [], done: false, startedAt: 0 };
    t = applyEvent(t, { type: "step", id: "a", name: "SizeAudience", toolType: "generic", input: {} });
    t = applyEvent(t, { type: "done" });
    expect(t.steps[0].status).toBe("error");
  });

  it("says what each step was asked, in words", () => {
    expect(describeInput("TestHypothesis", { CAMPAIGN_ID: "camp-001", DIMENSION: "stock" })).toBe("camp-001 · split by stock");
    expect(describeInput("SizeAudience", { SPEC: JSON.stringify({ all: [{ field: "CAR_SEAT_LAST_CLASS", op: "in", values: ["Capsule (0-6m)"] }], quadrants: ["PERSUADABLE"] }) }))
      .toBe("car seat last class Capsule (0-6m) · persuadable");
    expect(describeInput("CheckCampaignGuardrails", { CATEGORY: "Car Seats", BRAND: "", START_DATE: "2026-05-18", END_DATE: "2026-06-14" }))
      .toBe("Car Seats · no brand · 2026-05-18 → 2026-06-14");
  });
});

/** A database that answers the queries a tool makes from canned rows. */
function fakeRun(answers: [string, Row[]][]) {
  const calls: string[] = [];
  const run = (sql: string) => {
    calls.push(sql);
    for (const [q, rows] of answers) if (sql === q || sql.includes(q)) return rows;
    return [];
  };
  return { run, calls };
}

describe("agent tools", () => {
  // camp-001 as measured: members at stores short of Rascal + Friends converted
  // well below the holdout; everyone else was flat.
  const stockSplit: [string, Row[]][] = [
    [SQL.SQL_CAMPAIGN, [{ CAMPAIGN_ID: "camp-001", NAME: "Crawler Nappies Surge" }]],
    [SQL.SQL_LIFT_BY, [
      { DIM: "Home store short of promoted brand", VAL: "No", TN: 13176, TC: 665, HN: 1465, HC: 73 },
      { DIM: "Home store short of promoted brand", VAL: "Yes", TN: 3374, TC: 78, HN: 374, HC: 17 },
      { DIM: "Channel", VAL: "EMAIL", TN: 9000, TC: 400, HN: 1000, HC: 45 },
      { DIM: "Channel", VAL: "SMS", TN: 7550, TC: 343, HN: 839, HC: 38 },
    ]],
  ];

  it("does not rule out a split whose small group has a significant lift of its own", () => {
    const r = testHypothesis(fakeRun(stockSplit).run, "camp-001", "stock") as Row & { groups: Row[]; comparison: Row };
    expect(r.ok).toBe(true);
    expect(r.dimension).toBe("Home store short of promoted brand");
    expect((r.comparison as Row).differs).toBe(false);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(String(r.reading)).toMatch(/likely contributor/);
    expect(r.groups.find((g) => g.value === "Yes")?.significant).toBe(true);
  });

  it("rules out a split with no difference and no significant group", () => {
    const r = testHypothesis(fakeRun(stockSplit).run, "camp-001", "channel") as Row;
    expect(r.verdict).toBe("NOT_SUPPORTED");
  });

  it("refuses an unknown dimension or campaign with a reason the agent can act on", () => {
    expect(testHypothesis(fakeRun(stockSplit).run, "camp-001", "weather")).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown dimension/) });
    expect(testHypothesis(fakeRun([]).run, "camp-999", "stock")).toMatchObject({ ok: false, error: expect.stringMatching(/No campaign/) });
  });

  it("returns the allowed fields when the agent writes a spec the app would reject", () => {
    const { run, calls } = fakeRun([]);
    const r = sizeAudience(run, JSON.stringify({ all: [{ field: "INCOME", op: "gte", value: 1 }] })) as Row;
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not a field/) });
    expect((r.allowed_fields as string[]).some((f) => f.startsWith("CAR_SEAT_DUE_STATUS: DUE_NOW"))).toBe(true);
    expect(calls).toEqual([]);
  });

  it("will not draft a campaign in the past, over budget, or without dates", () => {
    const run = fakeRun([[SQL.SQL_AS_OF, [{ AS_OF: "2026-05-07" }]]]).run;
    const spec = JSON.stringify({ all: [{ field: "CAR_SEAT_DUE_STATUS", op: "in", values: ["DUE_NOW"] }] });
    const brief = (b: Row) => JSON.stringify({ name: "Test", budget_aud: 5000, start_date: "2026-05-18", end_date: "2026-06-14", ...b });
    expect(createDraft(run, brief({ start_date: "2026-05-01" }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/start after 2026-05-07/) });
    expect(createDraft(run, brief({ budget_aud: 250000 }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/budget_aud/) });
    expect(createDraft(run, brief({ end_date: null }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/required/) });
    expect(createDraft(run, brief({ name: "" }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/needs a name/) });
  });
});

// Recorded runs of the NPS Analyst's investigator on canonical
// (agent/deploy_sentiment_agents.sql, tools sql/51): NSW in late April (the
// Rascal + Friends stockout, amplified by camp-001), the national slide since
// February (Gold & Platinum members on price) and WA delivery complaints
// (running since March, with nothing in the operations data behind them).
describe("NPS investigator answers", () => {
  type Rca = { headline: string; confidence: string; hypotheses: { hypothesis: string; verdict: string; evidence: string }[];
    actions: { owner: string; action: string; recovery_prompt?: string | null }[] };
  const rca = (name: string) => splitBlock<Rca>(fixture(name).text, "rca").block!;
  const verdict = (b: Rca, re: RegExp) => b.hypotheses.find((h) => re.test(h.hypothesis))?.verdict;
  const uses = (name: string, tool: string) => fixture(name).events.filter((e) => e.event === "response.tool_use" && e.data.name === tool);
  const tested = (name: string) => uses(name, "TestNpsCause").map((e) => String((e.data.input as { DIMENSION?: string }).DIMENSION));

  it("verifies every figure it wrote against its tools", () => {
    for (const name of ["nps_nsw", "nps_national", "nps_wa"]) {
      const f = fixture(name);
      const s = splitBlock(f.text, "rca");
      expect(s.block).not.toBeNull();
      const v = verifyAnswer("rca", s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("starts from the evidence and tests every operational cause, not just the one asked about", () => {
    for (const name of ["nps_nsw", "nps_national", "nps_wa"]) {
      const first = fixture(name).events.find((e) => e.event === "response.tool_use")!;
      expect(["NpsEvidence", "TestNpsCause"]).toContain(String(first.data.name));
      expect(uses(name, "NpsEvidence").length).toBeGreaterThanOrEqual(1);
      for (const d of ["stock", "campaign", "supply", "delivery", "price", "app", "quality"]) expect(tested(name)).toContain(d);
    }
  });

  it("traces NSW to the Rascal + Friends stockout, amplified by camp-001, and hands off to Stockout Recovery", () => {
    const b = rca("nps_nsw");
    expect(b.headline).toMatch(/Rascal \+ Friends/);
    expect(b.confidence).toBe("High");
    expect(verdict(b, /stock ?out|stock\b/i)).toBe("CONFIRMED");
    expect(verdict(b, /campaign/i)).toBe("CONFIRMED");
    expect(verdict(b, /supplier|supply|DIFOT/i)).toBe("CONFIRMED");
    expect(verdict(b, /price/i)).toBe("RULED_OUT");
    expect(verdict(b, /store/i)).toBe("RULED_OUT");
    expect(b.actions.some((a) => a.owner === "Supply" && /Rascal/.test(a.recovery_prompt ?? ""))).toBe(true);
    expect(b.actions.some((a) => a.owner === "CRM" && /camp-001/.test(a.action))).toBe(true);
  });

  it("puts the national slide on Gold & Platinum members and value, not on stock", () => {
    const b = rca("nps_national");
    expect(b.headline).toMatch(/Gold & Platinum/);
    expect(verdict(b, /tier/i)).toBe("CONFIRMED");
    expect(verdict(b, /price/i)).toBe("CONFIRMED");
    expect(verdict(b, /out of stock|stock/i)).toBe("RULED_OUT");
    // The question gives the period, so it is passed through.
    expect((uses("nps_national", "NpsEvidence")[0].data.input as { START_DATE: string }).START_DATE).toBe("2026-02-02");
  });

  it("finds WA delivery complaints began in March and says operations cannot confirm a cause", () => {
    const b = rca("nps_wa");
    expect(b.headline).toMatch(/delivery/i);
    expect(b.confidence).not.toBe("High");
    expect(verdict(b, /delivery op|operations/i) ?? verdict(b, /^delivery/i)).toBe("INCONCLUSIVE");
    expect(verdict(b, /stock/i)).toBe("RULED_OUT");
    // It re-ran from when the complaints began rather than calling them steady.
    expect(uses("nps_wa", "NpsEvidence").some((e) => (e.data.input as { START_DATE: string }).START_DATE === "2026-03-02")).toBe(true);
  });

  it("describes the investigator's steps in words", () => {
    expect(describeInput("NpsEvidence", { SCOPE: "NSW", START_DATE: "", END_DATE: "" })).toBe("NSW");
    expect(describeInput("NpsEvidence", { SCOPE: "ALL", START_DATE: "2026-02-02", END_DATE: "2026-04-26" })).toBe("all stores · 2026-02-02 → 2026-04-26");
    expect(describeInput("TestNpsCause", { SCOPE: "WA", START_DATE: "2026-03-02", END_DATE: "", DIMENSION: "delivery" })).toBe("WA · 2026-03-02 → 7 May · test delivery");
  });
});
