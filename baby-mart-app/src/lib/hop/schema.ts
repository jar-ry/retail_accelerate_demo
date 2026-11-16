// ─── Head of Planning: schema (server only) ───────────────────────────────────
//
// The planning model lives in its own schema, BABY_MART_DEMO.HEAD_OF_PLANNING,
// because several of its object names (DIM_MERCH_HIERARCHY, PLANNING_SETTING)
// already exist in ANALYTICS with a different shape for the Global Planning tab.
//
// Interpolated into every query in ./sql.ts, so it must never carry user input --
// it is an operator setting. Built from DB so a renamed database still resolves.

import { DB } from "@/lib/snowflake";

export const S = process.env.HOP_SCHEMA?.trim() || `${DB}.HEAD_OF_PLANNING`;
