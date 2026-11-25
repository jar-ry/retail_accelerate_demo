import { describe, expect, it } from "vitest";
import type { Step } from "@/components/agent/useAgentRun";
import { checkAnswer, contextUsed, numbersIn, splitReading, sqlRun, toolPayload } from "./ontology-compare";

const step = (name: string, input: unknown, result?: unknown): Step =>
  ({ id: name, name, toolType: "generic", input, status: "success", startedAt: 0, result });

describe("checkAnswer", () => {
  const huggies = [{ label: "93.7%", number: 93.7234, decimals: 1 }, { label: "5,222 orders", number: 5222, decimals: 0 }];

  it("passes an answer carrying every reference figure", () => {
    expect(checkAnswer("Huggies DIFOT for FY2026 is **93.7%** across **5,222 orders**.", huggies).ok).toBe(true);
  });

  it("fails the double-counted answer and names what is missing", () => {
    // The semantic view alone: class rows counted twice (recorded run).
    const r = checkAnswer("Huggies' DIFOT for FY2026 is **92.8%**. That covers **8,822 orders**.", huggies);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["93.7%", "5,222 orders"]);
  });

  it("does not take a nearby figure for the reference", () => {
    // The ontology column: weighted, but the class rows still in (93.1% on 8,822).
    expect(checkAnswer("DIFOT this year was 93.1%, across 8,822 orders", huggies).missing).toEqual(["93.7%", "5,222 orders"]);
  });

  it("matches names case-insensitively and signed numbers by value", () => {
    const growth = [{ label: "Nuna", text: "Nuna" }, { label: "+2.9%", number: 2.9012, decimals: 1 }];
    expect(checkAnswer("**NUNA is growing fastest at +2.90%**", growth).ok).toBe(true);
    expect(checkAnswer("Nuna did best, at **-11.0%**", growth).missing).toEqual(["+2.9%"]);
  });
});

describe("numbersIn", () => {
  it("reads thousands separators as one number", () => {
    expect(numbersIn("AUD 1,234,567 and 5,222 orders, 93.7%")).toEqual([1234567, 5222, 93.7]);
  });
});

describe("tool results", () => {
  const ontology = JSON.stringify({ available: true, named_in_question: ["DIFOT %"],
    detail: [{ name: "DIFOT %", kind: "METRIC" }, { name: "DIFOT Target", kind: "POLICY" }] });
  const sense = { available: true, documents: [
    { kind: "table_entity", about: "TEMP.JARCHEN_ANALYTICS.DT_SUPPLIER_DIFOT" },
    { kind: "qbe", about: "STREAMLIT:56b3ad6327ebbcee" }] };

  it("reads a payload sent as text, as JSON, or as a procedure's result", () => {
    expect(toolPayload([{ type: "text", text: ontology }])?.available).toBe(true);
    expect(toolPayload([{ type: "json", json: sense }])?.documents).toHaveLength(2);
    // Recorded from CM_COMPARE_SENSE_AGENT: a procedure tool's text is under json.result.
    expect(toolPayload([{ json: { execution_type: "procedure", query_id: "01c8", result: ontology } }])?.named_in_question)
      .toEqual(["DIFOT %"]);
    expect(toolPayload(null)).toBeNull();
  });

  it("summarises the context each tool brought", () => {
    const ctx = contextUsed([
      step("OntologyLookup", { QUESTION: "q" }, [{ type: "text", text: ontology }]),
      step("CortexSenseLookup", { QUESTION: "q" }, [{ type: "json", json: sense }]),
    ]);
    expect(ctx.ontology).toMatchObject({ available: true, named: ["DIFOT %"], rules: ["DIFOT Target"] });
    expect(ctx.sense?.documents).toEqual([
      { kind: "Table page", about: "DT_SUPPLIER_DIFOT" }, { kind: "Past query", about: "a similar question" }]);
  });

  it("lists the SQL run, last first, without repeats", () => {
    const steps = [
      step("system_execute_sql", { sql: "SELECT 1" }),
      step("category_manager", {}, [{ type: "json", json: { sql: "SELECT 1" } }]),
      step("system_execute_sql", { sql: "SELECT 2" }),
    ];
    expect(sqlRun(steps)).toEqual(["SELECT 2", "SELECT 1"]);
  });
});

describe("splitReading", () => {
  it("separates the answer from how the agent read the question", () => {
    const r = splitReading("**Nuna +2.9%**\n\n### How I read the question\n- Metric: like-for-like");
    expect(r).toEqual({ answer: "**Nuna +2.9%**", reading: "- Metric: like-for-like" });
    expect(splitReading("just an answer").reading).toBeNull();
  });
});
