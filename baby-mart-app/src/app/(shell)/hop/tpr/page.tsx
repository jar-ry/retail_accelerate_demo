"use client";

import { useMemo, useState } from "react";
import { PageHeader, Card, Tile, Loading, ErrorState, Banner, Pill, InfoTip, OwnedCell, Th, Td } from "../_components/ui";
import { EditDialog } from "../_components/EditDialog";
import { useHop, useHopAction, ownershipMap, type Row } from "../_components/useHop";
import { InsightPanel } from "../_components/InsightPanel";
import { audM, pct, num, toNum } from "@/lib/hop/format";
import { PERIOD_DUAL } from "@/lib/hop/config";

type Payload = { funnel: Row[]; credibility: Row[]; byDept: Row[]; bySupplier: Row[]; ownership: Row[]; reasons: Row[]; approval: Row | null };

const STATUS_TONE: Record<string, "red" | "green" | "slate" | "amber"> = {
  "BELOW CREDIBLE OFFER": "red", CREDIBLE: "green", "NO THRESHOLD SET": "amber", "NO RANGE": "slate",
};

/** The option counts a range review agrees, each governed like any plan number.
 *  The totals are calculated from them, so the counts always reconcile. */
const OPTION_COLS = [
  { key: "OPT_NEW", label: "New", owns: "OPTIONS_NEW" },
  { key: "OPT_ONGOING", label: "Ongoing", owns: "OPTIONS_ONGOING" },
  { key: "OPT_NEW_DESELECTED", label: "New dropped", owns: "OPTIONS_NEW_DESELECTED" },
  { key: "OPT_ONGOING_DESELECTED", label: "Ongoing dropped", owns: "OPTIONS_ONGOING_DESELECTED" },
];

