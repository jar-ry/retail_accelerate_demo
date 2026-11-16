import { NextRequest, NextResponse } from "next/server";
import { CmpError } from "@/lib/campaign/db";
import { sessionUser } from "@/lib/hop/session";
import { getOverview, getSettings, postSettings, getOffers, getFindings } from "@/lib/campaign/handlers/overview";
import { getVoice, searchVoice } from "@/lib/campaign/handlers/voice";
import { getIdeas, ideasFromRun, decideIdea } from "@/lib/campaign/handlers/ideas";
import { getAudiences, sizeAudience, saveAudience, lockAudience, audienceFromText } from "@/lib/campaign/handlers/audiences";
import {
  getCampaigns, getCampaign, saveBrief, transition, simulate, alertAction, getInvestigation, publishLearnings, getLearnings,
} from "@/lib/campaign/handlers/campaigns";
import { getStudio, getStudioList, generateContent, saveVariant, approveContent, planCampaign, launch } from "@/lib/campaign/handlers/studio";

// ─── Campaign & CRM API ───────────────────────────────────────────────────────
//
// One catch-all route for the /campaigns pages, dispatching to a handler module
// per stage in src/lib/campaign/handlers. Errors come back as JSON {error} with
// the status the handler chose (400 bad input, 409 wrong lifecycle state, 502
// the model failed) rather than Next's HTML 500, which the page cannot show.
//
// Replaces /api/campaign, whose chat executed model-written SQL and whose
// "ai-complete" endpoint was an open prompt proxy.

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> | { path: string[] } };

const GETS: Record<string, (req: NextRequest) => Promise<unknown>> = {
  overview: () => getOverview(),
  ideas: () => getIdeas(),
  voice: (req) => getVoice(req.nextUrl.searchParams.get("state")),
  "voice/search": (req) => searchVoice(req.nextUrl.searchParams),
  audiences: (req) => getAudiences(req.nextUrl.searchParams.get("campaign")),
  campaigns: () => getCampaigns(),
  campaign: (req) => getCampaign(req.nextUrl.searchParams.get("id")),
  investigation: (req) => getInvestigation(req.nextUrl.searchParams.get("id")),
  studio: (req) => (req.nextUrl.searchParams.get("id") ? getStudio(req.nextUrl.searchParams.get("id")) : getStudioList()),
  learnings: () => getLearnings(),
  offers: () => getOffers(),
  settings: () => getSettings(),
  findings: (req) => getFindings(req.nextUrl.searchParams.get("surface")),
};

const POSTS: Record<string, (body: unknown, user: string) => Promise<unknown>> = {
  // Ideas and investigations come from the campaign agents through
  // /api/agent/chat; the board saves an ideas run the route logged.
  "ideas/from-run": ideasFromRun,
  "ideas/decide": decideIdea,
  "audiences/size": (body) => sizeAudience(body),
  "audiences/nl": audienceFromText,
  "audiences/save": saveAudience,
  "audiences/lock": lockAudience,
  brief: saveBrief,
  transition,
  simulate,
  "alerts/action": alertAction,
  "learnings/publish": publishLearnings,
  "studio/generate": generateContent,
  "studio/variant": saveVariant,
  "studio/approve": approveContent,
  "studio/plan": planCampaign,
  "studio/launch": launch,
  settings: postSettings,
};

function fail(e: unknown, where: string) {
  if (e instanceof CmpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(new Date().toISOString(), `[api/cmp/${where}] failed`, e);
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
  if (!handler) return NextResponse.json({ error: `No campaign endpoint '${key}'` }, { status: 404 });
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
  if (!handler) return NextResponse.json({ error: `No campaign endpoint '${key}'` }, { status: 404 });
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
