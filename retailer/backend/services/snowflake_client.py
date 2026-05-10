import os
import snowflake.connector

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"
SNOWFLAKE_ACCOUNT = os.getenv("SNOWFLAKE_ACCOUNT")
SNOWFLAKE_HOST = os.getenv("SNOWFLAKE_HOST")
SPCS_TOKEN_PATH = "/snowflake/session/token"


def get_connection():
    if os.path.exists(SPCS_TOKEN_PATH):
        with open(SPCS_TOKEN_PATH, "r") as f:
            token = f.read().strip()
        return snowflake.connector.connect(
            account=SNOWFLAKE_ACCOUNT,
            host=SNOWFLAKE_HOST,
            authenticator="oauth",
            token=token,
            database="BABY_MART_DEMO",
            schema="ANALYTICS",
            warehouse="DEMO_ANALYTICS_WH",
        )
    else:
        return snowflake.connector.connect(connection_name=CONNECTION_NAME)


def execute_query(sql: str):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("USE DATABASE BABY_MART_DEMO")
        cur.execute("USE SCHEMA ANALYTICS")
        cur.execute("USE WAREHOUSE DEMO_ANALYTICS_WH")
        cur.execute(sql)
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        return [dict(zip(columns, row)) for row in rows]
    finally:
        conn.close()
