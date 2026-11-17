-- ============================================================
-- OneDigital — synthetic multi-banner base data (od_10)
--
-- 150,000 OnePass members shopping across Bunnings, Kmart and Officeworks from
-- 1 Nov 2024 to 13 Nov 2026. Everything here is SYNTHETIC: generated with HASH
-- draws (no RANDOM()), so a rebuild produces the same customers, baskets and
-- dates, and a figure an agent quotes still matches the screen.
--
-- WHAT IS PLANTED. Each customer has a hidden household truth (CUSTOMER_TRUTH),
-- used only to generate purchases and to check the features in od_40 recover
-- it. Nothing downstream that an agent or the app reads exposes it.
--   Trade      STARTER      starts a trade business on BIZ_START_DATE: a burst of
--                           trade tools, ladders, storage, PPE and consumables
--                           at Bunnings within ~6 weeks, with no trade history
--                           before. 35% started in Jan-Mar 2026, 45% between
--                           20 Jul and 5 Nov 2026.
--              ESTABLISHED  a working tradie: trade buying every 2-3 weeks for the
--                           whole two years, and most already buy ink, paper and
--                           print at Officeworks.
--              DIY          a keen DIYer: garden, paint, the odd power tool.
--   Kids       SCHOOL       school-age children (1-3). Kmart school shoes each
--                           January, sneakers through the year, uniforms,
--                           lunchboxes and bags at the start of the school year.
--              TODDLER      one child aged 1-3: toddler shoe sizes only.
--              GIFT         a grandparent: one pair of kids' shoes and toys in
--                           December.
--   Officeworks  shoppers, business buyers, school list service users (Jan 2025,
--              Jan 2026), and starters who find Officeworks on their own.
--
-- KIDS' SHOE SIZES are a deliberately imperfect proxy: a size maps to an age
-- range, not an age (noise of a size either way), one child growing through
-- two sizes in a year looks like two children, and a gift looks like a child.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE OD_WH;

CREATE DATABASE IF NOT EXISTS ONEDIGITAL_DEMO;
CREATE SCHEMA IF NOT EXISTS ONEDIGITAL_DEMO.CURATED
  COMMENT = 'OneDigital synthetic OnePass-linked purchases across Bunnings, Kmart and Officeworks. AUD.';
USE SCHEMA ONEDIGITAL_DEMO.CURATED;

CREATE OR REPLACE TABLE NUMS AS
SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS N FROM TABLE(GENERATOR(ROWCOUNT => 200));

-- ---------- Calendar ----------
CREATE OR REPLACE TABLE DIM_DATE COMMENT = 'Calendar, 1 Nov 2024 to 13 Nov 2026 (the demo clock).' AS
WITH d AS (SELECT DATEADD('day', ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, '2024-11-01'::DATE) AS D FROM TABLE(GENERATOR(ROWCOUNT => 743)))
SELECT TO_NUMBER(TO_CHAR(D, 'YYYYMMDD')) AS DATE_KEY, D AS CALENDAR_DATE, DAYOFWEEKISO(D) AS DAY_OF_WEEK,
       DATE_TRUNC('week', D) AS WEEK_START, DATE_TRUNC('month', D) AS MONTH_START, YEAR(D) AS CAL_YEAR
FROM d WHERE D <= '2026-11-13'::DATE;

