"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle, StrategyPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtMoneyExact, fmtPct, fmtPctSigned, fmtPp, fmtNum, varianceClass,
  type Currency,
} from "../_components/ui";
import { SettingTip } from "../_components/settingTip";
import { toPathSegment } from "@/lib/class-slug";
import { usePlanningData, type MfpRow, type TrendPoint } from "../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type MfpResponse = {
  currency: Currency;
  level: string;
  total: MfpRow | null;
  rows: MfpRow[];
  trend: TrendPoint[];
};

type Tab = "plan" | "margin" | "range";

export default function MfpPage() {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [tab, setTab] = useState<Tab>("plan");
  const { data, error, loading } = usePlanningData<MfpResponse>("mfp", currency);

  if (loading) return <Loading what="merchandise financial plan" />;
  if (error) return <ErrorState message={error} backHref="/planning" backLabel="Planning dashboard" />;
  if (!data?.total) return <ErrorState message="No plan data returned." backHref="/planning" />;

  const t = data.total;
  const tabClass = (x: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 cursor-pointer ${
      tab === x
        ? "border-violet-600 text-violet-800 bg-violet-50"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Merchandise Financial Plan" }]} />
      <PageHeader
        title="Merchandise Financial Plan"
        subtitle="BABY MART · F27 H1 (Jan–Jun 2027) · drill from RBU to department to class"
        right={<CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />}
      />

      <div className="grid grid-cols-6 gap-3 mb-6">
        <KpiCard label="Forecast Sales" value={fmtMoney(t.salesFc, currency)}
          sub={`Budget ${fmtMoney(t.salesBud, currency)}`} />
        <KpiCard label="Var to Budget" value={fmtPctSigned(t.varToBudPct)}
          sub={fmtMoney(t.varToBud, currency)} subClass={varianceClass(t.varToBudPct)} />
        <KpiCard label="LFL Growth" value={fmtPctSigned(t.lflGrowthPct)}
          sub="vs last year" subClass={varianceClass(t.lflGrowthPct)} />
        <KpiCard label="POS Margin" value={fmtPct(t.gpPctFc)}
          sub={`${fmtPp(t.gpGapPp)} vs budget`} subClass={varianceClass(t.gpGapPp)} />
        <KpiCard label="Units" value={fmtNum(t.unitsFc)}
          sub={`ASP ${fmtMoneyExact(t.aspFc, currency)}`} />
        <KpiCard label="Options" value={fmtNum(t.optTotal)}
          sub={`${fmtPct(t.optNewPct)} new`} />
      </div>

      <Card
        title="Sales plan by period"
        subtitle="F27 full year. The plan horizon is Jan–Jun; Jul–Dec is trading in flight."
        className="mb-6"
      >
        <Plot
          data={[
            {
              x: data.trend.map((p) => p.month), y: data.trend.map((p) => p.salesLy),
              type: "bar", name: "Last year", marker: { color: "#cbd5e1" },
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
            height: 300, margin: { l: 60, r: 20, t: 10, b: 40 },
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            barmode: "group", showlegend: true,
            legend: { orientation: "h", y: -0.18 },
            yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
            xaxis: { gridcolor: "#f8fafc" },
            plot_bgcolor: "white", paper_bgcolor: "white",
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </Card>

      <div className="flex gap-1 border-b border-slate-200">
        <button className={tabClass("plan")} onClick={() => setTab("plan")}>Sales Plan</button>
        <button className={tabClass("margin")} onClick={() => setTab("margin")}>Margin & Price</button>
        <button className={tabClass("range")} onClick={() => setTab("range")}>Range & Options</button>
      </div>

      <div className="bg-white rounded-b-xl rounded-tr-xl p-5 border border-t-0 border-slate-200 shadow-sm mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <Th>Dept</Th>
              <Th>Department</Th>
              <Th align="center">LFL</Th>
              {tab === "plan" && (
                <>
                  <Th align="right">F26 Actual</Th>
                  <Th align="right">Budget</Th>
                  <Th align="right">Forecast</Th>
                  <Th align="right">Var to Bud</Th>
                  <Th align="right">Var %</Th>
                  <Th align="right">LFL %</Th>
                  <Th align="right">Mix %</Th>
                </>
              )}
              {tab === "margin" && (
                <>
                  <Th align="right">Forecast Sales</Th>
                  <Th align="right">GP Amount</Th>
                  <Th align="right">GP % Bud</Th>
                  <Th align="right">GP % FC</Th>
                  <Th align="right">GP Gap</Th>
                  <Th align="right">ASP LY</Th>
                  <Th align="right">ASP FC</Th>
                </>
              )}
              {tab === "range" && (
                <>
                  <Th align="right">Units</Th>
                  <Th align="right">Unit Growth</Th>
                  <Th align="right">Options</Th>
                  <Th align="right">New</Th>
                  <Th align="right">% New</Th>
                  <Th align="right">Ongoing</Th>
                  <Th align="right">Deselected</Th>
                </>
              )}
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
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

                {tab === "plan" && (
                  <>
                    <Td align="right" mono>{fmtMoney(r.salesF26, currency)}</Td>
                    <Td align="right" mono>{fmtMoney(r.salesBud, currency)}</Td>
                    <Td align="right" mono className="font-semibold">{fmtMoney(r.salesFc, currency)}</Td>
                    <Td align="right" mono className={varianceClass(r.varToBud)}>{fmtMoney(r.varToBud, currency)}</Td>
                    <Td align="right" mono className={varianceClass(r.varToBudPct)}>{fmtPctSigned(r.varToBudPct)}</Td>
                    <Td align="right" mono className={varianceClass(r.lflGrowthPct)}>{fmtPctSigned(r.lflGrowthPct)}</Td>
                    <Td align="right" mono>{fmtPct(r.mixPct)}</Td>
                  </>
                )}
                {tab === "margin" && (
                  <>
                    <Td align="right" mono>{fmtMoney(r.salesFc, currency)}</Td>
                    <Td align="right" mono>{fmtMoney(r.gpFc, currency)}</Td>
                    <Td align="right" mono>{fmtPct(r.gpPctBud)}</Td>
                    <Td align="right" mono className="font-semibold">{fmtPct(r.gpPctFc)}</Td>
                    <Td align="right" mono className={varianceClass(r.gpGapPp)}>{fmtPp(r.gpGapPp)}</Td>
                    <Td align="right" mono>{fmtMoneyExact(r.aspLy, currency)}</Td>
                    <Td align="right" mono>{fmtMoneyExact(r.aspFc, currency)}</Td>
                  </>
                )}
                {tab === "range" && (
                  <>
                    <Td align="right" mono>{fmtNum(r.unitsFc)}</Td>
                    <Td align="right" mono className={varianceClass(r.unitGrowthPct)}>{fmtPctSigned(r.unitGrowthPct)}</Td>
                    <Td align="right" mono>{fmtNum(r.optTotal)}</Td>
                    <Td align="right" mono>{fmtNum(r.optNew)}</Td>
                    <Td align="right" mono>{fmtPct(r.optNewPct)}</Td>
                    <Td align="right" mono>{fmtNum(r.optOngoing)}</Td>
                    <Td align="right" mono>{fmtNum(r.optDeselected)}</Td>
                  </>
                )}
                <Td align="right">
                  <Link href={`/planning/mfp/${toPathSegment(r.department ?? "")}`}>
                    <ChevronRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                  </Link>
                </Td>
              </tr>
            ))}
            {/* RBU total. Reads SUM of the department rows by construction -- the
                fact is built bottom-up from class level, so this ties exactly. */}
            <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50">
              <Td />
              <Td>BABY MART total</Td>
              <Td />
              {tab === "plan" && (
                <>
                  <Td align="right" mono>{fmtMoney(t.salesF26, currency)}</Td>
                  <Td align="right" mono>{fmtMoney(t.salesBud, currency)}</Td>
                  <Td align="right" mono>{fmtMoney(t.salesFc, currency)}</Td>
                  <Td align="right" mono className={varianceClass(t.varToBud)}>{fmtMoney(t.varToBud, currency)}</Td>
                  <Td align="right" mono className={varianceClass(t.varToBudPct)}>{fmtPctSigned(t.varToBudPct)}</Td>
                  <Td align="right" mono className={varianceClass(t.lflGrowthPct)}>{fmtPctSigned(t.lflGrowthPct)}</Td>
                  <Td align="right" mono>100.0%</Td>
                </>
              )}
              {tab === "margin" && (
                <>
                  <Td align="right" mono>{fmtMoney(t.salesFc, currency)}</Td>
                  <Td align="right" mono>{fmtMoney(t.gpFc, currency)}</Td>
                  <Td align="right" mono>{fmtPct(t.gpPctBud)}</Td>
                  <Td align="right" mono>{fmtPct(t.gpPctFc)}</Td>
                  <Td align="right" mono className={varianceClass(t.gpGapPp)}>{fmtPp(t.gpGapPp)}</Td>
                  <Td align="right" mono>{fmtMoneyExact(t.aspLy, currency)}</Td>
                  <Td align="right" mono>{fmtMoneyExact(t.aspFc, currency)}</Td>
                </>
              )}
              {tab === "range" && (
                <>
                  <Td align="right" mono>{fmtNum(t.unitsFc)}</Td>
                  <Td align="right" mono className={varianceClass(t.unitGrowthPct)}>{fmtPctSigned(t.unitGrowthPct)}</Td>
                  <Td align="right" mono>{fmtNum(t.optTotal)}</Td>
                  <Td align="right" mono>{fmtNum(t.optNew)}</Td>
                  <Td align="right" mono>{fmtPct(t.optNewPct)}</Td>
                  <Td align="right" mono>{fmtNum(t.optOngoing)}</Td>
                  <Td align="right" mono>{fmtNum(t.optDeselected)}</Td>
                </>
              )}
              <Td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
