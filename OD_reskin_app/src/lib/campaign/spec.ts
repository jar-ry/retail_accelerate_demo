// ─── OneDigital Campaign Manager: audience spec (pure) ─────────────────────────────────────
//
// An audience is a JSON spec, never SQL. Whoever writes it -- the filter panel,
// the natural-language builder (AI_COMPLETE), an idea card, the agent -- the spec
// is validated here against the field allow-list in ./config.ts and compiled to
// a WHERE clause whose every value is a bound `?`. Field names are checked against
// the list and are the only text spliced; a field the list does not hold, an
// operator outside OPS, or a value of the wrong type is a validation error with a
// message a person can act on, not a partially applied filter.
//
// The same shape is stored on AUDIENCE.SPEC, including for the modelled history
// (od_43), so a past audience can be re-sized today with the same compiler.
//
// A spec that filters on a Bunnings or Kmart field always carries the OnePass
// data-sharing consent rule: it is added here, not left to whoever wrote the
// spec, and cannot be switched off.

import { FIELDS, PERSONAL_CHANNELS, CHANNELS, CROSS_BANNER_FIELDS, type ChannelCode, type Quadrant, QUADRANTS } from "./config";

export const OPS = ["in", "not_in", "eq", "gte", "lte", "between", "is_true", "is_false"] as const;
export type Op = (typeof OPS)[number];

export type Condition = {
  field: string;
  op: Op;
  values?: (string | number)[];
  value?: string | number | boolean;
  min?: number;
  max?: number;
};

export type AudienceSpec = {
  version: 1;
  /** Every condition must hold. */
  all: Condition[];
  /** When non-empty, at least one must hold. */
  any: Condition[];
  /** A member matching any of these is left out. */
  exclude: Condition[];
  suppress: {
    /** Leave out anyone contacted by a campaign in the last N days. */
    fatigueDays: number | null;
    /** Leave out members with no sign of needing what the campaign sells who
     *  have never shopped at Officeworks: contact lowers their buying. */
    coldContacts: boolean;
    /** Leave out anyone whose home store is short of the promoted brand. */
    stockConflict: boolean;
  };
  channels: ChannelCode[];
  promoted: { category: string | null; className: string | null; brand: string | null };
  /** Restrict to these uplift quadrants for the promoted track. Null: everyone. */
  quadrants?: Quadrant[] | null;
  /** Keep only the customers most like a seed: the converters of a past campaign
   *  (cosine similarity on standardised purchase features). */
  lookalike?: { seedCampaignId: string; topN: number } | null;
  /** Keep at most this many reachable members, best expected uplift first. */
  cap?: number | null;
};

export function emptySpec(): AudienceSpec {
  return {
    version: 1, all: [], any: [], exclude: [],
    suppress: { fatigueDays: 14, coldContacts: true, stockConflict: true },
    channels: ["EMAIL", "SMS"], promoted: { category: null, className: null, brand: null }, quadrants: null, cap: null,
  };
}

export class SpecError extends Error {}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const MAX_VALUES = 40;
const MAX_CONDITIONS = 25;

function checkCondition(c: unknown, where: string): Condition {
  if (!c || typeof c !== "object") throw new SpecError(`${where}: each condition must be an object.`);
  const raw = c as Record<string, unknown>;
  const field = raw.field;
  if (!isStr(field) || !Object.hasOwn(FIELDS, field)) throw new SpecError(`${where}: '${String(field)}' is not a field audiences can filter on.`);
  const def = FIELDS[field];
  const op = raw.op;
  if (!isStr(op) || !(OPS as readonly string[]).includes(op)) throw new SpecError(`${where}: '${String(op)}' is not a supported comparison.`);
  const label = def.label;
  if (def.kind === "bool") {
    if (op === "is_true" || op === "is_false") return { field, op };
    if (op === "eq" && typeof raw.value === "boolean") return { field, op: raw.value ? "is_true" : "is_false" };
    throw new SpecError(`${where}: ${label} is yes/no; use is_true or is_false.`);
  }
  if (def.kind === "enum") {
    if (op === "eq" && isStr(raw.value)) return checkCondition({ field, op: "in", values: [raw.value] }, where);
    if (op !== "in" && op !== "not_in") throw new SpecError(`${where}: ${label} is a list; use in or not_in.`);
    const values = raw.values;
    if (!Array.isArray(values) || values.length === 0) throw new SpecError(`${where}: ${label} needs at least one value.`);
    if (values.length > MAX_VALUES) throw new SpecError(`${where}: ${label} has too many values.`);
    for (const v of values) {
      if (!isStr(v)) throw new SpecError(`${where}: ${label} values must be text.`);
      if (def.options && !def.options.includes(v)) throw new SpecError(`${where}: '${v}' is not a value of ${label}. Allowed: ${def.options.join(", ")}.`);
    }
    return { field, op, values: [...new Set(values as string[])] };
  }
  // number
  if (op === "between") {
    if (!isNum(raw.min) || !isNum(raw.max)) throw new SpecError(`${where}: ${label} between needs numeric min and max.`);
    if (raw.min > raw.max) throw new SpecError(`${where}: ${label} min is above max.`);
    return { field, op, min: raw.min, max: raw.max };
  }
  if (op === "gte" || op === "lte" || op === "eq") {
    if (!isNum(raw.value)) throw new SpecError(`${where}: ${label} needs a numeric value.`);
    return { field, op, value: raw.value };
  }
  throw new SpecError(`${where}: ${label} is a number; use gte, lte, eq or between.`);
}

