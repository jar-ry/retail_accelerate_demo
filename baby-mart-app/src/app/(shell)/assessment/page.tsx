"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles, Loader2, AlertTriangle, ChevronDown, ChevronUp, Clock, History,
  FileText, Database, X,
} from "lucide-react";

// ─── AI Assessment ────────────────────────────────────────────────────────────
//
// Runs one grounded CORTEX.COMPLETE over aggregated Merchandise Planning and
// Category Manager data, shaped by a stored SOP and insight template.
//
// A full BOTH-scope run measured at ~52 seconds. That drives two things here:
// an AbortController with a generous timeout, and a visible elapsed counter so
// the wait is legible rather than looking hung.

const TIMEOUT_MS = 280_000;

type TemplateListItem = {
  templateName: string;
  description: string | null;
  scope: string;
  isDefault: boolean;
  version: number;
  sectionCount: number;
};

type RunListItem = {
  assessmentId: string;
  createdAt: string | null;
  createdBy: string | null;
  templateName: string | null;
  templateVersion: number;
  scope: string;
  elapsedMs: number;
  excerpt: string;
};

type Assessment = {
  assessmentId?: string;
  templateName: string;
  templateVersion: number;
  scope: string;
  model: string | null;
  elapsedMs: number;
  markdown: string;
  metrics: Record<string, unknown> | null;
  sopSnapshot?: string | null;
  templateSnapshot?: string | null;
  createdAt?: string | null;
};

/** The review the merchandise-planning persona opens on. Planning-scoped, and its
 *  heading list carries no category or vendor section. */
const PLANNING_TEMPLATE = "Monthly merchandise review";

const SCOPE_LABEL: Record<string, string> = {
  BOTH: "Planning + Commercial",
  PLANNING: "Planning only",
  COMMERCIAL: "Commercial only",
};

/** Elapsed run time, or a dash when the field is missing.
 *  Dividing an absent value and calling .toFixed on the result rendered the
 *  badge as the literal string "NaNs", which reads as a broken page rather than
 *  as a figure that simply was not recorded. */
function fmtElapsed(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Flattens the metric pack to scalar leaves for the provenance panel.
 *  Arrays are summarised by length rather than dumped: the point is to let a
 *  reader confirm a figure, not to re-print the whole payload. */
function flattenMetrics(m: Record<string, unknown> | null): [string, string][] {
  if (!m) return [];
  const out: [string, string][] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        out.push([key, `${v.length} rows`]);
      } else if (typeof v === "object") {
        walk(v as Record<string, unknown>, key);
      } else if (typeof v === "number") {
        out.push([key, v.toLocaleString()]);
      } else {
        out.push([key, String(v)]);
      }
    }
  };
  walk(m, "");
  return out;
}

