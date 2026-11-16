-- ============================================================
-- Campaign & CRM — reading the customer voice with AI
--
-- Snowflake's task-specific AI functions read every distinct text, as the
-- customer-sentiment-health build does, rather than one general prompt:
--   AI_SENTIMENT  overall sentiment plus a sentiment per aspect (availability,
--                 price, quality, service, delivery, promotion, store);
--   AI_CLASSIFY   the main theme, what the parent says they will buy next, and
--                 the child's stage, each against labels with a description.
-- Sentiment is the overall reading corrected by the aspects: a comment whose
-- overall reads neutral but which complains about price is negative. On the
-- 200-text probe this took agreement with the planted labels from 76% to 90%.
-- The brand is matched against the catalogue, not extracted by a model, and
-- urgency is a rule. No summary is written.
--
-- PAY ONCE PER TEXT. Enrichment is keyed on TEXT_HASH and only texts without a
-- reading by the current method are sent, so re-running costs nothing for what
-- has been read, and new voice (campaign replies, sql/43) is read on the next
-- call. The table is created only if missing, so a redeploy keeps every reading.
-- Readings by an earlier method (the AI_COMPLETE prompt this replaced) are
-- re-read and overwritten. Every run is logged in VOICE_ENRICH_LOG.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.CAMPAIGN;

CREATE TABLE IF NOT EXISTS VOICE_ENRICHMENT (
  TEXT_HASH        VARCHAR PRIMARY KEY,
  SENTIMENT        VARCHAR,
  SENTIMENT_SCORE  FLOAT,
  THEME            VARCHAR,
  ASPECTS          VARIANT,
  BRAND_MENTIONED  VARCHAR,
  CHILD_STAGE      VARCHAR,
  PURCHASE_INTENT  VARCHAR,
  URGENCY          VARCHAR,
  SUMMARY          VARCHAR,
  MODEL            VARCHAR,
  RUN_ID           VARCHAR,
  ENRICHED_AT      TIMESTAMP_NTZ
) COMMENT = 'AI reading of each distinct voice text (AI_SENTIMENT + AI_CLASSIFY).';

-- Which reader produced the row. Rows without it came from the AI_COMPLETE prompt.
ALTER TABLE VOICE_ENRICHMENT ADD COLUMN IF NOT EXISTS ENRICH_METHOD VARCHAR;

CREATE TABLE IF NOT EXISTS VOICE_ENRICH_LOG (
  RUN_ID             VARCHAR,
  BATCH_NO           NUMBER,
  MODEL              VARCHAR,
  TEXTS_SENT         NUMBER,
  TEXTS_RETURNED     NUMBER,
  PROMPT_TOKENS      NUMBER,
  COMPLETION_TOKENS  NUMBER,
  LOGGED_AT          TIMESTAMP_NTZ
) COMMENT = 'One row per enrichment run: texts sent and read.';

-- The enrichment, as a procedure so the simulator (sql/43) and later scripts can
-- call it for whatever is new. P_MAX_TEXTS caps one call's spend.
CREATE OR REPLACE PROCEDURE ENRICH_VOICE(P_MAX_TEXTS NUMBER)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  method VARCHAR DEFAULT 'BUILTIN_V1';
  run_id VARCHAR;
  pending NUMBER;
  added NUMBER;
  still_pending NUMBER;
