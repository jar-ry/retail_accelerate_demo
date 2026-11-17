// ─── OneDigital Campaign Manager: configuration (client-safe) ───────────────
//
// Constants only. The schema name lives in ./schema.ts, which is server-only:
// importing the Snowflake driver here would drag it into every page bundle.

/** The demo clock. Purchases end on 13 Nov 2026; the server reads the date from
 *  CMP_SETTING (CMP_AS_OF()), and this copy is only for labels. */
export const AS_OF_LABEL = "13 Nov 2026";
export const AS_OF_ISO = "2026-11-13";

export const RETAILER = "Officeworks";
export const PLATFORM = "OneDigital";

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
  { n: 1, key: "ideation", label: "Ideation", blurb: "Signals from Bunnings, Kmart and Officeworks purchases, ranked into a shortlist of campaigns.", href: "/campaigns/ideas" },
  { n: 2, key: "audience", label: "Audience", blurb: "Who to target, who to leave alone, data-sharing consent, and a holdout to prove it worked.", href: "/campaigns/audiences" },
  { n: 3, key: "content", label: "Content & channels", blurb: "Copy for every channel, checked, and the channel each member gets.", href: "/campaigns/studio" },
  { n: 4, key: "performance", label: "Performance", blurb: "Lift against the holdout, live alerts, root cause and what we learned.", href: "/campaigns/performance" },
] as const;

export const CHANNELS = ["EMAIL", "SMS", "PUSH", "PAID_SOCIAL", "IN_STORE"] as const;
export type ChannelCode = (typeof CHANNELS)[number];
export const PERSONAL_CHANNELS: ChannelCode[] = ["EMAIL", "SMS", "PUSH"];

export const CHANNEL_LABEL: Record<ChannelCode, string> = {
  EMAIL: "Email", SMS: "SMS", PUSH: "OnePass app push", PAID_SOCIAL: "Paid social", IN_STORE: "In-store",
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
  REAL: "Computed from the OnePass-linked purchases at Bunnings, Kmart and Officeworks (synthetic demo data).",
  GENERATED: "From the member profile (segment, membership, state); not reconciled to purchases.",
  MODELLED: "Modelled: consent, stock position and past campaign responses follow stated rules, not observed data.",
  SYNTHETIC: "Synthetic demo data generated for OneDigital.",
  SIMULATED: "Produced by the campaign simulator for a campaign launched in this app.",
  AI: "Read or written by Snowflake AI (Cortex Agents for ideas and investigations, AI_COMPLETE for copy); numbers are checked against the figures the tools returned.",
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
  SLEEPING_DOG: "Buy LESS when contacted, and unsubscribe. Leave them alone.",
};

/** Campaign categories: what an Officeworks campaign sells, at the level the signals work. */
export const CATEGORIES = ["Business Essentials", "Back to School", "Technology", "Furniture"] as const;
export const TRACK_OF: Record<string, string> = {
  "Business Essentials": "BUSINESS", "Back to School": "SCHOOL", Technology: "TECH", Furniture: "FURNITURE",
};
/** Average order of a conversion by category, AUD, for the channel planner. */
export const AOV_BY_CATEGORY: Record<string, number> = { "Business Essentials": 690, "Back to School": 165, Technology: 1050, Furniture: 340 };
export const MARGIN_RATE_BY_CATEGORY: Record<string, number> = { "Business Essentials": 0.18, "Back to School": 0.28, Technology: 0.10, Furniture: 0.36 };

