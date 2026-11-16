-- ============================================================
-- Campaign & CRM — campaign history and the response simulator (MODELLED)
--
-- Baby Mart has no campaign response data, so nine past campaigns are rebuilt
-- here: each has a real audience (selected from purchase features as they stood
-- on the campaign's start date), a 10% holdout, creative variants, a channel plan
-- and modelled responses -- sends, deliveries, opens, clicks, conversions,
-- unsubscribes, complaints and replies.
--
-- ONE RESPONSE MODEL. GENERATE_EVENTS turns a locked audience into events, and it
-- is the same procedure for the modelled history and for a campaign launched in
-- the app (SIMULATE_CAMPAIGN). So the uplift model in sql/44, trained on the
-- history, learns the same rules a new campaign is simulated with: a model that
-- says "persuadable" is right about the simulator, and a presenter's live launch
-- behaves the way the history says it should.
--
-- THE RULES (RESPONSE_MODEL). Each member converts with probability
--   base  = BASE_RATE x recency factor x need factor       (holdout and treated)
--   lift  = UPLIFT x recency x need x channel x segment x variant   (treated)
-- A customer who bought last month would have bought anyway (a sure thing: low
-- lift). One who needs the product and has lapsed a little is persuadable. Two
-- overrides turn contact harmful:
--   STOCK_CONFLICT   the promoted brand is short at the member's home store, so
--                    the message sends them to an empty shelf (camp-001, NSW);
--   PRICE_GRIEVANCE  the member complained about price or promotions in the 120
--                    days before -- a "sleeping dog" a promo email wakes
--                    (camp-004, Gold and Platinum).
-- Every draw is HASH(customer, campaign, purpose): no RANDOM(), so a redeploy
-- produces the same events and the same lift to the decimal.
--
-- STORYLINES this produces:
--   camp-003  SMS lifts toddler-nappy sales for second-time parents; email barely
--             moves them. A randomised channel test, so the comparison is fair.
--   camp-001  Live. Headline conversions look healthy, but most are sure things,
--             and in NSW, where Rascal + Friends is short, contact LOWERS sales
--             and drives "sold out" replies and complaints.
--   camp-004  Paused on 6 May. Members with a recent price grievance unsubscribe
--             and complain at many times the normal rate and buy less than their
--             holdout: negative uplift.
--   camp-h03  Black Friday car seats: big reported numbers, almost no lift, and a
--             20% discount handed to people who were buying anyway.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.CAMPAIGN;

-- ---------- 1. The response model ----------
CREATE OR REPLACE TABLE RESPONSE_MODEL (
  SCOPE                VARCHAR NOT NULL,
  SCOPE_KEY            VARCHAR NOT NULL,
  BASE_RATE            FLOAT NOT NULL,
  UPLIFT               FLOAT NOT NULL,
  CH_EMAIL             FLOAT NOT NULL,
  CH_SMS               FLOAT NOT NULL,
  CH_PUSH              FLOAT NOT NULL,
  CH_SOCIAL            FLOAT NOT NULL,
  CH_INSTORE           FLOAT NOT NULL,
  VARIANT_B            FLOAT NOT NULL,
  PERSUADABLE_SEGMENT  VARCHAR,
  PERSUADABLE_MULT     FLOAT,
  SLEEPING_EFFECT      FLOAT NOT NULL,
  STOCK_EFFECT         FLOAT NOT NULL,
  AVG_ORDER_AUD        FLOAT,
  NOTE                 VARCHAR
) COMMENT = 'MODELLED response rules. TRACK rows are the defaults a new campaign is simulated with; CAMPAIGN rows override them for the planted history.';

INSERT INTO RESPONSE_MODEL VALUES
  -- Defaults by what a campaign sells.
  ('TRACK', 'NAPPY',    0.050, 0.020, 1.0, 1.5, 0.7, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.35,   48, 'Frequent, low-ticket. Recent buyers repurchase anyway.'),
  ('TRACK', 'CAR_SEAT', 0.020, 0.040, 1.0, 1.4, 0.8, 0.5, 0.5, 1.25, NULL, NULL, -0.30, -0.35,  455, 'Rare, high-ticket, stage-timed. A fitting angle lifts response.'),
  ('TRACK', 'FEEDING',  0.040, 0.014, 1.0, 1.2, 0.6, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.35,   95, NULL),
  ('TRACK', 'PRAM',     0.015, 0.015, 1.0, 1.2, 0.7, 0.6, 0.6, 1.00, NULL, NULL, -0.30, -0.35, 1180, NULL),
  ('TRACK', 'CLOTHING', 0.050, 0.016, 1.0, 1.2, 0.8, 0.6, 0.4, 1.00, NULL, NULL, -0.30, -0.35,   62, NULL),
  ('TRACK', 'GENERAL',  0.070, 0.012, 1.0, 1.3, 0.9, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.35, NULL, 'Members events and win-backs; order value is the member''s own.'),
  -- The planted history.
  ('CAMPAIGN', 'camp-h01', 0.045, 0.022, 1.0, 1.3, 0.7, 0.4, 0.3, 1.10, 'Expecting', 1.4, -0.30, -0.35,   52, 'Newborn welcome: expecting parents respond best.'),
  ('CAMPAIGN', 'camp-h02', 0.014, 0.014, 1.0, 1.2, 0.7, 0.6, 0.6, 1.20, NULL, NULL, -0.30, -0.35, 1150, 'Pram event: the trade-up angle (B) wins.'),
  ('CAMPAIGN', 'camp-h03', 0.075, 0.004, 1.0, 1.0, 1.0, 0.5, 0.5, 1.00, NULL, NULL, -0.30, -0.35,  430, 'Black Friday: everyone buys anyway; the discount buys almost nothing.'),
  ('CAMPAIGN', 'camp-h04', 0.045, 0.020, 1.0, 1.2, 0.8, 0.6, 0.4, 1.10, 'Grandparents', 1.5, -0.30, -0.35,   70, 'Gift guide: grandparents are the persuadable group.'),
  ('CAMPAIGN', 'camp-003', 0.045, 0.034, 0.10, 1.7, 0.7, 0.4, 0.3, 1.15, NULL, NULL, -0.30, -0.35,   46, 'Back to childcare: SMS works, email barely moves second-time parents.'),
  ('CAMPAIGN', 'camp-h05', 0.025, 0.030, 1.0, 1.3, 0.8, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.35, NULL, 'Win-back: lapsed members are the most persuadable there are.'),
  ('CAMPAIGN', 'camp-h06', 0.040, 0.010, 1.0, 1.2, 0.5, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.35,   92, 'Feeding replenishment: push is a weak channel.'),
  ('CAMPAIGN', 'camp-001', 0.065, 0.012, 1.0, 1.4, 0.7, 0.4, 0.3, 1.00, NULL, NULL, -0.30, -0.45,   48, 'Crawler nappies: mostly sure things, and NSW cannot supply the brand.'),
  ('CAMPAIGN', 'camp-004', 0.085, 0.012, 1.0, 1.2, 0.9, 0.4, 0.3, 1.00, NULL, NULL, -0.60, -0.35, NULL, 'Early access: price complainers are sleeping dogs.');

-- ---------- 2. The campaigns ----------
CREATE OR REPLACE TEMPORARY TABLE HISTORY_DEF AS
SELECT column1 AS CAMPAIGN_ID, column2 AS NAME, column3 AS OBJECTIVE, column4 AS HYPOTHESIS, column5 AS FINAL_STATUS,
       column6 AS PROMOTED_CATEGORY, column7 AS PROMOTED_CLASS, column8 AS PROMOTED_BRAND, column9 AS OFFER_ID,
       column10 AS CHANNEL_RULE, SPLIT(column11, ',') AS CHANNELS, column12::NUMBER(12,2) AS BUDGET_AUD,
       column13::DATE AS START_DATE, column14::DATE AS END_DATE, column15::DATE AS THROUGH_DATE,
       column16 AS AUDIENCE_NAME, column17 AS AUDIENCE_DESC, column18 AS SPEC_JSON
FROM VALUES
  ('camp-h01', 'Newborn Welcome - First Nappies', 'Win the first nappy shop of new and expecting parents.',
   'A welcome pack offered in the first weeks wins the household before habits form.', 'MEASURED',
   'Nappies & Wipes', 'Newborn Nappies', 'Huggies', 'off-1', 'EMAIL', 'EMAIL', 3500,
   '2025-08-04', '2025-08-31', '2025-08-31', 'Expecting and newborn parents', 'Customers expecting or with a newborn on the start date, email-consented.',
   '{"version":1,"all":[],"any":[{"field":"CHILD_STAGE","op":"in","values":["EXPECTING","NEWBORN_0_3M"]},{"field":"SEGMENT_NAME","op":"in","values":["Expecting"]}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL"],"promoted":{"category":"Nappies & Wipes","className":"Newborn Nappies","brand":"Huggies"}}'),
  ('camp-h02', 'Spring Pram Event', 'Bring expecting parents in to test prams before birth.',
   'Parents who have not bought a pram yet will come in for a test drive and a trade-up credit.', 'MEASURED',
   'Prams & Strollers', 'Travel System', NULL, 'off-10', 'PREFERRED_EMAIL_SMS', 'EMAIL,SMS', 9000,
   '2025-09-08', '2025-10-05', '2025-10-05', 'Pre-pram parents', 'Expecting, newborn or registry customers who have never bought a pram.',
   '{"version":1,"all":[{"field":"PRAMS_SHARE","op":"lte","value":0}],"any":[{"field":"CHILD_STAGE","op":"in","values":["EXPECTING","NEWBORN_0_3M"]},{"field":"SEGMENT_NAME","op":"in","values":["Expecting","Registry Shoppers"]}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL","SMS"],"promoted":{"category":"Prams & Strollers","className":"Travel System","brand":null}}'),
  ('camp-h03', 'Black Friday Car Seats', 'Maximise car seat sales over Black Friday week.',
   'A 20% discount to every active family will pull car seat demand forward.', 'MEASURED',
   'Car Seats', NULL, NULL, 'off-11', 'EMAIL_PUSH', 'EMAIL,PUSH', 260000,
   '2025-11-24', '2025-11-30', '2025-11-30', 'Active families, all car-seat ages', 'Every customer active in the last year with a child up to five or a car seat purchase.',
   '{"version":1,"all":[{"field":"RECENCY_DAYS","op":"lte","value":365}],"any":[{"field":"CHILD_STAGE","op":"in","values":["EXPECTING","NEWBORN_0_3M","INFANT_3_12M","TODDLER_1_3Y","PRESCHOOL_3_5Y"]},{"field":"CAR_SEATS_SHARE","op":"gte","value":0.0001}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL","PUSH"],"promoted":{"category":"Car Seats","className":null,"brand":null}}'),
  ('camp-h04', 'Christmas Gift Guide - Grandparents', 'Grow Christmas gifting from grandparents and gift buyers.',
   'A curated guide with a bundle saving turns occasional gift buyers into Christmas shoppers.', 'MEASURED',
   'Clothing', NULL, NULL, 'off-4', 'EMAIL', 'EMAIL', 7000,
   '2025-12-01', '2025-12-21', '2025-12-21', 'Grandparents and gift buyers', 'Gift buyers and grandparents who bought in the last 18 months.',
   '{"version":1,"all":[{"field":"SEGMENT_NAME","op":"in","values":["Gift Buyers","Grandparents"]},{"field":"RECENCY_DAYS","op":"lte","value":540}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL"],"promoted":{"category":"Clothing","className":null,"brand":null}}'),
  ('camp-003', 'Back to Childcare - Toddler Essentials', 'Win the back-to-childcare toddler shop from second-time parents.',
   'Second-time parents respond to a timely, practical nudge -- tested on SMS against email.', 'MEASURED',
   'Nappies & Wipes', 'Toddler Nappies', NULL, 'off-6', 'EMAIL_SMS_TEST', 'EMAIL,SMS', 9000,
   '2026-01-15', '2026-02-15', '2026-02-15', 'Second-time parents with toddlers', 'Second-time parents with a toddler or preschooler, or a nappy stage due, active in the last year. Channel randomised where both are consented.',
   '{"version":1,"all":[{"field":"SEGMENT_NAME","op":"in","values":["Second-time Parents"]},{"field":"RECENCY_DAYS","op":"lte","value":365}],"any":[{"field":"CHILD_STAGE","op":"in","values":["TODDLER_1_3Y","PRESCHOOL_3_5Y"]},{"field":"NAPPY_DUE_STATUS","op":"in","values":["DUE_NOW","DUE_SOON"]}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL","SMS"],"promoted":{"category":"Nappies & Wipes","className":"Toddler Nappies","brand":null}}'),
  ('camp-h05', 'Win Back - We Miss You', 'Reactivate loyalty members who have gone quiet.',
   'Members six to twelve months lapsed still have a child in the stage we sell to; a voucher brings them back.', 'MEASURED',
   NULL, NULL, NULL, 'off-12', 'SMS', 'SMS', 6000,
   '2026-02-16', '2026-03-15', '2026-03-15', 'Lapsing loyalty members', 'Silver, Gold and Platinum members whose last purchase was 181 to 365 days before the start, SMS-consented.',
   '{"version":1,"all":[{"field":"LOYALTY_TIER","op":"in","values":["Silver","Gold","Platinum"]},{"field":"RECENCY_DAYS","op":"between","min":181,"max":365}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["SMS"],"promoted":{"category":null,"className":null,"brand":null}}'),
  ('camp-h06', 'Feeding Essentials Replenishment', 'Prompt the next feeding purchase at the right stage.',
   'Parents due a highchair or more bottles respond to an in-app reminder.', 'MEASURED',
   'Feeding', 'Highchairs', NULL, NULL, 'PUSH_EMAIL', 'PUSH,EMAIL', 2500,
   '2026-03-16', '2026-04-12', '2026-04-12', 'Feeding stage due', 'Customers with a feeding stage due or a newborn, active in the last year.',
   '{"version":1,"all":[{"field":"RECENCY_DAYS","op":"lte","value":365}],"any":[{"field":"FEEDING_DUE_STATUS","op":"in","values":["DUE_NOW","DUE_SOON"]},{"field":"CHILD_STAGE","op":"in","values":["EXPECTING","NEWBORN_0_3M"]}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["PUSH","EMAIL"],"promoted":{"category":"Feeding","className":"Highchairs","brand":null}}'),
  ('camp-001', 'Crawler Nappies Surge - Loyalty Push', 'Grow crawler nappy share with Rascal + Friends.',
   'Parents of crawling babies will switch to Rascal + Friends with a subscription discount.', 'LIVE',
   'Nappies & Wipes', 'Crawler Nappies', 'Rascal + Friends', 'off-2', 'PREFERRED_EMAIL_SMS', 'EMAIL,SMS', 12000,
   '2026-04-28', '2026-05-26', '2026-05-07', 'Parents of crawling babies', 'First- and second-time parents with an infant or a crawler nappy stage due, active in the last year.',
   '{"version":1,"all":[{"field":"SEGMENT_NAME","op":"in","values":["First-time Parents","Second-time Parents"]},{"field":"RECENCY_DAYS","op":"lte","value":365}],"any":[{"field":"CHILD_STAGE","op":"in","values":["INFANT_3_12M"]},{"field":"NAPPY_DUE_STATUS","op":"in","values":["DUE_NOW","DUE_SOON"]}],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["EMAIL","SMS"],"promoted":{"category":"Nappies & Wipes","className":"Crawler Nappies","brand":"Rascal + Friends"}}'),
  ('camp-004', 'Gold Member Early Access - Winter Sale', 'Reward Gold and Platinum members with early access to the Winter Sale.',
   'Early access makes top-tier members feel valued and pulls Winter Sale spend forward.', 'PAUSED',
   NULL, NULL, NULL, 'off-7', 'PUSH_EMAIL', 'PUSH,EMAIL', 8000,
   '2026-05-01', '2026-05-31', '2026-05-06', 'Gold and Platinum members', 'Gold and Platinum members active in the last year.',
   '{"version":1,"all":[{"field":"LOYALTY_TIER","op":"in","values":["Gold","Platinum"]},{"field":"RECENCY_DAYS","op":"lte","value":365}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"priceComplainers":false,"openComplaints":false,"stockConflict":false},"channels":["PUSH","EMAIL"],"promoted":{"category":null,"className":null,"brand":null}}');

-- Clear anything a previous run of this script wrote, keeping campaigns a user
-- created in the app (PROVENANCE USER or APP).
DELETE FROM CAMPAIGN WHERE PROVENANCE = 'MODELLED' OR CAMPAIGN_ID IN (SELECT CAMPAIGN_ID FROM HISTORY_DEF) OR CAMPAIGN_ID = 'camp-002';
DELETE FROM CAMPAIGN_STATUS_LOG WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM AUDIENCE WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM AUDIENCE_MEMBER WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CAMPAIGN_EVENT WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CONTENT_VARIANT WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CHANNEL_PLAN WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM VOICE_ITEM WHERE SOURCE = 'REPLY';

INSERT INTO CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, AUDIENCE_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND,
                      OFFER_ID, CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, DESTINATION, SIMULATED_THROUGH, PROVENANCE,
                      CREATED_BY, CREATED_AT, UPDATED_BY, UPDATED_AT)
