"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Save, Loader2, AlertTriangle, Check, Lock, RotateCcw, Info,
} from "lucide-react";

// ─── Planning parameters ──────────────────────────────────────────────────────
//
// Every threshold and calculation constant the planning pages depend on, grouped
// the way a planner reasons about them rather than the way they are stored.
//
// The page's whole job is to be HONEST about what each parameter does:
//
//   * QUERY_TIME parameters take effect on the next page load and are editable.
//   * GENERATION parameters are baked into a fact by the SQL scripts and cannot
//     change without a data rebuild. They are shown, locked, and labelled as
//     such -- because presenting them as editable dials would be a lie the first
//     time someone moved one and nothing happened.
//   * Per-class cover targets are planner-authored data, not configuration, so
//     they get their own table and survive a data redeploy.
//
// The buy-position section carries a live preview of how many classes land in
// each status at the chosen bands. That preview reads the same view the planning
// pages read, so it cannot promise an outcome the pages then contradict.

type Parameter = {
  key: string;
  value: string;
  valueType: string | null;
  category: string | null;
  affects: string | null;
  editable: boolean;
  min: number | null;
  max: number | null;
  drives: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type ClassTarget = {
  department: string | null;
  class: string;
  classCode: string;
  targetCoverWeeks: number;
  totalCoverWeeks: number | null;
  stockCoverWeeks: number | null;
  buyStatus: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  note: string | null;
};

type ParametersResponse = {
  settings: Parameter[];
  classTargets: ClassTarget[];
  statusPreview: Record<string, number>;
};

const CATEGORY_META: { id: string; label: string; blurb: string }[] = [
  {
    id: "BUY_POSITION",
    label: "Buy position",
    blurb:
      "The bands that decide whether a class is over- or under-bought. These drive the status pill, the cover KPI colour, the exception list and what the AI says about a class — all from this one place.",
  },
  {
    id: "EXCEPTIONS",
    label: "Exception thresholds",
    blurb:
      "When a variance becomes worth flagging, and when it escalates from MEDIUM to HIGH severity.",
  },
  {
    id: "SCENARIO",
    label: "Scenario assumptions",
    blurb:
      "The behavioural assumptions behind every generated scenario. Elasticity in particular decides whether a goal-seek target is reachable at all, so it is the most consequential number on this page.",
  },
  {
    id: "CURRENCY",
    label: "Currency",
    blurb: "The rate applied to every figure when the currency toggle is set to AUD.",
  },
  {
    id: "GRID",
    label: "Weekly grid",
    blurb:
      "Where the actuals boundary sits and which half the grid opens on. The cut-off is what puts the dashes in the Act row.",
  },
];

const STATUS_STYLE: Record<string, string> = {
  OVERBUY: "text-amber-800 bg-amber-100",
  UNDERBUY: "text-red-700 bg-red-100",
  BALANCED: "text-emerald-800 bg-emerald-100",
};

export default function PlanningParametersTab() {
  const [data, setData] = useState<ParametersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/planning/parameters")
      .then((r) => r.json())
      .then((b) => {
        if (b?.error) setError(String(b.error));
        else {
          setData(b as ParametersResponse);
          setError(null);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byCategory = useMemo(() => {
    const m: Record<string, Parameter[]> = {};
    for (const p of data?.settings ?? []) {
      const c = p.category ?? "OTHER";
      m[c] ??= [];
      m[c].push(p);
    }
    return m;
  }, [data]);

  const saveParam = async (p: Parameter) => {
    const value = drafts[p.key];
    if (value === undefined) return;
    setSaving(p.key);
    try {
      const res = await fetch("/api/planning/parameters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: p.key, value, updatedBy: "Wensi Cai" }),
      });
      const b = await res.json();
      if (b?.ok) {
        setMessages((m) => ({ ...m, [p.key]: { ok: true, text: "Saved" } }));
        setDrafts((d) => {
          const n = { ...d };
          delete n[p.key];
          return n;
        });
        load();
      } else {
        setMessages((m) => ({
          ...m,
          [p.key]: { ok: false, text: String(b?.error ?? "Save failed") },
        }));
      }
    } finally {
      setSaving(null);
    }
  };

  const saveTarget = async (t: ClassTarget) => {
    const raw = targetDrafts[t.class];
    if (raw === undefined) return;
    const weeks = Number(raw);
    if (!isFinite(weeks)) return;
    setSaving(t.class);
    try {
      const res = await fetch("/api/planning/parameters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class: t.class,
          targetCoverWeeks: weeks,
          updatedBy: "Wensi Cai",
          note: "Edited in settings",
        }),
      });
      const b = await res.json();
      if (b?.ok) {
        setMessages((m) => ({ ...m, [t.class]: { ok: true, text: "Saved" } }));
        setTargetDrafts((d) => {
          const n = { ...d };
          delete n[t.class];
          return n;
        });
        load();
      } else {
        setMessages((m) => ({
          ...m,
          [t.class]: { ok: false, text: String(b?.error ?? "Save failed") },
        }));
      }
    } finally {
      setSaving(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin text-violet-500 mr-2" /> Loading parameters...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-red-800">Could not load parameters</div>
        <div className="text-xs text-red-700 mt-1 font-mono">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const preview = data.statusPreview;
  const generation = byCategory.GENERATION ?? [];

  return (
    <div className="space-y-5">
      <div className="bg-violet-50/60 border border-violet-100 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-700 leading-relaxed">
          These parameters are read at query time, so a change here moves the status pills, KPI
          colours, exception list and AI commentary together. Every figure they drive carries an
          info icon naming the parameter behind it, so the two can never drift apart.
        </p>
      </div>

      {CATEGORY_META.filter((c) => (byCategory[c.id] ?? []).length > 0).map((cat) => (
        <div key={cat.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 pt-4 pb-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">{cat.label}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-3xl">
              {cat.blurb}
            </p>
          </div>

          {/* Live consequence preview, for the one section where the change is
              hard to picture from the number alone. */}
          {cat.id === "BUY_POSITION" && (
            <div className="px-5 pt-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="text-slate-500">At these values:</span>
                {["OVERBUY", "BALANCED", "UNDERBUY"].map((s) => (
                  <span
                    key={s}
                    className={`px-2 py-0.5 rounded-full font-semibold ${
                      STATUS_STYLE[s] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {preview[s] ?? 0} {s}
                  </span>
                ))}
                <span className="text-slate-400">of {data.classTargets.length} classes</span>
              </div>
            </div>
          )}

          <div className="p-5 space-y-3">
            {(byCategory[cat.id] ?? []).map((p) => {
              const dirty = drafts[p.key] !== undefined && drafts[p.key] !== p.value;
              const msg = messages[p.key];
              return (
                <div key={p.key} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-violet-800">
                          {p.key}
                        </span>
                        {p.min !== null && p.max !== null && (
                          <span className="text-[10px] text-slate-400">
                            allowed {p.min} to {p.max}
                          </span>
                        )}
                      </div>
                      {p.drives && (
                        <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                          {p.drives}
                        </p>
                      )}
                      {p.updatedBy && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Last changed by {p.updatedBy}
                          {p.updatedAt
                            ? ` · ${new Date(p.updatedAt).toLocaleDateString(undefined, {
                                day: "2-digit", month: "short", year: "numeric",
                              })}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type={p.valueType === "DATE" ? "date" : "text"}
                        value={drafts[p.key] ?? p.value}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [p.key]: e.target.value }))
                        }
                        className="w-32 text-xs font-mono border border-slate-200 rounded px-2 py-1.5 text-right focus:border-violet-500 focus:outline-none"
                      />
                      <button
                        onClick={() => saveParam(p)}
                        disabled={!dirty || saving === p.key}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-30 cursor-pointer"
                      >
                        {saving === p.key ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Save className="w-3 h-3" />
                        )}
                        Save
                      </button>
                      {dirty && (
                        <button
                          onClick={() =>
                            setDrafts((d) => {
                              const n = { ...d };
                              delete n[p.key];
                              return n;
                            })
                          }
                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          title="Discard"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {msg && (
                    <div
                      className={`mt-2 text-[11px] flex items-start gap-1.5 ${
                        msg.ok ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {msg.ok ? (
                        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <span>{msg.text}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Per-class cover targets. Planner-authored, so they live in their own
          table and are preserved across a data redeploy. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Target cover by class</h3>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-3xl">
            Weeks of stock each class intends to hold. This is the denominator behind every buy
            status, so changing one immediately moves that class&apos;s pill, its open-to-buy and
            whether it appears in the exception list. Current cover is shown beside each target so
            the consequence is visible before you commit.
          </p>
        </div>
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-left font-semibold pb-2 px-2">Department</th>
                  <th className="text-left font-semibold pb-2 px-2">Class</th>
                  <th className="text-right font-semibold pb-2 px-2">Stock cover</th>
                  <th className="text-right font-semibold pb-2 px-2">Incl. on order</th>
                  <th className="text-right font-semibold pb-2 px-2">Target</th>
                  <th className="text-center font-semibold pb-2 px-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.classTargets.map((t) => {
                  const dirty =
                    targetDrafts[t.class] !== undefined &&
                    Number(targetDrafts[t.class]) !== t.targetCoverWeeks;
                  const msg = messages[t.class];
                  return (
                    <tr key={t.classCode} className="border-b border-slate-50">
                      <td className="py-1.5 px-2 text-slate-500">{t.department}</td>
                      <td className="py-1.5 px-2 font-medium text-slate-900">{t.class}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                        {t.stockCoverWeeks !== null ? `${t.stockCoverWeeks.toFixed(1)}w` : "–"}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-800 font-semibold">
                        {t.totalCoverWeeks !== null ? `${t.totalCoverWeeks.toFixed(1)}w` : "–"}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={targetDrafts[t.class] ?? String(t.targetCoverWeeks)}
                          onChange={(e) =>
                            setTargetDrafts((d) => ({ ...d, [t.class]: e.target.value }))
                          }
                          className={`w-16 text-xs font-mono border rounded px-1.5 py-1 text-right focus:outline-none focus:border-violet-500 ${
                            dirty ? "border-violet-400 bg-violet-50" : "border-slate-200"
                          }`}
                        />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                            STATUS_STYLE[t.buyStatus ?? ""] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {t.buyStatus ?? "–"}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        {dirty && (
                          <button
                            onClick={() => saveTarget(t)}
                            disabled={saving === t.class}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 cursor-pointer"
                          >
                            {saving === t.class ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            Save
                          </button>
                        )}
                        {msg && (
                          <span
                            className={`text-[10px] ml-1 ${
                              msg.ok ? "text-emerald-700" : "text-red-700"
                            }`}
                          >
                            {msg.text}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Generation parameters, read-only and clearly marked. */}
      {generation.length > 0 && (
        <div className="bg-slate-50 rounded-xl border border-slate-200">
          <div className="px-5 pt-4 pb-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" /> Generation parameters
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-3xl">
              These are baked into the plan facts when the data is built, so editing them here would
              change nothing. They are shown because the assumptions behind the generated plan
              should be visible, not hidden. Changing one means re-running{" "}
              <span className="font-mono">scripts/deploy_data.sh</span>.
            </p>
          </div>
          <div className="p-5 grid grid-cols-2 gap-3">
            {generation.map((p) => (
              <div key={p.key} className="border border-slate-200 rounded-lg p-2.5 bg-white">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] font-semibold text-slate-600">
                    {p.key}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-slate-900">{p.value}</span>
                </div>
                {p.drives && (
                  <p className="text-[10px] text-slate-500 mt-1 leading-snug">{p.drives}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
