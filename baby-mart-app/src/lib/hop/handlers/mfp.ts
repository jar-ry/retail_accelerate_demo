// ─── Head of Planning: MFP ────────────────────────────────────────────────────
//
// The reference implementation's MFP edits were display overlays: a typed value
// was painted over the grid, while the identities, the planning chain and every
// downstream figure kept reading the uploaded plan. Here an edit is real. It
// changes a department INPUT, the whole plan is re-derived (./mfp-model.ts), and
// every measure that moved is written as a new version -- the superseded rows are
// kept -- so the identities, the chain and the WSSI reconciliation all move with
// it. A cell edit and a pasted upload go through the same derivation.

import { S } from "../schema";
import { batch, q, tx, HopError, NOW, type Row, type Run, type Stmt } from "../db";
import { assertEditable, overrideInsert, type EditRequest, type Grant } from "../ownership";
import { MARKET, PLAN_FY, PLAN_HALF } from "../config";
import { toNum } from "../format";
import { COLUMN, MEASURE_OF, derivePlan, applyEdit, validate, parsePaste, planChecks, type Dept, type Modelled } from "../mfp-model";
import * as SQL from "../sql";

/** History is a record, not a plan: an edit never rewrites it. */
const HISTORY_KEYS = new Set(["F26_ACTUAL", "F26_UNITS", "F26_ASP", "F26_FIRST_MARGIN_PCT", "F26_POS_ACTUAL", "EXIT_MARGIN_PCT", "F26_MIX_PCT"]);

export async function getMfp() {
  const [grid, mix, chain, recon, phased, ownMfp, ownMix, reasons, uploads, history, approval, settings] = await batch([
    SQL.SQL_MFP_GRID,
    SQL.SQL_MFP_MIX,
    SQL.SQL_CHAIN,
    SQL.SQL_MFP_WSSI_RECON,
    SQL.SQL_MFP_PHASED,
    { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["MFP"] },
    { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["RBU_MIX"] },
    SQL.SQL_REASON_CODES,
    SQL.SQL_MFP_UPLOADS,
    SQL.SQL_MFP_HISTORY,
    SQL.SQL_LATEST_APPROVAL,
    SQL.SQL_SETTINGS,
  ]);
  return { grid, mix, chain, recon, phased, ownership: [...ownMfp, ...ownMix], reasons, uploads, history, approval: approval[0] ?? null, settings };
}

// ─── The model's view of the plan ─────────────────────────────────────────────

function deptOf(r: Row): Dept {
  const n = (k: string) => toNum(r[k]) ?? 0;
  return {
    code: String(r.ENTITY_CODE),
    name: String(r.ENTITY_NAME),
    rbu: String(r.RBU_CODE),
    F26_ACTUAL: n("F26_ACTUAL"), F26_UNITS: n("F26_UNITS"), F26_ASP: n("F26_ASP"),
    F26_FIRST_MARGIN_PCT: n("F26_FIRST_MARGIN_PCT"), F26_POS_ACTUAL: n("F26_POS_ACTUAL"), EXIT_MARGIN_PCT: n("EXIT_MARGIN_PCT"),
    LFL_PCT: n("LFL_PCT"), GROWTH_STATED: n("GROWTH_STATED"), TPR_UNITS: n("TPR_UNITS"), TPR_ASP: n("TPR_ASP"),
    POS_PCT: n("POS_PCT"), F27_FIRST_MARGIN_PCT: n("F27_FIRST_MARGIN_PCT"),
    OPT_NEW: n("OPT_NEW"), OPT_ONGOING: n("OPT_ONGOING"),
    OPT_NEW_DESELECTED: n("OPT_NEW_DESELECTED"), OPT_ONGOING_DESELECTED: n("OPT_ONGOING_DESELECTED"),
  };
}

async function loadPlan() {
  const rows = await q(SQL.SQL_MFP_GRID);
  const depts = rows.filter((r) => r.PLAN_LEVEL === "DEPARTMENT" && r.HAS_PLAN === true).map(deptOf);
  const stored = new Map<string, Row>(rows.map((r) => [`${r.PLAN_LEVEL}|${r.ENTITY_CODE}`, r]));
  return { depts, stored };
}

