-- ============================================================
-- Campaign & CRM — what the agents can read (sql/44)
--
-- Three semantic views for Cortex Analyst and one Cortex Search service, the
-- customer-sentiment-health pattern. The agents' procedure tools (sql/45) do
-- the statistics; these answer the open questions around them.
--
--   SV_CAMPAIGN_RESULTS   campaigns, their members (treated and holdout) and
--                         outcomes, and published learnings. Lift is treated rate
--                         minus holdout rate within one campaign.
--   SV_CUSTOMER_VOICE     surveys, reviews, care, social and campaign replies with
--                         the AI reading. The construction labels the synthetic
--                         text was built from (TRUE_*, STORYLINE) are left out:
--                         they are the answers.
--   SV_CUSTOMER_SIGNALS   life stage, value, affinity and consent, AGGREGATE ONLY:
--                         no customer key or id is exposed, so the agent can count
--                         customers but not list them.
--   CMP_VOICE_SEARCH      semantic search over the verbatims, to quote them.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_ANALYTICS_WH;
USE SCHEMA BABY_MART_DEMO.CAMPAIGN;

-- One row per member of a locked audience, with what happened to them.
CREATE OR REPLACE VIEW VW_CAMPAIGN_MEMBER_OUTCOME
  COMMENT = 'One row per campaign member (TREATED or HOLDOUT) with the segment they were in and their outcome.'
AS
WITH e AS (
  SELECT CAMPAIGN_ID, CUSTOMER_KEY,
         MAX(IFF(EVENT_TYPE = 'CONVERT', 1, 0)) AS CONVERTED,
         SUM(IFF(EVENT_TYPE = 'CONVERT', ORDER_VALUE_AUD, 0)) AS REVENUE_AUD,
         SUM(IFF(EVENT_TYPE = 'CONVERT', MARGIN_AUD, 0)) AS MARGIN_AUD,
         MAX(IFF(EVENT_TYPE = 'OPEN', 1, 0)) AS OPENED,
         MAX(IFF(EVENT_TYPE = 'CLICK', 1, 0)) AS CLICKED,
         MAX(IFF(EVENT_TYPE = 'UNSUBSCRIBE', 1, 0)) AS UNSUBSCRIBED,
         MAX(IFF(EVENT_TYPE = 'COMPLAINT', 1, 0)) AS COMPLAINED,
         MAX(IFF(EVENT_TYPE = 'REPLY', 1, 0)) AS REPLIED,
         SUM(COALESCE(SEND_COST_AUD, 0) + COALESCE(OFFER_COST_AUD, 0)) AS COST_AUD
  FROM BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_EVENT GROUP BY 1, 2
)
SELECT am.CAMPAIGN_ID, am.CUSTOMER_KEY, am.GROUP_CODE, am.CHANNEL_CODE, am.VARIANT_CODE,
       am.HOME_STATE, am.SEGMENT_NAME, am.LOYALTY_TIER, am.RECENCY_BAND, am.CHILD_STAGE, am.RFM_SEGMENT,
       am.UPLIFT_QUADRANT,
       IFF(COALESCE(am.STOCK_CONFLICT, FALSE), 'Yes', 'No') AS HOME_STORE_SHORT,
       IFF(COALESCE(am.NEG_VOICE_120D, 0) > 0 AND am.NEG_THEME IN ('Price and value', 'Promotions and offers'), 'Yes', 'No') AS PRICE_COMPLAINER,
       IFF(COALESCE(am.IS_RELEVANT, FALSE), 'Yes', 'No') AS NEEDS_PRODUCT,
       IFF(am.SUPPRESSED_AT IS NULL, 'No', 'Yes') AS SUPPRESSED,
       COALESCE(e.CONVERTED, 0) AS CONVERTED, COALESCE(e.REVENUE_AUD, 0) AS REVENUE_AUD, COALESCE(e.MARGIN_AUD, 0) AS MARGIN_AUD,
       COALESCE(e.OPENED, 0) AS OPENED, COALESCE(e.CLICKED, 0) AS CLICKED, COALESCE(e.UNSUBSCRIBED, 0) AS UNSUBSCRIBED,
       COALESCE(e.COMPLAINED, 0) AS COMPLAINED, COALESCE(e.REPLIED, 0) AS REPLIED, COALESCE(e.COST_AUD, 0) AS COST_AUD
