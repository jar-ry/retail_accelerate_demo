-- ============================================================
-- Campaign & CRM — reading the customer voice with AI
--
-- One AI_COMPLETE call reads twenty distinct texts at a time and returns, for
-- each, a fixed JSON shape: sentiment and its score, sentiment per aspect, the
-- main theme, the brand named, the child's stage, what the parent plans to buy
-- next, how urgently they need a reply, and a ten-word summary. The response
-- schema is enforced, so a malformed answer comes back NULL rather than as text
-- that has to be parsed and guessed at.
--
-- PAY ONCE PER TEXT. Enrichment is keyed on TEXT_HASH and only texts without a
-- row in VOICE_ENRICHMENT are sent, so re-running costs nothing for what has
-- already been read, and new voice (campaign replies, sql/43) is read on the next
-- call. The table is created only if missing, so a redeploy keeps every reading
-- it already paid for: drop it to re-read everything after changing the prompt.
-- Every batch's token usage is logged in VOICE_ENRICH_LOG.
--
-- Uses AI_COMPLETE rather than the single-purpose AI functions so the whole
-- reading is one call against one schema, and so it runs on accounts where only
-- AI_COMPLETE is granted.
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
) COMMENT = 'AI_COMPLETE reading of each distinct voice text.';

CREATE TABLE IF NOT EXISTS VOICE_ENRICH_LOG (
  RUN_ID             VARCHAR,
  BATCH_NO           NUMBER,
  MODEL              VARCHAR,
  TEXTS_SENT         NUMBER,
  TEXTS_RETURNED     NUMBER,
  PROMPT_TOKENS      NUMBER,
  COMPLETION_TOKENS  NUMBER,
  LOGGED_AT          TIMESTAMP_NTZ
) COMMENT = 'Token usage per enrichment batch.';

-- The enrichment, as a procedure so the app and later scripts can call it for
-- whatever is new. P_MAX_TEXTS caps one call's spend. The model is fixed here
-- (claude-haiku-4-5: fast, cheap, and plenty for a ten-field reading) because
-- AI_COMPLETE takes its model as a literal.
CREATE OR REPLACE PROCEDURE ENRICH_VOICE(P_MAX_TEXTS NUMBER)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  model VARCHAR DEFAULT 'claude-haiku-4-5';
  run_id VARCHAR;
  pending NUMBER;
  added NUMBER;
  still_pending NUMBER;
