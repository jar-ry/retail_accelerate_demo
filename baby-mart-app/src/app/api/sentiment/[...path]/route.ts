import { NextRequest, NextResponse } from "next/server";
import { CmpError } from "@/lib/campaign/db";
import { getMeta, getPulse, getMap, getMapStores, getStore, getRisk, rescoreRisk } from "@/lib/sentiment/handlers";

// ─── NPS Analyst API ──────────────────────────────────────────────────────────
//
// One catch-all route for the /sentiment pages (src/lib/sentiment/handlers.ts).
// Errors come back as JSON {error} with the status the handler chose. Every
// parameter is checked against a list or a pattern in the handler and bound,
// never interpolated.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> | { path: string[] } };

const p = (req: NextRequest, k: string) => req.nextUrl.searchParams.get(k);

const GETS: Record<string, (req: NextRequest) => Promise<unknown>> = {
  meta: () => getMeta(),
  pulse: (req) => getPulse(p(req, "week")),
  map: (req) => getMap(p(req, "period"), p(req, "category"), p(req, "tier")),
  "map/stores": (req) => getMapStores(p(req, "state"), p(req, "week"), p(req, "period"), p(req, "category"), p(req, "tier")),
  store: (req) => getStore(p(req, "code"), p(req, "week")),
  risk: () => getRisk(),
};

const POSTS: Record<string, () => Promise<unknown>> = {
  "risk/rescore": rescoreRisk,
};

function fail(e: unknown, where: string) {
  if (e instanceof CmpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(new Date().toISOString(), `[api/sentiment/${where}] failed`, e);
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
  if (!handler) return NextResponse.json({ error: `No sentiment endpoint '${key}'` }, { status: 404 });
  try {
    return NextResponse.json(await handler(request));
  } catch (e) {
    return fail(e, key);
  }
}

export async function POST(_request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const key = path.join("/");
  const handler = route(POSTS, key);
  if (!handler) return NextResponse.json({ error: `No sentiment endpoint '${key}'` }, { status: 404 });
  try {
    return NextResponse.json(await handler());
  } catch (e) {
    return fail(e, key);
  }
}
