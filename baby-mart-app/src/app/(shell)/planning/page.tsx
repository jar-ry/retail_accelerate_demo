"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AlertTriangle, TrendingUp, TrendingDown, Boxes, ArrowRight } from "lucide-react";
import {
  PageHeader, KpiCard, Card, CurrencyToggle, SeverityPill, StrategyPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtPct, fmtPctSigned, fmtPp, varianceClass,
  type Currency,
} from "./_components/ui";
import { SettingTip } from "./_components/settingTip";
import { toPathSegment } from "@/lib/class-slug";
import {
  usePlanningData, type MfpRow, type TrendPoint, type PlanningException,
} from "./_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Overview = {
  currency: Currency;
  mfp: MfpRow | null;
  departments: MfpRow[];
  trend: TrendPoint[];
  otb: {
    stock: number;
    onOrder: number;
    otbAvailable: number;
    coverWeeks: number;
    overbuyClasses: number;
    underbuyClasses: number;
  };
  exceptions: PlanningException[];
};

const EXCEPTION_ICON: Record<string, typeof AlertTriangle> = {
  SALES_RISK: TrendingDown,
  SALES_OPPORTUNITY: TrendingUp,
  MARGIN_EROSION: TrendingDown,
  OVERBUY: Boxes,
  UNDERBUY: Boxes,
  SUPPLIER_DELAY: AlertTriangle,
};

/** Where clicking an exception should take the planner. */
function exceptionHref(e: PlanningException): string {
  if (e.class && e.department) {
    return `/planning/mfp/${toPathSegment(e.department)}/${toPathSegment(e.class)}`;
  }
  if (e.planLevel === "DEPARTMENT") return `/planning/mfp/${toPathSegment(e.node)}`;
  if (e.planLevel === "SUPPLIER") return "/planning/commitments";
  return "/planning/mfp";
}

