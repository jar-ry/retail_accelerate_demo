"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Store } from "lucide-react";
import { Card, Pill, Th, Td, OwnedCell } from "../../_components/ui";
import type { Ownership, Row } from "../../_components/useHop";
import { isoDate } from "@/lib/hop/format";

export type MasterField = "SELLING_AREA_SQM" | "HALO_WEEKS";

/** The store facts the plan reads. Location and format come from the curated
 *  store dimension; selling area (held by no source) and a new store's halo are
 *  Planning's, and change through the same reason-and-audit path as a plan cell. */
export function StoreMaster({
  stores, own, sandbox, onEdit,
}: {
  stores: Row[]; own: Map<string, Ownership>; sandbox: boolean; onEdit: (store: Row, field: MasterField) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return stores.filter((s) => !f || `${s.STORE_CODE} ${s.STORE_NAME} ${s.STATE} ${s.REGION}`.toLowerCase().includes(f));
  }, [stores, find]);
  const recorded = stores.filter((s) => s.SELLING_AREA_SQM != null).length;
  const can = (field: MasterField) => !sandbox && (own.get(field)?.editableInApp ?? false);

  return (
    <Card
      title={
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 hover:text-teal-700">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<Store className="h-4 w-4 text-teal-600" />Store master
        </button>
      }
      subtitle={`${stores.length} stores. Selling area is recorded for ${recorded}: no source holds it, so what is here was entered by Planning, with a reason.`}
      right={open ? <input className="w-44 rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Find a store" value={find} onChange={(e) => setFind(e.target.value)} /> : undefined}
    >
      {open ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200">
                <Th>Store</Th><Th>State</Th><Th>Region</Th><Th>Format</Th><Th>Opens</Th><Th>Planned off</Th>
                <Th align="right">Halo weeks</Th><Th align="right">Selling area (sqm)</Th><Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const isNew = s.IS_NEW_STORE === true;
                return (
                  <tr key={String(s.STORE_CODE)} className="border-b border-slate-50 align-top">
                    <Td>
                      <span className="font-medium text-slate-800">{String(s.STORE_NAME).replace("Baby Mart ", "")}</span>
                      <span className="ml-1 text-[10px] text-slate-400">{String(s.STORE_CODE)}</span>
                      {isNew && <span className="ml-1"><Pill tone="violet">new</Pill></span>}
                    </Td>
                    <Td>{String(s.STATE ?? "—")}</Td>
                    <Td>{String(s.REGION ?? "—")}</Td>
                    <Td>{String(s.STORE_FORMAT ?? "—")}</Td>
                    <Td>{isNew ? (s.OPENING_DATE ? isoDate(s.OPENING_DATE) : <Pill tone="amber" title="The first planned week stands in for it">not recorded</Pill>) : "trading"}</Td>
                    <Td>{isNew ? `${Math.round(Number(s.BENCHMARK_PCT) * 100)}% of ${String(s.BENCHMARK_STORE_CODE)}` : "own last year"}</Td>
                    <Td align="right">
                      {isNew ? (
                        <OwnedCell editable={can("HALO_WEEKS")} hint={own.get("HALO_WEEKS")?.ownershipHint} onEdit={() => onEdit(s, "HALO_WEEKS")}>
                          {s.HALO_WEEKS == null ? <span className="text-slate-400" title="Uses the planning default">default</span> : String(s.HALO_WEEKS)}
                        </OwnedCell>
                      ) : <span className="text-slate-300">·</span>}
                    </Td>
                    <Td align="right">
                      <OwnedCell editable={can("SELLING_AREA_SQM")} hint={own.get("SELLING_AREA_SQM")?.ownershipHint} onEdit={() => onEdit(s, "SELLING_AREA_SQM")}>
                        {s.SELLING_AREA_SQM == null ? <span className="text-slate-400" title="Not recorded. Never shown as zero.">not recorded</span> : Number(s.SELLING_AREA_SQM).toLocaleString("en-AU")}
                      </OwnedCell>
                    </Td>
                    <Td className="max-w-[260px] whitespace-normal text-[11px] text-slate-500">{s.NOTE ? String(s.NOTE) : ""}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-[11px] text-teal-700 hover:underline">Show the store master</button>
      )}
    </Card>
  );
}
