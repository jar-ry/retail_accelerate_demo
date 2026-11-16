-- ============================================================
-- Campaign & CRM — foundation
--
-- The Campaign Manager persona rebuilt around four stages -- ideation, audience
-- creation, content and channel strategy, performance measurement -- in its own
-- schema, BABY_MART_DEMO.CAMPAIGN, so nothing the Category, Supply, Global
-- Planning or Head of Planning tabs read is touched.
--
-- PROVENANCE, stated once here and carried to every surface:
--   REAL       purchase history from CURATED.FACT_TRANSACTION_LINES: recency,
--              frequency, spend, category mix, home store, and the child's stage,
--              which the product classes encode (Newborn -> Crawler -> Toddler
--              nappies, Capsule 0-6m -> Convertible 0-4y -> Booster 4-8y).
--   GENERATED  the customer profile on CURATED.DIM_CUSTOMER (segment, state, age
--              band, tier). Its LIFETIME_SPEND / TOTAL_TRANSACTIONS /
--              LAST_PURCHASE_DATE columns are random and do NOT reconcile to the
--              purchases, so nothing here reads them: spend and recency come from
--              the transactions.
--   MODELLED   consent and contactability (no source holds them), store-level
--              supply position (from the seeded STOCK_ALERTS), and campaign
--              history and responses (sql/43).
--   SYNTHETIC  customer voice: surveys, reviews, replies, social, care (sql/41).
--   SIMULATED  results of a campaign launched in the app, produced by the same
--              response model as the history (SIMULATE_CAMPAIGN, sql/43).
--
-- THE DEMO CLOCK. Purchases end on 7 May 2026, so "today" for every recency,
-- due-date and campaign-window calculation is AS_OF_DATE in CMP_SETTING -- never
-- CURRENT_DATE(), which would leave every customer six months lapsed and every
-- recency filter empty. Seeds use no RANDOM() either: pseudo-random draws are
-- HASH-based, so a figure the AI quotes still matches the screen after a redeploy.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;

CREATE SCHEMA IF NOT EXISTS BABY_MART_DEMO.CAMPAIGN
  COMMENT = 'Campaign & CRM - ideation, audiences, content and channels, measurement. Baby Mart data, AUD.';
USE SCHEMA BABY_MART_DEMO.CAMPAIGN;

-- ---------- 1. Settings ----------
CREATE OR REPLACE TABLE CMP_SETTING (
  SETTING_KEY    VARCHAR PRIMARY KEY,
  SETTING_VALUE  VARCHAR NOT NULL,
  DATA_TYPE      VARCHAR NOT NULL,
  LABEL          VARCHAR NOT NULL,
  DESCRIPTION    VARCHAR,
  UPDATED_BY     VARCHAR DEFAULT 'seed',
  UPDATED_AT     TIMESTAMP_NTZ DEFAULT '2026-05-07 09:00:00'::TIMESTAMP_NTZ
) COMMENT = 'Operator settings for the campaign persona. AS_OF_DATE is the demo clock.';

INSERT INTO CMP_SETTING (SETTING_KEY, SETTING_VALUE, DATA_TYPE, LABEL, DESCRIPTION) VALUES
  ('AS_OF_DATE',          '2026-05-07', 'DATE',   'As-of date',                    'Demo clock: the last day of purchase data. Recency, due dates and campaign windows are measured from here.'),
  ('HOLDOUT_PCT',         '10',         'NUMBER', 'Holdout share (%)',             'Share of a locked audience held back from contact so incremental lift can be measured.'),
  ('FATIGUE_DAYS',        '14',         'NUMBER', 'Fatigue window (days)',         'A customer contacted by another campaign inside this window is suppressed by default.'),
  ('MAX_CONTACTS_30D',    '3',          'NUMBER', 'Max contacts per 30 days',      'Frequency cap across all campaigns.'),
  ('BOUNCE_ALERT_PCT',    '3',          'NUMBER', 'Bounce alert (%)',              'Raise a deliverability alert above this bounce rate.'),
  ('UNSUB_ALERT_PCT',     '0.8',        'NUMBER', 'Unsubscribe alert (%)',         'Raise an alert above this unsubscribe rate of delivered sends.'),
  ('COMPLAINT_ALERT_PCT', '0.2',        'NUMBER', 'Complaint alert (%)',           'Raise an alert above this complaint rate of delivered sends.'),
  ('PACING_ALERT_PTS',    '15',         'NUMBER', 'Pacing alert (pts)',            'Raise an alert when spend runs this many points ahead of elapsed time.'),
  ('NEG_REPLY_ALERT_PCT', '35',         'NUMBER', 'Negative reply alert (%)',      'Raise an alert when this share of a campaign''s replies is negative.'),
  ('MIN_ARM_FOR_LEARNING','300',        'NUMBER', 'Minimum holdout for a learning','A cell needs at least this many holdout customers before its lift is published as a learning.'),
  ('DEFAULT_MODEL',       'claude-sonnet-4-6', 'TEXT', 'Default model',            'Model for ideas, audience requests, copy and insights.'),
  ('CURRENCY',            'AUD',        'TEXT',   'Currency',                      'Baby Mart stores, POS and margins are in Australian dollars.');

-- The demo clock as a function, so every later script and view reads the one
-- setting instead of repeating the date.
CREATE OR REPLACE FUNCTION CMP_AS_OF()
RETURNS DATE
MEMOIZABLE
AS
$$
  SELECT SETTING_VALUE::DATE FROM BABY_MART_DEMO.CAMPAIGN.CMP_SETTING WHERE SETTING_KEY = 'AS_OF_DATE'
$$;

-- Where a stage-due date falls against a reference date. "Now" means due in the
-- last 90 days or the next 30: a parent who is a little late is still in the
-- market. DUE_STATUS is the same against the demo clock.
CREATE OR REPLACE FUNCTION DUE_STATUS_AT(DUE DATE, REF DATE)
RETURNS VARCHAR
AS
$$
  CASE WHEN DUE IS NULL THEN NULL
       WHEN DUE BETWEEN DATEADD('day', -90, REF) AND DATEADD('day', 30, REF) THEN 'DUE_NOW'
       WHEN DUE BETWEEN DATEADD('day', 31, REF) AND DATEADD('day', 120, REF) THEN 'DUE_SOON'
       WHEN DUE > DATEADD('day', 120, REF) THEN 'LATER'
       ELSE 'PASSED' END
$$;

CREATE OR REPLACE FUNCTION DUE_STATUS(DUE DATE)
RETURNS VARCHAR
AS
$$
  BABY_MART_DEMO.CAMPAIGN.DUE_STATUS_AT(DUE, BABY_MART_DEMO.CAMPAIGN.CMP_AS_OF())
$$;

CREATE OR REPLACE FUNCTION RECENCY_BAND(DAYS NUMBER)
RETURNS VARCHAR
AS
$$
  CASE WHEN DAYS IS NULL THEN 'NONE' WHEN DAYS <= 90 THEN '0-90d' WHEN DAYS <= 180 THEN '91-180d'
       WHEN DAYS <= 365 THEN '181-365d' ELSE '365d+' END
$$;

