-- ============================================================
-- Anko Global Planning — WISSI / Open-to-Buy (OTB) facts
--
-- Scenario 2: AI-Enabled WISSI / Open-to-Buy Planning. Behind the
-- /planning/otb pages and the OTB half of the Cortex Agent's planning tool.
--
--   FACT_OTB_POSITION        weekly stock/sales/receipts/OTB by class
--   FACT_SUPPLIER_COMMITMENT PO-level forward commitments
--
-- WHY WEEKLY SALES ARE DERIVED, NOT GENERATED
-- The weekly sales line comes from FACT_MFP_PLAN (version FC, metric SLS_PHP)
-- divided across the weeks of its period. Generating an independent sales
-- number here would let the OTB page and the MFP page disagree about the same
-- class in the same month -- the single most damaging thing this demo could do,
-- since the whole pitch is one reconciled plan. The weekly split factors
-- average exactly 1.0 across the four weeks, so the weekly rows still sum back
-- to the MFP period total.
--
-- 11_planning_mfp.sql MUST RUN FIRST.
--
-- STOCK ARITHMETIC
-- Closing stock is a genuine running roll, not an independent random number:
--     closing(t) = opening_stock + SUM(receipts - sales - markdown) up to t
-- computed with a cumulative window rather than recursion. This means the
-- numbers survive scrutiny: a planner can add the columns up on screen and the
-- closing balance is right, and forward cover follows from real stock.
--
-- DETERMINISM: HASH-based, no RANDOM(), no CURRENT_DATE(). See the header of
-- 10_planning_dimensions.sql.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.ANALYTICS;

