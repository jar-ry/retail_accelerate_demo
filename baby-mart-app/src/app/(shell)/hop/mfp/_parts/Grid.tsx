"use client";

import { useState } from "react";
import { Card, Pill, InfoTip, OwnedCell, Th } from "../../_components/ui";
import type { Ownership, Row } from "../../_components/useHop";
import { MFP_COLUMNS, BANDS, type MfpColumn } from "@/lib/hop/mfp-model";
import { audM, aud, pct, pts, num, toNum, varianceColor } from "@/lib/hop/format";

export function fmtCol(c: MfpColumn, v: number | null): string {
  if (v === null) return "—";
  switch (c.kind) {
    case "money": return audM(v, 2);
    case "asp": return aud(v, 2);
    case "rate": return pct(v, 1, c.key.includes("GROWTH") || c.key === "LFL_PCT" || c.key === "EXPANSION_PREMIUM_PCT");
    case "pts": return pts(v, 1);
    default: return num(v);
  }
}

/** The product plan grid: one row per RBU and department, measures grouped in the
 *  pairs a range review argues -- top-down against bottom-up, ASP against units,
 *  first margin against POS margin, and the options behind it all. */
export function MfpGrid({
  rows, own, materiality, onEdit,
}: {
  rows: Row[];
  own: Map<string, Ownership>;
  materiality: number;
  onEdit: (row: Row, col: MfpColumn) => void;
}) {
  const [bands, setBands] = useState<Set<string>>(new Set(["SALES", "ASP_UNITS", "MARGIN", "OPTIONS"]));
  const cols = MFP_COLUMNS.filter((c) => bands.has(c.band));
  const toggle = (b: string) => setBands((p) => { const n = new Set(p); n.has(b) ? n.delete(b) : n.add(b); return n; });

  return (
    <Card
      title="Product plan"
      subtitle={<>Departments are typed; RBUs add them up. Every identity is recomputed from its components on each read.</>}
      right={
        <div className="flex flex-wrap gap-1">
          {BANDS.map((b) => (
            <button key={b.key} onClick={() => toggle(b.key)} title={b.blurb}
              className={`rounded-md border px-2 py-1 text-[11px] ${bands.has(b.key) ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-500"}`}>
              {b.label}
            </button>
          ))}
        </div>
      }
      bodyClass="px-0 pb-3"
    >
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white" />
              {BANDS.filter((b) => bands.has(b.key)).map((b) => (
                <th key={b.key} colSpan={cols.filter((c) => c.band === b.key).length}
                  className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {b.label} <span className="font-normal normal-case tracking-normal text-slate-400">· {b.blurb}</span>
                </th>
              ))}
            </tr>
            <tr>
              <Th className="sticky left-0 z-10 min-w-[190px] border-b border-slate-200 bg-white">Entity</Th>
              {cols.map((c) => (
                <Th key={c.key} align="right" className="border-b border-slate-200" title={c.title}>
                  <span className={c.owns ? "text-teal-800" : ""}>{c.label}</span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isRbu = r.PLAN_LEVEL === "RBU";
              const hasPlan = r.HAS_PLAN === true;
              const breakPts = toNum(r.GROWTH_BREAK_PTS);
              const material = breakPts !== null && Math.abs(breakPts) * 100 >= materiality;
              const idOk = [r.ID1_VARIANCE, r.ID2_VARIANCE, r.ID3_VARIANCE].every((v) => Math.abs(toNum(v) ?? 0) < 0.005);
              return (
                <tr key={`${r.PLAN_LEVEL}-${r.ENTITY_CODE}`} className={isRbu ? "bg-slate-50 font-semibold" : "hover:bg-slate-50/60"}>
                  <td className={`sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 ${isRbu ? "bg-slate-50" : "bg-white"}`}>
                    <div className={`flex items-center gap-1.5 ${isRbu ? "" : "pl-3"}`}>
                      <span className="text-slate-400">{String(r.ENTITY_CODE)}</span>
                      <span className="text-slate-900">{String(r.ENTITY_NAME)}</span>
                      {idOk && hasPlan && <InfoTip text="All three identities hold to the cent: top-down = LY × (1 + LFL), bottom-up = units × ASP, POS $ = bottom-up × POS %."><span className="text-[10px] text-emerald-600">✓</span></InfoTip>}
                      {material && !isRbu && <Pill tone="red" title="The committed range does not deliver the growth stated for it">break</Pill>}
                    </div>
                  </td>
                  {cols.map((c) => {
                    const v = toNum(r[c.key]);
                    if (!hasPlan) return <td key={c.key} className="border-b border-slate-100 px-2 text-right text-slate-300">awaiting plan</td>;
                    const editable = !isRbu && !!c.owns && (own.get(c.owns)?.editableInApp ?? false);
                    const emph = c.key === "GROWTH_BREAK_PTS" ? (material ? "font-semibold text-red-600" : varianceColor(v))
                      : c.key === "VAR_BUD_TO_TPR_AUD" ? varianceColor(v)
                        : c.key === "FIRST_MARGIN_MOVE_PTS" && v !== null && Math.abs(v) > 0.1 ? "font-semibold text-amber-700" : "";
                    return (
                      <td key={c.key} className="border-b border-slate-100 px-1 py-0.5">
                        <OwnedCell editable={editable} hint={c.owns ? own.get(c.owns)?.ownershipHint : c.title ?? "Calculated from the inputs, or last year's record."}
                          onEdit={() => onEdit(r, c)} className={emph}>
                          {fmtCol(c, v)}
                        </OwnedCell>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 pt-2 text-[10px] text-slate-400">
        Teal headings are typed inputs. A growth break of {materiality} points or more is flagged. A first-margin move of more than 10 points is the largest kind of assumption in a plan.
      </p>
    </Card>
  );
}
