"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Handshake, Info, Loader2, Save } from "lucide-react";
import { RULE_META, pctToRule, ruleToPct, type NegotiationRule, type RuleChange, type RuleMeta } from "@/lib/meeting";

// ─── Negotiation rules ────────────────────────────────────────────────────────
//
// The Head of Department's rules for sizing a supplier brief
// (ANALYTICS.NEGOTIATION_SETTING, sql/48): how much of each opening ask the
// target keeps at each stance, where to walk away, how much promo co-funding to
// open with, the DIFOT credit, and when a brand is one the category depends on.
// BUILD_NEGOTIATION_BRIEF reads them on every build and records the values it
// used on the brief, so a change here shows up in the next brief, and earlier
// briefs keep the rules they were built with.
//
// One rule per save, with a reason, as the signed-in user. The server
// (SAVE_NEGOTIATION_SETTING) enforces the ranges and the stance order; the
// ranges here only stop an obviously bad entry before the round trip.

const GROUPS: { id: RuleMeta["group"]; blurb: string }[] = [
  { id: "Stance", blurb: "The stance picker on the Supplier Meeting page. Each ask opens at the full sized value; the target keeps this share of it; below the walk-away share, walk away." },
  { id: "Ask sizing", blurb: "How the money asks are sized from the evidence." },
  { id: "Guardrails", blurb: "When the brief warns you before you push." },
];

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";

export default function NegotiationRulesTab() {
  const [rules, setRules] = useState<NegotiationRule[] | null>(null);
  const [history, setHistory] = useState<RuleChange[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/negotiation?rules=1")).json();
      if (d.error) setError(d.error);
      else { setRules(d.settings); setHistory(d.history); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (m: RuleMeta) => {
    const raw = drafts[m.key];
    const pctValue = Number(raw);
    const lo = ruleToPct(m, m.min), hi = ruleToPct(m, m.max);
    if (!Number.isFinite(pctValue) || pctValue < lo || pctValue > hi) {
      setMessages((x) => ({ ...x, [m.key]: { ok: false, text: `Enter ${lo} to ${hi}%.` } }));
      return;
    }
    if (!notes[m.key]?.trim()) {
      setMessages((x) => ({ ...x, [m.key]: { ok: false, text: "Add a reason: it goes in the history." } }));
      return;
    }
    setSaving(m.key);
    try {
      const r = await fetch("/api/negotiation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveRule", key: m.key, value: pctToRule(m, pctValue), note: notes[m.key] }) });
      const d = await r.json();
      setMessages((x) => ({ ...x, [m.key]: d.ok ? { ok: true, text: "Saved. The next brief uses it." } : { ok: false, text: d.error || "Save failed" } }));
      if (d.ok) {
        setDrafts((x) => { const n = { ...x }; delete n[m.key]; return n; });
        setNotes((x) => { const n = { ...x }; delete n[m.key]; return n; });
        await load();
      }
    } finally { setSaving(null); }
  };

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-red-800">Could not load the negotiation rules</div>
      <div className="text-xs text-red-700 mt-1 font-mono">{error}</div>
    </div>
  );
  if (!rules) return (
    <div className="flex items-center justify-center h-64 text-sm text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin text-violet-500 mr-2" /> Loading the negotiation rules...
    </div>
  );

  const label = (key: string) => RULE_META.find((m) => m.key === key)?.label ?? key;
  const fmt = (key: string, v: number | null) => {
    const m = RULE_META.find((x) => x.key === key);
    return v === null || !m ? "–" : `${ruleToPct(m, v)}%`;
  };

  return (
    <div className="space-y-5">
      <div className="bg-violet-50/60 border border-violet-100 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-700 leading-relaxed">
          Your Head of Department&apos;s rules for every supplier brief. The brief builder reads them on each build and records the
          values it used, so the next brief follows a change here and earlier briefs keep the rules they were built with. How the
          brief and the battlecard are <em>worded</em> follows the <span className="font-semibold">Supplier negotiation prep</span> SOP
          on the SOP &amp; Templates tab. See them at work on the{" "}
          <Link href="/meeting" className="inline-flex items-center gap-0.5 font-semibold text-violet-800 hover:underline"><Handshake className="h-3 w-3" />Supplier Meeting</Link> page.
        </p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 pt-4 pb-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">{g.id}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-3xl">{g.blurb}</p>
          </div>
          <div className="p-5 space-y-3">
            {RULE_META.filter((m) => m.group === g.id).map((m) => {
              const r = rules.find((x) => x.key === m.key);
              const shown = r?.value === null || r?.value === undefined ? "" : String(ruleToPct(m, r.value));
              const draft = drafts[m.key] ?? shown;
              const dirty = drafts[m.key] !== undefined && drafts[m.key] !== shown;
              const msg = messages[m.key];
              return (
                <div key={m.key} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900">{m.label} <span className="font-normal text-slate-500">{m.hint}</span></div>
                      {r?.description && <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{r.description}</p>}
                      <p className="text-[10px] text-slate-400 mt-1">
                        <span className="font-mono">{m.key}</span> · allowed {ruleToPct(m, m.min)} to {ruleToPct(m, m.max)}%
                        {r?.updatedBy ? ` · last changed by ${r.updatedBy}${r.updatedAt ? `, ${when(r.updatedAt)}` : ""}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative">
                        <input type="number" step="any" value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                          className="w-24 text-xs font-mono border border-slate-200 rounded px-2 py-1.5 pr-6 text-right focus:border-violet-500 focus:outline-none" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">%</span>
                      </div>
                      <button onClick={() => save(m)} disabled={!dirty || saving === m.key}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-30 cursor-pointer">
                        {saving === m.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}Save
                      </button>
                    </div>
                  </div>
                  {dirty && (
                    <input value={notes[m.key] ?? ""} onChange={(e) => setNotes((x) => ({ ...x, [m.key]: e.target.value }))}
                      placeholder="Why are you changing it? (kept in the history)"
                      className="mt-2 w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:border-violet-500 focus:outline-none" />
                  )}
                  {msg && (
                    <p className={`mt-1.5 text-[11px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
                      {msg.ok && <Check className="inline w-3 h-3 mr-0.5" />}{msg.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">History</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Every change, who made it and why. Newest first.</p>
        </div>
        <div className="p-5">
          {history.length === 0 ? <p className="text-xs text-slate-400">No changes since the rules were set up.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-slate-500">
                <th className="py-1.5 text-left">When</th><th className="py-1.5 text-left">Rule</th><th className="py-1.5 text-right">From</th>
                <th className="py-1.5 text-right">To</th><th className="py-1.5 text-left pl-4">By</th><th className="py-1.5 text-left">Why</th>
              </tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 text-slate-600">{when(h.changedAt)}</td>
                    <td className="py-1.5">{label(h.key)}</td>
                    <td className="py-1.5 text-right font-mono">{fmt(h.key, h.oldValue)}</td>
                    <td className="py-1.5 text-right font-mono">{fmt(h.key, h.newValue)}</td>
                    <td className="py-1.5 pl-4">{h.changedBy}</td>
                    <td className="py-1.5 text-slate-600">{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
