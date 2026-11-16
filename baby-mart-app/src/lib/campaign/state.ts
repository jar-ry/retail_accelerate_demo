// ─── Campaign & CRM: lifecycle (pure) ─────────────────────────────────────────
//
// The only transitions a campaign may make, enforced on the server: the client
// asks for a target status and the handler refuses anything not listed here. Each
// one is written with its audit row in one transaction (handlers/campaigns.ts).

import type { Status } from "./config";

export const TRANSITIONS: Record<Status, Status[]> = {
  IDEA: ["BRIEF", "CANCELLED"],
  BRIEF: ["AUDIENCE_LOCKED", "CANCELLED"],
  // Back to BRIEF unlocks the audience (its members and holdout are discarded).
  AUDIENCE_LOCKED: ["CONTENT_APPROVED", "BRIEF", "CANCELLED"],
  CONTENT_APPROVED: ["SCHEDULED", "AUDIENCE_LOCKED", "CANCELLED"],
  SCHEDULED: ["LIVE", "CONTENT_APPROVED", "CANCELLED"],
  LIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["LIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: ["MEASURED"],
  MEASURED: [],
  CANCELLED: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export type GateFacts = {
  audienceLocked: boolean;
  treated: number;
  holdout: number;
  variantsApproved: number;
  variantsBlocked: number;
  channelPlanned: boolean;
  plannedCostAud: number;
  budgetAud: number;
  stockConflicts: number;
  fatigueBreaches: number;
};

export type Gate = { key: string; label: string; pass: boolean; detail: string };

/** The launch gates. All must pass before a campaign is scheduled. */
export function launchGates(f: GateFacts): Gate[] {
  return [
    { key: "audience", label: "Audience locked with a holdout", pass: f.audienceLocked && f.treated > 0 && f.holdout > 0,
      detail: f.audienceLocked ? `${f.treated.toLocaleString("en-AU")} treated, ${f.holdout.toLocaleString("en-AU")} held out` : "Lock the audience first" },
    { key: "content", label: "Content approved and nothing blocked", pass: f.variantsApproved > 0 && f.variantsBlocked === 0,
      detail: f.variantsBlocked > 0 ? `${f.variantsBlocked} variant(s) blocked by QA` : `${f.variantsApproved} variant(s) approved` },
    { key: "channels", label: "Channel plan approved", pass: f.channelPlanned, detail: f.channelPlanned ? "Every treated member has a channel" : "Run the channel plan" },
    { key: "budget", label: "Within budget", pass: f.plannedCostAud <= f.budgetAud + 0.005,
      detail: `Planned $${Math.round(f.plannedCostAud).toLocaleString("en-AU")} against $${Math.round(f.budgetAud).toLocaleString("en-AU")}` },
    { key: "stock", label: "No member sent to a store that cannot supply", pass: f.stockConflicts === 0,
      detail: f.stockConflicts === 0 ? "Promoted range in stock at every member's home store" : `${f.stockConflicts.toLocaleString("en-AU")} treated members' home store is short` },
    { key: "fatigue", label: "Frequency cap respected", pass: f.fatigueBreaches === 0,
      detail: f.fatigueBreaches === 0 ? "No member over the contact cap" : `${f.fatigueBreaches.toLocaleString("en-AU")} members over the cap` },
  ];
}
