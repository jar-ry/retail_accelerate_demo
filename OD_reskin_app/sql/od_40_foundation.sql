-- ============================================================
-- OneDigital Campaign Manager — foundation (od_40)
--
-- Officeworks' campaign persona, fed by what OnePass members buy at Bunnings and
-- Kmart as well as at Officeworks. Its own schema, ONEDIGITAL_DEMO.CAMPAIGN.
--
-- PROVENANCE, stated once here and carried to every surface:
--   SYNTHETIC  every purchase, store and product (od_10). The features below are
--              computed from those purchases exactly as they would be from real
--              ones; nothing reads the construction truth.
--   GENERATED  the member profile (segment, membership, age band).
--   MODELLED   consent, including OnePass group data-sharing consent, stock
--              position, and campaign responses (od_43).
--   SIMULATED  results of a campaign launched in the app (od_43's simulator).
--
-- THE TWO SIGNALS this persona is built around:
--   Bunnings -> Officeworks  a cluster of trade tools, ladders, storage, PPE and
--     consumables bought within 90 days by someone with no trade buying before
--     it: a business being set up. BIZ_STARTER_SCORE / BIZ_STARTER_FLAG. Fresh
--     for about four months; after that the member is an established tradie.
--   Kmart -> Officeworks  kids' shoe sizes and school items suggest school-age
--     children. Sizes are an IMPERFECT proxy: a size spans about a year of age,
--     a child growing through sizes can look like two, and a gift looks like a
--     child. SCHOOL_SIGNAL_CONFIDENCE says how much to trust it; school items
--     (uniforms, lunchboxes, bags) are what make it HIGH. Combined with
--     DAYS_TO_SCHOOL_START from each state's Term 1 date.
-- Using either signal for Officeworks marketing needs the member's OnePass
-- group data-sharing consent (GROUP_DATA_CONSENT); the audience compiler adds
-- that rule itself whenever a Bunnings or Kmart field is in the spec.
--
-- THE DEMO CLOCK. Purchases end on 13 Nov 2026: "today" is AS_OF_DATE, never
-- CURRENT_DATE(). Draws are HASH-based, never RANDOM().
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE OD_WH;

CREATE SCHEMA IF NOT EXISTS ONEDIGITAL_DEMO.CAMPAIGN
  COMMENT = 'OneDigital Campaign Manager for Officeworks: ideation, audiences, content and channels, measurement. AUD.';
USE SCHEMA ONEDIGITAL_DEMO.CAMPAIGN;

-- ---------- 1. Settings ----------
CREATE OR REPLACE TABLE CMP_SETTING (
  SETTING_KEY    VARCHAR PRIMARY KEY,
  SETTING_VALUE  VARCHAR NOT NULL,
  DATA_TYPE      VARCHAR NOT NULL,
  LABEL          VARCHAR NOT NULL,
  DESCRIPTION    VARCHAR,
  UPDATED_BY     VARCHAR DEFAULT 'seed',
  UPDATED_AT     TIMESTAMP_NTZ DEFAULT '2026-11-13 09:00:00'::TIMESTAMP_NTZ
) COMMENT = 'Operator settings for the campaign persona. AS_OF_DATE is the demo clock.';

INSERT INTO CMP_SETTING (SETTING_KEY, SETTING_VALUE, DATA_TYPE, LABEL, DESCRIPTION) VALUES
  ('AS_OF_DATE',          '2026-11-13', 'DATE',   'As-of date',                    'Demo clock: the last day of purchase data. Recency, signal windows, school timing and campaign windows are measured from here.'),
  ('HOLDOUT_PCT',         '10',         'NUMBER', 'Holdout share (%)',             'Share of a locked audience held back from contact so incremental lift can be measured.'),
  ('FATIGUE_DAYS',        '14',         'NUMBER', 'Fatigue window (days)',         'A customer contacted by another campaign inside this window is suppressed by default.'),
  ('MAX_CONTACTS_30D',    '3',          'NUMBER', 'Max contacts per 30 days',      'Frequency cap across all campaigns.'),
  ('BOUNCE_ALERT_PCT',    '3',          'NUMBER', 'Bounce alert (%)',              'Raise a deliverability alert above this bounce rate.'),
  ('UNSUB_ALERT_PCT',     '0.8',        'NUMBER', 'Unsubscribe alert (%)',         'Raise an alert above this unsubscribe rate of delivered sends.'),
  ('COMPLAINT_ALERT_PCT', '0.2',        'NUMBER', 'Complaint alert (%)',           'Raise an alert above this complaint rate of delivered sends.'),
  ('PACING_ALERT_PTS',    '15',         'NUMBER', 'Pacing alert (pts)',            'Raise an alert when spend runs this many points ahead of elapsed time.'),
  ('MIN_ARM_FOR_LEARNING','300',        'NUMBER', 'Minimum holdout for a learning','A cell needs at least this many holdout customers before its lift is published as a learning.'),
  ('DEFAULT_MODEL',       'claude-sonnet-4-6', 'TEXT', 'Default model',            'Model for audience requests and copy.'),
  ('CURRENCY',            'AUD',        'TEXT',   'Currency',                      'Officeworks prices and margins are in Australian dollars.');

CREATE OR REPLACE FUNCTION CMP_AS_OF()
RETURNS DATE
MEMOIZABLE
AS
$$
  SELECT SETTING_VALUE::DATE FROM ONEDIGITAL_DEMO.CAMPAIGN.CMP_SETTING WHERE SETTING_KEY = 'AS_OF_DATE'
$$;

CREATE OR REPLACE FUNCTION RECENCY_BAND(DAYS NUMBER)
RETURNS VARCHAR
AS
$$
  CASE WHEN DAYS IS NULL THEN 'NONE' WHEN DAYS <= 90 THEN '0-90d' WHEN DAYS <= 180 THEN '91-180d'
       WHEN DAYS <= 365 THEN '181-365d' ELSE '365d+' END
$$;

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

-- A campaign's TRACK is what it sells, at the level the signals work.
CREATE OR REPLACE FUNCTION CAMPAIGN_TRACK(CATEGORY VARCHAR)
RETURNS VARCHAR
AS
$$
  DECODE(CATEGORY, 'Business Essentials', 'BUSINESS', 'Back to School', 'SCHOOL', 'Technology', 'TECH',
                   'Furniture', 'FURNITURE', 'GENERAL')
$$;

-- What a member needs from a campaign on this track, right now. One definition
-- for the history, the simulator, the uplift cells and the audience builder.
--   BUSINESS  STARTER_NEW (setting up, not yet buying business supplies at
--             Officeworks), STARTER_OW (setting up, already buying them),
--             TRADE_ESTABLISHED (trade buying for over four months), then no signal.
--   SCHOOL    LIST_USER (used the school list service last year), SCHOOL_STARTING
--             (a child likely starting school), SCHOOL_HIGH / _MEDIUM / _LOW by
--             signal confidence, then no signal.
--   TECH      TECH_OWNER (laptop or printer bought 12-24 months ago), TECH_RECENT.
--   FURNITURE HOME_OFFICE (Kmart home-office buying in 12 months).
--   Any track ends in OW_ACTIVE / OW_LAPSED for Officeworks shoppers, or
--   NO_SIGNAL_COLD for a member who has never shopped at Officeworks: contacting
--   them about something they show no sign of needing is cold.
CREATE OR REPLACE FUNCTION NEED_STATE(TRACK VARCHAR, BIZ_STARTER_FLAG BOOLEAN, PRIOR_TRADE_HISTORY BOOLEAN, TRADE_CLASSES_12M NUMBER,
                                      OW_BUSINESS_BUYER BOOLEAN, SCHOOL_SIGNAL VARCHAR, STARTING_SCHOOL BOOLEAN, SCHOOL_LIST_USER BOOLEAN,
                                      TECH_LAST_DAYS NUMBER, HOME_OFFICE_12M BOOLEAN, OW_RECENCY_DAYS NUMBER)
RETURNS VARCHAR
AS
$$
  CASE
    WHEN TRACK = 'BUSINESS' AND COALESCE(BIZ_STARTER_FLAG, FALSE) AND NOT COALESCE(OW_BUSINESS_BUYER, FALSE) THEN 'STARTER_NEW'
    WHEN TRACK = 'BUSINESS' AND COALESCE(BIZ_STARTER_FLAG, FALSE) THEN 'STARTER_OW'
    WHEN TRACK = 'BUSINESS' AND COALESCE(PRIOR_TRADE_HISTORY, FALSE) AND COALESCE(TRADE_CLASSES_12M, 0) >= 4 THEN 'TRADE_ESTABLISHED'
    WHEN TRACK = 'SCHOOL' AND COALESCE(SCHOOL_LIST_USER, FALSE) THEN 'LIST_USER'
    WHEN TRACK = 'SCHOOL' AND COALESCE(STARTING_SCHOOL, FALSE) AND SCHOOL_SIGNAL IN ('HIGH', 'MEDIUM') THEN 'SCHOOL_STARTING'
    WHEN TRACK = 'SCHOOL' AND SCHOOL_SIGNAL = 'HIGH' THEN 'SCHOOL_HIGH'
    WHEN TRACK = 'SCHOOL' AND SCHOOL_SIGNAL = 'MEDIUM' THEN 'SCHOOL_MEDIUM'
    WHEN TRACK = 'SCHOOL' AND SCHOOL_SIGNAL = 'LOW' THEN 'SCHOOL_LOW'
    WHEN TRACK = 'TECH' AND TECH_LAST_DAYS BETWEEN 365 AND 760 THEN 'TECH_OWNER'
    WHEN TRACK = 'TECH' AND TECH_LAST_DAYS < 365 THEN 'TECH_RECENT'
    WHEN TRACK = 'FURNITURE' AND COALESCE(HOME_OFFICE_12M, FALSE) THEN 'HOME_OFFICE'
    WHEN OW_RECENCY_DAYS <= 365 THEN 'OW_ACTIVE'
    WHEN OW_RECENCY_DAYS IS NOT NULL THEN 'OW_LAPSED'
    ELSE 'NO_SIGNAL_COLD'
  END
$$;

-- "Needs what the campaign sells": the need states with a reason to buy.
CREATE OR REPLACE FUNCTION IS_RELEVANT_STATE(NEED VARCHAR)
RETURNS BOOLEAN
AS
$$
  COALESCE(NEED IN ('STARTER_NEW', 'STARTER_OW', 'LIST_USER', 'SCHOOL_STARTING', 'SCHOOL_HIGH', 'SCHOOL_MEDIUM', 'TECH_OWNER', 'HOME_OFFICE'), FALSE)
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
  ('EMAIL',       'Email',            0.0300, NULL, 'EMAIL_OPT_IN', TRUE,  TRUE,  1, 'Officeworks email to the OnePass address. Cheapest personal channel; lowest attention.'),
  ('SMS',         'SMS',              0.0800, 160,  'SMS_OPT_IN',   TRUE,  TRUE,  2, 'One message of up to 160 characters. Expensive, high attention.'),
  ('PUSH',        'OnePass app push', 0.0000, 110,  'PUSH_ENABLED', TRUE,  TRUE,  3, 'OnePass app notification: title and body. Free, but only app users.'),
  ('PAID_SOCIAL', 'Paid social',      0.0120, 280,  NULL,           FALSE, FALSE, 4, 'Hashed audience match on Meta. Cost per reached member at an AUD 12 CPM.'),
  ('IN_STORE',    'In-store',         0.0000, 90,   NULL,           TRUE,  FALSE, 5, 'Officeworks store screens and the Print & Copy counter.');

-- ---------- 3. Offers ----------
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
) COMMENT = 'Officeworks offer catalogue. Copy may only quote an offer''s terms as written here.';

