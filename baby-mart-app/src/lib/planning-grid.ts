import { querySnowflake, toIsoDate, toIsoDateTime } from "@/lib/snowflake";

// ─── Weekly planning grid, sandbox scenarios and approval history ─────────────
//
// Split out of the planning route so that file stays a dispatcher. Every handler
// returns a plain object; the route wraps it in NextResponse.
//
// SQL is written against BABY_MART_DEMO.* literally. querySnowflake pipes each
// statement through remapNamespace, so the prefix must never be built from env
// vars here.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Parses the JSON string a Snowflake procedure returns via CALL.
 *  Procedures here return OBJECT_CONSTRUCT(...)::STRING, so the CALL result is a
 *  single column holding a JSON document. Returning the raw text on a parse
 *  failure keeps the error debuggable instead of silently empty. */
function parseProcResult(rows: Record<string, unknown>[]): Record<string, unknown> {
  if (rows.length === 0) return { ok: false, error: "Procedure returned no rows" };
  const raw = String(Object.values(rows[0])[0] ?? "");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Could not parse procedure result", raw };
  }
}

/** SLS_UNITS is a count, so it must not be divided by the FX rate. Doing the
 *  split here rather than in SQL keeps one code path for all three metrics. */
const CURRENCY_METRICS = new Set(["SLS_PHP", "POS_GP_AMT"]);

/** Stable key for a week column. Period code plus week number, not the week
 *  ending date: the date would work today but breaks the moment two fiscal years
 *  are shown together. */
function weekKey(periodCode: string, weekNo: number): string {
  return `${periodCode}-${weekNo}`;
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

export type GridWeek = {
  key: string;
  periodCode: string;
  periodNo: number;
  monthName: string;
  weekNo: number;
  weekSeq: number;
  weekEnding: string | null;
  isClosed: boolean;
};

/** The Excel-parity weekly grid for one class.
 *
 *  Returns RAW values per (metric, version, week) and lets the client derive the
 *  month subtotal columns, the Act/FC blend, the variance rows, CAGR and every
 *  margin percentage. That split is deliberate: all of those have to recompute
 *  live as a planner types into an FC cell, and anything computed server-side
 *  would be stale between a keystroke and a save -- so the displayed value and
 *  the saved value would disagree, which is the one thing a planning grid must
 *  never do.
 *
 *  `scenario` overlays a sandbox scenario's cells onto the FC row. The stored
 *  fact is never modified.
 */
export async function handleGrid(
  department: string,
  klass: string,
  half: string | null,
  scenarioId: string | null,
  currency: string
) {
  const dept = escapeSql(department.toUpperCase());
  const cls = escapeSql(klass.toUpperCase());
  const halfFilter = half === "H1" || half === "H2" ? `AND w.HALF = '${half}'` : "";
  const sid = scenarioId ? escapeSql(scenarioId) : null;

  const [valueRows, cellRows, annRows, settingRows, tabRows, fxRows] = await Promise.all([
    // Stored versions only. ACT_FC is deliberately NOT read from VW_MFP_WEEKLY:
    // that view blends against the FACT forecast, which would ignore an active
    // scenario's edits. The client rebuilds the blend from ACT and the resolved
    // FC so the Act/FC row always agrees with the two rows above it.
    querySnowflake(`
      SELECT
        w.PERIOD_CODE, w.PERIOD_NO, w.MONTH_NAME, w.HALF, w.WEEK_NO, w.WEEK_SEQ,
        w.WEEK_ENDING_DATE, w.IS_CLOSED, w.VERSION, w.METRIC, w.VALUE_PHP,
        w.CLASS_CODE, w.PERIOD_TYPE
      FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
      WHERE w.PLAN_LEVEL = 'CLASS'
        AND UPPER(w.DEPARTMENT) = '${dept}'
        AND UPPER(w.CLASS) = '${cls}'
        AND w.FISCAL_YEAR = 'F27'
        ${halfFilter}
      ORDER BY w.WEEK_SEQ
    `),
    sid
      ? querySnowflake(`
          SELECT PERIOD_CODE, WEEK_NO, METRIC, VALUE_PHP, BASELINE_PHP,
                 IS_PINNED, REASON_CODE, REASON_NOTE, EDITED_BY, EDITED_AT
          FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL
          WHERE SCENARIO_ID = '${sid}'
            AND UPPER(CLASS) = '${cls}'
        `)
      : Promise.resolve([]),
    querySnowflake(`
      SELECT ANNOTATION_ID, PERIOD_CODE, WEEK_NO, METRIC, VERSION,
             ANNOTATION_TYPE, ANNOTATION_VALUE, AUTHOR, CREATED_AT
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION
      WHERE UPPER(CLASS) = '${cls}'
        AND (SCENARIO_ID IS NULL ${sid ? `OR SCENARIO_ID = '${sid}'` : ""})
      ORDER BY PERIOD_CODE, WEEK_NO
    `),
    querySnowflake(`
      SELECT SETTING_KEY, SETTING_VALUE
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
      WHERE SETTING_KEY IN ('ACTUALS_CUTOFF_DATE', 'DEFAULT_PLANNER_NAME')
    `),
    // The sheet-tab strip. Sibling classes in the same department, which is what
    // the source workbook's .OSJP / .OSLW / .OSME tabs are.
    querySnowflake(`
      SELECT CLASS, CLASS_CODE, LFL_STRATEGY
      FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
      WHERE UPPER(DEPARTMENT) = '${dept}'
      ORDER BY CLASS_CODE
    `),
    // FX from VW_PLANNING_PARAM, not DIM_FISCAL_PERIOD. The FX_RATE_PHP_AUD
    // setting already existed but every view read the calendar instead, so
    // editing the setting changed nothing -- worse than not offering it.
    querySnowflake(`
      SELECT FX_RATE_PHP_AUD AS FX FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM
    `),
  ]);

  if (valueRows.length === 0) {
    return { error: `No weekly plan found for ${department} / ${klass}` };
  }

  const fx = currency === "AUD" ? num(fxRows[0]?.FX) || 36.1 : 1;

  // Week columns, deduplicated in fiscal order.
  const weekMap = new Map<string, GridWeek>();
  for (const r of valueRows) {
    const pc = String(r.PERIOD_CODE);
    const wn = num(r.WEEK_NO);
    const k = weekKey(pc, wn);
    if (!weekMap.has(k)) {
      weekMap.set(k, {
        key: k,
        periodCode: pc,
        periodNo: num(r.PERIOD_NO),
        monthName: String(r.MONTH_NAME),
        weekNo: wn,
        weekSeq: num(r.WEEK_SEQ),
        weekEnding: toIsoDate(r.WEEK_ENDING_DATE),
        isClosed: r.IS_CLOSED === true || r.IS_CLOSED === "true",
      });
    }
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.weekSeq - b.weekSeq);

  // Month groups, which become the bold subtotal columns interleaved after each
  // month's four weeks.
  const monthOrder: string[] = [];
  const monthWeeks = new Map<string, string[]>();
  for (const w of weeks) {
    if (!monthWeeks.has(w.periodCode)) {
      monthWeeks.set(w.periodCode, []);
      monthOrder.push(w.periodCode);
    }
    monthWeeks.get(w.periodCode)!.push(w.key);
  }
  const months = monthOrder.map((pc) => {
    const first = weeks.find((w) => w.periodCode === pc)!;
    return {
      key: pc,
      periodCode: pc,
      monthName: first.monthName,
      periodNo: first.periodNo,
      weekKeys: monthWeeks.get(pc)!,
    };
  });

  // values[metric][version][weekKey]
  const values: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of valueRows) {
    const metric = String(r.METRIC);
    const version = String(r.VERSION);
    const k = weekKey(String(r.PERIOD_CODE), num(r.WEEK_NO));
    const divisor = CURRENCY_METRICS.has(metric) ? fx : 1;
    values[metric] ??= {};
    values[metric][version] ??= {};
    values[metric][version][k] = num(r.VALUE_PHP) / divisor;
  }

  // Scenario overlay onto the FC row, plus the per-cell edit metadata that
  // drives the blue fill.
  const edited: Record<string, Record<string, {
    pinned: boolean;
    reasonCode: string | null;
    reasonNote: string | null;
    editedBy: string | null;
    editedAt: string | null;
    baseline: number;
  }>> = {};
  for (const r of cellRows) {
    const metric = String(r.METRIC);
    const k = weekKey(String(r.PERIOD_CODE), num(r.WEEK_NO));
    const divisor = CURRENCY_METRICS.has(metric) ? fx : 1;
    values[metric] ??= {};
    values[metric]["FC"] ??= {};
    values[metric]["FC"][k] = num(r.VALUE_PHP) / divisor;
    edited[metric] ??= {};
    edited[metric][k] = {
      pinned: r.IS_PINNED === true || r.IS_PINNED === "true",
      reasonCode: str(r.REASON_CODE),
      reasonNote: str(r.REASON_NOTE),
      editedBy: str(r.EDITED_BY),
      editedAt: toIsoDateTime(r.EDITED_AT),
      baseline: num(r.BASELINE_PHP) / divisor,
    };
  }

  const settings: Record<string, string> = {};
  for (const r of settingRows) settings[String(r.SETTING_KEY)] = String(r.SETTING_VALUE);

  const annotations = annRows.map((r) => ({
    id: String(r.ANNOTATION_ID),
    periodCode: str(r.PERIOD_CODE),
    weekNo: numOrNull(r.WEEK_NO),
    weekKey:
      r.PERIOD_CODE && r.WEEK_NO !== null && r.WEEK_NO !== undefined
        ? weekKey(String(r.PERIOD_CODE), num(r.WEEK_NO))
        : null,
    metric: str(r.METRIC),
    version: str(r.VERSION),
    type: String(r.ANNOTATION_TYPE),
    value: String(r.ANNOTATION_VALUE),
    author: str(r.AUTHOR),
    createdAt: toIsoDateTime(r.CREATED_AT),
  }));

  // Most recent edit anywhere in this class, for the provenance block. Falls
  // back to the seeded annotation timestamp so the corner is never blank.
  const lastEdit = cellRows
    .map((r) => toIsoDateTime(r.EDITED_AT))
    .filter((v): v is string => v !== null)
    .sort()
    .pop() ?? null;

  return {
    currency,
    fxRate: currency === "AUD" ? fx : null,
    department: department.toUpperCase(),
    class: klass.toUpperCase(),
    classCode: str(valueRows[0].CLASS_CODE),
    fiscalYear: "F27",
    half: half === "H1" || half === "H2" ? half : null,
    scenarioId: sid,
    weeks,
    months,
    values,
    edited,
    annotations,
    classTabs: tabRows.map((r) => ({
      class: String(r.CLASS),
      classCode: String(r.CLASS_CODE),
      strategy: str(r.LFL_STRATEGY),
    })),
    actualsCutoff: settings.ACTUALS_CUTOFF_DATE ?? null,
    planner: settings.DEFAULT_PLANNER_NAME ?? null,
    lastEditedAt: lastEdit,
    lastEditedBy:
      cellRows.length > 0 ? str(cellRows[cellRows.length - 1].EDITED_BY) : null,
  };
}

