"use client";

// ─── Reading /api/agent/chat, through dropped connections ─────────────────────
//
// An agent run takes a minute or more, and the stream can break before it ends:
// the app being redeployed, the platform's ingress, the browser's network. The
// run itself carries on (it is a Cortex background run), so a broken stream is
// not a failed run. The route sends the run's id and numbers each event, and
// when the stream breaks before its `done`, or goes silent, this reconnects to
// the same run from the last event it had, so the user sees the answer rather
// than "network error".

export type ChatEvent = { type: string; seq?: number } & Record<string, any>;

// A redeploy takes the app away for a minute or two while the run carries on,
// so reconnecting keeps trying for longer than that; any progress restarts the
// clock.
const RECONNECT_FOR_MS = 180_000;
// The route pings every 15 s, so this long without a byte is a dead connection.
const SILENT_MS = 45_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Post a question (or a follow-up) to an agent and hand each event to `onEvent`
 *  until the run is done, reconnecting to it when the stream breaks. */
export async function streamAgentChat(body: Record<string, unknown>, onEvent: (e: ChatEvent) => void): Promise<void> {
  let runId: string | null = null;
  let seq = -1;
  let done = false;

  /** One request; returns whether the server refused it outright (4xx), which
   *  no retry will fix. */
  const read = async (payload: Record<string, unknown>): Promise<boolean> => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(new Error("The agent's stream went silent.")), SILENT_MS);
    };
    arm();
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      if (!res.body) throw new Error(`The agent did not answer (HTTP ${res.status}).`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        arm();
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let e: ChatEvent;
          try {
            e = JSON.parse(line);
          } catch {
            continue; // not ours: an error page from the platform mid-restart
          }
          if (e.type === "cortex_run" && typeof e.runId === "string") runId = e.runId;
          if (typeof e.seq === "number" && e.seq > seq) seq = e.seq;
          if (e.type === "done") done = true;
          if (e.type !== "ping" && e.type !== "cortex_run") onEvent(e);
        }
      }
      return res.status >= 400 && res.status < 500;
    } finally {
      clearTimeout(timer);
    }
  };

  let lastError: unknown = null;
  try {
    if (await read(body)) return;
  } catch (e) {
    lastError = e;
  }
  let deadline = Date.now() + RECONNECT_FOR_MS;
  for (let attempt = 0; !done && runId && Date.now() < deadline; attempt++) {
    onEvent({ type: "status", message: "The connection dropped. Reconnecting to the agent" });
    await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    const before = seq;
    try {
      if (await read({ ...body, resume: { runId, after: seq } })) return;
    } catch (e) {
      lastError = e;
    }
    if (seq > before) {
      attempt = -1;
      deadline = Date.now() + RECONNECT_FOR_MS;
    }
  }
  if (done) return;
  if (!runId) {
    throw new Error("The connection dropped before the agent started. Ask again.");
  }
  console.warn("[agent] could not reconnect to run", runId, lastError);
  throw new Error("Lost the connection to the agent and could not reconnect. Ask again.");
}