-- Term 1 start dates (students' first day) by state. Approximate, for the demo:
-- the back-to-school window is measured from these.
CREATE OR REPLACE TABLE DIM_SCHOOL_TERM (
  STATE VARCHAR, SCHOOL_YEAR NUMBER, TERM NUMBER, START_DATE DATE
) COMMENT = 'Term 1 start dates by state (approximate, demo data). Back-to-school timing is measured from these.';
INSERT INTO DIM_SCHOOL_TERM VALUES
  ('NSW', 2025, 1, '2025-02-06'), ('VIC', 2025, 1, '2025-01-30'), ('QLD', 2025, 1, '2025-01-28'), ('WA', 2025, 1, '2025-02-05'),
  ('SA',  2025, 1, '2025-01-29'), ('TAS', 2025, 1, '2025-02-05'), ('ACT', 2025, 1, '2025-02-04'), ('NT', 2025, 1, '2025-01-29'),
  ('NSW', 2026, 1, '2026-02-02'), ('VIC', 2026, 1, '2026-01-28'), ('QLD', 2026, 1, '2026-01-27'), ('WA', 2026, 1, '2026-02-02'),
  ('SA',  2026, 1, '2026-01-28'), ('TAS', 2026, 1, '2026-02-04'), ('ACT', 2026, 1, '2026-02-02'), ('NT', 2026, 1, '2026-01-28'),
  ('NSW', 2027, 1, '2027-02-01'), ('VIC', 2027, 1, '2027-01-27'), ('QLD', 2027, 1, '2027-01-27'), ('WA', 2027, 1, '2027-02-01'),
  ('SA',  2027, 1, '2027-01-27'), ('TAS', 2027, 1, '2027-02-03'), ('ACT', 2027, 1, '2027-02-01'), ('NT', 2027, 1, '2027-01-27');

-- ---------- Banners and stores ----------
CREATE OR REPLACE TABLE DIM_BANNER (
  BANNER_CODE VARCHAR PRIMARY KEY, BANNER_NAME VARCHAR, BANNER_IDX NUMBER, STORE_PREFIX VARCHAR, DESCRIPTION VARCHAR
) COMMENT = 'The three retail banners linked by OnePass.';
INSERT INTO DIM_BANNER VALUES
  ('BUNNINGS', 'Bunnings', 1, 'BUN', 'Home improvement, garden and trade'),
  ('KMART', 'Kmart', 2, 'KMT', 'General merchandise: home, apparel, kids and school'),
  ('OFFICEWORKS', 'Officeworks', 3, 'OWK', 'Office, technology, print and copy, education');

CREATE OR REPLACE TABLE DIM_SUBURB (STATE VARCHAR, SUBURB_IDX NUMBER, SUBURB VARCHAR);
INSERT INTO DIM_SUBURB VALUES
  ('NSW', 1, 'Parramatta'), ('NSW', 2, 'Penrith'), ('NSW', 3, 'Chatswood'), ('NSW', 4, 'Liverpool'), ('NSW', 5, 'Castle Hill'),
  ('NSW', 6, 'Hornsby'), ('NSW', 7, 'Campbelltown'), ('NSW', 8, 'Bankstown'), ('NSW', 9, 'Newcastle'), ('NSW', 10, 'Wollongong'),
  ('NSW', 11, 'Gosford'), ('NSW', 12, 'Alexandria'),
  ('VIC', 1, 'Richmond'), ('VIC', 2, 'Box Hill'), ('VIC', 3, 'Dandenong'), ('VIC', 4, 'Frankston'), ('VIC', 5, 'Sunshine'),
  ('VIC', 6, 'Epping'), ('VIC', 7, 'Ringwood'), ('VIC', 8, 'Geelong'), ('VIC', 9, 'Ballarat'), ('VIC', 10, 'Craigieburn'),
  ('QLD', 1, 'Fortitude Valley'), ('QLD', 2, 'Chermside'), ('QLD', 3, 'Carindale'), ('QLD', 4, 'Springwood'), ('QLD', 5, 'Ipswich'),
  ('QLD', 6, 'Southport'), ('QLD', 7, 'Townsville'), ('QLD', 8, 'Toowoomba'),
  ('WA', 1, 'Osborne Park'), ('WA', 2, 'Joondalup'), ('WA', 3, 'Cannington'), ('WA', 4, 'Rockingham'), ('WA', 5, 'Midland'),
  ('SA', 1, 'Mile End'), ('SA', 2, 'Marion'), ('SA', 3, 'Elizabeth'),
  ('TAS', 1, 'Hobart'), ('ACT', 1, 'Fyshwick'), ('NT', 1, 'Darwin');

CREATE OR REPLACE TABLE DIM_STORE COMMENT = 'One store per banner in each of 41 suburbs.' AS
SELECT b.BANNER_IDX * 1000 + ROW_NUMBER() OVER (PARTITION BY b.BANNER_CODE ORDER BY s.STATE, s.SUBURB_IDX) AS STORE_KEY,
       b.STORE_PREFIX || '-' || s.STATE || '-' || LPAD(s.SUBURB_IDX::VARCHAR, 2, '0') AS STORE_CODE,
       b.BANNER_NAME || ' ' || s.SUBURB AS STORE_NAME, b.BANNER_CODE AS BANNER, s.STATE, s.SUBURB, s.SUBURB_IDX
FROM DIM_BANNER b CROSS JOIN DIM_SUBURB s;

-- ---------- Products ----------
-- PICK_GROUP is what the generator draws from: a class, or a class and trade
-- for the trade-specific tools and consumables.
CREATE OR REPLACE TABLE STG_PRODUCT (
  BANNER VARCHAR, CATEGORY VARCHAR, CLASS VARCHAR, TRADE_TYPE VARCHAR, PRODUCT_NAME VARCHAR, BRAND VARCHAR,
  UNIT_PRICE NUMBER(10,2), MARGIN_RATE FLOAT, IS_TRADE BOOLEAN
);
INSERT INTO STG_PRODUCT VALUES
  -- Bunnings: trade
  ('BUNNINGS', 'Trade Tools', 'Trade Power Tools', NULL, 'Makita 18V Brushless Combo Kit 6pc', 'Makita', 1099, 0.24, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Power Tools', NULL, 'Milwaukee M18 FUEL Combo Kit 5pc', 'Milwaukee', 1249, 0.24, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Power Tools', NULL, 'DeWalt 18V XR Combo Kit 4pc', 'DeWalt', 999, 0.24, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Specialist Tools', 'Electrical', 'Fluke Multimeter and Cable Tester Kit', 'Fluke', 489, 0.28, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Specialist Tools', 'Plumbing', 'Ridgid Pipe Cutter and Flaring Kit', 'Ridgid', 389, 0.28, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Specialist Tools', 'Carpentry', 'Makita Plunge Saw and Track Kit', 'Makita', 789, 0.26, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Specialist Tools', 'Landscaping', 'Trade Concrete Mixer 120L', 'Ozito Pro', 549, 0.26, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Specialist Tools', 'Cleaning', 'Karcher Commercial Pressure Washer', 'Karcher', 999, 0.26, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Ladders', NULL, 'Gorilla 2.4m Industrial Platform Ladder 150kg', 'Gorilla', 399, 0.30, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Trade Ladders', NULL, 'Bailey 3.8m Pro Extension Ladder', 'Bailey', 459, 0.30, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Tool Storage & Transport', NULL, 'Aluminium Ute Tool Box', 'Trade Pro', 599, 0.30, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Tool Storage & Transport', NULL, 'Rolling Tool Chest 7-Drawer', 'Trade Pro', 449, 0.30, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Tool Storage & Transport', NULL, 'Box Trailer 7x4', 'Trade Pro', 1690, 0.18, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Workwear & PPE', NULL, 'Hi-Vis Work Shirt 3-Pack', 'KingGee', 69, 0.40, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Workwear & PPE', NULL, 'Steel Cap Work Boots', 'Steel Blue', 149, 0.35, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Workwear & PPE', NULL, 'Safety Glasses 12-Pack', 'Prochoice', 29, 0.45, TRUE),
  ('BUNNINGS', 'Trade Tools', 'Workwear & PPE', NULL, 'Class 5 Ear Muffs', '3M', 45, 0.42, TRUE),
  ('BUNNINGS', 'Trade Supplies', 'Trade Consumables', 'Electrical', 'Twin and Earth Cable 2.5mm 100m', 'Olex', 189, 0.22, TRUE),
  ('BUNNINGS', 'Trade Supplies', 'Trade Consumables', 'Plumbing', 'PVC Pressure Pipe 6m 10-Pack', 'Holman', 129, 0.24, TRUE),
  ('BUNNINGS', 'Trade Supplies', 'Trade Consumables', 'Carpentry', 'Treated Pine 90x45 6m 10-Pack', 'Pinepro', 159, 0.22, TRUE),
  ('BUNNINGS', 'Trade Supplies', 'Trade Consumables', 'Landscaping', 'Turf Underlay Bulk Bag 1t', 'Earthwise', 119, 0.26, TRUE),
  ('BUNNINGS', 'Trade Supplies', 'Trade Consumables', 'Cleaning', 'Commercial Degreaser 20L', 'Septone', 89, 0.32, TRUE),
  -- Bunnings: DIY, garden, outdoor
  ('BUNNINGS', 'Garden', 'Garden', NULL, 'Premium Potting Mix 25L', 'Scotts', 12, 0.35, FALSE),
  ('BUNNINGS', 'Garden', 'Garden', NULL, 'Garden Hose 30m', 'Pope', 49, 0.35, FALSE),
  ('BUNNINGS', 'Garden', 'Garden', NULL, 'Lawn Fertiliser 10kg', 'Searles', 39, 0.35, FALSE),
  ('BUNNINGS', 'Garden', 'Garden', NULL, 'Native Plant 140mm', 'Bunnings Garden', 15, 0.45, FALSE),
  ('BUNNINGS', 'Paint & Decor', 'Paint & Decor', NULL, 'Interior Low Sheen Paint 10L', 'Taubmans', 129, 0.34, FALSE),
  ('BUNNINGS', 'Paint & Decor', 'Paint & Decor', NULL, 'Paint Roller and Tray Kit', 'Uni-Pro', 25, 0.40, FALSE),
  ('BUNNINGS', 'DIY Tools', 'DIY Tools', NULL, 'Ozito 18V Drill Driver Kit', 'Ozito', 79, 0.30, FALSE),
  ('BUNNINGS', 'DIY Tools', 'DIY Tools', NULL, 'Ryobi ONE+ 18V Drill Kit', 'Ryobi', 159, 0.30, FALSE),
  ('BUNNINGS', 'DIY Tools', 'DIY Tools', NULL, 'Aluminium Step Ladder 3-Step', 'Gorilla', 89, 0.32, FALSE),
  ('BUNNINGS', 'Hardware', 'Hardware', NULL, 'Assorted Screws 200pc', 'Zenith', 15, 0.45, FALSE),
  ('BUNNINGS', 'Hardware', 'Hardware', NULL, 'Wall Hooks 10-Pack', 'Zenith', 9, 0.45, FALSE),
  ('BUNNINGS', 'Hardware', 'Hardware', NULL, 'Door Hinges 2-Pack', 'Carbine', 12, 0.45, FALSE),
  ('BUNNINGS', 'BBQ & Outdoor', 'BBQ & Outdoor', NULL, 'Weber Q BBQ', 'Weber', 449, 0.26, FALSE),
  ('BUNNINGS', 'BBQ & Outdoor', 'BBQ & Outdoor', NULL, 'Outdoor Setting 5pc', 'Marquee', 399, 0.30, FALSE),
  ('BUNNINGS', 'BBQ & Outdoor', 'BBQ & Outdoor', NULL, 'Gas Bottle Swap 9kg', 'Swap''n''Go', 32, 0.20, FALSE),
  -- Kmart: kids' footwear (the line carries the shoe size), school, kids
  ('KMART', 'Kids Footwear', 'Kids School Shoes', NULL, 'Kids Black Leather School Shoes', 'Anko', 25, 0.38, FALSE),
  ('KMART', 'Kids Footwear', 'Kids Sneakers', NULL, 'Kids Runner Sneakers', 'Anko', 15, 0.40, FALSE),
  ('KMART', 'Kids Footwear', 'Toddler Shoes', NULL, 'Toddler First Walker Shoes', 'Anko', 12, 0.40, FALSE),
  ('KMART', 'School', 'School Uniform', NULL, 'School Polo 2-Pack', 'Anko', 8, 0.40, FALSE),
  ('KMART', 'School', 'School Uniform', NULL, 'School Shorts', 'Anko', 8, 0.40, FALSE),
  ('KMART', 'School', 'School Uniform', NULL, 'School Check Dress', 'Anko', 10, 0.40, FALSE),
  ('KMART', 'School', 'Lunch & Drink', NULL, 'Bento Lunchbox', 'Anko', 6, 0.45, FALSE),
  ('KMART', 'School', 'Lunch & Drink', NULL, 'Insulated Drink Bottle 500ml', 'Anko', 8, 0.45, FALSE),
  ('KMART', 'School', 'School Bags', NULL, 'Kids School Backpack', 'Anko', 15, 0.42, FALSE),
  ('KMART', 'Kids', 'Toys', NULL, 'Building Bricks Set 500pc', 'Anko', 25, 0.38, FALSE),
  ('KMART', 'Kids', 'Toys', NULL, 'Plush Toy', 'Anko', 8, 0.45, FALSE),
  ('KMART', 'Kids', 'Toys', NULL, 'Kids Art Kit', 'Anko', 12, 0.42, FALSE),
  ('KMART', 'Kids', 'Kids Apparel', NULL, 'Kids Pyjama Set', 'Anko', 10, 0.42, FALSE),
  ('KMART', 'Kids', 'Kids Apparel', NULL, 'Kids Tee 3-Pack', 'Anko', 10, 0.42, FALSE),
  -- Kmart: home and apparel
  ('KMART', 'Home', 'Homewares', NULL, 'Textured Cushion', 'Anko', 8, 0.48, FALSE),
  ('KMART', 'Home', 'Homewares', NULL, 'Knit Throw Rug', 'Anko', 15, 0.46, FALSE),
  ('KMART', 'Home', 'Homewares', NULL, 'Woven Storage Basket', 'Anko', 10, 0.46, FALSE),
  ('KMART', 'Home', 'Homewares', NULL, 'Dinner Set 12pc', 'Anko', 29, 0.42, FALSE),
  ('KMART', 'Home', 'Home Office', NULL, 'Study Desk', 'Anko', 79, 0.36, FALSE),
  ('KMART', 'Home', 'Home Office', NULL, 'Task Office Chair', 'Anko', 59, 0.36, FALSE),
  ('KMART', 'Home', 'Home Office', NULL, 'LED Desk Lamp', 'Anko', 15, 0.44, FALSE),
  ('KMART', 'Apparel', 'Womens Apparel', NULL, 'Womens Organic Cotton Tee', 'Anko', 8, 0.48, FALSE),
  ('KMART', 'Apparel', 'Womens Apparel', NULL, 'Womens Straight Jeans', 'Anko', 25, 0.44, FALSE),
  ('KMART', 'Apparel', 'Mens Apparel', NULL, 'Mens Crew Tee', 'Anko', 8, 0.48, FALSE),
  ('KMART', 'Apparel', 'Mens Apparel', NULL, 'Mens Cargo Shorts', 'Anko', 15, 0.44, FALSE),
  -- Officeworks
  ('OFFICEWORKS', 'Technology', 'Laptops', NULL, 'HP 14in Laptop Core i5 16GB', 'HP', 899, 0.10, FALSE),
  ('OFFICEWORKS', 'Technology', 'Laptops', NULL, 'Lenovo ThinkPad E14 Gen 6', 'Lenovo', 1299, 0.10, FALSE),
  ('OFFICEWORKS', 'Technology', 'Laptops', NULL, 'Apple MacBook Air 13in M3', 'Apple', 1699, 0.08, FALSE),
  ('OFFICEWORKS', 'Technology', 'Printers', NULL, 'Brother Mono Laser Printer HL-L2460DW', 'Brother', 249, 0.15, FALSE),
  ('OFFICEWORKS', 'Technology', 'Printers', NULL, 'HP OfficeJet Pro 9130 Multifunction', 'HP', 349, 0.15, FALSE),
  ('OFFICEWORKS', 'Technology', 'Ink & Toner', NULL, 'HP 962XL Ink Multipack', 'HP', 129, 0.35, FALSE),
  ('OFFICEWORKS', 'Technology', 'Ink & Toner', NULL, 'Brother TN2450 Toner', 'Brother', 109, 0.35, FALSE),
  ('OFFICEWORKS', 'Technology', 'Tech Accessories', NULL, 'Logitech Wireless Mouse', 'Logitech', 39, 0.40, FALSE),
  ('OFFICEWORKS', 'Technology', 'Tech Accessories', NULL, 'USB-C 7-in-1 Hub', 'J.Burrows', 69, 0.42, FALSE),
  ('OFFICEWORKS', 'Technology', 'Tech Accessories', NULL, 'Laptop Sleeve 14in', 'J.Burrows', 35, 0.45, FALSE),
  ('OFFICEWORKS', 'Print & Signage', 'Business Cards', NULL, 'Premium Business Cards 250', 'Officeworks Print', 49, 0.55, FALSE),
  ('OFFICEWORKS', 'Print & Signage', 'Signage', NULL, 'Corflute Sign A1', 'Officeworks Print', 89, 0.50, FALSE),
  ('OFFICEWORKS', 'Print & Signage', 'Signage', NULL, 'Vehicle Magnet Signs Pair', 'Officeworks Print', 99, 0.50, FALSE),
  ('OFFICEWORKS', 'Print & Signage', 'Signage', NULL, 'Pull-Up Banner 850mm', 'Officeworks Print', 179, 0.50, FALSE),
  ('OFFICEWORKS', 'Print & Signage', 'Flyers', NULL, 'Flyers A5 500', 'Officeworks Print', 99, 0.50, FALSE),
  ('OFFICEWORKS', 'School', 'School List Service', NULL, 'School List Order', 'Officeworks', 160, 0.28, FALSE),
  ('OFFICEWORKS', 'School', 'Stationery Packs', NULL, 'Back to School Stationery Pack', 'J.Burrows', 35, 0.45, FALSE),
  ('OFFICEWORKS', 'School', 'Stationery Packs', NULL, 'Casio Scientific Calculator', 'Casio', 29, 0.30, FALSE),
  ('OFFICEWORKS', 'Stationery & Paper', 'Paper', NULL, 'A4 Copy Paper 5 Ream', 'Reflex', 29, 0.25, FALSE),
  ('OFFICEWORKS', 'Stationery & Paper', 'Stationery', NULL, 'Ballpoint Pens 10-Pack', 'Bic', 9, 0.45, FALSE),
  ('OFFICEWORKS', 'Stationery & Paper', 'Stationery', NULL, 'A4 Notebooks 5-Pack', 'J.Burrows', 12, 0.45, FALSE),
  ('OFFICEWORKS', 'Stationery & Paper', 'Stationery', NULL, 'Lever Arch Folders 4-Pack', 'J.Burrows', 18, 0.45, FALSE),
  ('OFFICEWORKS', 'Furniture', 'Office Chairs', NULL, 'Ergonomic Mesh Office Chair', 'Otto', 299, 0.38, FALSE),
  ('OFFICEWORKS', 'Furniture', 'Desks', NULL, 'Electric Height Adjustable Desk', 'Otto', 499, 0.36, FALSE);

CREATE OR REPLACE TABLE DIM_PRODUCT COMMENT = 'Products of the three banners. IS_TRADE marks the trade range whose cluster signals a new business.' AS
SELECT ROW_NUMBER() OVER (ORDER BY BANNER, CATEGORY, CLASS, PRODUCT_NAME) AS PRODUCT_KEY,
       BANNER, CATEGORY, CLASS, TRADE_TYPE, PRODUCT_NAME, BRAND, UNIT_PRICE, MARGIN_RATE, IS_TRADE,
       CLASS || COALESCE('|' || TRADE_TYPE, '') AS PICK_GROUP,
       ROW_NUMBER() OVER (PARTITION BY BANNER, CLASS || COALESCE('|' || TRADE_TYPE, '') ORDER BY PRODUCT_NAME) AS GROUP_IDX,
       COUNT(*) OVER (PARTITION BY BANNER, CLASS || COALESCE('|' || TRADE_TYPE, '')) AS GROUP_N
FROM STG_PRODUCT;
DROP TABLE STG_PRODUCT;

-- ---------- Household truth (hidden) ----------
CREATE OR REPLACE TABLE CUSTOMER_TRUTH
  COMMENT = 'CONSTRUCTION TRUTH for the synthetic data: what each household really is. Used to generate purchases and to check the features recover it. Never exposed to the app or the agents.'
AS
WITH g AS (SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) AS K FROM TABLE(GENERATOR(ROWCOUNT => 150000))),
u AS (
  SELECT K,
         (ABS(HASH(K, 'state')) % 1000000) / 1e6 AS U_STATE, (ABS(HASH(K, 'sub')) % 1000000) / 1e6 AS U_SUB,
         (ABS(HASH(K, 'trade')) % 1000000) / 1e6 AS U_TRADE, (ABS(HASH(K, 'kids')) % 1000000) / 1e6 AS U_KIDS,
         (ABS(HASH(K, 'cohort')) % 1000000) / 1e6 AS U_COHORT, (ABS(HASH(K, 'cday')) % 1000000) / 1e6 AS U_CDAY,
         (ABS(HASH(K, 'spec')) % 1000000) / 1e6 AS U_SPEC, (ABS(HASH(K, 'age')) % 1000000) / 1e6 AS U_AGE,
         (ABS(HASH(K, 'nkids')) % 1000000) / 1e6 AS U_NKIDS, (ABS(HASH(K, 'kage')) % 1000000) / 1e6 AS U_KAGE,
         (ABS(HASH(K, 'kgap1')) % 1000000) / 1e6 AS U_GAP1, (ABS(HASH(K, 'kgap2')) % 1000000) / 1e6 AS U_GAP2,
         (ABS(HASH(K, 'ow')) % 1000000) / 1e6 AS U_OW, (ABS(HASH(K, 'owb')) % 1000000) / 1e6 AS U_OWB,
         (ABS(HASH(K, 'adopt')) % 1000000) / 1e6 AS U_ADOPT, (ABS(HASH(K, 'adday')) % 1000000) / 1e6 AS U_ADDAY,
         (ABS(HASH(K, 'l25')) % 1000000) / 1e6 AS U_L25, (ABS(HASH(K, 'l26')) % 1000000) / 1e6 AS U_L26,
         (ABS(HASH(K, 'kmt')) % 1000000) / 1e6 AS U_KMT, (ABS(HASH(K, 'bun')) % 1000000) / 1e6 AS U_BUN,
         (ABS(HASH(K, 'tech')) % 1000000) / 1e6 AS U_TECH, (ABS(HASH(K, 'wfh')) % 1000000) / 1e6 AS U_WFH,
         (ABS(HASH(K, 'seg')) % 1000000) / 1e6 AS U_SEG, (ABS(HASH(K, 'member')) % 1000000) / 1e6 AS U_MEMBER,
         (ABS(HASH(K, 'gender')) % 1000000) / 1e6 AS U_GENDER
  FROM g
), t AS (
  SELECT u.*,
         CASE WHEN U_STATE < 0.32 THEN 'NSW' WHEN U_STATE < 0.58 THEN 'VIC' WHEN U_STATE < 0.78 THEN 'QLD' WHEN U_STATE < 0.88 THEN 'WA'
              WHEN U_STATE < 0.95 THEN 'SA' WHEN U_STATE < 0.97 THEN 'TAS' WHEN U_STATE < 0.99 THEN 'ACT' ELSE 'NT' END AS STATE,
         CASE WHEN U_TRADE < 0.030 THEN 'STARTER' WHEN U_TRADE < 0.055 THEN 'ESTABLISHED' WHEN U_TRADE < 0.175 THEN 'DIY' ELSE 'NONE' END AS TRADE_TRUTH,
         CASE WHEN U_KIDS < 0.22 THEN 'SCHOOL' WHEN U_KIDS < 0.30 THEN 'TODDLER' WHEN U_KIDS < 0.36 THEN 'GIFT' ELSE 'NONE' END AS KIDS_TRUTH
  FROM u
)
SELECT K AS CUSTOMER_KEY, STATE,
       FLOOR(U_SUB * DECODE(STATE, 'NSW', 12, 'VIC', 10, 'QLD', 8, 'WA', 5, 'SA', 3, 1)) + 1 AS HOME_SUBURB_IDX,
       DECODE(STATE, 'NSW', 12, 'VIC', 10, 'QLD', 8, 'WA', 5, 'SA', 3, 1) AS STATE_SUBURBS,
       TRADE_TRUTH,
       CASE WHEN TRADE_TRUTH IN ('STARTER', 'ESTABLISHED') THEN
         DECODE(FLOOR(U_SPEC * 5), 0, 'Electrical', 1, 'Plumbing', 2, 'Carpentry', 3, 'Landscaping', 'Cleaning') END AS TRADE_SPECIALTY,
       CASE WHEN TRADE_TRUTH = 'STARTER' THEN
         CASE WHEN U_COHORT < 0.15 THEN DATEADD('day', FLOOR(U_CDAY * 300), '2025-03-01'::DATE)
              WHEN U_COHORT < 0.50 THEN DATEADD('day', FLOOR(U_CDAY * 60), '2026-01-10'::DATE)
              WHEN U_COHORT < 0.55 THEN DATEADD('day', FLOOR(U_CDAY * 120), '2026-03-20'::DATE)
              ELSE DATEADD('day', FLOOR(U_CDAY * 108), '2026-07-20'::DATE) END END AS BIZ_START_DATE,
       KIDS_TRUTH,
       CASE WHEN KIDS_TRUTH = 'SCHOOL' THEN IFF(U_NKIDS < 0.45, 1, IFF(U_NKIDS < 0.85, 2, 3)) WHEN KIDS_TRUTH = 'TODDLER' THEN 1 ELSE 0 END AS NUM_KIDS,
       -- Youngest child's age on 13 Nov 2026, and the gaps to older siblings.
       CASE WHEN KIDS_TRUTH = 'SCHOOL' THEN 3.8 + U_KAGE * 7.7 WHEN KIDS_TRUTH = 'TODDLER' THEN 1.0 + U_KAGE * 2.2 END AS YOUNGEST_AGE,
       2.0 + U_GAP1 * 2.5 AS GAP1, 1.5 + U_GAP2 * 2.5 AS GAP2,
       CASE WHEN KIDS_TRUTH IN ('SCHOOL', 'TODDLER') THEN U_KMT < 0.95 WHEN KIDS_TRUTH = 'GIFT' THEN U_KMT < 0.90 ELSE U_KMT < 0.62 END AS SHOPS_KMART,
       TRADE_TRUTH <> 'NONE' OR U_BUN < 0.50 AS SHOPS_BUNNINGS,
       U_OW < 0.40 OR (KIDS_TRUTH = 'SCHOOL' AND U_OW < 0.62) OR (TRADE_TRUTH = 'ESTABLISHED' AND U_OW < 0.92)
         OR (TRADE_TRUTH = 'STARTER' AND U_OW < 0.45) AS SHOPS_OFFICEWORKS,
       (TRADE_TRUTH = 'ESTABLISHED' AND U_OWB < 0.70) OR (TRADE_TRUTH IN ('NONE', 'DIY') AND U_OWB < 0.03) AS OW_BUSINESS_BUYER,
       -- Starters who find Officeworks on their own, some weeks after starting.
       CASE WHEN TRADE_TRUTH = 'STARTER' AND U_ADOPT < 0.30 THEN 25 + FLOOR(U_ADDAY * 180) END AS OW_ADOPT_AFTER_DAYS,
       KIDS_TRUTH = 'SCHOOL' AND U_L25 < 0.20 AS SCHOOL_LIST_2025,
       KIDS_TRUTH = 'SCHOOL' AND ((U_L25 < 0.20 AND U_L26 < 0.70) OR (U_L25 >= 0.20 AND U_L26 < 0.12)) AS SCHOOL_LIST_2026,
       U_TECH < 0.12 AS TECH_BUYER, U_TECH AS U_TECH, U_WFH < 0.08 AS HOME_OFFICE_SHOPPER,
       CASE
         WHEN KIDS_TRUTH = 'SCHOOL' THEN DECODE(FLOOR(U_AGE * 20), 0, '25-34', 1, '25-34', 2, '25-34', 3, '25-34', 15, '45-54', 16, '45-54', 17, '45-54', 18, '45-54', 19, '45-54', '35-44')
         WHEN KIDS_TRUTH = 'TODDLER' THEN IFF(U_AGE < 0.6, '25-34', '35-44')
         WHEN KIDS_TRUTH = 'GIFT' THEN IFF(U_AGE < 0.5, '55-64', '65+')
         ELSE DECODE(FLOOR(U_AGE * 6), 0, '18-24', 1, '25-34', 2, '35-44', 3, '45-54', 4, '55-64', '65+') END AS AGE_BAND,
       IFF(U_GENDER < 0.52, 'F', 'M') AS GENDER,
       IFF(U_MEMBER < 0.30, 'OnePass', 'Standard') AS MEMBERSHIP,
       -- The marketing segment is a GENERATED profile label: it leans towards the
       -- household's truth but is often wrong, as a bought segmentation would be.
       CASE
         WHEN KIDS_TRUTH = 'SCHOOL' AND U_SEG < 0.55 THEN 'Established Families'
         WHEN KIDS_TRUTH = 'SCHOOL' AND U_SEG < 0.75 THEN 'Young Families'
         WHEN KIDS_TRUTH = 'TODDLER' AND U_SEG < 0.65 THEN 'Young Families'
         WHEN KIDS_TRUTH = 'GIFT' AND U_SEG < 0.65 THEN 'Empty Nesters'
         WHEN TRADE_TRUTH = 'ESTABLISHED' AND U_SEG < 0.60 THEN 'Tradies & DIYers'
         WHEN TRADE_TRUTH = 'STARTER' AND U_SEG < 0.25 THEN 'Tradies & DIYers'
         WHEN TRADE_TRUTH = 'DIY' AND U_SEG < 0.55 THEN 'Home Improvers'
         ELSE DECODE(FLOOR(U_SEG * 1000) % 6, 0, 'Young Singles & Couples', 1, 'Home Improvers', 2, 'Established Families',
                     3, 'Empty Nesters', 4, 'Young Singles & Couples', 'Young Families') END AS SEGMENT_NAME
FROM t;

-- Children: birth dates from the youngest child's age on 13 Nov 2026.
CREATE OR REPLACE TABLE CUSTOMER_KID COMMENT = 'CONSTRUCTION TRUTH: each household''s children. Never exposed.' AS
SELECT CUSTOMER_KEY, KID_NO, AGE_NOW, DATEADD('day', -ROUND(AGE_NOW * 365.25), '2026-11-13'::DATE) AS BIRTH_DATE
FROM (
  SELECT t.CUSTOMER_KEY, n.N AS KID_NO,
         LEAST(14.5, t.YOUNGEST_AGE + IFF(n.N >= 2, t.GAP1, 0) + IFF(n.N >= 3, t.GAP2, 0)) AS AGE_NOW
  FROM CUSTOMER_TRUTH t JOIN NUMS n ON n.N <= t.NUM_KIDS
);

-- The customer profile the business holds (GENERATED).
CREATE OR REPLACE TABLE DIM_CUSTOMER COMMENT = 'OnePass member profile: state, suburb, age band, membership, marketing segment (GENERATED).' AS
SELECT t.CUSTOMER_KEY, 'OP' || LPAD(t.CUSTOMER_KEY::VARCHAR, 7, '0') AS CUSTOMER_ID, t.STATE, s.SUBURB AS HOME_SUBURB, t.HOME_SUBURB_IDX,
       t.AGE_BAND, t.GENDER, t.MEMBERSHIP, t.SEGMENT_NAME,
       DATEADD('day', -(ABS(HASH(t.CUSTOMER_KEY, 'joined')) % 2400), '2024-11-01'::DATE) AS JOINED_DATE
FROM CUSTOMER_TRUTH t JOIN DIM_SUBURB s ON s.STATE = t.STATE AND s.SUBURB_IDX = t.HOME_SUBURB_IDX;

-- ---------- Purchases ----------
-- Staged as (customer, banner, date, pick group, draw), then resolved to a
-- product and a store. 85% of trips go to the home suburb's store.
CREATE OR REPLACE TABLE STG_LINES (
  CUSTOMER_KEY NUMBER, BANNER VARCHAR, DT DATE, PICK_GROUP VARCHAR, PICK NUMBER, QTY NUMBER, PROMO BOOLEAN,
  SHOE_SIZE_IDX NUMBER, PRICE_MULT FLOAT
);

-- Bunnings everyday: garden, paint, DIY tools, hardware, BBQ.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, TRADE_TRUTH FROM CUSTOMER_TRUTH WHERE SHOPS_BUNNINGS),
occ AS (
  SELECT c.CUSTOMER_KEY, n.N, (ABS(HASH(c.CUSTOMER_KEY, n.N, 'bd')) % 1000000) / 1e6 AS U_D,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'bc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'bp')) AS PICK
  FROM c JOIN NUMS n ON n.N <= IFF(c.TRADE_TRUTH = 'DIY', 14 + ABS(HASH(c.CUSTOMER_KEY, 'bn')) % 10, 3 + ABS(HASH(c.CUSTOMER_KEY, 'bn')) % 8)
)
SELECT CUSTOMER_KEY, 'BUNNINGS', DATEADD('day', FLOOR(U_D * 743), '2024-11-01'::DATE),
       CASE WHEN U_C < 0.40 THEN 'Garden' WHEN U_C < 0.55 THEN 'Paint & Decor' WHEN U_C < 0.70 THEN 'DIY Tools'
            WHEN U_C < 0.90 THEN 'Hardware' ELSE 'BBQ & Outdoor' END,
       PICK, 1 + PICK % 2, PICK % 5 = 0, NULL, 1.0