/** Persist edited FC cells into a scenario overlay.
 *
 *  Creates a MANUAL scenario on first save when none is supplied, so a planner
 *  can start typing without first deciding they are "making a scenario" -- and
 *  their edits still land in a sandbox rather than on the approved forecast.
 *
 *  Saved cells are PINNED. Re-running a generated scenario or a lever over the
 *  top must not silently discard a number a planner typed after a supplier call.
 */
export async function handleGridSave(request: Request) {
  const body = await request.json();
  const department = String(body.department ?? "");
  const klass = String(body.class ?? "");
  const half = body.half === "H1" || body.half === "H2" ? body.half : null;
  const editedBy = String(body.editedBy ?? "Planner");
  const reasonCode = body.reasonCode ? String(body.reasonCode) : null;
  const reasonNote = body.reasonNote ? String(body.reasonNote) : null;
  const cells = Array.isArray(body.cells) ? body.cells : [];

  if (!department || !klass) return { error: "department and class are required" };
  if (cells.length === 0) return { ok: true, saved: 0, scenarioId: body.scenarioId ?? null };

  const dept = escapeSql(department.toUpperCase());
  const cls = escapeSql(klass.toUpperCase());

  let scenarioId: string = body.scenarioId ? String(body.scenarioId) : "";

  if (!scenarioId) {
    scenarioId = `SCN-MANUAL-${Date.now()}`;
    await querySnowflake(`
      INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
        (SCENARIO_ID, SCENARIO_NAME, SCENARIO_TYPE, SIBLING_LABEL, PROMPT_TEXT,
         RBU, DEPARTMENT, CLASS, FISCAL_YEAR, HALF, ASSUMPTIONS, STATUS,
         CREATED_BY, CREATED_AT, UPDATED_AT)
      SELECT
        '${escapeSql(scenarioId)}',
        'Manual edits: ${cls}',
        'MANUAL', NULL, NULL,
        MAX(RBU), MAX(DEPARTMENT), MAX(CLASS), 'F27',
        ${half ? `'${half}'` : "NULL"},
        OBJECT_CONSTRUCT('method', 'Hand-typed forecast cells. No model or lever applied.'),
        'DRAFT', '${escapeSql(editedBy)}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
      FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY
      WHERE UPPER(DEPARTMENT) = '${dept}' AND UPPER(CLASS) = '${cls}'
    `);
  }

  // Values arrive in the display currency, so convert back to PHP before
  // storing. The fact is PHP-native and mixing the two in one column is how a
  // stored plan silently becomes 36x too small.
  const fxRows = await querySnowflake(`
    SELECT FX_RATE_PHP_AUD AS FX FROM BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM
  `);
  const fx = body.currency === "AUD" ? num(fxRows[0]?.FX) || 36.1 : 1;

  const tuples = cells
    .filter(
      (c: Record<string, unknown>) =>
        c && c.periodCode && c.metric && c.weekNo !== undefined && c.value !== undefined
    )
    .map((c: Record<string, unknown>) => {
      const metric = String(c.metric);
      const raw = num(c.value) * (CURRENCY_METRICS.has(metric) ? fx : 1);
      return `('${escapeSql(String(c.periodCode))}', ${num(c.weekNo)}, '${escapeSql(metric)}', ${raw})`;
    });

  if (tuples.length === 0) return { ok: true, saved: 0, scenarioId };

  // Read the CURRENT values before the MERGE overwrites them. The audit trail
  // needs the value that was on screen a moment ago, and once the MERGE has run
  // it is gone. Reconstructing it afterwards from FACT_MFP_WEEKLY would give the
  // delta against the ML baseline instead, so two successive edits to one cell
  // would each report the full movement from the baseline and the trail would
  // double-count the same change.
  const priorRows = await querySnowflake(`
    SELECT PERIOD_CODE, WEEK_NO, METRIC, VALUE_PHP, BASELINE_PHP
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL
    WHERE SCENARIO_ID = '${escapeSql(scenarioId)}' AND UPPER(CLASS) = '${cls}'
  `);
  const prior = new Map<string, { value: number; baseline: number }>();
  for (const r of priorRows) {
    prior.set(`${String(r.PERIOD_CODE)}|${num(r.WEEK_NO)}|${String(r.METRIC)}`, {
      value: num(r.VALUE_PHP),
      baseline: num(r.BASELINE_PHP),
    });
  }

  // MERGE rather than DELETE + INSERT so a re-save preserves the ORIGINAL
  // baseline captured at the first edit. Re-reading the baseline on every save
  // would make the variance-to-forecast column drift toward zero as a planner
  // iterated, hiding the size of their own change.
  await querySnowflake(`
    MERGE INTO BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL t
    USING (
      SELECT
        w.DEPARTMENT, w.CLASS, w.CLASS_CODE, w.FISCAL_YEAR,
        v.PERIOD_CODE, v.WEEK_NO, w.WEEK_SEQ, v.METRIC, v.NEW_VALUE,
        w.VALUE_PHP AS BASELINE_PHP
      FROM (
        SELECT COLUMN1::VARCHAR AS PERIOD_CODE, COLUMN2::INT AS WEEK_NO,
               COLUMN3::VARCHAR AS METRIC, COLUMN4::FLOAT AS NEW_VALUE
        FROM VALUES ${tuples.join(", ")}
      ) v
      JOIN BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
        ON  w.PERIOD_CODE = v.PERIOD_CODE
       AND  w.WEEK_NO     = v.WEEK_NO
       AND  w.METRIC      = v.METRIC
       AND  w.VERSION     = 'FC'
       AND  w.PLAN_LEVEL  = 'CLASS'
       AND  UPPER(w.DEPARTMENT) = '${dept}'
       AND  UPPER(w.CLASS)      = '${cls}'
    ) s
    ON  t.SCENARIO_ID = '${escapeSql(scenarioId)}'
    AND t.CLASS       = s.CLASS
    AND t.PERIOD_CODE = s.PERIOD_CODE
    AND t.WEEK_NO     = s.WEEK_NO
    AND t.METRIC      = s.METRIC
    WHEN MATCHED THEN UPDATE SET
      t.VALUE_PHP   = s.NEW_VALUE,
      t.IS_PINNED   = TRUE,
      t.REASON_CODE = ${reasonCode ? `'${escapeSql(reasonCode)}'` : "t.REASON_CODE"},
      t.REASON_NOTE = ${reasonNote ? `'${escapeSql(reasonNote)}'` : "t.REASON_NOTE"},
      t.EDITED_BY   = '${escapeSql(editedBy)}',
      t.EDITED_AT   = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT
      (SCENARIO_ID, DEPARTMENT, CLASS, CLASS_CODE, FISCAL_YEAR, PERIOD_CODE,
       WEEK_NO, WEEK_SEQ, METRIC, VALUE_PHP, BASELINE_PHP, IS_PINNED,
       REASON_CODE, REASON_NOTE, EDITED_BY, EDITED_AT)
    VALUES
      ('${escapeSql(scenarioId)}', s.DEPARTMENT, s.CLASS, s.CLASS_CODE, s.FISCAL_YEAR,
       s.PERIOD_CODE, s.WEEK_NO, s.WEEK_SEQ, s.METRIC, s.NEW_VALUE, s.BASELINE_PHP, TRUE,
       ${reasonCode ? `'${escapeSql(reasonCode)}'` : "NULL"},
       ${reasonNote ? `'${escapeSql(reasonNote)}'` : "NULL"},
       '${escapeSql(editedBy)}', CURRENT_TIMESTAMP())
  `);

  await querySnowflake(`
    UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    SET UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE SCENARIO_ID = '${escapeSql(scenarioId)}'
  `);

  // Audit trail. Built from the pre-read map so OLD_VALUE is what the planner was
  // looking at, and wrapped in try/catch because a missing audit table must not
  // fail a save -- losing an edit is worse than losing its history entry.
  try {
    const auditCells = cells
      .filter(
        (c: Record<string, unknown>) =>
          c && c.periodCode && c.metric && c.weekNo !== undefined && c.value !== undefined
      )
      .map((c: Record<string, unknown>) => {
        const metric = String(c.metric);
        const newPhp = num(c.value) * (CURRENCY_METRICS.has(metric) ? fx : 1);
        const p = prior.get(`${String(c.periodCode)}|${num(c.weekNo)}|${metric}`);
        return {
          period_code: String(c.periodCode),
          week_no: num(c.weekNo),
          metric,
          // No prior cell means this is the first edit to it, so the value it is
          // moving away from is the forecast rather than an earlier edit.
          old: p ? p.value : null,
          new: newPhp,
          baseline: p ? p.baseline : null,
          reason_code: reasonCode,
          reason_note: reasonNote,
        };
      });

    await querySnowflake(`
      CALL BABY_MART_DEMO.ANALYTICS.LOG_CELL_CHANGES(
        '${escapeSql(scenarioId)}', 'MANUAL_GRID', '${escapeSql(editedBy)}',
        PARSE_JSON('${escapeSql(JSON.stringify(auditCells))}'))
    `);
  } catch (e: unknown) {
    console.error(
      `[planning] audit log failed for ${scenarioId}: ${e instanceof Error ? e.message : e}`
    );
  }

  return { ok: true, saved: tuples.length, scenarioId };
}

