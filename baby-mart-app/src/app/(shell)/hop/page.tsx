"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader, Card, Tile, Loading, ErrorState, Th, Td, Pill, InfoTip } from "./_components/ui";
import { InsightPanel } from "./_components/InsightPanel";
import { useHop, type Row } from "./_components/useHop";
import { audM, pct, num, toNum, isoDate, varianceColor, shortDate } from "@/lib/hop/format";
import { BUILD_STAGES, PERIOD_DUAL } from "@/lib/hop/config";

type Overview = { kpi: Row; attention: Row[]; tracking: Row[] };

const SEV_TONE: Record<string, "red" | "amber" | "slate"> = { HIGH: "red", MEDIUM: "amber", LOW: "slate" };

function ratio(a: number | null, b: number | null): number | null {
  return a !== null && b ? a / b - 1 : null;
}

export default function HopOverview() {
  const { data, error, isLoading } = useHop<Overview>("overview");
  if (isLoading) return <Loading what="the planning overview" />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="No planning data returned." />;

  const k = data.kpi;
  const n = (key: string) => toNum(k[key]);
  const plan = n("PLAN_TOTAL_AUD");
  const ly = n("LY_BASE_AUD");
  const lfl = n("LFL_AUD");
  const lflLy = n("LFL_LY_AUD");
  const newS = n("NEW_STORE_AUD");
  const margin = n("PLAN_MARGIN_AUD");
  const approved = n("APPROVED_SALES_AUD");
  const tyTd = n("TY_TD_AUD");
  const asAt = isoDate(k.ACTUALS_AS_AT);
  const leH1 = n("LE_H1_AUD");
  const budH1 = n("BUD_H1_AUD");
  const drift = plan !== null && approved !== null ? plan - approved : null;
  const attention = data.attention.filter((a) => (toNum(a.N) ?? 0) > 0);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Head of Planning"
        subtitle={<>Baby Mart · {PERIOD_DUAL} · does the product plan deliver the budget?</>}
        right={
          <div className="text-right text-[11px] text-slate-500">
            {asAt && <div>actuals to week ending {shortDate(asAt)} 2026</div>}
            {k.APPROVED_AT ? <div>baseline approved {isoDate(k.APPROVED_AT)} by {String(k.APPROVED_BY)}</div> : <div>no approved baseline yet</div>}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          emphasis
          label="H1 store plan"
          value={audM(plan, 2)}
          sub={
            <>
              {pct(ratio(plan, ly), 1, true)} on FY26 H1 ({audM(ly, 2)})
              {drift !== null && Math.abs(drift) >= 1 && (
                <span className="text-amber-700"> · {drift > 0 ? "+" : ""}{audM(drift)} since approval</span>
              )}
            </>
          }
          hint="The live store plan for July to December 2026. Everything else in this tab has to add up to it. The approved figure is held separately and does not move."
        />
        <Tile
          label="Like-for-like"
          value={pct(ratio(lfl, lflLy), 2, true)}
          sub={`${audM(lfl)} on ${num(n("STORES") !== null ? (n("STORES") as number) - (n("NEW_STORES") ?? 0) : null)} comparable stores, from ${audM(lflLy)} last year`}
          hint="Comparable stores only, each matched week for week against its own last year and rebuilt from components rather than averaged. New stores have no like-for-like, so they never flatter or depress it."
        />
        <Tile
          label="New stores"
          value={audM(newS, 2)}
          sub={`${pct(plan ? (newS ?? 0) / plan : null)} of the plan · ${num(n("NEW_STORES"))} openings`}
          hint="A new store has no history, so it is phased off a comparable store at a declared share rather than grown from last year."
        />
        <Tile
          label="Margin"
          value={pct(plan ? (margin ?? 0) / plan : null, 1)}
          sub={`POS margin in the store plan · first margin ${pct(n("PLAN_FIRST_MARGIN_PCT"), 1)} at intake · trading at ${pct(n("EXIT_MARGIN_PCT_ACTUAL"), 1)} this year`}
          hint="Three different numbers. The store plan's margin is a POS margin: sales less landed cost, after discount. FIRST margin is struck at intake at full retail and lives in the MFP. The realised EXIT margin is what this year's tills show. None is quoted as another."
        />
        <Tile
          label="Trading to date"
          value={pct(ratio(tyTd, n("LY_TD_AUD")), 1, true)}
          subClass={varianceColor(ratio(tyTd, n("LY_TD_AUD")))}
          sub={`${audM(tyTd)} since ${shortDate(k.TD_FROM)} vs the same weeks last year · ${pct(ratio(tyTd, n("BUD_TD_AUD")), 1, true)} vs budget · ${pct(ratio(tyTd, n("FC_TD_AUD")), 1, true)} vs forecast`}
          hint="Real POS for every complete week since the start of the current half, against last year, the budget and the merch forecast for exactly the same weeks. The H1 plan asks for like-for-like growth while the business is trading behind last year."
        />
        <Tile
          label="Latest estimate, H1"
          value={audM(leH1, 2)}
          subClass={varianceColor(ratio(leH1, budH1))}
          sub={`${pct(ratio(leH1, budH1), 1, true)} vs the H1 budget of ${audM(budH1, 2)}`}
          hint="The merch forecast for July to December: where the business expects to land, against the board-approved budget it is measured on."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <InsightPanel surface="OVERVIEW" className="xl:col-span-2" />
        <div className="space-y-4">
        <Card title="Ask the Planning Investigator" subtitle="Tests every candidate cause against the store plan, the MFP and the ownership registry, and says who has to move.">
          <div className="space-y-1.5">
            {["Why does QLD plan weaker like-for-like than the rest of the business?", "Why is the bottom-up MFP short of the store plan, and who has to move?"].map((q) => (
              <Link key={q} href={`/hop/investigate?q=${encodeURIComponent(q)}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:border-teal-300 hover:bg-teal-50/50">
                {q}<ArrowRight className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              </Link>
            ))}
          </div>
        </Card>
        <Card title="Needs attention" subtitle="What is unresolved, what has moved, and what is waiting on a decision.">
          {attention.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing outstanding.</p>
          ) : (
            <div className="space-y-1.5">
              {attention.map((a) => (
                <Link key={String(a.KIND)} href={String(a.HREF)}
                  className="flex items-start gap-2 rounded-md border border-slate-200 p-2 hover:border-teal-300 hover:bg-teal-50/40">
                  <Pill tone={SEV_TONE[String(a.SEVERITY)] ?? "slate"}>{num(toNum(a.N))}</Pill>
                  <span className="text-[11px] leading-relaxed text-slate-600">{String(a.DESCRIPTION)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        </div>
      </div>

      <Card title="Actuals against budget and forecast"
        subtitle={<>By fiscal month. A month still trading is compared with the plan for the <em>same weeks</em>, not the whole month.</>}>
        <Tracking rows={data.tracking} />
      </Card>

      <Card className="border-dashed" title="How the plan is built"
        subtitle="Six stages, each reconciling to the one above it. Two are not built here, and are shown so rather than left out.">
        <div className="grid gap-2 lg:grid-cols-2">
          {BUILD_STAGES.map((s, i) => {
            const body =
              s.key === "STORE_PLAN"
                ? `${audM(plan, 2)} across ${num(n("STORES"))} stores from ${num(n("DRIVER_CELLS"))} driver cells. Like-for-like is a store concept, so this comes first.`
                : s.key === "MFP"
                  ? `The product plan adds to ${audM(n("MFP_BOTTOM_UP_AUD"), 2)} bottom-up against ${audM(plan, 2)} top-down. The growth stated at range review and the growth the buy delivers are shown side by side.`
                  : s.key === "TPR"
                    ? `${audM(n("SALES_AT_RISK_AUD"))} of the bottom-up budget sits on options Buying has dropped.`
                    : s.blurb;
            const inner = (
              <>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold">{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-900">{s.label}</span>
                    {s.status !== "BUILT" && <Pill>{s.status === "NOT_SUPPLIED" ? "not supplied" : "not built"}</Pill>}
                  </span>
                  <span className="block pt-0.5 text-xs text-slate-500">{body}</span>
                </span>
              </>
            );
            return s.href ? (
              <Link key={s.key} href={s.href} className="flex gap-3 rounded-md border border-slate-200 p-3 hover:border-teal-300">
                {inner}
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            ) : (
              <div key={s.key} className="flex gap-3 rounded-md border border-dashed border-slate-200 p-3 opacity-70">{inner}</div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Tracking({ rows }: { rows: Row[] }) {
  const months = rows.filter((r) => r.TIME_GRAIN === "MONTH");
  const halves = rows.filter((r) => r.TIME_GRAIN === "HALF");
  const line = (r: Row, isHalf: boolean) => {
    const state = String(r.PERIOD_STATE);
    const a = toNum(r.ACTUAL_AUD);
    const part = state === "PART_TRADED";
    const future = state === "FUTURE";
    // The comparator for a part-traded period is the same weeks of the plan.
    const bud = part ? toNum(r.BUDGET_TD_AUD) : toNum(r.BUDGET_AUD);
    const fc = part ? toNum(r.FORECAST_TD_AUD) : toNum(r.FORECAST_AUD);
    const lyC = part ? toNum(r.LY_TD_AUD) : toNum(r.LY_AUD);
    const v = (x: number | null) => (!future && a !== null ? ratio(a, x) : null);
    const note = future
      ? "Not yet trading: there are no actuals to compare."
      : part
        ? `Part traded: ${r.ACTUAL_WEEKS} of ${r.EXPECTED_WEEKS} weeks. Compared with the plan for the same weeks.`
        : null;
    return (
      <tr key={String(r.PERIOD_KEY)} className={`border-b border-slate-50 ${isHalf ? "bg-slate-50 font-semibold" : ""} ${String(r.FY_YEAR) === "2027" && !isHalf ? "bg-teal-50/30" : ""}`}>
        <Td>
          <span className="text-slate-900">{String(r.PERIOD_LABEL)}</span>
          <span className="ml-1.5 text-[10px] text-slate-400">{String(r.CAL_LABEL)}</span>
          {part && <span className="ml-1.5 text-[10px] text-amber-700" title={note ?? ""}>part month</span>}
          {future && !isHalf && <span className="ml-1.5 text-[10px] text-slate-400">not yet trading</span>}
        </Td>
        <Td align="right" mono>{a !== null ? audM(a, 2) : "—"}</Td>
        <Td align="right" mono className="text-slate-600">{audM(toNum(r.BUDGET_AUD), 2)}</Td>
        <Td align="right" mono className="text-slate-600">{audM(toNum(r.FORECAST_AUD), 2)}</Td>
        <Td align="right" mono className="text-slate-600">{audM(toNum(r.LE_AUD), 2)}</Td>
        <Td align="right" mono className={varianceColor(v(bud))} title={note ?? undefined}>{future ? <span className="text-slate-300">n/a</span> : pct(v(bud), 1, true)}</Td>
        <Td align="right" mono className={varianceColor(v(fc))} title={note ?? undefined}>{future ? <span className="text-slate-300">n/a</span> : pct(v(fc), 1, true)}</Td>
        <Td align="right" mono className={varianceColor(v(lyC))} title={note ?? undefined}>{future ? <span className="text-slate-300">n/a</span> : pct(v(lyC), 1, true)}</Td>
        <Td align="right" mono className="text-slate-500">{pct(ratio(toNum(r.BUDGET_AUD), toNum(r.LY_AUD)), 1, true)}</Td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <Th>Month</Th>
            <Th align="right">Actual</Th>
            <Th align="right">Budget</Th>
            <Th align="right">Forecast</Th>
            <Th align="right" title="Latest estimate: actuals for the weeks traded, the merch forecast after">Latest est.</Th>
            <Th align="right">vs budget</Th>
            <Th align="right">vs forecast</Th>
            <Th align="right">vs LY</Th>
            <Th align="right" title="The growth the budget asks for over last year">Budget vs LY</Th>
          </tr>
        </thead>
        <tbody>
          {months.map((r) => line(r, false))}
          {halves.map((r) => line(r, true))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
        Shaded months are the plan half.
        <InfoTip text="FY26 H2 (Jan–Jun 2026) is the half now trading; FY27 H1 (Jul–Dec 2026) is the half being planned. Baby Mart's fiscal year runs July to June, so 'FY27' alone would be ambiguous: every label carries the calendar months too." />
      </p>
    </div>
  );
}
