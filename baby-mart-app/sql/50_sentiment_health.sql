-- ============================================================
-- NPS Analyst — customer sentiment health: data
--
-- The NPS analyst's question is the one a customer insights team is asked every
-- Monday: is NPS moving, where, and why? This layer answers it from the customer
-- voice Baby Mart already holds (CAMPAIGN.VOICE_ITEM: NPS surveys, product
-- reviews, care emails, social posts and campaign replies, read by AI_SENTIMENT
-- and AI_CLASSIFY in sql/42), joined to the stores, the store supply position and
-- the DC purchase-order book. Nothing here generates new voice: the stories are
-- the ones the voice already carries.
--
--   - NSW nappies: Rascal + Friends short at 12 NSW stores from 20 Apr 2026 while
--     camp-001 promoted it to their members from 28 Apr. Out-of-stock complaints
--     jump from 15 to 342 a week; NSW NPS falls to -12.
--   - Gold & Platinum members complain about price from February (NPS -11 vs +34).
--   - A website outage in the week of 9 March (94 complaints; national NPS -8).
--   - WA delivery complaints in March-April, with nothing in the supply data
--     behind them (a red herring).
--
-- 1. SENTIMENT_AS_OF(): the voice clock, 7 May 2026 (the campaign clock).
-- 2. CUSTOMER_VOICE: one row per item with its AI reading, store, DC and loyalty
--    tier group. Materialised (the campaign view stack is deep); no answer-key
--    columns (TRUE_* / STORYLINE) -- the analyst and the agent see what a real
--    insights team would.
-- 3. HEALTH_WEEKLY: counts by week x store x category x tier group. NPS and
--    sentiment are rebuilt from counts and sums at every grain, never averaged.
-- 4. STORE_SUPPLY_WEEKLY: a brand's supply status at a store by week, from the
--    live CAMPAIGN.SUPPLY_POSITION (an approved recovery plan changes it).
-- 5. DC_INBOUND_WEEKLY: PO lines due into each DC by brand and week.
-- 6. SV_SENTIMENT_HEALTH (Cortex Analyst) and NPS_VOICE_SEARCH (Cortex Search).
--
-- REFRESH_SENTIMENT_HEALTH() rebuilds 2 and 3, e.g. after ENRICH_VOICE reads new
-- text. Idempotent. Run AFTER sql/40-46.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_ANALYTICS_WH;
CREATE SCHEMA IF NOT EXISTS BABY_MART_DEMO.SENTIMENT
  COMMENT = 'NPS Analyst persona: customer sentiment health over the Baby Mart customer voice';
USE SCHEMA BABY_MART_DEMO.SENTIMENT;

-- ---------- 1. Clock ----------
CREATE OR REPLACE FUNCTION SENTIMENT_AS_OF()
RETURNS DATE
COMMENT = 'The last day of customer voice: the campaign clock (7 May 2026).'
AS $$ BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF() $$;

-- The stores, with the DC that serves each (ACT from NSW, TAS from VIC, NT from QLD).
CREATE OR REPLACE VIEW STORES
  COMMENT = 'Baby Mart stores with suburb, store type and the DC that serves each.'
AS
SELECT STORE_CODE, STORE_NAME, REPLACE(STORE_NAME, 'Baby Mart ', '') AS SUBURB, STATE, CITY,
       REGION AS STORE_TYPE, STORE_FORMAT, LATITUDE, LONGITUDE,
       CASE STATE WHEN 'ACT' THEN 'NSW' WHEN 'TAS' THEN 'VIC' WHEN 'NT' THEN 'QLD' ELSE STATE END AS DC_STATE
FROM BABY_MART_DEMO.CURATED.DIM_STORE;

-- ---------- 2 + 3. The voice and its weekly health ----------
CREATE OR REPLACE PROCEDURE REFRESH_SENTIMENT_HEALTH()
RETURNS VARCHAR
LANGUAGE SQL
COMMENT = 'Rebuilds CUSTOMER_VOICE and HEALTH_WEEKLY from the campaign voice and its AI reading.'
EXECUTE AS OWNER
AS
$$
DECLARE
  n_voice INTEGER;
  n_weekly INTEGER;