// ─── Option productivity ──────────────────────────────────────────────────────

/** The productivity ranking behind a range rationalisation.
 *
 *  Ordered worst-first, because the question this answers is always "what should
 *  come out", never "what is best". */
export async function handleOptions(
  klass: string,
  half: string | null,
  currency: string
) {
  const cls = escapeSql(klass.toUpperCase());
  const h = half === "H1" || half === "H2" ? half : "H2";
  const fx = currency === "AUD" ? "FX_RATE_PHP_AUD" : "1";

  const rows = await querySnowflake(`
    SELECT
      p.OPTION_ID, p.OPTION_CODE, p.OPTION_DESC, p.OPTION_STATUS,
      p.SUPPLIER_NAME, p.COUNTRY_OF_ORIGIN, p.CLASS, p.DEPARTMENT,
      p.SLS_PHP    / ${fx} AS SLS,
      p.SLS_UNITS,
      p.POS_GP_AMT / ${fx} AS GP,
      p.STOCK_PHP  / ${fx} AS STOCK,
      p.ASP_PHP    / ${fx} AS ASP,
      p.GP_PCT, p.RATE_OF_SALE,
      p.GP_PER_OPTION_WEEK / ${fx} AS GP_PER_WEEK,
      p.SELL_THROUGH_PCT, p.STOCK_TURN, p.COVER_WEEKS,
      p.PRODUCTIVITY_RANK, p.PRODUCTIVITY_DECILE, p.CLASS_OPTION_COUNT,
      p.SHARE_OF_CLASS_GP_PCT, p.SHARE_OF_CLASS_SLS_PCT
    FROM BABY_MART_DEMO.ANALYTICS.VW_OPTION_PRODUCTIVITY p
    CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
    WHERE UPPER(p.CLASS) = '${cls}' AND p.HALF = '${h}'
    ORDER BY p.GP_PER_OPTION_WEEK ASC
  `);

  return {
    currency,
    class: klass.toUpperCase(),
    half: h,
    options: rows.map((r) => ({
      optionId: String(r.OPTION_ID),
      optionCode: String(r.OPTION_CODE),
      description: String(r.OPTION_DESC),
      status: String(r.OPTION_STATUS),
      supplier: str(r.SUPPLIER_NAME),
      origin: str(r.COUNTRY_OF_ORIGIN),
      sales: num(r.SLS),
      units: num(r.SLS_UNITS),
      gp: num(r.GP),
      stock: num(r.STOCK),
      asp: num(r.ASP),
      gpPct: numOrNull(r.GP_PCT),
      rateOfSale: numOrNull(r.RATE_OF_SALE),
      gpPerWeek: num(r.GP_PER_WEEK),
      sellThroughPct: numOrNull(r.SELL_THROUGH_PCT),
      stockTurn: numOrNull(r.STOCK_TURN),
      coverWeeks: numOrNull(r.COVER_WEEKS),
      rank: num(r.PRODUCTIVITY_RANK),
      decile: num(r.PRODUCTIVITY_DECILE),
      classOptionCount: num(r.CLASS_OPTION_COUNT),
      shareOfGpPct: numOrNull(r.SHARE_OF_CLASS_GP_PCT),
      shareOfSalesPct: numOrNull(r.SHARE_OF_CLASS_SLS_PCT),
    })),
  };
}

// ─── Scenario sandbox ─────────────────────────────────────────────────────────

/** Every scenario with its impact, plus the option actions and AI decision.
 *  This is the Step 3 comparison table's data source. */
