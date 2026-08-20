#!/usr/bin/env python3
"""Register GENERATE_BATTLECARD as a tool on a Cortex Agent (idempotent).

Part of clean-slate setup: run after sql/09_battlecard_procedure.sql so the
agent can produce battlecards, not just the app.

Why a script and not SQL: adding one tool means merging into the agent's
existing JSON spec. `ALTER AGENT ... SET FROM SPECIFICATION` isn't supported, so
this reads the current spec, splices the tool in, and issues CREATE OR REPLACE.
That resets the agent's version history -- expected, and harmless for a demo.

Usage:
    # canonical account
    SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python scripts/register_battlecard_tool.py \
        --agent BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT \
        --procedure BABY_MART_DEMO.AI.GENERATE_BATTLECARD \
        --warehouse DEMO_AI_WH

    # explicit params (accounts the CLI can't see, e.g. Snowhouse)
    SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_HOST=... \
    SNOWFLAKE_ROLE=... SNOWFLAKE_WAREHOUSE=... python scripts/register_battlecard_tool.py \
        --agent TEMP.JARCHEN_AI.CATEGORY_MANAGER_AGENT_APP \
        --procedure TEMP.JARCHEN_AI.GENERATE_BATTLECARD \
        --warehouse MNEGLAY_XS
"""

import argparse
import json
import os
import sys

import snowflake.connector

TOOL_NAME = "generate_battlecard"

# IMPORTANT: the agent binds tool arguments BY NAME from input_schema, so these
# property names must match the procedure's parameter names exactly (p_brand /
# p_category). Mismatched names fail with:
#   "named arguments [BRAND] do not match any signature for function ..."
TOOL_SPEC = {
    "tool_spec": {
        "type": "generic",
        "name": TOOL_NAME,
        "description": (
            "Generates a supplier negotiation battlecard for a brand, grounded in Baby Mart's "
            "actual data (margin vs category, revenue growth, category share, DIFOT, brand "
            "switching, price gap, promotional ROI, customer value). Use this whenever the user "
            "asks for a battlecard, negotiation prep, supplier negotiation strategy, or what to "
            "ask a supplier for. Returns JSON containing the source metrics plus grouped "
            "arguments with asks and impact scores."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "p_brand": {
                    "type": "string",
                    "description": "Brand name, e.g. Huggies, Bugaboo, Britax.",
                },
                "p_category": {
                    "type": "string",
                    "description": (
                        "Optional category, e.g. 'Nappies & Wipes'. "
                        "Omit to use the brand's largest category."
                    ),
                },
            },
            "required": ["p_brand"],
        },
    }
}


def connect():
    conn_name = os.getenv("SNOWFLAKE_CONNECTION_NAME")
    if conn_name and not os.getenv("SNOWFLAKE_ACCOUNT"):
        return snowflake.connector.connect(connection_name=conn_name)
    kwargs = {
        "account": os.environ["SNOWFLAKE_ACCOUNT"],
        "user": os.environ["SNOWFLAKE_USER"],
        "authenticator": os.getenv("SNOWFLAKE_AUTHENTICATOR", "externalbrowser"),
        "client_store_temporary_credential": True,
        "login_timeout": 120,
    }
    for env_key, key in (("SNOWFLAKE_HOST", "host"), ("SNOWFLAKE_ROLE", "role"),
                         ("SNOWFLAKE_WAREHOUSE", "warehouse")):
        if os.getenv(env_key):
            kwargs[key] = os.environ[env_key]
    return snowflake.connector.connect(**kwargs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True, help="DB.SCHEMA.AGENT_NAME")
    ap.add_argument("--procedure", required=True, help="DB.SCHEMA.GENERATE_BATTLECARD")
    ap.add_argument("--warehouse", required=True, help="Warehouse the tool executes in")
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()

    cur.execute(f"DESCRIBE AGENT {args.agent}")
    row = dict(zip([d[0].lower() for d in cur.description], cur.fetchone()))
    spec = json.loads(row["agent_spec"])
    comment = (row.get("comment") or "").replace("'", "''")
    profile = row.get("profile") or ""

    had_mcp = bool(spec.get("mcp_servers"))

    spec.setdefault("tools", [])
    spec["tools"] = [t for t in spec["tools"]
                     if t.get("tool_spec", {}).get("name") != TOOL_NAME]
    spec["tools"].append(TOOL_SPEC)
    spec.setdefault("tool_resources", {})[TOOL_NAME] = {
        "type": "procedure",
        "identifier": args.procedure,
        "execution_environment": {"type": "warehouse", "warehouse": args.warehouse},
    }

    stmt = f"CREATE OR REPLACE AGENT {args.agent} "
    if profile:
        stmt += f"WITH PROFILE='{profile}' "
    stmt += f"COMMENT = '{comment}' FROM SPECIFICATION $${json.dumps(spec, indent=2)}$$"
    cur.execute(stmt)

    cur.execute(f"DESCRIBE AGENT {args.agent}")
    after = json.loads(dict(zip([d[0].lower() for d in cur.description],
                                cur.fetchone()))["agent_spec"])
    tools = [t["tool_spec"]["name"] for t in after.get("tools", [])]
    print(f"OK  {args.agent}")
    print(f"    tools       : {tools}")
    print(f"    mcp_servers : {'preserved' if bool(after.get('mcp_servers')) == had_mcp else 'CHANGED'}"
          f" ({len(after.get('mcp_servers') or [])})")
    if TOOL_NAME not in tools:
        sys.exit(f"FAILED: {TOOL_NAME} not present after update")
    conn.close()


if __name__ == "__main__":
    main()
