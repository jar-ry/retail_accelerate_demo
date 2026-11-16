// ─── Head of Planning: ownership enforcement ──────────────────────────────────
//
// Every plan write passes through assertEditable. The grid's colouring is only a
// hint: a lock that exists only in the interface is a suggestion, not a control.
// The reference implementation enforced this on 5 of its ~15 write routes; here
// every write route calls it.
//
// The rules are not encoded here. They live in MEASURE_OWNERSHIP; this module
// reads and applies them.
//
// Two departures from the reference, both deliberate:
//   - A reason is REQUIRED for any editable measure, and a narrative when the
//     reason code demands one. The reference's documentation said so but its code
//     treated both as optional prompts.
//   - A post-lock amendment to a jointly agreed or Buying-owned number REQUIRES an
//     escalation note. VW_OVERRIDE_COMPLIANCE flags any that lack one, so only an
//     edit that bypassed the app can produce that finding.

import { S } from "./schema";
import { batch, HopError, NOW, type Row, type Stmt } from "./db";
import { PLAN_FY, PLAN_HALF, MARKET } from "./config";
import { SQL_SURFACE_OWNERSHIP } from "./sql";

export type EditClass = "INGESTED" | "CALCULATED" | "JOINT" | "PLANNING" | "BUYING" | "UNCLASSIFIED";