INSERT INTO OFFER VALUES
  ('off-1',  'New Business Tech Bundle - $150 Off', 'Bundle', 'Bundle', '$150 off a laptop and a printer bought together, for new business customers', 150.00, NULL, 'Business Essentials', NULL,
   '$150 off when a laptop over $799 and a printer are bought in one transaction with a new Officeworks business account. Valid 30 days from the offer.', TRUE),
  ('off-2',  'Free Business Card Design + 250 Cards', 'Promo', 'GWP', 'Free design and 250 premium business cards with a new business account', 30.00, NULL, 'Business Essentials', NULL,
   'One free design and 250 premium business cards per new business account. Collect from any Officeworks Print & Copy centre.', TRUE),
  ('off-3',  '20% Off Signage and Vehicle Magnets', 'Discount', '% Off', '20% off corflute signs, banners and vehicle magnet signs', 22.00, 20, 'Business Essentials', NULL,
   '20% off signage and vehicle magnet orders placed in store or online. One order per customer; valid 30 days.', TRUE),
  ('off-4',  'Officeworks Business Account - Free Sign-Up', 'Service', 'Service', 'A free business account with business pricing and 30-day terms', 0.00, NULL, 'Business Essentials', NULL,
   'Free to join. 30-day account terms subject to approval. Business pricing on bulk orders.', TRUE),
  ('off-5',  'School List Service - Upload, We Pack It', 'Service', 'Service', 'Upload the school''s list; Officeworks picks and packs it, ready to collect or delivered', 4.00, NULL, 'Back to School', NULL,
   'Free service: upload your school''s booklist online or in store and we pick and pack it. Standard prices apply; delivery fees may apply.', TRUE),
  ('off-6',  'Back to School - $10 Off $100', 'Reward', '$ Off', '$10 off a school list or school supplies order of $100 or more', 10.00, NULL, 'Back to School', NULL,
   '$10 off a school list or school supplies order of $100 or more. One use per member; valid until 15 February 2027.', TRUE),
  ('off-7',  'Back to School Stationery Bundle - 15% Off', 'Discount', 'Bundle', '15% off when buying three or more back-to-school stationery items', 6.00, 15, 'Back to School', NULL,
   '15% off three or more back-to-school stationery items in one transaction. Excludes technology.', TRUE),
  ('off-8',  'Black Friday Tech - Up to 20% Off', 'Discount', '% Off', 'Up to 20% off selected laptops and printers', 95.00, 20, 'Technology', 'Supplier co-funded',
   'Selected laptops and printers only, while stocks last. Ends 30 November 2026.', TRUE),
  ('off-9',  'Home Office Furniture - 15% Off', 'Discount', '% Off', '15% off office chairs and desks', 45.00, 15, 'Furniture', NULL,
   '15% off Otto chairs and desks. Valid 21 days.', TRUE),
  ('off-10', 'Laptop Trade-Up - $100 Credit', 'Reward', 'Trade-in', '$100 credit towards a new laptop when you trade in an old one', 100.00, NULL, 'Technology', NULL,
   'Trade in a working laptop under five years old for $100 off a new laptop over $899.', TRUE);

