"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { BookOpen, ChevronRight, FileText, Handshake, Loader2, RefreshCw, Sliders, Sparkles } from "lucide-react";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { Banner, Pill, Segmented } from "@/components/ui/kit";
import { Arguments, CheckBadge, FactTiles } from "@/components/meeting/Battlecard";
import { BriefCard, type BriefBlock } from "@/components/meeting/BriefCard";
import { BriefHistory } from "@/components/meeting/BriefHistory";
import {
  briefRequest, cardIsCurrent, currentBrief, readCard, ruleValue, saveCard, sopLabel, stanceTitle, RULES_HREF, SOP_HREF, SOP_NAME, STANCES,
  type Battlecard, type BriefRow, type Evidence, type NegotiationRule, type Stance,
} from "@/lib/meeting";

// ─── Supplier Meeting: one brand, facts -> plan -> approve ────────────────────
//
// What were two pages -- the Battlecard and the Negotiation Brief -- as the three
// steps of preparing one meeting:
//
//   1 FACTS    the negotiation evidence (sql/48) as tiles, and the battlecard's
//              arguments Cortex AI worded from it (sql/09), figure-checked
//   2 PLAN     pick a stance; NEGOTIATION_BRIEF_AGENT sizes the asks from the same
//              evidence and writes a DRAFT brief
//   3 APPROVE  the brand's briefs, newest first: approve the draft; earlier
//              meetings show what was agreed
//
// House rules, not the model's: the arguments and the brief are written to the
// Head of Department's "Supplier negotiation prep" SOP, and the asks are sized by
// the negotiation rules; both live on Settings, versioned and owned, and the page
// names the version and the values it used.
//
// The battlecard is kept in the browser per brand (readCard/saveCard), so returning
// to the page and the printable pack (/meeting-pack/<brand>) show the same wording,
// until the SOP changes: then it is written again to the new version.

type CardResult = Battlecard & { error?: string; evidence?: Evidence };