function checkList(v: unknown, where: string): Condition[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new SpecError(`${where} must be a list of conditions.`);
  if (v.length > MAX_CONDITIONS) throw new SpecError(`${where} has more than ${MAX_CONDITIONS} conditions.`);
  return v.map((c, i) => checkCondition(c, `${where} #${i + 1}`));
}

/** Validate anything claiming to be a spec. Returns a normalised copy. */
export function validateSpec(input: unknown): AudienceSpec {
  const raw = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new SpecError("An audience spec must be an object.");
  const s = (raw.suppress ?? {}) as Record<string, unknown>;
  const fatigue = s.fatigueDays === null || s.fatigueDays === undefined ? null : Number(s.fatigueDays);
  if (fatigue !== null && (!Number.isInteger(fatigue) || fatigue < 0 || fatigue > 365)) throw new SpecError("The fatigue window must be 0 to 365 days.");
  const channels = Array.isArray(raw.channels) ? raw.channels : [];
  for (const c of channels) if (!(CHANNELS as readonly string[]).includes(String(c))) throw new SpecError(`'${String(c)}' is not a channel.`);
  const p = (raw.promoted ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (v === null || v === undefined || v === "" ? null : isStr(v) && v.length <= max ? v : (() => { throw new SpecError("Promoted product fields must be short text."); })());
  const quadrants = raw.quadrants === null || raw.quadrants === undefined ? null : raw.quadrants;
  if (quadrants !== null) {
    if (!Array.isArray(quadrants) || quadrants.some((q) => !(QUADRANTS as readonly string[]).includes(String(q)))) throw new SpecError("Unknown uplift quadrant.");
  }
  const cap = raw.cap === null || raw.cap === undefined ? null : Number(raw.cap);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 500000)) throw new SpecError("The audience cap must be a whole number from 1 to 500,000.");
  let lookalike: AudienceSpec["lookalike"] = null;
  if (raw.lookalike !== null && raw.lookalike !== undefined) {
    const l = raw.lookalike as Record<string, unknown>;
    const topN = Number(l.topN);
    if (!isStr(l.seedCampaignId) || !/^[A-Za-z0-9_-]{1,40}$/.test(l.seedCampaignId)) throw new SpecError("A lookalike needs the id of a seed campaign.");
    if (!Number.isInteger(topN) || topN < 100 || topN > 100000) throw new SpecError("A lookalike keeps 100 to 100,000 customers.");
    lookalike = { seedCampaignId: l.seedCampaignId, topN };
  }
  return {
    version: 1,
    all: checkList(raw.all, "All of"),
    any: checkList(raw.any, "Any of"),
    exclude: checkList(raw.exclude, "Exclude"),
    suppress: {
      fatigueDays: fatigue,
      coldContacts: s.coldContacts === true,
      stockConflict: s.stockConflict === true,
    },
    channels: [...new Set(channels as ChannelCode[])],
    promoted: { category: text(p.category, 60), className: text(p.className, 60), brand: text(p.brand, 60) },
    quadrants: quadrants as Quadrant[] | null,
    lookalike,
    cap,
  };
}

function conditionSql(c: Condition, binds: unknown[]): string {
  // The field is from the allow-list (checked above), so it is safe as an identifier.
  const col = c.field;
  switch (c.op) {
    case "in":
    case "not_in": {
      const vals = c.values ?? [];
      binds.push(...vals);
      const list = vals.map(() => "?").join(", ");
      return c.op === "in" ? `${col} IN (${list})` : `(${col} IS NULL OR ${col} NOT IN (${list}))`;
    }
    case "eq": binds.push(c.value); return `${col} = ?`;
    case "gte": binds.push(c.value); return `${col} >= ?`;
    case "lte": binds.push(c.value); return `${col} <= ?`;
    case "between": binds.push(c.min, c.max); return `${col} BETWEEN ? AND ?`;
    case "is_true": return `COALESCE(${col}, FALSE)`;
    case "is_false": return `NOT COALESCE(${col}, FALSE)`;
  }
}

/** The WHERE clause that selects who MATCHES the spec, before consent and
 *  suppression. Applied to the customer 360 base (see sql.ts C360). */