FROM BABY_MART_DEMO.CAMPAIGN.AUDIENCE_MEMBER am
LEFT JOIN e ON e.CAMPAIGN_ID = am.CAMPAIGN_ID AND e.CUSTOMER_KEY = am.CUSTOMER_KEY;

CREATE OR REPLACE SEMANTIC VIEW SV_CAMPAIGN_RESULTS
  TABLES (
    campaigns AS BABY_MART_DEMO.CAMPAIGN.CAMPAIGN PRIMARY KEY (CAMPAIGN_ID)
      WITH SYNONYMS ('campaign', 'CRM campaign', 'send')
      COMMENT = 'Every Baby Mart CRM campaign and where it is in its lifecycle',
    members AS BABY_MART_DEMO.CAMPAIGN.VW_CAMPAIGN_MEMBER_OUTCOME
      WITH SYNONYMS ('audience members', 'treated', 'holdout', 'control group')
      COMMENT = 'One row per campaign member: TREATED (contacted) or HOLDOUT (randomly held back, never contacted), and what they did',
    learnings AS BABY_MART_DEMO.CAMPAIGN.LEARNING PRIMARY KEY (LEARNING_ID)
      WITH SYNONYMS ('lessons', 'what worked', 'findings')
      COMMENT = 'Published findings from measured campaigns'
  )
  RELATIONSHIPS (
    members_to_campaign AS members (CAMPAIGN_ID) REFERENCES campaigns,
    learnings_to_campaign AS learnings (CAMPAIGN_ID) REFERENCES campaigns
  )
  FACTS (
    members.converted_flag AS CONVERTED COMMENT = '1 if the member bought in the campaign window',
    members.revenue AS REVENUE_AUD COMMENT = 'Revenue from the member in the campaign window, AUD',
    members.margin AS MARGIN_AUD COMMENT = 'Margin from the member in the campaign window, AUD',
    members.cost AS COST_AUD COMMENT = 'Send and offer cost for the member, AUD',
    members.unsub_flag AS UNSUBSCRIBED,
    members.complaint_flag AS COMPLAINED,
    members.open_flag AS OPENED,
    members.click_flag AS CLICKED,
    learnings.learning_lift AS LIFT_PP COMMENT = 'Lift in percentage points',
    campaigns.budget AS BUDGET_AUD
  )
  DIMENSIONS (
    campaigns.campaign_id AS CAMPAIGN_ID,
    campaigns.campaign_name AS NAME WITH SYNONYMS ('campaign name'),
    campaigns.status AS STATUS COMMENT = 'IDEA, BRIEF, AUDIENCE_LOCKED, CONTENT_APPROVED, SCHEDULED, LIVE, PAUSED, COMPLETED, MEASURED or CANCELLED'
      SAMPLE_VALUES ('LIVE', 'PAUSED', 'MEASURED', 'BRIEF'),
    campaigns.objective AS OBJECTIVE,
    campaigns.promoted_category AS PROMOTED_CATEGORY WITH SYNONYMS ('category')
      SAMPLE_VALUES ('Nappies & Wipes', 'Car Seats', 'Feeding', 'Prams & Strollers', 'Clothing'),
    campaigns.promoted_brand AS PROMOTED_BRAND WITH SYNONYMS ('brand'),
    campaigns.offer_id AS OFFER_ID,
    campaigns.start_date AS START_DATE,
    campaigns.end_date AS END_DATE,
    campaigns.start_month AS DATE_TRUNC('month', START_DATE),
    members.group_code AS GROUP_CODE WITH SYNONYMS ('arm', 'treated or holdout') COMMENT = 'TREATED or HOLDOUT'
      SAMPLE_VALUES ('TREATED', 'HOLDOUT') IS_ENUM,
    members.channel AS CHANNEL_CODE SAMPLE_VALUES ('EMAIL', 'SMS', 'PUSH', 'PAID_SOCIAL', 'IN_STORE') IS_ENUM,
    members.variant AS VARIANT_CODE COMMENT = 'Creative variant A or B (treated members only)',
    members.home_state AS HOME_STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    members.segment AS SEGMENT_NAME WITH SYNONYMS ('customer segment'),
    members.loyalty_tier AS LOYALTY_TIER SAMPLE_VALUES ('Bronze', 'Silver', 'Gold', 'Platinum') IS_ENUM,
    members.recency_band AS RECENCY_BAND WITH SYNONYMS ('last purchase') SAMPLE_VALUES ('0-90d', '91-180d', '181-365d', '365d+', 'NONE') IS_ENUM,
    members.child_stage AS CHILD_STAGE,
    members.rfm_segment AS RFM_SEGMENT,
    members.uplift_quadrant AS UPLIFT_QUADRANT SAMPLE_VALUES ('PERSUADABLE', 'SURE_THING', 'LOST_CAUSE', 'SLEEPING_DOG') IS_ENUM,
    members.home_store_short AS HOME_STORE_SHORT COMMENT = 'Yes when the member''s home store was short of the promoted brand' IS_ENUM,
    members.price_complainer AS PRICE_COMPLAINER COMMENT = 'Yes when the member complained about price or promotions in the 120 days before' IS_ENUM,
    members.needs_product AS NEEDS_PRODUCT COMMENT = 'Yes when the member''s life stage or purchases make the promoted product relevant' IS_ENUM,
    members.suppressed AS SUPPRESSED COMMENT = 'Yes when the member was suppressed mid-campaign; they stay TREATED for measurement' IS_ENUM,
    learnings.dimension AS DIMENSION,
    learnings.dimension_value AS DIMENSION_VALUE,
    learnings.statement AS STATEMENT WITH SYNONYMS ('learning', 'finding'),
    learnings.is_significant AS IS_SIGNIFICANT
  )
  METRICS (
    members.members AS COUNT(*) COMMENT = 'Number of members',
    members.treated_members AS COUNT_IF(members.GROUP_CODE = 'TREATED'),
    members.holdout_members AS COUNT_IF(members.GROUP_CODE = 'HOLDOUT'),
    members.treated_conversions AS SUM(IFF(members.GROUP_CODE = 'TREATED', members.converted_flag, 0)),
    members.holdout_conversions AS SUM(IFF(members.GROUP_CODE = 'HOLDOUT', members.converted_flag, 0)),
    members.treated_rate_pct AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'TREATED', members.converted_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'TREATED'), 0), 2)
      WITH SYNONYMS ('conversion rate') COMMENT = 'Percent of treated members who bought',
    members.holdout_rate_pct AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'HOLDOUT', members.converted_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'HOLDOUT'), 0), 2)
      WITH SYNONYMS ('control rate', 'baseline rate') COMMENT = 'Percent of holdout members who bought anyway',
    members.lift_pts AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'TREATED', members.converted_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'TREATED'), 0)
                            - 100 * SUM(IFF(members.GROUP_CODE = 'HOLDOUT', members.converted_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'HOLDOUT'), 0), 2)
      WITH SYNONYMS ('incremental lift', 'uplift') COMMENT = 'Treated conversion rate minus holdout conversion rate, in percentage points. The campaign effect.',
    members.treated_revenue AS SUM(IFF(members.GROUP_CODE = 'TREATED', members.revenue, 0)) COMMENT = 'Revenue from treated members, AUD. NOT incremental: most would have happened anyway.',
    members.campaign_cost AS SUM(members.cost) COMMENT = 'Send and offer cost, AUD',
    members.unsubscribe_rate_pct AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'TREATED', members.unsub_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'TREATED'), 0), 2),
    members.complaint_rate_pct AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'TREATED', members.complaint_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'TREATED'), 0), 2),
    members.click_rate_pct AS ROUND(100 * SUM(IFF(members.GROUP_CODE = 'TREATED', members.click_flag, 0)) / NULLIF(COUNT_IF(members.GROUP_CODE = 'TREATED'), 0), 2),
    learnings.learnings AS COUNT(learnings.LEARNING_ID)
  )
  COMMENT = 'Baby Mart CRM campaign results measured against randomised holdouts. Campaign history is MODELLED; campaigns launched in the app are SIMULATED.'
  AI_SQL_GENERATION 'Lift is always treated rate minus holdout rate WITHIN the same campaign and the same group of members; use the lift_pts metric and never average rates across campaigns or rows. Revenue from treated members is not incremental. When comparing groups (channel, state, home_store_short), group by that dimension and the campaign. Round to 2 decimals.';