BEGIN
  CREATE OR REPLACE TABLE BABY_MART_DEMO.SENTIMENT.CUSTOMER_VOICE
    COMMENT = 'Customer voice for the NPS analyst: one row per survey, review, care email, social post or campaign reply, with its AI reading (AI_SENTIMENT + AI_CLASSIFY), store, DC and loyalty tier. SYNTHETIC text on real purchases, stores and dates.'
  AS
  SELECT v.VOICE_ID, v.SOURCE,
         CASE v.SOURCE WHEN 'SURVEY' THEN 'NPS survey' WHEN 'REVIEW' THEN 'Product review' WHEN 'CARE' THEN 'Care email'
                       WHEN 'SOCIAL' THEN 'Social post' WHEN 'REPLY' THEN 'Campaign reply' ELSE v.SOURCE END AS SOURCE_LABEL,
         v.EVENT_DATE, v.EVENT_WEEK, v.EVENT_MONTH,
         v.CUSTOMER_KEY, v.SEGMENT_NAME, v.LOYALTY_TIER,
         CASE WHEN v.LOYALTY_TIER IN ('Gold', 'Platinum') THEN 'Gold & Platinum'
              WHEN v.LOYALTY_TIER IN ('Silver', 'Bronze') THEN 'Silver & Bronze'
              ELSE 'Not a member' END AS TIER_GROUP,
         v.STORE_CODE, s.STORE_NAME, REPLACE(s.STORE_NAME, 'Baby Mart ', '') AS SUBURB, s.STATE, s.CITY,
         s.REGION AS STORE_TYPE, s.STORE_FORMAT, s.LATITUDE, s.LONGITUDE,
         CASE s.STATE WHEN 'ACT' THEN 'NSW' WHEN 'TAS' THEN 'VIC' WHEN 'NT' THEN 'QLD' ELSE s.STATE END AS DC_STATE,
         COALESCE(v.CATEGORY, 'Not product-specific') AS CATEGORY, v.CLASS, v.BRAND_NAME, v.CAMPAIGN_ID, v.PLATFORM,
         v.NPS_SCORE, v.NPS_CLASS, v.STAR_RATING, v.VOICE_TEXT,
         v.SENTIMENT, v.SENTIMENT_SCORE, v.THEME, v.URGENCY,
         v.SENTIMENT IN ('negative', 'mixed') AS IS_NEGATIVE
  FROM BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE v
  JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON s.STORE_CODE = v.STORE_CODE
  WHERE v.EVENT_DATE <= BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF();

  CREATE OR REPLACE TABLE BABY_MART_DEMO.SENTIMENT.HEALTH_WEEKLY
    COMMENT = 'Customer voice counts by week (Monday) x store x product category x loyalty tier group. Rebuild NPS as 100 * (PROMOTERS - DETRACTORS) / RESPONSES and sentiment as SENTIMENT_SUM / SENTIMENT_N at any grain.'
  AS
  SELECT EVENT_WEEK, STORE_CODE, ANY_VALUE(STORE_NAME) AS STORE_NAME, ANY_VALUE(STATE) AS STATE,
         ANY_VALUE(DC_STATE) AS DC_STATE, CATEGORY, TIER_GROUP,
         COUNT_IF(SOURCE = 'SURVEY') AS RESPONSES,
         COUNT_IF(NPS_CLASS = 'PROMOTER') AS PROMOTERS,
         COUNT_IF(NPS_CLASS = 'PASSIVE') AS PASSIVES,
         COUNT_IF(NPS_CLASS = 'DETRACTOR') AS DETRACTORS,
         COUNT(*) AS VOICE_ITEMS,
         COUNT_IF(IS_NEGATIVE) AS NEGATIVE_ITEMS,
         SUM(SENTIMENT_SCORE) AS SENTIMENT_SUM,
         COUNT(SENTIMENT_SCORE) AS SENTIMENT_N,
         COUNT_IF(THEME = 'Out of stock') AS OOS_MENTIONS,
         COUNT_IF(THEME = 'Price and value' AND IS_NEGATIVE) AS PRICE_COMPLAINTS,
         COUNT_IF(THEME = 'Delivery and click and collect' AND IS_NEGATIVE) AS DELIVERY_COMPLAINTS,
         COUNT_IF(THEME = 'App and website' AND IS_NEGATIVE) AS APP_COMPLAINTS,
         COUNT_IF(THEME = 'Product quality and safety' AND IS_NEGATIVE) AS QUALITY_COMPLAINTS,
         COUNT_IF(SOURCE = 'REPLY') AS CAMPAIGN_REPLIES
  FROM BABY_MART_DEMO.SENTIMENT.CUSTOMER_VOICE
  GROUP BY EVENT_WEEK, STORE_CODE, CATEGORY, TIER_GROUP;

  SELECT COUNT(*) INTO :n_voice FROM BABY_MART_DEMO.SENTIMENT.CUSTOMER_VOICE;
  SELECT COUNT(*) INTO :n_weekly FROM BABY_MART_DEMO.SENTIMENT.HEALTH_WEEKLY;
  RETURN 'CUSTOMER_VOICE ' || n_voice || ' rows; HEALTH_WEEKLY ' || n_weekly || ' rows';
