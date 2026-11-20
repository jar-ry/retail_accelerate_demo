"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, Check, Clock, ExternalLink, Link2, ListChecks, Mic, MousePointerClick, Play, Presentation, Snowflake, X,
} from "lucide-react";
import { useDemoMode } from "@/lib/demo/demo-mode";
import { DemoSwitch } from "@/components/demo/DemoSwitch";
import { DEMO_TRACKS, stepHref, trackById, type DemoPersona, type DemoTrack } from "@/lib/demo/tracks";

// ─── /demo: the talk track for each persona ──────────────────────────────────
//
// One story per persona, each opening "Imagine you wake up tomorrow and ...",
// then the route through the app with what to show, say and click. Present
// turns on demo mode and opens the first step; the presenter guide
// (components/demo/DemoGuide.tsx) then follows the presenter page to page.
// ?persona= picks the track (the guide's "Talk tracks" link sends it).

// Literal classes per persona: Tailwind cannot see dynamically built names.
const TONE: Record<DemoPersona, { chip: string; ring: string; dot: string; soft: string }> = {
  category: { chip: "bg-blue-100 text-blue-800", ring: "ring-blue-500 border-blue-300", dot: "bg-blue-600", soft: "bg-blue-50" },
  supply: { chip: "bg-emerald-100 text-emerald-800", ring: "ring-emerald-500 border-emerald-300", dot: "bg-emerald-600", soft: "bg-emerald-50" },
  planning: { chip: "bg-violet-100 text-violet-800", ring: "ring-violet-500 border-violet-300", dot: "bg-violet-600", soft: "bg-violet-50" },
  hop: { chip: "bg-teal-100 text-teal-800", ring: "ring-teal-500 border-teal-300", dot: "bg-teal-600", soft: "bg-teal-50" },
  campaign: { chip: "bg-amber-100 text-amber-800", ring: "ring-amber-500 border-amber-300", dot: "bg-amber-600", soft: "bg-amber-50" },
  nps: { chip: "bg-rose-100 text-rose-800", ring: "ring-rose-500 border-rose-300", dot: "bg-rose-600", soft: "bg-rose-50" },
};