/** Measures whose derived value differs from what is stored, history excluded. */
function changes(next: Map<string, Modelled>, stored: Map<string, Row>) {
  const out: { level: string; entity: string; measure: string; old: number | null; value: number }[] = [];
  for (const [key, m] of next) {
    const [level, entity] = key.split("|");
    const row = stored.get(key) ?? {};
    for (const [k, v] of Object.entries(m)) {
      if (HISTORY_KEYS.has(k)) continue;
      const old = toNum(row[k]);
      // A part in a million: below that a "change" is the rounding of a stored
      // figure, not an edit, and rewriting it would clutter the version history.
      if (old === null || Math.abs(v - old) > Math.max(Math.abs(old) * 1e-6, 1e-6)) {
        out.push({ level, entity, measure: MEASURE_OF[k], old, value: v });
      }
    }
  }
  return out;
}

/** Write a new version of each changed measure and supersede the old row. One
 *  stamp for both statements, so the view's latest-row rule has a single answer.
 *
 *  Runs inside the caller's transaction, after its other writes and before its
 *  audit rows (`extra`): a supersede without its replacement would silently
 *  delete the measure from the plan, so a short insert throws and rolls the
 *  whole change back. */
async function writeVersion(run: Run, changed: ReturnType<typeof changes>, uploadId: number | null, extra: Stmt[]) {
  if (!changed.length) return 0;
  const stamp = String((await run(`SELECT TO_VARCHAR(${NOW}, 'YYYY-MM-DD HH24:MI:SS.FF3') AS T`))[0].T);
  const values = changed.map(() => "(?, ?, ?, ?)").join(", ");
  const vbinds = changed.flatMap((c) => [c.level, c.entity, c.measure, c.value]);
  // Positional binds follow the text: the two in the SELECT list come before
  // the VALUES rows.
  const inserted = await run(
    `INSERT INTO ${S}.FACT_MFP_PRODUCT_PLAN
       (MARKET_CODE, PLAN_LEVEL, RBU_CODE, ENTITY_CODE, ENTITY_NAME, LFL_STRATEGY, FY_YEAR, FY_HALF, SOURCE_COLUMN,
        MEASURE_CODE, MEASURE_VALUE, PROVENANCE, NOTE, UPLOAD_ID, IS_CURRENT, LOADED_AT)
     SELECT o.MARKET_CODE, o.PLAN_LEVEL, o.RBU_CODE, o.ENTITY_CODE, o.ENTITY_NAME, o.LFL_STRATEGY, o.FY_YEAR, o.FY_HALF,
            o.SOURCE_COLUMN, o.MEASURE_CODE, v.column4::FLOAT, o.PROVENANCE, o.NOTE, ?, TRUE, TO_TIMESTAMP_NTZ(?)
       FROM (SELECT * FROM VALUES ${values}) v
       JOIN ${S}.FACT_MFP_PRODUCT_PLAN o
         ON o.PLAN_LEVEL = v.column1 AND o.ENTITY_CODE = v.column2 AND o.MEASURE_CODE = v.column3 AND o.IS_CURRENT
     QUALIFY ROW_NUMBER() OVER (PARTITION BY o.PLAN_LEVEL, o.ENTITY_CODE, o.MEASURE_CODE ORDER BY o.LOADED_AT DESC) = 1`,
    [uploadId, stamp, ...vbinds],
  );
  const n = Number(Object.values(inserted[0] ?? {})[0] ?? 0);
  if (n !== changed.length) {
    throw new HopError(500, `The new version wrote ${n} of ${changed.length} measures, so it was rolled back and nothing changed.`);
  }
  await run(
    `UPDATE ${S}.FACT_MFP_PRODUCT_PLAN t SET IS_CURRENT = FALSE
       FROM (SELECT * FROM VALUES ${values}) v
      WHERE t.PLAN_LEVEL = v.column1 AND t.ENTITY_CODE = v.column2 AND t.MEASURE_CODE = v.column3
        AND t.IS_CURRENT AND t.LOADED_AT < TO_TIMESTAMP_NTZ(?)`,
    [...vbinds, stamp],
  );
  for (const s of extra) await run(s.sql, s.binds);
  return changed.length;
}

// ─── Cell edit ────────────────────────────────────────────────────────────────