END;
$$;

CALL REFRESH_SENTIMENT_HEALTH();

-- The weeks a page can show. The last week of voice is partial (it ends on the
-- clock), so pages focus on complete weeks and the investigator says so.
CREATE OR REPLACE VIEW WEEKS
  COMMENT = 'Every week (Monday) with voice, and whether it is complete by the voice clock.'
AS
SELECT EVENT_WEEK AS WEEK_START,
       DATEADD('day', 6, EVENT_WEEK) <= BABY_MART_DEMO.SENTIMENT.SENTIMENT_AS_OF() AS IS_COMPLETE
FROM (SELECT DISTINCT EVENT_WEEK FROM BABY_MART_DEMO.SENTIMENT.HEALTH_WEEKLY);

-- ---------- 4. Store supply status by week ----------
-- CAMPAIGN.SUPPLY_POSITION holds one status per brand and store with the window
-- it applies to; outside the window the brand is in stock. It is read live, and
-- an approved recovery plan changes it (SHORT -> LOW). That fix is the outlook,
-- not history: weeks to the voice clock keep the status the store had before
-- the plan (ANALYTICS.SUPPLY_RECOVERY_STORE), weeks after it show the fix -- so
-- the risk forecast sees a recovery, and Store 360 still shows the shortage.
CREATE OR REPLACE VIEW STORE_SUPPLY_WEEKLY
  COMMENT = 'Supply status of a brand at a store by week (Monday): SHORT, LOW, OVER or OK. MODELLED from the stock alerts (CAMPAIGN.SUPPLY_POSITION); an approved recovery plan applies from the week after the voice clock.'
AS
WITH wk AS (
  SELECT DATEADD('week', ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, '2025-06-30'::DATE) AS WEEK_START
  FROM TABLE(GENERATOR(ROWCOUNT => 60))
), fix AS (
  SELECT rs.BRAND_NAME, rs.STORE_CODE, rs.PRIOR_STATUS, rs.PRIOR_REASON
  FROM BABY_MART_DEMO.ANALYTICS.SUPPLY_RECOVERY_STORE rs
  JOIN BABY_MART_DEMO.ANALYTICS.SUPPLY_RECOVERY_PLAN rp ON rp.PLAN_ID = rs.PLAN_ID AND rp.STATUS = 'APPROVED'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rs.BRAND_NAME, rs.STORE_CODE ORDER BY rp.APPROVED_AT DESC) = 1
), s AS (
  SELECT p.STORE_CODE, p.STORE_NAME, p.STATE, p.BRAND_NAME, w.WEEK_START, p.ALERT_ID, p.VALID_FROM, p.VALID_TO,
         w.WEEK_START <= p.VALID_TO AND DATEADD('day', 6, w.WEEK_START) >= p.VALID_FROM AS IN_ALERT,
         p.PROVENANCE = 'RECOVERY_PLAN' AND f.PRIOR_STATUS IS NOT NULL AS FIXED,
         w.WEEK_START <= BABY_MART_DEMO.SENTIMENT.SENTIMENT_AS_OF() AS IS_HISTORY,
         p.STATUS, p.REASON, f.PRIOR_STATUS, f.PRIOR_REASON
  FROM BABY_MART_DEMO.CAMPAIGN.SUPPLY_POSITION p
  CROSS JOIN wk w
  LEFT JOIN fix f ON f.BRAND_NAME = p.BRAND_NAME AND f.STORE_CODE = p.STORE_CODE
)
SELECT STORE_CODE, STORE_NAME, STATE, BRAND_NAME, WEEK_START,
       IFF(IN_ALERT, IFF(FIXED AND IS_HISTORY, PRIOR_STATUS, STATUS), 'OK') AS STATUS,
       IFF(IN_ALERT, IFF(FIXED AND IS_HISTORY, PRIOR_REASON, REASON), NULL) AS REASON,
       IN_ALERT AND FIXED AND NOT IS_HISTORY AS IS_RECOVERING,
       ALERT_ID, VALID_FROM, VALID_TO
