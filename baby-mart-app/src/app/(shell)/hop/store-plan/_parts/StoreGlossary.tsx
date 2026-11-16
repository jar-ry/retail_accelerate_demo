"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "../../_components/ui";

/** The terms this page asks a planner to reason in, with why each exists and how
 *  to choose it. The examples are this plan's own openings, not invented ones. */
const TERMS: { term: string; what: string; why: string; how?: string }[] = [
  {
    term: "Benchmark store",
    what: "The existing store a new store borrows its shape from. A new store's plan is the benchmark's last-year months, scaled to a share.",
    why: "A new store has no history, so there is nothing to grow. Like-for-like is a statement about a store's own past, and a store that has never traded has none. The benchmark supplies the seasonality and the trading rhythm the new store is assumed to inherit.",
    how: "Pick a store that trades like the new one will: a comparable centre, catchment and format. Similarity matters more than distance. Marsden Park is benchmarked on Parramatta because both sit in the north-west Sydney growth corridor.",
  },
  {
    term: "Benchmark share",
    what: "How much of the benchmark's trade the new store is expected to do. 0.85 means 85% of that store, month by month.",
    why: "It is the single assumption the whole new-store value rests on. If it is wrong, the store's plan is wrong by the same proportion.",
    how: "Reason from catchment, selling area and format, in that order. It is a statement about relative volume, not a discount for uncertainty. Write the reasoning down: someone will ask in six months, and the number alone will not answer them.",
  },
  {
    term: "Phasing source",
    what: "The store whose weekly shape is applied to the new store's months. Usually the benchmark itself.",
    why: "A benchmark that is itself a new store has no weekly history to lend, so the shape comes from that store's own comparable. Mernda is the live example: benchmarked on Craigieburn, itself an opening, so it is phased on Southland.",
    how: "It is resolved for you. Benchmark a new store on another opening and the plan follows that opening's phasing source rather than failing quietly.",
  },
  {
    term: "Halo",
    what: "The opening weeks when a new store trades above its settled run rate because it is new. Nine weeks unless set otherwise; Marsden Park carries twelve as a large-format destination.",
    why: "It matters most a year later. Left in next year's like-for-like base, the halo makes the store look as if it is declining when it is only settling. Flagging it now is what makes next year's comparison honest.",
    how: "Longer for a destination opening with marketing behind it; shorter for a store opening quietly into an established catchment. Halo weeks are shaded on the week view.",
  },
  {
    term: "Like-for-like %",
    what: "Growth on the same store's same week last year. A comparable store's plan is last year's week × (1 + LFL %).",
    why: "It separates trading performance from the effect of opening stores. Total growth mixes the two, which is why both are shown.",
    how: "A new store shows n/a, never zero: it has no like-for-like at all. The chain figure is measured on matched store-weeks only, against the same weeks last year.",
  },
  {
    term: "Margin %",
    what: "POS margin: what the till realises after discount. First margin, struck at intake, lives in the MFP.",
    why: "They are different numbers, and quoting one as the other is one of the easiest ways to draw a wrong conclusion. The overview shows both side by side for that reason.",
  },
  {
    term: "Week edit",
    what: "A rate typed against a single week rather than the month.",
    why: "Some trading is genuinely weekly: a centre event, a launch weekend. A week edit wins over the month driver until the month is next changed, and the next month edit supersedes it, so neither silently shadows the other.",
  },
  {
    term: "Value override",
    what: "Naming the sales you want a store-month to land on, instead of the rate that produces it.",
    why: "Sometimes the number is the decision and the rate is the consequence. For a comparable store LFL % is back-solved, so the grid still explains itself; a new store's month is typed over its benchmark-derived value, and the trail records that it is no longer derived.",
    how: "Every override carries its reason and who made it, and can be stepped back from the store's history. A revert is its own entry: the trail shows the change and the correction.",
  },
  {
    term: "Selling area",
    what: "A store's floor area in square metres, kept in the store master.",
    why: "No source holds it: the store dimension has no area column. A figure entered here is a planner's record, with its reason, not a measurement from a feed. The free-text sizing note on the add-store form is a note, not a measurement.",
  },
];

export function StoreGlossary() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(TERMS[0].term);
  const t = TERMS.find((x) => x.term === term) ?? TERMS[0];
  return (
    <Card
      title={
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 hover:text-teal-700">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<BookOpen className="h-4 w-4 text-teal-600" />Glossary
        </button>
      }
      subtitle="Benchmarks, halo, like-for-like, margin and overrides: what each is, why it exists, and how to choose it."
    >
      {open ? (
        <div className="grid gap-4 md:grid-cols-[180px_1fr]">
          <div className="flex flex-wrap gap-1 md:flex-col">
            {TERMS.map((x) => (
              <button key={x.term} onClick={() => setTerm(x.term)}
                className={`rounded px-2 py-1 text-left text-[11px] ${x.term === term ? "bg-teal-50 font-medium text-teal-800" : "text-slate-600 hover:bg-slate-50"}`}>
                {x.term}
              </button>
            ))}
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-slate-700">
            <p className="text-sm font-semibold text-slate-900">{t.term}</p>
            <p>{t.what}</p>
            <p><span className="font-medium text-slate-900">Why it exists. </span>{t.why}</p>
            {t.how && <p><span className="font-medium text-slate-900">Choosing it. </span>{t.how}</p>}
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-[11px] text-teal-700 hover:underline">Show the glossary</button>
      )}
    </Card>
  );
}
