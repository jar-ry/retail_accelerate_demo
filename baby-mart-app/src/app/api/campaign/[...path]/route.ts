import { NextRequest, NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";
import { randomUUID } from "crypto";

// ─── Schema context for text-to-SQL agent ───────────────────────────────

const SCHEMA_CONTEXT = `You are an audience segmentation SQL assistant for Baby Mart (Australia's leading baby & nursery retailer).

Available tables:
1. BABY_MART_DEMO.CURATED.DIM_CUSTOMER (c) — 150,000 customers
   Columns: CUSTOMER_KEY, CUSTOMER_ID, SEGMENT_KEY (1-6), STATE (NSW/VIC/QLD/WA/SA/ACT/NT/TAS), AGE_BAND (18-24/25-34/35-44/45-54/55-64/65+), GENDER (M/F), LOYALTY_TIER (Bronze/Silver/Gold/Platinum), LIFETIME_SPEND (AUD), TOTAL_TRANSACTIONS, LAST_PURCHASE_DATE, FIRST_PURCHASE_DATE

2. BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT (cs)
   Columns: SEGMENT_KEY, SEGMENT_NAME, SEGMENT_DESCRIPTION
   Values: 1=First-time Parents, 2=Second-time Parents, 3=Gift Buyers, 4=Grandparents, 5=Expecting, 6=Registry Shoppers

3. BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES (t)
   Columns: TRANSACTION_LINE_KEY, TRANSACTION_ID, DATE_KEY, STORE_KEY, PRODUCT_KEY, CUSTOMER_KEY, QUANTITY, UNIT_PRICE, NET_REVENUE, MARGIN_AMOUNT

4. BABY_MART_DEMO.CURATED.DIM_STORE (s)
   Columns: STORE_KEY, STORE_NAME, STATE, REGION (CBD/Metro/Regional), CITY, STORE_FORMAT (Standard/Large Format)

5. BABY_MART_DEMO.CURATED.DIM_PRODUCT (p)
   Columns: PRODUCT_KEY, PRODUCT_NAME, BRAND_KEY, CATEGORY, CLASS, SUBCLASS

Rules:
- Always return COUNT(*) or COUNT(DISTINCT ...) for audience sizing
- Use aliases: c for customers, cs for segments, t for transactions, s for stores, p for products
- Join customers to segments: c.SEGMENT_KEY = cs.SEGMENT_KEY
- Join transactions to customers: t.CUSTOMER_KEY = c.CUSTOMER_KEY
- For spend analysis join transactions
- Always use fully qualified table names
- Return at most 1000 rows
- Format numbers with commas in text responses`;

// ─── Types ─────────────────────────────────────────────────────────────

interface AudienceFilters {
  segments: string[];
  states: string[];
  loyaltyTiers: string[];
  gender: string;
  minSpend: number;
  recencyDays: number;
}

const DEFAULT_FILTERS: AudienceFilters = {
  segments: [],
  states: [],
  loyaltyTiers: [],
  gender: "All",
  minSpend: 0,
  recencyDays: 730,
};

// ─── Segment map ───────────────────────────────────────────────────────

const SEGMENT_MAP: Record<number, string> = {
  1: "First-time Parents",
  2: "Second-time Parents",
  3: "Gift Buyers",
  4: "Grandparents",
  5: "Expecting",
  6: "Registry Shoppers",
};

// ─── Campaigns are stored in BABY_MART_DEMO.ANALYTICS.CAMPAIGNS ──────

// ─── Offers ────────────────────────────────────────────────────────────

const OFFERS = [
  { id: "off-1", name: "Welcome Pack — Newborn Essentials", type: "Promo", description: "Free sample pack with first nappy purchase for new parents", costPerRedemption: 8.5, avgRedemptionRate: 0.42, active: true },
  { id: "off-2", name: "Nappy Subscription — 10% Off", type: "Discount", description: "Monthly nappy auto-ship with 10% loyalty discount", costPerRedemption: 4.2, avgRedemptionRate: 0.28, active: true },
  { id: "off-3", name: "Registry Completion Reward", type: "Reward", description: "$25 voucher when registry reaches 80% purchased", costPerRedemption: 25.0, avgRedemptionRate: 0.15, active: true },
  { id: "off-4", name: "Nursery Bundle Deal", type: "Discount", description: "15% off when purchasing 3+ nursery items together", costPerRedemption: 18.5, avgRedemptionRate: 0.22, active: true },
  { id: "off-5", name: "Huggies Partner Cashback", type: "Cashback", description: "$5 cashback on Huggies purchases over $30 (Kimberly-Clark funded)", costPerRedemption: 2.5, avgRedemptionRate: 0.35, partner: "Kimberly-Clark", active: true },
  { id: "off-6", name: "Toddler Transition Kit", type: "Promo", description: "Free pull-ups sample when purchasing crawler nappies", costPerRedemption: 6.0, avgRedemptionRate: 0.31, active: true },
  { id: "off-7", name: "Gold Member Early Access", type: "Reward", description: "Exclusive early access to seasonal sales for Gold+ members", costPerRedemption: 0, avgRedemptionRate: 0.55, active: true },
  { id: "off-8", name: "Refer a Parent — $15 Each", type: "Partner", description: "Both referrer and new parent get $15 store credit", costPerRedemption: 30.0, avgRedemptionRate: 0.08, partner: "Baby Mart Loyalty", active: true },
];

// ─── Helpers ───────────────────────────────────────────────────────────

function parseFilters(body: Partial<AudienceFilters>): AudienceFilters {
  return {
    segments: body.segments ?? DEFAULT_FILTERS.segments,
    states: body.states ?? DEFAULT_FILTERS.states,
    loyaltyTiers: body.loyaltyTiers ?? DEFAULT_FILTERS.loyaltyTiers,
    gender: body.gender ?? DEFAULT_FILTERS.gender,
    minSpend: body.minSpend ?? DEFAULT_FILTERS.minSpend,
    recencyDays: body.recencyDays ?? DEFAULT_FILTERS.recencyDays,
  };
}

function buildWhere(filters: AudienceFilters): string {
  const conditions: string[] = [];

  if (filters.segments.length > 0) {
    const segKeys = Object.entries(SEGMENT_MAP)
      .filter(([, v]) => filters.segments.includes(v))
      .map(([k]) => k);
    if (segKeys.length > 0) {
      conditions.push(`c.SEGMENT_KEY IN (${segKeys.join(",")})`);
    }
  }

  if (filters.states.length > 0) {
    const stateList = filters.states.map((s) => `'${s}'`).join(",");
    conditions.push(`c.STATE IN (${stateList})`);
  }

  if (filters.loyaltyTiers.length > 0) {
    const tierList = filters.loyaltyTiers.map((t) => `'${t}'`).join(",");
    conditions.push(`c.LOYALTY_TIER IN (${tierList})`);
  }

  if (filters.gender && filters.gender !== "All") {
    conditions.push(`c.GENDER = '${filters.gender}'`);
  }

  if (filters.minSpend > 0) {
    conditions.push(`c.LIFETIME_SPEND >= ${filters.minSpend}`);
  }

  if (filters.recencyDays > 0 && filters.recencyDays < 730) {
    conditions.push(
      `c.LAST_PURCHASE_DATE >= DATEADD('day', -${filters.recencyDays}, CURRENT_DATE())`
    );
  }

  return conditions.join(" AND ");
}

// ─── Route handlers ────────────────────────────────────────────────────

async function handleAgentChat(req: NextRequest) {
  const body = await req.json();
  const query = body.query || "";
  const filterContext = body.filterContext || "";

  const prompt = `${SCHEMA_CONTEXT}

User question: ${query}
${filterContext ? `Current filters applied: ${filterContext}` : ""}

Respond with EXACTLY this JSON format (no other text):
{
  "text": "Your natural language answer with audience insights",
  "sql": "The SQL query you used (or would use)",
  "suggested": ["suggested follow-up question 1", "suggested follow-up question 2", "suggested follow-up question 3"]
}

If the question requires data, write and mentally execute the SQL. Estimate the count based on the 150K customer base and filter proportions. Be specific with numbers.`;

  try {
    const escaped = prompt.replace(/'/g, "''");
    const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '${escaped}') AS RESP`;
    const rows = await querySnowflake(sql);
    const respText = rows[0]?.RESP || "";

    // Try to parse JSON from response
    try {
      if (respText.includes("{")) {
        const start = respText.indexOf("{");
        const end = respText.lastIndexOf("}") + 1;
        const match = respText.slice(start, end);
        if (match) {
          const parsed = JSON.parse(match);
          const agentSql = parsed.sql || "";
          let data = null;

          // If SQL is provided, try to execute it
          if (agentSql && agentSql.toUpperCase().includes("SELECT")) {
            try {
              const dataRows = await querySnowflake(agentSql);
              data = dataRows?.slice(0, 50) || null;
            } catch {
              // Ignore SQL execution errors
            }
          }

          return NextResponse.json({
            text: parsed.text || respText,
            sql: agentSql || null,
            data,
            suggested: parsed.suggested || [],
          });
        }
      }
    } catch {
      // JSON parse failed, return raw text
    }

    return NextResponse.json({ text: respText, sql: null, data: null, suggested: [] });
  } catch (e: any) {
    return NextResponse.json({
      text: `I encountered an error: ${e.message}`,
      sql: null,
      data: null,
      suggested: [],
    });
  }
}

async function handleAiComplete(req: NextRequest) {
  const body = await req.json();
  const prompt = body.prompt || "";

  try {
    const escaped = prompt.replace(/'/g, "''");
    const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '${escaped}') AS RESP`;
    const rows = await querySnowflake(sql);
    return NextResponse.json({ text: rows[0]?.RESP || "" });
  } catch (e: any) {
    return NextResponse.json({ text: `Error: ${e.message}` });
  }
}

async function handleAudienceCount(req: NextRequest) {
  const body = await req.json();
  const filters = parseFilters(body);
  const where = buildWhere(filters);
  const whereClause = where ? `WHERE ${where}` : "";

  const sql = `
    SELECT COUNT(*) AS CNT,
           COUNT(CASE WHEN LOYALTY_TIER IN ('Silver','Gold','Platinum') THEN 1 END) AS REACHABLE
    FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c
    ${whereClause}
  `;
  const rows = await querySnowflake(sql);
  const r = rows[0] || {};

  const totalSql = "SELECT COUNT(*) AS TOTAL FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER";
  const totalRows = await querySnowflake(totalSql);
  const total = Number(totalRows[0]?.TOTAL) || 150000;
  const cnt = Number(r.CNT) || 0;

  return NextResponse.json({
    audienceSize: cnt,
    reachable: Number(r.REACHABLE) || 0,
    totalBase: total,
    pctOfBase: total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0,
  });
}

async function handleAudienceBreakdown(req: NextRequest) {
  const body = await req.json();
  const filters = parseFilters(body.filters || {});
  const groupBy = body.groupBy || "state";
  const where = buildWhere(filters);
  const whereClause = where ? `WHERE ${where}` : "";

  let sql: string;

  switch (groupBy) {
    case "state":
      sql = `SELECT c.STATE AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ${whereClause} GROUP BY c.STATE ORDER BY COUNT DESC`;
      break;
    case "age":
      sql = `SELECT c.AGE_BAND AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ${whereClause} GROUP BY c.AGE_BAND ORDER BY COUNT DESC`;
      break;
    case "segment":
      sql = `SELECT cs.SEGMENT_NAME AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY ${whereClause} GROUP BY cs.SEGMENT_NAME ORDER BY COUNT DESC`;
      break;
    case "loyalty":
      sql = `SELECT c.LOYALTY_TIER AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ${whereClause} GROUP BY c.LOYALTY_TIER ORDER BY COUNT DESC`;
      break;
    case "gender":
      sql = `SELECT c.GENDER AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c ${whereClause} GROUP BY c.GENDER ORDER BY COUNT DESC`;
      break;
    default:
      return NextResponse.json([]);
  }

  const rows = await querySnowflake(sql);
  return NextResponse.json(
    rows.map((r) => ({ label: r.LABEL, count: Number(r.COUNT) }))
  );
}

async function handleAudienceInsights(req: NextRequest) {
  const body = await req.json();
  const { audienceSize = 0, filters = {}, breakdown = {} } = body;

  const prompt = `You are a campaign strategist for Baby Mart (Australia's #1 baby & nursery retailer). Given this audience segment:
- Size: ${audienceSize.toLocaleString()} customers (of 150K total)
- Filters: ${JSON.stringify(filters)}
- Top states: ${JSON.stringify((breakdown.state || []).slice(0, 5))}
- Top segments: ${JSON.stringify((breakdown.segment || []).slice(0, 4))}

Provide 3-4 concise bullet points with actionable campaign recommendations. Focus on parent lifecycle targeting, product category opportunities, channel strategy, and seasonal timing. Keep each bullet to 1-2 sentences. Be specific to baby retail.`;

  try {
    const escaped = prompt.replace(/'/g, "''");
    const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '${escaped}') AS RESP`;
    const rows = await querySnowflake(sql);
    return NextResponse.json({ insights: rows[0]?.RESP || "" });
  } catch {
    return NextResponse.json({ insights: "" });
  }
}

async function handleAudienceExtractFilters(req: NextRequest) {
  const body = await req.json();
  const sqlText = body.sql || "";

  if (!sqlText) {
    return NextResponse.json(null);
  }

  const prompt = `Given this SQL query, extract the filter values as JSON. Only include filters that are explicitly present in the SQL.

SQL: ${sqlText}

Return ONLY valid JSON with these optional fields:
- segments: ["First-time Parents", "Second-time Parents", ...] (segment names)
- states: ["NSW", "VIC", ...] (state codes)
- loyaltyTiers: ["Gold", "Platinum", ...] (tier names)
- gender: "M" or "F" or "All"
- minSpend: number
- recencyDays: number

Example: {"segments":["First-time Parents"],"states":["NSW","VIC"],"minSpend":500}

Return ONLY the JSON object, nothing else.`;

  try {
    const escaped = prompt.replace(/'/g, "''");
    const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '${escaped}') AS RESP`;
    const rows = await querySnowflake(sql);
    const text = rows[0]?.RESP || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return NextResponse.json(JSON.parse(match[0]));
    }
  } catch {
    // Ignore errors
  }
  return NextResponse.json(null);
}

