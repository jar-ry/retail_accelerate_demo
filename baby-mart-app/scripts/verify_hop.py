#!/usr/bin/env python3
"""Verification gates for the Head of Planning tab.

Three gates, each a set of PASS/FAIL assertions against the live schema:

  reconcile   the numbers tie: LY to real POS to the cent, the MFP identities, the
              planning chain, balances at the closing week, the WSSI splice, and
              planner inputs reading back exactly what was typed
  ownership   the registry says no where it must: nothing ingested or calculated is
              editable, every editable measure demands a reason, class and party
              agree, and every WSSI row resolves to an owner
  queries     every query the app issues, run exactly as written in
              src/lib/hop/sql.ts, so SQL that compiles in isolation but breaks
              against the real views is caught before a demo is

  SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python scripts/verify_hop.py [gate ...]

Another account takes the same namespace variables as the app, and run_sql.py's
connection variables, e.g. Snowhouse:

  SNOWFLAKE_ACCOUNT=SFCOGSOPS-SNOWHOUSE_AWS_US_WEST_2 SNOWFLAKE_USER=JARCHEN \
  SNOWFLAKE_HOST=snowhouse.snowflakecomputing.com SNOWFLAKE_ROLE=SALES_ENGINEER \
  SNOWFLAKE_WAREHOUSE=MNEGLAY_XS HOP_SCHEMA=TEMP.JARCHEN_HEAD_OF_PLANNING \
  BABY_MART_DATABASE=TEMP BABY_MART_SCHEMA_CURATED=JARCHEN_CURATED python scripts/verify_hop.py
"""
import os
import pathlib
import re
import sys

import snowflake.connector

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from run_sql import connect  # noqa: E402  -- one connection rule for every script

# The app binds with ? placeholders (querySnowflakeWithBinds). Match it, or a
# bound query fails here on a formatting error that has nothing to do with the SQL.
snowflake.connector.paramstyle = "qmark"

S = os.environ.get("HOP_SCHEMA", "BABY_MART_DEMO.HEAD_OF_PLANNING")
# The real POS the LY base must tie to, named the way src/lib/snowflake.ts names it.
CURATED = f"{os.environ.get('BABY_MART_DATABASE', 'BABY_MART_DEMO')}.{os.environ.get('BABY_MART_SCHEMA_CURATED', 'CURATED')}"
SQL_TS = pathlib.Path(__file__).parent.parent / "src" / "lib" / "hop" / "sql.ts"

results = []


def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"\n        {detail}" if detail and not ok else ""))


def one(cur, sql, binds=None):
    cur.execute(sql, binds) if binds else cur.execute(sql)
    row = cur.fetchone()
    return row[0] if row and len(row) == 1 else row


def near(a, b, tol=0.005):
    return a is not None and b is not None and abs(float(a) - float(b)) <= tol


