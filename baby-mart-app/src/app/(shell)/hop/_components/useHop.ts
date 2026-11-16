"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

// ─── Data access for the Head of Planning pages ───────────────────────────────
//
// GET through react-query (the shell provides the client); POST through
// useHopAction, which invalidates every /hop query on success so the page
// re-reads the views rather than patching numbers in the browser.

export type Row = Record<string, unknown>;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as T;
}

export function useHop<T>(path: string, params?: Record<string, string | number | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const url = `/api/hop/${path}${qs.toString() ? `?${qs}` : ""}`;
  return useQuery({ queryKey: ["hop", path, params ?? {}], queryFn: () => getJson<T>(url), staleTime: 30_000 });
}

export function useHopAction<T = Row>(path: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> => {
      setBusy(true);
      try {
        const r = await fetch(`/api/hop/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || json?.error) return { ok: false, error: String(json?.error ?? `HTTP ${r.status}`), status: r.status };
        await qc.invalidateQueries({ queryKey: ["hop"] });
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

export type Ownership = {
  surface: string;
  measureCode: string;
  measureLabel: string;
  editClass: string;
  owningParty: string;
  editableInApp: boolean;
  lockBehaviour: string;
  requiresRationale: boolean;
  ownershipHint: string;
  cellTreatment: string;
  isInferred: boolean;
  evidence: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

/** The registry rows arrive raw from SQL on page payloads; map them once. */
export function ownershipMap(rows: Row[] | undefined): Map<string, Ownership> {
  const m = new Map<string, Ownership>();
  for (const r of rows ?? []) {
    m.set(String(r.MEASURE_CODE), {
      surface: String(r.SURFACE),
      measureCode: String(r.MEASURE_CODE),
      measureLabel: String(r.MEASURE_LABEL ?? r.MEASURE_CODE),
      editClass: String(r.EDIT_CLASS),
      owningParty: String(r.OWNING_PARTY),
      editableInApp: r.EDITABLE_IN_APP === true,
      lockBehaviour: String(r.LOCK_BEHAVIOUR),
      requiresRationale: r.REQUIRES_RATIONALE === true,
      ownershipHint: String(r.OWNERSHIP_HINT ?? ""),
      cellTreatment: String(r.CELL_TREATMENT),
      isInferred: r.IS_INFERRED === true,
      evidence: r.EVIDENCE == null ? null : String(r.EVIDENCE),
      confirmedBy: r.CONFIRMED_BY == null ? null : String(r.CONFIRMED_BY),
      confirmedAt: r.CONFIRMED_AT == null ? null : String(r.CONFIRMED_AT),
    });
  }
  return m;
}
