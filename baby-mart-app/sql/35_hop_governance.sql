-- ============================================================
-- Head of Planning — governance: ownership, audit, approval, scenarios, AI
--
-- OWNERSHIP GOVERNS THE PEN, NOT THE EYES. Two parties edit one plan:
--   PLANNING  the head of planning's team: the TOP-DOWN figures -- like-for-like
--             forecast, store margin, halo, the merch forecast
--   BUYING    the buying team: the BOTTOM-UP figures -- range review units, ASP and
--             the budget they build. Planning may key them, but only on Buying's
--             behalf, and the audit trail records that it was Buying's number
--   JOINT     agreed between the two at range review: LFL, option counts, the RBU
--             mix, the stated growth, the planned intake margin
-- plus INGESTED (a record of what happened, nobody edits), CALCULATED (change the
-- inputs, not the result) and UNCLASSIFIED (no owner agreed, so nobody edits).
--
-- Nothing is hidden from either party; the posture is deliberate visibility.
-- Editability is enforced on the server against this table, not just shown in the
-- interface: a lock that exists only in the UI is a suggestion, not a control.
-- ============================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE DEMO_LOAD_WH;
USE SCHEMA BABY_MART_DEMO.HEAD_OF_PLANNING;

-- ---------- 1. Ownership registry ----------
CREATE OR REPLACE TABLE MEASURE_OWNERSHIP (
  SURFACE             VARCHAR COMMENT 'STORE_PLAN | MFP | RBU_MIX | FUNNEL | WSSI',
  MEASURE_CODE        VARCHAR,
  MEASURE_LABEL       VARCHAR,
  EDIT_CLASS          VARCHAR COMMENT 'INGESTED | CALCULATED | JOINT | PLANNING | BUYING | UNCLASSIFIED',
  OWNING_PARTY        VARCHAR COMMENT 'NONE | BOTH | PLANNING | BUYING',
  EDITABLE_IN_APP     BOOLEAN COMMENT 'FALSE for INGESTED, CALCULATED and UNCLASSIFIED, always.',
  LOCK_BEHAVIOUR      VARCHAR COMMENT 'FREEZE | AMEND_WITH_ESCALATION | ALWAYS_OPEN | NOT_APPLICABLE',
  REQUIRES_RATIONALE  BOOLEAN,
  IS_INFERRED         BOOLEAN COMMENT 'TRUE = classified by Cortex Code, not yet confirmed by the business.',
  EVIDENCE            VARCHAR,
  CONFIRMED_BY        VARCHAR,
  CONFIRMED_AT        TIMESTAMP_LTZ
) COMMENT = 'Measure-level ownership: who may change which number, and what happens to it once the plan is locked.';

