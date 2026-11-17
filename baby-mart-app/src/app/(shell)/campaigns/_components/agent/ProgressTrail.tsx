"use client";

import { BarChart3, CheckCircle2, Database, FlaskConical, Loader2, MessagesSquare, PenLine, Search, ShieldCheck, Sigma, Users, XCircle } from "lucide-react";
import type { Step, Turn } from "./useAgentRun";

// ─── Progress: the agent's steps as they happen ──────────────────────────────
//
// The customer-sentiment-health investigation trail, in the campaign pages'
// style: one line per tool call with what it was asked, a spinner while it runs
// and a tick or a cross when it returns, the agent's status line at the bottom,
// and a tail of its reasoning while it works.

type Meta = { icon: typeof Database; label: string };

const TOOL_META: Record<string, Meta> = {
  CustomerSignals: { icon: Users, label: "Cortex Analyst · Customer life stage and value" },
  CustomerVoice: { icon: Sigma, label: "Cortex Analyst · Customer voice" },
  CampaignResults: { icon: Database, label: "Cortex Analyst · Campaign results" },
  VoiceSearch: { icon: Search, label: "Cortex Search · Customer verbatims" },
  SizeAudience: { icon: Users, label: "Tool · Size the audience" },
  CheckCampaignGuardrails: { icon: ShieldCheck, label: "Tool · Stock, sentiment and overlap guardrails" },
  EstimateLift: { icon: FlaskConical, label: "Tool · Expected lift from past campaigns" },
  CreateCampaignDraft: { icon: PenLine, label: "Tool · Create the draft brief" },
  CampaignEvidence: { icon: Database, label: "Tool · Campaign evidence pack" },
  TestHypothesis: { icon: FlaskConical, label: "Tool · Test a hypothesis" },
  PlanEvidence: { icon: Database, label: "Tool · Plan evidence pack" },
  TestPlanHypothesis: { icon: FlaskConical, label: "Tool · Test a cause of the gap" },
  PlanData: { icon: Sigma, label: "Cortex Analyst · Merchandise plan" },
  OptionSearch: { icon: Search, label: "Cortex Search · Option range" },
  GoalSeek: { icon: FlaskConical, label: "Solver · Goal seek GP (draft scenarios)" },
  RangeCut: { icon: PenLine, label: "Solver · Range rationalisation (draft scenario)" },
  ScenarioReview: { icon: ShieldCheck, label: "Tool · Scenario impact and guardrails" },
  StoreEvidence: { icon: Database, label: "Tool · Store plan evidence pack" },
  TestStoreHypothesis: { icon: FlaskConical, label: "Tool · Test a cause of the LFL gap" },
  ChainEvidence: { icon: Database, label: "Tool · Planning chain evidence pack" },
  TestChainGap: { icon: FlaskConical, label: "Tool · Test a cause of the chain gap" },
  system_execute_sql: { icon: Database, label: "Running the query" },
  data_to_chart: { icon: BarChart3, label: "Building a chart" },
};

/** The agent's own plumbing: shown as part of the step that asked for it. */
const HIDDEN = new Set(["server_skill"]);

