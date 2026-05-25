import { useState } from "react";
import { Bot, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: string;
  content: string;
}

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm your Category Intelligence Agent. I can help you analyse brand performance, customer segments, competitive pricing, and promotional effectiveness across all Baby Mart categories. What would you like to know?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      const content = data.content || "I'm analysing your request...";
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setLoading(false);
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
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
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
