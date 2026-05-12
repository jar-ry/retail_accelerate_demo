-- ============================================================
-- Step 4: Upload app assets to stage
-- Run this via Python (upload_assets.py) or snowsql.
-- The files uploaded are:
--   manifest.yml
--   scripts/setup.sql
--   streamlit/supplier_portal.py
--   streamlit/pages/1_sellthrough.py
--   streamlit/pages/2_customer_segments.py
--   streamlit/pages/3_brand_switching.py
--   streamlit/pages/4_ai_comms.py
--   streamlit/environment.yml
-- ============================================================

-- Verify uploads:
LIST @SUPPLIER_PORTAL_BUGABOO_PACKAGE.APP_ASSETS.APP_STAGE;

-- To upload manually via snowsql:
-- PUT file://manifest.yml @SUPPLIER_PORTAL_BUGABOO_PACKAGE.APP_ASSETS.APP_STAGE/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
-- PUT file://scripts/setup.sql @SUPPLIER_PORTAL_BUGABOO_PACKAGE.APP_ASSETS.APP_STAGE/scripts/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
-- PUT file://streamlit/supplier_portal.py @SUPPLIER_PORTAL_BUGABOO_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
-- ... etc

-- Or use the helper script:
-- SNOWFLAKE_CONNECTION_NAME=JCHEN_AWS1 python3 upload_assets.py
