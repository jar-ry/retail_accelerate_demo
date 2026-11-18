import { NextRequest } from "next/server";
import { resolveAgentFqn, getSpcsRestAuth, executeMultiple } from "@/lib/snowflake";
import { sessionUser } from "@/lib/hop/session";
import { agentStage, logAgentRun, type AgentStep } from "@/lib/campaign/agent-log";
import type { ToolResult } from "@/lib/campaign/agent-answer";

// Streaming requires the Node runtime and must not be statically optimised.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Groups this app's threads in the Threads API. Limited to 16 bytes.
const ORIGIN_APPLICATION = "sf_intelligence";

// ─── Surviving a dropped connection ───────────────────────────────────────────
//
// An investigation runs for a minute or more, and three things can cut the
// stream before it finishes: the app being redeployed or restarted (the
// container goes, and the request with it), the SPCS ingress closing a
// connection that has been silent for 90 seconds, and the browser's network.
// None of them should cost the user the answer, so:
//
//  * every run is a Cortex background run, which carries on when the caller
//    disconnects and can be streamed again from its run id;
//  * the browser is told that run id and the sequence number of every event it
//    gets, and reconnects with them (`resume`) when its stream breaks;
//  * a ping goes out whenever nothing else has for a while, so the ingress
//    never sees a silent connection;
//  * when the browser goes, the route stops writing to it but finishes the run
//    and logs it, and the audit row is keyed on the run id, so a run is logged
//    once however many requests streamed it.

/** One newline-delimited JSON event sent to the browser. The step, chart and
 *  thinking events feed the campaign agents' progress trail; the /agent page
 *  ignores types it does not know. Events taken from the agent's stream carry
 *  its sequence number, which is where a resumed stream picks up. */
type ClientEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "table"; title: string; columns: string[]; rows: unknown[][] }
  | { type: "thread"; threadId: number }
  | { type: "parent"; messageId: number }
  | { type: "cortex_run"; runId: string }
  | { type: "step"; id: string; name: string; toolType: string; input: unknown }
  | { type: "step_status"; id: string; message: string }
  | { type: "step_result"; id: string; name: string; status: string; content: unknown }
  | { type: "chart"; spec: string }
  | { type: "thinking"; text: string }
  | { type: "reset" }
  | { type: "ping" }
  | { type: "run"; runId: string; verified: boolean | null; unmatched: string[]; hasBlock: boolean }
  | { type: "error"; message: string }
  | { type: "done" };
type Sent = ClientEvent & { seq?: number };
type Send = (event: Sent) => void;

/** What one turn produced, kept for the campaign agents' audit row, and how far
 *  through the agent's stream this request has read. */
type RunState = {
  sawText: boolean; text: string; steps: AgentStep[]; results: ToolResult[]; error: string | null; streamed: boolean;
  runId: string | null; seq: number; finished: boolean;
};
const newState = (): RunState => ({
  sawText: false, text: "", steps: [], results: [], error: null, streamed: false,
  runId: null, seq: -1, finished: false,
});

/** A Cortex run id is `{thread_id}-{user_message_id}`. */
const RUN_ID = /^\d{1,20}-\d{1,20}$/;
const PING_MS = 15_000;
// Cortex sends a keep-alive every few seconds while a run is working, so a
// minute of nothing is a dead connection, not a slow agent.
const AGENT_IDLE_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tool result trimmed for the browser: the figures are what verification
 *  needs, so JSON results are kept whole up to a cap and the rest summarised. */
const RESULT_CAP = 60_000;
function trimResult(content: unknown): unknown {
  const s = JSON.stringify(content ?? null);
  return s.length <= RESULT_CAP ? content : { truncated: true, preview: s.slice(0, RESULT_CAP) };
}

/**
 * Render a Cortex result_set as a table the chat page can display.
 */
function resultSetToClientEvent(data: {
  title?: string;
  result_set?: {
    data?: unknown[][];
    resultSetMetaData?: { rowType?: Array<{ name: string }> };
  };
}): ClientEvent | null {
  const rs = data.result_set;
  if (!rs?.data?.length) return null;
  const columns = (rs.resultSetMetaData?.rowType || []).map((c) => c.name);
  if (!columns.length) return null;
  return { type: "table", title: data.title || "", columns, rows: rs.data };
}

