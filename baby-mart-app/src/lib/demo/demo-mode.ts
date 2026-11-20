"use client";

import { useCallback, useEffect, useState } from "react";
import type { DemoPersona } from "./tracks";

// ─── Demo mode: on/off, the track being presented, and its step ──────────────
//
// Kept in localStorage, not React state: the SPCS ingress turns every internal
// link into a full page reload, so anything held in memory is gone on the next
// click. A change is broadcast on a window event so the sidebar toggle, the
// /demo page and the presenter guide stay in step within one page, and the
// storage event covers other tabs.

const KEY = "bm.demo.v1";
const EVENT = "bm-demo-change";

export type DemoState = { on: boolean; track: DemoPersona | null; step: number; collapsed: boolean };
const OFF: DemoState = { on: false, track: null, step: 0, collapsed: false };

function read(): DemoState {
  if (typeof window === "undefined") return OFF;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return v && typeof v === "object" ? { ...OFF, ...v } : OFF;
  } catch {
    return OFF;
  }
}

function write(next: DemoState) {
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: in-page only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function useDemoMode() {
  // OFF on the server and on the first client render, then the stored state:
  // reading localStorage during render would not match the prerendered HTML.
  const [state, setState] = useState<DemoState>(OFF);
  useEffect(() => {
    setState(read());
    const sync = () => setState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const update = useCallback((patch: Partial<DemoState>) => write({ ...read(), ...patch }), []);
  return {
    ...state,
    setOn: (on: boolean) => update({ on }),
    present: (track: DemoPersona, step = 0) => update({ on: true, track, step, collapsed: false }),
    goTo: (step: number) => update({ step }),
    setCollapsed: (collapsed: boolean) => update({ collapsed }),
  };
}
