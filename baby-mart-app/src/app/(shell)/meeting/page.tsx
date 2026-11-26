"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Handshake, Loader2 } from "lucide-react";
import { Pill } from "@/components/ui/kit";
import { CATEGORIES } from "@/lib/categories";
import type { BriefRow } from "@/lib/meeting";

// ─── Supplier Meeting: pick the brand ─────────────────────────────────────────
//
// Every brand POS sold in the 28 days to 7 May 2026, by category
// (/api/brand/list), with the state of its latest brief; and the recent briefs
// across brands. Each brand opens /meeting/<brand>: facts, plan, approve.

type Listed = { brand: string; category: string; revenue: number };

const short = (n: number) => (Math.abs(n) >= 1e6 ? `AUD ${(n / 1e6).toFixed(2)}M` : `AUD ${(n / 1e3).toFixed(1)}K`);
const aud = (v: number | null) => (typeof v === "number" ? `AUD ${Math.round(v).toLocaleString("en-AU")}` : "–");
const href = (brand: string) => `/meeting/${encodeURIComponent(brand)}`;

export default function SupplierMeetingIndex() {
  const [brands, setBrands] = useState<Listed[] | null>(null);
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/brand/list").then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setBrands(d.brands)))
      .catch(() => setError("Could not load the brand list."));
    fetch("/api/negotiation").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setBriefs(d); }).catch(() => {});
  }, []);

  // The newest brief per brand (the list is newest first).
  const latest = new Map<string, BriefRow>();
  for (const b of briefs) if (!latest.has(b.brand) && b.status !== "SUPERSEDED") latest.set(b.brand, b);

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <Handshake className="h-5 w-5 text-blue-700" />
          <h1 className="text-xl font-bold text-slate-900">Supplier Meeting</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Prepare a supplier meeting in one place: the facts and arguments (the battlecard), a brief sized at the stance
          you choose, and the approval. Every figure comes from one evidence tool, so the arguments and the asks cannot
          disagree. Pick a brand.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!brands && !error && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>}

      {brands && CATEGORIES.map((c) => {
        const inCat = brands.filter((b) => b.category === c.name);
        if (!inCat.length) return null;
        return (
          <div key={c.slug}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{c.name}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {inCat.map((b) => {
                const l = latest.get(b.brand);
                return (
                  <Link key={b.brand} href={href(b.brand)}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{b.brand}</div>
                      <div className="text-xs text-slate-500">{short(b.revenue)} in the last 28 days</div>
                    </div>
                    {l ? <Pill tone={l.status === "APPROVED" ? "green" : "amber"}>{l.status === "APPROVED" ? "approved" : "draft"}</Pill>
                      : <span className="text-xs font-medium text-blue-600">Prepare</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Recent briefs</h3>
        {briefs.length === 0 ? <p className="text-xs text-slate-400">No briefs yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-100 text-slate-500">
              <th className="py-1.5 text-left">Brief</th><th className="py-1.5 text-left">Brand · supplier</th><th className="py-1.5 text-left">Stance</th>
              <th className="py-1.5 text-left">Status</th><th className="py-1.5 text-right">Opening</th><th className="py-1.5 text-right">Target</th><th className="py-1.5 text-right">Walk-away</th>
            </tr></thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.briefId} className="border-b border-slate-50">
                  <td className="py-2 font-mono">{b.briefId}</td>
                  <td className="py-2"><Link href={href(b.brand)} className="text-blue-700 hover:underline">{b.brand}</Link> · {b.supplier}</td>
                  <td className="py-2">{b.stance?.toLowerCase()}</td>
                  <td className="py-2"><Pill tone={b.status === "APPROVED" ? "green" : b.status === "DRAFT" ? "amber" : "slate"}>{b.status.toLowerCase()}</Pill>{b.approvedBy ? <span className="ml-1 text-slate-500">by {b.approvedBy}</span> : null}</td>
                  <td className="py-2 text-right font-mono">{aud(b.openingAud)}</td>
                  <td className="py-2 text-right font-mono">{aud(b.targetAud)}</td>
                  <td className="py-2 text-right font-mono">{aud(b.walkawayAud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
