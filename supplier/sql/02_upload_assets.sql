-- ============================================================
-- Upload all native app assets to the application package stage
-- Run from local machine using snowsql or snow CLI
-- ============================================================

-- Upload manifest
PUT file://manifest.yml @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;

-- Upload setup script
PUT file://scripts/setup.sql @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/scripts/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;

-- Upload Streamlit files
PUT file://streamlit/supplier_portal.py @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
PUT file://streamlit/pages/1_sellthrough.py @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/pages/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
PUT file://streamlit/pages/2_customer_segments.py @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/pages/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
PUT file://streamlit/pages/3_brand_switching.py @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/pages/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
PUT file://streamlit/pages/4_ai_comms.py @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/pages/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;
PUT file://streamlit/environment.yml @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE/streamlit/ OVERWRITE=TRUE AUTO_COMPRESS=FALSE;

-- Verify uploads
LIST @SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE;
