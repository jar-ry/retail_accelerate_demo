-- ============================================================
-- OneDigital Campaign Manager — campaign history and the response simulator (od_43)
--
-- Officeworks has no campaign response data in this demo, so six campaigns are
-- built here: each has a real audience (selected from the features as they
-- stood on its start date), a randomised holdout, creative, a channel plan and
-- modelled responses. The same procedure (GENERATE_EVENTS) simulates a campaign
-- launched in the app, so the uplift the history teaches is the uplift a new
-- campaign gets.
--
-- THE RULES. A member's response depends on what they need from the campaign's
-- track (NEED_STATE, od_40):
--   base  = BASE_RATE x BASE_MULT                                   (holdout and treated)
--   lift  = UPLIFT x UPLIFT_MULT x channel x variant x timing      (treated)
-- RESPONSE_STATE holds the multipliers. Members who would buy anyway (a starter
-- already buying business supplies at Officeworks, a family that used the
-- school list service last year, an established tradie) have a high base and
-- almost no lift. A member with no sign of need who has never shopped at
-- Officeworks is a sleeping dog: contact lowers their buying and they
-- unsubscribe. Back-to-school lift is strongest two to five weeks before each
-- state's Term 1 start; the business-starter signal fades after two months.
-- Draws are HASH(customer, campaign, purpose): a rebuild gives the same events.
--
-- STORYLINES:
--   camp-h01  Back to School 2026 to every Officeworks shopper, $10 off, sent nine
--             weeks out: a small lift, almost all of it in households Kmart flags
--             as school-age, and the discount handed to last year's school-list
--             users who were coming anyway.
--   camp-h02  School list pilot on the Kmart signal in VIC and QLD, three weeks out:
--             strong lift for HIGH and MEDIUM confidence and for children starting
--             school; LOW (toddler sizes, December gifts) does not respond.
--   camp-h03  New-business bundle to anyone with a Bunnings trade cluster: big lift
--             for starters, none for established tradies, who buy anyway.
--   camp-h04  Business account to every Bunnings shopper: no lift overall and
--             unsubscribes far above the limit from DIY shoppers with no need.
--   camp-h05  Home-office furniture to Kmart home-office shoppers: weak.
--   camp-l01  LIVE Black Friday tech: mostly sure things, and WA stores are short of
--             the promoted MacBook Air.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE OD_WH;
USE SCHEMA ONEDIGITAL_DEMO.CAMPAIGN;

-- ---------- 1. The response model ----------
CREATE OR REPLACE TABLE RESPONSE_MODEL (
  SCOPE          VARCHAR NOT NULL,
  SCOPE_KEY      VARCHAR NOT NULL,
  BASE_RATE      FLOAT NOT NULL,
  UPLIFT         FLOAT NOT NULL,
  CH_EMAIL       FLOAT NOT NULL,
  CH_SMS         FLOAT NOT NULL,
  CH_PUSH        FLOAT NOT NULL,
  CH_SOCIAL      FLOAT NOT NULL,
  CH_INSTORE     FLOAT NOT NULL,
  VARIANT_B      FLOAT NOT NULL,
  STOCK_EFFECT   FLOAT NOT NULL,
  AVG_ORDER_AUD  FLOAT NOT NULL,
  MARGIN_RATE    FLOAT NOT NULL,
  NOTE           VARCHAR
) COMMENT = 'MODELLED response rules. TRACK rows are the defaults a new campaign is simulated with; CAMPAIGN rows override them for the planted history.';

INSERT INTO RESPONSE_MODEL VALUES
  ('TRACK', 'BUSINESS',  0.040, 0.060, 1.0, 1.3, 0.8, 0.4, 0.3, 1.10, -0.45,  690, 0.18, 'Set-up purchases: a laptop, a printer, cards and signs.'),
  ('TRACK', 'SCHOOL',    0.060, 0.050, 1.0, 1.35, 0.9, 0.4, 0.3, 1.05, -0.45, 165, 0.28, 'A school list order plus extras.'),
  ('TRACK', 'TECH',      0.030, 0.012, 1.0, 1.1, 0.9, 0.4, 0.3, 1.00, -0.45, 1050, 0.10, 'High ticket, thin margin.'),
  ('TRACK', 'FURNITURE', 0.020, 0.010, 1.0, 1.1, 0.8, 0.4, 0.3, 1.00, -0.45,  340, 0.36, NULL),
  ('TRACK', 'GENERAL',   0.040, 0.012, 1.0, 1.2, 0.9, 0.4, 0.3, 1.00, -0.45,   60, 0.35, 'Stationery, paper and ink.'),
  ('CAMPAIGN', 'camp-h01', 0.060, 0.048, 1.0, 1.35, 0.9, 0.4, 0.3, 1.00, -0.45, 170, 0.28, 'Broad back-to-school email with $10 off.'),
  ('CAMPAIGN', 'camp-h02', 0.060, 0.052, 1.0, 1.40, 0.9, 0.4, 0.3, 1.10, -0.45, 165, 0.28, 'School list pilot: SMS beats email; the "we pack it" angle (B) wins.'),
  ('CAMPAIGN', 'camp-h03', 0.040, 0.095, 1.0, 1.30, 0.8, 0.4, 0.3, 1.10, -0.45,  720, 0.18, 'New-business bundle: starters respond strongly.'),
  ('CAMPAIGN', 'camp-h04', 0.040, 0.050, 1.0, 1.20, 0.8, 0.4, 0.3, 1.00, -0.45,  520, 0.18, 'Business account to all Bunnings shoppers.'),
  ('CAMPAIGN', 'camp-h05', 0.020, 0.010, 1.0, 1.10, 0.8, 0.4, 0.3, 1.00, -0.45,  340, 0.36, 'Home-office furniture: weak.'),
  ('CAMPAIGN', 'camp-l01', 0.030, 0.012, 1.0, 1.10, 0.9, 0.4, 0.3, 1.00, -0.50, 1080, 0.10, 'Black Friday tech: mostly sure things; WA cannot supply the brand.');

-- Multipliers by what the member needs from the track.
CREATE OR REPLACE TABLE RESPONSE_STATE (
  TRACK        VARCHAR NOT NULL,
  NEED_STATE   VARCHAR NOT NULL,
  BASE_MULT    FLOAT NOT NULL,
  UPLIFT_MULT  FLOAT NOT NULL,
  SLEEPING_REL FLOAT NOT NULL,
  UNSUB_MULT   FLOAT NOT NULL,
  NOTE         VARCHAR
) COMMENT = 'MODELLED: how a member in each need state responds. SLEEPING_REL < 0 means contact lowers their buying by that share of the base.';

