"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Pencil } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Banner, Button, Pill, InfoTip, Th, Td, Segmented } from "../_components/ui";
import { EditDialog } from "../_components/EditDialog";
import { useHop, useHopAction, ownershipMap, type Row } from "../_components/useHop";
import { InsightPanel } from "../_components/InsightPanel";
import { MfpGrid, fmtCol } from "./_parts/Grid";
import { UploadPanel, MixDialog } from "./_parts/Upload";
import { type MfpColumn, type Dept } from "@/lib/hop/mfp-model";
import { audM, aud, pct, pts, toNum, isoDateTime, varianceColor } from "@/lib/hop/format";
import { PERIOD_DUAL } from "@/lib/hop/config";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Payload = {
  grid: Row[]; mix: Row[]; chain: Row[]; recon: Row[]; phased: Row[]; ownership: Row[]; reasons: Row[];
  uploads: Row[]; history: Row[]; approval: Row | null; settings: Row[];
};

function deptsOf(grid: Row[]): Dept[] {
  const n = (r: Row, k: string) => toNum(r[k]) ?? 0;
  return grid.filter((r) => r.PLAN_LEVEL === "DEPARTMENT" && r.HAS_PLAN === true).map((r) => ({
    code: String(r.ENTITY_CODE), name: String(r.ENTITY_NAME), rbu: String(r.RBU_CODE),
    F26_ACTUAL: n(r, "F26_ACTUAL"), F26_UNITS: n(r, "F26_UNITS"), F26_ASP: n(r, "F26_ASP"), F26_FIRST_MARGIN_PCT: n(r, "F26_FIRST_MARGIN_PCT"),
    F26_POS_ACTUAL: n(r, "F26_POS_ACTUAL"), EXIT_MARGIN_PCT: n(r, "EXIT_MARGIN_PCT"),
    LFL_PCT: n(r, "LFL_PCT"), GROWTH_STATED: n(r, "GROWTH_STATED"), TPR_UNITS: n(r, "TPR_UNITS"), TPR_ASP: n(r, "TPR_ASP"),
    POS_PCT: n(r, "POS_PCT"), F27_FIRST_MARGIN_PCT: n(r, "F27_FIRST_MARGIN_PCT"),
    OPT_NEW: n(r, "OPT_NEW"), OPT_ONGOING: n(r, "OPT_ONGOING"), OPT_NEW_DESELECTED: n(r, "OPT_NEW_DESELECTED"), OPT_ONGOING_DESELECTED: n(r, "OPT_ONGOING_DESELECTED"),
  }));
}

