from fastapi import APIRouter
from backend.services.snowflake_client import execute_query

router = APIRouter()


@router.get("/by-mechanic")
def promo_by_mechanic(brand: str = "Huggies"):
    sql = f"""
        SELECT mechanic, SUM(promo_units) as units, SUM(promo_revenue) as revenue,
               SUM(total_discount) as discount, SUM(promo_margin) as margin
        FROM DT_PROMOTIONAL_EFFECTIVENESS
        WHERE brand_name = '{brand}'
        GROUP BY mechanic
        ORDER BY revenue DESC
    """
    return execute_query(sql)
