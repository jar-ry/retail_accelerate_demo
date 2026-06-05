"""Campaign Manager endpoints — audience segmentation, AI agent, campaigns, offers."""
import json
import uuid
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from backend.routes.supply import execute_query

router = APIRouter()

# ─── Schema context for text-to-SQL agent ───────────────────────────────

SCHEMA_CONTEXT = """You are an audience segmentation SQL assistant for Baby Mart (Australia's leading baby & nursery retailer).

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
- Format numbers with commas in text responses
"""


# ─── Models ─────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    query: str
    filterContext: Optional[str] = ""


class AiCompleteRequest(BaseModel):
    prompt: str


class AudienceFilters(BaseModel):
    segments: list[str] = []
    states: list[str] = []
    loyaltyTiers: list[str] = []
    gender: str = "All"
    minSpend: float = 0
    recencyDays: int = 730


class BreakdownRequest(BaseModel):
    filters: AudienceFilters = AudienceFilters()
    groupBy: str = "state"


class InsightsRequest(BaseModel):
    filters: dict = {}
    audienceSize: int = 0
    breakdown: dict = {}


# ─── Agent Chat ─────────────────────────────────────────────────────────

@router.post("/agent/chat")
def agent_chat(req: ChatRequest):
    """Text-to-SQL agent using Cortex Complete."""
    query = req.query
    context = req.filterContext

    prompt = f"""{SCHEMA_CONTEXT}

User question: {query}
{f"Current filters applied: {context}" if context else ""}

Respond with EXACTLY this JSON format (no other text):
{{
  "text": "Your natural language answer with audience insights",
  "sql": "The SQL query you used (or would use)",
  "suggested": ["suggested follow-up question 1", "suggested follow-up question 2", "suggested follow-up question 3"]
}}

If the question requires data, write and mentally execute the SQL. Estimate the count based on the 150K customer base and filter proportions. Be specific with numbers."""

    try:
        escaped = prompt.replace("'", "''")
        sql = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '{escaped}') AS RESP"
        rows = execute_query(sql)
        resp_text = rows[0]["RESP"] if rows else ""

        # Try to parse JSON
        try:
            match = None
            if "{" in resp_text:
                start = resp_text.index("{")
                end = resp_text.rindex("}") + 1
                match = resp_text[start:end]
            if match:
                parsed = json.loads(match)
                # If SQL is provided, try to execute it
                agent_sql = parsed.get("sql", "")
                data = None
                if agent_sql and "SELECT" in agent_sql.upper():
                    try:
                        data_rows = execute_query(agent_sql)
                        data = data_rows[:50] if data_rows else None
                    except Exception:
                        pass
                return {
                    "text": parsed.get("text", resp_text),
                    "sql": agent_sql or None,
                    "data": data,
                    "suggested": parsed.get("suggested", []),
                }
        except (json.JSONDecodeError, ValueError):
            pass

        return {"text": resp_text, "sql": None, "data": None, "suggested": []}
    except Exception as e:
        return {"text": f"I encountered an error: {str(e)}", "sql": None, "data": None, "suggested": []}


# ─── AI Complete ────────────────────────────────────────────────────────

@router.post("/ai-complete")
def ai_complete(req: AiCompleteRequest):
    """General Cortex Complete endpoint."""
    try:
        escaped = req.prompt.replace("'", "''")
        sql = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '{escaped}') AS RESP"
        rows = execute_query(sql)
        return {"text": rows[0]["RESP"] if rows else ""}
    except Exception as e:
        return {"text": f"Error: {str(e)}"}


# ─── Audience ───────────────────────────────────────────────────────────

SEGMENT_MAP = {
    1: "First-time Parents",
    2: "Second-time Parents",
    3: "Gift Buyers",
    4: "Grandparents",
    5: "Expecting",
    6: "Registry Shoppers",
}


