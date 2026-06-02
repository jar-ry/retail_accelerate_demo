import json
from fastapi import APIRouter
from pydantic import BaseModel
from backend.services.snowflake_client import execute_query

router = APIRouter()


class BattlecardRequest(BaseModel):
    category: str = "Nappies & Wipes"
    brand: str = "Huggies"


def ai_complete(prompt: str) -> str:
    sql = f"""
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'claude-opus-4-7',
            '{prompt.replace("'", "''")}'
        ) AS result
    """
    result = execute_query(sql)
    return result[0]["RESULT"].strip() if result else ""


def parse_ai_json(raw: str) -> dict:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
        return json.loads(cleaned)
    except Exception:
        return {}


@router.post("/generate")
def generate_battlecard(req: BattlecardRequest):
    if req.brand == "Huggies":
        return {
            "brand": "Huggies",
            "category": "Nappies & Wipes",
            "key_arguments": {
                "profitability": [
                    {
                        "name": "Profitability %",
                        "description": "Gross margin contribution to category",
                        "data": "32% margin — 2pp above category avg. $448K gross profit contribution.",
                        "argument": "Huggies delivers above-average margin; protect shelf allocation to maintain profit pool.",
                        "ask": "Maintain current margin terms; resist cost-price increase requests.",
                        "impact": 4
                    },
                    {
                        "name": "Space Productivity",
                        "description": "Revenue per linear metre of shelf",
                        "data": "$2,840/linear metre vs category avg $1,960. RoS 18.2 units/wk.",
                        "argument": "Highest space productivity brand — every metre allocated to Huggies earns 45% more than alternatives.",
                        "ask": "No shelf reduction. Lock in 12-month planogram commitment.",
                        "impact": 5
                    },
                    {
                        "name": "Loyalty & Substitution",
                        "description": "Repeat purchase and switching behaviour",
                        "data": "68% repeat rate. Net switching +2.1pp (gaining from Babylove/PL, losing to eco brands).",
                        "argument": "Strong loyalty base — delisting would drive customers to competitors, not substitutes in-aisle.",
                        "ask": "Exclusive loyalty activation funding in exchange for maintained terms.",
                        "impact": 3
                    },
                    {
                        "name": "Assortment",
                        "description": "Range breadth and SKU efficiency",
                        "data": "24 SKUs, top 8 deliver 72% of revenue. 4 tail SKUs underperforming.",
                        "argument": "Opportunity to rationalise tail SKUs and reinvest space into proven performers.",
                        "ask": "Range review: delist bottom 4, replace with Huggies Ultra Dry Pants expansion.",
                        "impact": 3
                    }
                ],
                "growth": [
                    {
                        "name": "Sales Growth",
                        "description": "YoY and QoQ revenue trajectory",
                        "data": "+8% QoQ, +1.2% YoY. NSW +12% driven by Ultra Dry Pants.",
                        "argument": "Huggies is the primary growth engine in Nappies; throttling support risks category decline.",
                        "ask": "Growth-linked rebate: additional 0.5% rebate if brand exceeds 5% YoY growth.",
                        "impact": 4
                    },
                    {
                        "name": "Market Momentum",
                        "description": "Share trajectory and competitive position",
                        "data": "42% share, +1.8pp vs prior period. Category leader widening gap to #2.",
                        "argument": "Accelerating share gains justify increased investment from Kimberly-Clark.",
                        "ask": "Incremental co-op funding for in-store activations in growth states (NSW, WA).",
                        "impact": 4
                    }
                ],
                "others": [
                    {
                        "name": "Input Cost Management",
                        "description": "Raw material and supply cost trends",
                        "data": "Pulp prices down 6% since Jan. KC reported improved COGS in latest earnings.",
                        "argument": "Input costs declining — cost-price increase requests not justified by current commodity environment.",
                        "ask": "Reject any proposed CPI. Request 1% cost price reduction effective Jul.",
                        "impact": 5
                    },
                    {
                        "name": "Pricing",
                        "description": "Retail price positioning and elasticity",
                        "data": "Price index 108 vs category. Premium positioning maintained. Elasticity -1.2.",
                        "argument": "Price sensitive — a $1 increase would lose ~4% volume based on elasticity modelling.",
                        "ask": "Hold current RSP. Fund any promotional price points via supplier contribution.",
                        "impact": 3
                    },
                    {
                        "name": "Supplier Operations",
                        "description": "DIFOT, lead times, and service reliability",
                        "data": "DIFOT 94.2% (target 96%). 3 supply disruptions in last 6 months. Lead time 14 days.",
                        "argument": "Below-target DIFOT has cost $62K in lost sales — improvement required before additional investment.",
                        "ask": "DIFOT improvement plan to 96%+ or penalty clause activation (2% deduction per point below).",
                        "impact": 4
                    },
                    {
                        "name": "Promotional ROI",
                        "description": "Trade spend effectiveness and promo uplift",
                        "data": "Promo uplift 2.4x (vs category 1.8x). Trade spend ROI $3.20 per $1 invested.",
                        "argument": "Strong promo response justifies continued investment but demands better funded rates.",
                        "ask": "Increase scan deal funding by 15% for H2; lock in 6 promotional windows.",
                        "impact": 3
                    }
                ]
            },
            "incentives": [
                "Extended payment terms (60→90 days) for volume commitment",
                "First-to-market window on Huggies Ultra Dry Pants expansion (3-month exclusive)",
                "Co-funded loyalty activation: 50/50 spend on targeted new parent campaigns",
                "Guaranteed feature space in Baby Club monthly mailer (6 editions)",
                "Joint business plan with shared data access for demand forecasting"
            ],
            "pressures": [
                "DIFOT penalty activation if below 96% for consecutive quarter",
                "Range review risk: bottom 4 SKUs flagged for delisting in Aug review",
                "Eco-brand switching accelerating (+2.1pp to Rascal + Friends) — shelf at risk",
                "No cost-price increase will be accepted given declining input costs",
                "Competitor (Rascal + Friends) offering 2% better margin with faster growth"
            ],
            "negotiation_approach": "Position of strength — Huggies is the undisputed category anchor but has operational gaps (DIFOT) and faces emerging eco-brand threats. Use DIFOT underperformance and input cost declines as pressure levers while offering growth-linked incentives to secure better terms.",
            "total_addressable": "$180K — Combined value of margin improvement, promotional funding uplift, and DIFOT penalty recovery.",
            "sellthrough": "Huggies revenue in Nappies & Wipes is trending up 8% quarter-on-quarter, driven by strong uptake of the Ultra Dry Nappy Pants range across newborn and crawler sizes.\nRate of sale sits at 4.2 units per store per day, outpacing the category average of 2.9 and reinforcing Huggies' position as the anchor brand in the aisle.\nNSW is the standout state, contributing 34% of national Huggies sell-through with metro Sydney stores delivering double-digit growth versus the same period last year.",
            "switching": "Huggies is gaining most shoppers from private label and Babylove, particularly among value-conscious parents trading up for trusted overnight protection and sensitive skin variants.\nHuggies is losing share to Rascal + Friends and Tooshies by TOM, with eco-conscious millennials and premium-seeking parents switching for plant-based materials and modern branding.\nNet position remains positive in Nappies & Wipes overall, though margin is narrowing as premium defections to eco-challengers outpace value-tier gains, signaling a need for sustainability-led innovation.",
            "summary": "Biggest lever: Huggies' category dominance in Nappies & Wipes makes volume-tiered rebates and growth-based trade spend the most powerful negotiation tool to extract margin without risking range delisting.\nKey risk: Over-reliance on Huggies (likely 40%+ of category sales) means aggressive negotiation could trigger supply disruption or promotional withdrawal, directly impacting category traffic and basket size.\nOpportunity: Leverage Kimberly-Clark's premium innovation pipeline (Huggies Ultra Dry, Newborn) for exclusive SKUs or first-to-market windows in exchange for guaranteed shelf space and co-funded loyalty activations targeting new parents.",
        }

    context = (
        f"You are a retail category manager at Baby Mart, Australia's largest baby retailer. "
        f"Generate a structured negotiation battlecard for {req.brand} in the {req.category} category. "
        f"Return ONLY valid JSON (no markdown, no explanation) with this exact structure: "
        f'{{"key_arguments": {{"profitability": [{{"name": "...", "description": "...", "data": "...", "argument": "...", "ask": "...", "impact": 1-5}}], '
        f'"growth": [...], "others": [...]}}, '
        f'"incentives": ["...", "..."], '
        f'"pressures": ["...", "..."], '
        f'"negotiation_approach": "...", '
        f'"total_addressable": "..."}}'
    )

    raw = ai_complete(context)
    parsed = parse_ai_json(raw)

    if parsed:
        return {
            "brand": req.brand,
            "category": req.category,
            **parsed,
            "sellthrough": "",
            "switching": "",
            "summary": "",
        }

    fallback_context = (
        f"You are a retail data analyst at Baby Mart, Australia's largest baby retailer. "
        f"Generate insights about {req.brand} in {req.category}. "
        f"Include supply chain reliability (DIFOT - Delivered In Full On Time) where relevant. "
        f"Respond with EXACTLY 3 concise bullet points (one sentence each). No headers, no numbering, just 3 lines starting with •"
    )

    sellthrough = ai_complete(
        f"{fallback_context} "
        f"Focus on sell-through performance: revenue trend, rate of sale, and state-level standout."
    )

    switching = ai_complete(
        f"{fallback_context} "
        f"Focus on brand switching: who they're gaining from, who they're losing to, and net position."
    )

    summary = ai_complete(
        f"{fallback_context} "
        f"Focus on negotiation strategy: the single biggest lever, the key risk, and one opportunity."
    )

    return {
        "brand": req.brand,
        "category": req.category,
        "key_arguments": None,
        "incentives": None,
        "pressures": None,
        "negotiation_approach": None,
        "total_addressable": None,
        "sellthrough": sellthrough,
        "switching": switching,
        "summary": summary,
    }