async function handleAudienceExport(req: NextRequest) {
  const body = await req.json();
  const filters = parseFilters(body);
  const where = buildWhere(filters);
  const whereClause = where ? `WHERE ${where}` : "";

  const sql = `
    SELECT c.CUSTOMER_ID, c.STATE, c.AGE_BAND, c.GENDER, c.LOYALTY_TIER,
           cs.SEGMENT_NAME, c.LIFETIME_SPEND, c.TOTAL_TRANSACTIONS, c.LAST_PURCHASE_DATE
    FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c
    JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY
    ${whereClause}
    LIMIT 10000
  `;
  const rows = await querySnowflake(sql);
  return NextResponse.json({ rows });
}

// ─── Campaign CRUD (Snowflake-backed) ─────────────────────────────────

async function handleGetCampaigns() {
  const rows = await querySnowflake(`
    SELECT CAMPAIGN_ID, NAME, STATUS, CHANNEL, AUDIENCE, AUDIENCE_SIZE, 
           SENT, OPENED, CLICKED, CONVERTED, START_DATE, END_DATE, BUDGET, SPENT, DESTINATION
    FROM BABY_MART_DEMO.ANALYTICS.CAMPAIGNS
    ORDER BY CREATED_AT DESC
  `);
  const campaigns = rows.map((r: any) => ({
    id: r.CAMPAIGN_ID,
    name: r.NAME,
    status: r.STATUS,
    channel: r.CHANNEL,
    audience: r.AUDIENCE,
    audienceSize: Number(r.AUDIENCE_SIZE),
    sent: Number(r.SENT),
    opened: Number(r.OPENED),
    clicked: Number(r.CLICKED),
    converted: Number(r.CONVERTED),
    startDate: r.START_DATE ? String(r.START_DATE).split("T")[0] : "",
    endDate: r.END_DATE ? String(r.END_DATE).split("T")[0] : "",
    budget: Number(r.BUDGET),
    spent: Number(r.SPENT),
    destination: r.DESTINATION,
  }));
  return NextResponse.json(campaigns);
}

