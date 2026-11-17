#!/usr/bin/env python3
"""
Execute one or more .sql files against Snowflake using explicit connection
parameters, so no connections.toml entry is required.

Statements are split on semicolons at the top level, with $$-quoted blocks
(procedures, semantic-view YAML, agent specs) kept intact.

Usage:
  SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_HOST=... \
  SNOWFLAKE_ROLE=... SNOWFLAKE_WAREHOUSE=... \
  python3 run_sql.py file1.sql file2.sql
"""
import os
import re
import sys

import snowflake.connector


def split_statements(sql: str):
    """Split SQL on top-level semicolons.

    Semicolons inside $$ ... $$ blocks, single-quoted strings and line/block
    comments must not terminate a statement -- demo data legitimately contains
    semicolons inside text values.
    """
    statements = []
    buf = []
    in_dollar = False
    in_quote = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    n = len(sql)

    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        # Terminate a line comment at newline.
        if in_line_comment:
            buf.append(ch)
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            buf.append(ch)
            if ch == "*" and nxt == "/":
                buf.append(nxt)
                i += 2
                in_block_comment = False
                continue
            i += 1
            continue

        if in_quote:
            buf.append(ch)
            if ch == "'":
                # '' is an escaped quote, stay inside the string.
                if nxt == "'":
                    buf.append(nxt)
                    i += 2
                    continue
                in_quote = False
            i += 1
            continue

        if not in_dollar:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                buf.append(ch)
                i += 1
                continue
            if ch == "/" and nxt == "*":
                in_block_comment = True
                buf.append(ch)
                i += 1
                continue
            if ch == "'":
                in_quote = True
                buf.append(ch)
                i += 1
                continue

        if sql.startswith("$$", i):
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue

        if ch == ";" and not in_dollar:
            statements.append("".join(buf))
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    if "".join(buf).strip():
        statements.append("".join(buf))

    cleaned = []
    for st in statements:
        # Drop statements that are only comments/whitespace.
        body = re.sub(r"/\*.*?\*/", "", st, flags=re.DOTALL)
        body = re.sub(r"--[^\n]*", "", body)
        if body.strip():
            cleaned.append(st.strip())
    return cleaned


def connect():
    # Prefer a named connections.toml entry when given -- simplest for the
    # canonical demo account. Fall back to explicit params, which is required
    # for accounts whose connection is nested and therefore invisible to the
    # CLI/connector (e.g. Snowhouse under [connections.snowhouse]).
    #
    # Note: use this runner rather than `snow sql -f` for these scripts. The CLI
    # applies &{...} / <%...%> template substitution to SQL text and misparses
    # the data literals here.
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
    for env_key, conn_key in (
        ("SNOWFLAKE_HOST", "host"),
        ("SNOWFLAKE_ROLE", "role"),
        ("SNOWFLAKE_WAREHOUSE", "warehouse"),
        ("SNOWFLAKE_PASSWORD", "password"),
    ):
        v = os.getenv(env_key)
        if v:
            kwargs[conn_key] = v
    return snowflake.connector.connect(**kwargs)


def main():
    files = sys.argv[1:]
    if not files:
        sys.exit("usage: run_sql.py <file.sql> [...]")

    conn = connect()
    cur = conn.cursor()
    overall_failures = 0

    for path in files:
        sql = open(path).read()
        statements = split_statements(sql)
        print(f"\n=== {os.path.basename(path)} ({len(statements)} statements) ===")
        failures = 0
        for idx, st in enumerate(statements, 1):
            preview = " ".join(st.split())[:80]
            try:
                cur.execute(st)
            except Exception as exc:
                failures += 1
                overall_failures += 1
                print(f"  [{idx}] FAIL  {preview}")
                print(f"        -> {str(exc).splitlines()[0][:200]}")
        status = "OK" if failures == 0 else f"{failures} FAILED"
        print(f"  -- {status}")

    cur.close()
    conn.close()
    print(f"\n{'ALL OK' if overall_failures == 0 else f'{overall_failures} statement(s) failed'}")
    return 1 if overall_failures else 0


if __name__ == "__main__":
    sys.exit(main())
