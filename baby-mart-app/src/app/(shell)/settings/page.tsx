"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Save, Plus, Trash2, History, Star, RotateCcw, FileText, ListOrdered,
  AlertTriangle, Check, Loader2, X,
} from "lucide-react";
import PlanningParametersTab from "./_components/PlanningParametersTab";

// ─── Settings: SOP and insight templates ──────────────────────────────────────
//
// Two fields do very different jobs, and the page has to make that obvious or
// users will put output structure in the SOP box and get nothing:
//   SOP      = HOW to assess. Thresholds, materiality, judgement, tone.
//   TEMPLATE = the OUTPUT SHAPE. Its "## " headings become the assessment's
//              sections, in order.

type TemplateListItem = {
  templateName: string;
  description: string | null;
  scope: string;
  isDefault: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  sopChars: number;
  templateChars: number;
  sectionCount: number;
};

type TemplateDetail = {
  templateName: string;
  description: string | null;
  sopText: string;
  templateText: string;
  scope: string;
  isDefault: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  error?: string;
};

type HistoryEntry = {
  version: number;
  description: string | null;
  sopText: string;
  templateText: string;
  scope: string;
  changedAt: string | null;
  changedBy: string | null;
  changeNote: string | null;
};

const SCOPES = [
  { value: "BOTH", label: "Both", hint: "Planning and category/vendor data" },
  { value: "PLANNING", label: "Planning", hint: "Merchandise plan and open-to-buy" },
  { value: "COMMERCIAL", label: "Commercial", hint: "Category, brand and vendor" },
];

const NEW_TEMPLATE_SEED = `## Headline
One paragraph: the most important thing the reader must know.

## What the data shows
Your analysis here.

## Where the risk sits
Name the department or class, and the metric that shows it.`;

type SettingsTab = "templates" | "parameters";