FROM occ;

-- DIYers and the odd everyday shopper: a single trade item now and then. Spread
-- over two years, so they rarely look like a cluster.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, TRADE_TRUTH FROM CUSTOMER_TRUTH WHERE TRADE_TRUTH IN ('DIY', 'NONE') AND SHOPS_BUNNINGS),
items AS (
  SELECT * FROM VALUES ('Trade Power Tools', 0.22, 0.01), ('Workwear & PPE', 0.30, 0.05), ('Trade Ladders', 0.10, 0.01),
                       ('Trade Consumables|Carpentry', 0.12, 0.01), ('Trade Specialist Tools|Landscaping', 0.04, 0.00)
  AS i(PICK_GROUP, P_DIY, P_NONE)
)
SELECT c.CUSTOMER_KEY, 'BUNNINGS', DATEADD('day', ABS(HASH(c.CUSTOMER_KEY, i.PICK_GROUP, 'dd')) % 743, '2024-11-01'::DATE),
       i.PICK_GROUP, ABS(HASH(c.CUSTOMER_KEY, i.PICK_GROUP, 'dp')), 1, FALSE, NULL, 1.0
FROM c CROSS JOIN items i
WHERE (ABS(HASH(c.CUSTOMER_KEY, i.PICK_GROUP, 'du')) % 1000000) / 1e6 < IFF(c.TRADE_TRUTH = 'DIY', i.P_DIY, i.P_NONE);