-- RFM label from quintile scores (5 = best). Ordered so a customer lands in the
-- first rule they meet.
CREATE OR REPLACE FUNCTION RFM_LABEL(R NUMBER, F NUMBER, M NUMBER)
RETURNS VARCHAR
AS
$$
  CASE
    WHEN R IS NULL THEN 'No purchases'
    WHEN R >= 4 AND F >= 4 AND M >= 4 THEN 'Champions'
    WHEN R >= 3 AND F >= 4 THEN 'Loyal'
    WHEN R = 5 AND F <= 2 THEN 'New'
    WHEN R >= 3 AND M >= 3 THEN 'Potential loyalist'
    WHEN R <= 2 AND M >= 4 THEN 'At risk'
    WHEN R <= 2 AND M >= 2 THEN 'Hibernating'
    WHEN R = 1 THEN 'Lost'
    ELSE 'Needs attention'
  END
$$;

-- A campaign's TRACK is what it sells, at the level the child-stage signal works:
-- NAPPY, CAR_SEAT, FEEDING, PRAM, CLOTHING, or GENERAL when it promotes no one
-- category (a members' event).
CREATE OR REPLACE FUNCTION CAMPAIGN_TRACK(CATEGORY VARCHAR)
RETURNS VARCHAR
AS
$$
  DECODE(CATEGORY, 'Nappies & Wipes', 'NAPPY', 'Car Seats', 'CAR_SEAT', 'Feeding', 'FEEDING',
                   'Prams & Strollers', 'PRAM', 'Clothing', 'CLOTHING', 'GENERAL')
$$;

-- Does the customer need what a campaign on this track sells, right now? One
-- definition for the modelled history, the simulator, the uplift model and the
-- audience builder, so "relevant" means the same thing at every stage.
CREATE OR REPLACE FUNCTION IS_RELEVANT(TRACK VARCHAR, CHILD_STAGE VARCHAR, SEGMENT_NAME VARCHAR, RECENCY_DAYS NUMBER,
                                       NAPPY_DUE VARCHAR, CAR_SEAT_DUE VARCHAR, FEEDING_DUE VARCHAR,
                                       PRAM_NO_CAR_SEAT BOOLEAN, NAPPIES_SHARE FLOAT, PRAMS_SHARE FLOAT)
RETURNS BOOLEAN
AS
$$
  CASE TRACK
    WHEN 'NAPPY'    THEN COALESCE(NAPPY_DUE IN ('DUE_NOW', 'DUE_SOON'), FALSE)
                         OR (COALESCE(CHILD_STAGE IN ('NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y'), FALSE) AND COALESCE(NAPPIES_SHARE, 0) > 0)
    WHEN 'CAR_SEAT' THEN COALESCE(CAR_SEAT_DUE IN ('DUE_NOW', 'DUE_SOON'), FALSE) OR COALESCE(PRAM_NO_CAR_SEAT, FALSE)
    WHEN 'FEEDING'  THEN COALESCE(FEEDING_DUE IN ('DUE_NOW', 'DUE_SOON'), FALSE) OR COALESCE(CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M'), FALSE)
    WHEN 'PRAM'     THEN COALESCE(CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M'), FALSE) AND COALESCE(PRAMS_SHARE, 0) = 0
    WHEN 'CLOTHING' THEN COALESCE(CHILD_STAGE IN ('NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y'), FALSE)
                         OR COALESCE(SEGMENT_NAME IN ('Gift Buyers', 'Grandparents'), FALSE)
    -- A members' event or win-back sells everything: relevant to anyone still
    -- in the baby years, however long since they last shopped.
    ELSE COALESCE(CHILD_STAGE IN ('EXPECTING', 'NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_3Y', 'PRESCHOOL_3_5Y'), FALSE)
  END
$$;

-- ---------- 2. Channels ----------
CREATE OR REPLACE TABLE CHANNEL (
  CHANNEL_CODE        VARCHAR PRIMARY KEY,
  LABEL               VARCHAR NOT NULL,
  COST_PER_SEND_AUD   NUMBER(8,4) NOT NULL,
  MAX_CHARS           NUMBER,
  CONSENT_COLUMN      VARCHAR,
  IS_OWNED            BOOLEAN NOT NULL,
  IS_PERSONAL         BOOLEAN NOT NULL,
  SORT_ORDER          NUMBER,
  DESCRIPTION         VARCHAR
) COMMENT = 'Channels a campaign can use. Owned, personal channels need consent; paid social and in-store reach an audience, not a person.';

INSERT INTO CHANNEL VALUES
  ('EMAIL',       'Email',            0.0300, NULL, 'EMAIL_OPT_IN', TRUE,  TRUE,  1, 'Subject, preheader and body. Cheapest personal channel; lowest attention.'),
  ('SMS',         'SMS',              0.0800, 160,  'SMS_OPT_IN',   TRUE,  TRUE,  2, 'One message of up to 160 characters. Expensive, high attention.'),
  ('PUSH',        'App push',         0.0000, 110,  'PUSH_ENABLED', TRUE,  TRUE,  3, 'App notification: title and body. Free, but only app users.'),
  ('PAID_SOCIAL', 'Paid social',      0.0120, 280,  NULL,           FALSE, FALSE, 4, 'Hashed audience match on Meta and TikTok. Cost per reached member at an AUD 12 CPM.'),
  ('IN_STORE',    'In-store',         0.0000, 90,   NULL,           TRUE,  FALSE, 5, 'POS screen and shelf message in the stores where the audience shops.');

-- ---------- 3. Offers ----------
-- Ported from the hardcoded array the old Offers page used, plus two the car-seat
-- and pram storylines need. MECHANIC matches CURATED.DIM_PROMOTION's vocabulary.
CREATE OR REPLACE TABLE OFFER (
  OFFER_ID              VARCHAR PRIMARY KEY,
  NAME                  VARCHAR NOT NULL,
  OFFER_TYPE            VARCHAR NOT NULL,
  MECHANIC              VARCHAR NOT NULL,
  DESCRIPTION           VARCHAR NOT NULL,
  COST_PER_REDEMPTION   NUMBER(8,2) NOT NULL,
  DISCOUNT_PCT          NUMBER(5,2),
  CATEGORY              VARCHAR,
  FUNDED_BY             VARCHAR,
  TERMS                 VARCHAR,
  IS_ACTIVE             BOOLEAN DEFAULT TRUE
) COMMENT = 'Offer catalogue. Copy may only quote an offer''s terms as written here.';

INSERT INTO OFFER VALUES
  ('off-1',  'Welcome Pack - Newborn Essentials', 'Promo',    'GWP',       'Free sample pack with a first nappy purchase for new parents', 8.50, NULL, 'Nappies & Wipes', NULL, 'One pack per customer, while stocks last.', TRUE),
  ('off-2',  'Nappy Subscription - 10% Off',      'Discount', '% Off',     'Monthly nappy auto-ship with a 10% loyalty discount',          4.20, 10,   'Nappies & Wipes', NULL, '10% off every subscription order; cancel any time.', TRUE),
  ('off-3',  'Registry Completion Reward',        'Reward',   'GWP',       'A $25 voucher when a registry reaches 80% purchased',          25.00, NULL, NULL, NULL, 'Voucher issued once per registry; valid 60 days.', TRUE),
  ('off-4',  'Nursery Bundle Deal',               'Discount', 'Bundle',    '15% off when buying 3 or more nursery items together',         18.50, 15,   NULL, NULL, '15% off the bundle; excludes prams and car seats.', TRUE),
  ('off-5',  'Huggies Partner Cashback',          'Cashback', 'GWP',       '$5 cashback on Huggies purchases over $30',                    2.50, NULL, 'Nappies & Wipes', 'Kimberly-Clark', 'Supplier funded; one claim per customer per month.', TRUE),
  ('off-6',  'Toddler Transition Kit',            'Promo',    'GWP',       'Free pull-ups sample with a crawler nappy purchase',           6.00, NULL, 'Nappies & Wipes', NULL, 'One sample per customer.', TRUE),
  ('off-7',  'Gold Member Early Access',          'Reward',   '% Off',     'Early access to seasonal sales for Gold and Platinum members',  0.00, NULL, NULL, NULL, 'Gold and Platinum members only; 48 hours early.', TRUE),
  ('off-8',  'Refer a Parent - $15 Each',         'Partner',  'GWP',       'Referrer and new parent each get $15 store credit',            30.00, NULL, NULL, 'Baby Mart Loyalty', 'Credit issued after the referred parent''s first purchase.', TRUE),
  ('off-9',  'Free Fitting + $40 Off a Convertible', 'Service','% Off',    'Free professional fitting and $40 off a convertible car seat',  52.00, NULL, 'Car Seats', NULL, '$40 off convertible car seats over $299; fitting booked in store.', TRUE),
  ('off-10', 'Pram Trade-Up Credit',              'Reward',   'GWP',       '$75 credit towards a new pram when you trade in an old one',    75.00, NULL, 'Prams & Strollers', NULL, 'One trade-in per customer; pram must be complete.', TRUE),
  ('off-11', 'Black Friday - 20% Off Car Seats',  'Discount', '% Off',     '20% off every car seat for one week',                           98.00, 20,   'Car Seats', NULL, 'Black Friday week only; excludes clearance.', FALSE),
  ('off-12', 'Welcome Back - $15 Off $60',        'Reward',   '% Off',     '$15 off a $60 spend for members we have not seen in a while',   15.00, NULL, NULL, NULL, 'One use; valid 30 days from the email.', TRUE);

-- ---------- 4. How a product class encodes the child's age ----------
-- The child-stage signal in the data. AGE_AT_PURCHASE_M is the child's typical age
-- (months) when a parent buys the class; NEXT_DUE_AGE_M is when the next class in
-- the same track is typically needed. Only nappies, car seats, feeding and prams
-- carry a stage: clothing sizes vary too much and wipes are bought at every age.
CREATE OR REPLACE TABLE STAGE_CLASS_MAP (
  TRACK              VARCHAR NOT NULL,
  CATEGORY           VARCHAR NOT NULL,
  CLASS              VARCHAR NOT NULL,
  AGE_AT_PURCHASE_M  NUMBER(5,1) NOT NULL,
  CONFIDENCE         VARCHAR NOT NULL,
  NEXT_CLASS         VARCHAR,
  NEXT_DUE_AGE_M     NUMBER(5,1),
  NOTE               VARCHAR
) COMMENT = 'Product class -> typical child age at purchase and the next class due in the same track.';

INSERT INTO STAGE_CLASS_MAP VALUES
  ('NAPPY',    'Nappies & Wipes',   'Newborn Nappies',    1,  'HIGH',   'Crawler Nappies',    5,  'Newborn sizes run to about 4 months.'),
  ('NAPPY',    'Nappies & Wipes',   'Crawler Nappies',    8,  'HIGH',   'Toddler Nappies',    13, 'Crawler sizes cover roughly 6 to 12 months.'),
  ('NAPPY',    'Nappies & Wipes',   'Toddler Nappies',    18, 'HIGH',   'Pull-Ups',           26, 'Toilet training usually starts after 2.'),
  ('NAPPY',    'Nappies & Wipes',   'Pull-Ups',           32, 'HIGH',   NULL,                 NULL, 'End of the nappy track.'),
  ('CAR_SEAT', 'Car Seats',         'Capsule (0-6m)',     0,  'HIGH',   'Convertible (0-4y)', 6,  'Capsules are bought before or at birth and outgrown at about 6 months.'),
  ('CAR_SEAT', 'Car Seats',         'Convertible (0-4y)', 8,  'MEDIUM', 'Booster (4-8y)',     48, 'Bought at the capsule hand-over or for a second car.'),
  ('CAR_SEAT', 'Car Seats',         'Harness Booster',    30, 'LOW',    'Booster (4-8y)',     54, 'Wide age range.'),
  ('CAR_SEAT', 'Car Seats',         'Booster (4-8y)',     54, 'MEDIUM', NULL,                 NULL, 'End of the car seat track.'),
  ('FEEDING',  'Feeding',           'Breast Pumps',       0,  'MEDIUM', 'Bottles',            3,  'Bought before or just after birth.'),
  ('FEEDING',  'Feeding',           'Sterilisers',        1,  'MEDIUM', 'Highchairs',         6,  'Newborn feeding.'),
  ('FEEDING',  'Feeding',           'Bottles',            2,  'LOW',    'Highchairs',         6,  'Bottles are bought at many ages.'),
  ('FEEDING',  'Feeding',           'Highchairs',         6,  'MEDIUM', NULL,                 NULL, 'Starting solids.'),
  ('PRAM',     'Prams & Strollers', 'Travel System',      -2, 'MEDIUM', 'Single Stroller',    12, 'Bought before birth; a lighter stroller follows at about a year.'),
  ('PRAM',     'Prams & Strollers', 'Capsule Stroller',   0,  'MEDIUM', 'Single Stroller',    12, 'Newborn pram.'),
  ('PRAM',     'Prams & Strollers', 'Single Stroller',    12, 'LOW',    NULL,                 NULL, 'Lightweight stroller.');

-- ---------- 5. Customer features (REAL, from purchases) ----------
-- One function so the live features (as of AS_OF_DATE) and the snapshots frozen on
-- historical campaigns (as of each campaign's start) are the same calculation:
-- a model trained on snapshots and scored on today's features then sees the same
-- definitions on both sides.
CREATE OR REPLACE FUNCTION CUSTOMER_FEATURES_AT(REF_DATE DATE)
RETURNS TABLE (
  CUSTOMER_KEY NUMBER, CUSTOMER_ID VARCHAR, SEGMENT_NAME VARCHAR, PROFILE_STATE VARCHAR, AGE_BAND VARCHAR, GENDER VARCHAR,
  LOYALTY_TIER VARCHAR, HOME_STORE_KEY NUMBER, HOME_STORE_CODE VARCHAR, HOME_STORE_NAME VARCHAR, HOME_STATE VARCHAR,
  FIRST_PURCHASE_DATE DATE, LAST_PURCHASE_DATE DATE, RECENCY_DAYS NUMBER, LINES_TOTAL NUMBER, LINES_12M NUMBER,
  SPEND_TOTAL_AUD NUMBER(38,2), SPEND_12M_AUD NUMBER(38,2), MARGIN_TOTAL_AUD NUMBER(38,2), AOV_AUD NUMBER(38,2), PROMO_SHARE FLOAT,
  NAPPIES_SHARE FLOAT, FEEDING_SHARE FLOAT, CLOTHING_SHARE FLOAT, CAR_SEATS_SHARE FLOAT, PRAMS_SHARE FLOAT,
  TOP_CATEGORY VARCHAR, TOP_BRAND VARCHAR, PREFERRED_PRICE_TIER VARCHAR,
  STAGE_SOURCE_CLASS VARCHAR, STAGE_SOURCE_DATE DATE, STAGE_CONFIDENCE VARCHAR, EST_CHILD_AGE_M FLOAT, CHILD_STAGE VARCHAR,
  MULTI_CHILD_OR_GIFT BOOLEAN,
  NAPPY_LAST_CLASS VARCHAR, NAPPY_NEXT_CLASS VARCHAR, NAPPY_DUE_DATE DATE,
  CAR_SEAT_LAST_CLASS VARCHAR, CAR_SEAT_LAST_DATE DATE, CAR_SEAT_NEXT_CLASS VARCHAR, CAR_SEAT_DUE_DATE DATE,
  FEEDING_NEXT_CLASS VARCHAR, FEEDING_DUE_DATE DATE, PRAM_NO_CAR_SEAT BOOLEAN
)
AS
$$
WITH lines AS (
  SELECT tl.CUSTOMER_KEY, d.CALENDAR_DATE AS DT, tl.STORE_KEY, tl.NET_REVENUE, tl.MARGIN_AMOUNT, tl.PROMOTION_KEY,
         p.CATEGORY, p.CLASS, b.BRAND_NAME, b.PRICE_TIER
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b   ON b.BRAND_KEY = p.BRAND_KEY
  WHERE tl.CUSTOMER_KEY IS NOT NULL AND d.CALENDAR_DATE <= REF_DATE
), agg AS (
  SELECT CUSTOMER_KEY,
         MIN(DT) AS FIRST_DT, MAX(DT) AS LAST_DT, COUNT(*) AS LINES_TOTAL,
         COUNT_IF(DT > DATEADD('month', -12, REF_DATE)) AS LINES_12M,
         SUM(NET_REVENUE) AS SPEND_TOTAL, SUM(IFF(DT > DATEADD('month', -12, REF_DATE), NET_REVENUE, 0)) AS SPEND_12M,
         SUM(MARGIN_AMOUNT) AS MARGIN_TOTAL, AVG(NET_REVENUE) AS AOV,
         COUNT_IF(PROMOTION_KEY IS NOT NULL) / COUNT(*) AS PROMO_SHARE,
         SUM(IFF(CATEGORY = 'Nappies & Wipes', NET_REVENUE, 0)) / NULLIF(SUM(NET_REVENUE), 0) AS NAPPIES_SHARE,
         SUM(IFF(CATEGORY = 'Feeding', NET_REVENUE, 0)) / NULLIF(SUM(NET_REVENUE), 0) AS FEEDING_SHARE,
         SUM(IFF(CATEGORY = 'Clothing', NET_REVENUE, 0)) / NULLIF(SUM(NET_REVENUE), 0) AS CLOTHING_SHARE,
         SUM(IFF(CATEGORY = 'Car Seats', NET_REVENUE, 0)) / NULLIF(SUM(NET_REVENUE), 0) AS CAR_SEATS_SHARE,
         SUM(IFF(CATEGORY = 'Prams & Strollers', NET_REVENUE, 0)) / NULLIF(SUM(NET_REVENUE), 0) AS PRAMS_SHARE,
         COUNT_IF(CATEGORY = 'Prams & Strollers' AND CLASS IN ('Travel System', 'Capsule Stroller')) > 0
           AND COUNT_IF(CATEGORY = 'Car Seats') = 0 AS PRAM_NO_CAR_SEAT
  FROM lines GROUP BY CUSTOMER_KEY
), home AS (
  -- The store a customer buys from most often; ties go to the most recent visit.
  SELECT CUSTOMER_KEY, STORE_KEY FROM (
    SELECT CUSTOMER_KEY, STORE_KEY, COUNT(*) AS N, MAX(DT) AS LAST_DT FROM lines GROUP BY 1, 2)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_KEY ORDER BY N DESC, LAST_DT DESC, STORE_KEY) = 1
), top_cat AS (
  SELECT CUSTOMER_KEY, CATEGORY FROM (SELECT CUSTOMER_KEY, CATEGORY, SUM(NET_REVENUE) AS R FROM lines GROUP BY 1, 2)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_KEY ORDER BY R DESC, CATEGORY) = 1
), top_brand AS (
  SELECT CUSTOMER_KEY, BRAND_NAME, PRICE_TIER FROM (SELECT CUSTOMER_KEY, BRAND_NAME, PRICE_TIER, SUM(NET_REVENUE) AS R FROM lines GROUP BY 1, 2, 3)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_KEY ORDER BY R DESC, BRAND_NAME) = 1
), staged AS (
  -- Every stage-coded purchase with the birth date it implies.
  SELECT l.CUSTOMER_KEY, l.DT, l.CLASS, m.TRACK, m.CONFIDENCE, m.AGE_AT_PURCHASE_M, m.NEXT_CLASS, m.NEXT_DUE_AGE_M,
         DATEADD('day', -ROUND(m.AGE_AT_PURCHASE_M * 30.44), l.DT) AS IMPLIED_BIRTH
  FROM lines l JOIN BABY_MART_DEMO.CAMPAIGN.STAGE_CLASS_MAP m ON m.CATEGORY = l.CATEGORY AND m.CLASS = l.CLASS
), stage AS (
  -- The child's stage comes from the most recent confident signal; a LOW one is
  -- used only when nothing better exists.
  SELECT CUSTOMER_KEY, CLASS, DT, CONFIDENCE, AGE_AT_PURCHASE_M FROM staged
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_KEY
                             ORDER BY IFF(CONFIDENCE = 'LOW', 1, 0), DT DESC, CLASS) = 1
), multi AS (
  -- Two confident nappy signals within six months that imply births over a year
  -- apart: two children in nappies, or a gift buyer.
  SELECT a.CUSTOMER_KEY
  FROM staged a JOIN staged b2 ON b2.CUSTOMER_KEY = a.CUSTOMER_KEY AND b2.TRACK = 'NAPPY' AND a.TRACK = 'NAPPY'
   AND a.CONFIDENCE = 'HIGH' AND b2.CONFIDENCE = 'HIGH'
   AND ABS(DATEDIFF('day', a.DT, b2.DT)) <= 183 AND DATEDIFF('day', a.IMPLIED_BIRTH, b2.IMPLIED_BIRTH) > 365
  GROUP BY a.CUSTOMER_KEY
), track_last AS (
  SELECT CUSTOMER_KEY, TRACK, CLASS, DT, NEXT_CLASS,
         IFF(NEXT_DUE_AGE_M IS NULL, NULL, DATEADD('day', ROUND(NEXT_DUE_AGE_M * 30.44), IMPLIED_BIRTH)) AS DUE_DATE
  FROM staged
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_KEY, TRACK ORDER BY DT DESC, CLASS) = 1
)
SELECT c.CUSTOMER_KEY, c.CUSTOMER_ID, cs.SEGMENT_NAME, c.STATE, c.AGE_BAND, c.GENDER, c.LOYALTY_TIER,
       h.STORE_KEY, s.STORE_CODE, s.STORE_NAME, s.STATE,
       a.FIRST_DT, a.LAST_DT, DATEDIFF('day', a.LAST_DT, REF_DATE)::NUMBER, a.LINES_TOTAL::NUMBER, a.LINES_12M::NUMBER,
       a.SPEND_TOTAL::NUMBER(38,2), a.SPEND_12M::NUMBER(38,2), a.MARGIN_TOTAL::NUMBER(38,2), a.AOV::NUMBER(38,2), a.PROMO_SHARE::FLOAT,
       a.NAPPIES_SHARE::FLOAT, a.FEEDING_SHARE::FLOAT, a.CLOTHING_SHARE::FLOAT, a.CAR_SEATS_SHARE::FLOAT, a.PRAMS_SHARE::FLOAT,
       tc.CATEGORY, tb.BRAND_NAME, tb.PRICE_TIER,
       st.CLASS, st.DT, st.CONFIDENCE,
       IFF(st.CLASS IS NULL, NULL, st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44)::FLOAT,
       CASE
         WHEN st.CLASS IS NULL THEN IFF(cs.SEGMENT_NAME = 'Expecting', 'EXPECTING', 'UNKNOWN')
         WHEN st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44 < 0  THEN 'EXPECTING'
         WHEN st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44 < 3  THEN 'NEWBORN_0_3M'
         WHEN st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44 < 12 THEN 'INFANT_3_12M'
         WHEN st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44 < 36 THEN 'TODDLER_1_3Y'
         WHEN st.AGE_AT_PURCHASE_M + DATEDIFF('day', st.DT, REF_DATE) / 30.44 < 60 THEN 'PRESCHOOL_3_5Y'
         ELSE 'SCHOOL_5_PLUS'
       END,
       mu.CUSTOMER_KEY IS NOT NULL,
       tn.CLASS, tn.NEXT_CLASS, tn.DUE_DATE,
       tcs.CLASS, tcs.DT, tcs.NEXT_CLASS, tcs.DUE_DATE,
       tf.NEXT_CLASS, tf.DUE_DATE,
       COALESCE(a.PRAM_NO_CAR_SEAT, FALSE)