def _build_where(filters: AudienceFilters) -> str:
    conditions = []
    if filters.segments:
        seg_keys = [str(k) for k, v in SEGMENT_MAP.items() if v in filters.segments]
        if seg_keys:
            conditions.append(f"c.SEGMENT_KEY IN ({','.join(seg_keys)})")
    if filters.states:
        state_list = ",".join(f"'{s}'" for s in filters.states)
        conditions.append(f"c.STATE IN ({state_list})")
    if filters.loyaltyTiers:
        tier_list = ",".join(f"'{t}'" for t in filters.loyaltyTiers)
        conditions.append(f"c.LOYALTY_TIER IN ({tier_list})")
    if filters.gender and filters.gender != "All":
        conditions.append(f"c.GENDER = '{filters.gender}'")
    if filters.minSpend > 0:
        conditions.append(f"c.LIFETIME_SPEND >= {filters.minSpend}")
    if filters.recencyDays > 0 and filters.recencyDays < 730:
        conditions.append(f"c.LAST_PURCHASE_DATE >= DATEADD('day', -{filters.recencyDays}, CURRENT_DATE())")
    return " AND ".join(conditions)


@router.post("/audience/count")
def audience_count(filters: AudienceFilters = AudienceFilters()):
    where = _build_where(filters)
    where_clause = f"WHERE {where}" if where else ""
    sql = f"""
        SELECT COUNT(*) AS CNT,
               COUNT(CASE WHEN LOYALTY_TIER IN ('Silver','Gold','Platinum') THEN 1 END) AS REACHABLE
        FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c
        {where_clause}
    """
    rows = execute_query(sql)
    r = rows[0] if rows else {}
    total_sql = "SELECT COUNT(*) AS TOTAL FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER"
    total_rows = execute_query(total_sql)
    total = int(total_rows[0]["TOTAL"]) if total_rows else 150000
    cnt = int(r.get("CNT", 0))
    return {
        "audienceSize": cnt,
        "reachable": int(r.get("REACHABLE", 0)),
        "totalBase": total,
        "pctOfBase": round(cnt / total * 100, 1) if total > 0 else 0,
    }


@router.post("/audience/breakdown")
def audience_breakdown(body: BreakdownRequest):
    filters = body.filters
    group_by = body.groupBy
    where = _build_where(filters)
    where_clause = f"WHERE {where}" if where else ""

    if group_by == "state":
        sql = f"SELECT c.STATE AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c {where_clause} GROUP BY c.STATE ORDER BY COUNT DESC"
    elif group_by == "age":
        sql = f"SELECT c.AGE_BAND AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c {where_clause} GROUP BY c.AGE_BAND ORDER BY COUNT DESC"
    elif group_by == "segment":
        seg_where = where_clause.replace("WHERE", "WHERE") if where_clause else ""
        sql = f"SELECT cs.SEGMENT_NAME AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY {seg_where} GROUP BY cs.SEGMENT_NAME ORDER BY COUNT DESC"
    elif group_by == "loyalty":
        sql = f"SELECT c.LOYALTY_TIER AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c {where_clause} GROUP BY c.LOYALTY_TIER ORDER BY COUNT DESC"
    elif group_by == "gender":
        sql = f"SELECT c.GENDER AS LABEL, COUNT(*) AS COUNT FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c {where_clause} GROUP BY c.GENDER ORDER BY COUNT DESC"
    else:
        return []

    rows = execute_query(sql)
    return [{"label": r["LABEL"], "count": int(r["COUNT"])} for r in rows]


