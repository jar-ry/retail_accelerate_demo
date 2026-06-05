"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Users, Filter, Sparkles, Send, ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import { useAudience } from "@/context/AudienceContext";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Breakdown { label: string; count: number; }
interface ChatMessage { role: "user" | "assistant"; content: string; sql?: string; data?: Record<string, unknown>[]; suggested?: string[]; }
interface Filters {
  segments: string[];
  states: string[];
  loyaltyTiers: string[];
  gender: string;
  minSpend: number;
  recencyDays: number;
}

const ALL_SEGMENTS = ["First-time Parents", "Second-time Parents", "Gift Buyers", "Grandparents", "Expecting", "Registry Shoppers"];
const ALL_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "ACT", "NT", "TAS"];
const ALL_TIERS = ["Bronze", "Silver", "Gold", "Platinum"];
const COLORS = ["#f59e0b", "#2563eb", "#10b981", "#8b5cf6", "#ec4899", "#64748b", "#ef4444", "#06b6d4"];
const DEFAULT_FILTERS: Filters = { segments: [], states: [], loyaltyTiers: [], gender: "All", minSpend: 0, recencyDays: 730 };

function buildFilterContext(f: Filters): string {
  const parts: string[] = [];
  if (f.segments.length > 0) parts.push(`Segments=${f.segments.join(",")}`);
  if (f.states.length > 0) parts.push(`States=${f.states.join(",")}`);
  if (f.loyaltyTiers.length > 0) parts.push(`Loyalty=${f.loyaltyTiers.join(",")}`);
  if (f.gender !== "All") parts.push(`Gender=${f.gender}`);
  if (f.minSpend > 0) parts.push(`MinSpend=$${f.minSpend}`);
  if (f.recencyDays < 730) parts.push(`Recency=${f.recencyDays}days`);
  return parts.join("; ");
}

