"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { PageHeader, Card, Loading, ErrorState, Banner, Button, Pill, Modal, Field, Th, Td, inputCls } from "../_components/ui";
import { EditDialog } from "../_components/EditDialog";
import { useHop, useHopAction, ownershipMap, type Row } from "../_components/useHop";
import { pct, num, toNum, isoDateTime } from "@/lib/hop/format";

type Payload = {
  settings: Row[]; ownership: Row[]; doctrine: Row[]; templates: Row[]; credibility: Row[];
  usage: Row[]; assumptions: Row[]; reasons: Row[]; latestRuns: Row[];
};

const MODELS = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5", "llama4-maverick", "mistral-large2"];

export default function SettingsPage() {
  const { data, error, isLoading } = useHop<Payload>("settings");
  const action = useHopAction("settings");
  const ownSettings = useMemo(() => ownershipMap(data?.ownership), [data]);
  const [editSetting, setEditSetting] = useState<Row | null>(null);
  const [editCred, setEditCred] = useState<Row | null>(null);
  const [editTemplate, setEditTemplate] = useState<Row | null>(null);
  const [doctrineOpen, setDoctrineOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  if (isLoading) return <Loading what="settings" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No settings returned." />;

  const active = data.doctrine.find((d) => d.IS_ACTIVE === true);
  const run = async (body: Record<string, unknown>, ok: string) => {
    const r = await action.run(body);
    if (!r.ok) return r.error;
    setFlash(ok);
    return null;
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Settings" subtitle="Planning thresholds, the method the AI insights follow, and what they cost. Judgement is labelled as judgement wherever it is used." />
      {flash && <Banner tone="ok" onClose={() => setFlash(null)}>{flash}</Banner>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Planning settings" subtitle="Thresholds and conventions. Planning's to set; each change is recorded with its reason.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Setting</Th><Th align="right">Value</Th><Th>Basis</Th><Th /></tr></thead>
            <tbody>
              {data.settings.map((s) => {
                const own = ownSettings.get(String(s.SETTING_KEY));
                return (
                  <tr key={String(s.SETTING_KEY)} className="border-b border-slate-50 align-top">
                    <Td className="whitespace-normal">
                      <div className="font-medium text-slate-800">{String(s.SETTING_KEY).replace(/_/g, " ").toLowerCase()}</div>
                      <div className="text-[10px] text-slate-500">{String(s.DESCRIPTION ?? "")}</div>
                    </Td>
                    <Td align="right" mono className="font-semibold">{String(s.SETTING_VALUE)}</Td>
                    <Td>{s.IS_ASSUMPTION === true ? <Pill tone="amber">judgement</Pill> : <Pill tone="green">data</Pill>}</Td>
                    <Td align="right">
                      {own?.editableInApp ? <Button onClick={() => setEditSetting(s)}><Pencil className="h-3 w-3" /></Button> : <span className="text-[10px] text-slate-400" title={own?.evidence ?? ""}>{own?.editClass === "UNCLASSIFIED" ? "no owner" : "fixed"}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Minimum credible offer" subtitle="How much of the presented range a department must commit. Below it, the offer is not credible to a customer.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Department</Th><Th align="right">Minimum</Th><Th>Why</Th><Th /></tr></thead>
            <tbody>
              {data.credibility.map((c) => (
                <tr key={String(c.DEPARTMENT_NUM)} className="border-b border-slate-50 align-top">
                  <Td>{String(c.DEPARTMENT_NUM)} {String(c.DEPARTMENT_NAME)}</Td>
                  <Td align="right" mono className="font-semibold">{pct(toNum(c.MIN_CREDIBLE_ADOPTION_PCT), 0)}</Td>
                  <Td className="whitespace-normal text-[10px] text-slate-500">{String(c.RATIONALE ?? "")}{c.IS_ASSUMPTION === true && <> <Pill tone="amber">assumption</Pill></>}</Td>
                  <Td align="right"><Button onClick={() => setEditCred(c)}><Pencil className="h-3 w-3" /></Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="How you plan" subtitle={`The method every AI insight is given. Versioned and insert-only, so an insight keeps the method it was actually given. Version ${active?.DOCTRINE_VERSION ?? "—"} is in force.`}
        right={<Button onClick={() => setDoctrineOpen(true)}><Pencil className="h-3.5 w-3.5" />New version</Button>}>
        <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800">{String(active?.DOCTRINE_TEXT ?? "")}</pre>
        <p className="mt-2 text-[11px] text-slate-500">Tone: {String(active?.TONE ?? "")} · by {String(active?.AUTHORED_BY ?? "")} {isoDateTime(active?.CREATED_AT)}</p>
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-slate-700">Version history</div>
          <p className="mb-1.5 text-[10px] text-slate-500">How many insights each version produced, so you can see whether a change to the method actually changed the advice.</p>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Version</Th><Th>Author</Th><Th>Why</Th><Th align="right">Insights</Th><Th>When</Th></tr></thead>
            <tbody>
              {data.doctrine.map((d) => (
                <tr key={String(d.DOCTRINE_VERSION)} className="border-b border-slate-50 align-top">
                  <Td>{String(d.DOCTRINE_VERSION)} {d.IS_ACTIVE === true && <Pill tone="teal">in force</Pill>}</Td>
                  <Td>{String(d.AUTHORED_BY ?? "")}</Td>
                  <Td className="whitespace-normal text-[11px] text-slate-600">{String(d.RATIONALE ?? "")}</Td>
                  <Td align="right" mono>{num(toNum(d.INSIGHTS))}</Td>
                  <Td className="text-[10px] text-slate-500">{isoDateTime(d.CREATED_AT)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="What each surface looks at" subtitle="Edited in place; every insight run records the template it used.">
          <div className="space-y-2">
            {data.templates.map((t) => (
              <div key={String(t.TEMPLATE_ID)} className="rounded-md border border-slate-100 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div><Pill tone="teal">{String(t.SURFACE).replace("_", " ").toLowerCase()}</Pill> <span className="font-medium text-slate-900">{String(t.NAME)}</span></div>
                  <Button onClick={() => setEditTemplate(t)}><Pencil className="h-3 w-3" /></Button>
                </div>
                <div className="mt-1 text-slate-700">{String(t.TASK_INSTRUCTION)}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">Focus: {String(t.FOCUS_MEASURES)} · {String(t.MODEL)} · up to {String(t.MAX_FINDINGS)} findings</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Model usage" subtitle="Every run is logged, including failures and unverified ones. Token counts are measured from each response, not estimated.">
          {data.usage.length === 0 ? <p className="text-xs text-slate-500">No insights generated yet.</p> : (
            <div className="space-y-4">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-200"><Th>Surface</Th><Th align="right">Runs</Th><Th align="right">Unverified</Th><Th align="right">Failed</Th><Th align="right">In</Th><Th align="right">Out</Th><Th align="right">Total</Th></tr></thead>
                <tbody>
                  {data.usage.map((u, i) => (
                    <tr key={i} className="border-b border-slate-50" title={String(u.MODEL)}>
                      <Td>{String(u.SURFACE).replace(/_/g, " ").toLowerCase()}</Td>
                      <Td align="right" mono>{num(toNum(u.RUNS))}</Td>
                      <Td align="right" mono>{num((toNum(u.RUNS) ?? 0) - (toNum(u.VERIFIED) ?? 0) - (toNum(u.FAILED) ?? 0))}</Td>
                      <Td align="right" mono>{num(toNum(u.FAILED))}</Td>
                      <Td align="right" mono>{num(toNum(u.PROMPT_TOKENS))}</Td>
                      <Td align="right" mono>{num(toNum(u.COMPLETION_TOKENS))}</Td>
                      <Td align="right" mono>{num(toNum(u.TOTAL_TOKENS))}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    <Td align="right" mono>{num(data.usage.reduce((a, u) => a + (toNum(u.RUNS) ?? 0), 0))}</Td>
                    <Td /><Td />
                    <Td align="right" mono>{num(data.usage.reduce((a, u) => a + (toNum(u.PROMPT_TOKENS) ?? 0), 0))}</Td>
                    <Td align="right" mono>{num(data.usage.reduce((a, u) => a + (toNum(u.COMPLETION_TOKENS) ?? 0), 0))}</Td>
                    <Td align="right" mono>{num(data.usage.reduce((a, u) => a + (toNum(u.TOTAL_TOKENS) ?? 0), 0))}</Td>
                  </tr>
                </tbody>
              </table>
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-700">Showing now, per surface</div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-slate-200"><Th>Surface</Th><Th>Method</Th><Th>Verified</Th><Th align="right">Tokens</Th><Th>When</Th></tr></thead>
                  <tbody>
                    {data.latestRuns.map((r) => (
                      <tr key={String(r.SURFACE)} className="border-b border-slate-50" title={`${String(r.MODEL)} · ${String(r.GENERATED_BY ?? "")}`}>
                        <Td>{String(r.SURFACE).replace(/_/g, " ").toLowerCase()}</Td>
                        <Td>{r.DOCTRINE_VERSION == null ? "—" : `v${String(r.DOCTRINE_VERSION)}`}</Td>
                        <Td>{r.IS_VERIFIED === true ? <Pill tone="green">yes</Pill> : <Pill tone="red">no</Pill>}</Td>
                        <Td align="right" mono>{num(toNum(r.TOTAL_TOKENS))}</Td>
                        <Td className="text-[10px] text-slate-500">{isoDateTime(r.GENERATED_AT)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      {editSetting && (
        <SettingDialog row={editSetting} reasons={data.reasons} onClose={() => setEditSetting(null)}
          onSave={(b) => run({ action: "SETTING", key: editSetting.SETTING_KEY, ...b }, `${String(editSetting.SETTING_KEY).replace(/_/g, " ").toLowerCase()} updated.`)} />
      )}
      {editCred && (
        <EditDialog title={`${String(editCred.DEPARTMENT_NAME)}: minimum credible offer`} kind="rate" current={toNum(editCred.MIN_CREDIBLE_ADOPTION_PCT)}
          own={{ surface: "FUNNEL", measureCode: "MIN_CREDIBLE_ADOPTION_PCT", measureLabel: "Minimum credible adoption", editClass: "PLANNING", owningParty: "PLANNING",
            editableInApp: true, lockBehaviour: "ALWAYS_OPEN", requiresRationale: true, ownershipHint: "Planning sets the floor a department must clear.",
            cellTreatment: "EDITABLE", isInferred: false, evidence: null, confirmedBy: null, confirmedAt: null }}
          reasons={data.reasons} locked={false}
          onSave={(p) => run({ action: "CREDIBILITY", departmentNum: editCred.DEPARTMENT_NUM, minPct: p.newValue, reasonCode: p.reasonCode, rationale: p.rationale }, "Threshold updated.")}
          onClose={() => setEditCred(null)} />
      )}
      {editTemplate && <TemplateDialog row={editTemplate} onClose={() => setEditTemplate(null)}
        onSave={(b) => run({ action: "TEMPLATE", templateId: editTemplate.TEMPLATE_ID, ...b }, "Template saved.")} />}
      {doctrineOpen && <DoctrineDialog current={active} onClose={() => setDoctrineOpen(false)}
        onSave={(b) => run({ action: "DOCTRINE", ...b }, "New doctrine version in force.")} />}
    </div>
  );
}

function SettingDialog({ row, reasons, onSave, onClose }: { row: Row; reasons: Row[]; onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [value, setValue] = useState(String(row.SETTING_VALUE));
  const [reason, setReason] = useState("");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={String(row.SETTING_KEY).replace(/_/g, " ").toLowerCase()} subtitle={String(row.DESCRIPTION ?? "")} onClose={onClose}>
      <div className="space-y-3">
        <Field label={`Value (${String(row.VALUE_TYPE).toLowerCase()})`}><input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={String(r.REASON_CODE)} value={String(r.REASON_CODE)}>{String(r.REASON_NAME)}</option>)}
          </select>
        </Field>
        <Field label="Why"><input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave({ value, reasonCode: reason, rationale: why }); if (e) setErr(e); else onClose(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateDialog({ row, onSave, onClose }: { row: Row; onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [f, setF] = useState({ taskInstruction: String(row.TASK_INSTRUCTION), focusMeasures: String(row.FOCUS_MEASURES), model: String(row.MODEL), maxFindings: String(row.MAX_FINDINGS) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal wide title={String(row.NAME)} subtitle={`${String(row.SURFACE)} insight template`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="What to look at"><textarea className={`${inputCls} h-20`} value={f.taskInstruction} onChange={(e) => setF({ ...f, taskInstruction: e.target.value })} /></Field>
        <Field label="Focus measures"><input className={inputCls} value={f.focusMeasures} onChange={(e) => setF({ ...f, focusMeasures: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model" hint="Sonnet answers inside the gateway timeout; Opus may not.">
            <select className={inputCls} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </Field>
          <Field label="Findings (1–8)"><input className={inputCls} value={f.maxFindings} onChange={(e) => setF({ ...f, maxFindings: e.target.value })} /></Field>
        </div>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave({ ...f, maxFindings: Number(f.maxFindings) }); if (e) setErr(e); else onClose(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function DoctrineDialog({ current, onSave, onClose }: { current: Row | undefined; onSave: (b: Record<string, unknown>) => Promise<string | null>; onClose: () => void }) {
  const [text, setText] = useState(String(current?.DOCTRINE_TEXT ?? ""));
  const [tone, setTone] = useState(String(current?.TONE ?? ""));
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal wide title="A new version of the method" subtitle="Saved as a new version; the old one is kept, so earlier insights still show the method they were given." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Method"><textarea className={`${inputCls} h-64 font-mono`} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Field label="Tone"><input className={inputCls} value={tone} onChange={(e) => setTone(e.target.value)} /></Field>
        <Field label="What changed"><input className={inputCls} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const e = await onSave({ text, tone, rationale: why }); if (e) setErr(e); else onClose(); }}>Save new version</Button>
        </div>
      </div>
    </Modal>
  );
}