SELECT CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, FINAL_STATUS, 'aud-' || CAMPAIGN_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND,
       OFFER_ID, CHANNELS, BUDGET_AUD, START_DATE, END_DATE, 10, 'Braze', THROUGH_DATE, 'MODELLED',
       'Mia Torres', DATEADD('day', -28, START_DATE)::TIMESTAMP_NTZ, 'Mia Torres', THROUGH_DATE::TIMESTAMP_NTZ
FROM HISTORY_DEF;

-- The draft for June: a brief with no audience yet, for the presenter to build.
INSERT INTO CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, PROMOTED_CATEGORY, OFFER_ID, CHANNELS, BUDGET_AUD,
                      START_DATE, END_DATE, HOLDOUT_PCT, DESTINATION, PROVENANCE, LEGACY_AUDIENCE_LABEL, CREATED_BY, CREATED_AT)
SELECT 'camp-002', 'Registry Completion - Expecting Mums', 'Convert open baby registries into completed purchases.',
       'Expecting parents with a registry will finish it before the due date if nudged with a completion reward.', 'BRIEF',
       'Prams & Strollers', 'off-3', ARRAY_CONSTRUCT('EMAIL'), 6000, '2026-06-01'::DATE, '2026-06-30'::DATE, 10, 'Braze', 'MODELLED',
       'Expecting + Registry Shoppers', 'Mia Torres', '2026-05-04 10:00:00'::TIMESTAMP_NTZ;

