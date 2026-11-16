"use client";

import { useState } from "react";
import { X, RotateCcw, GitBranch, MessageSquare } from "lucide-react";
import { createPortal } from "react-dom";
import { Button, Banner, Pill, inputCls } from "../../_components/ui";
import type { Row } from "../../_components/useHop";
import { audM, pct, isoDate, isoDateTime, toNum } from "@/lib/hop/format";
import { rates, type Agg } from "./model";

type Act = (body: Record<string, unknown>) => Promise<{ error: string | null }>;

const MEASURE_LABEL: Record<string, string> = {
  LFL_PCT: "LFL %", MARGIN_PCT: "Margin %", MONTHLY_SALES_AUD: "Monthly sales",
  H1_PLAN_SALES_AUD: "Half sales", H1_MARGIN_PCT: "Half margin %", H1_LFL_PCT: "Half LFL %",
  BENCHMARK_PCT: "Benchmark", BENCHMARK_STORE_CODE: "Benchmark store",
};

function fmtChange(measure: string, v: unknown): string {
  const n = toNum(v);
  if (n === null) return "—";
  return measure.includes("PCT") ? pct(n, 2) : audM(n, 2);
}

export function StoreDrawer({
  store, agg, history, comments, variance, sandbox, onClose, onRebase, act,
}: {
  store: Row; agg: Agg; history: Row[]; comments: Row[]; variance: Row[]; sandbox: boolean;
  onClose: () => void; onRebase: () => void; act: Act;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const code = String(store.STORE_CODE);
  const r = rates(agg);
  const isNew = store.IS_NEW_STORE === true;
  const mine = history.filter((h) => h.ENTITY_CODE === code);
  const edits = mine.filter((h) => h.IS_MIGRATION !== true);
  const myVar = variance.filter((v) => v.STORE_CODE === code);
  const myComments = comments.filter((c) => c.STORE_CODE === code);

  const revert = async (h: Row) => {
    setErr(null);
    const res = await act({ action: "REVERT", storeCode: code, monthName: h.MONTH_NAME, measure: h.MEASURE_CODE, rationale: null });
    if (res.error) setErr(res.error);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/20" onMouseDown={onClose}>
      <div className="h-full w-[460px] overflow-y-auto bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">{String(store.STORE_NAME)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span>{code} · {String(store.STATE)} · {String(store.REGION)} · {String(store.STORE_FORMAT)}</span>
              {isNew ? <Pill tone="violet">new store</Pill> : <Pill tone="teal">comparable</Pill>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 px-5 py-4 text-xs">
          <section className="grid grid-cols-2 gap-2">
            <Stat label="Plan sales, H1" value={audM(agg.plan, 2)} />
            <Stat label={isNew ? "LY sales" : "LFL %"} value={isNew ? "no history" : pct(r.lfl, 2, true)} />
            <Stat label="Margin %" value={pct(r.marginPct, 2)} />
            <Stat label="Trading weeks" value={`${agg.weeks}${agg.halo ? ` · ${agg.halo} halo` : ""}`} />
          </section>

          {isNew ? (
            <section className="rounded-md border border-violet-200 bg-violet-50/50 p-3">
              <div className="font-medium text-slate-900">How this store is planned</div>
              <p className="mt-1 text-slate-600">
                {Math.round(Number(store.BENCHMARK_PCT) * 100)}% of {String(store.BENCHMARK_STORE_CODE)} {String(store.BENCHMARK_STORE_NAME ?? "").replace("Baby Mart ", "")},
                phased week by week on {String(store.MIX_SOURCE_STORE_CODE)}&apos;s shape.
                {store.OPENING_DATE ? ` Opens ${isoDate(store.OPENING_DATE)}.` : " No opening date has been recorded: the first planned week stands in for it, and is inferred."}
              </p>
              {store.NOTE ? <p className="mt-1 text-slate-500">{String(store.NOTE)}</p> : null}
              {!sandbox && <div className="mt-2"><Button onClick={onRebase}><GitBranch className="h-3.5 w-3.5" />Re-base</Button></div>}
            </section>
          ) : (
            <section className="rounded-md border border-slate-200 p-3 text-slate-600">
              Grows off its own last year, week for week: plan = LY week × (1 + LFL %), margin = plan × margin %.
              Only those two drivers are typed.
            </section>
          )}

          {myVar.length > 0 && (
            <section>
              <div className="mb-1 font-medium text-slate-900">Moved since the approved baseline</div>
              {myVar.map((v) => (
                <div key={String(v.MONTH_NAME)} className="flex justify-between border-b border-slate-50 py-1">
                  <span>{String(v.MONTH_NAME)} {v.BASELINE_STATUS === "NOT IN BASELINE" && <Pill tone="amber">not in baseline</Pill>}</span>
                  <span className="font-mono">{v.SALES_VARIANCE_AUD == null ? audM(toNum(v.CURRENT_SALES_AUD), 2) : `${Number(v.SALES_VARIANCE_AUD) >= 0 ? "+" : ""}${audM(toNum(v.SALES_VARIANCE_AUD), 2)}`}</span>
                </div>
              ))}
            </section>
          )}

          <section>
            <div className="mb-1 font-medium text-slate-900">Change history ({edits.length})</div>
            {err && <Banner tone="error">{err}</Banner>}
            {mine.length === 0 && <p className="text-slate-500">No recorded changes.</p>}
            <div className="space-y-1.5">
              {mine.map((h) => {
                const measure = String(h.MEASURE_CODE);
                const compliant = h.COMPLIANCE_STATUS === "COMPLIANT" || h.COMPLIANCE_STATUS == null;
                return (
                  <div key={String(h.OVERRIDE_ID)} className="rounded-md border border-slate-100 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {String(h.MONTH_NAME)} {MEASURE_LABEL[measure] ?? measure}: {fmtChange(measure, h.OLD_VALUE)} → {fmtChange(measure, h.NEW_VALUE)}
                      </span>
                      {!sandbox && h.IS_MIGRATION !== true && String(h.PLAN_KIND) === "STORE_PLAN" && h.MONTH_NAME !== "H1" && h.OLD_VALUE != null && (
                        <button title="Step this cell back to its previous value. Recorded as its own entry." onClick={() => revert(h)} className="text-slate-400 hover:text-teal-700">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {String(h.CHANGED_BY)} · {isoDateTime(h.CHANGED_AT)} · {String(h.REASON_CODE ?? "").toLowerCase().replace(/_/g, " ")}
                      {h.IS_POST_LOCK_AMENDMENT === true && <> · <Pill tone="amber">post-lock</Pill></>}
                      {!compliant && <> · <Pill tone="red">{String(h.COMPLIANCE_STATUS).toLowerCase()}</Pill></>}
                    </div>
                    {h.RATIONALE ? <div className="mt-0.5 text-[11px] text-slate-600">{String(h.RATIONALE)}</div> : null}
                    {h.ESCALATION_NOTE ? <div className="mt-0.5 text-[11px] text-amber-800">Escalation: {String(h.ESCALATION_NOTE)}</div> : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center gap-1 font-medium text-slate-900"><MessageSquare className="h-3.5 w-3.5" />Comments</div>
            {myComments.map((c) => (
              <div key={String(c.COMMENT_ID)} className="border-b border-slate-50 py-1.5">
                <div className="text-slate-700">{String(c.COMMENT_TEXT)}</div>
                <div className="text-[10px] text-slate-400">{String(c.CREATED_BY)} · {isoDateTime(c.CREATED_AT)}</div>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" />
              <Button onClick={async () => { const res = await act({ action: "COMMENT", storeCode: code, text }); if (!res.error) setText(""); else setErr(res.error); }}>Post</Button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
