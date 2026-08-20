#!/usr/bin/env python3
"""
Rewrite the Baby Mart demo SQL scripts for a target account whose namespace,
warehouse and role differ from the original demo account.

The original scripts assume:
  - a dedicated database  BABY_MART_DEMO  with schemas RAW/CURATED/ANALYTICS/AI/APP
  - dedicated warehouses  DEMO_LOAD_WH / DEMO_ANALYTICS_WH / DEMO_AI_WH
  - ACCOUNTADMIN

On a restricted account (e.g. Snowhouse with SALES_ENGINEER) none of those can
be created. This transformer maps each original schema onto a schema inside an
existing database, points everything at one existing warehouse, and strips the
DDL the role isn't allowed to run.

Dynamic tables are converted to plain CTAS tables: the demo data is static, and
this removes any dependency on refresh scheduling or warehouse type support.

Reads SQL on stdin (or --in) and writes transformed SQL to stdout (or --out).
"""
import argparse
import re
import sys

# Original schema names. The target name is PREFIX + name, so a prefix is only
# needed when several projects share one database (e.g. Snowhouse's TEMP).
SCHEMAS = ["RAW", "CURATED", "ANALYTICS", "AI", "APP"]

# Populated from --schema-prefix in main(); default is no prefix, which keeps the
# canonical BABY_MART_DEMO layout intact.
SCHEMA_MAP = {name: name for name in SCHEMAS}


def set_schema_prefix(prefix: str) -> None:
    global SCHEMA_MAP
    SCHEMA_MAP = {name: f"{prefix}{name}" for name in SCHEMAS}

SOURCE_DB = "BABY_MART_DEMO"
OLD_WAREHOUSES = ["DEMO_LOAD_WH", "DEMO_ANALYTICS_WH", "DEMO_AI_WH", "RETAIL_AI_EVAL_WH"]