-- ---------- 1. Weekly OTB position by class ----------
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION (
    RBU                   VARCHAR(50),
    DEPARTMENT            VARCHAR(50),
    DEPARTMENT_CODE       VARCHAR(10),
    CLASS                 VARCHAR(50),
    CLASS_CODE            VARCHAR(10),
    LFL_STRATEGY          VARCHAR(1),
    FISCAL_YEAR           VARCHAR(4),
    PERIOD_CODE           VARCHAR(10),
    PERIOD_NO             INT,
    WEEK_NO               INT,
    WEEK_LABEL            VARCHAR(20),
    WEEK_ENDING_DATE      DATE,
    PERIOD_TYPE           VARCHAR(10),
    OPENING_STOCK_UNITS   NUMBER(18,0),
    OPENING_STOCK_PHP     NUMBER(18,2),
    SALES_UNITS           NUMBER(18,0),
    SALES_PHP             NUMBER(18,2),
    RECEIPTS_UNITS        NUMBER(18,0),
    RECEIPTS_PHP          NUMBER(18,2),
    MARKDOWN_UNITS        NUMBER(18,0),
    MARKDOWN_PHP          NUMBER(18,2),
    ON_ORDER_UNITS        NUMBER(18,0),
    ON_ORDER_PHP          NUMBER(18,2),
    CLOSING_STOCK_UNITS   NUMBER(18,0),
    CLOSING_STOCK_PHP     NUMBER(18,2),
    FORWARD_COVER_WEEKS   NUMBER(10,1),
    TARGET_COVER_WEEKS    NUMBER(10,1),
    OTB_AVAILABLE_PHP     NUMBER(18,2),  -- >0 room to buy, <0 overbought
    OTB_PLANNED_PHP       NUMBER(18,2),
    OTB_VARIANCE_PHP      NUMBER(18,2),
    BUY_STATUS            VARCHAR(12),   -- OVERBUY | UNDERBUY | BALANCED
    FX_RATE_PHP_AUD       NUMBER(10,4)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION
WITH
-- Class-level forecast sales straight from the MFP, so the two scenarios
-- cannot disagree.
mfp_fc AS (
    SELECT
        CLASS, PERIOD_CODE,
        MAX(IFF(METRIC = 'SLS_PHP',   VALUE_PHP, NULL)) AS PERIOD_SLS_PHP,
        MAX(IFF(METRIC = 'SLS_UNITS', VALUE_PHP, NULL)) AS PERIOD_SLS_UNITS
    FROM BABY_MART_DEMO.ANALYTICS.FACT_MFP_PLAN
    WHERE PLAN_LEVEL = 'CLASS'
      AND VERSION    = 'FC'
      AND FISCAL_YEAR = 'F27'
      AND METRIC IN ('SLS_PHP', 'SLS_UNITS')
    GROUP BY CLASS, PERIOD_CODE
),
-- Intra-period weekly shape. Deliberately averages to 1.0 (0.92+0.98+1.04+1.06
-- = 4.00) so weekly rows still reconcile to the MFP period total.
week_shape AS (
    SELECT * FROM VALUES (1, 0.92), (2, 0.98), (3, 1.04), (4, 1.06)
    AS t(WEEK_NO, WEEK_FACTOR)
),
-- Seeded buy-position storylines. These are chosen to AGREE with the MFP
-- storylines rather than contradict them, which is what makes the cross-page
-- narrative hold up:
--   PRAMS & STROLLERS / CAR SEATS / CLOTHING are behind budget
--        -> sales miss plan while receipts keep landing -> stock piles up -> OVERBUY
--   NAPPIES & WIPES / FEEDING are ahead of budget
--        -> sell-through outruns the buy -> stock runs out -> UNDERBUY
class_bias AS (
    SELECT
        h.RBU, h.DEPARTMENT, h.DEPARTMENT_CODE, h.CLASS, h.CLASS_CODE,
        h.LFL_STRATEGY,
        CASE h.CLASS_CODE
            WHEN '0504' THEN 'OVERBUY'    -- TRAVEL SYSTEM     (PRAMS & STROLLERS)
            WHEN '0502' THEN 'OVERBUY'    -- DOUBLE STROLLER   (PRAMS & STROLLERS)
            WHEN '0404' THEN 'OVERBUY'    -- HARNESS BOOSTER   (CAR SEATS)
            WHEN '0303' THEN 'OVERBUY'    -- OUTERWEAR         (CLOTHING)
            WHEN '0102' THEN 'UNDERBUY'   -- CRAWLER NAPPIES   (NAPPIES & WIPES)
            WHEN '0201' THEN 'UNDERBUY'   -- BOTTLES           (FEEDING)
            WHEN '0105' THEN 'UNDERBUY'   -- WIPES             (NAPPIES & WIPES)
            ELSE 'BALANCED'
        END AS BIAS,
        -- Target forward cover, 6-11 weeks depending on class
        6.0 + (ABS(HASH(h.CLASS_CODE, 'cover')) % 51) / 10.0 AS TARGET_COVER_WEEKS
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
),
-- ---------- Weekly sales, receipts and markdown ----------
weekly AS (
    SELECT
        cb.RBU, cb.DEPARTMENT, cb.DEPARTMENT_CODE, cb.CLASS, cb.CLASS_CODE,
        cb.LFL_STRATEGY, cb.BIAS, cb.TARGET_COVER_WEEKS,
        d.FISCAL_YEAR, d.PERIOD_CODE, d.PERIOD_NO, d.WEEK_NO, d.WEEK_LABEL,
        d.WEEK_ENDING_DATE, d.PERIOD_TYPE, d.FX_RATE_PHP_AUD,
        -- Absolute week index drives the cumulative stock roll below.
        ((d.PERIOD_NO - 1) * 4) + d.WEEK_NO                       AS WEEK_IDX,
        ROUND(m.PERIOD_SLS_PHP   / 4.0 * ws.WEEK_FACTOR, 2)       AS SALES_PHP,
        ROUND(m.PERIOD_SLS_UNITS / 4.0 * ws.WEEK_FACTOR, 0)       AS SALES_UNITS,
        -- Receipts intentionally mismatch sales for the biased classes: that
        -- mismatch, compounded week over week, is what CREATES the overbuy or
        -- underbuy position rather than it being asserted as a flag.
        --
        -- These ratios are tuned, not arbitrary. Compounded over 48 weeks a
        -- ratio of 0.74 drives underbought classes to zero stock and they then
        -- sit flat on the GREATEST(0,...) floor -- which reads as broken data on
        -- the page rather than as a class that needs a buy. 0.88 depletes cover
        -- from ~8.7 weeks to ~2-3, comfortably under the UNDERBUY threshold
        -- while still leaving a live stock position to plan against.
        CASE cb.BIAS
            WHEN 'OVERBUY'  THEN 1.24
            WHEN 'UNDERBUY' THEN 0.88
            ELSE 1.0 + (ABS(HASH(cb.CLASS_CODE, d.PERIOD_CODE, 'rcpt')) % 91 - 45) / 1000.0
        END                                                       AS RECEIPT_RATIO,
        -- Markdown runs harder where stock is long.
        CASE cb.BIAS
            WHEN 'OVERBUY'  THEN 0.060
            WHEN 'UNDERBUY' THEN 0.012
            ELSE 0.02 + (ABS(HASH(cb.CLASS_CODE, 'mdrate')) % 26) / 1000.0
        END                                                       AS MARKDOWN_RATE
    FROM class_bias cb
    JOIN BABY_MART_DEMO.ANALYTICS.DIM_FISCAL_PERIOD d
      ON d.FISCAL_YEAR = 'F27'
    JOIN week_shape ws ON ws.WEEK_NO = d.WEEK_NO
    JOIN mfp_fc m      ON m.CLASS = cb.CLASS AND m.PERIOD_CODE = d.PERIOD_CODE
),
flows AS (
    SELECT
        w.*,
        ROUND(SALES_PHP   * RECEIPT_RATIO, 2)                   AS RECEIPTS_PHP,
        ROUND(SALES_UNITS * RECEIPT_RATIO, 0)                   AS RECEIPTS_UNITS,
        ROUND(SALES_PHP   * MARKDOWN_RATE, 2)                   AS MARKDOWN_PHP,
        ROUND(SALES_UNITS * MARKDOWN_RATE, 0)                   AS MARKDOWN_UNITS,
        -- Opening stock for week 1 of the year, sized off the target cover.
        ROUND(SALES_PHP   * TARGET_COVER_WEEKS, 2)              AS SEED_STOCK_PHP,
        ROUND(SALES_UNITS * TARGET_COVER_WEEKS, 0)              AS SEED_STOCK_UNITS
    FROM weekly w
),
-- Cumulative roll: closing(t) = seed + SUM(receipts - sales - markdown) to t.
-- A window function rather than a recursive CTE -- same result, one pass.
rolled AS (
    SELECT
        f.*,
        FIRST_VALUE(SEED_STOCK_PHP) OVER (
            PARTITION BY CLASS_CODE ORDER BY WEEK_IDX
        ) AS BASE_STOCK_PHP,
        FIRST_VALUE(SEED_STOCK_UNITS) OVER (
            PARTITION BY CLASS_CODE ORDER BY WEEK_IDX
        ) AS BASE_STOCK_UNITS,
        SUM(RECEIPTS_PHP - SALES_PHP - MARKDOWN_PHP) OVER (
            PARTITION BY CLASS_CODE ORDER BY WEEK_IDX
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CUM_NET_PHP,
        SUM(RECEIPTS_UNITS - SALES_UNITS - MARKDOWN_UNITS) OVER (
            PARTITION BY CLASS_CODE ORDER BY WEEK_IDX
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CUM_NET_UNITS,
        -- Forward 4-week average sales, for a cover figure that looks ahead
        -- rather than backwards. Falls back to the current week at year end.
        COALESCE(AVG(SALES_PHP) OVER (
            PARTITION BY CLASS_CODE ORDER BY WEEK_IDX
            ROWS BETWEEN 1 FOLLOWING AND 4 FOLLOWING
        ), SALES_PHP) AS FWD_AVG_SALES_PHP
    FROM flows f
),
positioned AS (
    SELECT
        r.*,
        GREATEST(0, BASE_STOCK_PHP   + CUM_NET_PHP)   AS CLOSING_STOCK_PHP,
        GREATEST(0, BASE_STOCK_UNITS + CUM_NET_UNITS) AS CLOSING_STOCK_UNITS,
        -- On order = the next two weeks of planned receipts, i.e. what is
        -- already committed and in the pipeline.
        ROUND(RECEIPTS_PHP   * 2 * 0.9, 2)            AS ON_ORDER_PHP,
        ROUND(RECEIPTS_UNITS * 2 * 0.9, 0)            AS ON_ORDER_UNITS
    FROM rolled r
),
final AS (
    SELECT
        p.*,
        ROUND(CLOSING_STOCK_PHP / NULLIF(FWD_AVG_SALES_PHP, 0), 1) AS FORWARD_COVER_WEEKS,
        -- OTB = the gap between the stock the plan WANTS to be holding and what
        -- is already owned or committed. Positive = headroom to buy.
        ROUND((FWD_AVG_SALES_PHP * TARGET_COVER_WEEKS)
              - (CLOSING_STOCK_PHP + ON_ORDER_PHP), 2)             AS OTB_AVAILABLE_PHP,
        ROUND(FWD_AVG_SALES_PHP * TARGET_COVER_WEEKS * 0.35, 2)    AS OTB_PLANNED_PHP
    FROM positioned p
)
SELECT
    RBU, DEPARTMENT, DEPARTMENT_CODE, CLASS, CLASS_CODE, LFL_STRATEGY,
    FISCAL_YEAR, PERIOD_CODE, PERIOD_NO, WEEK_NO, WEEK_LABEL, WEEK_ENDING_DATE,
    PERIOD_TYPE,
    -- Opening stock is last week's closing; week 1 opens on the seed.
    COALESCE(LAG(CLOSING_STOCK_UNITS) OVER (PARTITION BY CLASS_CODE ORDER BY WEEK_IDX),
             BASE_STOCK_UNITS)                                     AS OPENING_STOCK_UNITS,
    COALESCE(LAG(CLOSING_STOCK_PHP)   OVER (PARTITION BY CLASS_CODE ORDER BY WEEK_IDX),
             BASE_STOCK_PHP)                                       AS OPENING_STOCK_PHP,
    SALES_UNITS, SALES_PHP,
    RECEIPTS_UNITS, RECEIPTS_PHP,
    MARKDOWN_UNITS, MARKDOWN_PHP,
    ON_ORDER_UNITS, ON_ORDER_PHP,
    CLOSING_STOCK_UNITS, CLOSING_STOCK_PHP,
    FORWARD_COVER_WEEKS,
    TARGET_COVER_WEEKS,
    OTB_AVAILABLE_PHP,
    OTB_PLANNED_PHP,
    ROUND(OTB_AVAILABLE_PHP - OTB_PLANNED_PHP, 2)                  AS OTB_VARIANCE_PHP,
    -- Status is derived from TOTAL cover -- stock PLUS what is already on order
    -- -- not from stock alone.
    --
    -- This matters because OTB_AVAILABLE already subtracts on-order:
    --   OTB = (target x weekly sales) - (stock + on_order)
    -- so judging status on stock-only cover let the two disagree. A department
    -- could show BALANCED on stock cover against its target while its OTB was
    -- deeply negative, because on-order stock was invisible to the
    -- status but not to the OTB. Basing both on stock + on_order makes them
    -- agree by construction.
    --
    -- The UNDERBUY band is 0.6x rather than 0.5x of target: at half of target a
    -- class is already close to stocking out, which is later than a buyer would
    -- want to hear about it.
    CASE
        WHEN (CLOSING_STOCK_PHP + ON_ORDER_PHP)
             / NULLIF(FWD_AVG_SALES_PHP, 0) > TARGET_COVER_WEEKS * 1.6 THEN 'OVERBUY'
        WHEN (CLOSING_STOCK_PHP + ON_ORDER_PHP)
             / NULLIF(FWD_AVG_SALES_PHP, 0) < TARGET_COVER_WEEKS * 0.6 THEN 'UNDERBUY'
        ELSE 'BALANCED'
    END                                                            AS BUY_STATUS,
    FX_RATE_PHP_AUD
FROM final;

-- ---------- 2. Supplier commitments ----------
-- Gives "end-to-end visibility of supplier commitments and future buying
-- capacity" actual PO rows to stand on. One supplier (Bugaboo Australia) carries
-- a deliberate cluster of slipped ETAs so the exceptions view and the AI have a
-- supply-side risk to find, not just a demand-side one. Bugaboo is chosen
-- because it supplies PRAMS & STROLLERS: the department is already overbought,
-- so late receipts land stock the plan no longer wants -- a supply problem and
-- a demand problem that compound instead of cancelling out.
CREATE OR REPLACE TABLE BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT (
    PO_NUMBER         VARCHAR(20),
    SUPPLIER_NAME     VARCHAR(100),
    SOURCING_COUNTRY  VARCHAR(50),
    RBU               VARCHAR(50),
    DEPARTMENT        VARCHAR(50),
    CLASS             VARCHAR(50),
    CLASS_CODE        VARCHAR(10),
    FISCAL_YEAR       VARCHAR(4),
    PERIOD_CODE       VARCHAR(10),
    ORDER_DATE        DATE,
    ETA_DATE          DATE,
    ORIGINAL_ETA_DATE DATE,
    ETA_SLIP_DAYS     INT,
    COMMITTED_UNITS   NUMBER(18,0),
    COMMITTED_PHP     NUMBER(18,2),
    STATUS            VARCHAR(15),   -- CONFIRMED | IN_TRANSIT | DELAYED | RECEIVED
    FX_RATE_PHP_AUD   NUMBER(10,4)
);

INSERT INTO BABY_MART_DEMO.ANALYTICS.FACT_SUPPLIER_COMMITMENT
-- These are the REAL supplier names from CURATED.DIM_SUPPLIER, not invented
-- ones. Using the same vendors the POS data uses means a supplier named in the
-- planning persona's exposure table can be followed straight through to actual
-- sell-through in the category persona -- which is the whole point of the two
-- personas sitting on one warehouse. SOURCING_COUNTRY is the manufacturing
-- origin behind each brand, which the POS dimension does not carry.
WITH suppliers AS (
    SELECT * FROM VALUES
        (1,  'Bugaboo Australia',        'Netherlands'),
        (2,  'Uppababy ANZ',             'China'),
        (3,  'Mountain Buggy',           'New Zealand'),
        (4,  'Silver Cross AU',          'China'),
        (5,  'Britax Australia',         'Australia'),
        (6,  'Maxi-Cosi (Dorel)',        'China'),
        (7,  'Infasecure',               'China'),
        (8,  'Kimberly-Clark (Huggies)', 'Australia'),
        (9,  'P&G (Pampers)',            'Vietnam'),
        (10, 'Philips (Avent)',          'Indonesia'),
        (11, 'Mayborn (Tommee Tippee)',  'China'),
        (12, 'Hanesbrands (Bonds Baby)', 'Bangladesh')
    AS t(SUPPLIER_ID, SUPPLIER_NAME, SOURCING_COUNTRY)
),
-- 3 POs per class across the plan horizon = 75 commitments.
po_spine AS (
    SELECT
        h.RBU, h.DEPARTMENT, h.CLASS, h.CLASS_CODE,
        s.SEQ AS PO_SEQ,
        -- Deterministic supplier allocation, stable across deploys.
        (ABS(HASH(h.CLASS_CODE, 'sup')) % 12) + 1 AS SUPPLIER_ID
    FROM BABY_MART_DEMO.ANALYTICS.DIM_MERCH_HIERARCHY h
    CROSS JOIN (SELECT SEQ4() + 1 AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 3))) s
),
-- Size each PO off the class's real OTB demand rather than an arbitrary number.
class_demand AS (
    SELECT CLASS_CODE,
           AVG(SALES_PHP)   AS AVG_WK_SLS_PHP,
           AVG(SALES_UNITS) AS AVG_WK_SLS_UNITS
    FROM BABY_MART_DEMO.ANALYTICS.FACT_OTB_POSITION
    GROUP BY CLASS_CODE
),
built AS (
    SELECT
        'PO' || LPAD((ABS(HASH(p.CLASS_CODE, p.PO_SEQ)) % 900000 + 100000)::STRING, 6, '0')
            AS PO_NUMBER,
        sup.SUPPLIER_NAME, sup.SOURCING_COUNTRY,
        p.RBU, p.DEPARTMENT, p.CLASS, p.CLASS_CODE,
        -- POs land in the plan horizon: Jan, Mar, May 2027 orders.
        DATEADD(MONTH, (p.PO_SEQ - 1) * 2, '2026-11-01'::DATE) AS ORDER_DATE,
        -- Lead time 35-85 days by sourcing distance.
        35 + (ABS(HASH(p.CLASS_CODE, p.PO_SEQ, 'lt')) % 51)    AS LEAD_TIME_DAYS,
        -- Bugaboo slips 12-26 days; everyone else is on time.
        IFF(sup.SUPPLIER_NAME = 'Bugaboo Australia',
            12 + (ABS(HASH(p.CLASS_CODE, p.PO_SEQ, 'slip')) % 15), 0) AS ETA_SLIP_DAYS,
        ROUND(cd.AVG_WK_SLS_PHP   * (3 + (ABS(HASH(p.CLASS_CODE, p.PO_SEQ, 'qty')) % 5)), 2)
            AS COMMITTED_PHP,
        ROUND(cd.AVG_WK_SLS_UNITS * (3 + (ABS(HASH(p.CLASS_CODE, p.PO_SEQ, 'qty')) % 5)), 0)
            AS COMMITTED_UNITS
    FROM po_spine p
    JOIN suppliers sup   ON sup.SUPPLIER_ID = p.SUPPLIER_ID
    JOIN class_demand cd ON cd.CLASS_CODE   = p.CLASS_CODE
)
SELECT
    PO_NUMBER, SUPPLIER_NAME, SOURCING_COUNTRY,
    RBU, DEPARTMENT, CLASS, CLASS_CODE,
    'F27' AS FISCAL_YEAR,
    'PD' || LPAD((MOD(MONTH(DATEADD(DAY, LEAD_TIME_DAYS + ETA_SLIP_DAYS, ORDER_DATE)) + 5, 12) + 1)::STRING, 2, '0')
        || 'F27' AS PERIOD_CODE,
    ORDER_DATE,
    DATEADD(DAY, LEAD_TIME_DAYS + ETA_SLIP_DAYS, ORDER_DATE) AS ETA_DATE,
    DATEADD(DAY, LEAD_TIME_DAYS, ORDER_DATE)                 AS ORIGINAL_ETA_DATE,
    ETA_SLIP_DAYS,
    COMMITTED_UNITS,
    COMMITTED_PHP,
    -- Status pinned to fixed dates, never CURRENT_DATE(), so the mix of
    -- received / in-transit / delayed POs cannot drift as the demo ages.
    CASE
        WHEN ETA_SLIP_DAYS > 0                                                    THEN 'DELAYED'
        WHEN DATEADD(DAY, LEAD_TIME_DAYS, ORDER_DATE) < '2027-01-01'::DATE        THEN 'RECEIVED'
        WHEN DATEADD(DAY, LEAD_TIME_DAYS, ORDER_DATE) < '2027-03-01'::DATE        THEN 'IN_TRANSIT'
        ELSE 'CONFIRMED'
    END AS STATUS,
    36.1 AS FX_RATE_PHP_AUD
FROM built;
