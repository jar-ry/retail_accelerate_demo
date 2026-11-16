"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, ListChecks } from "lucide-react";
import { PageHeader, Card, Loading, ErrorState, Banner, Segmented, Pill, InfoTip, Th, Td, Button } from "../_components/ui";
import { EditDialog } from "../_components/EditDialog";
import { useHop, useHopAction, ownershipMap, type Row } from "../_components/useHop";
import { InsightPanel } from "../_components/InsightPanel";
import { WssiBulkTray, toTyped, type BulkPick } from "./_parts/BulkTray";
import { resolveCell, formatOf, versionOf, wssiMeasureCode, overrideKey, PRESET_HOP, PRESET_PM, type SpecRow, type Cell, type CellState } from "@/lib/hop/wssi-model";
import { audM, aud, pct, num, wks, toNum, isoDate, isoDateTime } from "@/lib/hop/format";

type Payload = {
  grain: string; scope: string; rows: Row[]; spec: Row[]; pins: Row[]; integrity: Row[];
  ownership: Row[]; reasons: Row[]; settings: Row[]; inputs: Row[];
};

const GRAINS = [
  { value: "WEEK", label: "Week" }, { value: "MONTH", label: "Month" }, { value: "QUARTER", label: "Quarter" },
  { value: "HALF", label: "Half" }, { value: "YEAR", label: "Year" },
];
const GROUP_LABEL: Record<string, string> = {
  TOTAL: "Total", FP: "Full price", CL: "Clearance", MARKDOWN: "Markdown", PURCHASES: "Purchases and open-to-buy", STOCK: "Stock and cover",
};

const STATE_CLS: Record<CellState, string> = {
  MEASURED: "text-slate-900",
  MODELLED: "text-slate-600 italic",
  PLAN: "text-slate-700",
  DERIVED: "text-slate-700",
  PLACEHOLDER: "italic text-amber-700 bg-amber-50/70",
  DEFAULT: "text-slate-500",
  TYPED: "font-semibold text-teal-800 bg-teal-50",
  PINNED: "font-semibold text-violet-800 bg-violet-50",
  AWAITING: "text-slate-300",
  NOT_TRADED: "text-slate-300",
  EMPTY: "text-slate-300",
};

function fmt(spec: SpecRow, c: Cell): string {
  if (c.state === "AWAITING") return "awaiting";
  if (c.value === null) return c.state === "NOT_TRADED" ? "·" : "—";
  switch (formatOf(spec)) {
    case "money": return audM(c.value, 2);
    case "asp": return aud(c.value, 2);
    case "rate": return pct(c.value, 1);
    case "weeks": return wks(c.value, 1);
    case "variance": return pct(c.value, 1, true);
    default: return num(c.value);
  }
}