async function handleCreateCampaign(req: NextRequest) {
  const body = await req.json();
  const id = `camp-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const name = (body.name || "New Campaign").replace(/'/g, "''");
  const channel = (body.channel || "Email").replace(/'/g, "''");
  const audience = (body.audience || "").replace(/'/g, "''");
  const audienceSize = body.audienceSize || 0;
  const startDate = body.startDate || null;
  const endDate = body.endDate || null;
  const budget = body.budget || 0;
  const destination = (body.destination || "Braze").replace(/'/g, "''");

  await querySnowflake(`
    INSERT INTO BABY_MART_DEMO.ANALYTICS.CAMPAIGNS 
    (CAMPAIGN_ID, NAME, STATUS, CHANNEL, AUDIENCE, AUDIENCE_SIZE, START_DATE, END_DATE, BUDGET, DESTINATION)
    VALUES ('${id}', '${name}', 'Draft', '${channel}', '${audience}', ${audienceSize}, 
            ${startDate ? `'${startDate}'` : "NULL"}, ${endDate ? `'${endDate}'` : "NULL"}, 
            ${budget}, '${destination}')
  `);

  return NextResponse.json({ id, name: body.name || "New Campaign", status: "Draft", channel: body.channel || "Email", audience: body.audience || "", audienceSize, sent: 0, opened: 0, clicked: 0, converted: 0, startDate: startDate || "", endDate: endDate || "", budget, spent: 0, destination: body.destination || "Braze" });
}

async function handleGetCampaignById(campaignId: string) {
  const rows = await querySnowflake(`
    SELECT * FROM BABY_MART_DEMO.ANALYTICS.CAMPAIGNS WHERE CAMPAIGN_ID = '${campaignId.replace(/'/g, "''")}'
  `);
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const r = rows[0];
  return NextResponse.json({
    id: r.CAMPAIGN_ID, name: r.NAME, status: r.STATUS, channel: r.CHANNEL, audience: r.AUDIENCE,
    audienceSize: Number(r.AUDIENCE_SIZE), sent: Number(r.SENT), opened: Number(r.OPENED),
    clicked: Number(r.CLICKED), converted: Number(r.CONVERTED),
    startDate: r.START_DATE ? String(r.START_DATE).split("T")[0] : "", endDate: r.END_DATE ? String(r.END_DATE).split("T")[0] : "",
    budget: Number(r.BUDGET), spent: Number(r.SPENT), destination: r.DESTINATION,
  });
}

async function handleUpdateCampaign(req: NextRequest, campaignId: string) {
  const body = await req.json();
  const sets: string[] = [];
  if (body.status) sets.push(`STATUS = '${body.status.replace(/'/g, "''")}'`);
  if (body.name) sets.push(`NAME = '${body.name.replace(/'/g, "''")}'`);
  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await querySnowflake(`UPDATE BABY_MART_DEMO.ANALYTICS.CAMPAIGNS SET ${sets.join(", ")} WHERE CAMPAIGN_ID = '${campaignId.replace(/'/g, "''")}'`);
  return handleGetCampaignById(campaignId);
}

