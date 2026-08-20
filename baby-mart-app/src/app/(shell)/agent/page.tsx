"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TableBlock {
  title: string;
  columns: string[];
  rows: unknown[][];
}

interface Message {
  role: string;
  content: string;
  tables?: TableBlock[];
}

const GREETING: Message = {
  role: "assistant",
  content:
    "Hi! I'm your Category Intelligence Agent. I can help you analyse brand performance, customer segments, competitive pricing, and promotional effectiveness across all Baby Mart categories. What would you like to know?",
};

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Conversation history lives in the Cortex thread, not in this component.
  // Refs (not state) so the values are current the moment a turn is sent.
  const threadId = useRef<number | null>(null);
  const parentMessageId = useRef<number>(0);

  // Keep the newest tokens in view while the answer streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  /** Apply a streamed event to the in-progress assistant message. */
  const appendToLast = (fn: (msg: Message) => Message) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    setStatus("");

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          threadId: threadId.current,
          parentMessageId: parentMessageId.current,
        }),
      });
      if (!res.body) throw new Error("No response stream");

      // Placeholder that the streamed tokens are appended to.
      setMessages((prev) => [...prev, { role: "assistant", content: "", tables: [] }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let event: Record<string, any>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "text") {
            setStatus("");
            appendToLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "status") {
            setStatus(event.message);
          } else if (event.type === "thread") {
            threadId.current = event.threadId;
          } else if (event.type === "parent") {
            // Anchor the next turn to this assistant message.
            parentMessageId.current = event.messageId;
          } else if (event.type === "table") {
            appendToLast((m) => ({
              ...m,
              tables: [
                ...(m.tables || []),
                { title: event.title, columns: event.columns, rows: event.rows },
              ],
            }));
          } else if (event.type === "error") {
            appendToLast((m) => ({
              ...m,
              content: m.content + `\n\n_${event.message}_`,
            }));
          }
        }
      }

      // Guard against a stream that closed without producing any answer.
      appendToLast((m) =>
        m.content || m.tables?.length
          ? m
          : { ...m, content: "I couldn't generate a response." },
      );
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
      ]);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Category Intelligence Agent</h1>
            <p className="text-xs text-slate-500">Powered by Cortex Agent + Semantic View</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-blue-700 text-white"
                : "bg-white border border-slate-200 text-slate-800 shadow-sm"
            }`}>
              {msg.role === "user" ? msg.content : (
                <>
                  <div className="prose prose-sm max-w-none prose-headings:text-sm prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-li:my-0.5">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ children }) => (
                          <div className="my-3 rounded-lg border border-slate-200 overflow-x-auto">
                            <table className="w-full text-xs border-collapse">{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="bg-slate-50 border-b border-slate-200">{children}</thead>
                        ),
                        th: ({ children }) => (
                          <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{children}</th>
                        ),
                        td: ({ children }) => (
                          <td className="px-3 py-1.5 border-t border-slate-100 whitespace-nowrap">{children}</td>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  {msg.tables?.map((t, ti) => (
                    <div key={ti} className="my-3">
                      {t.title && (
                        <p className="text-xs font-semibold text-slate-600 mb-1">{t.title}</p>
                      )}
                      <div className="rounded-lg border border-slate-200 overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {t.columns.map((c) => (
                                <th key={c} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {t.rows.map((row, ri) => (
                              <tr key={ri}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-3 py-1.5 border-t border-slate-100 whitespace-nowrap">{String(cell ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              {status && <span className="text-xs text-slate-500">{status}</span>}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about category performance, brand trends, competitive pricing..."
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          {["Top 5 brands by revenue growth this year", "Which brands are losing the most customers in Nappies & Wipes?", "Compare Huggies promotion effectiveness by mechanic"].map((q) => (
            <button
              key={q}
              onClick={() => { setInput(q); }}
              className="text-[11px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full hover:bg-slate-200 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