FROM BABY_MART_DEMO.CURATED.DIM_CUSTOMER c
JOIN BABY_MART_DEMO.CURATED.DIM_CUSTOMER_SEGMENT cs ON cs.SEGMENT_KEY = c.SEGMENT_KEY
LEFT JOIN agg a        ON a.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN home h       ON h.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN BABY_MART_DEMO.CURATED.DIM_STORE s ON s.STORE_KEY = h.STORE_KEY
LEFT JOIN top_cat tc   ON tc.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN top_brand tb ON tb.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN stage st     ON st.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN multi mu     ON mu.CUSTOMER_KEY = c.CUSTOMER_KEY
LEFT JOIN track_last tn  ON tn.CUSTOMER_KEY = c.CUSTOMER_KEY AND tn.TRACK = 'NAPPY'
LEFT JOIN track_last tcs ON tcs.CUSTOMER_KEY = c.CUSTOMER_KEY AND tcs.TRACK = 'CAR_SEAT'
LEFT JOIN track_last tf  ON tf.CUSTOMER_KEY = c.CUSTOMER_KEY AND tf.TRACK = 'FEEDING'
$$;

-- The live features, as of the demo clock, plus RFM scores over customers who
-- have bought at all. A customer with no purchases keeps their profile and scores
-- NULL rather than a misleading 1.
CREATE OR REPLACE TABLE CUSTOMER_FEATURES
  COMMENT = 'One row per customer as of AS_OF_DATE. Purchase-derived columns are REAL; profile columns are GENERATED.'