# ---------------------------------------------------------------- reconcile
def gate_reconcile(cur):
    print("\nReconciliation")

    # LY is real POS, and the store plan's base must tie to it to the cent.
    ly_plan, ly_pos = one(cur, f"""
        SELECT (SELECT SUM(LY_SALES_AUD) FROM {S}.VW_STORE_PLAN_WEEKLY),
               (SELECT SUM(tl.NET_REVENUE)
                FROM {CURATED}.FACT_TRANSACTION_LINES tl
                JOIN {CURATED}.DIM_DATE d ON d.DATE_KEY = tl.DATE_KEY
                WHERE d.CALENDAR_DATE BETWEEN
                      (SELECT DATEADD(day, -6, MIN(LY_WEEK_END_DATE)) FROM {S}.STORE_PLAN_WEEK_SLOT)
                  AND (SELECT MAX(LY_WEEK_END_DATE) FROM {S}.STORE_PLAN_WEEK_SLOT))""")
    check(f"LY base ties to real POS to the cent ({float(ly_plan):,.2f})", near(ly_plan, ly_pos, 0.01),
          f"plan {ly_plan} vs POS {ly_pos}")

    total, by_store = one(cur, f"""
        SELECT (SELECT SUM(TOTAL_SALES_AUD) FROM {S}.VW_STORE_PLAN_SUMMARY),
               (SELECT SUM(s) FROM (SELECT STORE_CODE, SUM(PLAN_SALES_AUD) s FROM {S}.VW_STORE_PLAN_WEEKLY GROUP BY 1))""")
    check("store plan total equals the sum of stores", near(total, by_store, 0.01), f"{total} vs {by_store}")

    # LFL must be measured on the matched base: like-for-like this year over the
    # SAME store-weeks last year, never over all of last year.
    lfl_base, universe = one(cur, f"""
        SELECT (SELECT SUM(LY_SALES_LFL_AUD) FROM {S}.VW_STORE_PLAN_SUMMARY),
               (SELECT SUM(LY_SALES_AUD) FROM {S}.VW_STORE_PLAN_WEEKLY WHERE IS_LFL_UNIVERSE)""")
    check("LFL uses the matched denominator", near(lfl_base, universe, 0.01), f"{lfl_base} vs {universe}")

    worst = one(cur, f"""
        SELECT MAX(GREATEST(ABS(NVL(ID1_VARIANCE, 0)), ABS(NVL(ID2_VARIANCE, 0)), ABS(NVL(ID3_VARIANCE, 0))))
        FROM {S}.VW_MFP_IDENTITY""")
    check("the three MFP identities hold at 0.00", near(worst, 0, 0.005), f"worst {worst}")

    gap = one(cur, f"""
        SELECT MAX(ABS(r.TPR_BUDGET - d.S) + ABS(r.LFL_FORECAST - d.L) + ABS(r.F26_ACTUAL - d.A))
        FROM {S}.VW_MFP_IDENTITY r
        JOIN (SELECT RBU_CODE, SUM(TPR_BUDGET) S, SUM(LFL_FORECAST) L, SUM(F26_ACTUAL) A
              FROM {S}.VW_MFP_IDENTITY WHERE PLAN_LEVEL = 'DEPARTMENT' GROUP BY 1) d
          ON d.RBU_CODE = r.ENTITY_CODE
        WHERE r.PLAN_LEVEL = 'RBU'""")
    check("departments sum exactly to their RBU", near(gap, 0, 0.05), f"worst {gap}")

    gap = one(cur, f"""
        SELECT ABS(SUM(MONTH_BUDGET_AUD) - (SELECT SUM(TPR_BUDGET) FROM {S}.VW_MFP_IDENTITY WHERE PLAN_LEVEL = 'DEPARTMENT'))
        FROM {S}.VW_MFP_PHASED""")
    check("MFP phasing neither invents nor loses budget", near(gap, 0, 0.05), f"off by {gap}")

    bud, approved, bud_gp, approved_gp = one(cur, f"""
        SELECT SUM(f.SLS_AUD), (SELECT TOTAL_SALES_AUD FROM {S}.PLAN_APPROVAL WHERE STATE = 'APPROVED' ORDER BY APPROVAL_ID DESC LIMIT 1),
               SUM(f.POS_GP_AUD), (SELECT TOTAL_MARGIN_AUD FROM {S}.PLAN_APPROVAL WHERE STATE = 'APPROVED' ORDER BY APPROVAL_ID DESC LIMIT 1)
        FROM {S}.FACT_WSSI_WEEKLY f JOIN {S}.DIM_CALENDAR_WEEK c ON c.WEEK_END_DATE = f.WEEK_END_DATE
        WHERE f.VERSION = 'BUD' AND c.FY_YEAR = 2027 AND c.FY_HALF = 'H1'""")
    check("the WSSI budget is the board-approved store plan, to the cent", near(bud, approved, 0.005), f"BUD {bud} vs approved {approved}")
    check("the WSSI budget margin is the approved margin, to the cent", near(bud_gp, approved_gp, 0.005), f"BUD {bud_gp} vs approved {approved_gp}")

    hops = one(cur, f"""
        SELECT ABS(SUM(IFF(HOP = 2, VALUE_AUD, 0)) - SUM(IFF(HOP = 1, VALUE_AUD, 0)))
             + ABS(SUM(IFF(HOP = 3, VARIANCE_AUD, 0)) - (SUM(IFF(HOP = 3, VALUE_AUD, 0)) - SUM(IFF(HOP = 2, VALUE_AUD, 0))))
        FROM {S}.VW_PLANNING_CHAIN""")
    check("planning chain hops add up", near(hops, 0, 0.05), f"off by {hops}")

    gap = one(cur, f"""
        WITH g AS (SELECT * FROM {S}.VW_WSSI_GRAIN WHERE TIME_GRAIN = 'MONTH' AND RBU_SCOPE = 'ALL'),
        w AS (SELECT VERSION, ALIGNED_WEEK_END_DATE, SUM(C_CLS_INV_AUD) STOCK FROM {S}.VW_WSSI_EXTENDED GROUP BY 1, 2)
        SELECT MAX(ABS(g.C_CLS_INV_AUD - w.STOCK)) FROM g JOIN w ON w.VERSION = g.VERSION AND w.ALIGNED_WEEK_END_DATE = g.CLOSING_WEEK""")
    check("balances are taken at the closing week, not summed across weeks", near(gap, 0, 0.05), f"worst {gap}")

    gap = one(cur, f"""
        SELECT MAX(ABS(a - r)) FROM (
          SELECT TIME_GRAIN, PERIOD_KEY, VERSION,
                 SUM(IFF(RBU_SCOPE = 'ALL', SLS_AUD + NVL(C_CLS_INV_AUD, 0), 0)) a,
                 SUM(IFF(RBU_SCOPE <> 'ALL', SLS_AUD + NVL(C_CLS_INV_AUD, 0), 0)) r
          FROM {S}.VW_WSSI_GRAIN GROUP BY 1, 2, 3)""")
    check("WSSI all-RBU equals the sum of RBUs at every grain", near(gap, 0, 0.05), f"worst {gap}")

    breaches = one(cur, f"SELECT COUNT(*) FROM {S}.VW_WSSI_INTEGRITY WHERE CHECK_NAME IN ('STOCK_ROLLFORWARD', 'TOTAL_EQ_FP_PLUS_CL', 'NEGATIVE_STOCK', 'ASP_ORIENTATION')")
    check("the WSSI model passes its own roll-forward, FP+CL, sign and ASP checks", breaches == 0, f"{breaches} breaches")

    # The latest estimate starts from where stock actually closed, not where the
    # forecast assumed it would be.
    gap = one(cur, f"""
        SELECT MAX(ABS(le.C_CLS_INV_AUD - ty.C_CLS_INV_AUD))
        FROM {S}.VW_WSSI_DERIVED le
        JOIN {S}.VW_WSSI_DERIVED ty ON ty.VERSION = 'TY' AND ty.DEPARTMENT_NUM = le.DEPARTMENT_NUM AND ty.WEEK_END_DATE = le.WEEK_END_DATE
        WHERE le.VERSION = 'LE'""")
    check("the latest estimate equals actual stock for every traded week", near(gap, 0, 0.005), f"worst {gap}")

    leaked = one(cur, f"""
        SELECT COUNT(*) FROM {S}.VW_WSSI_EXTENDED
        WHERE NOT ACCEPTS_PLANNER_INPUT
          AND (IN_MD_EXIT OR IN_MD_EXIT_GP OR IN_MD_DEPTH OR IN_MD_SPEND OR IN_MD_UNITS OR IN_SHRINK
               OR IN_FP_ADJ_R OR IN_CL_ADJ_R OR IN_FP_ADJ_C OR IN_CL_ADJ_C OR IN_FP_ADJ_U OR IN_CL_ADJ_U)""")
    check("planner inputs never restate a traded week, last year, the budget or the forecast", leaked == 0, f"{leaked} rows")

    # What was typed must read back exactly, at the grain and scope it was typed.
    cur.execute(f"""
        WITH b AS (
          SELECT BATCH_ID, MIN(TYPED_GRAIN) GRAIN, MIN(TYPED_PERIOD_KEY) PK, NVL(MIN(RBU_CODE), 'ALL') SCOPE,
                 MIN(MEASURE_CODE) M, MIN(TYPED_VALUE) TYPED
          FROM {S}.WSSI_PLANNED_INPUT GROUP BY BATCH_ID
        )
        SELECT b.M, b.PK, b.SCOPE, b.TYPED,
               CASE b.M
                 WHEN 'SHRINK_PCT'        THEN g.SHRINK_C_AUD / NULLIF(g.SHRINK_BASE_AUD, 0)
                 WHEN 'MD_DEPTH_PCT'      THEN g.MD_DEPTH_W_AUD / NULLIF(g.SLS_CL_AUD, 0)
                 WHEN 'MD_EXIT_FP_GP_PCT' THEN g.MD_EXIT_GP_W_AUD / NULLIF(g.MD_EXIT_AUD, 0)
                 WHEN 'MD_SPEND_AUD'      THEN g.MD_SPEND_AUD
                 WHEN 'MD_UNITS'          THEN g.MD_UNITS
                 WHEN 'MD_EXIT_AUD'       THEN g.MD_EXIT_AUD
               END AS SHOWN
        FROM b JOIN {S}.VW_WSSI_GRAIN g
          ON g.TIME_GRAIN = b.GRAIN AND g.PERIOD_KEY = b.PK AND g.RBU_SCOPE = b.SCOPE AND g.VERSION = 'LE'""")
    rows = cur.fetchall()
    bad = [r for r in rows if r[4] is None or abs(float(r[4]) - float(r[3])) > max(abs(float(r[3])) * 1e-9, 1e-9)]
    check(f"every planner input reads back exactly as typed ({len(rows)} inputs)", rows and not bad, f"{bad}")

    weeks, shape, dup = one(cur, f"""
        SELECT SUM(WEEKS_IN_PERIOD), LISTAGG(WEEKS_IN_PERIOD, '-') WITHIN GROUP (ORDER BY FY_PERIOD_NO),
               (SELECT COUNT(*) FROM (SELECT PERIOD_KEY FROM {S}.VW_CALENDAR_PERIOD GROUP BY 1 HAVING COUNT(*) > 1))
        FROM {S}.VW_CALENDAR_PERIOD WHERE FY_YEAR = 2027 AND FY_HALF = 'H1'""")
    check(f"FY27 H1 is 26 weeks, 4-4-5-4-4-5 ({shape})", int(weeks) == 26 and shape == "4-4-5-4-4-5", f"got {weeks} {shape}")
    check("the calendar has exactly one row per period", dup == 0, f"{dup} duplicated")

    open_compliance = one(cur, f"SELECT COUNT(*) FROM {S}.VW_OVERRIDE_COMPLIANCE WHERE COMPLIANCE_STATUS = 'UNKNOWN REASON CODE'")
    check("every edit's reason code is known", open_compliance == 0, f"{open_compliance} unknown")


