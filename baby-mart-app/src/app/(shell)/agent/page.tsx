"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Lightbulb, RotateCcw, Search, Send, Sparkles } from "lucide-react";
import { LookupAnswer, Working, useLookupChat, type LookupTurn } from "@/components/agent/LookupChat";
import { ProgressTrail } from "@/components/agent/ProgressTrail";
import { AgentAnswer } from "@/components/agent/AgentCards";
import { useAgentRun } from "@/components/agent/useAgentRun";
import {
  investigateQuestion, namedBrand, routeCategoryQuestion, type CategoryMode, type CategoryRoute,
} from "@/lib/ai/category-route";

/** The two agents this page can front. Selected by the ?persona= tag the sidebar
 *  puts on its link, so a merchandise planner and a category manager get the
 *  agent that reads their data -- not one agent guessing between two businesses.
 *
 *  Read from window rather than useSearchParams: this page is statically
 *  prerendered and useSearchParams would force it into a Suspense boundary. */
const MERCH = {
  id: "merch",
  title: "Merch Planning Agent",
  subtitle: "Baby Mart merchandise plan, open-to-buy and scenarios",
  greeting:
    "Hi! I'm your Merch Planning Agent. I can explain what is driving a variance, show you the buy position by class, rank SKU productivity, and model range or price scenarios against the Baby Mart plan. What would you like to know?",
  prompts: [
    "What are the drivers of PRAMS & STROLLERS being behind budget?",
    "Which classes are overbought, and by how much?",
    "Model rationalising the bottom 25% of TRAVEL SYSTEM in H2",
  ],
} as const;

const isMerch = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("persona") === "planning";

export default function AgentPage() {
  // Resolved once on mount. The profile decides which agent the chat talks to,
  // so it must not change mid-conversation -- a thread belongs to one agent.
  const [merch] = useState(isMerch);
  return merch ? <MerchChat /> : <CategoryAgent />;
}

// ─── Merch Planning Agent: a plain text-to-SQL chat ──────────────────────────

