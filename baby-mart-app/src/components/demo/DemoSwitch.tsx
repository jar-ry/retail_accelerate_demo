"use client";

/** The demo mode on/off switch (sidebar footer and /demo). */
export function DemoSwitch({ on, onChange, label = "Demo mode" }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}