export const NEED_STATES = [
  "STARTER_NEW", "STARTER_OW", "TRADE_ESTABLISHED", "LIST_USER", "SCHOOL_STARTING", "SCHOOL_HIGH", "SCHOOL_MEDIUM", "SCHOOL_LOW",
  "TECH_OWNER", "TECH_RECENT", "HOME_OFFICE", "OW_ACTIVE", "OW_LAPSED", "NO_SIGNAL_COLD",
] as const;
export const NEED_LABEL: Record<string, string> = {
  STARTER_NEW: "New business, not yet buying at Officeworks", STARTER_OW: "New business, already buying at Officeworks",
  TRADE_ESTABLISHED: "Established tradie", LIST_USER: "Used the school list service last year", SCHOOL_STARTING: "Child likely starting school",
  SCHOOL_HIGH: "School-age signal: high", SCHOOL_MEDIUM: "School-age signal: medium", SCHOOL_LOW: "School-age signal: low",
  TECH_OWNER: "Laptop or printer 1-2 years old", TECH_RECENT: "Bought tech this year", HOME_OFFICE: "Kmart home-office shopper",
  OW_ACTIVE: "Active Officeworks shopper", OW_LAPSED: "Lapsed Officeworks shopper", NO_SIGNAL_COLD: "No signal, never shopped Officeworks",
};

// ─── Audience field catalogue ──────────────────────────────────────────────
//
// The allow-list an audience spec may filter on. Both the hand-built filters and
// the natural-language builder go through it: a field that is not here cannot
// reach SQL, and every value is bound, never spliced. A field with a `banner`
// of Bunnings or Kmart is a cross-banner signal: any spec that uses one gets the
// OnePass data-sharing consent rule added by the compiler.

export type FieldKind = "enum" | "number" | "bool";
export type FieldDef = {
  label: string; kind: FieldKind; group: string; provenance: Provenance; options?: readonly string[]; hint?: string;
  banner?: "Bunnings" | "Kmart" | "Officeworks" | "All";
};

const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const SCHOOL_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;