@router.post("/audience/insights")
def audience_insights(body: InsightsRequest):
    """Generate AI insights for the audience segment."""
    prompt = f"""You are a campaign strategist for Baby Mart (Australia's #1 baby & nursery retailer). Given this audience segment:
- Size: {body.audienceSize:,} customers (of 150K total)
- Filters: {json.dumps(body.filters)}
- Top states: {json.dumps(body.breakdown.get('state', [])[:5])}
- Top segments: {json.dumps(body.breakdown.get('segment', [])[:4])}

Provide 3-4 concise bullet points with actionable campaign recommendations. Focus on parent lifecycle targeting, product category opportunities, channel strategy, and seasonal timing. Keep each bullet to 1-2 sentences. Be specific to baby retail."""

    try:
        escaped = prompt.replace("'", "''")
        sql = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '{escaped}') AS RESP"
        rows = execute_query(sql)
        return {"insights": rows[0]["RESP"] if rows else ""}
    except Exception:
        return {"insights": ""}


@router.post("/audience/extract-filters")
def extract_filters(body: dict):
    """Extract filter values from SQL using AI."""
    sql_text = body.get("sql", "")
    if not sql_text:
        return None

    prompt = f"""Given this SQL query, extract the filter values as JSON. Only include filters that are explicitly present in the SQL.

SQL: {sql_text}

Return ONLY valid JSON with these optional fields:
- segments: ["First-time Parents", "Second-time Parents", ...] (segment names)
- states: ["NSW", "VIC", ...] (state codes)
- loyaltyTiers: ["Gold", "Platinum", ...] (tier names)
- gender: "M" or "F" or "All"
- minSpend: number
- recencyDays: number

Example: {{"segments":["First-time Parents"],"states":["NSW","VIC"],"minSpend":500}}

Return ONLY the JSON object, nothing else."""

    try:
        escaped = prompt.replace("'", "''")
        sql = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-opus-4-7', '{escaped}') AS RESP"
        rows = execute_query(sql)
        text = rows[0]["RESP"] if rows else ""
        import re
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            return json.loads(match.group(0))
    except Exception:
        pass
    return None


@router.post("/audience/export")
def audience_export(filters: AudienceFilters = AudienceFilters()):
    """Export audience as JSON (for CSV download)."""
    where = _build_where(filters)
    where_clause = f"WHERE {where}" if where else ""
    sql = f"""
        SELECT c.CUSTOMER_ID, c.STATE, c.AGE_BAND, c.GENDER, c.LOYALTY_TIER,
               cs.SEGMENT_NAME, c.LIFETIME_SPEND, c.TOTAL_TRANSACTIONS, c.LAST_PURCHASE_DATE
        FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c
        JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON c.SEGMENT_KEY = cs.SEGMENT_KEY
        {where_clause}
        LIMIT 10000
    """
    rows = execute_query(sql)
    return {"rows": rows}


# ─── Campaigns ──────────────────────────────────────────────────────────

_campaigns = [
    {
        "id": "camp-001",
        "name": "Crawler Nappies Surge — Loyalty Push",
        "status": "Active",
        "channel": "Email + SMS",
        "audience": "First-time Parents, NSW & QLD",
        "audienceSize": 18400,
        "sent": 18400,
        "opened": 7360,
        "clicked": 2944,
        "converted": 1178,
        "startDate": "2026-04-28",
        "endDate": "2026-05-26",
        "budget": 12000,
        "spent": 8450,
        "destination": "Braze",
    },
    {
        "id": "camp-002",
        "name": "Registry Completion — Expecting Mums",
        "status": "Draft",
        "channel": "Email",
        "audience": "Expecting, Registry Shoppers",
        "audienceSize": 24600,
        "sent": 0,
        "opened": 0,
        "clicked": 0,
        "converted": 0,
        "startDate": "2026-06-01",
        "endDate": "2026-06-30",
        "budget": 8000,
        "spent": 0,
        "destination": "Hightouch",
    },
    {
        "id": "camp-003",
        "name": "Back to Childcare — Toddler Essentials",
        "status": "Completed",
        "channel": "Email + SMS",
        "audience": "Second-time Parents, 25-44",
        "audienceSize": 31200,
        "sent": 31200,
        "opened": 14040,
        "clicked": 5616,
        "converted": 2493,
        "startDate": "2026-01-15",
        "endDate": "2026-02-15",
        "budget": 15000,
        "spent": 14200,
        "destination": "Braze",
    },
    {
        "id": "camp-004",
        "name": "Gold Member Early Access — Winter Sale",
        "status": "Paused",
        "channel": "App Push",
        "audience": "Gold & Platinum members",
        "audienceSize": 12800,
        "sent": 12800,
        "opened": 8960,
        "clicked": 3840,
        "converted": 1536,
        "startDate": "2026-05-01",
        "endDate": "2026-05-31",
        "budget": 5000,
        "spent": 3200,
        "destination": "Braze",
    },
]