INSERT INTO RESPONSE_STATE VALUES
  ('BUSINESS', 'STARTER_NEW',       1.00, 1.00,  0.00, 1.0, 'Setting up and not yet an Officeworks business customer: persuadable.'),
  ('BUSINESS', 'STARTER_OW',        4.00, 0.12,  0.00, 1.0, 'Already buying business supplies at Officeworks: a sure thing.'),
  ('BUSINESS', 'TRADE_ESTABLISHED', 3.00, 0.04,  0.00, 1.3, 'An established tradie: buys anyway.'),
  ('BUSINESS', 'OW_ACTIVE',         0.50, 0.05,  0.00, 1.6, NULL),
  ('BUSINESS', 'OW_LAPSED',         0.30, 0.04,  0.00, 2.0, NULL),
  ('BUSINESS', 'NO_SIGNAL_COLD',    0.60, 0.00, -0.55, 7.0, 'No need and no Officeworks relationship: a sleeping dog.'),
  ('SCHOOL',   'LIST_USER',         7.00, 0.08,  0.00, 0.8, 'Used the school list service last year: coming back anyway.'),
  ('SCHOOL',   'SCHOOL_STARTING',   1.20, 2.00,  0.00, 1.0, 'A child likely starting school: the most persuadable.'),
  ('SCHOOL',   'SCHOOL_HIGH',       1.30, 1.20,  0.00, 1.0, NULL),
  ('SCHOOL',   'SCHOOL_MEDIUM',     0.80, 0.70,  0.00, 1.0, NULL),
  ('SCHOOL',   'SCHOOL_LOW',        0.30, 0.06,  0.00, 1.5, 'Toddler sizes or a December gift: no school-age child.'),
  ('SCHOOL',   'OW_ACTIVE',         0.35, 0.06,  0.00, 1.2, NULL),
  ('SCHOOL',   'OW_LAPSED',         0.20, 0.04,  0.00, 1.5, NULL),
  ('SCHOOL',   'NO_SIGNAL_COLD',    0.08, 0.00, -0.40, 4.0, NULL),
  ('TECH',     'TECH_OWNER',        1.50, 1.00,  0.00, 1.0, 'Laptop or printer one to two years old.'),
  ('TECH',     'TECH_RECENT',       2.00, 0.15,  0.00, 1.2, 'Bought in the last year: buys anyway or not at all.'),
  ('TECH',     'OW_ACTIVE',         1.00, 0.25,  0.00, 1.0, NULL),
  ('TECH',     'OW_LAPSED',         0.60, 0.40,  0.00, 1.3, NULL),
  ('TECH',     'NO_SIGNAL_COLD',    0.10, 0.00, -0.30, 3.0, NULL),
  ('FURNITURE','HOME_OFFICE',       1.50, 0.70,  0.00, 1.0, NULL),
  ('FURNITURE','OW_ACTIVE',         1.00, 0.30,  0.00, 1.0, NULL),
  ('FURNITURE','OW_LAPSED',         0.60, 0.30,  0.00, 1.3, NULL),
  ('FURNITURE','NO_SIGNAL_COLD',    0.10, 0.00, -0.30, 3.0, NULL),
  ('GENERAL',  'OW_ACTIVE',         1.00, 1.00,  0.00, 1.0, NULL),
  ('GENERAL',  'OW_LAPSED',         0.60, 1.20,  0.00, 1.3, NULL),
  ('GENERAL',  'NO_SIGNAL_COLD',    0.10, 0.00, -0.30, 3.0, NULL);

-- Back-to-school lift by weeks to the member's Term 1 start at the send; any
-- other track is 1.
CREATE OR REPLACE FUNCTION TIMING_FACTOR(TRACK VARCHAR, DAYS_TO_SCHOOL NUMBER)
RETURNS FLOAT
AS
$$
  (CASE WHEN TRACK <> 'SCHOOL' THEN 1.0
        WHEN DAYS_TO_SCHOOL IS NULL OR DAYS_TO_SCHOOL < 0 THEN 0.3
        WHEN DAYS_TO_SCHOOL <= 40 THEN 1.0
        WHEN DAYS_TO_SCHOOL <= 65 THEN 0.7
        WHEN DAYS_TO_SCHOOL <= 100 THEN 0.45
        ELSE 0.25 END)::FLOAT
$$;

-- ---------- 2. The campaigns ----------
CREATE OR REPLACE TEMPORARY TABLE HISTORY_DEF AS
SELECT column1 AS CAMPAIGN_ID, column2 AS NAME, column3 AS OBJECTIVE, column4 AS HYPOTHESIS, column5 AS FINAL_STATUS,
       column6 AS PROMOTED_CATEGORY, column7 AS PROMOTED_CLASS, column8 AS PROMOTED_BRAND, column9 AS OFFER_ID,
       column10 AS CHANNEL_RULE, SPLIT(column11, ',') AS CHANNELS, column12::NUMBER(12,2) AS BUDGET_AUD,
       column13::DATE AS START_DATE, column14::DATE AS END_DATE, column15::DATE AS THROUGH_DATE, column16::NUMBER AS HOLDOUT_PCT,
       column17 AS AUDIENCE_NAME, column18 AS AUDIENCE_DESC, column19 AS SPEC_JSON
FROM VALUES
  ('camp-h01', 'Back to School 2026 - All Officeworks Shoppers', 'Win the 2026 back-to-school shop.',
   'A $10-off-$100 offer to every recent Officeworks shopper brings the school shop forward.', 'MEASURED',
   'Back to School', NULL, NULL, 'off-6', 'EMAIL', 'EMAIL', 15000,
   '2025-12-01', '2026-01-31', '2026-01-31', 15, 'Recent Officeworks shoppers', 'Email-consented members who shopped at Officeworks in the last two years. No Kmart signal.',
   '{"version":1,"all":[{"field":"OW_RECENCY_DAYS","op":"lte","value":730}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL"],"promoted":{"category":"Back to School","className":null,"brand":null}}'),
  ('camp-h02', 'School List Pilot - Kmart Signal (VIC, QLD)', 'Test whether Kmart purchases find the families who need the school list service.',
   'Households whose Kmart buying suggests school-age children will use the school list service when invited three weeks before school starts.', 'MEASURED',
   'Back to School', 'School List Service', NULL, 'off-5', 'EMAIL_SMS_TEST', 'EMAIL,SMS', 9000,
   '2026-01-06', '2026-01-31', '2026-01-31', 20, 'Kmart school signal, VIC and QLD', 'Members in VIC and QLD with any Kmart school signal (HIGH, MEDIUM or LOW, to test the proxy) and group data-sharing consent. Channel randomised where both are consented.',
   '{"version":1,"all":[{"field":"HOME_STATE","op":"in","values":["VIC","QLD"]},{"field":"SCHOOL_SIGNAL_CONFIDENCE","op":"in","values":["HIGH","MEDIUM","LOW"]}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL","SMS"],"promoted":{"category":"Back to School","className":"School List Service","brand":null}}'),
  ('camp-h03', 'New Business Welcome - Trade Cluster Test', 'Test whether a Bunnings trade cluster finds new business customers for Officeworks.',
   'A member buying three or more kinds of trade gear in 90 days is setting up a business and needs a laptop, printer, cards and signs.', 'MEASURED',
   'Business Essentials', NULL, NULL, 'off-1', 'PREFERRED_EMAIL_SMS', 'EMAIL,SMS', 12000,
   '2026-03-16', '2026-04-26', '2026-04-26', 30, 'Bunnings trade cluster', 'Members with three or more trade categories at Bunnings in the last 90 days and group data-sharing consent. Established tradies included, to test the signal.',
   '{"version":1,"all":[{"field":"TRADE_CLASSES_90D","op":"gte","value":3}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL","SMS"],"promoted":{"category":"Business Essentials","className":null,"brand":null}}'),
  ('camp-h04', 'Business Account Sign-Up - All Bunnings Shoppers', 'Sign Bunnings shoppers up to an Officeworks business account.',
   'Bunnings shoppers include many small businesses; a free business account will convert them.', 'MEASURED',
   'Business Essentials', NULL, NULL, 'off-4', 'EMAIL', 'EMAIL', 6000,
   '2026-08-03', '2026-08-30', '2026-08-30', 10, 'All Bunnings shoppers', 'Every member who shopped at Bunnings in the last 12 months, with group data-sharing consent.',
   '{"version":1,"all":[{"field":"BUNNINGS_SPEND_12M","op":"gte","value":1}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL"],"promoted":{"category":"Business Essentials","className":null,"brand":null}}'),
  ('camp-h05', 'Home Office Refresh - Kmart Home-Office Shoppers', 'Move Kmart home-office shoppers up to Officeworks furniture.',
   'Members who bought a desk or chair at Kmart will trade up to an ergonomic chair or a sit-stand desk.', 'MEASURED',
   'Furniture', NULL, NULL, 'off-9', 'EMAIL', 'EMAIL', 4000,
   '2026-05-11', '2026-06-07', '2026-06-07', 10, 'Kmart home-office shoppers', 'Members who bought home-office items at Kmart in the last 12 months, with group data-sharing consent.',
   '{"version":1,"all":[{"field":"HOME_OFFICE_12M","op":"is_true"}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL"],"promoted":{"category":"Furniture","className":null,"brand":null}}'),
  ('camp-l01', 'Black Friday Tech - Early Deals on Laptops', 'Maximise laptop and printer sales over Black Friday.',
   'Up to 20% off laptops and printers to every active shopper pulls tech demand forward.', 'LIVE',
   'Technology', 'Laptops', 'Apple', 'off-8', 'EMAIL_PUSH', 'EMAIL,PUSH', 40000,
   '2026-10-26', '2026-11-30', '2026-11-12', 10, 'Active Officeworks shoppers', 'Members who shopped at Officeworks in the last 12 months.',
   '{"version":1,"all":[{"field":"OW_RECENCY_DAYS","op":"lte","value":365}],"any":[],"exclude":[],"suppress":{"fatigueDays":null,"coldContacts":false,"stockConflict":false},"channels":["EMAIL","PUSH"],"promoted":{"category":"Technology","className":"Laptops","brand":"Apple"}}');

