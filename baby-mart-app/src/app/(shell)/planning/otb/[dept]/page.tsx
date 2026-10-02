"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronRight, Lightbulb } from "lucide-react";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle, BuyStatusPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtNum, type Currency,
} from "../../_components/ui";
import { SettingTip } from "../../_components/settingTip";
import { toPathSegment, fromPathSegment } from "@/lib/class-slug";
import {
  usePlanningData, type OtbRow, type OtbWeek, type PurchaseOrder,
} from "../../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Response = {
  currency: Currency;
  department: string;
  total: OtbRow;
  classes: OtbRow[];
  trend: OtbWeek[];
  purchaseOrders: PurchaseOrder[];
};

const PO_STATUS_STYLE: Record<string, string> = {
  DELAYED: "text-red-700 bg-red-100",
  IN_TRANSIT: "text-blue-700 bg-blue-100",
  CONFIRMED: "text-slate-600 bg-slate-100",
  RECEIVED: "text-emerald-800 bg-emerald-100",
};

export default function OtbDepartmentPage() {
  const params = useParams();
  const department = fromPathSegment(params.dept as string);
  const [currency, setCurrency] = useState<Currency>("PHP");
  const { data, error, loading } = usePlanningData<Response>(
    `otb/${toPathSegment(department)}`,
    currency
  );

  if (loading) return <Loading what={`${department} buy position`} />;
  if (error) return <ErrorState message={error} backHref="/planning/otb" backLabel="Open-to-Buy" />;
  if (!data?.total)
    return <ErrorState message={`No OTB position for ${department}.`} backHref="/planning/otb" backLabel="Open-to-Buy" />;

  const t = data.total;
  const delayed = data.purchaseOrders.filter((p) => p.status === "DELAYED");

  return (
    <div className="p-6">
      <Breadcrumb
        trail={[
          { label: "Global Planning", href: "/planning" },
          { label: "Open-to-Buy", href: "/planning/otb" },
          { label: department },
        ]}
      />
      <PageHeader
        title={`${t.departmentCode} · ${department}`}
        subtitle={`Buy position as at ${t.asAtWeek ?? "–"} · F27 H1 horizon`}
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
        <KpiCard label="Stock on Hand" value={fmtMoney(t.stock, currency)} sub={`${fmtNum(t.stockUnits)} units`} />
        <KpiCard label="On Order" value={fmtMoney(t.onOrder, currency)} sub={`${fmtNum(t.onOrderUnits)} units`} />
        <KpiCard label="Forward Cover" value={`${t.coverWeeks.toFixed(1)}w`}
          sub={`Target ${t.targetCoverWeeks.toFixed(1)}w`}
          subClass={
            t.coverWeeks > t.targetCoverWeeks * 1.6 ? "text-amber-700"
            : t.coverWeeks < t.targetCoverWeeks * 0.5 ? "text-red-600"
            : "text-slate-500"
          } />
        <KpiCard label="Open-to-Buy" value={fmtMoney(t.otbAvailable, currency)}
          sub={t.buyStatus}
          subClass={t.otbAvailable < 0 ? "text-amber-700" : "text-emerald-700"} />
        <KpiCard label="Committed" value={fmtMoney(data.purchaseOrders.reduce((a, p) => a + p.committed, 0), currency)}
          sub={`${data.purchaseOrders.length} POs`} />
        <KpiCard label="Delayed POs" value={String(delayed.length)}
          sub={delayed.length > 0 ? `${fmtMoney(delayed.reduce((a, p) => a + p.committed, 0), currency)} at risk` : "None"}
          subClass={delayed.length > 0 ? "text-red-600" : "text-slate-500"} />
      </div>

      <Card
        title="Weekly stock flow"
        subtitle="Sales, receipts and the resulting stock position across the plan horizon"
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
              x: data.trend.map((w) => w.weekEnding), y: data.trend.map((w) => w.markdown),
              type: "bar", name: "Markdown", marker: { color: "#fca5a5" },
            },
          ]}
          layout={{
            height: 300, margin: { l: 60, r: 20, t: 10, b: 50 },
            font: { family: "Inter, system-ui, sans-serif", size: 11 },
            barmode: "group", showlegend: true, legend: { orientation: "h", y: -0.22 },
            yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
            xaxis: { type: "date", tickformat: "%d %b", gridcolor: "#f8fafc", automargin: true },
            plot_bgcolor: "white", paper_bgcolor: "white",
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </Card>

      <Card title="Classes" subtitle="Buy position by class" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Class</Th>
                <Th align="right">Stock</Th>
                <Th align="right">Units</Th>
                <Th align="right">On Order</Th>
                <Th align="right">Cover</Th>
                <Th align="right">Target</Th>
                <Th align="right">Open-to-Buy</Th>
                <Th align="right">Markdown</Th>
                <Th align="center">Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.classes.map((c) => (
                <tr key={c.classCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td>
                    <Link
                      href={`/planning/mfp/${toPathSegment(department)}/${toPathSegment(c.class ?? "")}`}
                      className="font-medium text-slate-900 hover:text-violet-700"
                    >
                      {c.class}
                    </Link>
                  </Td>
                  <Td align="right" mono>{fmtMoney(c.stock, currency)}</Td>
                  <Td align="right" mono>{fmtNum(c.stockUnits)}</Td>
                  <Td align="right" mono>{fmtMoney(c.onOrder, currency)}</Td>
                  <Td align="right" mono className="font-semibold">{c.coverWeeks.toFixed(1)}w</Td>
                  <Td align="right" mono className="text-slate-500">{c.targetCoverWeeks.toFixed(1)}w</Td>
                  <Td align="right" mono className={c.otbAvailable < 0 ? "text-amber-700 font-semibold" : ""}>
                    {fmtMoney(c.otbAvailable, currency)}
                  </Td>
                  <Td align="right" mono>{fmtMoney(c.horizonMarkdown, currency)}</Td>
                  <Td align="center"><BuyStatusPill status={c.buyStatus} /></Td>
                  <Td align="right">
                    <Link href={`/planning/mfp/${toPathSegment(department)}/${toPathSegment(c.class ?? "")}`}>
                      <ChevronRight className="w-4 h-4 text-slate-300 hover:text-violet-600" />
                    </Link>
                  </Td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50">
                <Td>{department} total</Td>
                <Td align="right" mono>{fmtMoney(t.stock, currency)}</Td>
                <Td align="right" mono>{fmtNum(t.stockUnits)}</Td>
                <Td align="right" mono>{fmtMoney(t.onOrder, currency)}</Td>
                <Td align="right" mono>{t.coverWeeks.toFixed(1)}w</Td>
                <Td align="right" mono>{t.targetCoverWeeks.toFixed(1)}w</Td>
                <Td align="right" mono>{fmtMoney(t.otbAvailable, currency)}</Td>
                <Td align="right" mono>{fmtMoney(t.horizonMarkdown, currency)}</Td>
                <Td align="center"><BuyStatusPill status={t.buyStatus} /></Td>
                <Td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Supplier commitments"
        subtitle={`${data.purchaseOrders.length} purchase orders · ${delayed.length} delayed`}
      >
        {data.purchaseOrders.length === 0 ? (
          <p className="text-sm text-slate-500">No supplier commitments for this department.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <Th>PO</Th>
                  <Th>Supplier</Th>
                  <Th>Origin</Th>
                  <Th>Class</Th>
                  <Th>Original ETA</Th>
                  <Th>Current ETA</Th>
                  <Th align="right">Slip</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Committed</Th>
                  <Th align="center">Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.purchaseOrders.map((po) => (
                  <tr key={po.poNumber} className="border-b border-slate-50 hover:bg-slate-50">
                    <Td mono className="text-xs">{po.poNumber}</Td>
                    <Td>{po.supplierName}</Td>
                    <Td className="text-slate-500 text-xs">{po.sourcingCountry}</Td>
                    <Td className="text-xs">{po.class}</Td>
                    <Td mono className="text-xs text-slate-400">{po.originalEtaDate}</Td>
                    <Td mono className="text-xs">{po.etaDate}</Td>
                    <Td align="right" mono className={po.etaSlipDays > 0 ? "text-red-600 font-semibold" : ""}>
                      {po.etaSlipDays > 0 ? `+${po.etaSlipDays}d` : "–"}
                    </Td>
                    <Td align="right" mono>{fmtNum(po.committedUnits)}</Td>
                    <Td align="right" mono>{fmtMoney(po.committed, currency)}</Td>
                    <Td align="center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        PO_STATUS_STYLE[po.status] ?? "text-slate-600 bg-slate-100"
                      }`}>
                        {po.status.replace("_", " ")}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