def transform(sql: str, target_db: str, target_wh: str, target_role: str) -> str:
    # --- 1. Strip DDL the restricted role cannot execute -------------------
    # CREATE DATABASE ... ;
    sql = re.sub(
        r"^[ \t]*CREATE\s+DATABASE\s+(IF\s+NOT\s+EXISTS\s+)?[A-Z_$0-9]+\s*;[ \t]*$",
        "-- [removed: CREATE DATABASE not permitted on target account]",
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    # CREATE WAREHOUSE ... ; (may span multiple lines until the terminating ;)
    sql = re.sub(
        r"^[ \t]*CREATE\s+WAREHOUSE\s+(IF\s+NOT\s+EXISTS\s+)?[A-Z_$0-9]+.*?;[ \t]*$",
        "-- [removed: CREATE WAREHOUSE not permitted on target account]",
        sql,
        flags=re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )

    # --- 2. Dynamic tables -> plain CTAS tables ---------------------------
    # CREATE OR REPLACE DYNAMIC TABLE X\n TARGET_LAG=... WAREHOUSE=... [REFRESH_MODE=...] AS
    sql = re.sub(
        r"CREATE\s+(OR\s+REPLACE\s+)?DYNAMIC\s+TABLE\s+([A-Z_$0-9.]+)"
        r"(.*?)\bAS\b",
        lambda m: f"CREATE OR REPLACE TABLE {m.group(2)} AS",
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # --- 3. Schema-qualified references: DB.SCHEMA. -> TARGET_DB.NEWSCHEMA.
    for old_schema, new_schema in SCHEMA_MAP.items():
        sql = re.sub(
            rf"\b{SOURCE_DB}\.{old_schema}\b",
            f"{target_db}.{new_schema}",
            sql,
            flags=re.IGNORECASE,
        )

    # --- 3b. Bare schema-qualified references: SCHEMA.TABLE ---------------
    # The scripts frequently reference sibling schemas without the database,
    # e.g. "FROM CURATED.FACT_TRANSACTION_LINES" while the session database is
    # BABY_MART_DEMO. After remapping the database those must also pick up the
    # new schema name, otherwise they resolve to <target_db>.CURATED.
    #
    # The negative lookbehind prevents matching an already-rewritten name such
    # as TEMP.JARCHEN_CURATED. (preceded by '.' or a word character).
    for old_schema, new_schema in SCHEMA_MAP.items():
        sql = re.sub(
            rf"(?<![\w.]){old_schema}\.",
            f"{new_schema}.",
            sql,
            flags=re.IGNORECASE,
        )

    # --- 4. USE SCHEMA with a bare schema name ---------------------------
    # Must run before the generic USE DATABASE rewrite so we can still tell
    # which original schema was meant.
    def _use_schema(match):
        name = match.group(1).upper()
        if name in SCHEMA_MAP:
            return f"USE SCHEMA {target_db}.{SCHEMA_MAP[name]};"
        return match.group(0)

    sql = re.sub(
        r"^[ \t]*USE\s+SCHEMA\s+([A-Z_$0-9]+)\s*;[ \t]*$",
        _use_schema,
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    # --- 5. USE DATABASE ------------------------------------------------
    sql = re.sub(
        rf"^[ \t]*USE\s+DATABASE\s+{SOURCE_DB}\s*;[ \t]*$",
        f"USE DATABASE {target_db};",
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    # --- 6. Warehouses ---------------------------------------------------
    # Only rewrite when a target is given, so retargeting to the canonical
    # account is a true no-op and the scripts can also be run directly.
    if target_wh:
        for wh in OLD_WAREHOUSES:
            sql = re.sub(rf"\b{wh}\b", target_wh, sql, flags=re.IGNORECASE)

    # --- 7. Role ---------------------------------------------------------
    if target_role:
        sql = re.sub(
            r"^[ \t]*USE\s+ROLE\s+[A-Z_$0-9]+\s*;[ \t]*$",
            f"USE ROLE {target_role};",
            sql,
            flags=re.IGNORECASE | re.MULTILINE,
        )

    # --- 7b. YAML-form references (semantic view definitions) ------------
    # Semantic views are declared as embedded YAML, e.g.
    #     base_table:
    #       database: BABY_MART_DEMO
    #       schema: ANALYTICS
    #       table: DT_SELLTHROUGH_WEEKLY
    # so the plain "DB.SCHEMA." rewrite above never sees them.
    sql = re.sub(
        rf"(^[ \t]*database:[ \t]*){SOURCE_DB}[ \t]*$",
        rf"\g<1>{target_db}",
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    for old_schema, new_schema in SCHEMA_MAP.items():
        sql = re.sub(
            rf"(^[ \t]*schema:[ \t]*){old_schema}[ \t]*$",
            rf"\g<1>{new_schema}",
            sql,
            flags=re.IGNORECASE | re.MULTILINE,
        )

    # --- 8. Bare CREATE SCHEMA <name>; (unqualified) ---------------------
    def _create_schema(match):
        name = match.group(2).upper()
        if name in SCHEMA_MAP:
            return f"CREATE SCHEMA IF NOT EXISTS {target_db}.{SCHEMA_MAP[name]};"
        return match.group(0)

    sql = re.sub(
        r"^[ \t]*CREATE\s+SCHEMA\s+(IF\s+NOT\s+EXISTS\s+)?([A-Z_$0-9]+)\s*;[ \t]*$",
        _create_schema,
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    return sql


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", help="Input SQL file (default stdin)")
    ap.add_argument("--out", dest="outfile", help="Output SQL file (default stdout)")
    ap.add_argument("--target-db", default="BABY_MART_DEMO")
    ap.add_argument("--target-warehouse", default="",
                    help="Rewrite DEMO_*_WH to this warehouse; empty leaves them alone")
    ap.add_argument("--target-role", default="",
                    help="Rewrite USE ROLE to this role; empty leaves it alone")
    ap.add_argument("--schema-prefix", default="",
                    help="Prefix for target schema names, e.g. JARCHEN_ for Snowhouse")
    args = ap.parse_args()

    set_schema_prefix(args.schema_prefix)

    sql = open(args.infile).read() if args.infile else sys.stdin.read()
    out = transform(sql, args.target_db, args.target_warehouse, args.target_role)

    if args.outfile:
        with open(args.outfile, "w") as fh:
            fh.write(out)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
