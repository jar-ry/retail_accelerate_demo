"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight, ChevronDown, Plus, ListChecks } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Banner, Segmented, Button, Pill, InfoTip, OwnedCell, Th, Td } from "../_components/ui";
import { EditDialog, type EditPayload, type ValueKind } from "../_components/EditDialog";
import { useHop, useHopAction, ownershipMap, type Row } from "../_components/useHop";
import { InsightPanel } from "../_components/InsightPanel";
import { audM, aud, pct, toNum, isoDate, isoDateTime } from "@/lib/hop/format";
import { PERIOD_DUAL } from "@/lib/hop/config";
import { buildColumns, slotsOf, indexWeeks, aggregate, aggregateAll, rates, METRICS, type Grain, type Col, type MetricKey } from "./_parts/model";
import { AddStoreDialog, RebaseDialog, BulkTray, type BulkCell, type StoreDraft } from "./_parts/Dialogs";
import { SandboxBar } from "./_parts/Sandbox";
import { StoreDrawer } from "./_parts/StoreDrawer";
import { StoreAssist } from "./_parts/StoreAssist";
import { StoreGlossary } from "./_parts/StoreGlossary";
import { StoreMaster, type MasterField } from "./_parts/StoreMaster";
import { CommentCell } from "./_parts/StoreComments";

type Payload = {
  scenario: Row | null;
  weeks: Row[]; stores: Row[]; drivers: Row[]; recon: Row[]; reasons: Row[]; ownership: Row[]; history: Row[];
  approval: Row | null; scenarios: Row[]; months: Row[]; variance: Row[]; comments: Row[]; events: Row[]; targets: Row[];
  periods: Row[]; live: Row | null;
};

type EditTarget = {
  title: string;
  subtitle: string;
  kind: ValueKind;
  current: number | null;
  measure: string;
  body: (p: EditPayload) => Record<string, unknown>;
  valueLabel?: string;
};

const GRAINS: { value: Grain; label: string }[] = [
  { value: "WEEK", label: "Week" },
  { value: "MONTH", label: "Month" },
  { value: "QUARTER", label: "Quarter" },
  { value: "HALF", label: "Half" },
  { value: "YEAR", label: "Year" },
];

