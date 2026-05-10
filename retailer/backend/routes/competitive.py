from fastapi import APIRouter
from backend.services.snowflake_client import execute_query

router = APIRouter()


@router.get("/pricing")
def competitor_pricing(brand: str = "Huggies"):
    sql = f"""
        SELECT competitor_name, AVG(avg_competitor_price) as their_price,
               AVG(avg_our_price) as our_price, AVG(avg_price_gap_pct) as gap_pct
        FROM DT_COMPETITIVE_POSITION
        WHERE brand_name = '{brand}' AND fiscal_year = 2026
        GROUP BY competitor_name
        ORDER BY gap_pct DESC
    """
    return execute_query(sql)