async function editCell(b: EditRequest & { entityCode?: string; planLevel?: string; column?: string; newValue?: number; currentValue?: number | null }, user: string) {
  if (b.planLevel !== "DEPARTMENT") {
    throw new HopError(400, "An RBU row adds up its departments. Change a department and the RBU follows.");
  }
  const col = COLUMN.get(b.column ?? "");
  if (!col) throw new HopError(400, `'${b.column}' is not a product plan column.`);
  if (!col.owns) throw new HopError(403, `${col.label} is calculated or last year's record, so it cannot be typed.`);
  if (typeof b.newValue !== "number") throw new HopError(400, "Enter a number.");
  const err = validate(col, b.newValue);
  if (err) throw new HopError(400, err);

  const grant = await assertEditable("MFP", col.owns, b);
  const { depts, stored } = await loadPlan();
  const dept = depts.find((d) => d.code === b.entityCode);
  if (!dept) throw new HopError(404, `Department ${b.entityCode} has no product plan loaded.`);
  const shown = toNum(stored.get(`DEPARTMENT|${dept.code}`)?.[col.key]);
  if (b.currentValue !== undefined && b.currentValue !== null && shown !== null && Math.abs(shown - b.currentValue) > Math.max(Math.abs(shown) * 1e-9, 1e-9)) {
    throw new HopError(409, "This cell changed after you selected it. Refresh and try again.");
  }
  const next = depts.map((d) => (d.code === dept.code ? applyEdit(d, col, b.newValue as number) : d));
  const changed = changes(derivePlan(next), stored);
  const audit = [
    overrideInsert({ grant, planKind: "MFP", entityCode: dept.code, monthName: PLAN_HALF, oldValue: shown, newValue: b.newValue, changedBy: user }),
    {
      sql: `INSERT INTO ${S}.MFP_CELL_OVERRIDE (MARKET_CODE, FY_YEAR, FY_HALF, PLAN_LEVEL, ENTITY_CODE, GRID_COLUMN, OLD_VALUE, NEW_VALUE, REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, SOURCE_UPLOAD_ID)
            SELECT ?, ?, ?, 'DEPARTMENT', ?, ?, ?, ?, ?, ?, ?, ${NOW}, NULL`,
      binds: [MARKET, PLAN_FY, PLAN_HALF, dept.code, col.key, shown, b.newValue, grant.reasonCode, grant.rationale, user],
    },
  ];
  const written = await tx((run) => writeVersion(run, changed, null, audit));
  return { ok: true, entityCode: dept.code, column: col.key, oldValue: shown, newValue: b.newValue, measuresWritten: written, isPostLockAmendment: grant.isPostLockAmendment };
}

// ─── Paste upload ─────────────────────────────────────────────────────────────

async function upload(b: EditRequest & { text?: string; sourceFile?: string; commit?: boolean }, user: string) {
  const text = b.text ?? "";
  if (text.length > 20000) throw new HopError(400, "That paste is too large for a five-department plan.");
  const { depts, stored } = await loadPlan();
  const settings = await q(`SELECT TRY_TO_NUMBER(SETTING_VALUE) AS V FROM ${S}.PLANNING_SETTING WHERE SETTING_KEY = 'MATERIALITY_PTS'`);
  const parsed = parsePaste(text, depts);
  const checks = parsed.depts ? [...parsed.checks, ...planChecks(parsed.depts, Number(settings[0]?.V ?? 7))] : parsed.checks;
  const hard = checks.some((c) => c.status === "FAIL");
  const preview = parsed.depts
    ? parsed.depts.map((d) => {
        const before = depts.find((x) => x.code === d.code)!;
        return {
          code: d.code, name: d.name,
          bottomUpBefore: before.TPR_UNITS * before.TPR_ASP, bottomUpAfter: d.TPR_UNITS * d.TPR_ASP,
          statedAfter: d.GROWTH_STATED, deliveredAfter: d.F26_ACTUAL ? (d.TPR_UNITS * d.TPR_ASP) / d.F26_ACTUAL - 1 : null,
        };
      })
    : [];
  if (!b.commit) return { ok: !hard, checks, preview };
  const incoming = parsed.depts;
  if (hard || !incoming) throw new HopError(400, "The upload has failures to fix first. Nothing was loaded.");

  // An upload carries Buying's numbers (units, ASP) and jointly agreed ones
  // (growth, options), so it must clear both classes' rules.
  const buying: Grant = await assertEditable("MFP", "F27_TPR_UNIT_SALES", b);
  await assertEditable("MFP", "TOTAL_GROWTH_PCT_STATED", b);

  const changed = changes(derivePlan(incoming), stored);
  if (!changed.length) return { ok: true, checks, preview, uploadId: null, measuresWritten: 0, note: "The upload matches the current plan: nothing changed." };
  const soft = checks.some((c) => c.status === "WARN");
  const bu = (x: Dept[]) => x.reduce((a, d) => a + d.TPR_UNITS * d.TPR_ASP, 0);
  // The upload record, the new version and its audit row commit together: an
  // upload that is listed must be one that loaded.
  const uploadId = await tx(async (run) => {
    await run(
      `INSERT INTO ${S}.MFP_PLAN_UPLOAD (MARKET_CODE, FY_YEAR, FY_HALF, PLAN_LEVELS, ENTITIES, ROW_COUNT, MEASURE_COUNT, SUPERSEDED_ROWS,
         SOURCE_FILE, SOURCE_SHEET, SOURCE_PULLED_ON, RATIONALE, CHECK_RESULTS, HAS_SOFT_FAILURE, UPLOADED_BY, UPLOADED_AT, RAW_PASTE)
       SELECT ?, ?, ?, 'DEPARTMENT,RBU', ?, ?, ?, ?, ?, NULL, CURRENT_DATE(), ?, PARSE_JSON(?), ?, ?, ${NOW}, ?`,
      [MARKET, PLAN_FY, PLAN_HALF, incoming.map((d) => d.code).join(","), incoming.length, changed.length, changed.length,
        b.sourceFile?.trim() || "Pasted", buying.rationale, JSON.stringify(checks), soft, user, text],
    );
    const id = Number((await run(`SELECT MAX(UPLOAD_ID) AS ID FROM ${S}.MFP_PLAN_UPLOAD WHERE UPLOADED_BY = ?`, [user]))[0].ID);
    await writeVersion(run, changed, id, [
      overrideInsert({ grant: buying, planKind: "MFP_UPLOAD", entityCode: "ALL", monthName: PLAN_HALF, oldValue: bu(depts), newValue: bu(incoming), changedBy: user, measureCode: "TPR_BUDGET_AUD" }),
    ]);
    return id;
  });
  return { ok: true, checks, preview, uploadId, measuresWritten: changed.length };
}

