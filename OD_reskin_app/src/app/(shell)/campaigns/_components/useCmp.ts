"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// ─── Data access for the Campaign & CRM pages ─────────────────────────────────
//
// The Head of Planning pattern: GET through react-query, POST through
// useCmpAction, which invalidates every /cmp query on success so each page
// re-reads the data rather than patching numbers in the browser.

export type Row = Record<string, unknown>;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as T;
}

export function useCmp<T>(path: string, params?: Record<string, string | number | null | undefined>, enabled = true) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const url = `/api/cmp/${path}${qs.toString() ? `?${qs}` : ""}`;
  return useQuery({ queryKey: ["cmp", path, params ?? {}], queryFn: () => getJson<T>(url), staleTime: 30_000, enabled });
}

export function useCmpAction<T = Row>(path: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (body: unknown, opts?: { invalidate?: boolean }): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> => {
      setBusy(true);
      try {
        const r = await fetch(`/api/cmp/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || json?.error) return { ok: false, error: String(json?.error ?? `HTTP ${r.status}`), status: r.status };
        if (opts?.invalidate !== false) await qc.invalidateQueries({ queryKey: ["cmp"] });
        return { ok: true, data: json as T };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Request failed", status: 0 };
      } finally {
        setBusy(false);
      }
    },
    [path, qc],
  );
  return { run, busy };
}

export function parse<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}