# ---------------------------------------------------------------- ownership
def gate_ownership(cur):
    print("\nOwnership registry")

    n = one(cur, f"SELECT COUNT(*) FROM {S}.MEASURE_OWNERSHIP WHERE EDIT_CLASS IN ('INGESTED', 'CALCULATED', 'UNCLASSIFIED') AND EDITABLE_IN_APP")
    check("nothing ingested, calculated or unclassified is editable", n == 0, f"{n} are")

    n = one(cur, f"SELECT COUNT(*) FROM {S}.MEASURE_OWNERSHIP WHERE EDITABLE_IN_APP AND NOT REQUIRES_RATIONALE")
    check("every editable measure demands a reason", n == 0, f"{n} do not")

    n = one(cur, f"""
        SELECT COUNT(*) FROM {S}.MEASURE_OWNERSHIP
        WHERE NOT ((EDIT_CLASS = 'JOINT' AND OWNING_PARTY = 'BOTH')
                OR (EDIT_CLASS = 'PLANNING' AND OWNING_PARTY = 'PLANNING')
                OR (EDIT_CLASS = 'BUYING' AND OWNING_PARTY = 'BUYING')
                OR (EDIT_CLASS IN ('INGESTED', 'CALCULATED', 'UNCLASSIFIED') AND OWNING_PARTY = 'NONE'))""")
    check("class and owning party agree on every row", n == 0, f"{n} disagree")

    n = one(cur, f"""
        SELECT COUNT(*) FROM {S}.MEASURE_OWNERSHIP
        WHERE (EDIT_CLASS = 'PLANNING' AND LOCK_BEHAVIOUR <> 'ALWAYS_OPEN')
           OR (EDIT_CLASS IN ('JOINT', 'BUYING') AND LOCK_BEHAVIOUR <> 'AMEND_WITH_ESCALATION')""")
    check("lock behaviour follows the class", n == 0, f"{n} do not")

    # The pad width matches how the app builds the code. A fixed LPAD(x, 2) would
    # truncate 100+ to two digits and silently miss 41 rows.
    missing, total = one(cur, f"""
        SELECT COUNT_IF(o.MEASURE_CODE IS NULL), COUNT(*)
        FROM {S}.WSSI_ROW_MEASURE_MAP m
        LEFT JOIN {S}.MEASURE_OWNERSHIP o ON o.SURFACE = 'WSSI'
         AND o.MEASURE_CODE = 'WSSI:' || LPAD(m.DISPLAY_ORDER, GREATEST(3, LENGTH(m.DISPLAY_ORDER::VARCHAR)), '0') || ':' || m.ROW_LABEL""")
    check(f"all {total} WSSI rows resolve to an owner", missing == 0, f"{missing} do not")

    n = one(cur, f"""
        SELECT COUNT(*) FROM {S}.PLAN_CELL_OVERRIDE o
        WHERE NOT EXISTS (SELECT 1 FROM {S}.MEASURE_OWNERSHIP m WHERE m.MEASURE_CODE = o.MEASURE_CODE)""")
    check("every recorded edit names a registered measure", n == 0, f"{n} do not")


