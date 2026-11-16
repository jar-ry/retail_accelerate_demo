"use client";

import { useState } from "react";
import { Lock, FilePlus2 } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Banner, Button, Pill, Modal, Field, Segmented, Th, Td, inputCls } from "../_components/ui";
import { useHop, useHopAction, type Row } from "../_components/useHop";
import { audM, aud, pct, toNum, isoDate, isoDateTime } from "@/lib/hop/format";
import { PERIOD_DUAL } from "@/lib/hop/config";

type Payload = {
  approvals: Row[]; amendments: Row[]; variance: Row[]; compliance: Row[]; decisions: Row[]; findings: Row[];
  assumptions: Row[]; live: Row | null;
};

const COMPLIANCE_TONE = (s: string) => (s === "COMPLIANT" ? "green" : "red");

function fmtValue(measure: string, v: unknown): string {
  const n = toNum(v);
  if (n === null) return "—";
  if (measure.includes("PCT") || measure.includes("%") || measure.includes("MIX")) return pct(n, 2);
  if (measure.includes("AUD")) return audM(n, 2);
  return Math.abs(n) < 2 ? pct(n, 2) : Math.round(n).toLocaleString("en-AU");
}

export default function ApprovePage() {
  const { data, error, isLoading } = useHop<Payload>("approve");
  const action = useHopAction("approve");
  const [dialog, setDialog] = useState<"approve" | "amend" | null>(null);
  const [filter, setFilter] = useState<"ALL" | "SINCE" | "ISSUES" | "POSTLOCK">("SINCE");
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [decide, setDecide] = useState<Row | null>(null);

  if (isLoading) return <Loading what="approvals" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No approval data returned." />;

  const current = data.approvals.find((a) => a.STATE === "APPROVED") ?? null;
  const liveSales = toNum(data.live?.SALES);
  const approvedSales = toNum(current?.TOTAL_SALES_AUD);
  const drift = liveSales !== null && approvedSales !== null ? liveSales - approvedSales : null;
  const since = data.compliance.filter((c) => current && String(c.CHANGED_AT) > String(current.APPROVED_AT));
  const issues = data.compliance.filter((c) => c.COMPLIANCE_STATUS !== "COMPLIANT");
  const rows =
    filter === "SINCE" ? since : filter === "ISSUES" ? issues : filter === "POSTLOCK" ? data.compliance.filter((c) => c.IS_POST_LOCK_AMENDMENT === true) : data.compliance;
  const awaiting = data.decisions.filter((d) => d.STATUS === "AWAITING_CUSTOMER");
  const amendments = data.amendments.filter((a) => current && a.APPROVAL_ID === current.APPROVAL_ID);

  const run = async (body: Record<string, unknown>, ok: string) => {
    const r = await action.run(body);
    if (!r.ok) return r.error;
    setFlash({ tone: "ok", text: ok });
    return null;
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Approve & lock" subtitle={<>{PERIOD_DUAL} · the store plan locks at the board so performance is measured against what was actually agreed.</>}
        right={<Button variant="primary" onClick={() => setDialog("approve")}><Lock className="h-3.5 w-3.5" />Approve the live plan</Button>} />
      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile emphasis label="Approved baseline" value={audM(approvedSales, 2)} sub={current ? `approval ${current.APPROVAL_ID} · board ${isoDate(current.BOARD_MEETING_DATE)}` : "none yet"} />
        <Tile label="Live plan" value={audM(liveSales, 2)} sub={drift !== null ? `${drift >= 0 ? "+" : ""}${aud(drift)} since approval` : undefined} subClass={drift && Math.abs(drift) > 1 ? "text-amber-700" : undefined} />
        <Tile label="Edits since approval" value={String(since.length)} sub={`${since.filter((s) => s.IS_POST_LOCK_AMENDMENT === true).length} amended agreed numbers`} />
        <Tile label="Failing the rules" value={String(issues.length)} subClass={issues.length ? "text-red-600" : undefined}
          sub={issues.length ? issues.map((i) => String(i.COMPLIANCE_STATUS).toLowerCase()).join(" · ") : "every edit has its reason and escalation"}
          hint="An edit made in the app cannot fail these rules: the server refuses it first. A failure here is an edit that went around the app." />
      </div>

      {current && (
        <Card title={`Current baseline: approval ${current.APPROVAL_ID}`} subtitle={`Approved by ${current.APPROVED_BY} on ${isoDateTime(current.APPROVED_AT)} · ${toNum(current.SNAPSHOT_ROWS)?.toLocaleString("en-AU")} values snapshotted`}
          right={<Button onClick={() => setDialog("amend")}><FilePlus2 className="h-3.5 w-3.5" />Add a correction</Button>}>
          <p className="text-sm leading-relaxed text-slate-800">{String(current.NARRATIVE)}</p>
          {amendments.length > 0 && (
            <div className="mt-3 space-y-1.5 border-l-2 border-amber-300 pl-3">
              {amendments.map((a) => (
                <div key={String(a.AMENDMENT_ID)} className="text-xs">
                  <div className="text-amber-900">{String(a.AMENDMENT_NOTE)}</div>
                  <div className="text-[10px] text-slate-500">Correction by {String(a.AMENDED_BY)} on {isoDateTime(a.AMENDED_AT)}. The narrative above is never edited.</div>
                </div>
              ))}
            </div>
          )}
          {data.approvals.length > 1 && <p className="mt-3 text-[11px] text-slate-500">{data.approvals.length - 1} earlier approval{data.approvals.length > 2 ? "s" : ""} superseded and kept.</p>}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Variance to the baseline" subtitle="Stores whose plan has moved since approval. A store added after the lock reads as not in baseline.">
          {data.variance.length === 0 ? <p className="text-xs text-slate-500">The live plan matches the baseline.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200"><Th>Store</Th><Th align="right">Sales</Th><Th align="right">Margin</Th><Th>Months</Th></tr></thead>
              <tbody>
                {data.variance.map((v) => (
                  <tr key={String(v.STORE_CODE)} className="border-b border-slate-50">
                    <Td>{String(v.STORE_NAME).replace("Baby Mart ", "")} {v.BASELINE_STATUS === "NOT IN BASELINE" && <Pill tone="amber">not in baseline</Pill>}</Td>
                    <Td align="right" mono>{(toNum(v.SALES_VARIANCE_AUD) ?? 0) >= 0 ? "+" : ""}{aud(toNum(v.SALES_VARIANCE_AUD))}</Td>
                    <Td align="right" mono>{(toNum(v.MARGIN_VARIANCE_AUD) ?? 0) >= 0 ? "+" : ""}{aud(toNum(v.MARGIN_VARIANCE_AUD))}</Td>
                    <Td className="text-[10px] text-slate-500">{String(v.MONTHS_MOVED ?? "all")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="xl:col-span-3" title="Change audit" subtitle="Every edit: who, when, why, and the ownership class it was made under."
          right={<Segmented value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
            { value: "SINCE", label: "Since approval" }, { value: "POSTLOCK", label: "Post-lock" }, { value: "ISSUES", label: "Failing" }, { value: "ALL", label: "All" },
          ]} />}>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200"><Th>What</Th><Th align="right">Change</Th><Th>Who</Th><Th>Rule</Th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={String(c.OVERRIDE_ID)} className="border-b border-slate-50 align-top">
                    <Td className="whitespace-normal">
                      <div className="font-medium text-slate-800">{String(c.ENTITY_CODE)} · {String(c.MONTH_NAME)} · {String(c.MEASURE_CODE).replace(/^WSSI:\d+:/, "").replace(/_/g, " ").toLowerCase()}</div>
                      <div className="text-[10px] text-slate-500">{String(c.REASON_CODE ?? "").replace(/_/g, " ").toLowerCase()}{c.RATIONALE ? `: ${c.RATIONALE}` : ""}</div>
                      {c.ESCALATION_NOTE ? <div className="text-[10px] text-amber-800">Escalation: {String(c.ESCALATION_NOTE)}</div> : null}
                    </Td>
                    <Td align="right" mono className="text-[10px]">{fmtValue(String(c.MEASURE_CODE), c.OLD_VALUE)} → {fmtValue(String(c.MEASURE_CODE), c.NEW_VALUE)}</Td>
                    <Td className="text-[10px] text-slate-500">{String(c.CHANGED_BY)}<br />{isoDateTime(c.CHANGED_AT)}{c.ON_BEHALF_OF ? <><br />for {String(c.ON_BEHALF_OF)}</> : null}</Td>
                    <Td>
                      <Pill tone={COMPLIANCE_TONE(String(c.COMPLIANCE_STATUS))}>{String(c.COMPLIANCE_STATUS).toLowerCase()}</Pill>
                      {c.IS_POST_LOCK_AMENDMENT === true && <div className="mt-0.5"><Pill tone="amber">post-lock</Pill></div>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Decisions" subtitle={`Recorded, not remembered. ${awaiting.length} left open on purpose: "waiting on the business" is itself a decision.`}>
          <div className="space-y-2">
            {data.decisions.map((d) => (
              <div key={String(d.DECISION_ID)} className={`rounded-md border p-2 text-xs ${d.STATUS === "AWAITING_CUSTOMER" ? "border-amber-200 bg-amber-50/40" : "border-slate-100"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-900">{String(d.TOPIC)}: {String(d.QUESTION)}</div>
                  {d.STATUS === "AWAITING_CUSTOMER" ? <Button onClick={() => setDecide(d)}>Record</Button> : <Pill tone="green">decided</Pill>}
                </div>
                {d.DECISION ? <div className="mt-0.5 text-slate-700">{String(d.DECISION)}</div> : null}
                <div className="mt-0.5 text-[10px] text-slate-500">{String(d.RATIONALE ?? "")}{d.DECIDED_BY ? ` · ${d.DECIDED_BY}` : ""}{d.OWNING_PARTY ? ` · owner ${String(d.OWNING_PARTY).toLowerCase()}` : ""}</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Data quality findings" subtitle="True of Baby Mart's data today. Flagged rather than silently corrected.">
            <div className="space-y-1.5">
              {data.findings.map((f) => (
                <div key={String(f.FINDING_ID)} className="flex items-start gap-2 text-xs">
                  <Pill tone={f.SEVERITY === "HIGH" ? "red" : f.SEVERITY === "MEDIUM" ? "amber" : "slate"}>{String(f.SEVERITY).toLowerCase()}</Pill>
                  <div>
                    <div className="text-slate-800">{String(f.FINDING)} <span className="text-slate-400">({String(f.OBJECT_NAME)})</span></div>
                    <div className="text-[10px] text-slate-500">{String(f.ACTION_TAKEN ?? "")}{f.NEEDS_CUSTOMER_DECISION === true ? " · needs a decision" : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Assumptions in this plan" subtitle="Judgement standing in for data. Each is labelled wherever it is used.">
            <table className="w-full text-xs">
              <tbody>
                {data.assumptions.map((a, i) => (
                  <tr key={i} className="border-b border-slate-50 align-top">
                    <Td className="text-[10px] text-slate-400">{String(a.KIND)}</Td>
                    <Td className="font-medium text-slate-800">{String(a.ITEM)}</Td>
                    <Td mono>{String(a.VALUE)}</Td>
                    <Td className="whitespace-normal text-[10px] text-slate-500">{String(a.BASIS ?? "")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      {dialog === "approve" && (
        <ApproveDialog live={liveSales} approved={approvedSales} onClose={() => setDialog(null)}
          onSave={(b) => run({ action: "APPROVE", ...b }, "Approved. The baseline, its snapshot and the WSSI budget now agree.")} />
      )}
      {dialog === "amend" && current && (
        <AmendDialog onClose={() => setDialog(null)}
          onSave={(b) => run({ action: "AMEND", approvalId: current.APPROVAL_ID, ...b }, "Correction added beside the original narrative.")} />
      )}
      {decide && (
        <DecideDialog decision={decide} onClose={() => setDecide(null)}
          onSave={(b) => run({ action: "DECIDE", decisionId: decide.DECISION_ID, ...b }, "Decision recorded.")} />
      )}
    </div>
  );
}

function ApproveDialog({ live, approved, onSave, onClose }: { live: number | null; approved: number | null; onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [narrative, setNarrative] = useState("");
  const [boardDate, setBoardDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Approve the live store plan" subtitle="Takes an immutable snapshot of every store-week, supersedes the current baseline (kept, not deleted) and re-strikes the WSSI budget to match." onClose={onClose}>
      <div className="space-y-3">
        <Banner tone="info">Live plan {audM(live, 2)}{approved !== null ? ` against the current baseline of ${audM(approved, 2)}` : ""}.</Banner>
        <Field label="Narrative" hint="What was agreed, and on what conditions. It is never edited afterwards; corrections are appended.">
          <textarea className={`${inputCls} h-28`} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
        </Field>
        <Field label="Board meeting date"><input type="date" className={inputCls} value={boardDate} onChange={(e) => setBoardDate(e.target.value)} /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); const e = await onSave({ narrative, boardDate }); setBusy(false); if (e) setErr(e); else onClose(); }}>
            {busy ? "Snapshotting…" : "Approve and lock"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AmendDialog({ onSave, onClose }: { onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [moves, setMoves] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add a correction" subtitle="Appended beside the original narrative, which is never edited: a record that can be rewritten is not a record." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Correction"><textarea className={`${inputCls} h-24`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={moves} onChange={(e) => setMoves(e.target.checked)} />This correction changes an approved figure
        </label>
        {moves && <Banner tone="warn">A correction that moves an approved number needs a fresh approval, not an amendment.</Banner>}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave({ note, changedFigures: moves }); if (e) setErr(e); else onClose(); }}>Add correction</Button>
        </div>
      </div>
    </Modal>
  );
}

function DecideDialog({ decision, onSave, onClose }: { decision: Row; onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={String(decision.TOPIC)} subtitle={String(decision.QUESTION)} onClose={onClose}>
      <div className="space-y-3">
        {decision.IMPACT ? <Banner tone="info">{String(decision.IMPACT)}</Banner> : null}
        <Field label="Decision"><textarea className={`${inputCls} h-20`} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Field label="Why"><input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave({ decision: text, rationale: why }); if (e) setErr(e); else onClose(); }}>Record decision</Button>
        </div>
      </div>
    </Modal>
  );
}
