// ─── Head of Planning: Overview ───────────────────────────────────────────────

import { batch } from "../db";
import { SQL_KPI, SQL_ATTENTION, SQL_TRACKING } from "../sql";

export async function getOverview() {
  const [kpi, attention, tracking] = await batch([SQL_KPI, SQL_ATTENTION, SQL_TRACKING]);
  return { kpi: kpi[0] ?? {}, attention, tracking };
}
