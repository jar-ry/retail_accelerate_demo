import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.services.snowflake_client import get_connection

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    supplier: str = "Bugaboo"


@router.post("/chat")
async def agent_chat(req: ChatRequest):
    async def event_generator():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("USE DATABASE BABY_MART_DEMO")
            cur.execute("USE SCHEMA AI")
            cur.execute("USE WAREHOUSE DEMO_AI_WH")
            sql = f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    'claude-3-5-sonnet',
                    '{req.message.replace("'", "''")}'
                ) AS response
            """
            cur.execute(sql)
            result = cur.fetchone()
            response = result[0] if result else "Unable to get response."
            yield f"data: {json.dumps({'content': response, 'done': True})}\n\n"
        finally:
            conn.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