INSERT INTO MEASURE_OWNERSHIP
WITH rules AS (
  SELECT * FROM VALUES
    ('INGESTED',     'NONE',     FALSE, 'NOT_APPLICABLE',        FALSE),
    ('CALCULATED',   'NONE',     FALSE, 'NOT_APPLICABLE',        FALSE),
    ('JOINT',        'BOTH',     TRUE,  'AMEND_WITH_ESCALATION', TRUE),
    ('PLANNING',     'PLANNING', TRUE,  'ALWAYS_OPEN',           TRUE),
    ('BUYING',       'BUYING',   TRUE,  'AMEND_WITH_ESCALATION', TRUE),
    ('UNCLASSIFIED', 'NONE',     FALSE, 'NOT_APPLICABLE',        FALSE)
  AS r(EDIT_CLASS, OWNING_PARTY, EDITABLE_IN_APP, LOCK_BEHAVIOUR, REQUIRES_RATIONALE)
), m AS (
  SELECT * FROM VALUES
    -- Store plan
    ('STORE_PLAN','LY_SALES_AUD','LY sales','INGESTED',FALSE,'FY26 H1 POS: a record of what happened.'),
    ('STORE_PLAN','PLAN_SALES_AUD','Plan sales','CALCULATED',FALSE,'LY same week x (1 + LFL %).'),
    ('STORE_PLAN','PLAN_MARGIN_AUD','Margin $','CALCULATED',FALSE,'Plan sales x margin %.'),
    ('STORE_PLAN','LFL_PCT','LFL %','JOINT',FALSE,'Agreed between Planning and Buying at the budget review: the range has to support it.'),
    ('STORE_PLAN','MARGIN_PCT','Margin %','PLANNING',FALSE,'Store margin is the head of planning''s number.'),
    ('STORE_PLAN','MONTHLY_SALES_AUD','New store monthly plan','JOINT',FALSE,'A new store''s value is agreed, not derived from history it does not have.'),
    ('STORE_PLAN','BENCHMARK_PCT','Benchmark %','PLANNING',TRUE,'Who sets a new store''s benchmark share was never stated. Inferred as Planning.'),
    ('STORE_PLAN','BENCHMARK_STORE_CODE','Benchmark store','PLANNING',TRUE,'Inferred as Planning, with the benchmark percentage.'),
    ('STORE_PLAN','HALO_WEEKS','Halo weeks','PLANNING',FALSE,'Planning convention.'),
    ('STORE_PLAN','SELLING_AREA_SQM','Selling area (sqm)','PLANNING',TRUE,'No source holds floor area: the store dimension has no area column. Inferred as Planning''s to record, in the store master.'),
    ('STORE_PLAN','H1_PLAN_SALES_AUD','Half plan sales','JOINT',FALSE,'A top-down change to the half moves every month: agreed, not unilateral.'),
    ('STORE_PLAN','H1_MARGIN_PCT','Half margin %','PLANNING',FALSE,'As store margin.'),
    ('STORE_PLAN','H1_LFL_PCT','Half LFL %','JOINT',FALSE,'As store LFL.'),
    -- MFP
    ('MFP','F26_ACTUAL_SALES_AUD','LY actual','INGESTED',FALSE,'FY26 H1 POS.'),
    ('MFP','F26_UNIT_SALES','LY units','INGESTED',FALSE,'FY26 H1 POS.'),
    ('MFP','F26_ASP_AUD','LY ASP','INGESTED',FALSE,'FY26 H1 POS.'),
    ('MFP','F26_FIRST_MARGIN_PCT','LY first margin','INGESTED',FALSE,'FY26 H1 intake margin at full retail.'),
    ('MFP','F26_POS_ACTUAL_AUD','LY POS margin $','INGESTED',FALSE,'FY26 H1 POS.'),
    ('MFP','EXIT_POS_MARGIN_PCT','LY exit margin','INGESTED',FALSE,'FY26 H1 realised margin after discount.'),
    ('MFP','F26_MIX_PCT','LY mix','CALCULATED',FALSE,'Share of LY sales.'),
    ('MFP','F27_LFL_FORECAST_AUD','Top-down budget','PLANNING',FALSE,'LY x (1 + LFL): the top-down is Planning''s.'),
    ('MFP','LFL_GROWTH_PCT','LFL %','JOINT',FALSE,'Agreed at the budget review.'),
    ('MFP','TOTAL_GROWTH_PCT_STATED','Growth stated','JOINT',FALSE,'The growth presented at range review.'),
    ('MFP','TPR_BUDGET_AUD','Bottom-up budget','BUYING',FALSE,'Units x ASP from the range review: Buying''s number.'),
    ('MFP','F27_TPR_UNIT_SALES','Plan units','BUYING',FALSE,'Range review unit plan.'),
    ('MFP','F27_TPR_ASP_AUD','Plan ASP','BUYING',FALSE,'Range review ASP.'),
    ('MFP','F27_TPR_MIX_PCT','Plan mix','CALCULATED',FALSE,'Share of the bottom-up plan.'),
    ('MFP','F27_POS_SALES_AUD','Plan POS margin $','CALCULATED',FALSE,'Bottom-up x POS %.'),
    ('MFP','F27_POS_PCT','Plan POS margin %','JOINT',FALSE,'Agreed at the budget review.'),
    ('MFP','F27_TPR_FIRST_MARGIN_PCT','Plan first margin','JOINT',FALSE,'Planned intake margin, agreed with Buying.'),
    -- The two totals are CALCULATED from their parts, so the counts always
    -- reconcile: presented = new + ongoing + dropped, dropped = new + ongoing dropped.
    ('MFP','OPTIONS_PRESENTED','Options presented','CALCULATED',FALSE,'Committed plus dropped options.'),
    ('MFP','OPTIONS_NEW','New options','JOINT',FALSE,'Range review.'),
    ('MFP','OPTIONS_ONGOING','Ongoing options','JOINT',FALSE,'Range review.'),
    ('MFP','OPTIONS_DESELECTED','Options dropped','CALCULATED',FALSE,'New plus ongoing options dropped.'),
    ('MFP','OPTIONS_NEW_DESELECTED','New options dropped','JOINT',FALSE,'Range review.'),
    ('MFP','OPTIONS_ONGOING_DESELECTED','Ongoing options dropped','JOINT',FALSE,'Range review.'),
    -- RBU mix
    ('RBU_MIX','PLAN_MIX_PCT_STATED','Plan mix %','JOINT',FALSE,'Agreed at the end-of-half review.'),
    ('RBU_MIX','LY_MIX_PCT_STATED','LY mix stated','INGESTED',FALSE,'As stated at the review.'),
    ('RBU_MIX','LY_MIX_PCT_MEASURED','LY mix measured','CALCULATED',FALSE,'From POS.'),
    ('RBU_MIX','PLAN_SALES_AUD','RBU plan sales','CALCULATED',FALSE,'Plan mix x store plan total.'),
    -- Range funnel
    ('FUNNEL','MIN_CREDIBLE_ADOPTION_PCT','Minimum credible adoption','PLANNING',FALSE,'Planning sets the floor a department must clear.'),
    ('FUNNEL','OPTIONS_AT_GATE','Options at gate','JOINT',FALSE,'Range review.'),
    ('FUNNEL','OPTIONS_LOST_AT_GATE','Options lost at gate','JOINT',FALSE,'Range review.'),
    ('FUNNEL','ORDERED_UNITS','Ordered units','INGESTED',FALSE,'Purchase orders.'),
    ('FUNNEL','DELIVERED_UNITS','Delivered units','INGESTED',FALSE,'DC receipts.'),
    ('FUNNEL','UNITS_LOST','Units lost','CALCULATED',FALSE,'Ordered less delivered.'),
    ('FUNNEL','ATTRITION_PCT','Short-ship %','CALCULATED',FALSE,'Units lost / ordered.'),
    ('FUNNEL','LOSS_PCT','Loss at gate','CALCULATED',FALSE,'Derived.'),
    ('FUNNEL','SALES_AT_RISK_AUD','Budget on dropped options','CALCULATED',FALSE,'Derived.'),
    -- Planning settings. Thresholds are Planning's; a window the views fix is not
    -- editable, because changing the setting would not change the arithmetic.
    ('SETTINGS','NEW_STORE_HALO_WEEKS','New-store halo weeks','PLANNING',FALSE,'Planning convention.'),
    ('SETTINGS','MATERIALITY_PTS','Growth-break materiality','PLANNING',FALSE,'Planning threshold.'),
    ('SETTINGS','IMPLAUSIBLE_COVER_WEEKS','Implausible cover','PLANNING',FALSE,'Planning threshold.'),
    ('SETTINGS','MERCH_ABOVE_BUDGET_BAND_LOW','Forecast above budget, low band','PLANNING',FALSE,'Planning threshold.'),
    ('SETTINGS','MERCH_ABOVE_BUDGET_BAND_HIGH','Forecast above budget, high band','PLANNING',FALSE,'Planning threshold.'),
    ('SETTINGS','CREDIBLE_ADOPTION_DEFAULT','Default credible adoption','PLANNING',FALSE,'Planning threshold.'),
    ('SETTINGS','DEFAULT_UI_CALENDAR','Default calendar','PLANNING',FALSE,'Display preference.'),
    ('SETTINGS','FWD_COVER_WEEKS','Forward cover window','CALCULATED',FALSE,'Fixed at four weeks by the WSSI views.'),
    ('SETTINGS','STOCK_BASIS','Stock basis','CALCULATED',FALSE,'Set by the data: the SOH feed is implausible, so stock is modelled.'),
    ('SETTINGS','CLEARANCE_DEFINITION','Clearance definition','UNCLASSIFIED',TRUE,'How POS tells clearance from full price. No owner agreed.')
  AS t(SURFACE, MEASURE_CODE, MEASURE_LABEL, EDIT_CLASS, IS_INFERRED, EVIDENCE)
), wssi AS (
  -- One row per WSSI layout row. The classification follows the row's kind; the
  -- rows a business has to own -- the merch forecast, every planning input, every
  -- placeholder that will one day be a feed -- are marked INFERRED until someone
  -- confirms them.
  SELECT 'WSSI' AS SURFACE,
         'WSSI:' || LPAD(DISPLAY_ORDER, 3, '0') || ':' || ROW_LABEL AS MEASURE_CODE,
         ROW_LABEL AS MEASURE_LABEL,
         CASE
           WHEN ROW_KIND IN ('CALC', 'VARIANCE')         THEN 'CALCULATED'
           WHEN ROW_KIND = 'PLANNED'                     THEN 'PLANNING'
           WHEN ROW_KIND = 'FACT' AND VERSION_HINT = 'FC' THEN 'PLANNING'
           ELSE 'INGESTED'
         END AS EDIT_CLASS,
         (ROW_KIND IN ('PLANNED', 'PLACEHOLDER') OR (ROW_KIND = 'FACT' AND VERSION_HINT = 'FC')) AS IS_INFERRED,
         CASE
           WHEN ROW_KIND IN ('CALC', 'VARIANCE') THEN 'Derived from other rows.'
           WHEN ROW_KIND = 'PLANNED'             THEN 'A planning input. Inferred as Planning''s to set.'
           WHEN ROW_KIND = 'PLACEHOLDER'         THEN 'Will be a feed once one is supplied. Inferred as ingested.'
           WHEN VERSION_HINT = 'FC'              THEN 'The merch forecast moves with every review. Inferred as Planning''s number.'
           WHEN MEASURE_BASIS = 'MODELLED'       THEN 'Modelled stock position, in place of the SOH feed.'
           WHEN ROW_KIND = 'AWAITING'            THEN 'No feed yet.'
           ELSE 'From source data.'
         END AS EVIDENCE
  FROM WSSI_ROW_MEASURE_MAP
)
SELECT x.SURFACE, x.MEASURE_CODE, x.MEASURE_LABEL, x.EDIT_CLASS,
       r.OWNING_PARTY, r.EDITABLE_IN_APP, r.LOCK_BEHAVIOUR, r.REQUIRES_RATIONALE,
       x.IS_INFERRED, x.EVIDENCE, NULL, NULL
