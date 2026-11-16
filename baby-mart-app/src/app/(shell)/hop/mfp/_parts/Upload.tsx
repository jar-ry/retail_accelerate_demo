"use client";

import { useState } from "react";
import { Upload, ClipboardCopy } from "lucide-react";
import { Card, Button, Banner, Field, Pill, Modal, Th, Td, inputCls } from "../../_components/ui";
import type { Ownership, Row } from "../../_components/useHop";
import { toTemplate, type Dept } from "@/lib/hop/mfp-model";
import { audM, pct, toNum, isoDateTime } from "@/lib/hop/format";

type Act = (body: Record<string, unknown>) => Promise<{ error: string | null; data?: Row }>;
type Check = { check: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

const TONE = { PASS: "green", WARN: "amber", FAIL: "red" } as const;

/** Paste a plan from a spreadsheet. It is checked before anything loads: hard
 *  failures stop it, judgement calls are listed and need a reason, and the load
 *  is recorded with the paste itself, so how a plan entered the model is never
 *  a mystery. */
export function UploadPanel({ depts, uploads, reasons, ownBuying, locked, act }: {
  depts: Dept[]; uploads: Row[]; reasons: Row[]; ownBuying?: Ownership; locked: boolean; act: Act;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [preview, setPreview] = useState<Row[]>([]);
  const [f, setF] = useState({ reason: "RANGE_REVIEW_AGREED", rationale: "", escalation: "", behalf: "", source: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hard = checks?.some((c) => c.status === "FAIL") ?? true;

  const check = async () => {
    setMsg(null);
    setBusy(true);
    const r = await act({ action: "UPLOAD_CHECK", text });
    setBusy(false);
    if (r.error) return setMsg({ tone: "error", text: r.error });
    setChecks((r.data?.checks as Check[]) ?? []);
    setPreview((r.data?.preview as Row[]) ?? []);
  };
  const commit = async () => {
    setBusy(true);
    const r = await act({ action: "UPLOAD_COMMIT", text, sourceFile: f.source, reasonCode: f.reason, rationale: f.rationale, escalationNote: f.escalation, onBehalfOf: f.behalf });
    setBusy(false);
    if (r.error) return setMsg({ tone: "error", text: r.error });
    setMsg({ tone: "ok", text: r.data?.uploadId ? `Loaded as upload ${r.data.uploadId}: ${r.data.measuresWritten} measures re-versioned.` : String(r.data?.note ?? "Nothing changed.") });
    setChecks(null);
    setText("");
  };

  return (
    <Card title="Load a product plan" subtitle="Paste department rows from a spreadsheet. Checked before anything loads."
      right={<Button onClick={() => setOpen(!open)}><Upload className="h-3.5 w-3.5" />{open ? "Close" : "Paste a plan"}</Button>}>
      {open ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <Button onClick={() => { navigator.clipboard?.writeText(toTemplate(depts)); setText(toTemplate(depts)); }}>
              <ClipboardCopy className="h-3.5 w-3.5" />Start from the current plan
            </Button>
            Columns: department, LFL %, growth stated, plan units, plan ASP, POS margin %, first margin %, then the four option counts. Last year is never uploaded: it is the record.
          </div>
          <textarea className={`${inputCls} h-40 font-mono`} value={text} onChange={(e) => { setText(e.target.value); setChecks(null); }} placeholder="Paste tab-separated rows here" />
          <div className="flex gap-2"><Button onClick={check} disabled={busy || !text.trim()}>{busy && !checks ? "Checking…" : "Check"}</Button></div>
          {checks && (
            <div className="space-y-1">
              {checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]"><Pill tone={TONE[c.status]}>{c.status.toLowerCase()}</Pill><span className="font-medium text-slate-700">{c.check}</span><span className="text-slate-600">{c.detail}</span></div>
              ))}
            </div>
          )}
          {checks && preview.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200"><Th>Department</Th><Th align="right">Bottom-up now</Th><Th align="right">After</Th><Th align="right">Stated</Th><Th align="right">Delivered</Th></tr></thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={String(p.code)} className="border-b border-slate-50">
                    <Td>{String(p.code)} {String(p.name)}</Td>
                    <Td align="right" mono>{audM(toNum(p.bottomUpBefore), 2)}</Td>
                    <Td align="right" mono className="font-semibold">{audM(toNum(p.bottomUpAfter), 2)}</Td>
                    <Td align="right" mono>{pct(toNum(p.statedAfter), 1, true)}</Td>
                    <Td align="right" mono>{pct(toNum(p.deliveredAfter), 1, true)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {checks && !hard && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Source"><input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. Range review pack, 12 June" /></Field>
              <Field label="Reason">
                <select className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                  {reasons.map((r) => <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>)}
                </select>
              </Field>
              <Field label="Why"><input className={inputCls} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
              {ownBuying?.owningParty === "BUYING" && (
                <Field label="Entered on behalf of" hint="Units and ASP are Buying's numbers."><input className={inputCls} value={f.behalf} onChange={(e) => setF({ ...f, behalf: e.target.value })} /></Field>
              )}
              {locked && (
                <Field label="Escalation note" hint="The plan is approved: this load is a post-lock amendment."><input className={inputCls} value={f.escalation} onChange={(e) => setF({ ...f, escalation: e.target.value })} /></Field>
              )}
              <div className="col-span-2 flex justify-end"><Button variant="primary" onClick={commit} disabled={busy}>{busy ? "Loading…" : "Load this plan"}</Button></div>
            </div>
          )}
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        </div>
      ) : (
        <div className="text-xs text-slate-500">
          {uploads.length === 0
            ? "The current plan was generated from range review data; no upload has been made yet."
            : <>Latest: upload {String(uploads[0].UPLOAD_ID)} from {String(uploads[0].SOURCE_FILE)} by {String(uploads[0].UPLOADED_BY)} on {isoDateTime(uploads[0].UPLOADED_AT)}{uploads[0].HAS_SOFT_FAILURE === true ? " · loaded with warnings" : ""}.</>}
          {msg && <div className="mt-2"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
        </div>
      )}
    </Card>
  );
}

/** Set the agreed RBU mix; it must add to 100%, and saving re-strikes each RBU's
 *  budget from the current store plan total. */
export function MixDialog({ mix, reasons, own, locked, act, onClose }: {
  mix: Row[]; reasons: Row[]; own?: Ownership; locked: boolean; act: Act; onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(mix.map((m) => [String(m.RBU_CODE), ((toNum(m.PLAN_MIX_PCT_STATED) ?? 0) * 100).toFixed(2)])));
  const [f, setF] = useState({ reason: "", rationale: "", escalation: "" });
  const [err, setErr] = useState<string | null>(null);
  const total = Object.values(vals).reduce((a, v) => a + (Number(v) || 0), 0);
  const save = async () => {
    setErr(null);
    if (!f.reason) return setErr("Choose a reason.");
    const r = await act({ action: "MIX", mixes: Object.entries(vals).map(([rbu, v]) => ({ rbu, pct: Number(v) / 100 })), reasonCode: f.reason, rationale: f.rationale, escalationNote: f.escalation });
    if (r.error) setErr(r.error); else onClose();
  };
  return (
    <Modal title="RBU mix" subtitle="The agreed share of the store plan each RBU must deliver. Saving re-strikes every RBU's budget from today's store plan total." onClose={onClose}>
      <div className="space-y-3">
        {mix.map((m) => (
          <Field key={String(m.RBU_CODE)} label={`${m.RBU_CODE} ${m.RBU_DESCRIPTION} (%)`} hint={`Last year measured ${pct(toNum(m.LY_MIX_PCT_MEASURED), 2)}; stated ${pct(toNum(m.LY_MIX_PCT_STATED), 2)}`}>
            <input className={inputCls} value={vals[String(m.RBU_CODE)]} onChange={(e) => setVals({ ...vals, [String(m.RBU_CODE)]: e.target.value })} inputMode="decimal" />
          </Field>
        ))}
        <div className={`text-xs ${Math.abs(total - 100) < 0.05 ? "text-emerald-700" : "text-red-600"}`}>Adds to {total.toFixed(2)}%</div>
        <Field label="Reason">
          <select className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>)}
          </select>
        </Field>
        <Field label="Why"><input className={inputCls} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
        {locked && own?.lockBehaviour === "AMEND_WITH_ESCALATION" && (
          <Field label="Escalation note"><input className={inputCls} value={f.escalation} onChange={(e) => setF({ ...f, escalation: e.target.value })} /></Field>
        )}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save mix</Button></div>
      </div>
    </Modal>
  );
}