AS
WITH f AS (SELECT * FROM TABLE(CUSTOMER_FEATURES_AT(CMP_AS_OF()))),
scored AS (
  SELECT f.*,
         IFF(LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY LAST_PURCHASE_DATE IS NULL ORDER BY RECENCY_DAYS DESC, CUSTOMER_KEY)) AS R_SCORE,
         IFF(LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY LAST_PURCHASE_DATE IS NULL ORDER BY LINES_12M, LINES_TOTAL, CUSTOMER_KEY)) AS F_SCORE,
         IFF(LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY LAST_PURCHASE_DATE IS NULL ORDER BY SPEND_12M_AUD, SPEND_TOTAL_AUD, CUSTOMER_KEY)) AS M_SCORE
  FROM f
)
SELECT s.*,
       RFM_LABEL(R_SCORE, F_SCORE, M_SCORE) AS RFM_SEGMENT,
       RECENCY_BAND(RECENCY_DAYS)           AS RECENCY_BAND,
       DUE_STATUS(CAR_SEAT_DUE_DATE) AS CAR_SEAT_DUE_STATUS,
       DUE_STATUS(NAPPY_DUE_DATE)    AS NAPPY_DUE_STATUS,
       DUE_STATUS(FEEDING_DUE_DATE)  AS FEEDING_DUE_STATUS
