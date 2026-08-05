-- ============================================================
-- Baby Mart Supply Chain Demo — Daily Demand Forecast
-- Generates 90 days history + 28 days forward forecast
-- by product x store x day with channel derivation
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY (
    FORECAST_DATE DATE,
    BRAND_NAME VARCHAR(100),
    SKU_CLASS VARCHAR(100),
    CATEGORY VARCHAR(100),
    STORE_NAME VARCHAR(100),
    STATE VARCHAR(10),
    REGION VARCHAR(20),
    CHANNEL VARCHAR(20),
    FORECAST_UNITS FLOAT,
    ACTUAL_UNITS FLOAT,
    FORECAST_REVENUE FLOAT,
    ACTUAL_REVENUE FLOAT,
    IS_FORECAST BOOLEAN
);

-- Generate data using CTEs
-- Top 5 brands x 3 SKU classes x 8 representative stores x 118 days
INSERT INTO BABY_MART_DEMO.ANALYTICS.FORECAST_DEMAND_DAILY
WITH brands AS (
    SELECT * FROM VALUES
        ('Huggies',       'Crawler Nappies',     'Nappies & Wipes',   22.50),
        ('Huggies',       'Newborn Nappies',     'Nappies & Wipes',   18.90),
        ('Huggies',       'Toddler Nappies',     'Nappies & Wipes',   25.20),
        ('Bugaboo',       'Single Stroller',     'Prams & Strollers', 1299.00),
        ('Bugaboo',       'Double Stroller',     'Prams & Strollers', 1899.00),
        ('Bugaboo',       'Capsule Stroller',    'Prams & Strollers', 899.00),
        ('Bonds Baby',    'Bodysuits & Onesies', 'Clothing',          29.95),
        ('Bonds Baby',    'Sleepwear',           'Clothing',          34.95),
        ('Bonds Baby',    'Outerwear',           'Clothing',          44.95),
        ('Avent',         'Bottles',             'Feeding',           24.95),
        ('Avent',         'Sterilisers',         'Feeding',          149.95),
        ('Avent',         'Breast Pumps',        'Feeding',          199.95),
        ('Maxi-Cosi',    'Infant Car Seat',     'Car Seats',        499.00),
        ('Maxi-Cosi',    'Convertible Seat',    'Car Seats',        699.00),
        ('Maxi-Cosi',    'Booster Seat',        'Car Seats',        349.00)
    AS t(BRAND_NAME, SKU_CLASS, CATEGORY, AVG_PRICE)
),
stores AS (
    SELECT * FROM VALUES
        ('Baby Mart Chadstone',   'VIC', 'Metro',    'In-Store', 1.0),
        ('Baby Mart Bondi',       'NSW', 'Metro',    'In-Store', 1.2),
        ('Baby Mart Brisbane CBD','QLD', 'Metro',    'In-Store', 0.9),
        ('Baby Mart Perth City',  'WA',  'Metro',    'In-Store', 0.7),
        ('Baby Mart Geelong',     'VIC', 'Regional', 'In-Store', 0.5),
        ('Baby Mart Newcastle',   'NSW', 'Regional', 'In-Store', 0.6),
        ('Baby Mart Online VIC',  'VIC', 'CBD',      'Online',   0.8),
        ('Baby Mart Online NSW',  'NSW', 'CBD',      'Online',   1.1)
    AS t(STORE_NAME, STATE, REGION, CHANNEL, VOLUME_FACTOR)
),
date_spine AS (
    SELECT DATEADD(DAY, SEQ4(), '2026-03-01')::DATE AS D
    FROM TABLE(GENERATOR(ROWCOUNT => 118))
),
base AS (
    SELECT
        ds.D AS FORECAST_DATE,
        b.BRAND_NAME,
        b.SKU_CLASS,
        b.CATEGORY,
        b.AVG_PRICE,
        s.STORE_NAME,
        s.STATE,
        s.REGION,
        s.CHANNEL,
        s.VOLUME_FACTOR,
        -- Base daily demand varies by category
        CASE b.CATEGORY
            WHEN 'Nappies & Wipes' THEN 8.0
            WHEN 'Clothing' THEN 3.0
            WHEN 'Feeding' THEN 2.5
            WHEN 'Prams & Strollers' THEN 0.3
            WHEN 'Car Seats' THEN 0.4
        END AS BASE_DEMAND,
        -- Day-of-week seasonality (weekends higher for retail)
        CASE DAYOFWEEK(ds.D)
            WHEN 0 THEN 1.3  -- Sunday
            WHEN 6 THEN 1.4  -- Saturday
            WHEN 5 THEN 1.1  -- Friday
            ELSE 0.9
        END AS DOW_FACTOR,
        -- Trend: Online growing 2% per week, in-store flat
        CASE WHEN s.CHANNEL = 'Online'
            THEN 1.0 + (DATEDIFF(DAY, '2026-03-01', ds.D) * 0.003)
            ELSE 1.0
        END AS TREND_FACTOR,
        -- Add a demand spike for Huggies Crawlers in late May (causes the overtrading story)
        CASE WHEN b.BRAND_NAME = 'Huggies' AND b.SKU_CLASS = 'Crawler Nappies'
             AND ds.D BETWEEN '2026-05-15' AND '2026-06-15'
             AND s.CHANNEL = 'Online'
            THEN 1.8  -- 80% spike in online demand
            ELSE 1.0
        END AS SPIKE_FACTOR
    FROM date_spine ds
    CROSS JOIN brands b
    CROSS JOIN stores s
)
SELECT
    FORECAST_DATE,
    BRAND_NAME,
    SKU_CLASS,
    CATEGORY,
    STORE_NAME,
    STATE,
    REGION,
    CHANNEL,
    -- Forecast (what model predicted — doesn't know about spike until it starts)
    GREATEST(0, ROUND(
        BASE_DEMAND * VOLUME_FACTOR * DOW_FACTOR * TREND_FACTOR
        * (CASE WHEN SPIKE_FACTOR > 1 AND FORECAST_DATE < '2026-05-25' THEN 1.0 ELSE SPIKE_FACTOR * 0.7 END)
        * (1 + (RANDOM() % 100) / 500.0),  -- ±20% noise
    1)) AS FORECAST_UNITS,
    -- Actuals (only for past dates — includes the spike)
    CASE WHEN FORECAST_DATE <= CURRENT_DATE() THEN
        GREATEST(0, ROUND(
            BASE_DEMAND * VOLUME_FACTOR * DOW_FACTOR * TREND_FACTOR * SPIKE_FACTOR
            * (1 + (RANDOM() % 100) / 400.0),  -- ±25% noise
        1))
    ELSE NULL END AS ACTUAL_UNITS,
    -- Revenue
    GREATEST(0, ROUND(
        BASE_DEMAND * VOLUME_FACTOR * DOW_FACTOR * TREND_FACTOR
        * (CASE WHEN SPIKE_FACTOR > 1 AND FORECAST_DATE < '2026-05-25' THEN 1.0 ELSE SPIKE_FACTOR * 0.7 END)
        * AVG_PRICE * (1 + (RANDOM() % 100) / 500.0),
    2)) AS FORECAST_REVENUE,
    CASE WHEN FORECAST_DATE <= CURRENT_DATE() THEN
        GREATEST(0, ROUND(
            BASE_DEMAND * VOLUME_FACTOR * DOW_FACTOR * TREND_FACTOR * SPIKE_FACTOR
            * AVG_PRICE * (1 + (RANDOM() % 100) / 400.0),
        2))
    ELSE NULL END AS ACTUAL_REVENUE,
    -- Is forecast flag
    FORECAST_DATE > CURRENT_DATE() AS IS_FORECAST
FROM base;