export function compileMatch(spec: AudienceSpec): { where: string; binds: unknown[] } {
  const binds: unknown[] = [];
  const parts: string[] = [];
  for (const c of spec.all) parts.push(conditionSql(c, binds));
  if (spec.any.length) parts.push(`(${spec.any.map((c) => conditionSql(c, binds)).join(" OR ")})`);
  for (const c of spec.exclude) parts.push(`NOT COALESCE(${conditionSql(c, binds)}, FALSE)`);
  return { where: parts.length ? parts.join("\n  AND ") : "TRUE", binds };
}

/** Consent on at least one of the spec's personal channels. Paid social and
 *  in-store reach an audience, not a person, so they need no consent. */
export function compileReach(spec: AudienceSpec): string {
  const personal = spec.channels.filter((c) => PERSONAL_CHANNELS.includes(c));
  if (personal.length === 0) return spec.channels.length ? "TRUE" : "FALSE";
  const col: Record<string, string> = { EMAIL: "EMAIL_OPT_IN", SMS: "SMS_OPT_IN", PUSH: "PUSH_ENABLED" };
  return `(${personal.map((c) => `COALESCE(${col[c]}, FALSE)`).join(" OR ")})`;
}

/** The Bunnings and Kmart fields a spec filters on, in order of first use. */
export function crossBannerFields(spec: AudienceSpec): string[] {
  return [...new Set([...spec.all, ...spec.any, ...spec.exclude].map((c) => c.field).filter((f) => CROSS_BANNER_FIELDS.includes(f)))];
}

/** The suppression rules, each as its own boolean expression so the page can say
 *  how many each one removed. The stock rule needs the promoted brand bound.
 *  NEED is the member's need state for the promoted track (audience-core.ts). */
export function compileSuppress(spec: AudienceSpec, supplyTable: string): { key: string; label: string; sql: string; binds: unknown[] }[] {
  const out: { key: string; label: string; sql: string; binds: unknown[] }[] = [];
  // A lookalike reads every banner's purchases, so it needs the consent as well.
  const needsConsent = crossBannerFields(spec).length > 0 || !!spec.lookalike;
  if (needsConsent) {
    out.push({ key: "consent", label: "No OnePass data-sharing consent (Bunnings or Kmart signal used)", sql: "NOT COALESCE(GROUP_DATA_CONSENT, FALSE)", binds: [] });
  }
  if (spec.suppress.fatigueDays !== null && spec.suppress.fatigueDays > 0) {
    out.push({ key: "fatigue", label: `Contacted in the last ${spec.suppress.fatigueDays} days`, sql: "DAYS_SINCE_CONTACT < ?", binds: [spec.suppress.fatigueDays] });
  }
  if (spec.suppress.coldContacts) {
    // Without consent the signals are hidden and everyone looks cold; the consent
    // rule already removes them, so this one counts only consented members.
    out.push({ key: "cold", label: "No sign of need and never shopped at Officeworks",
      sql: needsConsent ? "NEED = 'NO_SIGNAL_COLD' AND COALESCE(GROUP_DATA_CONSENT, FALSE)" : "NEED = 'NO_SIGNAL_COLD'", binds: [] });
  }
  if (spec.suppress.stockConflict && spec.promoted.brand) {
    out.push({ key: "stock", label: `Home store short of ${spec.promoted.brand}`,
      sql: `COALESCE(HOME_STORE_CODE, '-') IN (SELECT STORE_CODE FROM ${supplyTable} WHERE BRAND_NAME = ? AND STATUS = 'SHORT')`, binds: [spec.promoted.brand] });
  }
  return out;
}

/** A stable hash input: the normalised spec, keys in a fixed order. */
export function canonicalSpec(spec: AudienceSpec): string {
  return JSON.stringify(validateSpec(spec));
}

/** A one-line description of a spec for cards and the audit trail. */
export function describeSpec(spec: AudienceSpec): string {
  const say = (c: Condition) => {
    const label = FIELDS[c.field]?.label ?? c.field;
    switch (c.op) {
      case "in": return `${label}: ${(c.values ?? []).join(", ")}`;
      case "not_in": return `${label} not ${(c.values ?? []).join(", ")}`;
      case "eq": return `${label} = ${c.value}`;
      case "gte": return `${label} ≥ ${c.value}`;
      case "lte": return `${label} ≤ ${c.value}`;
      case "between": return `${label} ${c.min}–${c.max}`;
      case "is_true": return label;
      case "is_false": return `not ${label.toLowerCase()}`;
    }
  };
  const parts = [...spec.all.map(say)];
  if (spec.any.length) parts.push(`any of (${spec.any.map(say).join("; ")})`);
  if (spec.exclude.length) parts.push(`excluding ${spec.exclude.map(say).join("; ")}`);
  return parts.join(" · ") || "Everyone";
}
