// ─── NPS Analyst: schema (server only) ──────────────────────────────────────
//
// Customer sentiment health lives in its own schema, BABY_MART_DEMO.SENTIMENT
// (sql/50-52), over the customer voice the campaign schema holds. Interpolated
// into every query in ./handlers.ts, so it must never carry user input: it is an
// operator setting. Snowhouse: SENTIMENT_SCHEMA=TEMP.JARCHEN_SENTIMENT (app.yml).

import { DB } from "@/lib/snowflake";

export const S = process.env.SENTIMENT_SCHEMA?.trim() || `${DB}.SENTIMENT`;