-- ---------- 4. Customer features (computed from the purchases) ----------
-- One function, so the live features (as of AS_OF_DATE) and the snapshots frozen
-- on historical campaigns (as of each start date) are the same calculation.
CREATE OR REPLACE FUNCTION CUSTOMER_FEATURES_AT(REF_DATE DATE)
RETURNS TABLE (
  CUSTOMER_KEY NUMBER, CUSTOMER_ID VARCHAR, SEGMENT_NAME VARCHAR, PROFILE_STATE VARCHAR, AGE_BAND VARCHAR, GENDER VARCHAR,
  LOYALTY_TIER VARCHAR, HOME_SUBURB VARCHAR, HOME_STORE_CODE VARCHAR, HOME_STORE_NAME VARCHAR, HOME_STATE VARCHAR,
  FIRST_PURCHASE_DATE DATE, LAST_PURCHASE_DATE DATE, RECENCY_DAYS NUMBER, LINES_TOTAL NUMBER, LINES_12M NUMBER,
  SPEND_TOTAL_AUD NUMBER(38,2), SPEND_12M_AUD NUMBER(38,2), AOV_AUD NUMBER(38,2), PROMO_SHARE FLOAT,
  BANNERS_12M NUMBER, BUNNINGS_SPEND_12M NUMBER(38,2), KMART_SPEND_12M NUMBER(38,2), OW_SPEND_12M NUMBER(38,2),
  OW_LINES_12M NUMBER, OW_RECENCY_DAYS NUMBER, OW_BUSINESS_LINES_12M NUMBER, OW_BUSINESS_BUYER BOOLEAN, TECH_LAST_DAYS NUMBER,
  HOME_OFFICE_12M BOOLEAN,
  TRADE_LINES_90D NUMBER, TRADE_CLASSES_90D NUMBER, TRADE_SPEND_90D NUMBER(38,2), TRADE_CLASSES_12M NUMBER,
  PRIOR_TRADE_HISTORY BOOLEAN, DAYS_SINCE_FIRST_TRADE NUMBER, TRADE_TYPE VARCHAR, BIZ_STARTER_SCORE NUMBER, BIZ_STARTER_FLAG BOOLEAN,
  KIDS_SHOE_LINES_12M NUMBER, KIDS_SHOE_SIZES_12M NUMBER, LATEST_KIDS_SIZE VARCHAR, YOUNGEST_KID_AGE_EST FLOAT, OLDEST_KID_AGE_EST FLOAT,
  EST_SCHOOL_AGE_KIDS NUMBER, SCHOOL_ITEMS_12M NUMBER, DECEMBER_ONLY_SHOES BOOLEAN, SCHOOL_SIGNAL_CONFIDENCE VARCHAR,
  STARTING_SCHOOL_LIKELY BOOLEAN, SCHOOL_LIST_USED_LAST_YEAR BOOLEAN, NEXT_SCHOOL_START DATE, DAYS_TO_SCHOOL_START NUMBER
)
AS
$$
WITH lines AS (
  SELECT tl.CUSTOMER_KEY, tl.TXN_DATE AS DT, tl.BANNER, tl.NET_REVENUE, tl.PROMO_FLAG, tl.SHOE_SIZE_IDX, tl.SHOE_SIZE,
         p.CATEGORY, p.CLASS, p.TRADE_TYPE, p.IS_TRADE
  FROM ONEDIGITAL_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN ONEDIGITAL_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  WHERE tl.TXN_DATE <= REF_DATE
), term AS (
  SELECT STATE, MIN(START_DATE) AS NEXT_START FROM ONEDIGITAL_DEMO.CURATED.DIM_SCHOOL_TERM WHERE START_DATE > REF_DATE GROUP BY 1
), agg AS (
  SELECT CUSTOMER_KEY,
         MIN(DT) AS FIRST_DT, MAX(DT) AS LAST_DT, COUNT(*) AS LINES_TOTAL,
         COUNT_IF(DT > DATEADD('month', -12, REF_DATE)) AS LINES_12M,
         SUM(NET_REVENUE) AS SPEND_TOTAL, SUM(IFF(DT > DATEADD('month', -12, REF_DATE), NET_REVENUE, 0)) AS SPEND_12M,
         AVG(NET_REVENUE) AS AOV, COUNT_IF(PROMO_FLAG) / COUNT(*) AS PROMO_SHARE,
         COUNT(DISTINCT IFF(DT > DATEADD('month', -12, REF_DATE), BANNER, NULL)) AS BANNERS_12M,
         SUM(IFF(BANNER = 'BUNNINGS' AND DT > DATEADD('month', -12, REF_DATE), NET_REVENUE, 0)) AS BUN_12M,
         SUM(IFF(BANNER = 'KMART' AND DT > DATEADD('month', -12, REF_DATE), NET_REVENUE, 0)) AS KMT_12M,
         SUM(IFF(BANNER = 'OFFICEWORKS' AND DT > DATEADD('month', -12, REF_DATE), NET_REVENUE, 0)) AS OW_12M,
         COUNT_IF(BANNER = 'OFFICEWORKS' AND DT > DATEADD('month', -12, REF_DATE)) AS OW_LINES_12M,
         MAX(IFF(BANNER = 'OFFICEWORKS', DT, NULL)) AS OW_LAST,
         COUNT_IF(BANNER = 'OFFICEWORKS' AND DT > DATEADD('month', -12, REF_DATE)
                  AND CLASS IN ('Ink & Toner', 'Paper', 'Business Cards', 'Flyers', 'Signage')) AS OW_BIZ_12M,
         COUNT_IF(BANNER = 'OFFICEWORKS' AND DT > DATEADD('month', -12, REF_DATE) AND CLASS IN ('Business Cards', 'Flyers', 'Signage')) AS OW_PRINT_12M,
         MAX(IFF(BANNER = 'OFFICEWORKS' AND CLASS IN ('Laptops', 'Printers'), DT, NULL)) AS TECH_LAST,
         COUNT_IF(BANNER = 'KMART' AND CLASS = 'Home Office' AND DT > DATEADD('month', -12, REF_DATE)) AS HOME_OFFICE_12M,
         -- Trade
         COUNT_IF(IS_TRADE AND DT > DATEADD('day', -90, REF_DATE)) AS TRADE_LINES_90D,
         COUNT(DISTINCT IFF(IS_TRADE AND DT > DATEADD('day', -90, REF_DATE), CLASS, NULL)) AS TRADE_CLASSES_90D,
         SUM(IFF(IS_TRADE AND DT > DATEADD('day', -90, REF_DATE), NET_REVENUE, 0)) AS TRADE_SPEND_90D,
         COUNT(DISTINCT IFF(IS_TRADE AND DT > DATEADD('month', -12, REF_DATE), CLASS, NULL)) AS TRADE_CLASSES_12M,
         COUNT_IF(IS_TRADE AND DT > DATEADD('day', -480, REF_DATE) AND DT <= DATEADD('day', -120, REF_DATE)) AS TRADE_LINES_PRIOR,
         MIN(IFF(IS_TRADE AND DT > DATEADD('day', -90, REF_DATE), DT, NULL)) AS FIRST_TRADE_90D,
         MODE(IFF(IS_TRADE AND DT > DATEADD('day', -90, REF_DATE), TRADE_TYPE, NULL)) AS TRADE_TYPE,
         -- School
         COUNT_IF(SHOE_SIZE_IDX IS NOT NULL AND SHOE_SIZE_IDX >= 3 AND DT > DATEADD('day', -365, REF_DATE)) AS SHOE_LINES_12M,
         COUNT(DISTINCT IFF(SHOE_SIZE_IDX IS NOT NULL AND DT > DATEADD('day', -365, REF_DATE), SHOE_SIZE_IDX, NULL)) AS SHOE_SIZES_12M,
         MAX_BY(IFF(SHOE_SIZE_IDX IS NOT NULL AND DT > DATEADD('day', -365, REF_DATE), SHOE_SIZE, NULL),
                IFF(SHOE_SIZE_IDX IS NOT NULL AND DT > DATEADD('day', -365, REF_DATE), DT, NULL)) AS LATEST_SIZE,
         COUNT_IF(SHOE_SIZE_IDX IS NOT NULL AND DT > DATEADD('day', -365, REF_DATE) AND MONTH(DT) <> 12) AS SHOE_LINES_NOT_DEC,
         COUNT_IF(CLASS IN ('School Uniform', 'Lunch & Drink', 'School Bags') AND DT > DATEADD('day', -365, REF_DATE)) AS SCHOOL_ITEMS_12M,
         COUNT_IF(CLASS = 'School List Service' AND DT > DATEADD('day', -400, REF_DATE) AND DT <= DATEADD('day', -30, REF_DATE)) AS SCHOOL_LIST_LAST_YEAR
  FROM lines GROUP BY CUSTOMER_KEY
), cust AS (
  SELECT c.*, t.NEXT_START FROM ONEDIGITAL_DEMO.CURATED.DIM_CUSTOMER c LEFT JOIN term t ON t.STATE = c.STATE
), shoe_age AS (
  -- Each kids' shoe bought in the last year implies the child's age at the next
  -- school start: the size's typical age plus the time since. Rounded to half a
  -- year, so a child growing through two sizes collapses to one age.
  SELECT DISTINCT l.CUSTOMER_KEY,
         ROUND((IFF(l.SHOE_SIZE_IDX <= 9, (l.SHOE_SIZE_IDX - 2) / 2.0, l.SHOE_SIZE_IDX - 6.0)
                + DATEDIFF('day', l.DT, c.NEXT_START) / 365.25) * 2) / 2 AS A
  FROM lines l JOIN cust c ON c.CUSTOMER_KEY = l.CUSTOMER_KEY
  WHERE l.SHOE_SIZE_IDX IS NOT NULL AND l.DT > DATEADD('day', -365, REF_DATE)
), shoe_step AS (
  -- Ages more than 1.5 years apart are taken to be different children.
  SELECT CUSTOMER_KEY, A, IFF(A - COALESCE(LAG(A) OVER (PARTITION BY CUSTOMER_KEY ORDER BY A), -99) > 1.5, 1, 0) AS NEW_KID
  FROM shoe_age
), shoe_kid AS (
  SELECT CUSTOMER_KEY, A, SUM(NEW_KID) OVER (PARTITION BY CUSTOMER_KEY ORDER BY A ROWS UNBOUNDED PRECEDING) AS KID
  FROM shoe_step
), kids AS (
  SELECT CUSTOMER_KEY, MIN(KID_AGE) AS YOUNGEST, MAX(KID_AGE) AS OLDEST,
         COUNT_IF(KID_AGE BETWEEN 4.4 AND 12.9) AS SCHOOL_AGE_KIDS
  FROM (SELECT CUSTOMER_KEY, KID, AVG(A) AS KID_AGE FROM shoe_kid GROUP BY 1, 2) GROUP BY 1
), f AS (
  SELECT c.CUSTOMER_KEY, c.CUSTOMER_ID, c.SEGMENT_NAME, c.STATE AS PROFILE_STATE, c.AGE_BAND, c.GENDER, c.MEMBERSHIP AS LOYALTY_TIER,
         c.HOME_SUBURB, 'OWK-' || c.STATE || '-' || LPAD(c.HOME_SUBURB_IDX::VARCHAR, 2, '0') AS HOME_STORE_CODE,
         'Officeworks ' || c.HOME_SUBURB AS HOME_STORE_NAME, c.STATE AS HOME_STATE, c.NEXT_START,
         a.* EXCLUDE (CUSTOMER_KEY), k.YOUNGEST, k.OLDEST, k.SCHOOL_AGE_KIDS
  FROM cust c LEFT JOIN agg a ON a.CUSTOMER_KEY = c.CUSTOMER_KEY LEFT JOIN kids k ON k.CUSTOMER_KEY = c.CUSTOMER_KEY
), scored AS (
  SELECT f.*,
         COALESCE(TRADE_LINES_PRIOR, 0) >= 3 AS PRIOR_TRADE,
         -- 0-100: how many of the six trade classes in 90 days, no trade history
         -- before them, and the spend of a set-up rather than a top-up.
         GREATEST(0, LEAST(100, LEAST(COALESCE(TRADE_CLASSES_90D, 0), 5) * 15
                                 + IFF(COALESCE(TRADE_CLASSES_90D, 0) = 0, 0, IFF(COALESCE(TRADE_LINES_PRIOR, 0) >= 3, -40, 20))
                                 + IFF(COALESCE(TRADE_SPEND_90D, 0) >= 1500, 5, 0))) AS BIZ_SCORE,
         CASE
           WHEN COALESCE(SHOE_LINES_12M, 0) = 0 AND COALESCE(SCHOOL_ITEMS_12M, 0) = 0 THEN 'NONE'
           WHEN COALESCE(SHOE_LINES_12M, 0) > 0 AND COALESCE(SHOE_LINES_NOT_DEC, 0) = 0 THEN 'LOW'
           WHEN COALESCE(SCHOOL_AGE_KIDS, 0) >= 1 AND COALESCE(SCHOOL_ITEMS_12M, 0) >= 1 THEN 'HIGH'
           WHEN COALESCE(SCHOOL_AGE_KIDS, 0) >= 1 OR COALESCE(SCHOOL_ITEMS_12M, 0) >= 2 THEN 'MEDIUM'
           ELSE 'LOW'
         END AS SCHOOL_CONF
  FROM f
)
SELECT CUSTOMER_KEY, CUSTOMER_ID, SEGMENT_NAME, PROFILE_STATE, AGE_BAND, GENDER, LOYALTY_TIER, HOME_SUBURB, HOME_STORE_CODE, HOME_STORE_NAME, HOME_STATE,
       FIRST_DT, LAST_DT, DATEDIFF('day', LAST_DT, REF_DATE)::NUMBER, COALESCE(LINES_TOTAL, 0)::NUMBER, COALESCE(LINES_12M, 0)::NUMBER,
       COALESCE(SPEND_TOTAL, 0)::NUMBER(38,2), COALESCE(SPEND_12M, 0)::NUMBER(38,2), AOV::NUMBER(38,2), PROMO_SHARE::FLOAT,
       COALESCE(BANNERS_12M, 0)::NUMBER, COALESCE(BUN_12M, 0)::NUMBER(38,2), COALESCE(KMT_12M, 0)::NUMBER(38,2), COALESCE(OW_12M, 0)::NUMBER(38,2),
       COALESCE(OW_LINES_12M, 0)::NUMBER, DATEDIFF('day', OW_LAST, REF_DATE)::NUMBER, COALESCE(OW_BIZ_12M, 0)::NUMBER,
       COALESCE(OW_BIZ_12M, 0) >= 4 OR COALESCE(OW_PRINT_12M, 0) >= 2,
       DATEDIFF('day', TECH_LAST, REF_DATE)::NUMBER, COALESCE(HOME_OFFICE_12M, 0) > 0,
       COALESCE(TRADE_LINES_90D, 0)::NUMBER, COALESCE(TRADE_CLASSES_90D, 0)::NUMBER, COALESCE(TRADE_SPEND_90D, 0)::NUMBER(38,2),
       COALESCE(TRADE_CLASSES_12M, 0)::NUMBER, PRIOR_TRADE, DATEDIFF('day', FIRST_TRADE_90D, REF_DATE)::NUMBER, TRADE_TYPE,
       BIZ_SCORE::NUMBER, BIZ_SCORE >= 70 AND COALESCE(TRADE_CLASSES_90D, 0) >= 3 AND NOT PRIOR_TRADE,
       COALESCE(SHOE_LINES_12M, 0)::NUMBER, COALESCE(SHOE_SIZES_12M, 0)::NUMBER, LATEST_SIZE,
       ROUND(YOUNGEST, 1)::FLOAT, ROUND(OLDEST, 1)::FLOAT, COALESCE(SCHOOL_AGE_KIDS, 0)::NUMBER, COALESCE(SCHOOL_ITEMS_12M, 0)::NUMBER,
       COALESCE(SHOE_LINES_12M, 0) > 0 AND COALESCE(SHOE_LINES_NOT_DEC, 0) = 0,
       SCHOOL_CONF,
       SCHOOL_CONF IN ('HIGH', 'MEDIUM') AND YOUNGEST BETWEEN 4.4 AND 5.6,
       COALESCE(SCHOOL_LIST_LAST_YEAR, 0) > 0,
       NEXT_START, DATEDIFF('day', REF_DATE, NEXT_START)::NUMBER