BEGIN
  run_id := 'ENR-' || TO_CHAR(CURRENT_TIMESTAMP(), 'YYYYMMDDHH24MISSFF3');

  CREATE OR REPLACE TEMPORARY TABLE ENRICH_TODO AS
  SELECT TEXT_HASH, VOICE_TEXT,
         FLOOR((ROW_NUMBER() OVER (ORDER BY TEXT_HASH) - 1) / 20) AS BATCH_NO,
         1 + MOD(ROW_NUMBER() OVER (ORDER BY TEXT_HASH) - 1, 20) AS IDX
  FROM (SELECT t.TEXT_HASH, t.VOICE_TEXT FROM BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
        WHERE NOT EXISTS (SELECT 1 FROM BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e WHERE e.TEXT_HASH = t.TEXT_HASH)
        QUALIFY ROW_NUMBER() OVER (ORDER BY t.TEXT_HASH) <= :P_MAX_TEXTS);
  SELECT COUNT(*) INTO :pending FROM ENRICH_TODO;
  IF (pending = 0) THEN
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'run_id', run_id, 'sent', 0, 'enriched', 0, 'still_pending', 0);
  END IF;

  CREATE OR REPLACE TEMPORARY TABLE ENRICH_RESULT AS
  WITH req AS (
    SELECT BATCH_NO, ARRAY_AGG(OBJECT_CONSTRUCT('i', IDX, 'text', VOICE_TEXT)) WITHIN GROUP (ORDER BY IDX) AS ITEMS, COUNT(*) AS N
    FROM ENRICH_TODO GROUP BY BATCH_NO
  )
  SELECT BATCH_NO, N, AI_COMPLETE(
    model => 'claude-haiku-4-5',
    prompt => 'You read customer comments for Baby Mart, an Australian retailer of baby products: nappies and wipes, feeding, clothing, car seats, prams and strollers. Return exactly one item per comment, carrying the same i.

For each comment:
- sentiment: positive, negative, neutral or mixed. Mixed means it contains both a clear positive and a clear negative.
- sentiment_score: from -1 (very negative) to 1 (very positive).
- theme: the main driver of the comment, exactly one of: Out of stock | Product quality and safety | Price and value | Staff and expert advice | Delivery and click and collect | Returns and refunds | Range and choice | Store experience | App and website | Promotions and offers. A promoted item that is sold out is Out of stock. A question about which product to buy is Range and choice unless it asks for a fitting or advice from staff.
- aspects: for each of availability, price, quality, service, delivery, promotion and store that the comment actually talks about, its sentiment (positive, negative or neutral). Leave out aspects it does not mention.
- brand: the product brand named, exactly as written, or none. Baby Mart is the retailer, not a brand; Big W and Amazon are competitors, not brands.
- child_stage: the age of the child if the comment states it, else UNKNOWN. EXPECTING (pregnant or baby due), NEWBORN_0_3M, INFANT_3_12M, TODDLER_1_3Y, PRESCHOOL_3_5Y, SCHOOL_5_PLUS, or MULTIPLE for more than one young child (twins, or a toddler and a newborn).
- purchase_intent: what the customer says they will buy next: CAR_SEAT_UPGRADE (a bigger or convertible car seat), PRAM_OR_STROLLER, FEEDING, NAPPY_STAGE_CHANGE (a different nappy size or pull-ups), NURSERY_OR_CLOTHING, or NONE.
- urgency: HIGH if the customer needs a reply or says they will shop elsewhere, MEDIUM for any other complaint, LOW otherwise.
- summary: ten words at most.

Comments as JSON, an array of {i, text}:
' || TO_JSON(ITEMS),
    model_parameters => {'temperature': 0, 'max_tokens': 4096},
    response_format => {
      'type': 'json',
      'schema': {
        'type': 'object',
        'properties': {
          'items': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'i': {'type': 'integer'},
            'sentiment': {'type': 'string', 'enum': ['positive', 'negative', 'neutral', 'mixed']},
            'sentiment_score': {'type': 'number'},
            'theme': {'type': 'string', 'enum': ['Out of stock', 'Product quality and safety', 'Price and value', 'Staff and expert advice',
                      'Delivery and click and collect', 'Returns and refunds', 'Range and choice', 'Store experience', 'App and website', 'Promotions and offers']},
            'aspects': {'type': 'array', 'items': {'type': 'object', 'properties': {
              'aspect': {'type': 'string', 'enum': ['availability', 'price', 'quality', 'service', 'delivery', 'promotion', 'store']},
              'sentiment': {'type': 'string', 'enum': ['positive', 'negative', 'neutral']}}, 'required': ['aspect', 'sentiment']}},
            'brand': {'type': 'string'},
            'child_stage': {'type': 'string', 'enum': ['EXPECTING', 'NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y', 'PRESCHOOL_3_5Y', 'SCHOOL_5_PLUS', 'MULTIPLE', 'UNKNOWN']},
            'purchase_intent': {'type': 'string', 'enum': ['CAR_SEAT_UPGRADE', 'PRAM_OR_STROLLER', 'FEEDING', 'NAPPY_STAGE_CHANGE', 'NURSERY_OR_CLOTHING', 'NONE']},
            'urgency': {'type': 'string', 'enum': ['HIGH', 'MEDIUM', 'LOW']},
            'summary': {'type': 'string'}},
            'required': ['i', 'sentiment', 'sentiment_score', 'theme', 'aspects', 'brand', 'child_stage', 'purchase_intent', 'urgency', 'summary']}}},
        'required': ['items']}},
    show_details => TRUE) AS R
  FROM req;

  INSERT INTO BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICH_LOG
  SELECT :run_id, BATCH_NO, :model, N, ARRAY_SIZE(R:structured_output[0]:raw_message:items),
         R:usage:prompt_tokens::NUMBER, R:usage:completion_tokens::NUMBER, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ
  FROM ENRICH_RESULT;

  INSERT INTO BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT
  SELECT t.TEXT_HASH,
         x.V:sentiment::STRING, x.V:sentiment_score::FLOAT, x.V:theme::STRING, x.V:aspects,
         NULLIF(NULLIF(LOWER(TRIM(x.V:brand::STRING)), 'none'), '')::STRING,
         x.V:child_stage::STRING, x.V:purchase_intent::STRING, x.V:urgency::STRING, x.V:summary::STRING,
         :model, :run_id, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ
  FROM (SELECT r.BATCH_NO, f.value AS V, f.index AS IX
        FROM ENRICH_RESULT r, LATERAL FLATTEN(input => r.R:structured_output[0]:raw_message:items) f) x
  JOIN ENRICH_TODO t ON t.BATCH_NO = x.BATCH_NO AND t.IDX = x.V:i::NUMBER
  QUALIFY ROW_NUMBER() OVER (PARTITION BY t.TEXT_HASH ORDER BY x.IX) = 1;
  added := SQLROWCOUNT;

  SELECT COUNT(*) INTO :still_pending FROM BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
  WHERE NOT EXISTS (SELECT 1 FROM BABY_MART_DEMO.CAMPAIGN.VOICE_ENRICHMENT e WHERE e.TEXT_HASH = t.TEXT_HASH);
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'run_id', run_id, 'sent', pending, 'enriched', added, 'still_pending', still_pending);
END;
$$;

-- Read everything. A second pass picks up any batch whose answer was cut off.
CALL ENRICH_VOICE(20000);
CALL ENRICH_VOICE(20000);

-- Brand names back in their catalogue casing, so they join to DIM_BRAND.
CREATE OR REPLACE VIEW VW_VOICE_BRAND_MAP AS
SELECT LOWER(BRAND_NAME) AS BRAND_LOWER, BRAND_NAME FROM BABY_MART_DEMO.CURATED.DIM_BRAND;

-- ---------- The voice, enriched ----------
-- One row per voice item with what the AI read in it. A survey answered with a
-- score only has no text: it keeps its NPS and scores 0 sentiment, the way a
-- 7-out-of-10 with no comment reads.
CREATE OR REPLACE VIEW VW_CUSTOMER_VOICE
  COMMENT = 'Every customer voice item with its AI reading, store, customer segment and NPS class. SYNTHETIC text, AI_COMPLETE reading.'
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