BEGIN
  run_id := 'ENR-' || TO_CHAR(CURRENT_TIMESTAMP(), 'YYYYMMDDHH24MISSFF3');

  CREATE OR REPLACE TEMPORARY TABLE ENRICH_TODO AS
  SELECT t.TEXT_HASH, t.VOICE_TEXT FROM BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
  LEFT JOIN BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e ON e.TEXT_HASH = t.TEXT_HASH
  WHERE e.TEXT_HASH IS NULL OR COALESCE(e.ENRICH_METHOD, '') <> :method
  QUALIFY ROW_NUMBER() OVER (ORDER BY t.TEXT_HASH) <= :P_MAX_TEXTS;
  SELECT COUNT(*) INTO :pending FROM ENRICH_TODO;
  IF (pending = 0) THEN
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'run_id', run_id, 'sent', 0, 'enriched', 0, 'still_pending', 0);
  END IF;

  -- The labels carry descriptions: AI_CLASSIFY matches on them, and the planted
  -- confusions (a sold-out promoted item, a "which seat should I buy" question)
  -- are spelled out the way the old prompt spelled them out.
  CREATE OR REPLACE TEMPORARY TABLE ENRICH_RESULT AS
  SELECT TEXT_HASH, VOICE_TEXT,
    AI_SENTIMENT(VOICE_TEXT, ['availability', 'price', 'quality', 'service', 'delivery', 'promotion', 'store']) AS S,
    AI_CLASSIFY(VOICE_TEXT, [
      {'label': 'Out of stock', 'description': 'the product the customer wanted was unavailable, sold out, an empty shelf or not in stock at their store, including a promoted item that had sold out'},
      {'label': 'Product quality and safety', 'description': 'the product itself: it broke, was faulty, poorly made, unsafe, leaked or caused a rash, or praise for how well it works'},
      {'label': 'Price and value', 'description': 'the price, cost, being cheaper elsewhere, price matching, or value for money'},
      {'label': 'Staff and expert advice', 'description': 'staff help, a car seat fitting, or expert product advice from team members'},
      {'label': 'Delivery and click and collect', 'description': 'home delivery, shipping, click and collect, order pickup or late parcels'},
      {'label': 'Returns and refunds', 'description': 'returning an item, exchanges, refunds or the returns policy'},
      {'label': 'Range and choice', 'description': 'the selection of products, sizes or brands, a question about which product to buy, or a routine shop with nothing else to report'},
      {'label': 'Store experience', 'description': 'the store itself: layout, cleanliness, queues, parking or the parents room'},
      {'label': 'App and website', 'description': 'the Baby Mart app or website, checkout errors, login or browsing online'},
      {'label': 'Promotions and offers', 'description': 'a sale, discount code, voucher, promotion, loyalty points or a campaign message'}
    ], {'task_description': 'The main reason for a customer comment to Baby Mart, an Australian baby products retailer'}) AS T,
    AI_CLASSIFY(VOICE_TEXT, [
      {'label': 'CAR_SEAT_UPGRADE', 'description': 'the parent states they plan to buy a bigger, next-stage or convertible car seat or booster'},
      {'label': 'PRAM_OR_STROLLER', 'description': 'the parent states they plan to buy a pram, stroller or travel system'},
      {'label': 'FEEDING', 'description': 'the parent states they plan to buy bottles, a breast pump, a high chair, formula or feeding gear'},
      {'label': 'NAPPY_STAGE_CHANGE', 'description': 'the parent states they plan to move to a bigger nappy size, pull-ups or training pants'},
      {'label': 'NURSERY_OR_CLOTHING', 'description': 'the parent states they plan to buy a cot, nursery furniture or baby clothes'},
      {'label': 'NONE', 'description': 'the comment is about something already bought or experienced and states no plan to buy anything next'}
    ], {'task_description': 'Whether the parent states a plan to buy something next, and what'}) AS I,
    AI_CLASSIFY(VOICE_TEXT, [
      {'label': 'EXPECTING', 'description': 'pregnant, expecting, or the baby is due soon'},
      {'label': 'NEWBORN_0_3M', 'description': 'a newborn, or a baby of 0 to 3 months'},
      {'label': 'INFANT_3_12M', 'description': 'a baby of 3 to 12 months'},
      {'label': 'TODDLER_1_3Y', 'description': 'a toddler aged 1 to 3'},
      {'label': 'PRESCHOOL_3_5Y', 'description': 'a child aged 3 to 5'},
      {'label': 'SCHOOL_5_PLUS', 'description': 'a school-age child'},
      {'label': 'MULTIPLE', 'description': 'more than one young child: twins, or a toddler and a newborn'},
      {'label': 'UNKNOWN', 'description': 'the age of the child is not stated'}
    ], {'task_description': 'The age of the child the comment mentions'}) AS G
  FROM ENRICH_TODO;

  MERGE INTO BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT tgt
  USING (
    WITH r AS (
      SELECT TEXT_HASH, VOICE_TEXT,
             S:categories[0]:sentiment::STRING AS OVERALL,
             FILTER(S:categories, c -> c:name::STRING <> 'overall' AND c:sentiment::STRING IN ('positive', 'negative', 'mixed')) AS ASP,
             ARRAY_SIZE(FILTER(S:categories, c -> c:name::STRING <> 'overall' AND c:sentiment::STRING = 'negative')) AS NEGS,
             ARRAY_SIZE(FILTER(S:categories, c -> c:name::STRING <> 'overall' AND c:sentiment::STRING = 'positive')) AS POSS,
             T:labels[0]::STRING AS THEME, I:labels[0]::STRING AS INTENT, G:labels[0]::STRING AS STAGE
      FROM ENRICH_RESULT
    ), s AS (
      -- The overall reading, corrected by the aspects it names.
      SELECT r.*, CASE WHEN NEGS > 0 AND POSS > 0 THEN 'mixed' WHEN NEGS > 0 THEN 'negative'
                       WHEN OVERALL = 'neutral' AND POSS > 0 THEN 'positive' ELSE COALESCE(OVERALL, 'neutral') END AS SENT
      FROM r
    ), b AS (
      -- The longest catalogue brand the text names.
      SELECT s.TEXT_HASH, LOWER(d.BRAND_NAME) AS BRAND
      FROM s JOIN BABY_MART_DEMO.CURATED.DIM_BRAND d ON CONTAINS(LOWER(s.VOICE_TEXT), LOWER(d.BRAND_NAME))
      QUALIFY ROW_NUMBER() OVER (PARTITION BY s.TEXT_HASH ORDER BY LENGTH(d.BRAND_NAME) DESC) = 1
    )
    SELECT s.TEXT_HASH, s.SENT AS SENTIMENT,
           DECODE(s.SENT, 'positive', 1, 'negative', -1, 0)::FLOAT AS SENTIMENT_SCORE,
           s.THEME,
           TRANSFORM(s.ASP, c -> OBJECT_CONSTRUCT('aspect', c:name, 'sentiment', c:sentiment)) AS ASPECTS,
           b.BRAND AS BRAND_MENTIONED, COALESCE(s.STAGE, 'UNKNOWN') AS CHILD_STAGE, COALESCE(s.INTENT, 'NONE') AS PURCHASE_INTENT,
           -- HIGH: a safety or availability complaint, or a customer saying they
           -- will go elsewhere. MEDIUM: any other complaint.
           CASE WHEN s.SENT IN ('negative', 'mixed')
                     AND (s.THEME IN ('Product quality and safety', 'Out of stock')
                          OR REGEXP_LIKE(LOWER(s.VOICE_TEXT), '.*(elsewhere|big w|amazon|never again|cancel|unsubscribe|go somewhere else|shop somewhere).*')) THEN 'HIGH'
                WHEN s.SENT IN ('negative', 'mixed') THEN 'MEDIUM' ELSE 'LOW' END AS URGENCY
    FROM s LEFT JOIN b ON b.TEXT_HASH = s.TEXT_HASH
  ) src ON tgt.TEXT_HASH = src.TEXT_HASH
  WHEN MATCHED THEN UPDATE SET SENTIMENT = src.SENTIMENT, SENTIMENT_SCORE = src.SENTIMENT_SCORE, THEME = src.THEME, ASPECTS = src.ASPECTS,
    BRAND_MENTIONED = src.BRAND_MENTIONED, CHILD_STAGE = src.CHILD_STAGE, PURCHASE_INTENT = src.PURCHASE_INTENT, URGENCY = src.URGENCY,
    SUMMARY = NULL, MODEL = 'AI_SENTIMENT + AI_CLASSIFY', RUN_ID = :run_id, ENRICHED_AT = CURRENT_TIMESTAMP()::TIMESTAMP_NTZ, ENRICH_METHOD = :method
  WHEN NOT MATCHED THEN INSERT (TEXT_HASH, SENTIMENT, SENTIMENT_SCORE, THEME, ASPECTS, BRAND_MENTIONED, CHILD_STAGE, PURCHASE_INTENT, URGENCY,
    SUMMARY, MODEL, RUN_ID, ENRICHED_AT, ENRICH_METHOD)
  VALUES (src.TEXT_HASH, src.SENTIMENT, src.SENTIMENT_SCORE, src.THEME, src.ASPECTS, src.BRAND_MENTIONED, src.CHILD_STAGE, src.PURCHASE_INTENT,
    src.URGENCY, NULL, 'AI_SENTIMENT + AI_CLASSIFY', :run_id, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ, :method);
  added := SQLROWCOUNT;

  INSERT INTO BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICH_LOG
  SELECT :run_id, 1, 'AI_SENTIMENT + AI_CLASSIFY', :pending, :added, NULL, NULL, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ;

  SELECT COUNT(*) INTO :still_pending FROM BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
  LEFT JOIN BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e ON e.TEXT_HASH = t.TEXT_HASH
  WHERE e.TEXT_HASH IS NULL OR COALESCE(e.ENRICH_METHOD, '') <> :method;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'run_id', run_id, 'method', method, 'sent', pending, 'enriched', added, 'still_pending', still_pending);