FROM (SELECT SURFACE, MEASURE_CODE, MEASURE_LABEL, EDIT_CLASS, IS_INFERRED, EVIDENCE FROM m
      UNION ALL
      SELECT SURFACE, MEASURE_CODE, MEASURE_LABEL, EDIT_CLASS, IS_INFERRED, EVIDENCE FROM wssi) x
JOIN rules r ON r.EDIT_CLASS = x.EDIT_CLASS;

-- ---------- 2. Reason codes and versions ----------
CREATE OR REPLACE TABLE PLAN_REASON_CODE (
  REASON_CODE         VARCHAR,
  REASON_NAME         VARCHAR,
  APPLIES_TO          VARCHAR,
  REQUIRES_NARRATIVE  BOOLEAN
) COMMENT = 'Reason codes for plan edits. Always say why.';

INSERT INTO PLAN_REASON_CODE VALUES
  ('NEWNESS_TIMING',      'New range landing timing',                              'LFL_PCT',   TRUE),
  ('STORE_REFURB',        'Store refurbishment',                                   'LFL_PCT',   TRUE),
  ('CANNIBALISATION',     'A new store nearby takes trade',                        'LFL_PCT',   TRUE),
  ('CLEARANCE_PUSH',      'Clearance stock pushed to this store',                  'MARGIN_PCT',TRUE),
  ('RUN_RATE_ADJUST',     'Adjusted to the current run rate',                      'ANY',       TRUE),
  ('COMPARABLE_BENCHMARK','Benchmarked to a comparable store',                     'NEW_STORE', TRUE),
  ('CENTRE_EVENT',        'Shopping centre or weather event',                      'ANY',       TRUE),
  ('SUPPLY_CONSTRAINT',   'Supplier short-ship or lead time',                      'ANY',       TRUE),
  ('STRATEGY_MIX',        'Deliberate mix shift from the end-of-half review',      'ANY',       TRUE),
  ('RANGE_REVIEW_AGREED', 'Agreed between Planning and Buying at range review',    'ANY',       TRUE),
  ('PEAK_TRADING',        'Peak trading: Black Friday and Christmas',              'ANY',       TRUE),
  ('STORE_FACT',          'A store fact supplied or corrected',                    'STORE',     TRUE),
  ('REVERTED',            'Reverts the previous change to this cell',              'ANY',       FALSE),
  ('MIGRATED_COMMENT',    'Migrated from a spreadsheet cell comment',              'ANY',       FALSE),
  ('NOT_SUPPLIED',        'No reason supplied',                                    'ANY',       FALSE);

CREATE OR REPLACE TABLE PLAN_VERSION (
  VERSION_CODE     VARCHAR,
  VERSION_NAME     VARCHAR,
  VERSION_SEQ      NUMBER,
  IS_IMMUTABLE     BOOLEAN COMMENT 'BUD cannot move once approved.',
  MOVES_OVER_TIME  BOOLEAN COMMENT 'MERCH_FC is the moving number.',
  DESCRIPTION      VARCHAR
) COMMENT = 'Four versions: this year, last year, budget, merch forecast. Budget does not move; the forecast is continually reviewed.';