export default function TprPage() {
  const { data, error, isLoading } = useHop<Payload>("tpr");
  const mfp = useHopAction("mfp");
  const [edit, setEdit] = useState<{ row: Row; col: (typeof OPTION_COLS)[number] } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const own = useMemo(() => ownershipMap(data?.ownership), [data]);

  if (isLoading) return <Loading what="the range review" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No range data returned." />;

  const g = (code: string) => data.funnel.find((f) => f.GATE_CODE === code);
  const presented = toNum(g("RANGE_PRESENTED")?.OPTIONS_AT_GATE);
  const committed = toNum(g("RANGE_COMMITTED")?.OPTIONS_AT_GATE);
  const delivered = g("DELIVERED");
  const below = data.credibility.filter((c) => c.CREDIBILITY_STATUS === "BELOW CREDIBLE OFFER");
  const maxCount = Math.max(...data.funnel.map((f) => toNum(f.OPTIONS_AT_GATE) ?? 0), 1);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Range review (TPR)" subtitle={<>{PERIOD_DUAL} · where the range is lost between what suppliers offer and what reaches the shelf. Only the option roll-up of the range review lives here.</>} />
      {flash && <Banner tone="ok" onClose={() => setFlash(null)}>{flash}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile emphasis label="Options committed" value={num(committed)} sub={`of ${num(presented)} presented · ${pct(toNum(g("RANGE_COMMITTED")?.LOSS_PCT), 1)} dropped`} />
        <Tile label="Budget on dropped options" value={audM(toNum(g("RANGE_COMMITTED")?.SALES_AT_RISK_AUD), 2)} sub="The bottom-up budget per committed option, times the options dropped"
          hint="Valued at the average COMMITTED option. Whether a dropped option is worth the average presented option instead is an open design decision." />
        <Tile label="Short-shipped after commitment" value={pct(toNum(delivered?.LOSS_PCT), 2)} sub={`${num(toNum(delivered?.UNITS_LOST))} units lost on delivered orders`}
          hint="Real purchase orders, delivered only: an order still on the water has not been short-shipped yet, and counting it would overstate the loss tenfold." />
        <Tile label="Below a credible offer" value={String(below.length)} subClass={below.length ? "text-red-600" : undefined}
          sub={below.map((b) => `${String(b.DEPARTMENT_NAME).toLowerCase()} ${pct(toNum(b.ADOPTION_PCT), 1)} vs ${pct(toNum(b.MIN_CREDIBLE_ADOPTION_PCT), 0)}`).join(" · ") || "every department clears its threshold"} />
      </div>

      <Card title="Where the range goes" subtitle="Four gates. The first is not measurable: no supplier catalogue feed is held, and it is shown as such rather than estimated.">
        <div className="space-y-2">
          {data.funnel.map((f) => {
            const count = toNum(f.OPTIONS_AT_GATE);
            const measurable = f.IS_MEASURABLE_TODAY === true;
            return (
              <div key={String(f.GATE_CODE)} className="grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-3">
                  <div className="font-medium text-slate-900">{String(f.GATE_SEQ)}. {String(f.GATE_NAME)}</div>
                  <div className="text-[10px] text-slate-500">{String(f.OWNER)} · {String(f.DATA_SOURCE ?? "")}</div>
                </div>
                <div className="col-span-6">
                  {!measurable ? (
                    <div className="rounded border border-dashed border-slate-300 px-2 py-1.5 text-[11px] text-slate-400">not measurable today{f.INDICATIVE_SKU_COUNT ? ` · indicatively ${num(toNum(f.INDICATIVE_SKU_COUNT))} SKUs` : ""}</div>
                  ) : count !== null ? (
                    <div className="h-6 rounded bg-teal-600/80" style={{ width: `${Math.max(4, (count / maxCount) * 100)}%` }}>
                      <span className="pl-2 text-[11px] font-semibold leading-6 text-white">{num(count)} options</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600">{num(toNum(f.UNITS_LOST))} units short-shipped · {num(toNum(f.POS_FULLY_LOST))} orders fully lost</div>
                  )}
                </div>
                <div className="col-span-3 text-right">
                  {toNum(f.LOSS_PCT) !== null && <Pill tone={(toNum(f.LOSS_PCT) ?? 0) > 0.1 ? "red" : "amber"}>{pct(toNum(f.LOSS_PCT), 1)} lost here</Pill>}
                  {!measurable && <Pill>{String(f.STATUS).toLowerCase()}</Pill>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Options by department, against a credible offer"
        subtitle="Counts are agreed at range review and edited here under the same rules as any plan number. Presented and dropped are calculated from them.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Department</Th>
                <Th align="right">Presented</Th>
                {OPTION_COLS.map((c) => <Th key={c.key} align="right"><span className="text-teal-800">{c.label}</span></Th>)}
                <Th align="right">Committed</Th>
                <Th align="right">Adoption</Th>
                <Th align="right">Needs</Th>
                <Th>Status</Th>
                <Th align="right">Budget on dropped</Th>
              </tr>
            </thead>
            <tbody>
              {data.credibility.map((r) => (
                <tr key={String(r.DEPARTMENT_NUM)} className="border-b border-slate-50">
                  <Td><span className="text-slate-400">{String(r.DEPARTMENT_NUM)}</span> {String(r.DEPARTMENT_NAME)}</Td>
                  <Td align="right" mono>{num(toNum(r.OPT_PRESENTED))}</Td>
                  {OPTION_COLS.map((c) => (
                    <td key={c.key} className="px-1">
                      <OwnedCell editable={own.get(c.owns)?.editableInApp ?? false} hint={own.get(c.owns)?.ownershipHint} onEdit={() => setEdit({ row: r, col: c })}>
                        {num(toNum(r[c.key]))}
                      </OwnedCell>
                    </td>
                  ))}
                  <Td align="right" mono className="font-semibold">{num(toNum(r.OPT_COMMITTED))}</Td>
                  <Td align="right" mono>{pct(toNum(r.ADOPTION_PCT), 1)}</Td>
                  <Td align="right" mono className="text-slate-500">
                    {pct(toNum(r.MIN_CREDIBLE_ADOPTION_PCT), 0)}
                    {r.THRESHOLD_IS_ASSUMPTION === true && <InfoTip text={`An assumption, not a measurement. ${String(r.THRESHOLD_RATIONALE ?? "")}`} />}
                  </Td>
                  <Td><Pill tone={STATUS_TONE[String(r.CREDIBILITY_STATUS)] ?? "slate"}>{String(r.CREDIBILITY_STATUS).toLowerCase()}</Pill></Td>
                  <Td align="right" mono>{audM(toNum(r.SALES_AT_RISK_AUD), 2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Short-ship by department" subtitle="Delivered purchase orders only. Lead time against the supplier's standard.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Department</Th><Th align="right">Orders</Th><Th align="right">Units ordered</Th><Th align="right">Short-ship</Th><Th align="right">Short orders</Th><Th align="right">Lead days</Th></tr></thead>
            <tbody>
              {data.byDept.map((r) => (
                <tr key={String(r.DEPARTMENT_NAME)} className="border-b border-slate-50">
                  <Td>{String(r.DEPARTMENT_NAME)}</Td>
                  <Td align="right" mono>{num(toNum(r.POS))}</Td>
                  <Td align="right" mono>{num(toNum(r.ORDERED_UNITS))}</Td>
                  <Td align="right" mono className="font-semibold">{pct(toNum(r.ATTRITION_PCT), 2)}</Td>
                  <Td align="right" mono>{num(toNum(r.SHORT_POS))}</Td>
                  <Td align="right" mono>{num(toNum(r.AVG_LEAD_DAYS), 1)} <span className="text-slate-400">/ {num(toNum(r.AVG_STD_LEAD_DAYS), 1)}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Suppliers losing the most range" subtitle="Units ordered but not delivered, as a share of units ordered.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Supplier</Th><Th>Departments</Th><Th align="right">Orders</Th><Th align="right">Units lost</Th><Th align="right">Short-ship</Th></tr></thead>
            <tbody>
              {data.bySupplier.map((r) => (
                <tr key={String(r.SUPPLIER_NAME)} className="border-b border-slate-50">
                  <Td className="font-medium text-slate-800">{String(r.SUPPLIER_NAME)}</Td>
                  <Td className="text-[10px] text-slate-500">{String(r.DEPARTMENTS).toLowerCase()}</Td>
                  <Td align="right" mono>{num(toNum(r.POS))}</Td>
                  <Td align="right" mono>{num(toNum(r.UNITS_LOST))}</Td>
                  <Td align="right" mono className="font-semibold">{pct(toNum(r.ATTRITION_PCT), 2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <InsightPanel surface="TPR" />

      {edit && (
        <EditDialog
          title={`${String(edit.row.DEPARTMENT_NAME)}: ${edit.col.label.toLowerCase()} options`}
          subtitle="Presented, dropped, adoption and the budget on dropped options all follow from this count."
          kind="count" current={toNum(edit.row[edit.col.key])} own={own.get(edit.col.owns)} reasons={data.reasons} locked={!!data.approval}
          onSave={async (p) => {
            const r = await mfp.run({ action: "CELL", planLevel: "DEPARTMENT", entityCode: edit.row.DEPARTMENT_NUM, column: edit.col.key, currentValue: toNum(edit.row[edit.col.key]), ...p });
            if (!r.ok) return r.error;
            setFlash(`Saved ${edit.col.label.toLowerCase()} options for ${String(edit.row.DEPARTMENT_NAME)}.`);
            return null;
          }}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
