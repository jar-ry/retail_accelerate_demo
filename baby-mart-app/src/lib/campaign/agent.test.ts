import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { splitBlock, verifyAnswer, toolPayload, type ToolResult } from "./agent-answer";
import { testHypothesis, sizeAudience, createDraft, type Row } from "./tools";
import * as SQL from "./sql";
import { applyEvent, type Turn } from "@/app/(shell)/campaigns/_components/agent/useAgentRun";
import { describeInput } from "@/app/(shell)/campaigns/_components/agent/ProgressTrail";

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

  it("checks the Crawler spike against POS and calls it a reporting artefact, not demand", () => {
    expect(tools("brand_crawler")).toContain("CheckReportedDemand");
    const b = rca("brand_crawler");
    expect(b.headline).toMatch(/artefact|artifact|not in sales|not real/i);
    expect(verdict(b, /artefact|artifact|report/i)).toBe("CONFIRMED");
    expect(verdict(b, /step|week|spike/i)).toBe("RULED_OUT");
    // The DIFOT collapse is a risk to raise with the supplier, not the cause of a sales move.
    expect(verdict(b, /supply/i)).not.toBe("CONFIRMED");
    expect(b.actions.some((a) => a.owner === "Data")).toBe(true);
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