INSERT INTO PLAN_VERSION VALUES
  ('TY',       'This year',      1, FALSE, TRUE,  'Actuals as they land.'),
  ('LY',       'Last year',      2, TRUE,  FALSE, 'The same week last year, 364 days earlier.'),
  ('BUD',      'Budget',         3, TRUE,  FALSE, 'Locked each half: the store plan the board signed off.'),
  ('MERCH_FC', 'Merch forecast', 4, FALSE, TRUE,  'Reviewed monthly. The number the business expects to land.');

-- ---------- 3. Decisions, findings ----------
-- Decisions are RECORDED, not remembered -- including the ones deliberately left
-- open, because "awaiting the business" is itself a decision and should be visible
-- rather than implied by silence.
CREATE OR REPLACE TABLE DESIGN_DECISION (
  DECISION_ID   NUMBER,
  TOPIC         VARCHAR,
  QUESTION      VARCHAR,
  DECISION      VARCHAR,
  RATIONALE     VARCHAR,
  IMPACT        VARCHAR,
  STATUS        VARCHAR COMMENT 'DECIDED | AWAITING_CUSTOMER',
  DECIDED_BY    VARCHAR,
  DECIDED_AT    DATE,
  OWNING_PARTY  VARCHAR
) COMMENT = 'What was decided, by whom, why, and what it changed. Open questions are recorded too.';

INSERT INTO DESIGN_DECISION VALUES
  (1, 'Stock basis', 'Can the store SOH feed be used as closing stock?',
   'No. Stock is modelled at plan cover and flagged MODELLED on every cell.',
   'The feed implies 60-113 weeks of cover against POS. Trading on it would make every stock row read as broken.',
   'Every STOCK and PURCHASES row rests on the model. The feed is kept beside it and its gap reported as an integrity check.',
   'DECIDED', 'Head of Planning', '2026-05-22', 'PLANNING'),
  (2, 'Clearance definition', 'What counts as clearance in POS?',
   'Any line carrying a discount or a promotion.',
   'POS does not distinguish a planned promotion from a clearance markdown.',
   'CL sales include promotions, so CL mix (12.5%) overstates true clearance. Worth a promotion flag in the feed.',
   'DECIDED', 'Head of Planning', '2026-05-22', 'PLANNING'),
  (3, 'Two parties', 'Who owns which number?',
   'Planning owns the top-down; Buying owns the bottom-up; LFL, options, mix and stated growth are joint.',
   'Mirrors the top-down vs bottom-up split the MFP grid is built around.',
   'Buying''s numbers can be keyed by Planning only on Buying''s behalf, and the audit says so.',
   'DECIDED', 'Head of Planning', '2026-05-22', 'BOTH'),
  (4, 'Plan half', 'Which half does the store plan and MFP cover?',
   'FY27 H1, Jul-Dec 2026.',
   'Last year (Jul-Dec 2025) is then fully covered by real POS, and the MFP and WSSI budgets overlap so they can be reconciled.',
   'Every LY figure ties to POS to the cent.', 'DECIDED', 'Head of Planning', '2026-05-22', 'PLANNING'),
  (5, 'Calendar labels', 'How is the fiscal year shown?',
   'Never a bare "FY27". Every half is shown with its calendar months: FY27 H1 - Jul-Dec 2026.',
   'Baby Mart''s fiscal year runs Jul-Jun, and the Global Planning tab labels Jan-Jun 2027 as F27 H1. The same string means different weeks.',
   'All period headers carry both keys.', 'DECIDED', 'Head of Planning', '2026-05-22', 'PLANNING'),
  (6, 'Budget phasing', 'How is the WSSI budget set for FY27 H1?',
   'The store plan, split to department by each department''s top-down LFL, so every week ties to the store plan.',
   'The budget being traded against is the board-locked plan, not a separate number that can drift from it.',
   'WSSI BUD for FY27 H1 equals the store plan to the cent.', 'DECIDED', 'Head of Planning', '2026-05-22', 'PLANNING'),
  (7, 'Range gate 4', 'What does the last range gate measure?',
   'Supplier short-ship: ordered vs delivered units.',
   'No minimum-order or pack constraints are held. Short-ship is the range lost after commitment that the data can show.',
   'Gate 4 is labelled short-ship, not MOQ.', 'DECIDED', 'Head of Planning', '2026-05-22', 'BOTH'),
  (8, 'New store budget timing', 'Should an in-app new store enter the budget before it is approved?',
   NULL, 'Adding a store moves the plan total the moment it saves.',
   'Open: the head of planning to decide whether a new store needs approval before it counts.',
   'AWAITING_CUSTOMER', NULL, NULL, 'PLANNING'),
  (9, 'Sales at risk', 'Are dropped options valued at the average COMMITTED option or the average PRESENTED one?',
   NULL, 'The current definition uses committed, which is the more conservative reading for a range that drops its tail.',
   'Changes the budget on dropped options by department.', 'AWAITING_CUSTOMER', NULL, NULL, 'BOTH'),
  (10, 'Prams credibility', 'Is 90% the right minimum adoption for prams?',
   NULL, 'Set high because a pram floor without the full brand wall is not a credible offer. No planogram minimums are held.',
   'Prams currently read BELOW CREDIBLE OFFER at 88% adoption.', 'AWAITING_CUSTOMER', NULL, NULL, 'BUYING'),
  (11, 'Dropped option split', 'Were dropped options new or ongoing?',
   NULL, 'The option feed does not say; the split is assigned at 40% new.',
   'New and ongoing deselection columns are assumptions until the feed carries the flag.', 'AWAITING_CUSTOMER', NULL, NULL, 'BUYING'),
  (12, 'Ripley opening date', 'When does Ripley open?',
   NULL, 'No date was recorded; the plan derives it from the first planned week (October).',
   'Ripley''s halo window rests on the derived date.', 'AWAITING_CUSTOMER', NULL, NULL, 'PLANNING'),
  (13, 'Store floor area', 'Is selling area held anywhere?',
   NULL, 'DIM_STORE has no floor area. Sizing is a free-text note on the add-store form.',
   'Area is shown as not recorded rather than inferred from sales density, which would manufacture a measurement out of a result.',
   'AWAITING_CUSTOMER', NULL, NULL, 'PLANNING');

