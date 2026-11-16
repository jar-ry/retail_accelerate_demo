"""Regression checks for retarget_sql.transform: run with
    /opt/miniconda3/bin/python scripts/test_retarget_sql.py
"""
import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location("retarget_sql", pathlib.Path(__file__).with_name("retarget_sql.py"))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
rt.set_schema_prefix("JARCHEN_")


def t(sql: str) -> str:
    return rt.transform(sql, "TEMP", "MNEGLAY_XS", "SALES_ENGINEER")


# Fully and bare qualified names are rewritten.
assert t("SELECT * FROM BABY_MART_DEMO.CURATED.DIM_STORE") == "SELECT * FROM TEMP.JARCHEN_CURATED.DIM_STORE"
assert t("SELECT * FROM CAMPAIGN.CAMPAIGN_EVENT") == "SELECT * FROM JARCHEN_CAMPAIGN.CAMPAIGN_EVENT"

# Prose is not: an agent's instructions read "set up the campaign." as a sentence.
assert "set up the campaign. It" in t("description: set up the campaign. It never launches.")
assert "stays in ANALYTICS.'" in t("COMMENT = 'The single source of truth stays in ANALYTICS.'")

# A JavaScript procedure body keeps its variables (raw.min is not RAW.min), and
# its fully qualified names are still rewritten.
js = """CREATE OR REPLACE PROCEDURE P(X VARCHAR)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'x'
EXECUTE AS OWNER
AS
$$
var raw = {min: 1}; var app = raw.min; var S = "BABY_MART_DEMO.CAMPAIGN";
return JSON.stringify([raw.min, app, S, "FROM CURATED.DIM_STORE"]);
$$;
SELECT * FROM RAW.T;"""
out = t(js)
assert "var app = raw.min;" in out and "JARCHEN_RAW.min" not in out, out
assert 'var S = "TEMP.JARCHEN_CAMPAIGN";' in out, out
assert "SELECT * FROM JARCHEN_RAW.T;" in out, out
print("retarget_sql: all checks passed")
