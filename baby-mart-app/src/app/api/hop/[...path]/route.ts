import { NextRequest, NextResponse } from "next/server";
import { HopError } from "@/lib/hop/db";
import { sessionUser } from "@/lib/hop/session";
import { getOverview } from "@/lib/hop/handlers/overview";
import { getStorePlan, postStorePlan } from "@/lib/hop/handlers/store-plan";
import { getMfp, postMfp } from "@/lib/hop/handlers/mfp";
import { getWssi, postWssi } from "@/lib/hop/handlers/wssi";
import { getTpr, getApprove, postApprove, getOwnership, postOwnership, getSettings, postSettings } from "@/lib/hop/handlers/governance";
import { getInsight, generateInsight } from "@/lib/hop/handlers/insights";
import { postStoreAssist } from "@/lib/hop/handlers/store-assist";

// ─── Head of Planning API ─────────────────────────────────────────────────────
//
// One catch-all route for the /hop pages, dispatching to a handler module per
// surface in src/lib/hop/handlers. Page reads live in src/lib/hop/sql.ts, where
// scripts/verify_hop.py runs every one; writes sit with the handler that owns them.
//
// Errors come back as JSON {error} with the status the handler chose -- 403 for
// an ownership refusal, 409 for a stale cell, 423 for a frozen measure -- rather
// than Next's HTML 500, which the client cannot parse and which would show as an
// endless spinner instead of the reason.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> | { path: string[] } };

const GETS: Record<string, (req: NextRequest) => Promise<unknown>> = {
  overview: () => getOverview(),
  "store-plan": (req) => {
    const id = Number(req.nextUrl.searchParams.get("scenarioId") ?? 0);
    return getStorePlan(Number.isFinite(id) && id > 0 ? id : null);
  },
  mfp: () => getMfp(),
  wssi: (req) => getWssi(req.nextUrl.searchParams.get("grain"), req.nextUrl.searchParams.get("rbu")),
  tpr: () => getTpr(),
  approve: () => getApprove(),
  ownership: () => getOwnership(),
  settings: () => getSettings(),
  insights: (req) => getInsight(req.nextUrl.searchParams.get("surface")),
};

const POSTS: Record<string, (body: unknown, user: string) => Promise<unknown>> = {
  "store-plan": postStorePlan,
  mfp: postMfp,
  wssi: (body, user) => postWssi(body as Record<string, unknown>, user),
  approve: postApprove,
  ownership: postOwnership,
  settings: postSettings,
  insights: (body, user) => generateInsight(body as { surface?: string; question?: string | null }, user),
  "store-assist": (body, user) => postStoreAssist(body as Parameters<typeof postStoreAssist>[0], user),
};

function fail(e: unknown, where: string) {
  if (e instanceof HopError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(new Date().toISOString(), `[api/hop/${where}] failed`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: 500 });
}

/** The handler for a path, from the map's own keys: a plain lookup would also
 *  answer "constructor" or "toString" with whatever Object.prototype holds. */
function route<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const key = path.join("/");
  const handler = route(GETS, key);
  if (!handler) return NextResponse.json({ error: `No Head of Planning endpoint '${key}'` }, { status: 404 });
  try {
    return NextResponse.json(await handler(request));
  } catch (e) {
    return fail(e, key);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const key = path.join("/");
  const handler = route(POSTS, key);
  if (!handler) return NextResponse.json({ error: `No Head of Planning endpoint '${key}'` }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }
  try {
    return NextResponse.json(await handler(body, sessionUser(request)));
  } catch (e) {
    return fail(e, key);
  }
}
