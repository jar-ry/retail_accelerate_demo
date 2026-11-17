-- ============================================================
-- OneDigital Campaign Manager — what the agents can read (od_44)
--
--   SV_CAMPAIGN_RESULTS   campaigns, their members (treated and holdout) and
--                         outcomes by every targeting dimension, and published
--                         learnings. Lift is treated rate minus holdout rate.
--   SV_CUSTOMER_SIGNALS   the Bunnings business-starter signal, the Kmart
--                         school-age signal, Officeworks relationship, value and
--                         consent, AGGREGATE ONLY: no customer key is exposed.
--   CMP_PLAYBOOK_SEARCH   Cortex Search over the playbook: how each signal is
--                         built and where it is weak, the data-sharing rule,
--                         school term dates, the offers and the learnings.
--   OPPORTUNITY           every candidate play sized and valued the way the
--                         audience builder does it (cells learned from the
--                         history), ranked by expected incremental margin.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE OD_WH;
USE SCHEMA ONEDIGITAL_DEMO.CAMPAIGN;

-- ---------- 1. Campaign results ----------
CREATE OR REPLACE VIEW VW_CAMPAIGN_MEMBER_OUTCOME
  COMMENT = 'One row per campaign member (TREATED or HOLDOUT) with the signals they had and their outcome.'
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
         SUM(COALESCE(SEND_COST_AUD, 0) + COALESCE(OFFER_COST_AUD, 0)) AS COST_AUD
  FROM ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN_EVENT GROUP BY 1, 2
)
SELECT am.CAMPAIGN_ID, am.CUSTOMER_KEY, am.GROUP_CODE, am.CHANNEL_CODE, am.VARIANT_CODE, am.HOME_STATE, am.SEGMENT_NAME,
       am.LOYALTY_TIER AS MEMBERSHIP, am.RECENCY_BAND, am.RFM_SEGMENT, am.UPLIFT_QUADRANT, am.NEED_STATE, am.OW_RELATIONSHIP,
       CASE WHEN am.TRACK <> 'BUSINESS' THEN NULL WHEN NOT am.GROUP_DATA_CONSENT THEN 'No data-sharing consent'
            WHEN am.BIZ_STARTER THEN 'Yes' ELSE 'No' END AS BUSINESS_STARTER,
       IFF(am.TRACK = 'SCHOOL', am.SCHOOL_SIGNAL, NULL) AS SCHOOL_SIGNAL,
       IFF(am.TRACK = 'SCHOOL', IFF(am.SCHOOL_LIST_USER, 'Yes', 'No'), NULL) AS USED_SCHOOL_LIST_LAST_YEAR,
       IFF(COALESCE(am.COLD_CONTACT, FALSE), 'Yes', 'No') AS COLD_CONTACT,
       IFF(COALESCE(am.STOCK_CONFLICT, FALSE), 'Yes', 'No') AS HOME_STORE_SHORT,
       IFF(COALESCE(am.IS_RELEVANT, FALSE), 'Yes', 'No') AS NEEDS_PRODUCT,
       IFF(am.SUPPRESSED_AT IS NULL, 'No', 'Yes') AS SUPPRESSED,
       COALESCE(e.CONVERTED, 0) AS CONVERTED, COALESCE(e.REVENUE_AUD, 0) AS REVENUE_AUD, COALESCE(e.MARGIN_AUD, 0) AS MARGIN_AUD,
       COALESCE(e.OPENED, 0) AS OPENED, COALESCE(e.CLICKED, 0) AS CLICKED, COALESCE(e.UNSUBSCRIBED, 0) AS UNSUBSCRIBED,
       COALESCE(e.COMPLAINED, 0) AS COMPLAINED, COALESCE(e.COST_AUD, 0) AS COST_AUD
FROM ONEDIGITAL_DEMO.CAMPAIGN.AUDIENCE_MEMBER am
LEFT JOIN e ON e.CAMPAIGN_ID = am.CAMPAIGN_ID AND e.CUSTOMER_KEY = am.CUSTOMER_KEY;

