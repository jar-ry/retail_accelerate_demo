// ─── Campaign & CRM: AI read of a screen ─────────────────────────────────────

import { CmpError } from "../db";
import { runGrounded } from "../ai";
import { loadPortfolio } from "../measure";
import { getLearnings } from "./campaigns";
import { INSIGHT_METHOD } from "../doctrine";
import { toNum } from "../format";

const SURFACES = ["OVERVIEW", "PERFORMANCE", "LEARNINGS"] as const;
const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

const FORMAT = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'headline': {'type': 'string'},
      'findings': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'observation': {'type': 'string'}, 'figures_cited': {'type': 'array', 'items': {'type': 'string'}},
        'severity': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}}, 'required': ['observation', 'figures_cited', 'severity']}},
      'recommendations': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'action': {'type': 'string'}, 'rationale': {'type': 'string'}, 'owning_party': {'type': 'string', 'enum': ['CRM', 'MERCHANDISING', 'SUPPLY', 'CX']}},
        'required': ['action', 'rationale', 'owning_party']}},
      'confidence': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}
    },
    'required': ['headline', 'findings', 'recommendations', 'confidence']
  }
}`;

type Insight = { headline: string; findings: { observation: string; figures_cited: string[]; severity: string }[];
  recommendations: { action: string; rationale: string; owning_party: string }[]; confidence: string };

export async function generateInsight(body: unknown, user: string) {
  const b = (body ?? {}) as { surface?: string; question?: string };
  const surface = String(b.surface ?? "").toUpperCase();
  if (!(SURFACES as readonly string[]).includes(surface)) throw new CmpError(400, `No insights for '${b.surface}'.`);
  const question = String(b.question ?? "").trim().slice(0, 500) || null;
  const { campaigns } = await loadPortfolio();
  const pct = (v: number | null) => (v === null ? null : r2(v * 100));
  const payload: Record<string, unknown> = {
    as_of: "7 May 2026",
    campaigns: campaigns.filter((c) => c.treated > 0).map((c) => ({
      campaign: c.name, status: c.status, start: c.start, treated: c.treated, holdout: c.holdout,
      reported_conversions: c.treatedConv, treated_rate_pct: pct(c.treatedRate), holdout_rate_pct: pct(c.holdoutRate),
      lift_pts: r2(c.liftPp), lift_ci_low_pts: r2(c.ciLowPp), lift_ci_high_pts: r2(c.ciHighPp), significant: c.significant,
      incremental_conversions: r2(c.incrementalConv), incremental_margin_aud: r2(c.incMargin), cost_aud: r2(c.cost), net_aud: r2(c.net),
      unsubscribe_rate_pct: pct(c.unsubRate), complaint_rate_pct: pct(c.complaintRate), health_score: c.health?.score ?? null,
      open_alerts: c.alerts.filter((a) => a.status === "OPEN").map((a) => a.message),
    })),
  };
  if (surface === "LEARNINGS") {
    const { learnings } = await getLearnings();
    payload.learnings = learnings.map((l) => ({ campaign: l.CAMPAIGN_NAME, finding: l.STATEMENT, lift_pts: r2(toNum(l.LIFT_PP)), significant: l.IS_SIGNIFICANT }));
  }
  const task = surface === "LEARNINGS"
    ? "Summarise what has worked and what has not across the published learnings, and what the next campaigns should do differently."
    : surface === "PERFORMANCE"
      ? "Judge the campaign portfolio on incremental results: which campaigns earned their cost, which did not, and why it matters."
      : "Give the campaign manager the three or four things that matter most on the command centre today: live problems first.";
  const prompt = `You are the analytical second pair of eyes for Baby Mart's CRM team.

${INSIGHT_METHOD}

=== YOUR TASK ===
${task}
${question ? `\nThe question asked: "${question.replace(/"/g, "'")}". Answer it from the figures; if they cannot answer it, say so.\n` : ""}
=== THE FIGURES (the only data you have; keys ending _pct are percentages, _pts points, _aud dollars) ===
${JSON.stringify(payload, null, 1)}

Rules: never invent a number; list every number you use in figures_cited, as it appears. Quote the CI when you call a lift
real or not. At most 4 findings. Write money as $ with K or M. Respond in JSON.`;
  const r = await runGrounded<Insight>({
    stage: surface, templateKey: `INSIGHT_${surface}`, prompt, responseFormatSql: FORMAT, user, question, figures: payload,
    cited: (x) => x.findings.flatMap((f) => f.figures_cited ?? []),
    prose: (x) => [x.headline, ...x.findings.map((f) => f.observation), ...x.recommendations.flatMap((a) => [a.action, a.rationale])],
  });
  return { ok: true, verified: r.verified, unmatched: r.unmatched };
}
