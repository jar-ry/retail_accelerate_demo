"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Swords, Sparkles, Loader2 } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";

// Every brand POS sold in the 28 days to 7 May 2026, by category (/api/brand/list).
// The list used to be ten hand-picked names looked up in brandConfig.ts.

type Listed = { brand: string; category: string; revenue: number };

const aud = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${(n / 1e3).toFixed(1)}K`);

export default function BattlecardsPage() {
  const [brands, setBrands] = useState<Listed[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/brand/list")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setBrands(d.brands)))
      .catch(() => setError("Could not load the brand list."));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Swords className="w-5 h-5 text-blue-700" />
        <h1 className="text-xl font-bold text-slate-900">Negotiation Battlecards</h1>
      </div>

      <p className="text-sm text-slate-500 mb-6">
        AI-generated negotiation briefs: the figures come from POS, DIFOT, switching and promotions; Cortex AI writes the
        negotiation wording. Select a brand to generate a battlecard.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!brands && !error && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>}

      {brands && CATEGORIES.map((c) => {
        const inCat = brands.filter((b) => b.category === c.name);
        if (!inCat.length) return null;
        return (
          <div key={c.slug} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{c.name}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {inCat.map((b) => (
                <Link
                  key={b.brand}
                  href={`/brand/${encodeURIComponent(b.brand)}/battlecard`}
                  className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left"
                >
                  <div>
                    <div className="font-medium text-slate-900 text-sm">{b.brand}</div>
                    <div className="text-xs text-slate-500">{aud(b.revenue)} in the last 28 days</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
