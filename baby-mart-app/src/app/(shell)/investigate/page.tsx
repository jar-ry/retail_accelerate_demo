"use client";

import { useEffect } from "react";

// ─── /investigate: merged into the Category Agent ────────────────────────────
//
// The Brand Investigator used to have its own page beside the Category Agent;
// both took "why is <brand> down?" and only this one answered it correctly. The
// Category Agent (/agent) now routes a brand's root cause to the investigator, so
// this route only forwards older links, keeping the question and forcing the
// investigation route. A full-page replace because the SPCS ingress blocks
// Next's client-side navigation anyway.

export default function BrandInvestigateRedirect() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    window.location.replace(`/agent?mode=investigate${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  }, []);
  return <div className="p-6 text-sm text-slate-500">Opening the Category Agent…</div>;
}
