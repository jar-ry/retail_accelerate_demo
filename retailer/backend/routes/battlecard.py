from fastapi import APIRouter
from pydantic import BaseModel
from backend.services.snowflake_client import execute_query

router = APIRouter()


class BattlecardRequest(BaseModel):
    category: str = "Nappies & Wipes"
    brand: str = "Huggies"


@router.post("/generate")
def generate_battlecard(req: BattlecardRequest):
    sql = f"""
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'claude-3-5-sonnet',
            CONCAT(
                'Generate a concise negotiation battlecard for a category manager negotiating with ',
                '{req.brand}', ' in the ', '{req.category}', ' category at Baby Mart (AU baby retailer). ',
                'Include: sell-through position, customer value contribution, brand switching dynamics, ',
                'promotional effectiveness, competitive pricing, and recommended negotiation levers. ',
                'Be factual, use bullet points, include specific numbers.'
            )
        ) AS battlecard
    """
    result = execute_query(sql)
    return {"battlecard": result[0]["BATTLECARD"] if result else "Unable to generate battlecard."}
