import { describe, it, expect, vi, afterEach } from "vitest";
import { streamAgentChat, type ChatEvent } from "./agentStream";
import { applyEvent, type Turn } from "./useAgentRun";

/** A response whose body sends these NDJSON lines, then either ends or breaks
 *  the way a dropped connection does. */
function ndjson(lines: object[], opts: { breakAfter?: boolean; status?: number } = {}) {
  const enc = new TextEncoder();
  let sent = false;
  // Pulled, so the lines are read before the break: erroring a stream drops
  // whatever is still queued in it.
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        c.enqueue(enc.encode(lines.map((l) => JSON.stringify(l) + "\n").join("")));
      } else if (opts.breakAfter) c.error(new TypeError("network error"));
      else c.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("agent stream", () => {
  it("reconnects to the same run from the last event it had when the stream breaks", async () => {
    vi.useFakeTimers();
    const bodies: Record<string, any>[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1
        ? ndjson([{ type: "thread", threadId: 7 }, { type: "cortex_run", runId: "7-11" },
            { type: "step", id: "a", name: "BrandEvidence", seq: 3 }, { type: "step_result", id: "a", status: "success", seq: 9 }],
            { breakAfter: true })
        : ndjson([{ type: "text", text: "answer", seq: 40 }, { type: "run", runId: "AG-7-11" }, { type: "done" }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const seen: ChatEvent[] = [];
    const run = streamAgentChat({ agent: "brandInvestigator", message: "What drove Huggies Pull-Ups decline?" }, (e) => seen.push(e));
    await vi.runAllTimersAsync();
    await run;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[1].resume).toEqual({ runId: "7-11", after: 9 });
    expect(bodies[1].message).toBe("What drove Huggies Pull-Ups decline?");
    expect(seen.map((e) => e.type)).toEqual(["thread", "step", "step_result", "status", "text", "run", "done"]);
  });

  it("does not reconnect a run that finished", async () => {
    const fetchMock = vi.fn(async () => ndjson([{ type: "cortex_run", runId: "7-11" }, { type: "text", text: "a", seq: 1 }, { type: "done" }]));
    vi.stubGlobal("fetch", fetchMock);
    await streamAgentChat({ message: "q" }, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says the run never started when the stream breaks before its id arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([{ type: "thread", threadId: 7 }], { breakAfter: true })));
    await expect(streamAgentChat({ message: "q" }, () => {})).rejects.toThrow(/before the agent started/);
  });

  it("takes a refusal as final", async () => {
    const fetchMock = vi.fn(async () => ndjson([{ type: "error", message: "No message provided." }], { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: ChatEvent[] = [];
    await streamAgentChat({ message: "" }, (e) => seen.push(e));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ type: "error" });
  });

  it("keeps reconnecting through a redeploy-length outage, then gives up saying so", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0
      ? ndjson([{ type: "cortex_run", runId: "7-11" }], { breakAfter: true })
      : Promise.reject(new TypeError("Failed to fetch")))));
    const started = Date.now();
    const run = streamAgentChat({ message: "q" }, () => {});
    const settled = expect(run).rejects.toThrow(/could not reconnect/);
    await vi.runAllTimersAsync();
    await settled;
    expect(Date.now() - started).toBeGreaterThanOrEqual(180_000);
    expect(n).toBeGreaterThan(10);
  });

  it("restarts the reconnect clock whenever a reconnect makes progress", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++;
      if (n === 1) return ndjson([{ type: "cortex_run", runId: "7-11" }, { type: "text", text: "a", seq: 1 }], { breakAfter: true });
      if (n <= 25) return ndjson([{ type: "text", text: "b", seq: n }], { breakAfter: true });
      return ndjson([{ type: "done" }]);
    }));
    const run = streamAgentChat({ message: "q" }, () => {});
    await vi.runAllTimersAsync();
    await run;
    expect(n).toBe(26);
  });

  it("drops a connection that goes silent and resumes the run", async () => {
    vi.useFakeTimers();
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length > 1) return ndjson([{ type: "text", text: "answer", seq: 30 }, { type: "done" }]);
      // Sends the run id, then nothing: no data, no ping, no close.
      const enc = new TextEncoder();
      let sent = false;
      return new Response(new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(enc.encode(JSON.stringify({ type: "cortex_run", runId: "7-11" }) + "\n" + JSON.stringify({ type: "status", message: "x", seq: 4 }) + "\n"));
            return;
          }
          return new Promise<void>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
        },
      }));
    }));
    const seen: ChatEvent[] = [];
    const run = streamAgentChat({ message: "q" }, (e) => seen.push(e));
    await vi.runAllTimersAsync();
    await run;
    expect(bodies[1].resume).toEqual({ runId: "7-11", after: 4 });
    expect(seen.at(-1)).toMatchObject({ type: "done" });
  });

  it("replaces a partial turn when the answer is read back from the thread", () => {
    let t: Turn = { question: "q", text: "", steps: [], charts: [], done: false, startedAt: 0 };
    t = applyEvent(t, { type: "step", id: "a", name: "BrandEvidence", toolType: "generic", input: {} });
    t = applyEvent(t, { type: "text", text: "```rca\n{\"partial" });
    t = applyEvent(t, { type: "reset" });
    t = applyEvent(t, { type: "step", id: "a", name: "BrandEvidence", toolType: "generic", input: {} });
    t = applyEvent(t, { type: "step_result", id: "a", name: "BrandEvidence", status: "success" });
    t = applyEvent(t, { type: "text", text: "whole answer" });
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0].status).toBe("success");
    expect(t.text).toBe("whole answer");
  });
});
