-- ============================================================
-- Step 6: Test install locally + Create listing
-- ============================================================

USE ROLE ACCOUNTADMIN;

-- Local test install (on retailer account):
CREATE APPLICATION BABY_MART_BUGABOO_PORTAL
  FROM APPLICATION PACKAGE SUPPLIER_PORTAL_BUGABOO_PACKAGE
  USING VERSION v1;

-- REQUIRED: Grant Cortex access to the installed app
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO APPLICATION BABY_MART_BUGABOO_PORTAL;

-- Verify data is filtered correctly:
SELECT DISTINCT supplier_name FROM BABY_MART_BUGABOO_PORTAL.APP_CODE.SELLTHROUGH;
-- Should return only 'Bugaboo Australia'

-- ============================================================
-- Create listing (via Snowsight UI):
-- 1. Data Products → Provider Studio → + Listing
-- 2. Select "Only Specified Consumers"
-- 3. Attach: SUPPLIER_PORTAL_BUGABOO_PACKAGE
-- 4. Title: "Baby Mart Supplier Portal — Bugaboo"
-- 5. Add target account (e.g. SFSEAPAC.JCHEN_AWS_COLLAB_AP)
-- 6. Publish
-- ============================================================

-- ============================================================
-- ON THE SUPPLIER ACCOUNT (after they accept the listing):
-- ============================================================
-- CREATE APPLICATION BABY_MART_BUGABOO_PORTAL
--   FROM LISTING '<listing_global_name>';
--
-- IMPORTANT: Supplier must run this after install:
-- GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO APPLICATION BABY_MART_BUGABOO_PORTAL;
--
-- Then open the Streamlit app from:
--   Data Products → Apps → BABY_MART_BUGABOO_PORTAL → SUPPLIER_PORTAL
-- ============================================================