DELETE FROM CAMPAIGN WHERE PROVENANCE = 'MODELLED' OR CAMPAIGN_ID IN (SELECT CAMPAIGN_ID FROM HISTORY_DEF);
DELETE FROM CAMPAIGN_STATUS_LOG WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM AUDIENCE WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM AUDIENCE_MEMBER WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CAMPAIGN_EVENT WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CONTENT_VARIANT WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM CHANNEL_PLAN WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN);
DELETE FROM LEARNING WHERE CAMPAIGN_ID NOT IN (SELECT CAMPAIGN_ID FROM CAMPAIGN) OR PUBLISHED_BY = 'Priya Shah';

INSERT INTO CAMPAIGN (CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, STATUS, AUDIENCE_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND,
                      OFFER_ID, CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, DESTINATION, SIMULATED_THROUGH, PROVENANCE,
                      CREATED_BY, CREATED_AT, UPDATED_BY, UPDATED_AT)
SELECT CAMPAIGN_ID, NAME, OBJECTIVE, HYPOTHESIS, FINAL_STATUS, 'aud-' || CAMPAIGN_ID, PROMOTED_CATEGORY, PROMOTED_CLASS, PROMOTED_BRAND,
       OFFER_ID, CHANNELS, BUDGET_AUD, START_DATE, END_DATE, HOLDOUT_PCT, 'Braze', THROUGH_DATE, 'MODELLED',
       'Priya Shah', DATEADD('day', -28, START_DATE)::TIMESTAMP_NTZ, 'Priya Shah', THROUGH_DATE::TIMESTAMP_NTZ
FROM HISTORY_DEF;

-- ---------- 3. Audiences, frozen on each campaign's start date ----------
INSERT INTO AUDIENCE (AUDIENCE_ID, NAME, DESCRIPTION, SPEC, SPEC_HASH, VERSION, SOURCE, STATUS, CAMPAIGN_ID, CREATED_BY, CREATED_AT, LOCKED_BY, LOCKED_AT)
SELECT 'aud-' || CAMPAIGN_ID, AUDIENCE_NAME, AUDIENCE_DESC, PARSE_JSON(SPEC_JSON), SHA2(SPEC_JSON, 256), 1, 'BUILDER', 'LOCKED', CAMPAIGN_ID,
       'Priya Shah', DATEADD('day', -16, START_DATE)::TIMESTAMP_NTZ, 'Priya Shah', DATEADD('day', -14, START_DATE)::TIMESTAMP_NTZ
FROM HISTORY_DEF;

CREATE OR REPLACE TEMPORARY TABLE SNAP AS
SELECT CMP_AS_OF() AS SNAPSHOT_DATE, f.* FROM TABLE(CUSTOMER_FEATURES_AT('2025-01-01'::DATE)) f WHERE FALSE;

EXECUTE IMMEDIATE $$
DECLARE
  c CURSOR FOR SELECT DISTINCT START_DATE FROM HISTORY_DEF ORDER BY START_DATE;
BEGIN
  FOR r IN c DO
    LET d DATE := r.START_DATE;
    INSERT INTO SNAP SELECT :d, f.* FROM TABLE(ONEDIGITAL_DEMO.CAMPAIGN.CUSTOMER_FEATURES_AT(:d)) f;
  END FOR;
  RETURN 'ok';
END;
$$;

INSERT INTO AUDIENCE_MEMBER (CAMPAIGN_ID, AUDIENCE_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, SNAPSHOT_DATE,
                             SEGMENT_NAME, LOYALTY_TIER, PROFILE_STATE, HOME_STORE_CODE, HOME_STATE, RECENCY_DAYS, RECENCY_BAND,
                             LINES_12M, SPEND_12M_AUD, AOV_AUD, PROMO_SHARE, RFM_SEGMENT, TRACK, NEED_STATE, RESPONSE_STATE, SIGNAL_AGE_DAYS,
                             BIZ_STARTER, SCHOOL_SIGNAL, SCHOOL_LIST_USER, OW_RELATIONSHIP, GROUP_DATA_CONSENT, DAYS_TO_SCHOOL_START,
                             IS_RELEVANT, COLD_CONTACT, STOCK_CONFLICT)