-- ---------- 3. Audiences, frozen on each campaign's start date ----------
INSERT INTO AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT, LOCKED_BY, LOCKED_AT)
SELECT 'aud-' || CAMPAIGN_ID, AUDIENCE_NAME, AUDIENCE_DESC, PARSE_JSON(SPEC_JSON), SHA2(SPEC_JSON, 256), 1, 'BUILDER', 'LOCKED', CAMPAIGN_ID,
       'Mia Torres', DATEADD('day', -16, START_DATE)::TIMESTAMP_NTZ, 'Mia Torres', DATEADD('day', -14, START_DATE)::TIMESTAMP_NTZ
FROM HISTORY_DEF;

-- Features as they stood on each start date: the same function as today's.
CREATE OR REPLACE TEMPORARY TABLE SNAP AS
SELECT CMP_AS_OF() AS SNAPSHOT_DATE, f.* FROM TABLE(CUSTOMER_FEATURES_AT('2024-01-01'::DATE)) f WHERE FALSE;

EXECUTE IMMEDIATE $$
DECLARE
  c CURSOR FOR SELECT DISTINCT START_DATE FROM HISTORY_DEF ORDER BY START_DATE;
BEGIN
  FOR r IN c DO
    LET d DATE := r.START_DATE;
    INSERT INTO SNAP SELECT :d, f.* FROM TABLE(BABY_MART_DEMO.CAMPAIGN.CUSTOMER_FEATURES_AT(:d)) f;
  END FOR;
  RETURN 'ok';
END;
$$;

INSERT INTO AUDIENCE_MEMBER (CAMPAIGN_ID, AUDIENCE_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, SNAPSHOT_DATE,
                             SEGMENT_NAME, LOYALTY_TIER, PROFILE_STATE, HOME_STORE_CODE, HOME_STATE, RECENCY_DAYS, RECENCY_BAND,
                             LINES_12M, SPEND_12M_AUD, AOV_AUD, PROMO_SHARE, CHILD_STAGE, RFM_SEGMENT, NEG_VOICE_120D, NEG_THEME,
                             IS_RELEVANT, STOCK_CONFLICT)
