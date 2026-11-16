"use client";

import { useState } from "react";
import { Modal, Field, Button, Banner, Pill, inputCls } from "./ui";
import type { Ownership, Row } from "./useHop";

// ─── The governed edit ────────────────────────────────────────────────────────
//
// One dialog for every plan edit. It asks only for what the server will demand,
// driven by the ownership registry: a reason for any editable number, a sentence
// when the reason needs one, an escalation note when an approved number is being
// amended, and who it is for when Planning keys a number Buying owns. The server
// enforces the same rules; this just saves a round trip to be told.

export type ValueKind = "rate" | "money" | "count";

export const CLASS_TONE: Record<string, "teal" | "violet" | "blue" | "slate" | "amber"> = {
  PLANNING: "teal",
  BUYING: "violet",
  JOINT: "blue",
  INGESTED: "slate",
  CALCULATED: "slate",
  UNCLASSIFIED: "amber",
};

export const CLASS_LABEL: Record<string, string> = {
  PLANNING: "Planning",
  BUYING: "Buying",
  JOINT: "Joint",
  INGESTED: "Ingested",
  CALCULATED: "Calculated",
  UNCLASSIFIED: "No owner",
};

export function OwnerPill({ own }: { own: Ownership | undefined }) {
  if (!own) return <Pill tone="amber">Unregistered</Pill>;
  return (
    <Pill tone={CLASS_TONE[own.editClass] ?? "slate"} title={own.ownershipHint}>
      {CLASS_LABEL[own.editClass] ?? own.editClass}
      {own.isInferred && !own.confirmedBy ? " · inferred" : ""}
    </Pill>
  );
}

function toInput(v: number | null, kind: ValueKind): string {
  if (v === null || !Number.isFinite(v)) return "";
  if (kind === "rate") return (v * 100).toFixed(2);
  if (kind === "money") return String(Math.round(v));
  return String(Math.round(v));
}

function fromInput(s: string, kind: ValueKind): number | null {
  const t = s.replace(/[,$%\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return kind === "rate" ? n / 100 : n;
}

export type EditPayload = {
  newValue: number;
  reasonCode: string | null;
  rationale: string | null;
  escalationNote: string | null;
  onBehalfOf: string | null;
};

export function EditDialog({
  title, subtitle, kind, current, own, reasons, locked, sandbox, onSave, onClose, extra, valueLabel,
}: {
  title: string;
  subtitle?: React.ReactNode;
  kind: ValueKind;
  current: number | null;
  own: Ownership | undefined;
  reasons: Row[];
  /** An approved baseline exists for the half. */
  locked: boolean;
  /** Sandbox edits are prompt-free: nothing in a sandbox reaches the live plan. */
  sandbox?: boolean;
  onSave: (p: EditPayload) => Promise<string | null>;
  onClose: () => void;
  extra?: React.ReactNode;
  valueLabel?: string;
}) {
  const [value, setValue] = useState(toInput(current, kind));
  const [reason, setReason] = useState("");
  const [rationale, setRationale] = useState("");
  const [escalation, setEscalation] = useState("");
  const [behalf, setBehalf] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsReason = !sandbox && (own?.requiresRationale ?? true);
  const chosen = reasons.find((r) => r.REASON_CODE === reason);
  const needsNarrative = needsReason && chosen?.REQUIRES_NARRATIVE === true;
  const needsEscalation = !sandbox && locked && own?.lockBehaviour === "AMEND_WITH_ESCALATION";
  const needsBehalf = !sandbox && own?.owningParty === "BUYING";
  const blocked = !sandbox && own !== undefined && !own.editableInApp;

  const parsed = fromInput(value, kind);
  const unit = kind === "rate" ? "%" : kind === "money" ? "$" : "";

  const submit = async () => {
    setErr(null);
    if (parsed === null) return setErr("Enter a number.");
    if (needsReason && !reason) return setErr("Choose a reason. Every change says why.");
    if (needsNarrative && !rationale.trim()) return setErr("This reason needs a sentence of explanation.");
    if (needsEscalation && !escalation.trim()) return setErr("Say why this cannot wait for the next approval cycle.");
    if (needsBehalf && !behalf.trim()) return setErr("Say who in Buying this number is for.");
    setBusy(true);
    const e = await onSave({
      newValue: parsed,
      reasonCode: reason || null,
      rationale: rationale.trim() || null,
      escalationNote: escalation.trim() || null,
      onBehalfOf: behalf.trim() || null,
    });
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  };

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          {sandbox ? <Pill tone="amber">Sandbox: no prompts, nothing reaches the live plan</Pill> : <OwnerPill own={own} />}
          {own && !sandbox && <span>{own.ownershipHint}</span>}
        </div>
        {blocked ? (
          <Banner tone="error">{own?.measureLabel} cannot be edited here. {own?.ownershipHint}</Banner>
        ) : (
          <>
            {extra}
            <Field label={`${valueLabel ?? "New value"}${unit ? ` (${unit})` : ""}`} hint={`Currently ${current === null ? "not set" : kind === "rate" ? `${(current * 100).toFixed(2)}%` : `${kind === "money" ? "$" : ""}${Math.round(current).toLocaleString("en-AU")}`}`}>
              <input autoFocus className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} inputMode="decimal" />
            </Field>
            {needsReason && (
              <Field label="Reason">
                <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose…</option>
                  {reasons.map((r) => (
                    <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>
                  ))}
                </select>
              </Field>
            )}
            {!sandbox && (
              <Field label={needsNarrative ? "Why (required for this reason)" : "Why (optional)"}>
                <textarea className={`${inputCls} h-16`} value={rationale} onChange={(e) => setRationale(e.target.value)}
                  placeholder="What changed, and what it is based on" />
              </Field>
            )}
            {needsBehalf && (
              <Field label="Entered on behalf of" hint="This is Buying's number. The trail records that it is theirs, not Planning's.">
                <input className={inputCls} value={behalf} onChange={(e) => setBehalf(e.target.value)} placeholder="e.g. Hardgoods buying team" />
              </Field>
            )}
            {needsEscalation && (
              <Field label="Escalation note" hint="The plan has been approved and this number was agreed in it. The change is recorded as a post-lock amendment.">
                <textarea className={`${inputCls} h-14`} value={escalation} onChange={(e) => setEscalation(e.target.value)}
                  placeholder="Why this cannot wait for the next cycle" />
              </Field>
            )}
          </>
        )}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!blocked && <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>}
        </div>
      </div>
    </Modal>
  );
}