export default function MfpPage() {
  const { data, error, isLoading } = useHop<Payload>("mfp");
  const action = useHopAction("mfp");
  const [edit, setEdit] = useState<{ row: Row; col: MfpColumn } | null>(null);
  const [mixOpen, setMixOpen] = useState(false);
  const [rbu, setRbu] = useState<string>("200");
  const [flash, setFlash] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const own = useMemo(() => ownershipMap(data?.ownership), [data]);
  const depts = useMemo(() => deptsOf(data?.grid ?? []), [data]);

  if (isLoading) return <Loading what="the MFP" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No product plan returned." />;

  const act = async (body: Record<string, unknown>) => {
    const r = await action.run(body);
    return r.ok ? { error: null, data: r.data as Row } : { error: r.error };
  };
  const materiality = Number(data.settings.find((s) => s.SETTING_KEY === "MATERIALITY_PTS")?.SETTING_VALUE ?? 7);
  const locked = !!data.approval;
  const chain = data.chain;
  const storePlan = toNum(chain.find((c) => Number(c.HOP) === 1)?.VALUE_AUD) ?? 0;
  const mfpRbu = chain.filter((c) => Number(c.HOP) === 3);
  const bottomUp = mfpRbu.reduce((a, c) => a + (toNum(c.VALUE_AUD) ?? 0), 0);
  const gap = bottomUp - storePlan;
  const breaks = data.grid.filter((r) => r.PLAN_LEVEL === "DEPARTMENT" && Math.abs((toNum(r.GROWTH_BREAK_PTS) ?? 0) * 100) >= materiality);
  const atRisk = data.grid.filter((r) => r.PLAN_LEVEL === "DEPARTMENT").reduce((a, r) => a + (toNum(r.SALES_AT_RISK_AUD) ?? 0), 0);

  const rbuRow = data.grid.find((r) => r.PLAN_LEVEL === "RBU" && r.ENTITY_CODE === rbu);
  const rbuDepts = data.grid.filter((r) => r.PLAN_LEVEL === "DEPARTMENT" && r.RBU_CODE === rbu);
  const recon = data.recon.filter((r) => r.RBU_CODE === rbu);
  const mixRow = data.mix.find((m) => m.RBU_CODE === rbu);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="MFP" subtitle={<>{PERIOD_DUAL} · does the product plan deliver the budget? Top-down from the store plan against bottom-up from the range review.</>}
        right={data.approval ? <div className="text-right text-[11px] text-slate-500">approved baseline in force: agreed and Buying numbers need an escalation note</div> : null} />
      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile emphasis label="Store plan (top-down)" value={audM(storePlan, 2)} sub="The budget the product plan has to add up to" />
        <Tile label="Product plan (bottom-up)" value={audM(bottomUp, 2)} sub={<span className={varianceColor(gap)}>{gap >= 0 ? "+" : ""}{audM(gap, 2)} ({pct(storePlan ? gap / storePlan : null, 1, true)}) against the store plan</span>}
          hint="Units × ASP from the range review, by RBU. The gap is the question for the next range review." />
        <Tile label="Growth breaks" value={String(breaks.length)} sub={breaks.map((b) => `${String(b.ENTITY_NAME).toLowerCase()} ${pts(toNum(b.GROWTH_BREAK_PTS))}`).join(" · ") || "none material"}
          subClass={breaks.length ? "text-red-600" : undefined}
          hint={`The growth stated at range review against the growth the committed buy delivers. Flagged at ${materiality} points (a planning setting).`} />
        <Tile label="Budget on dropped options" value={audM(atRisk, 2)} sub="Bottom-up budget valued at the average committed option"
          hint="Dropped options × the bottom-up budget per committed option. Whether to value them at the average presented option instead is an open design decision." />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="From store plan to product plan" subtitle="Each RBU's share of the store plan, against what its range review adds to.">
          <Plot
            data={[{
              type: "waterfall", orientation: "v",
              x: ["Store plan", ...mfpRbu.map((c) => `${String(c.RBU_CODE) === "100" ? "Consumables" : "Hardgoods"} gap`), "Product plan"],
              measure: ["absolute", ...mfpRbu.map(() => "relative"), "total"],
              y: [storePlan, ...mfpRbu.map((c) => toNum(c.VARIANCE_AUD) ?? 0), bottomUp],
              text: [audM(storePlan, 2), ...mfpRbu.map((c) => audM(toNum(c.VARIANCE_AUD), 2)), audM(bottomUp, 2)],
              textposition: "outside",
              connector: { line: { color: "#cbd5e1" } },
              increasing: { marker: { color: "#059669" } }, decreasing: { marker: { color: "#dc2626" } }, totals: { marker: { color: "#0f766e" } },
            } as never]}
            layout={{
              height: 300, margin: { l: 60, r: 20, t: 20, b: 40 }, showlegend: false,
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
              yaxis: { range: [Math.min(storePlan, bottomUp) * 0.9, Math.max(storePlan, bottomUp) * 1.03], gridcolor: "#f1f5f9", tickprefix: "$", tickformat: ".3s" },
              plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }}
          />
        </Card>
        <Card className="xl:col-span-2" title="RBU mix" subtitle="Store plan → RBU budgets. The stored budget goes stale when the store plan moves; the drift is shown."
          right={<Button onClick={() => setMixOpen(true)} disabled={!own.get("PLAN_MIX_PCT_STATED")?.editableInApp}><Pencil className="h-3.5 w-3.5" />Edit</Button>}>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>RBU</Th><Th align="right">LY mix</Th><Th align="right">Plan mix</Th><Th align="right">Budget</Th><Th align="right">Drift</Th><Th align="right">Bottom-up</Th></tr></thead>
            <tbody>
              {data.mix.map((m) => {
                const drift = toNum(m.PLAN_SALES_DRIFT_AUD);
                return (
                  <tr key={String(m.RBU_CODE)} className="border-b border-slate-50">
                    <Td><span className="text-slate-400">{String(m.RBU_CODE)}</span> {String(m.RBU_DESCRIPTION)}</Td>
                    <Td align="right" mono title={`Stated ${pct(toNum(m.LY_MIX_PCT_STATED), 2)}`}>{pct(toNum(m.LY_MIX_PCT_MEASURED), 1)}</Td>
                    <Td align="right" mono className="font-semibold">{pct(toNum(m.PLAN_MIX_PCT_STATED), 1)}</Td>
                    <Td align="right" mono>{audM(toNum(m.PLAN_SALES_IMPLIED_AUD), 2)}</Td>
                    <Td align="right" mono className={drift && Math.abs(drift) > 1 ? "text-amber-700" : "text-slate-400"} title={`Stored ${aud(toNum(m.PLAN_SALES_STORED_AUD))}`}>
                      {drift && Math.abs(drift) > 1 ? `${drift > 0 ? "+" : ""}${audM(drift)}` : "none"}
                    </Td>
                    <Td align="right" mono className={varianceColor((toNum(m.TPR_BUDGET_AUD) ?? 0) - (toNum(m.PLAN_SALES_IMPLIED_AUD) ?? 0))}>{audM(toNum(m.TPR_BUDGET_AUD), 2)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
            Measured last-year mix comes from POS; the stated figures were agreed at the end-of-half review. Neither is preferred.
            <InfoTip text="The stored budget was struck before Ripley was added to the store plan, which is why it has drifted. Saving the mix re-strikes it from today's total." />
          </p>
        </Card>
      </div>

      <InsightPanel surface="MFP" />

      <MfpGrid rows={data.grid} own={own} materiality={materiality} onEdit={(row, col) => setEdit({ row, col })} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="RBU drill" subtitle="Departments against their share, and the product plan phased to month against the WSSI budget."
          right={<Segmented value={rbu} onChange={setRbu} options={data.grid.filter((r) => r.PLAN_LEVEL === "RBU").map((r) => ({ value: String(r.ENTITY_CODE), label: String(r.ENTITY_NAME) }))} />}>
          {rbuRow && (
            <div className="space-y-3">
              <Plot
                data={[
                  { type: "bar", name: "Top-down", x: rbuDepts.map((d) => String(d.ENTITY_NAME)), y: rbuDepts.map((d) => toNum(d.LFL_FORECAST)), marker: { color: "#99f6e4" } },
                  { type: "bar", name: "Bottom-up", x: rbuDepts.map((d) => String(d.ENTITY_NAME)), y: rbuDepts.map((d) => toNum(d.TPR_BUDGET)), marker: { color: "#0f766e" } },
                ]}
                layout={{ height: 220, barmode: "group", margin: { l: 55, r: 10, t: 10, b: 40 }, font: { family: "Inter, system-ui, sans-serif", size: 11 },
                  legend: { orientation: "h", y: -0.25 }, yaxis: { tickprefix: "$", tickformat: ".3s", gridcolor: "#f1f5f9" }, plot_bgcolor: "white", paper_bgcolor: "white" }}
                config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }}
              />
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-200"><Th>Month</Th><Th align="right">MFP (phased)</Th><Th align="right">WSSI budget</Th><Th align="right">Gap</Th></tr></thead>
                <tbody>
                  {recon.map((r) => (
                    <tr key={String(r.PERIOD_KEY)} className="border-b border-slate-50">
                      <Td>{String(r.MONTH_NAME)} <span className="text-[10px] text-slate-400">{String(r.PERIOD_KEY)}</span></Td>
                      <Td align="right" mono>{audM(toNum(r.MFP_AUD), 2)}</Td>
                      <Td align="right" mono>{audM(toNum(r.BUD_AUD), 2)}</Td>
                      <Td align="right" mono className={varianceColor(toNum(r.VARIANCE_AUD))}>{audM(toNum(r.VARIANCE_AUD), 2)}</Td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <Td>H1</Td>
                    <Td align="right" mono>{audM(recon.reduce((a, r) => a + (toNum(r.MFP_AUD) ?? 0), 0), 2)}</Td>
                    <Td align="right" mono>{audM(recon.reduce((a, r) => a + (toNum(r.BUD_AUD) ?? 0), 0), 2)}</Td>
                    <Td align="right" mono className={varianceColor(recon.reduce((a, r) => a + (toNum(r.VARIANCE_AUD) ?? 0), 0))}>{audM(recon.reduce((a, r) => a + (toNum(r.VARIANCE_AUD) ?? 0), 0), 2)}</Td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[10px] text-slate-500">
                The MFP is a half-level plan, phased here on the store plan&apos;s monthly shape: an allocation, not a figure anyone supplied.
                The WSSI budget is split to department on last year&apos;s mix, so the gap is the product-plan shortfall plus the difference between last year&apos;s mix and the agreed {pct(toNum(mixRow?.PLAN_MIX_PCT_STATED), 1)}.
              </p>
            </div>
          )}
        </Card>
        <Card title="Changes to the product plan" subtitle={`${data.history.length} recorded edits, uploads and mix changes.`}>
          {data.history.length === 0 ? <p className="text-xs text-slate-500">No edits since the plan was loaded.</p> : (
            <div className="max-h-96 space-y-1.5 overflow-y-auto">
              {data.history.map((h) => (
                <div key={String(h.OVERRIDE_ID)} className="rounded-md border border-slate-100 p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-slate-800">{String(h.ENTITY_CODE)} {String(h.MEASURE_CODE).replace(/_/g, " ").toLowerCase()}</span>
                    <span className="font-mono text-slate-600">{fmtHistory(h)}</span>
                    {h.IS_POST_LOCK_AMENDMENT === true && <Pill tone="amber">post-lock</Pill>}
                    {h.ON_BEHALF_OF ? <Pill tone="violet">for {String(h.ON_BEHALF_OF)}</Pill> : null}
                  </div>
                  <div className="text-slate-500">{String(h.CHANGED_BY)} · {isoDateTime(h.CHANGED_AT)}{h.RATIONALE ? ` · ${h.RATIONALE}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <UploadPanel depts={depts} uploads={data.uploads} reasons={data.reasons} ownBuying={own.get("F27_TPR_UNIT_SALES")} locked={locked} act={act} />

      {edit && (
        <EditDialog
          title={`${String(edit.row.ENTITY_NAME)}: ${edit.col.label}`}
          subtitle={edit.col.title ?? "The plan is re-derived from this input; every identity still holds."}
          kind={edit.col.kind === "rate" ? "rate" : edit.col.kind === "count" ? "count" : "money"}
          current={toNum(edit.row[edit.col.key])}
          own={own.get(edit.col.owns ?? "")}
          reasons={data.reasons} locked={locked}
          onSave={async (p) => {
            const r = await act({ action: "CELL", planLevel: "DEPARTMENT", entityCode: edit.row.ENTITY_CODE, column: edit.col.key, currentValue: toNum(edit.row[edit.col.key]), ...p });
            if (r.error) return r.error;
            setFlash({ tone: r.data?.isPostLockAmendment === true ? "warn" : "ok", text: `Saved ${edit.col.label} for ${String(edit.row.ENTITY_NAME)}: ${fmtCol(edit.col, p.newValue)}. ${r.data?.measuresWritten} derived measures re-versioned.` });
            return null;
          }}
          onClose={() => setEdit(null)}
        />
      )}
      {mixOpen && <MixDialog mix={data.mix} reasons={data.reasons} own={own.get("PLAN_MIX_PCT_STATED")} locked={locked} act={act} onClose={() => setMixOpen(false)} />}
    </div>
  );
}

function fmtHistory(h: Row): string {
  const m = String(h.MEASURE_CODE);
  const f = (v: unknown) => {
    const n = toNum(v);
    if (n === null) return "—";
    return m.includes("PCT") || m.includes("MIX") ? pct(n, 2) : m.includes("AUD") ? audM(n, 2) : Math.round(n).toLocaleString("en-AU");
  };
  return `${f(h.OLD_VALUE)} → ${f(h.NEW_VALUE)}`;
}
