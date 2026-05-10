-- ============================================================
-- Create version and set release directive
-- ============================================================

ALTER APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE
  ADD VERSION v1
  USING '@SUPPLIER_PORTAL_APP_PACKAGE.APP_ASSETS.APP_STAGE'
  LABEL = 'Supplier Portal v1.0 - Sellthrough Intelligence with AI Agent';

SHOW VERSIONS IN APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE;

ALTER APPLICATION PACKAGE SUPPLIER_PORTAL_APP_PACKAGE
  SET DEFAULT RELEASE DIRECTIVE
  VERSION = v1
  PATCH = 0;