function MerchChat() {
  const { turns, busy, ask } = useLookupChat(MERCH.id);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest tokens in view while the answer streams in.
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  const send = () => {
    if (!input.trim() || busy) return;
    void ask(input);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <Header title={MERCH.title} subtitle={MERCH.subtitle} />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Bubble>{MERCH.greeting}</Bubble>
        {turns.map((t, i) => <LookupExchange key={i} turn={t} currency="PHP" />)}
        <div ref={endRef} />
      </div>
      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex gap-3">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about the plan, open-to-buy, scenarios..."
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
          <button onClick={send} disabled={busy || !input.trim()}
            className="px-4 py-2.5 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          {MERCH.prompts.map((q) => (
            <button key={q} onClick={() => setInput(q)}
              className="text-[11px] px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full hover:bg-slate-200 transition-colors">{q}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Category Agent: one entry, two agents ───────────────────────────────────
//
// A lookup goes to CATEGORY_MANAGER_AGENT (text to SQL over the category
// semantic view). "Why did <brand> move?" goes to BRAND_INVESTIGATOR_AGENT, which
// tests every candidate cause on POS and has its figures checked. Routing rules:
// src/lib/ai/category-route.ts. Each agent keeps its own Cortex thread, so a
// follow-up continues whichever one it is routed to. The user can force a route.
//
// ?q=<question> asks on arrival and ?mode=investigate|lookup forces its route:
// the brand and demand pages' Investigate links, and the old /investigate page.

const LOOKUP_SAMPLES = [
  "Top 5 brands by revenue growth this year",
  "Which brands are losing the most customers in Nappies & Wipes?",
  "Compare Huggies promotion effectiveness by mechanic",
];
const INVESTIGATE_SAMPLES = [
  "What drove the Huggies Crawler Nappies spike?",
  "Why is Bugaboo down on last year?",
  "What is behind Mountain Buggy's growth?",
];

type Entry = { route: CategoryRoute; index: number; brand: string | null };

const MODES: { id: CategoryMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "lookup", label: "Look up" },
  { id: "investigate", label: "Investigate" },
];

function CategoryAgent() {
  const lookup = useLookupChat("category");
  const inv = useAgentRun("brandInvestigator", { stage: "BRAND_INVESTIGATE" });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [mode, setMode] = useState<CategoryMode>("auto");
  const [input, setInput] = useState("");
  const busy = lookup.busy || inv.busy;
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  // Brand names for the router. If the list fails, a "why" question still goes
  // to the investigator, which answers with the valid brands.
  useEffect(() => {
    fetch("/api/brand/list")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { brands?: { brand: string }[] } | null) => {
        if (d?.brands) setBrands(Array.from(new Set(d.brands.map((b) => b.brand))));
      })
      .catch(() => {});
  }, []);

  const send = (question: string, force?: CategoryMode) => {
    const q = question.trim();
    if (!q || busy) return;
    const previous = entries.length ? entries[entries.length - 1].route : null;
    const { route, brand } = routeCategoryQuestion(q, { brands, mode: force ?? mode, previous });
    const index = route === "investigate" ? inv.turns.length : lookup.turns.length;
    setEntries((es) => [...es, { route, index, brand }]);
    setInput("");
    void (route === "investigate" ? inv.ask(q) : lookup.ask(q));
  };

  useEffect(() => {
    if (asked.current) return;
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q")?.slice(0, 500);
    const m = p.get("mode");
    if (q) {
      asked.current = true;
      send(q, m === "investigate" || m === "lookup" ? m : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries, lookup.turns, inv.turns]);

  const reset = () => { lookup.reset(); inv.reset(); setEntries([]); };
  const routeHint = useMemo(() => {
    if (!input.trim() || mode !== "auto") return null;
    const previous = entries.length ? entries[entries.length - 1].route : null;
    return routeCategoryQuestion(input, { brands, previous }).route;
  }, [input, mode, brands, entries]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Category Agent"
        subtitle="Look up any category figure, or investigate what drove a brand's move: every cause tested on POS, every figure checked" />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {entries.length === 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <SampleGroup icon={<Search className="w-4 h-4 text-blue-700" />} title="Look up"
              text="Sales, growth, margin, promotions, segments, CLV, brand switching, competitor prices and DIFOT, from the category semantic view. Growth compares the same weeks of each year."
              samples={LOOKUP_SAMPLES} onPick={(s) => send(s, "lookup")} disabled={busy} />
            <SampleGroup icon={<Lightbulb className="w-4 h-4 text-blue-700" />} title="Investigate a brand"
              text="What drove a brand's move: the 28 days to 7 May 2026 against last year and its market. Tests market, price vs volume, timing, states, stores, classes, SKUs, segments, promotions, competitor prices and supply. Recommends; changes nothing."
              samples={INVESTIGATE_SAMPLES} onPick={(s) => send(s, "investigate")} disabled={busy} />
          </div>
        )}

        {entries.map((e, i) => {
          if (e.route === "lookup") {
            const t = lookup.turns[e.index];
            if (!t) return null;
            // Resolved again here: a ?q= question is routed before the brand list loads.
            const brand = e.brand ?? namedBrand(t.question, brands);
            return (
              <div key={i} className="space-y-2">
                <LookupExchange turn={t} currency="AUD" badge={<RouteBadge route="lookup" />}
                  action={t.done && brand ? (
                    <button onClick={() => send(investigateQuestion(brand), "investigate")} disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50">
                      <Lightbulb className="w-3.5 h-3.5" /> Investigate what is driving {brand}
                    </button>
                  ) : null} />
              </div>
            );
          }
          const t = inv.turns[e.index];
          if (!t) return null;
          return (
            <div key={i} className="space-y-3">
              <UserBubble>{t.question}</UserBubble>
              <RouteBadge route="investigate" />
              <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
                <div className="h-fit xl:sticky xl:top-4"><ProgressTrail t={t} /></div>
                <AgentAnswer t={t} tag="rca" />
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="p-4 border-t border-slate-200 bg-white space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]" role="radiogroup" aria-label="Route">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${mode === m.id ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={busy ? "Working…" : entries.length ? "Ask a follow-up" : "Ask a question, or ask why a brand moved"}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}
            className="px-4 py-2.5 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" />
          </button>
          {entries.length > 0 && !busy && (
            <button onClick={reset} title="Start a new conversation"
              className="px-3 py-2.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 text-xs">
              <RotateCcw className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-400 h-4">
          {routeHint === "investigate" ? "Will investigate with the Brand Investigator"
            : routeHint === "lookup" ? "Will look up with the Category Intelligence agent" : ""}
        </p>
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="p-6 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm bg-blue-700 text-white">{children}</div>
    </div>
  );
}

function Bubble({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex justify-start">
      <div className={`${wide ? "w-full" : "max-w-[85%]"} rounded-xl px-4 py-3 text-sm bg-white border border-slate-200 text-slate-800 shadow-sm`}>{children}</div>
    </div>
  );
}

/** A question and its text-to-SQL answer. An answer that returned a result table
 *  gets the full column width: capped at 85% like a chat bubble, an 8-column
 *  buy-position table showed only 5 columns and hid the variance asked about. */
function LookupExchange({ turn, currency, badge, action }: {
  turn: LookupTurn; currency: string; badge?: React.ReactNode; action?: React.ReactNode;
}) {
  const answered = turn.content || turn.tables.length;
  return (
    <div className="space-y-2">
      <UserBubble>{turn.question}</UserBubble>
      {badge}
      {answered ? (
        <Bubble wide={turn.tables.length > 0}>
          <LookupAnswer turn={turn} currency={currency} />
          {action && <div className="mt-3 pt-3 border-t border-slate-100">{action}</div>}
        </Bubble>
      ) : null}
      {!turn.done && <Working status={turn.status} />}
    </div>
  );
}

function RouteBadge({ route }: { route: CategoryRoute }) {
  return route === "investigate" ? (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] text-amber-800">
      <Sparkles className="w-3 h-3" /> Brand Investigator · every cause tested, figures checked
    </div>
  ) : (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2.5 py-0.5 text-[11px] text-slate-600">
      <Search className="w-3 h-3" /> Look-up · Category Intelligence semantic view
    </div>
  );
}

function SampleGroup({ icon, title, text, samples, onPick, disabled }: {
  icon: React.ReactNode; title: string; text: string; samples: string[]; onPick: (s: string) => void; disabled: boolean;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center gap-2">{icon}<h3 className="text-sm font-semibold text-slate-800">{title}</h3></div>
      <p className="text-xs text-slate-500 mt-1 mb-3">{text}</p>
      <div className="space-y-2">
        {samples.map((s) => (
          <button key={s} onClick={() => onPick(s)} disabled={disabled}
            className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left text-xs text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
