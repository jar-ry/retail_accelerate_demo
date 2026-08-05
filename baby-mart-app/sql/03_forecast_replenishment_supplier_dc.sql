-- ============================================================
-- Baby Mart Supply Chain Demo — Supplier to DC Replenishment
-- Each row = one PO line with DIFOT, overtrading, and ops fields
-- Generates ~8K rows covering 16 weeks of purchase orders
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC (
    PO_NUMBER VARCHAR(20),
    ORDER_DATE DATE,
    EXPECTED_DELIVERY_DATE DATE,
    ACTUAL_DELIVERY_DATE DATE,
    BRAND_NAME VARCHAR(100),
    SKU_CLASS VARCHAR(100),
    CATEGORY VARCHAR(100),
    SUPPLIER_NAME VARCHAR(100),
    DC_STATE VARCHAR(10),
    ORDERED_UNITS INT,
    DELIVERED_UNITS INT,
    FORECAST_UNITS INT,
    STD_LEAD_TIME_DAYS INT,
    ACTUAL_LEAD_TIME_DAYS INT,
    IS_ON_TIME BOOLEAN,
    IS_IN_FULL BOOLEAN,
    IS_DIFOT BOOLEAN,
    IS_OVERTRADED BOOLEAN,
    OVERORDER_PCT FLOAT,
    IS_RUSH_ORDER BOOLEAN,
    STATUS VARCHAR(20),
    CARRIER VARCHAR(50),
    TRANSPORT_MODE VARCHAR(20),
    PALLETS INT,
    RECEIVING_TIMESTAMP TIMESTAMP,
    PUT_AWAY_TIMESTAMP TIMESTAMP,
    DOCK_TO_CHECK_HOURS FLOAT,
    CHECK_TO_PUTAWAY_HOURS FLOAT,
    HAS_DISCREPANCY BOOLEAN,
    DISCREPANCY_TYPE VARCHAR(20),
    DISCREPANCY_UNITS INT
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
WITH suppliers AS (
    SELECT * FROM VALUES
        ('Kimberly-Clark ANZ',  'Huggies',          'Nappies & Wipes',    7,  'Toll',      'Road'),
        ('Kimberly-Clark ANZ',  'Pampers',          'Nappies & Wipes',    7,  'Toll',      'Road'),
        ('Bugaboo Pacific',     'Bugaboo',          'Prams & Strollers', 28,  'DHL',       'Sea+Road'),
        ('Bugaboo Pacific',     'Babyzen',          'Prams & Strollers', 28,  'DHL',       'Sea+Road'),
        ('Dorel Australia',     'Maxi-Cosi',        'Car Seats',         21,  'DHL',       'Sea+Road'),
        ('Dorel Australia',     'Nuna',             'Car Seats',         21,  'DHL',       'Sea+Road'),
        ('Hanes Pacific',       'Bonds Baby',       'Clothing',          10,  'StarTrack', 'Road'),
        ('Hanes Pacific',       'Cotton On Baby',   'Clothing',          10,  'StarTrack', 'Road'),
        ('Philips ANZ',         'Avent',            'Feeding',           21,  'Toll',      'Air+Road'),
        ('Philips ANZ',         'Tommee Tippee',    'Feeding',           21,  'Toll',      'Air+Road'),
        ('Rascal & Co',         'Rascal + Friends', 'Nappies & Wipes',   14,  'StarTrack', 'Road'),
        ('Britax Group',        'Britax',           'Car Seats',         14,  'Toll',      'Road'),
        ('Premium Brands AU',   'Marquise',         'Clothing',          14,  'StarTrack', 'Road'),
        ('Feeding Solutions',   'Dr Browns',        'Feeding',           35,  'DHL',       'Sea+Road'),
        ('Feeding Solutions',   'NUK',              'Feeding',           35,  'DHL',       'Sea+Road')
    AS t(SUPPLIER_NAME, BRAND_NAME, CATEGORY, STD_LEAD_TIME, CARRIER, TRANSPORT_MODE)
),
sku_classes AS (
    SELECT * FROM VALUES
        ('Huggies',          'Crawler Nappies'),
        ('Huggies',          'Newborn Nappies'),
        ('Huggies',          'Toddler Nappies'),
        ('Pampers',          'Premium Nappies'),
        ('Bugaboo',          'Single Stroller'),
        ('Bugaboo',          'Double Stroller'),
        ('Babyzen',          'Compact Stroller'),
        ('Maxi-Cosi',       'Infant Car Seat'),
        ('Maxi-Cosi',       'Convertible Seat'),
        ('Nuna',             'Infant Car Seat'),
        ('Bonds Baby',       'Bodysuits & Onesies'),
        ('Bonds Baby',       'Sleepwear'),
        ('Cotton On Baby',   'Casual Wear'),
        ('Avent',            'Bottles'),
        ('Avent',            'Sterilisers'),
        ('Tommee Tippee',    'Bottles'),
        ('Rascal + Friends', 'Eco Nappies'),
        ('Britax',           'Convertible Seat'),
        ('Marquise',         'Premium Bodysuits'),
        ('Dr Browns',        'Anti-Colic Bottles'),
        ('NUK',              'Soothers')
    AS t(BRAND_NAME, SKU_CLASS)
),
dcs AS (
    SELECT * FROM VALUES ('NSW'), ('VIC'), ('QLD'), ('SA'), ('WA') AS t(DC_STATE)
),
-- Generate ~5 orders per supplier/brand/DC over 16 weeks
order_dates AS (
    SELECT DATEADD(DAY, SEQ4() * 3, '2026-02-17')::DATE AS BASE_ORDER_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 40))
    WHERE DATEADD(DAY, SEQ4() * 3, '2026-02-17')::DATE <= CURRENT_DATE()
),
raw_orders AS (
    SELECT
        s.SUPPLIER_NAME,
        s.BRAND_NAME,
        s.CATEGORY,
        s.STD_LEAD_TIME,
        s.CARRIER,
        s.TRANSPORT_MODE,
        sk.SKU_CLASS,
        d.DC_STATE,
        od.BASE_ORDER_DATE AS ORDER_DATE,
        -- Not every combo orders every 3 days — sample ~30%
        ABS(HASH(s.BRAND_NAME || sk.SKU_CLASS || d.DC_STATE || od.BASE_ORDER_DATE::VARCHAR)) % 100 AS SAMPLE_PCT
    FROM suppliers s
    JOIN sku_classes sk ON sk.BRAND_NAME = s.BRAND_NAME
    CROSS JOIN dcs d
    CROSS JOIN order_dates od
    WHERE ABS(HASH(s.BRAND_NAME || sk.SKU_CLASS || d.DC_STATE || od.BASE_ORDER_DATE::VARCHAR)) % 100 < 30
),
enriched AS (
    SELECT
        'PO-' || LPAD(ROW_NUMBER() OVER (ORDER BY ORDER_DATE, SUPPLIER_NAME, BRAND_NAME)::VARCHAR, 6, '0') AS PO_NUMBER,
        ORDER_DATE,
        DATEADD(DAY, STD_LEAD_TIME, ORDER_DATE)::DATE AS EXPECTED_DELIVERY_DATE,
        STD_LEAD_TIME,
        SUPPLIER_NAME,
        BRAND_NAME,
        SKU_CLASS,
        CATEGORY,
        DC_STATE,
        CARRIER,
        TRANSPORT_MODE,
        -- Order quantity (50-500 units for FMCG, 5-30 for big ticket)
        CASE
            WHEN CATEGORY IN ('Nappies & Wipes') THEN 100 + ABS(HASH(PO_NUMBER || 'qty')) % 400
            WHEN CATEGORY IN ('Clothing') THEN 50 + ABS(HASH(PO_NUMBER || 'qty')) % 150
            WHEN CATEGORY IN ('Feeding') THEN 30 + ABS(HASH(PO_NUMBER || 'qty')) % 70
            ELSE 5 + ABS(HASH(PO_NUMBER || 'qty')) % 25
        END AS ORDERED_UNITS,
        -- Forecast (what we should have ordered based on demand)
        CASE
            WHEN CATEGORY IN ('Nappies & Wipes') THEN 80 + ABS(HASH(PO_NUMBER || 'fcst')) % 350
            WHEN CATEGORY IN ('Clothing') THEN 40 + ABS(HASH(PO_NUMBER || 'fcst')) % 130
            WHEN CATEGORY IN ('Feeding') THEN 25 + ABS(HASH(PO_NUMBER || 'fcst')) % 60
            ELSE 4 + ABS(HASH(PO_NUMBER || 'fcst')) % 20
        END AS FORECAST_UNITS,
        -- Is this a rush order? (ordered with less than standard lead time expectation)
        ABS(HASH(PO_NUMBER || 'rush')) % 100 < 
            CASE 
                WHEN BRAND_NAME = 'Huggies' AND ORDER_DATE > '2026-05-01' THEN 25  -- More rush orders during spike
                ELSE 10 
            END AS IS_RUSH_ORDER,
        -- Delivery variance (days late — higher for international)
        CASE
            WHEN STD_LEAD_TIME >= 28 THEN (ABS(HASH(PO_NUMBER || 'late')) % 8) - 2  -- -2 to +5 days
            WHEN STD_LEAD_TIME >= 14 THEN (ABS(HASH(PO_NUMBER || 'late')) % 6) - 2  -- -2 to +3 days
            ELSE (ABS(HASH(PO_NUMBER || 'late')) % 4) - 1  -- -1 to +2 days
        END AS DELIVERY_VARIANCE_DAYS,
        -- Quantity delivered (% of ordered)
        CASE
            WHEN ABS(HASH(PO_NUMBER || 'short')) % 100 < 12 THEN 0.75 + (ABS(HASH(PO_NUMBER || 'pct')) % 20) / 100.0  -- 75-95% (short shipped)
            ELSE 1.0  -- Full delivery
        END AS DELIVERY_PCT,
        -- Pallets
        CASE
            WHEN CATEGORY IN ('Nappies & Wipes') THEN 4 + ABS(HASH(PO_NUMBER || 'pal')) % 8
            WHEN CATEGORY IN ('Clothing') THEN 2 + ABS(HASH(PO_NUMBER || 'pal')) % 4
            WHEN CATEGORY IN ('Feeding') THEN 1 + ABS(HASH(PO_NUMBER || 'pal')) % 3
            ELSE 1 + ABS(HASH(PO_NUMBER || 'pal')) % 2
        END AS PALLETS,
        -- Receiving performance (hours)
        2.0 + (ABS(HASH(PO_NUMBER || 'dock')) % 60) / 10.0 AS DOCK_TO_CHECK_HOURS,  -- 2-8 hours
        1.0 + (ABS(HASH(PO_NUMBER || 'put')) % 40) / 10.0 AS CHECK_TO_PUTAWAY_HOURS,  -- 1-5 hours
        -- Discrepancy
        ABS(HASH(PO_NUMBER || 'disc')) % 100 AS DISC_ROLL
    FROM raw_orders
    WHERE SAMPLE_PCT < 30  -- redundant but safe
)
SELECT
    PO_NUMBER,
    ORDER_DATE,
    EXPECTED_DELIVERY_DATE,
    -- Actual delivery date
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE
        WHEN EXPECTED_DELIVERY_DATE <= CURRENT_DATE() AND DELIVERY_VARIANCE_DAYS > 0
        THEN NULL  -- Overdue but not yet arrived
        WHEN EXPECTED_DELIVERY_DATE > CURRENT_DATE()
        THEN NULL  -- Not yet due
        ELSE DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE
    END AS ACTUAL_DELIVERY_DATE,
    BRAND_NAME,
    SKU_CLASS,
    CATEGORY,
    SUPPLIER_NAME,
    DC_STATE,
    ORDERED_UNITS,
    -- Delivered units
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN ROUND(ORDERED_UNITS * DELIVERY_PCT)::INT
        ELSE NULL
    END AS DELIVERED_UNITS,
    FORECAST_UNITS,
    STD_LEAD_TIME AS STD_LEAD_TIME_DAYS,
    -- Actual lead time
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS
        ELSE NULL
    END AS ACTUAL_LEAD_TIME_DAYS,
    -- DIFOT components
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DELIVERY_VARIANCE_DAYS <= 0
        ELSE NULL
    END AS IS_ON_TIME,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DELIVERY_PCT >= 1.0
        ELSE NULL
    END AS IS_IN_FULL,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DELIVERY_VARIANCE_DAYS <= 0 AND DELIVERY_PCT >= 1.0
        ELSE NULL
    END AS IS_DIFOT,
    -- Overtrading
    (ORDERED_UNITS > FORECAST_UNITS * 1.2) OR IS_RUSH_ORDER AS IS_OVERTRADED,
    ROUND((ORDERED_UNITS - FORECAST_UNITS)::FLOAT / NULLIF(FORECAST_UNITS, 0) * 100, 1) AS OVERORDER_PCT,
    IS_RUSH_ORDER,
    -- Status
    CASE
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
            THEN 'DELIVERED'
        WHEN EXPECTED_DELIVERY_DATE < CURRENT_DATE() AND DELIVERY_VARIANCE_DAYS > 0
            THEN 'OVERDUE'
        WHEN ORDER_DATE <= CURRENT_DATE() AND DATEADD(DAY, STD_LEAD_TIME - 3, ORDER_DATE)::DATE <= CURRENT_DATE()
            THEN 'IN_TRANSIT'
        ELSE 'ON_ORDER'
    END AS STATUS,
    CARRIER,
    TRANSPORT_MODE,
    PALLETS,
    -- Receiving timestamp (delivery date + dock-to-check hours)
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DATEADD(HOUR, DOCK_TO_CHECK_HOURS::INT, 
             DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::TIMESTAMP)
        ELSE NULL
    END AS RECEIVING_TIMESTAMP,
    -- Put-away timestamp
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DATEADD(HOUR, (DOCK_TO_CHECK_HOURS + CHECK_TO_PUTAWAY_HOURS)::INT, 
             DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::TIMESTAMP)
        ELSE NULL
    END AS PUT_AWAY_TIMESTAMP,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DOCK_TO_CHECK_HOURS ELSE NULL
    END AS DOCK_TO_CHECK_HOURS,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN CHECK_TO_PUTAWAY_HOURS ELSE NULL
    END AS CHECK_TO_PUTAWAY_HOURS,
    -- Discrepancy
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
        THEN DISC_ROLL < 8  -- 8% discrepancy rate
        ELSE FALSE
    END AS HAS_DISCREPANCY,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
             AND DISC_ROLL < 8
        THEN CASE
            WHEN DISC_ROLL < 4 THEN 'SHORT_SHIPPED'
            WHEN DISC_ROLL < 6 THEN 'DAMAGED'
            ELSE 'WRONG_SKU'
        END
        ELSE NULL
    END AS DISCREPANCY_TYPE,
    CASE 
        WHEN DATEADD(DAY, STD_LEAD_TIME + DELIVERY_VARIANCE_DAYS, ORDER_DATE)::DATE <= CURRENT_DATE()
             AND DISC_ROLL < 8
        THEN GREATEST(1, ROUND(ORDERED_UNITS * (5 + DISC_ROLL) / 100.0)::INT)
        ELSE NULL
    END AS DISCREPANCY_UNITS
FROM enriched;