CREATE OR REPLACE SEMANTIC VIEW SV_CUSTOMER_VOICE
  TABLES (
    voice AS BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE PRIMARY KEY (VOICE_ID)
      WITH SYNONYMS ('customer feedback', 'surveys', 'NPS responses', 'reviews', 'complaints', 'replies', 'voice of customer')
      COMMENT = 'One row per customer voice item: NPS survey, product review, customer care contact, social post or campaign reply, read by AI_SENTIMENT and AI_CLASSIFY'
  )
  FACTS (
    voice.nps_score_value AS NPS_SCORE COMMENT = 'Likelihood to recommend 0-10 (surveys only)',
    voice.sentiment_value AS SENTIMENT_SCORE COMMENT = 'AI sentiment: 1 positive, 0 neutral or mixed, -1 negative',
    voice.star_rating_value AS STAR_RATING COMMENT = 'Review stars 1-5'
  )
  DIMENSIONS (
    voice.event_date AS EVENT_DATE WITH SYNONYMS ('date'),
    voice.event_week AS EVENT_WEEK COMMENT = 'Week starting Monday',
    voice.event_month AS EVENT_MONTH,
    voice.source AS SOURCE SAMPLE_VALUES ('SURVEY', 'REVIEW', 'CARE', 'SOCIAL', 'REPLY') IS_ENUM,
    voice.state AS STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    voice.store_name AS STORE_NAME,
    voice.brand_name AS BRAND_NAME WITH SYNONYMS ('brand'),
    voice.category AS CATEGORY SAMPLE_VALUES ('Nappies & Wipes', 'Car Seats', 'Feeding', 'Prams & Strollers', 'Clothing'),
    voice.product_class AS CLASS,
    voice.campaign_id AS CAMPAIGN_ID COMMENT = 'Set on campaign replies',
    voice.nps_class AS NPS_CLASS SAMPLE_VALUES ('PROMOTER', 'PASSIVE', 'DETRACTOR') IS_ENUM,
    voice.sentiment AS SENTIMENT SAMPLE_VALUES ('positive', 'negative', 'neutral', 'mixed') IS_ENUM,
    voice.theme AS THEME WITH SYNONYMS ('reason', 'driver', 'complaint type')
      SAMPLE_VALUES ('Out of stock', 'Product quality and safety', 'Price and value', 'Staff and expert advice', 'Delivery and click and collect',
                     'Returns and refunds', 'Range and choice', 'Store experience', 'App and website', 'Promotions and offers'),
    voice.child_stage_mentioned AS CHILD_STAGE_MENTIONED,
    voice.purchase_intent AS PURCHASE_INTENT WITH SYNONYMS ('will buy next', 'intent')
      SAMPLE_VALUES ('CAR_SEAT_UPGRADE', 'PRAM_OR_STROLLER', 'FEEDING', 'NAPPY_STAGE_CHANGE', 'NURSERY_OR_CLOTHING', 'NONE'),
    voice.urgency AS URGENCY SAMPLE_VALUES ('HIGH', 'MEDIUM', 'LOW') IS_ENUM,
    voice.segment_name AS SEGMENT_NAME,
    voice.loyalty_tier AS LOYALTY_TIER,
    voice.voice_text AS VOICE_TEXT COMMENT = 'The verbatim comment'
  )
  METRICS (
    voice.voice_items AS COUNT(voice.VOICE_ID) COMMENT = 'Feedback items across all sources',
    voice.responses AS COUNT_IF(voice.SOURCE = 'SURVEY') COMMENT = 'NPS survey responses',
    voice.nps AS ROUND(100 * (COUNT_IF(voice.NPS_CLASS = 'PROMOTER') - COUNT_IF(voice.NPS_CLASS = 'DETRACTOR')) / NULLIF(COUNT_IF(voice.SOURCE = 'SURVEY'), 0), 1)
      WITH SYNONYMS ('net promoter score') COMMENT = 'NPS = % promoters - % detractors, -100 to 100',
    voice.detractor_rate_pct AS ROUND(100 * COUNT_IF(voice.NPS_CLASS = 'DETRACTOR') / NULLIF(COUNT_IF(voice.SOURCE = 'SURVEY'), 0), 1),
    voice.negative_items AS COUNT_IF(voice.SENTIMENT IN ('negative', 'mixed')),
    voice.negative_share_pct AS ROUND(100 * COUNT_IF(voice.SENTIMENT IN ('negative', 'mixed')) / NULLIF(COUNT(voice.VOICE_ID), 0), 1),
    voice.avg_sentiment AS ROUND(AVG(voice.sentiment_value), 3),
    voice.out_of_stock_mentions AS COUNT_IF(voice.THEME = 'Out of stock'),
    voice.price_complaints AS COUNT_IF(voice.THEME = 'Price and value' AND voice.SENTIMENT IN ('negative', 'mixed'))
  )
  COMMENT = 'Baby Mart customer voice. The text is SYNTHETIC (built on real purchases, stores and dates); the AI reading is real.'
  AI_SQL_GENERATION 'NPS must use the nps metric, never an average of scores. Default to the last 90 days before 2026-05-07 when no period is given; the data ends on 2026-05-07, never use CURRENT_DATE. Round percentages to 1 decimal.';

