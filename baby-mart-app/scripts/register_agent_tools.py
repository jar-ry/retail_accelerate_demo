#!/usr/bin/env python3
"""Register the demo's stored-procedure tools on a Cortex Agent (idempotent).

Part of clean-slate setup: run after sql/09_battlecard_procedure.sql and
sql/14_planning_insights_procedure.sql so the agent can produce battlecards and
planning insights, not just the app.

Why a script and not SQL: adding a tool means merging into the agent's existing
JSON spec. `ALTER AGENT ... SET FROM SPECIFICATION` isn't supported, so this
reads the current spec, splices the tools in, and issues CREATE OR REPLACE. That
resets the agent's version history -- expected, and harmless for a demo.

Both tools are registered in ONE pass. Registering them from two separate
scripts also works (each removes-then-appends only its own tool, so they
compose), but it costs two agent rewrites and leaves two near-identical files to
drift apart.

Usage:
    # canonical account
    SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python scripts/register_agent_tools.py \
        --agent BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT \
        --schema BABY_MART_DEMO.AI \
        --warehouse DEMO_AI_WH

    # explicit params (accounts the CLI can't see, e.g. Snowhouse)
    SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_HOST=... \
    SNOWFLAKE_ROLE=... SNOWFLAKE_WAREHOUSE=... python scripts/register_agent_tools.py \
        --agent TEMP.JARCHEN_AI.CATEGORY_MANAGER_AGENT \
        --schema TEMP.JARCHEN_AI \
        --warehouse MNEGLAY_XS
"""

import argparse
import json
import os
import sys

import snowflake.connector

# IMPORTANT: the agent binds tool arguments BY NAME from input_schema, so these
# property names must match each procedure's parameter names exactly (p_brand,
# p_level, ...). A mismatch fails at call time with:
#   "named arguments [BRAND] do not match any signature for function ..."
#
# "procedure" is the unqualified name; --schema is prepended so one flag
# retargets every tool for a different account namespace.
TOOLS = [
    {
        "procedure": "GENERATE_BATTLECARD",
        "tool_spec": {
            "type": "generic",
            "name": "generate_battlecard",
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
        },
    },
    {
        "procedure": "GENERATE_PLANNING_INSIGHTS",
        "tool_spec": {
            "type": "generic",
            "name": "generate_planning_insights",
            "description": (
                "Generates merchandise financial planning (MFP) and open-to-buy (OTB/WISSI) "
                "insights for a node of Anko's RBU > DEPARTMENT > CLASS merchandise hierarchy, "
                "grounded in the actual plan (sales vs budget, LFL growth, POS margin, ASP, option "
                "counts, stock cover, open-to-buy headroom, supplier commitments and delayed POs). "
                "Use this whenever the user asks about the merchandise financial plan, the MFP, "
                "open-to-buy, OTB, WISSI, buying capacity, overbuy or underbuy positions, stock "
                "cover, planning risks or opportunities, or asks to model a planning scenario. "
                "Returns JSON with risks, opportunities, recommended actions and the source metrics."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "p_level": {
                        "type": "string",
                        "description": (
                            "Hierarchy level to analyse: 'RBU', 'DEPARTMENT' or 'CLASS'."
                        ),
                    },
                    "p_node": {
                        "type": "string",
                        "description": (
                            "Name of the node at that level, e.g. 'BABY-HARDGOODS' for RBU, "
                            "'CAR SEATS' or 'NAPPIES & WIPES' for DEPARTMENT, 'BOTTLES' for CLASS."
                        ),
                    },
                    "p_scenario": {
                        "type": "string",
                        "description": (
                            "Optional what-if to model, e.g. 'demand comes in 8% above forecast' "
                            "or 'delay the Car Seats buy by 4 weeks'. Omit for a standard review."
                        ),
                    },
                },
                "required": ["p_level", "p_node"],
            },
        },
    },
]


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
    ap.add_argument("--schema", required=True,
                    help="DB.SCHEMA holding the procedures, e.g. BABY_MART_DEMO.AI")
    ap.add_argument("--warehouse", required=True, help="Warehouse the tools execute in")
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()

    cur.execute(f"DESCRIBE AGENT {args.agent}")
    row = dict(zip([d[0].lower() for d in cur.description], cur.fetchone()))
    spec = json.loads(row["agent_spec"])
    comment = (row.get("comment") or "").replace("'", "''")
    profile = row.get("profile") or ""

    # CREATE OR REPLACE rewrites the whole agent, so anything not carried over is
    # lost. mcp_servers is checked after the fact to prove nothing was dropped.
    had_mcp = bool(spec.get("mcp_servers"))

    spec.setdefault("tools", [])
    spec.setdefault("tool_resources", {})
    names = {t["tool_spec"]["name"] for t in TOOLS}

    # Remove-then-append, so re-running is a no-op rather than duplicating tools.
    spec["tools"] = [t for t in spec["tools"]
                     if t.get("tool_spec", {}).get("name") not in names]
    for tool in TOOLS:
        spec["tools"].append({"tool_spec": tool["tool_spec"]})
        spec["tool_resources"][tool["tool_spec"]["name"]] = {
            "type": "procedure",
            "identifier": f"{args.schema}.{tool['procedure']}",
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

    missing = sorted(names - set(tools))
    if missing:
        sys.exit(f"FAILED: {', '.join(missing)} not present after update")
    conn.close()


if __name__ == "__main__":
    main()