export default function SettingsPage() {
  // Read from window rather than useSearchParams: this page is statically
  // prerendered and useSearchParams would force it into a Suspense boundary.
  const [tab, setTab] = useState<SettingsTab>(() => {
    if (typeof window === "undefined") return "templates";
    return new URLSearchParams(window.location.search).get("tab") === "parameters"
      ? "parameters"
      : "templates";
  });

  const [list, setList] = useState<TemplateListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDetail | null>(null);
  const [original, setOriginal] = useState<TemplateDetail | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<HistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const loadList = useCallback(async (selectName?: string) => {
    const res = await fetch("/api/assessment/templates");
    const body = await res.json();
    if (body.error) {
      setError(body.error);
      return [];
    }
    setList(body.templates);
    if (selectName) setSelected(selectName);
    else if (!selected && body.templates.length > 0) {
      setSelected(body.templates[0].templateName);
    }
    return body.templates as TemplateListItem[];
  }, [selected]);

  useEffect(() => {
    loadList().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected template's full body and its history.
  useEffect(() => {
    if (!selected || isNew) return;
    let cancelled = false;
    setError(null);
    setViewingVersion(null);

    Promise.all([
      fetch(`/api/assessment/templates/${encodeURIComponent(selected)}`).then((r) => r.json()),
      fetch(`/api/assessment/templates/${encodeURIComponent(selected)}/history`).then((r) => r.json()),
    ]).then(([d, h]) => {
      if (cancelled) return;
      if (d.error) {
        setError(d.error);
        return;
      }
      setDraft(d);
      setOriginal(d);
      setChangeNote("");
      setHistory(h.error ? [] : h.history);
    });

    return () => {
      cancelled = true;
    };
  }, [selected, isNew]);

  const dirty =
    isNew ||
    (draft !== null &&
      original !== null &&
      (draft.sopText !== original.sopText ||
        draft.templateText !== original.templateText ||
        draft.scope !== original.scope ||
        draft.isDefault !== original.isDefault ||
        (draft.description ?? "") !== (original.description ?? "")));

  // Section headings the template will produce, parsed live so the user can see
  // the effect of an edit before running an assessment.
  const sections = (draft?.templateText ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("## "))
    .map((l) => l.trim().replace(/^##\s+/, ""));

  const startNew = () => {
    setIsNew(true);
    setSelected(null);
    setHistory([]);
    setViewingVersion(null);
    setChangeNote("");
    setError(null);
    setDraft({
      templateName: "",
      description: "",
      sopText: "",
      templateText: NEW_TEMPLATE_SEED,
      scope: "BOTH",
      isDefault: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });
    setOriginal(null);
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.templateName.trim();
    if (!name) {
      setError("Template name is required.");
      return;
    }
    if (!draft.templateText.trim()) {
      setError("Template text is required: it defines the assessment's sections.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/assessment/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: name,
          description: draft.description,
          sopText: draft.sopText,
          templateText: draft.templateText,
          scope: draft.scope,
          isDefault: draft.isDefault,
          changeNote: changeNote.trim() || null,
        }),
      });
      const body = await res.json();
      if (body.error) {
        setError(body.error);
        return;
      }
      setIsNew(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await loadList(name);
      setSelected(name);
      // Force a reload of body + history so the new version shows.
      const [d, h] = await Promise.all([
        fetch(`/api/assessment/templates/${encodeURIComponent(name)}`).then((r) => r.json()),
        fetch(`/api/assessment/templates/${encodeURIComponent(name)}/history`).then((r) => r.json()),
      ]);
      if (!d.error) {
        setDraft(d);
        setOriginal(d);
      }
      setHistory(h.error ? [] : h.history);
      setChangeNote("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    setError(null);
    const res = await fetch(`/api/assessment/templates/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (body.error) {
      setError(body.error);
      return;
    }
    setSelected(null);
    setDraft(null);
    const remaining = await loadList();
    if (remaining.length > 0) setSelected(remaining[0].templateName);
  };

  // Restore loads a prior version into the editor rather than writing directly.
  // Saving it then creates a NEW version, so history stays append-only and the
  // restore itself is recorded.
  const restore = (h: HistoryEntry) => {
    if (!draft) return;
    setDraft({
      ...draft,
      description: h.description,
      sopText: h.sopText,
      templateText: h.templateText,
      scope: h.scope,
    });
    setChangeNote(`Restored version ${h.version}`);
    setViewingVersion(null);
    setShowHistory(false);
  };

  const tabBar = (
    <div className="flex items-center gap-1 border-b border-slate-200 mb-5">
      {([
        { id: "templates" as const, label: "SOP & Templates" },
        { id: "parameters" as const, label: "Planning parameters" },
      ]).map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px cursor-pointer ${
            tab === t.id
              ? "border-violet-600 text-violet-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === "parameters") {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Planning thresholds, calculation parameters and per-class cover targets
          </p>
        </div>
        {tabBar}
        <PlanningParametersTab />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500 mb-3" />
        <p className="text-sm text-slate-500">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Assessment Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Standard operating procedures and insight templates used by the AI Assessment
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> New template
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {tabBar}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-xs text-red-800 font-mono break-words">{error}</div>
          <button onClick={() => setError(null)} className="ml-auto cursor-pointer">
            <X className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {/* Template list */}
        <div className="col-span-1">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Templates
            </div>
            <div className="space-y-1">
              {list.map((t) => (
                <button
                  key={t.templateName}
                  onClick={() => {
                    setIsNew(false);
                    setSelected(t.templateName);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-md cursor-pointer border ${
                    selected === t.templateName && !isNew
                      ? "bg-violet-50 border-violet-300"
                      : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium text-slate-800">{t.templateName}</span>
                    {t.isDefault && (
                      <Star className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" fill="currentColor" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-slate-600 bg-slate-100">
                      {t.scope}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      v{t.version} · {t.sectionCount} sections
                    </span>
                  </div>
                </button>
              ))}
              {isNew && (
                <div className="px-2.5 py-2 rounded-md bg-violet-50 border border-violet-300">
                  <span className="text-xs font-medium text-violet-800">New template</span>
                </div>
              )}
            </div>
          </div>

          {/* What the fields do. Non-obvious enough to be worth stating on-page. */}
          <div className="mt-3 bg-slate-50 rounded-xl border border-slate-200 p-3">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              How these are used
            </div>
            <div className="space-y-2 text-[11px] text-slate-600 leading-relaxed">
              <p>
                <span className="font-semibold text-slate-800">SOP</span> controls{" "}
                <em>how</em> the AI assesses: what counts as material, which thresholds
                matter, and the tone.
              </p>
              <p>
                <span className="font-semibold text-slate-800">Template</span> controls the{" "}
                <em>shape</em> of the output. Every <code className="font-mono">## </code>
                heading becomes a section of the assessment, in the order written.
              </p>
              <p className="text-slate-500">
                Figures always come from the dashboards, never from the model.
              </p>
            </div>
          </div>
        </div>

        {/* Editor */}
        <div className="col-span-3">
          {!draft ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Select a template, or create a new one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Metadata */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={draft.templateName}
                      disabled={!isNew}
                      onChange={(e) => setDraft({ ...draft, templateName: e.target.value })}
                      placeholder="e.g. Monthly trade review"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm disabled:bg-slate-50 disabled:text-slate-500"
                    />
                    {!isNew && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Name is fixed — create a new template to rename.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Data scope
                    </label>
                    <select
                      value={draft.scope}
                      onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm cursor-pointer"
                    >
                      {SCOPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label} — {s.hint}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={draft.description ?? ""}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      placeholder="When to use this template"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.isDefault}
                      onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
                      className="accent-violet-600 cursor-pointer"
                    />
                    <span className="text-xs text-slate-700">
                      Default template — used when an assessment is run without choosing one
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    {!isNew && (
                      <>
                        <span className="text-[10px] text-slate-400">
                          v{draft.version}
                          {draft.updatedBy ? ` · ${draft.updatedBy}` : ""}
                          {draft.updatedAt ? ` · ${draft.updatedAt.slice(0, 19)}` : ""}
                        </span>
                        <button
                          onClick={() => setShowHistory(!showHistory)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          <History className="w-3 h-3" /> History ({history.length})
                        </button>
                        <button
                          onClick={() => remove(draft.templateName)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Version history */}
              {showHistory && !isNew && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <div className="text-sm font-semibold text-slate-900 mb-2">Version history</div>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Append-only. Restoring loads that version into the editor; saving it creates a
                    new version rather than rewriting history.
                  </p>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {history.map((h) => (
                      <div
                        key={h.version}
                        className="flex items-center justify-between gap-3 border border-slate-100 rounded-md px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-800">v{h.version}</span>
                            {h.version === draft.version && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-violet-800 bg-violet-100">
                                current
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">
                              {h.changedBy} · {h.changedAt?.slice(0, 19)}
                            </span>
                          </div>
                          {h.changeNote && (
                            <div className="text-[11px] text-slate-600 truncate">{h.changeNote}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => setViewingVersion(h)}
                            className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            View
                          </button>
                          {h.version !== draft.version && (
                            <button
                              onClick={() => restore(h)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-200 text-violet-700 hover:bg-violet-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" /> Restore
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Read-only view of a historical version */}
              {viewingVersion && (
                <div className="bg-slate-50 rounded-xl border border-slate-300 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold text-slate-900">
                      Version {viewingVersion.version} (read-only)
                    </div>
                    <button onClick={() => setViewingVersion(null)} className="cursor-pointer">
                      <X className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">SOP</div>
                      <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans bg-white rounded p-2 border border-slate-200 max-h-48 overflow-y-auto">
                        {viewingVersion.sopText}
                      </pre>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Template</div>
                      <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans bg-white rounded p-2 border border-slate-200 max-h-48 overflow-y-auto">
                        {viewingVersion.templateText}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Editors */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-semibold text-slate-900">
                      Standard operating procedure
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    How to assess. Materiality thresholds, how to judge, tone.
                  </p>
                  <textarea
                    value={draft.sopText}
                    onChange={(e) => setDraft({ ...draft, sopText: e.target.value })}
                    rows={22}
                    placeholder="MATERIALITY&#10;- A sales variance to budget is material at +/- 5%..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-xs font-mono leading-relaxed resize-y"
                  />
                  <div className="text-[10px] text-slate-400 mt-1">
                    {draft.sopText.length.toLocaleString()} characters
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ListOrdered className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-semibold text-slate-900">Insight template</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    The output shape. Each <code className="font-mono">## </code>heading becomes a
                    section.
                  </p>
                  <textarea
                    value={draft.templateText}
                    onChange={(e) => setDraft({ ...draft, templateText: e.target.value })}
                    rows={22}
                    placeholder={NEW_TEMPLATE_SEED}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-xs font-mono leading-relaxed resize-y"
                  />
                  {/* Live preview of the resulting section list: the fastest way to
                      see that a heading was mistyped or nested at the wrong level. */}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Resulting sections ({sections.length})
                    </div>
                    {sections.length === 0 ? (
                      <p className="text-[11px] text-amber-700">
                        No <code className="font-mono">## </code>headings found — the assessment
                        will have no defined structure.
                      </p>
                    ) : (
                      <ol className="text-[11px] text-slate-600 list-decimal list-inside space-y-0.5">
                        {sections.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>

              {/* Change note */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Change note {isNew ? "" : "(recorded in version history)"}
                </label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="e.g. Tightened the margin threshold to 1.5pp"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