CREATE OR REPLACE TABLE DATA_QUALITY_FINDING (
  FINDING_ID               NUMBER,
  PHASE                    VARCHAR,
  SEVERITY                 VARCHAR,
  OBJECT_NAME              VARCHAR,
  COLUMN_NAME              VARCHAR,
  FINDING                  VARCHAR,
  MEASURED_VALUE           VARCHAR,
  ACTION_TAKEN             VARCHAR,
  NEEDS_CUSTOMER_DECISION  BOOLEAN
) COMMENT = 'Source defects found and deliberately NOT silently corrected. Each needs a call from the business.';

INSERT INTO DATA_QUALITY_FINDING
WITH cover AS (
  SELECT MIN(WKS) AS LO, MAX(WKS) AS HI FROM (
    SELECT p.CATEGORY,
           SUM(i.STOCK_ON_HAND * p.UNIT_COST)
             / NULLIF((SELECT SUM(tl.COST_AMOUNT) / 13
                       FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl
                       JOIN BABY_MART_DEMO.CURATED.DIM_DATE dd ON dd.DATE_KEY = tl.DATE_KEY
                       JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT pp ON pp.PRODUCT_KEY = tl.PRODUCT_KEY
                       WHERE pp.CATEGORY = p.CATEGORY AND dd.CALENDAR_DATE BETWEEN '2026-02-02' AND '2026-05-03'), 0) AS WKS
    FROM BABY_MART_DEMO.CURATED.FACT_INVENTORY i
    JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.DATE_KEY = i.DATE_KEY
    JOIN BABY_MART_DEMO.CURATED.DIM_PRODUCT p ON p.PRODUCT_KEY = i.PRODUCT_KEY
    WHERE d.CALENDAR_DATE = '2026-05-03'
    GROUP BY p.CATEGORY)
), inv AS (
  SELECT MIN(d.CALENDAR_DATE) AS LO, MAX(d.CALENDAR_DATE) AS HI, COUNT(DISTINCT d.CALENDAR_DATE) AS DAYS
  FROM BABY_MART_DEMO.CURATED.FACT_INVENTORY i JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.DATE_KEY = i.DATE_KEY
), st AS (
  SELECT COUNT(*) AS N, COUNT(DISTINCT OPEN_DATE) AS DATES, MIN(OPEN_DATE) AS D FROM BABY_MART_DEMO.CURATED.DIM_STORE
), spread AS (
  SELECT MIN(R) AS LO, MAX(R) AS HI FROM (
    SELECT STORE_KEY, SUM(NET_REVENUE) / 1e6 AS R FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES GROUP BY STORE_KEY)
), pos AS (
  SELECT MAX(d.CALENDAR_DATE) AS LAST_DAY
  FROM BABY_MART_DEMO.CURATED.FACT_TRANSACTION_LINES tl JOIN BABY_MART_DEMO.CURATED.DIM_DATE d ON d.DATE_KEY = tl.DATE_KEY
)
-- UNION ALL rather than VALUES: VALUES cannot hold the measured figures, which
-- are computed from the source so a finding states what the data says today.
SELECT 1, 'LOAD', 'HIGH', 'CURATED.FACT_INVENTORY', 'STOCK_ON_HAND',
       'Store SOH implies far more cover than any planner would hold: ' || ROUND(cover.LO) || '-' || ROUND(cover.HI) || ' weeks against the last 13 weeks of POS cost of sales.',
       ROUND(cover.LO) || '-' || ROUND(cover.HI) || ' weeks',
       'Stock modelled at plan cover; the feed kept beside it and its gap reported as SOH_FEED_VS_MODEL.', TRUE
FROM cover
UNION ALL SELECT 2, 'LOAD', 'HIGH', 'CURATED.FACT_BUDGET', NULL,
       'The budget table is empty.', '0 rows',
       'FY27 H1 budget generated from the store plan; FY26 H2 budget generated from LY. Purchase budget rows read AWAITING.', TRUE
UNION ALL SELECT 3, 'LOAD', 'HIGH', 'CURATED.FACT_PURCHASE_ORDERS', NULL,
       'The purchase order table is empty, so there is no purchase or receipt history.', '0 rows',
       'Receipts modelled to roll stock forward; LY purchase rows read AWAITING.', TRUE
UNION ALL SELECT 4, 'LOAD', 'MEDIUM', 'CURATED.FACT_INVENTORY', 'DATE_KEY',
       'Stock history is held for only ' || inv.DAYS || ' days.', inv.LO || ' to ' || inv.HI,
       'No stock trend can be measured; weekly stock is modelled across the whole window.', TRUE
FROM inv
UNION ALL SELECT 5, 'LOAD', 'MEDIUM', 'CURATED.DIM_STORE', 'OPEN_DATE',
       'Every store carries the same opening date.', st.N || ' stores, ' || st.DATES || ' date (' || st.D || ')',
       'All 60 treated as comparable. The four FY27 H1 openings are planned in this tab, not sourced.', TRUE
FROM st
UNION ALL SELECT 6, 'PROFILE', 'MEDIUM', 'CURATED.FACT_TRANSACTION_LINES', 'NET_REVENUE',
       'Store sales are implausibly uniform over 22 months: every store lands within a few percent of every other.',
       'AUD ' || ROUND(spread.LO, 2) || 'M - ' || ROUND(spread.HI, 2) || 'M per store',
       'Used as is. Store-level drivers vary by format and region so the plan is not uniform too.', TRUE
