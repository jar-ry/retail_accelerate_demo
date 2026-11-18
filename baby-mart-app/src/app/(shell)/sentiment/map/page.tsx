"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, ChevronLeft, ArrowRight, Bot } from "lucide-react";
import { useSentiment, urlParam } from "../_components/useSentiment";
import { AuMap, type MapState, type MapStore } from "../_components/AuMap";
import { Card, ErrorState, Loading, StepHeader, Segmented, StepLink, NpsChip, npsColor, NPS_LEGEND, fmt, signed, fmtDate, Pill } from "../_components/ui";

// ─── 2 · Locate: where is sentiment breaking? ───────────────────────────────
//
// NPS by state for the focus week (or the four weeks to it) against the weeks
// before, filtered by the product bought and the member tier. Play runs the
// weeks so a break shows up where it starts. Click a state for its stores
// (always read over four weeks: a store gets about three surveys a week), and a
// store for Store 360. ?state=&week= open it focused (the Pulse banner links here).

type MapData = { asOf: string; weeks: string[]; defaultWeek: string; period: number; minResponses: number; byWeek: Record<string, MapState[]> };
type Stores = { state: string; week: string; windowWeeks: number; window: { from: string; to: string }; stores: (MapStore & { storeType: string; negative: number })[] };

const CATS = ["ALL", "Nappies & Wipes", "Car Seats", "Prams & Strollers", "Feeding", "Clothing"] as const;
const TIERS = ["ALL", "Gold & Platinum", "Silver & Bronze"] as const;
const NAMES: Record<string, string> = { NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", WA: "Western Australia", SA: "South Australia", TAS: "Tasmania", ACT: "Australian Capital Territory", NT: "Northern Territory" };

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${value === o ? "border-rose-300 bg-rose-50 text-rose-800 font-medium" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export default function StateMapPage() {
  const [period, setPeriod] = useState<"1" | "4">("1");
  const [category, setCategory] = useState<(typeof CATS)[number]>("ALL");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ALL");
  const [week, setWeek] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const s = urlParam("state"), w = urlParam("week");
    if (s && NAMES[s]) setFocus(s);
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeek(w);
  }, []);

  const { data, error, isLoading } = useSentiment<MapData>("map", { period, category, tier });
  const wk = data && week && data.byWeek[week] ? week : data?.defaultWeek ?? null;
  const stores = useSentiment<Stores>("map/stores", { state: focus, week: wk, period, category, tier }, !!focus && !!wk);

  useEffect(() => {
    if (!playing || !data) return;
    const t = setInterval(() => {
      setWeek((cur) => {
        const i = data.weeks.indexOf(cur ?? data.defaultWeek);
        return data.weeks[(i + 1) % data.weeks.length];
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, data]);

  const states = useMemo(() => (data && wk ? data.byWeek[wk] ?? [] : []), [data, wk]);
  if (error) return <ErrorState message={String((error as Error).message)} />;
  if (isLoading || !data || !wk) return <Loading what="NPS by state" />;

  const idx = data.weeks.indexOf(wk);
  const ranked = [...states].sort((a, b) => (a.lowSample ? 1 : 0) - (b.lowSample ? 1 : 0) || (a.nps ?? 99) - (b.nps ?? 99));
  const fs = focus ? states.find((s) => s.state === focus) : null;
  const windowLabel = period === "1" ? `week of ${fmtDate(wk)}` : `four weeks to ${fmtDate(wk)}`;

  return (
    <div className="p-6 space-y-4">
      <StepHeader step="2 · Locate" title="Where is sentiment breaking?"
        subtitle={<>Survey NPS by state for the {windowLabel}, against the {period === "1" ? "four" : "eight"} weeks before. Filter by what the customer bought and their member tier; click a state for its stores.</>}
        right={<Segmented value={period} onChange={setPeriod} options={[{ value: "1", label: "Week" }, { value: "4", label: "4 weeks" }]} />} />

      <div className="flex flex-wrap items-center gap-3">
        <Chips value={category} options={CATS} onChange={setCategory} label={(c) => (c === "ALL" ? "All categories" : c)} />
        <span className="h-5 w-px bg-slate-200" />
        <Chips value={tier} options={TIERS} onChange={setTier} label={(t) => (t === "ALL" ? "All members" : t)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <Card bodyClass="p-3">
          <div className="flex items-center gap-3 px-2 pb-2">
            <button onClick={() => setPlaying(!playing)}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800">
              {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} {playing ? "Pause" : "Play"}
            </button>
            <input type="range" min={0} max={data.weeks.length - 1} value={idx} onChange={(e) => { setPlaying(false); setWeek(data.weeks[Number(e.target.value)]); }}
              className="flex-1 accent-rose-600" aria-label="Week" />
            <div className="w-36 text-right text-[11px] text-slate-600">Week of <span className="font-semibold text-slate-900">{fmtDate(wk)}</span></div>
          </div>
          {focus && (
            <div className="flex items-center justify-between px-2 pb-1">
              <button onClick={() => setFocus(null)} className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 hover:underline">
                <ChevronLeft className="w-3 h-3" /> All of Australia
              </button>
              <div className="text-[11px] text-slate-500">Bubbles: stores sized by surveys, coloured by NPS over four weeks; a dark ring = a brand SHORT</div>
            </div>
          )}
          <AuMap states={states} focus={focus} onFocus={setFocus} stores={stores.data?.stores} onStore={(c) => { window.location.href = `/sentiment/store/${c}?week=${wk}`; }} />
          <div className="flex items-center gap-2 px-2 pt-1 text-[10px] text-slate-500">
            NPS
            {NPS_LEGEND.map((v) => <span key={v} className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: npsColor(v) }} />{v}</span>)}
            <span className="ml-2">* fewer than {data.minResponses} surveys (grey)</span>
          </div>
        </Card>

        {!focus ? (
          <Card title="States ranked" subtitle={`Lowest NPS first · ${windowLabel}`} bodyClass="px-3 pb-3 max-h-[640px] overflow-y-auto">
            {ranked.map((s) => (
              <button key={s.state} onClick={() => setFocus(s.state)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                <span className="flex h-8 w-10 items-center justify-center rounded text-[11px] font-bold text-white" style={{ background: s.lowSample ? "#94a3b8" : npsColor(s.nps) }}>{s.state}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800">NPS {fmt(s.nps)}{s.lowSample ? "*" : ""}</div>
                  <div className="truncate text-[11px] text-slate-500">{s.responses} surveys · {s.oos} out-of-stock{s.topTheme ? ` · ${s.topTheme.theme}` : ""}</div>
                </div>
                <span className={`font-mono text-xs ${(s.change ?? 0) <= -10 && !s.lowSample ? "font-semibold text-rose-700" : "text-slate-500"}`}>{signed(s.change)}</span>
              </button>
            ))}
          </Card>
        ) : (
          <Card title={`${NAMES[focus]} stores`} subtitle={stores.data ? `Four weeks to ${fmtDate(wk)} against the eight before · click for Store 360` : "Loading stores…"}
            right={<StepLink href={`/sentiment/investigate?q=${encodeURIComponent(`Why did ${focus} NPS fall in the ${period === "1" ? `week of ${fmtDate(wk)}` : `four weeks to ${fmtDate(wk)}`}?`)}`}><Bot className="w-3.5 h-3.5" /> Investigate {focus}</StepLink>}
            bodyClass="px-3 pb-3 max-h-[640px] overflow-y-auto">
            {fs && (
              <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                {focus} NPS <span className="font-semibold text-slate-900">{fmt(fs.nps)}</span> ({signed(fs.change)} pts) on {fs.responses} surveys in the {windowLabel}; {fs.oos} out-of-stock complaints.
              </div>
            )}
            {stores.error && <div className="text-xs text-rose-700">{String((stores.error as Error).message)}</div>}
            {stores.data?.stores.map((s) => (
              <a key={s.code} href={`/sentiment/store/${s.code}?week=${wk}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                <NpsChip v={s.responses ? s.nps : null} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-800">{s.suburb}</div>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    {s.responses} surveys
                    {s.oos > 0 && <Pill tone="red">{s.oos} out of stock</Pill>}
                    {s.shortBrands && <Pill tone="amber">Short: {s.shortBrands}</Pill>}
                  </div>
                </div>
                <span className={`font-mono text-xs ${(s.change ?? 0) <= -15 ? "font-semibold text-rose-700" : "text-slate-500"}`}>{signed(s.change, 0)}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
              </a>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