/** The run a reconnecting browser asks for, and the last event it already has. */
function parseResume(raw: unknown): { runId: string; after: number } | null {
  const r = raw as { runId?: unknown; after?: unknown } | null;
  if (!r || typeof r.runId !== "string" || !RUN_ID.test(r.runId)) return null;
  const after = typeof r.after === "number" && Number.isInteger(r.after) && r.after >= -1 ? r.after : -1;
  return { runId: r.runId, after };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const message: string = (body.message || "").trim();
  // Thread state is owned by the browser and echoed back each turn, so the
  // server stays stateless across requests and container restarts.
  const incomingThreadId: number | null = body.threadId ?? null;
  const parentMessageId: number = body.parentMessageId ?? 0;
  // Which agent to talk to. Defaults to the category agent when absent, so an
  // older client that sends no id keeps working.
  const agentFqn = resolveAgentFqn(body.agent);
  // The campaign agents are logged to AI_RUN (src/lib/campaign/agent-log.ts).
  const stage = agentStage(String(body.agent ?? ""), body.stage);
  const user = sessionUser(request);
  const resume = parseResume(body.resume);

  if (!message) {
    return new Response(
      JSON.stringify({ type: "error", message: "No message provided." }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
      { status: 400, headers: { "Content-Type": "application/x-ndjson" } },
    );
  }

  const encoder = new TextEncoder();

  // Owner's rights: the agent runs as the app's service user (execution role
  // SALES_ENGINEER). Caller's rights would run it as the signed-in user, which
  // is what MCP tools need, but that requires GRANT CALLER on the execution
  // role -- an account-admin operation. Until those grants exist, sending the
  // caller token makes things worse, not better: a caller's-rights session
  // without caller grants has no privileges at all.

  // Whether the browser is still reading. Once it has gone, writes are dropped
  // rather than thrown, so the run still finishes and is logged.
  let open = true;
  let lastSent = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          lastSent = Date.now();
        } catch {
          open = false;
        }
      };
      const beat = setInterval(() => {
        if (Date.now() - lastSent >= PING_MS) send({ type: "ping" });
      }, 5_000);

      const state = newState();
      let threadId: number | null = incomingThreadId;
      try {
        const auth = getSpcsRestAuth();
        if (auth && resume) {
          threadId = await resumeRun(auth, resume, send, state);
        } else if (auth) {
          threadId = await runWithThread(auth, agentFqn, message, incomingThreadId, parentMessageId, send, state);
        } else {
          // Local development: no SPCS token is mounted, so fall back to the
          // non-streaming SQL function. Threads are not used on this path.
          await respondViaSqlFunction(agentFqn, message, send, state);
        }
      } catch (error: unknown) {
        state.error = error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", message: state.error });
      } finally {
        clearInterval(beat);
        if (stage) {
          const logged = await logAgentRun({ stage, agentFqn, campaignId: body.campaignId, question: message, text: state.text,
            steps: state.steps, results: state.results, threadId, user, error: state.error, streamed: state.streamed,
            cortexRunId: state.runId })
            .catch((e) => { console.error("[agent] run log failed", e); return null; });
          if (logged) send({ type: "run", ...logged });
        }
        send({ type: "done" });
        if (open) {
          try { controller.close(); } catch { /* the browser has gone */ }
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Prevent intermediate proxies from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}

type Auth = { host: string; token: string };

function restHeaders(auth: Auth, accept: string) {
  return {
    Authorization: `Bearer ${auth.token}`,
    "X-Snowflake-Authorization-Token-Type": "OAUTH",
    "Content-Type": "application/json",
    Accept: accept,
  };
}

/** Create a thread so conversation history is stored server-side. */
async function createThread(auth: Auth): Promise<number> {
  const res = await fetch(`https://${auth.host}/api/v2/cortex/threads`, {
    method: "POST",
    headers: restHeaders(auth, "application/json"),
    body: JSON.stringify({ origin_application: ORIGIN_APPLICATION }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Could not create thread (${res.status}): ${detail.slice(0, 400)}`,
    );
  }

  const json = await res.json();
  if (typeof json.thread_id !== "number") {
    throw new Error("Thread creation returned no thread_id.");
  }
  return json.thread_id;
}

/**
 * Run one turn against the agent using a thread. Only the new user message is
 * sent -- the service reconstructs prior context from the thread itself.
 */
async function runWithThread(
  auth: Auth,
  agentFqn: string,
  message: string,
  incomingThreadId: number | null,
  parentMessageId: number,
  send: Send,
  state: RunState,
): Promise<number> {
  let threadId = incomingThreadId;
  if (!threadId) {
    threadId = await createThread(auth);
    send({ type: "thread", threadId });
  }

  const [db, schema, name] = agentFqn.split(".");
  const url = `https://${auth.host}/api/v2/databases/${db}/schemas/${schema}/agents/${name}:run`;

  const res = await fetch(url, {
    method: "POST",
    headers: restHeaders(auth, "text/event-stream"),
    body: JSON.stringify({
      thread_id: threadId,
      parent_message_id: parentMessageId,
      // With a thread, messages carries only the current user turn.
      messages: [{ role: "user", content: [{ type: "text", text: message }] }],
      stream: true,
      // Keeps running if this request dies, so the browser can pick it up again.
      background: true,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.warn(`Agent REST API returned ${res.status}: ${detail.slice(0, 1200)}`);
    let msg = `Agent REST API returned ${res.status}.`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.message) msg = parsed.message;
    } catch {
      /* keep the generic message */
    }
    send({ type: "error", message: msg });
    state.error = msg;
    return threadId;
  }

  state.streamed = true;
  try {
    await readAgentStream(res.body, send, state, -1);
  } catch (e) {
    console.warn(`[agent] stream from Cortex dropped at seq ${state.seq}`, e);
  }
  if (!state.finished) {
    if (state.runId) await followRun(auth, send, state, -1, false);
    else state.error = "The agent's stream ended before it started. Ask again.";
  }

  if (!state.sawText) {
    console.warn(`Agent run produced no text. thread_id=${threadId}`);
  }
  return threadId;
}

/** Pick up a run the browser lost the stream of: replay it from the start, so
 *  this request has the whole turn to verify and log, and send the browser only
 *  what it has not had. */
async function resumeRun(
  auth: Auth,
  resume: { runId: string; after: number },
  send: Send,
  state: RunState,
): Promise<number> {
  state.runId = resume.runId;
  state.streamed = true;
  await followRun(auth, send, state, resume.after, true);
  return Number(resume.runId.split("-")[0]);
}

/**
 * Stream a background run by id until it ends. Each attempt replays the run
 * from its first event, and the events this request has already read are
 * skipped. A run that ended more than five minutes ago can no longer be
 * attached to (409, or the stream opens with error 399528), and its answer is
 * read from the thread instead; 399528 can also be a run that has only just
 * started, so the thread is checked once and the attach retried if it has no
 * reply yet.
 */
async function followRun(auth: Auth, send: Send, state: RunState, forwardAfter: number, immediate: boolean): Promise<void> {
  const url = `https://${auth.host}/api/v2/cortex/agent/runs/${encodeURIComponent(state.runId ?? "")}`;
  for (let attempt = 0; attempt < 6 && !state.finished; attempt++) {
    if (attempt > 0 || !immediate) await sleep(Math.min(1000 * 2 ** attempt, 8000));
    let res: Response;
    try {
      res = await fetch(url, { headers: restHeaders(auth, "text/event-stream") });
    } catch {
      continue;
    }
    if (res.status === 409 || res.status === 404) break;
    if (!res.ok || !res.body) continue;
    try {
      await readAgentStream(res.body, send, state, forwardAfter);
    } catch (e) {
      if (e instanceof NotAttachable) {
        if (await answerFromThread(auth, send, state, 1)) return;
      } else {
        console.warn(`[agent] run ${state.runId} stream dropped at seq ${state.seq}`, e);
      }
    }
  }
  if (!state.finished && !(await answerFromThread(auth, send, state, 60))) {
    state.error = "The connection to the agent dropped and its answer could not be recovered. Ask again.";
  }
}

class NotAttachable extends Error {}

/** Read the run's reply from its thread, where Cortex stores the whole
 *  assistant message: every tool call and result, and the text. A run that is
 *  still going has no reply yet, so this polls, every 3 seconds, `attempts`
 *  times; it returns whether the reply was found. */
async function answerFromThread(auth: Auth, send: Send, state: RunState, attempts: number): Promise<boolean> {
  const [threadId, userMessageId] = (state.runId ?? "").split("-");
  if (!threadId || !userMessageId) return false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(3000);
    let messages: Array<Record<string, any>>;
    try {
      const res = await fetch(`https://${auth.host}/api/v2/cortex/threads/${threadId}?page_size=20`, {
        headers: restHeaders(auth, "application/json"),
      });
      if (!res.ok) continue;
      messages = (await res.json()).messages ?? [];
    } catch {
      continue;
    }
    const reply = messages.find((m) => m.role === "assistant" && String(m.parent_id) === userMessageId);
    if (!reply) continue;
    let payload: Record<string, any>;
    try {
      payload = typeof reply.message_payload === "string" ? JSON.parse(reply.message_payload) : reply.message_payload ?? {};
    } catch {
      continue;
    }
    // The browser may hold part of the turn already; it is rebuilt whole.
    send({ type: "reset" });
    Object.assign(state, { sawText: false, text: "", steps: [], results: [] });
    replayContent(payload.content ?? [], send, state);
    if (typeof reply.message_id === "number") send({ type: "parent", messageId: reply.message_id });
    if (payload.status === "error") {
      state.error = payload.error?.message || "The agent returned an error.";
      send({ type: "error", message: state.error! });
    }
    state.finished = true;
    return true;
  }
  return false;
}

/** Read an agent event stream, process every event this request has not seen,
 *  and forward to the browser the ones after `forwardAfter`. */
async function readAgentStream(body: ReadableStream<Uint8Array>, send: Send, state: RunState, forwardAfter: number): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A read that hears nothing for AGENT_IDLE_MS fails, and followRun reattaches.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nextChunk = () => {
    clearTimeout(timer);
    const silent = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("agent stream idle")), AGENT_IDLE_MS);
    });
    silent.catch(() => {});
    return Promise.race([reader.read(), silent]);
  };
  try {
    while (!state.finished) {
      const { done, value } = await nextChunk();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        handleFrame(frame, send, state, forwardAfter);
      }
    }
    if (buffer.trim()) handleFrame(buffer, send, state, forwardAfter);
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
}