FROM scored
$$;

-- The live features, as of the demo clock, plus RFM over customers who have
-- bought at all (all three banners).
CREATE OR REPLACE TABLE CUSTOMER_FEATURES
  COMMENT = 'One row per OnePass member as of AS_OF_DATE: value, banner mix, the Bunnings business-starter signal and the Kmart school-age signal. Purchase-derived columns are computed from SYNTHETIC purchases; profile columns are GENERATED.'
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
       RECENCY_BAND(RECENCY_DAYS) AS RECENCY_BAND,
       CASE WHEN OW_BUSINESS_BUYER THEN 'Business buyer' WHEN OW_RECENCY_DAYS <= 365 THEN 'Active shopper'
            WHEN OW_RECENCY_DAYS IS NOT NULL THEN 'Lapsed shopper' ELSE 'Never shopped' END AS OW_RELATIONSHIP
FROM scored s;

-- ---------- 5. Consent and contactability (MODELLED) ----------
-- Channel consent is OnePass marketing consent; GROUP_DATA_CONSENT is the
-- member's agreement that purchases at one banner may personalise marketing
-- from another. OnePass subscribers opt in more and use the app more.
CREATE OR REPLACE TABLE CUSTOMER_CONTACT
  COMMENT = 'MODELLED consent and channel preference per member, including OnePass group data-sharing consent. HASHED_ID stands in for a hashed email in paid-social matching.'