FROM spread
UNION ALL SELECT 7, 'PROFILE', 'LOW', 'CURATED.FACT_TRANSACTION_LINES', 'PROMOTION_KEY',
       'A promotion and a clearance markdown cannot be told apart.', '12.5% of LY sales discounted or promoted',
       'Both treated as clearance (PLANNING_SETTING CLEARANCE_DEFINITION).', TRUE
UNION ALL SELECT 8, 'LOAD', 'LOW', 'ANALYTICS.DIM_PLAN_OPTION', 'OPTION_STATUS',
       'A dropped option does not say whether it was new or ongoing.', 'DESELECTED with no prior status',
       'Split assigned at 40% new by a seeded hash, and labelled as assigned.', TRUE
UNION ALL SELECT 9, 'LOAD', 'LOW', 'CURATED.DIM_STORE', NULL,
       'No selling area is held for any store.', 'no floor-area column',
       'Shown as not recorded. Area is never inferred from sales density.', TRUE
UNION ALL SELECT 10, 'LOAD', 'LOW', 'CURATED.DIM_DATE', 'CALENDAR_DATE',
       'The date dimension ends before the plan half begins.', '2026-06-30',
       'The planning calendar is generated (DIM_CALENDAR_WEEK, FY25-FY27).', FALSE
UNION ALL SELECT 11, 'LOAD', 'LOW', 'CURATED.FACT_TRANSACTION_LINES', 'DATE_KEY',
       'POS ends part-way through a week.', pos.LAST_DAY::VARCHAR,
       'That part-week is excluded from TY actuals so it does not read as a collapse in sales.', FALSE
FROM pos;

-- ---------- 4. The audit trail ----------
-- Every plan edit: who, when, why, and under which ownership class. This is the
-- trail that replaces "someone typed =this*0.6 an hour before the meeting".
CREATE OR REPLACE TABLE PLAN_CELL_OVERRIDE (
  OVERRIDE_ID             NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  MARKET_CODE             VARCHAR,
  PLAN_KIND               VARCHAR COMMENT 'STORE_PLAN | STORE_PLAN_WEEK | MFP | WSSI_DISPLAY',
  ENTITY_CODE             VARCHAR COMMENT 'Store code, department or RBU.',
  FY_YEAR                 NUMBER(4,0),
  MONTH_NAME              VARCHAR COMMENT 'Month, H1, or a grain:period for the WSSI.',
  MEASURE_CODE            VARCHAR,
  OLD_VALUE               FLOAT,
  NEW_VALUE               FLOAT,
  REASON_CODE             VARCHAR,
  RATIONALE               VARCHAR,
  CHANGED_BY              VARCHAR,
  CHANGED_AT              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  APPROVAL_ID             NUMBER COMMENT 'The baseline in force when the edit was made. NULL while in draft.',
  SURFACE                 VARCHAR,
  EDIT_CLASS              VARCHAR COMMENT 'Ownership class at the time of the edit.',
  OWNING_PARTY            VARCHAR,
  ON_BEHALF_OF            VARCHAR COMMENT 'Set when Planning keys a number Buying owns.',
  IS_POST_LOCK_AMENDMENT  BOOLEAN COMMENT 'TRUE when edited after the plan was locked.',
  ESCALATION_NOTE         VARCHAR COMMENT 'Why an approved number could not wait for the next cycle.'
) COMMENT = 'Every plan edit, with who, when, why and the ownership class it was made under.';

-- The driver rationale above was "migrated" from spreadsheet cell comments, so the
-- history starts with them rather than empty.
INSERT INTO PLAN_CELL_OVERRIDE
  (MARKET_CODE, PLAN_KIND, ENTITY_CODE, FY_YEAR, MONTH_NAME, MEASURE_CODE, OLD_VALUE, NEW_VALUE,
   REASON_CODE, RATIONALE, CHANGED_BY, CHANGED_AT, SURFACE, EDIT_CLASS, OWNING_PARTY, IS_POST_LOCK_AMENDMENT)
SELECT 'AU', 'STORE_PLAN', d.STORE_CODE, d.FY_YEAR, d.MONTH_NAME,
       IFF(d.REASON_CODE = 'CLEARANCE_PUSH', 'MARGIN_PCT', 'LFL_PCT'), NULL,
       IFF(d.REASON_CODE = 'CLEARANCE_PUSH', d.MARGIN_PCT, d.LFL_PCT),
       d.REASON_CODE, d.RATIONALE, 'migrated-from-spreadsheet', '2026-05-20 09:00:00',
       'STORE_PLAN', IFF(d.REASON_CODE = 'CLEARANCE_PUSH', 'PLANNING', 'JOINT'),
       IFF(d.REASON_CODE = 'CLEARANCE_PUSH', 'PLANNING', 'BOTH'), FALSE
FROM STORE_PLAN_DRIVER d
WHERE d.RATIONALE IS NOT NULL;

-- ---------- 5. Approval ----------
-- The store plan locks at the board meeting so performance can be measured
-- against what was actually agreed. The snapshot is an INSERT-ONLY row copy, not
-- a flag: a flag can be edited. The narrative is IMMUTABLE: a correction is
-- appended as an amendment and shown beside the original, because a record that
-- can be rewritten is not a record.
CREATE OR REPLACE TABLE PLAN_APPROVAL (
  APPROVAL_ID          NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  MARKET_CODE          VARCHAR,
  PLAN_KIND            VARCHAR COMMENT 'STORE_PLAN',
  SCOPE                VARCHAR,
  FY_YEAR              NUMBER(4,0),
  FY_HALF              VARCHAR,
  STATE                VARCHAR COMMENT 'APPROVED | SUPERSEDED',
  SUBMITTED_BY         VARCHAR,
  SUBMITTED_AT         TIMESTAMP_NTZ,
  APPROVED_BY          VARCHAR,
  APPROVED_AT          TIMESTAMP_NTZ,
  BOARD_MEETING_DATE   DATE,
  NARRATIVE            VARCHAR,
  TOTAL_SALES_AUD      NUMBER(38,2) COMMENT 'Headline agreed at approval, stored so it cannot drift.',
  TOTAL_MARGIN_AUD     NUMBER(38,2),
  SUPERSEDED_BY        NUMBER
) COMMENT = 'Approval state machine for the store plan.';

