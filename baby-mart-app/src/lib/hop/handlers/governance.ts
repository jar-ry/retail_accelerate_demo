// ─── Head of Planning: range review, approval, ownership, settings ────────────

import { S } from "../schema";
import { batch, q, tx, HopError, NOW, type Row } from "../db";
import { assertEditable, overrideInsert } from "../ownership";
import { MARKET, PLAN_FY, PLAN_HALF } from "../config";
import { toNum } from "../format";
import * as SQL from "../sql";

// ─── Range review ─────────────────────────────────────────────────────────────

export async function getTpr() {
  const [funnel, credibility, byDept, bySupplier, ownMfp, ownFunnel, reasons, approval] = await batch([
    SQL.SQL_FUNNEL, SQL.SQL_CREDIBILITY, SQL.SQL_ATTRITION_DEPT, SQL.SQL_ATTRITION_SUPPLIER,
    { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["MFP"] }, { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["FUNNEL"] },
    SQL.SQL_REASON_CODES, SQL.SQL_LATEST_APPROVAL,
  ]);
  return { funnel, credibility, byDept, bySupplier, ownership: [...ownMfp, ...ownFunnel], reasons, approval: approval[0] ?? null };
}

// ─── Approve and lock ─────────────────────────────────────────────────────────

export async function getApprove() {
  const [approvals, amendments, variance, compliance, decisions, findings, assumptions] = await batch([
    SQL.SQL_APPROVALS, SQL.SQL_AMENDMENTS, SQL.SQL_VARIANCE_BY_STORE, SQL.SQL_COMPLIANCE,
    SQL.SQL_DECISIONS, SQL.SQL_FINDINGS, SQL.SQL_ASSUMPTIONS,
  ]);
  const live = await q(`SELECT SUM(PLAN_SALES_AUD) AS SALES, SUM(PLAN_MARGIN_AUD) AS MARGIN FROM ${S}.VW_STORE_PLAN_WEEKLY`);
  return { approvals, amendments, variance, compliance, decisions, findings, assumptions, live: live[0] ?? null };
}

/** Re-strike the WSSI budget for the half from the store plan being approved.
 *  The budget IS the approved plan, so approving moves it: each week is scaled
 *  to the plan's weekly sales and margin, keeping the department split, with
 *  cumulative rounding so the half ties to the cent. Receipts move by the change
 *  in cost of sales, so closing stock -- and the roll-forward -- are unchanged. */