/** Parse one SSE frame and forward anything displayable to the browser. */
function handleFrame(
  frame: string,
  send: Send,
  state: RunState,
  forwardAfter: number,
): void {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (eventName === "done") {
    state.finished = true;
    return;
  }
  if (!dataLines.length) return;

  let data: Record<string, any>;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  // Attaching to a run can be refused: it has only just started, or it ended
  // too long ago to replay. Either way that is not an event of the run, and
  // followRun decides what to do.
  if (eventName === "error" && String(data.code) === "399528") {
    throw new NotAttachable("run stream not attachable");
  }

  // A replayed stream starts from the first event; skip what this request has
  // already read, and tell the browser only what it has not seen.
  const seq = typeof data.sequence_number === "number" ? data.sequence_number : null;
  if (seq !== null) {
    if (seq <= state.seq) return;
    state.seq = seq;
  }
  const emit: (e: ClientEvent) => void = seq === null || seq > forwardAfter
    ? (e) => send(seq === null ? e : { ...e, seq })
    : () => {};

  switch (eventName) {
    case "response.text.delta":
      if (data.text) {
        emit({ type: "text", text: data.text });
        state.sawText = true;
        state.text += data.text;
      }
      break;

    case "response.status":
      if (data.message) emit({ type: "status", message: data.message });
      break;

    case "response.tool_use":
      onToolUse(data, emit, state);
      break;

    case "response.tool_result.status":
      emit({ type: "step_status", id: String(data.tool_use_id ?? ""), message: String(data.message ?? data.status ?? "") });
      break;

    case "response.tool_result":
      onToolResult(data, emit, state);
      break;

    case "response.chart":
      if (data.chart_spec) emit({ type: "chart", spec: String(data.chart_spec) });
      break;

    case "response.thinking.delta":
      if (data.text) emit({ type: "thinking", text: data.text });
      break;

    case "response.table": {
      const event = resultSetToClientEvent(data);
      if (event) emit(event);
      break;
    }

    case "metadata": {
      // Only the assistant message ID is a valid parent for the next turn;
      // passing a user message ID breaks the conversation.
      const meta = data.metadata || {};
      if (meta.role === "assistant" && typeof meta.message_id === "number") {
        emit({ type: "parent", messageId: meta.message_id });
      }
      // The run id comes with the user message, first; the browser keeps it
      // to reconnect with.
      if (!state.runId && typeof meta.run_id === "string" && RUN_ID.test(meta.run_id)) {
        state.runId = meta.run_id;
        send({ type: "cortex_run", runId: meta.run_id });
      }
      break;
    }

    case "response.warning":
      console.warn(`Agent warning: ${data.message}`);
      break;

    case "error":
      console.warn(`Agent stream error: ${JSON.stringify(data)}`);
      state.error = data.message || "The agent returned an error.";
      state.finished = true;
      emit({
        type: "error",
        message: data.message || "The agent returned an error.",
      });
      break;

    case "response": {
      // Final aggregated event. Text is only needed if no deltas streamed.
      if (!state.sawText) {
        const text = emitFromContent(data.content || [], emit);
        if (text) {
          state.sawText = true;
          state.text = text;
        }
      }
      if (typeof data.metadata?.assistant_message_id === "number") {
        emit({ type: "parent", messageId: data.metadata.assistant_message_id });
      }
      state.finished = true;
      break;
    }

    default:
      // Unknown event types are ignored by design.
      break;
  }
}