AS
WITH u AS (
  SELECT f.CUSTOMER_KEY, f.CUSTOMER_ID, f.LOYALTY_TIER, f.RECENCY_DAYS,
         (ABS(HASH(f.CUSTOMER_KEY, 'email')) % 100000) / 100000.0 AS U_EMAIL,
         (ABS(HASH(f.CUSTOMER_KEY, 'sms'))   % 100000) / 100000.0 AS U_SMS,
         (ABS(HASH(f.CUSTOMER_KEY, 'push'))  % 100000) / 100000.0 AS U_PUSH,
         (ABS(HASH(f.CUSTOMER_KEY, 'group')) % 100000) / 100000.0 AS U_GROUP,
         (ABS(HASH(f.CUSTOMER_KEY, 'pref'))  % 100000) / 100000.0 AS U_PREF,
         IFF(f.LOYALTY_TIER = 'OnePass', 1, 0) AS ONEPASS
  FROM CUSTOMER_FEATURES f
), c AS (
  SELECT CUSTOMER_KEY, CUSTOMER_ID,
         U_EMAIL < 0.64 + 0.18 * ONEPASS                                                       AS EMAIL_OPT_IN,
         U_SMS   < 0.30 + 0.12 * ONEPASS                                                       AS SMS_OPT_IN,
         U_PUSH  < 0.14 + 0.36 * ONEPASS + IFF(COALESCE(RECENCY_DAYS, 999) <= 180, 0.04, 0)    AS PUSH_ENABLED,
         U_GROUP < 0.52 + 0.28 * ONEPASS                                                       AS GROUP_DATA_CONSENT,
         U_PREF
  FROM u
)
SELECT CUSTOMER_KEY, CUSTOMER_ID, EMAIL_OPT_IN, SMS_OPT_IN, PUSH_ENABLED, GROUP_DATA_CONSENT,
       CASE WHEN PUSH_ENABLED AND U_PREF < 0.30 THEN 'PUSH'
            WHEN SMS_OPT_IN AND U_PREF < 0.55 THEN 'SMS'
            WHEN EMAIL_OPT_IN THEN 'EMAIL'
            WHEN SMS_OPT_IN THEN 'SMS'
            WHEN PUSH_ENABLED THEN 'PUSH'
            ELSE 'NONE' END AS PREFERRED_CHANNEL,
       EMAIL_OPT_IN OR SMS_OPT_IN OR PUSH_ENABLED AS IS_CONTACTABLE,
       SHA2(CUSTOMER_ID || '|onepass', 256) AS HASHED_ID,
       'MODELLED' AS PROVENANCE
