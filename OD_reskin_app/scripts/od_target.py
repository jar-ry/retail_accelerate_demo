#!/usr/bin/env python3
"""
Retarget the OneDigital SQL for an account where the canonical names do not fit.

The scripts are written for a dedicated database, ONEDIGITAL_DEMO (schemas
CURATED, CAMPAIGN, APP), the warehouse OD_WH and ACCOUNTADMIN. On Snowhouse the
SALES_ENGINEER role cannot create a database, so each schema maps to
TEMP.<PREFIX><SCHEMA> and everything runs on one existing warehouse.

  python3 scripts/od_target.py --db TEMP --prefix JARCHEN_OD_ --warehouse MNEGLAY_XS \
      --role SALES_ENGINEER --out-dir /tmp/od sql/*.sql agent/deploy_od_campaign_agents.sql

With no options it writes the files unchanged (the canonical layout).
"""
import argparse
import os
import re
import sys

SOURCE_DB = "ONEDIGITAL_DEMO"
SCHEMAS = ["CURATED", "CAMPAIGN", "APP"]


def transform(sql: str, db: str, prefix: str, warehouse: str, role: str) -> str:
    if db != SOURCE_DB or prefix:
        sql = re.sub(rf"^[ \t]*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+{SOURCE_DB}\s*;[ \t]*$",
                     "-- [removed: CREATE DATABASE not permitted on the target account]", sql, flags=re.I | re.M)
        for s in SCHEMAS:
            sql = re.sub(rf"\b{SOURCE_DB}\.{s}\b", f"{db}.{prefix}{s}", sql)
        if re.search(rf"\b{SOURCE_DB}\b", sql):
            left = sorted(set(re.findall(rf"\b{SOURCE_DB}\.\w+", sql)))
            raise SystemExit(f"Unmapped {SOURCE_DB} references: {left}")
    if warehouse:
        sql = re.sub(r"\bOD_WH\b", warehouse, sql)
    if role:
        sql = re.sub(r"^USE ROLE ACCOUNTADMIN;", f"USE ROLE {role};", sql, flags=re.M)
    return sql


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=SOURCE_DB)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--warehouse", default="")
    ap.add_argument("--role", default="")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    for f in a.files:
        out = os.path.join(a.out_dir, os.path.basename(f))
        with open(f) as src, open(out, "w") as dst:
            dst.write(transform(src.read(), a.db, a.prefix, a.warehouse, a.role))
        print(f"{f} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