FROM s;

-- ---------- 5. DC inbound by week ----------
-- Fill is measured on delivered lines; open lines carry the supply plan's
-- forecast fill. The PO book runs to the supply clock (11 Jun 2026), past the
-- voice clock, so for the NPS analyst it is the supply outlook.
CREATE OR REPLACE VIEW DC_INBOUND_WEEKLY
  COMMENT = 'Purchase-order lines due into each DC by brand and week (Monday): ordered and delivered units, on-time lines, and forecast units on open lines.'
AS
SELECT DC_STATE, BRAND_NAME, CATEGORY, DATE_TRUNC('week', EXPECTED_DELIVERY_DATE)::DATE AS WEEK_START,
       COUNT(*) AS LINES,
       COUNT_IF(STATUS = 'DELIVERED') AS DELIVERED_LINES,
       COUNT_IF(STATUS = 'DELIVERED' AND IS_ON_TIME) AS ON_TIME_LINES,
       SUM(ORDERED_UNITS) AS ORDERED_UNITS,
       SUM(IFF(STATUS = 'DELIVERED', ORDERED_UNITS, 0)) AS DELIVERED_ORDERED_UNITS,
       SUM(IFF(STATUS = 'DELIVERED', DELIVERED_UNITS, 0)) AS DELIVERED_UNITS,
       SUM(IFF(STATUS <> 'DELIVERED', ORDERED_UNITS, 0)) AS OPEN_ORDERED_UNITS,
       SUM(IFF(STATUS <> 'DELIVERED', COALESCE(FORECAST_UNITS, ORDERED_UNITS), 0)) AS OPEN_FORECAST_UNITS
FROM BABY_MART_DEMO.ANALYTICS.FORECAST_REPLENISHMENT_SUPPLIER_DC
GROUP BY 1, 2, 3, 4;