export async function handleScenarioList(currency: string) {
  const fx = currency === "AUD" ? "f.FX_RATE_PHP_AUD" : "1";

  const [scenarioRows, optionRows, decisionRows] = await Promise.all([
    querySnowflake(`
      SELECT
        i.SCENARIO_ID, i.SCENARIO_NAME, i.SCENARIO_TYPE, i.PARENT_SCENARIO_ID,
        i.SIBLING_LABEL, i.PROMPT_TEXT, i.DEPARTMENT, i.CLASS, i.HALF, i.STATUS,
        i.NARRATIVE, i.ASSUMPTIONS, i.CREATED_BY, i.CREATED_AT,
        i.BASE_SLS  / ${fx} AS BASE_SLS,
        i.SCEN_SLS  / ${fx} AS SCEN_SLS,
        i.SLS_DELTA_PHP / ${fx} AS SLS_DELTA,
        i.SLS_DELTA_PCT,
        i.BASE_UNITS, i.SCEN_UNITS, i.UNITS_DELTA,
        i.BASE_GP   / ${fx} AS BASE_GP,
        i.SCEN_GP   / ${fx} AS SCEN_GP,
        i.GP_DELTA_PHP  / ${fx} AS GP_DELTA,
        i.GP_DELTA_PCT,
        i.BASE_ASP  / ${fx} AS BASE_ASP,
        i.SCEN_ASP  / ${fx} AS SCEN_ASP,
        i.BASE_GP_PCT, i.SCEN_GP_PCT, i.GP_PCT_DELTA_PP,
        i.STOCK_DELTA_PHP / ${fx} AS STOCK_DELTA,
        i.OPTIONS_DROPPED, i.OPTIONS_ADDED, i.OPTIONS_REPRICED, i.EDITED_CELLS,
        -- Hand edits made AFTER the scenario was generated. The narrative is a
        -- stored string written at generation time, so once a planner overrides a
        -- cell in the grid the prose still quotes the original figures while the
        -- impact tiles show the new ones -- the card contradicted itself by
        -- PHP 1.9M. The UI uses this to mark the narrative as superseded rather
        -- than silently print a stale number.
        (SELECT COUNT(*)
           FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL pc
          WHERE pc.SCENARIO_ID = i.SCENARIO_ID
            AND NVL(pc.IS_PINNED, FALSE))          AS HAND_EDITS
      FROM BABY_MART_DEMO.ANALYTICS.VW_SCENARIO_IMPACT i
      CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
      ORDER BY i.CREATED_AT DESC, i.SIBLING_LABEL
    `),
    querySnowflake(`
      SELECT
        o.SCENARIO_ID, o.OPTION_ID, o.OPTION_LABEL, o.CLASS, o.ACTION,
        o.TRANSFER_PCT,
        o.SLS_DELTA_PHP   / ${fx} AS SLS_DELTA,
        o.UNITS_DELTA,
        o.GP_DELTA_PHP    / ${fx} AS GP_DELTA,
        o.STOCK_DELTA_PHP / ${fx} AS STOCK_DELTA,
        o.PRODUCTIVITY_RANK,
        o.GP_PER_OPTION_WEEK / ${fx} AS GP_PER_WEEK,
        o.COVER_WEEKS
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_OPTION o
      CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
      ORDER BY ABS(NVL(o.GP_DELTA_PHP, 0)) DESC
    `),
    querySnowflake(`
      SELECT DECISION_ID, SCENARIO_ID, AI_RECOMMENDATION, AI_RATIONALE,
             AI_CONFIDENCE, HUMAN_DECISION, HUMAN_RATIONALE, DECIDED_BY,
             DECIDED_AT, AGREED_WITH_AI, RESULTING_VERSION_ID
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION
    `),
  ]);

  const optionsBy = new Map<string, Record<string, unknown>[]>();
  for (const r of optionRows) {
    const k = String(r.SCENARIO_ID);
    if (!optionsBy.has(k)) optionsBy.set(k, []);
    optionsBy.get(k)!.push({
      optionId: str(r.OPTION_ID),
      label: String(r.OPTION_LABEL),
      class: str(r.CLASS),
      action: String(r.ACTION),
      transferPct: numOrNull(r.TRANSFER_PCT),
      salesDelta: num(r.SLS_DELTA),
      unitsDelta: num(r.UNITS_DELTA),
      gpDelta: num(r.GP_DELTA),
      stockDelta: num(r.STOCK_DELTA),
      rank: numOrNull(r.PRODUCTIVITY_RANK),
      gpPerWeek: numOrNull(r.GP_PER_WEEK),
      coverWeeks: numOrNull(r.COVER_WEEKS),
    });
  }

  const decisionBy = new Map<string, Record<string, unknown>>();
  for (const r of decisionRows) {
    decisionBy.set(String(r.SCENARIO_ID), {
      decisionId: String(r.DECISION_ID),
      aiRecommendation: str(r.AI_RECOMMENDATION),
      aiRationale: str(r.AI_RATIONALE),
      aiConfidence: str(r.AI_CONFIDENCE),
      humanDecision: str(r.HUMAN_DECISION),
      humanRationale: str(r.HUMAN_RATIONALE),
      decidedBy: str(r.DECIDED_BY),
      decidedAt: toIsoDateTime(r.DECIDED_AT),
      agreedWithAi:
        r.AGREED_WITH_AI === null || r.AGREED_WITH_AI === undefined
          ? null
          : r.AGREED_WITH_AI === true || r.AGREED_WITH_AI === "true",
      resultingVersionId: str(r.RESULTING_VERSION_ID),
    });
  }

  return {
    currency,
    scenarios: scenarioRows.map((r) => ({
      scenarioId: String(r.SCENARIO_ID),
      name: String(r.SCENARIO_NAME),
      type: String(r.SCENARIO_TYPE),
      parentId: str(r.PARENT_SCENARIO_ID),
      siblingLabel: str(r.SIBLING_LABEL),
      prompt: str(r.PROMPT_TEXT),
      department: str(r.DEPARTMENT),
      class: str(r.CLASS),
      half: str(r.HALF),
      status: String(r.STATUS),
      narrative: str(r.NARRATIVE),
      handEdits: num(r.HAND_EDITS) ?? 0,
      // ASSUMPTIONS is a VARIANT, which the driver hands back as a JSON string.
      assumptions: (() => {
        const v = r.ASSUMPTIONS;
        if (v === null || v === undefined) return null;
        if (typeof v === "object") return v;
        try {
          return JSON.parse(String(v));
        } catch {
          return null;
        }
      })(),
      createdBy: str(r.CREATED_BY),
      createdAt: toIsoDateTime(r.CREATED_AT),
      baseSales: num(r.BASE_SLS),
      scenarioSales: num(r.SCEN_SLS),
      salesDelta: num(r.SLS_DELTA),
      salesDeltaPct: numOrNull(r.SLS_DELTA_PCT),
      baseUnits: num(r.BASE_UNITS),
      scenarioUnits: num(r.SCEN_UNITS),
      unitsDelta: num(r.UNITS_DELTA),
      baseGp: num(r.BASE_GP),
      scenarioGp: num(r.SCEN_GP),
      gpDelta: num(r.GP_DELTA),
      gpDeltaPct: numOrNull(r.GP_DELTA_PCT),
      baseAsp: num(r.BASE_ASP),
      scenarioAsp: num(r.SCEN_ASP),
      baseGpPct: numOrNull(r.BASE_GP_PCT),
      scenarioGpPct: numOrNull(r.SCEN_GP_PCT),
      gpPctDeltaPp: numOrNull(r.GP_PCT_DELTA_PP),
      stockDelta: num(r.STOCK_DELTA),
      optionsDropped: num(r.OPTIONS_DROPPED),
      optionsAdded: num(r.OPTIONS_ADDED),
      optionsRepriced: num(r.OPTIONS_REPRICED),
      editedCells: num(r.EDITED_CELLS),
      options: optionsBy.get(String(r.SCENARIO_ID)) ?? [],
      decision: decisionBy.get(String(r.SCENARIO_ID)) ?? null,
    })),
  };
}

/** Natural-language entry point for both slide steps.
 *
 *  Parses first, then dispatches to the matching deterministic builder. The
 *  parse result is returned alongside the outcome even on failure, so a planner
 *  can see WHAT was understood rather than only that something went wrong --
 *  which is the difference between a usable prompt box and a magic one. */
export async function handleScenarioPrompt(request: Request) {
  const body = await request.json();
  const prompt = String(body.prompt ?? "").trim();
  const createdBy = String(body.createdBy ?? "Planner");
  if (!prompt) return { error: "Enter a scenario to model." };

  const parsed = parseProcResult(
    await querySnowflake(
      `CALL BABY_MART_DEMO.ANALYTICS.PARSE_SCENARIO_PROMPT('${escapeSql(prompt)}')`
    )
  );
  if (parsed.ok !== true) return { ok: false, parsed, error: String(parsed.error ?? "Could not parse") };

  const intent = String(parsed.intent ?? "UNKNOWN");
  // The UI may scope the request even when the sentence does not, so an explicit
  // department or class from the page wins over a null from the parse.
  const dept = body.department ? String(body.department) : (parsed.department as string | null);
  const cls = body.class ? String(body.class) : (parsed.class as string | null);
  const half = (body.half as string | null) ?? (parsed.half as string | null) ?? "H2";

  if (intent === "RANGE_RATIONALISATION") {
    if (!cls) {
      return {
        ok: false,
        parsed,
        error:
          "Name a class to rationalise, for example \"rationalise the bottom 25% of TRAVEL SYSTEM SKUs\".",
      };
    }
    const res = parseProcResult(
      await querySnowflake(`
        CALL BABY_MART_DEMO.ANALYTICS.BUILD_RANGE_RATIONALISATION(
          '${escapeSql(cls)}',
          ${num(parsed.bottom_pct) || 10},
          '${escapeSql(half)}',
          '${escapeSql(createdBy)}',
          '${escapeSql(prompt)}')
      `)
    );
    return { ...res, parsed, intent };
  }

  if (intent === "GOAL_SEEK") {
    const target = num(parsed.target_gp_php);
    if (!target) {
      return {
        ok: false,
        parsed,
        error:
          "Say how much gross profit to find, for example \"find another 500k of GP in H2\".",
      };
    }
    const res = parseProcResult(
      await querySnowflake(`
        CALL BABY_MART_DEMO.ANALYTICS.GOAL_SEEK_GP(
          ${dept ? `'${escapeSql(dept)}'` : "NULL"},
          ${cls ? `'${escapeSql(cls)}'` : "NULL"},
          ${target},
          '${escapeSql(half)}',
          '${escapeSql(createdBy)}',
          '${escapeSql(prompt)}')
      `)
    );
    return { ...res, parsed, intent };
  }

  return {
    ok: false,
    parsed,
    intent,
    error:
      parsed.unresolved
        ? String(parsed.unresolved)
        : "That reads like a broad lever change rather than a range or goal-seek scenario. Use the Levers tab for demand, price, cost or markdown moves.",
  };
}