export type Ownership = {
  surface: string;
  measureCode: string;
  measureLabel: string;
  editClass: EditClass;
  owningParty: "NONE" | "BOTH" | "PLANNING" | "BUYING";
  editableInApp: boolean;
  lockBehaviour: "FREEZE" | "AMEND_WITH_ESCALATION" | "ALWAYS_OPEN" | "NOT_APPLICABLE";
  requiresRationale: boolean;
  ownershipHint: string;
  cellTreatment: "EDITABLE" | "LOCKED";
  isInferred: boolean;
  evidence: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

export type EditRequest = {
  reasonCode?: string | null;
  rationale?: string | null;
  /** Who a Buying-owned number is being keyed on behalf of. */
  onBehalfOf?: string | null;
  /** Why an approved number cannot wait for the next cycle. */
  escalationNote?: string | null;
};

export type Grant = {
  ownership: Ownership;
  approvalId: number | null;
  isPostLockAmendment: boolean;
  onBehalfOf: string | null;
  escalationNote: string | null;
  reasonCode: string;
  rationale: string | null;
};

export function rowToOwnership(r: Row): Ownership {
  return {
    surface: String(r.SURFACE),
    measureCode: String(r.MEASURE_CODE),
    measureLabel: String(r.MEASURE_LABEL ?? r.MEASURE_CODE),
    editClass: String(r.EDIT_CLASS) as EditClass,
    owningParty: String(r.OWNING_PARTY) as Ownership["owningParty"],
    editableInApp: r.EDITABLE_IN_APP === true,
    lockBehaviour: String(r.LOCK_BEHAVIOUR) as Ownership["lockBehaviour"],
    requiresRationale: r.REQUIRES_RATIONALE === true,
    ownershipHint: String(r.OWNERSHIP_HINT ?? ""),
    cellTreatment: String(r.CELL_TREATMENT) as Ownership["cellTreatment"],
    isInferred: r.IS_INFERRED === true,
    evidence: r.EVIDENCE == null ? null : String(r.EVIDENCE),
    confirmedBy: r.CONFIRMED_BY == null ? null : String(r.CONFIRMED_BY),
    confirmedAt: r.CONFIRMED_AT == null ? null : String(r.CONFIRMED_AT),
  };
}

/** Decide whether an edit may proceed. Throws a HopError with the status to
 *  return; on success returns the context the audit row must carry. */
export async function assertEditable(surface: string, measureCode: string, req: EditRequest): Promise<Grant> {
  const reasonCode = req.reasonCode?.trim() || null;
  const [own, reason, approval] = await batch([
    { sql: `SELECT * FROM (${SQL_SURFACE_OWNERSHIP}) WHERE MEASURE_CODE = ?`, binds: [surface, measureCode] },
    { sql: `SELECT REASON_CODE, REQUIRES_NARRATIVE FROM ${S}.PLAN_REASON_CODE WHERE REASON_CODE = ?`, binds: [reasonCode ?? ""] },
    {
      sql: `SELECT MAX(APPROVAL_ID) AS APPROVAL_ID FROM ${S}.PLAN_APPROVAL
             WHERE STATE = 'APPROVED' AND FY_YEAR = ? AND FY_HALF = ? AND MARKET_CODE = ?`,
      binds: [PLAN_FY, PLAN_HALF, MARKET],
    },
  ]);

  if (!own.length) {
    throw new HopError(
      400,
      `'${measureCode}' is not in the ownership registry for ${surface}, so the system cannot tell who may change it. ` +
        "This is a configuration gap, not a permission problem: classify it on the Ownership page.",
    );
  }
  const ownership = rowToOwnership(own[0]);

  if (ownership.editClass === "UNCLASSIFIED") {
    throw new HopError(409, `'${ownership.measureLabel}' has no agreed owner yet, so it cannot be edited. Classify it on the Ownership page first.`);
  }
  if (!ownership.editableInApp) {
    const because =
      ownership.editClass === "CALCULATED"
        ? "It is calculated: change the inputs it derives from, not the result."
        : /^BUD\b/.test(ownership.measureLabel)
          ? "It is the budget the board approved: it moves only when the plan is approved again."
          : "It is fed in from source data and is a record of what happened.";
    throw new HopError(403, `'${ownership.measureLabel}' cannot be edited. ${because}`);
  }

  // Always say why.
  const rationale = req.rationale?.trim() || null;
  if (ownership.requiresRationale) {
    if (!reasonCode) throw new HopError(400, `Choose a reason for changing '${ownership.measureLabel}'.`);
    if (!reason.length) throw new HopError(400, `Unknown reason code '${reasonCode}'.`);
    if (reason[0].REQUIRES_NARRATIVE === true && !rationale) {
      throw new HopError(400, "This reason needs a sentence of explanation, so the next person knows what changed and why.");
    }
  } else if (reasonCode && !reason.length) {
    throw new HopError(400, `Unknown reason code '${reasonCode}'.`);
  }

  // Keying someone else's number must be a conscious act, so the trail stays honest.
  let onBehalfOf: string | null = null;
  if (ownership.owningParty === "BUYING") {
    onBehalfOf = req.onBehalfOf?.trim() || null;
    if (!onBehalfOf) {
      throw new HopError(
        400,
        `'${ownership.measureLabel}' is Buying's number. Say who in Buying you are entering it for, so the trail records that it is theirs.`,
      );
    }
  }

  // The lock. An approved baseline never moves; whether the live plan may is a
  // per-measure decision recorded in LOCK_BEHAVIOUR.
  const approvalId = approval[0]?.APPROVAL_ID == null ? null : Number(approval[0].APPROVAL_ID);
  let isPostLockAmendment = false;
  let escalationNote: string | null = null;
  if (approvalId !== null) {
    if (ownership.lockBehaviour === "FREEZE") {
      throw new HopError(423, `'${ownership.measureLabel}' is frozen because the plan has been approved. Changing it needs a new approval, not an edit.`);
    }
    if (ownership.lockBehaviour === "AMEND_WITH_ESCALATION") {
      isPostLockAmendment = true;
      escalationNote = req.escalationNote?.trim() || null;
      if (!escalationNote) {
        throw new HopError(
          400,
          `The plan was approved, and '${ownership.measureLabel}' was agreed in it. Say why this cannot wait for the next cycle.`,
        );
      }
    }
  }

  return { ownership, approvalId, isPostLockAmendment, onBehalfOf, escalationNote, reasonCode: reasonCode ?? "NOT_SUPPLIED", rationale };
}

/** The audit row, as a statement + binds so a caller can run it in the same
 *  transaction as the write it records. */
export function overrideInsert(args: {
  grant: Grant;
  planKind: string;
  entityCode: string;
  monthName: string;
  oldValue: number | null;
  newValue: number | null;
  changedBy: string;
  measureCode?: string;
}): Stmt {
  const g = args.grant;
  return {
    sql: `INSERT INTO ${S}.PLAN_CELL_OVERRIDE
            (MARKET_CODE, PLAN_KIND, ENTITY_CODE, FY_YEAR, MONTH_NAME, MEASURE_CODE, OLD_VALUE, NEW_VALUE,
             REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, APPROVAL_ID, SURFACE, EDIT_CLASS, OWNING_PARTY,
             ON_BEHALF_OF, IS_POST_LOCK_AMENDMENT, ESCALATION_NOTE)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}, ?, ?, ?, ?, ?, ?, ?`,
    binds: [
      MARKET, args.planKind, args.entityCode, PLAN_FY, args.monthName, args.measureCode ?? g.ownership.measureCode,
      args.oldValue, args.newValue, g.reasonCode, g.rationale, args.changedBy, g.approvalId,
      g.ownership.surface, g.ownership.editClass, g.ownership.owningParty, g.onBehalfOf,
      g.isPostLockAmendment, g.escalationNote,
    ],
  };
}
