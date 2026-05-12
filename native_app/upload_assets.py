"""
Upload native app assets to an application package stage.

Usage:
  SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python3 upload_assets.py SUPPLIER_PORTAL_BUGABOO_PACKAGE
  SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python3 upload_assets.py SUPPLIER_PORTAL_HUGGIES_PACKAGE
"""
import snowflake.connector
import os
import sys

CONNECTION_NAME = os.getenv("SNOWFLAKE_CONNECTION_NAME") or "JCHEN_AWS1"

if len(sys.argv) < 2:
    print("Usage: python upload_assets.py <PACKAGE_NAME>")
    print("Example: python upload_assets.py SUPPLIER_PORTAL_BUGABOO_PACKAGE")
    sys.exit(1)

PACKAGE_NAME = sys.argv[1]

conn = snowflake.connector.connect(connection_name=CONNECTION_NAME)
cur = conn.cursor()
cur.execute("USE ROLE ACCOUNTADMIN")

stage = f"@{PACKAGE_NAME}.APP_ASSETS.APP_STAGE"
base = os.path.dirname(os.path.abspath(__file__))

files = [
    (f"{base}/manifest.yml", f"{stage}/"),
    (f"{base}/scripts/setup.sql", f"{stage}/scripts/"),
    (f"{base}/streamlit/supplier_portal.py", f"{stage}/streamlit/"),
    (f"{base}/streamlit/pages/1_sellthrough.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/2_customer_segments.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/3_brand_switching.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/pages/4_ai_comms.py", f"{stage}/streamlit/pages/"),
    (f"{base}/streamlit/environment.yml", f"{stage}/streamlit/"),
    (f"{base}/semantic/supplier_semantic_model.yaml", f"{stage}/semantic/"),
]

print(f"Uploading to {PACKAGE_NAME}...")
for local_path, stage_path in files:
    print(f"  {os.path.basename(local_path)}")
    cur.execute(f"PUT file://{local_path} {stage_path} OVERWRITE=TRUE AUTO_COMPRESS=FALSE")

print(f"\nVerifying:")
cur.execute(f"LIST {stage}")
for row in cur.fetchall():
    print(f"  {row[0]}")

conn.close()
print(f"\nDone! All files uploaded to {PACKAGE_NAME}.")