END;
$$;

-- Readings of texts the voice no longer holds (sql/41 rebuilt them) are dropped.
DELETE FROM VOICE_ENRICHMENT WHERE TEXT_HASH NOT IN (SELECT TEXT_HASH FROM VOICE_TEXT);

-- Read everything.
CALL ENRICH_VOICE(20000);

-- Brand names back in their catalogue casing, so they join to DIM_BRAND.
CREATE OR REPLACE VIEW VW_VOICE_BRAND_MAP AS
SELECT LOWER(BRAND_NAME) AS BRAND_LOWER, BRAND_NAME FROM BABY_MART_DEMO.CURATED.DIM_BRAND;

-- ---------- The voice, enriched ----------
-- One row per voice item with what the AI read in it. A survey answered with a
-- score only has no text: it keeps its NPS and scores 0 sentiment, the way a
-- 7-out-of-10 with no comment reads.
CREATE OR REPLACE VIEW VW_CUSTOMER_VOICE
  COMMENT = 'Every customer voice item with its AI reading, store, customer segment and NPS class. SYNTHETIC text, AI_SENTIMENT + AI_CLASSIFY reading.'
AS
SELECT v.VOICE_ID, v.SOURCE, v.EVENT_DATE,
       DATE_TRUNC('week', v.EVENT_DATE)::DATE  AS EVENT_WEEK,
       DATE_TRUNC('month', v.EVENT_DATE)::DATE AS EVENT_MONTH,
       v.CUSTOMER_KEY, f.SEGMENT_NAME, f.LOYALTY_TIER, f.CHILD_STAGE AS CUSTOMER_CHILD_STAGE,
       v.STORE_CODE, s.STORE_NAME, s.STATE, s.REGION,
       v.PLATFORM, v.PRODUCT_KEY, v.CATEGORY, v.CLASS,
       COALESCE(bm.BRAND_NAME, v.BRAND_NAME) AS BRAND_NAME,
       v.CAMPAIGN_ID, v.NPS_SCORE,
       CASE WHEN v.NPS_SCORE IS NULL THEN NULL WHEN v.NPS_SCORE >= 9 THEN 'PROMOTER' WHEN v.NPS_SCORE >= 7 THEN 'PASSIVE' ELSE 'DETRACTOR' END AS NPS_CLASS,
       v.STAR_RATING, v.VOICE_TEXT,
       COALESCE(e.SENTIMENT, IFF(v.VOICE_TEXT IS NULL, 'no comment', NULL)) AS SENTIMENT,
       COALESCE(e.SENTIMENT_SCORE, IFF(v.VOICE_TEXT IS NULL AND v.NPS_SCORE IS NOT NULL, 0, NULL)) AS SENTIMENT_SCORE,
       COALESCE(e.THEME, IFF(v.VOICE_TEXT IS NULL, 'No comment', NULL)) AS THEME,
       e.ASPECTS, e.CHILD_STAGE AS CHILD_STAGE_MENTIONED, e.PURCHASE_INTENT, e.URGENCY, e.SUMMARY,
       e.TEXT_HASH IS NOT NULL AS IS_ENRICHED,
       v.TRUE_THEME, v.TRUE_POLARITY, v.STORYLINE, v.PROVENANCE