function Step({ n, title, hint, children, right }: { n: number; title: string; hint: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={`step-${n}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-700 text-xs font-bold text-white">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function SupplierMeetingPage() {
  const params = useParams<{ brand: string }>();
  const brand = decodeURIComponent(params?.brand || "");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [card, setCard] = useState<CardResult | null>(null);
  const [writing, setWriting] = useState(false);
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [stance, setStance] = useState<Stance>("BALANCED");
  const [run, setRun] = useState<{ q: string; n: number } | null>(null);
  const [rules, setRules] = useState<NegotiationRule[]>([]);

  const loadHistory = useCallback(() => {
    fetch(`/api/negotiation?brand=${encodeURIComponent(brand)}`).then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setBriefs(d); }).catch(() => {});
  }, [brand]);

  const writeCard = useCallback(async () => {
    setWriting(true);
    try {
      const r = await fetch("/api/battlecard/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand }) });
      const d = (await r.json()) as CardResult;
      setCard(d);
      if (!d.error) saveCard(brand, d);
    } catch {
      setCard({ error: "The battlecard could not be written.", key_arguments: null, negotiation_approach: null, incentives: null, pressures: null });
    } finally { setWriting(false); }
  }, [brand]);

  useEffect(() => {
    if (!brand) return;
    fetch(`/api/negotiation?evidence=${encodeURIComponent(brand)}`).then((r) => r.json())
      .then((d) => (d.ok ? setEvidence(d) : setEvErr(d.error || "No evidence for this brand.")))
      .catch(() => setEvErr("Could not load the evidence."));
    loadHistory();
    fetch("/api/negotiation?rules=1").then((r) => r.json()).then((d) => { if (Array.isArray(d.settings)) setRules(d.settings); }).catch(() => {});
    // Reuse the kept battlecard only if it was written to the SOP version in force.
    const cached = readCard<CardResult>(brand);
    fetch("/api/assessment/templates").then((r) => r.json())
      .then((d) => (d.templates ?? []).find((t: { templateName: string }) => t.templateName === SOP_NAME)?.version ?? null)
      .catch(() => cached?.sop?.version ?? null)
      .then((live: number | null) => {
        if (cardIsCurrent(cached, live)) setCard(cached);
        else void writeCard();
      });
  }, [brand, loadHistory, writeCard]);

  const current = currentBrief(briefs);
  const counterparty = evidence?.distributor ?? evidence?.supplier ?? null;
  const stanceLabel = STANCES.find((s) => s.value === stance)!.label.toLowerCase();
  const pctOf = (key: string, share = false) => {
    const v = ruleValue(rules, key);
    return v === null ? "–" : `${Math.round(share ? v * 100 : v)}%`;
  };

  return (
    <div className="space-y-5 p-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/meeting" className="hover:text-blue-700">Supplier Meeting</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-slate-900">{brand}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-blue-800 px-6 py-4 text-white">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-blue-200">Supplier meeting</div>
          <h1 className="mt-0.5 text-lg font-bold">{brand}{counterparty ? ` with ${counterparty}` : ""}</h1>
          <p className="mt-0.5 text-xs text-blue-200">
            {evidence ? `${evidence.category} · ${evidence.period}` : "Loading the evidence…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {current && <Pill tone={current.status === "APPROVED" ? "green" : "amber"}>{current.status === "APPROVED" ? "brief approved" : "brief in draft"}</Pill>}
          <Link href={`/brand/${encodeURIComponent(brand)}`} className="rounded-lg border border-blue-300/50 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Brand page</Link>
          <a href={`/meeting-pack/${encodeURIComponent(brand)}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50">
            <FileText className="h-3.5 w-3.5" /> Meeting pack
          </a>
        </div>
      </div>

      <Step n={1} title="Facts" hint="The negotiation evidence, and the arguments Cortex AI wrote from it. The brief in step 2 is sized from the same figures."
        right={<div className="flex items-center gap-3"><CheckBadge check={card?.check} />
          <button onClick={() => void writeCard()} disabled={writing} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-700 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${writing ? "animate-spin" : ""}`} />Rewrite arguments
          </button></div>}>
        {evErr ? <Banner tone="error">{evErr}</Banner> : evidence ? <FactTiles e={evidence} /> : (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Reading sales, margin, DIFOT, promotions and switching…</div>
        )}
        <p className="mt-5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
          <BookOpen className="h-3.5 w-3.5 text-violet-600" />
          {card?.sop ? <>Arguments written to your Head of Department&apos;s SOP: <span className="font-semibold text-slate-800">{sopLabel(card.sop)}</span>
            {card.sop.updated_by ? <span className="text-slate-400">(last edited by {card.sop.updated_by})</span> : null}</>
            : <>No &quot;{SOP_NAME}&quot; SOP found: arguments follow the built-in rules only.</>}
          <Link href={SOP_HREF} className="font-semibold text-violet-700 hover:underline">View or edit in Settings</Link>
        </p>
        <div className="mt-2">
          {writing && !card?.key_arguments ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 py-8 justify-center text-xs text-slate-500">
              <Sparkles className="h-4 w-4 text-blue-600" />Cortex AI is writing the arguments from these figures…
            </div>
          ) : card?.key_arguments ? <Arguments card={card} /> : card?.error ? <Banner tone="warn">{card.error}</Banner> : null}
        </div>
      </Step>

      <Step n={2} title="Plan" hint="Pick a stance. The brief agent sizes each ask (opening, target, walk-away), the gives and the guardrails, and saves a draft.">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={stance} options={STANCES.map((s) => ({ ...s, title: stanceTitle(s.value, rules) }))} onChange={setStance} />
          <button onClick={() => setRun({ q: briefRequest(brand, stance, counterparty), n: (run?.n ?? 0) + 1 })}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800">
            <Handshake className="h-3.5 w-3.5" />Build the {stanceLabel} brief
          </button>
          <span className="text-[11px] text-slate-500">{stanceTitle(stance, rules)}. A new draft replaces an older draft.</span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
          <Sliders className="h-3.5 w-3.5 text-violet-600" />
          Sized by your negotiation rules: target keeps {pctOf(`TARGET_SHARE_${stance}`, true)} at {stanceLabel},
          walk away below {pctOf("WALKAWAY_SHARE", true)}, supplier co-funds {pctOf("PROMO_FUND_OPENING_PCT")} of promo discount,
          DIFOT credit {pctOf("DIFOT_CREDIT_PCT")}. Written to the same SOP.
          <Link href={RULES_HREF} className="font-semibold text-violet-700 hover:underline">Change them in Settings</Link>
        </p>
        {run && (
          <div className="mt-4">
            <AgentPanel key={run.n} agent="negotiationBrief" tag="brief" stage="CATEGORY_BRIEF" autoAsk={run.q} compact
              placeholder="Ask a follow-up, e.g. what if they refuse the promo ask?"
              card={(b, t) => <BriefCard b={b as BriefBlock} run={t.run} onApproved={loadHistory} />} onFinished={loadHistory} />
          </div>
        )}
      </Step>

      <Step n={3} title="Approve, and past meetings" hint="Nothing is agreed or sent until a category manager approves the draft. Earlier briefs show what was asked last time.">
        <BriefHistory briefs={briefs} currentId={current?.briefId} onChanged={loadHistory} />
      </Step>
    </div>
  );
}
