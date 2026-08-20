-- ============================================================
-- Baby Mart Supply Chain Demo — supplier vs distributor dimensions
--
-- IMPORTANT: an earlier version of this script did
--   CREATE OR REPLACE TABLE ... DIM_SUPPLIER (SUPPLIER_ID, BRANDS, ...)
-- which CLOBBERED the original 25-row product-supplier dimension and broke
-- every /vendor page (they join DIM_PRODUCT.SUPPLIER_KEY = s.SUPPLIER_KEY,
-- which then failed with "invalid identifier 'S.SUPPLIER_KEY'").
--
-- These are two different concepts and now live in two tables:
--   DIM_SUPPLIER     25 product suppliers, keyed SUPPLIER_KEY  -> /vendor pages
--   DIM_DISTRIBUTOR  10 logistics distributors                 -> /replenishment
--
-- DIM_SUPPLIER rows below are reproduced verbatim from the SUPPLIERS constant
-- in retailer/data_generation/01_generate_dimensions.py, which remains the
-- source of truth. Do not add logistics columns to DIM_SUPPLIER.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.CURATED;

-- ---------- Product suppliers (restored original schema) ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.CURATED.DIM_SUPPLIER (
    SUPPLIER_KEY   INT,
    SUPPLIER_NAME  VARCHAR(100),
    SUPPLIER_CODE  VARCHAR(20),
    CONTACT_NAME   VARCHAR(100),
    CONTACT_EMAIL  VARCHAR(200),
    PAYMENT_TERMS  VARCHAR(20),
    LEAD_TIME_DAYS INT
);

INSERT INTO BABY_MART_DEMO.CURATED.DIM_SUPPLIER VALUES
(1, 'Bugaboo Australia', 'SUP001', 'James Wright', 'james@bugaboo.com.au', 'Net 30', 21),
(2, 'Uppababy ANZ', 'SUP002', 'Sarah Chen', 'sarah@uppababy.com.au', 'Net 30', 28),
(3, 'Silver Cross AU', 'SUP003', 'Michael Brown', 'michael@silvercross.com.au', 'Net 45', 35),
(4, 'Babyzen Pacific', 'SUP004', 'Lucy Kim', 'lucy@babyzen.com.au', 'Net 30', 42),
(5, 'Mountain Buggy', 'SUP005', 'Tom Wilson', 'tom@mountainbuggy.co.nz', 'Net 30', 14),
(6, 'Maxi-Cosi (Dorel)', 'SUP006', 'Emma Davis', 'emma@dorel.com.au', 'Net 30', 21),
(7, 'Britax Australia', 'SUP007', 'David Lee', 'david@britax.com.au', 'Net 30', 14),
(8, 'Cybex (Goodbaby)', 'SUP008', 'Anna Muller', 'anna@cybex.com.au', 'Net 45', 42),
(9, 'Nuna Baby', 'SUP009', 'Rachel Green', 'rachel@nunababy.com.au', 'Net 30', 35),
(10, 'Infasecure', 'SUP010', 'Mark Thompson', 'mark@infasecure.com.au', 'Net 14', 7),
(11, 'Kimberly-Clark (Huggies)', 'SUP011', 'Paul Anderson', 'paul@kca.com.au', 'Net 30', 7),
(12, 'P&G (Pampers)', 'SUP012', 'Nicole Wang', 'nicole@pg.com.au', 'Net 30', 7),
(13, 'Rascal + Friends', 'SUP013', 'Jack Morrison', 'jack@rascalfriends.com.au', 'Net 30', 14),
(14, 'Tooshies by TOM', 'SUP014', 'Hannah Scott', 'hannah@tooshies.com.au', 'Net 14', 7),
(15, 'ECO by Naty', 'SUP015', 'Erik Lindgren', 'erik@naty.com', 'Net 45', 56),
(16, 'Hanesbrands (Bonds Baby)', 'SUP016', 'Chris Martin', 'chris@hanes.com.au', 'Net 30', 14),
(17, 'Purebaby', 'SUP017', 'Miriam Katz', 'miriam@purebaby.com.au', 'Net 14', 7),
(18, 'Cotton On Group', 'SUP018', 'Tim Fletcher', 'tim@cottonon.com.au', 'Net 14', 7),
(19, 'Marquise', 'SUP019', 'Sophie Laurent', 'sophie@marquise.com.au', 'Net 30', 14),
(20, 'Bebe by Minihaha', 'SUP020', 'Grace Chen', 'grace@minihaha.com.au', 'Net 30', 14),
(21, 'Philips (Avent)', 'SUP021', 'Robert Hill', 'robert@philips.com.au', 'Net 30', 21),
(22, 'Mayborn (Tommee Tippee)', 'SUP022', 'Jessica Park', 'jessica@mayborn.com.au', 'Net 30', 21),
(23, 'Handi-Craft (Dr Browns)', 'SUP023', 'Andrew Kim', 'andrew@handi-craft.com.au', 'Net 45', 35),
(24, 'Pigeon Australia', 'SUP024', 'Yuki Tanaka', 'yuki@pigeon.com.au', 'Net 30', 28),
(25, 'NUK (Mapa)', 'SUP025', 'Stefan Weber', 'stefan@nuk.com.au', 'Net 45', 42);
-- ---------- Logistics distributors (the supply-chain overlay) ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR (
    DISTRIBUTOR_ID      INT,
    -- Deliberately SUPPLIER_NAME, not DISTRIBUTOR_NAME: the fact table
    -- FORECAST_REPLENISHMENT_SUPPLIER_DC already stores distributor names in a
    -- SUPPLIER_NAME column, so matching it keeps the joins and the API response
    -- shape unchanged.
    SUPPLIER_NAME       VARCHAR(100),
    BRANDS              VARCHAR(500),
    STD_LEAD_TIME_DAYS  INT,
    SOURCING_TYPE       VARCHAR(20),
    IS_3PL_VIABLE       BOOLEAN,
    PRIMARY_CARRIER     VARCHAR(50),
    TRANSPORT_MODE      VARCHAR(20),
    ESTIMATED_3PL_DAYS  INT
);