WITH s AS (
  SELECT sn.*,
         DUE_STATUS_AT(sn.NAPPY_DUE_DATE, sn.SNAPSHOT_DATE)    AS NAPPY_DUE_STATUS,
         DUE_STATUS_AT(sn.CAR_SEAT_DUE_DATE, sn.SNAPSHOT_DATE) AS CAR_SEAT_DUE_STATUS,
         DUE_STATUS_AT(sn.FEEDING_DUE_DATE, sn.SNAPSHOT_DATE)  AS FEEDING_DUE_STATUS,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.RECENCY_DAYS DESC, sn.CUSTOMER_KEY)) AS R_SCORE,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.LINES_12M, sn.LINES_TOTAL, sn.CUSTOMER_KEY)) AS F_SCORE,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.SPEND_12M_AUD, sn.SPEND_TOTAL_AUD, sn.CUSTOMER_KEY)) AS M_SCORE
  FROM SNAP sn
), v AS (
  -- What the customer had said in the 120 days before the start, as the AI read it.
  SELECT d.START_DATE, cv.CUSTOMER_KEY, COUNT(*) AS NEG_N, MAX_BY(cv.THEME, cv.EVENT_DATE) AS NEG_THEME
  FROM (SELECT DISTINCT START_DATE FROM HISTORY_DEF) d
  JOIN VW_CUSTOMER_VOICE cv ON cv.CUSTOMER_KEY IS NOT NULL AND cv.SENTIMENT IN ('negative', 'mixed')
   AND cv.EVENT_DATE >= DATEADD('day', -120, d.START_DATE) AND cv.EVENT_DATE < d.START_DATE
  GROUP BY 1, 2
), cand AS (
  SELECT h.CAMPAIGN_ID, h.START_DATE, h.END_DATE, h.CHANNEL_RULE, h.PROMOTED_BRAND, CAMPAIGN_TRACK(h.PROMOTED_CATEGORY) AS TRACK,
         s.CUSTOMER_KEY, s.SEGMENT_NAME, s.LOYALTY_TIER, s.PROFILE_STATE, s.HOME_STORE_CODE, s.HOME_STATE, s.RECENCY_DAYS,
         RECENCY_BAND(s.RECENCY_DAYS) AS RECENCY_BAND, s.LINES_12M, s.SPEND_12M_AUD, s.AOV_AUD, s.PROMO_SHARE, s.CHILD_STAGE,
         RFM_LABEL(s.R_SCORE, s.F_SCORE, s.M_SCORE) AS RFM_SEGMENT, COALESCE(v.NEG_N, 0) AS NEG_VOICE_120D, v.NEG_THEME,
         IS_RELEVANT(CAMPAIGN_TRACK(h.PROMOTED_CATEGORY), s.CHILD_STAGE, s.SEGMENT_NAME, s.RECENCY_DAYS, s.NAPPY_DUE_STATUS,
                     s.CAR_SEAT_DUE_STATUS, s.FEEDING_DUE_STATUS, s.PRAM_NO_CAR_SEAT, s.NAPPIES_SHARE, s.PRAMS_SHARE) AS IS_RELEVANT,
         c.EMAIL_OPT_IN, c.SMS_OPT_IN, c.PUSH_ENABLED, c.PREFERRED_CHANNEL,
         CASE h.CAMPAIGN_ID
           WHEN 'camp-h01' THEN s.CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M') OR s.SEGMENT_NAME = 'Expecting'
           WHEN 'camp-h02' THEN COALESCE(s.PRAMS_SHARE, 0) <= 0
                                AND (s.CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M') OR s.SEGMENT_NAME IN ('Expecting', 'Registry Shoppers'))
           WHEN 'camp-h03' THEN COALESCE(s.RECENCY_DAYS <= 365, FALSE)
                                AND (s.CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y', 'PRESCHOOL_3_5Y')
                                     OR COALESCE(s.CAR_SEATS_SHARE, 0) >= 0.0001)
           WHEN 'camp-h04' THEN s.SEGMENT_NAME IN ('Gift Buyers', 'Grandparents') AND COALESCE(s.RECENCY_DAYS <= 540, FALSE)
           WHEN 'camp-003' THEN s.SEGMENT_NAME = 'Second-time Parents' AND COALESCE(s.RECENCY_DAYS <= 365, FALSE)
                                AND (s.CHILD_STAGE IN ('TODDLER_1_3Y', 'PRESCHOOL_3_5Y') OR s.NAPPY_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON'))
           WHEN 'camp-h05' THEN s.LOYALTY_TIER IN ('Silver', 'Gold', 'Platinum') AND s.RECENCY_DAYS BETWEEN 181 AND 365
           WHEN 'camp-h06' THEN COALESCE(s.RECENCY_DAYS <= 365, FALSE)
                                AND (s.FEEDING_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON') OR s.CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M'))
           WHEN 'camp-001' THEN s.SEGMENT_NAME IN ('First-time Parents', 'Second-time Parents') AND COALESCE(s.RECENCY_DAYS <= 365, FALSE)
                                AND (s.CHILD_STAGE = 'INFANT_3_12M' OR s.NAPPY_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON'))
           WHEN 'camp-004' THEN s.LOYALTY_TIER IN ('Gold', 'Platinum') AND COALESCE(s.RECENCY_DAYS <= 365, FALSE)
         END AS IS_IN
  FROM HISTORY_DEF h
  JOIN s ON s.SNAPSHOT_DATE = h.START_DATE
  JOIN CUSTOMER_CONTACT c ON c.CUSTOMER_KEY = s.CUSTOMER_KEY
  LEFT JOIN v ON v.START_DATE = h.START_DATE AND v.CUSTOMER_KEY = s.CUSTOMER_KEY
), chan AS (
  SELECT cand.*,
         CASE CHANNEL_RULE
           WHEN 'EMAIL' THEN IFF(EMAIL_OPT_IN, 'EMAIL', NULL)
           WHEN 'SMS'   THEN IFF(SMS_OPT_IN, 'SMS', NULL)
           -- A randomised channel test: where both are consented, a coin decides.
           WHEN 'EMAIL_SMS_TEST' THEN CASE WHEN EMAIL_OPT_IN AND SMS_OPT_IN THEN IFF(ABS(HASH(CUSTOMER_KEY, CAMPAIGN_ID, 'chan')) % 2 = 0, 'SMS', 'EMAIL')
                                           WHEN SMS_OPT_IN THEN 'SMS' WHEN EMAIL_OPT_IN THEN 'EMAIL' END
           WHEN 'PREFERRED_EMAIL_SMS' THEN CASE WHEN PREFERRED_CHANNEL IN ('EMAIL', 'SMS') THEN PREFERRED_CHANNEL
                                                WHEN EMAIL_OPT_IN THEN 'EMAIL' WHEN SMS_OPT_IN THEN 'SMS' END
           WHEN 'PUSH_EMAIL' THEN CASE WHEN PUSH_ENABLED THEN 'PUSH' WHEN EMAIL_OPT_IN THEN 'EMAIL' END
           WHEN 'EMAIL_PUSH' THEN CASE WHEN EMAIL_OPT_IN THEN 'EMAIL' WHEN PUSH_ENABLED THEN 'PUSH' END
         END AS CHANNEL_CODE
  FROM cand WHERE IS_IN
)
SELECT ch.CAMPAIGN_ID, 'aud-' || ch.CAMPAIGN_ID, ch.CUSTOMER_KEY,
       IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'holdout')) % 100 < 10, 'HOLDOUT', 'TREATED'),
       ch.CHANNEL_CODE,
       IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'holdout')) % 100 < 10, NULL,
           IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'variant')) % 2 = 0, 'A', 'B')),
       ch.START_DATE, ch.SEGMENT_NAME, ch.LOYALTY_TIER, ch.PROFILE_STATE, ch.HOME_STORE_CODE, ch.HOME_STATE, ch.RECENCY_DAYS, ch.RECENCY_BAND,
       ch.LINES_12M, ch.SPEND_12M_AUD, ch.AOV_AUD, ch.PROMO_SHARE, ch.CHILD_STAGE, ch.RFM_SEGMENT, ch.NEG_VOICE_120D, ch.NEG_THEME,
       COALESCE(ch.IS_RELEVANT, FALSE),
       sp.BRAND_NAME IS NOT NULL
FROM chan ch
LEFT JOIN SUPPLY_POSITION sp ON sp.BRAND_NAME = ch.PROMOTED_BRAND AND sp.STORE_CODE = ch.HOME_STORE_CODE AND sp.STATUS = 'SHORT'
 AND sp.VALID_FROM <= ch.END_DATE AND sp.VALID_TO >= ch.START_DATE
WHERE ch.CHANNEL_CODE IS NOT NULL;

UPDATE AUDIENCE a SET SIZE_AT_SAVE = m.N, REACHABLE_AT_SAVE = m.N
FROM (SELECT AUDIENCE_ID, COUNT(*) AS N FROM AUDIENCE_MEMBER GROUP BY 1) m
WHERE m.AUDIENCE_ID = a.AUDIENCE_ID;

