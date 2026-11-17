import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { splitBlock, verifyAnswer, toolPayload, type ToolResult } from "./agent-answer";
import { testHypothesis, sizeAudience, createDraft, type Row } from "./tools";
import * as SQL from "./sql";
import { applyEvent, type Turn } from "@/app/(shell)/campaigns/_components/agent/useAgentRun";
import { describeInput } from "@/app/(shell)/campaigns/_components/agent/ProgressTrail";

// Recorded runs of the two agents on Snowhouse (trimmed to tool events and the
// final text): the investigator on camp-h04, the builder on the business-starter brief.
type Fixture = { question: string; text: string; events: { event: string; data: Record<string, unknown> }[] };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", `agent_${name}.json`), "utf8"));
const results = (f: Fixture): ToolResult[] => f.events.filter((e) => e.event === "response.tool_result")
  .map((e) => ({ name: String(e.data.name), status: String(e.data.status), content: e.data.content }));

describe("agent answer blocks", () => {
  it("finds the block after the agent's narration and keeps the markdown after it", () => {
    const f = fixture("inv_h04");
    const s = splitBlock<{ headline: string; hypotheses: unknown[] }>(f.text, "rca");
    expect(s.block?.headline).toMatch(/every Bunnings shopper/);
    expect(s.block?.hypotheses.length).toBeGreaterThanOrEqual(3);
    expect(s.before.trim()).toBe("");
    expect(s.after).toMatch(/^## Should we send it again\?/);
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
      { name: "PlaybookSearch", status: "success", content: [{ json: { search_results: [{ text: "Starters need consent" }] } }] },
      { name: "CustomerSignals", status: "success", content: [{ json: { result_set: { data: [["HIGH", "4862"]] } } }] },
      { name: "data_to_chart", status: "success", content: [{ json: { charts: ["{}"] } }] },
      { name: "SizeAudience", status: "error", content: [{ json: { result: "{\"final_audience\":999}" } }] },
    ]);
    expect(p).toEqual([{ final_audience: 244 }, ["Starters need consent"], [["HIGH", "4862"]]]);
  });

  it("verifies the recorded answers against their own tool results", () => {
    for (const [name, tag] of [["inv_h04", "rca"], ["build_business", "campaign"]] as const) {
      const f = fixture(name);
      const s = splitBlock(f.text, tag);
      const v = verifyAnswer(tag, s.block, s.after, results(f), f.question);
      expect(v.unmatched).toEqual([]);
      expect(v.verified).toBe(true);
    }
  });

  it("flags an invented amount or count", () => {
    const f = fixture("inv_h04");
    const s = splitBlock(f.text, "rca");
    const v = verifyAnswer("rca", s.block, `${s.after}\nIt cost AUD 48,215 across 7,913 members.`, results(f), f.question);
    expect(v.verified).toBe(false);
    expect(v.unmatched).toEqual(["prose: AUD 48,215", "prose: 7,913"]);
  });
});

