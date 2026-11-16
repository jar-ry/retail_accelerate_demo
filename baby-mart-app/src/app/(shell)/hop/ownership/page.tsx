"use client";

import { useMemo, useState } from "react";
import { PageHeader, Card, Tile, Loading, ErrorState, Banner, Button, Pill, Modal, Field, Segmented, Th, Td, inputCls } from "../_components/ui";
import { CLASS_LABEL, CLASS_TONE } from "../_components/EditDialog";
import { useHop, useHopAction, type Row } from "../_components/useHop";
import { isoDateTime, num, toNum } from "@/lib/hop/format";

type Payload = { rows: Row[] };

const SURFACE_LABEL: Record<string, string> = {
  STORE_PLAN: "Store plan", MFP: "MFP", RBU_MIX: "RBU mix", FUNNEL: "Range review", WSSI: "WSSI", SETTINGS: "Settings",
};
const CLASS_BLURB: Record<string, string> = {
  PLANNING: "Planning's top-down numbers: editable, always say why. Stay open after approval.",
  BUYING: "Buying's bottom-up numbers. Planning can key them, on Buying's behalf, and the trail says so.",
  JOINT: "Agreed between the two at range review. After approval, changing one needs an escalation note.",
  INGESTED: "A record of what happened, fed from source. Nobody edits it.",
  CALCULATED: "Derived from other numbers. Change the inputs, not the result.",
  UNCLASSIFIED: "No owner agreed, so nobody edits it until one is.",
};
const EDITABLE_CLASSES = ["PLANNING", "BUYING", "JOINT", "UNCLASSIFIED"];

/** Ownership governs the pen, not the eyes: nothing is hidden from either party. */
export default function OwnershipPage() {
  const { data, error, isLoading } = useHop<Payload>("ownership");
  const action = useHopAction("ownership");
  const [surface, setSurface] = useState("ALL");
  const [show, setShow] = useState<"ALL" | "INFERRED" | "EDITABLE">("INFERRED");
  const [target, setTarget] = useState<Row | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const rows = useMemo(
    () => (data?.rows ?? [])
      .filter((r) => surface === "ALL" || r.SURFACE === surface)
      .filter((r) => show === "ALL" || (show === "INFERRED" ? r.IS_INFERRED === true : r.EDITABLE_IN_APP === true)),
    [data, surface, show],
  );
  if (isLoading) return <Loading what="the ownership registry" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No registry returned." />;

  const all = data.rows;
  const count = (cls: string) => all.filter((r) => r.EDIT_CLASS === cls).length;
  const inferred = all.filter((r) => r.IS_INFERRED === true).length;

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Ownership" subtitle="Who may change which number, and what happens to it once the plan is locked. Enforced on the server for every edit, not just shown here." />
      {flash && <Banner tone="ok" onClose={() => setFlash(null)}>{flash}</Banner>}

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {["PLANNING", "BUYING", "JOINT", "INGESTED", "CALCULATED", "UNCLASSIFIED"].map((c) => (
          <Tile key={c} label={CLASS_LABEL[c]} value={num(count(c))} sub={CLASS_BLURB[c]} />
        ))}
      </div>

      <Card title={`${all.length} measures across ${new Set(all.map((r) => r.SURFACE)).size} surfaces`}
        subtitle={`${inferred} owners were inferred during the build and are waiting for Planning and Buying to confirm them.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Segmented value={show} onChange={(v) => setShow(v as typeof show)} options={[{ value: "INFERRED", label: "To confirm" }, { value: "EDITABLE", label: "Editable" }, { value: "ALL", label: "All" }]} />
            <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={surface} onChange={(e) => setSurface(e.target.value)}>
              <option value="ALL">All surfaces</option>
              {Object.entries(SURFACE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        }>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200"><Th>Surface</Th><Th>Measure</Th><Th>Owner</Th><Th>After approval</Th><Th>Evidence</Th><Th align="right">Edits</Th><Th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.SURFACE}|${r.MEASURE_CODE}`} className="border-b border-slate-50 align-top">
                  <Td className="text-[10px] text-slate-500">{SURFACE_LABEL[String(r.SURFACE)] ?? String(r.SURFACE)}</Td>
                  <Td className="whitespace-normal font-medium text-slate-800">{String(r.MEASURE_LABEL)}</Td>
                  <Td>
                    <Pill tone={CLASS_TONE[String(r.EDIT_CLASS)] ?? "slate"}>{CLASS_LABEL[String(r.EDIT_CLASS)] ?? String(r.EDIT_CLASS)}</Pill>
                    {r.IS_INFERRED === true && <span className="ml-1"><Pill tone="amber">inferred</Pill></span>}
                  </Td>
                  <Td className="text-[10px] text-slate-500">{String(r.LOCK_BEHAVIOUR).replace(/_/g, " ").toLowerCase()}</Td>
                  <Td className="whitespace-normal text-[10px] text-slate-500">
                    {String(r.EVIDENCE ?? "")}
                    {r.CONFIRMED_BY ? <div className="text-emerald-700">Confirmed by {String(r.CONFIRMED_BY)} {isoDateTime(r.CONFIRMED_AT)}</div> : null}
                  </Td>
                  <Td align="right" mono>{num(toNum(r.EDITS))}</Td>
                  <Td align="right"><Button onClick={() => setTarget(r)}>{r.IS_INFERRED === true ? "Confirm" : "Review"}</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {target && (
        <ConfirmDialog row={target} onClose={() => setTarget(null)}
          onSave={async (editClass, rationale) => {
            const r = await action.run({ action: "CONFIRM", surface: target.SURFACE, measureCode: target.MEASURE_CODE, editClass, rationale });
            if (!r.ok) return r.error;
            setFlash(`${String(target.MEASURE_LABEL)}: ${editClass === target.EDIT_CLASS ? "owner confirmed" : `reclassified as ${CLASS_LABEL[editClass]}`}.`);
            return null;
          }} />
      )}
    </div>
  );
}

function ConfirmDialog({ row, onSave, onClose }: { row: Row; onSave: (cls: string, why: string) => Promise<string | null>; onClose: () => void }) {
  const cur = String(row.EDIT_CLASS);
  const canReclassify = EDITABLE_CLASSES.includes(cur);
  const [cls, setCls] = useState(cur);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={String(row.MEASURE_LABEL)} subtitle={`${SURFACE_LABEL[String(row.SURFACE)] ?? row.SURFACE} · currently ${CLASS_LABEL[cur]}${row.IS_INFERRED === true ? ", inferred" : ""}`} onClose={onClose}>
      <div className="space-y-3">
        <Banner tone="info">{CLASS_BLURB[cur]}</Banner>
        {canReclassify ? (
          <Field label="Owner">
            <select className={inputCls} value={cls} onChange={(e) => setCls(e.target.value)}>
              {EDITABLE_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
            </select>
          </Field>
        ) : (
          <p className="text-xs text-slate-600">{CLASS_LABEL[cur]} measures can be confirmed but not made editable: no route writes them, so an editable owner would be a promise the app cannot keep.</p>
        )}
        {cls !== cur && <Field label="Why the owner is changing"><input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave(cls, why); if (e) setErr(e); else onClose(); }}>{cls === cur ? "Confirm owner" : "Reclassify"}</Button>
        </div>
      </div>
    </Modal>
  );
}
