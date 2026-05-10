-- ============================================================
-- Create private listing and share to supplier account
-- Note: Listing creation is typically done via Snowsight UI
-- (Provider Studio > Create Listing > Internal Listing)
-- Below is the SQL-based approach where possible
-- ============================================================

-- Grant shared data access to the application package
USE DATABASE BABY_MART_DEMO;

GRANT USAGE ON DATABASE BABY_MART_DEMO TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
GRANT USAGE ON SCHEMA BABY_MART_DEMO.ANALYTICS TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SELLTHROUGH TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SEGMENTS TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_SWITCHING TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;
GRANT SELECT ON VIEW BABY_MART_DEMO.ANALYTICS.VW_SUPPLIER_INVENTORY TO APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;

-- For local testing (on same account):
CREATE APPLICATION IF NOT EXISTS BABY_MART_SUPPLIER_PORTAL
  FROM APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE
  USING VERSION v1;

-- To share externally via private listing:
-- 1. Navigate to Provider Studio in Snowsight
-- 2. Create Listing > Internal Listing
-- 3. Select SUPPLIER_PORTAL_APP_PACKAGE
-- 4. Set access to specific accounts (supplier account locator)
-- 5. Publish

-- On SUPPLIER account after listing is shared:
-- CREATE APPLICATION BABY_MART_SUPPLIER_PORTAL
--   FROM LISTING 'Baby Mart Supplier Portal';
