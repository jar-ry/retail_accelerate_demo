"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  RotateCcw, Sparkles, Trash2, CheckCircle2, XCircle, PencilLine,
  Loader2, Grid3x3, Brain, AlertTriangle,
} from "lucide-react";
import {
  Breadcrumb, PageHeader, KpiCard, Card, CurrencyToggle,
  Loading, ErrorState, Th, Td,
  fmtMoney, fmtPct, fmtPctSigned, fmtNum, fmtPp, varianceClass,
  type Currency,
} from "../_components/ui";
import { SettingTip, ColumnLegend, SCENARIO_COLUMNS } from "../_components/settingTip";
import { toPathSegment } from "@/lib/class-slug";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

/** A signed ASP movement to two decimals.
 *  Deliberately not fmtMoney: ASP moves are per-unit and often smaller than a
 *  peso, and whole-peso rounding turns a real +0.04 shift into a flat "0". */
function fmtAspDelta(d: number): string {
  if (!isFinite(d) || Math.abs(d) < 0.005) return "flat";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
}


// ─── Scenario planning ────────────────────────────────────────────────────────
//
// Three tabs, mapping onto the SIMULATE SCENARIOS narrative:
//
//   Prompt       step 1 and step 2 -- range rationalisation and goal seek, driven
//                by a sentence rather than by sliders
//   Sandbox      step 3 -- every draft option side by side on sales, GP and STOCK
//   Decisioning  the AI recommendation, then the human accept / reject / modify
//
// The lever sliders that used to sit here have been removed deliberately. They
// answered a different and much weaker question: a uniform percentage applied to
// every class at once, which no planner would actually commit to. The prompt path
// names the specific options it is changing and shows its arithmetic, so it is
// both more useful and more defensible. History and audit live on their own page.
//
// The three legs of the comparison are given equal weight on purpose. A scenario
// that buys gross profit with a large stock increase is not obviously better than
// one that releases stock, and a comparison showing only sales and GP would make
// the range-increment option look free.

// ─── Sandbox model ────────────────────────────────────────────────────────────

type ScenarioOption = {
  optionId: string | null;
  label: string;
  class: string | null;
  action: string;
  transferPct: number | null;
  salesDelta: number;
  unitsDelta: number;
  gpDelta: number;
  stockDelta: number;
  rank: number | null;
  gpPerWeek: number | null;
  coverWeeks: number | null;
};

type Decision = {
  decisionId: string;
  aiRecommendation: string | null;
  aiRationale: string | null;
  aiConfidence: string | null;
  humanDecision: string | null;
  humanRationale: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  agreedWithAi: boolean | null;
  resultingVersionId: string | null;
};

type Scenario = {
  scenarioId: string;
  name: string;
  type: string;
  parentId: string | null;
  siblingLabel: string | null;
  prompt: string | null;
  department: string | null;
  class: string | null;
  half: string | null;
  status: string;
  handEdits: number;
  narrative: string | null;
  assumptions: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string | null;
  baseSales: number;
  scenarioSales: number;
  salesDelta: number;
  salesDeltaPct: number | null;
  baseUnits: number;
  scenarioUnits: number;
  unitsDelta: number;
  baseGp: number;
  scenarioGp: number;
  gpDelta: number;
  gpDeltaPct: number | null;
  baseAsp: number;
  scenarioAsp: number;
  baseGpPct: number | null;
  scenarioGpPct: number | null;
  gpPctDeltaPp: number | null;
  stockDelta: number;
  optionsDropped: number;
  optionsAdded: number;
  optionsRepriced: number;
  editedCells: number;
  options: ScenarioOption[];
  decision: Decision | null;
};

// The worked examples all sit inside PRAMS & STROLLERS, the department the AI
// assessment flags at -10.7% to budget, so the demo narrative stays in one place:
// the assessment names the department, the MFP pages decompose it, and these
// scenarios act on its classes.
//
// TRAVEL SYSTEM leads because it is the most defensible range cut in the plan --
// 20.1 weeks cover against an 8.8 target, 12% behind budget, and already on a
// planned-decline strategy, so the sales given up were sales the plan intended to
// give up. A quarter of the range rather than a tenth: at 11 weeks over target a
// 10% trim releases almost nothing.
const EXAMPLES = [
  "rationalise the bottom 25% of TRAVEL SYSTEM SKUs",
  "we need to find another 500k of GP in H2 for SINGLE STROLLER, give me options",
  "rationalise the bottom 15% of OUTERWEAR options in H2",
];