-- ---------- 4. The response simulator ----------
-- Turns a locked audience into events through P_THROUGH. Deterministic: run it
-- again with a later date and the earlier days come out identical, with the new
-- days added. P_PROVENANCE is MODELLED for the history, SIMULATED for a campaign
-- launched in the app.
CREATE OR REPLACE PROCEDURE GENERATE_EVENTS(P_CAMPAIGN_ID VARCHAR, P_THROUGH DATE, P_PROVENANCE VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  n_members NUMBER;
  n_events NUMBER;
  n_replies NUMBER;
BEGIN
  DELETE FROM BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_EVENT WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;
  DELETE FROM BABY_MART_DEMO.CAMPAIGN.VOICE_ITEM WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID AND SOURCE = 'REPLY';

  CREATE OR REPLACE TEMPORARY TABLE GEN_DRAW AS
  WITH cmp AS (
    SELECT c.CAMPAIGN_ID, c.START_DATE, c.END_DATE, c.PROMOTED_CATEGORY, c.PROMOTED_CLASS, c.PROMOTED_BRAND, c.OFFER_ID,
           BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_TRACK(c.PROMOTED_CATEGORY) AS TRACK,
           DATEDIFF('day', c.START_DATE, c.END_DATE) + 1 AS WINDOW_DAYS,
           LEAST(:P_THROUGH, c.END_DATE) AS THROUGH_DATE
    FROM BABY_MART_DEMO.CAMPAIGN.CAMPAIGN c WHERE c.CAMPAIGN_ID = :P_CAMPAIGN_ID
  ), prm AS (
    SELECT p.* FROM BABY_MART_DEMO.CAMPAIGN.RESPONSE_MODEL p CROSS JOIN cmp
    WHERE (p.SCOPE = 'CAMPAIGN' AND p.SCOPE_KEY = cmp.CAMPAIGN_ID) OR (p.SCOPE = 'TRACK' AND p.SCOPE_KEY = cmp.TRACK)
    QUALIFY ROW_NUMBER() OVER (ORDER BY IFF(p.SCOPE = 'CAMPAIGN', 0, 1)) = 1
  ), fat AS (
    -- Contacted by another campaign in the two weeks before this one started.
    SELECT DISTINCT m2.CUSTOMER_KEY
    FROM BABY_MART_DEMO.CAMPAIGN.AUDIENCE_MEMBER m2
    JOIN BABY_MART_DEMO.CAMPAIGN.CAMPAIGN c2 ON c2.CAMPAIGN_ID = m2.CAMPAIGN_ID
    CROSS JOIN cmp
    WHERE m2.GROUP_CODE = 'TREATED' AND m2.CAMPAIGN_ID <> cmp.CAMPAIGN_ID
      AND c2.START_DATE BETWEEN DATEADD('day', -14, cmp.START_DATE) AND DATEADD('day', -1, cmp.START_DATE)
  ), m AS (
    SELECT am.CAMPAIGN_ID, am.CUSTOMER_KEY, am.GROUP_CODE, am.CHANNEL_CODE, am.VARIANT_CODE, am.SEGMENT_NAME, am.RECENCY_BAND,
           am.HOME_STORE_CODE, am.AOV_AUD, am.SUPPRESSED_AT,
           COALESCE(am.IS_RELEVANT, FALSE) AS IS_RELEVANT, COALESCE(am.STOCK_CONFLICT, FALSE) AS STOCK_CONFLICT,
           COALESCE(am.NEG_VOICE_120D, 0) > 0 AND COALESCE(am.NEG_THEME IN ('Price and value', 'Promotions and offers'), FALSE) AS PRICE_GRIEVANCE,
           cmp.START_DATE, cmp.END_DATE, cmp.WINDOW_DAYS, cmp.THROUGH_DATE, cmp.TRACK,
           cmp.PROMOTED_CATEGORY, cmp.PROMOTED_CLASS, cmp.PROMOTED_BRAND,
           COALESCE(o.COST_PER_REDEMPTION, 0) AS REDEMPTION_COST, COALESCE(ch.COST_PER_SEND_AUD, 0) AS SEND_COST,
           prm.BASE_RATE, prm.UPLIFT, prm.CH_EMAIL, prm.CH_SMS, prm.CH_PUSH, prm.CH_SOCIAL, prm.CH_INSTORE, prm.VARIANT_B,
           prm.PERSUADABLE_SEGMENT, prm.PERSUADABLE_MULT, prm.SLEEPING_EFFECT, prm.STOCK_EFFECT, prm.AVG_ORDER_AUD,
           fat.CUSTOMER_KEY IS NOT NULL AS FATIGUED,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'conv'))   % 1000000) / 1000000.0 AS U_CONV,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'day'))    % 1000000) / 1000000.0 AS U_DAY,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'bounce')) % 1000000) / 1000000.0 AS U_BOUNCE,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'open'))   % 1000000) / 1000000.0 AS U_OPEN,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'oday'))   % 1000000) / 1000000.0 AS U_ODAY,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'click'))  % 1000000) / 1000000.0 AS U_CLICK,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'click2')) % 1000000) / 1000000.0 AS U_CLICK2,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'unsub'))  % 1000000) / 1000000.0 AS U_UNSUB,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'compl'))  % 1000000) / 1000000.0 AS U_COMPL,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'reply'))  % 1000000) / 1000000.0 AS U_REPLY,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'value'))  % 1000000) / 1000000.0 AS U_VALUE,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'redeem')) % 1000000) / 1000000.0 AS U_REDEEM
    FROM BABY_MART_DEMO.CAMPAIGN.AUDIENCE_MEMBER am
    JOIN cmp ON cmp.CAMPAIGN_ID = am.CAMPAIGN_ID
    CROSS JOIN prm
    LEFT JOIN BABY_MART_DEMO.CAMPAIGN.OFFER o ON o.OFFER_ID = cmp.OFFER_ID
    LEFT JOIN BABY_MART_DEMO.CAMPAIGN.CHANNEL ch ON ch.CHANNEL_CODE = am.CHANNEL_CODE
    LEFT JOIN fat ON fat.CUSTOMER_KEY = am.CUSTOMER_KEY
  ), p1 AS (
    SELECT m.*,
           LEAST(0.6, BASE_RATE * DECODE(RECENCY_BAND, '0-90d', 1.6, '91-180d', 1.0, '181-365d', 0.55, '365d+', 0.25, 0.10)
                                * IFF(IS_RELEVANT, 1.8, 0.6)) AS P_BASE,
           UPLIFT * DECODE(RECENCY_BAND, '0-90d', 0.45, '91-180d', 1.2, '181-365d', 1.5, '365d+', 0.8, 0.3)
                  * IFF(IS_RELEVANT, 1.0, 0.2)
                  * DECODE(CHANNEL_CODE, 'EMAIL', CH_EMAIL, 'SMS', CH_SMS, 'PUSH', CH_PUSH, 'PAID_SOCIAL', CH_SOCIAL, 'IN_STORE', CH_INSTORE, 1.0)
                  * IFF(SEGMENT_NAME = PERSUADABLE_SEGMENT, COALESCE(PERSUADABLE_MULT, 1), 1)
                  * IFF(VARIANT_CODE = 'B', VARIANT_B, 1) AS U_POS,
           DECODE(RECENCY_BAND, '0-90d', 1.25, '91-180d', 1.0, '181-365d', 0.7, '365d+', 0.45, 0.3) AS O_REC,
           -- Suppressed before the send: never contacted, measured as treated.
           GROUP_CODE = 'TREATED' AND (SUPPRESSED_AT IS NULL OR SUPPRESSED_AT > START_DATE) AS SENT
    FROM m
  ), p2 AS (
    SELECT p1.*,
           CASE WHEN STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL THEN STOCK_EFFECT * P_BASE
                WHEN PRICE_GRIEVANCE THEN SLEEPING_EFFECT * P_BASE
                ELSE U_POS END AS U_EFFECT,
           DATEADD('day', FLOOR(POWER(U_DAY, 1.6) * WINDOW_DAYS), START_DATE) AS CONV_DATE,
           DATEADD('day', IFF(U_ODAY < 0.7, 0, IFF(U_ODAY < 0.9, 1, 2)), START_DATE) AS OPEN_DATE
    FROM p1
  ), p3 AS (
    SELECT p2.*,
           GREATEST(0.002, LEAST(0.9, P_BASE + U_EFFECT)) AS P_TREAT,
           SENT AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH')
             AND U_BOUNCE < DECODE(CHANNEL_CODE, 'EMAIL', 0.012, 'SMS', 0.006, 'PUSH', 0.020, 0) AS BOUNCED,
           -- A treated member converts at P_TREAT while in contact, and at the
           -- base rate on a day after they were suppressed.
           IFF(SENT AND (SUPPRESSED_AT IS NULL OR CONV_DATE < SUPPRESSED_AT),
               U_CONV < GREATEST(0.002, LEAST(0.9, P_BASE + U_EFFECT)), U_CONV < P_BASE) AS CONVERTED
    FROM p2
  )
  SELECT p3.*,
         SENT AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH') AND NOT BOUNCED AS DELIVERED,
         SENT AND CHANNEL_CODE IN ('EMAIL', 'PUSH') AND NOT BOUNCED
           AND U_OPEN < DECODE(CHANNEL_CODE, 'EMAIL', 0.34, 'PUSH', 0.12, 0) * O_REC * IFF(IS_RELEVANT, 1.15, 1.0) AS OPENED,
         IFF(SENT AND NOT BOUNCED AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH'),
             U_UNSUB < DECODE(CHANNEL_CODE, 'EMAIL', 0.0022, 'SMS', 0.0045, 'PUSH', 0.0030, 0)
                       * IFF(PRICE_GRIEVANCE, 1 + 60 * ABS(SLEEPING_EFFECT), 1) * IFF(STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL, 3, 1)
                       * IFF(FATIGUED, 2, 1), FALSE) AS UNSUBSCRIBED,
         IFF(SENT AND NOT BOUNCED AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH'),
             U_COMPL < 0.0003 * IFF(PRICE_GRIEVANCE, 1 + 60 * ABS(SLEEPING_EFFECT), 1)
                       * IFF(STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL, 40, 1), FALSE) AS COMPLAINED,
         IFF(SENT AND NOT BOUNCED AND CHANNEL_CODE IN ('EMAIL', 'SMS'),
             U_REPLY < 0.004 * IFF(PRICE_GRIEVANCE, 1 + 30 * ABS(SLEEPING_EFFECT), 1)
                       * IFF(STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL, 18, 1), FALSE) AS REPLIED,
         ROUND(COALESCE(AVG_ORDER_AUD, GREATEST(COALESCE(AOV_AUD, 0) * 1.3, 60)) * (0.7 + 0.6 * U_VALUE), 2) AS ORDER_VALUE
  FROM p3;

  SELECT COUNT(*) INTO :n_members FROM GEN_DRAW;

  INSERT INTO BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_EVENT
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'SEND', START_DATE, NULL, NULL, NULL, SEND_COST, :P_PROVENANCE
  FROM GEN_DRAW WHERE SENT AND START_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'DELIVER', START_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE DELIVERED AND START_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'BOUNCE', START_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE BOUNCED AND START_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'OPEN', OPEN_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE OPENED AND OPEN_DATE <= THROUGH_DATE
  UNION ALL
  -- Clicks: from an opened email or push, from an SMS link, or on the way to a
  -- conversion; paid social reports clicks only.
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'CLICK',
         IFF(CONVERTED AND U_CLICK >= 0.22, LEAST(CONV_DATE, OPEN_DATE), OPEN_DATE), NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW
  WHERE ((DELIVERED AND ((CHANNEL_CODE = 'EMAIL' AND OPENED AND U_CLICK < 0.22)
                       OR (CHANNEL_CODE = 'SMS' AND U_CLICK < 0.08 * O_REC)
                       OR (CHANNEL_CODE = 'PUSH' AND OPENED AND U_CLICK < 0.55)
                       OR (CONVERTED AND U_CLICK2 < 0.40 AND (OPENED OR CHANNEL_CODE = 'SMS'))))
         OR (SENT AND CHANNEL_CODE = 'PAID_SOCIAL' AND U_CLICK < 0.009))
    AND OPEN_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'CONVERT', CONV_DATE,
         ORDER_VALUE, ROUND(ORDER_VALUE * 0.40, 2),
         IFF(SENT AND U_REDEEM < 0.70, REDEMPTION_COST, 0), NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE CONVERTED AND CONV_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'UNSUBSCRIBE', OPEN_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE UNSUBSCRIBED AND OPEN_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'COMPLAINT', DATEADD('day', 1, OPEN_DATE), NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE COMPLAINED AND DATEADD('day', 1, OPEN_DATE) <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'REPLY', OPEN_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE REPLIED AND OPEN_DATE <= THROUGH_DATE;
  n_events := SQLROWCOUNT;

  -- The replies' words: what went wrong or right for the member decides the kind
  -- of reply, the phrase library supplies the text.
  INSERT INTO BABY_MART_DEMO.CAMPAIGN.VOICE_ITEM
  WITH r AS (
    SELECT g.*,
           CASE WHEN g.STOCK_CONFLICT AND g.PROMOTED_BRAND IS NOT NULL THEN 'REPLY_STOCK'
                WHEN g.PRICE_GRIEVANCE THEN 'REPLY_PRICE'
                WHEN g.UNSUBSCRIBED OR g.FATIGUED THEN 'REPLY_NEG'
                WHEN g.CONVERTED THEN 'REPLY_POS'
                ELSE 'REPLY_NEU' END AS REPLY_KIND,
           REPLACE(s.STORE_NAME, 'Baby Mart ', '') AS SUBURB
    FROM GEN_DRAW g
    LEFT JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON s.STORE_CODE = g.HOME_STORE_CODE
    WHERE g.REPLIED AND g.OPEN_DATE <= g.THROUGH_DATE
  ), picked AS (
    SELECT r.*, ph.TEXT AS CORE, ph.THEME, ph.POLARITY
    FROM r JOIN BABY_MART_DEMO.CAMPAIGN.VOICE_PHRASE ph
      ON ph.STORYLINE = r.REPLY_KIND AND (ph.CATEGORY = 'ANY' OR ph.CATEGORY = r.PROMOTED_CATEGORY)
     AND (NOT CONTAINS(ph.TEXT, '{brand}') OR r.PROMOTED_BRAND IS NOT NULL)
     AND (NOT CONTAINS(ph.TEXT, '{store}') OR r.SUBURB IS NOT NULL)
     AND (NOT CONTAINS(ph.TEXT, '{class}') OR r.PROMOTED_CLASS IS NOT NULL)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY r.CUSTOMER_KEY ORDER BY ABS(HASH(r.CUSTOMER_KEY, r.CAMPAIGN_ID, ph.PHRASE_ID))) = 1
  ), t AS (
    SELECT picked.*,
           REPLACE(REPLACE(REPLACE(CORE, '{brand}', COALESCE(PROMOTED_BRAND, '')), '{store}', COALESCE(SUBURB, '')),
                   '{class}', LOWER(COALESCE(PROMOTED_CLASS, ''))) AS TXT
    FROM picked
  )
  SELECT 'RPL-' || CAMPAIGN_ID || '-' || CUSTOMER_KEY, 'REPLY', OPEN_DATE, CUSTOMER_KEY, HOME_STORE_CODE, NULL,
         PROMOTED_BRAND, PROMOTED_CATEGORY, PROMOTED_CLASS, CAMPAIGN_ID, CHANNEL_CODE, NULL, NULL,
         TXT, SHA2(TXT, 256), THEME, POLARITY, NULL, NULL, REPLY_KIND, 'SYNTHETIC'
  FROM t;
  n_replies := SQLROWCOUNT;

  MERGE INTO BABY_MART_DEMO.CAMPAIGN.VOICE_TEXT t
  USING (
    SELECT TEXT_HASH, ANY_VALUE(VOICE_TEXT) AS VOICE_TEXT, ANY_VALUE(TRUE_THEME) AS TRUE_THEME, ANY_VALUE(TRUE_POLARITY) AS TRUE_POLARITY,
           COUNT(*) AS ITEMS, MIN(EVENT_DATE) AS FIRST_SEEN
    FROM BABY_MART_DEMO.CAMPAIGN.VOICE_ITEM WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID AND TEXT_HASH IS NOT NULL GROUP BY TEXT_HASH
  ) s ON t.TEXT_HASH = s.TEXT_HASH
  WHEN NOT MATCHED THEN INSERT (TEXT_HASH, VOICE_TEXT, TRUE_THEME, TRUE_POLARITY, TRUE_STAGE, TRUE_INTENT, ITEMS, FIRST_SEEN)
    VALUES (s.TEXT_HASH, s.VOICE_TEXT, s.TRUE_THEME, s.TRUE_POLARITY, NULL, NULL, s.ITEMS, s.FIRST_SEEN);

  RETURN OBJECT_CONSTRUCT('campaign_id', :P_CAMPAIGN_ID, 'through', :P_THROUGH, 'members', n_members, 'events', n_events, 'replies', n_replies);
