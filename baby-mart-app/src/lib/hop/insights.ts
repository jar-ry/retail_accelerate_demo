// ─── AI insights: prompt and citation guardrail (pure) ───────────────────────
//
// One rule this module exists to enforce: the model never touches the database.
// It is handed a compact payload of figures already computed, and may reason only
// from those. A model producing a plausible dollar figure inside a planning system
// is the most dangerous output the feature can generate -- far worse than a blank
// panel, because it looks exactly like a measured number. So the prompt is
// grounded, the model must declare the figures it used, and every number it
// writes is checked against what was supplied. One that cannot be matched marks
// the whole insight unverified rather than silently passing.
//
// Two departures from the reference implementation:
//   - Rates are sent as PERCENTAGES and points, already scaled. The reference sent
//     decimals, so a 3.1-point growth break arrived as 0.031 and was rounded to
//     0.0 before the model ever saw it.
//   - Matching is UNIT-AWARE and precision-aware. The reference accepted any
//     number within 0.51 of any payload figure; with a few hundred figures in a
//     payload, nearly every small invented percentage passed.

export type Unit = "pct" | "money" | "plain";

export type Figure = { raw: string; value: number; unit: Unit; decimals: number; scale: number };

const MONEY_SCALE: Record<string, number> = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 };

/** Every number in a piece of text, with the unit and precision it is written at.
 *  A number glued to letters is part of a code -- FY27, S048, H1 -- not a figure. */
export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  const re = /(?<![A-Za-z0-9._])(\$|A\$|AUD\s?)?(-?\d[\d,]*(?:\.\d+)?)(?:[eE]([+-]?\d+))?\s?(%|bps\b|basis points?\b|pts?\b|points?\b|percentage points?\b|k\b|m\b|mn\b|b\b|bn\b|million\b|billion\b|thousand\b)?/gi;
  for (const m of text.matchAll(re)) {
    const [raw, cur, digits, exp, suffixRaw] = m;
    const suffix = (suffixRaw ?? "").toLowerCase();
    let value = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (exp) value *= 10 ** Number(exp);
    const decimals = (digits.split(".")[1] ?? "").length;
    let unit: Unit = "plain";
    let decimalsOut = decimals;
    if (suffix === "bps" || suffix.startsWith("basis")) {
      // 53 basis points is 0.53 percentage points.
      value /= 100;
      unit = "pct";
      decimalsOut = decimals + 2;
    } else if (suffix === "%" || suffix.startsWith("pt") || suffix.startsWith("point") || suffix.startsWith("percentage")) unit = "pct";
    else if (cur) unit = "money";
    const scale = suffix === "million" ? 1e6 : suffix === "billion" ? 1e9 : suffix === "thousand" ? 1e3 : MONEY_SCALE[suffix];
    if (scale) { value *= scale; unit = "money"; }
    // A zero-padded integer is a code (department 050), not a magnitude.
    const code = unit === "plain" && /^0\d+$/.test(digits);
    if (!code) out.push({ raw: raw.trim(), value, unit, decimals: decimalsOut, scale: scale ?? 1 });
  }
  return out;
}

export type Allowed = { value: number; unit: Unit }[];

/** The figures a payload supplies. A key ending _pct or _pts carries a percentage;
 *  _aud carries dollars. Anything else is a plain number (counts, weeks). */
export function payloadFigures(payload: unknown): Allowed {
  const out: Allowed = [];
  const walk = (v: unknown, key: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "number" && Number.isFinite(v)) {
      const k = key.toLowerCase();
      out.push({ value: v, unit: /_pct$|_pts$|pct_|_mix$|share/.test(k) ? "pct" : /_aud$|aud_|sales|margin_aud|budget/.test(k) ? "money" : "plain" });
      return;
    }
    if (typeof v === "string") {
      for (const f of extractFigures(v)) out.push({ value: f.value, unit: f.unit });
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
  };
  walk(payload, "");
  return out;
}

/** Arithmetic a reader could legitimately derive: pairwise differences and sums
 *  within a unit, and differences of counts ("267 options dropped" is presented
 *  less committed). Reasoning produces arithmetic -- "a 2.1-point gap between
 *  40.3% and 38.2%" is correct and useful, and flagging it would make the
 *  guardrail so noisy it would be ignored. Ratios are not admitted: almost any
 *  percentage is some ratio of two supplied amounts, so shares the model needs
 *  are put in the payload instead. Capped, because the set grows with the square. */
export function derive(base: Allowed): Allowed {
  const out: Allowed = [...base];
  for (const unit of ["pct", "money", "plain"] as Unit[]) {
    const vals = [...new Set(base.filter((b) => b.unit === unit).map((b) => b.value))].slice(0, unit === "plain" ? 80 : 160);
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 1; j < vals.length; j++) {
        out.push({ value: Math.abs(vals[i] - vals[j]), unit });
        if (unit !== "plain") out.push({ value: vals[i] + vals[j], unit });
      }
    }
  }
  return out;
}

/** Does a written figure match a supplied one, at the precision it is written?
 *  "$90.3M" matches 90,317,701 because it is that number to one decimal of a
 *  million; "4.1%" does not match 4.32%. The window is set by the last digit
 *  WRITTEN, so "$0.23M" is judged to $10K whatever its size, and it is
 *  asymmetric: a rounded figure sits within half a unit of the truth either way,
 *  a truncated one ($477K for $477,562) up to a whole unit BELOW it. A whole unit
 *  either way would let "4.1%" match a count of 4. A unit must match: 7.5% is
 *  not $7.5M. */
export function matches(f: Figure, allowed: Allowed): boolean {
  const unit = 10 ** -f.decimals * f.scale;
  const slack = Math.max(unit * 1e-9, Math.abs(f.value) * (f.unit === "money" ? 0.0005 : 1e-6));
  for (const a of allowed) {
    if (f.unit !== "plain" && a.unit !== "plain" && a.unit !== f.unit) continue;
    // How far the supplied magnitude sits above the written one.
    const above = Math.abs(a.value) - Math.abs(f.value);
    if (above >= -unit / 2 - slack && above < unit + slack) return true;
  }
  return false;
}

/** Small counts, years and list positions are not magnitude claims. */
function exempt(f: Figure): boolean {
  if (f.unit !== "plain") return false;
  if (Number.isInteger(f.value) && Math.abs(f.value) <= 12) return true;
  if (Number.isInteger(f.value) && f.value >= 1900 && f.value <= 2100) return true;
  return false;
}

/** Dates are not magnitude claims: "since 29 Dec", "week ending 3 May 2026",
 *  "2026-05-03". Removed before checking so a day of the month is not flagged. */
const DATES = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:\s+\d{4})?/gi;

/** Check every number in the declared citations AND the prose. A model can cite
 *  correctly and still write a derived figure into its text; prose is what a
 *  planner reads, so it is checked too. This catches invented magnitudes, not a
 *  wrong claim built from right numbers. */
export function verifyCitations(payload: unknown, cited: string[], prose: string[] = []) {
  const allowed = derive(payloadFigures(payload));
  const unmatched = new Set<string>();
  const check = (text: string, label: string) => {
    for (const f of extractFigures(String(text).replace(DATES, " "))) {
      if (exempt(f)) continue;
      if (!matches(f, allowed)) unmatched.add(`${label}: ${f.raw}`);
    }
  };
  for (const c of cited) check(c, "cited");
  for (const p of prose) check(p, "prose");
  return { verified: unmatched.size === 0, unmatched: [...unmatched] };
}

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