function onToolUse(data: Record<string, any>, emit: (e: ClientEvent) => void, state: RunState): void {
  const step = { id: String(data.tool_use_id ?? ""), name: String(data.name ?? ""), toolType: String(data.type ?? ""), input: data.input ?? null };
  state.steps.push(step);
  emit({ type: "step", ...step });
}

function onToolResult(data: Record<string, any>, emit: (e: ClientEvent) => void, state: RunState): void {
  const id = String(data.tool_use_id ?? "");
  const status = String(data.status ?? "");
  const step = state.steps.find((s) => s.id === id);
  if (step) step.status = status;
  state.results.push({ name: String(data.name ?? ""), status, content: data.content });
  emit({ type: "step_result", id, name: String(data.name ?? ""), status, content: trimResult(data.content) });
}

/** Replay a stored assistant message (its content array, as the thread keeps
 *  it) as the events its live stream would have sent. */
function replayContent(content: Array<Record<string, any>>, send: Send, state: RunState): void {
  for (const item of content) {
    if (item.type === "tool_use" && item.tool_use) onToolUse(item.tool_use, send, state);
    else if (item.type === "tool_result" && item.tool_result) onToolResult(item.tool_result, send, state);
    else if (item.type === "chart" && item.chart?.chart_spec) send({ type: "chart", spec: String(item.chart.chart_spec) });
    else if (item.type === "table" && item.table) {
      const event = resultSetToClientEvent(item.table);
      if (event) send(event);
    } else if (item.type === "text" && item.text) {
      send({ type: "text", text: (state.text ? "\n\n" : "") + item.text });
      state.text += (state.text ? "\n\n" : "") + item.text;
      state.sawText = true;
    }
  }
}