-- Established tradies: trade buying every two to three weeks, all two years.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, TRADE_SPECIALTY FROM CUSTOMER_TRUTH WHERE TRADE_TRUTH = 'ESTABLISHED'),
occ AS (
  SELECT c.CUSTOMER_KEY, c.TRADE_SPECIALTY, n.N, (ABS(HASH(c.CUSTOMER_KEY, n.N, 'td')) % 1000000) / 1e6 AS U_D,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'tc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'tp')) AS PICK
  FROM c JOIN NUMS n ON n.N <= 34 + ABS(HASH(c.CUSTOMER_KEY, 'tn')) % 20
)
SELECT CUSTOMER_KEY, 'BUNNINGS', DATEADD('day', FLOOR(U_D * 743), '2024-11-01'::DATE),
       CASE WHEN U_C < 0.45 THEN 'Trade Consumables|' || TRADE_SPECIALTY WHEN U_C < 0.65 THEN 'Workwear & PPE'
            WHEN U_C < 0.78 THEN 'Trade Specialist Tools|' || TRADE_SPECIALTY WHEN U_C < 0.87 THEN 'Trade Power Tools'
            WHEN U_C < 0.94 THEN 'Trade Ladders' ELSE 'Tool Storage & Transport' END,
       PICK, 1 + PICK % 3, PICK % 6 = 0, NULL, 1.0