/** AI recommendation, then optionally the human decision.
 *  Both are stored; neither overwrites the other. */
export async function handleScenarioDecide(request: Request) {
  const body = await request.json();
  const scenarioId = String(body.scenarioId ?? "");
  if (!scenarioId) return { error: "scenarioId is required" };

  const humanDecision = body.humanDecision ? String(body.humanDecision).toUpperCase() : null;

  if (!humanDecision) {
    return parseProcResult(
      await querySnowflake(
        `CALL BABY_MART_DEMO.ANALYTICS.RECOMMEND_SCENARIO_DECISION('${escapeSql(scenarioId)}')`
      )
    );
  }

  const decidedBy = String(body.decidedBy ?? "Planner");
  const rationale = body.rationale ? String(body.rationale) : null;

  // AGREED_WITH_AI is computed here against the stored AI column rather than
  // being sent by the client, so the flag cannot be faked by a stale page.
  await querySnowflake(`
    UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_DECISION
    SET HUMAN_DECISION  = '${escapeSql(humanDecision)}',
        HUMAN_RATIONALE = ${rationale ? `'${escapeSql(rationale)}'` : "NULL"},
        DECIDED_BY      = '${escapeSql(decidedBy)}',
        DECIDED_AT      = CURRENT_TIMESTAMP(),
        AGREED_WITH_AI  = (AI_RECOMMENDATION = '${escapeSql(humanDecision)}')
    WHERE SCENARIO_ID = '${escapeSql(scenarioId)}'
  `);

  // REJECT closes the scenario. ACCEPT does NOT approve it here: approval is a
  // separate, explicit call so that promoting a forecast is never a side effect
  // of recording an opinion.
  if (humanDecision === "REJECT") {
    await querySnowflake(`
      UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
      SET STATUS = 'REJECTED', UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE SCENARIO_ID = '${escapeSql(scenarioId)}'
    `);
  } else if (humanDecision === "ACCEPT") {
    await querySnowflake(`
      UPDATE BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
      SET STATUS = 'SUBMITTED', UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE SCENARIO_ID = '${escapeSql(scenarioId)}' AND STATUS = 'DRAFT'
    `);
  }

  return { ok: true, scenarioId, humanDecision };
}

export async function handleScenarioApprove(request: Request) {
  const body = await request.json();
  const scenarioId = String(body.scenarioId ?? "");
  if (!scenarioId) return { error: "scenarioId is required" };

  return parseProcResult(
    await querySnowflake(`
      CALL BABY_MART_DEMO.ANALYTICS.APPROVE_SCENARIO(
        '${escapeSql(scenarioId)}',
        ${body.label ? `'${escapeSql(String(body.label))}'` : "NULL"},
        '${escapeSql(String(body.approvedBy ?? "Planner"))}',
        ${body.notes ? `'${escapeSql(String(body.notes))}'` : "NULL"})
    `)
  );
}

/** Discard a sandbox scenario. Approved scenarios are refused: an approved
 *  forecast has a version snapshot pointing at it, and deleting the scenario
 *  would orphan the audit trail. */
export async function handleScenarioDelete(request: Request) {
  const body = await request.json();
  const scenarioId = String(body.scenarioId ?? "");
  if (!scenarioId) return { error: "scenarioId is required" };
  const id = escapeSql(scenarioId);

  const statusRows = await querySnowflake(`
    SELECT STATUS FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    WHERE SCENARIO_ID = '${id}'
  `);
  if (statusRows.length === 0) return { error: "No such scenario" };
  if (String(statusRows[0].STATUS) === "APPROVED") {
    return { error: "Approved scenarios cannot be deleted; they are the audit trail." };
  }

  // Children first: goal-seek siblings would otherwise be left pointing at a
  // parent that no longer exists.
  for (const table of [
    "PLANNING_SCENARIO_CELL",
    "PLANNING_SCENARIO_OPTION",
    "PLANNING_DECISION",
  ]) {
    await querySnowflake(`
      DELETE FROM BABY_MART_DEMO.ANALYTICS.${table}
      WHERE SCENARIO_ID IN (
        SELECT SCENARIO_ID FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
        WHERE SCENARIO_ID = '${id}' OR PARENT_SCENARIO_ID = '${id}')
    `);
  }
  await querySnowflake(`
    DELETE FROM BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION WHERE SCENARIO_ID = '${id}'
  `);
  await querySnowflake(`
    DELETE FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO
    WHERE SCENARIO_ID = '${id}' OR PARENT_SCENARIO_ID = '${id}'
  `);

  return { ok: true, deleted: scenarioId };
}

// ─── Annotations ──────────────────────────────────────────────────────────────

/** Add or remove a comment, region tag or event marker.
 *  Region tags and event markers are notes about a week, not a data split -- the
 *  planning model holds no regional forecast. */