END;
$$;

-- Fast-forward a launched campaign by P_DAYS of simulated time. Moves it to
-- COMPLETED when the window ends, reads the new replies, and records who did it.
CREATE OR REPLACE PROCEDURE SIMULATE_CAMPAIGN(P_CAMPAIGN_ID VARCHAR, P_DAYS NUMBER, P_USER VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  st VARCHAR;
  start_date DATE;
  end_date DATE;
  through_date DATE;
  next_through DATE;
  gen VARIANT;
BEGIN
  SELECT STATUS, START_DATE, END_DATE, SIMULATED_THROUGH INTO :st, :start_date, :end_date, :through_date
  FROM BABY_MART_DEMO.CAMPAIGN.CAMPAIGN WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;
  IF (st IS NULL OR st NOT IN ('LIVE', 'SCHEDULED')) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Only a live or scheduled campaign can be fast-forwarded; this one is ' || COALESCE(st, 'missing') || '.');
  END IF;
  next_through := LEAST(end_date, DATEADD('day', GREATEST(1, LEAST(P_DAYS, 60)), COALESCE(through_date, DATEADD('day', -1, start_date))));
  gen := (CALL BABY_MART_DEMO.CAMPAIGN.GENERATE_EVENTS(:P_CAMPAIGN_ID, :next_through, 'SIMULATED'));
  UPDATE BABY_MART_DEMO.CAMPAIGN.CAMPAIGN
     SET SIMULATED_THROUGH = :next_through,
         STATUS = IFF(:next_through >= END_DATE, 'COMPLETED', 'LIVE'),
         UPDATED_BY = :P_USER, UPDATED_AT = CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ
   WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;
  IF (st = 'SCHEDULED') THEN
    INSERT INTO BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_STATUS_LOG VALUES
      (:P_CAMPAIGN_ID, 'SCHEDULED', 'LIVE', 'Start date reached in simulation.', :P_USER, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ);
  END IF;
  IF (next_through >= end_date) THEN
    INSERT INTO BABY_MART_DEMO.CAMPAIGN.CAMPAIGN_STATUS_LOG VALUES
      (:P_CAMPAIGN_ID, 'LIVE', 'COMPLETED', 'End date reached in simulation.', :P_USER, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ);
  END IF;
  CALL BABY_MART_DEMO.CAMPAIGN.ENRICH_VOICE(2000);
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'through', next_through, 'completed', next_through >= end_date, 'events', gen);
END;
$$;