export default function AudienceBuilderPage() {
  const { state: audienceCtx, setFilters: setCtxFilters, setAudienceSize: setCtxAudienceSize, setReachable: setCtxReachable, setAudienceLabel } = useAudience();
  const [filters, setFiltersLocal] = useState<Filters>(audienceCtx.filters);
  const setFilters = (f: Filters | ((prev: Filters) => Filters)) => {
    const next = typeof f === "function" ? f(filters) : f;
    setFiltersLocal(next);
    setCtxFilters(next);
    // Build label
    const parts: string[] = [];
    if (next.segments.length > 0) parts.push(next.segments.join(", "));
    if (next.states.length > 0) parts.push(next.states.join(", "));
    if (next.loyaltyTiers.length > 0) parts.push(next.loyaltyTiers.join(" & "));
    setAudienceLabel(parts.length > 0 ? parts.join(" | ") : "All Customers");
  };
  const [showFilters, setShowFilters] = useState(false);
  const [syncedFromAgent, setSyncedFromAgent] = useState(false);
  const [audienceSize, setAudienceSizeLocal] = useState(audienceCtx.audienceSize);
  const setAudienceSize = (n: number) => { setAudienceSizeLocal(n); setCtxAudienceSize(n); };
  const [reachable, setReachableLocal] = useState(audienceCtx.reachable);
  const setReachable = (n: number) => { setReachableLocal(n); setCtxReachable(n); };
  const [totalBase, setTotalBase] = useState(150000);
  const [pct, setPct] = useState(0);
  const [stateData, setStateData] = useState<Breakdown[]>([]);
  const [segmentData, setSegmentData] = useState<Breakdown[]>([]);
  const [ageData, setAgeData] = useState<Breakdown[]>([]);
  const [execSummary, setExecSummary] = useState("");
  const [loading, setLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [expandedSQL, setExpandedSQL] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const refresh = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const [countRes, stateRes, segRes, ageRes] = await Promise.all([
        fetch("/api/campaign/audience/count", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
        fetch("/api/campaign/audience/breakdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: f, groupBy: "state" }) }),
        fetch("/api/campaign/audience/breakdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: f, groupBy: "segment" }) }),
        fetch("/api/campaign/audience/breakdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: f, groupBy: "age" }) }),
      ]);
      const countData = await countRes.json();
      setAudienceSize(countData.audienceSize);
      setReachable(countData.reachable);
      setTotalBase(countData.totalBase);
      setPct(countData.pctOfBase);
      setStateData(await stateRes.json());
      setSegmentData(await segRes.json());
      setAgeData(await ageRes.json());
    } catch {}
    setLoading(false);
  }, []);

  const fetchInsights = useCallback(async () => {
    const res = await fetch("/api/campaign/audience/insights", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters, audienceSize, breakdown: { state: stateData, segment: segmentData } }),
    });
    const data = await res.json();
    setExecSummary(data.insights || "");
  }, [filters, audienceSize, stateData, segmentData]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => refresh(filters), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [filters, refresh]);

  // Chat send
  const sendMessage = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const filterCtx = buildFilterContext(filters);
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/campaign/agent/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, filterContext: filterCtx }),
      });
      const result = await res.json();
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.text || "No response received.",
        sql: result.sql || undefined,
        data: result.data || undefined,
        suggested: result.suggested || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Bidirectional sync: extract filters from SQL
      if (result.sql) {
        try {
          const extractRes = await fetch("/api/campaign/audience/extract-filters", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: result.sql }),
          });
          const extracted = await extractRes.json();
          if (extracted && Object.keys(extracted).length > 0) {
            setFilters((prev) => ({ ...prev, ...extracted }));
            setSyncedFromAgent(true);
            setTimeout(() => setSyncedFromAgent(false), 5000);
          }
        } catch {}
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }]);
    }
    setChatLoading(false);
  };

  const toggleSQL = (idx: number) => setExpandedSQL((prev) => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const toggleArray = (arr: string[], val: string) => arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];

  const handleExport = async () => {
    const res = await fetch("/api/campaign/audience/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filters) });
    const data = await res.json();
    const rows = data.rows || [];
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r: Record<string, unknown>) => headers.map((h) => `"${String(r[h] ?? "")}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `baby_mart_audience_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 flex flex-col h-full overflow-hidden">
      {/* Metrics Bar */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-5 flex-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center"><Users className="w-4 h-4 text-amber-700" /></div>
            <div><div className="font-mono text-lg font-bold text-amber-700">{loading ? "..." : audienceSize.toLocaleString()}</div><div className="text-[10px] text-slate-400">Audience</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div><div className="font-mono text-lg font-bold text-slate-800">{loading ? "..." : `${pct}%`}</div><div className="text-[10px] text-slate-400">of {totalBase.toLocaleString()}</div></div>
          </div>
          <div className="flex items-center gap-2">
            <div><div className="font-mono text-lg font-bold text-emerald-600">{loading ? "..." : reachable.toLocaleString()}</div><div className="text-[10px] text-slate-400">Reachable</div></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"><Download className="w-3.5 h-3.5" />CSV</button>
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg ${showFilters ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><Filter className="w-3.5 h-3.5" />Filters</button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Left: Chat */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-semibold text-slate-600">AI Audience Agent</div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm mb-1">Ask me about your audience</p>
                <p className="text-xs">Try: &quot;How many first-time parents in NSW spent over $500?&quot;</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`${msg.role === "user" ? "flex justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${msg.role === "user" ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.sql && (
                    <>
                      <button onClick={() => toggleSQL(i)} className="flex items-center gap-1 mt-2 text-[10px] text-slate-500 hover:text-slate-700">
                        {expandedSQL.has(i) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {expandedSQL.has(i) ? "Hide SQL" : "Show SQL"}
                      </button>
                      {expandedSQL.has(i) && <pre className="mt-1.5 p-2 bg-slate-800 text-emerald-300 text-[10px] rounded-lg overflow-x-auto">{msg.sql}</pre>}
                    </>
                  )}
                  {msg.suggested && msg.suggested.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.suggested.map((s, j) => (
                        <button key={j} onClick={() => sendMessage(s)} className="px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[10px] text-slate-600 hover:bg-amber-50 hover:border-amber-200">{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex gap-1.5 px-3 py-2"><div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" /><div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce [animation-delay:0.1s]" /><div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce [animation-delay:0.2s]" /></div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-3 border-t border-slate-100 flex gap-2">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); } }} placeholder="Ask about your audience..." disabled={chatLoading} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
            <button onClick={() => sendMessage(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40"><Send className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Right: Charts + Insights */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* AI Insights */}
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-500" />AI Insights</h4>
              <button onClick={fetchInsights} className="text-[10px] px-2 py-0.5 bg-amber-600 text-white rounded font-medium hover:bg-amber-700">Generate</button>
            </div>
            {execSummary ? <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{execSummary}</div> : <div className="text-[11px] text-slate-400 italic">Click Generate for AI recommendations</div>}
          </div>

          {/* State */}
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">State Breakdown</h4>
            {loading ? <div className="h-32 bg-slate-100 rounded animate-pulse" /> : (
              <Plot data={[{ y: stateData.map((d) => d.label), x: stateData.map((d) => d.count), type: "bar" as const, orientation: "h" as const, marker: { color: "#f59e0b" } }]} layout={{ height: 160, margin: { l: 35, r: 10, t: 5, b: 20 }, font: { size: 9, family: "Inter" }, xaxis: { showgrid: false } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
            )}
          </div>

          {/* Segment */}
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">Segment Breakdown</h4>
            {loading ? <div className="h-32 bg-slate-100 rounded animate-pulse" /> : (
              <Plot data={[{ values: segmentData.map((d) => d.count), labels: segmentData.map((d) => d.label), type: "pie" as const, hole: 0.4, marker: { colors: COLORS }, textinfo: "percent" as const, textfont: { size: 8 } }]} layout={{ height: 150, margin: { l: 5, r: 5, t: 5, b: 5 }, showlegend: false, font: { size: 8, family: "Inter" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
            )}
          </div>

          {/* Age */}
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">Age Breakdown</h4>
            {loading ? <div className="h-28 bg-slate-100 rounded animate-pulse" /> : (
              <Plot data={[{ x: ageData.map((d) => d.label), y: ageData.map((d) => d.count), type: "bar" as const, marker: { color: "#8b5cf6" } }]} layout={{ height: 120, margin: { l: 30, r: 5, t: 5, b: 25 }, font: { size: 9, family: "Inter" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
            )}
          </div>
        </div>

        {/* Filter Sidebar (overlay) */}
        {showFilters && (
          <div className="w-56 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700">Filters</h3>
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[10px] text-amber-600 hover:underline">Reset</button>
            </div>
            {syncedFromAgent && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 font-medium">
                <RefreshCw className="w-3 h-3" />Synced from agent
              </div>
            )}
            {/* Segments */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Segment</div>
              {ALL_SEGMENTS.map((s) => (<label key={s} className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer"><input type="checkbox" checked={filters.segments.includes(s)} onChange={() => setFilters((f) => ({ ...f, segments: toggleArray(f.segments, s) }))} className="rounded border-slate-300 text-amber-500 w-3 h-3" />{s}</label>))}
            </div>
            {/* States */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">State</div>
              <div className="flex flex-wrap gap-1">{ALL_STATES.map((s) => (<button key={s} onClick={() => setFilters((f) => ({ ...f, states: toggleArray(f.states, s) }))} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${filters.states.includes(s) ? "bg-amber-100 border-amber-300 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-500"}`}>{s}</button>))}</div>
            </div>
            {/* Loyalty */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Loyalty</div>
              {ALL_TIERS.map((t) => (<label key={t} className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer"><input type="checkbox" checked={filters.loyaltyTiers.includes(t)} onChange={() => setFilters((f) => ({ ...f, loyaltyTiers: toggleArray(f.loyaltyTiers, t) }))} className="rounded border-slate-300 text-amber-500 w-3 h-3" />{t}</label>))}
            </div>
            {/* Gender */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Gender</div>
              <select value={filters.gender} onChange={(e) => setFilters((f) => ({ ...f, gender: e.target.value }))} className="w-full text-[11px] border border-slate-200 rounded px-2 py-1"><option value="All">All</option><option value="F">Female</option><option value="M">Male</option></select>
            </div>
            {/* Min Spend */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Min Spend: ${filters.minSpend}</div>
              <input type="range" min={0} max={5000} step={100} value={filters.minSpend} onChange={(e) => setFilters((f) => ({ ...f, minSpend: parseInt(e.target.value) }))} className="w-full accent-amber-500 h-1.5" />
            </div>
            {/* Recency */}
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Recency: {filters.recencyDays}d</div>
              <input type="range" min={7} max={730} value={filters.recencyDays} onChange={(e) => setFilters((f) => ({ ...f, recencyDays: parseInt(e.target.value) }))} className="w-full accent-amber-500 h-1.5" />
              <div className="flex justify-between text-[9px] text-slate-400"><span>7d</span><span>2yr</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