export default function PlanningDashboard() {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const { data, error, loading } = usePlanningData<Overview>("overview", currency);

  if (loading) return <Loading what="planning dashboard" />;
  if (error) return <ErrorState message={error} />;
  if (!data?.mfp) return <ErrorState message="No planning data returned." />;

  const t = data.mfp;
  const high = data.exceptions.filter((e) => e.severity === "HIGH");

  return (
    <div className="p-6">
      <PageHeader
        title="Global Planning"
        subtitle="BABY MART · F27 H1 (Jan–Jun 2027) · merchandise financial plan and open-to-buy"
        right={<CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />}
      />

      <div className="grid grid-cols-6 gap-3 mb-6">
        <KpiCard label="Forecast Sales" value={fmtMoney(t.salesFc, currency)}
          sub={`Budget ${fmtMoney(t.salesBud, currency)}`} />
        <KpiCard label="Var to Budget" value={fmtPctSigned(t.varToBudPct)}
          sub={fmtMoney(t.varToBud, currency)} subClass={varianceClass(t.varToBudPct)} />
        <KpiCard label="POS Margin" value={fmtPct(t.gpPctFc)}
          sub={`${fmtPp(t.gpGapPp)} vs budget`} subClass={varianceClass(t.gpGapPp)} />
        <KpiCard label="Stock on Hand" value={fmtMoney(data.otb.stock, currency)}
          sub={`${data.otb.coverWeeks.toFixed(1)}w cover`} />
        <KpiCard label="Open-to-Buy" value={fmtMoney(data.otb.otbAvailable, currency)}
          sub={`${fmtMoney(data.otb.onOrder, currency)} on order`}
          subClass={data.otb.otbAvailable < 0 ? "text-amber-700" : "text-slate-500"} />
        <KpiCard label="Exceptions" value={String(data.exceptions.length)}
          sub={`${high.length} high severity`}
          subClass={high.length > 0 ? "text-red-600" : "text-slate-500"} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card
          title="Proactive insights"
          subtitle="Detected in SQL against fixed thresholds, so the same review returns the same findings"
          right={
            <Link href="/planning/insights" className="text-xs font-medium text-violet-700 hover:underline">
              AI analysis →
            </Link>
          }
          className="col-span-1"
        >
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {data.exceptions.length === 0 && (
              <p className="text-sm text-slate-500">No exceptions detected.</p>
            )}
            {data.exceptions.map((e, i) => {
              const Icon = EXCEPTION_ICON[e.type] ?? AlertTriangle;
              return (
                <Link
                  key={`${e.type}-${e.node}-${i}`}
                  href={exceptionHref(e)}
                  className="block border border-slate-200 rounded-lg p-2.5 hover:border-violet-300 hover:bg-violet-50/40"
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                        e.severity === "HIGH" ? "text-red-500" : "text-amber-500"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <SeverityPill severity={e.severity} />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                          {e.type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="text-xs text-slate-700 leading-snug">{e.headline}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card
          title="Sales plan by period"
          subtitle="F27 — Jul–Dec trading in flight, Jan–Jun the plan horizon"
          className="col-span-2"
        >
          <Plot
            data={[
              {
                x: data.trend.map((p) => p.month), y: data.trend.map((p) => p.salesLy),
                type: "bar", name: "Last year", marker: { color: "#e2e8f0" },
              },
              {
                x: data.trend.map((p) => p.month), y: data.trend.map((p) => p.salesBud),
                type: "bar", name: "Budget", marker: { color: "#a78bfa" },
              },
              {
                x: data.trend.map((p) => p.month), y: data.trend.map((p) => p.salesFc),
                type: "scatter", mode: "lines+markers", name: "Forecast",
                line: { color: "#6d28d9", width: 2.5 },
              },
            ]}
            layout={{
              height: 380, margin: { l: 60, r: 20, t: 10, b: 45 },
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
              barmode: "group", showlegend: true, legend: { orientation: "h", y: -0.14 },
              yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
              xaxis: { gridcolor: "#f8fafc" },
              plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Card>
      </div>

      <Card
        title="Departments"
        subtitle="Forecast vs budget across the F27 H1 plan horizon"
        right={
          <Link href="/planning/mfp" className="text-xs font-medium text-violet-700 hover:underline">
            Full MFP →
          </Link>
        }
        className="mb-6"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Dept</Th>
                <Th>Department</Th>
                <Th align="center">LFL</Th>
                <Th align="right">Budget</Th>
                <Th align="right">Forecast</Th>
                <Th align="right">Var to Bud</Th>
                <Th align="right">Var %</Th>
                <Th align="right">LFL %</Th>
                <Th align="right">GP % FC</Th>
                <Th align="right">GP Gap</Th>
                <Th align="right">Mix %</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.departments.map((r) => (
                <tr key={r.departmentCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td mono className="text-slate-400 text-xs">{r.departmentCode}</Td>
                  <Td>
                    <Link
                      href={`/planning/mfp/${toPathSegment(r.department ?? "")}`}
                      className="font-medium text-slate-900 hover:text-violet-700"
                    >
                      {r.department}
                    </Link>
                  </Td>
                  <Td align="center"><StrategyPill strategy={r.lflStrategy} /></Td>
                  <Td align="right" mono>{fmtMoney(r.salesBud, currency)}</Td>
                  <Td align="right" mono className="font-semibold">{fmtMoney(r.salesFc, currency)}</Td>
                  <Td align="right" mono className={varianceClass(r.varToBud)}>{fmtMoney(r.varToBud, currency)}</Td>
                  <Td align="right" mono className={varianceClass(r.varToBudPct)}>{fmtPctSigned(r.varToBudPct)}</Td>
                  <Td align="right" mono className={varianceClass(r.lflGrowthPct)}>{fmtPctSigned(r.lflGrowthPct)}</Td>
                  <Td align="right" mono>{fmtPct(r.gpPctFc)}</Td>
                  <Td align="right" mono className={varianceClass(r.gpGapPp)}>{fmtPp(r.gpGapPp)}</Td>
                  <Td align="right" mono>{fmtPct(r.mixPct)}</Td>
                  <Td align="right">
                    <Link href={`/planning/mfp/${toPathSegment(r.department ?? "")}`}>
                      <ArrowRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Link href="/planning/otb" className="block">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm hover:border-violet-300">
            <div className="flex items-center gap-2 mb-1">
              <Boxes className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-slate-900">Open-to-Buy (WISSI)</span>
            </div>
            <p className="text-xs text-slate-500">
              {data.otb.overbuyClasses} overbought and {data.otb.underbuyClasses} underbought
              classes. Manage buying capacity against live stock and commitments.
            </p>
          </div>
        </Link>
        <Link href="/planning/scenarios" className="block">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm hover:border-violet-300">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-slate-900">Scenario Planning</span>
            </div>
            <p className="text-xs text-slate-500">
              Model demand, price, cost and markdown changes and see the commercial impact on
              sales, margin and required stock.
            </p>
          </div>
        </Link>
        <Link href="/planning/commitments" className="block">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm hover:border-violet-300">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-slate-900">Supplier Commitments</span>
            </div>
            <p className="text-xs text-slate-500">
              Forward purchase orders, ETA slippage and committed spend by supplier and
              sourcing country.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
