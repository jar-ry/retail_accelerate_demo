import { NextResponse } from "next/server";
import { queryBatch } from "@/lib/snowflake";
import type { Reference } from "@/lib/ontology-compare";

// GET /api/ontology/reference
//
// The right answer to each /ontology preset question, computed here from the
// base tables with Baby Mart's rules applied by hand, so the page can show which
// column got it right. Nothing in it comes from an agent.
//
//   growth        like-for-like revenue growth: FY2026 against the same fiscal
//                 weeks of FY2025 (27-52 and 1-18; POS ends 7 May 2026)
//   huggiesDifot  Huggies FY2026 DIFOT weighted by orders, brand-total rows only
//   redFlag       suppliers whose FY2026 DIFOT (weighted, brand totals) is below 90

const A = "BABY_MART_DEMO.ANALYTICS";
const C = "BABY_MART_DEMO.CURATED";
type Row = Record<string, unknown>;

const GROWTH = `
  WITH lfl AS (
    SELECT BRAND_NAME,
           SUM(IFF(FISCAL_YEAR = 2026, REVENUE, 0)) AS CY,
           SUM(IFF(FISCAL_YEAR = 2025, REVENUE, 0)) AS LY
    FROM ${A}.DT_SELLTHROUGH_WEEKLY
    WHERE FISCAL_YEAR IN (2025, 2026) AND (FISCAL_WEEK BETWEEN 27 AND 52 OR FISCAL_WEEK BETWEEN 1 AND 18)
    GROUP BY 1),
  full_year AS (
    SELECT BRAND_NAME,
           SUM(IFF(FISCAL_YEAR = 2026, REVENUE, 0)) / NULLIF(SUM(IFF(FISCAL_YEAR = 2025, REVENUE, 0)), 0) - 1 AS NAIVE
    FROM ${A}.DT_SELLTHROUGH_WEEKLY GROUP BY 1)
  SELECT l.BRAND_NAME, 100 * (l.CY / NULLIF(l.LY, 0) - 1) AS LFL_PCT, 100 * f.NAIVE AS NAIVE_PCT,
         COUNT_IF(l.CY > l.LY) OVER () AS GROWING
  FROM lfl l JOIN full_year f USING (BRAND_NAME)
  ORDER BY LFL_PCT DESC LIMIT 3`;

const HUGGIES = `
  SELECT SUM(IFF(CLASS IS NULL, DIFOT_PCT * ORDERS_TOTAL, 0)) / NULLIF(SUM(IFF(CLASS IS NULL, ORDERS_TOTAL, 0)), 0) AS DIFOT,
         SUM(IFF(CLASS IS NULL, ORDERS_TOTAL, 0)) AS ORDERS,
         SUM(ORDERS_TOTAL) AS ORDERS_ALL_ROWS
  FROM ${A}.DT_SUPPLIER_DIFOT
  WHERE BRAND_NAME = 'Huggies' AND FISCAL_YEAR = 2026`;

const RED_FLAG = `
  SELECT s.SUPPLIER_NAME, SUM(d.DIFOT_PCT * d.ORDERS_TOTAL) / NULLIF(SUM(d.ORDERS_TOTAL), 0) AS DIFOT
  FROM ${A}.DT_SUPPLIER_DIFOT d
  JOIN ${C}.DIM_BRAND b ON b.BRAND_NAME = d.BRAND_NAME
  JOIN ${C}.DIM_SUPPLIER s ON s.SUPPLIER_KEY = b.SUPPLIER_KEY
  WHERE d.CLASS IS NULL AND d.FISCAL_YEAR = 2026
  GROUP BY 1 HAVING DIFOT < 90 ORDER BY DIFOT`;

const n = (v: unknown) => Number(v);
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export async function GET() {
  try {
    const [growth, huggies, red] = (await queryBatch([{ sql: GROWTH }, { sql: HUGGIES }, { sql: RED_FLAG }])) as Row[][];
    const top = growth[0];
    const h = huggies[0];
    const refs: Reference[] = [
      {
        id: "growth",
        summary: `${top.BRAND_NAME} is growing fastest at ${pct(n(top.LFL_PCT))} like-for-like; ${n(top.GROWING)} of 25 brands grew. `
          + `Compared full year on part year it would read ${pct(n(top.NAIVE_PCT))}.`,
        rule: "Like-for-like Period: fiscal weeks 27-52 and 1-18 of both years",
        expect: [
          { label: String(top.BRAND_NAME), text: String(top.BRAND_NAME) },
          { label: pct(n(top.LFL_PCT)), number: Math.abs(n(top.LFL_PCT)), decimals: 1 },
        ],
      },
      {
        id: "huggiesDifot",
        summary: `Huggies FY2026 DIFOT is ${n(h.DIFOT).toFixed(1)}% on ${n(h.ORDERS).toLocaleString("en-AU")} orders `
          + `(${n(h.ORDERS_ALL_ROWS).toLocaleString("en-AU")} if the class rows are counted too).`,
        rule: "Weighted by orders; brand-total rows only",
        expect: [
          { label: `${n(h.DIFOT).toFixed(1)}%`, number: n(h.DIFOT), decimals: 1 },
          { label: `${n(h.ORDERS).toLocaleString("en-AU")} orders`, number: n(h.ORDERS), decimals: 0 },
        ],
      },
      {
        id: "redFlag",
        summary: `${red.length} suppliers are below 90% DIFOT in FY2026: `
          + red.map((r) => `${r.SUPPLIER_NAME} ${n(r.DIFOT).toFixed(1)}%`).join(", ") + ".",
        rule: "DIFOT Target: below 90% is a red flag (target 96%)",
        expect: red.map((r) => ({ label: String(r.SUPPLIER_NAME), text: String(r.SUPPLIER_NAME) })),
      },
    ];
    return NextResponse.json(refs);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The reference answers could not be computed." }, { status: 500 });
  }
}
