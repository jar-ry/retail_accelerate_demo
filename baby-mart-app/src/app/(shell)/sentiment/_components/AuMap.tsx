"use client";

import { useMemo, useState } from "react";
import geo from "@/lib/sentiment/au-states.json";
import { npsColor, fmt } from "./ui";

// ─── Australia by state, as SVG ──────────────────────────────────────────────
//
// The reference build's state outlines (au-states.json, [lon, lat] MultiPolygons
// keyed by properties.code), drawn with a Mercator projection by hand so the page
// carries no map library. Paths are projected once; focusing a state re-fits a
// CSS transform on the group, so the zoom animates and strokes stay one pixel.

type Ring = [number, number][];
type Feature = { properties: { code: string; name: string }; geometry: { coordinates: Ring[][] } };
const FEATURES = (geo as unknown as { features: Feature[] }).features;

const W = 760, H = 620, PAD = 24;
const K = 1000; // raw Mercator units are radians; scale up for path precision
const project = (lon: number, lat: number): [number, number] => [
  ((lon * Math.PI) / 180) * K,
  -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * K,
];

type Box = [number, number, number, number];
const boxOf = (pts: [number, number][]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);

const SHAPES = FEATURES.map((f) => {
  const polys = f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => project(lon, lat))));
  const d = polys.map((poly) => poly.map((ring) => "M" + ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z").join("")).join("");
  // The state's own extent and label point, from its larger polygons only: an
  // offshore island (Lord Howe for NSW) would otherwise pull the zoom out to sea.
  const outer = polys.map((p) => ({ pts: p[0], box: boxOf(p[0]) }));
  const biggest = Math.max(...outer.map((o) => area(o.box)));
  const main = outer.filter((o) => area(o.box) >= biggest * 0.02);
  const box = boxOf(main.flatMap((o) => o.pts));
  const core = outer.find((o) => area(o.box) === biggest)!;
  const c: [number, number] = [core.pts.reduce((a, p) => a + p[0], 0) / core.pts.length, core.pts.reduce((a, p) => a + p[1], 0) / core.pts.length];
  return { code: f.properties.code, name: f.properties.name, d, box, centroid: c };
});
const ALL_BOX = boxOf(SHAPES.flatMap((s) => [[s.box[0], s.box[1]], [s.box[2], s.box[3]]] as [number, number][]));
const LABEL_NUDGE: Record<string, [number, number]> = { ACT: [26, 6], TAS: [0, 26], VIC: [0, 4], NSW: [8, 0] };

function fit(b: Box) {
  const k = Math.min((W - 2 * PAD) / (b[2] - b[0]), (H - 2 * PAD) / (b[3] - b[1]));
  const tx = (W - k * (b[2] - b[0])) / 2 - k * b[0], ty = (H - k * (b[3] - b[1])) / 2 - k * b[1];
  return { k, tx, ty };
}

export type MapState = { state: string; nps: number | null; baseline: number | null; change: number | null; responses: number; lowSample: boolean; oos: number; detractorRate: number | null; topTheme?: { theme: string; mentions: number } | null };
export type MapStore = { code: string; name: string; suburb: string; lat: number; lon: number; nps: number | null; baseline: number | null; change: number | null; responses: number; oos: number; shortBrands: string | null };