export default function StorePlanPage() {
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  // ?scenario=<id> opens a sandbox directly (the Sandbox builder links here).
  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get("scenario"));
    if (Number.isInteger(s) && s > 0) setScenarioId(s);
  }, []);
  const { data, error, isLoading } = useHop<Payload>("store-plan", { scenarioId });
  const action = useHopAction("store-plan");
  const [grain, setGrain] = useState<Grain>("MONTH");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"ALL" | "COMPARABLE" | "NEW" | "MOVED">("ALL");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [addStore, setAddStore] = useState(false);
  const [addDraft, setAddDraft] = useState<{ draft: StoreDraft; inferred: string[] } | null>(null);
  const [rebase, setRebase] = useState<Row | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [picked, setPicked] = useState<Map<string, BulkCell>>(new Map());
  // A sandbox that has since been removed (a stale link): show the live plan and say so.
  const missingSandbox = scenarioId !== null && !!error && /does not exist/.test((error as Error).message);
  useEffect(() => {
    if (!missingSandbox) return;
    setFlash({ tone: "warn", text: `Sandbox ${scenarioId} no longer exists, so this is the live plan.` });
    setScenarioId(null);
    window.history.replaceState(null, "", window.location.pathname);
  }, [missingSandbox, scenarioId]);

  const own = useMemo(() => ownershipMap(data?.ownership), [data]);
  const index = useMemo(() => indexWeeks(data?.weeks ?? []), [data]);
  const slots = useMemo(() => slotsOf(data?.weeks ?? []), [data]);
  const columns = useMemo(() => buildColumns(grain, slots, expanded), [grain, slots, expanded]);
  const storeMeta = useMemo(() => new Map((data?.stores ?? []).map((s) => [String(s.STORE_CODE), s])), [data]);
  const moved = useMemo(() => new Set((data?.variance ?? []).map((v) => String(v.STORE_CODE))), [data]);
  const commentsByStore = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const c of data?.comments ?? []) {
      const k = String(c.STORE_CODE);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }, [data]);
  const sandbox = data?.scenario ?? null;
  const isSandbox = !!sandbox;
  const draft = sandbox?.STATUS === "DRAFT";
  const locked = !!data?.approval && !isSandbox;
  const openPeriods = useMemo(
    () => new Set((data?.periods ?? []).filter((p) => p.IS_SELECTED === true).map((p) => String(p.PERIOD_KEY))),
    [data],
  );
  const monthPeriod = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of data?.weeks ?? []) m.set(String(w.MONTH_NAME), String(w.PERIOD_KEY));
    return m;
  }, [data]);

  /** store|month|measure -> the latest recorded change (the initial migration excluded). */
  const lastChange = useMemo(() => {
    const m = new Map<string, Row>();
    for (const h of data?.history ?? []) {
      if (h.IS_MIGRATION === true) continue;
      const k = `${h.ENTITY_CODE}|${h.MONTH_NAME}|${h.MEASURE_CODE}`;
      if (!m.has(k)) m.set(k, h);
    }
    return m;
  }, [data]);

  const storeCodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.stores ?? [])
      .filter((s) => index.has(String(s.STORE_CODE)))
      .filter((s) => (filter === "NEW" ? s.IS_NEW_STORE === true : filter === "COMPARABLE" ? s.IS_NEW_STORE !== true : filter === "MOVED" ? moved.has(String(s.STORE_CODE)) : true))
      .filter((s) => !q || String(s.STORE_CODE).toLowerCase().includes(q) || String(s.STORE_NAME).toLowerCase().includes(q) || String(s.STATE).toLowerCase() === q)
      .map((s) => String(s.STORE_CODE));
  }, [data, index, filter, search, moved]);

  if (isLoading || missingSandbox) return <Loading what="the store plan" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No store plan returned." />;

  const allCodes = [...index.keys()];
  const total = aggregateAll(index, allCodes, slots.map((s) => s.slot));
  const tr = rates(total);
  const liveTotal = toNum(data.live?.PLAN_SALES_AUD);

  const act = async (body: Record<string, unknown>) => {
    const res = await action.run({ scenarioId, ...body });
    if (!res.ok) return { error: res.error };
    return { error: null, data: res.data as Row };
  };

  const save = async (body: Record<string, unknown>): Promise<string | null> => {
    const res = await act(body);
    if (res.error) return res.error;
    const d = res.data ?? {};
    const tot = toNum(d.planSales);
    setFlash({
      tone: d.isPostLockAmendment === true ? "warn" : "ok",
      text: `Saved${d.isPostLockAmendment === true ? " as a post-lock amendment" : ""}.${tot !== null ? ` The plan is now ${aud(tot)}.` : ""}`,
    });
    return null;
  };

  const editable = (col: Col, metric: MetricKey, isNew: boolean): boolean => {
    if (isSandbox && !draft) return false;
    if (metric === "LY" || metric === "MARGIN") return false;
    if (metric === "LFL" && isNew) return false;
    if (col.kind === "quarter" || col.kind === "year") return false;
    if (isSandbox) {
      if (col.kind === "half") return false;
      if (metric === "PLAN" && col.kind === "week") return false;
      return openPeriods.has(monthPeriod.get(col.month ?? "") ?? "");
    }
    if (metric === "PLAN" && col.kind === "week") return false;
    const code =
      col.kind === "half"
        ? { PLAN: "H1_PLAN_SALES_AUD", LFL: "H1_LFL_PCT", MPCT: "H1_MARGIN_PCT" }[metric as "PLAN" | "LFL" | "MPCT"]
        : metric === "PLAN" ? (isNew ? "MONTHLY_SALES_AUD" : "LFL_PCT") : metric === "LFL" ? "LFL_PCT" : "MARGIN_PCT";
    return own.get(code)?.editableInApp ?? false;
  };

  const openEdit = (storeCode: string, col: Col, metric: MetricKey) => {
    const meta = storeMeta.get(storeCode)!;
    const isNew = meta.IS_NEW_STORE === true;
    const a = aggregate(index.get(storeCode), col.slots);
    const r = rates(a);
    const name = String(meta.STORE_NAME).replace("Baby Mart ", "");
    const when = col.kind === "week" ? `week ending ${col.weekEnd}` : col.kind === "half" ? "the half" : col.month!;

    if (bulk && (metric === "LFL" || metric === "MPCT") && (col.kind === "month" || col.kind === "week")) {
      const key = `${storeCode}|${col.key}|${metric}`;
      setPicked((p) => {
        const n = new Map(p);
        if (n.has(key)) n.delete(key);
        else n.set(key, {
          key, storeCode, storeName: name,
          monthName: col.kind === "month" ? col.month : undefined, weekEndDate: col.kind === "week" ? col.weekEnd : undefined,
          measure: metric === "LFL" ? "LFL_PCT" : "MARGIN_PCT", current: metric === "LFL" ? r.lfl : r.marginPct,
        });
        return n;
      });
      return;
    }

    if (col.kind === "half") {
      const measure = metric === "PLAN" ? "H1_PLAN_SALES_AUD" : metric === "LFL" ? "H1_LFL_PCT" : "H1_MARGIN_PCT";
      setEdit({
        title: `${name}: ${metric === "PLAN" ? "half sales" : metric === "LFL" ? "half LFL %" : "half margin %"}`,
        subtitle: metric === "MPCT"
          ? "Every month shifts by the same points, so the monthly shape is kept and the half lands exactly on the target."
          : "Every month scales by the same factor, so the monthly shape is kept and the half lands exactly on the target.",
        kind: metric === "PLAN" ? "money" : "rate",
        current: metric === "PLAN" ? a.plan : metric === "LFL" ? r.lfl : r.marginPct,
        measure,
        body: (p) => ({ action: "HALF", storeCode, measure, currentValue: metric === "PLAN" ? a.plan : metric === "LFL" ? r.lfl : r.marginPct, ...p }),
      });
      return;
    }
    if (metric === "PLAN") {
      setEdit({
        title: `${name}: sales for ${when}`,
        subtitle: isNew
          ? "Types over the benchmark-derived value for this month. The trail records that it is no longer derived."
          : "Name the sales you want and LFL % is back-solved to reach it, so the driver still explains the result.",
        kind: "money", current: a.plan, measure: isNew ? "MONTHLY_SALES_AUD" : "LFL_PCT", valueLabel: "Sales",
        body: (p) => ({ action: "VALUE", storeCode, monthName: col.month, targetSales: p.newValue, currentValue: a.plan, ...p }),
      });
      return;
    }
    const measure = metric === "LFL" ? "LFL_PCT" : "MARGIN_PCT";
    const current = metric === "LFL" ? r.lfl : r.marginPct;
    setEdit({
      title: `${name}: ${metric === "LFL" ? "LFL %" : "margin %"} for ${when}`,
      subtitle: col.kind === "week"
        ? "A week edit wins over the month driver until the month is next changed."
        : "Applies to every week of the month. Earlier week edits in it are superseded.",
      kind: "rate", current, measure,
      body: (p) => ({
        action: "DRIVER", storeCode, measure, currentValue: current,
        monthName: col.kind === "month" ? col.month : undefined, weekEndDate: col.kind === "week" ? col.weekEnd : undefined, ...p,
      }),
    });
  };

  const cell = (storeCode: string, col: Col, metric: MetricKey) => {
    const meta = storeMeta.get(storeCode)!;
    const isNew = meta.IS_NEW_STORE === true;
    const a = aggregate(index.get(storeCode), col.slots);
    if (!a.weeks) return <span className="block text-right text-slate-200">·</span>;
    const r = rates(a);
    const measureForChange =
      col.kind === "half" ? { PLAN: "H1_PLAN_SALES_AUD", LFL: "H1_LFL_PCT", MPCT: "H1_MARGIN_PCT", LY: "", MARGIN: "" }[metric]
        : metric === "LFL" ? "LFL_PCT" : metric === "MPCT" ? "MARGIN_PCT" : metric === "PLAN" ? (isNew ? "MONTHLY_SALES_AUD" : "") : "";
    const ch = measureForChange ? lastChange.get(`${storeCode}|${col.kind === "half" ? "H1" : col.month}|${measureForChange}`) : undefined;
    const weekChanged = col.kind === "week" && a.overridden > 0 && (metric === "LFL" || metric === "MPCT");
    const changed = col.kind !== "week" && ch
      ? `Changed by ${ch.CHANGED_BY} on ${isoDate(ch.CHANGED_AT)}${ch.RATIONALE ? `: ${ch.RATIONALE}` : ""}`
      : weekChanged ? "This week carries its own edit, newer than the month driver" : null;
    const text =
      metric === "LY" ? (isNew ? <span className="text-slate-300">new</span> : audM(a.ly))
        : metric === "PLAN" ? audM(a.plan)
          : metric === "MARGIN" ? audM(a.margin)
            : metric === "LFL" ? (isNew ? <span className="text-slate-300" title="A new store has no like-for-like">n/a</span> : pct(r.lfl, 1, true))
              : pct(r.marginPct, 1);
    const can = editable(col, metric, isNew);
    const pickKey = `${storeCode}|${col.key}|${metric}`;
    const ownCode = metric === "LFL" ? "LFL_PCT" : metric === "MPCT" ? "MARGIN_PCT" : metric === "PLAN" ? "PLAN_SALES_AUD" : metric === "MARGIN" ? "PLAN_MARGIN_AUD" : "LY_SALES_AUD";
    // Plan sales is calculated, but an editable sales cell back-solves the driver
    // behind it, so its hint says that rather than "calculated".
    const hint = metric === "PLAN" && can
      ? col.kind === "half"
        ? "Set the half: every month scales by the same factor, so the shape is kept."
        : isNew ? "Type over the benchmark-derived sales for this month." : "Name the sales you want: LFL % is back-solved to reach it."
      : own.get(ownCode)?.ownershipHint;
    return (
      <div className={`${picked.has(pickKey) ? "rounded ring-2 ring-teal-500" : ""} ${col.kind === "week" && a.halo > 0 ? "bg-violet-50/70" : ""}`}>
        <OwnedCell editable={can} hint={hint} onEdit={() => openEdit(storeCode, col, metric)}
          changed={changed} postLock={ch?.IS_POST_LOCK_AMENDMENT === true}>
          {text}
        </OwnedCell>
      </div>
    );
  };

  const footer = (col: Col, metric: MetricKey | "NEW") => {
    const a = aggregateAll(index, storeCodes, col.slots);
    const r = rates(a);
    const v =
      metric === "LY" ? audM(a.ly) : metric === "PLAN" ? audM(a.plan) : metric === "MARGIN" ? audM(a.margin)
        : metric === "LFL" ? pct(r.lfl, 1, true) : metric === "MPCT" ? pct(r.marginPct, 1) : audM(a.newPlan);
    return <span className="block text-right font-mono tabular-nums">{v}</span>;
  };

  const toggleMonth = (m: string) => setExpanded((p) => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; });

  const MASTER_LABEL: Record<MasterField, string> = { SELLING_AREA_SQM: "Selling area (sqm)", HALO_WEEKS: "Halo weeks" };
  const editMaster = (store: Row, field: MasterField) => {
    const name = String(store.STORE_NAME).replace("Baby Mart ", "");
    setEdit({
      title: `${name}: ${MASTER_LABEL[field].toLowerCase()}`,
      subtitle: field === "HALO_WEEKS"
        ? "The opening weeks flagged as halo, outside next year's like-for-like base. The plan's sales do not move."
        : "No source holds a store's floor area. What is entered here is recorded as Planning's figure, with its reason.",
      kind: "count", current: toNum(store[field]), measure: field, valueLabel: MASTER_LABEL[field],
      body: (p) => ({ action: "STORE_MASTER", storeCode: String(store.STORE_CODE), field, ...p }),
    });
  };
  const isHalfLike = (c: Col) => c.kind === "half" || c.kind === "year";

  return (
    <div className="p-6 space-y-4 pb-28">
      <PageHeader
        title="Store plan"
        subtitle={<>{PERIOD_DUAL} · the budget, built store by store from two drivers: like-for-like % and margin %</>}
        right={
          <>
          <div className="text-right text-[11px] text-slate-500">
            {data.approval ? (
              <>
                <div>baseline approved {isoDate(data.approval.APPROVED_AT)} at {audM(toNum(data.approval.TOTAL_SALES_AUD), 2)}</div>
                <div>agreed numbers now need an escalation note to change</div>
              </>
            ) : <div>draft: no approved baseline</div>}
          </div>
          <Link href={`/hop/investigate?q=${encodeURIComponent("Which states plan the weakest like-for-like, and why?")}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700">
            <Bot className="h-3.5 w-3.5" /> Investigate like-for-like
          </Link>
          </>
        }
      />

      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      <SandboxBar
        scenarios={data.scenarios} scenario={sandbox} periods={data.periods} months={data.months}
        events={data.events} targets={data.targets} stores={data.stores}
        liveTotal={liveTotal} shownTotal={total.plan}
        onSelect={(id) => { setScenarioId(id); setPicked(new Map()); }}
        act={act}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile emphasis label={isSandbox ? "Sandbox plan sales" : "Plan sales"} value={audM(total.plan, 2)} sub={`${pct(tr.growth, 1, true)} on last year's ${audM(total.ly, 2)}`} />
        <Tile label="Like-for-like" value={pct(tr.lfl, 2, true)} sub={`${audM(total.lflPlan)} on a matched ${audM(total.lflLy)}`}
          hint="Comparable stores only, matched week for week. The denominator is last year's sales for the SAME store-weeks, never all of last year." />
        <Tile label="New stores" value={audM(total.newPlan, 2)} sub={`${pct(total.plan ? total.newPlan / total.plan : null)} of the plan`} />
        <Tile label="Margin" value={pct(tr.marginPct, 2)} sub={`${audM(total.margin, 2)} POS margin`} />
        <Tile label="Stores" value={String(allCodes.length)} sub={`${(data.stores ?? []).filter((s) => s.IS_NEW_STORE === true).length} new · ${moved.size} moved since approval`} />
      </div>

      {!isSandbox && <StoreAssist onUse={(draft, inferred) => { setAddDraft({ draft, inferred }); setAddStore(true); }} />}

      <Card
        title="Stores by period"
        subtitle={<>Five measures per store. Dashed cells are typed drivers; everything else is calculated from them. Click a month heading to open its weeks.</>}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <input className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Find a store or state" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="rounded-md border border-slate-300 px-2 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="ALL">All stores</option>
              <option value="COMPARABLE">Comparable</option>
              <option value="NEW">New stores</option>
              <option value="MOVED">Moved since approval</option>
            </select>
            <Segmented value={grain} options={GRAINS} onChange={(g) => { setGrain(g); setPicked(new Map()); }} />
            <Button variant={bulk ? "primary" : "outline"} disabled={grain === "QUARTER" || grain === "HALF" || grain === "YEAR" || (isSandbox && !draft)}
              title="Select many LFL or margin cells and change them with one reason"
              onClick={() => { setBulk(!bulk); setPicked(new Map()); }}>
              <ListChecks className="h-3.5 w-3.5" />Bulk edit
            </Button>
            {!isSandbox && <Button onClick={() => { setAddDraft(null); setAddStore(true); }}><Plus className="h-3.5 w-3.5" />Add store</Button>}
          </div>
        }
        bodyClass="px-0 pb-3"
      >
        <div className="flex flex-wrap items-center gap-3 px-5 pb-2 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 border-b border-dashed border-teal-400" /> typed driver</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> changed</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> amended after approval</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 bg-violet-100" /> halo week (outside LFL)</span>
          {isSandbox && <span className="inline-flex items-center gap-1"><Pill tone="amber">sandbox</Pill> months not being replanned are read-only</span>}
        </div>
        <div className="max-h-[70vh] overflow-auto border-t border-slate-100">
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-20 bg-white">
              <tr>
                <th className="sticky left-0 z-30 min-w-[170px] border-b border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-semibold text-slate-500">Store</th>
                <th className="sticky left-[170px] z-30 min-w-[78px] border-b border-slate-200 bg-white px-2 py-2 text-left text-[11px] font-semibold text-slate-500">Measure</th>
                {columns.map((c) => (
                  <th key={c.key} className={`min-w-[78px] border-b border-slate-200 px-2 py-1 text-right ${isHalfLike(c) ? "bg-slate-50" : c.kind === "week" ? "bg-slate-50/50" : ""}`}>
                    {c.expandable ? (
                      <button onClick={() => toggleMonth(c.month!)} className="inline-flex items-center gap-0.5 font-semibold text-slate-700 hover:text-teal-700">
                        {expanded.has(c.month!) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{c.label}
                      </button>
                    ) : <span className={`font-semibold ${c.kind === "week" ? "text-slate-500" : "text-slate-700"}`}>{c.label}</span>}
                    <div className="text-[9px] font-normal text-slate-400">{c.sub}</div>
                  </th>
                ))}
                <th className="border-b border-slate-200 px-2 py-2 text-left text-[11px] font-semibold text-slate-500">Comments</th>
              </tr>
            </thead>
            <tbody>
              {storeCodes.map((code, si) => {
                const meta = storeMeta.get(code)!;
                const isNew = meta.IS_NEW_STORE === true;
                return METRICS.map((m, mi) => (
                  <tr key={`${code}-${m.key}`} className={si % 2 ? "bg-slate-50/40" : ""}>
                    {mi === 0 && (
                      <td rowSpan={METRICS.length} className={`sticky left-0 z-10 border-b border-slate-200 px-3 py-1.5 align-top ${si % 2 ? "bg-slate-50" : "bg-white"}`}>
                        <button onClick={() => setDrawer(code)} className="text-left">
                          <div className="font-medium text-slate-900 hover:text-teal-700">{String(meta.STORE_NAME).replace("Baby Mart ", "")}</div>
                          <div className="text-[10px] text-slate-400">{code} · {String(meta.STATE)} · {String(meta.REGION)}</div>
                        </button>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {isNew && <Pill tone="violet" title={`${Math.round(Number(meta.BENCHMARK_PCT) * 100)}% of ${meta.BENCHMARK_STORE_CODE}`}>new · {Math.round(Number(meta.BENCHMARK_PCT) * 100)}% of {String(meta.BENCHMARK_STORE_CODE)}</Pill>}
                          {isNew && !meta.OPENING_DATE && <Pill tone="amber" title="No opening date recorded: the first planned week stands in for it">date inferred</Pill>}
                          {moved.has(code) && <Pill tone="amber" title="Differs from the approved baseline">moved</Pill>}
                        </div>
                      </td>
                    )}
                    <td className={`sticky left-[170px] z-10 whitespace-nowrap px-2 py-1 text-slate-500 ${mi === METRICS.length - 1 ? "border-b border-slate-200" : ""} ${si % 2 ? "bg-slate-50" : "bg-white"}`}>{m.label}</td>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-1 py-0.5 ${mi === METRICS.length - 1 ? "border-b border-slate-200" : ""} ${isHalfLike(c) ? "bg-slate-50/70" : ""}`}>
                        {cell(code, c, m.key)}
                      </td>
                    ))}
                    {mi === 0 && (
                      <td rowSpan={METRICS.length} className="border-b border-slate-200 px-2 py-1.5 align-top">
                        <CommentCell comments={commentsByStore.get(code) ?? []} onOpen={() => setDrawer(code)}
                          onPost={async (text) => (await act({ action: "COMMENT", storeCode: code, text })).error} />
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20 bg-teal-50">
              {([...METRICS.map((m) => ({ key: m.key as MetricKey | "NEW", label: m.label })), { key: "NEW" as const, label: "New stores" }]).map((m, i) => (
                <tr key={m.key}>
                  {i === 0 && (
                    <td rowSpan={6} className="sticky left-0 z-30 border-t-2 border-teal-300 bg-teal-50 px-3 py-1.5 align-top font-semibold text-teal-900">
                      {storeCodes.length === allCodes.length ? "All stores" : `${storeCodes.length} stores shown`}
                    </td>
                  )}
                  <td className={`sticky left-[170px] z-30 bg-teal-50 px-2 py-1 font-medium text-teal-900 ${i === 0 ? "border-t-2 border-teal-300" : ""}`}>{m.label}</td>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1 font-semibold text-teal-900 ${i === 0 ? "border-t-2 border-teal-300" : ""}`}>{footer(c, m.key)}</td>
                  ))}
                  {i === 0 && <td rowSpan={6} className="border-t-2 border-teal-300 bg-teal-50" />}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Card>

      <StoreMaster stores={data.stores} own={own} sandbox={isSandbox} onEdit={editMaster} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reconciliation" subtitle="Each figure re-derived independently from POS and the drivers. Every line should tie to the cent.">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200"><Th>Line</Th><Th align="right">Model</Th><Th align="right">Re-derived</Th><Th align="right">Variance</Th></tr></thead>
            <tbody>
              {data.recon.map((r) => {
                const v = toNum(r.VARIANCE_AUD);
                const ties = v !== null && Math.abs(v) < 0.01;
                return (
                  <tr key={String(r.LINE)} className="border-b border-slate-50 align-top">
                    <Td className="whitespace-normal">
                      <div className="font-medium text-slate-800">{String(r.LINE)}</div>
                      <div className="text-[10px] text-slate-500">{String(r.EXPLANATION ?? "")}</div>
                    </Td>
                    <Td align="right" mono>{aud(toNum(r.MODEL_AUD), 2)}</Td>
                    <Td align="right" mono>{aud(toNum(r.SOURCE_STATED_AUD), 2)}</Td>
                    <Td align="right" mono className={ties ? "text-emerald-700" : "text-amber-700"}>
                      {ties ? "ties" : aud(v, 2)}
                      {r.DEFECT ? <InfoTip tone="warn" text={String(r.DEFECT)} /> : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Recent changes" subtitle={`${data.history.filter((h) => h.IS_MIGRATION !== true).length} edits recorded, plus ${data.history.filter((h) => h.IS_MIGRATION === true).length} rationales migrated from the spreadsheet.`}>
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {data.history.filter((h) => h.IS_MIGRATION !== true).slice(0, 40).map((h) => (
              <button key={String(h.OVERRIDE_ID)} onClick={() => storeMeta.has(String(h.ENTITY_CODE)) && setDrawer(String(h.ENTITY_CODE))}
                className="block w-full rounded-md border border-slate-100 p-2 text-left text-[11px] hover:border-teal-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-slate-800">{String(storeMeta.get(String(h.ENTITY_CODE))?.STORE_NAME ?? h.ENTITY_CODE).replace("Baby Mart ", "")}</span>
                  <span className="text-slate-500">{String(h.MONTH_NAME)} {String(h.MEASURE_CODE).replace(/_/g, " ").toLowerCase()}</span>
                  {h.IS_POST_LOCK_AMENDMENT === true && <Pill tone="amber">post-lock</Pill>}
                  {h.COMPLIANCE_STATUS != null && h.COMPLIANCE_STATUS !== "COMPLIANT" && <Pill tone="red">{String(h.COMPLIANCE_STATUS).toLowerCase()}</Pill>}
                </div>
                <div className="text-slate-500">{String(h.CHANGED_BY)} · {isoDateTime(h.CHANGED_AT)}{h.RATIONALE ? ` · ${h.RATIONALE}` : ""}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <StoreGlossary />

      <InsightPanel surface="STORE_PLAN" />

      {edit && (
        <EditDialog
          title={edit.title} subtitle={edit.subtitle} kind={edit.kind} current={edit.current} valueLabel={edit.valueLabel}
          own={own.get(edit.measure)} reasons={data.reasons} locked={locked} sandbox={isSandbox}
          onSave={(p) => save(edit.body(p))} onClose={() => setEdit(null)}
        />
      )}
      {addStore && (
        <AddStoreDialog stores={data.stores} reasons={data.reasons} own={own.get("MONTHLY_SALES_AUD")} locked={locked}
          draft={addDraft?.draft} inferred={addDraft?.inferred}
          onSave={save} onClose={() => { setAddStore(false); setAddDraft(null); }} />
      )}
      {rebase && (
        <RebaseDialog store={rebase} stores={data.stores} reasons={data.reasons} own={own.get("BENCHMARK_PCT")} locked={locked}
          onSave={save} onClose={() => setRebase(null)} />
      )}
      {drawer && storeMeta.has(drawer) && (
        <StoreDrawer store={storeMeta.get(drawer)!} agg={aggregate(index.get(drawer), slots.map((s) => s.slot))}
          history={data.history} comments={data.comments} variance={data.variance} sandbox={isSandbox}
          onClose={() => setDrawer(null)} onRebase={() => { setRebase(storeMeta.get(drawer)!); setDrawer(null); }} act={act} />
      )}
      {bulk && (
        <BulkTray cells={[...picked.values()]} reasons={data.reasons} ownLfl={own.get("LFL_PCT")} ownMargin={own.get("MARGIN_PCT")}
          locked={locked} sandbox={isSandbox} onClear={() => setPicked(new Map())}
          onApply={async (changes, meta) => {
            const res = await act({ action: "BULK", changes, ...meta });
            if (res.error) return { error: res.error };
            const d = res.data as { results?: { key: string; ok: boolean; error?: string }[] };
            return { error: null, rejected: (d.results ?? []).filter((x) => !x.ok) };
          }} />
      )}
    </div>
  );
}
