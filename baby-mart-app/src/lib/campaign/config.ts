// ─── Campaign & CRM: configuration (client-safe) ─────────────────────────────
//
// Constants only. The schema name lives in ./schema.ts, which is server-only:
// importing the Snowflake driver here would drag it into every page bundle.

/** The demo clock. Purchases end on 7 May 2026; the server reads the date from
 *  CMP_SETTING (CMP_AS_OF()), and this copy is only for labels. */
export const AS_OF_LABEL = "7 May 2026";

export const STATUSES = [
  "IDEA", "BRIEF", "AUDIENCE_LOCKED", "CONTENT_APPROVED", "SCHEDULED", "LIVE", "PAUSED", "COMPLETED", "MEASURED", "CANCELLED",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  IDEA: "Idea", BRIEF: "Brief", AUDIENCE_LOCKED: "Audience locked", CONTENT_APPROVED: "Content approved",
  SCHEDULED: "Scheduled", LIVE: "Live", PAUSED: "Paused", COMPLETED: "Completed", MEASURED: "Measured", CANCELLED: "Cancelled",
};

/** Which of the four stages a status belongs to, for the pipeline view. */
export const STAGE_OF: Record<Status, 1 | 2 | 3 | 4> = {
  IDEA: 1, BRIEF: 1, AUDIENCE_LOCKED: 2, CONTENT_APPROVED: 3, SCHEDULED: 3, LIVE: 4, PAUSED: 4, COMPLETED: 4, MEASURED: 4, CANCELLED: 4,
};

export const STAGES = [
  { n: 1, key: "ideation", label: "Ideation", blurb: "Signals in the data and the voice, turned into grounded campaign ideas.", href: "/campaigns/ideas" },
  { n: 2, key: "audience", label: "Audience", blurb: "Who to target, who to leave alone, and a holdout to prove it worked.", href: "/campaigns/audiences" },
  { n: 3, key: "content", label: "Content & channels", blurb: "Copy for every channel, checked, and the channel each member gets.", href: "/campaigns/studio" },
  { n: 4, key: "performance", label: "Performance", blurb: "Lift against the holdout, live alerts, root cause and what we learned.", href: "/campaigns/performance" },
] as const;

export const CHANNELS = ["EMAIL", "SMS", "PUSH", "PAID_SOCIAL", "IN_STORE"] as const;
export type ChannelCode = (typeof CHANNELS)[number];
export const PERSONAL_CHANNELS: ChannelCode[] = ["EMAIL", "SMS", "PUSH"];

export const CHANNEL_LABEL: Record<ChannelCode, string> = {
  EMAIL: "Email", SMS: "SMS", PUSH: "App push", PAID_SOCIAL: "Paid social", IN_STORE: "In-store",
};

/** Consent column a personal channel needs. */
export const CONSENT_FIELD: Partial<Record<ChannelCode, string>> = { EMAIL: "EMAIL_OPT_IN", SMS: "SMS_OPT_IN", PUSH: "PUSH_ENABLED" };

export const SMS_MAX = 160;
export const PUSH_TITLE_MAX = 50;
export const PUSH_BODY_MAX = 110;
export const SUBJECT_MAX = 70;
export const SOCIAL_MAX = 280;
export const INSTORE_MAX = 90;

export const PROVENANCE = ["REAL", "GENERATED", "MODELLED", "SYNTHETIC", "SIMULATED", "AI"] as const;
export type Provenance = (typeof PROVENANCE)[number];
export const PROVENANCE_HINT: Record<Provenance, string> = {
  REAL: "From Baby Mart's point-of-sale transactions.",
  GENERATED: "From the generated customer profile (segment, tier, state); not reconciled to purchases.",
  MODELLED: "Modelled: consent, stock position and past campaign responses follow stated rules, not observed data.",
  SYNTHETIC: "Synthetic customer voice built from a phrase library on real purchases.",
  SIMULATED: "Produced by the campaign simulator for a campaign launched in this app.",
  AI: "Written or read by AI_COMPLETE; numbers are checked against the figures supplied.",
};

export const QUADRANTS = ["PERSUADABLE", "SURE_THING", "LOST_CAUSE", "SLEEPING_DOG"] as const;
export type Quadrant = (typeof QUADRANTS)[number];
export const QUADRANT_LABEL: Record<Quadrant, string> = {
  PERSUADABLE: "Persuadables", SURE_THING: "Sure things", LOST_CAUSE: "Lost causes", SLEEPING_DOG: "Sleeping dogs",
};
export const QUADRANT_HINT: Record<Quadrant, string> = {
  PERSUADABLE: "Buy more when contacted. Target these.",
  SURE_THING: "Buy anyway. Contact is wasted spend, and an offer is a discount given away.",
  LOST_CAUSE: "Unlikely to buy either way.",
  SLEEPING_DOG: "Buy LESS when contacted, and unsubscribe or complain. Leave them alone.",
};