FROM scored s;

-- ---------- 6. Consent and contactability (MODELLED) ----------
-- No source holds consent, so it is modelled: higher tiers opt in more and app
-- users skew to recent, higher-tier customers. Draws are HASH-based, not RANDOM().
CREATE OR REPLACE TABLE CUSTOMER_CONTACT
  COMMENT = 'MODELLED consent and channel preference per customer. HASHED_ID stands in for a hashed email in paid-social matching.'
AS
WITH u AS (
  SELECT f.CUSTOMER_KEY, f.CUSTOMER_ID, f.LOYALTY_TIER, f.RECENCY_DAYS,
         (ABS(HASH(f.CUSTOMER_KEY, 'email')) % 100000) / 100000.0 AS U_EMAIL,
         (ABS(HASH(f.CUSTOMER_KEY, 'sms'))   % 100000) / 100000.0 AS U_SMS,
         (ABS(HASH(f.CUSTOMER_KEY, 'push'))  % 100000) / 100000.0 AS U_PUSH,
         (ABS(HASH(f.CUSTOMER_KEY, 'pref'))  % 100000) / 100000.0 AS U_PREF,
         DECODE(f.LOYALTY_TIER, 'Platinum', 0.20, 'Gold', 0.15, 'Silver', 0.08, 0.0) AS TIER_BONUS
  FROM CUSTOMER_FEATURES f
), c AS (
  SELECT CUSTOMER_KEY, CUSTOMER_ID,
         U_EMAIL < 0.64 + TIER_BONUS                                                AS EMAIL_OPT_IN,
         U_SMS   < 0.34 + TIER_BONUS * 0.75                                         AS SMS_OPT_IN,
         U_PUSH  < 0.20 + TIER_BONUS * 1.2 + IFF(COALESCE(RECENCY_DAYS, 999) <= 180, 0.08, 0)  AS PUSH_ENABLED,
         U_PREF
  FROM u
)
SELECT CUSTOMER_KEY, CUSTOMER_ID, EMAIL_OPT_IN, SMS_OPT_IN, PUSH_ENABLED,
       CASE WHEN PUSH_ENABLED AND U_PREF < 0.35 THEN 'PUSH'
            WHEN SMS_OPT_IN AND U_PREF < 0.60 THEN 'SMS'
            WHEN EMAIL_OPT_IN THEN 'EMAIL'
            WHEN SMS_OPT_IN THEN 'SMS'
            WHEN PUSH_ENABLED THEN 'PUSH'
            ELSE 'NONE' END AS PREFERRED_CHANNEL,
       EMAIL_OPT_IN OR SMS_OPT_IN OR PUSH_ENABLED AS IS_CONTACTABLE,
       SHA2(CUSTOMER_ID || '|babymart', 256) AS HASHED_ID,
       'MODELLED' AS PROVENANCE
FROM c;

-- ---------- 7. Supply position by brand and store (MODELLED) ----------
-- From the seeded STOCK_ALERTS, spread to stores so a campaign can be checked
-- against what the shopper's own store can actually sell. Rascal + Friends is
-- short across most NSW stores: the crawler-nappy campaign storyline depends on it.
CREATE OR REPLACE TABLE SUPPLY_POSITION
  COMMENT = 'MODELLED availability of a brand at a store, derived from ANALYTICS.STOCK_ALERTS. SHORT means the promoted range cannot be sold there.'
