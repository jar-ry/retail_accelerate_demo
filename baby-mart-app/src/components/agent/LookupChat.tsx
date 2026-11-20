"use client";

import { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamAgentChat } from "./agentStream";

// ─── A text-to-SQL agent's chat: streamed answer plus its result tables ──────
//
// The category and merch agents answer with markdown and the Analyst's result
// sets. Shared by /agent's merch chat and the Category Agent page, which mixes
// these turns with Brand Investigator runs.

export interface TableBlock {
  title: string;
  columns: string[];
  rows: unknown[][];
}

export interface LookupTurn {
  question: string;
  content: string;
  tables: TableBlock[];
  status: string;
  done: boolean;
}

// ─── Result-table presentation ────────────────────────────────────────────────
//
// A tool result arrives as raw SQL: physical column names and unrounded numbers.
// Printed verbatim that gave the planner "VARIANCE_TO_BUDGET_PCT" over
// "219938238.00" while every other screen in the app says "Variance to budget"
// over "PHP 219.9M" -- and the wide raw headers pushed the variance column, the
// one the question was actually about, off the right edge.
//
// Column names carry their own type here, so the formatter is driven by the name
// rather than by guessing from the value: a bare 40.6 could be a rate or an
// amount, and only "GP_PCT" says which.

/** SALES_BUDGET -> Sales budget.
 *  Also trims the words that make a SQL alias verbose without adding meaning, so
 *  a seven-column result fits the pane instead of pushing its last two columns
 *  off the right edge. */
export function humaniseColumn(c: string): string {
  const s = c
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\bpct\b/g, "%")
    .replace(/\b(php|aud)\b/g, "")
    .replace(/\bamt\b/g, "amount")
    .replace(/\bweeks\b/g, "wks")
    .replace(/\btotal wks\b/g, "wks")
    .replace(/\bvalue\b/g, "")
    .replace(/\btotal cover\b/g, "cover")
    .replace(/\bgp\b/g, "GP")
    .replace(/\botb\b/g, "OTB")
    .replace(/\blfl\b/g, "LFL")
    .replace(/\basp\b/g, "ASP")
    .replace(/\bfy(\d+)\b/g, "FY$1")
    .replace(/\s+/g, " ")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type ColKind = "money" | "pct" | "weeks" | "num" | "text";

export function columnKind(c: string): ColKind {
  const u = c.toUpperCase();
  if (/(_PCT|\bPCT\b|PERCENT|_PP\b)/.test(u)) return "pct";
  // An amount whose alias names its weeks ("REVENUE_FY25_SAME_WEEKS") is still an
  // amount; checked before WEEK, which would print it as "4437766.4w".
  if (/(REVENUE|_AUD\b|\bAUD_|PHP|CLV|SPEND)/.test(u) && !/(^|_)COUNT(_|$)|UNITS/.test(u)) return "money";
  if (/WEEK/.test(u)) return "weeks";
  if (/(SALES|BUDGET|VARIANCE|GP|PHP|AUD|REVENUE|OTB|OPEN_TO_BUY|STOCK|ON_ORDER|COMMITTED|AMT|VALUE|COST|MARGIN|CLV|SPEND|PRICE)/.test(u)
      && !/(^|_)COUNT(_|$)|UNITS|RANK|SWITCH/.test(u)) return "money";
  if (/((^|_)COUNT(_|$)|UNITS|RANK|OPTIONS|QTY|SWITCH)/.test(u)) return "num";
  return "text";
}