export const FIELDS: Record<string, FieldDef> = {
  BIZ_STARTER_FLAG: { label: "New business starter", kind: "bool", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings",
    hint: "3+ of the six Bunnings trade categories in 90 days with no trade buying in the 4-16 months before: a trade business being set up" },
  BIZ_STARTER_SCORE: { label: "Business-starter score (0-100)", kind: "number", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings" },
  TRADE_CLASSES_90D: { label: "Trade categories bought in 90 days (of 6)", kind: "number", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings",
    hint: "Established tradies score high on this too; use BIZ_STARTER_FLAG or PRIOR_TRADE_HISTORY to tell them apart" },
  PRIOR_TRADE_HISTORY: { label: "Established tradie (trade buying 4-16 months ago)", kind: "bool", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings" },
  DAYS_SINCE_FIRST_TRADE: { label: "Days since first trade purchase in the cluster", kind: "number", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings",
    hint: "The starter signal is freshest in the first 60 days" },
  TRADE_TYPE: { label: "Trade", kind: "enum", group: "Business start (Bunnings)", provenance: "REAL", banner: "Bunnings",
    options: ["Electrical", "Plumbing", "Carpentry", "Landscaping", "Cleaning"] },
  SCHOOL_SIGNAL_CONFIDENCE: { label: "School-age children signal", kind: "enum", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart",
    options: SCHOOL_CONFIDENCE,
    hint: "HIGH = school-age kids' shoe sizes AND school items (uniforms, lunchboxes, bags) in 12 months; MEDIUM = one or the other; LOW = toddler sizes or only December gift buying. Shoe sizes alone are an imperfect proxy for age and household size" },
  EST_SCHOOL_AGE_KIDS: { label: "School-age children (estimated from shoe sizes)", kind: "number", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart",
    hint: "Undercounts: siblings of similar age look like one child" },
  YOUNGEST_KID_AGE_EST: { label: "Youngest child's age at next school start (estimated)", kind: "number", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart" },
  STARTING_SCHOOL_LIKELY: { label: "Child likely starting school", kind: "bool", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart" },
  SCHOOL_ITEMS_12M: { label: "School items bought at Kmart in 12 months", kind: "number", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart" },
  HOME_OFFICE_12M: { label: "Bought home-office items at Kmart in 12 months", kind: "bool", group: "School household (Kmart)", provenance: "REAL", banner: "Kmart" },
  DAYS_TO_SCHOOL_START: { label: "Days to their state's Term 1 start", kind: "number", group: "Timing", provenance: "REAL", banner: "All" },
  SCHOOL_LIST_USED_LAST_YEAR: { label: "Used the school list service last year", kind: "bool", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks" },
  OW_BUSINESS_BUYER: { label: "Already buys business supplies at Officeworks", kind: "bool", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks" },
  OW_RELATIONSHIP: { label: "Officeworks relationship", kind: "enum", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks",
    options: ["Business buyer", "Active shopper", "Lapsed shopper", "Never shopped"] },
  OW_RECENCY_DAYS: { label: "Days since last Officeworks purchase", kind: "number", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks" },
  OW_SPEND_12M: { label: "Officeworks spend in 12 months ($)", kind: "number", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks" },
  TECH_LAST_DAYS: { label: "Days since last laptop or printer", kind: "number", group: "Officeworks relationship", provenance: "REAL", banner: "Officeworks" },
  BUNNINGS_SPEND_12M: { label: "Bunnings spend in 12 months ($)", kind: "number", group: "Value", provenance: "REAL", banner: "Bunnings" },
  KMART_SPEND_12M: { label: "Kmart spend in 12 months ($)", kind: "number", group: "Value", provenance: "REAL", banner: "Kmart" },
  BANNERS_12M: { label: "Banners shopped in 12 months", kind: "number", group: "Value", provenance: "REAL", banner: "All" },
  RFM_SEGMENT: { label: "RFM segment", kind: "enum", group: "Value", provenance: "REAL", banner: "All",
    options: ["Champions", "Loyal", "Potential loyalist", "New", "Needs attention", "At risk", "Hibernating", "Lost", "No purchases"] },
  RECENCY_BAND: { label: "Last purchase (any banner)", kind: "enum", group: "Value", provenance: "REAL", banner: "All", options: ["0-90d", "91-180d", "181-365d", "365d+", "NONE"] },
  SPEND_12M_AUD: { label: "Spend in 12 months, all banners ($)", kind: "number", group: "Value", provenance: "REAL", banner: "All" },
  SEGMENT_NAME: { label: "Marketing segment", kind: "enum", group: "Profile", provenance: "GENERATED",
    options: ["Established Families", "Young Families", "Young Singles & Couples", "Home Improvers", "Tradies & DIYers", "Empty Nesters"] },
  LOYALTY_TIER: { label: "Membership", kind: "enum", group: "Profile", provenance: "GENERATED", options: ["OnePass", "Standard"] },
  HOME_STATE: { label: "Home state", kind: "enum", group: "Profile", provenance: "GENERATED", options: STATES },
  AGE_BAND: { label: "Age band", kind: "enum", group: "Profile", provenance: "GENERATED", options: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] },
  GROUP_DATA_CONSENT: { label: "OnePass data-sharing consent", kind: "bool", group: "Contact", provenance: "MODELLED",
    hint: "Added automatically when a Bunnings or Kmart field is used" },
  EMAIL_OPT_IN: { label: "Email consent", kind: "bool", group: "Contact", provenance: "MODELLED" },
  SMS_OPT_IN: { label: "SMS consent", kind: "bool", group: "Contact", provenance: "MODELLED" },
  PUSH_ENABLED: { label: "OnePass app push enabled", kind: "bool", group: "Contact", provenance: "MODELLED" },
  DAYS_SINCE_CONTACT: { label: "Days since last campaign contact", kind: "number", group: "Contact", provenance: "MODELLED" },
  CONTACTS_30D: { label: "Campaign contacts, last 30 days", kind: "number", group: "Contact", provenance: "MODELLED" },
};

/** Fields whose values come from another banner's purchases. */
export const CROSS_BANNER_FIELDS = Object.entries(FIELDS).filter(([, f]) => f.banner === "Bunnings" || f.banner === "Kmart").map(([k]) => k);

/** Models the campaign persona may call: validated before being inlined into SQL. */
export const MODELS = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5", "llama4-maverick", "mistral-large2"] as const;
