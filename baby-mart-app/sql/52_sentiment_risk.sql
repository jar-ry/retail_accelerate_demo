-- ============================================================
-- NPS Analyst — sentiment risk radar (Snowflake ML)
--
-- "Where will sentiment break next?" A store's customer voice breaks when its
-- negative feedback jumps well above its own norm -- the week the NSW nappy
-- shortage met a campaign promoting the nappies, the week the website went down,
-- the month Gold members started complaining about price. The model learns which
-- store-weeks break from what was known going into the week, and scores the six
-- weeks after the voice clock from what is known about them now: the supply
-- position (stock alerts, recovery plans), the campaigns booked, the purchase
-- orders due into the store's DC, the suppliers' DIFOT, and the store's recent voice.
--
-- 1. RISK_FEATURES: store x week, history and the six forward weeks, one view so
--    training and scoring compute every feature the same way.
--      Known ahead of the week:
--        SHORT_BRANDS / LOW_BRANDS      brands SHORT / LOW at the store that week
--        PROMOTED_SHORT                 a live campaign promotes a brand the store is SHORT of
--        CAMPAIGNS_LIVE                 campaigns sending that week
--        SHORT_BRAND_FILL_PCT           expected fill of POs due into the store's DC that week and the
--                                       week before, for the brands the store is SHORT or LOW of
--                                       (delivered units, or the supply plan's forecast on open lines;
--                                       capped at 100 -- an open line's forecast can exceed the order)
--        SUPPLIER_DIFOT_PCT             latest scorecard DIFOT of those brands, two weeks back
--      The store's voice up to the week before (forward weeks: the last complete week):
--        NEG_LAST_WEEK, NEG_BASE_PER_WEEK, OOS_LAST_2W, PRICE_LAST_2W, DETRACTOR_RATE_8W_PCT
--    Label SENTIMENT_BREAK: negative voice items that week >= max(4, 3 x the store's
--    weekly norm over weeks T-9..T-2).
--    Not features: the DC's fill across all brands (DC_FILL_PCT, kept for context)
--    and the state. With ~150 breaks the trees split on whatever separates them,
--    and both carried noise, not cause: DC-wide fill moved with the PO book's
--    random draws, and the state only named where past breaks happened.
-- 2. STORE_SENTIMENT_RISK_MODEL: SNOWFLAKE.ML.CLASSIFICATION (gradient boosting)
--    trained on weeks 15 Sep 2025 - 27 Apr 2026, with its evaluation metrics and
--    feature importance kept in RISK_MODEL_METRICS / RISK_MODEL_FEATURE_IMPORTANCE.
-- 3. SCORE_STORE_RISK(): scores the forward weeks into STORE_RISK_FORECAST with a
--    band and the drivers in words. Supply is read live, so after a planner
--    approves a recovery plan a re-score shows the risk it removed.
--
-- Run AFTER sql/50. Training takes about a minute on an X-Small warehouse.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_ANALYTICS_WH;
USE SCHEMA BABY_MART_DEMO.SENTIMENT;

-- ---------- 1. Features ----------
CREATE OR REPLACE VIEW RISK_FEATURES
  COMMENT = 'Store x week features for the sentiment risk model: supply, campaigns, DC inbound and supplier DIFOT known ahead of the week, and the store''s voice up to the week before. Label SENTIMENT_BREAK on history.'
AS
WITH clock AS (
  SELECT BABY_MART_DEMO.SENTIMENT.SENTIMENT_AS_OF() AS AS_OF,
         DATEADD('week', -1, DATE_TRUNC('week', BABY_MART_DEMO.SENTIMENT.SENTIMENT_AS_OF()))::DATE AS LAST_FULL_WEEK
), wk AS (
  SELECT DATEADD('week', ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, '2025-07-07'::DATE) AS WEEK_START
  FROM TABLE(GENERATOR(ROWCOUNT => 50))
), st AS (
  SELECT STORE_CODE, STORE_NAME, STATE, CASE STATE WHEN 'ACT' THEN 'NSW' WHEN 'TAS' THEN 'VIC' WHEN 'NT' THEN 'QLD' ELSE STATE END AS DC_STATE
  FROM BABY_MART_DEMO.CURATED.DIM_STORE
), grid AS (
  SELECT st.*, wk.WEEK_START,
         IFF(wk.WEEK_START > c.LAST_FULL_WEEK, 'FORWARD', 'HISTORY') AS PERIOD,
         -- The week whose voice the features read: the week before, or for a
         -- forward week the last complete week.
         IFF(wk.WEEK_START > c.LAST_FULL_WEEK, c.LAST_FULL_WEEK, DATEADD('week', -1, wk.WEEK_START))::DATE AS VOICE_WEEK
  FROM st CROSS JOIN wk CROSS JOIN clock c
  WHERE wk.WEEK_START <> DATE_TRUNC('week', c.AS_OF)          -- the partial week is neither
    AND wk.WEEK_START <= DATEADD('week', 6, DATE_TRUNC('week', c.AS_OF))
), voice AS (
  SELECT g.STORE_CODE, w.WEEK_START, COALESCE(SUM(h.NEGATIVE_ITEMS), 0) AS NEG, COALESCE(SUM(h.OOS_MENTIONS), 0) AS OOS,
         COALESCE(SUM(h.PRICE_COMPLAINTS), 0) AS PRICE, COALESCE(SUM(h.RESPONSES), 0) AS R, COALESCE(SUM(h.DETRACTORS), 0) AS D
  FROM st g CROSS JOIN wk w
  LEFT JOIN BABY_MART_DEMO.SENTIMENT.HEALTH_WEEKLY h ON h.STORE_CODE = g.STORE_CODE AND h.EVENT_WEEK = w.WEEK_START
  GROUP BY 1, 2
), vroll AS (
  SELECT v.*,
         SUM(OOS) OVER (PARTITION BY STORE_CODE ORDER BY WEEK_START ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS OOS_2W,
         SUM(PRICE) OVER (PARTITION BY STORE_CODE ORDER BY WEEK_START ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS PRICE_2W,
         SUM(R) OVER (PARTITION BY STORE_CODE ORDER BY WEEK_START ROWS BETWEEN 7 PRECEDING AND CURRENT ROW) AS R_8W,
         SUM(D) OVER (PARTITION BY STORE_CODE ORDER BY WEEK_START ROWS BETWEEN 7 PRECEDING AND CURRENT ROW) AS D_8W,
         -- The norm a week's voice is judged against: weeks T-9..T-2, so the week
         -- before a break does not raise the bar for it.
         AVG(NEG) OVER (PARTITION BY STORE_CODE ORDER BY WEEK_START ROWS BETWEEN 9 PRECEDING AND 2 PRECEDING) AS NORM
  FROM voice v
), supply AS (
  SELECT STORE_CODE, WEEK_START, COUNT_IF(STATUS = 'SHORT') AS SHORT_BRANDS, COUNT_IF(STATUS = 'LOW') AS LOW_BRANDS,
         ARRAY_AGG(IFF(STATUS = 'SHORT', BRAND_NAME, NULL)) AS SHORT_LIST,
         ARRAY_AGG(IFF(STATUS IN ('SHORT', 'LOW'), BRAND_NAME, NULL)) AS SHORT_LOW_LIST,
         BOOLOR_AGG(IS_RECOVERING) AS RECOVERING
  FROM BABY_MART_DEMO.SENTIMENT.STORE_SUPPLY_WEEKLY GROUP BY 1, 2
), camp AS (
  SELECT g.STORE_CODE, g.WEEK_START, COUNT(DISTINCT c.CAMPAIGN_ID) AS CAMPAIGNS_LIVE,
         MAX(IFF(ARRAY_CONTAINS(c.PROMOTED_BRAND::VARIANT, s.SHORT_LIST), 1, 0)) AS PROMOTED_SHORT,
         MAX(IFF(ARRAY_CONTAINS(c.PROMOTED_BRAND::VARIANT, s.SHORT_LIST), c.CAMPAIGN_ID, NULL)) AS PROMOTING_CAMPAIGN
  FROM grid g
  JOIN supply s ON s.STORE_CODE = g.STORE_CODE AND s.WEEK_START = g.WEEK_START
  JOIN BABY_MART_DEMO.CAMPAIGN.CAMPAIGN c
    ON c.STATUS IN ('LIVE', 'MEASURED') AND c.START_DATE <= DATEADD('day', 6, g.WEEK_START) AND c.END_DATE >= g.WEEK_START
  GROUP BY 1, 2
), dc AS (
  SELECT DC_STATE, WEEK_START,
         SUM(DELIVERED_UNITS + OPEN_FORECAST_UNITS) AS EXP_UNITS, SUM(ORDERED_UNITS) AS ORD_UNITS
  FROM BABY_MART_DEMO.SENTIMENT.DC_INBOUND_WEEKLY GROUP BY 1, 2
), dcb AS (
  SELECT DC_STATE, BRAND_NAME, WEEK_START, SUM(DELIVERED_UNITS + OPEN_FORECAST_UNITS) AS EXP_UNITS, SUM(ORDERED_UNITS) AS ORD_UNITS
  FROM BABY_MART_DEMO.SENTIMENT.DC_INBOUND_WEEKLY GROUP BY 1, 2, 3
), brandfill AS (
  SELECT g.STORE_CODE, g.WEEK_START, LEAST(ROUND(100 * SUM(b.EXP_UNITS) / NULLIF(SUM(b.ORD_UNITS), 0), 1), 100) AS SHORT_BRAND_FILL_PCT
  FROM grid g
  JOIN supply s ON s.STORE_CODE = g.STORE_CODE AND s.WEEK_START = g.WEEK_START
  JOIN dcb b ON b.DC_STATE = g.DC_STATE AND ARRAY_CONTAINS(b.BRAND_NAME::VARIANT, s.SHORT_LOW_LIST)
            AND b.WEEK_START BETWEEN DATEADD('week', -1, g.WEEK_START) AND g.WEEK_START
  GROUP BY 1, 2
), difot AS (
  SELECT s.BRAND_NAME, d.CALENDAR_DATE AS WEEK_START, s.DIFOT_PCT
  FROM BABY_MART_DEMO.ANALYTICS.DT_SUPPLIER_DIFOT s
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.FISCAL_YEAR = s.FISCAL_YEAR AND d.FISCAL_WEEK = s.FISCAL_WEEK AND d.DAY_OF_WEEK = 'Monday'
  WHERE s.CLASS IS NULL
), sdifot AS (
  -- The scorecard is published two weeks behind; a forward week sees the last
  -- one published by the voice clock.
  SELECT g.STORE_CODE, g.WEEK_START, MIN(df.DIFOT_PCT) AS SUPPLIER_DIFOT_PCT, MIN_BY(df.BRAND_NAME, df.DIFOT_PCT) AS DIFOT_BRAND
  FROM grid g CROSS JOIN clock c
  JOIN supply s ON s.STORE_CODE = g.STORE_CODE AND s.WEEK_START = g.WEEK_START
  JOIN difot df ON ARRAY_CONTAINS(df.BRAND_NAME::VARIANT, s.SHORT_LOW_LIST)
              AND df.WEEK_START = LEAST(DATEADD('week', -2, g.WEEK_START), DATEADD('week', -2, DATE_TRUNC('week', c.AS_OF)))
  GROUP BY 1, 2
)
SELECT g.STORE_CODE, g.STORE_NAME, g.STATE, g.DC_STATE, g.WEEK_START, g.PERIOD,
       COALESCE(s.SHORT_BRANDS, 0) AS SHORT_BRANDS, COALESCE(s.LOW_BRANDS, 0) AS LOW_BRANDS,
       COALESCE(cp.PROMOTED_SHORT, 0) AS PROMOTED_SHORT, COALESCE(cp.CAMPAIGNS_LIVE, 0) AS CAMPAIGNS_LIVE,
       LEAST(ROUND(100 * d.EXP_UNITS / NULLIF(d.ORD_UNITS, 0), 1), 100) AS DC_FILL_PCT,
       bf.SHORT_BRAND_FILL_PCT, sd.SUPPLIER_DIFOT_PCT,
       pv.NEG AS NEG_LAST_WEEK, ROUND(pv.NORM, 2) AS NEG_BASE_PER_WEEK, pv.OOS_2W AS OOS_LAST_2W, pv.PRICE_2W AS PRICE_LAST_2W,
       ROUND(100 * pv.D_8W / NULLIF(pv.R_8W, 0), 1) AS DETRACTOR_RATE_8W_PCT,
       -- Label (history only).
       IFF(g.PERIOD = 'HISTORY', cv.NEG >= GREATEST(4, 3 * COALESCE(cv.NORM, 0)), NULL) AS SENTIMENT_BREAK,
       cv.NEG AS NEG_THIS_WEEK,
       -- Context for the forecast table (not features).
       ARRAY_COMPACT(s.SHORT_LIST) AS SHORT_BRAND_LIST, cp.PROMOTING_CAMPAIGN, COALESCE(s.RECOVERING, FALSE) AS RECOVERING, sd.DIFOT_BRAND
FROM grid g
LEFT JOIN supply s ON s.STORE_CODE = g.STORE_CODE AND s.WEEK_START = g.WEEK_START
LEFT JOIN camp cp ON cp.STORE_CODE = g.STORE_CODE AND cp.WEEK_START = g.WEEK_START
LEFT JOIN dc d ON d.DC_STATE = g.DC_STATE AND d.WEEK_START = g.WEEK_START
LEFT JOIN brandfill bf ON bf.STORE_CODE = g.STORE_CODE AND bf.WEEK_START = g.WEEK_START
LEFT JOIN sdifot sd ON sd.STORE_CODE = g.STORE_CODE AND sd.WEEK_START = g.WEEK_START
LEFT JOIN vroll pv ON pv.STORE_CODE = g.STORE_CODE AND pv.WEEK_START = g.VOICE_WEEK
LEFT JOIN vroll cv ON cv.STORE_CODE = g.STORE_CODE AND cv.WEEK_START = g.WEEK_START;

-- What the model trains on: the features and the label, nothing else.
CREATE OR REPLACE VIEW RISK_TRAINING
  COMMENT = 'Training rows for STORE_SENTIMENT_RISK_MODEL: store-weeks 15 Sep 2025 - 27 Apr 2026.'
AS
SELECT SHORT_BRANDS, LOW_BRANDS, PROMOTED_SHORT, CAMPAIGNS_LIVE, SHORT_BRAND_FILL_PCT, SUPPLIER_DIFOT_PCT,
       NEG_LAST_WEEK, NEG_BASE_PER_WEEK, OOS_LAST_2W, PRICE_LAST_2W, DETRACTOR_RATE_8W_PCT, SENTIMENT_BREAK
FROM RISK_FEATURES
WHERE PERIOD = 'HISTORY' AND WEEK_START >= '2025-09-15';

-- ---------- 2. Train ----------
CREATE OR REPLACE SNOWFLAKE.ML.CLASSIFICATION STORE_SENTIMENT_RISK_MODEL(
  INPUT_DATA => SYSTEM$REFERENCE('VIEW', 'RISK_TRAINING'),
  TARGET_COLNAME => 'SENTIMENT_BREAK',
  CONFIG_OBJECT => {'evaluate': TRUE, 'on_error': 'skip'}
);

CALL STORE_SENTIMENT_RISK_MODEL!SHOW_GLOBAL_EVALUATION_METRICS();
CREATE OR REPLACE TABLE RISK_MODEL_METRICS
  COMMENT = 'Holdout evaluation of STORE_SENTIMENT_RISK_MODEL (random 20% of training rows).'
AS SELECT "ERROR_METRIC" AS METRIC, "AVERAGE_TYPE" AS AVERAGE_TYPE, "METRIC_VALUE" AS VALUE FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

CALL STORE_SENTIMENT_RISK_MODEL!SHOW_EVALUATION_METRICS();
INSERT INTO RISK_MODEL_METRICS
SELECT "ERROR_METRIC" || '_' || LOWER("CLASS"), 'class', "METRIC_VALUE" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

CALL STORE_SENTIMENT_RISK_MODEL!SHOW_FEATURE_IMPORTANCE();
CREATE OR REPLACE TABLE RISK_MODEL_FEATURE_IMPORTANCE
  COMMENT = 'Feature importance of STORE_SENTIMENT_RISK_MODEL (share of tree splits, sums to 1).'
AS SELECT "RANK" AS RANK, "FEATURE" AS FEATURE, "SCORE" AS IMPORTANCE FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

CREATE OR REPLACE TABLE RISK_MODEL_INFO
  COMMENT = 'When STORE_SENTIMENT_RISK_MODEL was trained and on what.'
AS
SELECT CURRENT_TIMESTAMP()::TIMESTAMP_NTZ AS TRAINED_AT, COUNT(*) AS TRAINING_ROWS, COUNT_IF(SENTIMENT_BREAK) AS BREAKS,
       MIN(WEEK_START) AS FIRST_WEEK, MAX(WEEK_START) AS LAST_WEEK
FROM RISK_FEATURES WHERE PERIOD = 'HISTORY' AND WEEK_START >= '2025-09-15';

-- What the model learned from, for the risk page: breaks by month.
CREATE OR REPLACE VIEW RISK_TRAINING_BREAKS
  COMMENT = 'Sentiment breaks in the training weeks by month and state: what STORE_SENTIMENT_RISK_MODEL learned from.'
AS
SELECT DATE_TRUNC('month', WEEK_START)::DATE AS MONTH, STATE, COUNT(*) AS STORE_WEEKS, COUNT_IF(SENTIMENT_BREAK) AS BREAKS,
       COUNT_IF(SENTIMENT_BREAK AND SHORT_BRANDS > 0) AS BREAKS_WITH_BRAND_SHORT
FROM RISK_FEATURES WHERE PERIOD = 'HISTORY' AND WEEK_START >= '2025-09-15'
GROUP BY 1, 2;

-- ---------- 3. Score the weeks ahead ----------
CREATE OR REPLACE PROCEDURE SCORE_STORE_RISK()
RETURNS VARCHAR
LANGUAGE SQL
COMMENT = 'Scores the six weeks after the voice clock with STORE_SENTIMENT_RISK_MODEL into STORE_RISK_FORECAST. Reads supply live.'
EXECUTE AS OWNER
AS
$$
DECLARE
  n INTEGER;
  hot INTEGER;
BEGIN
  CREATE OR REPLACE TABLE BABY_MART_DEMO.SENTIMENT.STORE_RISK_FORECAST
    COMMENT = 'Forward sentiment risk by store and week from STORE_SENTIMENT_RISK_MODEL, with the band and the drivers in words.'
  AS
  WITH f AS (
    SELECT * FROM BABY_MART_DEMO.SENTIMENT.RISK_FEATURES WHERE PERIOD = 'FORWARD'
  ), p AS (
    SELECT f.*, BABY_MART_DEMO.SENTIMENT.STORE_SENTIMENT_RISK_MODEL!PREDICT(INPUT_DATA => OBJECT_CONSTRUCT(
             'SHORT_BRANDS', f.SHORT_BRANDS, 'LOW_BRANDS', f.LOW_BRANDS, 'PROMOTED_SHORT', f.PROMOTED_SHORT,
             'CAMPAIGNS_LIVE', f.CAMPAIGNS_LIVE, 'SHORT_BRAND_FILL_PCT', f.SHORT_BRAND_FILL_PCT,
             'SUPPLIER_DIFOT_PCT', f.SUPPLIER_DIFOT_PCT, 'NEG_LAST_WEEK', f.NEG_LAST_WEEK, 'NEG_BASE_PER_WEEK', f.NEG_BASE_PER_WEEK,
             'OOS_LAST_2W', f.OOS_LAST_2W, 'PRICE_LAST_2W', f.PRICE_LAST_2W, 'DETRACTOR_RATE_8W_PCT', f.DETRACTOR_RATE_8W_PCT)) AS PRED
    FROM f
  )
  SELECT p.STORE_CODE, p.STORE_NAME, REPLACE(p.STORE_NAME, 'Baby Mart ', '') AS SUBURB, p.STATE, p.DC_STATE, s.LATITUDE, s.LONGITUDE,
         p.WEEK_START, p.SHORT_BRANDS, p.LOW_BRANDS, p.PROMOTED_SHORT, p.CAMPAIGNS_LIVE, p.DC_FILL_PCT, p.SHORT_BRAND_FILL_PCT,
         p.SUPPLIER_DIFOT_PCT, p.NEG_LAST_WEEK, p.NEG_BASE_PER_WEEK, p.OOS_LAST_2W, p.PRICE_LAST_2W, p.DETRACTOR_RATE_8W_PCT,
         p.SHORT_BRAND_LIST, p.PROMOTING_CAMPAIGN, p.RECOVERING, p.DIFOT_BRAND,
         ROUND(p.PRED:probability:"True"::FLOAT, 4) AS RISK_SCORE,
         -- Bands by rank across the forward store-weeks, with a probability
         -- floor. The model is trained on an AUC loss: its scores rank well but
         -- are not calibrated rates, and their level moves between retrains
         -- (about 150 breaks to learn from), so a fixed cut-off would flag a
         -- different number of stores each time. The floor stops a calm outlook
         -- from being forced into criticals.
         PERCENT_RANK() OVER (ORDER BY p.PRED:probability:"True"::FLOAT) AS RISK_PERCENTILE,
         CASE WHEN RISK_PERCENTILE >= 0.97 AND RISK_SCORE >= 0.1 THEN 'CRITICAL'
              WHEN RISK_PERCENTILE >= 0.92 AND RISK_SCORE >= 0.1 THEN 'HIGH'
              WHEN RISK_PERCENTILE >= 0.82 AND RISK_SCORE >= 0.05 THEN 'ELEVATED'
              ELSE 'LOW' END AS RISK_BAND,
         ARRAY_TO_STRING(ARRAY_COMPACT(ARRAY_CONSTRUCT(
           IFF(p.SHORT_BRANDS > 0, ARRAY_TO_STRING(p.SHORT_BRAND_LIST, ', ') || ' short at the store', NULL),
           IFF(p.PROMOTED_SHORT = 1, p.PROMOTING_CAMPAIGN || ' is promoting it to the store''s members', NULL),
           IFF(p.SHORT_BRAND_FILL_PCT < 90, 'POs due into the ' || p.DC_STATE || ' DC expected at ' || p.SHORT_BRAND_FILL_PCT || '% fill', NULL),
           IFF(p.SUPPLIER_DIFOT_PCT < 85, p.DIFOT_BRAND || ' supplier DIFOT ' || p.SUPPLIER_DIFOT_PCT || '%', NULL),
           IFF(p.OOS_LAST_2W >= 5, p.OOS_LAST_2W || ' out-of-stock complaints in the last two weeks', NULL),
           IFF(p.PRICE_LAST_2W >= 3, p.PRICE_LAST_2W || ' price complaints in the last two weeks', NULL),
           IFF(p.RECOVERING, 'recovery plan approved', NULL))), '; ') AS DRIVERS,
         CURRENT_TIMESTAMP()::TIMESTAMP_NTZ AS SCORED_AT
  FROM p JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON s.STORE_CODE = p.STORE_CODE;

  SELECT COUNT(*), COUNT_IF(RISK_BAND IN ('CRITICAL', 'HIGH')) INTO :n, :hot FROM BABY_MART_DEMO.SENTIMENT.STORE_RISK_FORECAST;
  RETURN 'Scored ' || n || ' store-weeks; ' || hot || ' HIGH or CRITICAL';
END;
$$;

CALL SCORE_STORE_RISK();

SELECT RISK_BAND, COUNT(*) AS STORE_WEEKS, COUNT(DISTINCT STORE_CODE) AS STORES FROM STORE_RISK_FORECAST GROUP BY 1 ORDER BY 1;
