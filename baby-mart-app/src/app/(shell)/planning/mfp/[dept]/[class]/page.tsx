"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Lightbulb, TableProperties } from "lucide-react";import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle, StrategyPill, BuyStatusPill,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtMoneyExact, fmtPct, fmtPctSigned, fmtPp, fmtNum, varianceClass,
  type Currency,
} from "../../../_components/ui";
import { SettingTip, ColumnLegend, COVER_COLUMNS, MFP_COLUMNS } from "../../../_components/settingTip";
import { toPathSegment, fromPathSegment } from "@/lib/class-slug";
import {
  usePlanningData, type MfpRow, type TrendPoint, type PurchaseOrder,
} from "../../../_components/usePlanning";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Week = {
  periodCode: string;
  weekLabel: string;
  weekEnding: string;
  openingStock: number;
  sales: number;
  receipts: number;
  markdown: number;
  closingStock: number;
  onOrder: number;
  otbAvailable: number;
  coverWeeks: number;
  targetCoverWeeks: number;
  buyStatus: string;
};

type Response = {
  currency: Currency;
  department: string;
  class: string;
  total: MfpRow;
  buyPosition: BuyPosition | null;
  trend: TrendPoint[];
  weeks: Week[];
  purchaseOrders: PurchaseOrder[];
};

/** Headline buy position for the class, read from VW_OTB_SUMMARY so it matches
 *  the OTB pages exactly. `coverWeeks` is stock only; `totalCoverWeeks` adds
 *  on-order stock and is what `buyStatus` is derived from. */
type BuyPosition = {
  buyStatus: string;
  coverWeeks: number;
  totalCoverWeeks: number;
  targetCoverWeeks: number;
  /** The bands that produced buyStatus, from the same view. Read from the API
   *  rather than restated here: this page used to carry its own copy of 1.6 and
   *  0.6, making a third place the rule had to be kept in sync. */
  overbuyMult: number;
  underbuyMult: number;
  otbAvailable: number;
};

type Tab = "weekly" | "periods" | "orders";

const PO_STATUS_STYLE: Record<string, string> = {
  DELAYED: "text-red-700 bg-red-100",
  IN_TRANSIT: "text-blue-700 bg-blue-100",
  CONFIRMED: "text-slate-600 bg-slate-100",
  RECEIVED: "text-emerald-800 bg-emerald-100",
};

