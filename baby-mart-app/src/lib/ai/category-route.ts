// ─── The Category Agent's one entry: which agent answers a question ──────────
//
// /agent fronts two agents for the Category Manager. A lookup ("top 5 brands by
// growth", "Huggies promotion mechanics") goes to CATEGORY_MANAGER_AGENT, text to
// SQL over the category semantic view. "Why did <brand> move?" goes to
// BRAND_INVESTIGATOR_AGENT, which tests every candidate cause on POS and has its
// figures checked. Asked of the text-to-SQL agent, that question got a confident
// wrong answer: it compared ten months of FY2026 with a full FY2025 and called the
// gap a market-wide decline (Bugaboo "-17.6%, every pram brand -13 to -18%";
// like-for-like Bugaboo -4.5% and the rest of the class -0.9%).
//
// Pure, so the rules are tested (category-route.test.ts).

export type CategoryMode = "auto" | "lookup" | "investigate";
export type CategoryRoute = "lookup" | "investigate";

/** Asks what caused a move, not what the numbers are. */
const DIAGNOSIS =
  /\b(why|what(?:'s| is| was)? (?:drove|drives|driving|driven|caused|causing|behind)|what is driving|root cause|explain|drivers? of|reason for|spike|surge|slump|collapse)\b/i;

/** Ranking and listing questions stay lookups even when they say "why". */
const LOOKUP = /\b(top \d+|top|which|list|how many|rank|show me|compare|breakdown|by (?:state|store|class|category|mechanic|segment|week|month))\b/i;

/** A brand the question names, longest name first so "Bonds Baby" beats "Bonds".
 *  Matched on word edges, case-insensitive; "+" and "-" in names are literal. */
export function namedBrand(question: string, brands: readonly string[]): string | null {
  const q = ` ${question.toLowerCase()} `;
  const sorted = [...brands].sort((a, b) => b.length - a.length);
  for (const b of sorted) {
    const name = b.toLowerCase().trim();
    if (!name) continue;
    const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i");
    if (re.test(q)) return b;
  }
  return null;
}

/** Route one question.
 *
 *  - An explicit mode wins.
 *  - A diagnosis question that names one brand is an investigation, unless it is
 *    a ranking ("which brands are down, and why?" is a lookup across brands).
 *  - A follow-up that names no brand and is not a lookup stays with the agent
 *    that answered the last turn: "what about the prior 28 days?" after an
 *    investigation continues the investigation thread.
 *  - With no brand list (it failed to load) a diagnosis question still goes to
 *    the investigator, which returns the valid brands if the name is wrong. */
export function routeCategoryQuestion(
  question: string,
  opts: { brands: readonly string[]; mode?: CategoryMode; previous?: CategoryRoute | null },
): { route: CategoryRoute; brand: string | null } {
  const brand = namedBrand(question, opts.brands);
  if (opts.mode === "lookup" || opts.mode === "investigate") return { route: opts.mode, brand };

  const diagnosis = DIAGNOSIS.test(question);
  const lookup = LOOKUP.test(question);
  if (diagnosis && !lookup && (brand || opts.brands.length === 0)) return { route: "investigate", brand };
  if (!brand && !lookup && opts.previous === "investigate") return { route: "investigate", brand };
  return { route: "lookup", brand };
}

/** The question an "Investigate <brand>" button asks the investigator. */
export const investigateQuestion = (brand: string) => `Why has ${brand} moved against last year?`;