FROM occ;

-- Business starters: the set-up burst within ~6 weeks of starting...
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, TRADE_SPECIALTY, BIZ_START_DATE FROM CUSTOMER_TRUTH WHERE TRADE_TRUTH = 'STARTER'),
kit AS (
  SELECT * FROM VALUES ('Trade Consumables', 1.00, 3), ('Trade Power Tools', 0.95, 1), ('Workwear & PPE', 0.92, 3),
                       ('Trade Specialist Tools', 0.90, 1), ('Tool Storage & Transport', 0.72, 1), ('Trade Ladders', 0.66, 1)
  AS k(CLASS, P, MAX_LINES)
)
SELECT c.CUSTOMER_KEY, 'BUNNINGS', DATEADD('day', ABS(HASH(c.CUSTOMER_KEY, k.CLASS, n.N, 'sd')) % 42, c.BIZ_START_DATE),
       k.CLASS || IFF(k.CLASS IN ('Trade Consumables', 'Trade Specialist Tools'), '|' || c.TRADE_SPECIALTY, ''),
       ABS(HASH(c.CUSTOMER_KEY, k.CLASS, n.N, 'sp')), IFF(k.CLASS = 'Trade Consumables', 2 + n.N, 1), FALSE, NULL, 1.0
FROM c CROSS JOIN kit k JOIN NUMS n ON n.N <= k.MAX_LINES
WHERE (ABS(HASH(c.CUSTOMER_KEY, k.CLASS, 'su')) % 1000000) / 1e6 < k.P
  AND (n.N = 1 OR (ABS(HASH(c.CUSTOMER_KEY, k.CLASS, n.N, 'sx')) % 1000000) / 1e6 < 0.5);

