"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtNum, type Currency,
} from "../_components/ui";
import { SettingTip } from "../_components/settingTip";
import { usePlanningData, type PurchaseOrder } from "../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type SupplierRow = {
  supplierName: string;
  sourcingCountry: string;
  poCount: number;
  delayedCount: number;
  avgSlipDays: number | null;
  committed: number;
};

type Response = {
  currency: Currency;
  purchaseOrders: PurchaseOrder[];
  suppliers: SupplierRow[];
};

const PO_STATUS_STYLE: Record<string, string> = {
  DELAYED: "text-red-700 bg-red-100",
  IN_TRANSIT: "text-blue-700 bg-blue-100",
  CONFIRMED: "text-slate-600 bg-slate-100",
  RECEIVED: "text-emerald-800 bg-emerald-100",
};

type Filter = "ALL" | "DELAYED";

export default function CommitmentsPage() {
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [filter, setFilter] = useState<Filter>("ALL");
  const { data, error, loading } = usePlanningData<Response>("commitments", currency);

  if (loading) return <Loading what="supplier commitments" />;
  if (error) return <ErrorState message={error} backHref="/planning" backLabel="Planning dashboard" />;
  if (!data) return <ErrorState message="No commitment data returned." backHref="/planning" />;

  const pos = filter === "ALL" ? data.purchaseOrders : data.purchaseOrders.filter((p) => p.status === "DELAYED");
  const delayed = data.purchaseOrders.filter((p) => p.status === "DELAYED");
  const totalCommitted = data.purchaseOrders.reduce((a, p) => a + p.committed, 0);
  const atRisk = delayed.reduce((a, p) => a + p.committed, 0);

  // Committed value by sourcing country, for the supply concentration view.
  const byCountry = new Map<string, number>();
  for (const s of data.suppliers) {
    byCountry.set(s.sourcingCountry, (byCountry.get(s.sourcingCountry) ?? 0) + s.committed);
  }

  const filterClass = (f: Filter) =>
    `px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
      filter === f ? "bg-violet-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Supplier Commitments" }]} />
      <PageHeader
        title="Supplier Commitments"
        subtitle="Forward purchase orders, ETA slippage and committed spend — future buying capacity"
        right={<CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />}
      />

      <div className="grid grid-cols-5 gap-3 mb-6">
        <KpiCard label="Total Committed" value={fmtMoney(totalCommitted, currency)}
          sub={`${data.purchaseOrders.length} purchase orders`} />
        <KpiCard label="Suppliers" value={String(data.suppliers.length)}
          sub={`${byCountry.size} sourcing countries`} />
        <KpiCard label="Delayed POs" value={String(delayed.length)}
          sub={`${((delayed.length / (data.purchaseOrders.length || 1)) * 100).toFixed(0)}% of orders`}
          subClass={delayed.length > 0 ? "text-red-600" : "text-slate-500"} />
        <KpiCard label="Value at Risk" value={fmtMoney(atRisk, currency)}
          sub="On delayed orders"
          subClass={atRisk > 0 ? "text-red-600" : "text-slate-500"} />
        <KpiCard label="Avg Slip"
          value={delayed.length > 0
            ? `${(delayed.reduce((a, p) => a + p.etaSlipDays, 0) / delayed.length).toFixed(0)}d`
            : "–"}
          sub="On delayed orders" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card title="Committed spend by supplier" subtitle="Delayed portion shown in red">
          <Plot
            data={[
              {
                y: data.suppliers.map((s) => s.supplierName),
                x: data.suppliers.map((s) => s.committed),
                type: "bar", orientation: "h", name: "Committed",
                marker: {
                  color: data.suppliers.map((s) => (s.delayedCount > 0 ? "#ef4444" : "#a78bfa")),
                },
                hovertemplate: "%{y}: %{x:,.0f}<extra></extra>",
              },
            ]}
            layout={{
              height: 340,
              // automargin on the y axis sizes the left gutter to the longest
              // supplier name. A fixed left margin let names like "Golden Bamboo
              // Manufacturing" run into the plot area.
              margin: { l: 8, r: 20, t: 10, b: 40 },
              font: { family: "Inter, system-ui, sans-serif", size: 10 },
              showlegend: false,
              xaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
              yaxis: { automargin: true, ticksuffix: "  " },
              plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Card>

        <Card title="Sourcing concentration" subtitle="Committed spend by country of origin">
          <Plot
            data={[
              {
                labels: Array.from(byCountry.keys()),
                values: Array.from(byCountry.values()),
                type: "pie", hole: 0.55,
                marker: { colors: ["#6d28d9", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#f5f3ff"] },
                // Inside labels and an explicit 1-decimal template. Outside
                // labels were clipped at both card edges ("hailand", "Chin"),
                // and Plotly's default percent formatting was inconsistent --
                // one slice rendered as 3.37% while the rest showed 1 decimal.
                textinfo: "label+percent",
                textposition: "inside",
                insidetextorientation: "horizontal",
                texttemplate: "%{label}<br>%{percent:.1%}",
                textfont: { size: 9 },
                hovertemplate: "%{label}: %{percent:.1%}<extra></extra>",
              },
            ]}
            layout={{
              height: 340, margin: { l: 10, r: 10, t: 10, b: 10 },
              font: { family: "Inter, system-ui, sans-serif", size: 10 },
              showlegend: false, plot_bgcolor: "white", paper_bgcolor: "white",
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Card>
      </div>

      <Card title="Suppliers" subtitle="Commitment and reliability by supplier" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Supplier</Th>
                <Th>Origin</Th>
                <Th align="right">POs</Th>
                <Th align="right">Delayed</Th>
                <Th align="right">On-Time %</Th>
                <Th align="right">Avg Slip</Th>
                <Th align="right">Committed</Th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.map((s) => {
                const onTime = ((s.poCount - s.delayedCount) / (s.poCount || 1)) * 100;
                return (
                  <tr key={s.supplierName} className="border-b border-slate-50 hover:bg-slate-50">
                    <Td className="font-medium">{s.supplierName}</Td>
                    <Td className="text-slate-500 text-xs">{s.sourcingCountry}</Td>
                    <Td align="right" mono>{s.poCount}</Td>
                    <Td align="right" mono className={s.delayedCount > 0 ? "text-red-600 font-semibold" : ""}>
                      {s.delayedCount || "–"}
                    </Td>
                    <Td align="right" mono className={onTime < 100 ? "text-red-600" : "text-emerald-700"}>
                      {onTime.toFixed(0)}%
                    </Td>
                    <Td align="right" mono className={s.avgSlipDays ? "text-red-600" : ""}>
                      {s.avgSlipDays ? `+${s.avgSlipDays.toFixed(0)}d` : "–"}
                    </Td>
                    <Td align="right" mono>{fmtMoney(s.committed, currency)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Purchase orders"
        subtitle="Forward commitments by expected arrival"
        right={
          <div className="flex gap-1.5">
            <button className={filterClass("ALL")} onClick={() => setFilter("ALL")}>
              All ({data.purchaseOrders.length})
            </button>
            <button className={filterClass("DELAYED")} onClick={() => setFilter("DELAYED")}>
              Delayed ({delayed.length})
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200">
                <Th>PO</Th>
                <Th>Supplier</Th>
                <Th>Origin</Th>
                <Th>Class</Th>
                <Th>Ordered</Th>
                <Th>Original ETA</Th>
                <Th>Current ETA</Th>
                <Th align="right">Slip</Th>
                <Th align="right">Units</Th>
                <Th align="right">Committed</Th>
                <Th align="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.poNumber} className="border-b border-slate-50 hover:bg-slate-50">
                  <Td mono className="text-xs">{po.poNumber}</Td>
                  <Td>{po.supplierName}</Td>
                  <Td className="text-slate-500 text-xs">{po.sourcingCountry}</Td>
                  <Td className="text-xs">{po.class}</Td>
                  <Td mono className="text-xs">{po.orderDate}</Td>
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
      </Card>
    </div>
  );
}
