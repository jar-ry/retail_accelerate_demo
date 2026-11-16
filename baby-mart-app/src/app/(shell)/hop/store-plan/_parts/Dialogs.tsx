"use client";

import { useState } from "react";
import { Modal, Field, Button, Banner, Pill, inputCls } from "../../_components/ui";
import { OwnerPill } from "../../_components/EditDialog";
import type { Ownership, Row } from "../../_components/useHop";
import { PLAN_MONTHS, STORE_STATES, STORE_REGIONS, STORE_FORMATS } from "@/lib/hop/config";

type Save = (body: Record<string, unknown>) => Promise<string | null>;

function ReasonFields({
  reasons, own, locked, state, set,
}: {
  reasons: Row[];
  own: Ownership | undefined;
  locked: boolean;
  state: { reason: string; rationale: string; escalation: string };
  set: (k: "reason" | "rationale" | "escalation", v: string) => void;
}) {
  const needsEscalation = locked && own?.lockBehaviour === "AMEND_WITH_ESCALATION";
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reason">
          <select className={inputCls} value={state.reason} onChange={(e) => set("reason", e.target.value)}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>)}
          </select>
        </Field>
        <div className="flex items-end pb-1"><OwnerPill own={own} /></div>
      </div>
      <Field label="Why">
        <textarea className={`${inputCls} h-14`} value={state.rationale} onChange={(e) => set("rationale", e.target.value)} />
      </Field>
      {needsEscalation && (
        <Field label="Escalation note" hint="The plan has been approved. This change is recorded as a post-lock amendment.">
          <textarea className={`${inputCls} h-12`} value={state.escalation} onChange={(e) => set("escalation", e.target.value)} />
        </Field>
      )}
    </>
  );
}

function useReasonState(initial?: { reason?: string; rationale?: string }) {
  const [s, setS] = useState({ reason: initial?.reason ?? "", rationale: initial?.rationale ?? "", escalation: "" });
  return [s, (k: "reason" | "rationale" | "escalation", v: string) => setS((p) => ({ ...p, [k]: v }))] as const;
}

/** What the opening assistant proposes, shaped for this form. */
export type StoreDraft = {
  storeName: string; state: string; region: string; format: string;
  openingDate: string | null; firstMonth: string | null;
  benchmarkStoreCode: string | null; benchmarkPct: number | null; benchmarkReason: string;
  sizing: string | null; haloWeeks: number | null;
};

