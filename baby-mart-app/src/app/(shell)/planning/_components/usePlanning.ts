"use client";

import { useCallback, useEffect, useState } from "react";
import type { Currency } from "./ui";

// ─── Data fetching for the Global Planning pages ───────────────────────────────

/** GET a planning endpoint, refetching when the currency changes.
 *
 *  The API returns {error} as JSON on failure rather than an HTML 500, so a
 *  failed query surfaces as a readable message instead of an endless spinner --
 *  the failure mode that made the vendor pages look broken. This hook keeps that
 *  contract by treating a body-level `error` as a failure.
 */
export function usePlanningData<T>(path: string | null, currency: Currency) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/planning/${path}?currency=${currency}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body && body.error) {
          setError(String(body.error));
          setData(null);
        } else {
          setData(body as T);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Guard against a slow first response overwriting a newer one after the
    // user flips currency twice quickly.
    return () => {
      cancelled = true;
    };
  }, [path, currency]);

  return { data, error, loading };
}

/** POST helper for the insight and scenario endpoints, which are actions rather
 *  than page loads and so are triggered explicitly. */
export function usePlanningAction<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (body: unknown) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/planning/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (json && json.error) {
          setError(String(json.error));
          setData(null);
        } else {
          setData(json as T);
        }
        return json;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Request failed");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [path]
  );

  return { data, error, loading, run };
}

// ─── Shared response types ────────────────────────────────────────────────────

export type MfpRow = {
  department: string | null;
  departmentCode: string | null;
  class: string | null;
  classCode: string | null;
  planLevel: string;
  lflStrategy: string | null;
  salesF26: number;
  salesLy: number;
  salesBud: number;
  salesFc: number;
  netSalesFc: number;
  varToBud: number;
  varToBudPct: number | null;
  lflGrowthPct: number | null;
  totalGrowthPct: number | null;
  unitsFc: number;
  unitGrowthPct: number | null;
  aspFc: number;
  aspLy: number;
  gpFc: number;
  gpPctFc: number | null;
  gpPctBud: number | null;
  gpGapPp: number | null;
  optTotal: number;
  optNew: number;
  optOngoing: number;
  optDeselected: number;
  optNewPct: number | null;
  mixPct: number | null;
};

export type TrendPoint = {
  periodCode: string;
  month: string;
  periodType: string;
  salesLy: number;
  salesBud: number;
  salesMrch: number;
  salesFc: number;
};

export type OtbRow = {
  department: string | null;
  departmentCode: string | null;
  class: string | null;
  classCode: string | null;
  planLevel: string;
  asAtWeek: string | null;
  buyStatus: string;
  coverWeeks: number;
  targetCoverWeeks: number;
  stockUnits: number;
  onOrderUnits: number;
  stock: number;
  onOrder: number;
  otbAvailable: number;
  otbPlanned: number;
  horizonSales: number;
  horizonMarkdown: number;
};

export type OtbWeek = {
  weekEnding: string;
  periodCode: string;
  sales: number;
  receipts: number;
  markdown: number;
  closingStock: number;
  onOrder: number;
  otbAvailable: number;
  coverWeeks: number;
};

export type PurchaseOrder = {
  poNumber: string;
  supplierName: string;
  sourcingCountry: string;
  class: string | null;
  orderDate: string;
  etaDate: string;
  originalEtaDate: string;
  etaSlipDays: number;
  committedUnits: number;
  committed: number;
  status: string;
};

export type PlanningException = {
  type: string;
  severity: string;
  planLevel: string;
  node: string;
  department: string | null;
  class: string | null;
  metric: string;
  variancePct: number | null;
  variancePhp: number | null;
  headline: string;
};

export type PlanningInsights = {
  level: string;
  node: string;
  scenario: string | null;
  metrics: Record<string, unknown>;
  insights: {
    summary: string;
    risks: { title: string; detail: string; data: string; impact: number }[];
    opportunities: { title: string; detail: string; data: string; impact: number }[];
    // No recommended_actions. The procedure reports findings and the metrics
    // behind them; deciding the action is the planner's job.
    scenario_commentary: string | null;
  };
};