WITH s AS (
  SELECT sn.*,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.RECENCY_DAYS DESC, sn.CUSTOMER_KEY)) AS R_SCORE,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.LINES_12M, sn.LINES_TOTAL, sn.CUSTOMER_KEY)) AS F_SCORE,
         IFF(sn.LAST_PURCHASE_DATE IS NULL, NULL, NTILE(5) OVER (PARTITION BY sn.SNAPSHOT_DATE, sn.LAST_PURCHASE_DATE IS NULL ORDER BY sn.SPEND_12M_AUD, sn.SPEND_TOTAL_AUD, sn.CUSTOMER_KEY)) AS M_SCORE,
         CASE WHEN sn.OW_BUSINESS_BUYER THEN 'Business buyer' WHEN sn.OW_RECENCY_DAYS <= 365 THEN 'Active shopper'
              WHEN sn.OW_RECENCY_DAYS IS NOT NULL THEN 'Lapsed shopper' ELSE 'Never shopped' END AS OW_REL
  FROM SNAP sn
), cand AS (
  SELECT h.CAMPAIGN_ID, h.START_DATE, h.HOLDOUT_PCT, h.CHANNEL_RULE, h.PROMOTED_BRAND, CAMPAIGN_TRACK(h.PROMOTED_CATEGORY) AS TRACK,
         s.*, RFM_LABEL(s.R_SCORE, s.F_SCORE, s.M_SCORE) AS RFM_SEGMENT,
         c.EMAIL_OPT_IN, c.SMS_OPT_IN, c.PUSH_ENABLED, c.PREFERRED_CHANNEL, c.GROUP_DATA_CONSENT,
         -- What the business may use: cross-banner signals only with consent.
         NEED_STATE(CAMPAIGN_TRACK(h.PROMOTED_CATEGORY), s.BIZ_STARTER_FLAG AND c.GROUP_DATA_CONSENT, s.PRIOR_TRADE_HISTORY AND c.GROUP_DATA_CONSENT,
                    IFF(c.GROUP_DATA_CONSENT, s.TRADE_CLASSES_12M, 0), s.OW_BUSINESS_BUYER, IFF(c.GROUP_DATA_CONSENT, s.SCHOOL_SIGNAL_CONFIDENCE, 'NONE'),
                    s.STARTING_SCHOOL_LIKELY AND c.GROUP_DATA_CONSENT, s.SCHOOL_LIST_USED_LAST_YEAR, s.TECH_LAST_DAYS,
                    s.HOME_OFFICE_12M AND c.GROUP_DATA_CONSENT, s.OW_RECENCY_DAYS) AS NEED_STATE,
         -- What the member actually needs, whatever the business may see: the simulator's input.
         NEED_STATE(CAMPAIGN_TRACK(h.PROMOTED_CATEGORY), s.BIZ_STARTER_FLAG, s.PRIOR_TRADE_HISTORY, s.TRADE_CLASSES_12M, s.OW_BUSINESS_BUYER,
                    s.SCHOOL_SIGNAL_CONFIDENCE, s.STARTING_SCHOOL_LIKELY, s.SCHOOL_LIST_USED_LAST_YEAR, s.TECH_LAST_DAYS, s.HOME_OFFICE_12M,
                    s.OW_RECENCY_DAYS) AS RESPONSE_STATE,
         CASE h.CAMPAIGN_ID
           WHEN 'camp-h01' THEN COALESCE(s.OW_RECENCY_DAYS <= 730, FALSE)
           WHEN 'camp-h02' THEN c.GROUP_DATA_CONSENT AND s.HOME_STATE IN ('VIC', 'QLD') AND s.SCHOOL_SIGNAL_CONFIDENCE IN ('HIGH', 'MEDIUM', 'LOW')
           WHEN 'camp-h03' THEN c.GROUP_DATA_CONSENT AND s.TRADE_CLASSES_90D >= 3
           WHEN 'camp-h04' THEN c.GROUP_DATA_CONSENT AND s.BUNNINGS_SPEND_12M >= 1
           WHEN 'camp-h05' THEN c.GROUP_DATA_CONSENT AND s.HOME_OFFICE_12M
           WHEN 'camp-l01' THEN COALESCE(s.OW_RECENCY_DAYS <= 365, FALSE)
         END AS IS_IN
  FROM HISTORY_DEF h
  JOIN s ON s.SNAPSHOT_DATE = h.START_DATE
  JOIN CUSTOMER_CONTACT c ON c.CUSTOMER_KEY = s.CUSTOMER_KEY
), chan AS (
  SELECT cand.*,
         CASE CHANNEL_RULE
           WHEN 'EMAIL' THEN IFF(EMAIL_OPT_IN, 'EMAIL', NULL)
           WHEN 'EMAIL_SMS_TEST' THEN CASE WHEN EMAIL_OPT_IN AND SMS_OPT_IN THEN IFF(ABS(HASH(CUSTOMER_KEY, CAMPAIGN_ID, 'chan')) % 2 = 0, 'SMS', 'EMAIL')
                                           WHEN SMS_OPT_IN THEN 'SMS' WHEN EMAIL_OPT_IN THEN 'EMAIL' END
           WHEN 'PREFERRED_EMAIL_SMS' THEN CASE WHEN PREFERRED_CHANNEL IN ('EMAIL', 'SMS') THEN PREFERRED_CHANNEL
                                                WHEN EMAIL_OPT_IN THEN 'EMAIL' WHEN SMS_OPT_IN THEN 'SMS' END
           WHEN 'EMAIL_PUSH' THEN CASE WHEN EMAIL_OPT_IN THEN 'EMAIL' WHEN PUSH_ENABLED THEN 'PUSH' END
         END AS CHANNEL_CODE
  FROM cand WHERE IS_IN
)
SELECT ch.CAMPAIGN_ID, 'aud-' || ch.CAMPAIGN_ID, ch.CUSTOMER_KEY,
       IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'holdout')) % 100 < ch.HOLDOUT_PCT, 'HOLDOUT', 'TREATED'),
       ch.CHANNEL_CODE,
       IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'holdout')) % 100 < ch.HOLDOUT_PCT, NULL,
           IFF(ABS(HASH(ch.CUSTOMER_KEY, ch.CAMPAIGN_ID, 'variant')) % 2 = 0, 'A', 'B')),
       ch.START_DATE, ch.SEGMENT_NAME, ch.LOYALTY_TIER, ch.PROFILE_STATE, ch.HOME_STORE_CODE, ch.HOME_STATE, ch.RECENCY_DAYS,
       RECENCY_BAND(ch.RECENCY_DAYS), ch.LINES_12M, ch.SPEND_12M_AUD, ch.AOV_AUD, ch.PROMO_SHARE, ch.RFM_SEGMENT, ch.TRACK,
       ch.NEED_STATE, ch.RESPONSE_STATE, ch.DAYS_SINCE_FIRST_TRADE,
       IFF(ch.GROUP_DATA_CONSENT, COALESCE(ch.BIZ_STARTER_FLAG, FALSE), NULL),
       IFF(ch.GROUP_DATA_CONSENT, ch.SCHOOL_SIGNAL_CONFIDENCE, 'NOT_CONSENTED'),
       COALESCE(ch.SCHOOL_LIST_USED_LAST_YEAR, FALSE), ch.OW_REL, ch.GROUP_DATA_CONSENT, ch.DAYS_TO_SCHOOL_START,
       IS_RELEVANT_STATE(ch.NEED_STATE), ch.NEED_STATE = 'NO_SIGNAL_COLD',
       sp.BRAND_NAME IS NOT NULL
FROM chan ch
LEFT JOIN SUPPLY_POSITION sp ON sp.BRAND_NAME = ch.PROMOTED_BRAND AND sp.STORE_CODE = ch.HOME_STORE_CODE AND sp.STATUS = 'SHORT'
 AND sp.VALID_FROM <= ch.START_DATE + 28 AND sp.VALID_TO >= ch.START_DATE
WHERE ch.CHANNEL_CODE IS NOT NULL;

UPDATE AUDIENCE a SET SIZE_AT_SAVE = m.N, REACHABLE_AT_SAVE = m.N
FROM (SELECT AUDIENCE_ID, COUNT(*) AS N FROM AUDIENCE_MEMBER GROUP BY 1) m
WHERE m.AUDIENCE_ID = a.AUDIENCE_ID;