-- ...then working: consumables and PPE every three weeks or so.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, TRADE_SPECIALTY, BIZ_START_DATE FROM CUSTOMER_TRUTH WHERE TRADE_TRUTH = 'STARTER'),
occ AS (
  SELECT c.CUSTOMER_KEY, c.TRADE_SPECIALTY, n.N,
         DATEADD('day', 42 + n.N * 21 + ABS(HASH(c.CUSTOMER_KEY, n.N, 'wd')) % 10, c.BIZ_START_DATE) AS DT,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'wc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'wp')) AS PICK
  FROM c JOIN NUMS n ON n.N <= 40
)
SELECT CUSTOMER_KEY, 'BUNNINGS', DT, IFF(U_C < 0.75, 'Trade Consumables|' || TRADE_SPECIALTY, 'Workwear & PPE'),
       PICK, 1 + PICK % 3, FALSE, NULL, 1.0
FROM occ WHERE DT <= '2026-11-13'::DATE;

-- Kmart everyday: home, apparel, home office; kids' clothes in families.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, KIDS_TRUTH, HOME_OFFICE_SHOPPER FROM CUSTOMER_TRUTH WHERE SHOPS_KMART),
occ AS (
  SELECT c.CUSTOMER_KEY, c.KIDS_TRUTH, n.N, (ABS(HASH(c.CUSTOMER_KEY, n.N, 'kd')) % 1000000) / 1e6 AS U_D,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'kc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'kp')) AS PICK
  FROM c JOIN NUMS n ON n.N <= 6 + ABS(HASH(c.CUSTOMER_KEY, 'kn')) % 18
)
SELECT CUSTOMER_KEY, 'KMART', DATEADD('day', FLOOR(U_D * 743), '2024-11-01'::DATE),
       CASE WHEN U_C < 0.38 THEN 'Homewares' WHEN U_C < 0.58 THEN 'Womens Apparel' WHEN U_C < 0.72 THEN 'Mens Apparel'
            WHEN U_C < 0.77 THEN 'Home Office' WHEN U_C < 0.85 THEN 'Toys'
            WHEN KIDS_TRUTH IN ('SCHOOL', 'TODDLER') THEN 'Kids Apparel' ELSE 'Homewares' END,
       PICK, 1 + PICK % 2, PICK % 4 = 0, NULL, 1.0
FROM occ;

-- Home-office shoppers: a desk, a chair, a lamp.
INSERT INTO STG_LINES
SELECT t.CUSTOMER_KEY, 'KMART', DATEADD('day', ABS(HASH(t.CUSTOMER_KEY, n.N, 'hd')) % 743, '2024-11-01'::DATE), 'Home Office',
       ABS(HASH(t.CUSTOMER_KEY, n.N, 'hp')), 1, FALSE, NULL, 1.0
FROM CUSTOMER_TRUTH t JOIN NUMS n ON n.N <= 2 + ABS(HASH(t.CUSTOMER_KEY, 'hn')) % 3
WHERE t.HOME_OFFICE_SHOPPER AND t.SHOPS_KMART;