export default function MfpClassPage() {
  const params = useParams();
  const department = fromPathSegment(params.dept as string);
  const klass = fromPathSegment(params.class as string);
  const [currency, setCurrency] = useState<Currency>("PHP");
  const [tab, setTab] = useState<Tab>("weekly");

  const { data, error, loading } = usePlanningData<Response>(
    `mfp/${toPathSegment(department)}/${toPathSegment(klass)}`,
    currency
  );

  const backHref = `/planning/mfp/${toPathSegment(department)}`;

  if (loading) return <Loading what={klass} />;
  if (error) return <ErrorState message={error} backHref={backHref} backLabel={department} />;
  if (!data?.total)
    return <ErrorState message={`No plan for ${klass}.`} backHref={backHref} backLabel={department} />;

  const t = data.total;
  // Buy position comes from VW_OTB_SUMMARY via the API, which is the same source
  // the OTB pages and the exception engine read. Deriving it from the last row
  // of data.weeks instead gave a different cover figure under the same label.
  const bp = data.buyPosition;

  const tabClass = (x: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 cursor-pointer ${
      tab === x
        ? "border-violet-600 text-violet-800 bg-violet-50"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="p-6">
      <Breadcrumb
        trail={[
          { label: "Global Planning", href: "/planning" },
          { label: "MFP", href: "/planning/mfp" },
          { label: department, href: backHref },
          { label: klass },
        ]}
      />
      <PageHeader
        title={`${t.classCode} · ${klass}`}
        subtitle={`${department} · F27 H1 plan and weekly buy position`}
        right={
          <>
            {/* The weekly grid is where a planner actually edits this class, so
                it belongs next to the class it edits rather than only in the
                left-hand navigation.

                It opens on H2 DELIBERATELY, and says so, because that is the
                IN_FLIGHT half (PD01-PD06, Jul-Dec 26) where actuals exist and
                where the scenario overlays are built. This page reports F27 H1,
                the forward PLAN half (PD07-PD12), so the button changes half --
                unlabelled, that silently lands you on different months than the
                page you left. The grid's own H2/H1 toggle switches back. */}
            <Link
              href={`/planning/grid/${toPathSegment(department)}/${toPathSegment(klass)}?half=H2`}
              title="Open the editable weekly grid for the in-flight half, F27 H2 (Jul–Dec 26)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <TableProperties className="w-3.5 h-3.5" /> Weekly grid · H2
            </Link>
            <Link
              href={`/planning/insights?level=CLASS&node=${encodeURIComponent(klass)}`}
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
        <KpiCard label="POS Margin" value={fmtPct(t.gpPctFc)}
          sub={`${fmtPp(t.gpGapPp)} vs budget`} subClass={varianceClass(t.gpGapPp)} />
        <KpiCard label="ASP" value={fmtMoneyExact(t.aspFc, currency)}
          sub={`LY ${fmtMoneyExact(t.aspLy, currency)}`} />
        <KpiCard
          label={<>Stock Cover <SettingTip settingKeys={["BUY_OVERBUY_MULT", "BUY_UNDERBUY_MULT"]}
            extra={bp ? [{ label: "This class's target", value: `${bp.targetCoverWeeks.toFixed(1)}w` }] : undefined} /></>}
          value={bp ? `${bp.coverWeeks.toFixed(1)}w` : "–"}
          sub={bp
            ? `Target ${bp.targetCoverWeeks.toFixed(1)}w · ${bp.totalCoverWeeks.toFixed(1)}w incl. on order`
            : undefined}
          subClass={
            bp && bp.totalCoverWeeks > bp.targetCoverWeeks * bp.overbuyMult
              ? "text-amber-700"
              : bp && bp.totalCoverWeeks < bp.targetCoverWeeks * bp.underbuyMult
              ? "text-red-600"
              : "text-slate-500"
          } />
        <KpiCard
          label={<>Open-to-Buy <SettingTip settingKeys={["OTB_PLANNED_FACTOR"]} align="right" /></>}
          value={bp ? fmtMoney(bp.otbAvailable, currency) : "–"}
          sub={bp && bp.otbAvailable < 0 ? "Already overcommitted" : "Available to spend"}
          subClass={bp && bp.otbAvailable < 0 ? "text-amber-700" : "text-slate-500"} />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <StrategyPill strategy={t.lflStrategy} />
        <span className="text-xs text-slate-500">
          {t.lflStrategy === "D"
            ? "Planned decline — judge performance against budget, not against last year"
            : "Growth class"}
        </span>
        {bp && <BuyStatusPill status={bp.buyStatus} />}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        <button className={tabClass("weekly")} onClick={() => setTab("weekly")}>Weekly Buy Position</button>
        <button className={tabClass("periods")} onClick={() => setTab("periods")}>Period Plan</button>
        <button className={tabClass("orders")} onClick={() => setTab("orders")}>
          Purchase Orders ({data.purchaseOrders.length})
        </button>
      </div>

      <div className="bg-white rounded-b-xl rounded-tr-xl p-5 border border-t-0 border-slate-200 shadow-sm mb-6">
        {tab === "weekly" && (
          <>
            <Plot
              data={[
                {
                  x: data.weeks.map((w) => w.weekEnding), y: data.weeks.map((w) => w.closingStock),
                  type: "scatter", mode: "lines", name: "Closing stock", fill: "tozeroy",
                  line: { color: "#a78bfa", width: 2 }, fillcolor: "rgba(167,139,250,0.15)",
                },
                {
                  x: data.weeks.map((w) => w.weekEnding), y: data.weeks.map((w) => w.sales),
                  type: "bar", name: "Sales", marker: { color: "#6d28d9" },
                },
                {
                  x: data.weeks.map((w) => w.weekEnding), y: data.weeks.map((w) => w.receipts),
                  type: "bar", name: "Receipts", marker: { color: "#34d399" },
                },
                {
                  x: data.weeks.map((w) => w.weekEnding), y: data.weeks.map((w) => w.coverWeeks),
                  type: "scatter", mode: "lines", name: "Cover (weeks)", yaxis: "y2",
                  line: { color: "#f59e0b", width: 2, dash: "dot" },
                },
              ]}
              layout={{
                height: 320, margin: { l: 60, r: 55, t: 10, b: 50 },
                font: { family: "Inter, system-ui, sans-serif", size: 11 },
                barmode: "group", showlegend: true, legend: { orientation: "h", y: -0.22 },
                yaxis: { title: { text: currency }, gridcolor: "#f1f5f9" },
                // rangemode "tozero" so cover is read against a true zero.
                // Plotly's autorange started this axis near the lowest cover in
                // the series (about 5w), which made a routine seasonal decline
                // look like a cliff -- the same data reads as a gentle slope
                // once the baseline is honest.
                yaxis2: {
                  title: { text: "Weeks" }, overlaying: "y", side: "right",
                  showgrid: false, rangemode: "tozero",
                },
                xaxis: { type: "date", tickformat: "%d %b", gridcolor: "#f8fafc", automargin: true },
                plot_bgcolor: "white", paper_bgcolor: "white",
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <Th>Week Ending</Th>
                    <Th>Period</Th>
                    <Th align="right">Opening</Th>
                    <Th align="right">Sales</Th>
                    <Th align="right">Receipts</Th>
                    <Th align="right">Markdown</Th>
                    <Th align="right">Closing</Th>
                    <Th align="right">On Order</Th>
                    <Th align="right">
                      Wk cover <SettingTip settingKeys={["BUY_OVERBUY_MULT", "BUY_UNDERBUY_MULT"]} align="right" />
                    </Th>
                    <Th align="right">OTB</Th>
                    <Th align="center">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.weekEnding} className="border-b border-slate-50 hover:bg-slate-50">
                      <Td mono className="text-xs">{w.weekEnding}</Td>
                      <Td mono className="text-xs text-slate-400">{w.periodCode} {w.weekLabel}</Td>
                      <Td align="right" mono>{fmtMoney(w.openingStock, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(w.sales, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(w.receipts, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(w.markdown, currency)}</Td>
                      <Td align="right" mono className="font-semibold">{fmtMoney(w.closingStock, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(w.onOrder, currency)}</Td>
                      <Td align="right" mono>{w.coverWeeks.toFixed(1)}w</Td>
                      <Td align="right" mono className={w.otbAvailable < 0 ? "text-amber-700" : ""}>
                        {fmtMoney(w.otbAvailable, currency)}
                      </Td>
                      <Td align="center"><BuyStatusPill status={w.buyStatus} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* The three cover metrics on this page use three different
                denominators, so the guide is the only place that difference is
                stated in full. */}
            <ColumnLegend columns={COVER_COLUMNS} title="Cover and buy-position columns" />
          </>
        )}

        {tab === "periods" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <Th>Period</Th>
                  <Th>Month</Th>
                  <Th align="center">Type</Th>
                  <Th align="right">Last Year</Th>
                  <Th align="right">Budget</Th>
                  <Th align="right">Merch Plan</Th>
                  <Th align="right">Forecast</Th>
                  <Th align="right">Var to Bud</Th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((p) => {
                  const varPct = p.salesBud > 0 ? ((p.salesFc - p.salesBud) / p.salesBud) * 100 : null;
                  return (
                    <tr key={p.periodCode} className="border-b border-slate-50 hover:bg-slate-50">
                      <Td mono className="text-xs text-slate-400">{p.periodCode}</Td>
                      <Td>{p.month}</Td>
                      <Td align="center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          p.periodType === "PLAN" ? "text-violet-800 bg-violet-100" : "text-slate-600 bg-slate-100"
                        }`}>
                          {p.periodType}
                        </span>
                      </Td>
                      <Td align="right" mono>{fmtMoney(p.salesLy, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(p.salesBud, currency)}</Td>
                      <Td align="right" mono>{fmtMoney(p.salesMrch, currency)}</Td>
                      <Td align="right" mono className="font-semibold">{fmtMoney(p.salesFc, currency)}</Td>
                      <Td align="right" mono className={varianceClass(varPct)}>{fmtPctSigned(varPct)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ColumnLegend columns={MFP_COLUMNS} title="Plan version columns" />
          </div>
        )}

        {tab === "orders" && (
          data.purchaseOrders.length === 0 ? (
            <p className="text-sm text-slate-500">No supplier commitments for this class.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <Th>PO</Th>
                    <Th>Supplier</Th>
                    <Th>Origin</Th>
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
                  {data.purchaseOrders.map((po) => (
                    <tr key={po.poNumber} className="border-b border-slate-50 hover:bg-slate-50">
                      <Td mono className="text-xs">{po.poNumber}</Td>
                      <Td>{po.supplierName}</Td>
                      <Td className="text-slate-500 text-xs">{po.sourcingCountry}</Td>
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
          )
        )}
      </div>
    </div>
  );
}