-- ---------- 4. The response simulator ----------
-- Turns a locked audience into events through P_THROUGH. Deterministic: run it
-- again with a later date and the earlier days come out identical, with the
-- new days added. P_PROVENANCE is MODELLED for the history, SIMULATED for a
-- campaign launched in the app.
CREATE OR REPLACE PROCEDURE GENERATE_EVENTS(P_CAMPAIGN_ID VARCHAR, P_THROUGH DATE, P_PROVENANCE VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  n_members NUMBER;
  n_events NUMBER;
BEGIN
  DELETE FROM ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_EVENT WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;

  CREATE OR REPLACE TEMPORARY TABLE GEN_DRAW AS
  WITH cmp AS (
    SELECT c.CAMPAIGN_ID, c.START_DATE, c.END_DATE, c.PROMOTED_CATEGORY, c.PROMOTED_BRAND, c.OFFER_ID,
           ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_TRACK(c.PROMOTED_CATEGORY) AS TRACK,
           DATEDIFF('day', c.START_DATE, c.END_DATE) + 1 AS WINDOW_DAYS,
           LEAST(:P_THROUGH, c.END_DATE) AS THROUGH_DATE
    FROM ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN c WHERE c.CAMPAIGN_ID = :P_CAMPAIGN_ID
  ), prm AS (
    SELECT p.* FROM ONEDIGITAL_DEMO.CAMPAIGN.RESPONSE_MODEL p CROSS JOIN cmp
    WHERE (p.SCOPE = 'CAMPAIGN' AND p.SCOPE_KEY = cmp.CAMPAIGN_ID) OR (p.SCOPE = 'TRACK' AND p.SCOPE_KEY = cmp.TRACK)
    QUALIFY ROW_NUMBER() OVER (ORDER BY IFF(p.SCOPE = 'CAMPAIGN', 0, 1)) = 1
  ), fat AS (
    SELECT DISTINCT m2.CUSTOMER_KEY
    FROM ONEDIGITAL_DEMO.CAMPAIGN.AUDIENCE_MEMBER m2
    JOIN ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN c2 ON c2.CAMPAIGN_ID = m2.CAMPAIGN_ID
    CROSS JOIN cmp
    WHERE m2.GROUP_CODE = 'TREATED' AND m2.CAMPAIGN_ID <> cmp.CAMPAIGN_ID
      AND c2.START_DATE BETWEEN DATEADD('day', -14, cmp.START_DATE) AND DATEADD('day', -1, cmp.START_DATE)
  ), m AS (
    SELECT am.CAMPAIGN_ID, am.CUSTOMER_KEY, am.GROUP_CODE, am.CHANNEL_CODE, am.VARIANT_CODE, am.SUPPRESSED_AT, am.AOV_AUD,
           COALESCE(am.STOCK_CONFLICT, FALSE) AS STOCK_CONFLICT,
           cmp.START_DATE, cmp.END_DATE, cmp.WINDOW_DAYS, cmp.THROUGH_DATE, cmp.TRACK, cmp.PROMOTED_BRAND,
           COALESCE(o.COST_PER_REDEMPTION, 0) AS REDEMPTION_COST, COALESCE(ch.COST_PER_SEND_AUD, 0) AS SEND_COST,
           prm.BASE_RATE, prm.UPLIFT, prm.CH_EMAIL, prm.CH_SMS, prm.CH_PUSH, prm.CH_SOCIAL, prm.CH_INSTORE, prm.VARIANT_B,
           prm.STOCK_EFFECT, prm.AVG_ORDER_AUD, prm.MARGIN_RATE,
           COALESCE(rs.BASE_MULT, 0.3) AS BASE_MULT, COALESCE(rs.UPLIFT_MULT, 0.1) AS UPLIFT_MULT,
           COALESCE(rs.SLEEPING_REL, 0) AS SLEEPING_REL, COALESCE(rs.UNSUB_MULT, 1) AS UNSUB_MULT,
           ONEDIGITAL_DEMO.CAMPAIGN.TIMING_FACTOR(cmp.TRACK, am.DAYS_TO_SCHOOL_START) AS TIMING,
           IFF(cmp.TRACK = 'BUSINESS' AND am.RESPONSE_STATE LIKE 'STARTER%', IFF(COALESCE(am.SIGNAL_AGE_DAYS, 0) <= 60, 1.0, 0.7), 1.0) AS FRESH,
           fat.CUSTOMER_KEY IS NOT NULL AS FATIGUED,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'cnv'))    % 1000000) / 1000000.0 AS U_CONV,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'day'))    % 1000000) / 1000000.0 AS U_DAY,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'bounce')) % 1000000) / 1000000.0 AS U_BOUNCE,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'open'))   % 1000000) / 1000000.0 AS U_OPEN,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'oday'))   % 1000000) / 1000000.0 AS U_ODAY,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'click'))  % 1000000) / 1000000.0 AS U_CLICK,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'click2')) % 1000000) / 1000000.0 AS U_CLICK2,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'unsub'))  % 1000000) / 1000000.0 AS U_UNSUB,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'compl'))  % 1000000) / 1000000.0 AS U_COMPL,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'value'))  % 1000000) / 1000000.0 AS U_VALUE,
           (ABS(HASH(am.CUSTOMER_KEY, am.CAMPAIGN_ID, 'redeem')) % 1000000) / 1000000.0 AS U_REDEEM
    FROM ONEDIGITAL_DEMO.CAMPAIGN.AUDIENCE_MEMBER am
    JOIN cmp ON cmp.CAMPAIGN_ID = am.CAMPAIGN_ID
    CROSS JOIN prm
    LEFT JOIN ONEDIGITAL_DEMO.CAMPAIGN.RESPONSE_STATE rs ON rs.TRACK = cmp.TRACK AND rs.NEED_STATE = am.RESPONSE_STATE
    LEFT JOIN ONEDIGITAL_DEMO.CAMPAIGN.OFFER o ON o.OFFER_ID = cmp.OFFER_ID
    LEFT JOIN ONEDIGITAL_DEMO.CAMPAIGN.CHANNEL ch ON ch.CHANNEL_CODE = am.CHANNEL_CODE
    LEFT JOIN fat ON fat.CUSTOMER_KEY = am.CUSTOMER_KEY
  ), p1 AS (
    SELECT m.*,
           LEAST(0.6, BASE_RATE * BASE_MULT) AS P_BASE,
           UPLIFT * UPLIFT_MULT * TIMING * FRESH
                  * DECODE(CHANNEL_CODE, 'EMAIL', CH_EMAIL, 'SMS', CH_SMS, 'PUSH', CH_PUSH, 'PAID_SOCIAL', CH_SOCIAL, 'IN_STORE', CH_INSTORE, 1.0)
                  * IFF(VARIANT_CODE = 'B', VARIANT_B, 1) AS U_POS,
           -- Suppressed before the send: never contacted, measured as treated.
           GROUP_CODE = 'TREATED' AND (SUPPRESSED_AT IS NULL OR SUPPRESSED_AT > START_DATE) AS SENT
    FROM m
  ), p2 AS (
    SELECT p1.*,
           CASE WHEN STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL THEN STOCK_EFFECT * P_BASE
                WHEN SLEEPING_REL < 0 THEN SLEEPING_REL * P_BASE
                ELSE U_POS END AS U_EFFECT,
           DATEADD('day', FLOOR(POWER(U_DAY, 1.6) * WINDOW_DAYS), START_DATE) AS CONV_DATE,
           DATEADD('day', IFF(U_ODAY < 0.7, 0, IFF(U_ODAY < 0.9, 1, 2)), START_DATE) AS OPEN_DATE
    FROM p1
  ), p3 AS (
    SELECT p2.*,
           SENT AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH')
             AND U_BOUNCE < DECODE(CHANNEL_CODE, 'EMAIL', 0.012, 'SMS', 0.006, 'PUSH', 0.020, 0) AS BOUNCED,
           IFF(SENT AND (SUPPRESSED_AT IS NULL OR CONV_DATE < SUPPRESSED_AT),
               U_CONV < GREATEST(0.001, LEAST(0.9, P_BASE + U_EFFECT)), U_CONV < P_BASE) AS CONVERTED
    FROM p2
  )
  SELECT p3.*,
         SENT AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH') AND NOT BOUNCED AS DELIVERED,
         SENT AND CHANNEL_CODE IN ('EMAIL', 'PUSH') AND NOT BOUNCED
           AND U_OPEN < DECODE(CHANNEL_CODE, 'EMAIL', 0.32, 'PUSH', 0.12, 0) * IFF(UPLIFT_MULT >= 0.5, 1.2, 1.0) AS OPENED,
         IFF(SENT AND NOT BOUNCED AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH'),
             U_UNSUB < DECODE(CHANNEL_CODE, 'EMAIL', 0.0022, 'SMS', 0.0045, 'PUSH', 0.0030, 0)
                       * UNSUB_MULT * IFF(STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL, 3, 1) * IFF(FATIGUED, 2, 1), FALSE) AS UNSUBSCRIBED,
         IFF(SENT AND NOT BOUNCED AND CHANNEL_CODE IN ('EMAIL', 'SMS', 'PUSH'),
             U_COMPL < 0.0003 * POWER(UNSUB_MULT, 1.2) * IFF(STOCK_CONFLICT AND PROMOTED_BRAND IS NOT NULL, 30, 1), FALSE) AS COMPLAINED,
         ROUND(AVG_ORDER_AUD * (0.7 + 0.6 * U_VALUE), 2) AS ORDER_VALUE
  FROM p3;

  SELECT COUNT(*) INTO :n_members FROM GEN_DRAW;

  INSERT INTO ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_EVENT
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
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'CLICK',
         IFF(CONVERTED AND U_CLICK >= 0.22, LEAST(CONV_DATE, OPEN_DATE), OPEN_DATE), NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW
  WHERE ((DELIVERED AND ((CHANNEL_CODE = 'EMAIL' AND OPENED AND U_CLICK < 0.22)
                       OR (CHANNEL_CODE = 'SMS' AND U_CLICK < 0.08)
                       OR (CHANNEL_CODE = 'PUSH' AND OPENED AND U_CLICK < 0.55)
                       OR (CONVERTED AND U_CLICK2 < 0.40 AND (OPENED OR CHANNEL_CODE = 'SMS'))))
         OR (SENT AND CHANNEL_CODE = 'PAID_SOCIAL' AND U_CLICK < 0.009))
    AND OPEN_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'CONVERT', CONV_DATE,
         ORDER_VALUE, ROUND(ORDER_VALUE * MARGIN_RATE, 2),
         IFF(SENT AND U_REDEEM < 0.70, REDEMPTION_COST, 0), NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE CONVERTED AND CONV_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'UNSUBSCRIBE', OPEN_DATE, NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE UNSUBSCRIBED AND OPEN_DATE <= THROUGH_DATE
  UNION ALL
  SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CHANNEL_CODE, VARIANT_CODE, 'COMPLAINT', DATEADD('day', 1, OPEN_DATE), NULL, NULL, NULL, NULL, :P_PROVENANCE
  FROM GEN_DRAW WHERE COMPLAINED AND DATEADD('day', 1, OPEN_DATE) <= THROUGH_DATE;
  n_events := SQLROWCOUNT;

  RETURN OBJECT_CONSTRUCT('campaign_id', :P_CAMPAIGN_ID, 'through', :P_THROUGH, 'members', n_members, 'events', n_events);