-- Kids' shoes. The size follows the child's age at purchase, give or take a
-- size: toddler 3-9 (1-3 years), kids 10-13 (4-7), youth 1-6 (8-13).
INSERT INTO STG_LINES
WITH k AS (
  SELECT kd.CUSTOMER_KEY, kd.KID_NO, kd.BIRTH_DATE
  FROM CUSTOMER_KID kd JOIN CUSTOMER_TRUTH t ON t.CUSTOMER_KEY = kd.CUSTOMER_KEY WHERE t.SHOPS_KMART
), buys AS (
  -- January school shoes for children of school age that year.
  SELECT k.CUSTOMER_KEY, k.KID_NO, k.BIRTH_DATE, 'Kids School Shoes' AS CLS,
         DATEADD('day', ABS(HASH(k.CUSTOMER_KEY, k.KID_NO, y.Y, 'ssd')) % 30, (y.Y || '-01-04')::DATE) AS DT,
         (ABS(HASH(k.CUSTOMER_KEY, k.KID_NO, y.Y, 'ssu')) % 1000000) / 1e6 < 0.85 AS KEEP
  FROM k CROSS JOIN (SELECT 2025 AS Y UNION ALL SELECT 2026) y
  WHERE DATEDIFF('day', k.BIRTH_DATE, (y.Y || '-01-28')::DATE) / 365.25 BETWEEN 4.4 AND 13
  UNION ALL
  -- Sneakers every six to eight months, any child over one.
  SELECT k.CUSTOMER_KEY, k.KID_NO, k.BIRTH_DATE, 'Kids Sneakers',
         DATEADD('day', n.N * 200 - 120 + ABS(HASH(k.CUSTOMER_KEY, k.KID_NO, n.N, 'snd')) % 90, '2024-11-01'::DATE),
         (ABS(HASH(k.CUSTOMER_KEY, k.KID_NO, n.N, 'snu')) % 1000000) / 1e6 < 0.85
  FROM k JOIN NUMS n ON n.N <= 4
)
SELECT CUSTOMER_KEY, 'KMART', DT,
       IFF(SZ <= 9, 'Toddler Shoes', CLS), ABS(HASH(CUSTOMER_KEY, KID_NO, DT, 'shp')), 1, FALSE, SZ, 1.0
FROM (
  SELECT b.*, DATEDIFF('day', b.BIRTH_DATE, b.DT) / 365.25 AS AGE,
         LEAST(19, GREATEST(3, IFF(DATEDIFF('day', b.BIRTH_DATE, b.DT) / 365.25 < 4,
                                   ROUND(2 + 2 * DATEDIFF('day', b.BIRTH_DATE, b.DT) / 365.25),
                                   ROUND(6 + DATEDIFF('day', b.BIRTH_DATE, b.DT) / 365.25))
                              + DECODE(ABS(HASH(b.CUSTOMER_KEY, b.KID_NO, b.DT, 'noise')) % 4, 0, -1, 3, 1, 0))) AS SZ
  FROM buys b
  WHERE b.KEEP AND b.DT BETWEEN '2024-11-01' AND '2026-11-13' AND DATEDIFF('day', b.BIRTH_DATE, b.DT) > 330
);

-- Gift buyers: one pair of kids' shoes, any size, and toys in December.
INSERT INTO STG_LINES
SELECT t.CUSTOMER_KEY, 'KMART', DATEADD('day', ABS(HASH(t.CUSTOMER_KEY, y.Y, 'gd')) % 23, (y.Y || '-12-01')::DATE), 'Kids Sneakers',
       ABS(HASH(t.CUSTOMER_KEY, y.Y, 'gp')), 1, FALSE, 8 + ABS(HASH(t.CUSTOMER_KEY, y.Y, 'gs')) % 8, 1.0
FROM CUSTOMER_TRUTH t CROSS JOIN (SELECT 2024 AS Y, 0.5 AS P UNION ALL SELECT 2025, 0.9) y
WHERE t.KIDS_TRUTH = 'GIFT' AND t.SHOPS_KMART AND (ABS(HASH(t.CUSTOMER_KEY, y.Y, 'gu')) % 1000000) / 1e6 < y.P
UNION ALL
SELECT t.CUSTOMER_KEY, 'KMART', DATEADD('day', ABS(HASH(t.CUSTOMER_KEY, y.Y, n.N, 'td')) % 23, (y.Y || '-12-01')::DATE), 'Toys',
       ABS(HASH(t.CUSTOMER_KEY, y.Y, n.N, 'tp')), 1, FALSE, NULL, 1.0
FROM CUSTOMER_TRUTH t CROSS JOIN (SELECT 2024 AS Y UNION ALL SELECT 2025) y JOIN NUMS n ON n.N <= 2
WHERE t.KIDS_TRUTH = 'GIFT' AND t.SHOPS_KMART;

-- School items at the start of each school year (January), and top-ups in July.
INSERT INTO STG_LINES
WITH fam AS (
  SELECT t.CUSTOMER_KEY, y.Y, COUNT(*) AS SCHOOL_KIDS
  FROM CUSTOMER_TRUTH t JOIN CUSTOMER_KID kd ON kd.CUSTOMER_KEY = t.CUSTOMER_KEY
  CROSS JOIN (SELECT 2025 AS Y UNION ALL SELECT 2026) y
  WHERE t.SHOPS_KMART AND DATEDIFF('day', kd.BIRTH_DATE, (y.Y || '-01-28')::DATE) / 365.25 BETWEEN 4.4 AND 12.9
  GROUP BY 1, 2
), items AS (
  SELECT * FROM VALUES ('School Uniform', 0.80, 3), ('Lunch & Drink', 0.60, 2), ('School Bags', 0.35, 1) AS i(CLS, P, MAX_LINES)
)
SELECT f.CUSTOMER_KEY, 'KMART', DATEADD('day', ABS(HASH(f.CUSTOMER_KEY, f.Y, i.CLS, n.N, 'sid')) % 32, (f.Y || '-01-02')::DATE),
       i.CLS, ABS(HASH(f.CUSTOMER_KEY, f.Y, i.CLS, n.N, 'sip')), f.SCHOOL_KIDS, FALSE, NULL, 1.0
FROM fam f CROSS JOIN items i JOIN NUMS n ON n.N <= i.MAX_LINES
WHERE (ABS(HASH(f.CUSTOMER_KEY, f.Y, i.CLS, 'siu')) % 1000000) / 1e6 < i.P
UNION ALL
SELECT f.CUSTOMER_KEY, 'KMART', DATEADD('day', ABS(HASH(f.CUSTOMER_KEY, f.Y, 'jud')) % 20, (f.Y || '-07-01')::DATE),
       'School Uniform', ABS(HASH(f.CUSTOMER_KEY, f.Y, 'jup')), 1, FALSE, NULL, 1.0
FROM fam f WHERE (ABS(HASH(f.CUSTOMER_KEY, f.Y, 'juu')) % 1000000) / 1e6 < 0.25;

-- Officeworks everyday: stationery, paper, ink, accessories, the odd laptop.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, KIDS_TRUTH FROM CUSTOMER_TRUTH WHERE SHOPS_OFFICEWORKS),
occ AS (
  SELECT c.CUSTOMER_KEY, c.KIDS_TRUTH, n.N, (ABS(HASH(c.CUSTOMER_KEY, n.N, 'od')) % 1000000) / 1e6 AS U_D,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'oc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'op')) AS PICK
  FROM c JOIN NUMS n ON n.N <= 3 + ABS(HASH(c.CUSTOMER_KEY, 'on')) % 10
)
SELECT CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', FLOOR(U_D * 743), '2024-11-01'::DATE),
       CASE WHEN U_C < 0.38 THEN 'Stationery' WHEN U_C < 0.50 THEN 'Paper' WHEN U_C < 0.62 THEN 'Ink & Toner'
            WHEN U_C < 0.80 THEN 'Tech Accessories' WHEN U_C < 0.88 THEN 'Stationery Packs' WHEN U_C < 0.93 THEN 'Office Chairs'
            WHEN U_C < 0.96 THEN 'Desks' ELSE 'Stationery' END,
       PICK, 1 + PICK % 2, PICK % 5 = 0, NULL, 1.0