function spec(s: unknown): Record<string, unknown> | null {
  if (typeof s !== "string") return (s as Record<string, unknown>) ?? null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** One line saying what a step was asked, in words. */
export function describeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (o.query) return String(o.query);
  if (o.pruning_question) return String(o.pruning_question);
  if (name === "TestHypothesis") return `${o.CAMPAIGN_ID} · split by ${String(o.DIMENSION)}`;
  if (name === "CampaignEvidence") return String(o.CAMPAIGN_ID ?? "");
  if (name === "PlanEvidence") return String(o.NODE ?? "");
  if (name === "TestPlanHypothesis") return `${o.NODE} · split by ${String(o.DIMENSION)}`;
  if (name === "GoalSeek") return [o.NODE, typeof o.TARGET_GP_PHP === "number" ? `PHP ${(o.TARGET_GP_PHP / 1e6).toFixed(1)}M GP` : null, o.HALF].filter(Boolean).join(" · ");
  if (name === "RangeCut") return [o.CLASS_NAME, o.BOTTOM_PCT ? `bottom ${o.BOTTOM_PCT}%` : null, o.HALF].filter(Boolean).join(" · ");
  if (name === "ScenarioReview") return String(o.SCENARIO_ID ?? "");
  if (name === "StoreEvidence") return String(o.SCOPE ?? "");
  if (name === "TestStoreHypothesis") return `${o.SCOPE} · split by ${String(o.DIMENSION)}`;
  if (name === "TestChainGap") return `${o.NODE} · split by ${String(o.DIMENSION)}`;
  if (name === "CheckCampaignGuardrails") return [o.CATEGORY, o.BRAND || "no brand", o.START_DATE && `${o.START_DATE} → ${o.END_DATE}`].filter(Boolean).join(" · ");
  if (name === "EstimateLift") return [o.CATEGORY || "all categories", o.CHANNELS, o.RECENCY_BAND].filter(Boolean).join(" · ");
  if (name === "SizeAudience" || name === "CreateCampaignDraft") {
    const sp = spec(o.SPEC);
    const all = Array.isArray(sp?.all) ? (sp!.all as Record<string, unknown>[]) : [];
    const conds = all.map((c) => `${String(c.field).toLowerCase().replace(/_/g, " ")} ${Array.isArray(c.values) ? (c.values as string[]).join("/") : c.op}`);
    const q = Array.isArray(sp?.quadrants) ? ` · ${(sp!.quadrants as string[]).join(", ").toLowerCase()}` : "";
    const brief = name === "CreateCampaignDraft" ? spec(o.BRIEF) : null;
    return (brief?.name ? `${String(brief.name)} · ` : "") + (conds.join(" · ") || "everyone") + q;
  }
  if (o.sql) return String(o.sql).replace(/\s+/g, " ").slice(0, 140) + "…";
  if (o.chart) {
    try {
      const t = JSON.parse(String(o.chart)).title;
      return typeof t === "string" ? t : t?.text ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

function StepIcon({ s }: { s: Step }) {
  if (s.status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />;
  if (s.status === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

export function ProgressTrail({ t, compact }: { t: Turn; compact?: boolean }) {
  const steps = t.steps.filter((s) => !HIDDEN.has(s.name));
  const secs = Math.max(0, Math.round(((t.done ? (steps.at(-1)?.endedAt ?? Date.now()) : Date.now()) - t.startedAt) / 1000));
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <MessagesSquare className="h-3.5 w-3.5 text-amber-600" />Progress
        </div>
        <div className="text-[10px] text-slate-500">{steps.length} step{steps.length === 1 ? "" : "s"}{t.done ? ` · ${secs}s` : ""}</div>
      </div>
      <ol className={`relative ml-5 space-y-2.5 border-l border-slate-200 py-3 pl-5 pr-4 ${compact ? "max-h-72 overflow-y-auto" : ""}`}>
        {steps.map((s) => {
          const meta = TOOL_META[s.name] ?? { icon: Database, label: s.name };
          const Icon = meta.icon;
          const what = describeInput(s.name, s.input);
          return (
            <li key={s.id || `${s.name}-${s.startedAt}`} className="relative">
              <span className="absolute -left-[27px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-white"><StepIcon s={s} /></span>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-800"><Icon className="h-3 w-3 text-slate-500" />{meta.label}</div>
              {what && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{what}</div>}
              {s.status === "error" && <div className="mt-0.5 text-[10px] text-red-600">This step failed; the agent will work around it.</div>}
            </li>
          );
        })}
        {!t.done && (
          <li className="relative text-[11px] text-amber-700">
            <span className="absolute -left-[25px] top-1 grid h-3 w-3 place-items-center"><span className="h-2 w-2 animate-ping rounded-full bg-amber-500" /></span>
            {t.status ?? "Working…"}
          </li>
        )}
        {t.done && steps.length === 0 && <li className="text-[11px] text-slate-500">No tools were called.</li>}
      </ol>
      {t.thinking && !t.done && (
        <p className="mx-4 mb-3 line-clamp-3 rounded-md bg-slate-50 p-2 text-[11px] italic leading-snug text-slate-500">{t.thinking}</p>
      )}
    </div>
  );
}
