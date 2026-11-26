"use client";

import { Fragment, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Pill, Banner } from "@/components/ui/kit";
import type { BriefRow } from "@/lib/meeting";

// ─── Approve, and the meetings before this one ────────────────────────────────
//
// Every brief for the brand, newest first. A DRAFT can be approved here as the
// signed-in category manager (POST /api/negotiation); an approved one shows who
// approved it, so the next meeting starts from what was agreed last time.

const aud = (v: number | null | undefined) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
const when = (v: string | null | undefined) => (v ? String(v).slice(0, 16).replace("T", " ") : "");
const TONE: Record<string, "green" | "amber" | "slate"> = { APPROVED: "green", DRAFT: "amber" };

export function BriefHistory({ briefs, currentId, onChanged }: { briefs: BriefRow[]; currentId?: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(currentId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const approve = async (briefId: string) => {
    setErr(null); setBusy(briefId);
    try {
      const r = await fetch("/api/negotiation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", briefId }) });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "Approval failed");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  if (!briefs.length) return <p className="text-xs text-slate-400">No briefs for this brand yet. Build one in step 2.</p>;
  return (
    <div>
      {err && <div className="mb-2"><Banner tone="error">{err}</Banner></div>}
      <table className="w-full text-xs">
        <thead><tr className="border-b border-slate-100 text-slate-500">
          <th className="py-1.5 text-left">Brief</th><th className="py-1.5 text-left">Built</th><th className="py-1.5 text-left">Stance</th>
          <th className="py-1.5 text-left">Status</th><th className="py-1.5 text-right">Opening</th><th className="py-1.5 text-right">Target</th>
          <th className="py-1.5 text-right">Walk-away</th><th />
        </tr></thead>
        <tbody>
          {briefs.map((b) => (
            <Fragment key={b.briefId}>
              <tr className={`border-b border-slate-50 ${b.briefId === currentId ? "bg-blue-50/40" : ""}`}>
                <td className="py-2">
                  <button onClick={() => setOpen(open === b.briefId ? null : b.briefId)} className="inline-flex items-center gap-1 font-mono text-slate-700 hover:text-blue-700">
                    {open === b.briefId ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{b.briefId}
                  </button>
                  {b.briefId === currentId && <span className="ml-1.5 text-[10px] font-semibold text-blue-700">current</span>}
                </td>
                <td className="py-2 text-slate-600">{when(b.createdAt)}</td>
                <td className="py-2">{b.stance?.toLowerCase()}{b.sop ? <div className="text-[10px] text-slate-400">SOP v{b.sop.version}</div> : null}</td>
                <td className="py-2">
                  <Pill tone={TONE[b.status] ?? "slate"}>{b.status.toLowerCase()}</Pill>
                  {b.approvedBy ? <span className="ml-1 text-slate-500">by {b.approvedBy}</span> : null}
                </td>
                <td className="py-2 text-right font-mono">{aud(b.openingAud)}</td>
                <td className="py-2 text-right font-mono">{aud(b.targetAud)}</td>
                <td className="py-2 text-right font-mono">{aud(b.walkawayAud)}</td>
                <td className="py-2 pl-3 text-right">
                  {b.status === "DRAFT" && (
                    <button onClick={() => approve(b.briefId)} disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                      {busy === b.briefId ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}Approve
                    </button>
                  )}
                </td>
              </tr>
              {open === b.briefId && (
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <td colSpan={8} className="px-4 py-2.5">
                    <ul className="space-y-1">
                      {b.asks.map((a) => (
                        <li key={a.askId} className="text-[11px] text-slate-700">
                          <span className="font-semibold">{a.askId}. {a.label}</span>{a.direction === "GIVE" ? <span className="ml-1"><Pill tone="amber">give</Pill></span> : null}
                          <span className="ml-2 font-mono text-slate-500">{aud(a.openingAud)} / {aud(a.targetAud)} / {aud(a.walkawayAud)}</span>
                          {a.basis && <div className="text-[10px] text-slate-500">{a.basis}</div>}
                        </li>
                      ))}
                      {(b.levers ?? []).map((l, i) => <li key={`l${i}`} className="text-[11px] text-slate-600"><span className="font-semibold">Lever: {l.label}.</span> {l.basis}</li>)}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