INSERT INTO BABY_MART_DEMO.CURATED.DIM_DISTRIBUTOR VALUES
(1,  'Dorel Australia',      'Maxi-Cosi,Nuna,Cybex',                    21, 'International', TRUE,  'DHL',       'Sea+Road', 14),
(2,  'Bugaboo Pacific',      'Bugaboo,Babyzen',                         28, 'International', TRUE,  'DHL',       'Sea+Road', 18),
(3,  'Kimberly-Clark ANZ',   'Huggies,Pampers',                          7, 'Domestic',      FALSE, 'Toll',      'Road',      5),
(4,  'Uppababy Pacific',     'Uppababy,Silver Cross,Mountain Buggy',    28, 'International', TRUE,  'DHL',       'Sea+Road', 18),
(5,  'Hanes Pacific',        'Bonds Baby,Cotton On Baby,Purebaby',      10, 'Domestic',      FALSE, 'StarTrack', 'Road',      7),
(6,  'Philips ANZ',          'Avent,Pigeon,Tommee Tippee',              21, 'Mixed',         TRUE,  'Toll',      'Air+Road', 12),
(7,  'Rascal & Co',          'Rascal + Friends,Tooshies,ECO by Naty',   14, 'Domestic',      FALSE, 'StarTrack', 'Road',      9),
(8,  'Britax Group',         'Britax,Infasecure',                       14, 'Domestic',      FALSE, 'Toll',      'Road',      9),
(9,  'Premium Brands AU',    'Marquise,Bebe',                           14, 'Domestic',      FALSE, 'StarTrack', 'Road',     10),
(10, 'Feeding Solutions',    'Dr Browns,NUK',                           35, 'International', TRUE,  'DHL',       'Sea+Road', 21);
