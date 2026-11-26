// ─── The Supplier Meeting: one brand, facts -> plan -> approve ────────────────
//
// /meeting/<brand> merges what were the Battlecards and the Negotiation Brief
// pages. Every figure on it comes from AI.NEGOTIATION_EVIDENCE (sql/48): the facts
// tiles directly, the battlecard's arguments worded from it (sql/09, words only),
// and the brief sized from it (BUILD_NEGOTIATION_BRIEF). This file holds the
// shapes the page and the printable pack share, and the small pure rules they
// both apply.

export type Evidence = {
  ok: boolean; brand: string; category: string; supplier: string; distributor: string | null; period: string;
  weeks_traded: number; annualise_factor: number;
  sales: {
    revenue_aud: number; margin_aud: number; units: number; margin_pct: number | null; margin_pct_category: number | null;
    margin_gap_pp: number | null; margin_gap_aud: number | null; revenue_growth_pct: number | null; category_growth_pct: number | null;
    share_pct: number | null; share_change_pts: number | null; rank_in_category: number; brands_in_category: number;
  };
  promo: { promo_discount_ytd_aud: number | null; promo_discount_annual_aud: number | null; margin_per_aud_discount: number | null; best_mechanic: string | null };
  switching: { gained: number | null; lost: number | null; net: number | null; top_loss_to: string | null; top_loss_to_count: number | null };
  price_vs_competitors_pct: number | null;
  difot: null | {
    distributor: string; target_pct: number; recent_difot_pct: number | null; before_difot_pct: number | null;
    gap_to_target_pts: number | null; attribution: string; ours_share_pct: number | null;
    missed_lines: number; missed_lines_supplier: number; missed_lines_ours: number; window: string;
  };
  customers?: { clv_aud: number | null; customers: number | null };
  rate_of_sale?: { brand: number | null; category: number | null };
  geography?: { top_state: string; top_state_share_pct: number | null } | null;
  range?: { class: string; share_pct: number | null }[];
  overrides: { override_id: string; class: string; status: string }[];
  provenance: string;
};

export type KeyArgument = { name: string; description: string; data: string; argument: string; ask: string; impact: number };
/** The Head of Department's negotiation SOP a battlecard or brief was written to. */
export type Sop = { name: string; version: number; updated_by?: string | null; updated_at?: string | null; sections?: string[] };
export type Battlecard = {
  key_arguments: { profitability: KeyArgument[]; growth: KeyArgument[]; others: KeyArgument[] } | null;
  negotiation_approach: string | null; incentives: string[] | null; pressures: string[] | null;
  check?: { verified: boolean; unmatched: string[] };
  sop?: Sop | null;
};

export type BriefRow = {
  briefId: string; brand: string; supplier: string; category: string; stance: string; status: string; createdAt: string;
  openingAud: number | null; targetAud: number | null; walkawayAud: number | null;
  approvedBy?: string | null; approvedAt?: string | null; note?: string | null;
  levers?: { kind: string; label: string; basis?: string }[]; guardrails?: { level: string; message: string }[];
  sop?: Sop | null;
  rules?: { stance: string; target_share: number; walkaway_share: number; promo_fund_opening_pct: number; difot_credit_pct: number } | null;
  asks: { askId: string; kind: string; direction: string; label: string; basis?: string;
    openingAud: number | null; targetAud: number | null; walkawayAud: number | null }[];
};

export type Stance = "COLLABORATIVE" | "BALANCED" | "FIRM";

export const STANCES: { value: Stance; label: string; title: string }[] = [
  { value: "COLLABORATIVE", label: "Collaborative", title: "Target keeps 45% of each opening ask" },
  { value: "BALANCED", label: "Balanced", title: "Target keeps 60% of each opening ask" },
  { value: "FIRM", label: "Firm", title: "Target keeps 75% of each opening ask" },
];

/** The request the stance picker sends the brief agent. The stance is named in
 *  the tool's own vocabulary so the agent passes it through unchanged. */
export function briefRequest(brand: string, stance: Stance, supplier?: string | null): string {
  return `Build a ${stance} negotiation brief for our ${brand} meeting${supplier ? ` with ${supplier}` : ""}.`;
}

// ─── House rules: the negotiation rules and the SOP ───────────────────────────
//
// The brief is sized by NEGOTIATION_SETTING (Settings > Negotiation rules) and
// written to the "Supplier negotiation prep" SOP (Settings > SOP & Templates).
// RULE_META is how Settings shows each rule; the ranges match
// SAVE_NEGOTIATION_SETTING (sql/48), which is what actually enforces them.

export type NegotiationRule = { key: string; value: number | null; label?: string | null; description?: string | null;
  updatedBy?: string | null; updatedAt?: string | null };
