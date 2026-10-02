"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronRight, Lightbulb } from "lucide-react";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle, StrategyPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtMoneyExact, fmtPct, fmtPctSigned, fmtPp, fmtNum, varianceClass,
  type Currency,
} from "../../_components/ui";
import { SettingTip } from "../../_components/settingTip";
import { toPathSegment, fromPathSegment } from "@/lib/class-slug";
import { usePlanningData, type MfpRow, type TrendPoint } from "../../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Response = {
  currency: Currency;
  department: string;
  total: MfpRow;
  rows: MfpRow[];
  trend: TrendPoint[];
};

export default function MfpDepartmentPage() {
  const params = useParams();
  const department = fromPathSegment(params.dept as string);
  const [currency, setCurrency] = useState<Currency>("PHP");
  const { data, error, loading } = usePlanningData<Response>(
    `mfp/${toPathSegment(department)}`,
    currency
  );

  if (loading) return <Loading what={department} />;
  if (error)
    return <ErrorState message={error} backHref="/planning/mfp" backLabel="Merchandise Financial Plan" />;
  if (!data?.total)
    return <ErrorState message={`No plan for ${department}.`} backHref="/planning/mfp" backLabel="Merchandise Financial Plan" />;

  const t = data.total;

  return (
    <div className="p-6">
      <Breadcrumb
        trail={[
          { label: "Global Planning", href: "/planning" },
          { label: "MFP", href: "/planning/mfp" },
          { label: department },
        ]}
      />
      <PageHeader
        title={`${t.departmentCode} · ${department}`}
        subtitle="F27 H1 (Jan–Jun 2027) department plan · drill into a class for the weekly buy position"
        right={
          <>
            <Link
              href={`/planning/insights?level=DEPARTMENT&node=${encodeURIComponent(department)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700"
            >
              <Lightbulb className="w-3.5 h-3.5" /> AI insights
            </Link>
            <CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />
          </>
        }
      />

      <div className="grid grid-cols-6 gap-3 mb-6">
        <KpiCard label="Forecast Sales" value={fmtMoney(t.salesFc, currency)}
          sub={`Budget ${fmtMoney(t.salesBud, currency)}`} />
        <KpiCard label="Var to Budget" value={fmtPctSigned(t.varToBudPct)}
          sub={fmtMoney(t.varToBud, currency)} subClass={varianceClass(t.varToBudPct)} />
        {/* Spelling the strategy code out matters: a "D" department is meant to
            decline, so its negative LFL is on-strategy and should be judged
            against budget. Leaving that as a hover tooltip hid the point. */}
        <KpiCard label="LFL Growth" value={fmtPctSigned(t.lflGrowthPct)}
          sub={
            t.lflStrategy === "D"
              ? "Strategy D · planned decline"
              : t.lflStrategy === "G"
              ? "Strategy G · grow"
              : "Strategy –"
          }
          subClass={varianceClass(t.lflGrowthPct)} />
        <KpiCard label="POS Margin" value={fmtPct(t.gpPctFc)}
          sub={`${fmtPp(t.gpGapPp)} vs budget`} subClass={varianceClass(t.gpGapPp)} />
        <KpiCard label="Mix of RBU" value={fmtPct(t.mixPct)}
          sub={`${fmtNum(t.unitsFc)} units`} />
        <KpiCard label="Options" value={fmtNum(t.optTotal)}
          sub={`${fmtPct(t.optNewPct)} new`} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card title="Sales plan by period" subtitle="Budget vs forecast across F27">
          <Plot
            data={[
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
              height: 260, margin: { l: 55, r: 15, t: 10, b: 40 },
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
              showlegend: true, legend: { orientation: "h", y: -0.2 },
              yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
              xaxis: { gridcolor: "#f8fafc" },
              plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Card>

        <Card title="Class contribution" subtitle="Share of department forecast sales">
          <Plot
            data={[
              {
                labels: data.rows.map((r) => r.class ?? ""),
                values: data.rows.map((r) => r.salesFc),
                type: "pie", hole: 0.55,
                marker: { colors: ["#6d28d9", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"] },
                // Only the percentage goes inside the ring; class names go in a
                // legend. Class names are long enough that outside labels were
                // clipped by the card edge, and putting them inside made Plotly
                // auto-shrink them to an unreadable size to make them fit.
                textinfo: "percent",
                textposition: "inside",
                insidetextorientation: "horizontal",
                texttemplate: "%{percent:.1%}",
                textfont: { size: 12 },
                hovertemplate: "%{label}: %{percent:.1%}<extra></extra>",
              },
            ]}
            layout={{
              height: 280, margin: { l: 10, r: 10, t: 10, b: 10 },
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
              // minsize with mode "show" stops Plotly scaling a label down to
              // fit its slice, which is what made one label illegible.
              uniformtext: { minsize: 11, mode: "show" },
              showlegend: true,
              legend: { orientation: "h", y: -0.05, x: 0.5, xanchor: "center", font: { size: 11 } },
              plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Card>
      </div>

      <Card title="Classes" subtitle={`${data.rows.length} classes in ${department}`} className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Class</Th>
                <Th>Name</Th>
                <Th align="center">LFL</Th>
                <Th align="right">Budget</Th>
                <Th align="right">Forecast</Th>
                <Th align="right">Var %</Th>
                <Th align="right">LFL %</Th>
                <Th align="right">GP % FC</Th>
                <Th align="right">GP Gap</Th>
                <Th align="right">ASP</Th>
                <Th align="right">Options</Th>
                <Th align="right">Mix %</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.classCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td mono className="text-slate-400 text-xs">{r.classCode}</Td>
                  <Td>
                    <Link
                      href={`/planning/mfp/${toPathSegment(department)}/${toPathSegment(r.class ?? "")}`}
                      className="font-medium text-slate-900 hover:text-violet-700"
                    >
                      {r.class}
                    </Link>
                  </Td>
                  <Td align="center"><StrategyPill strategy={r.lflStrategy} /></Td>
                  <Td align="right" mono>{fmtMoney(r.salesBud, currency)}</Td>
                  <Td align="right" mono className="font-semibold">{fmtMoney(r.salesFc, currency)}</Td>
                  <Td align="right" mono className={varianceClass(r.varToBudPct)}>{fmtPctSigned(r.varToBudPct)}</Td>
                  <Td align="right" mono className={varianceClass(r.lflGrowthPct)}>{fmtPctSigned(r.lflGrowthPct)}</Td>
                  <Td align="right" mono>{fmtPct(r.gpPctFc)}</Td>
                  <Td align="right" mono className={varianceClass(r.gpGapPp)}>{fmtPp(r.gpGapPp)}</Td>
                  <Td align="right" mono>{fmtMoneyExact(r.aspFc, currency)}</Td>
                  <Td align="right" mono>{fmtNum(r.optTotal)}</Td>
                  <Td align="right" mono>{fmtPct(r.mixPct)}</Td>
                  <Td align="right">
                    <Link href={`/planning/mfp/${toPathSegment(department)}/${toPathSegment(r.class ?? "")}`}>
                      <ChevronRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                    </Link>
                  </Td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50">
                <Td />
                <Td>{department} total</Td>
                <Td />
                <Td align="right" mono>{fmtMoney(t.salesBud, currency)}</Td>
                <Td align="right" mono>{fmtMoney(t.salesFc, currency)}</Td>
                <Td align="right" mono className={varianceClass(t.varToBudPct)}>{fmtPctSigned(t.varToBudPct)}</Td>
                <Td align="right" mono className={varianceClass(t.lflGrowthPct)}>{fmtPctSigned(t.lflGrowthPct)}</Td>
                <Td align="right" mono>{fmtPct(t.gpPctFc)}</Td>
                <Td align="right" mono className={varianceClass(t.gpGapPp)}>{fmtPp(t.gpGapPp)}</Td>
                <Td align="right" mono>{fmtMoneyExact(t.aspFc, currency)}</Td>
                <Td align="right" mono>{fmtNum(t.optTotal)}</Td>
                <Td align="right" mono>100.0%</Td>
                <Td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