END;
$$;

-- Fast-forward a launched campaign by P_DAYS of simulated time. Moves it to
-- COMPLETED when the window ends, and records who did it.
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
  FROM ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;
  IF (st IS NULL OR st NOT IN ('LIVE', 'SCHEDULED')) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Only a live or scheduled campaign can be fast-forwarded; this one is ' || COALESCE(st, 'missing') || '.');
  END IF;
  next_through := LEAST(end_date, DATEADD('day', GREATEST(1, LEAST(P_DAYS, 60)), COALESCE(through_date, DATEADD('day', -1, start_date))));
  gen := (CALL ONEDIGITAL_DEMO.CAMPAIGN.GENERATE_EVENTS(:P_CAMPAIGN_ID, :next_through, 'SIMULATED'));
  UPDATE ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN
     SET SIMULATED_THROUGH = :next_through,
         STATUS = IFF(:next_through >= END_DATE, 'COMPLETED', 'LIVE'),
         UPDATED_BY = :P_USER, UPDATED_AT = CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ
   WHERE CAMPAIGN_ID = :P_CAMPAIGN_ID;
  IF (st = 'SCHEDULED') THEN
    INSERT INTO ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_STATUS_LOG VALUES
      (:P_CAMPAIGN_ID, 'SCHEDULED', 'LIVE', 'Start date reached in simulation.', :P_USER, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ);
  END IF;
  IF (next_through >= end_date) THEN
    INSERT INTO ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_STATUS_LOG VALUES
      (:P_CAMPAIGN_ID, 'LIVE', 'COMPLETED', 'End date reached in simulation.', :P_USER, CONVERT_TIMEZONE('Australia/Sydney', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ);
  END IF;
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
    CALL ONEDIGITAL_DEMO.CAMPAIGN.GENERATE_EVENTS(:id, :d, 'MODELLED');
  END FOR;
  RETURN 'ok';
END;
$$;

-- ---------- 6. Lifecycle trail ----------
INSERT INTO CAMPAIGN_STATUS_LOG (CAMPAIGN_ID, FROM_STATUS, TO_STATUS, REASON, CHANGED_BY, CHANGED_AT)
WITH steps AS (
  SELECT * FROM VALUES
    (1, NULL,               'BRIEF',            'Brief written.',                                     -28),
    (2, 'BRIEF',            'AUDIENCE_LOCKED',  'Audience locked with a randomised holdout.',         -14),
    (3, 'AUDIENCE_LOCKED',  'CONTENT_APPROVED', 'Variants A and B passed content QA.',                -7),
    (4, 'CONTENT_APPROVED', 'SCHEDULED',        'Channel plan approved within budget.',               -3),
    (5, 'SCHEDULED',        'LIVE',             'Sent.',                                              0)
  AS t(N, FROM_STATUS, TO_STATUS, REASON, OFFSET_DAYS)
)
SELECT h.CAMPAIGN_ID, s.FROM_STATUS, s.TO_STATUS, s.REASON, 'Priya Shah',
       DATEADD('hour', 9 + s.N, DATEADD('day', s.OFFSET_DAYS, h.START_DATE)::TIMESTAMP_NTZ)
FROM HISTORY_DEF h CROSS JOIN steps s
UNION ALL
SELECT CAMPAIGN_ID, 'LIVE', 'COMPLETED', 'Campaign window ended.', 'system', DATEADD('hour', 23, END_DATE::TIMESTAMP_NTZ)
FROM HISTORY_DEF WHERE FINAL_STATUS = 'MEASURED'
UNION ALL
SELECT CAMPAIGN_ID, 'COMPLETED', 'MEASURED', 'Lift read against the holdout and learnings published.', 'Priya Shah',
       DATEADD('hour', 10, DATEADD('day', 10, END_DATE)::TIMESTAMP_NTZ)
FROM HISTORY_DEF WHERE FINAL_STATUS = 'MEASURED';

-- ---------- 7. Creative ----------
INSERT INTO CONTENT_VARIANT (VARIANT_ID, CAMPAIGN_ID, VARIANT_CODE, ANGLE, SUBJECT, PREHEADER, BODY, SMS_TEXT, PUSH_TITLE, PUSH_BODY, CTA,
                             QA, QA_STATUS, STATUS, APPROVED_BY, APPROVED_AT, CREATED_BY, CREATED_AT)
SELECT v.column1 || '-' || v.column2, v.column1, v.column2, v.column3, v.column4, v.column5, v.column6, v.column7, v.column8, v.column9, v.column10,
       PARSE_JSON('{"checks":[{"check":"Channel length limits","result":"PASS"},{"check":"Offer terms match the catalogue","result":"PASS"},{"check":"Products in range","result":"PASS"},{"check":"Claims","result":"PASS"}],"judge":{"brand_voice":4,"claims_risk":"LOW","tone_fit":4}}'),
       'PASS', 'APPROVED', 'Priya Shah', DATEADD('day', -7, h.START_DATE)::TIMESTAMP_NTZ, 'Priya Shah', DATEADD('day', -9, h.START_DATE)::TIMESTAMP_NTZ
FROM VALUES
  ('camp-h01', 'A', 'Save', 'Back to school: $10 off $100', 'School supplies, sorted early',
   'Get the school shop done early and take $10 off when you spend $100 on school supplies.', NULL, NULL, NULL, 'Shop back to school'),
  ('camp-h01', 'B', 'Checklist', 'Your back-to-school checklist', 'Everything for day one, plus $10 off',
   'Stationery, calculators, laptops and bags in one shop, and $10 off a $100 school order.', NULL, NULL, NULL, 'See the checklist'),
  ('camp-h02', 'A', 'Save time', 'Your school list, packed for you', 'Upload it, we pick and pack it',
   'Upload your school''s booklist and we will pick and pack the lot, ready to collect or delivered.',
   'Officeworks: Upload your school list and we''ll pack it for you. officeworks.com.au/schoollists Opt out: reply STOP', NULL, NULL, 'Upload my list'),
  ('camp-h02', 'B', 'We pack it', 'School list stress? We have it covered', 'Ready before the first day',
   'Skip the aisles: send us your school''s list and collect it packed before school goes back.',
   'Officeworks: School list sorted - we pick & pack it before school starts. officeworks.com.au/schoollists Opt out: reply STOP', NULL, NULL, 'Get it packed'),
  ('camp-h03', 'A', 'Set up', 'Set up your business: $150 off a laptop and printer', 'For new business customers',
   'Starting out? Save $150 when you buy a laptop and printer together with a free Officeworks business account.',
   'Officeworks: New business? $150 off a laptop + printer with a free business account. officeworks.com.au/business Opt out: reply STOP', NULL, NULL, 'Set up my business'),
  ('camp-h03', 'B', 'Look the part', 'Look like a business from day one', 'Laptop, printer, cards and signs',
   'Quotes, invoices, business cards and signs for the ute: get set up in one shop and save $150 on a laptop and printer.',
   'Officeworks: Cards, signs, laptop & printer - $150 off the tech for new businesses. officeworks.com.au/business Opt out: reply STOP', NULL, NULL, 'Get set up'),
  ('camp-h04', 'A', 'Business account', 'Open a free Officeworks business account', 'Business pricing and 30-day terms',
   'Business pricing on bulk orders and 30-day account terms, free to join.', NULL, NULL, NULL, 'Open an account'),
  ('camp-h04', 'B', 'For trades', 'Built for trades: a free business account', 'Quotes, invoices and print, sorted',
   'Print quotes, invoices and signs on business pricing. Free to join.', NULL, NULL, NULL, 'Join free'),
  ('camp-h05', 'A', 'Upgrade', 'Upgrade your home office: 15% off', 'Chairs and desks built for the work day',
   'Trade up to an ergonomic chair or a sit-stand desk and save 15%.', NULL, NULL, NULL, 'Shop furniture'),
  ('camp-h05', 'B', 'Comfort', 'Your back will thank you', '15% off ergonomic chairs and desks',
   'Work in comfort with an ergonomic mesh chair or a height-adjustable desk, 15% off.', NULL, NULL, NULL, 'Find my chair'),
  ('camp-l01', 'A', 'Black Friday', 'Black Friday: up to 20% off laptops', 'Laptops and printers, this week only',
   'Selected laptops and printers up to 20% off for Black Friday, including the MacBook Air.', NULL, 'Black Friday tech', 'Up to 20% off laptops and printers.', 'Shop tech'),
  ('camp-l01', 'B', 'Upgrade', 'Time for a new laptop?', 'Up to 20% off for Black Friday',
   'Upgrade to a faster laptop this Black Friday, up to 20% off selected models.', NULL, 'Time to upgrade?', 'Up to 20% off selected laptops.', 'Find a laptop')
  AS v
JOIN HISTORY_DEF h ON h.CAMPAIGN_ID = v.column1;

-- ---------- 8. Channel plans, from the members actually assigned ----------
INSERT INTO CHANNEL_PLAN (CAMPAIGN_ID, CHANNEL_CODE, MEMBERS, COST_AUD, SEND_DAY, SEND_HOUR, RATIONALE, CREATED_BY, CREATED_AT)
SELECT m.CAMPAIGN_ID, m.CHANNEL_CODE, COUNT_IF(m.GROUP_CODE = 'TREATED'),
       ROUND(COUNT_IF(m.GROUP_CODE = 'TREATED') * ch.COST_PER_SEND_AUD, 2),
       DAYNAME(h.START_DATE), DECODE(m.CHANNEL_CODE, 'SMS', 11, 'PUSH', 19, 8),
       DECODE(h.CHANNEL_RULE, 'EMAIL_SMS_TEST', 'Randomised email vs SMS test where both are consented.',
                              'PREFERRED_EMAIL_SMS', 'Each member on their preferred channel.',
                              'EMAIL_PUSH', 'Email where consented, app push otherwise.',
                              'Single channel.'),
       'Priya Shah', DATEADD('day', -3, h.START_DATE)::TIMESTAMP_NTZ
FROM AUDIENCE_MEMBER m
JOIN HISTORY_DEF h ON h.CAMPAIGN_ID = m.CAMPAIGN_ID
JOIN CHANNEL ch ON ch.CHANNEL_CODE = m.CHANNEL_CODE
GROUP BY m.CAMPAIGN_ID, m.CHANNEL_CODE, ch.COST_PER_SEND_AUD, h.START_DATE, h.CHANNEL_RULE;

-- ---------- 9. Lift by dimension, and the learnings it publishes ----------
-- One row per member and dimension: the app's lift-by tables, TestHypothesis and
-- the learnings all read this view, so a dimension means the same everywhere.
CREATE OR REPLACE VIEW VW_MEMBER_DIM
  COMMENT = 'One row per campaign member and dimension, with whether they converted. Lift is computed from it by campaign and value.'
AS
WITH conv AS (SELECT DISTINCT CAMPAIGN_ID, CUSTOMER_KEY FROM ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_EVENT WHERE EVENT_TYPE = 'CONVERT'),
mm AS (
  SELECT am.*, cv.CUSTOMER_KEY IS NOT NULL AS CONVERTED
  FROM ONEDIGITAL_DEMO.CAMPAIGN.AUDIENCE_MEMBER am
  LEFT JOIN conv cv ON cv.CAMPAIGN_ID = am.CAMPAIGN_ID AND cv.CUSTOMER_KEY = am.CUSTOMER_KEY
)
SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Channel' AS DIM, CHANNEL_CODE AS VAL FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Home state', HOME_STATE FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Need state', NEED_STATE FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Business starter (Bunnings)',
                 CASE WHEN NOT GROUP_DATA_CONSENT THEN 'No data-sharing consent' WHEN BIZ_STARTER THEN 'Yes' ELSE 'No' END
          FROM mm WHERE TRACK = 'BUSINESS'
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'School signal (Kmart)', SCHOOL_SIGNAL FROM mm WHERE TRACK = 'SCHOOL'
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Used school list last year', IFF(SCHOOL_LIST_USER, 'Yes', 'No') FROM mm WHERE TRACK = 'SCHOOL'
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Officeworks relationship', OW_RELATIONSHIP FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Last purchase', RECENCY_BAND FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Membership', LOYALTY_TIER FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Needs the product', IFF(COALESCE(IS_RELEVANT, FALSE), 'Yes', 'No') FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Cold contact (no need, never shopped Officeworks)', IFF(COALESCE(COLD_CONTACT, FALSE), 'Yes', 'No') FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Home store short of promoted brand', IFF(COALESCE(STOCK_CONFLICT, FALSE), 'Yes', 'No') FROM mm
UNION ALL SELECT CAMPAIGN_ID, CUSTOMER_KEY, GROUP_CODE, CONVERTED, 'Uplift quadrant', UPLIFT_QUADRANT FROM mm WHERE UPLIFT_QUADRANT IS NOT NULL;

-- The learnings the history published, templated from the numbers the way the
-- app's Publish button writes them: the overall lift, and every value of a
-- targeting dimension (need, signal, channel, cold contact, stock) whose lift is
-- significant with at least 150 held out.
INSERT INTO LEARNING
WITH d AS (
  SELECT CAMPAIGN_ID, DIM, COALESCE(VAL, 'Unknown') AS VAL,
         COUNT_IF(GROUP_CODE = 'TREATED') AS TN, COUNT_IF(GROUP_CODE = 'TREATED' AND CONVERTED) AS TC,
         COUNT_IF(GROUP_CODE = 'HOLDOUT') AS HN, COUNT_IF(GROUP_CODE = 'HOLDOUT' AND CONVERTED) AS HC
  FROM VW_MEMBER_DIM
  WHERE DIM IN ('Channel', 'Need state', 'Business starter (Bunnings)', 'School signal (Kmart)', 'Used school list last year',
                'Cold contact (no need, never shopped Officeworks)', 'Home store short of promoted brand')
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT CAMPAIGN_ID, 'Overall', 'All members', COUNT_IF(GROUP_CODE = 'TREATED'), COUNT_IF(GROUP_CODE = 'TREATED' AND CONVERTED),
         COUNT_IF(GROUP_CODE = 'HOLDOUT'), COUNT_IF(GROUP_CODE = 'HOLDOUT' AND CONVERTED)
  FROM VW_MEMBER_DIM WHERE DIM = 'Channel' GROUP BY 1
), l AS (
  SELECT d.*, TC / NULLIF(TN, 0) AS TR, HC / NULLIF(HN, 0) AS HR, MAX(IFF(DIM = 'Overall', TN, 0)) OVER (PARTITION BY CAMPAIGN_ID) AS ALL_TN,
         (TC / NULLIF(TN, 0) - HC / NULLIF(HN, 0)) * 100 AS LIFT,
         SQRT((TC / NULLIF(TN, 0)) * (1 - TC / NULLIF(TN, 0)) / NULLIF(TN, 0) + (HC / NULLIF(HN, 0)) * (1 - HC / NULLIF(HN, 0)) / NULLIF(HN, 0)) * 100 AS SE
  FROM d
), m AS (
  SELECT l.*, LIFT - 1.959964 * SE AS LO, LIFT + 1.959964 * SE AS HI,
         SE > 0 AND (LIFT - 1.959964 * SE > 0 OR LIFT + 1.959964 * SE < 0) AS SIG, c.NAME, c.STATUS, c.END_DATE,
         ROW_NUMBER() OVER (PARTITION BY l.CAMPAIGN_ID ORDER BY IFF(l.DIM = 'Overall', 0, 1), l.DIM, l.VAL) AS RN
  FROM l JOIN CAMPAIGN c ON c.CAMPAIGN_ID = l.CAMPAIGN_ID
  WHERE c.STATUS = 'MEASURED'
    AND (l.DIM = 'Overall' OR (l.HN >= 150 AND SE > 0 AND (LIFT - 1.959964 * SE > 0 OR LIFT + 1.959964 * SE < 0)
                               -- a value every member shares says nothing the overall does not
                               AND l.TN < l.ALL_TN))
)
SELECT CAMPAIGN_ID || '-L' || RN, CAMPAIGN_ID, DIM, VAL, TN, HN, TR, HR, LIFT, LO, HI, SIG, NULL,
       IFF(DIM = 'Overall',
           NAME || ': ' || IFF(LIFT >= 0, '+', '') || TO_CHAR(ROUND(LIFT, 1), 'FM990.0') || ' pts lift over holdout (95% CI '
             || IFF(LO >= 0, '+', '') || TO_CHAR(ROUND(LO, 1), 'FM990.0') || ' pts to ' || IFF(HI >= 0, '+', '') || TO_CHAR(ROUND(HI, 1), 'FM990.0') || ' pts)'
             || IFF(SIG, '', ', not significant') || '.',
           DIM || ' = ' || VAL || ': ' || IFF(LIFT >= 0, '+', '') || TO_CHAR(ROUND(LIFT, 1), 'FM990.0') || ' pts lift (95% CI '
             || IFF(LO >= 0, '+', '') || TO_CHAR(ROUND(LO, 1), 'FM990.0') || ' pts to ' || IFF(HI >= 0, '+', '') || TO_CHAR(ROUND(HI, 1), 'FM990.0') || ' pts) in '
             || NAME || IFF(LIFT < 0, ' -- contact LOWERED conversion', '') || '.'),
       'PUBLISHED', 'Priya Shah', DATEADD('hour', 10, DATEADD('day', 10, END_DATE)::TIMESTAMP_NTZ)
FROM m;

-- One cross-campaign learning: the same Kmart HIGH-signal households, nine weeks
-- before school (camp-h01) and three weeks before (camp-h02).
INSERT INTO LEARNING
WITH x AS (
  SELECT CAMPAIGN_ID, COUNT_IF(GROUP_CODE = 'TREATED') AS TN, COUNT_IF(GROUP_CODE = 'TREATED' AND CONVERTED) AS TC,
         COUNT_IF(GROUP_CODE = 'HOLDOUT') AS HN, COUNT_IF(GROUP_CODE = 'HOLDOUT' AND CONVERTED) AS HC
  FROM VW_MEMBER_DIM WHERE DIM = 'School signal (Kmart)' AND VAL = 'HIGH' AND CAMPAIGN_ID IN ('camp-h01', 'camp-h02') GROUP BY 1
), l AS (SELECT x.*, (TC / TN - HC / HN) * 100 AS LIFT FROM x)
SELECT 'timing-L1', 'camp-h02', 'Timing', 'Weeks before school starts', a.TN, a.HN, a.TC / a.TN, a.HC / a.HN, a.LIFT, NULL, NULL, TRUE, NULL,
       'Timing: Kmart HIGH-signal households lifted ' || TO_CHAR(ROUND(a.LIFT, 1), 'FM990.0') || ' pts when invited three weeks before school started (camp-h02) against '
         || TO_CHAR(ROUND(b.LIFT, 1), 'FM990.0') || ' pts nine weeks before (camp-h01, with a $10 offer). Send close to each state''s Term 1 start.',
       'PUBLISHED', 'Priya Shah', '2026-02-12 10:00:00'::TIMESTAMP_NTZ
FROM l a JOIN l b ON a.CAMPAIGN_ID = 'camp-h02' AND b.CAMPAIGN_ID = 'camp-h01';