/** Emit the text and tables from an aggregated agent content array; returns
 *  the text (empty when there was none). */
function emitFromContent(
  content: Array<Record<string, any>>,
  send: (event: ClientEvent) => void,
): string {
  const texts: string[] = [];
  for (const item of content) {
    if (item.type === "text" && item.text) texts.push(item.text);
    if (item.type === "table" && item.table) {
      const event = resultSetToClientEvent(item.table);
      if (event) send(event);
    }
  }
  const text = texts.join("\n\n");
  if (text) send({ type: "text", text });
  return text;
}

/**
 * Local-development fallback via SNOWFLAKE.CORTEX.DATA_AGENT_RUN. Emits the
 * answer in one chunk and does not participate in threads, so follow-up
 * questions have no conversation history.
 */
async function respondViaSqlFunction(
  agentFqn: string,
  message: string,
  send: Send,
  state: RunState,
) {
  send({ type: "status", message: "Analysing your question" });

  // The payload sits inside a $$...$$ literal, so a message containing "$$"
  // would close it. \u0024 is the JSON escape for "$": the agent reads the same
  // text, but the SQL never sees a dollar sign.
  const payload = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: message }] }],
  }).replace(/\$/g, "\\u0024");
  const results = await executeMultiple([
    `SELECT TRY_PARSE_JSON(
       SNOWFLAKE.CORTEX.DATA_AGENT_RUN('${agentFqn}', $$${payload}$$)
     ) AS RESPONSE`,
  ]);

  const raw = results[0]?.[0]?.RESPONSE;
  if (raw) {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const text = emitFromContent(parsed.content || [], send);
    if (text) {
      state.text = text;
      return;
    }
    // DATA_AGENT_RUN reports failures as a plain object rather than raising.
    console.warn(`Agent returned no text. Keys: ${Object.keys(parsed).join(", ")}`);
    if (parsed.message) {
      send({ type: "error", message: parsed.message });
      return;
    }
  }

  send({
    type: "error",
    message: "The agent did not return an answer. Check the app logs for details.",
  });
}