describe("progress trail", () => {
  it("turns the recorded stream into steps that each finish", () => {
    const f = fixture("inv_h04");
    let t: Turn = { question: f.question, text: "", steps: [], charts: [], done: false, startedAt: 0 };
    for (const e of f.events) {
      const d = e.data as Record<string, unknown>;
      if (e.event === "response.tool_use") t = applyEvent(t, { type: "step", id: String(d.tool_use_id), name: String(d.name), toolType: String(d.type), input: d.input });
      if (e.event === "response.tool_result") t = applyEvent(t, { type: "step_result", id: String(d.tool_use_id), name: String(d.name), status: String(d.status) });
      if (e.event === "response.status") t = applyEvent(t, { type: "status", message: String(d.message) });
    }
    t = applyEvent(t, { type: "done" });
    expect(t.steps.map((s) => s.name).slice(0, 3)).toEqual(["CampaignEvidence", "PlaybookSearch", "TestHypothesis"]);
    expect(t.steps.filter((s) => s.name === "TestHypothesis")).toHaveLength(4);
    expect(t.steps.every((s) => s.status !== "running")).toBe(true);
    // Two charts were asked for at once and both returned; results are matched
    // to steps by tool id, not by order.
    expect(t.steps.filter((s) => s.name === "data_to_chart").map((s) => s.status)).toEqual(["success", "success"]);
    expect(t.done).toBe(true);
  });

  it("marks a step still running when the stream ends as failed", () => {
    let t: Turn = { question: "q", text: "", steps: [], charts: [], done: false, startedAt: 0 };
    t = applyEvent(t, { type: "step", id: "a", name: "SizeAudience", toolType: "generic", input: {} });
    t = applyEvent(t, { type: "done" });
    expect(t.steps[0].status).toBe("error");
  });

  it("says what each step was asked, in words", () => {
    expect(describeInput("TestHypothesis", { CAMPAIGN_ID: "camp-h04", DIMENSION: "cold" })).toBe("camp-h04 · split by cold");
    expect(describeInput("SizeAudience", { SPEC: JSON.stringify({ all: [{ field: "SCHOOL_SIGNAL_CONFIDENCE", op: "in", values: ["HIGH"] }], quadrants: ["PERSUADABLE"] }) }))
      .toBe("school signal confidence HIGH · persuadable");
    expect(describeInput("CheckCampaignGuardrails", { CATEGORY: "Business Essentials", BRAND: "", START_DATE: "2026-11-23", END_DATE: "2026-12-20" }))
      .toBe("Business Essentials · no brand · 2026-11-23 → 2026-12-20");
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
  // The live Black Friday tech campaign: members at WA stores short of Apple
  // converted well below the holdout; everyone else was flat.
  const stockSplit: [string, Row[]][] = [
    [SQL.SQL_CAMPAIGN, [{ CAMPAIGN_ID: "camp-l01", NAME: "Black Friday Tech" }]],
    [SQL.SQL_LIFT_BY, [
      { DIM: "Home store short of promoted brand", VAL: "No", TN: 13176, TC: 665, HN: 1465, HC: 73 },
      { DIM: "Home store short of promoted brand", VAL: "Yes", TN: 3374, TC: 78, HN: 374, HC: 17 },
      { DIM: "Channel", VAL: "EMAIL", TN: 9000, TC: 400, HN: 1000, HC: 45 },
      { DIM: "Channel", VAL: "SMS", TN: 7550, TC: 343, HN: 839, HC: 38 },
    ]],
  ];

  it("does not rule out a split whose small group has a significant lift of its own", () => {
    const r = testHypothesis(fakeRun(stockSplit).run, "camp-l01", "stock") as Row & { groups: Row[]; comparison: Row };
    expect(r.ok).toBe(true);
    expect(r.dimension).toBe("Home store short of promoted brand");
    expect((r.comparison as Row).differs).toBe(false);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(String(r.reading)).toMatch(/likely contributor/);
    expect(r.groups.find((g) => g.value === "Yes")?.significant).toBe(true);
  });

  it("rules out a split with no difference and no significant group", () => {
    const r = testHypothesis(fakeRun(stockSplit).run, "camp-l01", "channel") as Row;
    expect(r.verdict).toBe("NOT_SUPPORTED");
  });

  it("refuses an unknown dimension or campaign with a reason the agent can act on", () => {
    expect(testHypothesis(fakeRun(stockSplit).run, "camp-l01", "weather")).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown dimension/) });
    expect(testHypothesis(fakeRun([]).run, "camp-999", "stock")).toMatchObject({ ok: false, error: expect.stringMatching(/No campaign/) });
  });

  it("returns the allowed fields when the agent writes a spec the app would reject", () => {
    const { run, calls } = fakeRun([]);
    const r = sizeAudience(run, JSON.stringify({ all: [{ field: "INCOME", op: "gte", value: 1 }] })) as Row;
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not a field/) });
    expect((r.allowed_fields as string[]).some((f) => f.startsWith("SCHOOL_SIGNAL_CONFIDENCE: HIGH"))).toBe(true);
    expect(calls).toEqual([]);
  });

  it("will not draft a campaign in the past, over budget, or without dates", () => {
    const run = fakeRun([[SQL.SQL_AS_OF, [{ AS_OF: "2026-11-13" }]]]).run;
    const spec = JSON.stringify({ all: [{ field: "BIZ_STARTER_FLAG", op: "is_true" }] });
    const brief = (b: Row) => JSON.stringify({ name: "Test", budget_aud: 5000, start_date: "2026-11-23", end_date: "2026-12-20", ...b });
    expect(createDraft(run, brief({ start_date: "2026-11-01" }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/start after 2026-11-13/) });
    expect(createDraft(run, brief({ budget_aud: 250000 }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/budget_aud/) });
    expect(createDraft(run, brief({ end_date: null }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/required/) });
    expect(createDraft(run, brief({ name: "" }), spec, "")).toMatchObject({ ok: false, error: expect.stringMatching(/needs a name/) });
  });
});