export function AuMap({ states, focus, onFocus, stores, onStore }: {
  states: MapState[]; focus: string | null; onFocus: (s: string | null) => void; stores?: MapStore[]; onStore?: (code: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byCode = useMemo(() => new Map(states.map((s) => [s.state, s])), [states]);
  const target = focus ? SHAPES.find((s) => s.code === focus)?.box ?? ALL_BOX : ALL_BOX;
  const { k, tx, ty } = fit(target);
  const screen = ([x, y]: [number, number]): [number, number] => [x * k + tx, y * k + ty];
  const hov = hover ? byCode.get(hover) : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[520px]" role="img" aria-label="NPS by state">
        <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={12} onClick={() => onFocus(null)} />
        <g style={{ transform: `matrix(${k},0,0,${k},${tx},${ty})`, transition: "transform 0.6s ease" }}>
          {SHAPES.map((s) => {
            const st = byCode.get(s.code);
            const dim = focus && focus !== s.code;
            return (
              <path key={s.code} d={s.d}
                fill={st && !st.lowSample ? npsColor(st.nps) : "#e2e8f0"}
                fillOpacity={dim ? 0.25 : focus ? 0.45 : st?.lowSample ? 0.6 : 0.9}
                stroke={hover === s.code ? "#0f172a" : "#ffffff"} strokeWidth={hover === s.code ? 2 : 1.2}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer", transition: "fill 0.5s, fill-opacity 0.4s" }}
                onMouseEnter={() => setHover(s.code)} onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); onFocus(focus === s.code ? null : s.code); }}>
                <title>{s.name}</title>
              </path>
            );
          })}
        </g>
        {!focus && SHAPES.map((s) => {
          const st = byCode.get(s.code);
          const [x, y] = screen(s.centroid);
          const [dx, dy] = LABEL_NUDGE[s.code] ?? [0, 0];
          return (
            <g key={s.code} transform={`translate(${x + dx},${y + dy})`} style={{ pointerEvents: "none" }}>
              <text textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a" stroke="#fff" strokeWidth={3} paintOrder="stroke">{s.code}</text>
              <text textAnchor="middle" y={15} fontSize={12} fontWeight={600} fill="#0f172a" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                {st ? (st.lowSample ? `${fmt(st.nps, 0)}*` : fmt(st.nps, 0)) : ""}
              </text>
            </g>
          );
        })}
        {focus && stores?.filter((s) => s.lat && s.lon).map((s) => {
          const [x, y] = screen(project(s.lon, s.lat));
          const r = 5 + Math.sqrt(Math.max(s.responses, 0)) * 1.5;
          return (
            <g key={s.code} transform={`translate(${x},${y})`} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onStore?.(s.code); }}>
              <circle r={r + 4} fill={npsColor(s.nps)} opacity={0.18} />
              <circle r={r} fill={npsColor(s.nps)} stroke="#0f172a" strokeWidth={s.shortBrands ? 2 : 0.8} />
              <title>{`${s.name}\nNPS ${fmt(s.nps, 0)} (was ${fmt(s.baseline, 0)}) on ${s.responses} surveys\n${s.oos} out-of-stock complaints${s.shortBrands ? `\nShort: ${s.shortBrands}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      {hov && !focus && (
        <div className="absolute right-3 top-3 w-60 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-lg">
          <div className="font-semibold text-slate-900">{SHAPES.find((s) => s.code === hov.state)?.name}</div>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-0.5 text-slate-600">
            <dt>NPS</dt><dd className="text-right font-mono text-slate-900">{fmt(hov.nps)}</dd>
            <dt>Baseline</dt><dd className="text-right font-mono">{fmt(hov.baseline)}</dd>
            <dt>Change</dt><dd className={`text-right font-mono ${(hov.change ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmt(hov.change)} pts</dd>
            <dt>Surveys</dt><dd className="text-right font-mono">{hov.responses}{hov.lowSample ? " (low)" : ""}</dd>
            <dt>Detractor rate</dt><dd className="text-right font-mono">{fmt(hov.detractorRate)}%</dd>
            <dt>Out-of-stock complaints</dt><dd className="text-right font-mono">{hov.oos}</dd>
          </dl>
          {hov.topTheme && <div className="mt-2 text-[11px] text-slate-500">Top complaint: <span className="font-medium text-slate-700">{hov.topTheme.theme}</span> ({hov.topTheme.mentions})</div>}
          <div className="mt-2 text-[10px] text-rose-700">Click to see its stores →</div>
        </div>
      )}
    </div>
  );
}