/** Add a store mid-cycle: a recorded action with a stated benchmark and reason. */
export function AddStoreDialog({
  stores, reasons, own, locked, onSave, onClose, draft, inferred,
}: {
  stores: Row[]; reasons: Row[]; own: Ownership | undefined; locked: boolean; onSave: Save; onClose: () => void;
  /** Prefill from the assistant. Every field stays editable; nothing is saved until Add store. */
  draft?: StoreDraft | null; inferred?: string[];
}) {
  const [f, setF] = useState({
    storeName: draft?.storeName ?? "", state: draft?.state ?? "NSW", region: draft?.region ?? "Metro", format: draft?.format ?? "Standard",
    openingDate: draft?.openingDate ?? "", firstMonth: draft?.firstMonth ?? "OCT", benchmarkStoreCode: draft?.benchmarkStoreCode ?? "",
    benchmarkPct: draft?.benchmarkPct != null ? String(Math.round(draft.benchmarkPct * 1000) / 10) : "85",
    haloWeeks: draft?.haloWeeks != null ? String(draft.haloWeeks) : "", sellingAreaSqm: "",
    note: draft ? [draft.benchmarkReason ? `Benchmark reason: ${draft.benchmarkReason}` : "", draft.sizing ? `Sizing: ${draft.sizing}` : ""].filter(Boolean).join(". ") : "",
  });
  const [r, setR] = useReasonState(draft ? { reason: "COMPARABLE_BENCHMARK", rationale: draft.benchmarkReason } : undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    setErr(null);
    if (!f.storeName.trim()) return setErr("Name the store.");
    if (!f.benchmarkStoreCode) return setErr("Choose the store it is benchmarked off.");
    if (!r.reason) return setErr("Choose a reason.");
    setBusy(true);
    const e = await onSave({
      action: "ADD_STORE",
      storeName: f.storeName.startsWith("Baby Mart") ? f.storeName : `Baby Mart ${f.storeName}`,
      state: f.state, region: f.region, format: f.format,
      openingDate: f.openingDate || null, firstMonth: f.openingDate ? null : f.firstMonth,
      benchmarkStoreCode: f.benchmarkStoreCode, benchmarkPct: Number(f.benchmarkPct) / 100,
      haloWeeks: f.haloWeeks ? Number(f.haloWeeks) : null, sellingAreaSqm: f.sellingAreaSqm ? Number(f.sellingAreaSqm) : null,
      note: f.note || null, reasonCode: r.reason, rationale: r.rationale || null, escalationNote: r.escalation || null,
    });
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  return (
    <Modal wide title="Add a store" subtitle="A new store has no history, so it is planned off a comparable store at a declared share of that store's sales." onClose={onClose}>
      <div className="space-y-3">
        {draft && (
          <Banner tone="warn">
            Drafted by the assistant from your description. Check every field before adding: nothing is saved until you do.
            {inferred && inferred.length > 0 && <> Worked out rather than read: <b>{inferred.map((x) => x.replace(/_/g, " ")).join(", ")}</b>.</>}
          </Banner>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Store name"><input className={inputCls} value={f.storeName} onChange={(e) => set("storeName", e.target.value)} placeholder="e.g. Rouse Hill" /></Field>
          <Field label="State">
            <select className={inputCls} value={f.state} onChange={(e) => set("state", e.target.value)}>
              {STORE_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Region">
            <select className={inputCls} value={f.region} onChange={(e) => set("region", e.target.value)}>
              {STORE_REGIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select className={inputCls} value={f.format} onChange={(e) => set("format", e.target.value)}>
              {STORE_FORMATS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Opening date" hint="Leave blank if not confirmed; then choose the first trading month.">
            <input type="date" min="2026-06-29" max="2026-12-27" className={inputCls} value={f.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
          </Field>
          <Field label="First trading month" hint={f.openingDate ? "Taken from the opening date." : "The date is recorded as inferred."}>
            <select className={inputCls} value={f.firstMonth} disabled={!!f.openingDate} onChange={(e) => set("firstMonth", e.target.value)}>
              {PLAN_MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Benchmark store">
            <select className={inputCls} value={f.benchmarkStoreCode} onChange={(e) => set("benchmarkStoreCode", e.target.value)}>
              <option value="">Choose…</option>
              {stores.map((s) => (
                <option key={String(s.STORE_CODE)} value={String(s.STORE_CODE)}>
                  {String(s.STORE_CODE)} {String(s.STORE_NAME).replace("Baby Mart ", "")}{s.IS_NEW_STORE === true ? " (new)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Share of benchmark (%)"><input className={inputCls} value={f.benchmarkPct} onChange={(e) => set("benchmarkPct", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Halo weeks" hint="Blank uses the planning default."><input className={inputCls} value={f.haloWeeks} onChange={(e) => set("haloWeeks", e.target.value)} inputMode="numeric" /></Field>
        </div>
        <Field label="Note (sizing, catchment)"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        <ReasonFields reasons={reasons} own={own} locked={locked} state={r} set={setR} />
        {locked && <Banner tone="warn">The plan has been approved, so this store will read as <b>not in baseline</b> on Approve &amp; lock until the next approval.</Banner>}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add store"}</Button></div>
      </div>
    </Modal>
  );
}

/** Re-point a new store at a different comparable, or a different share of it. */
export function RebaseDialog({
  store, stores, reasons, own, locked, onSave, onClose,
}: {
  store: Row; stores: Row[]; reasons: Row[]; own: Ownership | undefined; locked: boolean; onSave: Save; onClose: () => void;
}) {
  const [bench, setBench] = useState(String(store.BENCHMARK_STORE_CODE ?? ""));
  const [share, setShare] = useState(String(Math.round(Number(store.BENCHMARK_PCT ?? 0) * 100)));
  const [r, setR] = useReasonState();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    if (!r.reason) return setErr("Choose a reason.");
    setBusy(true);
    const e = await onSave({ action: "REBASE", storeCode: store.STORE_CODE, benchmarkStoreCode: bench, benchmarkPct: Number(share) / 100, reasonCode: r.reason, rationale: r.rationale || null, escalationNote: r.escalation || null });
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  return (
    <Modal title={`Re-base ${String(store.STORE_NAME).replace("Baby Mart ", "")}`}
      subtitle={`Currently ${Math.round(Number(store.BENCHMARK_PCT) * 100)}% of ${store.BENCHMARK_STORE_CODE} ${String(store.BENCHMARK_STORE_NAME ?? "").replace("Baby Mart ", "")}. Every derived month is re-struck; a month typed over the benchmark is re-struck too.`}
      onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Benchmark store">
            <select className={inputCls} value={bench} onChange={(e) => setBench(e.target.value)}>
              {stores.filter((s) => s.STORE_CODE !== store.STORE_CODE).map((s) => (
                <option key={String(s.STORE_CODE)} value={String(s.STORE_CODE)}>{String(s.STORE_CODE)} {String(s.STORE_NAME).replace("Baby Mart ", "")}{s.IS_NEW_STORE === true ? " (new)" : ""}</option>
              ))}
            </select>
          </Field>
          <Field label="Share (%)"><input className={inputCls} value={share} onChange={(e) => setShare(e.target.value)} inputMode="decimal" /></Field>
        </div>
        <ReasonFields reasons={reasons} own={own} locked={locked} state={r} set={setR} />
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Re-basing…" : "Re-base"}</Button></div>
      </div>
    </Modal>
  );
}

export type BulkCell = { key: string; storeCode: string; storeName: string; monthName?: string; weekEndDate?: string; measure: "LFL_PCT" | "MARGIN_PCT"; current: number | null };

/** Change many driver cells at once with one reason. Each cell still goes through
 *  the same guard as a single edit; any the server refuses are listed. */
export function BulkTray({
  cells, reasons, ownLfl, ownMargin, locked, sandbox, onApply, onClear,
}: {
  cells: BulkCell[]; reasons: Row[]; ownLfl?: Ownership; ownMargin?: Ownership; locked: boolean; sandbox: boolean;
  onApply: (changes: Record<string, unknown>[], meta: Record<string, unknown>) => Promise<{ error: string | null; rejected?: { key: string; error?: string }[] }>;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"set" | "adjust">("adjust");
  const [value, setValue] = useState("");
  const [r, setR] = useReasonState();
  const [msg, setMsg] = useState<{ tone: "error" | "ok" | "warn"; text: string; detail?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasLfl = cells.some((c) => c.measure === "LFL_PCT");
  const own = hasLfl ? ownLfl : ownMargin;
  const apply = async () => {
    setMsg(null);
    const v = Number(value) / 100;
    if (!Number.isFinite(v) || value.trim() === "") return setMsg({ tone: "error", text: "Enter a percentage or a points adjustment." });
    if (!sandbox && !r.reason) return setMsg({ tone: "error", text: "Choose a reason." });
    const changes = cells.map((c) => ({
      storeCode: c.storeCode, monthName: c.monthName, weekEndDate: c.weekEndDate, measure: c.measure,
      currentValue: c.current, newValue: mode === "set" ? v : (c.current ?? 0) + v,
    }));
    setBusy(true);
    const res = await onApply(changes, { reasonCode: r.reason || null, rationale: r.rationale || null, escalationNote: r.escalation || null });
    setBusy(false);
    if (res.error) return setMsg({ tone: "error", text: res.error });
    const rej = res.rejected ?? [];
    if (rej.length) setMsg({ tone: "warn", text: `${cells.length - rej.length} saved, ${rej.length} refused:`, detail: rej.map((x) => `${x.key}: ${x.error}`) });
    else { setMsg({ tone: "ok", text: `${cells.length} cells saved.` }); onClear(); }
  };
  return (
    <div className="fixed bottom-4 left-72 right-6 z-40 rounded-xl border border-teal-200 bg-white p-3 shadow-xl">
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-xs">
          <div className="font-semibold text-slate-900">{cells.length} cell{cells.length === 1 ? "" : "s"} selected</div>
          <div className="text-[10px] text-slate-500">{[...new Set(cells.map((c) => c.measure === "LFL_PCT" ? "LFL %" : "Margin %"))].join(" and ")}</div>
        </div>
        <Field label="Change">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "set" | "adjust")}>
            <option value="adjust">Adjust by points</option>
            <option value="set">Set to %</option>
          </select>
        </Field>
        <Field label={mode === "set" ? "New %" : "Points (+/-)"}><input className={`${inputCls} w-24`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" /></Field>
        {!sandbox && (
          <>
            <Field label="Reason">
              <select className={inputCls} value={r.reason} onChange={(e) => setR("reason", e.target.value)}>
                <option value="">Choose…</option>
                {reasons.map((x) => <option key={String(x.REASON_CODE)} value={String(x.REASON_CODE)}>{String(x.REASON_NAME)}</option>)}
              </select>
            </Field>
            <Field label="Why"><input className={`${inputCls} w-64`} value={r.rationale} onChange={(e) => setR("rationale", e.target.value)} /></Field>
            {locked && own?.lockBehaviour === "AMEND_WITH_ESCALATION" && (
              <Field label="Escalation note"><input className={`${inputCls} w-56`} value={r.escalation} onChange={(e) => setR("escalation", e.target.value)} /></Field>
            )}
          </>
        )}
        {sandbox && <Pill tone="amber">Sandbox</Pill>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClear}>Clear</Button>
          <Button variant="primary" onClick={apply} disabled={busy || !cells.length}>{busy ? "Applying…" : "Apply"}</Button>
        </div>
      </div>
      {msg && (
        <div className="mt-2">
          <Banner tone={msg.tone}>
            {msg.text}
            {msg.detail && <ul className="mt-1 list-disc pl-4">{msg.detail.slice(0, 6).map((d) => <li key={d}>{d}</li>)}</ul>}
          </Banner>
        </div>
      )}
    </div>
  );
}