export const THEMES = [
  "Out of stock", "Product quality and safety", "Price and value", "Staff and expert advice", "Delivery and click and collect",
  "Returns and refunds", "Range and choice", "Store experience", "App and website", "Promotions and offers",
] as const;

export const CHILD_STAGES = ["EXPECTING", "NEWBORN_0_3M", "INFANT_3_12M", "TODDLER_1_3Y", "PRESCHOOL_3_5Y", "SCHOOL_5_PLUS", "UNKNOWN"] as const;
export const CHILD_STAGE_LABEL: Record<string, string> = {
  EXPECTING: "Expecting", NEWBORN_0_3M: "Newborn (0-3m)", INFANT_3_12M: "Infant (3-12m)", TODDLER_1_3Y: "Toddler (1-3y)",
  PRESCHOOL_3_5Y: "Preschool (3-5y)", SCHOOL_5_PLUS: "School age", MULTIPLE: "More than one", UNKNOWN: "Unknown",
};

export const CATEGORIES = ["Nappies & Wipes", "Car Seats", "Feeding", "Prams & Strollers", "Clothing"] as const;

export const INTENT_LABEL: Record<string, string> = {
  CAR_SEAT_UPGRADE: "Next car seat", PRAM_OR_STROLLER: "Pram or stroller", FEEDING: "Feeding",
  NAPPY_STAGE_CHANGE: "Next nappy size", NURSERY_OR_CLOTHING: "Nursery or clothing", NONE: "None",
};

// ─── Audience field catalogue ──────────────────────────────────────────────
//
// The allow-list an audience spec may filter on. Both the hand-built filters and
// the natural-language builder go through it: a field that is not here cannot
// reach SQL, and every value is bound, never spliced.

export type FieldKind = "enum" | "number" | "bool";
export type FieldDef = {
  label: string; kind: FieldKind; group: string; provenance: Provenance; options?: readonly string[]; hint?: string;
};

const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
const DUE = ["DUE_NOW", "DUE_SOON", "LATER", "PASSED"] as const;