FROM occ;

-- Tech buyers: one laptop (and often a printer) at some point in the two years.
INSERT INTO STG_LINES
SELECT t.CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', FLOOR(t.U_TECH / 0.12 * 743), '2024-11-01'::DATE), c.CLS,
       ABS(HASH(t.CUSTOMER_KEY, c.CLS, 'tbp')), 1, ABS(HASH(t.CUSTOMER_KEY, 'tbpr')) % 3 = 0, NULL, 1.0
FROM CUSTOMER_TRUTH t CROSS JOIN (SELECT 'Laptops' AS CLS UNION ALL SELECT 'Printers') c
WHERE t.TECH_BUYER AND t.SHOPS_OFFICEWORKS AND (c.CLS = 'Laptops' OR ABS(HASH(t.CUSTOMER_KEY, 'tbu')) % 2 = 0);

-- Officeworks business buyers: ink, paper and print, every few weeks.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY FROM CUSTOMER_TRUTH WHERE OW_BUSINESS_BUYER),
occ AS (
  SELECT c.CUSTOMER_KEY, n.N, (ABS(HASH(c.CUSTOMER_KEY, n.N, 'bbd')) % 1000000) / 1e6 AS U_D,
         (ABS(HASH(c.CUSTOMER_KEY, n.N, 'bbc')) % 1000000) / 1e6 AS U_C, ABS(HASH(c.CUSTOMER_KEY, n.N, 'bbp')) AS PICK
  FROM c JOIN NUMS n ON n.N <= 20 + ABS(HASH(c.CUSTOMER_KEY, 'bbn')) % 10
)
SELECT CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', FLOOR(U_D * 743), '2024-11-01'::DATE),
       CASE WHEN U_C < 0.34 THEN 'Ink & Toner' WHEN U_C < 0.58 THEN 'Paper' WHEN U_C < 0.67 THEN 'Business Cards'
            WHEN U_C < 0.72 THEN 'Flyers' WHEN U_C < 0.77 THEN 'Signage' WHEN U_C < 0.89 THEN 'Tech Accessories'
            WHEN U_C < 0.93 THEN 'Laptops' WHEN U_C < 0.96 THEN 'Printers' ELSE 'Stationery' END,
       PICK, 1 + PICK % 3, PICK % 6 = 0, NULL, 1.0
FROM occ;

-- Starters who find Officeworks themselves: the set-up shop, then ink and print.
INSERT INTO STG_LINES
WITH c AS (SELECT CUSTOMER_KEY, DATEADD('day', OW_ADOPT_AFTER_DAYS, BIZ_START_DATE) AS ADOPT_DATE FROM CUSTOMER_TRUTH WHERE OW_ADOPT_AFTER_DAYS IS NOT NULL),
setup AS (SELECT * FROM VALUES ('Laptops', 0.70), ('Printers', 0.60), ('Business Cards', 0.80), ('Signage', 0.40) AS s(CLS, P))
SELECT c.CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', ABS(HASH(c.CUSTOMER_KEY, s.CLS, 'ad')) % 5, c.ADOPT_DATE), s.CLS,
       ABS(HASH(c.CUSTOMER_KEY, s.CLS, 'ap')), 1, FALSE, NULL, 1.0
FROM c CROSS JOIN setup s
WHERE (ABS(HASH(c.CUSTOMER_KEY, s.CLS, 'au')) % 1000000) / 1e6 < s.P AND DATEADD('day', 5, c.ADOPT_DATE) <= '2026-11-13'::DATE
UNION ALL
SELECT c.CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', 20 + n.N * 26, c.ADOPT_DATE),
       DECODE(n.N % 3, 0, 'Business Cards', 1, 'Ink & Toner', 'Paper'), ABS(HASH(c.CUSTOMER_KEY, n.N, 'aop')), 1, FALSE, NULL, 1.0
FROM c JOIN NUMS n ON n.N <= 30
WHERE DATEADD('day', 20 + n.N * 26, c.ADOPT_DATE) <= '2026-11-13'::DATE;

-- The school list service: an order in early January, priced by the children.
INSERT INTO STG_LINES
SELECT t.CUSTOMER_KEY, 'OFFICEWORKS', DATEADD('day', ABS(HASH(t.CUSTOMER_KEY, y.Y, 'sld')) % 26, (y.Y || '-01-02')::DATE),
       'School List Service', 1, GREATEST(1, LEAST(3, t.NUM_KIDS)), FALSE, NULL,
       0.8 + (ABS(HASH(t.CUSTOMER_KEY, y.Y, 'slm')) % 50) / 100.0
FROM CUSTOMER_TRUTH t CROSS JOIN (SELECT 2025 AS Y UNION ALL SELECT 2026) y
WHERE (y.Y = 2025 AND t.SCHOOL_LIST_2025) OR (y.Y = 2026 AND t.SCHOOL_LIST_2026);

CREATE OR REPLACE TABLE FACT_TRANSACTION_LINES
  COMMENT = 'SYNTHETIC OnePass-linked purchase lines across Bunnings, Kmart and Officeworks. SHOE_SIZE is set on kids'' footwear.'
AS
SELECT ROW_NUMBER() OVER (ORDER BY s.DT, s.CUSTOMER_KEY, s.BANNER, s.PICK_GROUP, s.PICK) AS LINE_ID,
       TO_NUMBER(TO_CHAR(s.DT, 'YYYYMMDD')) AS DATE_KEY, s.DT AS TXN_DATE, s.CUSTOMER_KEY, st.STORE_KEY, s.BANNER, p.PRODUCT_KEY,
       s.QTY AS QUANTITY,
       ROUND(p.UNIT_PRICE * s.PRICE_MULT * s.QTY * IFF(s.PROMO, 0.85, 1), 2) AS NET_REVENUE,
       ROUND(p.UNIT_PRICE * s.PRICE_MULT * s.QTY * IFF(s.PROMO, 0.85, 1) * p.MARGIN_RATE * IFF(s.PROMO, 0.6, 1), 2) AS MARGIN_AMOUNT,
       s.PROMO AS PROMO_FLAG, s.SHOE_SIZE_IDX,
       CASE WHEN s.SHOE_SIZE_IDX IS NULL THEN NULL WHEN s.SHOE_SIZE_IDX <= 9 THEN 'Toddler ' || s.SHOE_SIZE_IDX
            WHEN s.SHOE_SIZE_IDX <= 13 THEN 'Kids ' || s.SHOE_SIZE_IDX ELSE 'Youth ' || (s.SHOE_SIZE_IDX - 13) END AS SHOE_SIZE
FROM STG_LINES s
JOIN DIM_PRODUCT p ON p.BANNER = s.BANNER AND p.PICK_GROUP = s.PICK_GROUP AND p.GROUP_IDX = MOD(s.PICK, p.GROUP_N) + 1
JOIN CUSTOMER_TRUTH t ON t.CUSTOMER_KEY = s.CUSTOMER_KEY
JOIN DIM_STORE st ON st.BANNER = s.BANNER AND st.STATE = t.STATE
 AND st.SUBURB_IDX = IFF(MOD(s.PICK, 100) < 85, t.HOME_SUBURB_IDX, MOD(FLOOR(s.PICK / 100), t.STATE_SUBURBS) + 1)
WHERE s.DT BETWEEN '2024-11-01'::DATE AND '2026-11-13'::DATE;

DROP TABLE STG_LINES;