FROM c;

-- ---------- 6. Supply position by brand and Officeworks store (MODELLED) ----------
-- MacBook Air allocation is short in WA stores during Black Friday: the live
-- tech campaign's storyline. Casio calculators run low in QLD.
CREATE OR REPLACE TABLE SUPPLY_POSITION
  COMMENT = 'MODELLED availability of a brand at an Officeworks store. SHORT means the promoted range cannot be sold there.'
AS
WITH rules AS (
  SELECT * FROM VALUES
    ('Apple',   'ALT-101', 'WA',  0.85, 'SHORT', 'OK',  '2026-10-26'::DATE, '2026-12-15'::DATE, 'MacBook Air M3 allocation cut for Black Friday; WA stores hold under a week of cover.'),
    ('Casio',   'ALT-102', 'QLD', 0.60, 'LOW',   'OK',  '2026-11-01'::DATE, '2027-01-31'::DATE, 'Scientific calculators running ahead of forecast; replenishment due 6 December.'),
    ('Otto',    'ALT-103', NULL,  0.00, 'OVER',  'OVER','2026-09-01'::DATE, '2027-03-31'::DATE, '16 weeks of cover on chairs against an 8-week target.')
  AS t(BRAND_NAME, ALERT_ID, STATE_FOCUS, SHARE, STATUS_IN, STATUS_OUT, VALID_FROM, VALID_TO, REASON)
)
SELECT r.BRAND_NAME, s.STORE_CODE, s.STORE_NAME, s.STATE,
       IFF((r.STATE_FOCUS IS NULL OR s.STATE = r.STATE_FOCUS)
           AND (ABS(HASH(r.BRAND_NAME, s.STORE_CODE, 'supply')) % 1000) / 1000.0 < IFF(r.SHARE = 0, 1, r.SHARE),
           r.STATUS_IN, r.STATUS_OUT) AS STATUS,
       r.ALERT_ID, r.VALID_FROM, r.VALID_TO, r.REASON, 'MODELLED' AS PROVENANCE