CREATE OR REPLACE TABLE PLAN_APPROVAL_SNAPSHOT (
  APPROVAL_ID     NUMBER,
  SNAPSHOT_AT     TIMESTAMP_NTZ,
  MARKET_CODE     VARCHAR,
  STORE_CODE      VARCHAR,
  WEEK_END_DATE   DATE,
  FY_YEAR         NUMBER(4,0),
  MONTH_NAME      VARCHAR,
  MEASURE_CODE    VARCHAR,
  MEASURE_VALUE   FLOAT
) COMMENT = 'Immutable copy of every planned value at the moment of approval.';

CREATE OR REPLACE TABLE PLAN_APPROVAL_AMENDMENT (
  AMENDMENT_ID     NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  APPROVAL_ID      NUMBER NOT NULL,
  PRIOR_NARRATIVE  VARCHAR NOT NULL,
  AMENDMENT_NOTE   VARCHAR NOT NULL,
  AMENDED_BY       VARCHAR NOT NULL,
  AMENDED_AT       TIMESTAMP_NTZ NOT NULL,
  CHANGED_FIGURES  BOOLEAN NOT NULL COMMENT 'A correction that moved an approved number needs a fresh approval, not an amendment.'
) COMMENT = 'Append-only corrections to an approval narrative. The narrative itself is never edited.';

