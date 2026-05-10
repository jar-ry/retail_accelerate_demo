import snowflake.connector
import os

conn = snowflake.connector.connect(connection_name=os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1")
cur = conn.cursor()
cur.execute("USE ROLE ACCOUNTADMIN")

stage = "@SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE"
base = "/Users/jarrychen/Code/retail_accelerate_demo/supplier"

files = [
    (f"{base}/manifest.yml", f"{stage}/"),
    (f"{base}/scripts/setup.sql", f"{stage}/scripts/"),
    (f"{base}/streamlit/supplier_portal.py", f"{stage}/streamlit/"),
    (f"{base}/streamlit/pages/1_sellthrough.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/2_customer_segments.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/3_brand_switching.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/4_ai_comms.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/environment.yml", f"{stage}/streamlit/"),
]

for local_path, stage_path in files:
    print(f"  Uploading {os.path.basename(local_path)}...")
    cur.execute(f"PUT file://{local_path} {stage_path} OVERWRITE=TRUE AUTO_COMPRESS=FALSE")

print()
cur.execute(f"LIST {stage}")
for row in cur.fetchall():
    print(f"  {row[0]}")

conn.close()
print("\nAll files uploaded!")
