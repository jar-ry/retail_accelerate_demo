// ─── Campaign & CRM: measurement statistics (pure) ───────────────────────────
//
// Lift is the treated conversion rate minus the holdout's, in points -- never an
// average of per-segment lifts, and never conversions over clicks. The interval is
// the normal approximation to the difference of two proportions, which is what a
// campaign analyst would quote; below a handful of conversions it is wide, and the
// page says so rather than hiding it.

export type Arm = { n: number; conv: number };

export type Lift = {
  treatedRate: number | null;
  holdoutRate: number | null;
  liftPp: number | null;
  ciLowPp: number | null;
  ciHighPp: number | null;
  significant: boolean;
  /** Treated members times the lift: conversions the campaign caused. */
  incremental: number | null;
  z: number | null;
};

const Z95 = 1.959964;

export function lift(treated: Arm, holdout: Arm): Lift {
  if (treated.n <= 0 || holdout.n <= 0) {
    return { treatedRate: treated.n ? treated.conv / treated.n : null, holdoutRate: holdout.n ? holdout.conv / holdout.n : null,
      liftPp: null, ciLowPp: null, ciHighPp: null, significant: false, incremental: null, z: null };
  }
  const pt = treated.conv / treated.n;
  const ph = holdout.conv / holdout.n;
  const d = pt - ph;
  const se = Math.sqrt((pt * (1 - pt)) / treated.n + (ph * (1 - ph)) / holdout.n);
  const lo = d - Z95 * se;
  const hi = d + Z95 * se;
  return {
    treatedRate: pt, holdoutRate: ph, liftPp: d * 100, ciLowPp: lo * 100, ciHighPp: hi * 100,
    significant: se > 0 && (lo > 0 || hi < 0), incremental: d * treated.n, z: se > 0 ? d / se : null,
  };
}

/** Two-sided p-value of a z statistic (Abramowitz-Stegun erf approximation). */
export function pValue(z: number | null): number | null {
  if (z === null || !Number.isFinite(z)) return null;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}

export type Cell = { key: string; treated: Arm; holdout: Arm };

/** Lift per cell, shrunk towards the pooled lift by the size of the cell's
 *  holdout: a 40-person holdout does not get to claim a 9-point lift on its own.
 *  K is the holdout size at which a cell's own estimate gets half the weight. */
export function shrunkCellLift(cells: Cell[], k = 200): Map<string, { liftPp: number; holdoutRate: number; weight: number; n: number }> {
  const tot = cells.reduce((a, c) => ({ tn: a.tn + c.treated.n, tc: a.tc + c.treated.conv, hn: a.hn + c.holdout.n, hc: a.hc + c.holdout.conv }), { tn: 0, tc: 0, hn: 0, hc: 0 });
  const pooled = tot.tn && tot.hn ? (tot.tc / tot.tn - tot.hc / tot.hn) * 100 : 0;
  const pooledBase = tot.hn ? tot.hc / tot.hn : 0;
  const out = new Map<string, { liftPp: number; holdoutRate: number; weight: number; n: number }>();
  for (const c of cells) {
    const w = c.holdout.n / (c.holdout.n + k);
    const own = c.treated.n && c.holdout.n ? (c.treated.conv / c.treated.n - c.holdout.conv / c.holdout.n) * 100 : pooled;
    const base = c.holdout.n ? c.holdout.conv / c.holdout.n : pooledBase;
    out.set(c.key, { liftPp: w * own + (1 - w) * pooled, holdoutRate: w * base + (1 - w) * pooledBase, weight: w, n: c.treated.n + c.holdout.n });
  }
  return out;
}

/** Which uplift quadrant a cell falls in. Thresholds in points / rates. A cell
 *  that buys a lot anyway and gains under a quarter of that from contact is a
 *  sure thing even when the gain clears a point (last year's school-list users). */
export function quadrantOf(liftPp: number, holdoutRate: number): "PERSUADABLE" | "SURE_THING" | "LOST_CAUSE" | "SLEEPING_DOG" {
  if (liftPp <= -0.5) return "SLEEPING_DOG";
  if (holdoutRate >= 0.08 && liftPp < holdoutRate * 100 * 0.25) return "SURE_THING";
  if (liftPp >= 1.0) return "PERSUADABLE";
  if (holdoutRate >= 0.08) return "SURE_THING";
  return "LOST_CAUSE";
}

/** Campaign Health: 0-100 from four components, each 0-25, so a person can see
 *  which part dragged it down. */
export function campaignHealth(o: {
  liftPp: number | null; significant: boolean; pacingGapPts: number | null; bounceRate: number | null;
  unsubRate: number | null; complaintRate: number | null; coldShare: number | null;
}) {
  const lift = o.liftPp === null ? 12 : o.liftPp <= 0 ? 0 : Math.min(25, (o.liftPp / 3) * 25 * (o.significant ? 1 : 0.7));
  const pacing = o.pacingGapPts === null ? 20 : Math.max(0, 25 - Math.abs(o.pacingGapPts) * 0.8);
  const deliver = Math.max(0, 25 - (o.bounceRate ?? 0) * 100 * 3 - (o.unsubRate ?? 0) * 100 * 8 - (o.complaintRate ?? 0) * 100 * 40);
  // Targeting: the share of the treated group that are cold contacts (no
  // Officeworks relationship and no signal), who mostly unsubscribe.
  const targeting = o.coldShare === null ? 20 : Math.max(0, 25 * (1 - Math.min(1, o.coldShare * 2)));
  const parts = { lift: Math.round(lift), pacing: Math.round(pacing), deliverability: Math.round(deliver), targeting: Math.round(targeting) };
  return { score: parts.lift + parts.pacing + parts.deliverability + parts.targeting, parts };
}