-- Customer signals, aggregate only. Materialised: Cortex Analyst queries it on
-- every sizing question, and the view stack under it (features, consent, the
-- voice summary and its UDF) hit transient internal errors when queried through
-- the agent. Rebuilt by this script; the signals are as of CMP_AS_OF().
DROP VIEW IF EXISTS VW_CUSTOMER_SIGNALS;
CREATE OR REPLACE TABLE CUSTOMER_SIGNALS
  COMMENT = 'Customer life stage, value, affinity and consent without any customer key, for counting audiences.'
AS
SELECT f.SEGMENT_NAME, f.LOYALTY_TIER, f.HOME_STATE, f.RECENCY_BAND, f.RECENCY_DAYS, f.RFM_SEGMENT, f.CHILD_STAGE, f.EST_CHILD_AGE_M,
       f.TOP_CATEGORY, f.PREFERRED_PRICE_TIER, f.NAPPY_NEXT_CLASS, f.NAPPY_DUE_STATUS, f.CAR_SEAT_LAST_CLASS, f.CAR_SEAT_NEXT_CLASS,
       f.CAR_SEAT_DUE_STATUS, f.FEEDING_NEXT_CLASS, f.FEEDING_DUE_STATUS, f.PRAM_NO_CAR_SEAT, f.MULTI_CHILD_OR_GIFT,
       f.SPEND_12M_AUD, f.LINES_12M, f.AOV_AUD, f.PROMO_SHARE,
       ct.EMAIL_OPT_IN, ct.SMS_OPT_IN, ct.PUSH_ENABLED, ct.IS_CONTACTABLE, ct.PREFERRED_CHANNEL,
       vs.LAST_NPS_CLASS, vs.STATED_INTENT,
       IFF(COALESCE(vs.NEG_VOICE_120D, 0) > 0 AND vs.NEG_THEME_120D IN ('Price and value', 'Promotions and offers'), 'Yes', 'No') AS PRICE_COMPLAINER