export type RuleChange = { key: string; oldValue: number | null; newValue: number | null; changedBy: string; changedAt: string; note?: string | null };

export type RuleMeta = { key: string; group: "Stance" | "Ask sizing" | "Guardrails"; label: string; hint: string;
  /** "share" is stored 0-1 and shown as a percentage; "pct" is stored as a percentage. */
  unit: "share" | "pct"; min: number; max: number };

export const RULE_META: RuleMeta[] = [
  { key: "TARGET_SHARE_COLLABORATIVE", group: "Stance", label: "Collaborative: target keeps", hint: "of each opening ask", unit: "share", min: 0.05, max: 1 },
  { key: "TARGET_SHARE_BALANCED", group: "Stance", label: "Balanced: target keeps", hint: "of each opening ask", unit: "share", min: 0.05, max: 1 },
  { key: "TARGET_SHARE_FIRM", group: "Stance", label: "Firm: target keeps", hint: "of each opening ask", unit: "share", min: 0.05, max: 1 },
  { key: "WALKAWAY_SHARE", group: "Stance", label: "Walk away below", hint: "of the opening (margin and promo asks)", unit: "share", min: 0, max: 0.95 },
  { key: "PROMO_FUND_OPENING_PCT", group: "Ask sizing", label: "Supplier co-funds", hint: "of our promotional discount (opening ask)", unit: "pct", min: 0, max: 100 },
  { key: "DIFOT_CREDIT_PCT", group: "Ask sizing", label: "DIFOT compliance credit", hint: "of the purchase value the supplier missed", unit: "pct", min: 0, max: 20 },
  { key: "DEPENDENCY_SHARE_PCT", group: "Guardrails", label: "Category depends on a brand at", hint: "share or more (warns against a firm stance)", unit: "pct", min: 5, max: 100 },
];

/** A rule's stored value as the percentage Settings shows, and back. */
export const ruleToPct = (m: Pick<RuleMeta, "unit">, v: number) => Math.round((m.unit === "share" ? v * 100 : v) * 100) / 100;
export const pctToRule = (m: Pick<RuleMeta, "unit">, pctValue: number) => (m.unit === "share" ? pctValue / 100 : pctValue);

export const ruleValue = (rules: NegotiationRule[], key: string): number | null => rules.find((r) => r.key === key)?.value ?? null;

/** What the stance picker says a stance does, from the live rules. */
export function stanceTitle(stance: Stance, rules: NegotiationRule[]): string {
  const t = ruleValue(rules, `TARGET_SHARE_${stance}`), w = ruleValue(rules, "WALKAWAY_SHARE");
  if (t === null) return STANCES.find((s) => s.value === stance)!.title;
  return `Target keeps ${Math.round(t * 100)}% of each opening ask${w !== null ? `; walk away below ${Math.round(w * 100)}%` : ""}`;
}

/** "Supplier negotiation prep v3" */
export const sopLabel = (sop: Sop | null | undefined) => (sop ? `${sop.name} v${sop.version}` : null);

/** The SOP & template the battlecard and the brief are written to (sql/09, sql/48). */
export const SOP_NAME = "Supplier negotiation prep";
export const SOP_HREF = `/settings?template=${encodeURIComponent(SOP_NAME)}`;
export const RULES_HREF = "/settings?tab=negotiation";

/** A kept battlecard is reused only while it was written to the SOP version in
 *  force: edit the SOP, come back, and the arguments are written again. */
export const cardIsCurrent = (card: Pick<Battlecard, "sop"> | null, liveVersion: number | null) =>
  !!card && (card.sop?.version ?? null) === liveVersion;

/** The brief the meeting runs on: the newest that is approved or in draft. A
 *  draft built after an approval is the meeting being re-prepared, so it wins and
 *  shows as not yet approved. Superseded and reset briefs are history only. */
export function currentBrief(briefs: BriefRow[]): BriefRow | null {
  return briefs.filter((b) => b.status === "APPROVED" || b.status === "DRAFT")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

/** Where a brand's battlecard is kept, so returning to the page and opening the
 *  pack (a new tab, which does not share sessionStorage) show the same wording.
 *  localStorage with a 12-hour life; "Rewrite arguments" replaces it. */
export const cardKey = (brand: string) => `meeting-card:${brand.toLowerCase()}`;
const CARD_TTL_MS = 12 * 3600 * 1000;

export function readCard<T>(brand: string, now = Date.now()): T | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(cardKey(brand)) : null;
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; card?: T };
    return v.at && now - v.at < CARD_TTL_MS && v.card ? v.card : null;
  } catch { return null; }
}

export function saveCard(brand: string, card: unknown, now = Date.now()) {
  try { window.localStorage.setItem(cardKey(brand), JSON.stringify({ at: now, card })); } catch { /* storage full or blocked */ }
}

