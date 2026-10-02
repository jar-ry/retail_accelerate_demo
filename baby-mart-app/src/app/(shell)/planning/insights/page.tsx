"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, TrendingUp, Lightbulb, Sparkles, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Breadcrumb, PageHeader, Card, Loading, ErrorState,
  fmtPct, type Currency,
} from "../_components/ui";
import {
  usePlanningData, usePlanningAction, type PlanningInsights,
} from "../_components/usePlanning";

type Hierarchy = {
  rbu: string | null;
  rbus: string[];
  departments: { department: string; departmentCode: string; classes: { class: string }[] }[];
};

function ImpactDots({ impact }: { impact: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Impact ${impact} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= impact ? "bg-violet-600" : "bg-slate-200"}`}
        />
      ))}
    </span>
  );
}

export default function PlanningInsightsPage() {
  // useSearchParams() opts the tree into client-side rendering, so Next requires
  // a Suspense boundary or the static prerender of this route fails outright.
  return (
    <Suspense fallback={<Loading what="planning insights" />}>
      <PlanningInsights />
    </Suspense>
  );
}

function PlanningInsights() {
  const search = useSearchParams();
  const [level, setLevel] = useState(search.get("level") ?? "DEPARTMENT");
  const [node, setNode] = useState(search.get("node") ?? "");
  const [scenario, setScenario] = useState("");
  const [showMetrics, setShowMetrics] = useState(false);

  const { data: hierarchy } = usePlanningData<Hierarchy>("hierarchy", "PHP" as Currency);
  const { data, error, loading, run } = usePlanningAction<PlanningInsights>("insights");

  // Default the node to the RBU or the first department once the tree loads.
  useEffect(() => {
    if (node || !hierarchy) return;
    if (level === "RBU" && hierarchy.rbu) setNode(hierarchy.rbu);
    else if (level === "DEPARTMENT" && hierarchy.departments[0]) {
      setNode(hierarchy.departments[0].department);
    }
  }, [hierarchy, level, node]);

  // Auto-run when arrived via a deep link from a plan page.
  useEffect(() => {
    const l = search.get("level");
    const n = search.get("node");
    if (l && n) run({ level: l, node: n, scenario: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodeOptions = (() => {
    if (!hierarchy) return [];
    if (level === "RBU") return hierarchy.rbus ?? (hierarchy.rbu ? [hierarchy.rbu] : []);
    if (level === "DEPARTMENT") return hierarchy.departments.map((d) => d.department);
    return hierarchy.departments.flatMap((d) => d.classes.map((c) => c.class));
  })();

  const onLevelChange = (l: string) => {
    setLevel(l);
    // The current node almost certainly does not exist at the new level.
    if (l === "RBU") setNode(hierarchy?.rbu ?? "");
    else if (l === "DEPARTMENT") setNode(hierarchy?.departments[0]?.department ?? "");
    else setNode(hierarchy?.departments[0]?.classes[0]?.class ?? "");
  };

  const insights = data?.insights;

  return (
    <div className="p-6">
      <Breadcrumb trail={[{ label: "Global Planning", href: "/planning" }, { label: "Planning Insights" }]} />
      <PageHeader
        title="AI Planning Insights"
        subtitle="Risks, opportunities and recommended actions grounded in the plan — every figure traces to a metric"
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Level
            </label>
            <select
              value={level}
              onChange={(e) => onLevelChange(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-md text-sm cursor-pointer"
            >
              <option value="RBU">RBU</option>
              <option value="DEPARTMENT">Department</option>
              <option value="CLASS">Class</option>
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              {level === "RBU" ? "RBU" : level === "DEPARTMENT" ? "Department" : "Class"}
            </label>
            <select
              value={node}
              onChange={(e) => setNode(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm cursor-pointer"
            >
              {nodeOptions.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Scenario to model (optional)
            </label>
            <input
              type="text"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="e.g. demand comes in 8% above forecast and the delayed POs slip 3 more weeks"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm"
            />
          </div>
          <button
            onClick={() => run({ level, node, scenario: scenario.trim() || null })}
            disabled={loading || !node}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? "Analysing..." : "Generate insights"}
          </button>
        </div>
      </Card>

      {loading && <Loading what={`insights for ${node}`} />}
      {error && !loading && <ErrorState message={error} backHref="/planning" backLabel="Planning dashboard" />}

      {!loading && !error && !data && (
        <Card>
          <div className="text-center py-10">
            <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              Choose a level and node, then generate insights.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Findings come from the plan itself, not from a model&apos;s guess — the exception list is
              detected in SQL and the narrative explains it.
            </p>
          </div>
        </Card>
      )}

      {!loading && insights && (
        <>
          <Card title={`${data.level} · ${data.node}`} subtitle="Summary" className="mb-4">
            <p className="text-sm text-slate-700 leading-relaxed">{insights.summary}</p>
          </Card>

          {insights.scenario_commentary && (
            <Card
              title="Scenario commentary"
              subtitle={data.scenario ?? undefined}
              className="mb-4 border-violet-200"
            >
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {insights.scenario_commentary}
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <Card title="Risks" subtitle={`${insights.risks?.length ?? 0} identified`}>
              <div className="space-y-3">
                {(insights.risks ?? []).map((r, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                        <span className="text-sm font-semibold text-slate-900">{r.title}</span>
                      </div>
                      <ImpactDots impact={r.impact} />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{r.detail}</p>
                    {r.data && (
                      <p className="text-[10px] font-mono text-slate-400 mt-1.5 break-words">{r.data}</p>
                    )}
                  </div>
                ))}
                {(insights.risks ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">No risks identified.</p>
                )}
              </div>
            </Card>

            <Card title="Opportunities" subtitle={`${insights.opportunities?.length ?? 0} identified`}>
              <div className="space-y-3">
                {(insights.opportunities ?? []).map((o, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-start gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span className="text-sm font-semibold text-slate-900">{o.title}</span>
                      </div>
                      <ImpactDots impact={o.impact} />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{o.detail}</p>
                    {o.data && (
                      <p className="text-[10px] font-mono text-slate-400 mt-1.5 break-words">{o.data}</p>
                    )}
                  </div>
                ))}
                {(insights.opportunities ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">No opportunities identified.</p>
                )}
              </div>
            </Card>
          </div>

          {/* Provenance. The procedure returns the metrics it used, so every number
              above can be checked against its source rather than trusted. */}
          <Card>
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className="w-full flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Source metrics</div>
                <div className="text-[11px] text-slate-500">
                  The exact figures passed to the model — every number above should appear here
                </div>
              </div>
              {showMetrics ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
            {showMetrics && (
              <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-1.5 max-h-[400px] overflow-y-auto">
                {Object.entries(data.metrics ?? {})
                  .filter(([, v]) => typeof v !== "object" || v === null)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 border-b border-slate-50 py-0.5">
                      <span className="text-[11px] text-slate-500 font-mono">{k}</span>
                      <span className="text-[11px] font-mono font-semibold text-slate-800 text-right">
                        {v === null ? "–" : typeof v === "number" ? v.toLocaleString() : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
