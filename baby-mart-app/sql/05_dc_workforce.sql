-- ============================================================
-- Baby Mart Supply Chain Demo — DC Workforce / Rostering
-- Staffing vs volume for each DC/shift to show capacity gaps
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.DC_WORKFORCE (
    SHIFT_DATE DATE,
    DC_STATE VARCHAR(10),
    SHIFT VARCHAR(10),
    SHIFT_START TIME,
    SHIFT_END TIME,
    STAFF_ROSTERED INT,
    STAFF_ACTUAL INT,
    INBOUND_PALLETS_EXPECTED INT,
    INBOUND_PALLETS_ACTUAL INT,
    INBOUND_POS_EXPECTED INT,
    OUTBOUND_ORDERS_EXPECTED INT,
    OUTBOUND_ORDERS_ACTUAL INT,
    OUTBOUND_PALLETS_EXPECTED FLOAT,
    PALLETS_PER_PERSON_HOUR FLOAT,
    STAFF_REQUIRED INT,
    STAFF_GAP INT,
    IS_UNDERSTAFFED BOOLEAN,
    RISK_LEVEL VARCHAR(10)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.DC_WORKFORCE
WITH dcs AS (
    SELECT * FROM VALUES
        ('NSW', 8, 6),   -- base staff AM, PM
        ('VIC', 7, 5),
        ('QLD', 5, 4),
        ('SA',  4, 3),
        ('WA',  4, 3)
    AS t(DC_STATE, BASE_STAFF_AM, BASE_STAFF_PM)
),
shifts AS (
    SELECT * FROM VALUES
        ('AM',    '06:00:00'::TIME, '14:00:00'::TIME),
        ('PM',    '14:00:00'::TIME, '22:00:00'::TIME)
    AS t(SHIFT, SHIFT_START, SHIFT_END)
),
date_spine AS (
    SELECT DATEADD(DAY, SEQ4(), '2026-05-01')::DATE AS D
    FROM TABLE(GENERATOR(ROWCOUNT => 50))
    WHERE DATEADD(DAY, SEQ4(), '2026-05-01')::DATE <= DATEADD(DAY, 3, CURRENT_DATE())
),
base AS (
    SELECT
        ds.D AS SHIFT_DATE,
        dc.DC_STATE,
        dc.BASE_STAFF_AM,
        dc.BASE_STAFF_PM,
        sh.SHIFT,
        sh.SHIFT_START,
        sh.SHIFT_END,
        -- Rostered staff (base +/- variance, weekends lower)
        CASE WHEN sh.SHIFT = 'AM'
            THEN dc.BASE_STAFF_AM + (ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || 'am')) % 3) - 1
            ELSE dc.BASE_STAFF_PM + (ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || 'pm')) % 3) - 1
        END AS STAFF_ROSTERED_RAW,
        -- Actual (sick days, no-shows: ~15% chance of -1 or -2)
        CASE
            WHEN ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'sick')) % 100 < 10 THEN -1
            WHEN ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'sick')) % 100 < 15 THEN -2
            ELSE 0
        END AS SICK_ADJUSTMENT,
        -- Inbound pallets (varies by day, spikes on Mon/Tue when international arrives)
        CASE
            WHEN DAYOFWEEK(ds.D) IN (1, 2) THEN 12 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'in')) % 15
            WHEN DAYOFWEEK(ds.D) IN (0, 6) THEN 3 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'in')) % 6
            ELSE 6 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'in')) % 10
        END AS INBOUND_PALLETS_BASE,
        -- Outbound orders
        CASE
            WHEN DAYOFWEEK(ds.D) IN (5, 6) THEN 30 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'out')) % 40  -- Fri/Sat higher
            WHEN DAYOFWEEK(ds.D) = 0 THEN 10 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'out')) % 15  -- Sunday lower
            ELSE 20 + ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'out')) % 30
        END AS OUTBOUND_ORDERS_BASE,
        -- Productivity target: 3.5 pallets per person per hour (8 hour shift = 28 pallet-equivalents per person)
        3.2 + (ABS(HASH(dc.DC_STATE || ds.D::VARCHAR || sh.SHIFT || 'prod')) % 8) / 10.0 AS PRODUCTIVITY
    FROM date_spine ds
    CROSS JOIN dcs dc
    CROSS JOIN shifts sh
    WHERE DAYOFWEEK(ds.D) NOT IN (0)  -- No Sunday shifts (reduced ops)
       OR dc.DC_STATE IN ('NSW', 'VIC')  -- Only big DCs run Sunday
)
SELECT
    SHIFT_DATE,
    DC_STATE,
    SHIFT,
    SHIFT_START,
    SHIFT_END,
    -- Staff rostered (minimum 2)
    GREATEST(2, STAFF_ROSTERED_RAW) AS STAFF_ROSTERED,
    -- Staff actual (after sick/no-show)
    GREATEST(1, STAFF_ROSTERED_RAW + SICK_ADJUSTMENT) AS STAFF_ACTUAL,
    -- Inbound (AM shift gets more inbound, PM more outbound)
    CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4)::INT END AS INBOUND_PALLETS_EXPECTED,
    CASE WHEN SHIFT_DATE <= CURRENT_DATE()
        THEN CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE + (ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'act')) % 5) - 2
             ELSE ROUND(INBOUND_PALLETS_BASE * 0.4)::INT + (ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'act2')) % 3) - 1 END
        ELSE NULL END AS INBOUND_PALLETS_ACTUAL,
    -- POs expected
    CASE WHEN SHIFT = 'AM' THEN 3 + ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'po')) % 5
         ELSE 1 + ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'po2')) % 3 END AS INBOUND_POS_EXPECTED,
    -- Outbound
    CASE WHEN SHIFT = 'PM' THEN OUTBOUND_ORDERS_BASE ELSE ROUND(OUTBOUND_ORDERS_BASE * 0.6)::INT END AS OUTBOUND_ORDERS_EXPECTED,
    CASE WHEN SHIFT_DATE <= CURRENT_DATE()
        THEN CASE WHEN SHIFT = 'PM' THEN OUTBOUND_ORDERS_BASE + (ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'oact')) % 10) - 5
             ELSE ROUND(OUTBOUND_ORDERS_BASE * 0.6)::INT + (ABS(HASH(DC_STATE || SHIFT_DATE::VARCHAR || 'oact2')) % 6) - 3 END
        ELSE NULL END AS OUTBOUND_ORDERS_ACTUAL,
    -- Outbound pallets
    ROUND(OUTBOUND_ORDERS_BASE / 8.0, 1) AS OUTBOUND_PALLETS_EXPECTED,
    -- Productivity
    PRODUCTIVITY AS PALLETS_PER_PERSON_HOUR,
    -- Staff required (total pallets ÷ productivity ÷ 8 hour shift, rounded up)
    CEIL((CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4) END
         + ROUND(OUTBOUND_ORDERS_BASE / 8.0))
         / (PRODUCTIVITY * 8)) AS STAFF_REQUIRED,
    -- Staff gap
    CEIL((CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4) END
         + ROUND(OUTBOUND_ORDERS_BASE / 8.0))
         / (PRODUCTIVITY * 8))
    - GREATEST(1, STAFF_ROSTERED_RAW + SICK_ADJUSTMENT) AS STAFF_GAP,
    -- Understaffed
    CEIL((CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4) END
         + ROUND(OUTBOUND_ORDERS_BASE / 8.0))
         / (PRODUCTIVITY * 8))
    > GREATEST(1, STAFF_ROSTERED_RAW + SICK_ADJUSTMENT) AS IS_UNDERSTAFFED,
    -- Risk level
    CASE
        WHEN CEIL((CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4) END
             + ROUND(OUTBOUND_ORDERS_BASE / 8.0))
             / (PRODUCTIVITY * 8))
             - GREATEST(1, STAFF_ROSTERED_RAW + SICK_ADJUSTMENT) >= 2 THEN 'RED'
        WHEN CEIL((CASE WHEN SHIFT = 'AM' THEN INBOUND_PALLETS_BASE ELSE ROUND(INBOUND_PALLETS_BASE * 0.4) END
             + ROUND(OUTBOUND_ORDERS_BASE / 8.0))
             / (PRODUCTIVITY * 8))
             - GREATEST(1, STAFF_ROSTERED_RAW + SICK_ADJUSTMENT) >= 1 THEN 'AMBER'
        ELSE 'GREEN'
    END AS RISK_LEVEL
FROM base;
