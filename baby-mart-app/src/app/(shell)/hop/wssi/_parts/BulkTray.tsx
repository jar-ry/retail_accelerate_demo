"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button, Banner, Field, inputCls } from "../../_components/ui";
import type { Row } from "../../_components/useHop";
import { formatOf, type SpecRow, type Cell } from "@/lib/hop/wssi-model";

export type BulkPick = { key: string; spec: SpecRow; period: Row; cell: Cell; mode: "INPUT" | "PIN"; value: string; error?: string };

/** A rate is typed as a percentage, so a cell reads back the way the grid shows it. */
export function toTyped(spec: SpecRow, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  return formatOf(spec) === "rate" ? (v * 100).toFixed(2) : String(Math.round(v * 100) / 100);
}

function fromTyped(spec: SpecRow, s: string): number | null {
  const t = s.replace(/[,$%\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return formatOf(spec) === "rate" ? n / 100 : n;
}

/** Many WSSI cells, each with its own value, under one reason. Every cell is still
 *  saved through its own checks; the ones refused stay here with the reason. */
export function WssiBulkTray({
  picks, reasons, onChange, onRemove, onClear, onApply,
}: {
  picks: BulkPick[]; reasons: Row[];
  onChange: (key: string, value: string) => void; onRemove: (key: string) => void; onClear: () => void;
  onApply: (changes: Record<string, unknown>[], meta: { reasonCode: string; rationale: string | null }) => Promise<{ error: string | null; rejected?: { key: string; error?: string }[] }>;
}) {
  const [reason, setReason] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const chosen = reasons.find((r) => r.REASON_CODE === reason);
  const bad = picks.filter((p) => fromTyped(p.spec, p.value) === null);

  const apply = async () => {
    setMsg(null);
    if (!picks.length) return setMsg({ tone: "error", text: "Pick at least one cell." });
    if (bad.length) return setMsg({ tone: "error", text: `Enter a number for every cell (${bad.length} missing).` });
    if (!reason) return setMsg({ tone: "error", text: "Choose a reason. Every change says why." });
    if (chosen?.REQUIRES_NARRATIVE === true && !rationale.trim()) return setMsg({ tone: "error", text: "This reason needs a sentence of explanation." });
    setBusy(true);
    const changes = picks.map((p) => ({
      mode: p.mode, displayOrder: p.spec.DISPLAY_ORDER, periodKey: p.period.PERIOD_KEY,
      newValue: fromTyped(p.spec, p.value), currentValue: p.cell.value,
    }));
    const r = await onApply(changes, { reasonCode: reason, rationale: rationale.trim() || null });
    setBusy(false);
    if (r.error) return setMsg({ tone: "error", text: r.error });
    const rejected = r.rejected ?? [];
    setMsg(rejected.length
      ? { tone: "warn", text: `${picks.length - rejected.length} saved; ${rejected.length} refused and kept below with the reason.` }
      : { tone: "ok", text: `${picks.length} saved under one reason, each with its own audit row.` });
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-4xl rounded-xl border border-teal-300 bg-white p-4 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Bulk edit · {picks.length} {picks.length === 1 ? "cell" : "cells"}</div>
        <button onClick={onClear} className="text-[11px] text-slate-500 hover:text-slate-800">Clear</button>
      </div>
      {picks.length === 0 ? (
        <p className="text-xs text-slate-500">Click dashed cells in the grid to add them. Planning inputs apply to weeks still to trade; forecast cells are pinned.</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {picks.map((p) => (
            <div key={p.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-64 truncate text-slate-700" title={p.spec.ROW_LABEL}>{p.spec.ROW_LABEL} · {String(p.period.PERIOD_LABEL)}</span>
              <span className="w-10 text-slate-400">{p.mode === "INPUT" ? "input" : "pin"}</span>
              <input className={`${inputCls} w-28 font-mono`} value={p.value} onChange={(e) => onChange(p.key, e.target.value)} inputMode="decimal" />
              <span className="w-4 text-slate-400">{formatOf(p.spec) === "rate" ? "%" : ""}</span>
              {p.error && <span className="flex-1 truncate text-red-600" title={p.error}>{p.error}</span>}
              <button onClick={() => onRemove(p.key)} className="ml-auto text-slate-400 hover:text-slate-700" title="Remove"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Reason">
          <select className={`${inputCls} w-56`} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>)}
          </select>
        </Field>
        <Field label="Why"><input className={`${inputCls} w-72`} value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
        <Button variant="primary" onClick={apply} disabled={busy || !picks.length}>
          {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : `Save ${picks.length || ""}`}
        </Button>
      </div>
      {msg && <div className="mt-2"><Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner></div>}
    </div>
  );
}
