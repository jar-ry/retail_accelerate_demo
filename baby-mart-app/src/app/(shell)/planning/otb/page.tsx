"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle, BuyStatusPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtNum, type Currency,
} from "../_components/ui";
import { SettingTip, ColumnLegend, COVER_COLUMNS } from "../_components/settingTip";
import { toPathSegment } from "@/lib/class-slug";
import { usePlanningData, type OtbRow, type OtbWeek } from "../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Response = {
  currency: Currency;
  departments: OtbRow[];
  classes: OtbRow[];
  trend: OtbWeek[];
};

type Filter = "ALL" | "OVERBUY" | "UNDERBUY";

export default function OtbPage() {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [filter, setFilter] = useState<Filter>("ALL");
  const { data, error, loading } = usePlanningData<Response>("otb", currency);

  if (loading) return <Loading what="open-to-buy position" />;
  if (error) return <ErrorState message={error} backHref="/planning" backLabel="Planning dashboard" />;
  if (!data) return <ErrorState message="No OTB data returned." backHref="/planning" />;

  const classes = filter === "ALL" ? data.classes : data.classes.filter((c) => c.buyStatus === filter);

  const totals = data.departments.reduce(
    (a, d) => ({
      stock: a.stock + d.stock,
      onOrder: a.onOrder + d.onOrder,
      otb: a.otb + d.otbAvailable,
      sales: a.sales + d.horizonSales,
      markdown: a.markdown + d.horizonMarkdown,
    }),
    { stock: 0, onOrder: 0, otb: 0, sales: 0, markdown: 0 }
  );

  const overbuy = data.classes.filter((c) => c.buyStatus === "OVERBUY").length;
  const underbuy = data.classes.filter((c) => c.buyStatus === "UNDERBUY").length;

  const filterClass = (f: Filter) =>
    `px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
      filter === f ? "bg-violet-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Open-to-Buy (WISSI)" }]} />
      <PageHeader
        title="Open-to-Buy Position"
        subtitle="BABY MART · F27 H1 · stock, commitments and remaining buying capacity"
        right={<CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />}
      />

      <div className="grid grid-cols-6 gap-3 mb-6">
        <KpiCard label="Stock on Hand" value={fmtMoney(totals.stock, currency)} />
        <KpiCard label="On Order" value={fmtMoney(totals.onOrder, currency)} sub="Already committed" />
        <KpiCard label="Open-to-Buy" value={fmtMoney(totals.otb, currency)}
          sub={totals.otb < 0 ? "Overbought overall" : "Headroom to buy"}
          subClass={totals.otb < 0 ? "text-amber-700" : "text-emerald-700"} />
        <KpiCard label="Horizon Sales" value={fmtMoney(totals.sales, currency)} sub="Jan–Jun plan" />
        <KpiCard label="Markdown" value={fmtMoney(totals.markdown, currency)}
          sub={`${((totals.markdown / (totals.sales || 1)) * 100).toFixed(1)}% of sales`} />
        <KpiCard label="Exceptions" value={`${overbuy + underbuy}`}
          sub={`${overbuy} overbuy · ${underbuy} underbuy`}
          subClass={overbuy + underbuy > 0 ? "text-amber-700" : "text-slate-500"} />
      </div>

      <Card
        title="Stock, receipts and cover across the plan horizon"
        subtitle="Closing stock is a running roll of opening stock plus receipts less sales and markdown"
        className="mb-6"
      >
        <Plot
          data={[
            {
              x: data.trend.map((w) => w.weekEnding), y: data.trend.map((w) => w.closingStock),
              type: "scatter", mode: "lines", name: "Closing stock", fill: "tozeroy",
              line: { color: "#a78bfa", width: 2 }, fillcolor: "rgba(167,139,250,0.15)",
            },
            {
              x: data.trend.map((w) => w.weekEnding), y: data.trend.map((w) => w.sales),
              type: "bar", name: "Sales", marker: { color: "#6d28d9" },
            },
            {
              x: data.trend.map((w) => w.weekEnding), y: data.trend.map((w) => w.receipts),
              type: "bar", name: "Receipts", marker: { color: "#34d399" },
            },
            {
              x: data.trend.map((w) => w.weekEnding), y: data.trend.map((w) => w.coverWeeks),
              type: "scatter", mode: "lines", name: "Cover (weeks)", yaxis: "y2",
              line: { color: "#f59e0b", width: 2, dash: "dot" },
            },
          ]}
          layout={{
            height: 320, margin: { l: 60, r: 55, t: 10, b: 50 },
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            barmode: "group", showlegend: true, legend: { orientation: "h", y: -0.2 },
            yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
            // rangemode "tozero": a cover axis that starts above zero
            // exaggerates every movement on it. See the note on the class page.
            yaxis2: {
              title: { text: "Weeks" }, overlaying: "y", side: "right",
              showgrid: false, rangemode: "tozero",
            },
            // Date-typed axis: with 24 weekly points Plotly thins the ticks and
            // formats them as "07 Jan" instead of printing every raw label.
            xaxis: { type: "date", tickformat: "%d %b", gridcolor: "#f8fafc", automargin: true },
            plot_bgcolor: "white", paper_bgcolor: "white",
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </Card>

      <Card title="Departments" subtitle="Buy position by department" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Dept</Th>
                <Th>Department</Th>
                <Th align="right">Stock</Th>
                <Th align="right">On Order</Th>
                <Th align="right">Cover</Th>
                <Th align="right">Target</Th>
                <Th align="right">Open-to-Buy</Th>
                <Th align="right">Horizon Sales</Th>
                <Th align="center">Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.departments.map((d) => (
                <tr key={d.departmentCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td mono className="text-slate-400 text-xs">{d.departmentCode}</Td>
                  <Td>
                    <Link
                      href={`/planning/otb/${toPathSegment(d.department ?? "")}`}
                      className="font-medium text-slate-900 hover:text-violet-700"
                    >
                      {d.department}
                    </Link>
                  </Td>
                  <Td align="right" mono>{fmtMoney(d.stock, currency)}</Td>
                  <Td align="right" mono>{fmtMoney(d.onOrder, currency)}</Td>
                  <Td align="right" mono className="font-semibold">{d.coverWeeks.toFixed(1)}w</Td>
                  <Td align="right" mono className="text-slate-500">{d.targetCoverWeeks.toFixed(1)}w</Td>
                  <Td align="right" mono className={d.otbAvailable < 0 ? "text-amber-700 font-semibold" : ""}>
                    {fmtMoney(d.otbAvailable, currency)}
                  </Td>
                  <Td align="right" mono>{fmtMoney(d.horizonSales, currency)}</Td>
                  <Td align="center"><BuyStatusPill status={d.buyStatus} /></Td>
                  <Td align="right">
                    <Link href={`/planning/otb/${toPathSegment(d.department ?? "")}`}>
                      <ChevronRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Classes by cover"
        subtitle="Highest cover first — the overbought end of the range needs action first"
        right={
          <div className="flex gap-1.5">
            <button className={filterClass("ALL")} onClick={() => setFilter("ALL")}>All ({data.classes.length})</button>
            <button className={filterClass("OVERBUY")} onClick={() => setFilter("OVERBUY")}>Overbuy ({overbuy})</button>
            <button className={filterClass("UNDERBUY")} onClick={() => setFilter("UNDERBUY")}>Underbuy ({underbuy})</button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Class</Th>
                <Th>Department</Th>
                <Th align="right">Stock</Th>
                <Th align="right">Units</Th>
                <Th align="right">On Order</Th>
                <Th align="right">Cover</Th>
                <Th align="right">Target</Th>
                <Th align="right">Gap</Th>
                <Th align="right">Open-to-Buy</Th>
                <Th align="center">Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => {
                const gap = c.coverWeeks - c.targetCoverWeeks;
                return (
                  <tr key={c.classCode} className="border-b border-slate-50 hover:bg-slate-50">
                    <Td>
                      <Link
                        href={`/planning/mfp/${toPathSegment(c.department ?? "")}/${toPathSegment(c.class ?? "")}`}
                        className="font-medium text-slate-900 hover:text-violet-700"
                      >
                        {c.class}
                      </Link>
                    </Td>
                    <Td className="text-slate-500 text-xs">{c.department}</Td>
                    <Td align="right" mono>{fmtMoney(c.stock, currency)}</Td>
                    <Td align="right" mono>{fmtNum(c.stockUnits)}</Td>
                    <Td align="right" mono>{fmtMoney(c.onOrder, currency)}</Td>
                    <Td align="right" mono className="font-semibold">{c.coverWeeks.toFixed(1)}w</Td>
                    <Td align="right" mono className="text-slate-500">{c.targetCoverWeeks.toFixed(1)}w</Td>
                    <Td align="right" mono className={gap > 0 ? "text-amber-700" : "text-red-600"}>
                      {gap > 0 ? "+" : ""}{gap.toFixed(1)}w
                    </Td>
                    <Td align="right" mono className={c.otbAvailable < 0 ? "text-amber-700 font-semibold" : ""}>
                      {fmtMoney(c.otbAvailable, currency)}
                    </Td>
                    <Td align="center"><BuyStatusPill status={c.buyStatus} /></Td>
                    <Td align="right">
                      <Link href={`/planning/mfp/${toPathSegment(c.department ?? "")}/${toPathSegment(c.class ?? "")}`}>
                        <ChevronRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ColumnLegend columns={COVER_COLUMNS} title="Cover and buy-position columns" />
      </Card>
    </div>
  );
}