FROM rules r CROSS JOIN ONEDIGITAL_DEMO.CURATED.DIM_STORE s
WHERE s.BANNER = 'OFFICEWORKS';

-- ---------- 7. Products to lead with, by track ----------
CREATE OR REPLACE TABLE TRACK_PRODUCT
  COMMENT = 'Per campaign track: Officeworks products to feature, best sellers in the last six months, at catalogue price.'
AS
WITH map AS (
  SELECT * FROM VALUES ('BUSINESS', 'Business Essentials', 'Laptops'), ('BUSINESS', 'Business Essentials', 'Printers'),
                       ('BUSINESS', 'Business Essentials', 'Business Cards'), ('BUSINESS', 'Business Essentials', 'Signage'),
                       ('SCHOOL', 'Back to School', 'School List Service'), ('SCHOOL', 'Back to School', 'Stationery Packs'),
                       ('TECH', 'Technology', 'Laptops'), ('TECH', 'Technology', 'Printers'), ('TECH', 'Technology', 'Tech Accessories'),
                       ('FURNITURE', 'Furniture', 'Office Chairs'), ('FURNITURE', 'Furniture', 'Desks'),
                       ('GENERAL', NULL, 'Stationery'), ('GENERAL', NULL, 'Paper')
  AS m(TRACK, CAMPAIGN_CATEGORY, CLASS)
), sellers AS (
  SELECT p.PRODUCT_KEY, p.CLASS, p.BRAND, p.PRODUCT_NAME, p.UNIT_PRICE, SUM(tl.QUANTITY) AS UNITS_6M
  FROM ONEDIGITAL_DEMO.CURATED.FACT_TRANSACTION_LINES tl
  JOIN ONEDIGITAL_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
  WHERE tl.BANNER = 'OFFICEWORKS' AND tl.TXN_DATE > DATEADD('month', -6, CMP_AS_OF())
  GROUP BY 1, 2, 3, 4, 5
)
SELECT m.TRACK, m.CAMPAIGN_CATEGORY, s.CLASS, s.BRAND AS BRAND_NAME, s.PRODUCT_KEY, s.PRODUCT_NAME, s.UNIT_PRICE AS UNIT_RETAIL, s.UNITS_6M,
       ROW_NUMBER() OVER (PARTITION BY m.TRACK ORDER BY s.UNITS_6M DESC, s.PRODUCT_KEY) AS RANK_IN_TRACK