export default function WssiPage() {
  const [grain, setGrain] = useState("MONTH");
  const [rbu, setRbu] = useState("ALL");
  const [preset, setPreset] = useState<"HOP" | "PM" | "FULL">("HOP");
  const [window, setWindow] = useState<"PLAN" | "BOTH">("BOTH");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ spec: SpecRow; period: Row; cell: Cell; mode: "INPUT" | "PIN" } | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [picks, setPicks] = useState<Map<string, BulkPick>>(new Map());
  const { data, error, isLoading } = useHop<Payload>("wssi", { grain, rbu });
  const action = useHopAction("wssi");

  const own = useMemo(() => ownershipMap(data?.ownership), [data]);
  const spec = useMemo(() => (data?.spec ?? []).map((r) => r as unknown as SpecRow), [data]);
  const byLabel = useMemo(() => new Map(spec.map((s) => [s.ROW_LABEL, s])), [spec]);
  const pinned = useMemo(
    () => new Map((data?.pins ?? []).filter((p) => p.NEW_VALUE != null).map((p) => [overrideKey(p.DISPLAY_ORDER, p.PERIOD_KEY), Number(p.NEW_VALUE)])),
    [data],
  );
  const periods = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of data?.rows ?? []) {
      if (window === "PLAN" && !(Number(r.FY_YEAR) === 2027 && r.FY_HALF === "H1")) continue;
      if (!m.has(String(r.PERIOD_KEY))) m.set(String(r.PERIOD_KEY), r);
    }
    return [...m.values()].sort((a, b) => Number(a.SORT_KEY) - Number(b.SORT_KEY));
  }, [data, window]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, Map<string, Row>>();
    for (const r of data?.rows ?? []) {
      const k = String(r.PERIOD_KEY);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(String(r.VERSION), r);
    }
    return m;
  }, [data]);

  if (isLoading) return <Loading what="the WSSI" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No WSSI returned." />;

  const implausible = Number(data.settings.find((s) => s.SETTING_KEY === "IMPLAUSIBLE_COVER_WEEKS")?.SETTING_VALUE ?? 26);
  const shown = preset === "FULL" ? spec : spec.filter((s) => (preset === "HOP" ? PRESET_HOP : PRESET_PM).includes(Number(s.DISPLAY_ORDER)));
  const groups = [...new Set(shown.map((s) => s.METRIC_GROUP))];
  const locked = false; // WSSI planning rows are Planning's and stay open after approval.
  const soh = data.integrity.find((i) => i.CHECK_NAME === "SOH_FEED_IMPLAUSIBLE_COVER");
  const asAt = isoDate(data.rows[0]?.LAST_ACTUAL_WEEK);

  const editable = (s: SpecRow, period: Row, c: Cell): "INPUT" | "PIN" | null => {
    const o = own.get(wssiMeasureCode(s));
    if (!o?.editableInApp) return null;
    if (s.ROW_KIND === "PLANNED") return Number(period.OPEN_WEEKS ?? 0) > 0 ? "INPUT" : null;
    if (s.ROW_KIND === "FACT" && versionOf(s) === "MERCH_FC" && c.value !== null) return "PIN";
    return null;
  };

  return (
    <div className={`p-6 space-y-4 ${bulk ? "pb-72" : ""}`}>
      <PageHeader title="WSSI" subtitle={<>Weekly sales, stock and intake, department to business. Actuals to week ending {asAt}; unversioned rows read the latest estimate.</>}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={preset} onChange={(v) => setPreset(v as typeof preset)} options={[
              { value: "HOP", label: "Head of planning", title: "Ten rows: are we on plan, and can we buy?" },
              { value: "PM", label: "Planning manager", title: "Twenty rows, adding the split and purchases" },
              { value: "FULL", label: "Full 140" },
            ]} />
          </div>
        } />
      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      {soh && (
        <Banner tone="warn">
          <span className="inline-flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Stock is modelled, not measured.</span>{" "}
          The store stock-on-hand feed implies {String(soh.MIN_REPORTED)}–{String(soh.MAX_REPORTED)} weeks of cover against real sales, so it is not a position to buy against.
          Stock rows show a modelled position that rolls forward exactly; they are marked in italics. Every derived cover inherits the mark.
        </Banner>
      )}

      <Card bodyClass="p-0"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={grain} onChange={(g) => { setGrain(g); setPicks(new Map()); }} options={GRAINS} />
            <Segmented value={rbu} onChange={(v) => { setRbu(v); setPicks(new Map()); }} options={[{ value: "ALL", label: "All RBUs" }, { value: "100", label: "Consumables" }, { value: "200", label: "Hardgoods" }]} />
            <Segmented value={window} onChange={(v) => setWindow(v as typeof window)} options={[{ value: "BOTH", label: "Jan–Dec 2026" }, { value: "PLAN", label: "Plan half only" }]} />
            <Button variant={bulk ? "primary" : "outline"} title="Pick several input or forecast cells and save them under one reason"
              onClick={() => { setBulk(!bulk); setPicks(new Map()); }}>
              <ListChecks className="h-3.5 w-3.5" />Bulk edit
            </Button>
          </div>
        }
        subtitle={<Legend />}>
        <div className="max-h-[72vh] overflow-auto border-t border-slate-100">
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-20 bg-white">
              <tr>
                <th className="sticky left-0 z-30 min-w-[250px] border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-500">Row</th>
                {periods.map((p) => (
                  <th key={String(p.PERIOD_KEY)} className={`min-w-[86px] border-b border-slate-200 px-2 py-1 text-right ${Number(p.FY_YEAR) === 2027 ? "bg-teal-50/40" : ""}`}>
                    <div className="font-semibold text-slate-700">{String(p.PERIOD_LABEL)}</div>
                    <div className="text-[9px] font-normal text-slate-400">{String(p.CAL_LABEL)}</div>
                    <div className="text-[9px] font-normal">
                      {p.PERIOD_STATE === "TRADED" ? <span className="text-slate-500">traded</span> : p.PERIOD_STATE === "PART_TRADED" ? <span className="text-amber-700">part traded</span> : <span className="text-slate-300">to trade</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g} group={g} rows={shown.filter((s) => s.METRIC_GROUP === g)} periods={periods}
                  collapsed={collapsed.has(g)} onToggle={() => setCollapsed((p) => { const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n; })}
                  render={(s, p) => {
                    const c = resolveCell(s, byPeriod.get(String(p.PERIOD_KEY)) ?? new Map(), { byLabel, pinned, periodKey: String(p.PERIOD_KEY), implausibleWeeks: implausible });
                    const mode = editable(s, byPeriod.get(String(p.PERIOD_KEY))?.get("LE") ?? p, c);
                    const tip = [c.note, c.implausible ? `Above ${implausible} weeks: check the stock before trusting this cover.` : null].filter(Boolean).join(" · ");
                    const body = <span className={`block rounded px-1 text-right font-mono tabular-nums ${STATE_CLS[c.state]} ${c.implausible ? "ring-1 ring-amber-400" : ""}`}>{fmt(s, c)}</span>;
                    const key = overrideKey(s.DISPLAY_ORDER, p.PERIOD_KEY);
                    const pick = () => setPicks((prev) => {
                      const n = new Map(prev);
                      if (n.has(key)) n.delete(key);
                      else n.set(key, { key, spec: s, period: p, cell: c, mode: mode!, value: toTyped(s, c.value) });
                      return n;
                    });
                    return mode ? (
                      <button title={tip || own.get(wssiMeasureCode(s))?.ownershipHint} onClick={() => (bulk ? pick() : setEdit({ spec: s, period: p, cell: c, mode }))}
                        className={`w-full border-b border-dashed border-teal-300 hover:bg-teal-50 ${picks.has(key) ? "rounded ring-2 ring-teal-500" : ""}`}>{body}</button>
                    ) : <span title={tip}>{body}</span>;
                  }} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Integrity" subtitle="The WSSI checks itself rather than asking to be trusted.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Check</Th><Th>Version</Th><Th align="right">Breaches</Th><Th>Range</Th></tr></thead>
            <tbody>
              {data.integrity.length === 0 && <tr><Td colSpan={4} className="text-emerald-700">Every check passes.</Td></tr>}
              {data.integrity.map((i) => (
                <tr key={`${i.CHECK_NAME}-${i.VERSION}`} className="border-b border-slate-50 align-top">
                  <Td className="whitespace-normal"><div className="font-medium text-slate-800">{String(i.CHECK_NAME).replace(/_/g, " ").toLowerCase()}</div><div className="text-[10px] text-slate-500">{String(i.RULE)}</div></Td>
                  <Td>{String(i.VERSION)}</Td>
                  <Td align="right" mono>{num(toNum(i.BREACHES))}</Td>
                  <Td className="text-[10px] text-slate-500">{isoDate(i.FIRST_WEEK)} – {isoDate(i.LAST_WEEK)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-500">The model's own checks (roll-forward, full price + clearance, sign, ASP) all pass. The failures are the source stock feed, which is why stock is modelled.</p>
        </Card>
        <Card title="Planning inputs" subtitle="Markdown, shrink and stock adjustments typed for weeks still to trade. Each reads back exactly as typed.">
          {data.inputs.length === 0 ? <p className="text-xs text-slate-500">No planning inputs yet: every planning row is at its default.</p> : (
            <div className="space-y-1.5">
              {data.inputs.map((i) => {
                const rate = i.VALUE_FORM === "RATE";
                return (
                  <div key={String(i.BATCH_ID)} className="rounded-md border border-slate-100 p-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-800">{String(i.MEASURE_CODE).replace(/_/g, " ").toLowerCase()}</span>
                      <Pill tone="teal">{String(i.TYPED_PERIOD_KEY).replace(/^[A-Z]:/, "")}</Pill>
                      <Pill>{String(i.RBU_SCOPE) === "ALL" ? "all RBUs" : `RBU ${i.RBU_SCOPE}`}</Pill>
                      <span className="font-mono">{rate ? pct(toNum(i.OLD_VALUE), 2) : audM(toNum(i.OLD_VALUE), 2)} → {rate ? pct(toNum(i.TYPED_VALUE), 2) : audM(toNum(i.TYPED_VALUE), 2)}</span>
                      <span className="text-slate-400">{String(i.WEEKS)} weeks</span>
                    </div>
                    <div className="text-slate-500">{String(i.CHANGED_BY)} · {isoDateTime(i.CHANGED_AT)} · {String(i.RATIONALE ?? "")}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <InsightPanel surface="WSSI" />

      {edit && (
        <EditDialog
          title={`${edit.spec.ROW_LABEL}: ${String(edit.period.PERIOD_LABEL)}`}
          subtitle={edit.mode === "INPUT"
            ? `${rbu === "ALL" ? "All RBUs" : `RBU ${rbu}`}. Applies to the weeks of this period still to trade, and reads back exactly what you type${edit.period.PERIOD_STATE === "PART_TRADED" ? ": the traded weeks keep their value" : ""}.`
            : "Pins the displayed forecast figure. The forecast feed underneath is unchanged; the pin is recorded."}
          kind={formatOf(edit.spec) === "rate" ? "rate" : formatOf(edit.spec) === "units" ? "count" : "money"}
          current={edit.cell.value}
          own={own.get(wssiMeasureCode(edit.spec))}
          reasons={data.reasons} locked={locked}
          onSave={async (p) => {
            const r = await action.run({ action: edit.mode, grain, rbuScope: rbu, periodKey: edit.period.PERIOD_KEY, displayOrder: edit.spec.DISPLAY_ORDER, currentValue: edit.cell.value, ...p });
            if (!r.ok) return r.error;
            setFlash({ tone: "ok", text: edit.mode === "INPUT" ? `Saved ${edit.spec.ROW_LABEL} for ${String(edit.period.PERIOD_LABEL)} across ${(r.data as Row).weeks} weeks.` : `Pinned ${edit.spec.ROW_LABEL} for ${String(edit.period.PERIOD_LABEL)}.` });
            return null;
          }}
          onClose={() => setEdit(null)}
        />
      )}
      {bulk && (
        <WssiBulkTray
          picks={[...picks.values()]} reasons={data.reasons}
          onChange={(key, value) => setPicks((prev) => { const n = new Map(prev); const x = n.get(key); if (x) n.set(key, { ...x, value }); return n; })}
          onRemove={(key) => setPicks((prev) => { const n = new Map(prev); n.delete(key); return n; })}
          onClear={() => setPicks(new Map())}
          onApply={async (changes, meta) => {
            const r = await action.run({ action: "BULK", grain, rbuScope: rbu, changes, ...meta });
            if (!r.ok) return { error: r.error };
            const results = ((r.data as Row).results ?? []) as { key: string; ok: boolean; error?: string }[];
            const rejected = results.filter((x) => !x.ok);
            // Saved cells leave the tray; refused ones stay, carrying the reason.
            setPicks((prev) => {
              const n = new Map<string, BulkPick>();
              for (const x of rejected) { const pk = prev.get(x.key); if (pk) n.set(x.key, { ...pk, error: x.error }); }
              return n;
            });
            return { error: null, rejected };
          }}
        />
      )}
    </div>
  );
}

function GroupRows({ group, rows, periods, collapsed, onToggle, render }: {
  group: string; rows: SpecRow[]; periods: Row[];
  collapsed: boolean; onToggle: () => void; render: (s: SpecRow, p: Row) => React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td colSpan={periods.length + 1} className="sticky left-0 border-b border-slate-200 bg-slate-100 px-3 py-1">
          <button onClick={onToggle} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{GROUP_LABEL[group] ?? group}
            <span className="font-normal normal-case tracking-normal text-slate-400">· {rows.length} {rows.length === 1 ? "row" : "rows"}</span>
          </button>
        </td>
      </tr>
      {!collapsed && rows.map((s) => (
        <tr key={s.DISPLAY_ORDER} className="hover:bg-slate-50/60">
          <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1">
            <div className="flex items-center gap-1.5">
              <span className="w-6 text-right text-[9px] text-slate-300">{s.DISPLAY_ORDER}</span>
              <span className={`${s.ROW_KIND === "VARIANCE" ? "italic text-slate-500" : "text-slate-800"}`}>{s.ROW_LABEL}</span>
              {s.FORMULA_TEXT && <InfoTip text={<><b>{s.ROW_LABEL}</b>: {s.FORMULA_TEXT}{s.BASIS_NOTE ? <><br />{s.BASIS_NOTE}</> : null}</>} />}
              <KindPill spec={s} />
            </div>
          </td>
          {periods.map((p) => <td key={String(p.PERIOD_KEY)} className="border-b border-slate-100 px-1 py-0.5">{render(s, p)}</td>)}
        </tr>
      ))}
    </>
  );
}

function KindPill({ spec }: { spec: SpecRow }) {
  if (spec.ROW_KIND === "PLACEHOLDER") return <Pill tone="amber" title="Invented so the layout can be used before the feed exists">assumed</Pill>;
  if (spec.ROW_KIND === "AWAITING") return <Pill title={spec.AWAITING_REASON ?? "No feed yet"}>no feed</Pill>;
  if (spec.ROW_KIND === "PLANNED") return <Pill tone="teal" title="A planning input: typed, with a default until someone does">input</Pill>;
  if (spec.MEASURE_BASIS === "MODELLED") return <Pill tone="slate" title="A modelled position, not a measurement">modelled</Pill>;
  return null;
}

function Legend() {
  const items: [string, string][] = [
    ["text-slate-900", "measured"], ["italic text-slate-600", "modelled"], ["italic text-amber-700 bg-amber-50", "assumed"],
    ["text-slate-500", "default input"], ["font-semibold text-teal-800 bg-teal-50", "typed input"], ["font-semibold text-violet-800 bg-violet-50", "pinned"],
    ["text-slate-300", "awaiting a feed · not yet traded"],
  ];
  return (
    <span className="flex flex-wrap gap-2 pt-1">
      {items.map(([cls, label]) => <span key={label} className={`rounded px-1 font-mono text-[10px] ${cls}`}>{label}</span>)}
      <span className="text-[10px] text-slate-400">Dashed cells can be edited. Rates are rebuilt from components; balances are the period&apos;s closing week.</span>
    </span>
  );
}