# ---------------------------------------------------------------- queries
def gate_queries(cur):
    print("\nApp queries (src/lib/hop/sql.ts)")
    src = SQL_TS.read_text()
    # Bind values and expected-empty queries are declared beside the queries
    # (BINDS, EXPECTED_EMPTY) so the two cannot drift.
    m = re.search(r"export const BINDS[^=]*=\s*(\{.*?\n\})", src, re.S)
    binds = eval(re.sub(r"(\w+):", r'"\1":', m.group(1))) if m else {}
    m = re.search(r"export const EXPECTED_EMPTY[^=]*=\s*(\[.*?\])", src, re.S)
    empty = set(eval(m.group(1))) if m else set()
    queries = re.findall(r"export const (SQL_\w+) = `(.*?)`", src, re.S)
    for name, body in queries:
        body = body.replace("${S}", S)
        try:
            b = binds.get(name)
            cur.execute(body, b) if b else cur.execute(body)
            rows = cur.fetchall()
            ok = bool(rows) or name in empty
            check(f"{name:<32} rows={len(rows)}", ok, "returned zero rows")
        except Exception as exc:
            check(name, False, str(exc).splitlines()[0][:200])


GATES = {"reconcile": gate_reconcile, "ownership": gate_ownership, "queries": gate_queries}


def main():
    wanted = sys.argv[1:] or list(GATES)
    if not os.environ.get("SNOWFLAKE_ACCOUNT"):
        os.environ.setdefault("SNOWFLAKE_CONNECTION_NAME", "JCHEN_AWS1")
    con = connect()
    cur = con.cursor()
    try:
        for g in wanted:
            GATES[g](cur)
    finally:
        cur.close()
        con.close()
    failed = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