CREATE OR REPLACE SEMANTIC VIEW SV_CAMPAIGN_RESULTS
  TABLES (
    campaigns AS ONEDIGITAL_DEMO.CAMPAIGN.CAMPAIGN PRIMARY KEY (CAMPAIGN_ID)
      WITH SYNONYMS ('campaign', 'CRM campaign', 'send')
      COMMENT = 'Every Officeworks CRM campaign and where it is in its lifecycle',
    members AS ONEDIGITAL_DEMO.CAMPAIGN.VW_CAMPAIGN_MEMBER_OUTCOME
      WITH SYNONYMS ('audience members', 'treated', 'holdout', 'control group')
      COMMENT = 'One row per campaign member: TREATED (contacted) or HOLDOUT (randomly held back, never contacted), their signals and what they did',
    learnings AS ONEDIGITAL_DEMO.CAMPAIGN.LEARNING PRIMARY KEY (LEARNING_ID)
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
      SAMPLE_VALUES ('LIVE', 'MEASURED', 'BRIEF'),
    campaigns.objective AS OBJECTIVE,
    campaigns.promoted_category AS PROMOTED_CATEGORY WITH SYNONYMS ('category')
      SAMPLE_VALUES ('Business Essentials', 'Back to School', 'Technology', 'Furniture'),
    campaigns.promoted_brand AS PROMOTED_BRAND WITH SYNONYMS ('brand'),
    campaigns.offer_id AS OFFER_ID,
    campaigns.start_date AS START_DATE,
    campaigns.end_date AS END_DATE,
    members.group_code AS GROUP_CODE WITH SYNONYMS ('arm', 'treated or holdout') COMMENT = 'TREATED or HOLDOUT'
      SAMPLE_VALUES ('TREATED', 'HOLDOUT') IS_ENUM,
    members.channel AS CHANNEL_CODE SAMPLE_VALUES ('EMAIL', 'SMS', 'PUSH', 'PAID_SOCIAL', 'IN_STORE') IS_ENUM,
    members.variant AS VARIANT_CODE COMMENT = 'Creative variant A or B (treated members only)',
    members.home_state AS HOME_STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    members.segment AS SEGMENT_NAME WITH SYNONYMS ('marketing segment'),
    members.membership AS MEMBERSHIP SAMPLE_VALUES ('OnePass', 'Standard') IS_ENUM,
    members.recency_band AS RECENCY_BAND WITH SYNONYMS ('last purchase') SAMPLE_VALUES ('0-90d', '91-180d', '181-365d', '365d+', 'NONE') IS_ENUM,
    members.need_state AS NEED_STATE COMMENT = 'What the member needed from the campaign: STARTER_NEW, STARTER_OW, TRADE_ESTABLISHED, LIST_USER, SCHOOL_STARTING, SCHOOL_HIGH, SCHOOL_MEDIUM, SCHOOL_LOW, TECH_OWNER, TECH_RECENT, HOME_OFFICE, OW_ACTIVE, OW_LAPSED or NO_SIGNAL_COLD',
    members.officeworks_relationship AS OW_RELATIONSHIP SAMPLE_VALUES ('Business buyer', 'Active shopper', 'Lapsed shopper', 'Never shopped') IS_ENUM,
    members.business_starter AS BUSINESS_STARTER COMMENT = 'Business campaigns only: Yes when the member was a new business starter from the Bunnings trade signal'
      SAMPLE_VALUES ('Yes', 'No', 'No data-sharing consent') IS_ENUM,
    members.school_signal AS SCHOOL_SIGNAL COMMENT = 'Back to school campaigns only: the Kmart school-age signal confidence, or NOT_CONSENTED'
      SAMPLE_VALUES ('HIGH', 'MEDIUM', 'LOW', 'NONE', 'NOT_CONSENTED') IS_ENUM,
    members.used_school_list AS USED_SCHOOL_LIST_LAST_YEAR COMMENT = 'Back to school campaigns only: used the school list service the year before' IS_ENUM,
    members.cold_contact AS COLD_CONTACT COMMENT = 'Yes when the member showed no need and had never shopped at Officeworks' IS_ENUM,
    members.uplift_quadrant AS UPLIFT_QUADRANT SAMPLE_VALUES ('PERSUADABLE', 'SURE_THING', 'LOST_CAUSE', 'SLEEPING_DOG') IS_ENUM,
    members.home_store_short AS HOME_STORE_SHORT COMMENT = 'Yes when the member''s Officeworks store was short of the promoted brand' IS_ENUM,
    members.needs_product AS NEEDS_PRODUCT COMMENT = 'Yes when the member''s signals make the promoted range relevant' IS_ENUM,
    members.suppressed AS SUPPRESSED IS_ENUM,
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
  COMMENT = 'Officeworks CRM campaign results measured against randomised holdouts. Campaign history is MODELLED; campaigns launched in the app are SIMULATED.'
  AI_SQL_GENERATION 'Lift is always treated rate minus holdout rate WITHIN the same campaign and the same group of members; use the lift_pts metric and never average rates across campaigns or rows. Revenue from treated members is not incremental. When comparing groups (need state, school signal, business starter, channel, cold contact), group by that dimension and the campaign. Round to 2 decimals.';

-- ---------- 2. Customer signals, aggregate only ----------
CREATE OR REPLACE VIEW SCHOOL_TERM_NEXT
  COMMENT = 'The next Term 1 start in each state after the demo clock.'
AS
SELECT STATE, MIN(START_DATE) AS START_DATE FROM ONEDIGITAL_DEMO.CURATED.DIM_SCHOOL_TERM
WHERE START_DATE > ONEDIGITAL_DEMO.CAMPAIGN.CMP_AS_OF() GROUP BY 1;

CREATE OR REPLACE TABLE CUSTOMER_SIGNALS
  COMMENT = 'OnePass members by signal, value, Officeworks relationship and consent, without any customer key, for counting audiences. As of CMP_AS_OF().'
AS
SELECT f.SEGMENT_NAME, f.LOYALTY_TIER AS MEMBERSHIP, f.HOME_STATE, f.AGE_BAND, f.RECENCY_BAND, f.RFM_SEGMENT, f.OW_RELATIONSHIP,
       f.BANNERS_12M, f.SPEND_12M_AUD, f.BUNNINGS_SPEND_12M, f.KMART_SPEND_12M, f.OW_SPEND_12M,
       f.BIZ_STARTER_FLAG, f.BIZ_STARTER_SCORE, f.TRADE_CLASSES_90D, f.PRIOR_TRADE_HISTORY, f.TRADE_TYPE, f.OW_BUSINESS_BUYER,
       f.SCHOOL_SIGNAL_CONFIDENCE, f.EST_SCHOOL_AGE_KIDS, f.YOUNGEST_KID_AGE_EST, f.STARTING_SCHOOL_LIKELY, f.SCHOOL_LIST_USED_LAST_YEAR,
       f.DAYS_TO_SCHOOL_START, f.NEXT_SCHOOL_START, f.HOME_OFFICE_12M, f.TECH_LAST_DAYS,
       ct.EMAIL_OPT_IN, ct.SMS_OPT_IN, ct.PUSH_ENABLED, ct.IS_CONTACTABLE, ct.GROUP_DATA_CONSENT, ct.PREFERRED_CHANNEL
FROM ONEDIGITAL_DEMO.CAMPAIGN.CUSTOMER_FEATURES f
JOIN ONEDIGITAL_DEMO.CAMPAIGN.CUSTOMER_CONTACT ct ON ct.CUSTOMER_KEY = f.CUSTOMER_KEY;

CREATE OR REPLACE SEMANTIC VIEW SV_CUSTOMER_SIGNALS
  TABLES (
    customers AS ONEDIGITAL_DEMO.CAMPAIGN.CUSTOMER_SIGNALS
      WITH SYNONYMS ('customers', 'members', 'OnePass members', 'shoppers', 'households')
      COMMENT = 'Every OnePass member with the Bunnings business-starter signal, the Kmart school-age signal, Officeworks relationship, value and consent. Aggregate only.'
  )
  FACTS (
    customers.spend_12m AS SPEND_12M_AUD COMMENT = 'Spend across all three banners in 12 months, AUD',
    customers.bunnings_spend AS BUNNINGS_SPEND_12M, customers.kmart_spend AS KMART_SPEND_12M, customers.officeworks_spend AS OW_SPEND_12M,
    customers.biz_score AS BIZ_STARTER_SCORE COMMENT = 'Business-starter score 0-100 from the Bunnings trade cluster',
    customers.trade_classes AS TRADE_CLASSES_90D COMMENT = 'Distinct trade categories bought at Bunnings in 90 days (of six)',
    customers.school_kids AS EST_SCHOOL_AGE_KIDS COMMENT = 'Estimated school-age children from Kmart kids shoe sizes (an imperfect proxy)',
    customers.youngest_age AS YOUNGEST_KID_AGE_EST COMMENT = 'Estimated age of the youngest child at the next school start, years',
    customers.days_to_school AS DAYS_TO_SCHOOL_START COMMENT = 'Days from 13 Nov 2026 to the member''s state Term 1 start'
  )
  DIMENSIONS (
    customers.segment AS SEGMENT_NAME SAMPLE_VALUES ('Established Families', 'Young Families', 'Young Singles & Couples', 'Home Improvers', 'Tradies & DIYers', 'Empty Nesters'),
    customers.membership AS MEMBERSHIP SAMPLE_VALUES ('OnePass', 'Standard') IS_ENUM,
    customers.home_state AS HOME_STATE WITH SYNONYMS ('state') SAMPLE_VALUES ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT') IS_ENUM,
    customers.recency_band AS RECENCY_BAND SAMPLE_VALUES ('0-90d', '91-180d', '181-365d', '365d+', 'NONE') IS_ENUM,
    customers.officeworks_relationship AS OW_RELATIONSHIP SAMPLE_VALUES ('Business buyer', 'Active shopper', 'Lapsed shopper', 'Never shopped') IS_ENUM,
    customers.business_starter AS BIZ_STARTER_FLAG WITH SYNONYMS ('new business', 'business starter', 'starting a business')
      COMMENT = 'TRUE when the member bought 3+ trade categories at Bunnings in 90 days with no trade buying before: setting up a business',
    customers.prior_trade AS PRIOR_TRADE_HISTORY COMMENT = 'TRUE when the member bought trade gear 4-16 months ago: an established tradie, not a starter',
    customers.trade_type AS TRADE_TYPE SAMPLE_VALUES ('Electrical', 'Plumbing', 'Carpentry', 'Landscaping', 'Cleaning'),
    customers.officeworks_business_buyer AS OW_BUSINESS_BUYER COMMENT = 'Already buys ink, paper and print for a business at Officeworks',
    customers.school_signal AS SCHOOL_SIGNAL_CONFIDENCE WITH SYNONYMS ('school-age children', 'school signal', 'kids')
      COMMENT = 'Kmart school-age signal: HIGH (school-age shoe sizes and school items), MEDIUM (one or the other), LOW (toddler sizes or only December gift buying), NONE'
      SAMPLE_VALUES ('HIGH', 'MEDIUM', 'LOW', 'NONE') IS_ENUM,
    customers.starting_school AS STARTING_SCHOOL_LIKELY COMMENT = 'A child likely starting school next year',
    customers.school_list_user AS SCHOOL_LIST_USED_LAST_YEAR COMMENT = 'Used the Officeworks school list service last year',
    customers.next_school_start AS NEXT_SCHOOL_START,
    customers.home_office AS HOME_OFFICE_12M COMMENT = 'Bought home-office items at Kmart in 12 months',
    customers.email_opt_in AS EMAIL_OPT_IN, customers.sms_opt_in AS SMS_OPT_IN, customers.push_enabled AS PUSH_ENABLED,
    customers.contactable AS IS_CONTACTABLE,
    customers.group_consent AS GROUP_DATA_CONSENT WITH SYNONYMS ('data sharing consent', 'cross-banner consent')
      COMMENT = 'OnePass group data-sharing consent: required to use Bunnings or Kmart purchases in Officeworks marketing',
    customers.preferred_channel AS PREFERRED_CHANNEL
  )
  METRICS (
    customers.customers AS COUNT(*) COMMENT = 'Number of members',
    customers.contactable_customers AS COUNT_IF(customers.IS_CONTACTABLE),
    customers.consented_contactable AS COUNT_IF(customers.IS_CONTACTABLE AND customers.GROUP_DATA_CONSENT)
      COMMENT = 'Contactable members who also consented to group data sharing: the most a cross-banner audience can reach',
    customers.email_consented AS COUNT_IF(customers.EMAIL_OPT_IN),
    customers.sms_consented AS COUNT_IF(customers.SMS_OPT_IN),
    customers.total_spend_12m AS ROUND(SUM(customers.spend_12m)),
    customers.avg_officeworks_spend AS ROUND(AVG(customers.officeworks_spend), 2)
  )
  COMMENT = 'OnePass members for sizing Officeworks opportunities. Purchases are SYNTHETIC demo data; consent is MODELLED.'
  AI_SQL_GENERATION 'Only aggregate: never return individual customers. Signals are as of 2026-11-13. When sizing a cross-banner audience (business starter, school signal, home office), count only GROUP_DATA_CONSENT members.';

-- ---------- 3. The playbook, searchable ----------
CREATE OR REPLACE TABLE PLAYBOOK (
  DOC_ID VARCHAR, DOC_TYPE VARCHAR, TITLE VARCHAR, TRACK VARCHAR, SIGNAL_SOURCE VARCHAR, BODY VARCHAR
) COMMENT = 'What the campaign team knows: signal definitions and their limits, the data-sharing rule, school dates, offers, learnings.';

INSERT INTO PLAYBOOK VALUES
  ('sig-biz', 'SIGNAL', 'Business-starter signal (Bunnings to Officeworks)', 'BUSINESS', 'Bunnings',
   'BIZ_STARTER_FLAG marks a member who bought three or more of the six Bunnings trade categories (trade power tools, specialist trade tools, trade ladders, tool storage and transport, workwear and PPE, trade consumables) within 90 days, with no trade buying in the 4 to 16 months before. That cluster is what setting up a trade business looks like: an electrician, plumber, carpenter, landscaper or cleaner buying the kit. BIZ_STARTER_SCORE (0-100) grades it. What a new business needs from Officeworks: a laptop for quotes and invoices, a printer, business cards, signage and vehicle magnets, and a business account. The signal is fresh for about four months; after that the member is an established tradie. Established tradies (PRIOR_TRADE_HISTORY) also buy trade clusters but already have their set-up and mostly buy anyway: exclude them, along with members already buying business supplies at Officeworks (OW_BUSINESS_BUYER).'),
  ('sig-school', 'SIGNAL', 'School-age household signal (Kmart to Officeworks)', 'SCHOOL', 'Kmart',
   'SCHOOL_SIGNAL_CONFIDENCE reads Kmart purchases for school-age children. Kids'' shoe sizes are one input: each size is mapped to a typical age and aged forward to the next school start. Shoe sizes are an IMPERFECT proxy for age and household size: a size spans about a year of age, the same child growing through two sizes in a year can look like two children, children of similar ages look like one, and a grandparent''s gift looks like a child. School items (uniform polos, shorts, dresses, lunchboxes, drink bottles, school bags) are what make the signal trustworthy. HIGH = school-age shoe sizes and school items in 12 months. MEDIUM = one or the other. LOW = only toddler sizes, or shoes bought only in December (likely a gift). EST_SCHOOL_AGE_KIDS undercounts children and should be treated as at least, not exactly. STARTING_SCHOOL_LIKELY flags a youngest child of about four and a half to five and a half at the next school start: a first school list. Members who used the school list service last year (SCHOOL_LIST_USED_LAST_YEAR) come back anyway.'),
  ('policy-consent', 'POLICY', 'Using Bunnings or Kmart purchases in Officeworks marketing', NULL, 'OnePass',
   'A member''s purchases at one banner may personalise another banner''s marketing only with OnePass group data-sharing consent (GROUP_DATA_CONSENT). The audience builder adds this rule itself whenever an audience uses a Bunnings or Kmart field, and the funnel shows how many it removes. Copy must not reveal what was bought at another banner ("we saw you bought a ladder at Bunnings"): speak to the need ("setting up your business?"), not the purchase.'),
  ('timing-school', 'TIMING', 'Back-to-school timing by state', 'SCHOOL', NULL,
   'Term 1 2027 starts on 27 January in VIC, QLD, SA and NT, 1 February in NSW, WA and ACT, and 3 February in TAS (approximate, demo data). From 13 November 2026 that is 75 to 82 days. Measured history: the same Kmart HIGH-signal households lifted far more when invited about three weeks before school started than when emailed nine weeks before with a discount. Plan an invitation to upload the school list in early January and a reminder in the two weeks before each state''s start, sequenced by state; anything sent in November or December lands too early.'),
  ('timing-business', 'TIMING', 'Business-starter timing', 'BUSINESS', NULL,
   'A business being set up needs its laptop, printer, cards and signs in the first weeks. Contact members within about 60 days of their first trade purchase; after that response falls. Run the starter campaign continuously (an always-on trigger) or in monthly waves rather than as a one-off.'),
  ('history-summary', 'HISTORY', 'What our past campaigns tested', NULL, NULL,
   'Back to School 2026 (all Officeworks shoppers, $10 off, December): small lift overall, almost all of it in Kmart school-signal households; last year''s school-list users bought anyway. School List Pilot (Kmart signal, VIC and QLD, January): strong lift for HIGH and MEDIUM confidence and for children starting school, none for LOW; SMS beat email. New Business Welcome (Bunnings trade cluster, March): a large lift for real starters and none for established tradies, who were half the audience. Business Account to all Bunnings shoppers (August): lowered buying overall and unsubscribes above the limit, driven by members with no business signal who had never shopped at Officeworks. Home Office Refresh (Kmart home-office shoppers): a small lift that barely covers the discount.');

INSERT INTO PLAYBOOK
SELECT 'offer-' || OFFER_ID, 'OFFER', NAME, CAMPAIGN_TRACK(CATEGORY), 'Officeworks',
       NAME || ' (' || OFFER_ID || ', ' || COALESCE(CATEGORY, 'any category') || '): ' || DESCRIPTION || '. Terms: ' || TERMS || ' Cost per redemption AUD ' || COST_PER_REDEMPTION || '.'
FROM OFFER WHERE IS_ACTIVE;

INSERT INTO PLAYBOOK
SELECT 'learning-' || l.LEARNING_ID, 'LEARNING', c.NAME, CAMPAIGN_TRACK(c.PROMOTED_CATEGORY), NULL, l.STATEMENT
FROM LEARNING l JOIN CAMPAIGN c ON c.CAMPAIGN_ID = l.CAMPAIGN_ID;

CREATE OR REPLACE CORTEX SEARCH SERVICE CMP_PLAYBOOK_SEARCH
  ON BODY
  ATTRIBUTES DOC_TYPE, TRACK, SIGNAL_SOURCE
  WAREHOUSE = OD_WH
  TARGET_LAG = '1 day'
  AS (SELECT DOC_ID, DOC_TYPE, TITLE, COALESCE(TRACK, 'ANY') AS TRACK, COALESCE(SIGNAL_SOURCE, 'ANY') AS SIGNAL_SOURCE, BODY FROM ONEDIGITAL_DEMO.CAMPAIGN.PLAYBOOK);

-- ---------- 4. Opportunities ----------
-- Every candidate play, sized and valued as the audience builder sizes an
-- audience: consent (and group data-sharing consent for cross-banner fields),
-- the 14-day fatigue rule, and expected lift per member from the uplift cell
-- (track and need state) learned from the measured history, shrunk to the
-- pooled lift by the size of its holdout. Value per incremental conversion is
-- the first order's margin measured in the history plus half a year of the
-- margin a converted member goes on to make (a new business customer buys
-- ink, paper and print; a school family comes back for supplies). Ranked by
-- expected incremental margin net of send and offer cost.
CREATE OR REPLACE TABLE OPPORTUNITY_DEF (
  PLAY_ID VARCHAR, TITLE VARCHAR, SIGNAL_SOURCE VARCHAR, TRACK VARCHAR, PROMOTED_CATEGORY VARCHAR, PROMOTED_CLASS VARCHAR,
  OFFER_ID VARCHAR, EXTRA_OFFERS VARCHAR, CHANNELS VARCHAR, CROSS_BANNER BOOLEAN, SPEC_JSON VARCHAR, TIMING VARCHAR,
  EVIDENCE_CAMPAIGN VARCHAR, EVIDENCE_NEED_STATE VARCHAR
);
INSERT INTO OPPORTUNITY_DEF VALUES
  ('play-school', 'School list service for Kmart school-age households', 'Kmart -> Officeworks', 'SCHOOL', 'Back to School', 'School List Service', 'off-5', 'off-6,off-7', 'EMAIL,SMS', TRUE,
   '{"all":[{"field":"SCHOOL_SIGNAL_CONFIDENCE","op":"in","values":["HIGH","MEDIUM"]}],"any":[],"exclude":[{"field":"SCHOOL_LIST_USED_LAST_YEAR","op":"is_true"}],"channels":["EMAIL","SMS"],"promoted":{"category":"Back to School","className":"School List Service","brand":null}}',
   'Term 1 starts in 75-82 days. Invite in early January, remind two weeks before each state''s start.', 'camp-h02', 'SCHOOL_HIGH'),
  ('play-business', 'New business starters from Bunnings: laptop, printer, cards and signage', 'Bunnings -> Officeworks', 'BUSINESS', 'Business Essentials', NULL, 'off-1', 'off-2,off-3,off-4', 'EMAIL,SMS', TRUE,
   '{"all":[{"field":"BIZ_STARTER_FLAG","op":"is_true"}],"any":[],"exclude":[{"field":"OW_BUSINESS_BUYER","op":"is_true"}],"channels":["EMAIL","SMS"],"promoted":{"category":"Business Essentials","className":null,"brand":null}}',
   'Now: the signal is fresh for about 60 days after the first trade purchase. Run as an always-on trigger.', 'camp-h03', 'STARTER_NEW'),
  ('play-furniture', 'Kmart home-office shoppers to Officeworks furniture', 'Kmart -> Officeworks', 'FURNITURE', 'Furniture', NULL, 'off-9', NULL, 'EMAIL', TRUE,
   '{"all":[{"field":"HOME_OFFICE_12M","op":"is_true"}],"any":[],"exclude":[],"channels":["EMAIL"],"promoted":{"category":"Furniture","className":null,"brand":null}}',
   'Any time; no seasonal peak.', 'camp-h05', 'HOME_OFFICE'),
  ('play-tech', 'Laptop trade-up for Officeworks tech owners', 'Officeworks', 'TECH', 'Technology', 'Laptops', 'off-10', NULL, 'EMAIL,PUSH', FALSE,
   '{"all":[{"field":"TECH_LAST_DAYS","op":"between","min":365,"max":760}],"any":[],"exclude":[],"channels":["EMAIL","PUSH"],"promoted":{"category":"Technology","className":"Laptops","brand":null}}',
   'After Black Friday; the live campaign already covers November.', 'camp-l01', 'TECH_OWNER'),
  ('play-bunnings-all', 'Business account sign-up to every Bunnings shopper', 'Bunnings -> Officeworks', 'BUSINESS', 'Business Essentials', NULL, 'off-4', NULL, 'EMAIL', TRUE,
   '{"all":[{"field":"BUNNINGS_SPEND_12M","op":"gte","value":1}],"any":[],"exclude":[],"channels":["EMAIL"],"promoted":{"category":"Business Essentials","className":null,"brand":null}}',
   'Ran in August.', 'camp-h04', NULL);

CREATE OR REPLACE TABLE OPPORTUNITY
  COMMENT = 'Candidate plays sized and valued like the audience builder (consent, data-sharing consent, fatigue, uplift cells from the history), ranked by expected incremental margin net of cost. As of CMP_AS_OF().'
AS
WITH conv AS (SELECT DISTINCT CAMPAIGN_ID, CUSTOMER_KEY FROM CAMPAIGN_EVENT WHERE EVENT_TYPE = 'CONVERT' AND PROVENANCE <> 'SIMULATED'),
cells_raw AS (
  SELECT am.TRACK, am.NEED_STATE,
         COUNT_IF(am.GROUP_CODE = 'TREATED') AS TN, COUNT_IF(am.GROUP_CODE = 'TREATED' AND cv.CUSTOMER_KEY IS NOT NULL) AS TC,
         COUNT_IF(am.GROUP_CODE = 'HOLDOUT') AS HN, COUNT_IF(am.GROUP_CODE = 'HOLDOUT' AND cv.CUSTOMER_KEY IS NOT NULL) AS HC
  FROM AUDIENCE_MEMBER am
  JOIN CAMPAIGN c ON c.CAMPAIGN_ID = am.CAMPAIGN_ID AND c.PROVENANCE <> 'APP'
  LEFT JOIN conv cv ON cv.CAMPAIGN_ID = am.CAMPAIGN_ID AND cv.CUSTOMER_KEY = am.CUSTOMER_KEY
  WHERE c.STATUS IN ('MEASURED', 'COMPLETED', 'PAUSED', 'LIVE')
  GROUP BY 1, 2
), pooled AS (
  SELECT (SUM(TC) / SUM(TN) - SUM(HC) / SUM(HN)) * 100 AS LIFT, SUM(HC) / SUM(HN) AS BASE FROM cells_raw
), cells AS (
  SELECT r.TRACK, r.NEED_STATE, r.HN / (r.HN + 200) AS W,
         r.HN / (r.HN + 200) * IFF(r.TN > 0 AND r.HN > 0, (r.TC / r.TN - r.HC / r.HN) * 100, p.LIFT) + (1 - r.HN / (r.HN + 200)) * p.LIFT AS LIFT_PP,
         r.HN / (r.HN + 200) * IFF(r.HN > 0, r.HC / r.HN, p.BASE) + (1 - r.HN / (r.HN + 200)) * p.BASE AS BASE_RATE
  FROM cells_raw r CROSS JOIN pooled p
), last_send AS (
  SELECT CUSTOMER_KEY, MAX(EVENT_DATE) AS LAST_CONTACT FROM CAMPAIGN_EVENT WHERE EVENT_TYPE = 'SEND' AND EVENT_DATE <= CMP_AS_OF() GROUP BY 1
), base AS (
  SELECT f.*, ct.EMAIL_OPT_IN, ct.SMS_OPT_IN, ct.PUSH_ENABLED, ct.GROUP_DATA_CONSENT,
         COALESCE(DATEDIFF('day', ls.LAST_CONTACT, CMP_AS_OF()), 9999) AS DAYS_SINCE_CONTACT
  FROM CUSTOMER_FEATURES f JOIN CUSTOMER_CONTACT ct ON ct.CUSTOMER_KEY = f.CUSTOMER_KEY
  LEFT JOIN last_send ls ON ls.CUSTOMER_KEY = f.CUSTOMER_KEY
), m AS (
  SELECT d.PLAY_ID, d.TRACK, b.CUSTOMER_KEY, b.GROUP_DATA_CONSENT,
         CASE d.PLAY_ID
           WHEN 'play-school'       THEN b.SCHOOL_SIGNAL_CONFIDENCE IN ('HIGH', 'MEDIUM') AND NOT COALESCE(b.SCHOOL_LIST_USED_LAST_YEAR, FALSE)
           WHEN 'play-business'     THEN COALESCE(b.BIZ_STARTER_FLAG, FALSE) AND NOT COALESCE(b.OW_BUSINESS_BUYER, FALSE)
           WHEN 'play-furniture'    THEN COALESCE(b.HOME_OFFICE_12M, FALSE)
           WHEN 'play-tech'         THEN b.TECH_LAST_DAYS BETWEEN 365 AND 760
           WHEN 'play-bunnings-all' THEN b.BUNNINGS_SPEND_12M >= 1
         END AS MATCHED,
         CASE d.CHANNELS WHEN 'EMAIL,SMS' THEN b.EMAIL_OPT_IN OR b.SMS_OPT_IN WHEN 'EMAIL,PUSH' THEN b.EMAIL_OPT_IN OR b.PUSH_ENABLED ELSE b.EMAIL_OPT_IN END AS REACHABLE,
         (NOT d.CROSS_BANNER OR b.GROUP_DATA_CONSENT) AND b.DAYS_SINCE_CONTACT >= 14 AS ALLOWED,
         NEED_STATE(d.TRACK, b.BIZ_STARTER_FLAG AND b.GROUP_DATA_CONSENT, b.PRIOR_TRADE_HISTORY AND b.GROUP_DATA_CONSENT,
                    IFF(b.GROUP_DATA_CONSENT, b.TRADE_CLASSES_12M, 0), b.OW_BUSINESS_BUYER, IFF(b.GROUP_DATA_CONSENT, b.SCHOOL_SIGNAL_CONFIDENCE, 'NONE'),
                    b.STARTING_SCHOOL_LIKELY AND b.GROUP_DATA_CONSENT, b.SCHOOL_LIST_USED_LAST_YEAR, b.TECH_LAST_DAYS,
                    b.HOME_OFFICE_12M AND b.GROUP_DATA_CONSENT, b.OW_RECENCY_DAYS) AS NEED
  FROM OPPORTUNITY_DEF d CROSS JOIN base b
), sized AS (
  SELECT m.PLAY_ID, COUNT_IF(m.MATCHED) AS MATCHED, COUNT_IF(m.MATCHED AND m.REACHABLE AND m.ALLOWED) AS ELIGIBLE,
         COUNT_IF(m.MATCHED AND m.REACHABLE AND NOT m.GROUP_DATA_CONSENT) AS NO_DATA_CONSENT,
         SUM(IFF(m.MATCHED AND m.REACHABLE AND m.ALLOWED, c.LIFT_PP, 0)) / 100 AS EXP_INC_CONV,
         SUM(IFF(m.MATCHED AND m.REACHABLE AND m.ALLOWED, c.BASE_RATE, 0)) AS EXP_BASE_CONV,
         COUNT_IF(m.MATCHED AND m.REACHABLE AND m.ALLOWED AND c.LIFT_PP >= 1.0 AND NOT (c.BASE_RATE >= 0.08 AND c.LIFT_PP < c.BASE_RATE * 25)) AS PERSUADABLE,
         COUNT_IF(m.MATCHED AND m.REACHABLE AND m.ALLOWED AND c.LIFT_PP <= -0.5) AS SLEEPING_DOGS
  FROM m LEFT JOIN cells c ON c.TRACK = m.TRACK AND c.NEED_STATE = m.NEED
  GROUP BY 1
), first_margin AS (
  SELECT CAMPAIGN_TRACK(c.PROMOTED_CATEGORY) AS TRACK, AVG(e.MARGIN_AUD) AS MARGIN_PER_CONV
  FROM CAMPAIGN_EVENT e JOIN CAMPAIGN c ON c.CAMPAIGN_ID = e.CAMPAIGN_ID
  WHERE e.EVENT_TYPE = 'CONVERT' AND e.PROVENANCE <> 'SIMULATED' GROUP BY 1
), follow_on AS (
  -- 12-month Officeworks margin of the members a conversion turns a starter or
  -- a school family into: business buyers, and last year's school-list users
  -- (excluding the list itself).
  SELECT 'BUSINESS' AS TRACK, AVG(COALESCE(o.M, 0)) AS MARGIN_12M FROM CUSTOMER_FEATURES f
  LEFT JOIN (SELECT CUSTOMER_KEY, SUM(MARGIN_AMOUNT) AS M FROM ONEDIGITAL_DEMO.CURATED.FACT_TRANSACTION_LINES
             WHERE BANNER = 'OFFICEWORKS' AND TXN_DATE > DATEADD('month', -12, CMP_AS_OF()) GROUP BY 1) o ON o.CUSTOMER_KEY = f.CUSTOMER_KEY
  WHERE f.OW_BUSINESS_BUYER
  UNION ALL
  SELECT 'SCHOOL', AVG(COALESCE(o.M, 0)) FROM CUSTOMER_FEATURES f
  LEFT JOIN (SELECT tl.CUSTOMER_KEY, SUM(tl.MARGIN_AMOUNT) AS M FROM ONEDIGITAL_DEMO.CURATED.FACT_TRANSACTION_LINES tl
             JOIN ONEDIGITAL_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = tl.PRODUCT_KEY
             WHERE tl.BANNER = 'OFFICEWORKS' AND p.CLASS <> 'School List Service' AND tl.TXN_DATE > DATEADD('month', -12, CMP_AS_OF()) GROUP BY 1) o
    ON o.CUSTOMER_KEY = f.CUSTOMER_KEY
  WHERE f.SCHOOL_LIST_USED_LAST_YEAR
), ev AS (
  SELECT CAMPAIGN_ID, ROUND(100 * (COUNT_IF(GROUP_CODE = 'TREATED' AND CONVERTED) / NULLIF(COUNT_IF(GROUP_CODE = 'TREATED'), 0)
                                   - COUNT_IF(GROUP_CODE = 'HOLDOUT' AND CONVERTED) / NULLIF(COUNT_IF(GROUP_CODE = 'HOLDOUT'), 0)), 2) AS LIFT_PTS
  FROM VW_MEMBER_DIM WHERE DIM = 'Channel' GROUP BY 1
), ev_seg AS (
  -- The same campaign's lift for the members the play targets.
  SELECT CAMPAIGN_ID, VAL AS NEED_STATE, COUNT_IF(GROUP_CODE = 'HOLDOUT') AS HN,
         ROUND(100 * (COUNT_IF(GROUP_CODE = 'TREATED' AND CONVERTED) / NULLIF(COUNT_IF(GROUP_CODE = 'TREATED'), 0)
                      - COUNT_IF(GROUP_CODE = 'HOLDOUT' AND CONVERTED) / NULLIF(COUNT_IF(GROUP_CODE = 'HOLDOUT'), 0)), 2) AS LIFT_PTS
  FROM VW_MEMBER_DIM WHERE DIM = 'Need state' GROUP BY 1, 2
), valued AS (
  SELECT d.*, s.MATCHED, s.ELIGIBLE, s.NO_DATA_CONSENT, s.PERSUADABLE, s.SLEEPING_DOGS,
         ROUND(s.EXP_INC_CONV, 1) AS EXP_INC_CONV,
         ROUND(100 * s.EXP_INC_CONV / NULLIF(s.ELIGIBLE, 0), 2) AS EXP_LIFT_PTS,
         ROUND(fm.MARGIN_PER_CONV, 2) AS FIRST_ORDER_MARGIN,
         ROUND(0.5 * COALESCE(fo.MARGIN_12M, 0), 2) AS FOLLOW_ON_MARGIN,
         ROUND(s.ELIGIBLE * IFF(d.CHANNELS LIKE '%SMS%', 0.5 * 0.03 + 0.5 * 0.08, 0.03), 0) AS SEND_COST,
         ROUND((s.EXP_BASE_CONV + s.EXP_INC_CONV) * 0.7 * COALESCE(o.COST_PER_REDEMPTION, 0), 0) AS OFFER_COST,
         o.NAME AS OFFER_NAME, ev.LIFT_PTS AS EVIDENCE_LIFT_PTS, c.NAME AS EVIDENCE_NAME,
         es.LIFT_PTS AS EVIDENCE_SEGMENT_LIFT_PTS, es.HN AS EVIDENCE_SEGMENT_HOLDOUT
  FROM OPPORTUNITY_DEF d
  JOIN sized s ON s.PLAY_ID = d.PLAY_ID
  LEFT JOIN first_margin fm ON fm.TRACK = d.TRACK
  LEFT JOIN follow_on fo ON fo.TRACK = d.TRACK
  LEFT JOIN OFFER o ON o.OFFER_ID = d.OFFER_ID
  LEFT JOIN ev ON ev.CAMPAIGN_ID = d.EVIDENCE_CAMPAIGN
  LEFT JOIN CAMPAIGN c ON c.CAMPAIGN_ID = d.EVIDENCE_CAMPAIGN
  LEFT JOIN ev_seg es ON es.CAMPAIGN_ID = d.EVIDENCE_CAMPAIGN AND es.NEED_STATE = d.EVIDENCE_NEED_STATE
)
SELECT v.*,
       ROUND(v.EXP_INC_CONV * (v.FIRST_ORDER_MARGIN + v.FOLLOW_ON_MARGIN), 0) AS EXP_INC_MARGIN,
       ROUND(v.EXP_INC_CONV * (v.FIRST_ORDER_MARGIN + v.FOLLOW_ON_MARGIN) - v.SEND_COST - v.OFFER_COST, 0) AS EXP_NET_MARGIN,
       ROUND((v.EXP_INC_CONV * (v.FIRST_ORDER_MARGIN + v.FOLLOW_ON_MARGIN) - v.SEND_COST - v.OFFER_COST) / NULLIF(v.ELIGIBLE, 0), 2) AS NET_PER_MEMBER,
       RANK() OVER (ORDER BY v.EXP_INC_CONV * (v.FIRST_ORDER_MARGIN + v.FOLLOW_ON_MARGIN) - v.SEND_COST - v.OFFER_COST DESC) AS PRIORITY_RANK,
       CMP_AS_OF() AS AS_OF
FROM valued v;