@router.get("/campaigns")
def get_campaigns():
    return _campaigns


class CampaignCreate(BaseModel):
    name: str = "New Campaign"
    channel: str = "Email"
    audience: str = ""
    audienceSize: int = 0
    startDate: str = ""
    endDate: str = ""
    budget: float = 0
    destination: str = "Braze"


@router.post("/campaigns")
def create_campaign(body: CampaignCreate):
    campaign = {
        "id": f"camp-{uuid.uuid4().hex[:6]}",
        "name": body.name,
        "status": "Activated",
        "channel": body.channel,
        "audience": body.audience,
        "audienceSize": body.audienceSize,
        "sent": 0,
        "opened": 0,
        "clicked": 0,
        "converted": 0,
        "startDate": body.startDate,
        "endDate": body.endDate,
        "budget": body.budget,
        "spent": 0,
        "destination": body.destination,
    }
    _campaigns.append(campaign)
    return campaign


class CampaignUpdate(BaseModel):
    status: Optional[str] = None


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: CampaignUpdate):
    for c in _campaigns:
        if c["id"] == campaign_id:
            if body.status:
                c["status"] = body.status
            return c
    return {"error": "Campaign not found"}


# ─── Offers ─────────────────────────────────────────────────────────────

OFFERS = [
    {"id": "off-1", "name": "Welcome Pack — Newborn Essentials", "type": "Promo", "description": "Free sample pack with first nappy purchase for new parents", "costPerRedemption": 8.50, "avgRedemptionRate": 0.42, "active": True},
    {"id": "off-2", "name": "Nappy Subscription — 10% Off", "type": "Discount", "description": "Monthly nappy auto-ship with 10% loyalty discount", "costPerRedemption": 4.20, "avgRedemptionRate": 0.28, "active": True},
    {"id": "off-3", "name": "Registry Completion Reward", "type": "Reward", "description": "$25 voucher when registry reaches 80% purchased", "costPerRedemption": 25.00, "avgRedemptionRate": 0.15, "active": True},
    {"id": "off-4", "name": "Nursery Bundle Deal", "type": "Discount", "description": "15% off when purchasing 3+ nursery items together", "costPerRedemption": 18.50, "avgRedemptionRate": 0.22, "active": True},
    {"id": "off-5", "name": "Huggies Partner Cashback", "type": "Cashback", "description": "$5 cashback on Huggies purchases over $30 (Kimberly-Clark funded)", "costPerRedemption": 2.50, "avgRedemptionRate": 0.35, "partner": "Kimberly-Clark", "active": True},
    {"id": "off-6", "name": "Toddler Transition Kit", "type": "Promo", "description": "Free pull-ups sample when purchasing crawler nappies", "costPerRedemption": 6.00, "avgRedemptionRate": 0.31, "active": True},
    {"id": "off-7", "name": "Gold Member Early Access", "type": "Reward", "description": "Exclusive early access to seasonal sales for Gold+ members", "costPerRedemption": 0, "avgRedemptionRate": 0.55, "active": True},
    {"id": "off-8", "name": "Refer a Parent — $15 Each", "type": "Partner", "description": "Both referrer and new parent get $15 store credit", "costPerRedemption": 30.00, "avgRedemptionRate": 0.08, "partner": "Baby Mart Loyalty", "active": True},
]


@router.get("/offers")
def get_offers():
    return OFFERS
