"""
Shared Snowflake connection + target-namespace resolution for the Baby Mart
data generators.

Originally each generator hardcoded the connection name, database, schema and
warehouse. That prevents the demo from being rebuilt on an account where those
objects don't exist (e.g. Snowhouse, where a dedicated database and DEMO_*_WH
warehouses cannot be created).

Resolution order:
  * If SNOWFLAKE_ACCOUNT is set, connect with explicit parameters. This avoids
    needing an entry in connections.toml at all.
  * Otherwise fall back to a named connections.toml entry
    (SNOWFLAKE_CONNECTION_NAME, default JCHEN_AWS1) which preserves the
    original behaviour.

Target namespace is controlled by:
  BABY_MART_DATABASE       (default BABY_MART_DEMO)
  BABY_MART_CURATED_SCHEMA (default CURATED)
  SNOWFLAKE_WAREHOUSE      (default DEMO_LOAD_WH)
"""
import os

import snowflake.connector

TARGET_DATABASE = os.getenv("BABY_MART_DATABASE", "BABY_MART_DEMO")
TARGET_SCHEMA = os.getenv("BABY_MART_CURATED_SCHEMA", "CURATED")
TARGET_WAREHOUSE = os.getenv("SNOWFLAKE_WAREHOUSE", "DEMO_LOAD_WH")


def connect():
    """Return a connection already pointed at the target database/schema."""
    account = os.getenv("SNOWFLAKE_ACCOUNT")

    if account:
        kwargs = {
            "account": account,
            "user": os.environ["SNOWFLAKE_USER"],
            "authenticator": os.getenv("SNOWFLAKE_AUTHENTICATOR", "externalbrowser"),
            "client_store_temporary_credential": True,
            "login_timeout": 120,
        }
        for env_key, conn_key in (
            ("SNOWFLAKE_HOST", "host"),
            ("SNOWFLAKE_ROLE", "role"),
            ("SNOWFLAKE_WAREHOUSE", "warehouse"),
            ("SNOWFLAKE_PASSWORD", "password"),
        ):
            value = os.getenv(env_key)
            if value:
                kwargs[conn_key] = value
        conn = snowflake.connector.connect(**kwargs)
    else:
        conn = snowflake.connector.connect(
            connection_name=os.getenv("SNOWFLAKE_CONNECTION_NAME", "JCHEN_AWS1")
        )

    cur = conn.cursor()
    cur.execute(f"USE DATABASE {TARGET_DATABASE}")
    cur.execute(f"USE SCHEMA {TARGET_SCHEMA}")
    cur.execute(f"USE WAREHOUSE {TARGET_WAREHOUSE}")
    return conn
