// ─── Head of Planning: configuration ──────────────────────────────────────────
//
// Client-safe constants only. The schema name lives in ./schema.ts, which is
// server-only: importing the Snowflake driver here would drag it into every page
// bundle.

/** The plan half. Baby Mart's fiscal year runs July to June, so FY27 H1 is
 *  July to December 2026. The Global Planning tab labels its own plan "F27 H1"
 *  for Jan-Jun 2027 -- a different six months -- which is why every label here
 *  carries the calendar months as well. Never render a bare "FY27". */
export const PLAN_FY = 2027;
export const PLAN_HALF = "H1";
export const PERIOD_FISCAL = "FY27 H1";
export const PERIOD_CALENDAR = "Jul–Dec 2026";
export const PERIOD_DUAL = `${PERIOD_FISCAL} · ${PERIOD_CALENDAR}`;

export const PLAN_MONTHS = ["JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** Single market. The reference implementation's country selector existed for
 *  joint-venture expansion, which Baby Mart does not have. */
export const MARKET = "AU";

/** The values a store's location and format can take, as the store dimension
 *  holds them. Shared by the add-store form and the server checks on what the
 *  AI assist proposes, so a model cannot introduce a fourth region. */
export const STORE_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const STORE_REGIONS = ["Metro", "CBD", "Regional"] as const;
export const STORE_FORMATS = ["Standard", "Large Format"] as const;

/** The six build stages, in planning order. Two are not built here, and saying
 *  so is the point: an empty stage is information, whereas a stage quietly
 *  missing from the list would misrepresent how complete this is. */
export const BUILD_STAGES = [
  {
    key: "STRATEGIC_PLAN",
    label: "Strategic plan",
    href: null,
    status: "NOT_SUPPLIED",
    blurb: "The three-year trajectory the board agrees. Not supplied, so not modelled.",
  },
  {
    key: "STORE_PLAN",
    label: "Store plan",
    href: "/hop/store-plan",
    status: "BUILT",
    blurb: "The budget, and the only place real inputs live.",
  },
  {
    key: "MFP",
    label: "MFP",
    href: "/hop/mfp",
    status: "BUILT",
    blurb: "Merchandise financial plan: RBU and department, top-down against bottom-up.",
  },
  {
    key: "WSSI",
    label: "WSSI",
    href: "/hop/wssi",
    status: "BUILT",
    blurb: "Weekly sales, stock and intake once trading starts. Department to business, never SKU.",
  },
  {
    key: "TPR",
    label: "Range review",
    href: "/hop/tpr",
    status: "BUILT",
    blurb: "The range review at option level. Only its roll-up is here.",
  },
  {
    key: "BUY_FILE",
    label: "Buy file",
    href: null,
    status: "NOT_BUILT",
    blurb: "Where committed options become orders. Purchase orders exist; the buy file does not.",
  },
] as const;
