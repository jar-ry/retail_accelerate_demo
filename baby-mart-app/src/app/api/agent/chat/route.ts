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

/** One newline-delimited JSON event sent to the browser. The step, chart and
 *  thinking events feed the campaign agents' progress trail; the /agent page
 *  ignores types it does not know. */
type ClientEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "table"; title: string; columns: string[]; rows: unknown[][] }
  | { type: "thread"; threadId: number }
  | { type: "parent"; messageId: number }
  | { type: "step"; id: string; name: string; toolType: string; input: unknown }
  | { type: "step_status"; id: string; message: string }
  | { type: "step_result"; id: string; name: string; status: string; content: unknown }
  | { type: "chart"; spec: string }
  | { type: "thinking"; text: string }
  | { type: "run"; runId: string; verified: boolean | null; unmatched: string[]; hasBlock: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

/** What one turn produced, kept for the campaign agents' audit row. */
type RunState = { sawText: boolean; text: string; steps: AgentStep[]; results: ToolResult[]; error: string | null; streamed: boolean };
const newState = (): RunState => ({ sawText: false, text: "", steps: [], results: [], error: null, streamed: false });

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

  if (!message) {
    return new Response(
      JSON.stringify({ type: "error", message: "No message provided." }) + "\n",
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ClientEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      const state = newState();
      let threadId: number | null = incomingThreadId;
      try {
        const auth = getSpcsRestAuth();
        if (auth) {
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
        if (stage) {
          const logged = await logAgentRun({ stage, agentFqn, campaignId: body.campaignId, question: message, text: state.text,
            steps: state.steps, results: state.results, threadId, user, error: state.error, streamed: state.streamed })
            .catch((e) => { console.error("[agent] run log failed", e); return null; });
          if (logged) send({ type: "run", ...logged });
        }
        send({ type: "done" });
        controller.close();
      }
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
  send: (event: ClientEvent) => void,
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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  state.streamed = true;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      handleFrame(frame, send, state);
    }
  }

  if (!state.sawText) {
    console.warn(`Agent run produced no text. thread_id=${threadId}`);
  }
  return threadId;
}

/** Parse one SSE frame and forward anything displayable to the browser. */
function handleFrame(
  frame: string,
  send: (event: ClientEvent) => void,
  state: RunState,
): void {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;

  let data: Record<string, any>;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  switch (eventName) {
    case "response.text.delta":
      if (data.text) {
        send({ type: "text", text: data.text });
        state.sawText = true;
        state.text += data.text;
      }
      break;

    case "response.status":
      if (data.message) send({ type: "status", message: data.message });
      break;

    case "response.tool_use": {
      const step = { id: String(data.tool_use_id ?? ""), name: String(data.name ?? ""), toolType: String(data.type ?? ""), input: data.input ?? null };
      state.steps.push(step);
      send({ type: "step", ...step });
      break;
    }

    case "response.tool_result.status":
      send({ type: "step_status", id: String(data.tool_use_id ?? ""), message: String(data.message ?? data.status ?? "") });
      break;

    case "response.tool_result": {
      const id = String(data.tool_use_id ?? "");
      const status = String(data.status ?? "");
      const step = state.steps.find((s) => s.id === id);
      if (step) step.status = status;
      state.results.push({ name: String(data.name ?? ""), status, content: data.content });
      send({ type: "step_result", id, name: String(data.name ?? ""), status, content: trimResult(data.content) });
      break;
    }

    case "response.chart":
      if (data.chart_spec) send({ type: "chart", spec: String(data.chart_spec) });
      break;

    case "response.thinking.delta":
      if (data.text) send({ type: "thinking", text: data.text });
      break;

    case "response.table": {
      const event = resultSetToClientEvent(data);
      if (event) send(event);
      break;
    }

    case "metadata": {
      // Only the assistant message ID is a valid parent for the next turn;
      // passing a user message ID breaks the conversation.
      const meta = data.metadata || {};
      if (meta.role === "assistant" && typeof meta.message_id === "number") {
        send({ type: "parent", messageId: meta.message_id });
      }
      break;
    }

    case "response.warning":
      console.warn(`Agent warning: ${data.message}`);
      break;

    case "error":
      console.warn(`Agent stream error: ${JSON.stringify(data)}`);
      state.error = data.message || "The agent returned an error.";
      send({
        type: "error",
        message: data.message || "The agent returned an error.",
      });
      break;

    case "response": {
      // Final aggregated event. Text is only needed if no deltas streamed.
      if (!state.sawText) {
        const text = emitFromContent(data.content || [], send);
        if (text) {
          state.sawText = true;
          state.text = text;
        }
      }
      if (typeof data.metadata?.assistant_message_id === "number") {
        send({ type: "parent", messageId: data.metadata.assistant_message_id });
      }
      break;
    }

    default:
      // Unknown event types are ignored by design.
      break;
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
  send: (event: ClientEvent) => void,
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
