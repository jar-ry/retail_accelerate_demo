// ─── Campaign & CRM: schema (server only) ────────────────────────────────────
//
// The campaign model lives in its own schema, BABY_MART_DEMO.CAMPAIGN (sql/40-48),
// so nothing the other personas read is touched. Interpolated into every query in
// ./sql.ts, so it must never carry user input: it is an operator setting.
// Snowhouse: CAMPAIGN_SCHEMA=TEMP.JARCHEN_CAMPAIGN (see app.yml).

import { DB } from "@/lib/snowflake";

export const S = process.env.CAMPAIGN_SCHEMA?.trim() || `${DB}.CAMPAIGN`;
