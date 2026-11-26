"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Printer } from "lucide-react";
import { cardText, currentBrief, readCard, saveCard, factTiles, overrideWarning, sopLabel, type Battlecard, type BriefRow, type Evidence } from "@/lib/meeting";

// ─── The meeting pack: one printable page to take into the room ───────────────
//
// /meeting-pack/<brand>, outside the app shell so it prints without the sidebar.
// The facts (the same tiles as the Supplier Meeting page), the brief the meeting
// runs on (the newest approved or draft brief, a draft marked as not yet
// approved), and the battlecard's arguments. The battlecard is the one the
// meeting page wrote (readCard); if there is none it is written again.

const aud = (v: number | null | undefined) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
type CardResult = Battlecard & { error?: string };

export default function MeetingPack() {
  const params = useParams<{ brand: string }>();
  const brand = decodeURIComponent(params?.brand || "");
  const [e, setE] = useState<Evidence | null>(null);
  const [briefs, setBriefs] = useState<BriefRow[] | null>(null);
  const [card, setCard] = useState<CardResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!brand) return;
    fetch(`/api/negotiation?evidence=${encodeURIComponent(brand)}`).then((r) => r.json())
      .then((d) => (d.ok ? setE(d) : setErr(d.error || "No evidence for this brand."))).catch(() => setErr("Could not load the evidence."));
    fetch(`/api/negotiation?brand=${encodeURIComponent(brand)}`).then((r) => r.json())
      .then((d) => setBriefs(Array.isArray(d) ? d : [])).catch(() => setBriefs([]));
    const cached = readCard<CardResult>(brand);
    if (cached) setCard(cached);
    else fetch("/api/battlecard/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand }) })
      .then((r) => r.json()).then((d) => { setCard(d); if (!d.error) saveCard(brand, d); })
      .catch(() => setCard({ error: "The battlecard could not be written.", key_arguments: null, negotiation_approach: null, incentives: null, pressures: null }));
  }, [brand]);

  const brief = briefs ? currentBrief(briefs) : null;
  const ready = !!e && briefs !== null && card !== null;
  const warning = e ? overrideWarning(e) : null;
  const args = card?.key_arguments ? [...card.key_arguments.profitability, ...card.key_arguments.growth, ...card.key_arguments.others] : [];

  return (
    <div className="mx-auto max-w-[900px] bg-white p-8 text-slate-900 print:max-w-none print:p-0">
      <style>{"@page { size: A4; margin: 14mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }"}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-xs text-slate-500">{ready ? "Ready to print." : "Preparing the pack…"}</span>
        <button onClick={() => window.print()} disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
          <Printer className="h-3.5 w-3.5" />Print or save as PDF
        </button>
      </div>

      <header className="border-b-2 border-blue-800 pb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-800">Baby Mart · supplier meeting pack · confidential</div>
        <h1 className="mt-1 text-xl font-bold">{brand}{e?.distributor ? ` with ${e.distributor}` : ""}</h1>
        <p className="text-xs text-slate-600">{e ? `${e.category} · ${e.period}` : ""}</p>
      </header>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      {!ready && !err && <div className="flex items-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Gathering the facts, the brief and the arguments…</div>}

      {ready && e && (
        <>
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">The facts</h2>
            <div className="grid grid-cols-4 gap-2">
              {factTiles(e).map((t) => (
                <div key={t.key} className="rounded border border-slate-200 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-500">{t.label}</div>
                  <div className="text-base font-bold">{t.value}</div>
                  <div className="text-[10px] text-slate-600">{t.sub}</div>
                </div>
              ))}
            </div>
            {warning && <p className="mt-2 text-[10px] text-amber-800">Watch out: {warning}</p>}
          </section>

          <section className="mt-5 break-inside-avoid">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-700">Our asks</h2>
            {!brief ? <p className="text-xs text-slate-500">No brief has been built for {brand} yet: build one on the Supplier Meeting page.</p> : (
              <>
                <p className="mb-2 text-[11px] text-slate-600">
                  Brief {brief.briefId}, {brief.stance?.toLowerCase()} stance ·{" "}
                  {brief.status === "APPROVED" ? <b className="text-emerald-700">approved by {brief.approvedBy}</b> : <b className="text-amber-700">DRAFT, not yet approved</b>}
                  {brief.rules && <> · sized by the negotiation rules: target keeps {Math.round(brief.rules.target_share * 100)}%, walk away below {Math.round(brief.rules.walkaway_share * 100)}%</>}
                  {brief.sop && <> · written to {sopLabel(brief.sop)}</>}
                </p>
                <table className="w-full border border-slate-200 text-[11px]">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <th className="px-2 py-1 text-left">Ask</th><th className="whitespace-nowrap px-2 py-1 text-right">Opening</th><th className="whitespace-nowrap px-2 py-1 text-right">Target</th><th className="whitespace-nowrap px-2 py-1 text-right">Walk-away</th>
                  </tr></thead>
                  <tbody>
                    {brief.asks.map((a) => (
                      <tr key={a.askId} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1"><b>{a.askId}. {a.label}</b>{a.direction === "GIVE" ? " (give)" : ""}{a.basis && <div className="text-[10px] text-slate-500">{a.basis}</div>}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(a.openingAud)}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(a.targetAud)}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(a.walkawayAud)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-2 py-1">Net, a year of terms</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(brief.openingAud)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(brief.targetAud)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{aud(brief.walkawayAud)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 grid grid-cols-2 gap-4 text-[11px]">
                  {!!brief.levers?.length && <div><b>Levers</b><ul className="list-disc pl-4">{brief.levers.map((l, i) => <li key={i}>{l.label}: {l.basis}</li>)}</ul></div>}
                  {!!brief.guardrails?.length && <div><b>Guardrails</b><ul className="list-disc pl-4">{brief.guardrails.map((g, i) => <li key={i}>{g.message}</li>)}</ul></div>}
                </div>
              </>
            )}
          </section>

          <section className="mt-5">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-700">The arguments</h2>
            {card?.sop && <p className="mb-1 text-[10px] text-slate-500">Written to the Head of Department&apos;s SOP: {sopLabel(card.sop)}.</p>}
            {card?.error ? <p className="text-xs text-slate-500">{card.error}</p> : (
              <>
                <table className="w-full border border-slate-200 text-[10.5px]">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <th className="px-2 py-1 text-left">Argument</th><th className="px-2 py-1 text-left">Brand data</th><th className="px-2 py-1 text-left">Ask</th>
                  </tr></thead>
                  <tbody>{args.map((a, i) => (
                    <tr key={i} className="break-inside-avoid border-t border-slate-100 align-top">
                      <td className="w-1/4 px-2 py-1 font-semibold">{a.name}</td><td className="px-2 py-1">{a.data}</td><td className="px-2 py-1">{a.ask}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <div className="mt-2 grid grid-cols-2 gap-4 text-[11px]">
                  {card?.negotiation_approach && <div className="col-span-2"><b>Approach.</b> {card.negotiation_approach}</div>}
                  {!!card?.incentives?.length && <div><b>What we can offer</b><ul className="list-disc pl-4">{card.incentives.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                  {!!card?.pressures?.length && <div><b>Expect pushback</b><ul className="list-disc pl-4">{card.pressures.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                </div>
                {card?.check && !card.check.verified && (
                  <p className="mt-2 text-[10px] text-amber-800">Not in the evidence, check before quoting: {card.check.unmatched.map((u) => u.replace(/^prose: /, "")).join(", ")}</p>
                )}
                {card && cardText(card).length === 0 && <p className="text-xs text-slate-500">No arguments.</p>}
              </>
            )}
          </section>

          <footer className="mt-6 border-t border-slate-200 pt-2 text-[9px] text-slate-400">{e.provenance}</footer>
        </>
      )}
    </div>
  );
}