AS
WITH rules AS (
  SELECT * FROM VALUES
    ('Rascal + Friends', 'ALT-001', 'NSW', 0.80, 'SHORT', 'LOW',  '2026-04-20'::DATE, '2026-06-15'::DATE, 'Demand outpacing supply; stockout risk in 18 days without an emergency order.'),
    ('Uppababy',         'ALT-002', NULL,  0.40, 'SHORT', 'LOW',  '2026-04-25'::DATE, '2026-06-30'::DATE, 'Two weeks of cover against a four-week minimum.'),
    ('Dr Browns',        'ALT-003', NULL,  0.00, 'LOW',   'LOW',  '2026-05-01'::DATE, '2026-06-09'::DATE, 'Delivery delayed seven days by port congestion.'),
    ('Bonds Baby',       'ALT-004', NULL,  0.00, 'LOW',   'LOW',  '2026-05-01'::DATE, '2026-06-15'::DATE, 'Winter demand 14% above forecast.'),
    ('Bugaboo',          'ALT-005', NULL,  0.00, 'OVER',  'OVER', '2026-03-01'::DATE, '2026-08-31'::DATE, '18.3 weeks of cover against an 8-week target; $61K tied up.'),
    ('Maxi-Cosi',        'ALT-006', NULL,  0.25, 'LOW',   'OK',   '2026-04-15'::DATE, '2026-06-30'::DATE, 'Supplier DIFOT down from 96.2% to 91.8%.')
  AS t(BRAND_NAME, ALERT_ID, STATE_FOCUS, SHARE, STATUS_IN, STATUS_OUT, VALID_FROM, VALID_TO, REASON)
)
SELECT r.BRAND_NAME, s.STORE_CODE, s.STORE_NAME, s.STATE,
       IFF((r.STATE_FOCUS IS NULL OR s.STATE = r.STATE_FOCUS)
           AND (ABS(HASH(r.BRAND_NAME, s.STORE_CODE, 'supply')) % 1000) / 1000.0 < IFF(r.SHARE = 0, 1, r.SHARE),
           r.STATUS_IN, r.STATUS_OUT)                               AS STATUS,
       r.ALERT_ID, r.VALID_FROM, r.VALID_TO, r.REASON, 'MODELLED' AS PROVENANCE
FROM rules r CROSS JOIN BABY_MART_DEMO.CURATED.DIM_STORE s;

-- ---------- 8. Next best product (REAL rules) ----------
-- Each customer's next stage-due class, with the best-selling product in it at
-- their preferred price tier -- skipping brands their home store cannot supply.
-- Replaces the 41 hand-typed rows of ANALYTICS.ML_PRODUCT_RECOMMENDATIONS.
CREATE OR REPLACE TABLE NEXT_BEST_PRODUCT
  COMMENT = 'Per customer and track: the next stage-due class and the product to lead with. Built from REAL sales and the stage map.'
AS
WITH sellers AS (
  -- Best sellers in the six months to the demo clock, by class and price tier.
  SELECT p.CATEGORY, p.CLASS, b.PRICE_TIER, b.BRAND_NAME, p.PRODUCT_KEY, p.SKU_CODE, p.PRODUCT_NAME, p.UNIT_RETAIL,
         SUM(tl.QUANTITY) AS UNITS_6M
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN BABY_MART_DEMO.CURATED.DIM_DATE d    ON d.DATE_KEY = tl.DATE_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  JOIN BABY_MART_DEMO.CURATED.DIM_BRAND b   ON b.BRAND_KEY = p.BRAND_KEY
  WHERE d.CALENDAR_DATE > DATEADD('month', -6, CMP_AS_OF())
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
), due AS (
  SELECT CUSTOMER_KEY, 'CAR_SEAT' AS TRACK, CAR_SEAT_NEXT_CLASS AS NEXT_CLASS, CAR_SEAT_DUE_DATE AS DUE_DATE, CAR_SEAT_DUE_STATUS AS DUE_STATUS, PREFERRED_PRICE_TIER, HOME_STORE_CODE
  FROM CUSTOMER_FEATURES WHERE CAR_SEAT_NEXT_CLASS IS NOT NULL AND CAR_SEAT_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON')
  UNION ALL
  SELECT CUSTOMER_KEY, 'NAPPY', NAPPY_NEXT_CLASS, NAPPY_DUE_DATE, NAPPY_DUE_STATUS, PREFERRED_PRICE_TIER, HOME_STORE_CODE
  FROM CUSTOMER_FEATURES WHERE NAPPY_NEXT_CLASS IS NOT NULL AND NAPPY_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON')
  UNION ALL
  SELECT CUSTOMER_KEY, 'FEEDING', FEEDING_NEXT_CLASS, FEEDING_DUE_DATE, FEEDING_DUE_STATUS, PREFERRED_PRICE_TIER, HOME_STORE_CODE
  FROM CUSTOMER_FEATURES WHERE FEEDING_NEXT_CLASS IS NOT NULL AND FEEDING_DUE_STATUS IN ('DUE_NOW', 'DUE_SOON')
  UNION ALL
  SELECT CUSTOMER_KEY, 'GAP', 'Capsule (0-6m)', NULL, 'GAP', PREFERRED_PRICE_TIER, HOME_STORE_CODE
  FROM CUSTOMER_FEATURES WHERE PRAM_NO_CAR_SEAT
), ranked AS (
  SELECT u.CUSTOMER_KEY, u.TRACK, u.NEXT_CLASS, u.DUE_DATE, u.DUE_STATUS, s.CATEGORY, s.BRAND_NAME, s.PRODUCT_KEY, s.SKU_CODE,
         s.PRODUCT_NAME, s.UNIT_RETAIL, s.PRICE_TIER,
         ROW_NUMBER() OVER (PARTITION BY u.CUSTOMER_KEY, u.TRACK
                            ORDER BY IFF(s.PRICE_TIER = u.PREFERRED_PRICE_TIER, 0, 1), s.UNITS_6M DESC, s.PRODUCT_KEY) AS RN
  FROM due u
  JOIN STAGE_CLASS_MAP m ON m.CLASS = u.NEXT_CLASS
  JOIN sellers s ON s.CLASS = u.NEXT_CLASS AND s.CATEGORY = m.CATEGORY
  LEFT JOIN SUPPLY_POSITION sp ON sp.BRAND_NAME = s.BRAND_NAME AND sp.STORE_CODE = u.HOME_STORE_CODE AND sp.STATUS = 'SHORT'
  WHERE sp.BRAND_NAME IS NULL
)
SELECT CUSTOMER_KEY, TRACK, NEXT_CLASS, DUE_DATE, DUE_STATUS, CATEGORY, BRAND_NAME, PRODUCT_KEY, SKU_CODE, PRODUCT_NAME, UNIT_RETAIL, PRICE_TIER,
       CASE TRACK
         WHEN 'GAP' THEN 'Bought a pram but no car seat'
         ELSE 'Next ' || LOWER(TRACK) || ' stage due ' || TO_CHAR(DUE_DATE, 'DD Mon YYYY')
       END AS REASON
FROM ranked WHERE RN = 1;