export const FIELDS: Record<string, FieldDef> = {
  CHILD_STAGE: { label: "Child stage", kind: "enum", group: "Life stage", provenance: "REAL", options: CHILD_STAGES,
    hint: "Inferred from the latest stage-coded purchase (nappy size, car seat, feeding) and the time since." },
  EST_CHILD_AGE_M: { label: "Child age (months, estimated)", kind: "number", group: "Life stage", provenance: "REAL" },
  MULTI_CHILD_OR_GIFT: { label: "More than one child, or a gift buyer", kind: "bool", group: "Life stage", provenance: "REAL" },
  NAPPY_NEXT_CLASS: { label: "Next nappy size", kind: "enum", group: "Life stage", provenance: "REAL", options: ["Crawler Nappies", "Toddler Nappies", "Pull-Ups"] },
  NAPPY_DUE_STATUS: { label: "Next nappy size due", kind: "enum", group: "Life stage", provenance: "REAL", options: DUE },
  CAR_SEAT_LAST_CLASS: { label: "Last car seat bought", kind: "enum", group: "Life stage", provenance: "REAL",
    options: ["Capsule (0-6m)", "Convertible (0-4y)", "Harness Booster", "Booster (4-8y)"] },
  CAR_SEAT_LAST_AGE_DAYS: { label: "Days since last car seat", kind: "number", group: "Life stage", provenance: "REAL" },
  CAR_SEAT_DUE_STATUS: { label: "Next car seat due", kind: "enum", group: "Life stage", provenance: "REAL", options: DUE },
  FEEDING_DUE_STATUS: { label: "Next feeding item due", kind: "enum", group: "Life stage", provenance: "REAL", options: DUE },
  PRAM_NO_CAR_SEAT: { label: "Bought a pram but no car seat", kind: "bool", group: "Life stage", provenance: "REAL" },
  RFM_SEGMENT: { label: "RFM segment", kind: "enum", group: "Value", provenance: "REAL",
    options: ["Champions", "Loyal", "Potential loyalist", "New", "Needs attention", "At risk", "Hibernating", "Lost", "No purchases"] },
  RECENCY_BAND: { label: "Last purchase", kind: "enum", group: "Value", provenance: "REAL", options: ["0-90d", "91-180d", "181-365d", "365d+", "NONE"] },
  RECENCY_DAYS: { label: "Days since last purchase", kind: "number", group: "Value", provenance: "REAL" },
  LINES_12M: { label: "Purchases in 12 months", kind: "number", group: "Value", provenance: "REAL" },
  SPEND_12M_AUD: { label: "Spend in 12 months ($)", kind: "number", group: "Value", provenance: "REAL" },
  AOV_AUD: { label: "Average order ($)", kind: "number", group: "Value", provenance: "REAL" },
  PROMO_SHARE: { label: "Share of purchases on promotion", kind: "number", group: "Value", provenance: "REAL" },
  TOP_CATEGORY: { label: "Top category", kind: "enum", group: "Affinity", provenance: "REAL", options: CATEGORIES },
  PREFERRED_PRICE_TIER: { label: "Price tier", kind: "enum", group: "Affinity", provenance: "REAL", options: ["Value", "Mid", "Premium"] },
  NAPPIES_SHARE: { label: "Share of spend: nappies", kind: "number", group: "Affinity", provenance: "REAL" },
  CAR_SEATS_SHARE: { label: "Share of spend: car seats", kind: "number", group: "Affinity", provenance: "REAL" },
  PRAMS_SHARE: { label: "Share of spend: prams", kind: "number", group: "Affinity", provenance: "REAL" },
  FEEDING_SHARE: { label: "Share of spend: feeding", kind: "number", group: "Affinity", provenance: "REAL" },
  CLOTHING_SHARE: { label: "Share of spend: clothing", kind: "number", group: "Affinity", provenance: "REAL" },
  SEGMENT_NAME: { label: "Segment", kind: "enum", group: "Profile", provenance: "GENERATED",
    options: ["First-time Parents", "Second-time Parents", "Expecting", "Registry Shoppers", "Gift Buyers", "Grandparents"] },
  LOYALTY_TIER: { label: "Loyalty tier", kind: "enum", group: "Profile", provenance: "GENERATED", options: ["Bronze", "Silver", "Gold", "Platinum"] },
  HOME_STATE: { label: "Home store state", kind: "enum", group: "Profile", provenance: "REAL", options: STATES,
    hint: "The state of the store they buy from most. The profile state agrees only a fifth of the time." },
  PROFILE_STATE: { label: "Profile state", kind: "enum", group: "Profile", provenance: "GENERATED", options: STATES },
  LAST_NPS_CLASS: { label: "Last NPS answer", kind: "enum", group: "Voice", provenance: "SYNTHETIC", options: ["PROMOTER", "PASSIVE", "DETRACTOR"] },
  NEG_VOICE_120D: { label: "Negative comments, last 120 days", kind: "number", group: "Voice", provenance: "SYNTHETIC" },
  NEG_THEME_120D: { label: "Theme of their latest complaint", kind: "enum", group: "Voice", provenance: "SYNTHETIC", options: THEMES },
  HAS_OPEN_COMPLAINT: { label: "Complaint in the last 60 days", kind: "bool", group: "Voice", provenance: "SYNTHETIC" },
  STATED_INTENT: { label: "Said they will buy next", kind: "enum", group: "Voice", provenance: "SYNTHETIC",
    options: ["CAR_SEAT_UPGRADE", "PRAM_OR_STROLLER", "FEEDING", "NAPPY_STAGE_CHANGE", "NURSERY_OR_CLOTHING"] },
  EMAIL_OPT_IN: { label: "Email consent", kind: "bool", group: "Contact", provenance: "MODELLED" },
  SMS_OPT_IN: { label: "SMS consent", kind: "bool", group: "Contact", provenance: "MODELLED" },
  PUSH_ENABLED: { label: "App push enabled", kind: "bool", group: "Contact", provenance: "MODELLED" },
  DAYS_SINCE_CONTACT: { label: "Days since last campaign contact", kind: "number", group: "Contact", provenance: "MODELLED" },
  CONTACTS_30D: { label: "Campaign contacts, last 30 days", kind: "number", group: "Contact", provenance: "MODELLED" },
};

export const PRICE_THEMES = ["Price and value", "Promotions and offers"];

/** Models the campaign persona may call: validated before being inlined into SQL. */
export const MODELS = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5", "llama4-maverick", "mistral-large2"] as const;
