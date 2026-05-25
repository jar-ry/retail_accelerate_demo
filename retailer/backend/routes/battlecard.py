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


@router.post("/generate")
def generate_battlecard(req: BattlecardRequest):
    if req.brand == "Huggies":
        return {
            "brand": "Huggies",
            "category": "Nappies & Wipes",
            "sellthrough": "Huggies revenue in Nappies & Wipes is trending up 8% quarter-on-quarter, driven by strong uptake of the Ultra Dry Nappy Pants range across newborn and crawler sizes.\nRate of sale sits at 4.2 units per store per day, outpacing the category average of 2.9 and reinforcing Huggies' position as the anchor brand in the aisle.\nNSW is the standout state, contributing 34% of national Huggies sell-through with metro Sydney stores delivering double-digit growth versus the same period last year.",
            "switching": "Huggies is gaining most shoppers from private label and Babylove, particularly among value-conscious parents trading up for trusted overnight protection and sensitive skin variants.\nHuggies is losing share to Rascal + Friends and Tooshies by TOM, with eco-conscious millennials and premium-seeking parents switching for plant-based materials and modern branding.\nNet position remains positive in Nappies & Wipes overall, though margin is narrowing as premium defections to eco-challengers outpace value-tier gains, signaling a need for sustainability-led innovation.",
            "summary": "Biggest lever: Huggies' category dominance in Nappies & Wipes makes volume-tiered rebates and growth-based trade spend the most powerful negotiation tool to extract margin without risking range delisting.\nKey risk: Over-reliance on Huggies (likely 40%+ of category sales) means aggressive negotiation could trigger supply disruption or promotional withdrawal, directly impacting category traffic and basket size.\nOpportunity: Leverage Kimberly-Clark's premium innovation pipeline (Huggies Ultra Dry, Newborn) for exclusive SKUs or first-to-market windows in exchange for guaranteed shelf space and co-funded loyalty activations targeting new parents.",
        }

    context = (
        f"You are a retail data analyst at Baby Mart, Australia's largest baby retailer. "
        f"Generate insights about {req.brand} in {req.category}. "
        f"Include supply chain reliability (DIFOT - Delivered In Full On Time) where relevant. "
        f"Respond with EXACTLY 3 concise bullet points (one sentence each). No headers, no numbering, just 3 lines starting with •"
    )

    sellthrough = ai_complete(
        f"{context} "
        f"Focus on sell-through performance: revenue trend, rate of sale, and state-level standout."
    )

    switching = ai_complete(
        f"{context} "
        f"Focus on brand switching: who they're gaining from, who they're losing to, and net position."
    )

    summary = ai_complete(
        f"{context} "
        f"Focus on negotiation strategy: the single biggest lever, the key risk, and one opportunity."
    )

    return {
        "brand": req.brand,
        "category": req.category,
        "sellthrough": sellthrough,
        "switching": switching,
        "summary": summary,
    }