-- ---------- 9. The campaign model (tables the app reads and writes) ----------
CREATE OR REPLACE TABLE CAMPAIGN (
  CAMPAIGN_ID          VARCHAR PRIMARY KEY,
  NAME                 VARCHAR NOT NULL,
  OBJECTIVE            VARCHAR,
  HYPOTHESIS           VARCHAR,
  STATUS               VARCHAR NOT NULL,
  IDEA_ID              VARCHAR,
  AUDIENCE_ID          VARCHAR,
  PROMOTED_CATEGORY    VARCHAR,
  PROMOTED_CLASS       VARCHAR,
  PROMOTED_BRAND       VARCHAR,
  OFFER_ID             VARCHAR,
  CHANNELS             ARRAY,
  BUDGET_AUD           NUMBER(12,2) DEFAULT 0,
  START_DATE           DATE,
  END_DATE             DATE,
  HOLDOUT_PCT          NUMBER(5,2) DEFAULT 10,
  DESTINATION          VARCHAR DEFAULT 'Braze',
  PRIMARY_KPI          VARCHAR DEFAULT 'INCREMENTAL_CONVERSIONS',
  SIMULATED_THROUGH    DATE,
  PROVENANCE           VARCHAR NOT NULL,
  LEGACY_AUDIENCE_LABEL VARCHAR,
  CREATED_BY           VARCHAR NOT NULL,
  CREATED_AT           TIMESTAMP_NTZ NOT NULL,
  UPDATED_BY           VARCHAR,
  UPDATED_AT           TIMESTAMP_NTZ
) COMMENT = 'A campaign and where it is in its lifecycle: IDEA, BRIEF, AUDIENCE_LOCKED, CONTENT_APPROVED, SCHEDULED, LIVE, PAUSED, COMPLETED, MEASURED, CANCELLED.';

CREATE OR REPLACE TABLE CAMPAIGN_STATUS_LOG (
  CAMPAIGN_ID  VARCHAR NOT NULL,
  FROM_STATUS  VARCHAR,
  TO_STATUS    VARCHAR NOT NULL,
  REASON       VARCHAR,
  CHANGED_BY   VARCHAR NOT NULL,
  CHANGED_AT   TIMESTAMP_NTZ NOT NULL
) COMMENT = 'Every lifecycle transition, who made it and why.';

CREATE OR REPLACE TABLE IDEA (
  IDEA_ID               VARCHAR PRIMARY KEY,
  RUN_ID                VARCHAR,
  TITLE                 VARCHAR NOT NULL,
  SIGNAL_TYPE           VARCHAR,
  HYPOTHESIS            VARCHAR,
  TARGET_DESCRIPTION    VARCHAR,
  AUDIENCE_SPEC         VARIANT,
  AUDIENCE_SIZE         NUMBER,
  REACHABLE_SIZE        NUMBER,
  EST_INC_REVENUE_LOW   NUMBER(12,2),
  EST_INC_REVENUE_HIGH  NUMBER(12,2),
  SUGGESTED_CHANNELS    ARRAY,
  SUGGESTED_OFFER_ID    VARCHAR,
  PROMOTED_CATEGORY     VARCHAR,
  PROMOTED_CLASS        VARCHAR,
  PROMOTED_BRAND        VARCHAR,
  EVIDENCE              VARIANT,
  GUARDRAILS            VARIANT,
  PRIORITY              VARCHAR,
  STATUS                VARCHAR NOT NULL,
  DECISION_REASON       VARCHAR,
  DECIDED_BY            VARCHAR,
  DECIDED_AT            TIMESTAMP_NTZ,
  CAMPAIGN_ID           VARCHAR,
  IS_VERIFIED           BOOLEAN,
  CREATED_BY            VARCHAR NOT NULL,
  CREATED_AT            TIMESTAMP_NTZ NOT NULL
) COMMENT = 'Campaign ideas from the ideation board: NEW, ACCEPTED, REJECTED or BLOCKED by a guardrail.';

CREATE OR REPLACE TABLE AUDIENCE (
  AUDIENCE_ID        VARCHAR PRIMARY KEY,
  NAME               VARCHAR NOT NULL,
  DESCRIPTION        VARCHAR,
  SPEC               VARIANT NOT NULL,
  SPEC_HASH          VARCHAR NOT NULL,
  VERSION            NUMBER DEFAULT 1,
  SOURCE             VARCHAR NOT NULL,
  SIZE_AT_SAVE       NUMBER,
  REACHABLE_AT_SAVE  NUMBER,
  STATUS             VARCHAR NOT NULL,
  CAMPAIGN_ID        VARCHAR,
  CREATED_BY         VARCHAR NOT NULL,
  CREATED_AT         TIMESTAMP_NTZ NOT NULL,
  LOCKED_BY          VARCHAR,
  LOCKED_AT          TIMESTAMP_NTZ
) COMMENT = 'Saved audience definitions. SPEC is the validated filter spec; it compiles to bound SQL, never free text.';

-- A locked audience, frozen with the features each member had on the snapshot
-- date, so a later campaign's lift is measured against the audience as it was.
CREATE OR REPLACE TABLE AUDIENCE_MEMBER (
  CAMPAIGN_ID        VARCHAR NOT NULL,
  AUDIENCE_ID        VARCHAR NOT NULL,
  CUSTOMER_KEY       NUMBER NOT NULL,
  GROUP_CODE         VARCHAR NOT NULL,
  CHANNEL_CODE       VARCHAR,
  VARIANT_CODE       VARCHAR,
  SNAPSHOT_DATE      DATE NOT NULL,
  SEGMENT_NAME       VARCHAR,
  LOYALTY_TIER       VARCHAR,
  PROFILE_STATE      VARCHAR,
  HOME_STORE_CODE    VARCHAR,
  HOME_STATE         VARCHAR,
  RECENCY_DAYS       NUMBER,
  RECENCY_BAND       VARCHAR,
  LINES_12M          NUMBER,
  SPEND_12M_AUD      NUMBER(14,2),
  AOV_AUD            NUMBER(12,2),
  PROMO_SHARE        FLOAT,
  CHILD_STAGE        VARCHAR,
  RFM_SEGMENT        VARCHAR,
  NEG_VOICE_120D     NUMBER,
  NEG_THEME          VARCHAR,
  IS_RELEVANT        BOOLEAN,
  STOCK_CONFLICT     BOOLEAN,
  UPLIFT_QUADRANT    VARCHAR,
  P_TREAT            FLOAT,
  P_CONTROL          FLOAT,
  SUPPRESSED_AT      DATE,
  SUPPRESS_REASON    VARCHAR
) COMMENT = 'Members of a locked audience: TREATED or HOLDOUT, the channel and variant they get, and their features on the snapshot date. A TREATED member suppressed mid-flight stays TREATED for measurement (intent to treat).';

CREATE OR REPLACE TABLE CONTENT_VARIANT (
  VARIANT_ID     VARCHAR PRIMARY KEY,
  CAMPAIGN_ID    VARCHAR NOT NULL,
  VARIANT_CODE   VARCHAR NOT NULL,
  ANGLE          VARCHAR,
  SUBJECT        VARCHAR,
  PREHEADER      VARCHAR,
  BODY           VARCHAR,
  SMS_TEXT       VARCHAR,
  PUSH_TITLE     VARCHAR,
  PUSH_BODY      VARCHAR,
  SOCIAL_TEXT    VARCHAR,
  INSTORE_TEXT   VARCHAR,
  CTA            VARCHAR,
  PRODUCTS       VARIANT,
  PERSONALISATION VARIANT,
  QA             VARIANT,
  QA_STATUS      VARCHAR,
  STATUS         VARCHAR NOT NULL,
  AI_RUN_ID      VARCHAR,
  APPROVED_BY    VARCHAR,
  APPROVED_AT    TIMESTAMP_NTZ,
  CREATED_BY     VARCHAR NOT NULL,
  CREATED_AT     TIMESTAMP_NTZ NOT NULL,
  UPDATED_BY     VARCHAR,
  UPDATED_AT     TIMESTAMP_NTZ
) COMMENT = 'Creative variants (A/B) for every channel, their QA scorecard and approval.';