FROM BABY_MART_DEMO.CAMPAIGN.CUSTOMER_FEATURES f
JOIN BABY_MART_DEMO.CAMPAIGN.CUSTOMER_CONTACT ct ON ct.CUSTOMER_KEY = f.CUSTOMER_KEY
LEFT JOIN BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE_SUMMARY vs ON vs.CUSTOMER_KEY = f.CUSTOMER_KEY;

CREATE OR REPLACE SEMANTIC VIEW SV_CUSTOMER_SIGNALS
  TABLES (
    customers AS BABY_MART_DEMO.CAMPAIGN.CUSTOMER_SIGNALS
      WITH SYNONYMS ('customers', 'parents', 'members', 'shoppers')
      COMMENT = 'Every Baby Mart customer with life stage inferred from purchases, value, affinity and consent. Aggregate only.'
  )
  FACTS (
    customers.spend_12m AS SPEND_12M_AUD COMMENT = 'Spend in the last 12 months, AUD',
    customers.recency AS RECENCY_DAYS COMMENT = 'Days since last purchase',
    customers.child_age AS EST_CHILD_AGE_M COMMENT = 'Estimated child age in months',
    customers.aov AS AOV_AUD,
    customers.promo_share_value AS PROMO_SHARE
  )
  DIMENSIONS (
    customers.segment AS SEGMENT_NAME SAMPLE_VALUES ('First-time Parents', 'Second-time Parents', 'Expecting', 'Registry Shoppers', 'Gift Buyers', 'Grandparents'),
    customers.loyalty_tier AS LOYALTY_TIER SAMPLE_VALUES ('Bronze', 'Silver', 'Gold', 'Platinum') IS_ENUM,
    customers.home_state AS HOME_STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    customers.recency_band AS RECENCY_BAND WITH SYNONYMS ('last purchase', 'lapsed') SAMPLE_VALUES ('0-90d', '91-180d', '181-365d', '365d+', 'NONE') IS_ENUM,
    customers.rfm_segment AS RFM_SEGMENT SAMPLE_VALUES ('Champions', 'Loyal', 'Potential loyalist', 'New', 'Needs attention', 'At risk', 'Hibernating', 'Lost', 'No purchases'),
    customers.child_stage AS CHILD_STAGE SAMPLE_VALUES ('EXPECTING', 'NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y', 'PRESCHOOL_3_5Y', 'SCHOOL_5_PLUS', 'UNKNOWN'),
    customers.top_category AS TOP_CATEGORY,
    customers.price_tier AS PREFERRED_PRICE_TIER,
    customers.nappy_next_class AS NAPPY_NEXT_CLASS,
    customers.nappy_due AS NAPPY_DUE_STATUS SAMPLE_VALUES ('DUE_NOW', 'DUE_SOON', 'LATER', 'PASSED') IS_ENUM,
    customers.car_seat_last_class AS CAR_SEAT_LAST_CLASS SAMPLE_VALUES ('Capsule (0-6m)', 'Convertible (0-4y)', 'Harness Booster', 'Booster (4-8y)'),
    customers.car_seat_next_class AS CAR_SEAT_NEXT_CLASS,
    customers.car_seat_due AS CAR_SEAT_DUE_STATUS SAMPLE_VALUES ('DUE_NOW', 'DUE_SOON', 'LATER', 'PASSED') IS_ENUM,
    customers.feeding_next_class AS FEEDING_NEXT_CLASS,
    customers.feeding_due AS FEEDING_DUE_STATUS SAMPLE_VALUES ('DUE_NOW', 'DUE_SOON', 'LATER', 'PASSED') IS_ENUM,
    customers.pram_no_car_seat AS PRAM_NO_CAR_SEAT COMMENT = 'Bought a pram but no car seat',
    customers.multi_child_or_gift AS MULTI_CHILD_OR_GIFT,
    customers.email_opt_in AS EMAIL_OPT_IN, customers.sms_opt_in AS SMS_OPT_IN, customers.push_enabled AS PUSH_ENABLED,
    customers.contactable AS IS_CONTACTABLE, customers.preferred_channel AS PREFERRED_CHANNEL,
    customers.last_nps_class AS LAST_NPS_CLASS,
    customers.stated_intent AS STATED_INTENT COMMENT = 'What the customer said they will buy next, from the voice',
    customers.price_complainer AS PRICE_COMPLAINER IS_ENUM
  )
  METRICS (
    customers.customers AS COUNT(*) COMMENT = 'Number of customers',
    customers.contactable_customers AS COUNT_IF(customers.IS_CONTACTABLE),
    customers.email_consented AS COUNT_IF(customers.EMAIL_OPT_IN),
    customers.sms_consented AS COUNT_IF(customers.SMS_OPT_IN),
    customers.total_spend_12m AS ROUND(SUM(customers.spend_12m)),
    customers.avg_spend_12m AS ROUND(AVG(customers.spend_12m), 2),
    customers.avg_recency_days AS ROUND(AVG(customers.recency))
  )
  COMMENT = 'Baby Mart customers for sizing opportunities. Counts and value are from real purchases; consent is MODELLED.'
  AI_SQL_GENERATION 'Only aggregate: never return individual customers. Life stage due status is as of 2026-05-07.';