/** Every string a battlecard shows, for the figure check. */
export function cardText(card: Pick<Battlecard, "key_arguments" | "negotiation_approach" | "incentives" | "pressures">): string[] {
  const out: string[] = [];
  const groups = card.key_arguments ? [card.key_arguments.profitability, card.key_arguments.growth, card.key_arguments.others] : [];
  for (const g of groups) for (const a of g ?? []) out.push(a.name, a.description, a.data, a.argument, a.ask);
  if (card.negotiation_approach) out.push(card.negotiation_approach);
  out.push(...(card.incentives ?? []), ...(card.pressures ?? []));
  return out.filter((s) => typeof s === "string" && s.length > 0);
}

/** AUD for a fact tile: whole dollars below 100K, else K or M. */
export function audShort(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "–";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}AUD ${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `${sign}AUD ${(a / 1e3).toFixed(0)}K`;
  return `${sign}AUD ${Math.round(a).toLocaleString("en-AU")}`;
}

export const pct = (v: number | null | undefined, signed = false) =>
  typeof v === "number" && Number.isFinite(v) ? `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%` : "–";
export const pts = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)} pts` : "–";

export type Tile = { key: string; label: string; value: string; sub: string; tone?: "warn" | "good" };

/** The facts step: the evidence as tiles, the same on the page and in the pack.
 *  Nothing here is computed beyond formatting: each value is one evidence field. */
export function factTiles(e: Evidence): Tile[] {
  const s = e.sales, d = e.difot, t: Tile[] = [];
  t.push({ key: "sales", label: "Sales, FY2026 to date", value: audShort(s.revenue_aud),
    sub: `#${s.rank_in_category} of ${s.brands_in_category} in ${e.category} · ${pct(s.share_pct)} share` });
  t.push({ key: "margin", label: "Margin vs category", value: pct(s.margin_pct),
    sub: `category ${pct(s.margin_pct_category)} · gap ${pts(s.margin_gap_pp)}`,
    tone: (s.margin_gap_pp ?? 0) <= -0.3 ? "warn" : undefined });
  t.push({ key: "growth", label: "Growth vs same weeks last year", value: pct(s.revenue_growth_pct, true),
    sub: `category ${pct(s.category_growth_pct, true)} · share ${pts(s.share_change_pts)}`,
    tone: s.revenue_growth_pct !== null && s.category_growth_pct !== null && s.revenue_growth_pct < s.category_growth_pct ? "warn" : undefined });
  if (d) {
    const ours = d.attribution === "BABY_MART";
    t.push({ key: "difot", label: "Supplier DIFOT since 6 April", value: pct(d.recent_difot_pct),
      sub: `target ${d.target_pct}% · ${ours ? `${pct(d.ours_share_pct)} of misses are our ordering` : `${d.missed_lines_supplier} of ${d.missed_lines} missed lines the supplier's`}`,
      tone: ours ? "warn" : (d.recent_difot_pct ?? 100) < d.target_pct ? "warn" : "good" });
  }
  t.push({ key: "promo", label: "Promotional discount, FY to date", value: audShort(e.promo.promo_discount_ytd_aud),
    sub: e.promo.margin_per_aud_discount !== null ? `AUD ${e.promo.margin_per_aud_discount} margin per AUD 1 of discount` : "no promotions" });
  if (e.price_vs_competitors_pct !== null)
    t.push({ key: "price", label: "Shelf price vs competitors", value: pct(e.price_vs_competitors_pct, true),
      sub: e.price_vs_competitors_pct > 0 ? "Baby Mart is dearer" : "Baby Mart is cheaper" });
  if (e.switching.net !== null)
    t.push({ key: "switching", label: "Net brand switching", value: `${e.switching.net > 0 ? "+" : ""}${e.switching.net.toLocaleString("en-AU")}`,
      sub: e.switching.top_loss_to ? `most lost to ${e.switching.top_loss_to} (${e.switching.top_loss_to_count})` : "customers gained less lost" });
  if (e.customers?.clv_aud)
    t.push({ key: "clv", label: "Customer lifetime value", value: audShort(e.customers.clv_aud),
      sub: `across ${(e.customers.customers ?? 0).toLocaleString("en-AU")} customers` });
  return t;
}

/** A planner override inflating the brand's demand feed: never cite it as growth. */
export function overrideWarning(e: Evidence): string | null {
  const active = (e.overrides ?? []).filter((o) => o.status === "ACTIVE");
  if (!active.length) return null;
  return `${active.length} active planner override${active.length > 1 ? "s" : ""} on ${active[0].class} (${active.map((o) => o.override_id).join(", ")}) inflate the demand feed: do not cite that spike as growth.`;
}