const RESTRIKE_BUDGET = `
UPDATE ${S}.FACT_WSSI_WEEKLY f
   SET SLS_AUD = n.S_NEW, POS_GP_AUD = n.G_NEW, SLS_U = n.U_NEW,
       C_REC_AUD = n.CREC_NEW, R_REC_AUD = n.RREC_NEW, U_REC = n.UREC_NEW
  FROM (
    WITH sp AS (
      SELECT WEEK_END_DATE, SUM(PLAN_SALES_AUD) AS SP, SUM(PLAN_MARGIN_AUD) AS SPM
      FROM ${S}.VW_STORE_PLAN_WEEKLY GROUP BY WEEK_END_DATE
    ), b AS (
      SELECT f.DEPARTMENT_NUM, f.WEEK_END_DATE, f.SLS_AUD, f.POS_GP_AUD, f.SLS_U, f.C_REC_AUD, f.R_REC_AUD, f.U_REC,
             SUM(f.SLS_AUD) OVER (PARTITION BY f.WEEK_END_DATE) AS WK_S, SUM(f.POS_GP_AUD) OVER (PARTITION BY f.WEEK_END_DATE) AS WK_G
      FROM ${S}.FACT_WSSI_WEEKLY f
      WHERE f.VERSION = 'BUD' AND f.FY_YEAR = ${PLAN_FY} AND f.FY_HALF = '${PLAN_HALF}'
    ), x AS (
      SELECT b.*, b.SLS_AUD * sp.SP / NULLIF(b.WK_S, 0) AS S_RAW, b.POS_GP_AUD * sp.SPM / NULLIF(b.WK_G, 0) AS G_RAW
      FROM b JOIN sp ON sp.WEEK_END_DATE = b.WEEK_END_DATE
    ), r AS (
      SELECT x.*,
        ROUND(ROUND(SUM(S_RAW) OVER (ORDER BY WEEK_END_DATE, DEPARTMENT_NUM ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
            - NVL(ROUND(SUM(S_RAW) OVER (ORDER BY WEEK_END_DATE, DEPARTMENT_NUM ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 2), 0), 2) AS S_NEW,
        ROUND(ROUND(SUM(G_RAW) OVER (ORDER BY WEEK_END_DATE, DEPARTMENT_NUM ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
            - NVL(ROUND(SUM(G_RAW) OVER (ORDER BY WEEK_END_DATE, DEPARTMENT_NUM ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 2), 0), 2) AS G_NEW
      FROM x
    )
    SELECT DEPARTMENT_NUM, WEEK_END_DATE, S_NEW, G_NEW,
           ROUND(SLS_U * DIV0(S_NEW, SLS_AUD), 0) AS U_NEW,
           ROUND(C_REC_AUD + ((S_NEW - G_NEW) - (SLS_AUD - POS_GP_AUD)), 2) AS CREC_NEW,
           ROUND(R_REC_AUD * DIV0(C_REC_AUD + ((S_NEW - G_NEW) - (SLS_AUD - POS_GP_AUD)), C_REC_AUD), 2) AS RREC_NEW,
           ROUND(U_REC * DIV0(C_REC_AUD + ((S_NEW - G_NEW) - (SLS_AUD - POS_GP_AUD)), C_REC_AUD), 0) AS UREC_NEW
    FROM r
  ) n
 WHERE f.VERSION = 'BUD' AND f.DEPARTMENT_NUM = n.DEPARTMENT_NUM AND f.WEEK_END_DATE = n.WEEK_END_DATE`;

/** Approve the live store plan: an immutable row-copy snapshot, not a flag,
 *  because a flag can be edited and a baseline must not move once agreed. */
