// ─── Head of Planning: formatting ─────────────────────────────────────────────
//
// Rates arrive as decimals (0.0432) and render as percentages; a difference
// between two rates renders in points. The Global Planning pages use whole-number
// percentages instead, which is why this is a separate module rather than a reuse
// of planning/_components/ui.tsx: mixing the two conventions is how 4.3% becomes
// 430%.

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Full-precision dollars, for cells a planner edits or reconciles. */
export function aud(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Compact dollars for headline tiles: $90.3M. */
export function audM(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return aud(n);
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A decimal rate as a percentage: 0.0432 -> 4.3%. */
export function pct(n: number | null | undefined, digits = 1, signed = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = n * 100;
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** The difference between two rates, in points: 0.031 -> +3.1 pts. */
export function pts(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = n * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)} pts`;
}

/** Weeks of cover. */
export function wks(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)} wks`;
}

/** Green for favourable, red for unfavourable. More is not always better, hence invert. */
export function varianceColor(n: number | null | undefined, invert = false): string {
  if (n === null || n === undefined || Number.isNaN(n) || Math.abs(n) < 1e-9) return "text-slate-500";
  const good = invert ? n < 0 : n > 0;
  return good ? "text-emerald-700" : "text-red-600";
}

/** Snowflake DATE/TIMESTAMP values arrive as Date objects from the Node driver. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

export function isoDateTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}[ T]/.test(s) ? s.slice(0, 16).replace("T", " ") : s;
}

/** "2026-11-29" -> "29 Nov". */
export function shortDate(v: unknown): string {
  const s = isoDate(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s ?? "—";
  const [, m, d] = s.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}