-- ---------- 5. Run the history ----------
EXECUTE IMMEDIATE $$
DECLARE
  c CURSOR FOR SELECT CAMPAIGN_ID, THROUGH_DATE FROM HISTORY_DEF ORDER BY START_DATE;
BEGIN
  FOR r IN c DO
    LET id VARCHAR := r.CAMPAIGN_ID;
    LET d DATE := r.THROUGH_DATE;
    CALL BABY_MART_DEMO.CAMPAIGN.GENERATE_EVENTS(:id, :d, 'MODELLED');
  END FOR;
  RETURN 'ok';
END;
$$;

-- Read the replies the history produced.
CALL ENRICH_VOICE(5000);

-- ---------- 6. Lifecycle trail ----------
INSERT INTO CAMPAIGN_STATUS_LOG (CAMPAIGN_ID, FROM_STATUS, TO_STATUS, REASON, CHANGED_BY, CHANGED_AT)
WITH steps AS (
  SELECT * FROM VALUES
    (1, NULL,               'BRIEF',            'Brief written.',                                     -28),
    (2, 'BRIEF',            'AUDIENCE_LOCKED',  'Audience locked with a 10% holdout.',                -14),
    (3, 'AUDIENCE_LOCKED',  'CONTENT_APPROVED', 'Variants A and B passed content QA.',                -7),
    (4, 'CONTENT_APPROVED', 'SCHEDULED',        'Channel plan approved within budget.',               -3),
    (5, 'SCHEDULED',        'LIVE',             'Sent.',                                              0)
  AS t(N, FROM_STATUS, TO_STATUS, REASON, OFFSET_DAYS)
)
SELECT h.CAMPAIGN_ID, s.FROM_STATUS, s.TO_STATUS, s.REASON, 'Mia Torres',
       DATEADD('hour', 9 + s.N, DATEADD('day', s.OFFSET_DAYS, h.START_DATE)::TIMESTAMP_NTZ)
FROM HISTORY_DEF h CROSS JOIN steps s
UNION ALL
SELECT CAMPAIGN_ID, 'LIVE', 'COMPLETED', 'Campaign window ended.', 'system', DATEADD('hour', 23, END_DATE::TIMESTAMP_NTZ)
FROM HISTORY_DEF WHERE FINAL_STATUS = 'MEASURED'
UNION ALL
SELECT CAMPAIGN_ID, 'COMPLETED', 'MEASURED', 'Lift read against the holdout and learnings published.', 'Mia Torres',
       DATEADD('hour', 10, DATEADD('day', 10, END_DATE)::TIMESTAMP_NTZ)
FROM HISTORY_DEF WHERE FINAL_STATUS = 'MEASURED'
UNION ALL
SELECT 'camp-004', 'LIVE', 'PAUSED',
       'Unsubscribes running well above the limit in the first week; replies from members who had complained about price. Paused to investigate.',
       'Mia Torres', '2026-05-06 16:20:00'::TIMESTAMP_NTZ
UNION ALL
SELECT 'camp-002', NULL, 'BRIEF', 'Brief written; audience still to build.', 'Mia Torres', '2026-05-04 10:00:00'::TIMESTAMP_NTZ;

-- ---------- 7. Creative ----------
INSERT INTO CONTENT_VARIANT (VARIANT_ID, CAMPAIGN_ID, VARIANT_CODE, ANGLE, SUBJECT, PREHEADER, BODY, SMS_TEXT, PUSH_TITLE, PUSH_BODY, CTA,
                             QA, QA_STATUS, STATUS, APPROVED_BY, APPROVED_AT, CREATED_BY, CREATED_AT)
SELECT v.column1 || '-' || v.column2, v.column1, v.column2, v.column3, v.column4, v.column5, v.column6, v.column7, v.column8, v.column9, v.column10,
       PARSE_JSON('{"checks":[{"check":"Channel length limits","result":"PASS"},{"check":"Offer terms match the catalogue","result":"PASS"},{"check":"Products in range","result":"PASS"},{"check":"Claims","result":"PASS"}],"judge":{"brand_voice":4,"claims_risk":"LOW","tone_fit":4}}'),
       'PASS', 'APPROVED', 'Mia Torres', DATEADD('day', -7, h.START_DATE)::TIMESTAMP_NTZ, 'Mia Torres', DATEADD('day', -9, h.START_DATE)::TIMESTAMP_NTZ
