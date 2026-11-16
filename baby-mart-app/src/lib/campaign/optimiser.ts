// ─── Campaign & CRM: channel optimiser (pure) ────────────────────────────────
//
// Gives each group of treated members the channel that earns the most expected
// INCREMENTAL margin net of its send cost, among the channels they consented to
// and the campaign allows -- then, if the plan is over budget, moves the groups
// whose expensive channel buys the least extra margin per dollar back to a
// cheaper one until it fits. Greedy rather than exact: groups are few (cell x
// consent pattern), and a planner can follow every step of a greedy plan.
//
// Expected lift per member = cell lift x channel factor. The factors come from
// the measured history (performance.channelFactors), so a learning such as "SMS
// beats email for second-time parents" changes the plan without a code change.

import type { ChannelCode } from "./config";

export type Group = {
  key: string;
  n: number;
  liftPp: number;
  /** Channels these members consented to (personal) or can be reached on. */
  reachable: ChannelCode[];
};

export type PlanInput = {
  groups: Group[];
  allowed: ChannelCode[];
  costPerSend: Partial<Record<ChannelCode, number>>;
  channelFactor: Partial<Record<ChannelCode, number>>;
  marginPerConversion: number;
  offerCostPerConversion: number;
  budgetAud: number;
  /** Sends per member in the campaign: the first send plus any reminder. */
  sendsPerMember: number;
};

export type Assignment = { key: string; n: number; channel: ChannelCode | null; incConv: number; cost: number; incMargin: number };

export type Plan = {
  assignments: Assignment[];
  byChannel: { channel: ChannelCode; members: number; cost: number; incConv: number; incMargin: number }[];
  totalCost: number;
  incConv: number;
  incMargin: number;
  withinBudget: boolean;
  unassigned: number;
  steps: string[];
};

function value(g: Group, ch: ChannelCode, p: PlanInput) {
  const inc = g.n * Math.max(0, g.liftPp / 100) * (p.channelFactor[ch] ?? 1);
  const cost = g.n * (p.costPerSend[ch] ?? 0) * p.sendsPerMember;
  const margin = inc * (p.marginPerConversion - p.offerCostPerConversion);
  return { inc, cost, margin, net: margin - cost };
}

export function planChannels(p: PlanInput): Plan {
  const steps: string[] = [];
  const assign = new Map<string, ChannelCode | null>();
  for (const g of p.groups) {
    const options = g.reachable.filter((c) => p.allowed.includes(c));
    let best: ChannelCode | null = null;
    let bestNet = -Infinity;
    for (const ch of options) {
      const v = value(g, ch, p);
      // Ties go to the cheaper channel.
      if (v.net > bestNet + 1e-9 || (Math.abs(v.net - bestNet) <= 1e-9 && best && (p.costPerSend[ch] ?? 0) < (p.costPerSend[best] ?? 0))) {
        best = ch; bestNet = v.net;
      }
    }
    assign.set(g.key, best);
  }
  const cost = () => p.groups.reduce((a, g) => { const ch = assign.get(g.key); return a + (ch ? value(g, ch, p).cost : 0); }, 0);

  // Over budget: downgrade the group whose current channel adds least margin per
  // extra dollar over its cheapest alternative; failing that, drop it.
  let guard = 0;
  while (cost() > p.budgetAud + 0.005 && guard++ < 500) {
    let pick: { key: string; to: ChannelCode | null; ratio: number } | null = null;
    for (const g of p.groups) {
      const cur = assign.get(g.key);
      if (!cur) continue;
      const vc = value(g, cur, p);
      const alts = g.reachable.filter((c) => p.allowed.includes(c) && (p.costPerSend[c] ?? 0) < (p.costPerSend[cur] ?? 0));
      const candidates: (ChannelCode | null)[] = [...alts, null];
      for (const to of candidates) {
        const vt = to ? value(g, to, p) : { cost: 0, margin: 0 };
        const saved = vc.cost - vt.cost;
        if (saved <= 0) continue;
        const ratio = (vc.margin - vt.margin) / saved;
        if (!pick || ratio < pick.ratio) pick = { key: g.key, to, ratio };
      }
    }
    if (!pick) break;
    const g = p.groups.find((x) => x.key === pick!.key)!;
    steps.push(`${g.key}: ${assign.get(g.key)} -> ${pick.to ?? "not contacted"} to stay within budget`);
    assign.set(pick.key, pick.to);
  }

  const assignments: Assignment[] = p.groups.map((g) => {
    const ch = assign.get(g.key) ?? null;
    const v = ch ? value(g, ch, p) : { inc: 0, cost: 0, margin: 0 };
    return { key: g.key, n: g.n, channel: ch, incConv: v.inc, cost: v.cost, incMargin: v.margin };
  });
  const byChannelMap = new Map<ChannelCode, { channel: ChannelCode; members: number; cost: number; incConv: number; incMargin: number }>();
  for (const a of assignments) {
    if (!a.channel) continue;
    const row = byChannelMap.get(a.channel) ?? { channel: a.channel, members: 0, cost: 0, incConv: 0, incMargin: 0 };
    row.members += a.n; row.cost += a.cost; row.incConv += a.incConv; row.incMargin += a.incMargin;
    byChannelMap.set(a.channel, row);
  }
  const totalCost = assignments.reduce((a, x) => a + x.cost, 0);
  return {
    assignments,
    byChannel: [...byChannelMap.values()].sort((a, b) => b.members - a.members),
    totalCost,
    incConv: assignments.reduce((a, x) => a + x.incConv, 0),
    incMargin: assignments.reduce((a, x) => a + x.incMargin, 0),
    withinBudget: totalCost <= p.budgetAud + 0.005,
    unassigned: assignments.filter((a) => !a.channel).reduce((s, a) => s + a.n, 0),
    steps,
  };
}