/** An amount at the magnitude a reader scans: millions above a million, else thousands. */
function fmtMoney(n: number, currency: string): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}${currency} ${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}${currency} ${(a / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${a.toFixed(a < 100 ? 2 : 0)}`;
}

export function fmtCell(cell: unknown, kind: ColKind, currency: string): string {
  if (cell === null || cell === undefined || cell === "") return "–";
  const n = typeof cell === "number" ? cell : Number(String(cell).replace(/,/g, ""));
  if (!isFinite(n) || String(cell).trim() === "") return String(cell);
  switch (kind) {
    case "money": return fmtMoney(n, currency);
    case "pct":   return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
    case "weeks": return `${n.toFixed(1)}w`;
    case "num":   return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    default:      return String(cell);
  }
}

/** One text-to-SQL agent conversation. A follow-up continues the Cortex thread. */
export function useLookupChat(agent: string) {
  const [turns, setTurns] = useState<LookupTurn[]>([]);
  const [busy, setBusy] = useState(false);
  // Conversation history lives in the Cortex thread, not in this component.
  // Refs (not state) so the values are current the moment a turn is sent.
  const thread = useRef<{ threadId: number | null; parent: number }>({ threadId: null, parent: 0 });

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    let current: LookupTurn = { question: q, content: "", tables: [], status: "", done: false };
    setTurns((ts) => [...ts, current]);
    const update = (fn: (t: LookupTurn) => LookupTurn) => {
      current = fn(current);
      const snap = current;
      setTurns((ts) => [...ts.slice(0, -1), snap]);
    };
    try {
      await streamAgentChat(
        { message: q, threadId: thread.current.threadId, parentMessageId: thread.current.parent, agent },
        (event) => {
          if (event.type === "text") update((t) => ({ ...t, status: "", content: t.content + event.text }));
          else if (event.type === "status") update((t) => ({ ...t, status: event.message }));
          else if (event.type === "thread") thread.current.threadId = event.threadId;
          // Anchor the next turn to this assistant message.
          else if (event.type === "parent") thread.current.parent = event.messageId;
          // Read back whole from the thread after the stream was lost.
          else if (event.type === "reset") update((t) => ({ ...t, content: "", tables: [] }));
          else if (event.type === "table")
            update((t) => ({ ...t, tables: [...t.tables, { title: event.title, columns: event.columns, rows: event.rows }] }));
          else if (event.type === "error") update((t) => ({ ...t, content: t.content + `\n\n_${event.message}_` }));
        },
      );
      // Guard against a stream that closed without producing any answer.
      update((t) => (t.content || t.tables.length ? t : { ...t, content: "I couldn't generate a response." }));
    } catch (e) {
      update((t) => ({
        ...t,
        content: (t.content ? t.content + "\n\n" : "") + `_${e instanceof Error ? e.message : "Sorry, I encountered an error. Please try again."}_`,
      }));
    } finally {
      update((t) => ({ ...t, status: "", done: true }));
      setBusy(false);
    }
  }, [agent, busy]);

  const reset = useCallback(() => {
    thread.current = { threadId: null, parent: 0 };
    setTurns([]);
  }, []);

  return { turns, busy, ask, reset };
}

/** The assistant side of a lookup turn: markdown, then the result tables. */
export function LookupAnswer({ turn, currency }: { turn: LookupTurn; currency: string }) {
  return (
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
            thead: ({ children }) => <thead className="bg-slate-50 border-b border-slate-200">{children}</thead>,
            th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{children}</th>,
            td: ({ children }) => <td className="px-3 py-1.5 border-t border-slate-100 whitespace-nowrap">{children}</td>,
          }}
        >
          {turn.content}
        </ReactMarkdown>
      </div>
      {turn.tables.map((t, ti) => (
        <div key={ti} className="my-3">
          {t.title && <p className="text-xs font-semibold text-slate-600 mb-1">{t.title}</p>}
          <div className="rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {t.columns.map((c) => (
                    <th key={c} className={`px-2 py-2 font-semibold text-slate-600 align-bottom ${columnKind(c) === "text" ? "text-left" : "text-right"}`}>
                      {humaniseColumn(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => {
                      const kind = columnKind(t.columns[ci] ?? "");
                      return (
                        <td key={ci} className={`px-2 py-1.5 border-t border-slate-100 whitespace-nowrap ${kind === "text" ? "text-left" : "text-right font-mono tabular-nums"}`}>
                          {fmtCell(cell, kind, currency)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/** Three bouncing dots and the agent's status line while a turn is running. */
export function Working({ status }: { status?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex items-center gap-2 w-fit">
      <div className="flex gap-1">
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      {status && <span className="text-xs text-slate-500">{status}</span>}
    </div>
  );
}
