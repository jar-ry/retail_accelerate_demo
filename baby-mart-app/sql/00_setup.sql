-- ============================================================
-- Baby Mart Supply Chain Demo — Setup
-- Run this first to ensure schemas and warehouses exist
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;

-- Ensure schemas exist
CREATE SCHEMA IF NOT EXISTS BABY_MART_DEMO.ANALYTICS;
CREATE SCHEMA IF NOT EXISTS BABY_MART_DEMO.CURATED;

USE SCHEMA BABY_MART_DEMO.ANALYTICS;