async function handleDeleteCampaign(campaignId: string) {
  await querySnowflake(`DELETE FROM BABY_MART_DEMO.ANALYTICS.CAMPAIGNS WHERE CAMPAIGN_ID = '${campaignId.replace(/'/g, "''")}'`);
  return NextResponse.json({ success: true });
}

async function handleGetOffers() {
  return NextResponse.json(OFFERS);
}

// ─── Main route dispatcher ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const route = path.join("/");

  if (route === "campaigns") {
    return handleGetCampaigns();
  }

  if (route.startsWith("campaigns/")) {
    const campaignId = path[1];
    return handleGetCampaignById(campaignId);
  }

  if (route === "offers") {
    return handleGetOffers();
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const route = path.join("/");

  switch (route) {
    case "agent/chat":
      return handleAgentChat(req);
    case "ai-complete":
      return handleAiComplete(req);
    case "audience/count":
      return handleAudienceCount(req);
    case "audience/breakdown":
      return handleAudienceBreakdown(req);
    case "audience/insights":
      return handleAudienceInsights(req);
    case "audience/export":
      return handleAudienceExport(req);
    case "audience/extract-filters":
      return handleAudienceExtractFilters(req);
    case "campaigns":
      return handleCreateCampaign(req);
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const route = path.join("/");

  if (route.startsWith("campaigns/")) {
    const campaignId = path[1];
    return handleUpdateCampaign(req, campaignId);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const route = path.join("/");

  if (route.startsWith("campaigns/")) {
    const campaignId = path[1];
    return handleDeleteCampaign(campaignId);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
