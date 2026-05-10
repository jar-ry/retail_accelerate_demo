from fastapi import APIRouter
from backend.services.snowflake_client import execute_query

router = APIRouter()


@router.get("/by-brand")
def clv_by_brand(category: str = "Nappies & Wipes"):
    sql = f"""
        SELECT brand_name, AVG(avg_clv) as avg_clv, SUM(customer_count) as customers,
               AVG(avg_transactions) as avg_txns
        FROM DT_CLV_BY_BRAND
        WHERE category = '{category}'
        GROUP BY brand_name
        ORDER BY avg_clv DESC
    """
    return execute_query(sql)