-- ---------- 6. What the agent's Analyst and Search tools read ----------
CREATE OR REPLACE SEMANTIC VIEW SV_SENTIMENT_HEALTH
  TABLES (
    voice AS BABY_MART_DEMO.SENTIMENT.CUSTOMER_VOICE PRIMARY KEY (VOICE_ID)
      WITH SYNONYMS ('customer feedback', 'surveys', 'NPS responses', 'reviews', 'complaints', 'voice of customer')
      COMMENT = 'One row per customer voice item: NPS survey, product review, care email, social post or campaign reply, read by AI_SENTIMENT and AI_CLASSIFY'
  )
  FACTS (
    voice.nps_score_value AS NPS_SCORE COMMENT = 'Likelihood to recommend 0-10 (surveys only)',
    voice.sentiment_value AS SENTIMENT_SCORE COMMENT = 'AI sentiment: 1 positive, 0 neutral or mixed, -1 negative'
  )
  DIMENSIONS (
    voice.event_date AS EVENT_DATE WITH SYNONYMS ('date'),
    voice.event_week AS EVENT_WEEK COMMENT = 'Week starting Monday',
    voice.event_month AS EVENT_MONTH,
    voice.source AS SOURCE SAMPLE_VALUES ('SURVEY', 'REVIEW', 'CARE', 'SOCIAL', 'REPLY') IS_ENUM,
    voice.state AS STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    voice.dc_state AS DC_STATE COMMENT = 'The DC that serves the store: NSW, VIC, QLD, SA or WA',
    voice.store_code AS STORE_CODE,
    voice.store_name AS STORE_NAME WITH SYNONYMS ('store'),
    voice.store_format AS STORE_FORMAT SAMPLE_VALUES ('Standard', 'Large Format') IS_ENUM,
    voice.store_type AS STORE_TYPE SAMPLE_VALUES ('Metro', 'Regional', 'CBD') IS_ENUM,
    voice.category AS CATEGORY WITH SYNONYMS ('product category')
      SAMPLE_VALUES ('Nappies & Wipes', 'Car Seats', 'Feeding', 'Prams & Strollers', 'Clothing', 'Not product-specific'),
    voice.brand_name AS BRAND_NAME WITH SYNONYMS ('brand'),
    voice.product_class AS CLASS,
    voice.campaign_id AS CAMPAIGN_ID COMMENT = 'Set on campaign replies',
    voice.loyalty_tier AS LOYALTY_TIER SAMPLE_VALUES ('Bronze', 'Silver', 'Gold', 'Platinum'),
    voice.tier_group AS TIER_GROUP SAMPLE_VALUES ('Gold & Platinum', 'Silver & Bronze', 'Not a member') IS_ENUM,
    voice.nps_class AS NPS_CLASS SAMPLE_VALUES ('PROMOTER', 'PASSIVE', 'DETRACTOR') IS_ENUM,
    voice.sentiment AS SENTIMENT SAMPLE_VALUES ('positive', 'negative', 'neutral', 'mixed') IS_ENUM,
    voice.theme AS THEME WITH SYNONYMS ('reason', 'driver', 'complaint type')
      SAMPLE_VALUES ('Out of stock', 'Product quality and safety', 'Price and value', 'Staff and expert advice', 'Delivery and click and collect',
                     'Returns and refunds', 'Range and choice', 'Store experience', 'App and website', 'Promotions and offers', 'No comment'),
    voice.voice_text AS VOICE_TEXT COMMENT = 'The verbatim comment'
  )
  METRICS (
    voice.voice_items AS COUNT(voice.VOICE_ID) COMMENT = 'Feedback items across all sources',
    voice.responses AS COUNT_IF(voice.SOURCE = 'SURVEY') COMMENT = 'NPS survey responses',
    voice.nps AS ROUND(100 * (COUNT_IF(voice.NPS_CLASS = 'PROMOTER') - COUNT_IF(voice.NPS_CLASS = 'DETRACTOR')) / NULLIF(COUNT_IF(voice.SOURCE = 'SURVEY'), 0), 1)
      WITH SYNONYMS ('net promoter score') COMMENT = 'NPS = % promoters - % detractors, -100 to 100',
    voice.detractor_rate_pct AS ROUND(100 * COUNT_IF(voice.NPS_CLASS = 'DETRACTOR') / NULLIF(COUNT_IF(voice.SOURCE = 'SURVEY'), 0), 1),
    voice.negative_items AS COUNT_IF(voice.IS_NEGATIVE),
    voice.avg_sentiment AS ROUND(AVG(voice.sentiment_value), 3),
    voice.out_of_stock_mentions AS COUNT_IF(voice.THEME = 'Out of stock'),
    voice.price_complaints AS COUNT_IF(voice.THEME = 'Price and value' AND voice.IS_NEGATIVE)
  )
  COMMENT = 'Baby Mart customer voice for the NPS analyst. The text is SYNTHETIC (built on real purchases, stores and dates); the AI reading is real.'
  AI_SQL_GENERATION 'NPS must use the nps metric, never an average of scores or of NPS values. The data ends on 2026-05-07; never use CURRENT_DATE. Weeks start on Monday and the week of 2026-05-04 is partial. Round percentages to 1 decimal.';

CREATE OR REPLACE CORTEX SEARCH SERVICE NPS_VOICE_SEARCH
  ON VOICE_TEXT
  ATTRIBUTES SOURCE, STATE, STORE_NAME, CATEGORY, BRAND_NAME, THEME, TIER_GROUP, EVENT_MONTH
  WAREHOUSE = DEMO_ANALYTICS_WH
  TARGET_LAG = '1 day'
  AS (
    SELECT VOICE_ID, VOICE_TEXT, SOURCE, STATE, STORE_NAME, CATEGORY, BRAND_NAME, THEME, TIER_GROUP,
           TO_CHAR(EVENT_MONTH, 'YYYY-MM') AS EVENT_MONTH, EVENT_DATE::STRING AS EVENT_DATE,
           NPS_SCORE::STRING AS NPS_SCORE
    FROM BABY_MART_DEMO.SENTIMENT.CUSTOMER_VOICE
    WHERE VOICE_TEXT IS NOT NULL
  );

SELECT 'CUSTOMER_VOICE' AS T, COUNT(*) AS N FROM CUSTOMER_VOICE
UNION ALL SELECT 'HEALTH_WEEKLY', COUNT(*) FROM HEALTH_WEEKLY
UNION ALL SELECT 'STORE_SUPPLY_WEEKLY', COUNT(*) FROM STORE_SUPPLY_WEEKLY
UNION ALL SELECT 'DC_INBOUND_WEEKLY', COUNT(*) FROM DC_INBOUND_WEEKLY;
