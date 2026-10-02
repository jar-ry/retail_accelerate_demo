import { NextRequest, NextResponse } from "next/server";
import { fromPathSegment } from "@/lib/class-slug";
import { querySnowflake, toIsoDate } from "@/lib/snowflake";
// The weekly grid, sandbox scenarios and approval history live in their own
// module so this file stays a dispatch table rather than growing past 1,500 lines.
import {
  handleGrid,
  handleGridSave,
  handleOptions,
  handleScenarioList,
  handleScenarioPrompt,
  handleScenarioDecide,
  handleScenarioApprove,
  handleScenarioDelete,
  handleAnnotation,
  handleSettings,
  handleParameters,
  handleSaveParameter,
  handleAudit,
  handleHistory,
  handleVersionGrid,
} from "@/lib/planning-grid";

// ─── Anko Global Planning API ─────────────────────────────────────────────────
//
// Serves the /planning pages: merchandise financial planning (MFP), open-to-buy
// (OTB / WISSI), scenario modelling and AI insights, across the
// RBU -> DEPARTMENT -> CLASS hierarchy.
//
// SQL is written against BABY_MART_DEMO.* literally; querySnowflake pipes every
// statement through remapNamespace, which rewrites the prefix to whatever
// namespace the account actually uses. Do not build the FQN from env vars here.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** Nullable numeric: preserves NULL rather than coercing it to 0.
 *  A margin gap of NULL (no budget to compare against) is not the same claim as
 *  a gap of 0.0, and the pages render the two differently. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  // fromPathSegment, not decodeURIComponent: a class name can contain "/"
  // and %2F is decoded to a path separator before routing, so
  // the client swaps it for a sentinel. Undoing that here -- the one place every
  // segment passes through -- keeps the handlers working in real class names.
  const segments = path.map(fromPathSegment);
  const { searchParams } = request.nextUrl;
  // PHP is the planning currency; AUD is the reporting currency. The FX rate
  // lives in DIM_FISCAL_PERIOD, so switching currency never hardcodes a rate.
  const currency = searchParams.get("currency") === "AUD" ? "AUD" : "PHP";

  // Ordered longest-match-first. Without the try/catch a failing query returns
  // Next's HTML 500 page and the client's r.json() throws, which surfaces as an
  // endless spinner instead of the actual Snowflake error.
  try {
    // ─── /planning/hierarchy ────────────────────────────────────────
    if (segments[0] === "hierarchy" && segments.length === 1) {
      return NextResponse.json(await handleHierarchy());
    }

    // ─── /planning/overview ─────────────────────────────────────────
    if (segments[0] === "overview" && segments.length === 1) {
      return NextResponse.json(await handleOverview(currency));
    }

    // ─── /planning/exceptions ───────────────────────────────────────
    if (segments[0] === "exceptions" && segments.length === 1) {
      return NextResponse.json(await handleExceptions());
    }

    // ─── /planning/mfp/{dept}/{class} ───────────────────────────────
    if (segments[0] === "mfp" && segments.length === 3) {
      return NextResponse.json(
        await handleMfpClass(segments[1], segments[2], currency)
      );
    }

    // ─── /planning/mfp/{dept} ───────────────────────────────────────
    if (segments[0] === "mfp" && segments.length === 2) {
      return NextResponse.json(await handleMfpDepartment(segments[1], currency));
    }

    // ─── /planning/mfp ──────────────────────────────────────────────
    if (segments[0] === "mfp" && segments.length === 1) {
      return NextResponse.json(await handleMfpRbu(currency));
    }

    // ─── /planning/otb/{dept} ───────────────────────────────────────
    if (segments[0] === "otb" && segments.length === 2) {
      return NextResponse.json(await handleOtbDepartment(segments[1], currency));
    }

    // ─── /planning/otb ──────────────────────────────────────────────
    if (segments[0] === "otb" && segments.length === 1) {
      return NextResponse.json(await handleOtb(currency));
    }

    // ─── /planning/commitments ──────────────────────────────────────
    if (segments[0] === "commitments" && segments.length === 1) {
      return NextResponse.json(
        await handleCommitments(searchParams.get("department"), currency)
      );
    }

    // ─── /planning/grid/{dept}/{class} ──────────────────────────────
    // The Excel-parity weekly grid. `scenario` overlays a sandbox scenario.
    if (segments[0] === "grid" && segments.length === 3) {
      return NextResponse.json(
        await handleGrid(
          segments[1],
          segments[2],
          searchParams.get("half"),
          searchParams.get("scenario"),
          currency
        )
      );
    }

    // ─── /planning/options/{class} ──────────────────────────────────
    if (segments[0] === "options" && segments.length === 2) {
      return NextResponse.json(
        await handleOptions(segments[1], searchParams.get("half"), currency)
      );
    }

    // ─── /planning/scenarios ────────────────────────────────────────
    if (segments[0] === "scenarios" && segments.length === 1) {
      return NextResponse.json(await handleScenarioList(currency));
    }

    // ─── /planning/history ──────────────────────────────────────────
    if (segments[0] === "history" && segments.length === 1) {
      return NextResponse.json(
        await handleHistory(searchParams.get("department"), currency)
      );
    }

    // ─── /planning/history/grid ─────────────────────────────────────
    // Cell-level diff of one approved version against the one before it.
    if (segments[0] === "history" && segments[1] === "grid") {
      return NextResponse.json(
        await handleVersionGrid(
          searchParams.get("versionId"),
          searchParams.get("metric") ?? "SLS_PHP",
          searchParams.get("half") ?? "H2",
          currency
        )
      );
    }

    // ─── /planning/settings ─────────────────────────────────────────
    if (segments[0] === "settings" && segments.length === 1) {
      return NextResponse.json(await handleSettings());
    }

    // ─── /planning/parameters ───────────────────────────────────────
    // Every threshold and calculation parameter, with the metadata the settings
    // UI needs to know which are live and which need a data rebuild.
    if (segments[0] === "parameters" && segments.length === 1) {
      return NextResponse.json(await handleParameters());
    }

    // ─── /planning/audit ────────────────────────────────────────────
    if (segments[0] === "audit" && segments.length === 1) {
      return NextResponse.json(await handleAudit(searchParams, currency));
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[planning] GET /${segments.join("/")} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  // fromPathSegment, not decodeURIComponent: a class name can contain "/"
  // and %2F is decoded to a path separator before routing, so
  // the client swaps it for a sentinel. Undoing that here -- the one place every
  // segment passes through -- keeps the handlers working in real class names.
  const segments = path.map(fromPathSegment);

  try {
    // ─── /planning/insights ─────────────────────────────────────────
    if (segments[0] === "insights" && segments.length === 1) {
      return await handleInsights(request);
    }

    // ─── /planning/grid/save ────────────────────────────────────────
    if (segments[0] === "grid" && segments[1] === "save") {
      return NextResponse.json(await handleGridSave(request));
    }

    // ─── /planning/scenario/{action} ────────────────────────────────
    // Length 2, so none of these collide with the length-1 lever handler above.
    if (segments[0] === "scenario" && segments.length === 2) {
      if (segments[1] === "prompt") {
        return NextResponse.json(await handleScenarioPrompt(request));
      }
      if (segments[1] === "decide") {
        return NextResponse.json(await handleScenarioDecide(request));
      }
      if (segments[1] === "approve") {
        return NextResponse.json(await handleScenarioApprove(request));
      }
      if (segments[1] === "delete") {
        return NextResponse.json(await handleScenarioDelete(request));
      }
    }

    // ─── /planning/annotation ───────────────────────────────────────
    if (segments[0] === "annotation" && segments.length === 1) {
      return NextResponse.json(await handleAnnotation(request));
    }

    // ─── /planning/parameters ───────────────────────────────────────
    // Writes go through validated procedures, so a range or cross-field rule
    // cannot be bypassed by posting here directly.
    if (segments[0] === "parameters" && segments.length === 1) {
      return NextResponse.json(await handleSaveParameter(request));
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[planning] POST /${segments.join("/")} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Hierarchy ────────────────────────────────────────────────────────────────

async function handleHierarchy() {
  const rows = await querySnowflake(`
    SELECT RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
    ORDER BY DEPARTMENT_CODE, CLASS_CODE
  `);

  // Nest into RBU > departments > classes so the nav tree is one fetch.
  const departments = new Map<
    string,
    { department: string; departmentCode: string; classes: unknown[] }
  >();
  for (const r of rows) {
    const dept = String(r.DEPARTMENT);
    if (!departments.has(dept)) {
      departments.set(dept, {
        department: dept,
        departmentCode: String(r.DEPARTMENT_CODE),
        classes: [],
      });
    }
    departments.get(dept)!.classes.push({
      class: String(r.CLASS),
      classCode: String(r.CLASS_CODE),
      lflStrategy: String(r.LFL_STRATEGY),
    });
  }

  // EVERY RBU, not rows[0]. This used to return a single scalar, which was
  // true when the hierarchy had one RBU and silently wrong the moment it had
  // two: the insights page builds its RBU dropdown from this, so exactly one
  // RBU was selectable and the other's insights were unreachable from the UI.
  // `rbu` is kept alongside `rbus` as the default selection, not as the set.
  const rbus = Array.from(new Set(rows.map((r) => String(r.RBU))));
  return {
    rbu: rbus[0] ?? null,
    rbus,
    departments: Array.from(departments.values()),
  };
}

// ─── Shared MFP row mapping ───────────────────────────────────────────────────

/** Selects the PHP or AUD column pair for the requested currency.
 *  Only CURRENCY metrics differ between the two; growth rates, margin
 *  percentages, units and option counts are currency-invariant. */
function mfpSelect(currency: string): string {
  const sls = currency === "AUD" ? "SLS_FC_AUD" : "SLS_FC_PHP";
  const bud = currency === "AUD" ? "SLS_BUD_AUD" : "SLS_BUD_PHP";
  const f26 = currency === "AUD" ? "SLS_F26_AUD" : "SLS_F26_PHP";
  const fx = currency === "AUD" ? "FX_RATE_PHP_AUD" : "1";
  return `
    ${sls}                      AS SALES_FC,
    ${bud}                      AS SALES_BUD,
    ${f26}                      AS SALES_F26,
    SLS_LY_PHP / ${fx}          AS SALES_LY,
    NET_SLS_FC_PHP / ${fx}      AS NET_SALES_FC,
    GP_FC_PHP / ${fx}           AS GP_FC,
    VAR_TO_BUD_PHP / ${fx}      AS VAR_TO_BUD,
    ASP_FC_PHP / ${fx}          AS ASP_FC,
    ASP_LY_PHP / ${fx}          AS ASP_LY
  `;
}

function mapMfpRow(r: Record<string, unknown>) {
  return {
    department: r.DEPARTMENT ? String(r.DEPARTMENT) : null,
    departmentCode: r.DEPARTMENT_CODE ? String(r.DEPARTMENT_CODE) : null,
    class: r.CLASS ? String(r.CLASS) : null,
    classCode: r.CLASS_CODE ? String(r.CLASS_CODE) : null,
    planLevel: String(r.PLAN_LEVEL),
    lflStrategy: r.LFL_STRATEGY ? String(r.LFL_STRATEGY) : null,
    salesF26: num(r.SALES_F26),
    salesLy: num(r.SALES_LY),
    salesBud: num(r.SALES_BUD),
    salesFc: num(r.SALES_FC),
    netSalesFc: num(r.NET_SALES_FC),
    varToBud: num(r.VAR_TO_BUD),
    varToBudPct: numOrNull(r.VAR_TO_BUD_PCT),
    lflGrowthPct: numOrNull(r.LFL_GROWTH_PCT),
    totalGrowthPct: numOrNull(r.TOTAL_GROWTH_PCT),
    unitsFc: num(r.UNITS_FC),
    unitGrowthPct: numOrNull(r.UNIT_GROWTH_PCT),
    aspFc: num(r.ASP_FC),
    aspLy: num(r.ASP_LY),
    gpFc: num(r.GP_FC),
    gpPctFc: numOrNull(r.GP_PCT_FC),
    gpPctBud: numOrNull(r.GP_PCT_BUD),
    gpGapPp: numOrNull(r.GP_GAP_PP),
    optTotal: num(r.OPT_TOTAL_FC),
    optNew: num(r.OPT_NEW_FC),
    optOngoing: num(r.OPT_ONGOING_FC),
    optDeselected: num(r.OPT_DESELECTED_FC),
    optNewPct: numOrNull(r.OPT_NEW_PCT),
    mixPct: numOrNull(r.MIX_PCT),
  };
}

const MFP_COLS = `
  DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL, LFL_STRATEGY,
  VAR_TO_BUD_PCT, LFL_GROWTH_PCT, TOTAL_GROWTH_PCT,
  UNITS_FC, UNIT_GROWTH_PCT,
  GP_PCT_FC, GP_PCT_BUD, GP_GAP_PP,
  OPT_TOTAL_FC, OPT_NEW_FC, OPT_ONGOING_FC, OPT_DESELECTED_FC, OPT_NEW_PCT,
  MIX_PCT
`;

// ─── MFP: RBU level ───────────────────────────────────────────────────────────

async function handleMfpRbu(currency: string) {
  const [totalRows, deptRows, trendRows] = await Promise.all([
    // VW_MFP_TOTAL, not PLAN_LEVEL = 'RBU'. There are now two RBUs, so the old
    // query returned two rows and totalRows[0] picked one of them arbitrarily --
    // printing a headline that did not equal the sum of the departments listed
    // directly beneath it.
    querySnowflake(`
      SELECT ${MFP_COLS}, ${mfpSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_TOTAL
    `),
    querySnowflake(`
      SELECT ${MFP_COLS}, ${mfpSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
      WHERE PLAN_LEVEL = 'DEPARTMENT'
      ORDER BY DEPARTMENT_CODE
    `),
    monthlyTrend(currency, null, null),
  ]);

  return {
    currency,
    level: "RBU",
    total: totalRows.length > 0 ? mapMfpRow(totalRows[0]) : null,
    rows: deptRows.map(mapMfpRow),
    trend: trendRows,
  };
}

// ─── MFP: department level ────────────────────────────────────────────────────

async function handleMfpDepartment(department: string, currency: string) {
  const dept = escapeSql(department.toUpperCase());

  const [totalRows, classRows, trendRows] = await Promise.all([
    querySnowflake(`
      SELECT ${MFP_COLS}, ${mfpSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
      WHERE PLAN_LEVEL = 'DEPARTMENT' AND UPPER(DEPARTMENT) = '${dept}'
    `),
    querySnowflake(`
      SELECT ${MFP_COLS}, ${mfpSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS' AND UPPER(DEPARTMENT) = '${dept}'
      ORDER BY CLASS_CODE
    `),
    monthlyTrend(currency, department, null),
  ]);

  if (totalRows.length === 0) {
    return { error: `Department "${department}" not found` };
  }

  return {
    currency,
    level: "DEPARTMENT",
    department,
    total: mapMfpRow(totalRows[0]),
    rows: classRows.map(mapMfpRow),
    trend: trendRows,
  };
}

// ─── MFP: class level ─────────────────────────────────────────────────────────

async function handleMfpClass(
  department: string,
  klass: string,
  currency: string
) {
  const dept = escapeSql(department.toUpperCase());
  const cls = escapeSql(klass.toUpperCase());

  const [totalRows, buyRows, trendRows, otbRows, poRows] = await Promise.all([
    querySnowflake(`
      SELECT ${MFP_COLS}, ${mfpSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_MFP_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS'
        AND UPPER(DEPARTMENT) = '${dept}' AND UPPER(CLASS) = '${cls}'
    `),
    // Buy-position headline comes from the SAME view the OTB pages read, rather
    // than being re-derived from the last row of the weekly table below. The
    // weekly rows carry a per-week cover whose denominator is that week's own
    // forward sales, so the final week disagreed with the OTB page (14.0w vs
    // 16.5w for the hero class) even though both were labelled "forward cover".
    querySnowflake(`
      SELECT ${otbSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS'
        AND UPPER(DEPARTMENT) = '${dept}' AND UPPER(CLASS) = '${cls}'
    `),
    monthlyTrend(currency, department, klass),
    // Weekly buy position for this class over the plan horizon.
    querySnowflake(`
      SELECT
        PERIOD_CODE, WEEK_LABEL, WEEK_ENDING_DATE,
        OPENING_STOCK_PHP  / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS OPENING_STOCK,
        SALES_PHP          / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS SALES,
        RECEIPTS_PHP       / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS RECEIPTS,
        MARKDOWN_PHP       / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS MARKDOWN,
        CLOSING_STOCK_PHP  / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS CLOSING_STOCK,
        ON_ORDER_PHP       / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS ON_ORDER,
        OTB_AVAILABLE_PHP  / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS OTB_AVAILABLE,
        FORWARD_COVER_WEEKS, TARGET_COVER_WEEKS, BUY_STATUS
      -- VW_OTB_WEEKLY, not FACT_OTB_POSITION: the fact's TARGET_COVER_WEEKS
      -- and BUY_STATUS are baked at generation time and go stale the moment a
      -- planner edits a cover target in settings. The view recomputes both from
      -- the live parameters.
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_WEEKLY
      WHERE UPPER(CLASS) = '${cls}' AND PERIOD_TYPE = 'PLAN'
      ORDER BY WEEK_ENDING_DATE
    `),
    querySnowflake(`
      SELECT PO_NUMBER, SUPPLIER_NAME, SOURCING_COUNTRY, ORDER_DATE, ETA_DATE,
             ORIGINAL_ETA_DATE, ETA_SLIP_DAYS, COMMITTED_UNITS, STATUS,
             COMMITTED_PHP / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS COMMITTED
      FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
      WHERE UPPER(CLASS) = '${cls}'
      ORDER BY ETA_DATE
    `),
  ]);

  if (totalRows.length === 0) {
    return { error: `Class "${klass}" not found in ${department}` };
  }

  return {
    currency,
    level: "CLASS",
    department,
    class: klass,
    total: mapMfpRow(totalRows[0]),
    buyPosition: buyRows.length > 0 ? mapOtbRow(buyRows[0]) : null,
    trend: trendRows,
    weeks: otbRows.map((r) => ({
      periodCode: String(r.PERIOD_CODE),
      weekLabel: String(r.WEEK_LABEL),
      weekEnding: toIsoDate(r.WEEK_ENDING_DATE),
      openingStock: num(r.OPENING_STOCK),
      sales: num(r.SALES),
      receipts: num(r.RECEIPTS),
      markdown: num(r.MARKDOWN),
      closingStock: num(r.CLOSING_STOCK),
      onOrder: num(r.ON_ORDER),
      otbAvailable: num(r.OTB_AVAILABLE),
      coverWeeks: num(r.FORWARD_COVER_WEEKS),
      targetCoverWeeks: num(r.TARGET_COVER_WEEKS),
      buyStatus: String(r.BUY_STATUS),
    })),
    purchaseOrders: poRows.map(mapPoRow),
  };
}

// ─── Monthly trend, shared by all three MFP levels ────────────────────────────

/** Sales by period and version for the whole F27 year, so the chart can show
 *  the in-flight months leading into the H1 plan horizon.
 *
 *  PLAN_LEVEL is always filtered to exactly one level: FACT_MFP_PLAN holds RBU,
 *  DEPARTMENT and CLASS rows in the same table, so omitting it would add
 *  parents on top of their own children and double the totals. */
async function monthlyTrend(
  currency: string,
  department: string | null,
  klass: string | null
) {
  const level = klass ? "CLASS" : department ? "DEPARTMENT" : "RBU";
  const filters = [
    `PLAN_LEVEL = '${level}'`,
    `FISCAL_YEAR = 'F27'`,
    `METRIC = 'SLS_PHP'`,
  ];
  if (department) filters.push(`UPPER(DEPARTMENT) = '${escapeSql(department.toUpperCase())}'`);
  if (klass) filters.push(`UPPER(CLASS) = '${escapeSql(klass.toUpperCase())}'`);

  const valueCol = currency === "AUD" ? "VALUE_AUD" : "VALUE_PHP";

  const rows = await querySnowflake(`
    SELECT
      f.PERIOD_CODE,
      f.PERIOD_NO,
      MAX(d.MONTH_NAME)  AS MONTH_NAME,
      MAX(f.PERIOD_TYPE) AS PERIOD_TYPE,
      SUM(IFF(f.VERSION = 'LY',   f.${valueCol}, 0)) AS SALES_LY,
      SUM(IFF(f.VERSION = 'BUD',  f.${valueCol}, 0)) AS SALES_BUD,
      SUM(IFF(f.VERSION = 'MRCH', f.${valueCol}, 0)) AS SALES_MRCH,
      SUM(IFF(f.VERSION = 'FC',   f.${valueCol}, 0)) AS SALES_FC
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN f
    JOIN (
      SELECT DISTINCT PERIOD_CODE, MONTH_NAME
      FROM BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD
    ) d ON d.PERIOD_CODE = f.PERIOD_CODE
    WHERE ${filters.join(" AND ")}
    GROUP BY f.PERIOD_CODE, f.PERIOD_NO
    ORDER BY f.PERIOD_NO
  `);

  return rows.map((r) => ({
    periodCode: String(r.PERIOD_CODE),
    month: String(r.MONTH_NAME),
    periodType: String(r.PERIOD_TYPE),
    salesLy: num(r.SALES_LY),
    salesBud: num(r.SALES_BUD),
    salesMrch: num(r.SALES_MRCH),
    salesFc: num(r.SALES_FC),
  }));
}

// ─── OTB / WISSI ──────────────────────────────────────────────────────────────

function otbSelect(currency: string): string {
  const fx = currency === "AUD" ? "FX_RATE_PHP_AUD" : "1";
  return `
    DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, PLAN_LEVEL,
    AS_AT_WEEK, BUY_STATUS, FORWARD_COVER_WEEKS, TOTAL_COVER_WEEKS, TARGET_COVER_WEEKS,
    -- The bands that produced BUY_STATUS travel with it, so the UI can colour a
    -- cover figure and explain the flag without keeping its own copy of the
    -- multipliers. Three copies of that rule is what this replaces.
    OVERBUY_MULT, UNDERBUY_MULT,
    STOCK_UNITS, ON_ORDER_UNITS,
    STOCK_PHP         / ${fx} AS STOCK,
    ON_ORDER_PHP      / ${fx} AS ON_ORDER,
    OTB_AVAILABLE_PHP / ${fx} AS OTB_AVAILABLE,
    OTB_PLANNED_PHP   / ${fx} AS OTB_PLANNED,
    HORIZON_SLS_PHP   / ${fx} AS HORIZON_SALES,
    HORIZON_MD_PHP    / ${fx} AS HORIZON_MARKDOWN
  `;
}

function mapOtbRow(r: Record<string, unknown>) {
  return {
    department: r.DEPARTMENT ? String(r.DEPARTMENT) : null,
    departmentCode: r.DEPARTMENT_CODE ? String(r.DEPARTMENT_CODE) : null,
    class: r.CLASS ? String(r.CLASS) : null,
    classCode: r.CLASS_CODE ? String(r.CLASS_CODE) : null,
    planLevel: String(r.PLAN_LEVEL),
    asAtWeek: toIsoDate(r.AS_AT_WEEK),
    buyStatus: String(r.BUY_STATUS),
    coverWeeks: num(r.FORWARD_COVER_WEEKS),
    // Stock PLUS on order. This -- not stock cover -- is what BUY_STATUS is
    // derived from, so it has to be shown wherever the status is shown or the
    // status looks unexplained.
    totalCoverWeeks: num(r.TOTAL_COVER_WEEKS),
    targetCoverWeeks: num(r.TARGET_COVER_WEEKS),
    overbuyMult: num(r.OVERBUY_MULT),
    underbuyMult: num(r.UNDERBUY_MULT),
    stockUnits: num(r.STOCK_UNITS),
    onOrderUnits: num(r.ON_ORDER_UNITS),
    stock: num(r.STOCK),
    onOrder: num(r.ON_ORDER),
    otbAvailable: num(r.OTB_AVAILABLE),
    otbPlanned: num(r.OTB_PLANNED),
    horizonSales: num(r.HORIZON_SALES),
    horizonMarkdown: num(r.HORIZON_MARKDOWN),
  };
}

async function handleOtb(currency: string) {
  const [deptRows, classRows, weekRows] = await Promise.all([
    querySnowflake(`
      SELECT ${otbSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'DEPARTMENT'
      ORDER BY DEPARTMENT_CODE
    `),
    querySnowflake(`
      SELECT ${otbSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS'
      ORDER BY FORWARD_COVER_WEEKS DESC
    `),
    weeklyOtbTrend(currency, null),
  ]);

  return {
    currency,
    level: "RBU",
    departments: deptRows.map(mapOtbRow),
    classes: classRows.map(mapOtbRow),
    trend: weekRows,
  };
}

async function handleOtbDepartment(department: string, currency: string) {
  const dept = escapeSql(department.toUpperCase());

  const [totalRows, classRows, weekRows, poRows] = await Promise.all([
    querySnowflake(`
      SELECT ${otbSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'DEPARTMENT' AND UPPER(DEPARTMENT) = '${dept}'
    `),
    querySnowflake(`
      SELECT ${otbSelect(currency)}
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS' AND UPPER(DEPARTMENT) = '${dept}'
      ORDER BY FORWARD_COVER_WEEKS DESC
    `),
    weeklyOtbTrend(currency, department),
    querySnowflake(`
      SELECT PO_NUMBER, SUPPLIER_NAME, SOURCING_COUNTRY, CLASS, ORDER_DATE,
             ETA_DATE, ORIGINAL_ETA_DATE, ETA_SLIP_DAYS, COMMITTED_UNITS, STATUS,
             COMMITTED_PHP / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"} AS COMMITTED
      FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
      WHERE UPPER(DEPARTMENT) = '${dept}'
      ORDER BY ETA_DATE
    `),
  ]);

  if (totalRows.length === 0) {
    return { error: `Department "${department}" not found` };
  }

  return {
    currency,
    level: "DEPARTMENT",
    department,
    total: mapOtbRow(totalRows[0]),
    classes: classRows.map(mapOtbRow),
    trend: weekRows,
    purchaseOrders: poRows.map(mapPoRow),
  };
}

/** Weekly stock, sales and receipts across the plan horizon. Cover is rebuilt
 *  from summed stock over summed sales rather than averaged, so a department's
 *  cover is not distorted by a small class with extreme cover. */
async function weeklyOtbTrend(currency: string, department: string | null) {
  const fx = currency === "AUD" ? "FX_RATE_PHP_AUD" : "1";
  const where = department
    ? `AND UPPER(DEPARTMENT) = '${escapeSql(department.toUpperCase())}'`
    : "";

  const rows = await querySnowflake(`
    SELECT
      WEEK_ENDING_DATE,
      MAX(PERIOD_CODE)                        AS PERIOD_CODE,
      SUM(SALES_PHP         / ${fx})          AS SALES,
      SUM(RECEIPTS_PHP      / ${fx})          AS RECEIPTS,
      SUM(MARKDOWN_PHP      / ${fx})          AS MARKDOWN,
      SUM(CLOSING_STOCK_PHP / ${fx})          AS CLOSING_STOCK,
      SUM(ON_ORDER_PHP      / ${fx})          AS ON_ORDER,
      SUM(OTB_AVAILABLE_PHP / ${fx})          AS OTB_AVAILABLE,
      ROUND(SUM(CLOSING_STOCK_PHP) / NULLIF(SUM(SALES_PHP), 0), 1) AS COVER_WEEKS
    -- Live view, same reason as the class-level query above.
    FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_WEEKLY
    WHERE PERIOD_TYPE = 'PLAN' ${where}
    GROUP BY WEEK_ENDING_DATE
    ORDER BY WEEK_ENDING_DATE
  `);

  return rows.map((r) => ({
    weekEnding: toIsoDate(r.WEEK_ENDING_DATE),
    periodCode: String(r.PERIOD_CODE),
    sales: num(r.SALES),
    receipts: num(r.RECEIPTS),
    markdown: num(r.MARKDOWN),
    closingStock: num(r.CLOSING_STOCK),
    onOrder: num(r.ON_ORDER),
    otbAvailable: num(r.OTB_AVAILABLE),
    coverWeeks: num(r.COVER_WEEKS),
  }));
}

function mapPoRow(r: Record<string, unknown>) {
  return {
    poNumber: String(r.PO_NUMBER),
    supplierName: String(r.SUPPLIER_NAME),
    sourcingCountry: String(r.SOURCING_COUNTRY),
    class: r.CLASS ? String(r.CLASS) : null,
    orderDate: toIsoDate(r.ORDER_DATE),
    etaDate: toIsoDate(r.ETA_DATE),
    originalEtaDate: toIsoDate(r.ORIGINAL_ETA_DATE),
    etaSlipDays: num(r.ETA_SLIP_DAYS),
    committedUnits: num(r.COMMITTED_UNITS),
    committed: num(r.COMMITTED),
    status: String(r.STATUS),
  };
}

// ─── Commitments ──────────────────────────────────────────────────────────────

async function handleCommitments(department: string | null, currency: string) {
  const fx = currency === "AUD" ? "FX_RATE_PHP_AUD" : "1";
  const where = department
    ? `WHERE UPPER(DEPARTMENT) = '${escapeSql(department.toUpperCase())}'`
    : "";

  const [poRows, supplierRows] = await Promise.all([
    querySnowflake(`
      SELECT PO_NUMBER, SUPPLIER_NAME, SOURCING_COUNTRY, CLASS, ORDER_DATE,
             ETA_DATE, ORIGINAL_ETA_DATE, ETA_SLIP_DAYS, COMMITTED_UNITS, STATUS,
             COMMITTED_PHP / ${fx} AS COMMITTED
      FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
      ${where}
      ORDER BY ETA_DATE
    `),
    querySnowflake(`
      SELECT
        SUPPLIER_NAME, SOURCING_COUNTRY,
        COUNT(*)                                  AS PO_COUNT,
        COUNT_IF(STATUS = 'DELAYED')              AS DELAYED_COUNT,
        ROUND(AVG(IFF(STATUS = 'DELAYED', ETA_SLIP_DAYS, NULL)), 1) AS AVG_SLIP_DAYS,
        SUM(COMMITTED_PHP / ${fx})                AS COMMITTED
      FROM BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
      ${where}
      GROUP BY SUPPLIER_NAME, SOURCING_COUNTRY
      ORDER BY COMMITTED DESC
    `),
  ]);

  return {
    currency,
    purchaseOrders: poRows.map(mapPoRow),
    suppliers: supplierRows.map((r) => ({
      supplierName: String(r.SUPPLIER_NAME),
      sourcingCountry: String(r.SOURCING_COUNTRY),
      poCount: num(r.PO_COUNT),
      delayedCount: num(r.DELAYED_COUNT),
      avgSlipDays: numOrNull(r.AVG_SLIP_DAYS),
      committed: num(r.COMMITTED),
    })),
  };
}

// ─── Exceptions ───────────────────────────────────────────────────────────────

async function handleExceptions() {
  const rows = await querySnowflake(`
    SELECT EXCEPTION_TYPE, SEVERITY, PLAN_LEVEL, NODE, DEPARTMENT, CLASS,
           METRIC, VARIANCE_PCT, VARIANCE_PHP, HEADLINE
    FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_EXCEPTIONS
    ORDER BY CASE SEVERITY WHEN 'HIGH' THEN 1 ELSE 2 END, EXCEPTION_TYPE, NODE
  `);

  return {
    exceptions: rows.map((r) => ({
      type: String(r.EXCEPTION_TYPE),
      severity: String(r.SEVERITY),
      planLevel: String(r.PLAN_LEVEL),
      node: String(r.NODE),
      department: r.DEPARTMENT ? String(r.DEPARTMENT) : null,
      class: r.CLASS ? String(r.CLASS) : null,
      metric: String(r.METRIC),
      variancePct: numOrNull(r.VARIANCE_PCT),
      variancePhp: numOrNull(r.VARIANCE_PHP),
      headline: String(r.HEADLINE),
    })),
  };
}

// ─── Overview (planning dashboard) ────────────────────────────────────────────

async function handleOverview(currency: string) {
  const [mfp, otb, exceptions] = await Promise.all([
    handleMfpRbu(currency),
    querySnowflake(`
      SELECT
        SUM(STOCK_PHP         / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"}) AS STOCK,
        SUM(ON_ORDER_PHP      / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"}) AS ON_ORDER,
        SUM(OTB_AVAILABLE_PHP / ${currency === "AUD" ? "FX_RATE_PHP_AUD" : "1"}) AS OTB_AVAILABLE,
        ROUND(SUM(STOCK_PHP) / NULLIF(SUM(AVG_WK_SLS_PHP), 0), 1) AS COVER_WEEKS,
        COUNT_IF(BUY_STATUS = 'OVERBUY')  AS OVERBUY_CLASSES,
        COUNT_IF(BUY_STATUS = 'UNDERBUY') AS UNDERBUY_CLASSES
      FROM BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY
      WHERE PLAN_LEVEL = 'CLASS'
    `),
    handleExceptions(),
  ]);

  const o = otb[0] || {};

  return {
    currency,
    mfp: mfp.total,
    departments: mfp.rows,
    trend: mfp.trend,
    otb: {
      stock: num(o.STOCK),
      onOrder: num(o.ON_ORDER),
      otbAvailable: num(o.OTB_AVAILABLE),
      coverWeeks: num(o.COVER_WEEKS),
      // Counted at CLASS level, matching what /planning/otb shows. Counting
      // departments here while the OTB page counted classes made the dashboard
      // claim "0 overbought" against the OTB page's 4.
      overbuyClasses: num(o.OVERBUY_CLASSES),
      underbuyClasses: num(o.UNDERBUY_CLASSES),
    },
    exceptions: exceptions.exceptions,
  };
}

// ─── AI insights ──────────────────────────────────────────────────────────────

async function handleInsights(request: NextRequest) {
  const body = await request.json();
  const level = String(body.level || "DEPARTMENT").toUpperCase();
  const node = String(body.node || "").trim();
  const scenario = body.scenario ? String(body.scenario).trim() : null;

  if (!node) {
    return NextResponse.json({ error: "node is required" }, { status: 400 });
  }
  if (!["RBU", "DEPARTMENT", "CLASS"].includes(level)) {
    return NextResponse.json(
      { error: `level must be RBU, DEPARTMENT or CLASS, got "${level}"` },
      { status: 400 }
    );
  }

  const sql = `CALL BABY_MART_DEMO.AI.GENERATE_PLANNING_INSIGHTS(
    '${escapeSql(level)}',
    '${escapeSql(node)}',
    ${scenario ? `'${escapeSql(scenario)}'` : "NULL"}
  )`;

  const rows = await querySnowflake(sql);
  const raw = rows.length > 0 ? rows[0].GENERATE_PLANNING_INSIGHTS : null;
  if (!raw) {
    return NextResponse.json(
      { error: `No insights returned for ${level} ${node}.` },
      { status: 502 }
    );
  }

  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  // The procedure reports a missing node as {error}, not by throwing.
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  // insights_raw is only populated when the model's JSON failed to parse.
  if (!result.insights) {
    return NextResponse.json(
      {
        error: "The model response could not be parsed.",
        raw: result.insights_raw ?? null,
        metrics: result.metrics ?? null,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(result);
}

// ─── Scenario modelling ───────────────────────────────────────────────────────