FROM BABY_MART_DEMO.CAMPAIGN.VOICE_ITEM v
LEFT JOIN BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e ON e.TEXT_HASH = v.TEXT_HASH
LEFT JOIN BABY_MART_DEMO.CAMPAIGN.VW_VOICE_BRAND_MAP bm ON bm.BRAND_LOWER = e.BRAND_MENTIONED
LEFT JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON s.STORE_CODE = v.STORE_CODE
LEFT JOIN BABY_MART_DEMO.CAMPAIGN.CUSTOMER_FEATURES f ON f.CUSTOMER_KEY = v.CUSTOMER_KEY;

-- Weekly voice health by state, with the prior four weeks as the baseline.
-- NPS is rebuilt from counts at every grain, never averaged.
CREATE OR REPLACE VIEW VW_VOICE_HEALTH_WEEKLY
  COMMENT = 'Weekly NPS, sentiment and theme mentions by state, with the trailing 4-week baseline.'
AS
WITH w AS (
  SELECT EVENT_WEEK, COALESCE(STATE, 'ONLINE') AS STATE,
         COUNT_IF(SOURCE = 'SURVEY') AS RESPONSES,
         COUNT_IF(NPS_CLASS = 'PROMOTER') AS PROMOTERS,
         COUNT_IF(NPS_CLASS = 'DETRACTOR') AS DETRACTORS,
         COUNT(*) AS VOICE_ITEMS,
         COUNT_IF(SENTIMENT = 'negative') AS NEGATIVE_ITEMS,
         AVG(SENTIMENT_SCORE) AS AVG_SENTIMENT,
         COUNT_IF(THEME = 'Out of stock') AS OOS_MENTIONS,
         COUNT_IF(THEME = 'Price and value' AND SENTIMENT IN ('negative', 'mixed')) AS PRICE_COMPLAINTS
  FROM BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE
  GROUP BY 1, 2
), b AS (
  SELECT w.*,
         SUM(PROMOTERS)  OVER (PARTITION BY STATE ORDER BY EVENT_WEEK ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS BASE_PROMOTERS,
         SUM(DETRACTORS) OVER (PARTITION BY STATE ORDER BY EVENT_WEEK ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS BASE_DETRACTORS,
         SUM(RESPONSES)  OVER (PARTITION BY STATE ORDER BY EVENT_WEEK ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS BASE_RESPONSES,
         AVG(OOS_MENTIONS) OVER (PARTITION BY STATE ORDER BY EVENT_WEEK ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS BASE_OOS_PER_WEEK
  FROM w
)
SELECT b.*,
       ROUND(100 * (PROMOTERS - DETRACTORS) / NULLIF(RESPONSES, 0), 1) AS NPS,
       ROUND(100 * (BASE_PROMOTERS - BASE_DETRACTORS) / NULLIF(BASE_RESPONSES, 0), 1) AS BASE_NPS
FROM b;

-- Emerging issues: a theme's weekly mentions against its own trailing eight
-- weeks, as a z-score. A statistical flag rather than a fixed threshold, so a
-- theme that is always loud is not flagged for being loud.
CREATE OR REPLACE VIEW VW_VOICE_THEME_ANOMALY
  COMMENT = 'Weekly mentions per theme and state against the trailing 8-week mean; Z >= 3 with at least 5 mentions is flagged.'
AS
WITH w AS (
  SELECT EVENT_WEEK, COALESCE(STATE, 'ONLINE') AS STATE, THEME,
         COUNT(*) AS MENTIONS,
         COUNT_IF(SENTIMENT IN ('negative', 'mixed')) AS NEGATIVE_MENTIONS
  FROM BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE
  WHERE THEME IS NOT NULL AND THEME <> 'No comment'
  GROUP BY 1, 2, 3
), spine AS (
  -- Every theme in every week, so a quiet week counts as zero in the baseline.
  SELECT wk.EVENT_WEEK, st.STATE, th.THEME
  FROM (SELECT DISTINCT EVENT_WEEK FROM w) wk
  CROSS JOIN (SELECT DISTINCT STATE FROM w) st
  CROSS JOIN (SELECT DISTINCT THEME FROM w) th
), filled AS (
  SELECT s.EVENT_WEEK, s.STATE, s.THEME, COALESCE(w.MENTIONS, 0) AS MENTIONS, COALESCE(w.NEGATIVE_MENTIONS, 0) AS NEGATIVE_MENTIONS
  FROM spine s LEFT JOIN w ON w.EVENT_WEEK = s.EVENT_WEEK AND w.STATE = s.STATE AND w.THEME = s.THEME
), based AS (
  SELECT f.*,
         AVG(NEGATIVE_MENTIONS)         OVER (PARTITION BY STATE, THEME ORDER BY EVENT_WEEK ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) AS BASE_MEAN,
         STDDEV_SAMP(NEGATIVE_MENTIONS) OVER (PARTITION BY STATE, THEME ORDER BY EVENT_WEEK ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) AS BASE_SD
  FROM filled f
)
SELECT b.*,
       (NEGATIVE_MENTIONS - BASE_MEAN) / GREATEST(COALESCE(BASE_SD, 0), 1) AS Z,
       (NEGATIVE_MENTIONS - BASE_MEAN) / GREATEST(COALESCE(BASE_SD, 0), 1) >= 3 AND NEGATIVE_MENTIONS >= 5 AS IS_ANOMALY
FROM based b;

-- What each customer has said: the voice features audiences and the uplift model
-- use. "Recent" is the 120 days to the demo clock.
CREATE OR REPLACE VIEW VW_CUSTOMER_VOICE_SUMMARY
  COMMENT = 'Per customer: last NPS, recent negative voice and its theme, open complaints and stated intent.'
AS
SELECT CUSTOMER_KEY,
       MAX_BY(NPS_SCORE, IFF(NPS_SCORE IS NULL, NULL, EVENT_DATE)) AS LAST_NPS,
       MAX_BY(NPS_CLASS, IFF(NPS_SCORE IS NULL, NULL, EVENT_DATE)) AS LAST_NPS_CLASS,
       MAX_BY(SENTIMENT, IFF(VOICE_TEXT IS NULL, NULL, EVENT_DATE)) AS LAST_SENTIMENT,
       COUNT(*) AS VOICE_ITEMS,
       COUNT_IF(SENTIMENT IN ('negative', 'mixed') AND EVENT_DATE > DATEADD('day', -120, BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF())) AS NEG_VOICE_120D,
       MAX_BY(THEME, IFF(SENTIMENT IN ('negative', 'mixed') AND EVENT_DATE > DATEADD('day', -120, BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF()), EVENT_DATE, NULL)) AS NEG_THEME_120D,
       COUNT_IF(URGENCY IN ('HIGH', 'MEDIUM') AND EVENT_DATE > DATEADD('day', -60, BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF())) > 0 AS HAS_OPEN_COMPLAINT,
       MAX_BY(PURCHASE_INTENT, IFF(PURCHASE_INTENT IS NOT NULL AND PURCHASE_INTENT <> 'NONE', EVENT_DATE, NULL)) AS STATED_INTENT,
       MAX_BY(CHILD_STAGE_MENTIONED, IFF(CHILD_STAGE_MENTIONED IS NOT NULL AND CHILD_STAGE_MENTIONED <> 'UNKNOWN', EVENT_DATE, NULL)) AS STATED_CHILD_STAGE
FROM BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE
WHERE CUSTOMER_KEY IS NOT NULL AND EVENT_DATE <= BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF()
GROUP BY CUSTOMER_KEY;

-- How well the AI read the voice, against what each text was built from. Not a
-- benchmark of the model -- the text is templated -- but a guard that the
-- enrichment is wired correctly and its labels can be trusted downstream.
CREATE OR REPLACE VIEW VW_VOICE_ENRICH_QUALITY
  COMMENT = 'AI reading vs the construction labels of the synthetic text: agreement per field.'
AS
SELECT COUNT(*) AS TEXTS,
       AVG(IFF(e.THEME = t.TRUE_THEME, 1, 0)) AS THEME_AGREEMENT,
       AVG(IFF(DECODE(t.TRUE_POLARITY, 'POS', 'positive', 'NEG', 'negative', 'NEU', 'neutral', 'MIXED', 'mixed') = e.SENTIMENT, 1, 0)) AS SENTIMENT_AGREEMENT,
       AVG(IFF((t.TRUE_POLARITY = 'NEG' AND e.SENTIMENT IN ('negative', 'mixed')) OR (t.TRUE_POLARITY = 'POS' AND e.SENTIMENT IN ('positive', 'mixed'))
               OR (t.TRUE_POLARITY IN ('NEU', 'MIXED') AND e.SENTIMENT IN ('neutral', 'mixed', 'positive', 'negative')), 1, 0)) AS POLARITY_DIRECTION_AGREEMENT,
       AVG(IFF(t.TRUE_STAGE IS NOT NULL, IFF(e.CHILD_STAGE = t.TRUE_STAGE, 1, 0), NULL)) AS STAGE_RECALL,
       AVG(IFF(t.TRUE_INTENT IS NOT NULL, IFF(e.PURCHASE_INTENT = t.TRUE_INTENT, 1, 0), NULL)) AS INTENT_RECALL,
       AVG(IFF(t.TRUE_INTENT IS NULL, IFF(e.PURCHASE_INTENT = 'NONE', 1, 0), NULL)) AS NO_INTENT_PRECISION
FROM BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
JOIN BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e ON e.TEXT_HASH = t.TEXT_HASH;
