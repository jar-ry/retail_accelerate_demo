"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// ─── Data access for the NPS Analyst pages ────────────────────────────────────
//
// The Campaign & CRM pattern: GET through react-query, POST through
// useSentimentAction, which invalidates every /sentiment query on success.

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as T;
}

export function useSentiment<T>(path: string, params?: Record<string, string | number | null | undefined>, enabled = true) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const url = `/api/sentiment/${path}${qs.toString() ? `?${qs}` : ""}`;
  return useQuery({ queryKey: ["sentiment", path, params ?? {}], queryFn: () => getJson<T>(url), staleTime: 5 * 60_000, enabled });
}

export function useSentimentAction<T = Record<string, unknown>>(path: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    setBusy(true);
    try {
      const r = await fetch(`/api/sentiment/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok || json?.error) return { ok: false, error: String(json?.error ?? `HTTP ${r.status}`) };
      await qc.invalidateQueries({ queryKey: ["sentiment"] });
      return { ok: true, data: json as T };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
    } finally {
      setBusy(false);
    }
  }, [path, qc]);
  return { run, busy };
}

/** Query parameters, read once from window.location so a page needs no Suspense
 *  boundary (the shell's convention; see AppShell). */
export function urlParam(k: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(k);
}
