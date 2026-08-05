-- ============================================================
-- Baby Mart Supply Chain Demo — Distributor Restructure
-- Merges 25 brands into 10 distributors with logistics metadata
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.CURATED;

CREATE OR REPLACE TABLE BABY_MART_DEMO.CURATED.DIM_SUPPLIER (
    SUPPLIER_ID INT,
    SUPPLIER_NAME VARCHAR(100),
    BRANDS VARCHAR(500),
    STD_LEAD_TIME_DAYS INT,
    SOURCING_TYPE VARCHAR(20),
    IS_3PL_VIABLE BOOLEAN,
    PRIMARY_CARRIER VARCHAR(50),
    TRANSPORT_MODE VARCHAR(20),
    ESTIMATED_3PL_DAYS INT
);

INSERT INTO BABY_MART_DEMO.CURATED.DIM_SUPPLIER VALUES
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