const TABS = [
  { id: "prompt", label: "Prompt", icon: Sparkles },
  { id: "sandbox", label: "Sandbox", icon: Grid3x3 },
  { id: "decisioning", label: "Decisioning", icon: Brain },
] as const;

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-slate-700 bg-slate-100",
  SUBMITTED: "text-sky-800 bg-sky-100",
  APPROVED: "text-emerald-800 bg-emerald-100",
  REJECTED: "text-red-700 bg-red-100",
};

const REC_STYLE: Record<string, string> = {
  ACCEPT: "text-emerald-800 bg-emerald-100",
  REJECT: "text-red-700 bg-red-100",
  MODIFY: "text-amber-800 bg-amber-100",
};

export default function ScenariosPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("prompt");
  const [currency, setCurrency] = useState<Currency>("PHP");

  // ─── Sandbox data ───────────────────────────────────────────────────────
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const loadScenarios = useCallback(() => {
    setListLoading(true);
    fetch(`/api/planning/scenarios?currency=${currency}`)
      .then((r) => r.json())
      .then((b) => {
        if (b?.error) setListError(String(b.error));
        else {
          setScenarios(b.scenarios ?? []);
          setListError(null);
        }
      })
      .catch((e: unknown) => setListError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setListLoading(false));
  }, [currency]);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  // ─── Prompt ─────────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null);
  const [newIds, setNewIds] = useState<string[]>([]);

  const runPrompt = async (text: string) => {
    const p = text.trim();
    if (!p) return;
    setRunning(true);
    setPromptError(null);
    setParsed(null);
    try {
      const res = await fetch("/api/planning/scenario/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, createdBy: "Wensi Cai" }),
      });
      const b = await res.json();
      setParsed((b.parsed as Record<string, unknown>) ?? null);
      if (b.error || b.ok !== true) {
        setPromptError(String(b.error ?? "Could not build that scenario"));
      } else {
        const ids: string[] = b.options
          ? (b.options as string[])
          : b.scenario_id
          ? [String(b.scenario_id)]
          : [];
        setNewIds(ids);
        loadScenarios();
        setTab("sandbox");
      }
    } catch (e: unknown) {
      setPromptError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  // ─── Actions ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    try {
      await fetch(`/api/planning/scenario/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      loadScenarios();
    } finally {
      setBusy(null);
    }
  };

  // A GOAL_SEEK row is only the CONTAINER for its 2a / 2b siblings. It holds no
  // cells of its own, so it has no impact to cost and must never appear in a
  // comparison -- it was being counted in the tab badge while correctly being
  // left out of the table, so the badge disagreed with the list beneath it.
  const costed = scenarios.filter((s) => s.type !== "GOAL_SEEK");

  // Decided scenarios STAY VISIBLE. Filtering the sandbox down to drafts hid
  // every approved and rejected scenario, so the moment you accepted one the
  // page forgot it existed and there was nothing left to compare the current
  // plan against. Each row carries its own status pill, and the approved one is
  // already protected from the discard button.
  const drafts = costed.filter((s) => s.status === "DRAFT" || s.status === "SUBMITTED");

  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Scenario Planning" }]} />
      <PageHeader
        title="Scenario Planning"
        subtitle="Model range and price changes in a sandbox. The approved forecast is never written to."
        right={<CurrencyToggle currency={currency} onChange={setCurrency}
              fxTip={<SettingTip settingKeys={["FX_RATE_PHP_AUD"]} align="right" />} />}
      />

      <div className="flex items-center gap-1 mb-5 border-b border-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 -mb-px cursor-pointer ${
                active
                  ? "border-violet-600 text-violet-800"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.id === "sandbox" && drafts.length > 0 && (
                <span className="ml-0.5 px-1.5 rounded-full bg-violet-100 text-violet-800 text-[10px] font-bold">
                  {drafts.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Prompt tab: slide steps 1 and 2 ─────────────────────────── */}
      {tab === "prompt" && (
        <div className="grid grid-cols-3 gap-4">
          <Card
            title="Describe the scenario"
            subtitle="Plain English. The class, percentile and GP target are read out of your sentence."
            className="col-span-2"
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="rationalise the bottom 25% of TRAVEL SYSTEM SKUs"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-violet-500 focus:outline-none"
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => runPrompt(prompt)}
                disabled={running || !prompt.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {running ? "Building scenario..." : "Run scenario"}
              </button>
              <button
                onClick={() => { setPrompt(""); setParsed(null); setPromptError(null); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Try
              </div>
              <div className="space-y-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => { setPrompt(ex); runPrompt(ex); }}
                    disabled={running}
                    className="w-full text-left px-2.5 py-2 rounded-md border border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 text-xs text-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {promptError && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-900">{promptError}</div>
                </div>
              </div>
            )}

            {parsed && (
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  What I understood
                </div>
                {typeof parsed.restated === "string" && (
                  <p className="text-xs text-slate-800 mb-2">{parsed.restated}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["Intent", parsed.intent],
                    ["Department", parsed.department],
                    ["Class", parsed.class],
                    ["Half", parsed.half],
                    ["Bottom %", parsed.bottom_pct],
                    ["GP target", parsed.target_gp_php],
                  ]
                    .filter(([, v]) => v !== null && v !== undefined && v !== "")
                    .map(([k, v]) => (
                      <span key={String(k)} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-mono text-slate-700">
                        {String(k)}: {String(v)}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="How this works" subtitle="Why the numbers are checkable">
            <div className="space-y-3 text-[11px] text-slate-600 leading-relaxed">
              <div>
                <div className="font-semibold text-slate-800 mb-0.5">Range rationalisation</div>
                Options are ranked by realised gross profit per option per trading week — not by
                sales. Ranking on sales would nominate high-turn, low-margin lines for deletion,
                which is the wrong answer. The bottom percentile you name is deleted by name, and a
                stated share of its demand transfers to the survivors.
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-0.5">Goal seek</div>
                The price move that delivers your GP target is solved algebraically, not searched.
                Because higher prices shed units, there is a ceiling past which price makes margin
                worse — if your target is beyond it, the answer says so and reports the best
                attainable figure rather than inventing a price.
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-0.5">The model&apos;s job</div>
                Cortex reads your sentence and writes the explanation. It never calculates. Every
                figure comes from SQL over the plan, so the same request always gives the same
                answer and the arithmetic can be checked.
              </div>
              <div className="pt-2 border-t border-slate-100">
                <div className="font-semibold text-slate-800 mb-0.5">Sandbox</div>
                Scenarios store only the cells they change. Nothing writes to the approved forecast,
                so an experiment cannot corrupt the plan and discarding one costs nothing.
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Sandbox tab: slide step 3 ───────────────────────────────── */}
      {tab === "sandbox" && (
        <>
          {listLoading && scenarios.length === 0 ? (
            <Loading what="sandbox scenarios" />
          ) : listError ? (
            <ErrorState message={listError} backHref="/planning" backLabel="Planning dashboard" />
          ) : costed.length === 0 ? (
            <Card>
              <div className="text-center py-10">
                <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 font-medium">No scenarios in the sandbox yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  Describe one on the Prompt tab, or edit forecast cells in a weekly grid.
                </p>
                <button
                  onClick={() => setTab("prompt")}
                  className="mt-4 px-4 py-2 text-xs font-semibold rounded-md bg-violet-600 text-white hover:bg-violet-700 cursor-pointer"
                >
                  Go to Prompt
                </button>
              </div>
            </Card>
          ) : (
            <>
              <Card
                title="Scenario comparison"
                subtitle="Each option against the current plan, on all three legs. Stock is shown because a scenario that buys GP with inventory is not free."
                className="mb-4"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <Th>Scenario</Th>
                        <Th>Scope</Th>
                        <Th align="right">Sales impact</Th>
                        <Th align="right">GP impact</Th>
                        <Th align="right">GP rate</Th>
                        <Th align="right">Stock impact</Th>
                        <Th align="right">Range</Th>
                        <Th align="center">Status</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <Td className="font-semibold">Current plan</Td>
                        <Td className="text-slate-500 text-xs">Approved forecast</Td>
                        <Td align="right" mono className="text-slate-400">–</Td>
                        <Td align="right" mono className="text-slate-400">–</Td>
                        <Td align="right" mono className="text-slate-400">–</Td>
                        <Td align="right" mono className="text-slate-400">–</Td>
                        <Td align="right" mono className="text-slate-400">–</Td>
                        <Td align="center" />
                        <Td />
                      </tr>
                      {costed.map((s) => {
                        const isNew = newIds.includes(s.scenarioId);
                        return (
                          <tr
                            key={s.scenarioId}
                            className={`border-b border-slate-100 hover:bg-slate-50 ${
                              isNew ? "bg-violet-50/50" : ""
                            }`}
                          >
                            <Td>
                              <div className="font-medium text-slate-900">
                                {s.siblingLabel && (
                                  <span className="mr-1.5 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">
                                    {s.siblingLabel}
                                  </span>
                                )}
                                {s.name}
                              </div>
                              {s.prompt && (
                                <div className="text-[10px] text-slate-400 italic mt-0.5 max-w-md truncate">
                                  &ldquo;{s.prompt}&rdquo;
                                </div>
                              )}
                            </Td>
                            <Td className="text-xs text-slate-600">
                              {s.class ?? s.department ?? "All"}
                              {s.half ? ` · ${s.half}` : ""}
                            </Td>
                            <Td align="right" mono className={varianceClass(s.salesDelta)}>
                              {fmtMoney(s.salesDelta, currency)}
                              <div className="text-[10px] text-slate-400">
                                {fmtPctSigned(s.salesDeltaPct)}
                              </div>
                            </Td>
                            <Td align="right" mono className={varianceClass(s.gpDelta)}>
                              {fmtMoney(s.gpDelta, currency)}
                            </Td>
                            <Td align="right" mono className={varianceClass(s.gpPctDeltaPp)}>
                              {fmtPp(s.gpPctDeltaPp)}
                              <div className="text-[10px] text-slate-400">
                                {fmtPct(s.scenarioGpPct)}
                              </div>
                            </Td>
                            {/* Lower stock is favourable, so the colour is flipped. */}
                            <Td align="right" mono className={varianceClass(s.stockDelta, false)}>
                              {s.stockDelta === 0 ? (
                                <span className="text-slate-400">no change</span>
                              ) : (
                                fmtMoney(s.stockDelta, currency)
                              )}
                            </Td>
                            <Td align="right" mono className="text-xs">
                              {s.optionsDropped > 0 && (
                                <span className="text-red-600">−{s.optionsDropped}</span>
                              )}
                              {s.optionsAdded > 0 && (
                                <span className="text-emerald-700">+{s.optionsAdded}</span>
                              )}
                              {s.optionsRepriced > 0 && (
                                <span className="text-sky-700">{s.optionsRepriced}↑$</span>
                              )}
                              {s.optionsDropped + s.optionsAdded + s.optionsRepriced === 0 && (
                                <span className="text-slate-400">–</span>
                              )}
                            </Td>
                            <Td align="center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  STATUS_STYLE[s.status] ?? "text-slate-600 bg-slate-100"
                                }`}
                              >
                                {s.status}
                              </span>
                            </Td>
                            <Td align="right">
                              <div className="flex items-center gap-1 justify-end">
                                {s.class && s.department && (
                                  <Link
                                    href={`/planning/grid/${toPathSegment(s.department)}/${toPathSegment(s.class)}?half=${s.half ?? "H2"}&scenario=${s.scenarioId}`}
                                    className="p-1 rounded hover:bg-violet-100 text-violet-700"
                                    title="Open in the weekly grid with this overlay applied"
                                  >
                                    <Grid3x3 className="w-3.5 h-3.5" />
                                  </Link>
                                )}
                                {s.status !== "APPROVED" && (
                                  <button
                                    onClick={() => act("delete", { scenarioId: s.scenarioId }, s.scenarioId)}
                                    disabled={busy === s.scenarioId}
                                    className="p-1 rounded hover:bg-red-100 text-red-600 cursor-pointer"
                                    title="Discard this scenario"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ColumnLegend columns={SCENARIO_COLUMNS} title="Impact columns" />
              </Card>

              {costed.length > 1 && (
                <Card
                  title="Sales, GP and stock movement"
                  subtitle="All three legs on one axis, so the trade-off between options is visible"
                  className="mb-4"
                >
                  <Plot
                    data={[
                      {
                        x: costed.map((s) => s.siblingLabel ?? s.name.slice(0, 22)),
                        y: costed.map((s) => s.salesDelta),
                        type: "bar", name: "Sales", marker: { color: "#a78bfa" },
                      },
                      {
                        x: costed.map((s) => s.siblingLabel ?? s.name.slice(0, 22)),
                        y: costed.map((s) => s.gpDelta),
                        type: "bar", name: "Gross profit", marker: { color: "#6d28d9" },
                      },
                      {
                        x: costed.map((s) => s.siblingLabel ?? s.name.slice(0, 22)),
                        y: costed.map((s) => s.stockDelta),
                        type: "bar", name: "Stock", marker: { color: "#f59e0b" },
                      },
                    ]}
                    layout={{
                      height: 300,
                      margin: { l: 70, r: 20, t: 10, b: 60 },
                      font: { family: "Inter, system-ui, sans-serif", size: 10 },
                      barmode: "group",
                      showlegend: true,
                      legend: { orientation: "h", y: -0.25 },
                      yaxis: { title: { text: currency }, gridcolor: "#f1f5f9", zerolinecolor: "#cbd5e1" },
                      xaxis: { automargin: true, tickfont: { size: 10 } },
                      plot_bgcolor: "white", paper_bgcolor: "white",
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: "100%" }}
                  />
                </Card>
              )}

              {/* Per-scenario detail: assumptions and the named options. */}
              <div className="grid grid-cols-2 gap-4">
                {costed.map((s) => (
                  <ScenarioDetail key={s.scenarioId} s={s} currency={currency} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Decisioning tab ─────────────────────────────────────────── */}
      {tab === "decisioning" && (
        <>
          {costed.length === 0 ? (
            <Card>
              <div className="text-center py-10 text-sm text-slate-600">
                Nothing to decide on yet. Build a scenario first.
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {costed.map((s) => (
                <Card key={s.scenarioId}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {s.siblingLabel && (
                          <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">
                            {s.siblingLabel}
                          </span>
                        )}
                        <span className="text-sm font-semibold text-slate-900">{s.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            STATUS_STYLE[s.status] ?? "text-slate-600 bg-slate-100"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span>
                          Sales{" "}
                          <span className={`font-mono font-semibold ${varianceClass(s.salesDelta)}`}>
                            {fmtMoney(s.salesDelta, currency)}
                          </span>
                        </span>
                        <span>
                          GP{" "}
                          <span className={`font-mono font-semibold ${varianceClass(s.gpDelta)}`}>
                            {fmtMoney(s.gpDelta, currency)}
                          </span>
                        </span>
                        <span>
                          Rate{" "}
                          <span className={`font-mono font-semibold ${varianceClass(s.gpPctDeltaPp)}`}>
                            {fmtPp(s.gpPctDeltaPp)}
                          </span>
                        </span>
                        <span>
                          Stock{" "}
                          <span className={`font-mono font-semibold ${varianceClass(s.stockDelta, false)}`}>
                            {fmtMoney(s.stockDelta, currency)}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => act("decide", { scenarioId: s.scenarioId }, `ai-${s.scenarioId}`)}
                        disabled={busy === `ai-${s.scenarioId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-violet-200 text-violet-800 hover:bg-violet-50 disabled:opacity-50 cursor-pointer"
                      >
                        {busy === `ai-${s.scenarioId}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Brain className="w-3.5 h-3.5" />
                        )}
                        Ask AI
                      </button>
                      {(["ACCEPT", "MODIFY", "REJECT"] as const).map((d) => {
                        const Icon =
                          d === "ACCEPT" ? CheckCircle2 : d === "MODIFY" ? PencilLine : XCircle;
                        const style =
                          d === "ACCEPT"
                            ? "border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                            : d === "MODIFY"
                            ? "border-amber-200 text-amber-800 hover:bg-amber-50"
                            : "border-red-200 text-red-700 hover:bg-red-50";
                        return (
                          <button
                            key={d}
                            onClick={() =>
                              act(
                                "decide",
                                { scenarioId: s.scenarioId, humanDecision: d, decidedBy: "Wensi Cai" },
                                `${d}-${s.scenarioId}`
                              )
                            }
                            disabled={busy !== null || s.status === "APPROVED"}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-40 cursor-pointer ${style}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {d.charAt(0) + d.slice(1).toLowerCase()}
                          </button>
                        );
                      })}
                      {s.decision?.humanDecision === "ACCEPT" && s.status !== "APPROVED" && (
                        <button
                          onClick={() =>
                            act(
                              "approve",
                              {
                                scenarioId: s.scenarioId,
                                label: s.name,
                                approvedBy: "Wensi Cai",
                                notes: s.prompt,
                              },
                              `appr-${s.scenarioId}`
                            )
                          }
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                        >
                          {busy === `appr-${s.scenarioId}` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          Approve as forecast
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AI opinion and human decision shown side by side, never
                      collapsed into one field: whether the planner agreed or
                      overrode is the most interesting fact in the audit trail. */}
                  {s.decision && (
                    <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                      <div className="bg-violet-50/60 border border-violet-100 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            AI recommendation
                          </span>
                          {s.decision.aiRecommendation && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                REC_STYLE[s.decision.aiRecommendation] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {s.decision.aiRecommendation}
                            </span>
                          )}
                          {s.decision.aiConfidence && (
                            <span className="text-[10px] text-slate-500">
                              {s.decision.aiConfidence} confidence
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-700 leading-relaxed">
                          {s.decision.aiRationale ?? "—"}
                        </p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            Human decision
                          </span>
                          {s.decision.humanDecision ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                REC_STYLE[s.decision.humanDecision] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {s.decision.humanDecision}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">not yet decided</span>
                          )}
                          {s.decision.agreedWithAi === false && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              OVERRODE AI
                            </span>
                          )}
                          {s.decision.agreedWithAi === true && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              AGREED
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-700">
                          {s.decision.decidedBy
                            ? `${s.decision.decidedBy}${
                                s.decision.decidedAt
                                  ? ` · ${new Date(s.decision.decidedAt).toLocaleString(undefined, {
                                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                                    })}`
                                  : ""
                              }`
                            : "—"}
                        </p>
                        {s.decision.resultingVersionId && (
                          <p className="text-[10px] text-emerald-700 mt-1 font-medium">
                            Promoted to approved forecast
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

    </div>
  );
}

// ─── Per-scenario detail: narrative, assumptions, named options ────────────────

function ScenarioDetail({ s, currency }: { s: Scenario; currency: Currency }) {
  const [showAll, setShowAll] = useState(false);
  const a = s.assumptions ?? {};
  const notAchievable = a.achievable === false;

  // Ordered so the reader meets the method before the caveat, and the caveat
  // before the list of names. Keys absent from a given scenario type are simply
  // skipped rather than rendered as blanks.
  const ASSUMPTION_KEYS: [string, string][] = [
    ["method", "Method"],
    ["scope", "Scope"],
    ["options_reviewed", "Options reviewed"],
    ["options_deleted", "Options deleted"],
    ["options_added", "Options added"],
    ["percentile", "Percentile"],
    ["demand_transfer_pct", "Demand transfer %"],
    ["transfer_valued_at", "Transfer valued at"],
    ["price_move_pct", "Price move %"],
    ["price_elasticity", "Price elasticity"],
    ["units_lost", "Units lost"],
    ["max_attainable_gp_php", "Max attainable GP"],
    ["price_at_max_pct", "Price at that maximum %"],
    ["valued_at", "New options valued at"],
    ["ramp_factor", "Ramp factor"],
    ["cannibalisation_pct", "Cannibalisation %"],
    ["gp_per_new_option_php", "GP per new option"],
    ["stock_investment_php", "Stock investment"],
    ["stock_treatment", "Stock treatment"],
    ["held_constant", "Held constant"],
    ["horizon", "Horizon"],
  ];

  const visible = s.options.slice(0, showAll ? s.options.length : 5);

  return (
    <Card>
      <div className="flex items-start gap-2 mb-2">
        {s.siblingLabel && (
          <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold shrink-0 mt-0.5">
            {s.siblingLabel}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{s.name}</div>
          <div className="text-[10px] text-slate-400">
            {s.class ?? s.department ?? "All"} · {s.half ?? "full year"} · {s.createdBy}
          </div>
        </div>
      </div>

      {notAchievable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-900">
            <span className="font-semibold">Target not achievable this way.</span> The best this
            lever can deliver is{" "}
            <span className="font-mono font-semibold">
              {fmtMoney(Number(a.max_attainable_gp_php ?? 0), currency)}
            </span>
            , at a {String(a.price_at_max_pct)}% price rise. Past that, lost units cost more margin
            than the higher price earns.
          </div>
        </div>
      )}

      {s.narrative && (
        <div className="mb-3">
          {/* The narrative is written once, at generation time. A later hand edit in
              the grid moves the numbers but not the prose, so it has to be
              labelled rather than left to contradict the tiles above it. */}
          {s.handEdits > 0 && (
            <div className="inline-flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[9px] font-semibold uppercase tracking-wide">
              Superseded by {s.handEdits} hand edit{s.handEdits === 1 ? "" : "s"} — figures above are current
            </div>
          )}
          <p className={`text-[11px] leading-relaxed ${s.handEdits > 0 ? "text-slate-500 italic" : "text-slate-700"}`}>
            {s.narrative}
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-3">
        <MiniStat label="Sales" value={fmtMoney(s.salesDelta, currency)} cls={varianceClass(s.salesDelta)} />
        <MiniStat label="Units" value={fmtNum(s.unitsDelta)} cls={varianceClass(s.unitsDelta)} />
        {/* ASP is a PER-UNIT price, so it needs decimals. fmtMoney rounds to whole
            pesos, which rendered this scenario's +0.04 move as a flat "PHP 0" while
            the narrative alongside it quoted PHP 428.94 -- the same metric
            disagreeing with itself on one card. Show the level, movement beneath. */}
        <MiniStat
          label="ASP"
          value={s.scenarioAsp.toFixed(2)}
          sub={fmtAspDelta(s.scenarioAsp - s.baseAsp)}
          cls={varianceClass(s.scenarioAsp - s.baseAsp)}
        />
        <MiniStat label="GP $" value={fmtMoney(s.gpDelta, currency)} cls={varianceClass(s.gpDelta)} />
      </div>

      <details className="mb-3">
        <summary className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-violet-700">
          Assumptions
        </summary>
        <dl className="mt-2 space-y-1.5">
          {ASSUMPTION_KEYS.filter(([k]) => a[k] !== undefined && a[k] !== null).map(([k, label]) => (
            <div key={k} className="text-[11px]">
              <dt className="font-semibold text-slate-700 inline">{label}: </dt>
              <dd className="text-slate-600 inline">{String(a[k])}</dd>
            </div>
          ))}
          {typeof a.caveat === "string" && (
            <div className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 mt-2">
              <dt className="font-semibold text-slate-700 inline">Binding assumption: </dt>
              <dd className="text-slate-600 inline">{a.caveat}</dd>
            </div>
          )}
        </dl>
      </details>

      {s.options.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            {s.optionsDropped > 0
              ? "Options deleted"
              : s.optionsAdded > 0
              ? "Options added"
              : "Options repriced"}{" "}
            <span className="text-slate-400 font-normal">({s.options.length})</span>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left font-medium pb-1">Option</th>
                <th className="text-right font-medium pb-1">GP/wk</th>
                <th className="text-right font-medium pb-1">Cover</th>
                <th className="text-right font-medium pb-1">GP effect</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o, i) => (
                <tr key={`${o.optionId ?? o.label}-${i}`} className="border-b border-slate-50">
                  <td className="py-1 pr-2 text-slate-700 truncate max-w-[190px]" title={o.label}>
                    {o.label}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-600">
                    {o.gpPerWeek === null ? "–" : fmtMoney(o.gpPerWeek, currency)}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-600">
                    {o.coverWeeks === null ? "–" : `${o.coverWeeks.toFixed(1)}w`}
                  </td>
                  <td className={`py-1 text-right font-mono ${varianceClass(o.gpDelta)}`}>
                    {fmtMoney(o.gpDelta, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.options.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-[10px] text-violet-700 hover:underline mt-1.5 cursor-pointer"
            >
              {showAll ? "Show fewer" : `Show all ${s.options.length}`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, cls, sub }: { label: string; value: string; cls: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg px-2 py-1.5">
      <div className="text-[9px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`font-mono text-[11px] font-bold ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-slate-400">{sub}</div>}
    </div>
  );
}