export default function AssessmentPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [defaultTemplateName, setDefaultTemplateName] = useState("");
  const [scopeOverride, setScopeOverride] = useState(() => {
    // The planning persona reports the FORWARD plan at merch-hierarchy grain in
    // PHP; the category and vendor blocks read HISTORIC category/brand
    // sell-through in AUD. Running the default BOTH-scope template from the
    // planning side therefore produced a "Category and vendor performance"
    // section at the wrong grain, horizon and currency for the report it sits in.
    // Default to PLANNING there; the select still allows widening deliberately.
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("persona");
      if (p === "planning") return "PLANNING";
    }
    return "";
  });
  const [result, setResult] = useState<Assessment | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/assessment/runs");
    const body = await res.json();
    if (!body.error) setRuns(body.runs);
  }, []);

  useEffect(() => {
    fetch("/api/assessment/templates")
      .then((r) => r.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
          return;
        }
        // A COMMERCIAL-only template has nothing to say about the merchandise
        // plan, and offering it on the planning side invites a run whose every
        // number comes from outside the plan under review.
        const planningOnly =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("persona") === "planning";
        const usable: TemplateListItem[] = planningOnly
          ? body.templates.filter((t: TemplateListItem) => t.scope !== "COMMERCIAL")
          : body.templates;

        setTemplates(usable);

        // On the planning side prefer the planning-only review over the global
        // default. The account default is the BOTH-scope trade review, whose own
        // heading list demands a category and vendor section -- so selecting it
        // here would reintroduce that section even with the scope forced to
        // PLANNING, because the template shape, not the scope, decides the
        // headings. Named rather than matched on scope alone because "Pre-buy
        // sign-off" is also PLANNING-scoped but is a narrow buy-release check,
        // not a monthly review.
        const pick = planningOnly
          ? usable.find((t: TemplateListItem) => t.templateName === PLANNING_TEMPLATE) ??
            usable.find((t: TemplateListItem) => t.scope === "PLANNING") ??
            usable.find((t: TemplateListItem) => t.isDefault)
          : usable.find((t: TemplateListItem) => t.isDefault);

        const chosen = pick ? pick.templateName : usable[0]?.templateName ?? "";
        setTemplateName(chosen);
        // Remembered so the "(default)" label in the dropdown names the template
        // that was actually selected on arrival, not the account-wide flag.
        setDefaultTemplateName(chosen);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load templates"));
    loadRuns();
  }, [loadRuns]);

  // Elapsed counter, so a 50-second wait reads as progress rather than a hang.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("/api/assessment/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName || null,
          scope: scopeOverride || null,
          save: true,
        }),
        signal: controller.signal,
      });

      const body = await res.json();
      // Checked explicitly: an error body parses as valid JSON, so without this
      // a failure renders as an empty card instead of a message.
      if (!res.ok || body.error) {
        setError(body.error ?? `Request failed with status ${res.status}`);
        return;
      }
      setResult(body);
      loadRuns();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setError(
          `The assessment did not finish within ${Math.round(TIMEOUT_MS / 1000)}s and was cancelled.`
        );
      } else {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setLoading(false);
    }
  };

  const openRun = async (id: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/assessment/runs/${encodeURIComponent(id)}`);
      const body = await res.json();
      if (body.error) {
        setError(body.error);
        return;
      }
      setResult(body);
      setShowHistory(false);
    } finally {
      setLoading(false);
    }
  };

  const selected = templates.find((t) => t.templateName === templateName);
  const metricRows = flattenMetrics(result?.metrics ?? null);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">AI Assessment</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            A written assessment across the merchandise plan and category performance, shaped by
            your SOP and insight template
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <History className="w-3.5 h-3.5" /> Past assessments ({runs.length})
        </button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Template
            </label>
            <select
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm cursor-pointer"
            >
              {templates.map((t) => (
                <option key={t.templateName} value={t.templateName}>
                  {t.templateName}
                  {/* The account-wide IS_DEFAULT flag is NOT the default here
                      whenever a persona overrides it, so labelling it "(default)"
                      contradicted the selection sitting right above it. Label
                      whatever is actually selected on arrival instead. */}
                  {t.templateName === defaultTemplateName ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Data scope
            </label>
            <select
              value={scopeOverride}
              onChange={(e) => setScopeOverride(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm cursor-pointer"
            >
              <option value="">
                Template default{selected ? ` (${selected.scope})` : ""}
              </option>
              <option value="BOTH">Planning + Commercial</option>
              <option value="PLANNING">Planning only</option>
              <option value="COMMERCIAL">Commercial only</option>
            </select>
          </div>
          <button
            onClick={generate}
            disabled={loading || !templateName}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? `Assessing... ${elapsed}s` : "Generate assessment"}
          </button>
          {selected?.description && (
            <p className="text-[11px] text-slate-500 flex-1 min-w-[200px]">{selected.description}</p>
          )}
        </div>
      </div>

      {/* Past assessments */}
      {showHistory && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-slate-900">Past assessments</div>
            <button onClick={() => setShowHistory(false)} className="cursor-pointer">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No saved assessments yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {runs.map((r) => (
                <button
                  key={r.assessmentId}
                  onClick={() => openRun(r.assessmentId)}
                  className="w-full text-left border border-slate-100 rounded-md px-3 py-2 hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-slate-800">{r.templateName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-slate-600 bg-slate-100">
                      v{r.templateVersion ?? "?"} · {r.scope}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {r.createdAt?.slice(0, 19)} · {fmtElapsed(r.elapsedMs)}
                      {r.createdBy ? ` · ${r.createdBy}` : ""}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-2">{r.excerpt}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-red-800">Assessment failed</div>
            <div className="text-xs text-red-700 mt-0.5 font-mono break-words">{error}</div>
          </div>
          <button onClick={() => setError(null)} className="ml-auto cursor-pointer">
            <X className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      )}

      {loading && !result && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-500 mb-3" />
          <p className="text-sm text-slate-700 font-medium">
            Assessing {scopeOverride || selected?.scope || "all"} data...
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {elapsed}s elapsed — a full assessment usually takes 30 to 60 seconds
          </p>
        </div>
      )}

      {!loading && !result && !error && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
          <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Choose a template and generate an assessment.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Sections come from the template; every figure comes from the dashboards.
          </p>
        </div>
      )}

      {result && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{result.templateName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-violet-800 bg-violet-100">
                    v{result.templateVersion ?? "?"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {SCOPE_LABEL[result.scope] ?? result.scope}
                  </span>
                  <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fmtElapsed(result.elapsedMs)}
                  </span>
                  {result.model && (
                    <span className="text-[11px] text-slate-400 font-mono">{result.model}</span>
                  )}
                  {result.createdAt && (
                    <span className="text-[11px] text-slate-400">{result.createdAt.slice(0, 19)}</span>
                  )}
                </div>
              </div>
            </div>
            {/* Template-driven markdown. Prose styling is applied here rather than
                relying on a typography plugin, which this app does not include. */}
            <div className="px-6 py-5 assessment-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-lg font-bold text-slate-900 mt-6 mb-2 first:mt-0">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold text-slate-900 mt-6 mb-2 first:mt-0 pb-1 border-b border-slate-100">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold text-slate-800 mt-4 mb-1.5">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm text-slate-700 leading-relaxed mb-3">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-outside ml-5 space-y-1 mb-3 text-sm text-slate-700">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-outside ml-5 space-y-1 mb-3 text-sm text-slate-700">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-slate-900">{children}</strong>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-4">
                      <table className="w-full text-sm border border-slate-200 rounded">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
                  th: ({ children }) => (
                    <th className="text-left text-xs font-semibold text-slate-600 px-3 py-2 border-b border-slate-200">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2 border-b border-slate-50 text-slate-700">{children}</td>
                  ),
                  code: ({ children }) => (
                    <code className="font-mono text-[12px] bg-slate-100 px-1 py-0.5 rounded text-slate-800">
                      {children}
                    </code>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-violet-300 pl-3 text-sm text-slate-600 italic mb-3">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {result.markdown}
              </ReactMarkdown>
            </div>
          </div>

          {/* Inputs that produced this assessment. For a saved run these are the
              snapshots taken at generation time, not the template's current text. */}
          {(result.sopSnapshot || result.templateSnapshot) && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
              <button
                onClick={() => setShowInputs(!showInputs)}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Inputs used</div>
                    <div className="text-[11px] text-slate-500">
                      The SOP and template as they were when this assessment ran
                    </div>
                  </div>
                </div>
                {showInputs ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {showInputs && (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">SOP</div>
                    <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 rounded p-3 border border-slate-200 max-h-72 overflow-y-auto">
                      {result.sopSnapshot}
                    </pre>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Template</div>
                    <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 rounded p-3 border border-slate-200 max-h-72 overflow-y-auto">
                      {result.templateSnapshot}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Provenance: the metric pack the model was given. Every figure in the
              assessment above should be findable here. */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className="w-full flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Source data</div>
                  <div className="text-[11px] text-slate-500">
                    The exact figures passed to the model — every number above should appear here
                  </div>
                </div>
              </div>
              {showMetrics ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
            {showMetrics && (
              <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-1 max-h-96 overflow-y-auto">
                {metricRows.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-2 border-b border-slate-50 py-0.5"
                  >
                    <span className="text-[11px] text-slate-500 font-mono truncate" title={k}>
                      {k}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-800 text-right shrink-0">
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
