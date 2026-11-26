"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ChevronsRight, Mic, MousePointerClick, Presentation, X } from "lucide-react";
import { useDemoMode } from "@/lib/demo/demo-mode";
import { stepForPath, stepHref, trackById, type DemoPersona } from "@/lib/demo/tracks";

// ─── Presenter guide: the talk track beside the page, in demo mode ───────────
//
// Docked as a right-hand rail on a wide screen (2xl and up). Below that the page
// layouts use viewport breakpoints, so a docked rail left a wide page laid out
// for the viewport in the space beside it and clipped its right-hand column;
// there it floats as a card above the bottom edge instead, clear of the agent
// pages' input bars, and collapses to a pill. The step follows the page: open a
// page that is in the track and the guide jumps to its step, so a presenter who
// clicks the app's own links (Investigate, Build a recovery plan) never has to
// touch Next.

export function DemoGuide({ persona }: { persona: DemoPersona }) {
  const demo = useDemoMode();
  const pathname = usePathname();
  const track = trackById(demo.track) ?? trackById(persona)!;
  // The query tells apart two steps on one page (/agent: decline, then spike).
  // Only read once demo mode is on, which is client-side only.
  const search = demo.on && typeof window !== "undefined" ? window.location.search : "";
  const onStep = stepForPath(track, pathname, demo.step, search);
  const leaving = useRef(false);
  const i = onStep >= 0 ? onStep : Math.min(demo.step, track.steps.length - 1);
  const step = track.steps[i];
  const last = i === track.steps.length - 1;

  // Keep the stored step on the page being shown, and pin the track the first
  // time demo mode is used from the sidebar toggle.
  useEffect(() => {
    // Next/Back already stored the step and is reloading onto its page: don't
    // re-match the page being left, or the stored step is overwritten.
    if (!demo.on || leaving.current) return;
    if (!demo.track) demo.present(track.id, Math.max(onStep, 0));
    else if (onStep >= 0 && onStep !== demo.step) demo.goTo(onStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.on, demo.track, onStep]);

  if (!demo.on) return null;

  const go = (n: number) => {
    leaving.current = true;
    demo.goTo(n);
    window.location.href = stepHref(track, track.steps[n]);
  };

  if (demo.collapsed) {
    return (
      <button onClick={() => demo.setCollapsed(false)} title="Show the talk track"
        className="fixed right-4 bottom-24 z-40 rounded-full px-3.5 py-2 shadow-xl bg-slate-900 text-white flex items-center gap-2 hover:bg-slate-800
          2xl:static 2xl:rounded-none 2xl:shadow-none 2xl:shrink-0 2xl:w-9 2xl:px-0 2xl:py-0 2xl:pt-4 2xl:flex-col 2xl:gap-3 2xl:border-l 2xl:border-slate-200">
        <Presentation className="w-4 h-4 text-amber-300" />
        <span className="text-[10px] font-semibold tracking-wide 2xl:[writing-mode:vertical-rl] 2xl:rotate-180">
          DEMO · STEP {i + 1}/{track.steps.length}
        </span>
      </button>
    );
  }

  return (
    <aside aria-label="Demo talk track"
      className="fixed right-4 bottom-24 z-40 w-80 max-h-[70vh] rounded-xl overflow-hidden shadow-2xl border border-slate-200 bg-white flex flex-col
        2xl:static 2xl:z-auto 2xl:w-72 2xl:max-h-none 2xl:rounded-none 2xl:shadow-none 2xl:border-y-0 2xl:border-r-0 2xl:shrink-0">
      <div className="px-4 py-3 bg-slate-900 text-white">
        <div className="flex items-center gap-2">
          <Presentation className="w-4 h-4 text-amber-300" />
          <div className="text-[11px] font-semibold uppercase tracking-wide">Demo · {track.role}</div>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => demo.setCollapsed(true)} title="Hide" className="p-1 rounded hover:bg-white/10"><ChevronsRight className="w-3.5 h-3.5" /></button>
            <button onClick={() => demo.setOn(false)} title="Exit demo mode" className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="mt-2 flex gap-1" aria-label={`Step ${i + 1} of ${track.steps.length}`}>
          {track.steps.map((s, n) => (
            <button key={n} onClick={() => go(n)} title={`${n + 1}. ${s.title}`}
              className={`h-1.5 flex-1 rounded-full ${n === i ? "bg-amber-300" : n < i ? "bg-white/60" : "bg-white/20"}`} />
          ))}
        </div>
        <div className="mt-2 text-[11px] text-slate-300">Step {i + 1} of {track.steps.length}</div>
        <div className="text-sm font-semibold leading-snug">{step.title}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[12px] leading-relaxed">
        {i === 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-amber-900 italic">{track.hook}</div>
        )}
        {onStep < 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-600">
            This page isn&apos;t in the talk track.
            <button onClick={() => go(i)} className="mt-1.5 block font-medium text-blue-700 hover:underline">Go to step {i + 1}: {step.title} →</button>
          </div>
        )}
        <Part label="On screen">{step.show}</Part>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><Mic className="w-3 h-3" /> Say</div>
          <p className="mt-1 border-l-2 border-amber-400 pl-2.5 text-slate-800">&ldquo;{step.say}&rdquo;</p>
        </div>
        {step.proof?.length ? (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Figures to quote</div>
            <ul className="mt-1 space-y-1">
              {step.proof.map((p) => <li key={p} className="rounded bg-slate-50 border border-slate-100 px-2 py-1 font-medium text-slate-700">{p}</li>)}
            </ul>
          </div>
        ) : null}
        {step.click && (
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"><MousePointerClick className="w-3 h-3" /> Then</div>
            <p className="mt-1 text-slate-700">{step.click}</p>
          </div>
        )}
        {last && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-900">
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Close</div>
            <p className="mt-1">{track.close}</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-3 flex items-center gap-2">
        <button onClick={() => go(i - 1)} disabled={i === 0}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <a href={`/demo?persona=${track.id}`} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700">
          <BookOpen className="w-3.5 h-3.5" /> Talk tracks
        </a>
        {!last ? (
          <button onClick={() => go(i + 1)}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            title={`Next: ${track.steps[i + 1].title}`}>
            Next <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <a href={`/demo?persona=${track.id}`}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-800">
            Finish <ArrowRight className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </aside>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <p className="mt-1 text-slate-600">{children}</p>
    </div>
  );
}
