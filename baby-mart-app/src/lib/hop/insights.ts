// ─── AI insights: prompt and citation guardrail ──────────────────────────────
//
// The guardrail itself -- extractFigures, verifyCitations and the matching rules
// -- lives in src/lib/ai/grounded.ts, shared with the campaign persona. This
// module keeps what is Head of Planning specific: the prompt and the response
// shape. Re-exported so existing imports (and insights.test.ts) are unchanged.

export { extractFigures, payloadFigures, derive, matches, verifyCitations } from "../ai/grounded";
export type { Unit, Figure, Allowed } from "../ai/grounded";

// ─── Prompt ──────────────────────────────────────────────────────────────────

export function composePrompt(o: {
  doctrine: string; tone: string | null; doctrineVersion: number; taskInstruction: string; focusMeasures: string | null;
  maxFindings: number; payload: unknown; question?: string | null;
}): string {
  return `You are the analytical second pair of eyes for the Head of Planning at Baby Mart, an Australian
retailer of baby products with 60 stores and four openings planned. Planning owns the top-down plan;
Buying owns the range and its bottom-up numbers; the two agree some numbers jointly at range review.

Follow the head of planning's own method, below. Where it and your instincts differ, follow the method.

=== HOW THE HEAD OF PLANNING WORKS (doctrine version ${o.doctrineVersion}) ===
${o.doctrine}
${o.tone ? `\n=== HOUSE STYLE ===\n${o.tone}\n` : ""}
=== YOUR TASK ON THIS SCREEN ===
${o.taskInstruction}${o.focusMeasures ? `\nMeasures that matter here: ${o.focusMeasures}` : ""}
${o.question ? `\n=== THE QUESTION ASKED ===\n"${o.question}"\nAnswer it from the figures below and nothing else. If they cannot answer it, say so and what would be needed.\n` : ""}
=== THE FIGURES ===
The only data you have. Amounts are Australian dollars. Keys ending _pct or _pts are already
percentages or points: 4.32 means 4.32%, not 432%. Every number you write must come from here.

${JSON.stringify(o.payload, null, 1)}

=== RULES, IN ORDER OF IMPORTANCE ===
1. Do not invent, estimate or extrapolate any number that is not in the figures. If something
   cannot be determined from them, say so plainly. Do not offer illustrative or hypothetical
   numbers either ("say, 5%"): name the assumption in words instead.
2. List every number you cite in figures_cited, as it appears in the figures. Every number in your
   text is checked against the figures; one that cannot be matched marks the insight unverified.
   Where the figures give a total or a share, quote it rather than adding up or dividing yourself.
3. Write money as $ with M or K (e.g. $3.78M) and rates with % or pts, so each number's unit is clear.
4. At most ${o.maxFindings} findings, most important first. Fewer strong findings beat more weak ones.
   Keep each observation to three sentences and each recommendation to two.
5. Name who must act on each recommendation: PLANNING, BUYING or JOINT.
6. Say which clause of the method drove your answer in doctrine_applied, in one sentence.
7. Respond in JSON.`;
}

/** The response shape, as a Snowflake object literal (single-quoted keys). */
export const RESPONSE_FORMAT_SQL = `{
  'type': 'json',
  'schema': {
    'type': 'object',
    'properties': {
      'headline': {'type': 'string'},
      'findings': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'observation': {'type': 'string'},
        'figures_cited': {'type': 'array', 'items': {'type': 'string'}},
        'severity': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']}
      }, 'required': ['observation', 'figures_cited', 'severity']}},
      'recommendations': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'action': {'type': 'string'},
        'rationale': {'type': 'string'},
        'owning_party': {'type': 'string', 'enum': ['PLANNING', 'BUYING', 'JOINT']}
      }, 'required': ['action', 'rationale', 'owning_party']}},
      'confidence': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']},
      'doctrine_applied': {'type': 'string'}
    },
    'required': ['headline', 'findings', 'recommendations', 'confidence', 'doctrine_applied']
  }
}`;

export type Insight = {
  headline: string;
  findings: { observation: string; figures_cited: string[]; severity: string }[];
  recommendations: { action: string; rationale: string; owning_party: string }[];
  confidence: string;
  doctrine_applied: string;
};

/** Every piece of prose in an insight, for the guardrail. */
export function proseOf(i: Insight): string[] {
  return [
    i.headline,
    ...i.findings.map((f) => f.observation),
    ...i.recommendations.flatMap((r) => [r.action, r.rationale]),
  ].filter(Boolean);
}