// ─── RBU mix ──────────────────────────────────────────────────────────────────

/** Set the agreed mix and re-strike each RBU's budget from the CURRENT store plan
 *  total, which also clears any drift since the budget was last struck. */
async function setMix(b: EditRequest & { mixes?: { rbu: string; pct: number }[] }, user: string) {
  const mixes = b.mixes ?? [];
  const rows = await q(`SELECT RBU_CODE, PLAN_MIX_PCT_STATED, PLAN_SALES_AUD FROM ${S}.RBU_MIX_TARGET WHERE IS_TRADED`);
  if (mixes.length !== rows.length || !rows.every((r) => mixes.some((m) => m.rbu === r.RBU_CODE))) {
    throw new HopError(400, "Give a mix for every traded RBU, so they can be checked to add to 100%.");
  }
  if (mixes.some((m) => typeof m.pct !== "number" || !Number.isFinite(m.pct) || m.pct < 0 || m.pct > 1)) {
    throw new HopError(400, "Each mix must be between 0% and 100%, as a decimal.");
  }
  const total = mixes.reduce((a, m) => a + m.pct, 0);
  if (Math.abs(total - 1) > 0.0005) throw new HopError(400, `The mix adds to ${(total * 100).toFixed(2)}%. It must add to 100%.`);
  const grant = await assertEditable("RBU_MIX", "PLAN_MIX_PCT_STATED", b);
  const sp = toNum((await q(`SELECT SUM(PLAN_SALES_AUD) AS T FROM ${S}.VW_STORE_PLAN_WEEKLY`))[0]?.T) ?? 0;
  await tx(
    mixes.flatMap((m) => {
      const old = rows.find((r) => r.RBU_CODE === m.rbu)!;
      return [
        {
          sql: `UPDATE ${S}.RBU_MIX_TARGET SET PLAN_MIX_PCT_STATED = ?, PLAN_SALES_AUD = ? WHERE RBU_CODE = ? AND IS_TRADED`,
          binds: [m.pct, m.pct * sp, m.rbu],
        },
        overrideInsert({ grant, planKind: "RBU_MIX", entityCode: m.rbu, monthName: PLAN_HALF, oldValue: toNum(old.PLAN_MIX_PCT_STATED), newValue: m.pct, changedBy: user }),
      ];
    }),
  );
  return { ok: true, storePlanTotal: sp, mixes };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postMfp(body: any, user: string) {
  switch (body?.action) {
    case "CELL": return editCell(body, user);
    case "UPLOAD_CHECK": return upload({ ...body, commit: false }, user);
    case "UPLOAD_COMMIT": return upload({ ...body, commit: true }, user);
    case "MIX": return setMix(body, user);
    default: throw new HopError(400, `Unknown MFP action '${body?.action}'.`);
  }
}