FROM VALUES
  ('camp-h01', 'A', 'Welcome gift', 'A little welcome gift for your newborn', 'Free sample pack with your first nappy shop',
   'Congratulations from everyone at Baby Mart. Pick up a free Newborn Essentials sample pack with your first nappy purchase, in store or online.', NULL, NULL, NULL, 'Claim your welcome pack'),
  ('camp-h01', 'B', 'Expert help', 'Your first weeks, sorted', 'Newborn nappies, wipes and a free sample pack',
   'Our team can help you choose newborn nappies, wipes and feeding basics, and your first nappy shop comes with a free sample pack.', NULL, NULL, NULL, 'Plan your first shop'),
  ('camp-h02', 'A', 'Test drive', 'Test drive this season''s prams', 'Book a pram demo at your local store',
   'Push, fold and lift every pram we stock before you decide. Bring your car boot measurements and we will help you find the one that fits.',
   'Baby Mart: Test drive this season''s prams at your local store. Book a demo: babymart.com.au/prams Opt out: STOP', NULL, NULL, 'Book a demo'),
  ('camp-h02', 'B', 'Trade up', '$75 towards your new pram', 'Trade in an old pram and save',
   'Trade in a complete pram and get $75 off a new one. Then test drive this season''s range with our team.',
   'Baby Mart: Trade in an old pram, get $75 off a new one. Details in store. Opt out: STOP', NULL, NULL, 'See the range'),
  ('camp-h03', 'A', 'Black Friday', 'Black Friday: 20% off every car seat', 'One week only',
   'Every car seat is 20% off for Black Friday week, from capsules to boosters.', NULL, 'Black Friday car seats', '20% off every car seat this week.', 'Shop car seats'),
  ('camp-h03', 'B', 'Safety first', 'The right seat for every stage, 20% off', 'Black Friday week only',
   'Capsule, convertible or booster: find the right seat for your child''s stage, 20% off this week only.', NULL, 'Every stage, 20% off', 'Car seats for every stage, 20% off.', 'Find the right seat'),
  ('camp-h04', 'A', 'Gift guide', 'The grandparent''s gift guide', 'Gifts they will actually use',
   'Our team picked the gifts new parents ask for most: sleepsuits, swaddles and nursery basics. Save 15% when you buy three or more.', NULL, NULL, NULL, 'Browse the guide'),
  ('camp-h04', 'B', 'Bundle and save', 'Wrap up 15% off nursery bundles', 'Three or more items, 15% off',
   'Build a nursery bundle of three or more items and save 15% this Christmas.', NULL, NULL, NULL, 'Build a bundle'),
  ('camp-003', 'A', 'Childcare checklist', 'Your back-to-childcare checklist', 'Toddler nappies, wipes and a free pull-ups sample',
   'Back to childcare next week? Tick off toddler nappies and wipes in one shop, and pick up a free pull-ups sample with crawler or toddler nappies.',
   'Baby Mart: Back to childcare? Toddler nappies + a free pull-ups sample this week. Opt out: STOP', NULL, NULL, 'Get the checklist'),
  ('camp-003', 'B', 'Time saver', 'The childcare run, sorted in one shop', 'Everything for drop-off, plus a free sample',
   'One shop for everything your toddler needs for childcare, and a free pull-ups sample when you buy nappies.',
   'Baby Mart: Childcare run sorted - nappies, wipes + free pull-ups sample. Opt out: STOP', NULL, NULL, 'Shop toddler essentials'),
  ('camp-h05', 'A', 'We miss you', 'We have missed you', '$15 off your next $60 shop',
   NULL, 'Baby Mart: We have missed you. Here is $15 off a $60 shop, valid 30 days. Opt out: STOP', NULL, NULL, 'Use my voucher'),
  ('camp-h05', 'B', 'New season', 'New season, next size up', '$15 off your next $60 shop',
   NULL, 'Baby Mart: Next size up? New season range is in, plus $15 off a $60 shop. Opt out: STOP', NULL, NULL, 'Use my voucher'),
  ('camp-h06', 'A', 'Running low', 'Running low on bottles?', 'Restock before you run out',
   'Bottles, teats and steriliser tablets, ready when you need them.', NULL, 'Running low on bottles?', 'Restock your feeding basics today.', 'Restock'),
  ('camp-h06', 'B', 'Starting solids', 'Starting solids? Highchairs they will love', 'Our most-loved highchairs',
   'Starting solids is messy. Our team''s favourite highchairs make it easier.', NULL, 'Starting solids?', 'Highchairs parents love.', 'See highchairs'),
  ('camp-001', 'A', 'Subscribe and save', 'Rascal + Friends crawler nappies, 10% off on subscription', 'Never run out again',
   'On the move? Rascal + Friends crawler nappies are designed for crawlers. Subscribe and save 10% on every order.',
   'Baby Mart: Rascal + Friends crawler nappies, 10% off on subscription. Opt out: STOP', NULL, NULL, 'Start a subscription'),
  ('camp-001', 'B', 'On the move', 'Nappies that keep up with your crawler', 'Rascal + Friends, 10% off on subscription',
   'Crawling means a nappy that moves with them. Try Rascal + Friends crawler nappies and save 10% when you subscribe.',
   'Baby Mart: Nappies that keep up with your crawler. 10% off Rascal + Friends on subscription. Opt out: STOP', NULL, NULL, 'Try them'),
  ('camp-004', 'A', 'Early access', 'Your Winter Sale early access starts now', '48 hours before everyone else',
   'As a Gold or Platinum member you shop the Winter Sale 48 hours early.', NULL, 'Your early access starts now', 'Shop the Winter Sale 48 hours early.', 'Shop early'),
  ('camp-004', 'B', 'Members first', 'Members first: the Winter Sale', 'Early access for Gold and Platinum',
   'Thank you for being one of our most loyal members. The Winter Sale opens to you first.', NULL, 'Members first', 'The Winter Sale opens to you first.', 'Shop now')
  AS v
JOIN HISTORY_DEF h ON h.CAMPAIGN_ID = v.column1;

-- ---------- 8. Channel plans, from the members actually assigned ----------
INSERT INTO CHANNEL_PLAN (CAMPAIGN_ID, CHANNEL_CODE, MEMBERS, COST_AUD, SEND_DAY, SEND_HOUR, RATIONALE, CREATED_BY, CREATED_AT)
SELECT m.CAMPAIGN_ID, m.CHANNEL_CODE, COUNT_IF(m.GROUP_CODE = 'TREATED'),
       ROUND(COUNT_IF(m.GROUP_CODE = 'TREATED') * ch.COST_PER_SEND_AUD, 2),
       DAYNAME(h.START_DATE), DECODE(m.CHANNEL_CODE, 'SMS', 11, 'PUSH', 19, 8),
       DECODE(h.CHANNEL_RULE, 'EMAIL_SMS_TEST', 'Randomised email vs SMS test where both are consented.',
                              'PREFERRED_EMAIL_SMS', 'Each member on their preferred channel.',
                              'PUSH_EMAIL', 'App push where enabled, email otherwise.',
                              'EMAIL_PUSH', 'Email where consented, app push otherwise.',
                              'Single channel.'),
       'Mia Torres', DATEADD('day', -3, h.START_DATE)::TIMESTAMP_NTZ
FROM AUDIENCE_MEMBER m
JOIN HISTORY_DEF h ON h.CAMPAIGN_ID = m.CAMPAIGN_ID
JOIN CHANNEL ch ON ch.CHANNEL_CODE = m.CHANNEL_CODE
GROUP BY m.CAMPAIGN_ID, m.CHANNEL_CODE, ch.COST_PER_SEND_AUD, h.START_DATE, h.CHANNEL_RULE;