FROM map m JOIN sellers s ON s.CLASS = m.CLASS;

-- ---------- 8. The campaign model (tables the app reads and writes) ----------
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
) COMMENT = 'An Officeworks campaign and where it is in its lifecycle: IDEA, BRIEF, AUDIENCE_LOCKED, CONTENT_APPROVED, SCHEDULED, LIVE, PAUSED, COMPLETED, MEASURED, CANCELLED.';

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
) COMMENT = 'Campaign ideas from the ideas board: NEW, ACCEPTED, REJECTED or BLOCKED by a guardrail.';

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

-- A locked audience, frozen with what each member looked like on the snapshot
-- date, so a campaign's lift is measured against the audience as it was.
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
  RFM_SEGMENT        VARCHAR,
  TRACK              VARCHAR,
  NEED_STATE         VARCHAR,
  RESPONSE_STATE     VARCHAR,
  SIGNAL_AGE_DAYS    NUMBER,
  BIZ_STARTER        BOOLEAN,
  SCHOOL_SIGNAL      VARCHAR,
  SCHOOL_LIST_USER   BOOLEAN,
  OW_RELATIONSHIP    VARCHAR,
  GROUP_DATA_CONSENT BOOLEAN,
  DAYS_TO_SCHOOL_START NUMBER,
  IS_RELEVANT        BOOLEAN,
  COLD_CONTACT       BOOLEAN,
  STOCK_CONFLICT     BOOLEAN,
  UPLIFT_QUADRANT    VARCHAR,
  P_TREAT            FLOAT,
  P_CONTROL          FLOAT,
  SUPPRESSED_AT      DATE,
  SUPPRESS_REASON    VARCHAR
) COMMENT = 'Members of a locked audience: TREATED or HOLDOUT, the channel and variant they get, and their signals on the snapshot date. NEED_STATE and the signal columns are what the business may use (cross-banner signals only with group data-sharing consent; SCHOOL_SIGNAL is NOT_CONSENTED otherwise). RESPONSE_STATE is the member''s need whatever the business may see: the simulator''s input, never shown. A TREATED member suppressed mid-flight stays TREATED for measurement (intent to treat).';

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
) COMMENT = 'SEND, DELIVER, BOUNCE, OPEN, CLICK, CONVERT, UNSUBSCRIBE, COMPLAINT. Holdout members only ever CONVERT: the organic purchase the campaign is measured against.';

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
) COMMENT = 'Monitoring alerts a person acted on or dismissed. Open alerts are computed live.';

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
) COMMENT = 'Every AI call the campaign persona makes -- agent runs, audience requests, copy, QA -- verified or not, including failures.';
