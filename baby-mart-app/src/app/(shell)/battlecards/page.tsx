"use client";

import Link from "next/link";
import { Swords, Sparkles } from "lucide-react";
import { brandData } from "@/data/brandConfig";

const battlecardBrands = [
  "Huggies", "Bugaboo", "Uppababy", "Rascal + Friends", "Maxi-Cosi",
  "Pampers", "Cybex", "Bonds Baby", "Dr Browns", "Infasecure",
];

export default function BattlecardsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Swords className="w-5 h-5 text-blue-700" />
        <h1 className="text-xl font-bold text-slate-900">Negotiation Battlecards</h1>
      </div>

      <p className="text-sm text-slate-500 mb-6">
        AI-generated negotiation briefs powered by Cortex AI. Select a brand to generate a battlecard.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {battlecardBrands.map((name) => {
          const b = brandData[name];
          if (!b) return null;
          return (
            <Link
              key={name}
              href={`/brand/${encodeURIComponent(name)}/battlecard`}
              className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left"
            >
              <div>
                <div className="font-medium text-slate-900 text-sm">{b.name}</div>
                <div className="text-xs text-slate-500">{b.category}</div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                Generate
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
