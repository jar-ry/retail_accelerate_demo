// ─── Campaign & CRM: headline findings (pure) ────────────────────────────────
//
// The few things that matter most on a screen, computed from the measurement
// every page uses and written from templates, as the published learnings are.
// This replaced an AI_COMPLETE "read of the screen": a ranking of open alerts
// and holdout results needs no model, and a templated sentence cannot misquote
// a number. Questions that do need judgement go to the campaign agents, which
// the panel links to.

type Campaign = {
  campaignId: string; name: string; status: string; treated: number; holdout: number;
  liftPp: number | null; ciLowPp: number | null; ciHighPp: number | null; significant: boolean;
  incrementalConv: number | null; net: number | null; cost: number;
  alerts: { code: string; severity: string; message: string; status: string }[];
};
type Learning = { CAMPAIGN_NAME?: unknown; STATEMENT?: unknown; LIFT_PP?: unknown; IS_SIGNIFICANT?: unknown; DIMENSION?: unknown };

export type Finding = { severity: "HIGH" | "MEDIUM" | "LOW"; text: string; campaignId?: string; ask?: string };
export const SURFACES = ["OVERVIEW", "PERFORMANCE", "LEARNINGS"] as const;
export type Surface = (typeof SURFACES)[number];

const pts = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)} pts`);
const money = (v: number | null) => {
  if (v === null) return "n/a";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  return a >= 1000 ? `${sign}AUD ${(a / 1000).toFixed(1)}K` : `${sign}AUD ${Math.round(a)}`;
};
const ci = (c: Campaign) => `95% CI ${pts(c.ciLowPp)} to ${pts(c.ciHighPp)}`;
const SEV_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const investigate = (c: Campaign) => `Why is the ${c.name} campaign (${c.campaignId}) performing the way it is against its holdout?`;

function alertFindings(cs: Campaign[], limit: number): Finding[] {
  return cs.flatMap((c) => c.alerts.filter((a) => a.status === "OPEN").map((a) => ({ c, a })))
    .sort((x, y) => (SEV_RANK[x.a.severity] ?? 3) - (SEV_RANK[y.a.severity] ?? 3))
    .slice(0, limit)
    .map(({ c, a }) => ({ severity: (a.severity as Finding["severity"]) ?? "MEDIUM", text: `${c.name}: ${a.message}`, campaignId: c.campaignId, ask: investigate(c) }));
}

export function computeFindings(surface: Surface, campaigns: Campaign[], learnings: Learning[] = []): Finding[] {
  const measured = campaigns.filter((c) => c.treated > 0 && c.holdout > 0 && c.liftPp !== null);
  const live = measured.filter((c) => ["LIVE", "PAUSED"].includes(c.status));
  const byNet = [...measured].filter((c) => c.net !== null).sort((a, b) => (a.net ?? 0) - (b.net ?? 0));
  const out: Finding[] = [];

  if (surface === "OVERVIEW") {
    out.push(...alertFindings(live, 3));
    const worstLive = [...live].sort((a, b) => (a.liftPp ?? 0) - (b.liftPp ?? 0))[0];
    if (worstLive && (worstLive.liftPp ?? 0) < 0) {
      out.push({ severity: worstLive.significant ? "HIGH" : "MEDIUM", campaignId: worstLive.campaignId, ask: investigate(worstLive),
        text: `${worstLive.name} is the live campaign furthest below its holdout: ${pts(worstLive.liftPp)} (${ci(worstLive)}), net ${money(worstLive.net)}.` });
    }
    const best = byNet.at(-1);
    if (best && (best.net ?? 0) > 0) {
      out.push({ severity: "LOW", campaignId: best.campaignId, text: `${best.name} has earned the most over its holdout: ${pts(best.liftPp)}, net ${money(best.net)}.` });
    }
    if (!out.length) out.push({ severity: "LOW", text: "No open alerts, and no live campaign is below its holdout." });
  }

  if (surface === "PERFORMANCE") {
    const winners = measured.filter((c) => c.significant && (c.liftPp ?? 0) > 0);
    const losers = measured.filter((c) => c.significant && (c.liftPp ?? 0) < 0);
    const total = measured.reduce((a, c) => a + (c.net ?? 0), 0);
    out.push({ severity: total < 0 ? "HIGH" : "LOW",
      text: `${winners.length} of ${measured.length} campaigns with a holdout show a significant lift; ${losers.length} are significantly below it. Net across them: ${money(total)}.` });
    for (const c of byNet.slice(0, 2).filter((c) => (c.net ?? 0) < 0)) {
      out.push({ severity: c.significant ? "HIGH" : "MEDIUM", campaignId: c.campaignId, ask: investigate(c),
        text: `${c.name} lost the most: ${pts(c.liftPp)} (${ci(c)}), ${money(c.cost)} spent, net ${money(c.net)}.` });
    }
    const top = byNet.at(-1);
    if (top && (top.net ?? 0) > 0) out.push({ severity: "LOW", campaignId: top.campaignId, text: `${top.name} earned the most: ${pts(top.liftPp)}, net ${money(top.net)}.` });
    const flat = measured.filter((c) => !c.significant && c.ciLowPp !== null && c.ciLowPp < 0 && (c.ciHighPp ?? 0) > 0).length;
    if (flat) out.push({ severity: "MEDIUM", text: `${flat} campaign${flat === 1 ? "" : "s"} cannot yet be told apart from their holdout: the interval spans zero.` });
  }

  if (surface === "LEARNINGS") {
    const sig = learnings.filter((l) => l.IS_SIGNIFICANT === true && l.DIMENSION !== "Overall");
    const lift = (l: Learning) => Number(l.LIFT_PP ?? 0);
    const pos = [...sig].sort((a, b) => lift(b) - lift(a)).slice(0, 2).filter((l) => lift(l) > 0);
    const neg = [...sig].sort((a, b) => lift(a) - lift(b)).slice(0, 2).filter((l) => lift(l) < 0);
    out.push({ severity: "LOW", text: `${learnings.length} published learnings; ${sig.length} name a segment or channel whose lift is significant.` });
    for (const l of pos) out.push({ severity: "LOW", text: `What worked: ${String(l.STATEMENT)}` });
    for (const l of neg) out.push({ severity: "MEDIUM", text: `What to avoid: ${String(l.STATEMENT)}` });
  }
  return out;
}
