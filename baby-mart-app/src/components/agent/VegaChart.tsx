"use client";

import { useEffect, useRef } from "react";

// Agent charts are Vega-Lite specs from data_to_chart. Themed to the campaign
// pages (light, amber first); vega-embed is loaded only when a chart appears.

const CONFIG = {
  background: "transparent",
  font: "Inter, ui-sans-serif, system-ui",
  view: { stroke: "transparent" },
  axis: { labelColor: "#64748B", titleColor: "#64748B", gridColor: "#F1F5F9", domainColor: "#E2E8F0", tickColor: "#E2E8F0", labelFontSize: 11, titleFontSize: 11 },
  legend: { labelColor: "#334155", titleColor: "#64748B", labelFontSize: 11 },
  title: { color: "#0F172A", fontSize: 12, fontWeight: 600, anchor: "start" },
  range: { category: ["#D97706", "#0F766E", "#6366F1", "#DC2626", "#0284C7", "#A21CAF", "#65A30D"] },
  mark: { color: "#D97706" },
  bar: { cornerRadiusEnd: 2 },
  line: { strokeWidth: 2 },
};

export function chartTitle(spec: string): string | null {
  try {
    const t = JSON.parse(spec).title;
    return typeof t === "string" ? t : t?.text ?? null;
  } catch {
    return null;
  }
}

export default function VegaChart({ spec }: { spec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    const el = ref.current;
    if (!el) return;
    let s: Record<string, unknown>;
    try {
      s = JSON.parse(spec);
    } catch {
      el.textContent = "The chart could not be read.";
      return;
    }
    delete s.config;
    delete s.background;
    delete s.title; // shown as the card title instead
    s.width = "container";
    s.height = typeof s.height === "number" && s.height < 320 ? s.height : 220;
    s.autosize = { type: "fit", contains: "padding" };
    import("vega-embed")
      .then(({ default: embed }) => (cancelled ? null : embed(el, s as never, { actions: false, renderer: "svg", config: CONFIG as never })))
      .then((r) => { if (r) view = r.view; })
      .catch((e) => { if (el) el.textContent = `The chart could not render: ${e.message}`; });
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);
  return <div ref={ref} className="w-full text-xs text-slate-500" />;
}