async function approve(b: { narrative?: string; boardDate?: string }, user: string) {
  const narrative = b.narrative?.trim();
  if (!narrative || narrative.length < 20) throw new HopError(400, "Write the approval narrative: what was agreed, and on what conditions.");
  const boardDate = b.boardDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(boardDate)) throw new HopError(400, "Give the board meeting date.");

  const prior = await q(`SELECT MAX(APPROVAL_ID) AS ID FROM ${S}.PLAN_APPROVAL WHERE STATE = 'APPROVED' AND FY_YEAR = ? AND FY_HALF = ?`, [PLAN_FY, PLAN_HALF]);
  // One transaction: an approval without its snapshot, or a budget not re-struck
  // to it, would be a baseline that does not match what was approved.
  const id = await tx(async (run) => {
    await run(
      `INSERT INTO ${S}.PLAN_APPROVAL (MARKET_CODE, PLAN_KIND, SCOPE, FY_YEAR, FY_HALF, STATE, SUBMITTED_BY, SUBMITTED_AT, APPROVED_BY,
         APPROVED_AT, BOARD_MEETING_DATE, NARRATIVE, TOTAL_SALES_AUD, TOTAL_MARGIN_AUD)
       SELECT ?, 'STORE_PLAN', 'All stores', ?, ?, 'APPROVED', ?, ${NOW}, ?, ${NOW}, TO_DATE(?), ?,
              ROUND(SUM(PLAN_SALES_AUD), 2), ROUND(SUM(PLAN_MARGIN_AUD), 2)
         FROM ${S}.VW_STORE_PLAN_WEEKLY`,
      [MARKET, PLAN_FY, PLAN_HALF, user, user, boardDate, narrative],
    );
    const id = Number((await run(`SELECT MAX(APPROVAL_ID) AS ID FROM ${S}.PLAN_APPROVAL WHERE APPROVED_BY = ?`, [user]))[0].ID);
    await run(
      `INSERT INTO ${S}.PLAN_APPROVAL_SNAPSHOT (APPROVAL_ID, SNAPSHOT_AT, MARKET_CODE, STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME, MEASURE_CODE, MEASURE_VALUE)
       SELECT ?, ${NOW}, ?, STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME, MEASURE_CODE, MEASURE_VALUE
         FROM (SELECT STORE_CODE, WEEK_END_DATE, FY_YEAR, MONTH_NAME, PLAN_SALES_AUD::FLOAT AS PLAN_SALES_AUD,
                      PLAN_MARGIN_AUD::FLOAT AS PLAN_MARGIN_AUD, LFL_PCT::FLOAT AS LFL_PCT, MARGIN_PCT::FLOAT AS MARGIN_PCT
                 FROM ${S}.VW_STORE_PLAN_WEEKLY)
       UNPIVOT (MEASURE_VALUE FOR MEASURE_CODE IN (PLAN_SALES_AUD, PLAN_MARGIN_AUD, LFL_PCT, MARGIN_PCT))`,
      [id, MARKET],
    );
    if (prior[0]?.ID != null) {
      await run(`UPDATE ${S}.PLAN_APPROVAL SET STATE = 'SUPERSEDED', SUPERSEDED_BY = ? WHERE APPROVAL_ID = ?`, [id, Number(prior[0].ID)]);
    }
    await run(RESTRIKE_BUDGET);
    return id;
  });
  // The three must agree: the approved total, the snapshot and the budget.
  const check = await q(
    `SELECT a.TOTAL_SALES_AUD,
            (SELECT ROUND(SUM(MEASURE_VALUE), 2) FROM ${S}.PLAN_APPROVAL_SNAPSHOT WHERE APPROVAL_ID = ? AND MEASURE_CODE = 'PLAN_SALES_AUD') AS SNAPSHOT_SALES,
            (SELECT SUM(SLS_AUD) FROM ${S}.FACT_WSSI_WEEKLY WHERE VERSION = 'BUD' AND FY_YEAR = ? AND FY_HALF = ?) AS BUDGET_SALES,
            (SELECT COUNT(*) FROM ${S}.PLAN_APPROVAL_SNAPSHOT WHERE APPROVAL_ID = ?) AS SNAPSHOT_ROWS
       FROM ${S}.PLAN_APPROVAL a WHERE a.APPROVAL_ID = ?`,
    [id, PLAN_FY, PLAN_HALF, id, id],
  );
  return { ok: true, approvalId: id, supersedes: prior[0]?.ID ?? null, verification: check[0] ?? null };
}

/** A correction to an approval narrative, appended beside the original. One that
 *  moves an approved figure is a new approval, not an amendment. */
async function amend(b: { approvalId?: number; note?: string; changedFigures?: boolean }, user: string) {
  if (b.changedFigures) throw new HopError(400, "A correction that moves an approved number needs a fresh approval, not an amendment.");
  const note = b.note?.trim();
  if (!note) throw new HopError(400, "Write the correction.");
  const a = await q(`SELECT NARRATIVE FROM ${S}.PLAN_APPROVAL WHERE APPROVAL_ID = ?`, [b.approvalId]);
  if (!a.length) throw new HopError(404, "That approval does not exist.");
  await q(
    `INSERT INTO ${S}.PLAN_APPROVAL_AMENDMENT (APPROVAL_ID, PRIOR_NARRATIVE, AMENDMENT_NOTE, AMENDED_BY, AMENDED_AT, CHANGED_FIGURES)
     SELECT ?, ?, ?, ?, ${NOW}, FALSE`,
    [b.approvalId, a[0].NARRATIVE, note, user],
  );
  return { ok: true };
}

/** Record the answer to a decision left open. Recording it is the point:
 *  "awaiting the business" is itself a state that should be visible. */