-- Verbatim search. Daily lag: replies from a fast-forward this session reach the
-- agent through CAMPAIGN_EVIDENCE's reply examples, and here the next day. A
-- search service's query cannot call a UDF, so there is no CMP_AS_OF() filter;
-- nothing dated after it exists except simulated replies, which belong here.
CREATE OR REPLACE CORTEX SEARCH SERVICE CMP_VOICE_SEARCH
  ON VOICE_TEXT
  ATTRIBUTES SOURCE, STATE, THEME, SENTIMENT, BRAND_NAME, CATEGORY, CAMPAIGN_ID, EVENT_MONTH
  WAREHOUSE = DEMO_ANALYTICS_WH
  TARGET_LAG = '1 day'
  AS (
    SELECT VOICE_ID, VOICE_TEXT, SOURCE, COALESCE(STATE, 'ONLINE') AS STATE, THEME, SENTIMENT, BRAND_NAME, CATEGORY, CAMPAIGN_ID,
           TO_CHAR(EVENT_MONTH, 'YYYY-MM') AS EVENT_MONTH, EVENT_DATE::STRING AS EVENT_DATE, STORE_NAME
    FROM BABY_MART_DEMO.CAMPAIGN.VW_CUSTOMER_VOICE
    WHERE VOICE_TEXT IS NOT NULL
  );