export async function handleAnnotation(request: Request) {
  const body = await request.json();
  const action = String(body.action ?? "add");

  if (action === "delete") {
    const id = escapeSql(String(body.annotationId ?? ""));
    if (!id) return { error: "annotationId is required" };
    await querySnowflake(`
      DELETE FROM BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION
      WHERE ANNOTATION_ID = '${id}'
    `);
    return { ok: true, deleted: id };
  }

  const type = String(body.type ?? "COMMENT").toUpperCase();
  if (!["COMMENT", "REGION_TAG", "EVENT_MARKER"].includes(type)) {
    return { error: `Unknown annotation type: ${type}` };
  }
  const value = String(body.value ?? "").trim();
  if (!value) return { error: "An annotation needs a value" };

  const id = `ANN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await querySnowflake(`
    INSERT INTO BABY_MART_DEMO.ANALYTICS.PLANNING_ANNOTATION
      (ANNOTATION_ID, SCENARIO_ID, DEPARTMENT, CLASS, FISCAL_YEAR, PERIOD_CODE,
       WEEK_NO, METRIC, VERSION, ANNOTATION_TYPE, ANNOTATION_VALUE, AUTHOR, CREATED_AT)
    VALUES (
      '${id}',
      ${body.scenarioId ? `'${escapeSql(String(body.scenarioId))}'` : "NULL"},
      ${body.department ? `'${escapeSql(String(body.department).toUpperCase())}'` : "NULL"},
      ${body.class ? `'${escapeSql(String(body.class).toUpperCase())}'` : "NULL"},
      'F27',
      ${body.periodCode ? `'${escapeSql(String(body.periodCode))}'` : "NULL"},
      ${body.weekNo !== undefined && body.weekNo !== null ? num(body.weekNo) : "NULL"},
      ${body.metric ? `'${escapeSql(String(body.metric))}'` : "NULL"},
      ${body.version ? `'${escapeSql(String(body.version))}'` : "NULL"},
      '${type}',
      '${escapeSql(value)}',
      '${escapeSql(String(body.author ?? "Planner"))}',
      CURRENT_TIMESTAMP())
  `);

  return { ok: true, annotationId: id };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Every planning parameter with the metadata the settings UI needs to render it
 *  honestly, plus the per-class cover targets, the reason codes, and a live
 *  buy-status preview.
 *
 *  `affects` is the important field. A QUERY_TIME parameter takes effect on the
 *  next page load; a GENERATION parameter is baked into a fact by the SQL scripts
 *  and cannot change without a data redeploy. The UI renders the second kind
 *  read-only, and SAVE_PLANNING_SETTING refuses it server-side as well, because a
 *  disabled input is not a constraint.
 *
 *  The preview reads VW_BUY_STATUS_PREVIEW, which is a thin select over the same
 *  VW_OTB_SUMMARY the pages read -- so it cannot promise an outcome the pages then
 *  contradict. */
export async function handleParameters() {
  const [settings, targets, reasons, preview] = await Promise.all([
    querySnowflake(`
      SELECT SETTING_KEY, SETTING_VALUE, VALUE_TYPE, CATEGORY, AFFECTS,
             MIN_VALUE, MAX_VALUE, DRIVES, DESCRIPTION, SORT_ORDER,
             UPDATED_BY, UPDATED_AT
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
      ORDER BY CATEGORY, SORT_ORDER, SETTING_KEY
    `),
    querySnowflake(`
      SELECT t.RBU, t.DEPARTMENT, t.CLASS, t.CLASS_CODE, t.TARGET_COVER_WEEKS,
             t.UPDATED_BY, t.UPDATED_AT, t.NOTE,
             o.TOTAL_COVER_WEEKS, o.FORWARD_COVER_WEEKS, o.BUY_STATUS
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_CLASS_TARGET t
      LEFT JOIN BABY_MART_DEMO.ANALYTICS.VW_OTB_SUMMARY o
             ON o.CLASS = t.CLASS AND o.PLAN_LEVEL = 'CLASS'
      ORDER BY t.DEPARTMENT, t.CLASS
    `),
    querySnowflake(`
      SELECT REASON_CODE, LABEL, DESCRIPTION
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE
      ORDER BY SORT_ORDER
    `),
    querySnowflake(`
      SELECT BUY_STATUS, COUNT(*) AS CLASSES
      FROM BABY_MART_DEMO.ANALYTICS.VW_BUY_STATUS_PREVIEW
      GROUP BY BUY_STATUS
    `),
  ]);

  return {
    settings: settings.map((r) => ({
      key: String(r.SETTING_KEY),
      value: String(r.SETTING_VALUE),
      valueType: str(r.VALUE_TYPE),
      category: str(r.CATEGORY),
      affects: str(r.AFFECTS),
      editable: String(r.AFFECTS) === "QUERY_TIME",
      min: numOrNull(r.MIN_VALUE),
      max: numOrNull(r.MAX_VALUE),
      drives: str(r.DRIVES),
      description: str(r.DESCRIPTION),
      sortOrder: num(r.SORT_ORDER),
      updatedBy: str(r.UPDATED_BY),
      updatedAt: toIsoDateTime(r.UPDATED_AT),
    })),
    classTargets: targets.map((r) => ({
      rbu: str(r.RBU),
      department: str(r.DEPARTMENT),
      class: String(r.CLASS),
      classCode: String(r.CLASS_CODE),
      targetCoverWeeks: num(r.TARGET_COVER_WEEKS),
      totalCoverWeeks: numOrNull(r.TOTAL_COVER_WEEKS),
      stockCoverWeeks: numOrNull(r.FORWARD_COVER_WEEKS),
      buyStatus: str(r.BUY_STATUS),
      updatedBy: str(r.UPDATED_BY),
      updatedAt: toIsoDateTime(r.UPDATED_AT),
      note: str(r.NOTE),
    })),
    reasonCodes: reasons.map((r) => ({
      code: String(r.REASON_CODE),
      label: String(r.LABEL),
      description: str(r.DESCRIPTION),
    })),
    statusPreview: Object.fromEntries(
      preview.map((r) => [String(r.BUY_STATUS), num(r.CLASSES)])
    ) as Record<string, number>,
  };
}

/** Save a parameter or a per-class cover target.
 *  Both paths go through validated procedures rather than a bare UPDATE, so range
 *  and cross-field checks cannot be bypassed by calling the endpoint directly. */
export async function handleSaveParameter(request: Request) {
  const body = await request.json();
  const updatedBy = String(body.updatedBy ?? "Planner");

  if (body.class !== undefined && body.class !== null) {
    const weeks = Number(body.targetCoverWeeks);
    if (!isFinite(weeks)) return { error: "targetCoverWeeks must be a number" };
    return parseProcResult(
      await querySnowflake(`
        CALL BABY_MART_DEMO.ANALYTICS.SAVE_CLASS_TARGET(
          '${escapeSql(String(body.class))}', ${weeks},
          '${escapeSql(updatedBy)}',
          ${body.note ? `'${escapeSql(String(body.note))}'` : "NULL"})
      `)
    );
  }

  const key = String(body.key ?? "");
  if (!key) return { error: "key is required" };
  return parseProcResult(
    await querySnowflake(`
      CALL BABY_MART_DEMO.ANALYTICS.SAVE_PLANNING_SETTING(
        '${escapeSql(key)}', '${escapeSql(String(body.value ?? ""))}',
        '${escapeSql(updatedBy)}')
    `)
  );
}

export async function handleSettings() {
  const rows = await querySnowflake(`
    SELECT SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCRIPTION, DRIVES,
           CATEGORY, AFFECTS, UPDATED_BY, UPDATED_AT
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_SETTING
    ORDER BY SETTING_KEY
  `);
  const reasons = await querySnowflake(`
    SELECT REASON_CODE, LABEL, DESCRIPTION
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE
    ORDER BY SORT_ORDER
  `);
  return {
    settings: rows.map((r) => ({
      key: String(r.SETTING_KEY),
      value: String(r.SETTING_VALUE),
      valueType: str(r.VALUE_TYPE),
      description: str(r.DESCRIPTION),
      drives: str(r.DRIVES),
      category: str(r.CATEGORY),
      affects: str(r.AFFECTS),
      updatedBy: str(r.UPDATED_BY),
      updatedAt: toIsoDateTime(r.UPDATED_AT),
    })),
    reasonCodes: reasons.map((r) => ({
      code: String(r.REASON_CODE),
      label: String(r.LABEL),
      description: str(r.DESCRIPTION),
    })),
  };
}

// ─── Approval history ─────────────────────────────────────────────────────────

/** One line per approved forecast version, plus the working forecast and budget.
 *
 *  Monthly points rather than weekly: 48 weekly points per line makes a
 *  multi-line chart unreadable, and the question this page answers -- "how has
 *  our view moved between planning meetings" -- is a monthly question. */
export async function handleHistory(department: string | null, currency: string) {
  const fx = currency === "AUD" ? "f.FX_RATE_PHP_AUD" : "1";
  const deptFilter = department
    ? `AND UPPER(DEPARTMENT) = '${escapeSql(department.toUpperCase())}'`
    : "AND DEPARTMENT IS NULL";
  const level = department ? "DEPARTMENT" : "RBU";

  const [versionRows, versionValues, baselineRows, adjustmentRows] = await Promise.all([
    querySnowflake(`
      SELECT v.VERSION_ID, v.VERSION_NO, v.LABEL, v.STATUS, v.SOURCE_SCENARIO_ID,
             v.APPROVED_BY, v.APPROVED_AT, v.NOTES, v.SETTINGS_SNAPSHOT,
             s.SCENARIO_NAME, s.SCENARIO_TYPE, s.PROMPT_TEXT
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION v
      LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO s
             ON s.SCENARIO_ID = v.SOURCE_SCENARIO_ID
      ORDER BY v.VERSION_NO
    `),
    querySnowflake(`
      SELECT
        pv.VERSION_ID, pv.PERIOD_CODE, pv.METRIC,
        SUM(pv.VALUE_PHP)       / ${fx} AS VALUE_,
        SUM(pv.ML_BASELINE_PHP) / ${fx} AS ML_,
        SUM(pv.PLANNER_DELTA_PHP) / ${fx} AS DELTA_
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE pv
      CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
      WHERE pv.PLAN_LEVEL = '${level}' ${deptFilter}
      GROUP BY pv.VERSION_ID, pv.PERIOD_CODE, pv.METRIC
    `),
    // The working forecast and budget, so a version can be read against what is
    // live now rather than only against other versions.
    querySnowflake(`
      SELECT
        w.PERIOD_CODE, w.PERIOD_NO, w.MONTH_NAME, w.HALF, w.VERSION, w.METRIC,
        SUM(w.VALUE_PHP) / ${fx} AS VALUE_,
        -- Weeks contributing to this bucket. ACT only exists for weeks that have
        -- closed, so a month mid-trade carries fewer weeks than the plan does and
        -- its total is not comparable with a full-month budget or forecast point.
        COUNT(*) AS WEEKS_
      FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_WEEKLY w
      CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
      WHERE w.PLAN_LEVEL = '${level}' ${deptFilter}
        AND w.FISCAL_YEAR = 'F27'
        AND w.VERSION IN ('FC', 'BUD', 'APP_FC', 'ACT')
      GROUP BY w.PERIOD_CODE, w.PERIOD_NO, w.MONTH_NAME, w.HALF, w.VERSION, w.METRIC
      ORDER BY w.PERIOD_NO
    `),
    // Largest planner adjustments per version, WITH their reasons. This is the
    // part that makes a planning meeting productive rather than speculative.
    querySnowflake(`
      SELECT
        v.VERSION_ID, c.CLASS, c.REASON_CODE, r.LABEL AS REASON_LABEL,
        MAX(c.REASON_NOTE) AS REASON_NOTE,
        MAX(c.EDITED_BY)   AS EDITED_BY,
        SUM(c.VALUE_PHP - c.BASELINE_PHP) / ${fx} AS DELTA_
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION v
      JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_SCENARIO_CELL c
        ON c.SCENARIO_ID = v.SOURCE_SCENARIO_ID
      LEFT JOIN BABY_MART_DEMO.ANALYTICS.PLANNING_REASON_CODE r
        ON r.REASON_CODE = c.REASON_CODE
      CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
      WHERE c.METRIC = 'SLS_PHP'
      GROUP BY v.VERSION_ID, c.CLASS, c.REASON_CODE, r.LABEL
      ORDER BY ABS(SUM(c.VALUE_PHP - c.BASELINE_PHP)) DESC
    `),
  ]);

  const adjBy = new Map<string, Record<string, unknown>[]>();
  for (const r of adjustmentRows) {
    const k = String(r.VERSION_ID);
    if (!adjBy.has(k)) adjBy.set(k, []);
    if (adjBy.get(k)!.length < 8) {
      adjBy.get(k)!.push({
        class: str(r.CLASS),
        reasonCode: str(r.REASON_CODE),
        reasonLabel: str(r.REASON_LABEL),
        reasonNote: str(r.REASON_NOTE),
        editedBy: str(r.EDITED_BY),
        delta: num(r.DELTA_),
      });
    }
  }

  // seriesByVersion[versionId][metric][periodCode]
  const seriesByVersion: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of versionValues) {
    const vid = String(r.VERSION_ID);
    const metric = String(r.METRIC);
    seriesByVersion[vid] ??= {};
    seriesByVersion[vid][metric] ??= {};
    seriesByVersion[vid][metric][String(r.PERIOD_CODE)] = num(r.VALUE_);
  }

  const periods: { periodCode: string; periodNo: number; monthName: string; half: string }[] = [];
  const live: Record<string, Record<string, Record<string, number>>> = {};

  // How many weeks a complete bucket has, taken from FC because the forecast is
  // always populated for the whole year.
  const planWeeks = new Map<string, number>();
  for (const r of baselineRows) {
    if (String(r.VERSION) === "FC") {
      const k = `${r.PERIOD_CODE}|${r.METRIC}`;
      planWeeks.set(k, Math.max(planWeeks.get(k) ?? 0, num(r.WEEKS_) ?? 0));
    }
  }

  for (const r of baselineRows) {
    const pc = String(r.PERIOD_CODE);
    if (!periods.some((p) => p.periodCode === pc)) {
      periods.push({
        periodCode: pc,
        periodNo: num(r.PERIOD_NO),
        monthName: String(r.MONTH_NAME),
        half: String(r.HALF),
      });
    }
    const metric = String(r.METRIC);
    const version = String(r.VERSION);

    // Drop an ACT bucket that is only PART of a month. Plotted alongside a
    // full-month budget it drew a cliff -- August showed roughly half a month of
    // trade against a whole month of plan, which reads as a collapse in sales
    // rather than as a month still in progress.
    if (version === "ACT") {
      const weeks = num(r.WEEKS_) ?? 0;
      const expected = planWeeks.get(`${pc}|${metric}`) ?? 0;
      if (expected > 0 && weeks < expected) continue;
    }

    live[metric] ??= {};
    live[metric][version] ??= {};
    live[metric][version][pc] = num(r.VALUE_);
  }
  periods.sort((a, b) => a.periodNo - b.periodNo);

  return {
    currency,
    department: department ? department.toUpperCase() : null,
    periods,
    live,
    versions: versionRows.map((r) => ({
      versionId: String(r.VERSION_ID),
      versionNo: num(r.VERSION_NO),
      label: String(r.LABEL),
      status: String(r.STATUS),
      sourceScenarioId: str(r.SOURCE_SCENARIO_ID),
      scenarioName: str(r.SCENARIO_NAME),
      scenarioType: str(r.SCENARIO_TYPE),
      prompt: str(r.PROMPT_TEXT),
      approvedBy: str(r.APPROVED_BY),
      approvedAt: toIsoDateTime(r.APPROVED_AT),
      notes: str(r.NOTES),
      settings: (() => {
        const v = r.SETTINGS_SNAPSHOT;
        if (v === null || v === undefined) return null;
        if (typeof v === "object") return v;
        try {
          return JSON.parse(String(v));
        } catch {
          return null;
        }
      })(),
      series: seriesByVersion[String(r.VERSION_ID)] ?? {},
      adjustments: adjBy.get(String(r.VERSION_ID)) ?? [],
    })),
  };
}

// ─── Plan change audit ────────────────────────────────────────────────────────

/** The unified change timeline: cell edits and approval events, newest first.
 *
 *  Filterable by version, class and source because the three questions a planning
 *  meeting actually asks are "what did this version change", "who has been
 *  touching this class", and "which of these were hand edits versus generated". */
export async function handleAudit(
  searchParams: URLSearchParams,
  currency: string
) {
  const fx = currency === "AUD" ? "f.FX_RATE_PHP_AUD" : "1";
  const filters: string[] = [];
  const versionId = searchParams.get("version");
  const klass = searchParams.get("class");
  const source = searchParams.get("source");
  if (versionId) filters.push(`a.VERSION_ID = '${escapeSql(versionId)}'`);
  if (klass) filters.push(`UPPER(a.CLASS) = '${escapeSql(klass.toUpperCase())}'`);
  if (source) filters.push(`a.CHANGE_SOURCE = '${escapeSql(source)}'`);
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const rows = await querySnowflake(`
    SELECT
      a.EVENT_TYPE, a.EVENT_AT, a.ACTOR, a.SCENARIO_ID, a.VERSION_ID,
      a.SCENARIO_NAME, a.DEPARTMENT, a.CLASS, a.PERIOD_CODE, a.WEEK_NO, a.METRIC,
      a.OLD_VALUE_PHP / ${fx} AS OLD_VALUE,
      a.NEW_VALUE_PHP / ${fx} AS NEW_VALUE,
      a.DELTA_PHP     / ${fx} AS DELTA,
      a.CHANGE_SOURCE, a.REASON_CODE, a.REASON_LABEL, a.REASON_NOTE, a.EVENT_DETAIL
    FROM BABY_MART_DEMO.ANALYTICS.VW_PLAN_AUDIT a
    CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
    ${where}
    ORDER BY a.EVENT_AT DESC NULLS LAST
    LIMIT 500
  `);

  // Which plan is currently in force, so the history page can label its baseline
  // line correctly rather than assuming an approved version exists.
  const current = await querySnowflake(`
    SELECT PLAN_SOURCE, MAX(VERSION_ID) AS VERSION_ID, MAX(VERSION_NO) AS VERSION_NO,
           MAX(LABEL) AS LABEL, MAX(APPROVED_AT) AS APPROVED_AT
    FROM BABY_MART_DEMO.ANALYTICS.VW_CURRENT_PLAN
    GROUP BY PLAN_SOURCE
    LIMIT 1
  `);

  return {
    currency,
    currentPlan:
      current.length > 0
        ? {
            source: String(current[0].PLAN_SOURCE),
            versionId: str(current[0].VERSION_ID),
            versionNo: num(current[0].VERSION_NO),
            label: str(current[0].LABEL),
            approvedAt: toIsoDateTime(current[0].APPROVED_AT),
          }
        : null,
    events: rows.map((r) => ({
      eventType: String(r.EVENT_TYPE),
      eventAt: toIsoDateTime(r.EVENT_AT),
      actor: str(r.ACTOR),
      scenarioId: str(r.SCENARIO_ID),
      versionId: str(r.VERSION_ID),
      scenarioName: str(r.SCENARIO_NAME),
      department: str(r.DEPARTMENT),
      class: str(r.CLASS),
      periodCode: str(r.PERIOD_CODE),
      weekNo: numOrNull(r.WEEK_NO),
      metric: str(r.METRIC),
      oldValue: numOrNull(r.OLD_VALUE),
      newValue: numOrNull(r.NEW_VALUE),
      delta: numOrNull(r.DELTA),
      changeSource: str(r.CHANGE_SOURCE),
      reasonCode: str(r.REASON_CODE),
      reasonLabel: str(r.REASON_LABEL),
      reasonNote: str(r.REASON_NOTE),
      detail: str(r.EVENT_DETAIL),
    })),
  };
}

// ─── Version diff grid ────────────────────────────────────────────────────────
//
// The weekly cell-level answer to "what did this approval actually change?".
//
// The chart above it moves monthly and at department level, which is the right
// grain for "has our view shifted" but useless for "which weeks moved and by how
// much". This walks one version against the one before it at week grain.
//
// PREVIOUS VERSION, NOT THE ML BASELINE. Every version snapshot carries its own
// ML_BASELINE_PHP, so diffing against that would report each version's movement
// from the untouched model -- meaning two successive approvals both restate the
// same earlier change and the incremental effect of the second is invisible.
// Diffing against version N-1 gives the movement that approval alone introduced.
// Version 1 has no predecessor, so it falls back to its own ML baseline, which is
// exactly the plan as it stood before any approval existed.
export async function handleVersionGrid(
  versionId: string | null,
  metric: string,
  half: string,
  currency: string
) {
  const fx = currency === "AUD" ? "f.FX_RATE_PHP_AUD" : "1";
  const m = ["SLS_PHP", "POS_GP_AMT", "SLS_UNITS"].includes(metric.toUpperCase())
    ? metric.toUpperCase()
    : "SLS_PHP";
  // Units are a count, so they are never converted; only money follows currency.
  const scale = m === "SLS_UNITS" ? "1" : fx;
  const h = half.toUpperCase() === "H1" ? "H1" : "H2";

  const versionRows = await querySnowflake(`
    SELECT VERSION_ID, VERSION_NO, LABEL, STATUS, APPROVED_BY, APPROVED_AT, NOTES
    FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VERSION
    ORDER BY VERSION_NO
  `);
  if (versionRows.length === 0) {
    return { currency, metric: m, half, versions: [], weeks: [], months: [], rows: [] };
  }

  const idx = versionId
    ? versionRows.findIndex((r) => String(r.VERSION_ID) === versionId)
    : versionRows.length - 1;
  const cur = versionRows[idx >= 0 ? idx : versionRows.length - 1];
  const prev = idx > 0 ? versionRows[idx - 1] : null;

  const curId = String(cur.VERSION_ID);
  const prevId = prev ? String(prev.VERSION_ID) : null;

  // One pass over both snapshots. The comparison value comes from the previous
  // version where one exists, and from this version's own ML baseline where it
  // does not -- resolved in SQL so the grid never has to special-case v1.
  const cells = await querySnowflake(`
    WITH cur AS (
      SELECT DEPARTMENT, CLASS, PERIOD_CODE, WEEK_NO, WEEK_SEQ,
             SUM(VALUE_PHP)       AS VAL,
             SUM(ML_BASELINE_PHP) AS BASE
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE
      WHERE VERSION_ID = '${escapeSql(curId)}'
        AND PLAN_LEVEL = 'CLASS' AND METRIC = '${m}'
        AND FISCAL_YEAR = 'F27'
      GROUP BY DEPARTMENT, CLASS, PERIOD_CODE, WEEK_NO, WEEK_SEQ
    ),
    prv AS (
      SELECT DEPARTMENT, CLASS, PERIOD_CODE, WEEK_NO, SUM(VALUE_PHP) AS VAL
      FROM BABY_MART_DEMO.ANALYTICS.PLANNING_FORECAST_VALUE
      WHERE VERSION_ID = ${prevId ? `'${escapeSql(prevId)}'` : "'~none~'"}
        AND PLAN_LEVEL = 'CLASS' AND METRIC = '${m}'
        AND FISCAL_YEAR = 'F27'
      GROUP BY DEPARTMENT, CLASS, PERIOD_CODE, WEEK_NO
    )
    SELECT
      c.DEPARTMENT, c.CLASS, c.PERIOD_CODE, c.WEEK_NO, c.WEEK_SEQ,
      d.MONTH_NAME, d.PERIOD_NO, d.WEEK_ENDING_DATE,
      c.VAL / ${scale}                                  AS CUR_VAL,
      COALESCE(p.VAL, c.BASE) / ${scale}                AS PRV_VAL,
      (c.VAL - COALESCE(p.VAL, c.BASE)) / ${scale}      AS MOVEMENT
    FROM cur c
    LEFT JOIN prv p
           ON p.DEPARTMENT = c.DEPARTMENT AND p.CLASS = c.CLASS
          AND p.PERIOD_CODE = c.PERIOD_CODE AND p.WEEK_NO = c.WEEK_NO
    JOIN BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD d
           ON d.PERIOD_CODE = c.PERIOD_CODE AND d.WEEK_NO = c.WEEK_NO
    CROSS JOIN BABY_MART_DEMO.ANALYTICS.VW_PLANNING_PARAM f
    WHERE d.HALF = '${h}'
    ORDER BY c.DEPARTMENT, c.CLASS, c.WEEK_SEQ
  `);

  // Column scaffold: every week in the half, plus one bold subtotal per month.
  const weekMap = new Map<string, Record<string, unknown>>();
  const monthMap = new Map<string, { periodCode: string; monthName: string; periodNo: number; weekKeys: string[] }>();
  for (const r of cells) {
    const key = `${r.PERIOD_CODE}-${r.WEEK_NO}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        key,
        periodCode: String(r.PERIOD_CODE),
        periodNo: num(r.PERIOD_NO),
        monthName: String(r.MONTH_NAME),
        weekNo: num(r.WEEK_NO),
        weekSeq: num(r.WEEK_SEQ),
        weekEnding: toIsoDateTime(r.WEEK_ENDING_DATE),
      });
      const pc = String(r.PERIOD_CODE);
      if (!monthMap.has(pc)) {
        monthMap.set(pc, {
          periodCode: pc,
          monthName: String(r.MONTH_NAME),
          periodNo: num(r.PERIOD_NO) ?? 0,
          weekKeys: [],
        });
      }
      monthMap.get(pc)!.weekKeys.push(key);
    }
  }
  const weeks = [...weekMap.values()].sort(
    (a, b) => (a.weekSeq as number) - (b.weekSeq as number)
  );
  const months = [...monthMap.values()].sort((a, b) => a.periodNo - b.periodNo);

  // rowMap[department|class] -> per-week current / previous / movement
  type Row = {
    department: string;
    class: string;
    cur: Record<string, number>;
    prv: Record<string, number>;
    mov: Record<string, number>;
    movementTotal: number;
    changedWeeks: number;
  };
  const rowMap = new Map<string, Row>();
  for (const r of cells) {
    const dept = String(r.DEPARTMENT);
    const cls = String(r.CLASS);
    const k = `${dept}|${cls}`;
    if (!rowMap.has(k)) {
      rowMap.set(k, {
        department: dept, class: cls,
        cur: {}, prv: {}, mov: {}, movementTotal: 0, changedWeeks: 0,
      });
    }
    const row = rowMap.get(k)!;
    const wk = `${r.PERIOD_CODE}-${r.WEEK_NO}`;
    const mv = num(r.MOVEMENT) ?? 0;
    row.cur[wk] = num(r.CUR_VAL) ?? 0;
    row.prv[wk] = num(r.PRV_VAL) ?? 0;
    row.mov[wk] = mv;
    row.movementTotal += mv;
    // Sub-peso residue is rounding, not a planner decision.
    if (Math.abs(mv) >= 1) row.changedWeeks += 1;
  }

  const rows = [...rowMap.values()].sort(
    (a, b) =>
      a.department.localeCompare(b.department) || a.class.localeCompare(b.class)
  );

  return {
    currency,
    metric: m,
    half: h,
    version: {
      versionId: curId,
      versionNo: num(cur.VERSION_NO),
      label: String(cur.LABEL),
      status: String(cur.STATUS),
      approvedBy: str(cur.APPROVED_BY),
      approvedAt: toIsoDateTime(cur.APPROVED_AT),
      notes: str(cur.NOTES),
    },
    comparedWith: prev
      ? { versionNo: num(prev.VERSION_NO), label: String(prev.LABEL) }
      : { versionNo: 0, label: "ML baseline (before any approval)" },
    versions: versionRows.map((r) => ({
      versionId: String(r.VERSION_ID),
      versionNo: num(r.VERSION_NO),
      label: String(r.LABEL),
      status: String(r.STATUS),
    })),
    weeks,
    months,
    rows,
  };
}