CREATE OR REPLACE TABLE CHANNEL_PLAN (
  CAMPAIGN_ID              VARCHAR NOT NULL,
  CHANNEL_CODE             VARCHAR NOT NULL,
  MEMBERS                  NUMBER NOT NULL,
  COST_AUD                 NUMBER(12,2),
  EXP_INC_CONV             NUMBER(12,2),
  EXP_INC_MARGIN_AUD       NUMBER(12,2),
  SEND_DAY                 VARCHAR,
  SEND_HOUR                NUMBER,
  RATIONALE                VARCHAR,
  CREATED_BY               VARCHAR NOT NULL,
  CREATED_AT               TIMESTAMP_NTZ NOT NULL
) COMMENT = 'The approved channel plan for a campaign: members per channel, cost and expected incremental return.';

CREATE OR REPLACE TABLE CAMPAIGN_EVENT (
  CAMPAIGN_ID      VARCHAR NOT NULL,
  CUSTOMER_KEY     NUMBER NOT NULL,
  GROUP_CODE       VARCHAR NOT NULL,
  CHANNEL_CODE     VARCHAR,
  VARIANT_CODE     VARCHAR,
  EVENT_TYPE       VARCHAR NOT NULL,
  EVENT_DATE       DATE NOT NULL,
  ORDER_VALUE_AUD  NUMBER(12,2),
  MARGIN_AUD       NUMBER(12,2),
  OFFER_COST_AUD   NUMBER(12,2),
  SEND_COST_AUD    NUMBER(12,4),
  PROVENANCE       VARCHAR NOT NULL
) COMMENT = 'SEND, DELIVER, BOUNCE, OPEN, CLICK, CONVERT, UNSUBSCRIBE, COMPLAINT, REPLY. Holdout members only ever CONVERT: the organic purchase the campaign is measured against.';

CREATE OR REPLACE TABLE LEARNING (
  LEARNING_ID      VARCHAR PRIMARY KEY,
  CAMPAIGN_ID      VARCHAR NOT NULL,
  DIMENSION        VARCHAR NOT NULL,
  DIMENSION_VALUE  VARCHAR NOT NULL,
  TREATED_N        NUMBER,
  HOLDOUT_N        NUMBER,
  TREATED_RATE     FLOAT,
  HOLDOUT_RATE     FLOAT,
  LIFT_PP          FLOAT,
  CI_LOW_PP        FLOAT,
  CI_HIGH_PP       FLOAT,
  IS_SIGNIFICANT   BOOLEAN,
  INC_REVENUE_AUD  NUMBER(12,2),
  STATEMENT        VARCHAR NOT NULL,
  STATUS           VARCHAR NOT NULL,
  PUBLISHED_BY     VARCHAR NOT NULL,
  PUBLISHED_AT     TIMESTAMP_NTZ NOT NULL
) COMMENT = 'What a measured campaign taught us, published for the ideation, audience and channel stages to reuse.';

CREATE OR REPLACE TABLE ALERT_LOG (
  ALERT_ID            VARCHAR PRIMARY KEY,
  CAMPAIGN_ID         VARCHAR NOT NULL,
  ALERT_CODE          VARCHAR NOT NULL,
  SEVERITY            VARCHAR NOT NULL,
  MESSAGE             VARCHAR NOT NULL,
  RECOMMENDED_ACTION  VARCHAR,
  STATUS              VARCHAR NOT NULL,
  ACTION_TAKEN        VARCHAR,
  ACTIONED_BY         VARCHAR,
  ACTIONED_AT         TIMESTAMP_NTZ,
  RAISED_AT           TIMESTAMP_NTZ NOT NULL
) COMMENT = 'Monitoring alerts a person acted on or dismissed. Open alerts are computed live by VW_CAMPAIGN_ALERTS.';

CREATE OR REPLACE TABLE AI_RUN (
  RUN_ID              VARCHAR PRIMARY KEY,
  STAGE               VARCHAR NOT NULL,
  CAMPAIGN_ID         VARCHAR,
  TEMPLATE_KEY        VARCHAR,
  MODEL               VARCHAR,
  QUESTION            VARCHAR,
  GROUNDING_PAYLOAD   VARIANT,
  PROMPT_CHARS        NUMBER,
  RESPONSE            VARIANT,
  FIGURES_CITED       VARIANT,
  UNVERIFIED_FIGURES  VARIANT,
  IS_VERIFIED         BOOLEAN,
  PROMPT_TOKENS       NUMBER,
  COMPLETION_TOKENS   NUMBER,
  TOTAL_TOKENS        NUMBER,
  ERROR_MESSAGE       VARCHAR,
  GENERATED_BY        VARCHAR NOT NULL,
  GENERATED_AT        TIMESTAMP_NTZ NOT NULL
) COMMENT = 'Every AI call the campaign persona makes -- ideas, audience requests, copy, QA, insights -- verified or not, including failures.';

-- ---------- 10. Campaigns created in the old app ----------
-- The four seeded campaigns are rebuilt with full history in sql/43. Anything a
-- user created through the old Campaigns page is carried across as a BRIEF so it
-- is not lost; it has no audience yet.
INSERT INTO CAMPAIGN (CAMPAIGN_ID, NAME, STATUS, CHANNELS, BUDGET_AUD, START_DATE, END_DATE, DESTINATION, PROVENANCE,
                      LEGACY_AUDIENCE_LABEL, CREATED_BY, CREATED_AT)
SELECT o.CAMPAIGN_ID, o.NAME, 'BRIEF',
       CASE o.CHANNEL WHEN 'Email + SMS' THEN ARRAY_CONSTRUCT('EMAIL', 'SMS') WHEN 'SMS' THEN ARRAY_CONSTRUCT('SMS')
                      WHEN 'App Push' THEN ARRAY_CONSTRUCT('PUSH') ELSE ARRAY_CONSTRUCT('EMAIL') END,
       COALESCE(o.BUDGET, 0), o.START_DATE, o.END_DATE, COALESCE(o.DESTINATION, 'Braze'), 'USER',
       o.AUDIENCE, 'migrated', COALESCE(o.CREATED_AT, '2026-05-07 09:00:00'::TIMESTAMP_NTZ)
FROM BABY_MART_DEMO.ANALYTICS.CAMPAIGNS o
WHERE o.CAMPAIGN_ID NOT IN ('camp-001', 'camp-002', 'camp-003', 'camp-004');

INSERT INTO CAMPAIGN_STATUS_LOG (CAMPAIGN_ID, FROM_STATUS, TO_STATUS, REASON, CHANGED_BY, CHANGED_AT)
SELECT CAMPAIGN_ID, NULL, 'BRIEF', 'Carried over from the previous Campaigns page; build an audience to continue.', 'migrated', CREATED_AT
FROM CAMPAIGN WHERE PROVENANCE = 'USER';