-- ---------- 6. Scenarios, events, targets, comments ----------
-- A sandbox is a COPY of the live drivers taken at creation, so live edits made
-- afterwards do not leak into a scenario someone is still working on.
CREATE OR REPLACE TABLE PLAN_SCENARIO (
  SCENARIO_ID        NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  SCENARIO_CODE      VARCHAR,
  SCENARIO_NAME      VARCHAR,
  SCENARIO_KIND      VARCHAR COMMENT 'BASELINE | SANDBOX',
  BASE_SCENARIO_ID   NUMBER,
  STATUS             VARCHAR COMMENT 'DRAFT | SUBMITTED | ARCHIVED',
  CURRENT_REVISION   NUMBER,
  CREATED_BY         VARCHAR,
  CREATED_AT         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_AT         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Store plan scenarios. BASELINE is the live plan; a SANDBOX is a prompt-free copy to try things in.';

INSERT INTO PLAN_SCENARIO (SCENARIO_CODE, SCENARIO_NAME, SCENARIO_KIND, BASE_SCENARIO_ID, STATUS, CURRENT_REVISION, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES ('BASELINE', 'Live plan', 'BASELINE', NULL, 'DRAFT', 1, 'seed', '2026-05-20 09:00:00', '2026-05-20 09:00:00');

CREATE OR REPLACE TABLE PLAN_SCENARIO_PERIOD (
  SCENARIO_ID   NUMBER,
  PERIOD_KEY    VARCHAR,
  IS_SELECTED   BOOLEAN
) COMMENT = 'Which plan months a sandbox includes.';

CREATE OR REPLACE TABLE PLAN_SCENARIO_REVISION (
  SCENARIO_ID   NUMBER,
  REVISION_NO   NUMBER,
  NOTE          VARCHAR,
  CREATED_BY    VARCHAR,
  CREATED_AT    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Revision log per scenario.';

CREATE OR REPLACE TABLE STORE_PLAN_SCENARIO_CELL (
  CELL_ID        NUMBER IDENTITY(1,1),
  SCENARIO_ID    NUMBER,
  STORE_CODE     VARCHAR,
  WEEK_END_DATE  DATE,
  MEASURE_CODE   VARCHAR COMMENT 'LFL_PCT | MARGIN_PCT | SALES_AUD',
  VALUE          FLOAT,
  BATCH          VARCHAR COMMENT 'SCENARIO_SNAPSHOT for the copy taken at creation; EDIT or TARGET after.',
  CHANGED_BY     VARCHAR,
  CHANGED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Sandbox drivers per store-week. The latest row per scenario/store/week/measure wins.';

CREATE OR REPLACE TABLE STORE_PLAN_EVENT (
  EVENT_ID          NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  SCENARIO_ID       NUMBER,
  STORE_CODE        VARCHAR,
  START_DATE        DATE,
  END_DATE          DATE,
  EVENT_TYPE        VARCHAR COMMENT 'FULL_CLOSURE | REFURB_CLOSURE | REDUCED_CAPACITY | REOPENING_RAMP | CENTRE_EVENT',
  ADJUSTMENT_METHOD VARCHAR COMMENT 'ZERO | CAPACITY_FACTOR',
  ADJUSTMENT_VALUE  FLOAT,
  DESCRIPTION       VARCHAR,
  STATUS            VARCHAR,
  CREATED_BY        VARCHAR,
  CREATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Store events in a sandbox. A closure zeroes the week; a capacity event scales it; overlapping events take the minimum.';

CREATE OR REPLACE TABLE STORE_PLAN_TARGET (
  TARGET_ID         NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  SCENARIO_ID       NUMBER,
  MEASURE_CODE      VARCHAR,
  SCOPE_TYPE        VARCHAR COMMENT 'MARKET | REGION | STORE',
  SCOPE_CODE        VARCHAR,
  START_DATE        DATE,
  END_DATE          DATE,
  CURRENT_VALUE     FLOAT,
  TARGET_VALUE      FLOAT,
  ALLOCATION_METHOD VARCHAR,
  CREATED_BY        VARCHAR,
  CREATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Top-down targets applied in a sandbox, allocated in proportion to the current weekly shape.';

CREATE OR REPLACE TABLE PLAN_COMMENT (
  COMMENT_ID         NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  SCENARIO_ID        NUMBER,
  STORE_CODE         VARCHAR,
  COMMENT_TEXT       VARCHAR,
  PARENT_COMMENT_ID  NUMBER,
  STATUS             VARCHAR,
  CREATED_BY         VARCHAR,
  CREATED_AT         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Store comments, per scenario. A NULL scenario is the live plan.';

-- ---------- 7. AI: doctrine, templates, runs ----------
-- DOCTRINE is the head of planning's standing method. It is versioned and
-- insert-only, so advice keeps the guidance it was actually given: change the
-- method today and last month's insight still shows the method behind it.
CREATE OR REPLACE TABLE INSIGHT_DOCTRINE (
  DOCTRINE_VERSION  NUMBER,
  DOCTRINE_TEXT     VARCHAR,
  TONE              VARCHAR,
  IS_ACTIVE         BOOLEAN,
  AUTHORED_BY       VARCHAR,
  RATIONALE         VARCHAR,
  CREATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'The head of planning''s method, versioned and insert-only. Insights record the version they were given.';

INSERT INTO INSIGHT_DOCTRINE VALUES (1,
'1. Start with the gap to the board-locked budget. Say which way it runs and by how much, in dollars and in points.
2. Separate like-for-like from new stores. A new store has no like-for-like; never let one flatter or depress the LFL figure.
3. Top-down against bottom-up: when the range Buying committed does not deliver the growth stated for it, name the department and say whether it is ASP or units that falls short.
4. First margin and exit margin are different numbers. First margin is struck at intake; exit margin is what the till realises after discount. Never quote one as the other.
5. A first-margin step-up above 10 points in a single year is the largest assumption in any plan. Call it out and ask what has changed to justify it.
6. Stock: forward cover above 26 weeks is a data problem before it is a stock problem. Do not recommend a buy on cover you cannot trust.
7. Every figure marked as an assumption, modelled or placeholder is not a measurement. Say so whenever you rely on one.
8. Name who owns each action: Planning for the top-down, Buying for the range, Joint for anything agreed at range review.
9. Recommend at most three actions, most valuable first.',
'Direct and specific. A finance-literate planner is reading. No hedging, no filler.',
TRUE, 'Head of Planning', 'Initial method', '2026-05-22 10:00:00');

CREATE OR REPLACE TABLE INSIGHT_TEMPLATE (
  TEMPLATE_ID       NUMBER,
  SURFACE           VARCHAR COMMENT 'OVERVIEW | STORE_PLAN | MFP | WSSI | TPR',
  NAME              VARCHAR,
  TASK_INSTRUCTION  VARCHAR,
  FOCUS_MEASURES    VARCHAR,
  MODEL             VARCHAR,
  MAX_FINDINGS      NUMBER,
  IS_ACTIVE         BOOLEAN,
  UPDATED_BY        VARCHAR,
  UPDATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'What to look at on each screen. Edited in place; every insight run records the template it used.';

INSERT INTO INSIGHT_TEMPLATE VALUES
  (1, 'OVERVIEW', 'The half at a glance',
   'Say whether the plan is on track to deliver the board-locked budget, what is outstanding, and the single biggest risk to the half.',
   'PLAN_TOTAL_AUD, LFL, NEW_STORE_AUD, FIRST_MARGIN, EXIT_MARGIN, tracking variance', 'claude-sonnet-4-6', 4, TRUE, 'seed', '2026-05-22 10:00:00'),
  (2, 'STORE_PLAN', 'Store plan review',
   'Find the stores and months whose drivers carry the plan, the ones that look unsupported, and what the new stores add.',
   'LFL %, margin %, new-store sales, halo weeks', 'claude-sonnet-4-6', 4, TRUE, 'seed', '2026-05-22 10:00:00'),
  (3, 'MFP', 'Does the product plan deliver the budget?',
   'Compare the bottom-up range plan with the top-down budget by department. Name each growth break and say whether ASP or units explains it.',
   'TPR budget, LFL forecast, growth stated vs derived, ASP growth, unit growth, first-margin move', 'claude-sonnet-4-6', 5, TRUE, 'seed', '2026-05-22 10:00:00'),
  (4, 'WSSI', 'Weekly trading position',
   'Say how this year is tracking against forecast, budget and last year, and what the stock position means for buying. Treat modelled stock as modelled.',
   'TY vs FC, TY vs BUD, TY vs LY, POS margin, forward cover, OTB', 'claude-sonnet-4-6', 4, TRUE, 'seed', '2026-05-22 10:00:00'),
  (5, 'TPR', 'Range review',
   'Where is range lost, what budget sits on dropped options, which departments fall below a credible offer, and which suppliers short-ship most.',
   'options presented, committed, dropped, sales at risk, short-ship %', 'claude-sonnet-4-6', 4, TRUE, 'seed', '2026-05-22 10:00:00');

CREATE OR REPLACE TABLE INSIGHT_RUN (
  RUN_ID               NUMBER AUTOINCREMENT START 1 INCREMENT 1,
  SURFACE              VARCHAR,
  TEMPLATE_ID          NUMBER,
  DOCTRINE_VERSION     NUMBER,
  MODEL                VARCHAR,
  QUESTION             VARCHAR,
  GROUNDING_PAYLOAD    VARIANT,
  PROMPT_CHARS         NUMBER,
  RESPONSE             VARIANT,
  FIGURES_CITED        VARIANT,
  UNVERIFIED_FIGURES   VARIANT,
  IS_VERIFIED          BOOLEAN,
  PROMPT_TOKENS        NUMBER,
  COMPLETION_TOKENS    NUMBER,
  TOTAL_TOKENS         NUMBER,
  ERROR_MESSAGE        VARCHAR,
  GENERATED_BY         VARCHAR,
  GENERATED_AT         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Every insight generated, verified or not, including failures. Hiding a failed insight would be a silent failure.';
