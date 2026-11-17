// ─── Campaign & CRM: schema (server only) ────────────────────────────────────
//
// The campaign model lives in its own schema, ONEDIGITAL_DEMO.CAMPAIGN (sql/od_40-45),
// so nothing else is touched. Interpolated into every query in
// ./sql.ts, so it must never carry user input: it is an operator setting.
// Snowhouse: CAMPAIGN_SCHEMA=TEMP.JARCHEN_OD_CAMPAIGN (see app.yml).

import { DB } from "@/lib/snowflake";

export const S = process.env.CAMPAIGN_SCHEMA?.trim() || `${DB}.CAMPAIGN`;
