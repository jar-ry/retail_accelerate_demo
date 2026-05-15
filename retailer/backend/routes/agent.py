import json
from fastapi import APIRouter
from pydantic import BaseModel
from backend.services.snowflake_client import get_connection

router = APIRouter()


class ChatRequest(BaseModel):
    message: str


@router.post("/chat")
def agent_chat(req: ChatRequest):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("USE DATABASE BABY_MART_DEMO")
        cur.execute("USE SCHEMA AI")
        cur.execute("USE WAREHOUSE DEMO_AI_WH")

        payload = json.dumps({
            "messages": [{"role": "user", "content": [{"type": "text", "text": req.message}]}]
        })

        sql = f"""
            SELECT TRY_PARSE_JSON(
                SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
                    'BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT',
                    $${payload}$$
                )
            ) AS response
        """
        cur.execute(sql)
        result = cur.fetchone()

        if result and result[0]:
            resp_json = json.loads(result[0]) if isinstance(result[0], str) else result[0]
            text_parts = []
            tables = []

            for item in resp_json.get("content", []):
                if item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
                elif item.get("type") == "tool_result":
                    tool_result = item.get("tool_result", {})
                    for tr in tool_result.get("content", []):
                        if tr.get("type") == "json":
                            tr_json = tr.get("json", {})
                            if tr_json.get("text"):
                                text_parts.append(tr_json["text"])
                            result_set = tr_json.get("result_set")
                            if result_set and result_set.get("data"):
                                columns = [col["name"] for col in result_set.get("resultSetMetaData", {}).get("rowType", [])]
                                tables.append({
                                    "columns": columns,
                                    "rows": result_set["data"],
                                })

            response_text = "\n\n".join(text_parts) if text_parts else "I couldn't generate a response."
            return {"content": response_text, "tables": tables}
        else:
            return {"content": "No response from agent.", "tables": []}
    except Exception as e:
        return {"content": f"Error: {str(e)}", "tables": []}
    finally:
        conn.close()