export default function DemoPage() {
  const demo = useDemoMode();
  const [id, setId] = useState<DemoPersona>("category");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("persona");
    if (trackById(p)) setId(p as DemoPersona);
  }, []);
  const track = trackById(id)!;

  const pick = (p: DemoPersona) => {
    setId(p);
    window.history.replaceState(null, "", `/demo?persona=${p}`);
  };
  const present = (t: DemoTrack, step = 0) => {
    demo.present(t.id, step);
    window.location.href = stepHref(t, t.steps[step]);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center"><Presentation className="w-5 h-5 text-amber-300" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Demo talk tracks</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              One morning at Baby Mart, six desks. Each track is a story you take one persona through, step by step.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-xs text-slate-600">Demo mode</span>
          <DemoSwitch on={demo.on} onChange={demo.setOn} />
          <span className={`text-[11px] font-medium ${demo.on ? "text-emerald-700" : "text-slate-400"}`}>
            {demo.on ? `On${demo.track ? ` · ${trackById(demo.track)?.role}` : ""}` : "Off"}
          </span>
        </div>
      </div>

      {/* The six stories as one morning: the tracks share a data story, so a
          presenter can hand off from one persona to the next. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEMO_TRACKS.map((t) => {
          const tone = TONE[t.id];
          const active = t.id === id;
          return (
            <button key={t.id} onClick={() => pick(t.id)}
              className={`text-left rounded-xl border bg-white p-4 shadow-sm transition hover:shadow ${active ? `ring-2 ${tone.ring}` : "border-slate-200"}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${tone.chip}`}>{t.role}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400"><Clock className="w-3 h-3" />{t.minutes} min</span>
              </div>
              <p className="mt-2 text-xs text-slate-600 line-clamp-3">{t.hook}</p>
            </button>
          );
        })}
      </div>

      <TrackView track={track} onPresent={present} presenting={demo.on && demo.track === track.id ? demo.step : null} />
    </div>
  );
}

function TrackView({ track, onPresent, presenting }: {
  track: DemoTrack; onPresent: (t: DemoTrack, step?: number) => void; presenting: number | null;
}) {
  const tone = TONE[track.id];
  return (
    <div className="space-y-5">
      <div className={`rounded-xl border border-slate-200 ${tone.soft} p-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${tone.chip}`}>{track.role}</span>
          <span className="text-[11px] text-slate-500">{track.steps.length} steps · about {track.minutes} minutes</span>
          <button onClick={() => onPresent(track)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <Play className="w-4 h-4" /> Present this track
          </button>
        </div>
        <p className="mt-4 text-lg leading-relaxed text-slate-900 font-medium">&ldquo;{track.hook}&rdquo;</p>
        <p className="mt-3 text-sm text-slate-600">{track.stakes}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Today, without it</h3>
          <ul className="mt-2 space-y-1.5">
            {track.today.map((s) => (
              <li key={s} className="flex gap-2 text-sm text-slate-600"><X className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />{s}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Tomorrow, on Snowflake</h3>
          <ul className="mt-2 space-y-1.5">
            {track.withIt.map((s) => (
              <li key={s} className="flex gap-2 text-sm text-slate-700"><Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />{s}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800">The flow</h3>
        <ol className="mt-4 space-y-0">
          {track.steps.map((s, n) => (
            <li key={n} className="relative flex gap-4 pb-6 last:pb-0">
              {n < track.steps.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200" />}
              <span className={`relative z-10 mt-0.5 h-7 w-7 shrink-0 rounded-full ${tone.dot} text-white text-xs font-bold flex items-center justify-center ${presenting === n ? "ring-4 ring-amber-300" : ""}`}>{n + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">{s.title}</h4>
                  <code className="text-[10px] text-slate-400 truncate max-w-xs">{s.route.split("?")[0]}</code>
                  <span className="ml-auto flex gap-2">
                    <a href={stepHref(track, s)} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                    <button onClick={() => onPresent(track, n)} className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline">
                      <Play className="w-3 h-3" /> Present from here
                    </button>
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-slate-600">{s.show}</p>
                <p className="mt-2 flex gap-2 text-[13px] text-slate-800">
                  <Mic className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                  <span className="italic">&ldquo;{s.say}&rdquo;</span>
                </p>
                {s.proof?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.proof.map((p) => <span key={p} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{p}</span>)}
                  </div>
                ) : null}
                {s.click && (
                  <p className="mt-2 flex gap-2 text-[12px] text-slate-500">
                    <MousePointerClick className="w-3.5 h-3.5 mt-0.5 shrink-0" />{s.click}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Close</h3>
        <p className="mt-1.5 text-sm text-emerald-950">{track.close}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><Snowflake className="w-3.5 h-3.5" /> What it shows</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {track.snowflake.map((s) => <span key={s} className="rounded-full bg-sky-50 border border-sky-100 px-2 py-0.5 text-[11px] text-sky-800">{s}</span>)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><ListChecks className="w-3.5 h-3.5" /> Before you present</h3>
          <ul className="mt-2 space-y-1.5 list-disc pl-4">
            {track.prep.map((s) => <li key={s} className="text-[12px] text-slate-600">{s}</li>)}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><Link2 className="w-3.5 h-3.5" /> Hand-off</h3>
          {track.connects ? (
            <p className="mt-2 text-[12px] text-slate-600">{track.connects}</p>
          ) : (
            <p className="mt-2 text-[12px] text-slate-400">Stands alone. Amounts on these pages are in PHP; every other persona uses AUD.</p>
          )}
          <a href={`/demo?persona=${nextTrack(track.id)}`} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-blue-700 hover:underline">
            Next desk: {trackById(nextTrack(track.id))?.role} <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** The track after this one, wrapping round. */
const nextTrack = (id: DemoPersona): DemoPersona => {
  const i = DEMO_TRACKS.findIndex((t) => t.id === id);
  return DEMO_TRACKS[(i + 1) % DEMO_TRACKS.length].id;
};