async function decide(b: { decisionId?: number; decision?: string; rationale?: string }, user: string) {
  const decision = b.decision?.trim();
  if (!decision) throw new HopError(400, "Write the decision.");
  const r = await q(`SELECT STATUS FROM ${S}.DESIGN_DECISION WHERE DECISION_ID = ?`, [b.decisionId]);
  if (!r.length) throw new HopError(404, "That decision does not exist.");
  if (r[0].STATUS !== "AWAITING_CUSTOMER") throw new HopError(409, "That decision has already been made.");
  await q(
    `UPDATE ${S}.DESIGN_DECISION SET DECISION = ?, RATIONALE = NVL(?, RATIONALE), STATUS = 'DECIDED', DECIDED_BY = ?, DECIDED_AT = ${NOW}::DATE
      WHERE DECISION_ID = ?`,
    [decision, b.rationale?.trim() || null, user, b.decisionId],
  );
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postApprove(body: any, user: string) {
  switch (body?.action) {
    case "APPROVE": return approve(body, user);
    case "AMEND": return amend(body, user);
    case "DECIDE": return decide(body, user);
    default: throw new HopError(400, `Unknown approval action '${body?.action}'.`);
  }
}

// ─── Ownership ────────────────────────────────────────────────────────────────

const CLASS_RULES: Record<string, { party: string; editable: boolean; lock: string; rationale: boolean }> = {
  JOINT: { party: "BOTH", editable: true, lock: "AMEND_WITH_ESCALATION", rationale: true },
  PLANNING: { party: "PLANNING", editable: true, lock: "ALWAYS_OPEN", rationale: true },
  BUYING: { party: "BUYING", editable: true, lock: "AMEND_WITH_ESCALATION", rationale: true },
  UNCLASSIFIED: { party: "NONE", editable: false, lock: "NOT_APPLICABLE", rationale: false },
};

export async function getOwnership() {
  const [rows] = await batch([SQL.SQL_OWNERSHIP_ALL]);
  return { rows };
}

/** Confirm an inferred owner, or reclassify. A measure that is ingested or
 *  calculated can be confirmed but never made editable: no route writes it, so
 *  an editable class would be a promise the app cannot keep. */
async function confirmOwner(b: { surface?: string; measureCode?: string; editClass?: string; rationale?: string }, user: string) {
  const r = await q(`SELECT * FROM ${S}.MEASURE_OWNERSHIP WHERE SURFACE = ? AND MEASURE_CODE = ?`, [b.surface, b.measureCode]);
  if (!r.length) throw new HopError(404, "That measure is not in the registry.");
  const cur = String(r[0].EDIT_CLASS);
  const next = b.editClass ?? cur;
  if (next !== cur) {
    // Own keys only: `in` would also accept an inherited name such as "toString".
    if (!Object.hasOwn(CLASS_RULES, cur) || !Object.hasOwn(CLASS_RULES, next)) {
      throw new HopError(400, `${r[0].MEASURE_LABEL} is ${cur.toLowerCase()}: it can be confirmed, not reclassified as an editable number.`);
    }
    if (!b.rationale?.trim()) throw new HopError(400, "Say why the owner is changing.");
    const rule = CLASS_RULES[next];
    await tx([
      {
        sql: `UPDATE ${S}.MEASURE_OWNERSHIP SET EDIT_CLASS = ?, OWNING_PARTY = ?, EDITABLE_IN_APP = ?, LOCK_BEHAVIOUR = ?, REQUIRES_RATIONALE = ?,
                     IS_INFERRED = FALSE, CONFIRMED_BY = ?, CONFIRMED_AT = CURRENT_TIMESTAMP(), EVIDENCE = ?
               WHERE SURFACE = ? AND MEASURE_CODE = ?`,
        binds: [next, rule.party, rule.editable, rule.lock, rule.rationale, user, b.rationale.trim(), b.surface, b.measureCode],
      },
      {
        sql: `INSERT INTO ${S}.PLAN_CELL_OVERRIDE (MARKET_CODE, PLAN_KIND, ENTITY_CODE, FY_YEAR, MONTH_NAME, MEASURE_CODE, OLD_VALUE, NEW_VALUE,
                REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, SURFACE, EDIT_CLASS, OWNING_PARTY, IS_POST_LOCK_AMENDMENT)
              SELECT ?, 'OWNERSHIP', ?, ?, ?, ?, NULL, NULL, 'RANGE_REVIEW_AGREED', ?, ?, ${NOW}, ?, ?, ?, FALSE`,
        binds: [MARKET, b.surface, PLAN_FY, PLAN_HALF, b.measureCode, `Reclassified from ${cur} to ${next}: ${b.rationale.trim()}`, user, b.surface, next, rule.party],
      },
    ]);
    return { ok: true, editClass: next };
  }
  await q(
    `UPDATE ${S}.MEASURE_OWNERSHIP SET IS_INFERRED = FALSE, CONFIRMED_BY = ?, CONFIRMED_AT = CURRENT_TIMESTAMP() WHERE SURFACE = ? AND MEASURE_CODE = ?`,
    [user, b.surface, b.measureCode],
  );
  return { ok: true, editClass: cur };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postOwnership(body: any, user: string) {
  if (body?.action !== "CONFIRM") throw new HopError(400, `Unknown ownership action '${body?.action}'.`);
  if (!body.surface || !body.measureCode) throw new HopError(400, "Name the surface and measure.");
  return confirmOwner(body, user);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings() {
  const [settings, ownership, doctrine, templates, credibility, usage, assumptions, reasons, latestRuns] = await batch([
    SQL.SQL_SETTINGS, { sql: SQL.SQL_SURFACE_OWNERSHIP, binds: ["SETTINGS"] }, SQL.SQL_DOCTRINE, SQL.SQL_TEMPLATES,
    SQL.SQL_CREDIBILITY_RULES, SQL.SQL_MODEL_USAGE, SQL.SQL_ASSUMPTIONS, SQL.SQL_REASON_CODES, SQL.SQL_INSIGHT_LATEST_RUNS,
  ]);
  return { settings, ownership, doctrine, templates, credibility, usage, assumptions, reasons, latestRuns };
}

function validSetting(type: string, raw: string): string {
  const v = raw.trim();
  if (type === "INT" && !/^\d+$/.test(v)) throw new HopError(400, "Enter a whole number.");
  if (type === "FLOAT" && !Number.isFinite(Number(v))) throw new HopError(400, "Enter a number.");
  if (!v) throw new HopError(400, "Enter a value.");
  return v;
}

async function setSetting(b: { key?: string; value?: string; reasonCode?: string; rationale?: string }, user: string) {
  const s = await q(`SELECT SETTING_VALUE, VALUE_TYPE FROM ${S}.PLANNING_SETTING WHERE SETTING_KEY = ?`, [b.key]);
  if (!s.length) throw new HopError(404, "That setting does not exist.");
  const grant = await assertEditable("SETTINGS", String(b.key), b);
  const value = validSetting(String(s[0].VALUE_TYPE), String(b.value ?? ""));
  await tx([
    { sql: `UPDATE ${S}.PLANNING_SETTING SET SETTING_VALUE = ?, SOURCE = ? WHERE SETTING_KEY = ?`, binds: [value, `Set by ${user}`, b.key] },
    overrideInsert({ grant, planKind: "SETTING", entityCode: String(b.key), monthName: PLAN_HALF, oldValue: toNum(s[0].SETTING_VALUE), newValue: toNum(value), changedBy: user }),
  ]);
  return { ok: true };
}

async function setCredibility(b: { departmentNum?: string; minPct?: number; reasonCode?: string; rationale?: string }, user: string) {
  const pct = b.minPct;
  if (typeof pct !== "number" || pct < 0 || pct > 1) throw new HopError(400, "Enter a share between 0% and 100%, as a decimal.");
  const r = await q(`SELECT MIN_CREDIBLE_ADOPTION_PCT FROM ${S}.RANGE_CREDIBILITY_RULE WHERE DEPARTMENT_NUM = ?`, [b.departmentNum]);
  if (!r.length) throw new HopError(404, "No rule for that department.");
  const grant = await assertEditable("FUNNEL", "MIN_CREDIBLE_ADOPTION_PCT", b);
  await tx([
    { sql: `UPDATE ${S}.RANGE_CREDIBILITY_RULE SET MIN_CREDIBLE_ADOPTION_PCT = ?, RATIONALE = NVL(?, RATIONALE) WHERE DEPARTMENT_NUM = ?`, binds: [pct, grant.rationale, b.departmentNum] },
    overrideInsert({ grant, planKind: "FUNNEL", entityCode: String(b.departmentNum), monthName: PLAN_HALF, oldValue: toNum(r[0].MIN_CREDIBLE_ADOPTION_PCT), newValue: pct, changedBy: user }),
  ]);
  return { ok: true };
}

/** The doctrine is versioned and insert-only, so an insight keeps the method it
 *  was given: change the method today and last month's advice still shows it. */
async function setDoctrine(b: { text?: string; tone?: string; rationale?: string }, user: string) {
  const text = b.text?.trim();
  if (!text || text.length < 40) throw new HopError(400, "Write the method in full.");
  const v = Number((await q(`SELECT NVL(MAX(DOCTRINE_VERSION), 0) + 1 AS V FROM ${S}.INSIGHT_DOCTRINE`))[0].V);
  // In order: retire the active version, then add the new one. Run side by side,
  // the retirement could catch the new row too and leave no method active.
  await tx([
    { sql: `UPDATE ${S}.INSIGHT_DOCTRINE SET IS_ACTIVE = FALSE WHERE IS_ACTIVE` },
    {
      sql: `INSERT INTO ${S}.INSIGHT_DOCTRINE (DOCTRINE_VERSION, DOCTRINE_TEXT, TONE, IS_ACTIVE, AUTHORED_BY, RATIONALE, CREATED_AT)
            SELECT ?, ?, ?, TRUE, ?, ?, ${NOW}`,
      binds: [v, text, b.tone?.trim() || null, user, b.rationale?.trim() || null],
    },
  ]);
  return { ok: true, version: v };
}

const MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5", "llama4-maverick", "mistral-large2"]);

async function setTemplate(b: { templateId?: number; taskInstruction?: string; focusMeasures?: string; model?: string; maxFindings?: number }, user: string) {
  if (!b.model || !MODELS.has(b.model)) throw new HopError(400, "Choose a supported model.");
  const max = Number(b.maxFindings ?? 4);
  if (!Number.isInteger(max) || max < 1 || max > 8) throw new HopError(400, "Between one and eight findings.");
  if (!b.taskInstruction?.trim()) throw new HopError(400, "Say what the insight should look at.");
  await q(
    `UPDATE ${S}.INSIGHT_TEMPLATE SET TASK_INSTRUCTION = ?, FOCUS_MEASURES = ?, MODEL = ?, MAX_FINDINGS = ?, UPDATED_BY = ?, UPDATED_AT = ${NOW}
      WHERE TEMPLATE_ID = ?`,
    [b.taskInstruction.trim(), b.focusMeasures?.trim() ?? "", b.model, max, user, b.templateId],
  );
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postSettings(body: any, user: string) {
  switch (body?.action) {
    case "SETTING": return setSetting(body, user);
    case "CREDIBILITY": return setCredibility(body, user);
    case "DOCTRINE": return setDoctrine(body, user);
    case "TEMPLATE": return setTemplate(body, user);
    default: throw new HopError(400, `Unknown settings action '${body?.action}'.`);
  }
}

export type { Row };
