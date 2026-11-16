"use client";

import { useState } from "react";
import { FlaskConical, Trash2, Send, CalendarDays, Target, Zap } from "lucide-react";
import { Button, Banner, Field, Modal, Pill, inputCls } from "../../_components/ui";
import type { Row } from "../../_components/useHop";
import { audM, pct, isoDate, shortDate } from "@/lib/hop/format";

type Act = (body: Record<string, unknown>) => Promise<{ error: string | null; data?: Row }>;

const EVENT_LABEL: Record<string, string> = {
  FULL_CLOSURE: "Full closure",
  REFURB_CLOSURE: "Refurbishment closure",
  REDUCED_CAPACITY: "Reduced capacity",
  REOPENING_RAMP: "Reopening ramp",
  CENTRE_EVENT: "Centre event",
};

/** The sandbox bar above the grid. A sandbox is a prompt-free copy of the live
 *  plan to try things in. Nothing in it reaches the live plan: submitting it
 *  proposes it for review; the live plan changes only through governed edits. */
export function SandboxBar({
  scenarios, scenario, periods, months, events, targets, stores, liveTotal, shownTotal, onSelect, act,
}: {
  scenarios: Row[]; scenario: Row | null; periods: Row[]; months: Row[]; events: Row[]; targets: Row[]; stores: Row[];
  liveTotal: number | null; shownTotal: number | null;
  onSelect: (id: number | null) => void; act: Act;
}) {
  const [dialog, setDialog] = useState<"new" | "months" | "events" | "targets" | "submit" | null>(null);
  const sandboxes = scenarios.filter((s) => s.SCENARIO_KIND === "SANDBOX");
  const id = scenario ? Number(scenario.SCENARIO_ID) : null;
  const draft = scenario?.STATUS === "DRAFT";
  const delta = scenario && liveTotal !== null && shownTotal !== null ? shownTotal - liveTotal : null;

  return (
    <div className={`rounded-lg border px-3 py-2 ${scenario ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FlaskConical className={`h-4 w-4 ${scenario ? "text-amber-600" : "text-slate-400"}`} />
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" value={id ?? ""}
          onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Live plan</option>
          {sandboxes.map((s) => (
            <option key={String(s.SCENARIO_ID)} value={String(s.SCENARIO_ID)}>
              Sandbox: {String(s.SCENARIO_NAME)}{s.STATUS !== "DRAFT" ? ` (${String(s.STATUS).toLowerCase()})` : ""}
            </option>
          ))}
        </select>
        {scenario ? (
          <>
            <Pill tone={draft ? "amber" : "slate"}>{draft ? "draft" : String(scenario.STATUS).toLowerCase()}</Pill>
            <span className="text-slate-600">
              {audM(shownTotal, 2)} vs live {audM(liveTotal, 2)}
              {delta !== null && <b className={delta >= 0 ? "text-emerald-700" : "text-red-600"}> ({delta >= 0 ? "+" : ""}{audM(delta)})</b>}
            </span>
            <span className="text-slate-400">· edits here never reach the live plan</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button onClick={() => setDialog("months")} disabled={!draft}><CalendarDays className="h-3.5 w-3.5" />Months</Button>
              <Button onClick={() => setDialog("events")} disabled={!draft}><Zap className="h-3.5 w-3.5" />Events ({events.length})</Button>
              <Button onClick={() => setDialog("targets")} disabled={!draft}><Target className="h-3.5 w-3.5" />Targets ({targets.length})</Button>
              <Button onClick={() => setDialog("submit")} disabled={!draft}><Send className="h-3.5 w-3.5" />Submit</Button>
              <Button variant="danger" onClick={async () => {
                if (!confirm("Discard this sandbox? It will be archived, not deleted.")) return;
                const r = await act({ action: "DISCARD", scenarioId: id });
                if (!r.error) onSelect(null);
              }}><Trash2 className="h-3.5 w-3.5" />Discard</Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-slate-500">Editing the live plan: every change is governed and recorded.</span>
            <div className="ml-auto"><Button onClick={() => setDialog("new")}><FlaskConical className="h-3.5 w-3.5" />New sandbox</Button></div>
          </>
        )}
      </div>

      {dialog === "new" && <NewSandbox act={act} onDone={(sid) => { setDialog(null); if (sid) onSelect(sid); }} />}
      {dialog === "months" && id && <MonthsDialog id={id} months={months} periods={periods} act={act} onClose={() => setDialog(null)} />}
      {dialog === "events" && id && <EventsDialog id={id} events={events} stores={stores} act={act} onClose={() => setDialog(null)} />}
      {dialog === "targets" && id && <TargetsDialog id={id} targets={targets} stores={stores} act={act} onClose={() => setDialog(null)} />}
      {dialog === "submit" && id && <SubmitDialog id={id} act={act} onClose={() => setDialog(null)} />}
    </div>
  );
}

function NewSandbox({ act, onDone }: { act: Act; onDone: (id: number | null) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New sandbox" subtitle="A copy of every live driver, taken now. Later live edits do not leak into it." onClose={() => onDone(null)}>
      <div className="space-y-3">
        <Field label="Name"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prams range slips to October" /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await act({ action: "CREATE_SANDBOX", name });
            setBusy(false);
            if (r.error) setErr(r.error); else onDone(Number(r.data?.scenarioId));
          }}>{busy ? "Copying the plan…" : "Create"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function MonthsDialog({ id, months, periods, act, onClose }: { id: number; months: Row[]; periods: Row[]; act: Act; onClose: () => void }) {
  const sel = new Set(periods.filter((p) => p.IS_SELECTED === true).map((p) => String(p.PERIOD_KEY)));
  const [keys, setKeys] = useState<Set<string>>(sel);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Months this sandbox replans" subtitle="Other months still show, read-only, so the sandbox's totals stay comparable with the live plan." onClose={onClose}>
      <div className="space-y-2">
        {months.map((m) => {
          const k = String(m.PERIOD_KEY).replace(/^M:/, "");
          return (
            <label key={k} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={keys.has(k)} onChange={() => setKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
              {String(m.PERIOD_LABEL)} <span className="text-slate-400">{String(m.CAL_LABEL)}</span>
            </label>
          );
        })}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            const r = await act({ action: "SET_PERIODS", scenarioId: id, periodKeys: [...keys] });
            if (r.error) setErr(r.error); else onClose();
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function EventsDialog({ id, events, stores, act, onClose }: { id: number; events: Row[]; stores: Row[]; act: Act; onClose: () => void }) {
  const [f, setF] = useState({ storeCode: "", eventType: "REFURB_CLOSURE", startDate: "", endDate: "", adjustmentValue: "0.6", description: "" });
  const [err, setErr] = useState<string | null>(null);
  const closure = f.eventType.endsWith("CLOSURE");
  return (
    <Modal wide title="Store events" subtitle="A closure zeroes the weeks it covers; a capacity event scales them. Where events overlap, the lowest factor wins." onClose={onClose}>
      <div className="space-y-3">
        {events.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {events.map((e) => (
                <tr key={String(e.EVENT_ID)} className="border-b border-slate-100">
                  <td className="py-1.5">{String(e.STORE_CODE)}</td>
                  <td>{EVENT_LABEL[String(e.EVENT_TYPE)] ?? String(e.EVENT_TYPE)}</td>
                  <td>{shortDate(e.START_DATE)} – {shortDate(e.END_DATE)}</td>
                  <td className="font-mono">{e.ADJUSTMENT_METHOD === "ZERO" ? "closed" : `× ${Number(e.ADJUSTMENT_VALUE).toFixed(2)}`}</td>
                  <td className="text-slate-500">{String(e.DESCRIPTION ?? "")}</td>
                  <td className="text-right"><button className="text-red-600 hover:underline" onClick={() => act({ action: "EVENT_REMOVE", scenarioId: id, eventId: e.EVENT_ID })}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Store">
            <select className={inputCls} value={f.storeCode} onChange={(e) => setF({ ...f, storeCode: e.target.value })}>
              <option value="">Choose…</option>
              {stores.map((s) => <option key={String(s.STORE_CODE)} value={String(s.STORE_CODE)}>{String(s.STORE_CODE)} {String(s.STORE_NAME).replace("Baby Mart ", "")}</option>)}
            </select>
          </Field>
          <Field label="Event">
            <select className={inputCls} value={f.eventType} onChange={(e) => setF({ ...f, eventType: e.target.value })}>
              {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Sales factor" hint={closure ? "A closure trades at zero." : "0.6 trades at 60%; 1.2 at 120%."}>
            <input className={inputCls} disabled={closure} value={closure ? "0" : f.adjustmentValue} onChange={(e) => setF({ ...f, adjustmentValue: e.target.value })} />
          </Field>
          <Field label="From"><input type="date" min="2026-06-29" max="2026-12-27" className={inputCls} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="To"><input type="date" min="2026-06-29" max="2026-12-27" className={inputCls} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button variant="primary" onClick={async () => {
            setErr(null);
            const r = await act({ action: "EVENT_ADD", scenarioId: id, ...f, adjustmentValue: Number(f.adjustmentValue) });
            if (r.error) setErr(r.error); else setF({ ...f, description: "" });
          }}>Add event</Button>
        </div>
      </div>
    </Modal>
  );
}

function TargetsDialog({ id, targets, stores, act, onClose }: { id: number; targets: Row[]; stores: Row[]; act: Act; onClose: () => void }) {
  const [f, setF] = useState({ measureCode: "SALES_AUD", scopeType: "MARKET", scopeCode: "", startDate: "2026-06-29", endDate: "2026-12-27", targetValue: "" });
  const [preview, setPreview] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isRate = f.measureCode !== "SALES_AUD";
  const body = () => ({
    action: "TARGET", scenarioId: id, ...f, scopeCode: f.scopeType === "MARKET" ? null : f.scopeCode,
    targetValue: isRate ? Number(f.targetValue) / 100 : Number(f.targetValue.replace(/[,$]/g, "")),
  });
  const states = [...new Set(stores.map((s) => String(s.STATE)))].sort();
  const regions = [...new Set(stores.map((s) => String(s.REGION)))].sort();
  return (
    <Modal wide title="Top-down targets" subtitle="Set a target for a scope and the sandbox allocates it across the weeks in proportion to their current shape." onClose={onClose}>
      <div className="space-y-3">
        {targets.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {targets.map((t) => (
                <tr key={String(t.TARGET_ID)} className="border-b border-slate-100">
                  <td className="py-1.5">{String(t.MEASURE_CODE).replace("_AUD", "").replace("_PCT", " %")}</td>
                  <td>{String(t.SCOPE_TYPE).toLowerCase()} {String(t.SCOPE_CODE ?? "")}</td>
                  <td>{isoDate(t.START_DATE)} – {isoDate(t.END_DATE)}</td>
                  <td className="font-mono">{t.MEASURE_CODE === "SALES_AUD" ? `${audM(Number(t.CURRENT_VALUE))} → ${audM(Number(t.TARGET_VALUE))}` : `${pct(Number(t.CURRENT_VALUE))} → ${pct(Number(t.TARGET_VALUE))}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Measure">
            <select className={inputCls} value={f.measureCode} onChange={(e) => { setF({ ...f, measureCode: e.target.value }); setPreview(null); }}>
              <option value="SALES_AUD">Sales $</option>
              <option value="LFL_PCT">LFL %</option>
              <option value="MARGIN_PCT">Margin %</option>
            </select>
          </Field>
          <Field label="Scope">
            <select className={inputCls} value={f.scopeType} onChange={(e) => { setF({ ...f, scopeType: e.target.value, scopeCode: "" }); setPreview(null); }}>
              <option value="MARKET">All stores</option>
              <option value="STATE">A state</option>
              <option value="REGION">A region</option>
              <option value="STORE">A store</option>
            </select>
          </Field>
          <Field label="Which">
            <select className={inputCls} disabled={f.scopeType === "MARKET"} value={f.scopeCode} onChange={(e) => { setF({ ...f, scopeCode: e.target.value }); setPreview(null); }}>
              <option value="">—</option>
              {(f.scopeType === "STATE" ? states : f.scopeType === "REGION" ? regions : stores.map((s) => String(s.STORE_CODE))).map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" className={inputCls} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="To"><input type="date" className={inputCls} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label={isRate ? "Target (%)" : "Target ($)"}><input className={inputCls} value={f.targetValue} onChange={(e) => setF({ ...f, targetValue: e.target.value })} /></Field>
        </div>
        {preview && (
          <Banner tone="info">
            {Number(preview.eligibleWeeks)} store-weeks in scope, currently {isRate ? pct(Number(preview.current), 2) : audM(Number(preview.current), 2)}.
            Applying moves them to {isRate ? pct(Number(preview.target), 2) : audM(Number(preview.target), 2)}.
          </Banner>
        )}
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button onClick={async () => { setErr(null); const r = await act({ ...body(), preview: true }); if (r.error) setErr(r.error); else setPreview(r.data ?? null); }}>Preview</Button>
          <Button variant="primary" disabled={!preview} onClick={async () => { setErr(null); const r = await act(body()); if (r.error) setErr(r.error); else { setPreview(null); onClose(); } }}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

function SubmitDialog({ id, act, onClose }: { id: number; act: Act; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Submit this sandbox" subtitle="Proposes it for review and makes it read-only. It does not change the live plan: that only happens through governed edits." onClose={onClose}>
      <div className="space-y-3">
        <Field label="What it proposes, and why"><textarea className={`${inputCls} h-20`} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        {err && <Banner tone="error">{err}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { const r = await act({ action: "SUBMIT", scenarioId: id, rationale: why }); if (r.error) setErr(r.error); else onClose(); }}>Submit</Button>
        </div>
      </div>
    </Modal>
  );
}
