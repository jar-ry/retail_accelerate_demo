-- ============================================================
-- Baby Mart Supply Chain Demo — DC to Store Replenishment (Outbound)
-- Full pick/pack/dispatch lifecycle for store replenishment + online orders
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE (
    SHIPMENT_ID VARCHAR(20),
    ORDER_RECEIVED_TIMESTAMP TIMESTAMP,
    PICK_COMPLETE_TIMESTAMP TIMESTAMP,
    PACK_COMPLETE_TIMESTAMP TIMESTAMP,
    DISPATCH_TIMESTAMP TIMESTAMP,
    DELIVERY_TIMESTAMP TIMESTAMP,
    BRAND_NAME VARCHAR(100),
    SKU_CLASS VARCHAR(100),
    CATEGORY VARCHAR(100),
    DC_STATE VARCHAR(10),
    STORE_NAME VARCHAR(100),
    DEST_STATE VARCHAR(10),
    DEST_REGION VARCHAR(20),
    CHANNEL VARCHAR(20),
    PLANNED_UNITS INT,
    ACTUAL_UNITS INT,
    PALLETS FLOAT,
    CARRIER VARCHAR(50),
    TRANSIT_DAYS_PLANNED INT,
    TRANSIT_DAYS_ACTUAL INT,
    ORDER_TO_DISPATCH_HOURS FLOAT,
    PICK_ACCURACY_PCT FLOAT,
    ON_TIME_DISPATCH BOOLEAN,
    ON_TIME_DELIVERY BOOLEAN,
    STATUS VARCHAR(20),
    IS_SPLIT_SHIPMENT BOOLEAN,
    IS_BACKORDER BOOLEAN,
    IS_FORECAST BOOLEAN
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_DC_STORE
WITH products AS (
    SELECT * FROM VALUES
        ('Huggies',     'Crawler Nappies',     'Nappies & Wipes'),
        ('Huggies',     'Newborn Nappies',     'Nappies & Wipes'),
        ('Huggies',     'Toddler Nappies',     'Nappies & Wipes'),
        ('Bonds Baby',  'Bodysuits & Onesies', 'Clothing'),
        ('Bonds Baby',  'Sleepwear',           'Clothing'),
        ('Avent',       'Bottles',             'Feeding'),
        ('Bugaboo',     'Single Stroller',     'Prams & Strollers'),
        ('Maxi-Cosi',  'Infant Car Seat',     'Car Seats')
    AS t(BRAND_NAME, SKU_CLASS, CATEGORY)
),
routes AS (
    SELECT * FROM VALUES
        ('VIC', 'Baby Mart Chadstone',    'VIC', 'Metro',    'In-Store',       'Toll',         1),
        ('VIC', 'Baby Mart Geelong',      'VIC', 'Regional', 'In-Store',       'Toll',         2),
        ('NSW', 'Baby Mart Bondi',        'NSW', 'Metro',    'In-Store',       'StarTrack',    1),
        ('NSW', 'Baby Mart Newcastle',    'NSW', 'Regional', 'In-Store',       'StarTrack',    2),
        ('QLD', 'Baby Mart Brisbane CBD', 'QLD', 'Metro',    'In-Store',       'Toll',         1),
        ('VIC', 'Baby Mart Online VIC',   'VIC', 'CBD',      'Online-Direct',  'Australia Post',1),
        ('NSW', 'Baby Mart Online NSW',   'NSW', 'CBD',      'Online-Direct',  'Australia Post',1),
        ('WA',  'Baby Mart Perth City',   'WA',  'Metro',    'In-Store',       'StarTrack',    3)
    AS t(DC_STATE, STORE_NAME, DEST_STATE, DEST_REGION, CHANNEL, CARRIER, TRANSIT_DAYS_PLANNED)
),
date_spine AS (
    SELECT DATEADD(DAY, SEQ4(), '2026-03-01')::DATE AS D
    FROM TABLE(GENERATOR(ROWCOUNT => 110))
    WHERE DATEADD(DAY, SEQ4(), '2026-03-01')::DATE <= DATEADD(DAY, 7, CURRENT_DATE())
),
raw_shipments AS (
    SELECT
        p.BRAND_NAME,
        p.SKU_CLASS,
        p.CATEGORY,
        r.DC_STATE,
        r.STORE_NAME,
        r.DEST_STATE,
        r.DEST_REGION,
        r.CHANNEL,
        r.CARRIER,
        r.TRANSIT_DAYS_PLANNED,
        ds.D AS SHIP_DATE,
        -- Not every route ships every day — stores get 2-3 shipments per week, online daily
        ABS(HASH(p.BRAND_NAME || r.STORE_NAME || ds.D::VARCHAR)) % 100 AS SAMPLE_ROLL
    FROM products p
    CROSS JOIN routes r
    CROSS JOIN date_spine ds
    WHERE ABS(HASH(p.BRAND_NAME || r.STORE_NAME || ds.D::VARCHAR)) % 100 < 
        CASE WHEN r.CHANNEL = 'Online-Direct' THEN 40 ELSE 20 END
),
enriched AS (
    SELECT
        'SH-' || LPAD(ROW_NUMBER() OVER (ORDER BY SHIP_DATE, DC_STATE, STORE_NAME)::VARCHAR, 6, '0') AS SHIPMENT_ID,
        SHIP_DATE,
        BRAND_NAME,
        SKU_CLASS,
        CATEGORY,
        DC_STATE,
        STORE_NAME,
        DEST_STATE,
        DEST_REGION,
        CHANNEL,
        CARRIER,
        TRANSIT_DAYS_PLANNED,
        -- Units
        CASE
            WHEN CATEGORY = 'Nappies & Wipes' THEN 20 + ABS(HASH(SHIPMENT_ID || 'u')) % 80
            WHEN CATEGORY = 'Clothing' THEN 10 + ABS(HASH(SHIPMENT_ID || 'u')) % 40
            WHEN CATEGORY = 'Feeding' THEN 5 + ABS(HASH(SHIPMENT_ID || 'u')) % 20
            ELSE 2 + ABS(HASH(SHIPMENT_ID || 'u')) % 8
        END AS PLANNED_UNITS,
        -- Processing times (hours from order received)
        1.0 + (ABS(HASH(SHIPMENT_ID || 'pick')) % 30) / 10.0 AS PICK_HOURS,      -- 1-4 hours
        0.5 + (ABS(HASH(SHIPMENT_ID || 'pack')) % 20) / 10.0 AS PACK_HOURS,      -- 0.5-2.5 hours
        0.5 + (ABS(HASH(SHIPMENT_ID || 'disp')) % 15) / 10.0 AS DISPATCH_HOURS,  -- 0.5-2 hours
        -- Pick accuracy
        CASE
            WHEN ABS(HASH(SHIPMENT_ID || 'acc')) % 100 < 3 THEN 95.0 + (ABS(HASH(SHIPMENT_ID || 'a2')) % 40) / 10.0  -- 95-99% (errors)
            ELSE 100.0
        END AS PICK_ACCURACY_PCT,
        -- Transit variance
        CASE
            WHEN ABS(HASH(SHIPMENT_ID || 'tv')) % 100 < 15 THEN 1  -- 15% chance of +1 day delay
            ELSE 0
        END AS TRANSIT_VARIANCE,
        -- Issues
        ABS(HASH(SHIPMENT_ID || 'split')) % 100 < 5 AS IS_SPLIT_SHIPMENT,
        ABS(HASH(SHIPMENT_ID || 'back')) % 100 < 4 AS IS_BACKORDER,
        -- Short pick (actual < planned)
        CASE
            WHEN ABS(HASH(SHIPMENT_ID || 'short')) % 100 < 8 THEN 0.8 + (ABS(HASH(SHIPMENT_ID || 'sp')) % 15) / 100.0
            ELSE 1.0
        END AS ACTUAL_PCT
    FROM raw_shipments
    WHERE SAMPLE_ROLL < CASE WHEN CHANNEL = 'Online-Direct' THEN 40 ELSE 20 END
)
SELECT
    SHIPMENT_ID,
    -- Order received (morning of ship date, 6am)
    DATEADD(HOUR, 6, SHIP_DATE::TIMESTAMP) AS ORDER_RECEIVED_TIMESTAMP,
    -- Pick complete
    CASE WHEN SHIP_DATE <= CURRENT_DATE()
        THEN DATEADD(MINUTE, (PICK_HOURS * 60)::INT, DATEADD(HOUR, 6, SHIP_DATE::TIMESTAMP))
        ELSE NULL END AS PICK_COMPLETE_TIMESTAMP,
    -- Pack complete
    CASE WHEN SHIP_DATE <= CURRENT_DATE()
        THEN DATEADD(MINUTE, ((PICK_HOURS + PACK_HOURS) * 60)::INT, DATEADD(HOUR, 6, SHIP_DATE::TIMESTAMP))
        ELSE NULL END AS PACK_COMPLETE_TIMESTAMP,
    -- Dispatch
    CASE WHEN SHIP_DATE <= CURRENT_DATE()
        THEN DATEADD(MINUTE, ((PICK_HOURS + PACK_HOURS + DISPATCH_HOURS) * 60)::INT, DATEADD(HOUR, 6, SHIP_DATE::TIMESTAMP))
        ELSE NULL END AS DISPATCH_TIMESTAMP,
    -- Delivery
    CASE WHEN DATEADD(DAY, TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE, SHIP_DATE)::DATE <= CURRENT_DATE()
        THEN DATEADD(HOUR, 10, DATEADD(DAY, TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE, SHIP_DATE)::TIMESTAMP)
        ELSE NULL END AS DELIVERY_TIMESTAMP,
    BRAND_NAME,
    SKU_CLASS,
    CATEGORY,
    DC_STATE,
    STORE_NAME,
    DEST_STATE,
    DEST_REGION,
    CHANNEL,
    PLANNED_UNITS,
    CASE WHEN SHIP_DATE <= CURRENT_DATE() THEN ROUND(PLANNED_UNITS * ACTUAL_PCT)::INT ELSE NULL END AS ACTUAL_UNITS,
    -- Pallets (fractional for smaller shipments)
    ROUND(PLANNED_UNITS / 50.0, 1) AS PALLETS,
    CARRIER,
    TRANSIT_DAYS_PLANNED,
    CASE WHEN DATEADD(DAY, TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE, SHIP_DATE)::DATE <= CURRENT_DATE()
        THEN TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE ELSE NULL END AS TRANSIT_DAYS_ACTUAL,
    -- Order to dispatch hours
    CASE WHEN SHIP_DATE <= CURRENT_DATE()
        THEN ROUND(PICK_HOURS + PACK_HOURS + DISPATCH_HOURS, 1)
        ELSE NULL END AS ORDER_TO_DISPATCH_HOURS,
    PICK_ACCURACY_PCT,
    -- On-time dispatch (must dispatch by 4pm = within 10 hours of 6am order)
    CASE WHEN SHIP_DATE <= CURRENT_DATE()
        THEN (PICK_HOURS + PACK_HOURS + DISPATCH_HOURS) <= 10.0
        ELSE NULL END AS ON_TIME_DISPATCH,
    -- On-time delivery
    CASE WHEN DATEADD(DAY, TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE, SHIP_DATE)::DATE <= CURRENT_DATE()
        THEN TRANSIT_VARIANCE <= 0
        ELSE NULL END AS ON_TIME_DELIVERY,
    -- Status
    CASE
        WHEN DATEADD(DAY, TRANSIT_DAYS_PLANNED + TRANSIT_VARIANCE, SHIP_DATE)::DATE <= CURRENT_DATE() THEN 'DELIVERED'
        WHEN SHIP_DATE <= CURRENT_DATE() AND DATEADD(DAY, TRANSIT_DAYS_PLANNED, SHIP_DATE)::DATE > CURRENT_DATE() THEN 'IN_TRANSIT'
        WHEN SHIP_DATE <= CURRENT_DATE() THEN 'IN_TRANSIT'
        WHEN SHIP_DATE = DATEADD(DAY, 1, CURRENT_DATE())::DATE THEN 'PLANNED'
        ELSE 'PLANNED'
    END AS STATUS,
    IS_SPLIT_SHIPMENT,
    IS_BACKORDER,
    SHIP_DATE > CURRENT_DATE() AS IS_FORECAST
FROM enriched;
